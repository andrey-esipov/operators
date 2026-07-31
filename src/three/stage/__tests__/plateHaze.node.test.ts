import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'
import { STAGES, STAGE_ORDER } from '../StageRegistry'
import { hazeScaleFor, plateBandMedian, HAZE_MIN_SCALE } from '../plateHaze'

/**
 * The far haze bands are ADDITIVE and carry the stage accent, so they deposit a
 * roughly fixed amount of light regardless of what is behind them. Left
 * unscaled they buried the darkest paintings: `crisis` rendered a midtone of 80
 * against a painted 27 (3.0x) and `ipo-prep` 123 against 45 (2.7x), which is
 * what made those arenas stop matching the thumbnail the player picked them
 * from. The four darkest paintings were exactly the four broken arenas.
 *
 * These assertions run against the SHIPPED PNGs, not against numbers copied out
 * of the source, so re-authoring an arena's art re-runs the real check.
 */
const root = resolve(__dirname, '../../../..')

async function medianFor(id: string): Promise<number> {
  const cfg = STAGES[id as keyof typeof STAGES]
  const file = resolve(root, 'public', cfg.backdrop.replace(/^\//, ''))
  const N = 96
  const { data, info } = await sharp(readFileSync(file))
    .resize(N, N, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return plateBandMedian(data, info.width, info.height, data.length / (info.width * info.height))
}

describe('plate-proportional atmospheric haze', () => {
  it('covers every shipped arena (vacuity guard)', () => {
    // Enumerated from the registry, not a local list, so a new arena cannot be
    // added without this suite measuring it.
    expect(STAGE_ORDER.length).toBe(8)
    for (const id of STAGE_ORDER) expect(STAGES[id].backdrop).toMatch(/\.png$/)
  })

  it('scales haze down on dark plates and leaves bright plates alone', async () => {
    const seen: Record<string, number> = {}
    for (const id of STAGE_ORDER) {
      const median = await medianFor(id)
      seen[id] = hazeScaleFor(median)
      expect(median).toBeGreaterThan(0)
      expect(median).toBeLessThanOrEqual(1)
    }
    // The arenas whose paintings are darkest must lose most of the additive
    // glow, or the painting is no longer what the player sees.
    expect(seen['crisis']).toBeLessThan(0.35)
    expect(seen['ipo-prep']).toBeLessThan(0.5)
    expect(seen['ai-native']).toBeLessThan(0.35)
    // The brightest arena must KEEP its atmosphere. A blind five-arm ranking
    // found the fully art-forward look loses: the plate stops reading as part
    // of the scene and starts reading as pasted-on wallpaper.
    expect(seen['distribution']).toBeGreaterThan(0.6)
    // and the correction must be ordered by how dark the art actually is
    expect(seen['crisis']).toBeLessThan(seen['distribution'])
  }, 30000)

  it('is monotone in plate luminance and clamped at both ends', () => {
    const pts = [0, 0.05, 0.12, 0.3, 0.5, 0.8, 1, 2]
    const out = pts.map((p) => hazeScaleFor(p))
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1])
    expect(hazeScaleFor(0)).toBe(HAZE_MIN_SCALE)
    expect(hazeScaleFor(5)).toBe(1)
    // never fully removes the bands
    expect(hazeScaleFor(0.0001)).toBeGreaterThan(0)
  })

  it('measures the visible window, not the whole painting', () => {
    // A plate that is black inside the cover-fit window but blazing outside it
    // must still read as dark: sampling the full image would miss the defect
    // this gate exists to catch. (Whole-image mean genuinely fails to separate
    // the broken arenas from the healthy ones on the real art.)
    const W = 64, H = 64, px = new Uint8Array(W * H * 4)
    for (let y = 0; y < H; y++) {
      const inBand = y / H > 0.078 + 0.21 * 0.844 && y / H < 0.078 + 0.44 * 0.844
      for (let x = 0; x < W; x++) {
        const v = inBand ? 0 : 255
        const i = (y * W + x) * 4
        px[i] = px[i + 1] = px[i + 2] = v
        px[i + 3] = 255
      }
    }
    expect(plateBandMedian(px, W, H, 4)).toBe(0)
    expect(hazeScaleFor(plateBandMedian(px, W, H, 4))).toBe(HAZE_MIN_SCALE)
  })
})
