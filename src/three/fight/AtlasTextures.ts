import * as THREE from 'three'
import { conditionAlbedoAlpha } from './edgeAlpha'

/**
 * Turns a packed sprite atlas image into the three maps the fighter material
 * needs: a clean albedo, a synthesised tangent-space normal, and a height
 * field. This is adapted from core/AssetCache's per-sprite pipeline but built
 * for a *packed atlas* (many frames in one image) and hardened against the two
 * things that read as amateur work on generated sprites:
 *
 *  1. Halo fringing. A feathered or antialiased silhouette edge is partially
 *     transparent, and straight-alpha blending shows whatever RGB sits under
 *     that partial alpha. On these sprites that RGB is the flat backdrop, so
 *     every character ships with a pale ring. The fix here is to *dilate* the
 *     silhouette's own colour outward into the transparent margin before the
 *     edge is feathered, so the half-transparent ring is tinted with skin/cloth
 *     instead of backdrop. No premultiply games, no ring.
 *
 *  2. Cross-frame bleed. Normals are derived only inside each silhouette (the
 *     background is hard-zeroed), so as long as frames don't touch, one frame's
 *     derivative never leaks into its neighbour.
 *
 * The silhouette edge itself is conditioned by ./edgeAlpha, shared verbatim with
 * the offline edge probe so the two cannot disagree about what ships on screen.
 */

export interface AtlasTextureSet {
  albedo: THREE.Texture
  normal: THREE.Texture
  height: THREE.Texture
  width: number
  height_px: number
  /**
   * The conditioned silhouette coverage, atlas-sized, row 0 = top (flipY is off
   * on the uploads, so this indexes identically to the sampled texture). 0 =
   * background, non-zero = inside the character. The contact-shadow anchoring in
   * Fighter reads the bottom band of each frame's silhouette from this to find
   * the real ground-contact points (feet, and hands/knees/torso on a knockdown),
   * so the shadow's dark cores land under the soles instead of in the stance gap.
   */
  mask: Uint8Array
}

export type AtlasSource = HTMLImageElement | HTMLCanvasElement

// ---------------------------------------------------------------------------
// Texture-memory policy — the single source of truth for what each map costs
// ---------------------------------------------------------------------------
//
// The albedo is the character's *art* and stays a full-resolution RGBA image so
// the baked coverage-AA ramp (see edgeAlpha) is preserved byte-for-byte. The
// other two maps are *synthesised* from that albedo — a tangent normal and a
// height/AO field — and are low-frequency by construction (chamfer distance +
// blurred luma). Shipping them as mipmapped full-res RGBA was the VRAM blocker:
// three atlas-sized RGBA maps + mipmaps = ~544 MB for lenny alone, ~1.09 GB for
// a two-lenny match, which hard-fails a 4 GB card before the stage even loads.
//
// So the derived maps drop to the format their data actually needs:
//   - normal: two channels (RG8); the shader reconstructs z = sqrt(1-x²-y²).
//   - height: one channel (R8).
// and to half resolution, which is invisible on a field this smooth but quarters
// the texel count. Net per-fighter cost falls ~2.5× (lenny 544 → ~215 MB) with
// zero change to the albedo or its edge.
//
// `residentBytesForAtlas` and `buildAtlasTextures` both read THIS object, so the
// budget gate cannot drift from what actually uploads (same discipline as
// footAnchorX / edgeAlpha): change the policy and both the estimate and the real
// upload move together.
export const ATLAS_MAP_POLICY = {
  albedo: { downscale: 1, bytesPerTexel: 4, mipmap: true },
  normal: { downscale: 2, bytesPerTexel: 2, mipmap: true },
  height: { downscale: 2, bytesPerTexel: 1, mipmap: true },
} as const

/** Downscale applied to the synthesised normal/height maps. */
export const DERIVED_MAP_DOWNSCALE = ATLAS_MAP_POLICY.normal.downscale

/** A full mip chain adds 1/3 to a texture's base footprint. */
const MIP_MULTIPLIER = 4 / 3

/**
 * Resident GPU bytes for one fighter's three maps at native atlas size `w`×`h`,
 * under {@link ATLAS_MAP_POLICY}. This is exactly what the runtime uploads — the
 * budget test asserts against it, and a mutation that reverts the policy to
 * 3× RGBA is caught because this number moves with it.
 */
export function residentBytesForAtlas(w: number, h: number): number {
  let total = 0
  for (const m of Object.values(ATLAS_MAP_POLICY)) {
    const mw = Math.ceil(w / m.downscale)
    const mh = Math.ceil(h / m.downscale)
    total += mw * mh * m.bytesPerTexel * (m.mipmap ? MIP_MULTIPLIER : 1)
  }
  return total
}

export interface DerivedMap {
  data: Uint8Array
  width: number
  height: number
}

export function buildAtlasTextures(src: AtlasSource, anisotropy = 8): AtlasTextureSet {
  const w = src instanceof HTMLImageElement ? src.naturalWidth : src.width
  const h = src instanceof HTMLImageElement ? src.naturalHeight : src.height

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(src, 0, 0)

  const image = ctx.getImageData(0, 0, w, h)
  const px = image.data

  // ---- 1-3. Silhouette edge conditioning (mask, halo dilate, edge alpha) ----
  // Preserves a baked coverage-AA ramp when the atlas carries one; chroma-keys
  // and feathers otherwise. Shared with scripts/lib/atlas-quality so the probe
  // measures this exact transform.
  const { mask, lum } = conditionAlbedoAlpha(px, w, h)
  ctx.putImageData(image, 0, 0)

  // ---- 4-6. Synthesised normal + height, at the reduced format the data needs.
  const { normal: nMap, height: hMap } = buildDerivedMaps(mask, lum, w, h)

  const albedo = new THREE.CanvasTexture(canvas)
  albedo.colorSpace = THREE.SRGBColorSpace
  const normal = new THREE.DataTexture(
    nMap.data, nMap.width, nMap.height, THREE.RGFormat, THREE.UnsignedByteType,
  )
  normal.colorSpace = THREE.NoColorSpace
  const heightTex = new THREE.DataTexture(
    hMap.data, hMap.width, hMap.height, THREE.RedFormat, THREE.UnsignedByteType,
  )
  heightTex.colorSpace = THREE.NoColorSpace

  for (const t of [albedo, normal, heightTex]) {
    t.anisotropy = anisotropy
    t.wrapS = THREE.ClampToEdgeWrapping
    t.wrapT = THREE.ClampToEdgeWrapping
    // The sprite vertex shader maps the head to v = 0, which is only correct
    // for an unflipped upload. Three defaults CanvasTexture to flipY = true, and
    // the derived DataTextures are authored top-row-first to match, so both are
    // pinned to flipY = false; otherwise every frame samples upside down.
    t.flipY = false
    // R8/RG8 rows aren't guaranteed 4-byte aligned; read them tightly packed.
    t.unpackAlignment = 1
    t.generateMipmaps = true
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.magFilter = THREE.LinearFilter
    t.needsUpdate = true
  }

  return { albedo, normal, height: heightTex, width: w, height_px: h, mask }
}

/**
 * Synthesises the tangent-normal and height/AO maps from the conditioned
 * silhouette, returning them at {@link DERIVED_MAP_DOWNSCALE} resolution in the
 * packed format {@link ATLAS_MAP_POLICY} declares (normal = RG8, height = R8).
 *
 * Pure (no DOM, no THREE) so the reduction is unit-testable without a canvas:
 * the honoring test calls this and asserts the output is half-size and 2-/1-byte
 * per texel, which — together with the budget test reading the same policy —
 * makes the VRAM gate impossible to satisfy while the real upload regresses.
 *
 * The normal is computed at full resolution (so its character matches the old
 * full-res map exactly) and then box-downsampled and renormalised, rather than
 * re-deriving a Sobel at half res with a fudged strength — the lighting sculpt
 * is visually the old map, just at half the texel count.
 */
export function buildDerivedMaps(
  mask: Uint8Array,
  lum: Float32Array,
  w: number,
  h: number,
): { normal: DerivedMap; height: DerivedMap } {
  const n = w * h

  // Height field: rounded body volume (chamfer distance) + surface detail.
  const dist = chamferDistance(mask, w, h)
  let maxDist = 0
  for (let i = 0; i < n; i++) if (dist[i] > maxDist) maxDist = dist[i]
  const invMax = maxDist > 0 ? 1 / maxDist : 0
  const blurLum = boxBlur(lum, w, h, 3)
  const height = new Float32Array(n)
  for (let p = 0; p < n; p++) {
    if (mask[p] === 0) { height[p] = 0; continue }
    const volume = Math.sqrt(Math.min(1, dist[p] * invMax * 2.2))
    const detail = (lum[p] - blurLum[p]) * 0.55
    height[p] = clamp01(volume * 0.86 + 0.14 + detail)
  }
  const heightSmooth = boxBlur(height, w, h, 2)

  // Full-res tangent normal (Sobel of the height field), kept as unit vectors.
  const nxF = new Float32Array(n)
  const nyF = new Float32Array(n)
  const nzF = new Float32Array(n)
  const strength = 2.6 * (w / 1024)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (mask[p] === 0) { nxF[p] = 0; nyF[p] = 0; nzF[p] = 1; continue }
      const l = heightSmooth[p - (x > 0 ? 1 : 0)]
      const r = heightSmooth[p + (x < w - 1 ? 1 : 0)]
      const u = heightSmooth[p - (y > 0 ? w : 0)]
      const d = heightSmooth[p + (y < h - 1 ? w : 0)]
      const dx = (l - r) * strength
      const dy = (u - d) * strength
      const len = Math.hypot(dx, dy, 1)
      nxF[p] = dx / len
      nyF[p] = dy / len
      nzF[p] = 1 / len
    }
  }

  // Downsample to the shipped resolution: average each block, renormalise the
  // normal, and encode (nx, ny) → RG, height → R.
  const ds = DERIVED_MAP_DOWNSCALE
  const w2 = Math.ceil(w / ds)
  const h2 = Math.ceil(h / ds)
  const normalData = new Uint8Array(w2 * h2 * 2)
  const heightData = new Uint8Array(w2 * h2)
  for (let y2 = 0; y2 < h2; y2++) {
    for (let x2 = 0; x2 < w2; x2++) {
      let ax = 0, ay = 0, az = 0, ah = 0, c = 0
      for (let by = 0; by < ds; by++) {
        const yy = y2 * ds + by
        if (yy >= h) continue
        for (let bx = 0; bx < ds; bx++) {
          const xx = x2 * ds + bx
          if (xx >= w) continue
          const p = yy * w + xx
          ax += nxF[p]; ay += nyF[p]; az += nzF[p]; ah += heightSmooth[p]; c++
        }
      }
      if (c > 0) { ax /= c; ay /= c; az /= c; ah /= c }
      else { az = 1 }
      const len = Math.hypot(ax, ay, az) || 1
      const q2 = y2 * w2 + x2
      normalData[q2 * 2] = Math.round(((ax / len) * 0.5 + 0.5) * 255)
      normalData[q2 * 2 + 1] = Math.round(((ay / len) * 0.5 + 0.5) * 255)
      heightData[q2] = Math.round(clamp01(ah) * 255)
    }
  }

  return {
    normal: { data: normalData, width: w2, height: h2 },
    height: { data: heightData, width: w2, height: h2 },
  }
}

// ---------------------------------------------------------------------------
// Image ops

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function chamferDistance(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9
  const d = new Float32Array(w * h)
  for (let p = 0; p < d.length; p++) d[p] = mask[p] === 0 ? 0 : INF
  const A = 1, B = 1.41421356
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (d[p] === 0) continue
      let v = d[p]
      if (y > 0) {
        if (x > 0) v = Math.min(v, d[p - w - 1] + B)
        v = Math.min(v, d[p - w] + A)
        if (x < w - 1) v = Math.min(v, d[p - w + 1] + B)
      }
      if (x > 0) v = Math.min(v, d[p - 1] + A)
      d[p] = v
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x
      if (d[p] === 0) continue
      let v = d[p]
      if (y < h - 1) {
        if (x < w - 1) v = Math.min(v, d[p + w + 1] + B)
        v = Math.min(v, d[p + w] + A)
        if (x > 0) v = Math.min(v, d[p + w - 1] + B)
      }
      if (x < w - 1) v = Math.min(v, d[p + 1] + A)
      d[p] = v
    }
  }
  return d
}

function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  if (radius <= 0) return src.slice()
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const norm = 1 / (radius * 2 + 1)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let acc = 0
    for (let x = -radius; x <= radius; x++) acc += src[row + clampi(x, 0, w - 1)]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * norm
      acc -= src[row + clampi(x - radius, 0, w - 1)]
      acc += src[row + clampi(x + radius + 1, 0, w - 1)]
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -radius; y <= radius; y++) acc += tmp[clampi(y, 0, h - 1) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc * norm
      acc -= tmp[clampi(y - radius, 0, h - 1) * w + x]
      acc += tmp[clampi(y + radius + 1, 0, h - 1) * w + x]
    }
  }
  return out
}

function clampi(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v
}
