import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * First-load bundle budget — the ThreeJS fight engine must NOT ship in the app's
 * entry chunk.
 *
 * The defect this gate exists to prevent: `App.tsx` wraps the attract reel in
 * `lazy()` so the ~600 KB `three` module + the whole `FightRenderer` stack split
 * into an on-demand chunk. But `MainMenu.tsx` *also* imported `AttractMode`, and
 * statically — which silently defeats the split. Vite says so out loud at build
 * time ("dynamically imported by App.tsx but also statically imported by
 * MainMenu.tsx, dynamic import will not move module into another chunk"), and the
 * entry chunk measured 1,667 KB / 513 KB gzip with three baked in. A buyer
 * downloaded the entire 3D renderer as JavaScript before the title screen — the
 * first thing they see and the first thing they must wait on to press START —
 * was even interactive. Making the `MainMenu` import lazy too drops the entry
 * chunk to 640 KB / 197 KB gzip and moves three behind the fight route where it
 * belongs.
 *
 * WHY THIS CAN'T LIE (build-free, always current, non-vacuous):
 *  - It reads the REAL source on disk and walks the STATIC import graph from the
 *    true entry (`main.tsx`). A module reachable from the entry through only
 *    static `import`s lands in the entry chunk; one reached only through a
 *    dynamic `import()` splits out. So "is `three` statically reachable from the
 *    entry?" is exactly "is `three` in the first-load chunk?" — with no build to
 *    go stale and no `dist/` to read a different revision than ships.
 *  - Type-only imports are skipped (erased at build, never bundled); dynamic
 *    `import()` is a split boundary and is not followed.
 *  - Vacuity guard: the walk must reach a substantial graph AND a known-eager
 *    module (`MainMenu`, which `App` imports statically). A resolver that
 *    silently finds nothing reddens here instead of passing blind — this
 *    project's single most common failure mode.
 *  - Positive control: the same walker, pointed at the reel itself, MUST reach
 *    three. If it can't (broken resolution), the entry's "zero three" is
 *    meaningless — so a blind walker fails the control instead of green-washing.
 *
 * Mutation-proven: restore `MainMenu`'s import to a static
 * `import { AttractMode } from './AttractMode'` and both "imports zero three.js"
 * and "keeps the FightRenderer out" go red, naming the leaked modules.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '../..') // src/
const ENTRY = resolve(SRC, 'main.tsx')
const REEL = resolve(SRC, 'screens/AttractMode.tsx')
const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs']

const rel = (abs: string) => abs.replace(SRC + '/', '')

/** Resolve a *relative* specifier to a real source file, or null. Bare
 *  (node_modules) specifiers return null — they are tracked separately by name. */
function resolveRelative(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(fromFile), spec)
  const cands: string[] = []
  if (extname(base)) cands.push(base)
  for (const e of EXTS) cands.push(base + e)
  for (const e of EXTS) cands.push(resolve(base, 'index' + e))
  return cands.find((c) => existsSync(c)) ?? null
}

interface Specs {
  /** Relative static import/export specifiers (bundled edges we follow). */
  staticRel: string[]
  /** Bare static specifiers (e.g. 'three', 'react') imported by this file. */
  staticBare: string[]
  /** Specifiers of dynamic `import('…')` calls (split boundaries). */
  dynamic: string[]
}

/** Parse one file's static imports (skipping type-only) and dynamic imports. */
function scan(file: string): Specs {
  const sf = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const staticRel: string[] = []
  const staticBare: string[] = []
  const dynamic: string[] = []

  const visit = (node: ts.Node): void => {
    // Static `import … from '…'` — the value form only; type-only is erased.
    if (ts.isImportDeclaration(node)) {
      if (!node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
        const s = node.moduleSpecifier.text
        ;(s.startsWith('.') ? staticRel : staticBare).push(s)
      }
      return
    }
    // Re-export `export … from '…'` also bundles the target module.
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) {
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        const s = node.moduleSpecifier.text
        ;(s.startsWith('.') ? staticRel : staticBare).push(s)
      }
      return
    }
    // Dynamic `import('…')` — a code-split boundary; recorded, never followed.
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      dynamic.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { staticRel, staticBare, dynamic }
}

interface Graph {
  /** Every code module reachable from the root through static edges. */
  modules: Set<string>
  /** Reachable modules that statically import `three` — must be empty at entry. */
  threeImporters: string[]
  /** All dynamic-import specifiers seen anywhere in the reachable graph. */
  dynamicSpecs: string[]
}

/** BFS the static import graph from `root`, never crossing a dynamic import. */
function walkStatic(root: string): Graph {
  const modules = new Set<string>([root])
  const queue = [root]
  const threeImporters: string[] = []
  const dynamicSpecs: string[] = []

  while (queue.length) {
    const file = queue.shift()!
    const { staticRel, staticBare, dynamic } = scan(file)
    if (staticBare.some((b) => b === 'three' || b.startsWith('three/'))) {
      threeImporters.push(file)
    }
    dynamicSpecs.push(...dynamic)
    for (const spec of staticRel) {
      const r = resolveRelative(file, spec)
      if (r && /\.(ts|tsx|js|jsx|mjs)$/.test(r) && !modules.has(r)) {
        modules.add(r)
        queue.push(r)
      }
    }
  }
  return { modules, threeImporters, dynamicSpecs }
}

describe('first-load bundle budget: ThreeJS must not ship in the entry chunk', () => {
  const eager = walkStatic(ENTRY)

  it('walks a real eager graph rooted at the app entry (vacuity guard)', () => {
    // Measured 30 modules. A resolver that finds nothing makes every budget
    // below vacuously green, so require a substantial graph AND a known-eager
    // module the entry imports statically.
    expect(eager.modules.size).toBeGreaterThan(12)
    expect([...eager.modules].map(rel)).toContain('screens/MainMenu.tsx')
  })

  it('imports zero three.js into the first-load (entry) chunk', () => {
    const leaked = eager.threeImporters.map(rel)
    expect(
      leaked,
      `three.js is statically reachable from the app entry via:\n  ${leaked.join('\n  ')}`,
    ).toEqual([])
  })

  it('keeps the ThreeJS fight engine and attract reel out of the eager graph', () => {
    const leaked = [...eager.modules]
      .map(rel)
      .filter((m) => m.startsWith('three/') || m.endsWith('screens/AttractMode.tsx'))
    expect(
      leaked,
      `these fight-engine modules are eagerly reachable and will bloat the entry chunk:\n  ${leaked.join('\n  ')}`,
    ).toEqual([])
  })

  it('still wires the attract reel behind a dynamic import (not deleted)', () => {
    // Guards against "passing the gate by deleting the reel": the reel must
    // still be imported, just dynamically (by App and/or MainMenu).
    const wired = eager.dynamicSpecs.some((s) => s.replace(/.*\//, '') === 'AttractMode')
    expect(wired, 'no dynamic import() of AttractMode found in the eager graph').toBe(true)
  })

  it('positive control: the walker DOES reach three when a static path exists', () => {
    // Proves the entry result is a real zero, not a blind walker. From the reel
    // itself, three must be statically reachable (measured 40 importers).
    const fromReel = walkStatic(REEL)
    expect(fromReel.threeImporters.length).toBeGreaterThan(0)
  })
})
