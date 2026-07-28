/**
 * Mastering + mixing graph, shared by live playback and offline measurement.
 *
 * Signal flow:
 *
 *   sfxBus ─┐
 *   voiceBus ─(voiceDuck)─┤
 *   musicBus ─(musicDuck)─┤
 *   reverbBus ─► convolver ─► reverbReturn ─┘
 *                                            └─► preMaster
 *                                                   │
 *                             ┌── low  ─► compL ──┐ │  (3-band multiband)
 *                 preMaster ──┼── mid  ─► compM ──┼─► sumBus
 *                             └── high ─► compH ──┘
 *                                                   │
 *                              sumBus ─► limiter ─► softClip ─► masterGain ─► ceiling ─► dest
 *
 * The multiband stage keeps the low-end punchy without the highs pumping; the
 * limiter + tanh soft-clip keeps the bus loud without pumping, and a final
 * linear `ceiling` clamp guarantees true-peak safety (the 4x soft-clip can ring
 * a hair over ±1). Building the identical chain offline is what makes the
 * audiolab's measurements trustworthy.
 */

import { type Ctx, softClipCurve, hardClipCurve } from './dsp'

/**
 * The sidechain music-duck envelope — the single source of the "punch pump".
 * Shared by the live engine (every impact, and the harder super/KO ducks) and
 * the offline duck measurement (tools/measure-duck.mjs), so both exercise ONE
 * curve rather than a live implementation and a drifting copy in the probe.
 *
 * A bigger `intensity` ducks DEEPER and recovers SLOWER — which is what gives a
 * super (0.95) or KO (1.0) their loudness *contrast*: the bed drops ~10–11 dB
 * out from under them, then eases back. `when` is the context time it begins.
 * The 12 ms down-ramp is fast enough to be under the transient but slow enough
 * not to click.
 */
export function duckMusicRamp(param: AudioParam, when: number, intensity: number): void {
  const amt = Math.max(0, Math.min(1.2, intensity))
  const depth = Math.min(0.85, 0.32 + amt * 0.4)
  const recover = 0.18 + amt * 0.25
  param.cancelScheduledValues(when)
  param.setValueAtTime(param.value, when)
  param.linearRampToValueAtTime(1 - depth, when + 0.012)
  param.setTargetAtTime(1, when + 0.02, recover)
}

export interface MasterGraph {
  sfxBus: GainNode
  voiceBus: GainNode
  musicBus: GainNode
  reverbBus: GainNode
  reverbReturn: GainNode
  convolver: ConvolverNode
  musicDuck: GainNode
  voiceDuck: GainNode
  preMaster: GainNode
  masterGain: GainNode
}

function band(ctx: Ctx, kind: 'low' | 'mid' | 'high', legacy = false): { input: AudioNode; output: AudioNode } {
  const comp = ctx.createDynamicsCompressor()
  if (legacy) {
    // The PRE-FIX profile: a fast, low-threshold, high-ratio multiband that
    // levelled every hit into a ~4 dB band (a jab and a KO 3 dB apart). Retained
    // ONLY so the measurement harness can regress-prove the fix (mutate=
    // crush-master): even the wide per-tier reactor gains collapse to a flat mix
    // under it. Deliberately brickwall — a low threshold with a steep ratio and a
    // near-instant attack pulls every loud tier down onto the quiet ones.
    comp.attack.value = kind === 'low' ? 0.003 : 0.001
    comp.release.value = kind === 'low' ? 0.25 : 0.18
    comp.threshold.value = kind === 'low' ? -30 : -32
    comp.ratio.value = kind === 'low' ? 10 : 12
    comp.knee.value = 4
  } else {
    // SHIP: gentle multiband GLUE, not a leveller. High thresholds let the quiet
    // tiers (whiff/light) pass uncompressed; low ratios let the loud tiers keep
    // their level so the ladder survives; slow attacks (8–12 ms) let the first
    // ~20 ms transient crack — where fighting-game "punch" lives — through
    // before any gain reduction engages; a wide knee keeps the onset soft.
    comp.attack.value = kind === 'low' ? 0.012 : 0.008
    comp.release.value = kind === 'low' ? 0.2 : 0.14
    comp.threshold.value = kind === 'low' ? -12 : -14
    comp.ratio.value = kind === 'low' ? 2 : 1.8
    comp.knee.value = 10
  }

  if (kind === 'low') {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 130; lp.Q.value = 0.7
    lp.connect(comp)
    return { input: lp, output: comp }
  }
  if (kind === 'high') {
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2600; hp.Q.value = 0.7
    hp.connect(comp)
    return { input: hp, output: comp }
  }
  // mid: bandpass via HP then LP in series
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 130; hp.Q.value = 0.7
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 0.7
  hp.connect(lp); lp.connect(comp)
  return { input: hp, output: comp }
}

/**
 * Build the full mixing + mastering graph into `dest`. Returns the bus handles.
 * `masterLevel` sets the final output trim. `opts.dynamics` selects the
 * mastering profile: 'ship' (default) is the wide-dynamic-range master that lets
 * the loudness hierarchy through; 'legacy' rebuilds the pre-fix crushed profile
 * and exists solely so the offline harness can prove the fix by regression.
 */
export function buildMasterGraph(
  ctx: Ctx,
  dest: AudioNode,
  masterLevel = 0.9,
  opts: { dynamics?: 'ship' | 'legacy' } = {},
): MasterGraph {
  const legacy = opts.dynamics === 'legacy'
  const sfxBus = ctx.createGain(); sfxBus.gain.value = 1.0
  const voiceBus = ctx.createGain(); voiceBus.gain.value = 1.0
  const musicBus = ctx.createGain(); musicBus.gain.value = 1.0
  const reverbBus = ctx.createGain(); reverbBus.gain.value = 1.0

  const voiceDuck = ctx.createGain(); voiceDuck.gain.value = 1.0
  const musicDuck = ctx.createGain(); musicDuck.gain.value = 1.0

  const convolver = ctx.createConvolver()
  const reverbReturn = ctx.createGain(); reverbReturn.gain.value = 0.9

  const preMaster = ctx.createGain(); preMaster.gain.value = 1.0

  // routing into preMaster
  sfxBus.connect(preMaster)
  voiceBus.connect(voiceDuck); voiceDuck.connect(preMaster)
  musicBus.connect(musicDuck); musicDuck.connect(preMaster)
  reverbBus.connect(convolver); convolver.connect(reverbReturn); reverbReturn.connect(preMaster)

  // multiband
  const sumBus = ctx.createGain(); sumBus.gain.value = 1.0
  for (const kind of ['low', 'mid', 'high'] as const) {
    const b = band(ctx, kind, legacy)
    preMaster.connect(b.input)
    b.output.connect(sumBus)
  }

  // Peak catcher. Legacy used a 0.8 ms attack that ate exactly the first-20 ms
  // transient (the classic "the hit has no punch" cause). Ship slows the attack
  // to 5 ms so the transient crest rings through; the tanh soft-clip below is the
  // true, inaudible ceiling (a WaveShaper hard-clamps its input to ±1 regardless
  // of drive), so nothing downstream can exceed full scale even with the slower
  // limiter.
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -1.5
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = legacy ? 0.0008 : 0.005
  limiter.release.value = 0.06
  sumBus.connect(limiter)

  // tanh soft-clip safety ceiling. Lower drive under ship = more linear through
  // the mid-levels (preserves crest/dynamics) while the ±1 clamp still guarantees
  // no hard clip.
  const softClip = ctx.createWaveShaper()
  softClip.curve = softClipCurve(legacy ? 1.5 : 1.2)
  softClip.oversample = '4x'
  limiter.connect(softClip)

  const masterGain = ctx.createGain()
  masterGain.gain.value = masterLevel
  softClip.connect(masterGain)

  // True-peak safety clamp (see hardClipCurve): the 4x soft-clip can overshoot
  // ±1 on the hottest transients, and masterVolume can be driven to 1.0, so the
  // musical ceiling alone doesn't guarantee no DAC clip. This final linear clamp
  // (no oversample → no ring of its own) does, inaudibly.
  const ceiling = ctx.createWaveShaper()
  ceiling.curve = hardClipCurve(0.985)
  ceiling.oversample = 'none'
  masterGain.connect(ceiling)
  ceiling.connect(dest)

  return {
    sfxBus, voiceBus, musicBus, reverbBus, reverbReturn, convolver,
    musicDuck, voiceDuck, preMaster, masterGain,
  }
}
