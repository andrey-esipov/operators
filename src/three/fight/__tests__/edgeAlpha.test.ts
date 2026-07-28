import { describe, expect, it } from 'vitest'
import { conditionAlbedoAlpha, dilateColor } from '../edgeAlpha'

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

/**
 * The original, obviously-correct dilateColor: scan every pixel, `iters` times,
 * snapshotting the whole mask each ring. The shipped dilateColor replaces this
 * with a frontier walk for speed (~1.9s -> a few ms on lenny). This reference
 * exists ONLY to prove the fast path is byte-identical, so the speed-up cannot
 * silently move a single edge pixel and undo the coverage-ramp fix.
 */
function dilateColorReference(
  px: Uint8ClampedArray,
  mask: Uint8Array,
  w: number,
  h: number,
  iters: number,
) {
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

/** Two differently-coloured blobs + a lone speck, on a wide transparent margin. */
function dilationFixture(): { px: Uint8ClampedArray; mask: Uint8Array; w: number; h: number } {
  const w = 44
  const h = 32
  const px = new Uint8ClampedArray(w * h * 4)
  const mask = new Uint8Array(w * h)
  const put = (x: number, y: number, r: number, g: number, b: number) => {
    const p = y * w + x
    mask[p] = 255
    px[p * 4] = r; px[p * 4 + 1] = g; px[p * 4 + 2] = b; px[p * 4 + 3] = 255
  }
  // Blob A (reddish) left, blob B (bluish) right — placed ~6px apart so their
  // dilation rings collide, exercising the multi-source-average / frontier-meet
  // case where snapshot-vs-live ordering would diverge if the fast path were wrong.
  for (let y = 10; y < 18; y++) for (let x = 6; x < 14; x++) put(x, y, 200, 60, 40)
  for (let y = 12; y < 20; y++) for (let x = 22; x < 30; x++) put(x, y, 40, 70, 210)
  // A lone 1px speck (mic-boom-like thin feature) to test boundary seeding.
  put(37, 6, 230, 220, 80)
  return { px, mask, w, h }
}

describe('edgeAlpha.dilateColor (fast frontier == reference)', () => {
  it('is byte-identical to the whole-image reference for iters 1..5', () => {
    for (let iters = 1; iters <= 5; iters++) {
      const a = dilationFixture()
      const b = dilationFixture()
      dilateColor(a.px, a.mask, a.w, a.h, iters)
      dilateColorReference(b.px, b.mask, b.w, b.h, iters)
      // Compare the whole RGBA buffer, not just a channel — any moved edge pixel
      // (the thing that would reintroduce the staircase) shows up here.
      let firstDiff = -1
      for (let i = 0; i < a.px.length; i++) {
        if (a.px[i] !== b.px[i]) { firstDiff = i; break }
      }
      expect(firstDiff, `iters=${iters} first differing byte at ${firstDiff}`).toBe(-1)
    }
  })

  it('actually dilated something (guards against a no-op fixture)', () => {
    const before = dilationFixture()
    const after = dilationFixture()
    dilateColor(after.px, after.mask, after.w, after.h, 4)
    let changed = 0
    for (let i = 0; i < before.px.length; i++) if (before.px[i] !== after.px[i]) changed++
    expect(changed).toBeGreaterThan(0)
  })
})
