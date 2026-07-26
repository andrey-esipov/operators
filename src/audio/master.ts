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
 *                              sumBus ─► limiter ─► softClip ─► masterGain ─► dest
 *
 * The multiband stage keeps the low-end punchy without the highs pumping; the
 * limiter + tanh soft-clip guarantees the bus never hard-clips while staying
 * loud. Building the identical chain offline is what makes the audiolab's
 * measurements trustworthy.
 */

import { type Ctx, softClipCurve } from './dsp'

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

function band(ctx: Ctx, kind: 'low' | 'mid' | 'high'): { input: AudioNode; output: AudioNode } {
  const comp = ctx.createDynamicsCompressor()
  comp.attack.value = kind === 'low' ? 0.01 : 0.004
  comp.release.value = kind === 'low' ? 0.18 : 0.12
  comp.threshold.value = kind === 'low' ? -20 : -22
  comp.ratio.value = kind === 'low' ? 3.5 : 3
  comp.knee.value = 6

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
 * `masterLevel` sets the final output trim.
 */
export function buildMasterGraph(ctx: Ctx, dest: AudioNode, masterLevel = 0.9): MasterGraph {
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
    const b = band(ctx, kind)
    preMaster.connect(b.input)
    b.output.connect(sumBus)
  }

  // brickwall-ish limiter
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -1.5
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.0008
  limiter.release.value = 0.06
  sumBus.connect(limiter)

  // tanh soft-clip safety ceiling
  const softClip = ctx.createWaveShaper()
  softClip.curve = softClipCurve(1.5)
  softClip.oversample = '4x'
  limiter.connect(softClip)

  const masterGain = ctx.createGain()
  masterGain.gain.value = masterLevel
  softClip.connect(masterGain)
  masterGain.connect(dest)

  return {
    sfxBus, voiceBus, musicBus, reverbBus, reverbReturn, convolver,
    musicDuck, voiceDuck, preMaster, masterGain,
  }
}
