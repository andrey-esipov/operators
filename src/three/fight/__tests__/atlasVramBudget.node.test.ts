import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ATLAS_MAP_POLICY,
  DERIVED_MAP_DOWNSCALE,
  buildDerivedMaps,
  residentBytesForAtlas,
} from '../AtlasTextures'

/**
 * VRAM shipping gate. A fighter uploads three atlas maps (albedo + synthesised
 * normal + height); a match loads two fighters. A prior build shipped all three
 * as full-res mipmapped RGBA, costing ~544 MB for lenny alone and ~1.09 GB for a
 * two-lenny match — a hard fail on a 4 GB card before the stage even loads.
 *
 * The budget below is what a 2026 fighter can hold on a mid-tier GPU whose floor
 * is 4 GB VRAM: 512 MB for both fighters leaves ~3.5 GB for the stage, VFX,
 * DPR-2 post-processing targets, and browser/compositor overhead. Shipping
 * fighters run their whole cast in a fraction of this.
 *
 * WHY THIS CAN'T LIE (two independent ties, so no single edit slips through):
 *  - Cost ← policy: `residentBytesForAtlas` derives the number the budget checks
 *    straight from {@link ATLAS_MAP_POLICY}. Revert the policy to 3× full-res
 *    RGBA and lenny climbs back to 544 MB > 256 → this test reddens.
 *  - Producer ← policy: the "honours the policy" test calls the *real* map
 *    builder {@link buildDerivedMaps} and asserts its output is half-resolution,
 *    two-channel (normal) / one-channel (height). Loosen the builder back to
 *    full-res or four-channel and that test reddens even if the policy object is
 *    left untouched. The runtime uploader consumes this same builder + policy,
 *    so what the gate measures is what actually ships.
 *
 * Mutation-proven: setting `ATLAS_MAP_POLICY.normal`/`.height` back to
 * `{ downscale: 1, bytesPerTexel: 4 }` fails "every fighter within budget",
 * "match within budget", and "policy compresses vs naive RGBA"; forcing
 * `buildDerivedMaps` to emit full-res or RGBA fails the honours-policy test.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const FIGHTERS_DIR = resolve(HERE, '../../../../public/fighters')

const MB = 1024 * 1024
const PER_FIGHTER_BUDGET_MB = 256
const PER_MATCH_BUDGET_MB = 512
const MATCH_FIGHTERS = 2

/**
 * Read canvas width/height from a WebP's VP8X (extended) header — no decode, no
 * deps, mirroring the old sync `pngSize`. The roster now ships WebP (a ~5.3x
 * download cut over PNG); every fighter atlas is VP8X because it carries an ALPH
 * chunk for the silhouette alpha the whole art pipeline leans on, so a non-VP8X
 * file here is unexpected and throws loudly rather than silently miscomputing
 * VRAM. Dimensions are format-independent, so the numbers this gate checks are
 * identical to the pre-WebP PNG era — WebP is a download win, not a VRAM one.
 */
function webpSize(path: string): { w: number; h: number } {
  const buf = readFileSync(path)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP')
    throw new Error(`not a WebP: ${path}`)
  const fourcc = buf.toString('ascii', 12, 16)
  if (fourcc !== 'VP8X') throw new Error(`unsupported WebP sub-format "${fourcc}": ${path}`)
  // VP8X payload: flags(1) + reserved(3), then 24-bit LE canvas width-1 @24 and
  // height-1 @27.
  return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 }
}

interface Atlas { id: string; w: number; h: number; mb: number }

function loadAtlases(): Atlas[] {
  return readdirSync(FIGHTERS_DIR)
    .filter((id) => existsSync(resolve(FIGHTERS_DIR, id, 'atlas.webp')))
    .map((id) => {
      const { w, h } = webpSize(resolve(FIGHTERS_DIR, id, 'atlas.webp'))
      return { id, w, h, mb: residentBytesForAtlas(w, h) / MB }
    })
    .sort((a, b) => b.mb - a.mb)
}

describe('atlas VRAM budget', () => {
  const atlases = loadAtlases()

  it('finds the fighter atlases it is meant to gate', () => {
    // If this drops to zero the budget checks below become vacuously true — the
    // classic lying harness. Fail loudly instead.
    expect(atlases.length).toBeGreaterThanOrEqual(6)
  })

  it('keeps every fighter within the per-fighter VRAM budget', () => {
    for (const a of atlases) {
      expect(
        a.mb,
        `${a.id} (${a.w}x${a.h}) resident ${a.mb.toFixed(0)} MB exceeds ${PER_FIGHTER_BUDGET_MB} MB`,
      ).toBeLessThanOrEqual(PER_FIGHTER_BUDGET_MB)
    }
  })

  it('keeps the worst-case two-fighter match within the match VRAM budget', () => {
    // Same skin twice is a legal match and the worst case, so charge the two
    // heaviest atlases (which for a mirror match is 2× the single heaviest).
    const heaviest = atlases[0]?.mb ?? 0
    const worstMatchMb = heaviest * MATCH_FIGHTERS
    expect(
      worstMatchMb,
      `worst match (2× ${atlases[0]?.id}) = ${worstMatchMb.toFixed(0)} MB exceeds ${PER_MATCH_BUDGET_MB} MB`,
    ).toBeLessThanOrEqual(PER_MATCH_BUDGET_MB)
  })

  it('actually compresses the derived maps vs naive 3× RGBA', () => {
    // Guards fighters that sit under budget anyway (the mock roster): a silent
    // revert to full-res RGBA everywhere must still redden something.
    const MIP = 4 / 3
    for (const a of atlases) {
      const naiveBytes = 3 * a.w * a.h * 4 * MIP
      expect(residentBytesForAtlas(a.w, a.h)).toBeLessThan(naiveBytes * 0.5)
    }
  })
})

describe('derived maps honour the texture-memory policy', () => {
  // A synthetic silhouette; odd height exercises the ceil() on downscale.
  const w = 16
  const h = 13
  const mask = new Uint8Array(w * h)
  const lum = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = x > 2 && x < 13 && y > 2 && y < 10
      mask[y * w + x] = inside ? 255 : 0
      lum[y * w + x] = inside ? 0.3 + 0.5 * ((x + y) % 3) / 2 : 0
    }
  }

  const { normal, height } = buildDerivedMaps(mask, lum, w, h)
  const w2 = Math.ceil(w / DERIVED_MAP_DOWNSCALE)
  const h2 = Math.ceil(h / DERIVED_MAP_DOWNSCALE)

  it('shares one downscale for both derived maps', () => {
    expect(DERIVED_MAP_DOWNSCALE).toBe(ATLAS_MAP_POLICY.normal.downscale)
    expect(DERIVED_MAP_DOWNSCALE).toBe(ATLAS_MAP_POLICY.height.downscale)
    expect(DERIVED_MAP_DOWNSCALE).toBeGreaterThan(1)
  })

  it('emits a half-resolution two-channel (RG8) normal', () => {
    expect(normal.width).toBe(w2)
    expect(normal.height).toBe(h2)
    expect(ATLAS_MAP_POLICY.normal.bytesPerTexel).toBe(2)
    // Two bytes per texel is the RG contract the shader reconstructs z from.
    expect(normal.data.length).toBe(w2 * h2 * 2)
    expect(normal.data.length).toBe(w2 * h2 * ATLAS_MAP_POLICY.normal.bytesPerTexel)
  })

  it('emits a half-resolution single-channel (R8) height', () => {
    expect(height.width).toBe(w2)
    expect(height.height).toBe(h2)
    expect(ATLAS_MAP_POLICY.height.bytesPerTexel).toBe(1)
    expect(height.data.length).toBe(w2 * h2 * 1)
    expect(height.data.length).toBe(w2 * h2 * ATLAS_MAP_POLICY.height.bytesPerTexel)
  })

  it('keeps the albedo full-resolution RGBA (art + coverage ramp untouched)', () => {
    expect(ATLAS_MAP_POLICY.albedo.downscale).toBe(1)
    expect(ATLAS_MAP_POLICY.albedo.bytesPerTexel).toBe(4)
  })
})
