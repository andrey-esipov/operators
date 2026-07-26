/**
 * Per-stage ambience beds — looping synthesized environmental texture that
 * sits under the music (server hum, crowd murmur, rain hiss, room air).
 *
 * Each bed is a small set of long looping buffer/oscillator voices with slow
 * LFO movement so it never sounds static. Fully fades in/out on stage change.
 */

import { type Ctx, noiseBuffer } from './dsp'
import type { AmbienceSpec } from './reverb'

export interface AmbienceHandle {
  out: GainNode
  stop: (when: number, fade?: number) => void
}

export function buildAmbience(ctx: Ctx, dest: AudioNode, spec: AmbienceSpec, when: number): AmbienceHandle {
  const out = ctx.createGain()
  out.gain.value = 0.0001
  out.connect(dest)
  // fade in
  out.gain.setValueAtTime(0.0001, when)
  out.gain.linearRampToValueAtTime(spec.level, when + 1.2)

  const sources: (AudioScheduledSourceNode)[] = []

  // Electrical / server hum: sine + its octave, gently detuned.
  if (spec.hum) {
    const lvl = spec.humLevel ?? 0.05
    ;[1, 2, 3].forEach((mult, i) => {
      const o = ctx.createOscillator()
      o.type = i === 0 ? 'sine' : 'triangle'
      o.frequency.value = spec.hum! * mult
      const g = ctx.createGain()
      g.gain.value = lvl / (i + 1)
      // slow amplitude shimmer
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.15 + i * 0.07
      const lfoG = ctx.createGain(); lfoG.gain.value = lvl * 0.3
      lfo.connect(lfoG); lfoG.connect(g.gain)
      o.connect(g); g.connect(out)
      o.start(when); lfo.start(when)
      sources.push(o, lfo)
    })
  }

  // Room air / wind: low-passed brown noise.
  if (spec.air) {
    const nb = noiseBuffer(ctx, 3.1, { color: 'brown', seed: 4242 })
    const src = ctx.createBufferSource(); src.buffer = nb; src.loop = true
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500
    const g = ctx.createGain(); g.gain.value = spec.air
    src.connect(lp); lp.connect(g); g.connect(out)
    src.start(when); sources.push(src)
  }

  // Crowd murmur: band-passed pink noise with slow swell.
  if (spec.crowd) {
    const nb = noiseBuffer(ctx, 4.3, { color: 'pink', seed: 7777 })
    const src = ctx.createBufferSource(); src.buffer = nb; src.loop = true
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.8
    const g = ctx.createGain(); g.gain.value = spec.crowd
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.1
    const lfoG = ctx.createGain(); lfoG.gain.value = spec.crowd * 0.4
    lfo.connect(lfoG); lfoG.connect(g.gain)
    src.connect(bp); bp.connect(g); g.connect(out)
    src.start(when); lfo.start(when); sources.push(src, lfo)
  }

  // Rain / static hiss: high-passed white noise.
  if (spec.rain) {
    const nb = noiseBuffer(ctx, 2.7, { color: 'white', seed: 9191 })
    const src = ctx.createBufferSource(); src.buffer = nb; src.loop = true
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800
    const g = ctx.createGain(); g.gain.value = spec.rain
    src.connect(hp); hp.connect(g); g.connect(out)
    src.start(when); sources.push(src)
  }

  return {
    out,
    stop(atWhen: number, fade = 1.0) {
      out.gain.cancelScheduledValues(atWhen)
      out.gain.setValueAtTime(out.gain.value, atWhen)
      out.gain.linearRampToValueAtTime(0.0001, atWhen + fade)
      for (const s of sources) {
        try { s.stop(atWhen + fade + 0.05) } catch { /* already stopped */ }
      }
    },
  }
}
