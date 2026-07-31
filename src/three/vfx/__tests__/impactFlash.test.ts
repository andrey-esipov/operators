import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { ImpactFlash } from '../ImpactFlash'
import type { LoadedImpactSheet } from '../../fight/loadImpactSheet'

/**
 * ImpactFlash is a pooled additive-quad primitive; none of its behaviour needs
 * GL (THREE's Scene/Mesh/ShaderMaterial/Texture are plain JS until rendered), so
 * we exercise the real pool and assert on the real uniforms. The mutation shape
 * for each claim: break the thing it measures and this exact assertion is the
 * one that can go red.
 */

function fakeCtx() {
  return {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    quality: 'high',
  } as unknown as ConstructorParameters<typeof ImpactFlash>[0]
}

/** A sheet with 5 distinct UV rects so we can prove spawn() selects by index. */
function fakeSheet(): LoadedImpactSheet {
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat)
  tex.needsUpdate = true
  const uv = Array.from({ length: 5 }, (_, i) => ({
    name: `m${i}`,
    offset: [i * 0.1, 0] as [number, number],
    scale: [0.1, 0.9] as [number, number],
  }))
  return {
    manifest: { sheet: 'impact-sparks', atlas: 'atlas.png', frameW: 128, frameH: 128, marks: [] },
    texture: tex,
    atlasW: 664,
    atlasH: 136,
    uv,
  }
}

/** Build a tint that carries a deliberate >1 (HDR) channel, straight on r/g/b. */
function hdr(r: number, g: number, b: number): THREE.Color {
  const c = new THREE.Color()
  c.r = r; c.g = g; c.b = b
  return c
}

const meshes = (scene: THREE.Scene) => scene.children.filter((m): m is THREE.Mesh => (m as THREE.Mesh).isMesh)
const visible = (scene: THREE.Scene) => meshes(scene).filter((m) => m.visible)
const uni = (m: THREE.Mesh) => (m.material as THREE.ShaderMaterial).uniforms

describe('ImpactFlash pool', () => {
  it('is inert until a sheet is installed (never draws the placeholder)', () => {
    const ctx = fakeCtx()
    const fx = new ImpactFlash(ctx)
    expect(fx.isReady).toBe(false)
    fx.spawn(new THREE.Vector3(1, 2, 0), 0, 1.5, 0, hdr(1.9, 0.6, 0.2), 2, 0.1)
    expect(visible(ctx.scene as THREE.Scene)).toHaveLength(0)
    fx.dispose()
  })

  it('spawns one oriented, weight-sized quad and preserves the HDR tint verbatim', () => {
    const ctx = fakeCtx()
    const scene = ctx.scene as THREE.Scene
    const fx = new ImpactFlash(ctx)
    fx.setSheet(fakeSheet())
    expect(fx.isReady).toBe(true)

    fx.spawn(new THREE.Vector3(3, 4, 0), 2, 1.85, 0.5, hdr(1.9, 0.66, 0.26), 2, 0.1)
    const vis = visible(scene)
    expect(vis).toHaveLength(1)
    const m = vis[0]

    // Weight → scale, blow → in-plane rotation, contact → position.
    expect(m.scale.x).toBeCloseTo(1.85, 6)
    expect(uni(m).uRot.value).toBeCloseTo(0.5, 6)
    expect(m.position.x).toBeCloseTo(3, 6)

    // The sheet sub-rect is chosen by index (mark 2 → offset 0.2).
    expect((uni(m).uOffset.value as THREE.Vector2).x).toBeCloseTo(0.2, 6)

    // HDR channels survive the copy unclamped — this is what lets additive+bloom
    // saturate with HUE instead of washing to white. If spawn clamped to [0,1]
    // this goes red.
    const tint = uni(m).uTint.value as THREE.Color
    expect(tint.r).toBeCloseTo(1.9, 6)
    expect(tint.b).toBeCloseTo(0.26, 6)
    expect(uni(m).uAge.value).toBe(0)
    fx.dispose()
  })

  it('is short-lived: ages over its life then hides itself', () => {
    const ctx = fakeCtx()
    const scene = ctx.scene as THREE.Scene
    const fx = new ImpactFlash(ctx)
    fx.setSheet(fakeSheet())
    fx.spawn(new THREE.Vector3(0, 0, 0), 0, 1, 0, hdr(1.6, 0.9, 0.4), 1.5, 0.1)

    fx.update(0.05) // half its 0.1s life
    const mid = visible(scene)
    expect(mid).toHaveLength(1)
    expect(uni(mid[0]).uAge.value).toBeCloseTo(0.5, 5)

    fx.update(0.05) // life exhausted
    expect(visible(scene)).toHaveLength(0)
    fx.dispose()
  })

  it('dispose() removes every pooled mesh from the scene (no orphans)', () => {
    const ctx = fakeCtx()
    const scene = ctx.scene as THREE.Scene
    const fx = new ImpactFlash(ctx)
    expect(meshes(scene).length).toBeGreaterThan(0)
    fx.dispose()
    expect(meshes(scene)).toHaveLength(0)
  })
})
