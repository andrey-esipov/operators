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

export type AtlasCostMap = Record<string, number>

/** Read skin id → atlas byte size from disk, resolving each id's `atlas` field
 *  from `manifestName` EXACTLY as the runtime loader and byte gates do. A skin
 *  whose manifest or atlas file is missing is omitted (treated as unknown →
 *  heavy → excluded from the cold first bout, never optimistically allowed).
 *  `fightersDir` is parameterised so a gate can point it at a fixture dir. */
function readCostsFrom(fightersDir: string, manifestName: string, fallbackAtlas: (id: string) => string): AtlasCostMap {
  const costs: AtlasCostMap = {}
  if (!existsSync(fightersDir)) return costs
  const publicDir = resolve(fightersDir, '..')
  for (const id of readdirSync(fightersDir)) {
    const manifestPath = resolve(fightersDir, id, manifestName)
    if (!existsSync(manifestPath)) continue
    let atlasField = fallbackAtlas(id)
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { atlas?: unknown }
      if (typeof parsed.atlas === 'string') atlasField = parsed.atlas
    } catch {
      // A malformed manifest falls back to the conventional atlas path; if that
      // is missing too the skin is simply omitted.
    }
    const diskPath = resolve(publicDir, atlasField.replace(/^\/+/, ''))
    if (existsSync(diskPath)) costs[id] = statSync(diskPath).size
  }
  return costs
}

/** Read skin id → shipped FULL atlas byte size (`assets.json`). */
export function readAtlasCosts(fightersDir: string = FIGHTERS_DIR): AtlasCostMap {
  return readCostsFrom(fightersDir, 'assets.json', (id) => `/fighters/${id}/atlas.webp`)
}

/** Read skin id → reduced HERO opener-atlas byte size (`assets.hero.json`). Only
 *  skins that carry a hero manifest appear; on a slow link the opener is priced
 *  and served from THIS map, decoupling opener cost from full-atlas growth. */
export function readHeroAtlasCosts(fightersDir: string = FIGHTERS_DIR): AtlasCostMap {
  return readCostsFrom(fightersDir, 'assets.hero.json', (id) => `/fighters/${id}/atlas.hero.webp`)
}

function renderFrozenMap(name: string, costs: AtlasCostMap): string {
  const entries = Object.keys(costs)
    .sort()
    .map((k) => `  ${JSON.stringify(k)}: ${costs[k]},`)
    .join('\n')
  return `export const ${name}: Readonly<Record<string, number>> = Object.freeze({\n${entries}\n})\n`
}

/** Render the committed generated module from the full + hero cost maps. Keys are
 *  sorted so an unchanged roster produces a byte-identical file (write-if-changed
 *  is a no-op). */
export function renderAtlasCostsModule(costs: AtlasCostMap, heroCosts: AtlasCostMap = {}): string {
  return (
    '// GENERATED from public/fighters/*/assets.json + assets.hero.json (real\n' +
    '// on-disk atlas byte sizes) by scripts/genAtlasCosts.ts — DO NOT hand-edit.\n' +
    '// Regenerate with:  npx tsx scripts/genAtlasCosts.ts\n' +
    '// scripts/atlasCostsPlugin.ts keeps it fresh at dev/build; freshness is gated\n' +
    '// by src/screens/attract/__tests__/atlasCostBake.node.test.ts.\n' +
    renderFrozenMap('ATLAS_COST_BYTES', costs) +
    '\n' +
    '// Reduced "hero" opener-atlas sizes. On a reported-slow link the attract\n' +
    '// opener (bout 1) is served AND priced from these, so improving a fighter\'s\n' +
    '// FULL art can no longer cost it an opener pairing — see attractLoadCost.ts.\n' +
    renderFrozenMap('HERO_ATLAS_COST_BYTES', heroCosts)
  )
}
