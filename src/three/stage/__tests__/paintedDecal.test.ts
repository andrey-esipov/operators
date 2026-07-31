import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'

// The material bakery rasterises procedural maps onto a <canvas>, which does not
// exist in the vitest 'node' environment. Stub it with plain data textures so we
// can build a whole arena headlessly and inspect the materials it actually
// instantiates. THREE object construction itself is canvas-free.
vi.mock('../../materials/procedural', () => {
  const tex = () => new THREE.Texture()
  return {
    bakeMaterial: () => ({
      map: tex(),
      roughnessMap: tex(),
      normalMap: tex(),
      metalnessMap: tex(),
      defaults: { normalScale: 1 },
    }),
    surface: () => new THREE.MeshStandardMaterial(),
    applyAoUv: () => {},
    disposeMaterialCache: () => {},
  }
})

import { paintedDecal, StageBuild } from '../StageKit'
import { buildPrePmf } from '../arenas/prePmf'
import { stageConfig } from '../StageRegistry'
import { flagsFor } from '../../core/QualityManager'

const hex = (h: number) => new THREE.Color(h).getHex()

function allMaterials(root: THREE.Object3D): THREE.Material[] {
  const out: THREE.Material[] = []
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material
    if (!m) return
    if (Array.isArray(m)) out.push(...m)
    else out.push(m)
  })
  return out
}

/** A flat pasted sticker: unlit basic paint that renders its source colour
 *  verbatim (toneMapped:false) and does not additively glow. This is exactly the
 *  material the critic flagged; the fix is that none survive on a wall. */
function isFlatSticker(m: THREE.Material): boolean {
  return (
    (m as THREE.MeshBasicMaterial).isMeshBasicMaterial === true &&
    m.toneMapped === false &&
    m.blending === THREE.NormalBlending
  )
}

describe('paintedDecal factory', () => {
  it('is a lit PBR material, not a toneMapped:false overlay', () => {
    const m = paintedDecal(0x2f5fe0)
    // A lit MeshStandardMaterial responds to the directional key/rim/fill; a
    // MeshBasicMaterial({toneMapped:false}) — the sticker — does not.
    expect((m as THREE.MeshStandardMaterial).isMeshStandardMaterial).toBe(true)
    expect(m.toneMapped).not.toBe(false)
    expect(m.metalness).toBe(0)
    expect(m.roughness).toBeGreaterThan(0.3)
  })

  it('keeps the emissive floor low so the surface is light-driven, not self-lit', () => {
    const m = paintedDecal(0x2f5fe0)
    expect(m.emissiveIntensity).toBeLessThanOrEqual(0.1)
    expect(m.emissiveIntensity).toBeGreaterThanOrEqual(0)
    // Default emissive tint tracks the base pigment.
    expect(m.emissive.getHex()).toBe(hex(0x2f5fe0))
  })

  it('honours roughness / metalness / emissiveScale opts', () => {
    const m = paintedDecal(0xffd23a, { roughness: 0.85, metalness: 0.1, emissiveScale: 0.13 })
    expect(m.roughness).toBeCloseTo(0.85, 5)
    expect(m.metalness).toBeCloseTo(0.1, 5)
    expect(m.emissiveIntensity).toBeCloseTo(0.13, 5)
  })
})

describe('THE GARAGE consumes lit decals (no pasted stickers on the wall)', () => {
  const b = new StageBuild()
  buildPrePmf(b, stageConfig('pre-pmf'), flagsFor('low'))
  const mats = allMaterials(b.root)

  it('has zero flat unlit paint stickers anywhere in the set', () => {
    const stickers = mats.filter(isFlatSticker)
    expect(stickers.length).toBe(0)
  })

  it('renders the whiteboard ink + sticky notes as lit surfaces at their exact pigment', () => {
    // These are the specific decals the critic called out: the blue growth line,
    // the red circle accent, and the sticky-note colour pops. structureMat shifts
    // colours via brightness compensation, so a material at the EXACT pigment hex
    // can only be a paintedDecal — a precise fingerprint of the converted meshes.
    const decalColors = [0x4a7cff, 0xff5a44, 0xffd23a, 0xff5aa0, 0x46d0ff, 0xff8a3a, 0x9be25a]
    for (const c of decalColors) {
      const matches = mats.filter((m) => (m as THREE.MeshStandardMaterial).color?.getHex() === hex(c))
      expect(matches.length, `expected a decal at #${c.toString(16)}`).toBeGreaterThan(0)
      for (const m of matches) {
        expect(isFlatSticker(m), `decal #${c.toString(16)} must not be a sticker`).toBe(false)
        expect((m as THREE.MeshStandardMaterial).isMeshStandardMaterial).toBe(true)
        expect(m.toneMapped).not.toBe(false)
      }
    }
  })
})
