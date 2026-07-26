import * as THREE from 'three'
import type { AssetCacheLike, SpriteTextureSet } from '../types'

/**
 * Texture + derived-map cache.
 *
 * The interesting part is `spriteSet`: the fighter art is flat 2D PNG on a
 * flat grey background. To light it like a 2.5D fighter (SFVI / KOF XV) we
 * synthesise two extra maps at load time, entirely on the client:
 *
 *   height — a chamfer distance transform of the alpha silhouette (so the
 *            body reads as a rounded volume) blended with a high-pass of the
 *            albedo luminance (so folds, hair and fabric read as detail).
 *   normal — Sobel derivative of that height field, packed to tangent space.
 *
 * The result: a real per-pixel normal for art that never had one. Key/fill/rim
 * lights then wrap around the character and the stage lighting actually
 * affects them, which is 90% of why modern 2.5D fighters look expensive.
 */
export class AssetCache implements AssetCacheLike {
  private textures = new Map<string, Promise<THREE.Texture>>()
  private sprites = new Map<string, Promise<SpriteTextureSet>>()
  private anisotropy = 4
  private disposables: THREE.Texture[] = []
  private inflight = 0

  /** Number of texture/sprite loads still in flight (screenshot harness gate). */
  pending() { return this.inflight }

  private track<T>(p: Promise<T>): Promise<T> {
    this.inflight++
    return p.finally(() => { this.inflight-- })
  }

  constructor(renderer?: THREE.WebGLRenderer) {
    if (renderer) {
      this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    }
  }

  texture(url: string): Promise<THREE.Texture> {
    const hit = this.textures.get(url)
    if (hit) return hit
    const p = this.track(new Promise<THREE.Texture>((resolve, reject) => {
      new THREE.TextureLoader().load(
        url,
        (t) => {
          t.colorSpace = THREE.SRGBColorSpace
          t.anisotropy = this.anisotropy
          t.wrapS = THREE.ClampToEdgeWrapping
          t.wrapT = THREE.ClampToEdgeWrapping
          t.generateMipmaps = true
          t.minFilter = THREE.LinearMipmapLinearFilter
          t.magFilter = THREE.LinearFilter
          t.needsUpdate = true
          this.disposables.push(t)
          resolve(t)
        },
        undefined,
        reject,
      )
    }))
    this.textures.set(url, p)
    return p
  }

  spriteSet(url: string): Promise<SpriteTextureSet> {
    const hit = this.sprites.get(url)
    if (hit) return hit
    const p = this.track(
      buildSpriteSet(url, this.anisotropy).then((set) => {
        this.disposables.push(set.albedo, set.normal, set.height)
        return set
      }),
    )
    this.sprites.set(url, p)
    return p
  }

  dispose() {
    for (const t of this.disposables) t.dispose()
    this.disposables.length = 0
    this.textures.clear()
    this.sprites.clear()
  }
}

// ---------------------------------------------------------------------------

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`sprite load failed: ${url}`))
    img.src = url
  })
}

/**
 * Chroma-key threshold matched to the gpt-image-2 `#808080` prompt background.
 * A pixel is background when it is near-grey AND near-neutral (r≈g≈b).
 */
function isBackdrop(r: number, g: number, b: number): boolean {
  const nearMid = Math.abs(r - 128) < 30 && Math.abs(g - 128) < 30 && Math.abs(b - 128) < 30
  const neutral = Math.abs(r - g) < 14 && Math.abs(g - b) < 14 && Math.abs(r - b) < 14
  return nearMid && neutral
}

async function buildSpriteSet(url: string, anisotropy: number): Promise<SpriteTextureSet> {
  const img = await loadImage(url)
  const w = img.naturalWidth
  const h = img.naturalHeight

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, 0, 0)

  const image = ctx.getImageData(0, 0, w, h)
  const px = image.data

  // ---- 1. Chroma key → alpha, and collect luminance ------------------------
  const lum = new Float32Array(w * h)
  const alpha = new Uint8Array(w * h)
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    const r = px[i], g = px[i + 1], b = px[i + 2]
    if (isBackdrop(r, g, b)) {
      px[i + 3] = 0
      alpha[p] = 0
      lum[p] = 0
    } else {
      alpha[p] = 255
      lum[p] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    }
  }

  // ---- 2. Despeckle: drop 1px alpha islands + close pinholes ---------------
  despeckle(alpha, w, h)

  // ---- 3. Feather the alpha edge so the silhouette is not aliased ----------
  const softAlpha = featherAlpha(alpha, w, h)
  for (let p = 0, i = 3; p < softAlpha.length; p++, i += 4) {
    px[i] = softAlpha[p]
  }
  ctx.putImageData(image, 0, 0)

  // ---- 4. Height field ----------------------------------------------------
  // Inner distance transform gives a rounded body volume; high-passed
  // luminance adds surface detail (folds, hair, hands).
  const dist = chamferDistance(alpha, w, h)
  let maxDist = 0
  for (let i = 0; i < dist.length; i++) if (dist[i] > maxDist) maxDist = dist[i]
  const invMax = maxDist > 0 ? 1 / maxDist : 0

  const blurLum = boxBlur(lum, w, h, 3)
  const height = new Float32Array(w * h)
  for (let p = 0; p < height.length; p++) {
    if (alpha[p] === 0) { height[p] = 0; continue }
    // sqrt() flattens the centre so the body reads as a cylinder, not a cone.
    const volume = Math.sqrt(Math.min(1, dist[p] * invMax * 2.2))
    const detail = (lum[p] - blurLum[p]) * 0.55
    height[p] = clamp01(volume * 0.86 + 0.14 + detail)
  }
  const heightSmooth = boxBlur(height, w, h, 2)

  // ---- 5. Normal map from the height field --------------------------------
  const normalCanvas = document.createElement('canvas')
  normalCanvas.width = w
  normalCanvas.height = h
  const nctx = normalCanvas.getContext('2d')!
  const nimg = nctx.createImageData(w, h)
  const nd = nimg.data
  // Strength scaled to resolution so 512px and 1024px sprites match.
  const strength = 2.6 * (w / 512)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const i = p * 4
      if (alpha[p] === 0) {
        nd[i] = 128; nd[i + 1] = 128; nd[i + 2] = 255; nd[i + 3] = 255
        continue
      }
      const l = heightSmooth[p - (x > 0 ? 1 : 0)]
      const r = heightSmooth[p + (x < w - 1 ? 1 : 0)]
      const u = heightSmooth[p - (y > 0 ? w : 0)]
      const d = heightSmooth[p + (y < h - 1 ? w : 0)]
      // dx/dy in height units; z fixed so steeper slopes tilt the normal more.
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

  // ---- 6. Height texture (R channel) --------------------------------------
  const heightCanvas = document.createElement('canvas')
  heightCanvas.width = w
  heightCanvas.height = h
  const hctx = heightCanvas.getContext('2d')!
  const himg = hctx.createImageData(w, h)
  for (let p = 0, i = 0; p < heightSmooth.length; p++, i += 4) {
    const v = Math.round(clamp01(heightSmooth[p]) * 255)
    himg.data[i] = v
    himg.data[i + 1] = v
    himg.data[i + 2] = v
    himg.data[i + 3] = 255
  }
  hctx.putImageData(himg, 0, 0)

  // ---- 7. Robust alpha bounds for auto-framing -----------------------------
  // Naive min/max is hostage to a single stray pixel the chroma key missed, so
  // we use row/column coverage histograms and clip rows that carry less than a
  // small fraction of the peak coverage. That makes framing consistent across
  // all 64 fighters even when a sprite has dust in the corners.
  const rowCov = new Int32Array(h)
  const colCov = new Int32Array(w)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      if (alpha[row + x] !== 0) { rowCov[y]++; colCov[x]++ }
    }
  }
  const span = (cov: Int32Array, floorFrac: number): [number, number] => {
    let peak = 0
    for (let i = 0; i < cov.length; i++) if (cov[i] > peak) peak = cov[i]
    const thresh = Math.max(2, peak * floorFrac)
    let a = -1, b = -1
    for (let i = 0; i < cov.length; i++) if (cov[i] >= thresh) { a = i; break }
    for (let i = cov.length - 1; i >= 0; i--) if (cov[i] >= thresh) { b = i; break }
    return a < 0 ? [0, cov.length - 1] : [a, b]
  }
  // Vertical: a head is a narrow sliver of the body, so the floor must be low.
  const [y0, y1] = span(rowCov, 0.012)
  // Horizontal: limbs are thin too, but noise is more common at the sides.
  const [x0, x1] = span(colCov, 0.02)

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
    t.generateMipmaps = true
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.magFilter = THREE.LinearFilter
    t.needsUpdate = true
  }

  return {
    albedo,
    normal,
    height: heightTex,
    width: w,
    height_px: h,
    bounds: [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h],
  }
}

// ---------------------------------------------------------------------------
// Image ops

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/** Remove isolated pixels and fill single-pixel holes in a binary mask. */
function despeckle(alpha: Uint8Array, w: number, h: number) {
  const src = alpha.slice()
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          if (src[p + dy * w + dx] !== 0) n++
        }
      }
      if (src[p] !== 0 && n <= 1) alpha[p] = 0
      else if (src[p] === 0 && n >= 7) alpha[p] = 255
    }
  }
}

/** 1px feather so the silhouette anti-aliases against the stage. */
function featherAlpha(alpha: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(alpha.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (alpha[p] !== 0) { out[p] = 255; continue }
      // Empty pixel: partially fill if it touches the silhouette.
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          if (alpha[yy * w + xx] !== 0) n++
        }
      }
      out[p] = n >= 5 ? 170 : n >= 3 ? 96 : 0
    }
  }
  return out
}

/**
 * Two-pass chamfer (3-4) distance transform: distance from each interior pixel
 * to the nearest background pixel. Fast, and accurate enough for a height map.
 */
function chamferDistance(alpha: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9
  const d = new Float32Array(w * h)
  for (let p = 0; p < d.length; p++) d[p] = alpha[p] === 0 ? 0 : INF

  const A = 1, B = 1.41421356
  // Forward pass
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
  // Backward pass
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

/** Separable box blur, `radius` px, `passes` implicit 1. */
function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  if (radius <= 0) return src.slice()
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const norm = 1 / (radius * 2 + 1)
  // Horizontal
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
  // Vertical
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
