import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ATLAS_COST_BYTES,
  HERO_ATLAS_COST_BYTES,
  firstBoutCostBytes,
  firstBoutHeroCostBytes,
} from '../attractLoadCost'
import { ROSTER } from '../../../fighthud/select/roster'
import { readAtlasCosts, readHeroAtlasCosts } from '../../../../scripts/atlasCosts.ts'

/**
 * Bake-integrity gate for the attract reel's first-bout cost accounting.
 *
 * `attractLoadCost` used to carry a hand-maintained table of six atlas byte sizes
 * shadowing six binary files. It drifted — the funded chesky art run grows that
 * atlas every commit — and a stale-LOW literal makes the director admit an opener
 * `reelQuality` then reddens on the real bytes: a gate that goes red on every
 * legitimate art commit, which is how good gates get disabled. The table is now
 * BAKED from the real files into a committed generated module
 * (scripts/genAtlasCosts.ts → ../atlasCosts.generated.ts, kept fresh at dev/build
 * by scripts/atlasCostsPlugin.ts), so this asserts the join it closes actually
 * holds:
 *
 *  - the byte the director prices each roster skin with EQUALS the byte on disk
 *    (resolved through the manifest exactly as the runtime loader + atlasByteBudget
 *    do), so the director and `reelQuality` can never disagree;
 *  - the bake is actually wired — an empty/unresolved map (the generated file
 *    removed or the plugin broken) fails the coverage and equality checks rather
 *    than passing vacuously; and
 *  - the COMMITTED generated file is not stale — it deep-equals the sizes read
 *    from disk right now, so an atlas that changed without regenerating reddens.
 *
 * Mutation-proven: perturbing any byte in the committed generated file fails both
 * the per-skin equality and the freshness deep-equal with the real diff in the
 * message; deleting a skin's entry fails coverage/freshness.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
// __tests__ → attract → screens → src → repo root, then /public.
const PUBLIC_DIR = resolve(HERE, '../../../../public')

/** Real on-disk atlas size for a skin, resolved through its manifest exactly as
 *  the shipping atlas gates do. 0 when the file is missing. */
function realAtlasBytes(skin: string): number {
  const manifestPath = resolve(PUBLIC_DIR, 'fighters', skin, 'assets.json')
  if (!existsSync(manifestPath)) return 0
  const atlasField =
    (JSON.parse(readFileSync(manifestPath, 'utf-8')) as { atlas?: string }).atlas ??
    `/fighters/${skin}/atlas.webp`
  const diskPath = resolve(PUBLIC_DIR, atlasField.replace(/^\/+/, ''))
  return existsSync(diskPath) ? statSync(diskPath).size : 0
}

/** Real on-disk REDUCED hero-atlas size for a skin, resolved through
 *  `assets.hero.json` exactly as the loader (variant='hero') + bake do. 0 when
 *  the fighter ships no hero variant. */
function realHeroAtlasBytes(skin: string): number {
  const manifestPath = resolve(PUBLIC_DIR, 'fighters', skin, 'assets.hero.json')
  if (!existsSync(manifestPath)) return 0
  const atlasField =
    (JSON.parse(readFileSync(manifestPath, 'utf-8')) as { atlas?: string }).atlas ??
    `/fighters/${skin}/atlas.hero.webp`
  const diskPath = resolve(PUBLIC_DIR, atlasField.replace(/^\/+/, ''))
  return existsSync(diskPath) ? statSync(diskPath).size : 0
}

describe('attract first-bout cost is baked from the real atlases, not a stale table', () => {
  it('bakes a cost for every choosable roster skin (vacuity: the bake is wired)', () => {
    // An unwired/empty generated module makes this the classic zero-check gate.
    expect(Object.keys(ATLAS_COST_BYTES).length).toBeGreaterThanOrEqual(6)
    for (const r of ROSTER) {
      expect(ATLAS_COST_BYTES[r.skin], `no baked cost for roster skin ${r.skin}`).toBeGreaterThan(0)
    }
  })

  it('prices each roster skin at its exact on-disk atlas byte count', () => {
    let checked = 0
    for (const r of ROSTER) {
      const disk = realAtlasBytes(r.skin)
      expect(disk, `missing atlas on disk for ${r.skin}`).toBeGreaterThan(0)
      expect(
        ATLAS_COST_BYTES[r.skin],
        `baked cost for ${r.skin} (${ATLAS_COST_BYTES[r.skin]}) != on-disk atlas ${disk}`,
      ).toBe(disk)
      checked++
    }
    expect(checked).toBe(ROSTER.length) // vacuity: we really compared the roster
    expect(checked).toBeGreaterThan(4)
  })

  it('sums a pairing from the same baked bytes the ceiling is enforced against', () => {
    // The director's admission test and reelQuality's real-byte pricing must be
    // the SAME number — that identity is the whole point of baking.
    const a = ROSTER[0].skin
    const b = ROSTER[1].skin
    expect(firstBoutCostBytes(a, b)).toBe(realAtlasBytes(a) + realAtlasBytes(b))
  })

  it('committed generated file is fresh: it deep-equals the sizes on disk right now', () => {
    // The bake is a COMMITTED file; if an atlas changes and nobody regenerates,
    // the director prices openers with a stale byte. readAtlasCosts() is the exact
    // reader scripts/genAtlasCosts.ts writes from, so the committed map must equal
    // it key-for-key. This catches non-roster drift and added/removed skins that
    // the per-roster equality above cannot see. The plugin is skipped under VITEST
    // precisely so this sees the file as committed, not a just-healed copy.
    const onDisk = readAtlasCosts()
    expect(Object.keys(onDisk).length, 'reader found no atlases — path/scan broke').toBeGreaterThan(4)
    expect(ATLAS_COST_BYTES).toEqual(onDisk)
  })
})

/**
 * Bake-integrity gate for the REDUCED hero atlas — the variant a reported-slow
 * visitor downloads for the opener (bout 1), upgrading to full art for bouts 2+.
 *
 * The hero tier is what decouples opener cost from full-art quality: the opener is
 * priced on `HERO_ATLAS_COST_BYTES`, so `combat-feel` can grow a full atlas
 * without ever pushing a pairing over the slow budget. That guarantee is only real
 * if the baked hero costs actually track the reduced files on disk, so this
 * asserts the same join for hero that the block above asserts for full:
 *
 *  - a hero cost is baked for every roster skin (vacuity: the hero bake is wired);
 *  - each baked hero byte EQUALS the reduced file on disk (resolved through
 *    assets.hero.json exactly as the loader's variant='hero' path does);
 *  - the committed hero map is FRESH (deep-equals readHeroAtlasCosts()); and
 *  - every hero atlas is MATERIALLY smaller than its full atlas (< 60%), so
 *    "priced on hero" is a genuine reduction, not a hero==full miswire that would
 *    silently re-couple opener cost to art quality.
 *
 * Mutation-proven (see the task report): perturbing a byte in the committed hero
 * map fails per-skin equality + freshness; pointing readHeroAtlasCosts at the full
 * manifest fails the reduction check; deleting a hero entry fails coverage.
 */
describe('attract hero-atlas cost is baked from the reduced atlases, not a stale table', () => {
  it('bakes a hero cost for every choosable roster skin (vacuity: the hero bake is wired)', () => {
    expect(Object.keys(HERO_ATLAS_COST_BYTES).length).toBeGreaterThanOrEqual(6)
    for (const r of ROSTER) {
      expect(HERO_ATLAS_COST_BYTES[r.skin], `no baked hero cost for roster skin ${r.skin}`).toBeGreaterThan(0)
    }
  })

  it('prices each roster skin at its exact on-disk HERO atlas byte count', () => {
    let checked = 0
    for (const r of ROSTER) {
      const disk = realHeroAtlasBytes(r.skin)
      expect(disk, `missing hero atlas on disk for ${r.skin}`).toBeGreaterThan(0)
      expect(
        HERO_ATLAS_COST_BYTES[r.skin],
        `baked hero cost for ${r.skin} (${HERO_ATLAS_COST_BYTES[r.skin]}) != on-disk hero atlas ${disk}`,
      ).toBe(disk)
      checked++
    }
    expect(checked).toBe(ROSTER.length) // vacuity: we really compared the roster
    expect(checked).toBeGreaterThan(4)
  })

  it('sums a hero pairing from the same baked bytes the slow opener is priced against', () => {
    // The slow-path admission (isAllowedFirstBout on a constrained link) prices on
    // firstBoutHeroCostBytes; it must be the SAME number as the reduced files sum.
    const a = ROSTER[0].skin
    const b = ROSTER[1].skin
    expect(firstBoutHeroCostBytes(a, b)).toBe(realHeroAtlasBytes(a) + realHeroAtlasBytes(b))
  })

  it('committed hero map is fresh: it deep-equals the reduced sizes on disk right now', () => {
    const onDisk = readHeroAtlasCosts()
    expect(Object.keys(onDisk).length, 'hero reader found no reduced atlases — path/scan broke').toBeGreaterThan(4)
    expect(HERO_ATLAS_COST_BYTES).toEqual(onDisk)
  })

  it('every hero atlas is MATERIALLY smaller than its full atlas (the reduction is real)', () => {
    // If hero ever equalled (or approached) full, opener cost would re-couple to
    // art quality and the whole decoupling would be a no-op. Assert a real cut on
    // every roster skin — today heroes are 0.20–0.27× full (scale 0.5 ⇒ ~¼ area).
    let checked = 0
    for (const r of ROSTER) {
      const full = realAtlasBytes(r.skin)
      const hero = realHeroAtlasBytes(r.skin)
      expect(full, `missing full atlas for ${r.skin}`).toBeGreaterThan(0)
      expect(hero, `missing hero atlas for ${r.skin}`).toBeGreaterThan(0)
      expect(
        hero,
        `hero atlas for ${r.skin} (${hero}) is not materially smaller than full (${full}) — ` +
          `the reduced variant decouples nothing`,
      ).toBeLessThan(full * 0.6)
      checked++
    }
    expect(checked).toBe(ROSTER.length)
    expect(checked).toBeGreaterThan(4)
  })
})
