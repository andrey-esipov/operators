import type { Plugin } from 'vite'
import { generateAtlasCosts, GENERATED_PATH } from './genAtlasCosts.ts'

/**
 * Vite plugin: keep `src/screens/attract/atlasCosts.generated.ts` in sync with the
 * REAL atlas byte sizes on disk at dev/build time.
 *
 * WHY A REAL GENERATED FILE, NOT A VIRTUAL MODULE. The reel's per-skin atlas costs
 * must be baked from disk — a hand-maintained table drifted (the art run grows
 * chesky's atlas every commit, and a stale-LOW literal makes the director admit an
 * opener the `reelQuality` gate then reddens on the real bytes). An earlier version
 * (26b86f6) baked them into a Vite VIRTUAL module, `virtual:atlas-costs`, which
 * ONLY Vite resolves. `tools/attract-census.mjs` imports the reel director, quietly
 * inherited that import, and its documented `npx tsx` invocation began dying with
 * ERR_UNSUPPORTED_ESM_URL_SCHEME — while the vitest suite stayed green, because
 * vitest resolves `virtual:` and a plain node/tsx loader does not. "Passes under
 * vitest" was standing in for "the instrument runs."
 *
 * A committed generated file imported by an ordinary specifier resolves IDENTICALLY
 * under vite, vitest, tsx and plain node, so that whole failure class is gone. This
 * plugin only keeps the file FRESH; the values themselves are authored by
 * scripts/genAtlasCosts.ts and gated by atlasCostBake.node.test.ts (committed file
 * must equal the real bytes on disk), and the run-headless promise is gated by
 * instrumentRunnable.node.test.ts.
 *
 * Skipped under VITEST so the freshness gate always sees the committed file exactly
 * as it was committed. A plugin that regenerated during the test run would heal
 * staleness before the assertion could catch it — the gate would then be blind to
 * precisely the drift it exists to catch.
 */
export function atlasCostsPlugin(): Plugin {
  return {
    name: 'operators:atlas-costs',
    buildStart() {
      if (process.env.VITEST) return
      if (generateAtlasCosts()) {
        this.warn(`regenerated ${GENERATED_PATH} from on-disk atlas sizes`)
      }
    },
  }
}
