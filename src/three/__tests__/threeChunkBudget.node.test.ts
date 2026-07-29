import { beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'
import { gzipSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * three.js chunk shipping gate.
 *
 * three.js is the single largest asset a buyer downloads. Once the entry chunk
 * was slimmed (see firstLoadBudget.node.test.ts — three no longer ships in the
 * app shell), three landed in its own lazy chunk at ~272 KB gzip — larger than
 * the whole entry chunk, and the thing a buyer waits on the moment the attract
 * reel or a match mounts.
 *
 * That chunk was measured module-by-module (rollup generateBundle attribution):
 *   three core (three.core.js + three.module.js) ...... 69%  (1,316,531 B rendered)
 *   postprocessing (npm) .............................. 15%  (  278,881 B)
 *   our src/three/* engine ............................ 16%  (  306,430 B)
 *   three examples (BufferGeometryUtils, used) ........  0.4% (    7,632 B)
 *                                                        ----------------------
 *   total rendered ......................... 1,909,474 B  ->  ~272 KB gzip
 *
 * It is NOT meaningfully cuttable, and that was proven rather than assumed:
 *   - tree-shaking already retains 98.2% of three.module.js;
 *   - `import { WebGLRenderer }` pulls the *identical* 120,512 gzip bytes as
 *     `import * as THREE` (esbuild) — a WebGLRenderer game needs nearly all of
 *     three core, so the namespace import is not the cost and a named-import
 *     refactor of all 56 call sites would save ~0;
 *   - there is no duplication (three.module.js imports ./three.core.js — the
 *     normal r0.180 core/module split, one copy) and the 1.8 MB WebGPU build is
 *     absent from the bundle.
 *
 * So this gate is REGRESSION PROTECTION, not a shrink target. The realistic
 * ways this chunk balloons are catastrophic and one edit away:
 *   - someone imports `three/webgpu` or `three/tsl` (the +1.4 MB rendered WebGPU
 *     path) — a single import statement;
 *   - three leaks back into the entry chunk (defeating the first-load fix);
 *   - a new heavy 3D dependency lands in the fight renderer.
 *
 * WHY THIS CAN'T LIE:
 *   - It builds the app in memory (`write:false`) and measures the REAL emitted
 *     chunk. It never reads `dist/` — which is gitignored, may be absent, and
 *     can be stale (this project's most-repeated lying-gate shape). What it
 *     asserts is what Vite actually emits for the current source.
 *   - Vacuity guard: it fails unless it actually FOUND exactly one three-
 *     carrying chunk, that chunk contains BOTH three.core.js and three.module.js,
 *     it has > 12 modules, and it gzips to > 150 KB. A build that emits no three
 *     chunk, or a finder that matches nothing, reddens here instead of passing
 *     blind.
 *   - Positive control: the entry-chunk assertion is only meaningful if an entry
 *     chunk with real modules exists, so it asserts that first (> 12 modules)
 *     before asserting it carries zero three.
 *   - The tight budget is on the DEPENDENCY weight (three + postprocessing
 *     rendered bytes), which is version-pinned and does not move when
 *     combat-feel adds stages/arenas to src/three/*. The whole-chunk gzip
 *     backstop carries deliberately generous headroom precisely because our
 *     engine legitimately grows — this gate must not redden on another agent's
 *     sanctioned art work.
 *
 * Mutation-proven: lowering DEP_BUDGET below the achieved 1,603,044 fails
 * "three + postprocessing dependency weight within budget" with the real byte
 * count in the message; restoring it goes green.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../../..')

// three 0.180.0 + postprocessing are version-pinned; the achieved dependency
// weight is 1,603,044 rendered bytes. ~12% headroom absorbs a patch bump but
// not a WebGPU import (+~1.4 MB) or a new heavy 3D dep.
const DEP_BUDGET = 1_800_000
// Achieved whole-chunk gzip ~272 KB. Generous ~21% headroom, on purpose: the
// tight guard is DEP_BUDGET; this backstop tolerates src/three/* engine growth.
const CHUNK_GZIP_BUDGET = 330_000

interface ChunkInfo {
  code: string
  /** module id -> renderedLength */
  modules: Record<string, number>
  isEntry: boolean
}

let chunks: Record<string, ChunkInfo> = {}
let threeFiles: string[] = []
let threeChunk: ChunkInfo | undefined
let entryChunk: ChunkInfo | undefined

const isThreeCore = (id: string) => id.includes('node_modules/three/build/three.core')
const isThreeModule = (id: string) => id.includes('node_modules/three/build/three.module')
const isThreeDep = (id: string) => id.includes('node_modules/three/')
const isPostprocessingDep = (id: string) => id.includes('node_modules/postprocessing/')
const isWebGPU = (id: string) => /three\.webgpu|three[\\/]webgpu|three[\\/]tsl/.test(id)

beforeAll(async () => {
  chunks = {}
  await build({
    root: ROOT,
    configFile: resolve(ROOT, 'vite.config.ts'),
    logLevel: 'error',
    build: { write: false },
    plugins: [
      {
        name: 'three-chunk-budget-capture',
        generateBundle(_options, bundle) {
          for (const [file, output] of Object.entries(bundle)) {
            const o = output as { type: string; code?: string; modules?: Record<string, { renderedLength?: number }>; isEntry?: boolean }
            if (o.type !== 'chunk') continue
            const modules: Record<string, number> = {}
            for (const [id, m] of Object.entries(o.modules ?? {})) {
              modules[id] = m.renderedLength ?? 0
            }
            chunks[file] = { code: o.code ?? '', modules, isEntry: !!o.isEntry }
          }
        },
      },
    ],
  })

  threeFiles = Object.keys(chunks).filter((f) => Object.keys(chunks[f].modules).some(isThreeCore))
  threeChunk = threeFiles.length ? chunks[threeFiles[0]] : undefined
  entryChunk = Object.values(chunks).find((c) => c.isEntry)
}, 120_000)

describe('three.js chunk shipping budget', () => {
  it('found exactly one substantial three-carrying chunk (vacuity guard)', () => {
    expect(threeFiles.length).toBe(1)
    expect(threeChunk).toBeDefined()
    const ids = Object.keys(threeChunk!.modules)
    // Must carry the real three build, not some incidental re-export.
    expect(ids.some(isThreeCore)).toBe(true)
    expect(ids.some(isThreeModule)).toBe(true)
    expect(ids.length).toBeGreaterThan(12)
    const gzip = gzipSync(Buffer.from(threeChunk!.code)).length
    expect(gzip).toBeGreaterThan(150_000)
  })

  it('keeps three + postprocessing dependency weight within budget', () => {
    const ids = Object.keys(threeChunk!.modules)
    const depBytes = ids
      .filter((id) => isThreeDep(id) || isPostprocessingDep(id))
      .reduce((sum, id) => sum + threeChunk!.modules[id], 0)
    expect(
      depBytes,
      `three + postprocessing rendered weight ${depBytes} exceeds ${DEP_BUDGET} — ` +
        `a WebGPU/tsl import or a new heavy 3D dependency is the usual cause`,
    ).toBeLessThan(DEP_BUDGET)
  })

  it('never bundles the WebGPU build anywhere (catastrophe guard)', () => {
    const offenders: string[] = []
    for (const [file, chunk] of Object.entries(chunks)) {
      if (Object.keys(chunk.modules).some(isWebGPU)) offenders.push(file)
    }
    expect(offenders, `WebGPU build pulled into: ${offenders.join(', ')}`).toEqual([])
  })

  it('keeps three core consolidated in a single chunk (no duplication)', () => {
    const carriers = Object.entries(chunks)
      .filter(([, c]) => Object.keys(c.modules).some(isThreeCore))
      .map(([f]) => f)
    expect(carriers.length, `three.core.js duplicated across: ${carriers.join(', ')}`).toBe(1)
  })

  it('keeps three out of the entry chunk (first-load stays slim)', () => {
    expect(entryChunk, 'no entry chunk emitted').toBeDefined()
    // Positive control: the entry check only means something if the entry chunk
    // actually has real modules to inspect.
    expect(Object.keys(entryChunk!.modules).length).toBeGreaterThan(12)
    const threeInEntry = Object.keys(entryChunk!.modules).filter(isThreeDep)
    expect(threeInEntry, `three leaked into entry: ${threeInEntry.join(', ')}`).toEqual([])
  })

  it('keeps the whole three chunk gzip under the backstop budget', () => {
    const gzip = gzipSync(Buffer.from(threeChunk!.code)).length
    expect(gzip, `three chunk gzip ${gzip} exceeds ${CHUNK_GZIP_BUDGET}`).toBeLessThan(
      CHUNK_GZIP_BUDGET,
    )
  })
})
