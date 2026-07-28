import { describe, expect, it } from 'vitest'
import { conditionAlbedoAlpha } from '../edgeAlpha'

/**
 * These guard the fix that stopped the texture loader from throwing away the
 * atlas' baked coverage-AA edge. The renderer used to re-threshold alpha at
 * >128 and re-feather it to a 3-level (255/175/96/0) stair, which the fighter
 * shader's smoothstep then rode as a staircased, weight-wandering edge. The
 * loader must now PRESERVE a real coverage ramp — but must still feather a
 * binary-alpha atlas (the mock/older frames), or those regress to a harder edge
 * than they shipped with.
 */

interface Frame {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** Count distinct partial-alpha levels (the sub-pixel richness the shader needs). */
function partialLevels(px: Uint8ClampedArray): Set<number> {
  const s = new Set<number>()
  for (let i = 3; i < px.length; i += 4) if (px[i] > 16 && px[i] < 240) s.add(px[i])
  return s
}

/** A disc whose edge alpha is a smooth ramp of distance — a real coverage-AA edge. */
function coverageDisc(size = 96, r = 34): Frame {
  const data = new Uint8ClampedArray(size * size * 4)
  const c = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const d = Math.hypot(x - c, y - c)
      // 3px-wide antialiased shoulder -> many intermediate alpha values.
      const cov = Math.max(0, Math.min(1, (r - d) / 3 + 0.5))
      data[i] = 200; data[i + 1] = 150; data[i + 2] = 120 // skin, not backdrop
      data[i + 3] = Math.round(cov * 255)
    }
  }
  return { data, width: size, height: size }
}

/** The same disc, but hard binary alpha — no coverage information at the edge. */
function binaryDisc(size = 96, r = 34): Frame {
  const data = new Uint8ClampedArray(size * size * 4)
  const c = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const d = Math.hypot(x - c, y - c)
      data[i] = 200; data[i + 1] = 150; data[i + 2] = 120
      data[i + 3] = d <= r ? 255 : 0
    }
  }
  return { data, width: size, height: size }
}

/** An opaque frame on gpt-image-2's neutral-grey backdrop — the chroma path. */
function chromaBlob(size = 96, r = 30): Frame {
  const data = new Uint8ClampedArray(size * size * 4)
  const c = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const d = Math.hypot(x - c, y - c)
      const inside = d <= r
      data[i] = inside ? 200 : 128
      data[i + 1] = inside ? 150 : 128
      data[i + 2] = inside ? 120 : 128
      data[i + 3] = 255 // fully opaque; silhouette only in colour
    }
  }
  return { data, width: size, height: size }
}

describe('edgeAlpha.conditionAlbedoAlpha', () => {
  it('preserves a baked coverage ramp instead of quantising it', () => {
    const f = coverageDisc()
    const before = partialLevels(f.data).size
    const { useNativeAlpha, hasCoverageRamp } = conditionAlbedoAlpha(f.data, f.width, f.height)

    expect(useNativeAlpha).toBe(true)
    expect(hasCoverageRamp).toBe(true)
    const after = partialLevels(f.data)
    // The whole point: the sub-pixel ramp survives to the texture. The old
    // feather collapsed this to at most two partial levels (175, 96).
    expect(after.size).toBeGreaterThanOrEqual(8)
    // And it is genuinely the ramp, not the feather signature.
    expect(after.size).toBeGreaterThanOrEqual(before - 1)
  })

  it('still feathers a binary-alpha atlas (no regression for mock/older frames)', () => {
    const f = binaryDisc()
    expect(partialLevels(f.data).size).toBe(0) // hard edge in
    const { useNativeAlpha, hasCoverageRamp } = conditionAlbedoAlpha(f.data, f.width, f.height)

    expect(useNativeAlpha).toBe(true)
    expect(hasCoverageRamp).toBe(false)
    // Feather ran: its 175/96 shoulder now exists where there was a hard step.
    const lv = partialLevels(f.data)
    expect(lv.size).toBeGreaterThan(0)
    expect([...lv].every((v) => v === 175 || v === 96)).toBe(true)
  })

  it('keys and feathers a chroma-backdrop frame', () => {
    const f = chromaBlob()
    const { useNativeAlpha, hasCoverageRamp } = conditionAlbedoAlpha(f.data, f.width, f.height)

    expect(useNativeAlpha).toBe(false)
    expect(hasCoverageRamp).toBe(false)
    // Backdrop is now transparent; the blob stays opaque; edge got a feather.
    const c = (f.height / 2) * f.width + f.width / 2
    expect(f.data[c * 4 + 3]).toBe(255) // centre opaque
    expect(f.data[3]).toBe(0) // corner (backdrop) keyed out
    expect(partialLevels(f.data).size).toBeGreaterThan(0)
  })
})
