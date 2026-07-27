import * as THREE from 'three'

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
 */

export interface AtlasTextureSet {
  albedo: THREE.Texture
  normal: THREE.Texture
  height: THREE.Texture
  width: number
  height_px: number
}

export type AtlasSource = HTMLImageElement | HTMLCanvasElement

/** gpt-image-2 renders on a flat neutral grey; used when a frame has no alpha. */
function isBackdrop(r: number, g: number, b: number): boolean {
  const nearMid = Math.abs(r - 128) < 32 && Math.abs(g - 128) < 32 && Math.abs(b - 128) < 32
  const neutral = Math.abs(r - g) < 16 && Math.abs(g - b) < 16 && Math.abs(r - b) < 16
  return nearMid && neutral
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
  const n = w * h

  // ---- 1. Resolve a hard alpha mask + collect luminance --------------------
  // Prefer the source's own alpha when it actually carries a silhouette; fall
  // back to chroma-keying the grey backdrop otherwise.
  let alphaCarriers = 0
  for (let i = 3; i < px.length; i += 4) if (px[i] < 250) alphaCarriers++
  const useNativeAlpha = alphaCarriers > n * 0.02

  const mask = new Uint8Array(n)
  const lum = new Float32Array(n)
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3]
    const solid = useNativeAlpha ? a > 128 : !isBackdrop(r, g, b)
    mask[p] = solid ? 255 : 0
    lum[p] = solid ? (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 : 0
  }

  despeckle(mask, w, h)

  // ---- 2. Dilate silhouette RGB into the transparent margin ----------------
  // Grow the interior colour a few pixels past the silhouette. The feather in
  // step 3 then blends onto the character's own edge colour rather than the
  // backdrop, which is what removes the halo. We keep the ORIGINAL mask for
  // alpha; this only rewrites colour under (soon-to-be) transparent pixels.
  dilateColor(px, mask, w, h, 4)

  // ---- 3. Feather the silhouette edge (1px) for a clean antialias ----------
  const soft = featherAlpha(mask, w, h)
  for (let p = 0, i = 3; p < n; p++, i += 4) px[i] = soft[p]
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
    // Mipmaps on an atlas bleed neighbouring frames at high mip levels; the
    // frames sit on their own generous gutters, and we sample near-native
    // resolution, so a linear (non-mip) magnify keeps the cel edge crisp
    // without cross-frame smear.
    t.generateMipmaps = true
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.magFilter = THREE.LinearFilter
    t.needsUpdate = true
  }

  return { albedo, normal, height: heightTex, width: w, height_px: h }
}

// ---------------------------------------------------------------------------
// Image ops

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function despeckle(mask: Uint8Array, w: number, h: number) {
  const src = mask.slice()
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      let c = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          if (src[p + dy * w + dx] !== 0) c++
        }
      if (src[p] !== 0 && c <= 1) mask[p] = 0
      else if (src[p] === 0 && c >= 7) mask[p] = 255
    }
  }
}

/**
 * Grow opaque RGB outward into transparent pixels by `iters` rings. Each pass a
 * transparent pixel that borders coloured pixels adopts their average colour.
 * Alpha is untouched — this only pre-loads sensible colour under the feather.
 */
function dilateColor(px: Uint8ClampedArray, mask: Uint8Array, w: number, h: number, iters: number) {
  const filled = mask.slice()
  for (let it = 0; it < iters; it++) {
    const snapshot = filled.slice()
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x
        if (snapshot[p] !== 0) continue
        let r = 0, g = 0, b = 0, c = 0
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= h) continue
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            if (xx < 0 || xx >= w) continue
            const q = yy * w + xx
            if (snapshot[q] === 0) continue
            const qi = q * 4
            r += px[qi]; g += px[qi + 1]; b += px[qi + 2]; c++
          }
        }
        if (c > 0) {
          const i = p * 4
          px[i] = r / c; px[i + 1] = g / c; px[i + 2] = b / c
          filled[p] = 255
        }
      }
    }
  }
}

function featherAlpha(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (mask[p] !== 0) { out[p] = 255; continue }
      let c = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          if (mask[yy * w + xx] !== 0) c++
        }
      }
      out[p] = c >= 5 ? 175 : c >= 3 ? 96 : 0
    }
  }
  return out
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
