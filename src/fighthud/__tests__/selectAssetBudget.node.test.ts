import { describe, expect, it } from 'vitest'
import { existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STAGES } from '../select/roster'
import { stageThumb, stageFull } from '../select/stageAssets'

/**
 * Select-screen asset-weight gate. The v10 critic measured that the stage phase
 * eagerly downloaded ~15 MB: preloadStages() fired an Image() for all eight
 * arenas and stageThumb() returned the full 1.5–2.5 MB hero render, which the
 * 8-card ribbon then painted into ~200 px plates. On a mid-tier connection
 * that's seconds of empty plates — the exact load race the preload claimed to
 * prevent, front-loaded instead of fixed.
 *
 * The fix is a display-size contract (see select/stageAssets.ts): the ribbon
 * loads small thumbs, the full render is fetched on demand for the one big
 * preview. This gate keeps that contract honest.
 *
 * WHY THIS CAN'T LIE (each budget is tied to the REAL path the app renders):
 *  - The eager total sums stageThumb(id) for the *actual* roster (STAGES) — the
 *    same function FightSelect renders into the ribbon. Repoint stageThumb back
 *    at /stages/<id>.png and this sums ~15 MB > 1.5 MB → red, even though every
 *    file still exists.
 *  - "thumb is a real downscale, not the full render" asserts the thumb weighs a
 *    fraction of the full asset, so aliasing the thumb to the full path (or
 *    copying the render in) reddens even if the byte budget were loosened.
 *  - The stage list is asserted non-empty first, so none of the budgets can go
 *    vacuously green by measuring nothing (the classic lying harness).
 *
 * Mutation-proven: change stageThumb() to `/stages/${id}.png` and both "eager
 * ribbon payload within budget" and "thumbnails are real downscales" go red;
 * delete a thumb and "every ribbon thumbnail exists" goes red.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = resolve(HERE, '../../../public')

const KB = 1024
const MB = 1024 * 1024
const PER_THUMB_MAX = 300 * KB // a display-sized ribbon plate, generously
const EAGER_RIBBON_BUDGET = 1.5 * MB // all 8 thumbs at once; ~10× under the 15 MB regression
const PER_FULL_MAX = 3 * MB // an on-hover full render must stay reasonable
const THUMB_SHARE_MAX = 0.2 // thumbs must be a real downscale: < 20% of the full payload

/** Disk path for a `/…`-rooted public URL. */
function diskPath(publicUrl: string): string {
  return resolve(PUBLIC_DIR, publicUrl.replace(/^\/+/, ''))
}
function bytes(publicUrl: string): number {
  return statSync(diskPath(publicUrl)).size
}

describe('select stage asset weight', () => {
  it('finds the stages it is meant to gate', () => {
    // If this is empty every budget below is vacuously satisfied. Fail loudly.
    expect(STAGES.length).toBeGreaterThanOrEqual(6)
  })

  it('ships a ribbon thumbnail for every stage', () => {
    for (const s of STAGES) {
      const p = diskPath(stageThumb(s.id))
      expect(existsSync(p), `missing ribbon thumb for ${s.id}: ${stageThumb(s.id)}`).toBe(true)
    }
  })

  it('keeps every ribbon thumbnail display-sized', () => {
    for (const s of STAGES) {
      const b = bytes(stageThumb(s.id))
      expect(
        b,
        `${s.id} thumb ${(b / KB).toFixed(0)} KB exceeds ${(PER_THUMB_MAX / KB).toFixed(0)} KB`,
      ).toBeLessThanOrEqual(PER_THUMB_MAX)
    }
  })

  it('keeps the eager ribbon payload within budget', () => {
    // This is the headline number the critic measured. The ribbon shows all 8
    // thumbs the moment the stage phase opens, so this sum is what the screen
    // eagerly pulls. Repointing stageThumb() at the full renders sums ~15 MB.
    const total = STAGES.reduce((sum, s) => sum + bytes(stageThumb(s.id)), 0)
    expect(
      total,
      `eager ribbon = ${(total / MB).toFixed(2)} MB exceeds ${(EAGER_RIBBON_BUDGET / MB).toFixed(2)} MB`,
    ).toBeLessThanOrEqual(EAGER_RIBBON_BUDGET)
  })

  it('serves thumbnails that are real downscales of the full renders', () => {
    const thumbTotal = STAGES.reduce((sum, s) => sum + bytes(stageThumb(s.id)), 0)
    const fullTotal = STAGES.reduce((sum, s) => sum + bytes(stageFull(s.id)), 0)
    for (const s of STAGES) {
      expect(stageThumb(s.id), `${s.id} thumb aliases the full render`).not.toBe(stageFull(s.id))
    }
    expect(
      thumbTotal / fullTotal,
      `thumbs are ${((thumbTotal / fullTotal) * 100).toFixed(0)}% of the full payload — not a real downscale`,
    ).toBeLessThan(THUMB_SHARE_MAX)
  })

  it('keeps each on-demand full render under the per-image ceiling', () => {
    for (const s of STAGES) {
      const p = diskPath(stageFull(s.id))
      expect(existsSync(p), `missing full render for ${s.id}`).toBe(true)
      const b = bytes(stageFull(s.id))
      expect(
        b,
        `${s.id} full render ${(b / MB).toFixed(2)} MB exceeds ${(PER_FULL_MAX / MB).toFixed(2)} MB`,
      ).toBeLessThanOrEqual(PER_FULL_MAX)
    }
  })
})
