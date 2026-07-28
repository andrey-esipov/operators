import * as THREE from 'three'

/**
 * Loads a projectile's real generated sprite set from `public/projectiles/`.
 *
 * The format is the authoritative one published in
 * `public/projectiles/README.md` — read from the committed `frames.json`, never
 * inferred. Projectiles are *objects, not characters*: each is chosen at runtime
 * by the sim's `Projectile.kind` string, so this loads purely by kind and keeps
 * no per-identity state.
 *
 * The same trap that hid the fighter atlases for weeks applies here: a dev
 * server answers a missing asset with `index.html` and a 200, so `res.ok` is not
 * proof the manifest exists. We validate the fetched body actually parses as
 * this manifest shape before trusting it, and reject otherwise.
 */

export interface ProjectileFrame {
  name: string
  rect: { x: number; y: number; w: number; h: number }
}

export interface ProjectileClip {
  /** Indices into `frames[]` (not rects). */
  frames: number[]
  /** Parallel array: how many 60fps ticks each frame of the clip is shown. */
  durations: number[]
  loop: boolean
}

export interface ProjectileManifest {
  kind: string
  atlas: string
  frameW: number
  frameH: number
  /** Frame-local hot-point in px from the frame's top-left; sits on the sim's
   *  `Projectile.pos`. Both the spawn origin and the tracked point. */
  anchor: { x: number; y: number }
  /** Art is authored travelling this way; mirror for the opposite facing. */
  travelDir: 'right' | 'left'
  frames: ProjectileFrame[]
  clips: { spawn: ProjectileClip; travel: ProjectileClip; impact: ProjectileClip }
}

export interface LoadedProjectile {
  manifest: ProjectileManifest
  /** Single shared atlas texture for this kind; sub-rects are selected per
   *  sprite by rewriting quad UVs, so one GPU upload serves every live bolt. */
  texture: THREE.Texture
  atlasW: number
  atlasH: number
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`projectile atlas image failed: ${src}`))
    img.src = src
  })
}

function isManifest(m: unknown, kind: string): m is ProjectileManifest {
  const o = m as ProjectileManifest | null
  return (
    !!o &&
    o.kind === kind &&
    Number.isFinite(o.frameW) &&
    Number.isFinite(o.frameH) &&
    !!o.anchor &&
    Array.isArray(o.frames) &&
    o.frames.length > 0 &&
    !!o.clips?.spawn &&
    !!o.clips?.travel &&
    !!o.clips?.impact &&
    Array.isArray(o.clips.travel.frames) &&
    o.clips.travel.frames.length > 0
  )
}

export async function loadProjectileAtlas(kind: string): Promise<LoadedProjectile> {
  const res = await fetch(`/projectiles/${kind}/frames.json`)
  if (!res.ok) throw new Error(`no projectile manifest for "${kind}" (${res.status})`)
  const raw = (await res.json()) as unknown
  if (!isManifest(raw, kind)) {
    throw new Error(`"/projectiles/${kind}/frames.json" did not parse as a projectile manifest`)
  }
  const manifest = raw

  const img = await loadImage(`/projectiles/${kind}/${manifest.atlas ?? 'atlas.png'}`)
  const texture = new THREE.Texture(img)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  // Default flipY (true): texture v=0 is the image bottom. Per-frame UVs are
  // built with that convention (v = 1 - (y+h)/H) in ProjectileLayer.
  texture.needsUpdate = true

  return {
    manifest,
    texture,
    atlasW: img.naturalWidth,
    atlasH: img.naturalHeight,
  }
}
