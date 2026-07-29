import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ATLAS_COST_BYTES, firstBoutCostBytes } from '../attractLoadCost'
import { ROSTER } from '../../../fighthud/select/roster'
import { readAtlasCosts } from '../../../../scripts/atlasCosts.ts'

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
