import * as THREE from 'three'
import type { ScenarioId } from '../../types'
import type { StageLightingPreset } from '../lighting/LightRig'

/**
 * Per-stage art direction.
 *
 * Each entry is a complete lighting + atmosphere recipe. The palettes are
 * lifted from the existing CSS stage themes so the 3D stages read as the same
 * places, just actually lit.
 */
export interface StagePractical {
  pos: [number, number, number]
  color: number
  intensity: number
  distance: number
}

export interface StageConfig {
  id: ScenarioId
  name: string
  /** Backdrop plate. */
  backdrop: string
  lighting: StageLightingPreset
  /** Floor material tuning. */
  floor: {
    color: number
    roughness: number
    metalness: number
    /** Mirror strength 0..1. */
    reflectivity: number
    /** Emissive grid lines. */
    gridColor: number
    gridIntensity: number
  }
  /** Colour of the light shafts / god rays. */
  shaftColor: number
  shaftIntensity: number
  /** Ambient particle mood. */
  motes: { color: number; density: number; drift: number }
  /** Accent used by generic props. */
  accent: number

  // --- 3D set-dressing art direction (added for AAA staging) -------------
  /** Glowing arena-boundary / edge-trim colour. */
  trim: number
  /** Base colour of structural architecture (racks, gantries, walls). */
  structure: number
  /** Animated-screen palette. */
  screen: { hue: number; hue2: number }
  /** Reflection roughness 0=mirror..1=matte, and metallic reflection tint. */
  floorRoughness: number
  floorTint: number
  /** Motivated practical point lights placed in the set. */
  practicals: StagePractical[]
}

const P = (
  key: [number, number, [number, number, number]],
  fill: [number, number, [number, number, number]],
  rim: [number, number, [number, number, number]],
  ambient: [number, number],
  fog: [number, number],
  background: number,
  exposure: number,
): StageLightingPreset => ({
  key: { color: key[0], intensity: key[1], dir: key[2] },
  fill: { color: fill[0], intensity: fill[1], dir: fill[2] },
  rim: { color: rim[0], intensity: rim[1], dir: rim[2] },
  ambient: { color: ambient[0], intensity: ambient[1] },
  fog: { color: fog[0], density: fog[1] },
  background,
  exposure,
})

export const STAGES: Record<ScenarioId, StageConfig> = {
  'pre-pmf': {
    id: 'pre-pmf',
    name: 'THE GARAGE',
    backdrop: '/stages/pre-pmf.png',
    lighting: P(
      [0xffd9a0, 3.4, [-0.5, 0.78, 0.38]],
      [0x4a3a7a, 0.9, [0.72, 0.3, 0.45]],
      [0xff9d4d, 2.8, [0.3, 0.4, -0.86]],
      [0x2a1f42, 0.6],
      [0x140c26, 0.019],
      0x0d0718,
      1.02,
    ),
    floor: { color: 0x1c1330, roughness: 0.42, metalness: 0.1, reflectivity: 0.5, gridColor: 0xf77f00, gridIntensity: 0.55 },
    shaftColor: 0xffb05a,
    shaftIntensity: 0.5,
    motes: { color: 0xffca7a, density: 0.7, drift: 0.35 },
    accent: 0xf77f00,
    trim: 0xff9d3c,
    structure: 0x211a26,
    screen: { hue: 0xff9d3c, hue2: 0x36e0ff },
    floorRoughness: 0.5,
    floorTint: 0xcabfa8,
    practicals: [
      { pos: [-5.5, 4.6, -7], color: 0xffb257, intensity: 22, distance: 20 },
      { pos: [5.2, 3.2, -6], color: 0xffd9a0, intensity: 14, distance: 16 },
      { pos: [0, 5.5, -12], color: 0xff8a3c, intensity: 12, distance: 24 },
    ],
  },
  hypergrowth: {
    id: 'hypergrowth',
    name: 'THE ROCKET DECK',
    backdrop: '/stages/hypergrowth.png',
    lighting: P(
      [0xd8f4ff, 3.6, [-0.42, 0.8, 0.44]],
      [0x1c5aa8, 1.05, [0.7, 0.28, 0.5]],
      [0x33e0ff, 3.1, [0.24, 0.42, -0.88]],
      [0x14283f, 0.62],
      [0x081726, 0.017],
      0x04101c,
      1.05,
    ),
    floor: { color: 0x0d2038, roughness: 0.24, metalness: 0.45, reflectivity: 0.78, gridColor: 0x06d6a0, gridIntensity: 0.8 },
    shaftColor: 0x66e6ff,
    shaftIntensity: 0.72,
    motes: { color: 0x9ff0ff, density: 1.0, drift: 0.7 },
    accent: 0x06d6a0,
    trim: 0x33e0ff,
    structure: 0x14202e,
    screen: { hue: 0x2ffbd0, hue2: 0x59c8ff },
    floorRoughness: 0.16,
    floorTint: 0xbcd8ec,
    practicals: [
      { pos: [-6, 5, -8], color: 0x33e0ff, intensity: 26, distance: 24 },
      { pos: [6, 5, -8], color: 0x2ffbd0, intensity: 26, distance: 24 },
      { pos: [0, 2.2, -3.5], color: 0x88f0ff, intensity: 10, distance: 12 },
    ],
  },
  plateau: {
    id: 'plateau',
    name: 'THE FLATLINE',
    backdrop: '/stages/plateau.png',
    lighting: P(
      [0xf2d8ff, 3.0, [-0.55, 0.72, 0.4]],
      [0x50208a, 0.95, [0.68, 0.3, 0.48]],
      [0xf72585, 3.0, [0.28, 0.44, -0.85]],
      [0x241338, 0.58],
      [0x150a24, 0.022],
      0x0f0620,
      1.0,
    ),
    floor: { color: 0x1d1136, roughness: 0.3, metalness: 0.3, reflectivity: 0.68, gridColor: 0xf72585, gridIntensity: 0.7 },
    shaftColor: 0xc766ff,
    shaftIntensity: 0.62,
    motes: { color: 0xe0a0ff, density: 0.8, drift: 0.28 },
    accent: 0xf72585,
    trim: 0xf72585,
    structure: 0x1c1430,
    screen: { hue: 0xf72585, hue2: 0x9d4edd },
    floorRoughness: 0.32,
    floorTint: 0xcbb2dc,
    practicals: [
      { pos: [-5.5, 4, -7], color: 0xf72585, intensity: 20, distance: 20 },
      { pos: [5.5, 4, -7], color: 0x9d4edd, intensity: 20, distance: 20 },
      { pos: [0, 6, -13], color: 0xc766ff, intensity: 12, distance: 26 },
    ],
  },
  'ai-native': {
    id: 'ai-native',
    name: 'THE MODEL FLOOR',
    backdrop: '/stages/ai-native.png',
    lighting: P(
      [0xcdfaff, 3.5, [-0.4, 0.82, 0.4]],
      [0x0f4f7a, 1.0, [0.72, 0.26, 0.5]],
      [0x06d6a0, 3.2, [0.22, 0.4, -0.89]],
      [0x0a2836, 0.6],
      [0x04141f, 0.018],
      0x02101a,
      1.06,
    ),
    floor: { color: 0x07202e, roughness: 0.18, metalness: 0.6, reflectivity: 0.88, gridColor: 0x00e5ff, gridIntensity: 0.95 },
    shaftColor: 0x59ffe0,
    shaftIntensity: 0.8,
    motes: { color: 0x8cffe8, density: 1.2, drift: 0.9 },
    accent: 0x06d6a0,
    trim: 0x00e5ff,
    structure: 0x0a1b24,
    screen: { hue: 0x00e5ff, hue2: 0x59ffb0 },
    floorRoughness: 0.1,
    floorTint: 0xb8e6f2,
    practicals: [
      { pos: [-6.5, 4.5, -9], color: 0x00e5ff, intensity: 24, distance: 26 },
      { pos: [6.5, 4.5, -9], color: 0x59ffe0, intensity: 24, distance: 26 },
      { pos: [0, 7, -14], color: 0x33fff0, intensity: 14, distance: 28 },
    ],
  },
  monetization: {
    id: 'monetization',
    name: 'THE PRICING ROOM',
    backdrop: '/stages/monetization.png',
    lighting: P(
      [0xffeec2, 3.3, [-0.52, 0.75, 0.4]],
      [0x5c1f6e, 0.92, [0.7, 0.3, 0.46]],
      [0xffd60a, 2.9, [0.3, 0.42, -0.86]],
      [0x2a1230, 0.58],
      [0x1a0a1c, 0.02],
      0x140718,
      1.02,
    ),
    floor: { color: 0x24122c, roughness: 0.26, metalness: 0.42, reflectivity: 0.74, gridColor: 0xffd60a, gridIntensity: 0.72 },
    shaftColor: 0xffd97a,
    shaftIntensity: 0.66,
    motes: { color: 0xffe08a, density: 0.9, drift: 0.4 },
    accent: 0xffd60a,
    trim: 0xffd60a,
    structure: 0x241528,
    screen: { hue: 0xffd60a, hue2: 0x2fe08a },
    floorRoughness: 0.26,
    floorTint: 0xdccca0,
    practicals: [
      { pos: [-5.5, 4.2, -7], color: 0xffd60a, intensity: 22, distance: 20 },
      { pos: [5.5, 4.2, -7], color: 0xffe9a0, intensity: 18, distance: 18 },
      { pos: [0, 6, -12], color: 0xffcf3c, intensity: 12, distance: 24 },
    ],
  },
  crisis: {
    id: 'crisis',
    name: 'THE WAR ROOM',
    backdrop: '/stages/crisis.png',
    lighting: P(
      [0xffd0c0, 3.2, [-0.58, 0.7, 0.36]],
      [0x6a1f1f, 0.9, [0.68, 0.3, 0.44]],
      [0xef233c, 3.2, [0.3, 0.4, -0.86]],
      [0x2c1010, 0.55],
      [0x1c0808, 0.026],
      0x150505,
      0.98,
    ),
    floor: { color: 0x241010, roughness: 0.36, metalness: 0.2, reflectivity: 0.56, gridColor: 0xef233c, gridIntensity: 0.85 },
    shaftColor: 0xff6a5a,
    shaftIntensity: 0.85,
    motes: { color: 0xff9a72, density: 1.4, drift: 0.5 },
    accent: 0xef233c,
    trim: 0xef233c,
    structure: 0x1e1416,
    screen: { hue: 0xef233c, hue2: 0xff7a3c },
    floorRoughness: 0.4,
    floorTint: 0xcc9a90,
    practicals: [
      { pos: [-5.5, 4, -7], color: 0xef233c, intensity: 22, distance: 20 },
      { pos: [5.5, 4, -7], color: 0xff5a3c, intensity: 18, distance: 18 },
      { pos: [0, 5.5, -12], color: 0xff3030, intensity: 14, distance: 24 },
    ],
  },
  'ipo-prep': {
    id: 'ipo-prep',
    name: 'THE LISTING FLOOR',
    backdrop: '/stages/ipo-prep.png',
    lighting: P(
      [0xfff4dc, 3.5, [-0.45, 0.8, 0.42]],
      [0x1e3f70, 0.95, [0.7, 0.28, 0.48]],
      [0xfcbf49, 2.8, [0.26, 0.44, -0.86]],
      [0x131f33, 0.6],
      [0x0a1220, 0.016],
      0x070d18,
      1.04,
    ),
    floor: { color: 0x101d33, roughness: 0.2, metalness: 0.55, reflectivity: 0.85, gridColor: 0xfcbf49, gridIntensity: 0.6 },
    shaftColor: 0xffe0a0,
    shaftIntensity: 0.7,
    motes: { color: 0xffeec2, density: 0.6, drift: 0.25 },
    accent: 0xfcbf49,
    trim: 0xfcbf49,
    structure: 0x121d2e,
    screen: { hue: 0xfcbf49, hue2: 0x59c8ff },
    floorRoughness: 0.14,
    floorTint: 0xdcd2ac,
    practicals: [
      { pos: [-6, 4.6, -8], color: 0xfcbf49, intensity: 22, distance: 22 },
      { pos: [6, 4.6, -8], color: 0xffe0a0, intensity: 20, distance: 22 },
      { pos: [0, 7, -13], color: 0xffd97a, intensity: 14, distance: 26 },
    ],
  },
  distribution: {
    id: 'distribution',
    name: 'THE CHANNEL',
    backdrop: '/stages/distribution.png',
    lighting: P(
      [0xffd9a8, 3.6, [-0.5, 0.76, 0.4]],
      [0x7a3a10, 0.95, [0.7, 0.3, 0.46]],
      [0xffd60a, 3.0, [0.28, 0.42, -0.86]],
      [0x2e1a0c, 0.6],
      [0x1c0f06, 0.02],
      0x160c05,
      1.03,
    ),
    floor: { color: 0x2a1709, roughness: 0.34, metalness: 0.28, reflectivity: 0.6, gridColor: 0xffd60a, gridIntensity: 0.7 },
    shaftColor: 0xffc36a,
    shaftIntensity: 0.75,
    motes: { color: 0xffd89a, density: 1.0, drift: 0.55 },
    accent: 0xf77f00,
    trim: 0xffa53c,
    structure: 0x241a12,
    screen: { hue: 0xffb03c, hue2: 0x36c8ff },
    floorRoughness: 0.4,
    floorTint: 0xd4b890,
    practicals: [
      { pos: [-5.8, 4.2, -7], color: 0xffb03c, intensity: 22, distance: 20 },
      { pos: [5.8, 4.2, -7], color: 0xffd08a, intensity: 18, distance: 18 },
      { pos: [0, 5.5, -12], color: 0xff9d3c, intensity: 12, distance: 24 },
    ],
  },
}

export const STAGE_ORDER: ScenarioId[] = [
  'pre-pmf', 'hypergrowth', 'plateau', 'ai-native',
  'monetization', 'crisis', 'ipo-prep', 'distribution',
]

export function stageConfig(id: ScenarioId): StageConfig {
  return STAGES[id] ?? STAGES['pre-pmf']
}

/** Convenience for subsystems that want a THREE.Color without allocating. */
export function hexColor(hex: number): THREE.Color {
  return new THREE.Color(hex)
}
