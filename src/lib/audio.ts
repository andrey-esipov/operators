/**
 * Audio system. Uses WebAudio API directly to synthesize 8-bit SFX without external files.
 * Music is intentionally absent in v1 — sound effects do the work.
 *
 * All sounds are procedurally generated chiptune tones so the game ships
 * with arcade-feel audio out of the box with zero asset cost.
 */

let ctx: AudioContext | null = null

function getCtx(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)()
  return ctx
}

function tone(opts: {
  freq: number
  duration: number
  type?: OscillatorType
  vol?: number
  attack?: number
  decay?: number
  pitchEnd?: number
}) {
  const c = getCtx()
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = opts.type ?? 'square'
  o.frequency.setValueAtTime(opts.freq, c.currentTime)
  if (opts.pitchEnd) {
    o.frequency.exponentialRampToValueAtTime(opts.pitchEnd, c.currentTime + opts.duration)
  }
  const vol = opts.vol ?? 0.18
  g.gain.setValueAtTime(0, c.currentTime)
  g.gain.linearRampToValueAtTime(vol, c.currentTime + (opts.attack ?? 0.005))
  g.gain.linearRampToValueAtTime(0, c.currentTime + opts.duration)
  o.connect(g)
  g.connect(c.destination)
  o.start()
  o.stop(c.currentTime + opts.duration)
}

function noise(duration: number, vol = 0.15) {
  const c = getCtx()
  const buffer = c.createBuffer(1, c.sampleRate * duration, c.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  const src = c.createBufferSource()
  src.buffer = buffer
  const g = c.createGain()
  g.gain.value = vol
  src.connect(g)
  g.connect(c.destination)
  src.start()
}

export const Sfx = {
  light() {
    tone({ freq: 440, duration: 0.08, type: 'square', vol: 0.12, pitchEnd: 220 })
  },
  heavy() {
    tone({ freq: 220, duration: 0.18, type: 'sawtooth', vol: 0.2, pitchEnd: 110 })
    noise(0.08, 0.1)
  },
  crit() {
    tone({ freq: 880, duration: 0.06, type: 'square', vol: 0.18 })
    setTimeout(() => tone({ freq: 1320, duration: 0.06, type: 'square', vol: 0.18 }), 50)
    setTimeout(() => tone({ freq: 1760, duration: 0.12, type: 'square', vol: 0.18 }), 100)
  },
  combo() {
    tone({ freq: 523, duration: 0.06, type: 'square', vol: 0.16 })
    setTimeout(() => tone({ freq: 659, duration: 0.06, type: 'square', vol: 0.16 }), 60)
    setTimeout(() => tone({ freq: 784, duration: 0.18, type: 'square', vol: 0.18 }), 120)
  },
  ult() {
    tone({ freq: 110, duration: 0.5, type: 'sawtooth', vol: 0.18, pitchEnd: 880 })
    setTimeout(() => noise(0.4, 0.08), 200)
  },
  ko() {
    noise(0.6, 0.15)
    tone({ freq: 220, duration: 0.6, type: 'sawtooth', vol: 0.2, pitchEnd: 55 })
  },
  menuMove() {
    tone({ freq: 660, duration: 0.04, type: 'square', vol: 0.08 })
  },
  menuSelect() {
    tone({ freq: 880, duration: 0.06, type: 'square', vol: 0.1 })
    setTimeout(() => tone({ freq: 1320, duration: 0.08, type: 'square', vol: 0.1 }), 60)
  },
  fight() {
    // FIGHT! voice cue stand-in
    tone({ freq: 660, duration: 0.1, type: 'square', vol: 0.18 })
    setTimeout(() => tone({ freq: 990, duration: 0.16, type: 'square', vol: 0.2 }), 120)
  },
  victory() {
    const notes = [523, 659, 784, 1047]
    notes.forEach((n, i) =>
      setTimeout(() => tone({ freq: n, duration: 0.18, type: 'square', vol: 0.16 }), i * 120)
    )
  },
  defeat() {
    const notes = [440, 392, 349, 261]
    notes.forEach((n, i) =>
      setTimeout(() => tone({ freq: n, duration: 0.22, type: 'sawtooth', vol: 0.16 }), i * 150)
    )
  },
}
