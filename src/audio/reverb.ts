/**
 * Per-arena acoustic spaces + ambience bed definitions.
 *
 * Each of the 8 arenas gets a distinct convolution reverb (built from a
 * procedural impulse response) and an ambience bed layered from synthesized
 * elements (server hum, crowd murmur, rain, city, air). The garage feels
 * small and dry; the IPO floor is a cavernous hall.
 */

import { type Ctx, impulseResponse } from './dsp'

export type StageId =
  | 'pre-pmf'
  | 'hypergrowth'
  | 'plateau'
  | 'ai-native'
  | 'monetization'
  | 'crisis'
  | 'ipo-prep'
  | 'distribution'

export interface StageAcoustics {
  /** IR length in seconds — bigger = larger space. */
  seconds: number
  /** Decay exponent — higher = tighter/deader. */
  decay: number
  /** Pre-delay in seconds — bigger = larger perceived room. */
  preDelay: number
  /** HF content of the tail 0..1 — bright rooms vs dark ones. */
  bright: number
  /** Wet mix for the reverb bus 0..1. */
  wet: number
  /** Ambience bed recipe. */
  ambience: AmbienceSpec
}

export interface AmbienceSpec {
  /** low sine hum (server room / electrical) Hz, 0 = none */
  hum?: number
  humLevel?: number
  /** filtered noise wind/air 0..1 */
  air?: number
  /** crowd murmur band-limited noise 0..1 */
  crowd?: number
  /** rain/static hiss 0..1 */
  rain?: number
  /** overall bed gain */
  level: number
}

export const STAGE_ACOUSTICS: Record<StageId, StageAcoustics> = {
  // Garage / pre-product: tiny, dry, boxy room.
  'pre-pmf': {
    seconds: 0.5, decay: 5.5, preDelay: 0.004, bright: 0.35, wet: 0.14,
    ambience: { hum: 60, humLevel: 0.05, air: 0.06, level: 0.5 },
  },
  // Hypergrowth: mid room, energetic, some crowd.
  hypergrowth: {
    seconds: 1.1, decay: 3.4, preDelay: 0.011, bright: 0.55, wet: 0.2,
    ambience: { crowd: 0.1, air: 0.05, level: 0.55 },
  },
  // Plateau: flat, medium-dead office.
  plateau: {
    seconds: 0.9, decay: 4.2, preDelay: 0.009, bright: 0.4, wet: 0.16,
    ambience: { hum: 120, humLevel: 0.04, air: 0.05, level: 0.45 },
  },
  // AI-native: clean, bright, slightly synthetic space + electrical hum.
  'ai-native': {
    seconds: 1.3, decay: 3.0, preDelay: 0.013, bright: 0.75, wet: 0.22,
    ambience: { hum: 100, humLevel: 0.06, air: 0.07, level: 0.5 },
  },
  // Monetization: glossy mid-large room.
  monetization: {
    seconds: 1.5, decay: 2.8, preDelay: 0.015, bright: 0.6, wet: 0.24,
    ambience: { crowd: 0.08, air: 0.05, level: 0.5 },
  },
  // Crisis: dark, rainy, oppressive.
  crisis: {
    seconds: 1.8, decay: 2.6, preDelay: 0.017, bright: 0.28, wet: 0.26,
    ambience: { rain: 0.16, hum: 50, humLevel: 0.05, air: 0.06, level: 0.6 },
  },
  // IPO prep: huge glass hall, long bright tail, big crowd.
  'ipo-prep': {
    seconds: 2.6, decay: 2.0, preDelay: 0.022, bright: 0.7, wet: 0.3,
    ambience: { crowd: 0.14, air: 0.06, level: 0.6 },
  },
  // Distribution: expansive, airy, wide city-scale space.
  distribution: {
    seconds: 2.2, decay: 2.3, preDelay: 0.02, bright: 0.62, wet: 0.27,
    ambience: { crowd: 0.06, air: 0.09, hum: 80, humLevel: 0.03, level: 0.55 },
  },
}

/** Build the convolution IR buffer for a stage. */
export function stageImpulse(ctx: Ctx, stage: StageId): AudioBuffer {
  const a = STAGE_ACOUSTICS[stage] ?? STAGE_ACOUSTICS.hypergrowth
  return impulseResponse(ctx, {
    seconds: a.seconds,
    decay: a.decay,
    preDelay: a.preDelay,
    bright: a.bright,
    seed: 1000 + hashStage(stage),
  })
}

function hashStage(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h) % 100000
}
