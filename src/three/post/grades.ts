import * as THREE from 'three'
import type { ScenarioId } from '../../types'

/**
 * A per-stage colour script.
 *
 * These are authored the way a DI colourist would build a show LUT: a neutral
 * filmic base (AgX) with a per-stage "look" layered on top — white balance,
 * lift/gamma/gain, an AgX log-space look (slope/offset/power/saturation),
 * split toning and a vignette. The eight arenas each get their own emotional
 * grade so the game reads as authored, not as a raw WebGL buffer.
 *
 * All colour values are linear-sRGB unless noted. The grade is uploaded to the
 * MasterGradeEffect as uniforms and cross-faded on stage changes.
 */
export interface StageGrade {
  /** Linear exposure multiplier applied before the tone map. */
  exposure: number
  /** White balance: warm(+)/cool(-) and green(-)/magenta(+). Small values. */
  temperature: number
  tint: number
  /** ASC-CDL style shadow lift (added), mid gamma, highlight gain (mult). */
  lift: [number, number, number]
  gamma: [number, number, number]
  gain: [number, number, number]
  /** Saturation applied in linear before the tone map. 1 = neutral. */
  preSat: number
  /** AgX log-space look. */
  lookSlope: [number, number, number]
  lookOffset: [number, number, number]
  lookPower: [number, number, number]
  lookSat: number
  /** Display-referred S-curve contrast around 0.5. 1 = neutral. */
  contrast: number
  /** Post-tonemap black-point crush for filmic density. 0 = none. */
  black: number
  /** Split toning: shadow + highlight tint colours, balance pivot, strength. */
  shadowTint: [number, number, number]
  highlightTint: [number, number, number]
  splitBalance: number
  splitStrength: number
  /** Vignette: radius offset, darkness, and its colour (cool/warm falloff). */
  vigOffset: number
  vigDarkness: number
  vigColor: [number, number, number]
  /** Filmic grain strength (sits in the mid-tones). */
  grain: number
  /** Bloom art direction. */
  bloomIntensity: number
  bloomThreshold: number
  bloomTint: [number, number, number]
  /** Lens dirt / anamorphic streak strength for this arena. */
  lensDirt: number
  anamorphic: number
  anamorphicTint: [number, number, number]
}

const base: StageGrade = {
  exposure: 1.0,
  temperature: 0,
  tint: 0,
  lift: [0, 0, 0],
  gamma: [1, 1, 1],
  gain: [1, 1, 1],
  preSat: 1.0,
  lookSlope: [1, 1, 1],
  lookOffset: [0, 0, 0],
  lookPower: [1, 1, 1],
  lookSat: 1.0,
  contrast: 1.0,
  black: 0.025,
  shadowTint: [0.5, 0.55, 0.7],
  highlightTint: [1.0, 0.95, 0.85],
  splitBalance: 0.5,
  splitStrength: 0.12,
  vigOffset: 0.62,
  vigDarkness: 0.5,
  vigColor: [0.06, 0.05, 0.09],
  grain: 0.05,
  bloomIntensity: 1.1,
  bloomThreshold: 0.6,
  bloomTint: [1, 1, 1],
  lensDirt: 0.35,
  anamorphic: 0.35,
  anamorphicTint: [0.35, 0.55, 1.0],
}

function grade(overrides: Partial<StageGrade>): StageGrade {
  return { ...base, ...overrides }
}

/**
 * The eight authored arena grades. Each is written to evoke the emotional beat
 * of that stage of a company's life.
 */
export const STAGE_GRADES: Record<ScenarioId, StageGrade> = {
  // Uncertain, cold pre-dawn. Muted, blue-grey, low energy — everything still
  // to prove. Slightly lifted milky shadows (fog of the unknown).
  'pre-pmf': grade({
    exposure: 1.02,
    temperature: -0.06,
    tint: 0.01,
    lift: [0.008, 0.012, 0.02],
    gamma: [1.0, 1.0, 1.02],
    gain: [0.98, 0.99, 1.02],
    preSat: 0.9,
    lookSat: 0.9,
    contrast: 1.05,
    shadowTint: [0.34, 0.42, 0.62],
    highlightTint: [0.86, 0.9, 1.0],
    splitStrength: 0.18,
    vigOffset: 0.55,
    vigDarkness: 0.62,
    vigColor: [0.03, 0.04, 0.08],
    grain: 0.07,
    bloomIntensity: 0.95,
    bloomThreshold: 0.68,
    bloomTint: [0.8, 0.88, 1.0],
    lensDirt: 0.25,
    anamorphic: 0.28,
    anamorphicTint: [0.4, 0.55, 1.0],
  }),

  // Explosive, electric momentum. Punchy teal-and-orange, high saturation and
  // contrast — the classic energetic fighting-game grade.
  hypergrowth: grade({
    exposure: 1.08,
    temperature: 0.05,
    tint: 0.0,
    lift: [0.0, 0.004, 0.014],
    gamma: [0.99, 1.0, 1.0],
    gain: [1.06, 1.02, 0.97],
    preSat: 1.12,
    lookSlope: [1.04, 1.0, 0.97],
    lookSat: 1.16,
    contrast: 1.14,
    black: 0.03,
    shadowTint: [0.22, 0.44, 0.66],
    highlightTint: [1.0, 0.86, 0.6],
    splitBalance: 0.48,
    splitStrength: 0.22,
    vigOffset: 0.6,
    vigDarkness: 0.56,
    vigColor: [0.05, 0.03, 0.02],
    grain: 0.05,
    bloomIntensity: 1.35,
    bloomThreshold: 0.56,
    bloomTint: [1.0, 0.92, 0.78],
    lensDirt: 0.42,
    anamorphic: 0.5,
    anamorphicTint: [0.5, 0.7, 1.0],
  }),

  // Stalled, airless. Flat, faintly sickly green-grey — the grind of the
  // plateau. Low contrast, drained saturation.
  plateau: grade({
    exposure: 0.98,
    temperature: -0.02,
    tint: -0.05,
    lift: [0.01, 0.014, 0.012],
    gamma: [1.0, 1.0, 0.99],
    gain: [0.98, 1.0, 0.97],
    preSat: 0.82,
    lookSat: 0.82,
    contrast: 0.96,
    shadowTint: [0.4, 0.46, 0.44],
    highlightTint: [0.92, 0.94, 0.86],
    splitStrength: 0.14,
    vigOffset: 0.58,
    vigDarkness: 0.58,
    vigColor: [0.05, 0.06, 0.05],
    grain: 0.08,
    bloomIntensity: 0.85,
    bloomThreshold: 0.7,
    bloomTint: [0.92, 0.96, 0.88],
    lensDirt: 0.2,
    anamorphic: 0.22,
    anamorphicTint: [0.5, 0.6, 0.7],
  }),

  // Neon future. Cyan/magenta bi-chromatic, cool and high-contrast with hot
  // bloom on the emissive tech.
  'ai-native': grade({
    exposure: 1.05,
    temperature: -0.05,
    tint: 0.04,
    lift: [0.0, 0.006, 0.016],
    gamma: [0.99, 1.0, 1.01],
    gain: [1.02, 1.0, 1.05],
    preSat: 1.1,
    lookSlope: [1.0, 0.99, 1.05],
    lookSat: 1.14,
    contrast: 1.16,
    black: 0.034,
    shadowTint: [0.18, 0.3, 0.6],
    highlightTint: [0.85, 0.75, 1.0],
    splitBalance: 0.46,
    splitStrength: 0.26,
    vigOffset: 0.58,
    vigDarkness: 0.62,
    vigColor: [0.04, 0.02, 0.1],
    grain: 0.05,
    bloomIntensity: 1.5,
    bloomThreshold: 0.5,
    bloomTint: [0.7, 0.85, 1.0],
    lensDirt: 0.45,
    anamorphic: 0.68,
    anamorphicTint: [0.5, 0.8, 1.0],
  }),

  // Money. Warm gold with rich green undertones, luxe and slightly opulent —
  // creamy highlights, deep saturated mids.
  monetization: grade({
    exposure: 1.05,
    temperature: 0.07,
    tint: -0.02,
    lift: [0.006, 0.008, 0.0],
    gamma: [1.0, 1.0, 0.98],
    gain: [1.05, 1.02, 0.92],
    preSat: 1.08,
    lookSlope: [1.03, 1.01, 0.95],
    lookSat: 1.1,
    contrast: 1.1,
    shadowTint: [0.3, 0.36, 0.28],
    highlightTint: [1.0, 0.9, 0.62],
    splitBalance: 0.5,
    splitStrength: 0.24,
    vigOffset: 0.6,
    vigDarkness: 0.54,
    vigColor: [0.06, 0.05, 0.02],
    grain: 0.05,
    bloomIntensity: 1.2,
    bloomThreshold: 0.58,
    bloomTint: [1.0, 0.88, 0.6],
    lensDirt: 0.4,
    anamorphic: 0.4,
    anamorphicTint: [1.0, 0.8, 0.4],
  }),

  // Crisis. Smouldering red/orange danger, crushed cool shadows, high
  // contrast, heavier grain and vignette. Everything is on fire.
  crisis: grade({
    exposure: 1.0,
    temperature: 0.06,
    tint: 0.02,
    lift: [0.014, 0.004, 0.004],
    gamma: [1.02, 0.99, 0.97],
    gain: [1.08, 0.98, 0.9],
    preSat: 1.02,
    lookSlope: [1.06, 0.98, 0.94],
    lookSat: 1.06,
    contrast: 1.2,
    black: 0.04,
    shadowTint: [0.4, 0.16, 0.14],
    highlightTint: [1.0, 0.72, 0.4],
    splitBalance: 0.52,
    splitStrength: 0.3,
    vigOffset: 0.5,
    vigDarkness: 0.72,
    vigColor: [0.09, 0.02, 0.01],
    grain: 0.09,
    bloomIntensity: 1.3,
    bloomThreshold: 0.54,
    bloomTint: [1.0, 0.6, 0.35],
    lensDirt: 0.5,
    anamorphic: 0.45,
    anamorphicTint: [1.0, 0.5, 0.3],
  }),

  // Prestige. Clean, bright, cool corporate glass — champagne highlights, low
  // grain, restrained and expensive-looking.
  'ipo-prep': grade({
    exposure: 1.1,
    temperature: -0.03,
    tint: 0.0,
    lift: [0.004, 0.006, 0.01],
    gamma: [1.0, 1.0, 1.0],
    gain: [1.02, 1.02, 1.03],
    preSat: 0.98,
    lookSat: 1.02,
    contrast: 1.08,
    shadowTint: [0.32, 0.4, 0.56],
    highlightTint: [1.0, 0.97, 0.9],
    splitBalance: 0.5,
    splitStrength: 0.16,
    vigOffset: 0.66,
    vigDarkness: 0.44,
    vigColor: [0.05, 0.06, 0.08],
    grain: 0.035,
    bloomIntensity: 1.15,
    bloomThreshold: 0.6,
    bloomTint: [1.0, 0.98, 0.92],
    lensDirt: 0.3,
    anamorphic: 0.42,
    anamorphicTint: [0.7, 0.8, 1.0],
  }),

  // Broadcast blockbuster. Wide warm sunset, saturated teal-and-orange with a
  // cinematic falloff — the "go wide" finale grade.
  distribution: grade({
    exposure: 1.06,
    temperature: 0.08,
    tint: 0.0,
    lift: [0.002, 0.006, 0.016],
    gamma: [0.99, 1.0, 1.0],
    gain: [1.07, 1.0, 0.94],
    preSat: 1.12,
    lookSlope: [1.05, 1.0, 0.95],
    lookSat: 1.14,
    contrast: 1.14,
    black: 0.03,
    shadowTint: [0.2, 0.42, 0.6],
    highlightTint: [1.0, 0.82, 0.55],
    splitBalance: 0.48,
    splitStrength: 0.26,
    vigOffset: 0.62,
    vigDarkness: 0.54,
    vigColor: [0.06, 0.04, 0.02],
    grain: 0.05,
    bloomIntensity: 1.3,
    bloomThreshold: 0.55,
    bloomTint: [1.0, 0.86, 0.62],
    lensDirt: 0.44,
    anamorphic: 0.55,
    anamorphicTint: [1.0, 0.75, 0.45],
  }),
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerp3 = (
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

/** Smoothly cross-fade two grades (used on stage transitions). */
export function mixGrades(a: StageGrade, b: StageGrade, t: number): StageGrade {
  return {
    exposure: lerp(a.exposure, b.exposure, t),
    temperature: lerp(a.temperature, b.temperature, t),
    tint: lerp(a.tint, b.tint, t),
    lift: lerp3(a.lift, b.lift, t),
    gamma: lerp3(a.gamma, b.gamma, t),
    gain: lerp3(a.gain, b.gain, t),
    preSat: lerp(a.preSat, b.preSat, t),
    lookSlope: lerp3(a.lookSlope, b.lookSlope, t),
    lookOffset: lerp3(a.lookOffset, b.lookOffset, t),
    lookPower: lerp3(a.lookPower, b.lookPower, t),
    lookSat: lerp(a.lookSat, b.lookSat, t),
    contrast: lerp(a.contrast, b.contrast, t),
    black: lerp(a.black, b.black, t),
    shadowTint: lerp3(a.shadowTint, b.shadowTint, t),
    highlightTint: lerp3(a.highlightTint, b.highlightTint, t),
    splitBalance: lerp(a.splitBalance, b.splitBalance, t),
    splitStrength: lerp(a.splitStrength, b.splitStrength, t),
    vigOffset: lerp(a.vigOffset, b.vigOffset, t),
    vigDarkness: lerp(a.vigDarkness, b.vigDarkness, t),
    vigColor: lerp3(a.vigColor, b.vigColor, t),
    grain: lerp(a.grain, b.grain, t),
    bloomIntensity: lerp(a.bloomIntensity, b.bloomIntensity, t),
    bloomThreshold: lerp(a.bloomThreshold, b.bloomThreshold, t),
    bloomTint: lerp3(a.bloomTint, b.bloomTint, t),
    lensDirt: lerp(a.lensDirt, b.lensDirt, t),
    anamorphic: lerp(a.anamorphic, b.anamorphic, t),
    anamorphicTint: lerp3(a.anamorphicTint, b.anamorphicTint, t),
  }
}

/**
 * Convert a temperature/tint pair into an approximate linear white-balance
 * gain. Warm (+temp) pushes red/knocks blue; magenta (+tint) lifts red/blue.
 */
export function whiteBalanceGain(temperature: number, tint: number): THREE.Vector3 {
  const r = 1 + temperature * 0.6 + tint * 0.2
  const g = 1 - tint * 0.3
  const b = 1 - temperature * 0.6 + tint * 0.2
  return new THREE.Vector3(r, g, b)
}

export function gradeFor(scenario: ScenarioId): StageGrade {
  return STAGE_GRADES[scenario] ?? base
}

export const NEUTRAL_GRADE = base
