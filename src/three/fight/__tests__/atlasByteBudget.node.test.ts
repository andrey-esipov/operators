import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Download / disk shipping gate for fighter sprite atlases.
 *
 * The roster shipped 171 MB of atlases as PNG — a hard blocker for a browser
 * game where the player pays that download before the first match (the select
 * screen preloads every roster atlas; a match loads two). Re-encoding each atlas
 * to WebP (`cwebp -q 95 -alpha_q 100 -m 6`, bit-exact/lossless alpha) cut the
 * roster to ~32 MB — a ~5.3x download cut — with ZERO VRAM change, since WebP
 * decodes to the same RGBA the GPU already budgets in atlasVramBudget.node.test.
 * This gate exists so that win cannot silently rot back to PNG.
 *
 * WHY THIS CAN'T LIE:
 *  - It reads the REAL file each manifest's `atlas` field points at, so it gates
 *    exactly what ships, not a stand-in copy on disk.
 *  - Every atlas field must end in `.webp` AND resolve to a file on disk. Repoint
 *    one back at `atlas.png` (the exact regression) and the per-fighter check
 *    reddens.
 *  - The whole-roster total must stay under budget, and no single atlas may be
 *    PNG-sized. Inflate one or re-add a raw PNG and a total/per-atlas check
 *    reddens.
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
// Achieved with `cwebp -q 95 -alpha_q 100 -m 6` across the 11-fighter roster:
// ~32.5 MB total, largest single atlas ~5.8 MB (lenny). The budgets below leave
// modest headroom for a re-encode or a new skin while decisively barring the
// PNG-era 171 MB (or any single un-encoded 15-34 MB atlas) from creeping back.
const ROSTER_ATLAS_BUDGET_BYTES = 38 * MB
const PER_ATLAS_CEILING_BYTES = 12 * MB

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

  it('keeps no single atlas PNG-sized (catches a raw file even if the total still fit)', () => {
    for (const a of atlases) {
      expect(
        a.bytes,
        `${a.id} atlas is ${(a.bytes / MB).toFixed(1)} MB (${a.atlasField}) — looks un-encoded`,
      ).toBeLessThanOrEqual(PER_ATLAS_CEILING_BYTES)
    }
  })
})
