/**
 * Non-impact "feel" SFX — whiffs, footsteps, cloth, meter charge, the super
 * activation stinger, victory/defeat stings and menu blips. Same context-in
 * design as impacts so they render offline for measurement.
 */

import { type Ctx, noiseBuffer, bufferVoice, clamp } from './dsp'
import type { ImpactRouting } from './impacts'

/** A swishing air whiff — filtered noise with a fast bandpass sweep. */
export function renderWhiff(ctx: Ctx, r: ImpactRouting, when: number, opts: { power?: number; pan?: number; seed?: number } = {}): number {
  const p = clamp(opts.power ?? 0.6, 0, 1)
  const dur = 0.14 + p * 0.1
  const nb = noiseBuffer(ctx, dur * 1.4, { color: 'white', seed: opts.seed ?? 51 })
  const { src, gain } = bufferVoice(ctx, nb)
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.6
  bp.frequency.setValueAtTime(600, when)
  bp.frequency.exponentialRampToValueAtTime(3200, when + dur * 0.6)
  bp.frequency.exponentialRampToValueAtTime(900, when + dur)
  const pan = ctx.createStereoPanner(); pan.pan.value = opts.pan ?? 0
  gain.disconnect(); src.connect(gain); gain.connect(bp); bp.connect(pan); pan.connect(r.out)
  if (r.reverb) { const s = ctx.createGain(); s.gain.value = 0.1; pan.connect(s); s.connect(r.reverb) }
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.linearRampToValueAtTime(0.35 * (0.7 + p * 0.6), when + dur * 0.35)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + dur)
  src.start(when); src.stop(when + dur + 0.02)
  return when + dur + 0.03
}

/** A low, soft footstep thud + a little scuff. */
export function renderFootstep(ctx: Ctx, r: ImpactRouting, when: number, opts: { pan?: number; seed?: number } = {}): number {
  const pan = ctx.createStereoPanner(); pan.pan.value = opts.pan ?? 0
  pan.connect(r.out)
  // thud
  const o = ctx.createOscillator(); o.type = 'sine'
  o.frequency.setValueAtTime(120, when)
  o.frequency.exponentialRampToValueAtTime(55, when + 0.08)
  const g = ctx.createGain(); o.connect(g); g.connect(pan)
  g.gain.setValueAtTime(0.0001, when)
  g.gain.linearRampToValueAtTime(0.28, when + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.1)
  o.start(when); o.stop(when + 0.12)
  // scuff
  const nb = noiseBuffer(ctx, 0.08, { color: 'brown', seed: opts.seed ?? 88 })
  const nv = bufferVoice(ctx, nb)
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200
  nv.gain.disconnect(); nv.src.connect(nv.gain); nv.gain.connect(hp); hp.connect(pan)
  nv.gain.gain.setValueAtTime(0.12, when)
  nv.gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.06)
  nv.src.start(when); nv.src.stop(when + 0.09)
  return when + 0.12
}

/** Cloth/gi movement — very short soft high-passed noise. */
export function renderCloth(ctx: Ctx, r: ImpactRouting, when: number, opts: { pan?: number; seed?: number } = {}): number {
  const dur = 0.09
  const nb = noiseBuffer(ctx, dur * 1.3, { color: 'pink', seed: opts.seed ?? 123 })
  const { src, gain } = bufferVoice(ctx, nb)
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2500; bp.Q.value = 0.9
  const pan = ctx.createStereoPanner(); pan.pan.value = opts.pan ?? 0
  gain.disconnect(); src.connect(gain); gain.connect(bp); bp.connect(pan); pan.connect(r.out)
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.linearRampToValueAtTime(0.14, when + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, when + dur)
  src.start(when); src.stop(when + dur + 0.02)
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
  // power chord
  ;[220, 330, 440].forEach((f) => {
    const oo = ctx.createOscillator(); oo.type = 'square'; oo.frequency.value = f
    const gg = ctx.createGain(); oo.connect(gg); gg.connect(bus)
    gg.gain.setValueAtTime(0.0001, when + 0.2)
    gg.gain.linearRampToValueAtTime(0.12, when + 0.24)
    gg.gain.exponentialRampToValueAtTime(0.0001, when + 0.8)
    oo.start(when + 0.2); oo.stop(when + 0.85)
  })
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

/** Victory sting — bright ascending major triad fanfare. */
export function renderVictory(ctx: Ctx, r: ImpactRouting, when: number): number {
  const bus = ctx.createGain(); bus.gain.value = 0.8; bus.connect(r.out)
  if (r.reverb) { const s = ctx.createGain(); s.gain.value = 0.3; bus.connect(s); s.connect(r.reverb) }
  const notes = [523.25, 659.25, 783.99, 1046.5]
  notes.forEach((f, i) => {
    const t0 = when + i * 0.12
    ;['sawtooth', 'square'].forEach((type, j) => {
      const o = ctx.createOscillator(); o.type = type as OscillatorType; o.frequency.value = f * (j === 1 ? 1.005 : 1)
      const g = ctx.createGain(); o.connect(g); g.connect(bus)
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.linearRampToValueAtTime(0.12, t0 + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + (i === notes.length - 1 ? 0.6 : 0.2))
      o.start(t0); o.stop(t0 + 0.65)
    })
  })
  return when + 0.12 * notes.length + 0.6
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
