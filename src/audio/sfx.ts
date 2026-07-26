/**
 * Non-impact "feel" SFX — whiffs, footsteps, cloth, meter charge, the super
 * activation stinger, victory/defeat stings and menu blips. Same context-in
 * design as impacts so they render offline for measurement.
 */

import { type Ctx, noiseBuffer, bufferVoice, clamp } from './dsp'
import type { ImpactRouting } from './impacts'

/** A swishing air whiff — filtered noise with a fast bandpass sweep, moderate width. */
export function renderWhiff(ctx: Ctx, r: ImpactRouting, when: number, opts: { power?: number; pan?: number; seed?: number } = {}): number {
  const p = clamp(opts.power ?? 0.6, 0, 1)
  const dur = 0.14 + p * 0.1
  const basePan = opts.pan ?? 0
  const bus = ctx.createGain(); bus.gain.value = 1; bus.connect(r.out)
  if (r.reverb) { const s = ctx.createGain(); s.gain.value = 0.06; bus.connect(s); s.connect(r.reverb) }
  // Two moderately-decorrelated voices (±0.5) → controlled width ~0.6-0.8, not 0.95.
  for (const side of [-0.5, 0.5]) {
    const nb = noiseBuffer(ctx, dur * 1.4, { color: 'white', seed: (opts.seed ?? 51) + (side < 0 ? 0 : 200) })
    const { src, gain } = bufferVoice(ctx, nb)
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.6
    bp.frequency.setValueAtTime(600, when)
    bp.frequency.exponentialRampToValueAtTime(3200, when + dur * 0.6)
    bp.frequency.exponentialRampToValueAtTime(900, when + dur)
    const pan = ctx.createStereoPanner(); pan.pan.value = clamp(basePan + side, -1, 1)
    gain.disconnect(); src.connect(gain); gain.connect(bp); bp.connect(pan); pan.connect(bus)
    gain.gain.setValueAtTime(0.0001, when)
    gain.gain.linearRampToValueAtTime(0.26 * (0.7 + p * 0.6), when + dur * 0.35)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur)
    src.start(when); src.stop(when + dur + 0.02)
  }
  // centred low-mid "wff" body — anchors the image so it isn't phasey/detached.
  const nb2 = noiseBuffer(ctx, dur * 1.4, { color: 'pink', seed: (opts.seed ?? 51) + 400 })
  const bv = bufferVoice(ctx, nb2)
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400
  bv.gain.disconnect(); bv.src.connect(bv.gain); bv.gain.connect(lp); lp.connect(bus)
  bv.gain.gain.setValueAtTime(0.0001, when)
  bv.gain.gain.linearRampToValueAtTime(0.2 * (0.7 + p * 0.6), when + dur * 0.35)
  bv.gain.gain.exponentialRampToValueAtTime(0.0001, when + dur)
  bv.src.start(when); bv.src.stop(when + dur + 0.02)
  return when + dur + 0.03
}

/** A low, punchy footstep thud + a gritty surface scuff. */
export function renderFootstep(ctx: Ctx, r: ImpactRouting, when: number, opts: { pan?: number; seed?: number } = {}): number {
  const pan = ctx.createStereoPanner(); pan.pan.value = opts.pan ?? 0
  pan.connect(r.out)
  if (r.reverb) { const s = ctx.createGain(); s.gain.value = 0.14; pan.connect(s); s.connect(r.reverb) }
  // thud (louder, with a snap)
  const o = ctx.createOscillator(); o.type = 'sine'
  o.frequency.setValueAtTime(135, when)
  o.frequency.exponentialRampToValueAtTime(52, when + 0.09)
  const g = ctx.createGain(); o.connect(g); g.connect(pan)
  g.gain.setValueAtTime(0.0001, when)
  g.gain.linearRampToValueAtTime(0.55, when + 0.003)
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.11)
  o.start(when); o.stop(when + 0.13)
  // surface scuff — broadband grit with a little decay (dirt/mat texture)
  const nb = noiseBuffer(ctx, 0.12, { color: 'brown', seed: opts.seed ?? 88 })
  const nv = bufferVoice(ctx, nb)
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.7
  nv.gain.disconnect(); nv.src.connect(nv.gain); nv.gain.connect(bp); bp.connect(pan)
  nv.gain.gain.setValueAtTime(0.0001, when)
  nv.gain.gain.linearRampToValueAtTime(0.32, when + 0.003)
  nv.gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.09)
  nv.src.start(when); nv.src.stop(when + 0.11)
  // high scuff tick
  const nb2 = noiseBuffer(ctx, 0.05, { color: 'white', seed: (opts.seed ?? 88) + 3 })
  const nv2 = bufferVoice(ctx, nb2)
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3500
  nv2.gain.disconnect(); nv2.src.connect(nv2.gain); nv2.gain.connect(hp); hp.connect(pan)
  nv2.gain.gain.setValueAtTime(0.18, when)
  nv2.gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.04)
  nv2.src.start(when); nv2.src.stop(when + 0.06)
  return when + 0.13
}

/** Cloth/gi movement — soft high-passed noise swish, audible but subtle. */
export function renderCloth(ctx: Ctx, r: ImpactRouting, when: number, opts: { pan?: number; seed?: number } = {}): number {
  const dur = 0.11
  const basePan = opts.pan ?? 0
  const bus = ctx.createGain(); bus.gain.value = 1; bus.connect(r.out)
  if (r.reverb) { const s = ctx.createGain(); s.gain.value = 0.08; bus.connect(s); s.connect(r.reverb) }
  // two decorrelated voices for a natural fabric swish
  for (const side of [-0.4, 0.4]) {
    const nb = noiseBuffer(ctx, dur * 1.4, { color: 'pink', seed: (opts.seed ?? 123) + (side < 0 ? 0 : 90) })
    const { src, gain } = bufferVoice(ctx, nb)
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8
    bp.frequency.setValueAtTime(1800, when)
    bp.frequency.exponentialRampToValueAtTime(3200, when + dur * 0.5)
    bp.frequency.exponentialRampToValueAtTime(1500, when + dur)
    const pan = ctx.createStereoPanner(); pan.pan.value = clamp(basePan + side, -1, 1)
    gain.disconnect(); src.connect(gain); gain.connect(bp); bp.connect(pan); pan.connect(bus)
    gain.gain.setValueAtTime(0.0001, when)
    gain.gain.linearRampToValueAtTime(0.5, when + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur)
    src.start(when); src.stop(when + dur + 0.02)
  }
  return when + dur
}

/** Meter charge — a rising shimmer that builds over `dur` seconds. */
export function renderMeterCharge(ctx: Ctx, r: ImpactRouting, when: number, dur = 0.8): number {
  const base = ctx.createGain(); base.gain.value = 0.0001; base.connect(r.out)
  if (r.reverb) { const s = ctx.createGain(); s.gain.value = 0.2; base.connect(s); s.connect(r.reverb) }
  base.gain.setValueAtTime(0.0001, when)
  base.gain.linearRampToValueAtTime(0.16, when + dur * 0.85)
  base.gain.exponentialRampToValueAtTime(0.0001, when + dur + 0.15)
  // rising partials
  ;[220, 330, 440].forEach((f, i) => {
    const o = ctx.createOscillator(); o.type = 'triangle'
    o.frequency.setValueAtTime(f, when)
    o.frequency.exponentialRampToValueAtTime(f * 2, when + dur)
    const g = ctx.createGain(); g.gain.value = 0.5 / (i + 1)
    o.connect(g); g.connect(base)
    o.start(when); o.stop(when + dur + 0.2)
  })
  // sparkle noise
  const nb = noiseBuffer(ctx, dur + 0.2, { color: 'blue', seed: 321 })
  const nv = bufferVoice(ctx, nb)
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 5
  bp.frequency.setValueAtTime(2000, when)
  bp.frequency.exponentialRampToValueAtTime(8000, when + dur)
  nv.gain.disconnect(); nv.src.connect(nv.gain); nv.gain.connect(bp); bp.connect(base)
  nv.gain.gain.value = 0.25
  nv.src.start(when); nv.src.stop(when + dur + 0.2)
  return when + dur + 0.2
}

/** Super activation stinger — a bright, aggressive rising power chord hit. */
export function renderSuperStinger(ctx: Ctx, r: ImpactRouting, when: number): number {
  const bus = ctx.createGain(); bus.gain.value = 0.9; bus.connect(r.out)
  if (r.reverb) { const s = ctx.createGain(); s.gain.value = 0.35; bus.connect(s); s.connect(r.reverb) }
  // impact stab
  const o = ctx.createOscillator(); o.type = 'sawtooth'
  o.frequency.setValueAtTime(110, when)
  o.frequency.exponentialRampToValueAtTime(440, when + 0.25)
  const g = ctx.createGain(); o.connect(g); g.connect(bus)
  g.gain.setValueAtTime(0.0001, when)
  g.gain.linearRampToValueAtTime(0.3, when + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.5)
  o.start(when); o.stop(when + 0.55)
  // power chord — a detuned SUPERSAW cluster (7 voices) instead of exposed
  // squares, so it reads as a produced synth stab, not a chiptune chord.
  const chordRoots = [110, 164.8, 220]
  chordRoots.forEach((f) => {
    for (let d = 0; d < 7; d++) {
      const det = (d - 3) * 0.008
      const oo = ctx.createOscillator(); oo.type = 'sawtooth'; oo.frequency.value = f * (1 + det)
      const gg = ctx.createGain(); oo.connect(gg)
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'
      lp.frequency.setValueAtTime(700, when + 0.2)
      lp.frequency.exponentialRampToValueAtTime(6000, when + 0.5)
      gg.connect(lp)
      const sp = ctx.createStereoPanner(); sp.pan.value = clamp((d - 3) / 3 * 0.7, -1, 1)
      lp.connect(sp); sp.connect(bus)
      gg.gain.setValueAtTime(0.0001, when + 0.2)
      gg.gain.linearRampToValueAtTime(0.05, when + 0.24)
      gg.gain.exponentialRampToValueAtTime(0.0001, when + 0.8)
      oo.start(when + 0.2); oo.stop(when + 0.85)
    }
  })
  // rising noise riser feeding the stab
  const rb = noiseBuffer(ctx, 0.3, { color: 'pink', seed: 655 })
  const rv = bufferVoice(ctx, rb)
  const rbp = ctx.createBiquadFilter(); rbp.type = 'bandpass'; rbp.Q.value = 1.4
  rbp.frequency.setValueAtTime(400, when); rbp.frequency.exponentialRampToValueAtTime(5000, when + 0.22)
  rv.gain.disconnect(); rv.src.connect(rv.gain); rv.gain.connect(rbp); rbp.connect(bus)
  rv.gain.gain.setValueAtTime(0.0001, when)
  rv.gain.gain.exponentialRampToValueAtTime(0.28, when + 0.2)
  rv.gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.28)
  rv.src.start(when); rv.src.stop(when + 0.3)
  // white flash noise
  const nb = noiseBuffer(ctx, 0.3, { color: 'blue', seed: 654 })
  const nv = bufferVoice(ctx, nb)
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4000
  nv.gain.disconnect(); nv.src.connect(nv.gain); nv.gain.connect(hp); hp.connect(bus)
  nv.gain.gain.setValueAtTime(0.3, when)
  nv.gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.25)
  nv.src.start(when); nv.src.stop(when + 0.3)
  return when + 0.85
}

/** Victory sting — bright ascending major fanfare with octave depth + a pad swell. */
export function renderVictory(ctx: Ctx, r: ImpactRouting, when: number): number {
  const bus = ctx.createGain(); bus.gain.value = 0.72; bus.connect(r.out)
  if (r.reverb) { const s = ctx.createGain(); s.gain.value = 0.34; bus.connect(s); s.connect(r.reverb) }
  const notes = [523.25, 659.25, 783.99, 1046.5]
  notes.forEach((f, i) => {
    const t0 = when + i * 0.12
    const rel = i === notes.length - 1 ? 0.7 : 0.22
    // detuned saw pair + a sub-octave for body (less exposed than a bare triad)
    const voices: Array<{ mul: number; type: OscillatorType; lvl: number; det: number }> = [
      { mul: 0.5, type: 'triangle', lvl: 0.08, det: 0 },
      { mul: 1, type: 'sawtooth', lvl: 0.1, det: -0.004 },
      { mul: 1, type: 'sawtooth', lvl: 0.1, det: 0.004 },
    ]
    voices.forEach((v, j) => {
      const o = ctx.createOscillator(); o.type = v.type; o.frequency.value = f * v.mul * (1 + v.det)
      const g = ctx.createGain(); o.connect(g)
      const sp = ctx.createStereoPanner(); sp.pan.value = clamp((j - 1) * 0.4, -1, 1)
      g.connect(sp); sp.connect(bus)
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.linearRampToValueAtTime(v.lvl, t0 + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + rel)
      o.start(t0); o.stop(t0 + rel + 0.05)
    })
  })
  // sustained pad swell under the last note (removes the "bare arpeggio" feel)
  const padStart = when + 0.12 * (notes.length - 1)
  ;[523.25, 659.25, 783.99].forEach((f, j) => {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * (1 + (j - 1) * 0.005)
    const g = ctx.createGain()
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(600, padStart); lp.frequency.exponentialRampToValueAtTime(3000, padStart + 0.5)
    o.connect(g); g.connect(lp); lp.connect(bus)
    g.gain.setValueAtTime(0.0001, padStart)
    g.gain.linearRampToValueAtTime(0.05, padStart + 0.08)
    g.gain.exponentialRampToValueAtTime(0.0001, padStart + 0.8)
    o.start(padStart); o.stop(padStart + 0.85)
  })
  return when + 0.12 * notes.length + 0.8
}

/** Defeat sting — descending minor fall. */
export function renderDefeat(ctx: Ctx, r: ImpactRouting, when: number): number {
  const bus = ctx.createGain(); bus.gain.value = 0.7; bus.connect(r.out)
  if (r.reverb) { const s = ctx.createGain(); s.gain.value = 0.4; bus.connect(s); s.connect(r.reverb) }
  const notes = [440, 392, 349.23, 261.63]
  notes.forEach((f, i) => {
    const t0 = when + i * 0.18
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f
    const g = ctx.createGain(); o.connect(g); g.connect(bus)
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400
    g.disconnect(); o.connect(g); g.connect(lp); lp.connect(bus)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(0.13, t0 + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (i === notes.length - 1 ? 0.8 : 0.28))
    o.start(t0); o.stop(t0 + 0.85)
  })
  return when + 0.18 * notes.length + 0.8
}

/** Menu blip. */
export function renderMenuBlip(ctx: Ctx, r: ImpactRouting, when: number, select = false): number {
  const o = ctx.createOscillator(); o.type = 'square'
  o.frequency.setValueAtTime(select ? 660 : 880, when)
  if (select) o.frequency.setValueAtTime(1320, when + 0.05)
  const g = ctx.createGain(); o.connect(g); g.connect(r.out)
  g.gain.setValueAtTime(0.0001, when)
  g.gain.linearRampToValueAtTime(0.09, when + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, when + (select ? 0.12 : 0.05))
  o.start(when); o.stop(when + 0.14)
  return when + 0.14
}
