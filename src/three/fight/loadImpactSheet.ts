import * as THREE from 'three'

/**
 * Loads the procedural "impact-frame" spark sheet from `public/impact/sparks/`.
 *
 * The sheet is authored by `scripts/generate-impact-sparks.ts` and published as
 * `atlas.png` + `frames.json`. It is a single strip of bold WHITE marks (a star,
 * a slash, a shatter…); the HUE is applied at runtime by ImpactFlash, so one
 * sheet serves every hit weight. Loading is by fixed path, not per-identity.
 *
 * Same dev-server trap as the projectile loader: a dev server answers a missing
 * asset with `index.html` and a 200, so `res.ok` is not proof the manifest
 * exists. We validate the fetched body actually parses as this manifest shape
 * before trusting it, and reject otherwise.
 */

export interface ImpactMarkMeta {
  name: string
  rect: { x: number; y: number; w: number; h: number }
}

export interface ImpactSheetManifest {
  sheet: string
  atlas: string
  frameW: number
  frameH: number
  marks: ImpactMarkMeta[]
}

/** Per-mark UV sub-rect (offset + scale) into the shared atlas, precomputed so
 *  ImpactFlash never needs the atlas pixel size. */
export interface MarkUV {
  name: string
  offset: [number, number]
  scale: [number, number]
}

export interface LoadedImpactSheet {
  manifest: ImpactSheetManifest
  texture: THREE.Texture
  atlasW: number
  atlasH: number
  uv: MarkUV[]
}

export const IMPACT_SHEET_PATH = '/impact/sparks'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`impact spark atlas image failed: ${src}`))
    img.src = src
  })
}

export function isImpactManifest(m: unknown): m is ImpactSheetManifest {
  const o = m as ImpactSheetManifest | null
  return (
    !!o &&
    o.sheet === 'impact-sparks' &&
    Number.isFinite(o.frameW) &&
    Number.isFinite(o.frameH) &&
    Array.isArray(o.marks) &&
    o.marks.length > 0 &&
    o.marks.every(
      (mk) =>
        !!mk &&
        typeof mk.name === 'string' &&
        !!mk.rect &&
        Number.isFinite(mk.rect.x) &&
        Number.isFinite(mk.rect.y) &&
        Number.isFinite(mk.rect.w) &&
        Number.isFinite(mk.rect.h),
    )
  )
}

/** Build per-mark UV sub-rects. flipY is false on the texture (see loader), so
 *  atlas pixel (x,y) with y measured from the top maps linearly. The marks are
 *  centred and effectively symmetric, and slash/shatter are rotated at runtime,
 *  so vertical orientation is immaterial — this keeps the mapping trivial. */
export function markUVs(manifest: ImpactSheetManifest, atlasW: number, atlasH: number): MarkUV[] {
  return manifest.marks.map((mk) => ({
    name: mk.name,
    offset: [mk.rect.x / atlasW, mk.rect.y / atlasH],
    scale: [mk.rect.w / atlasW, mk.rect.h / atlasH],
  }))
}

export async function loadImpactSheet(basePath: string = IMPACT_SHEET_PATH): Promise<LoadedImpactSheet> {
  const res = await fetch(`${basePath}/frames.json`)
  if (!res.ok) throw new Error(`no impact spark manifest (${res.status})`)
  const raw = (await res.json()) as unknown
  if (!isImpactManifest(raw)) {
    throw new Error(`"${basePath}/frames.json" did not parse as an impact spark manifest`)
  }
  const manifest = raw

  const img = await loadImage(`${basePath}/${manifest.atlas ?? 'atlas.png'}`)
  const texture = new THREE.Texture(img)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  // flipY off so UVs map with atlas y measured from the top (see markUVs).
  texture.flipY = false
  texture.needsUpdate = true

  const atlasW = img.naturalWidth
  const atlasH = img.naturalHeight
  return { manifest, texture, atlasW, atlasH, uv: markUVs(manifest, atlasW, atlasH) }
}
