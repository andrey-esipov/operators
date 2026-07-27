/**
 * Impact synthesis — the core craft.
 *
 * Every hit is built from up to five authored layers so it reads as a physical
 * event rather than a beep:
 *   1. TRANSIENT  — sub-millisecond high-passed noise/click ("snap", the attack)
 *   2. BODY       — pitch-swept sine 120→50Hz ("thump", the weight)
 *   3. SUB        — optional 45→28Hz sine for chest-punch on big hits
 *   4. TEXTURE    — bandpassed noise burst ("crunch", broadband grit)
 *   5. RING/TAIL  — inharmonic partials + convolution send ("space", the decay)
 *
 * All builders take a supplied context + routing nodes so the identical graph
 * renders live or offline. Attack is always <5ms; decay is always authored.
 */

import {
  type Ctx,
  noiseBuffer,
  bufferVoice,
  oscVoice,
  distortionCurve,
  clamp,
} from './dsp'

export type Flavor =
  | 'light'
  | 'heavy'
  | 'crit'
  | 'combo'
  | 'ex'
  | 'ult'
  | 'signature'
  | 'shatter'
  | 'ko'

export interface ImpactRouting {
  /** Dry destination (into the SFX bus / mastering chain). */
  out: AudioNode
  /** Reverb send input (pre-convolver). May be null offline for a dry render. */
  reverb?: AudioNode | null
  /** Optional callback fired at the physical impact moment (for ducking). */
  onImpact?: (when: number, intensity: number) => void
}

export interface ImpactOpts {
  power?: number // 0..1 authored intensity within the flavor
  damage?: number // raw damage, lightly scales size
  pan?: number // -1..1
  seed?: number // deterministic noise (offline)
}

type NoiseColor = 'white' | 'pink' | 'brown' | 'blue'

interface HitSpec {
  gain: number
  /**
   * CONTACT TRANSIENT — a differentiated broadband crack (NOT a universal
   * needle). `attack` (s) authors the rising edge (0.3–1.8ms) so each flavour
   * has its own snap; `level*punch` is its amplitude; `hp`/`lp` shape its
   * timbre. Bypasses the per-hit drive so it stays a sharp spike.
   */
  crack: { level: number; punch: number; hp: number; lp?: number; attack: number; dur: number; color: NoiseColor }
  /** High-passed noise sizzle tail riding the attack (stereo air; goes through drive). */
  sizzle?: { level: number; hp: number; dur: number; color: NoiseColor; spread?: number }
  /** Pitch-swept body thump; `partial`/`partialLevel` add an inharmonic mode so it isn't a pure sine. */
  body: { level: number; f0: number; f1: number; dur: number; type: OscillatorType; partial?: number; partialLevel?: number }
  /** Lowpassed noise burst co-located with the body — roughens the low end (kills the clean sine rail). */
  bodyGrit?: { level: number; lp: number; dur: number }
  sub?: { level: number; f0: number; f1: number; dur: number }
  /** Punchy 60–120Hz transient "thump" — concentrated low-mid body at the moment
   * of contact. Short + fast so it adds measurable 60–120Hz authority AND crest
   * (it's a transient, not a sustained tone). */
  thump?: { level: number; f0: number; dur: number }
  texture: { level: number; bp: number; q: number; dur: number; color: NoiseColor; spread?: number; haas?: number }
  ring?: { level: number; partials: number[]; dur: number; type?: OscillatorType; spread?: number }
  drive: number // 0..1 waveshaper aggression
  reverbSend: number
}



/** Build one fully-layered impact starting at `when`, return its end time. */
function oneHit(
  ctx: Ctx,
  routing: ImpactRouting,
  when: number,
  spec: HitSpec,
  pan: number,
  seed: number,
): number {
  const panner = ctx.createStereoPanner()
  panner.pan.value = clamp(pan, -1, 1)

  // Optional drive stage for aggression, then to dry out + reverb send.
  let head: AudioNode = panner
  if (spec.drive > 0.001) {
    const ws = ctx.createWaveShaper()
    ws.curve = distortionCurve(spec.drive)
    ws.oversample = '4x'
    const mk = ctx.createGain()
    mk.gain.value = 1 / (1 + spec.drive) // makeup trim so drive doesn't blow level
    panner.connect(ws)
    ws.connect(mk)
    head = mk
  }
  head.connect(routing.out)
  if (routing.reverb && spec.reverbSend > 0) {
    const send = ctx.createGain()
    send.gain.value = spec.reverbSend
    head.connect(send)
    send.connect(routing.reverb)
  }

  const g = ctx.createGain()
  g.gain.value = spec.gain
  g.connect(panner)

  let end = when

  // 1) CONTACT TRANSIENT — the crack. A differentiated broadband spike that
  //    OWNS the peak, with an AUTHORED rising edge (0.3–1.8ms, per flavour) so
  //    it doesn't read as the same universal needle. Bypasses the per-hit drive
  //    so saturation can't flatten it, and carries a high-passed sizzle tail.
  {
    const c = spec.crack
    const cb = noiseBuffer(ctx, Math.max(0.012, c.dur * 2), { color: c.color, seed: seed + 5 })
    const crack = bufferVoice(ctx, cb)
    const chp = ctx.createBiquadFilter(); chp.type = 'highpass'; chp.frequency.value = c.hp; chp.Q.value = 0.5
    const cpan = ctx.createStereoPanner(); cpan.pan.value = clamp(pan, -1, 1)
    crack.gain.disconnect(); crack.src.connect(crack.gain); crack.gain.connect(chp)
    let ctail: AudioNode = chp
    if (c.lp) { const clp = ctx.createBiquadFilter(); clp.type = 'lowpass'; clp.frequency.value = c.lp; chp.connect(clp); ctail = clp }
    ctail.connect(cpan); cpan.connect(routing.out)
    if (routing.reverb && spec.reverbSend > 0) {
      const cs = ctx.createGain(); cs.gain.value = spec.reverbSend * 0.45
      cpan.connect(cs); cs.connect(routing.reverb)
    }
    const peak = c.level * spec.gain * c.punch
    crack.gain.gain.setValueAtTime(0.0001, when)
    crack.gain.gain.linearRampToValueAtTime(peak, when + c.attack) // authored rise
    crack.gain.gain.exponentialRampToValueAtTime(0.0001, when + c.attack + c.dur)
    crack.src.start(when); crack.src.stop(when + c.attack + c.dur + 0.01)

    if (spec.sizzle) {
      const s = spec.sizzle
      // Two decorrelated HP-noise voices panned L/R — adds stereo air to every
      // hit without touching the mono low-end punch.
      const sp = s.spread ?? 0.8
      for (const side of [-sp, sp]) {
        const nb = noiseBuffer(ctx, Math.max(0.02, s.dur * 2), { color: s.color, seed: seed + (side < 0 ? 0 : 128) })
        const { src, gain } = bufferVoice(ctx, nb)
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = s.hp; hp.Q.value = 0.6
        const spn = ctx.createStereoPanner(); spn.pan.value = clamp(pan + side, -1, 1)
        src.connect(gain); gain.disconnect(); gain.connect(hp); hp.connect(spn); spn.connect(g)
        gain.gain.setValueAtTime(0.0001, when)
        gain.gain.linearRampToValueAtTime(s.level * 0.5, when + 0.0006)
        gain.gain.exponentialRampToValueAtTime(0.0001, when + s.dur)
        src.start(when); src.stop(when + s.dur + 0.01)
        end = Math.max(end, when + s.dur)
      }
    }
  }

  // 2) BODY — pitch-swept thump. Delayed ~1.6ms so the crack owns the first
  //    sample. The tonal core (fundamental + inharmonic partner) decays FAST so
  //    it delivers a thwack, NOT a ringing sine rail; a mono, irregularly-
  //    modulated noise bed then fills the WHOLE remaining decay so the tail
  //    reads as physical debris/tearing rather than a clean damped oscillator.
  {
    const b = spec.body
    const bWhen = when + 0.0016
    const tonalDur = b.dur * 0.5 // short tonal thwack
    const { osc, gain } = oscVoice(ctx, b.type, b.f0)
    osc.frequency.setValueAtTime(b.f0, bWhen)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, b.f1), bWhen + tonalDur)
    // vibrato — a few cents of wobble so even the short tone isn't a static rail
    const vib = ctx.createOscillator(); vib.type = 'sine'; vib.frequency.value = 7 + (seed % 5)
    const vibG = ctx.createGain(); vibG.gain.value = b.f0 * 0.014
    vib.connect(vibG); vibG.connect(osc.frequency)
    vib.start(bWhen); vib.stop(bWhen + tonalDur + 0.02)
    gain.connect(g)
    gain.gain.setValueAtTime(0.0001, bWhen)
    gain.gain.linearRampToValueAtTime(b.level, bWhen + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.0001, bWhen + tonalDur)
    osc.start(bWhen); osc.stop(bWhen + tonalDur + 0.02)
    end = Math.max(end, bWhen + tonalDur)

    if (b.partial && b.partialLevel) {
      // inharmonic ratio (non-integer) → beating; also decays fast.
      const ratio = b.partial * 0.987
      const p2 = oscVoice(ctx, 'sine', b.f0 * ratio)
      p2.osc.frequency.setValueAtTime(b.f0 * ratio, bWhen)
      p2.osc.frequency.exponentialRampToValueAtTime(Math.max(30, b.f1 * ratio), bWhen + tonalDur * 0.8)
      p2.gain.connect(g)
      p2.gain.gain.setValueAtTime(0.0001, bWhen)
      p2.gain.gain.linearRampToValueAtTime(b.partialLevel, bWhen + 0.004)
      p2.gain.gain.exponentialRampToValueAtTime(0.0001, bWhen + tonalDur * 0.7)
      p2.osc.start(bWhen); p2.osc.stop(bWhen + tonalDur * 0.8 + 0.02)
    }

    if (spec.bodyGrit) {
      // Mono (width-controlled) low noise bed spanning the WHOLE body decay with
      // an IRREGULAR amplitude walk so late-tail energy is stochastic — this is
      // what turns a synth boom into a physical impact and erases harmonic rails.
      const bg = spec.bodyGrit
      const bedDur = Math.max(bg.dur, b.dur)
      const nb = noiseBuffer(ctx, bedDur * 1.4, { color: 'brown', stereo: false, seed: seed + 71 })
      const { src, gain: gg } = bufferVoice(ctx, nb)
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = bg.lp; lp.Q.value = 0.9
      lp.frequency.setValueAtTime(bg.lp, bWhen)
      lp.frequency.exponentialRampToValueAtTime(Math.max(120, bg.lp * 0.5), bWhen + bedDur)
      src.connect(gg); gg.disconnect(); gg.connect(lp); lp.connect(g)
      const rnd = mulberryLite(seed + 313)
      const steps = 10
      gg.gain.setValueAtTime(0.0001, bWhen)
      gg.gain.linearRampToValueAtTime(bg.level, bWhen + 0.002)
      for (let i = 1; i <= steps; i++) {
        const t = bWhen + (bedDur * i) / steps
        // gentler fade + a modest sustain floor: late-tail noise stays present
        // but not so loud it crushes the transient crest.
        const decay = 0.08 + 0.92 * Math.pow(1 - i / (steps + 1), 1.15)
        const jitter = 0.5 + 0.9 * rnd() // irregular texture
        gg.gain.linearRampToValueAtTime(Math.max(0.0001, bg.level * decay * jitter), t)
      }
      gg.gain.exponentialRampToValueAtTime(0.0001, bWhen + bedDur + 0.02)
      src.start(bWhen); src.stop(bWhen + bedDur + 0.02)
      end = Math.max(end, bWhen + bedDur)

      // Debris air: a brighter, STEREO-decorrelated pair riding the tail — restores
      // tail width + high texture (physical shards) while the low bed stays mono.
      for (const side of [-0.7, 0.7]) {
        const dnb = noiseBuffer(ctx, bedDur * 1.4, { color: 'white', stereo: false, seed: seed + 411 + (side < 0 ? 0 : 37) })
        const dv = bufferVoice(ctx, dnb)
        const dhp = ctx.createBiquadFilter(); dhp.type = 'highpass'; dhp.frequency.value = 1300; dhp.Q.value = 0.5
        const dpan = ctx.createStereoPanner(); dpan.pan.value = clamp(pan + side, -1, 1)
        dv.gain.disconnect(); dv.src.connect(dv.gain); dv.gain.connect(dhp); dhp.connect(dpan); dpan.connect(g)
        const dl = bg.level * 0.7
        dv.gain.gain.setValueAtTime(0.0001, bWhen)
        dv.gain.gain.linearRampToValueAtTime(dl, bWhen + 0.002)
        dv.gain.gain.exponentialRampToValueAtTime(0.0001, bWhen + bedDur * 0.9)
        dv.src.start(bWhen); dv.src.stop(bWhen + bedDur + 0.02)
      }
    }
  }

  // 3) SUB — chest-punch, big hits only. Mono (kept centre for a solid low end).
  if (spec.sub) {
    const s = spec.sub
    const sWhen = when + 0.0025
    const { osc, gain } = oscVoice(ctx, 'sine', s.f0)
    osc.frequency.setValueAtTime(s.f0, sWhen)
    osc.frequency.exponentialRampToValueAtTime(Math.max(18, s.f1), sWhen + s.dur)
    gain.connect(g)
    gain.gain.setValueAtTime(0.0001, sWhen)
    gain.gain.linearRampToValueAtTime(s.level, sWhen + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, sWhen + s.dur)
    osc.start(sWhen); osc.stop(sWhen + s.dur + 0.02)
    end = Math.max(end, sWhen + s.dur)
  }

  // 3b) THUMP — a punchy 60–120Hz half-cycle at contact. Short + steep so its
  //     energy lands on the transient (raising 60–120Hz authority AND crest).
  if (spec.thump) {
    const t = spec.thump
    const tWhen = when + 0.0015
    const { osc, gain } = oscVoice(ctx, 'sine', t.f0)
    osc.frequency.setValueAtTime(t.f0 * 1.6, tWhen) // quick drop = "thud"
    osc.frequency.exponentialRampToValueAtTime(t.f0, tWhen + t.dur * 0.7)
    gain.connect(g)
    gain.gain.setValueAtTime(0.0001, tWhen)
    gain.gain.linearRampToValueAtTime(t.level, tWhen + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.0001, tWhen + t.dur)
    osc.start(tWhen); osc.stop(tWhen + t.dur + 0.02)
    end = Math.max(end, tWhen + t.dur)
  }

  // 4) TEXTURE — broadband noise crunch as TWO decorrelated voices panned L/R
  //    (different centres + seeds), with an optional Haas delay on one side to
  //    widen the stereo image. Sub/body stay mono; the "air" spreads.
  {
    const x = spec.texture
    const spread = x.spread ?? 0.7
    const haas = x.haas ?? 0
    const voices: Array<{ mult: number; pan: number; seed: number; delay: number }> = [
      { mult: 0.55, pan: -spread, seed: seed + 31, delay: 0 },
      { mult: 1.7, pan: spread, seed: seed + 61, delay: haas },
    ]
    for (const v of voices) {
      const nb = noiseBuffer(ctx, Math.max(0.05, x.dur * 1.3), { color: x.color, seed: v.seed })
      const { src, gain } = bufferVoice(ctx, nb)
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = x.bp * v.mult; bp.Q.value = x.q * 0.7
      const vp = ctx.createStereoPanner(); vp.pan.value = clamp(pan + v.pan, -1, 1)
      gain.disconnect(); src.connect(gain); gain.connect(bp)
      let vtail: AudioNode = bp
      if (v.delay > 0) { const d = ctx.createDelay(0.05); d.delayTime.value = v.delay; bp.connect(d); vtail = d }
      vtail.connect(vp); vp.connect(g)
      bp.frequency.setValueAtTime(x.bp * v.mult * 1.4, when)
      bp.frequency.exponentialRampToValueAtTime(Math.max(120, x.bp * v.mult * 0.7), when + x.dur)
      gain.gain.setValueAtTime(0.0001, when)
      gain.gain.linearRampToValueAtTime(x.level * 0.72, when + 0.0016)
      gain.gain.exponentialRampToValueAtTime(0.0001, when + x.dur)
      src.start(when); src.stop(when + x.dur + 0.02)
      end = Math.max(end, when + x.dur)
    }
  }

  // 5) RING — inharmonic modes (metal/glass/energy). Built as NOISE-EXCITED
  //    RESONATORS (a noise burst through a high-Q bandpass) with slow frequency
  //    DRIFT + randomized per-mode decay, so each mode is a shimmering,
  //    non-stationary partial rather than a clean horizontal rail. A faint pure
  //    oscillator adds just enough pitch definition.
  if (spec.ring) {
    const r = spec.ring
    const spread = r.spread ?? 0
    const rnd = mulberryLite(seed + 907)
    r.partials.forEach((f, i) => {
      const lvl = r.level * (1 - i / (r.partials.length + 1))
      const dur = r.dur * (0.55 + 0.5 * (1 - i / r.partials.length)) * (0.8 + 0.4 * rnd())
      let dest: AudioNode = g
      if (spread > 0) {
        const rp = ctx.createStereoPanner()
        rp.pan.value = clamp(pan + (i % 2 === 0 ? -spread : spread) * (0.6 + 0.4 * (i / r.partials.length)), -1, 1)
        rp.connect(g); dest = rp
      }
      // resonator: noise → high-Q bandpass that rings at f, with drift. Stereo-
      // decorrelated excitation so the mode has natural width without railing.
      const nb = noiseBuffer(ctx, dur * 1.5, { color: 'white', stereo: true, seed: seed + 1201 + i * 13 })
      const { src, gain: ng } = bufferVoice(ctx, nb)
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'
      const Q = 16 + 14 * rnd()
      bp.Q.value = Q
      const drift = 0.97 + 0.06 * rnd()
      bp.frequency.setValueAtTime(f * (1.01 + 0.02 * rnd()), when + 0.001)
      bp.frequency.exponentialRampToValueAtTime(Math.max(120, f * drift), when + dur)
      src.connect(ng); ng.disconnect(); ng.connect(bp); bp.connect(dest)
      ng.gain.setValueAtTime(0.0001, when + 0.001)
      ng.gain.linearRampToValueAtTime(lvl * 1.5, when + 0.004)
      const steps = 6
      for (let s = 1; s <= steps; s++) {
        const t = when + 0.004 + (dur - 0.004) * (s / steps)
        const decay = Math.pow(1 - s / (steps + 1), 1.7) // snappier → higher crest
        const jit = 0.4 + 0.9 * rnd()
        ng.gain.linearRampToValueAtTime(Math.max(0.0001, lvl * 1.5 * decay * jit), t)
      }
      ng.gain.exponentialRampToValueAtTime(0.0001, when + dur + 0.005)
      src.start(when + 0.001); src.stop(when + dur + 0.02)
      // faint pure tone for pitch definition (low level so it doesn't rail)
      const { osc, gain: og } = oscVoice(ctx, r.type ?? 'sine', f)
      og.connect(dest)
      og.gain.setValueAtTime(0.0001, when + 0.001)
      og.gain.linearRampToValueAtTime(lvl * 0.3, when + 0.004)
      og.gain.exponentialRampToValueAtTime(0.0001, when + dur * 0.7)
      osc.start(when + 0.001); osc.stop(when + dur * 0.7 + 0.02)
      end = Math.max(end, when + dur)
    })
  }

  routing.onImpact?.(when, spec.gain)
  return end
}

// ─── Per-flavour specs ────────────────────────────────────────────────────

function scale(spec: HitSpec, k: number): HitSpec {
  return { ...spec, gain: spec.gain * k }
}

function lightSpec(p: number): HitSpec {
  return {
    gain: 2.4 * (0.8 + 0.4 * p),
    // crisp but with real contact: a snappy crack over a present, darker thump.
    crack: { level: 0.7, punch: 1.4, hp: 2200, lp: 9000, attack: 0.0004, dur: 0.0035, color: 'white' },
    sizzle: { level: 0.5, hp: 3400, dur: 0.045, color: 'blue', spread: 0.75 },
    body: { level: 1.5, f0: 165, f1: 62, dur: 0.14, type: 'sine', partial: 2.4, partialLevel: 0.24 },
    bodyGrit: { level: 0.5, lp: 1100, dur: 0.1 },
    texture: { level: 0.6, bp: 2400, q: 0.9, dur: 0.08, color: 'white', spread: 0.85, haas: 0.006 },
    drive: 0.12,
    reverbSend: 0.14,
  }
}

function heavySpec(p: number): HitSpec {
  return {
    gain: 1.05 * (0.85 + 0.3 * p),
    crack: { level: 1.55, punch: 4.5, hp: 1500, lp: 6800, attack: 0.0006, dur: 0.009, color: 'white' },
    sizzle: { level: 0.26, hp: 1500, dur: 0.09, color: 'pink' },
    body: { level: 1.05, f0: 118, f1: 44, dur: 0.24, type: 'sine', partial: 2.7, partialLevel: 0.28 },
    bodyGrit: { level: 0.6, lp: 560, dur: 0.16 },
    sub: { level: 1.45, f0: 56, f1: 30, dur: 0.3 },
    thump: { level: 1.55, f0: 80, dur: 0.12 },
    texture: { level: 0.4, bp: 900, q: 0.85, dur: 0.14, color: 'pink', spread: 1.0, haas: 0.009 },
    ring: { level: 0.16, partials: [178, 267, 401, 590], dur: 0.22, type: 'sine', spread: 0.5 },
    drive: 0.28,
    reverbSend: 0.28,
  }
}

function critSpec(p: number): HitSpec {
  return {
    gain: 1.2 * (0.85 + 0.35 * p),
    // bone-crack identity: darker & more percussive than ex, metallic short ring.
    crack: { level: 1.1, punch: 3.2, hp: 2400, attack: 0.0006, dur: 0.007, color: 'white' },
    sizzle: { level: 0.5, hp: 3400, dur: 0.07, color: 'pink', spread: 0.8 },
    body: { level: 1.3, f0: 138, f1: 50, dur: 0.2, type: 'triangle', partial: 2.5, partialLevel: 0.34 },
    bodyGrit: { level: 0.95, lp: 750, dur: 0.16 },
    sub: { level: 1.05, f0: 64, f1: 30, dur: 0.26 },
    texture: { level: 0.8, bp: 2200, q: 0.6, dur: 0.16, color: 'pink', spread: 1.0, haas: 0.008 },
    ring: { level: 0.26, partials: [1400, 2100, 3200, 4300], dur: 0.26, type: 'sine', spread: 0.7 },
    drive: 0.36,
    reverbSend: 0.32,
  }
}

function exSpec(p: number): HitSpec {
  return {
    gain: 1.5 * (0.85 + 0.3 * p),
    // electric identity: bright, buzzy, sawtooth body + a long fluttering buzz.
    crack: { level: 1.1, punch: 3.1, hp: 3800, attack: 0.0005, dur: 0.006, color: 'blue' },
    sizzle: { level: 0.58, hp: 4400, dur: 0.1, color: 'blue', spread: 0.95 },
    body: { level: 1.0, f0: 158, f1: 72, dur: 0.17, type: 'sawtooth', partial: 2.0, partialLevel: 0.3 },
    bodyGrit: { level: 0.6, lp: 950, dur: 0.14 },
    sub: { level: 0.9, f0: 70, f1: 38, dur: 0.22 },
    texture: { level: 0.6, bp: 4600, q: 3.8, dur: 0.2, color: 'blue', spread: 0.95, haas: 0.009 },
    ring: { level: 0.52, partials: [1200, 1810, 2730, 4090, 5600], dur: 0.3, type: 'sawtooth', spread: 0.9 },
    drive: 0.5,
    reverbSend: 0.28,
  }
}

const IMPACT_END_PAD = 0.05

/**
 * Render an impact of `flavor` at time `when`. Composite flavours (combo,
 * ult, signature, shatter, ko) are authored as multi-stage sequences.
 * Returns the absolute end time of the sound.
 */
export function renderImpact(
  ctx: Ctx,
  routing: ImpactRouting,
  when: number,
  flavor: Flavor,
  opts: ImpactOpts = {},
): number {
  const p = clamp(opts.power ?? 0.6, 0, 1)
  const pan = opts.pan ?? 0
  const seed = opts.seed ?? ((Math.random() * 1e6) | 0)
  const dmgK = 1 + clamp((opts.damage ?? 0) / 400, 0, 0.35)

  switch (flavor) {
    case 'light':
      return oneHit(ctx, routing, when, scale(lightSpec(p), dmgK), pan, seed) + IMPACT_END_PAD
    case 'heavy':
      return oneHit(ctx, routing, when, scale(heavySpec(p), dmgK), pan, seed) + IMPACT_END_PAD
    case 'crit':
      return oneHit(ctx, routing, when, scale(critSpec(p), dmgK), pan, seed) + IMPACT_END_PAD
    case 'ex':
      return oneHit(ctx, routing, when, scale(exSpec(p), dmgK), pan, seed) + IMPACT_END_PAD

    case 'combo': {
      // 3-hit rising flurry, each a bit brighter + higher, then a heavy capper.
      // The capper lands after a short gap so the flurry has decayed away — the
      // finishing blow rises sharply from near-silence (sub-5ms local transient)
      // and is the clear global peak.
      let end = when
      const gaps = [0, 0.07, 0.14]
      gaps.forEach((gp, i) => {
        const s = lightSpec(0.5)
        s.gain *= 0.5 + i * 0.08
        s.body.f0 *= 1 + i * 0.09
        s.body.dur *= 0.5
        if (s.sizzle) s.sizzle.level *= 0.15     // much darker flurry: pulls combo's
        s.crack.hp *= 0.6                         // centroid well below the bright shatter
        s.crack.lp = 4500
        s.texture.bp *= 0.55
        s.reverbSend = 0.03
        end = Math.max(end, oneHit(ctx, routing, when + gp, s, pan + (i - 1) * 0.15, seed + i * 17))
      })
      const cap = critSpec(1.0)   // bright, sharp capper: its HF transient survives the
      cap.gain *= 1.25            // limiter as the global peak (a bass-heavy hit gets
      cap.crack.level *= 1.2      // squashed below the flurry cracks → inflated riseMs)
      cap.crack.punch *= 1.2
      cap.thump = { level: 1.3, f0: 84, dur: 0.12 } // low-end weight for the finisher
      cap.body.dur *= 0.9
      cap.reverbSend = 0.1
      end = Math.max(end, oneHit(ctx, routing, when + 0.32, cap, pan, seed + 91))
      return end + IMPACT_END_PAD
    }

    case 'shatter': {
      // Armour break: metallic pre-crack, then a cloud of inharmonic glass
      // partials with randomised decays + a noise crackle tail.
      let end = when
      const crack = critSpec(0.9)
      crack.gain *= 0.9
      crack.ring = undefined
      crack.body.level *= 0.55   // lean the pre-crack's mid/low so shatter reads brighter
      crack.sub = undefined
      end = Math.max(end, oneHit(ctx, routing, when, crack, pan, seed))
      // glass cloud
      const rnd = mulberryLite(seed + 7)
      const g = ctx.createGain()
      g.gain.value = 0.5
      g.connect(routing.out)
      if (routing.reverb) {
        const send = ctx.createGain(); send.gain.value = 0.4
        g.connect(send); send.connect(routing.reverb)
      }
      // glass cloud — shards as short NOISE-EXCITED resonators (high-Q bandpass
      // on white noise) with dispersion + pitch drift, so they read as fracturing
      // debris rather than a bank of stationary sine rails.
      for (let i = 0; i < 20; i++) {
        const f = 3200 + rnd() * 7600
        const nb2 = noiseBuffer(ctx, 0.7, { color: 'white', stereo: true, seed: seed + 200 + i * 7 })
        const sv = bufferVoice(ctx, nb2)
        const bp2 = ctx.createBiquadFilter(); bp2.type = 'bandpass'; bp2.Q.value = 22 + rnd() * 26
        const t0 = when + 0.006 + rnd() * 0.14
        const dur = 0.08 + rnd() * 0.34
        bp2.frequency.setValueAtTime(f * (1.02 + rnd() * 0.04), t0)
        bp2.frequency.exponentialRampToValueAtTime(Math.max(600, f * (0.9 + rnd() * 0.06)), t0 + dur)
        const gp = ctx.createStereoPanner(); gp.pan.value = clamp(pan + (rnd() * 2 - 1) * 0.95, -1, 1)
        sv.gain.disconnect(); sv.src.connect(sv.gain); sv.gain.connect(bp2); bp2.connect(gp); gp.connect(g)
        sv.gain.gain.setValueAtTime(0.0001, t0)
        sv.gain.gain.linearRampToValueAtTime(0.5 + rnd() * 0.5, t0 + 0.002)
        sv.gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
        sv.src.start(t0); sv.src.stop(t0 + dur + 0.02)
        end = Math.max(end, t0 + dur)
      }
      // crackle
      const nb = noiseBuffer(ctx, 0.5, { color: 'blue', seed: seed + 3 })
      const { src, gain } = bufferVoice(ctx, nb)
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5500
      gain.disconnect(); src.connect(gain); gain.connect(hp); hp.connect(g)
      gain.gain.setValueAtTime(0.42, when + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.4)
      src.start(when + 0.01); src.stop(when + 0.55)
      return Math.max(end, when + 0.5) + IMPACT_END_PAD
    }

    case 'ult': {
      // Cinematic 3-stage: (a) short rising pre-whoosh that DUCKS to near-silence
      // just before impact (the beat of silence makes the hit enormous and gives
      // a genuine sub-5ms transient), (b) enormous impact, (c) rumbling tail.
      let end = when
      const hitAt = when + 0.16
      const nb = noiseBuffer(ctx, 0.24, { color: 'pink', seed: seed + 5 })
      const { src, gain } = bufferVoice(ctx, nb)
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2
      bp.frequency.setValueAtTime(300, when)
      bp.frequency.exponentialRampToValueAtTime(4500, hitAt - 0.03)
      gain.disconnect(); src.connect(gain); gain.connect(bp)
      const wpan = ctx.createStereoPanner(); wpan.pan.value = pan
      bp.connect(wpan); wpan.connect(routing.out)
      if (routing.reverb) { const s = ctx.createGain(); s.gain.value = 0.3; wpan.connect(s); s.connect(routing.reverb) }
      gain.gain.setValueAtTime(0.0001, when)
      gain.gain.exponentialRampToValueAtTime(0.42, hitAt - 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0002, hitAt - 0.006) // DUCK to silence
      src.start(when); src.stop(hitAt + 0.02)
      // (b) the impact
      const big: HitSpec = {
        gain: 1.15, 
        crack: { level: 1.1, punch: 3.9, hp: 1400, lp: 11000, attack: 0.0016, dur: 0.014, color: 'white' },
        sizzle: { level: 0.6, hp: 1800, dur: 0.14, color: 'white' },
        body: { level: 1.15, f0: 115, f1: 44, dur: 0.5, type: 'sine', partial: 2.6, partialLevel: 0.3 },
        bodyGrit: { level: 0.9, lp: 600, dur: 0.32 },
        sub: { level: 1.25, f0: 62, f1: 24, dur: 0.9 },
        thump: { level: 1.5, f0: 84, dur: 0.15 },
        texture: { level: 0.62, bp: 1400, q: 0.8, dur: 0.4, color: 'brown', spread: 0.9, haas: 0.011 },
        ring: { level: 0.26, partials: [96, 151, 233, 337], dur: 0.6, type: 'sine', spread: 0.5 },
        drive: 0.45,
        reverbSend: 0.5,
      }
      end = Math.max(end, oneHit(ctx, routing, hitAt, big, pan, seed + 11))
      // (c) rumble tail
      const rb = noiseBuffer(ctx, 1.4, { color: 'brown', seed: seed + 9 })
      const rv = bufferVoice(ctx, rb)
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220
      rv.gain.disconnect(); rv.src.connect(rv.gain); rv.gain.connect(lp)
      lp.connect(routing.out)
      if (routing.reverb) { const s = ctx.createGain(); s.gain.value = 0.5; lp.connect(s); s.connect(routing.reverb) }
      rv.gain.gain.setValueAtTime(0.0001, hitAt + 0.02)
      rv.gain.gain.linearRampToValueAtTime(0.42, hitAt + 0.08)
      rv.gain.gain.exponentialRampToValueAtTime(0.0001, hitAt + 1.3)
      rv.src.start(hitAt + 0.02); rv.src.stop(hitAt + 1.4)
      return Math.max(end, hitAt + 1.3) + IMPACT_END_PAD
    }

    case 'signature': {
      // The CLIMAX — its own architecture, NOT the ult template. A rising tonal
      // "charge" (detuned power chord that swells UP), then a DOUBLE impact
      // (grab-slam: a mid crack, then 90ms later the full body drop), capped by
      // a bright ascending sparkle arp. Distinct rhythm + spectral core vs ult.
      let end = when
      const chargeDur = 0.18
      const hit1 = when + chargeDur           // first (mid) impact
      const hit2 = hit1 + 0.1                  // second (full) impact — the drop

      // (a) rising charge: detuned saw power chord sweeping up under a resonant LP,
      //     DUCKED to near-silence just before hit1 so the impact rises from a beat
      //     of silence (real sub-5ms transient + a bigger-feeling slam).
      const chord = [55, 82.4, 110, 138.6, 164.8]
      const swell = ctx.createGain(); swell.gain.value = 0.0001
      const clp = ctx.createBiquadFilter(); clp.type = 'lowpass'; clp.Q.value = 6
      clp.frequency.setValueAtTime(180, when)
      clp.frequency.exponentialRampToValueAtTime(2600, hit1 - 0.02)
      swell.connect(clp)
      const cpan = ctx.createStereoPanner(); cpan.pan.value = pan; clp.connect(cpan); cpan.connect(routing.out)
      if (routing.reverb) { const s = ctx.createGain(); s.gain.value = 0.35; cpan.connect(s); s.connect(routing.reverb) }
      swell.gain.setValueAtTime(0.0001, when)
      swell.gain.exponentialRampToValueAtTime(0.3, hit1 - 0.02)
      swell.gain.exponentialRampToValueAtTime(0.0002, hit1 - 0.005) // DUCK to silence
      chord.forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'
        o.frequency.value = f * (1 + (i - 2) * 0.004) // slight detune spread
        o.connect(swell); o.start(when); o.stop(hit1 + 0.02)
      })

      // (b) DOUBLE impact
      const s1 = critSpec(0.9); s1.gain *= 0.85; s1.reverbSend = 0.4
      end = Math.max(end, oneHit(ctx, routing, hit1, s1, pan - 0.12, seed + 3))
      const s2: HitSpec = {
        gain: 0.98,
        crack: { level: 1.0, punch: 3.3, hp: 1600, lp: 12000, attack: 0.0013, dur: 0.014, color: 'white' },
        sizzle: { level: 0.62, hp: 2200, dur: 0.14, color: 'white', spread: 1.0 },
        // bell-like INHARMONIC body (partial 1.53) → a metallic bloom that reads
        // clearly different from ult's clean low boom on the spectrogram.
        body: { level: 1.0, f0: 150, f1: 46, dur: 0.55, type: 'sine', partial: 1.53, partialLevel: 0.42 },
        bodyGrit: { level: 0.85, lp: 700, dur: 0.3 },
        sub: { level: 0.98, f0: 72, f1: 24, dur: 1.0 },
        texture: { level: 0.9, bp: 2400, q: 0.7, dur: 0.5, color: 'white', spread: 1.0, haas: 0.013 },
        ring: { level: 0.4, partials: [231, 349, 523, 785, 1176], dur: 0.8, type: 'sine', spread: 1.0 },
        drive: 0.46,
        reverbSend: 0.55,
      }
      end = Math.max(end, oneHit(ctx, routing, hit2, s2, pan, seed + 11))

      // (c) ascending sparkle arp — each note is a NOISE-EXCITED RESONATOR shard
      // (noise → high-Q bandpass with frequency drift) instead of a clean triangle,
      // so it shimmers as a granular burst rather than a stationary horizontal rail.
      const spk = [1568, 1976, 2637, 3520, 4699]
      const arng = mulberryLite(seed + 55)
      spk.forEach((f, i) => {
        const t0 = hit2 + 0.18 + i * 0.07
        const dur = 0.3
        const nb = noiseBuffer(ctx, dur * 1.3, { color: 'white', stereo: false, seed: seed + 300 + i * 13 })
        const { src, gain: ng } = bufferVoice(ctx, nb)
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 24 + arng() * 12
        const f0 = f * (1.01 + arng() * 0.012)
        bp.frequency.setValueAtTime(f0 * 1.02, t0)
        bp.frequency.exponentialRampToValueAtTime(f * (0.985 + arng() * 0.01), t0 + dur)
        const sp = ctx.createStereoPanner(); sp.pan.value = clamp(pan + (i % 2 ? 0.8 : -0.8), -1, 1)
        ng.disconnect(); src.connect(ng); ng.connect(bp); bp.connect(sp); sp.connect(routing.out)
        ng.gain.setValueAtTime(0.0001, t0)
        ng.gain.linearRampToValueAtTime(0.42, t0 + 0.006)
        ng.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
        src.start(t0); src.stop(t0 + dur + 0.02)
        // faint pure tone (0.3×) purely for pitch definition — too quiet to rail.
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f0
        o.frequency.exponentialRampToValueAtTime(f * 0.99, t0 + dur * 0.6)
        const og = ctx.createGain(); o.connect(og); og.connect(sp)
        og.gain.setValueAtTime(0.0001, t0)
        og.gain.linearRampToValueAtTime(0.03, t0 + 0.008)
        og.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.6)
        o.start(t0); o.stop(t0 + dur * 0.6 + 0.02)
        end = Math.max(end, t0 + dur)
      })
      return end + IMPACT_END_PAD
    }

    case 'ko': {
      // Time-stops. Giant low impact + long sub drop + huge reverb + a
      // downward pitch-bent tonal "collapse".
      let end = when
      const big: HitSpec = {
        gain: 1.65, 
        // KO needs a BROADBAND CRACK, not just rumble — bright, wide, violent.
        crack: { level: 1.2, punch: 3.9, hp: 1800, attack: 0.0012, dur: 0.016, color: 'white' },
        sizzle: { level: 0.5, hp: 2400, dur: 0.14, color: 'white', spread: 0.95 },
        body: { level: 1.3, f0: 105, f1: 42, dur: 0.5, type: 'sine', partial: 2.7, partialLevel: 0.3 },
        bodyGrit: { level: 0.8, lp: 800, dur: 0.6 },
        sub: { level: 1.4, f0: 55, f1: 24, dur: 0.7 },
        thump: { level: 1.7, f0: 78, dur: 0.16 },
        texture: { level: 0.85, bp: 2200, q: 0.6, dur: 0.6, color: 'white', spread: 1.0, haas: 0.014 },
        ring: { level: 0.34, partials: [2100, 3300, 4700, 6100], dur: 0.45, type: 'sine', spread: 1.0 },
        drive: 0.4,
        reverbSend: 0.6,
      }
      end = Math.max(end, oneHit(ctx, routing, when, big, pan, seed))
      // collapse: descending sawtooth (kept modest so it doesn't collapse the
      // stereo image — the bright wide texture/ring carry the width).
      const o = ctx.createOscillator(); o.type = 'sawtooth'
      o.frequency.setValueAtTime(220, when + 0.05)
      o.frequency.exponentialRampToValueAtTime(30, when + 0.9)
      const gg = ctx.createGain(); o.connect(gg)
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200
      gg.connect(lp); lp.connect(routing.out)
      if (routing.reverb) { const s = ctx.createGain(); s.gain.value = 0.6; lp.connect(s); s.connect(routing.reverb) }
      gg.gain.setValueAtTime(0.0001, when + 0.05)
      gg.gain.linearRampToValueAtTime(0.24, when + 0.1)
      gg.gain.exponentialRampToValueAtTime(0.0001, when + 1.0)
      o.start(when + 0.05); o.stop(when + 1.05)
      return Math.max(end, when + 1.0) + IMPACT_END_PAD
    }
  }
  // fallthrough (should be exhaustive)
  return oneHit(ctx, routing, when, lightSpec(p), pan, seed) + IMPACT_END_PAD
}

/** tiny local PRNG for jitter without importing state */
function mulberryLite(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
