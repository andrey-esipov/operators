import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readAtlasCosts, renderAtlasCostsModule } from './atlasCosts.ts'

/**
 * Generator for the committed atlas-cost module. Baking the reel's per-skin atlas
 * sizes into a REAL file imported by an ordinary specifier — rather than a Vite
 * `virtual:` module — is what lets a plain node/tsx tool (attract-census) import
 * the reel director without ERR_UNSUPPORTED_ESM_URL_SCHEME. Run at dev/build by
 * scripts/atlasCostsPlugin.ts, or by hand:  npx tsx scripts/genAtlasCosts.ts
 */

const HERE = dirname(fileURLToPath(import.meta.url))
export const GENERATED_PATH = resolve(HERE, '../src/screens/attract/atlasCosts.generated.ts')

/** Regenerate the committed module from disk, writing only when it changed.
 *  Returns true iff a write happened. */
export function generateAtlasCosts(): boolean {
  const next = renderAtlasCostsModule(readAtlasCosts())
  const prev = existsSync(GENERATED_PATH) ? readFileSync(GENERATED_PATH, 'utf-8') : ''
  if (prev === next) return false
  writeFileSync(GENERATED_PATH, next)
  return true
}

// CLI: `npx tsx scripts/genAtlasCosts.ts`
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const wrote = generateAtlasCosts()
  console.log(wrote ? `wrote ${GENERATED_PATH}` : `up to date: ${GENERATED_PATH}`)
}
