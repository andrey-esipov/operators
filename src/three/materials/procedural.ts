import * as THREE from 'three'
import { contrast, fbm, mixBuf, mulBuf, normalise, rng, streaks, worley } from './noise'

/**
 * Procedural PBR material bakery.
 *
 * The stages have no authored texture assets, and untextured primitives are the
 * single loudest "this is a hobby project" signal in a 3D frame. This module
 * bakes tileable albedo / roughness / metalness / normal / AO map sets at
 * runtime from seeded noise, so every surface has real micro-detail for the
 * light to catch.
 *
 * Everything is cached by `${preset}:${seed}:${size}` — a stage that uses
 * `concrete` in four places pays for one bake.
 */

export type MaterialPreset =
  | 'concrete'
  | 'polishedConcrete'
  | 'asphalt'
  | 'brushedMetal'
  | 'paintedMetal'
  | 'darkSteel'
  | 'rustedSteel'
  | 'marble'
  | 'wornWood'
  | 'plywood'
  | 'rubberFloor'
  | 'carpet'
  | 'fabric'
  | 'plaster'
  | 'drywall'
  | 'glassPanel'
  | 'carbonFibre'
  | 'perforatedMetal'
  | 'cardboard'
  | 'whiteboard'

export interface MapSet {
  map: THREE.Texture
  roughnessMap: THREE.Texture
  normalMap: THREE.Texture
  aoMap: THREE.Texture
  metalnessMap?: THREE.Texture
  /** Sensible defaults for the material that consumes these maps. */
  defaults: { roughness: number; metalness: number; normalScale: number; color: number }
}

interface Recipe {
  /** Base colour and the colour of the "dirty"/variation pass. */
  base: [number, number, number]
  alt: [number, number, number]
  /** Fills `h` (height 0..1) and `v` (albedo variation 0..1). */
  build(h: Float32Array, v: Float32Array, size: number, seed: number): void
  roughness: [number, number]
  metalness: number
  normalScale: number
  /** Extra colour treatment applied per-pixel after the base/alt mix. */
  tint?(r: number, g: number, b: number, h: number, v: number): [number, number, number]
}

const hex = (n: number): [number, number, number] => [
  ((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255,
]

const RECIPES: Record<MaterialPreset, Recipe> = {
  concrete: {
    base: hex(0x8a8985), alt: hex(0x6d6c68), roughness: [0.72, 0.96], metalness: 0, normalScale: 1.1,
    build(h, v, size, seed) {
      const agg = new Float32Array(h.length)
      fbm(h, size, 4, 6, seed)
      worley(agg, size, 26, seed + 11)
      contrast(agg, 0.05, 0.55)
      mixBuf(h, agg, 0.45)
      const blotch = new Float32Array(h.length)
      fbm(blotch, size, 2, 4, seed + 77)
      v.set(blotch)
      normalise(v)
    },
  },
  polishedConcrete: {
    base: hex(0x9a9a97), alt: hex(0x76767a), roughness: [0.18, 0.42], metalness: 0, normalScale: 0.4,
    build(h, v, size, seed) {
      const agg = new Float32Array(h.length)
      fbm(h, size, 6, 5, seed)
      worley(agg, size, 34, seed + 3)
      contrast(agg, 0.1, 0.7)
      mixBuf(h, agg, 0.3)
      fbm(v, size, 3, 4, seed + 91)
      normalise(v)
    },
  },
  asphalt: {
    base: hex(0x3a3a3c), alt: hex(0x232325), roughness: [0.82, 0.99], metalness: 0, normalScale: 1.5,
    build(h, v, size, seed) {
      const agg = new Float32Array(h.length)
      worley(agg, size, 40, seed, 'f1')
      contrast(agg, 0.0, 0.45)
      fbm(h, size, 8, 6, seed + 5)
      mixBuf(h, agg, 0.62)
      fbm(v, size, 3, 3, seed + 44)
      normalise(v)
    },
  },
  brushedMetal: {
    base: hex(0xb9bec6), alt: hex(0x8d949d), roughness: [0.16, 0.46], metalness: 1, normalScale: 0.55,
    build(h, v, size, seed) {
      streaks(h, size, 'x', 160, 0.004, seed)
      const broad = new Float32Array(h.length)
      fbm(broad, size, 3, 4, seed + 17)
      mixBuf(h, broad, 0.35)
      v.set(broad)
      normalise(v)
    },
  },
  paintedMetal: {
    base: hex(0x4d5a68), alt: hex(0x2e3844), roughness: [0.34, 0.62], metalness: 0.15, normalScale: 0.5,
    build(h, v, size, seed) {
      fbm(h, size, 5, 4, seed)
      const chips = new Float32Array(h.length)
      worley(chips, size, 12, seed + 8, 'f2f1')
      contrast(chips, 0.72, 0.95)
      for (let i = 0; i < h.length; i++) h[i] = Math.max(h[i] * 0.35, chips[i])
      v.set(chips)
    },
  },
  darkSteel: {
    base: hex(0x33383f), alt: hex(0x1b1f24), roughness: [0.28, 0.55], metalness: 0.95, normalScale: 0.6,
    build(h, v, size, seed) {
      streaks(h, size, 'y', 90, 0.012, seed)
      const grime = new Float32Array(h.length)
      fbm(grime, size, 4, 5, seed + 23)
      mixBuf(h, grime, 0.5)
      v.set(grime)
      normalise(v)
    },
  },
  rustedSteel: {
    base: hex(0x6b4a33), alt: hex(0x35393d), roughness: [0.55, 0.95], metalness: 0.7, normalScale: 1.3,
    build(h, v, size, seed) {
      fbm(h, size, 6, 6, seed)
      const bloom = new Float32Array(h.length)
      worley(bloom, size, 9, seed + 61, 'f1')
      contrast(bloom, 0.15, 0.75)
      mixBuf(h, bloom, 0.45)
      v.set(bloom)
      for (let i = 0; i < v.length; i++) v[i] = 1 - v[i]
    },
  },
  marble: {
    base: hex(0xe8e6e1), alt: hex(0x6f7278), roughness: [0.08, 0.26], metalness: 0, normalScale: 0.25,
    build(h, v, size, seed) {
      const vein = new Float32Array(h.length)
      worley(vein, size, 5, seed, 'f2f1')
      contrast(vein, 0.0, 0.22)
      for (let i = 0; i < vein.length; i++) vein[i] = 1 - vein[i]
      const warp = new Float32Array(h.length)
      fbm(warp, size, 4, 5, seed + 13)
      mixBuf(vein, warp, 0.28)
      contrast(vein, 0.45, 0.9)
      v.set(vein)
      fbm(h, size, 8, 4, seed + 31)
      mixBuf(h, vein, 0.25)
    },
  },
  wornWood: {
    base: hex(0x8a5f3c), alt: hex(0x4e341f), roughness: [0.42, 0.78], metalness: 0, normalScale: 0.9,
    build(h, v, size, seed) {
      streaks(h, size, 'x', 40, 0.05, seed)
      const knots = new Float32Array(h.length)
      worley(knots, size, 4, seed + 29, 'f1')
      contrast(knots, 0.0, 0.35)
      mulBuf(h, knots)
      normalise(h)
      v.set(h)
    },
  },
  plywood: {
    base: hex(0xc09a6b), alt: hex(0x8a6b45), roughness: [0.55, 0.82], metalness: 0, normalScale: 0.7,
    build(h, v, size, seed) {
      streaks(h, size, 'x', 56, 0.03, seed)
      const chip = new Float32Array(h.length)
      fbm(chip, size, 20, 4, seed + 3)
      mixBuf(h, chip, 0.4)
      v.set(chip)
      normalise(v)
    },
  },
  rubberFloor: {
    base: hex(0x2b2f33), alt: hex(0x1a1d20), roughness: [0.68, 0.9], metalness: 0, normalScale: 1.0,
    build(h, v, size, seed) {
      // Studded rubber: a regular dot lattice softened by wear.
      worley(h, size, 18, seed, 'f1')
      contrast(h, 0.15, 0.55)
      for (let i = 0; i < h.length; i++) h[i] = 1 - h[i]
      const wear = new Float32Array(h.length)
      fbm(wear, size, 3, 4, seed + 55)
      mixBuf(h, wear, 0.25)
      v.set(wear)
      normalise(v)
    },
  },
  carpet: {
    base: hex(0x4a3f4d), alt: hex(0x2d2632), roughness: [0.9, 1.0], metalness: 0, normalScale: 1.4,
    build(h, v, size, seed) {
      fbm(h, size, 48, 3, seed)
      const patch = new Float32Array(h.length)
      fbm(patch, size, 3, 3, seed + 9)
      mixBuf(h, patch, 0.2)
      v.set(patch)
      normalise(v)
    },
  },
  fabric: {
    base: hex(0x6b5f56), alt: hex(0x453c36), roughness: [0.78, 0.96], metalness: 0, normalScale: 1.0,
    build(h, v, size, seed) {
      const warp = new Float32Array(h.length)
      const weft = new Float32Array(h.length)
      streaks(warp, size, 'x', size >> 1, 0.002, seed)
      streaks(weft, size, 'y', size >> 1, 0.002, seed + 1)
      for (let i = 0; i < h.length; i++) h[i] = Math.max(warp[i], weft[i])
      fbm(v, size, 4, 3, seed + 77)
      normalise(v)
    },
  },
  plaster: {
    base: hex(0xb5b0a8), alt: hex(0x8e8981), roughness: [0.68, 0.92], metalness: 0, normalScale: 0.8,
    build(h, v, size, seed) {
      fbm(h, size, 10, 5, seed)
      const trowel = new Float32Array(h.length)
      streaks(trowel, size, 'y', 8, 0.22, seed + 41)
      mixBuf(h, trowel, 0.22)
      fbm(v, size, 2, 3, seed + 8)
      normalise(v)
    },
  },
  drywall: {
    base: hex(0xd6d2ca), alt: hex(0xb3aea6), roughness: [0.74, 0.94], metalness: 0, normalScale: 0.45,
    build(h, v, size, seed) {
      fbm(h, size, 16, 4, seed)
      fbm(v, size, 2, 3, seed + 12)
      normalise(v)
    },
  },
  glassPanel: {
    base: hex(0x8fb4c9), alt: hex(0x4d6b7d), roughness: [0.02, 0.14], metalness: 0.1, normalScale: 0.2,
    build(h, v, size, seed) {
      fbm(h, size, 3, 3, seed)
      const smear = new Float32Array(h.length)
      streaks(smear, size, 'y', 14, 0.08, seed + 5)
      mixBuf(h, smear, 0.35)
      v.set(smear)
      normalise(v)
    },
  },
  carbonFibre: {
    base: hex(0x22242a), alt: hex(0x0f1013), roughness: [0.18, 0.42], metalness: 0.4, normalScale: 0.7,
    build(h, v, size, seed) {
      // 2x2 twill: alternating tow direction in a checker of blocks.
      const warp = new Float32Array(h.length)
      const weft = new Float32Array(h.length)
      streaks(warp, size, 'x', size >> 1, 0.001, seed)
      streaks(weft, size, 'y', size >> 1, 0.001, seed + 1)
      const block = size / 16
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = y * size + x
          const cell = (Math.floor(x / block) + Math.floor(y / block)) & 1
          h[i] = cell ? warp[i] : weft[i]
        }
      }
      v.set(h)
    },
  },
  perforatedMetal: {
    base: hex(0x565d66), alt: hex(0x1d2126), roughness: [0.3, 0.55], metalness: 0.9, normalScale: 1.6,
    build(h, v, size, seed) {
      worley(h, size, 22, seed, 'f1')
      contrast(h, 0.1, 0.34)
      v.set(h)
      const grime = new Float32Array(h.length)
      fbm(grime, size, 4, 4, seed + 6)
      mixBuf(v, grime, 0.4)
    },
  },
  cardboard: {
    base: hex(0xa8865c), alt: hex(0x7b6142), roughness: [0.8, 0.97], metalness: 0, normalScale: 0.9,
    build(h, v, size, seed) {
      streaks(h, size, 'y', 48, 0.006, seed)
      const fibres = new Float32Array(h.length)
      fbm(fibres, size, 30, 3, seed + 2)
      mixBuf(h, fibres, 0.45)
      fbm(v, size, 3, 3, seed + 19)
      normalise(v)
    },
  },
  whiteboard: {
    base: hex(0xf2f3f1), alt: hex(0xd3d8d6), roughness: [0.06, 0.2], metalness: 0, normalScale: 0.15,
    build(h, v, size, seed) {
      fbm(h, size, 6, 3, seed)
      // Ghosted marker residue that never quite wipes off.
      const ghost = new Float32Array(h.length)
      streaks(ghost, size, 'x', 10, 0.3, seed + 71)
      contrast(ghost, 0.6, 0.95)
      v.set(ghost)
    },
  },
}

// ---------------------------------------------------------------------------

function heightToNormal(h: Float32Array, size: number, strength: number): ImageData {
  const img = new ImageData(size, size)
  const d = img.data
  for (let y = 0; y < size; y++) {
    const yn = ((y - 1) + size) % size
    const yp = (y + 1) % size
    for (let x = 0; x < size; x++) {
      const xn = ((x - 1) + size) % size
      const xp = (x + 1) % size
      // Sobel over the wrapped height field keeps the normal map tileable.
      const tl = h[yn * size + xn], t = h[yn * size + x], tr = h[yn * size + xp]
      const l = h[y * size + xn], r = h[y * size + xp]
      const bl = h[yp * size + xn], b = h[yp * size + x], br = h[yp * size + xp]
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl)
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr)
      let nx = -dx * strength
      let ny = -dy * strength
      const nz = 1
      const inv = 1 / Math.hypot(nx, ny, nz)
      nx *= inv; ny *= inv
      const i = (y * size + x) * 4
      d[i] = (nx * 0.5 + 0.5) * 255
      d[i + 1] = (ny * 0.5 + 0.5) * 255
      d[i + 2] = (nz * inv * 0.5 + 0.5) * 255
      d[i + 3] = 255
    }
  }
  return img
}

/**
 * Cheap cavity AO: a surface point is occluded in proportion to how far it sits
 * below its local neighbourhood average. Two blur radii give both broad and
 * tight contact darkening.
 */
function heightToAO(h: Float32Array, size: number): ImageData {
  const wide = boxBlurWrap(h, size, Math.max(2, size >> 6))
  const tight = boxBlurWrap(h, size, 2)
  const img = new ImageData(size, size)
  const d = img.data
  for (let i = 0; i < h.length; i++) {
    const broad = Math.min(1, Math.max(0, 0.5 + (h[i] - wide[i]) * 2.2))
    const cavity = Math.min(1, Math.max(0, 0.5 + (h[i] - tight[i]) * 3.4))
    const ao = Math.min(1, Math.max(0, 0.35 + 0.65 * (broad * 0.55 + cavity * 0.45)))
    const c = ao * 255
    const j = i * 4
    d[j] = c; d[j + 1] = c; d[j + 2] = c; d[j + 3] = 255
  }
  return img
}

/** Separable box blur with wrap-around addressing (keeps textures tileable). */
function boxBlurWrap(src: Float32Array, size: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const norm = 1 / (radius * 2 + 1)
  for (let y = 0; y < size; y++) {
    const row = y * size
    for (let x = 0; x < size; x++) {
      let s = 0
      for (let k = -radius; k <= radius; k++) s += src[row + (((x + k) % size) + size) % size]
      tmp[row + x] = s * norm
    }
  }
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      let s = 0
      for (let k = -radius; k <= radius; k++) s += tmp[((((y + k) % size) + size) % size) * size + x]
      out[y * size + x] = s * norm
    }
  }
  return out
}

function toTexture(img: ImageData, srgb: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  c.getContext('2d')!.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.needsUpdate = true
  return t
}

const cache = new Map<string, MapSet>()
const disposables: THREE.Texture[] = []

/**
 * Bake (or fetch from cache) a full PBR map set for a preset.
 * `size` 256 is plenty for surfaces seen at fighting-game distance; 512 for
 * hero surfaces the camera pushes into.
 */
export function bakeMaterial(preset: MaterialPreset, seed = 1, size = 256): MapSet {
  const key = `${preset}:${seed}:${size}`
  const hit = cache.get(key)
  if (hit) return hit

  const r = RECIPES[preset]
  const n = size * size
  const h = new Float32Array(n)
  const v = new Float32Array(n)
  r.build(h, v, size, seed)
  normalise(h)

  const albedo = new ImageData(size, size)
  const rough = new ImageData(size, size)
  const metal = r.metalness > 0 && r.metalness < 1 ? new ImageData(size, size) : null
  const ad = albedo.data
  const rd = rough.data
  const md = metal?.data
  const [br, bg, bb] = r.base
  const [ar, ag, ab] = r.alt
  const [r0, r1] = r.roughness
  const grain = rng(seed + 4242)

  for (let i = 0; i < n; i++) {
    const t = v[i]
    let cr = br + (ar - br) * t
    let cg = bg + (ag - bg) * t
    let cb = bb + (ab - bb) * t
    // Height modulates local brightness so crevices read darker than peaks even
    // before any lighting is applied.
    const shade = 0.78 + h[i] * 0.34
    cr *= shade; cg *= shade; cb *= shade
    // A touch of per-texel grain stops large flat areas from banding.
    const g = 1 + (grain() - 0.5) * 0.035
    if (r.tint) {
      const [tr, tg, tb] = r.tint(cr, cg, cb, h[i], t)
      cr = tr; cg = tg; cb = tb
    }
    const j = i * 4
    ad[j] = Math.min(255, cr * g * 255)
    ad[j + 1] = Math.min(255, cg * g * 255)
    ad[j + 2] = Math.min(255, cb * g * 255)
    ad[j + 3] = 255

    // Rough where the surface is worn/low, smoother on raised polished areas.
    const rv = r0 + (r1 - r0) * (1 - h[i] * 0.7 - t * 0.3)
    const rc = Math.min(255, Math.max(0, rv * 255))
    rd[j] = rc; rd[j + 1] = rc; rd[j + 2] = rc; rd[j + 3] = 255

    if (md) {
      // Metal is knocked back wherever paint/dirt sits on top.
      const mv = r.metalness * (1 - t * 0.85)
      const mc = Math.min(255, Math.max(0, mv * 255))
      md[j] = mc; md[j + 1] = mc; md[j + 2] = mc; md[j + 3] = 255
    }
  }

  const set: MapSet = {
    map: toTexture(albedo, true),
    roughnessMap: toTexture(rough, false),
    normalMap: toTexture(heightToNormal(h, size, 6 * r.normalScale), false),
    aoMap: toTexture(heightToAO(h, size), false),
    metalnessMap: metal ? toTexture(metal, false) : undefined,
    defaults: {
      roughness: (r0 + r1) * 0.5,
      metalness: r.metalness,
      normalScale: r.normalScale,
      color: 0xffffff,
    },
  }
  for (const t of [set.map, set.roughnessMap, set.normalMap, set.aoMap, set.metalnessMap]) {
    if (t) disposables.push(t)
  }
  cache.set(key, set)
  return set
}

export interface SurfaceOptions {
  /** Texture repeats across the mapped surface. */
  repeat?: number | [number, number]
  seed?: number
  size?: number
  /** Multiplied over the baked albedo — use for per-stage colour scripting. */
  color?: THREE.ColorRepresentation
  roughness?: number
  metalness?: number
  normalScale?: number
  aoIntensity?: number
  emissive?: THREE.ColorRepresentation
  emissiveIntensity?: number
  envMapIntensity?: number
  transparent?: boolean
  opacity?: number
  side?: THREE.Side
}

/**
 * The one call a stage author needs: a fully textured MeshStandardMaterial.
 *
 *   mesh.material = surface('concrete', { repeat: 6, color: 0x9aa3ad })
 *
 * Remember `aoMap` requires a second UV set; `applyAoUv(geometry)` copies uv→uv1
 * for you.
 */
export function surface(preset: MaterialPreset, opts: SurfaceOptions = {}): THREE.MeshStandardMaterial {
  const set = bakeMaterial(preset, opts.seed ?? 1, opts.size ?? 256)
  const rep = opts.repeat ?? 1
  const [rx, ry] = Array.isArray(rep) ? rep : [rep, rep]

  // Textures are shared via the cache, so clone before changing repeat.
  const map = set.map.clone(); map.needsUpdate = true
  const roughnessMap = set.roughnessMap.clone(); roughnessMap.needsUpdate = true
  const normalMap = set.normalMap.clone(); normalMap.needsUpdate = true
  const aoMap = set.aoMap.clone(); aoMap.needsUpdate = true
  const metalnessMap = set.metalnessMap?.clone()
  if (metalnessMap) metalnessMap.needsUpdate = true

  for (const t of [map, roughnessMap, normalMap, aoMap, metalnessMap]) {
    if (!t) continue
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.RepeatWrapping
    t.repeat.set(rx, ry)
  }

  const m = new THREE.MeshStandardMaterial({
    map,
    roughnessMap,
    normalMap,
    aoMap,
    metalnessMap,
    color: opts.color ?? set.defaults.color,
    roughness: opts.roughness ?? set.defaults.roughness,
    metalness: opts.metalness ?? set.defaults.metalness,
    aoMapIntensity: opts.aoIntensity ?? 1,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    envMapIntensity: opts.envMapIntensity ?? 1,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
  })
  const ns = opts.normalScale ?? set.defaults.normalScale
  m.normalScale.set(ns, ns)
  return m
}

/** `aoMap` samples uv1. Call this once on any geometry you give an AO map. */
export function applyAoUv(geo: THREE.BufferGeometry) {
  if (!geo.getAttribute('uv1') && geo.getAttribute('uv')) {
    geo.setAttribute('uv1', geo.getAttribute('uv'))
  }
  return geo
}

export function disposeMaterialCache() {
  for (const t of disposables) t.dispose()
  disposables.length = 0
  cache.clear()
}
