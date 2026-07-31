import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildHeroAtlas, HERO_ATLAS_SCALE } from './lib/heroAtlas.ts'
import { ROSTER } from '../src/fighthud/select/roster.ts'

/**
 * Generate the reduced "hero" opener atlas + manifest for every roster skin.
 *
 * For each choosable fighter this reads `public/fighters/<id>/{assets.json,
 * atlas.webp}` and writes `atlas.hero.webp` (downscaled by HERO_ATLAS_SCALE) plus
 * `assets.hero.json` (same manifest with every frame rect/anchor scaled by the
 * same factor and the `atlas` field repointed). The renderer is
 * resolution-independent, so the hero pair renders at an identical world size and
 * pose, only lower fidelity — see scripts/lib/heroAtlas.ts.
 *
 * Idempotent (write-if-changed), so committing the output and re-running is a
 * no-op. The hero BYTE costs are baked separately into the generated cost module
 * by scripts/genAtlasCosts.ts (run it after this). Run:
 *   npx tsx scripts/genHeroAtlas.ts
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = resolve(HERE, '../public')

export async function generateHeroAtlases(): Promise<void> {
  const mb = (n: number) => (n / 1_000_000).toFixed(2)
  let wrote = 0
  for (const entry of ROSTER) {
    const r = await buildHeroAtlas(entry.skin, PUBLIC_DIR)
    if (!r) {
      console.warn(`skip ${entry.skin}: no manifest/atlas on disk`)
      continue
    }
    const changed = r.wroteAtlas || r.wroteManifest
    if (changed) wrote++
    console.log(
      `${r.id.padEnd(9)} ${r.fullDim[0]}x${r.fullDim[1]} ${mb(r.fullBytes)}MB` +
        ` → ${r.heroDim[0]}x${r.heroDim[1]} ${mb(r.heroBytes)}MB` +
        `  (${(r.heroBytes / r.fullBytes * 100).toFixed(0)}% of full)` +
        (changed ? '  [wrote]' : '  [up to date]'),
    )
  }
  console.log(`\nscale ${HERO_ATLAS_SCALE} · ${wrote} skin(s) updated · run \`npx tsx scripts/genAtlasCosts.ts\` next`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  generateHeroAtlases().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
