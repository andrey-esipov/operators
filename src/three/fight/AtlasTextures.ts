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
  const n = w * h

  // ---- 1-3. Silhouette edge conditioning (mask, halo dilate, edge alpha) ----
  // Preserves a baked coverage-AA ramp when the atlas carries one; chroma-keys
  // and feathers otherwise. Shared with scripts/lib/atlas-quality so the probe
  // measures this exact transform.
  const { mask, lum } = conditionAlbedoAlpha(px, w, h)
  ctx.putImageData(image, 0, 0)

  // ---- 4. Height field: rounded body volume + surface detail ---------------
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

  // ---- 5. Normal map (Sobel of the height field) ---------------------------
  const normalCanvas = document.createElement('canvas')
  normalCanvas.width = w
  normalCanvas.height = h
  const nctx = normalCanvas.getContext('2d')!
  const nimg = nctx.createImageData(w, h)
  const nd = nimg.data
  const strength = 2.6 * (w / 1024)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const i = p * 4
      if (mask[p] === 0) {
        nd[i] = 128; nd[i + 1] = 128; nd[i + 2] = 255; nd[i + 3] = 255
        continue
      }
      const l = heightSmooth[p - (x > 0 ? 1 : 0)]
      const r = heightSmooth[p + (x < w - 1 ? 1 : 0)]
      const u = heightSmooth[p - (y > 0 ? w : 0)]
      const d = heightSmooth[p + (y < h - 1 ? w : 0)]
      const dx = (l - r) * strength
      const dy = (u - d) * strength
      const len = Math.hypot(dx, dy, 1)
      nd[i] = Math.round(((dx / len) * 0.5 + 0.5) * 255)
      nd[i + 1] = Math.round(((dy / len) * 0.5 + 0.5) * 255)
      nd[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255)
      nd[i + 3] = 255
    }
  }
  nctx.putImageData(nimg, 0, 0)

  // ---- 6. Height texture (R = height) --------------------------------------
  const heightCanvas = document.createElement('canvas')
  heightCanvas.width = w
  heightCanvas.height = h
  const hctx = heightCanvas.getContext('2d')!
  const himg = hctx.createImageData(w, h)
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const v = Math.round(clamp01(heightSmooth[p]) * 255)
    himg.data[i] = v; himg.data[i + 1] = v; himg.data[i + 2] = v; himg.data[i + 3] = 255
  }
  hctx.putImageData(himg, 0, 0)

  const albedo = new THREE.CanvasTexture(canvas)
  albedo.colorSpace = THREE.SRGBColorSpace
  const normal = new THREE.CanvasTexture(normalCanvas)
  normal.colorSpace = THREE.NoColorSpace
  const heightTex = new THREE.CanvasTexture(heightCanvas)
  heightTex.colorSpace = THREE.NoColorSpace

  for (const t of [albedo, normal, heightTex]) {
    t.anisotropy = anisotropy
    t.wrapS = THREE.ClampToEdgeWrapping
    t.wrapT = THREE.ClampToEdgeWrapping
    // The sprite vertex shader maps the head to v = 0, which is only correct
    // for an unflipped upload. Three defaults CanvasTexture to flipY = true,
    // so leaving this alone samples every frame upside down.
    t.flipY = false
    t.generateMipmaps = true
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.magFilter = THREE.LinearFilter
    t.needsUpdate = true
  }

  return { albedo, normal, height: heightTex, width: w, height_px: h, mask }
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
