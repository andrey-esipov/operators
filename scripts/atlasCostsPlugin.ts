import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/**
 * Vite plugin: bake the attract reel's per-skin atlas download costs from the
 * REAL files on disk, at dev/build/test time, into a virtual module
 * (`virtual:atlas-costs`).
 *
 * WHY THIS EXISTS. `attractLoadCost.ts` needs each choosable skin's on-disk atlas
 * size to keep the first attract bout under the cold-start download ceiling — but
 * it runs in the browser, where it cannot stat a file. That size used to live in
 * a hand-maintained table of six literals shadowing six binary files, and it
 * drifted: the funded art run grows chesky's atlas every commit, and a stale-LOW
 * literal makes the director admit an opener the `reelQuality` gate then reddens
 * on the real bytes. A hand-copied number tracking a binary is a drift class.
 *
 * Baking it here kills that class permanently: there is no committed table to go
 * stale. The director prices openers with the exact bytes `reelQuality` measures
 * on disk, so the two can never disagree, and an atlas re-encode needs no second
 * edit anywhere. `atlasCostBake.node.test.ts` asserts the baked values equal the
 * real files (and that the plugin is actually wired), so a silent regression to
 * an empty or stale map reddens.
 *
 * Map keys are fighter/skin ids (the `public/fighters/<id>` dir name); values are
 * bytes of that fighter's shipped atlas, resolved through its `assets.json`
 * `atlas` field exactly as the runtime loader and the shipping gates do.
 */
export function atlasCostsPlugin(): Plugin {
  const VIRTUAL_ID = 'virtual:atlas-costs'
  const RESOLVED_ID = '\0' + VIRTUAL_ID
  const FIGHTERS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/fighters')
  const PUBLIC_DIR = resolve(FIGHTERS_DIR, '..')

  function readAtlasCosts(): Record<string, number> {
    const costs: Record<string, number> = {}
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
        // is missing too the skin is simply omitted (treated as unknown → heavy →
        // excluded from the first bout by attractLoadCost).
      }
      const diskPath = resolve(PUBLIC_DIR, atlasField.replace(/^\/+/, ''))
      if (existsSync(diskPath)) costs[id] = statSync(diskPath).size
    }
    return costs
  }

  return {
    name: 'operators:atlas-costs',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null
    },
    load(id) {
      if (id !== RESOLVED_ID) return null
      const costs = readAtlasCosts()
      const entries = Object.keys(costs)
        .sort()
        .map((k) => `  ${JSON.stringify(k)}: ${costs[k]},`)
        .join('\n')
      return (
        '// GENERATED at build from public/fighters/*/atlas.webp by ' +
        'scripts/atlasCostsPlugin.ts — do not hand-edit.\n' +
        `export const ATLAS_COST_BYTES = Object.freeze({\n${entries}\n})\n`
      )
    },
  }
}
