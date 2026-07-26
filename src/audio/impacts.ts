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

interface HitSpec {
  gain: number
  /** How hard the bypass click punches (multiplier). Lower = more body-forward. */
  clickPunch?: number
  transient: { level: number; hp: number; dur: number; color: 'white' | 'blue' | 'pink' }
  body: { level: number; f0: number; f1: number; dur: number; type: OscillatorType }
  sub?: { level: number; f0: number; f1: number; dur: number }
  texture: { level: number; bp: number; q: number; dur: number; color: 'white' | 'pink' | 'brown' | 'blue'; decayPow: number }
  ring?: { level: number; partials: number[]; dur: number; type?: OscillatorType }
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

  // 1) TRANSIENT — the snap. A dominant full-band CLICK (this is the peak, ~1ms)
  //    plus a high-passed SIZZLE tail. The click bypasses the per-hit drive/
  //    saturation so it stays a sharp spike and reads as a <2ms attack.
  {
    const t = spec.transient
    // (a) CLICK — very short broadband spike straight to the dry output.
    const cb = noiseBuffer(ctx, 0.01, { color: 'white', seed: seed + 5 })
    const click = bufferVoice(ctx, cb)
    const chp = ctx.createBiquadFilter(); chp.type = 'highpass'; chp.frequency.value = 350; chp.Q.value = 0.5
    const cpan = ctx.createStereoPanner(); cpan.pan.value = clamp(pan, -1, 1)
    click.gain.disconnect(); click.src.connect(click.gain); click.gain.connect(chp); chp.connect(cpan); cpan.connect(routing.out)
    if (routing.reverb && spec.reverbSend > 0) {
      const cs = ctx.createGain(); cs.gain.value = spec.reverbSend * 0.5
      cpan.connect(cs); cs.connect(routing.reverb)
    }
    click.gain.gain.setValueAtTime(t.level * spec.gain * (spec.clickPunch ?? 3.2), when)
    click.gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.0025)
    click.src.start(when); click.src.stop(when + 0.012)
    // (b) SIZZLE — high-passed noise for texture on the attack.
    const nb = noiseBuffer(ctx, Math.max(0.02, t.dur * 2), { color: t.color, seed })
    const { src, gain } = bufferVoice(ctx, nb)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = t.hp
    hp.Q.value = 0.6
    src.connect(gain)
    gain.disconnect()
    gain.connect(hp)
    hp.connect(g)
    gain.gain.setValueAtTime(0.0001, when)
    gain.gain.linearRampToValueAtTime(t.level * 0.7, when + 0.0006)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + t.dur)
    src.start(when)
    src.stop(when + t.dur + 0.01)
    end = Math.max(end, when + t.dur)
  }

  // 2) BODY — pitch-swept sine thump, the weight. Delayed ~1.6ms so the click
  //    owns the very first transient sample (defined <2ms attack), then blooms.
  {
    const b = spec.body
    const bWhen = when + 0.0016
    const { osc, gain } = oscVoice(ctx, b.type, b.f0)
    osc.frequency.setValueAtTime(b.f0, bWhen)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, b.f1), bWhen + b.dur)
    gain.connect(g)
    gain.gain.setValueAtTime(0.0001, bWhen)
    gain.gain.linearRampToValueAtTime(b.level, bWhen + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.0001, bWhen + b.dur)
    osc.start(bWhen)
    osc.stop(bWhen + b.dur + 0.02)
    end = Math.max(end, bWhen + b.dur)
  }

  // 3) SUB — chest-punch, big hits only. Blooms just after the click.
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
    osc.start(sWhen)
    osc.stop(sWhen + s.dur + 0.02)
    end = Math.max(end, sWhen + s.dur)
  }

  // 4) TEXTURE — broadband noise crunch, rendered as TWO decorrelated voices
  //    panned L/R (different centres + seeds) for width and spectral spread.
  {
    const x = spec.texture
    const spread = 0.6
    const voices: Array<{ mult: number; pan: number; seed: number }> = [
      { mult: 0.55, pan: -spread, seed: seed + 31 },
      { mult: 1.7, pan: spread, seed: seed + 61 },
    ]
    for (const v of voices) {
      const nb = noiseBuffer(ctx, Math.max(0.05, x.dur * 1.3), { color: x.color, seed: v.seed })
      const { src, gain } = bufferVoice(ctx, nb)
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = x.bp * v.mult
      bp.Q.value = x.q * 0.7
      const vp = ctx.createStereoPanner(); vp.pan.value = clamp(pan + v.pan, -1, 1)
      gain.disconnect()
      src.connect(gain)
      gain.connect(bp)
      bp.connect(vp)
      vp.connect(g)
      bp.frequency.setValueAtTime(x.bp * v.mult * 1.4, when)
      bp.frequency.exponentialRampToValueAtTime(Math.max(120, x.bp * v.mult * 0.7), when + x.dur)
      gain.gain.setValueAtTime(0.0001, when)
      gain.gain.linearRampToValueAtTime(x.level * 0.72, when + 0.0016)
      gain.gain.exponentialRampToValueAtTime(0.0001, when + x.dur)
      src.start(when)
      src.stop(when + x.dur + 0.02)
      end = Math.max(end, when + x.dur)
    }
  }

  // 5) RING — inharmonic partials (metal/glass/energy).
  if (spec.ring) {
    const r = spec.ring
    r.partials.forEach((f, i) => {
      const { osc, gain } = oscVoice(ctx, r.type ?? 'sine', f)
      gain.connect(g)
      const lvl = r.level * (1 - i / (r.partials.length + 1))
      const dur = r.dur * (0.6 + 0.4 * (1 - i / r.partials.length))
      gain.gain.setValueAtTime(0.0001, when + 0.001)
      gain.gain.linearRampToValueAtTime(lvl, when + 0.004)
      gain.gain.exponentialRampToValueAtTime(0.0001, when + dur)
      osc.start(when + 0.001)
      osc.stop(when + dur + 0.02)
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
    gain: 0.9 * (0.8 + 0.4 * p),
    clickPunch: 1.7,
    transient: { level: 0.85, hp: 3200, dur: 0.006, color: 'blue' },
    body: { level: 1.05, f0: 190, f1: 72, dur: 0.11, type: 'sine' },
    texture: { level: 0.42, bp: 2000, q: 0.9, dur: 0.06, color: 'white', decayPow: 3 },
    drive: 0.12,
    reverbSend: 0.12,
  }
}

function heavySpec(p: number): HitSpec {
  return {
    gain: 1.05 * (0.85 + 0.3 * p),
    clickPunch: 3.0,
    transient: { level: 1.15, hp: 2000, dur: 0.009, color: 'white' },
    body: { level: 0.82, f0: 140, f1: 46, dur: 0.24, type: 'sine' },
    sub: { level: 0.6, f0: 58, f1: 30, dur: 0.3 },
    texture: { level: 0.55, bp: 1500, q: 0.85, dur: 0.15, color: 'pink', decayPow: 2.5 },
    drive: 0.28,
    reverbSend: 0.22,
  }
}

function critSpec(p: number): HitSpec {
  return {
    gain: 0.98 * (0.85 + 0.35 * p),
    clickPunch: 3.1,
    transient: { level: 1.05, hp: 4000, dur: 0.007, color: 'blue' },
    body: { level: 0.9, f0: 170, f1: 62, dur: 0.18, type: 'triangle' },
    sub: { level: 0.62, f0: 62, f1: 32, dur: 0.22 },
    texture: { level: 0.62, bp: 3000, q: 0.65, dur: 0.16, color: 'blue', decayPow: 2 },
    ring: { level: 0.32, partials: [1860, 3120, 4700, 6400], dur: 0.34, type: 'sine' },
    drive: 0.42,
    reverbSend: 0.3,
  }
}

function exSpec(p: number): HitSpec {
  return {
    gain: 0.78 * (0.85 + 0.3 * p),
    clickPunch: 2.3,
    transient: { level: 0.95, hp: 5000, dur: 0.006, color: 'blue' },
    body: { level: 0.7, f0: 220, f1: 90, dur: 0.14, type: 'sawtooth' },
    texture: { level: 0.55, bp: 4200, q: 3.5, dur: 0.18, color: 'blue', decayPow: 1.6 },
    ring: { level: 0.4, partials: [1200, 1800, 2700, 4050], dur: 0.28, type: 'sawtooth' },
    drive: 0.5,
    reverbSend: 0.26,
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
      let end = when
      const gaps = [0, 0.075, 0.15]
      gaps.forEach((gp, i) => {
        const s = lightSpec(0.7)
        s.gain *= 0.85 + i * 0.12
        s.body.f0 *= 1 + i * 0.12
        s.transient.hp *= 1 + i * 0.1
        s.reverbSend = 0.16
        end = Math.max(end, oneHit(ctx, routing, when + gp, s, pan + (i - 1) * 0.15, seed + i * 17))
      })
      const cap = heavySpec(0.85)
      cap.gain *= 0.95
      end = Math.max(end, oneHit(ctx, routing, when + 0.24, cap, pan, seed + 91))
      return end + IMPACT_END_PAD
    }

    case 'shatter': {
      // Armour break: metallic pre-crack, then a cloud of inharmonic glass
      // partials with randomised decays + a noise crackle tail.
      let end = when
      const crack = critSpec(0.9)
      crack.gain *= 0.9
      crack.ring = undefined
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
      for (let i = 0; i < 14; i++) {
        const f = 1400 + rnd() * 6000
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.value = f
        const gg = ctx.createGain()
        osc.connect(gg); gg.connect(g)
        const t0 = when + 0.01 + rnd() * 0.09
        const dur = 0.12 + rnd() * 0.5
        gg.gain.setValueAtTime(0.0001, t0)
        gg.gain.linearRampToValueAtTime(0.12 + rnd() * 0.12, t0 + 0.003)
        gg.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
        osc.start(t0); osc.stop(t0 + dur + 0.02)
        end = Math.max(end, t0 + dur)
      }
      // crackle
      const nb = noiseBuffer(ctx, 0.5, { color: 'blue', seed: seed + 3 })
      const { src, gain } = bufferVoice(ctx, nb)
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000
      gain.disconnect(); src.connect(gain); gain.connect(hp); hp.connect(g)
      gain.gain.setValueAtTime(0.28, when + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.4)
      src.start(when + 0.01); src.stop(when + 0.55)
      return Math.max(end, when + 0.5) + IMPACT_END_PAD
    }

    case 'ult': {
      // Cinematic 3-stage: (a) rising pre-whoosh, (b) enormous impact with
      // sub drop + drive, (c) rumbling decay tail.
      let end = when
      // (a) whoosh riser over ~0.35s BEFORE the hit lands at when+0.35
      const hitAt = when + 0.35
      const nb = noiseBuffer(ctx, 0.4, { color: 'pink', seed: seed + 5 })
      const { src, gain } = bufferVoice(ctx, nb)
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2
      bp.frequency.setValueAtTime(300, when)
      bp.frequency.exponentialRampToValueAtTime(4500, hitAt)
      gain.disconnect(); src.connect(gain); gain.connect(bp)
      const wpan = ctx.createStereoPanner(); wpan.pan.value = pan
      bp.connect(wpan); wpan.connect(routing.out)
      if (routing.reverb) { const s = ctx.createGain(); s.gain.value = 0.3; wpan.connect(s); s.connect(routing.reverb) }
      gain.gain.setValueAtTime(0.0001, when)
      gain.gain.exponentialRampToValueAtTime(0.5, hitAt)
      gain.gain.exponentialRampToValueAtTime(0.0001, hitAt + 0.05)
      src.start(when); src.stop(hitAt + 0.1)
      // (b) the impact
      const big: HitSpec = {
        gain: 1.05, clickPunch: 3.3,
        transient: { level: 1.0, hp: 1800, dur: 0.012, color: 'white' },
        body: { level: 1.0, f0: 140, f1: 48, dur: 0.5, type: 'sine' },
        sub: { level: 0.95, f0: 70, f1: 26, dur: 0.9 },
        texture: { level: 0.6, bp: 1400, q: 0.8, dur: 0.4, color: 'brown', decayPow: 2 },
        ring: { level: 0.28, partials: [90, 150, 210, 320], dur: 0.6, type: 'sine' },
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
      rv.gain.gain.linearRampToValueAtTime(0.5, hitAt + 0.08)
      rv.gain.gain.exponentialRampToValueAtTime(0.0001, hitAt + 1.3)
      rv.src.start(hitAt + 0.02); rv.src.stop(hitAt + 1.4)
      return Math.max(end, hitAt + 1.3) + IMPACT_END_PAD
    }

    case 'signature': {
      // The climax: a massive ult-class impact fused with a tonal power chord
      // swell + a bright sparkle tail. Distinct from ult by its musical body.
      let end = renderImpact(ctx, routing, when, 'ult', { ...opts, power: 1 })
      const hitAt = when + 0.35
      // power-chord swell (root + fifth + octave), sawtooth through a lowpass
      const chord = [55, 82.4, 110, 164.8]
      const swell = ctx.createGain(); swell.gain.value = 0.0001
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'
      lp.frequency.setValueAtTime(400, hitAt)
      lp.frequency.exponentialRampToValueAtTime(3500, hitAt + 0.6)
      swell.connect(lp); lp.connect(routing.out)
      if (routing.reverb) { const s = ctx.createGain(); s.gain.value = 0.4; lp.connect(s); s.connect(routing.reverb) }
      swell.gain.setValueAtTime(0.0001, hitAt)
      swell.gain.linearRampToValueAtTime(0.22, hitAt + 0.05)
      swell.gain.exponentialRampToValueAtTime(0.0001, hitAt + 0.9)
      chord.forEach((f) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f
        o.connect(swell); o.start(hitAt); o.stop(hitAt + 0.95)
      })
      // sparkle
      const spk = [1976, 2640, 3520]
      spk.forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f
        const gg = ctx.createGain(); o.connect(gg); gg.connect(routing.out)
        const t0 = hitAt + 0.5 + i * 0.09
        gg.gain.setValueAtTime(0.0001, t0)
        gg.gain.linearRampToValueAtTime(0.1, t0 + 0.01)
        gg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4)
        o.start(t0); o.stop(t0 + 0.45)
        end = Math.max(end, t0 + 0.4)
      })
      return end
    }

    case 'ko': {
      // Time-stops. Giant low impact + long sub drop + huge reverb + a
      // downward pitch-bent tonal "collapse".
      let end = when
      const big: HitSpec = {
        gain: 1.1, clickPunch: 3.3,
        transient: { level: 1.0, hp: 1500, dur: 0.014, color: 'white' },
        body: { level: 1.0, f0: 130, f1: 40, dur: 0.6, type: 'sine' },
        sub: { level: 1.0, f0: 62, f1: 22, dur: 1.1 },
        texture: { level: 0.55, bp: 900, q: 0.7, dur: 0.5, color: 'brown', decayPow: 1.8 },
        drive: 0.4,
        reverbSend: 0.6,
      }
      end = Math.max(end, oneHit(ctx, routing, when, big, pan, seed))
      // collapse: descending sawtooth
      const o = ctx.createOscillator(); o.type = 'sawtooth'
      o.frequency.setValueAtTime(220, when + 0.05)
      o.frequency.exponentialRampToValueAtTime(30, when + 0.9)
      const gg = ctx.createGain(); o.connect(gg)
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200
      gg.connect(lp); lp.connect(routing.out)
      if (routing.reverb) { const s = ctx.createGain(); s.gain.value = 0.6; lp.connect(s); s.connect(routing.reverb) }
      gg.gain.setValueAtTime(0.0001, when + 0.05)
      gg.gain.linearRampToValueAtTime(0.4, when + 0.1)
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
