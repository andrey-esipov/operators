import ts from 'typescript'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * ONE enumerator of the app's WebGL-engine-owning modules, asked MANY questions.
 *
 * Several node gates need the same underlying list — "every module that
 * constructs a `FightRenderer`/`Engine`" — and then ask their own question of
 * each member:
 *   - `screens/__tests__/shellNav` asks: does it DISPOSE the engine on unmount?
 *   - `play/__tests__/captureCoverage` (impact-vfx) asks: does it APPLY capture
 *     quality?
 * Before this module existed, each gate carried its OWN copy of the filesystem
 * walk + the AST construction detector. That is the exact defect this project
 * keeps paying for — two lists that drift, so a component covered by one gate is
 * invisible to the other, and a capture-quality fix "landed" reaching only the
 * routes its private enumerator happened to see. Factoring the LIST out (and
 * leaving the QUESTION with each gate) makes "the enumerator found everything"
 * a property proven ONCE, in each consumer's non-blindness control, against a
 * single tree walk that new components join automatically.
 *
 * This is test-support only (it lives under `__tests__/`, so it ships in no
 * bundle and is itself excluded from the walk it performs) and does a
 * whole-program filesystem read, so it must run in the node lane, never jsdom.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
/** Absolute path to `src/` (this file lives at `src/__tests__/`). */
export const SRC = resolve(HERE, '..')
/** `src/`-relative POSIX path for stable, readable failure messages. */
export const rel = (abs: string): string => abs.replace(SRC + '/', '')

const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

/** Resolve a *relative* specifier to a real source file, or null. Bare
 *  (node_modules) specifiers return null — external edges can't reach our src. */
export function resolveRelative(fromFile: string, spec: string): string | null {
  const clean = spec.split('?')[0]
  if (!clean.startsWith('.')) return null
  const base = resolve(dirname(fromFile), clean)
  const cands: string[] = []
  if (extname(base)) {
    cands.push(base)
    if (/\.jsx?$/.test(base)) cands.push(base.replace(/\.jsx?$/, '.ts'), base.replace(/\.jsx?$/, '.tsx'))
  }
  for (const e of EXTS) cands.push(base + e)
  for (const e of EXTS) cands.push(resolve(base, 'index' + e))
  return cands.find((c) => existsSync(c)) ?? null
}

/** Every module specifier a file references — static, `export … from`, dynamic
 *  `import()`, `require()`, type-only alike — via the TS preprocessor, which reads
 *  real syntax so a specifier in a comment or string literal is ignored. */
export function edgesOf(file: string): string[] {
  return ts.preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles.map((f) => f.fileName)
}

/** Transitive closure of in-`src` files reachable from `roots` (roots included). */
export function reachableFrom(roots: string[]): Set<string> {
  const seen = new Set<string>()
  const stack = [...roots]
  while (stack.length) {
    const f = stack.pop()
    if (f === undefined || seen.has(f)) continue
    seen.add(f)
    let specs: string[]
    try {
      specs = edgesOf(f)
    } catch {
      continue
    }
    for (const s of specs) {
      const r = resolveRelative(f, s)
      if (r && r.startsWith(SRC + '/') && !seen.has(r)) stack.push(r)
    }
  }
  return seen
}

/** All shipped source files under a dir — excludes `__tests__/` and `*.test.*` /
 *  `*.probe.*`, which are not shipped modules (this file is thereby excluded from
 *  its own enumeration). */
export function shippedSourceUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === '__tests__' || ent.name === 'node_modules') continue
      out.push(...shippedSourceUnder(p))
    } else if (/\.(ts|tsx)$/.test(ent.name) && !/\.(test|probe)\./.test(ent.name)) {
      out.push(p)
    }
  }
  return out
}

/** The engine constructors that mark a module as owning a live WebGL context. */
export const DEFAULT_ENGINE_CTORS = ['FightRenderer', 'Engine'] as const

/** True iff `src` contains a real `new <ctor>(…)` for one of `ctors` — an AST
 *  NewExpression whose callee identifier is in the set. A comment or string that
 *  says "new Engine(" is trivia / a StringLiteral, never a NewExpression, so it
 *  is ignored (the comment-false-positive that bites text scans). */
export function constructsAny(src: string, ctors: Iterable<string>): boolean {
  const want = new Set(ctors)
  const sf = ts.createSourceFile('probe.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found = false
  const visit = (n: ts.Node) => {
    if (found) return
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && want.has(n.expression.text)) {
      found = true
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return found
}

export interface EngineModuleOptions {
  /** Which constructors count as owning an engine. Default:
   *  {@link DEFAULT_ENGINE_CTORS} (`FightRenderer` + `Engine`). Narrow it only to
   *  scope a gate to one engine class. */
  ctors?: readonly string[]
  /** Also require a `useEffect` reference, scoping the set to React components
   *  that MOUNT an engine (excludes the `FightRenderer` wrapper class, whose
   *  engine disposal is a METHOD, not effect cleanup). Both current consumers use
   *  this: shellNav's disposal gate, and impact-vfx's capture-quality gate — which
   *  widened (34167c6) from `['FightRenderer']` to this Engine-owning-component set
   *  so all four routes (play/fight/attract/lab) freeze on capture. */
  requireEffect?: boolean
}

/**
 * The shared LIST: every shipped, non-test module under `src/` that constructs a
 * WebGL engine (per {@link EngineModuleOptions}). Enumerated from the filesystem
 * so a NEW engine-owning module joins automatically — the property each consumer
 * proves is theirs to keep via a non-blindness control asserting the known
 * members are present.
 */
export function engineOwningModules(opts: EngineModuleOptions = {}): string[] {
  const ctors = opts.ctors ?? DEFAULT_ENGINE_CTORS
  return shippedSourceUnder(SRC).filter((f) => {
    const s = readFileSync(f, 'utf8')
    if (opts.requireEffect && !/\buseEffect\b/.test(s)) return false
    return constructsAny(s, ctors)
  })
}

/** A gate's QUESTION: given a module's source (and path), return the reasons it
 *  violates the gate's obligation ([] = compliant). */
export type ModulePredicate = (src: string, file: string) => string[]

/**
 * Ask ONE question of every engine-owning module — the "one list, two questions"
 * seam. Returns a `rel → reasons` line per flagged module (empty overall = all
 * compliant), ready to `expect(...).toEqual([])`. shellNav passes a disposal
 * predicate; impact-vfx's capture gate passes a freeze-quality predicate.
 */
export function auditEngineModules(predicate: ModulePredicate, opts: EngineModuleOptions = {}): string[] {
  const offenders: string[] = []
  for (const f of engineOwningModules(opts)) {
    const reasons = predicate(readFileSync(f, 'utf8'), f)
    if (reasons.length) offenders.push(`${rel(f)} → ${reasons.join('; ')}`)
  }
  return offenders
}
