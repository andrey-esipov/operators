import { describe, it, expect } from 'vitest'
import { isImpactManifest, markUVs, type ImpactSheetManifest } from '../loadImpactSheet'

/**
 * The loader's one job that can silently rot: a dev server answers a MISSING
 * asset with index.html and a 200, so `res.ok` is not proof the manifest is
 * real. `isImpactManifest` is the gate that rejects the wrong body. These tests
 * pin that gate — if it degrades to "any object", the wrong-shape cases go red.
 */

const good: ImpactSheetManifest = {
  sheet: 'impact-sparks',
  atlas: 'atlas.png',
  frameW: 128,
  frameH: 128,
  marks: [
    { name: 'star4', rect: { x: 4, y: 4, w: 128, h: 128 } },
    { name: 'slash', rect: { x: 400, y: 4, w: 128, h: 128 } },
  ],
}

describe('isImpactManifest', () => {
  it('accepts a real impact-spark manifest', () => {
    expect(isImpactManifest(good)).toBe(true)
  })

  it('rejects the things a dev server actually hands back for a missing file', () => {
    expect(isImpactManifest(null)).toBe(false)
    expect(isImpactManifest('<!doctype html><title>index</title>')).toBe(false)
    expect(isImpactManifest({})).toBe(false)
    // Right shape, WRONG sheet id — would be some other atlas's manifest.
    expect(isImpactManifest({ ...good, sheet: 'projectiles' })).toBe(false)
    // Empty / malformed marks.
    expect(isImpactManifest({ ...good, marks: [] })).toBe(false)
    expect(isImpactManifest({ ...good, marks: [{ name: 'x' }] })).toBe(false)
    // Non-finite geometry.
    expect(isImpactManifest({ ...good, frameW: NaN })).toBe(false)
  })
})

describe('markUVs', () => {
  it('maps each mark rect to a normalized offset/scale into the atlas', () => {
    const uv = markUVs(good, 664, 136)
    expect(uv).toHaveLength(2)
    expect(uv[0].offset[0]).toBeCloseTo(4 / 664, 9)
    expect(uv[0].scale[0]).toBeCloseTo(128 / 664, 9)
    expect(uv[0].scale[1]).toBeCloseTo(128 / 136, 9)
    // Second mark starts further right in the strip.
    expect(uv[1].offset[0]).toBeCloseTo(400 / 664, 9)
    expect(uv[1].offset[0]).toBeGreaterThan(uv[0].offset[0])
  })
})
