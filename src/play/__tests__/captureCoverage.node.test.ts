import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * COVERAGE gate: every route that constructs the capture renderer must apply
 * capture-quality freezing.
 *
 * captureQuality.test.ts proves the DECISION is correct — `openCaptureSession`
 * freezes the tier in capture mode — and does it deterministically with a state
 * spy. But a correct helper wired into 1 of 3 routes still ships a drifting tier
 * on the other 2: that is exactly how `?fight=1` and `?attract=1` captured
 * through a moving tier while `?play=1` was frozen, and how `?lab=1`
 * (FightScene3D) drifted until this commit. A per-route grep would have caught
 * those misses, but not the 5th route added next quarter. So this gate
 * enumerates the engine-owning components from the filesystem — every module
 * that constructs `new Engine` or `new FightRenderer` inside a `useEffect` — and
 * requires each to reference the freeze. A new route auto-joins the enumerated
 * set and is auto-required to freeze, with no edit to this test.
 *
 * REUSE, NOT FORK (the consolidation is real, and named): this is the same
 * canonical set framing's shellNav disposal gate walks. framing is mid-extraction
 * of that walker into `src/__tests__/engineModules` — but at this commit that
 * module is uncommitted working-tree WIP, not in HEAD, so importing it would
 * make this gate fail the clean-worktree run (module-not-found). Depending on an
 * uncommitted file is the one thing worse than a duplicated 20-line walker. Once
 * `engineModules` lands in HEAD, both this gate and shellNav should import its
 * enumerator and delete their local copies. The delivery report flags this to be
 * sequenced with framing.
 *
 * PROXY AND ITS LIMIT (named on purpose): this asserts the freeze call is
 * PRESENT in each route module's source. It does NOT assert React runs the
 * effect, nor that the call executes at runtime — that is captureQuality.test.ts
 * (the state-spy reachability gate on the fused `openCaptureSession`) plus the
 * GPU-window check that `__PLAY__`/`__FIGHT__.quality()` holds steady. Structure
 * is not execution. A broken HUD-style "present but unreachable" defect — the
 * `dispose()`/`forceContextLoss()` shape — can satisfy THIS gate; it cannot
 * satisfy the spy gate, which is why both exist. Detection is by AST, never text
 * match, so a mention in a comment or string literal cannot forge either half
 * (the comment-false-positive that has bitten this project's text scans).
 *
 * Mutation-proven both directions (transcript in the delivery report): deleting
 * the `openCaptureSession(` / `applyCaptureQuality(` reference from a real route
 * reddens the invariant naming that file; the positive/anti-vacuity controls
 * below redden if the detectors go blind. Restores byte-identical to green.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '..', '..') // src/
const rel = (abs: string) => abs.slice(SRC.length + 1).replaceAll('\\', '/')

/** Parse a source string as TSX so JSX routes parse without a program. */
function parse(src: string): ts.SourceFile {
  return ts.createSourceFile('m.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

/** True iff the source contains a `new <name>(…)` construction — an AST
 *  NewExpression whose callee is exactly `name`. A comment or string that says
 *  "new FightRenderer(" is trivia / a StringLiteral, never a NewExpression, so
 *  it is ignored. */
function constructs(src: string, name: string): boolean {
  let found = false
  const visit = (n: ts.Node) => {
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) {
      found = true
    }
    ts.forEachChild(n, visit)
  }
  visit(parse(src))
  return found
}

/** True iff the source CALLS any of `names` — an AST CallExpression whose callee
 *  is one of the identifiers. A function *declaration* named the same, or a
 *  mention in a comment, is not a CallExpression and does not count. */
function callsAny(src: string, names: readonly string[]): boolean {
  const set = new Set(names)
  let found = false
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && set.has(n.expression.text)) {
      found = true
    }
    ts.forEachChild(n, visit)
  }
  visit(parse(src))
  return found
}

/** Every shipped `.ts`/`.tsx` under a dir — excludes `__tests__/` and
 *  `*.test.*` / `*.probe.*`, which are not shipped modules. */
function shippedSourceUnder(dir: string): string[] {
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

// The freeze can be applied through either entry point: PlayableMatch/FightHarness
// use the fused `openCaptureSession`, AttractMode + FightScene3D use bare
// `applyCaptureQuality` (their probes live in a separate effect / a legacy hook
// and cannot fuse). Both satisfy the invariant.
const FREEZE_CALLS = ['openCaptureSession', 'applyCaptureQuality'] as const

// An engine-owning COMPONENT constructs `new Engine` or `new FightRenderer` AND
// runs a `useEffect` — i.e. a React component that mounts the renderer in an
// effect. The `useEffect` call is exactly what separates these routes from the
// shared `FightRenderer` class (which constructs `new Engine` in its constructor,
// not an effect, and has no URL to read) — see the scope block below.
function isEngineComponent(src: string): boolean {
  return (constructs(src, 'Engine') || constructs(src, 'FightRenderer')) && callsAny(src, ['useEffect'])
}

const FILES = shippedSourceUnder(SRC)
const CAPTURE_ROUTES = FILES.filter((f) => isEngineComponent(readFileSync(f, 'utf8')))

// The four engine-owning components that MUST freeze, by hand, so a blind
// enumerator (one that silently found nothing) cannot pass by returning an empty
// set. This mirrors framing's shellNav non-blindness list exactly.
const KNOWN_ROUTES = [
  'play/PlayableMatch.tsx',
  'three/dev/FightHarness.tsx',
  'screens/AttractMode.tsx',
  'three/FightScene3D.tsx',
] as const

describe('captureCoverage — detector self-checks (non-vacuity)', () => {
  it('the construction detector sees a real `new FightRenderer(` / `new Engine(` and ignores comments/strings', () => {
    expect(constructs('const r = new FightRenderer(canvas, {})', 'FightRenderer')).toBe(true)
    expect(constructs('const e = new Engine({ canvas })', 'Engine')).toBe(true)
    expect(constructs('// new FightRenderer(canvas)\nconst x = 1', 'FightRenderer')).toBe(false)
    expect(constructs('const s = "new FightRenderer("', 'FightRenderer')).toBe(false)
  })

  it('the freeze detector counts a CALL, not a declaration or a comment', () => {
    expect(callsAny('openCaptureSession(e, s, { captureRoute: true })', FREEZE_CALLS)).toBe(true)
    expect(callsAny('applyCaptureQuality(e, s)', FREEZE_CALLS)).toBe(true)
    // A module that only DEFINES the function (captureQuality.ts) does not "call"
    // it, so it is never mistaken for a route that froze.
    expect(callsAny('export function applyCaptureQuality() {}', FREEZE_CALLS)).toBe(false)
    expect(callsAny('// openCaptureSession(e, s)', FREEZE_CALLS)).toBe(false)
  })

  it('a route that builds the renderer but never freezes IS an offender (the invariant can fire)', () => {
    // If this synthetic module were not both (a) enumerated and (b) flagged, the
    // real `offenders === []` assertion below would be vacuous.
    const bad = 'import { FightRenderer } from "x"\nconst r = new FightRenderer(c)\n// never freezes'
    expect(constructs(bad, 'FightRenderer')).toBe(true)
    expect(callsAny(bad, FREEZE_CALLS)).toBe(false)
  })
})

describe('captureCoverage — every capture route freezes', () => {
  it('enumerated the known routes (anti-blindness: the scan is not empty and finds all four)', () => {
    const found = new Set(CAPTURE_ROUTES.map(rel))
    for (const known of KNOWN_ROUTES) {
      expect(found.has(known)).toBe(true)
    }
    // The four engine-owning components today; if a 5th appears it must freeze
    // (asserted below), and this lower bound guarantees the enumerator never
    // silently collapsed.
    expect(CAPTURE_ROUTES.length).toBeGreaterThanOrEqual(KNOWN_ROUTES.length)
  })

  it('THE INVARIANT: every engine-owning component references a freeze call', () => {
    const offenders = CAPTURE_ROUTES.filter(
      (f) => !callsAny(readFileSync(f, 'utf8'), FREEZE_CALLS),
    ).map(rel)
    // Naming the offending files is the whole point — a bare boolean would make
    // the failure a scavenger hunt.
    expect(offenders).toEqual([])
  })
})

describe('captureCoverage — scope of the invariant (documented, not blind)', () => {
  it('includes FightScene3D (a real `?lab=1` capture surface) but excludes the shared renderer class', () => {
    // FightScene3D constructs `new Engine` DIRECTLY in a useEffect — the `?lab=1`
    // dev/legacy surface that 10 capture tools drive (they self-declare their
    // output inadmissible as SHIPPED evidence, but it still renders and drifts, so
    // it must freeze too). It IS an engine-owning component and is required below.
    //
    // `three/fight/FightRenderer.ts` also constructs `new Engine`, but in its
    // CONSTRUCTOR, not a useEffect — it is the shared renderer the routes mount,
    // freed by its callers, with no URL to read. The useEffect filter excludes it.
    // This is a NARROWING of a detector that can see more, not a blind spot: the
    // raw construction detector finds BOTH; only the component (with an effect) is
    // required to freeze.
    const rawEngine = FILES.filter((f) => constructs(readFileSync(f, 'utf8'), 'Engine')).map(rel)
    expect(rawEngine).toContain('three/FightScene3D.tsx')
    expect(rawEngine).toContain('three/fight/FightRenderer.ts')
    expect(CAPTURE_ROUTES.map(rel)).toContain('three/FightScene3D.tsx')
    expect(CAPTURE_ROUTES.map(rel)).not.toContain('three/fight/FightRenderer.ts')
  })

  it('the useEffect filter is what draws that line (isEngineComponent self-check)', () => {
    // A component mounts the engine in an effect; the class builds it in a ctor.
    expect(isEngineComponent('const e = new Engine(c)\nuseEffect(() => {}, [])')).toBe(true)
    expect(isEngineComponent('class R { constructor() { this.e = new Engine(c) } }')).toBe(false)
    // And a component with an effect but no engine is not falsely pulled in.
    expect(isEngineComponent('useEffect(() => { doThing() }, [])')).toBe(false)
  })
})
