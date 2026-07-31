import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Download / disk shipping gate for fighter sprite atlases.
 *
 * The roster shipped 171 MB of atlases as PNG — a hard blocker for a browser
 * game. Re-encoding each atlas to WebP (`cwebp -q 95 -alpha_q 100 -m 6`,
 * bit-exact/lossless alpha) cut the roster to ~32 MB — a ~5.3x download cut —
 * with ZERO VRAM change, since WebP decodes to the same RGBA the GPU already
 * budgets in atlasVramBudget.node.test. This gate exists so that win cannot
 * silently rot back to PNG.
 *
 * STALE PREMISE CORRECTED (verified in source, not assumed): this header used to
 * justify the roster total with "the select screen preloads every roster atlas;
 * a match loads two". The first half has not been true since the baked-portrait
 * work landed. `preloadVsPortrait` warms the baked `portrait.png` still, every
 * roster fighter ships one, `FightSelect.tsx:98` states "the grid never pulls a
 * full atlas", and HeroRender fetches a full atlas on demand ONE fighter at a
 * time. That surface is owned by selectAssetBudget.node.test's EAGER_ROSTER_BUDGET
 * (8 MB, 5.06 MB achieved) — whose OWN mutation proof is "repoint fighterPortrait()
 * at fighterAtlas() and it reds", i.e. a select screen pulling full atlases is the
 * documented REGRESSION, not the shipped behaviour. Keeping a superseded premise
 * here mattered: it was the stated reason the roster sum was calibrated where it
 * was, so legitimate art growth was being priced against a download nobody makes.
 *
 * What this file actually gates today:
 *  - No PNG rot: every manifest atlas must end in `.webp` and resolve on disk.
 *  - No un-encoded single file: PER_ATLAS_CEILING_BYTES.
 *  - The REAL atlas download a buyer pays: a match loads TWO full atlases. That
 *    claim was asserted in prose here and never tested; it is now a test.
 *  - A coarse whole-roster disk/shipping backstop.
 *
 * WHY THIS CAN'T LIE:
 *  - It reads the REAL file each manifest's `atlas` field points at, so it gates
 *    exactly what ships, not a stand-in copy on disk.
 *  - Every atlas field must end in `.webp` AND resolve to a file on disk. Repoint
 *    one back at `atlas.png` (the exact regression) and the per-fighter check
 *    reddens.
 *  - The worst-case match pair, the whole-roster total, and each single atlas all
 *    have ceilings. Inflate one and a check reddens.
 *  - Vacuity guard: it must find > 8 fighters. A gate that checks zero fighters
 *    and passes is this project's single most common failure mode — fail loudly.
 *
 * Mutation-proven: repointing chesky's manifest at `atlas.png` fails "every
 * fighter ships a real .webp atlas its manifest points at"; inflating one
 * `atlas.webp` past the ceiling fails the total and per-atlas budget checks.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = resolve(HERE, '../../../../public')
const FIGHTERS_DIR = resolve(PUBLIC_DIR, 'fighters')

const MB = 1024 * 1024
// Encode policy is `cwebp -q 95 -alpha_q 100 -m 6` (sharp: quality 95,
// alphaQuality 100, effort 6) across the 11-fighter roster.
//
// The roster total is a coarse DISK/SHIPPING backstop, not a buyer-download
// figure — see the stale-premise note in the header. It was 38 MB against a
// ~32.5 MB roster. Two fighters have since been brought from impoverished to
// roster parity (madhavan 0.94→3.45 MB, turley 3.22→5.42 MB) by regenerating
// against cached raws — no new art, no API spend, and it closed a graded
// "reads DEAD" locomotion defect. Pricing that against a superseded select
// preload is the ratchet this project has documented three times: a ceiling
// that tightens as art improves is structurally wrong however it is tuned.
// Re-based on the real roster (39.08 MB) with the same ~13% headroom the
// original used, so the anti-PNG teeth keep biting (171 MB, or any single
// un-encoded 15–34 MB atlas, still reddens instantly) without taxing parity.
const ROSTER_ATLAS_BUDGET_BYTES = 44 * MB
const PER_ATLAS_CEILING_BYTES = 12 * MB
// The atlas bytes a buyer ACTUALLY pays for: PlayableMatch/FightHarness/AttractMode
// each load exactly two full atlases (`loadFighterAtlas(aId)`, `loadFighterAtlas(bId)`).
// The worst case is therefore the two heaviest atlases on the roster, currently
// lenny 5.74 + doshi 5.67 = 11.41 MB. This is the assertion the header claimed in
// prose for the file's whole history and never made.
const WORST_MATCH_PAIR_BUDGET_BYTES = 14 * MB

interface Atlas {
  id: string
  atlasField: string
  diskPath: string
  exists: boolean
  bytes: number
}

function loadAtlases(): Atlas[] {
  return readdirSync(FIGHTERS_DIR)
    .filter((id) => existsSync(resolve(FIGHTERS_DIR, id, 'assets.json')))
    .map((id) => {
      const manifest = JSON.parse(
        readFileSync(resolve(FIGHTERS_DIR, id, 'assets.json'), 'utf-8'),
      ) as { atlas?: string }
      const atlasField = manifest.atlas ?? ''
      // The manifest field is an absolute web path ("/fighters/<id>/atlas.webp");
      // resolve it against public/ to gate the actual file the browser fetches.
      const diskPath = resolve(PUBLIC_DIR, atlasField.replace(/^\/+/, ''))
      const exists = atlasField !== '' && existsSync(diskPath)
      return { id, atlasField, diskPath, exists, bytes: exists ? statSync(diskPath).size : 0 }
    })
    .sort((a, b) => b.bytes - a.bytes)
}

describe('fighter atlas download budget', () => {
  const atlases = loadAtlases()

  it('finds the fighter atlases it is meant to gate', () => {
    // If this drops to zero (or the roster shrinks) the budget checks below go
    // vacuously true — the classic lying harness. Fail loudly instead.
    expect(atlases.length).toBeGreaterThan(8)
  })

  it('has every fighter ship a real .webp atlas its manifest points at', () => {
    for (const a of atlases) {
      expect(a.atlasField, `${a.id}: manifest has no atlas field`).not.toBe('')
      expect(
        a.atlasField.endsWith('.webp'),
        `${a.id}: manifest atlas "${a.atlasField}" is not a .webp — the roster must ship WebP, not PNG`,
      ).toBe(true)
      expect(
        a.exists,
        `${a.id}: manifest atlas "${a.atlasField}" resolves to a missing file (${a.diskPath})`,
      ).toBe(true)
    }
  })

  it('keeps the whole-roster atlas download under budget', () => {
    const total = atlases.reduce((s, a) => s + a.bytes, 0)
    const detail = atlases.map((a) => `${a.id}=${(a.bytes / MB).toFixed(2)}MB`).join(' ')
    expect(
      total,
      `roster atlas download ${(total / MB).toFixed(1)} MB exceeds ${(
        ROSTER_ATLAS_BUDGET_BYTES / MB
      ).toFixed(0)} MB budget\n  ${detail}`,
    ).toBeLessThanOrEqual(ROSTER_ATLAS_BUDGET_BYTES)
  })

  it('keeps the worst-case match download (two full atlases) under budget', () => {
    // `atlases` is sorted heaviest-first, so the worst pair a matchup can ask for
    // is the top two. Anything that inflates a heavy atlas reddens here BEFORE the
    // roster sum notices, because this is the number a buyer actually waits on.
    expect(atlases.length, 'need at least two atlases to form a match pair').toBeGreaterThan(1)
    const [a, b] = atlases
    const pair = a.bytes + b.bytes
    expect(
      pair,
      `worst match pair ${a.id}+${b.id} = ${(pair / MB).toFixed(2)} MB exceeds ${(
        WORST_MATCH_PAIR_BUDGET_BYTES / MB
      ).toFixed(0)} MB budget`,
    ).toBeLessThanOrEqual(WORST_MATCH_PAIR_BUDGET_BYTES)
  })

  it('keeps no single atlas PNG-sized (catches a raw file even if the total still fit)', () => {
    for (const a of atlases) {
      expect(
        a.bytes,
        `${a.id} atlas is ${(a.bytes / MB).toFixed(1)} MB (${a.atlasField}) — looks un-encoded`,
      ).toBeLessThanOrEqual(PER_ATLAS_CEILING_BYTES)
    }
  })
})
