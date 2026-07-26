/**
 * Low-level DSP primitives shared by the whole fight-audio engine.
 *
 * Everything here is *pure with respect to a supplied context* — every helper
 * takes a `BaseAudioContext` so the exact same synthesis graph can be built
 * against the live `AudioContext` for playback OR an `OfflineAudioContext` for
 * headless measurement. That symmetry is what lets the audiolab prove the
 * shipped sound is the sound that was measured.
 */

export type Ctx = BaseAudioContext

/** Deterministic PRNG (mulberry32) — seedable so offline renders are stable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Coloured noise buffer.
 *   color: 'white' | 'pink' | 'brown' | 'blue'
 * Pink ≈ -3dB/oct (natural/warm), brown ≈ -6dB/oct (rumbly), blue ≈ +3dB/oct
 * (bright/hissy, good for glass/metal transients).
 */
export function noiseBuffer(
  ctx: Ctx,
  seconds: number,
  opts: { color?: 'white' | 'pink' | 'brown' | 'blue'; stereo?: boolean; seed?: number } = {},
): AudioBuffer {
  const { color = 'white', stereo = true, seed } = opts
  const rate = ctx.sampleRate
  const len = Math.max(1, Math.floor(seconds * rate))
  const channels = stereo ? 2 : 1
  const buf = ctx.createBuffer(channels, len, rate)
  for (let ch = 0; ch < channels; ch++) {
    const rnd = seed !== undefined ? mulberry32(seed + ch * 7919) : Math.random
    const data = buf.getChannelData(ch)
    if (color === 'white' || color === 'blue') {
      for (let i = 0; i < len; i++) data[i] = rnd() * 2 - 1
      if (color === 'blue') {
        // differentiate → +3dB/oct tilt
        let prev = 0
        for (let i = 0; i < len; i++) {
          const cur = data[i]
          data[i] = (cur - prev) * 0.5
          prev = cur
        }
      }
    } else if (color === 'pink') {
      // Paul Kellet's economical pink filter
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
      for (let i = 0; i < len; i++) {
        const w = rnd() * 2 - 1
        b0 = 0.99886 * b0 + w * 0.0555179
        b1 = 0.99332 * b1 + w * 0.0750759
        b2 = 0.969 * b2 + w * 0.153852
        b3 = 0.8665 * b3 + w * 0.3104856
        b4 = 0.55 * b4 + w * 0.5329522
        b5 = -0.7616 * b5 - w * 0.016898
        const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362
        b6 = w * 0.115926
        data[i] = out * 0.11
      }
    } else {
      // brown
      let last = 0
      for (let i = 0; i < len; i++) {
        const w = rnd() * 2 - 1
        last = (last + 0.02 * w) / 1.02
        data[i] = last * 3.5
      }
    }
  }
  return buf
}

/** Buffer source wired to a gain; caller wires gain → destination. */
export function bufferVoice(ctx: Ctx, buffer: AudioBuffer): { src: AudioBufferSourceNode; gain: GainNode } {
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const gain = ctx.createGain()
  src.connect(gain)
  return { src, gain }
}

/**
 * Waveshaper distortion curve. `amount` 0..1 → gentle warmth to hard grind.
 * Used to add aggression/harmonics to hits and as a soft-clip safety limiter.
 */
export function distortionCurve(amount: number, samples = 2048): Float32Array<ArrayBuffer> {
  const k = amount * 100
  const curve = new Float32Array(samples)
  const deg = Math.PI / 180
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x))
  }
  return curve
}

/** Tanh soft-clip curve — transparent brickwall-ish ceiling. drive>1 pushes level. */
export function softClipCurve(drive = 1.4, samples = 4096): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(samples)
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive)
  }
  return curve
}

/**
 * Procedural convolution impulse response for a room/hall.
 * Exponentially-decaying stereo noise with a short early-reflection cluster
 * and per-channel decorrelation for width. `bright` tilts the tail toward HF.
 */
export function impulseResponse(
  ctx: Ctx,
  opts: {
    seconds: number
    decay?: number // higher = faster decay
    preDelay?: number // seconds of leading silence
    bright?: number // 0..1 HF content of tail
    seed?: number
  },
): AudioBuffer {
  const { seconds, decay = 3, preDelay = 0, bright = 0.4, seed = 1337 } = opts
  const rate = ctx.sampleRate
  const len = Math.max(1, Math.floor(seconds * rate))
  const pre = Math.floor(preDelay * rate)
  const buf = ctx.createBuffer(2, len, rate)
  for (let ch = 0; ch < 2; ch++) {
    const rnd = mulberry32(seed + ch * 104729)
    const data = buf.getChannelData(ch)
    // one-pole LP state for darkening the tail
    let lp = 0
    const lpCoef = 0.05 + bright * 0.85
    for (let i = 0; i < len; i++) {
      if (i < pre) { data[i] = 0; continue }
      const t = (i - pre) / (len - pre)
      const env = Math.pow(1 - t, decay)
      const w = rnd() * 2 - 1
      lp += (w - lp) * lpCoef
      // blend filtered + raw so tail keeps some sparkle
      data[i] = (lp * (1 - bright) + w * bright) * env
    }
    // early reflections: a few sparse taps in the first ~40ms
    const erRnd = mulberry32(seed + 999 + ch)
    const erCount = 6
    for (let e = 0; e < erCount; e++) {
      const pos = pre + Math.floor((0.004 + erRnd() * 0.05) * rate)
      if (pos < len) data[pos] += (erRnd() * 2 - 1) * 0.6 * (1 - e / erCount)
    }
  }
  return buf
}

/** Convenience: schedule a click-free gain envelope (ADSR-ish, all ramps). */
export function envGain(
  gain: GainNode,
  when: number,
  peak: number,
  attack: number,
  decay: number,
  opts: { sustain?: number; hold?: number; release?: number } = {},
): number {
  const { sustain = 0, hold = 0, release = 0 } = opts
  const g = gain.gain
  const eps = 0.0002
  g.setValueAtTime(0.0001, when)
  // linear attack is snappier and click-free for transients
  g.linearRampToValueAtTime(Math.max(eps, peak), when + Math.max(0.0005, attack))
  const decayEnd = when + attack + hold + decay
  const sus = Math.max(eps, peak * sustain)
  g.exponentialRampToValueAtTime(sus, decayEnd)
  const end = decayEnd + release
  if (release > 0) g.exponentialRampToValueAtTime(eps, end)
  return end
}

/** A single detuned/pitch-swept oscillator voice into a gain. */
export function oscVoice(
  ctx: Ctx,
  type: OscillatorType,
  freq: number,
): { osc: OscillatorNode; gain: GainNode } {
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.value = freq
  const gain = ctx.createGain()
  osc.connect(gain)
  return { osc, gain }
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
