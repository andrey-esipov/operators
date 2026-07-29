import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Single source of truth for the attract reel's per-skin atlas DOWNLOAD costs,
 * read from the REAL files on disk.
 *
 * `attractLoadCost.ts` needs each choosable skin's shipped-atlas byte size to keep
 * the first attract bout under the cold-start download budget, but it runs in the
 * browser where it cannot stat a file. Those sizes used to be a hand-maintained
 * table of literals shadowing binaries, and it drifted (the funded art run grows
 * chesky's atlas every commit). This module reads them from disk instead, and is
 * imported by everything that needs to agree on the number:
 *   - scripts/genAtlasCosts.ts        — writes the committed generated module
 *   - scripts/atlasCostsPlugin.ts     — keeps that module fresh at dev/build
 *   - atlasCostBake.node.test.ts      — freshness gate (committed file == disk)
 *
 * Keys are fighter/skin ids (the `public/fighters/<id>` dir name); values are the
 * bytes of that fighter's shipped atlas, resolved through its `assets.json`
 * `atlas` field EXACTLY as the runtime loader and the shipping byte gates do.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const FIGHTERS_DIR = resolve(HERE, '../public/fighters')
const PUBLIC_DIR = resolve(FIGHTERS_DIR, '..')

export type AtlasCostMap = Record<string, number>

/** Read skin id → shipped atlas byte size from disk. A skin whose atlas file is
 *  missing is omitted (treated as unknown → heavy → excluded from the cold first
 *  bout by attractLoadCost, never optimistically allowed onto it). */
export function readAtlasCosts(): AtlasCostMap {
  const costs: AtlasCostMap = {}
  if (!existsSync(FIGHTERS_DIR)) return costs
  for (const id of readdirSync(FIGHTERS_DIR)) {
    const manifestPath = resolve(FIGHTERS_DIR, id, 'assets.json')
    if (!existsSync(manifestPath)) continue
    let atlasField = `/fighters/${id}/atlas.webp`
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { atlas?: unknown }
      if (typeof parsed.atlas === 'string') atlasField = parsed.atlas
    } catch {
      // A malformed manifest falls back to the conventional atlas path; if that
      // is missing too the skin is simply omitted.
    }
    const diskPath = resolve(PUBLIC_DIR, atlasField.replace(/^\/+/, ''))
    if (existsSync(diskPath)) costs[id] = statSync(diskPath).size
  }
  return costs
}

/** Render the committed generated module from a cost map. Keys are sorted so an
 *  unchanged roster produces a byte-identical file (write-if-changed is a no-op). */
export function renderAtlasCostsModule(costs: AtlasCostMap): string {
  const entries = Object.keys(costs)
    .sort()
    .map((k) => `  ${JSON.stringify(k)}: ${costs[k]},`)
    .join('\n')
  return (
    '// GENERATED from public/fighters/*/assets.json (real on-disk atlas byte\n' +
    '// sizes) by scripts/genAtlasCosts.ts — DO NOT hand-edit. Regenerate with:\n' +
    '//   npx tsx scripts/genAtlasCosts.ts\n' +
    '// scripts/atlasCostsPlugin.ts keeps it fresh at dev/build; freshness is gated\n' +
    '// by src/screens/attract/__tests__/atlasCostBake.node.test.ts.\n' +
    'export const ATLAS_COST_BYTES: Readonly<Record<string, number>> = Object.freeze({\n' +
    entries +
    '\n})\n'
  )
}
