import * as THREE from 'three'

/**
 * Shared visual-FX helpers for projectile rendering: a procedural soft-glow
 * texture, a per-kind energy tint, and an additive glow-mesh factory.
 *
 * These back the parts of a shipped fireball that the sprite atlas alone does
 * NOT give you — the motion trail, the light it spills on the floor, and the
 * impact flash. They are deliberately additive and un-tone-mapped so they read
 * as emitted light (and feed the bloom), never as a pasted-on decal.
 */

let glowTex: THREE.Texture | null = null

/**
 * A radial white core → transparent edge, rasterised once and shared. An
 * additive quad wearing this reads as a soft light bloom rather than a hard
 * disc, so a trail blob or floor pool melts into the scene instead of cutting a
 * circle out of it.
 */
export function softGlowTexture(): THREE.Texture {
  if (glowTex) return glowTex
  const S = 64
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0.0, 'rgba(255,255,255,1)')
  g.addColorStop(0.32, 'rgba(255,255,255,0.6)')
  g.addColorStop(0.68, 'rgba(255,255,255,0.14)')
  g.addColorStop(1.0, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  glowTex = tex
  return tex
}

/**
 * Energy tint per projectile kind, keyed off the same string the sim tags a
 * `Projectile` with. Values track the authored art hue (ion-bolt is electric
 * cyan, super-beam an indigo lance) but are pushed slightly past 1.0 on the
 * dominant channel so the glow survives tone-mapping into the bloom. An unknown
 * kind still gets a warm light rather than an untinted grey, so a newly authored
 * projectile lights the scene the day its `frames.json` lands.
 */
const TINTS: Record<string, [number, number, number]> = {
  'ion-bolt': [0.34, 0.78, 1.2],
  'super-beam': [0.66, 0.52, 1.3],
}

export function energyTint(kind: string): THREE.Color {
  const t = TINTS[kind] ?? [1.15, 1.0, 0.82]
  return new THREE.Color(t[0], t[1], t[2])
}

/**
 * A unit-quad additive glow mesh wearing the shared soft-glow texture. The
 * caller owns scale, position and per-frame opacity; this only fixes the bits
 * that make it behave as light: additive blend, no depth write, no tone-map.
 * `depthTest` is off so a floor pool or trail never gets z-killed by stage
 * geometry it is meant to wash over.
 */
export function makeGlowMesh(tint: THREE.Color, renderOrder: number): THREE.Mesh {
  const geom = new THREE.PlaneGeometry(1, 1)
  const mat = new THREE.MeshBasicMaterial({
    map: softGlowTexture(),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    color: tint.clone(),
    opacity: 1,
  })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = renderOrder
  return mesh
}
