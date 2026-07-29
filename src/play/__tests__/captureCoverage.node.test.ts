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
 * through a moving tier while `?play=1` was frozen. A per-route grep would have
 * caught today's two misses, but not the 4th route added next quarter. So this
 * gate enumerates the capture routes from the filesystem — every module that
 * says `new FightRenderer(` — and requires each to reference the freeze. A new
 * route auto-joins the enumerated set and is auto-required to freeze, with no
 * edit to this test.
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
// use the fused `openCaptureSession`, AttractMode uses bare `applyCaptureQuality`
// (its probe lives in a separate effect and cannot fuse). Both satisfy the
// invariant.
const FREEZE_CALLS = ['openCaptureSession', 'applyCaptureQuality'] as const

const FILES = shippedSourceUnder(SRC)
const CAPTURE_ROUTES = FILES.filter((f) => constructs(readFileSync(f, 'utf8'), 'FightRenderer'))

// The three routes that MUST freeze, by hand, so a blind enumerator (one that
// silently found nothing) cannot pass by returning an empty set.
const KNOWN_ROUTES = [
  'play/PlayableMatch.tsx',
  'three/dev/FightHarness.tsx',
  'screens/AttractMode.tsx',
] as const

describe('captureCoverage — detector self-checks (non-vacuity)', () => {
  it('the construction detector sees a real `new FightRenderer(` and ignores comments/strings', () => {
    expect(constructs('const r = new FightRenderer(canvas, {})', 'FightRenderer')).toBe(true)
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
  it('enumerated the known routes (anti-blindness: the scan is not empty and finds all three)', () => {
    const found = new Set(CAPTURE_ROUTES.map(rel))
    for (const known of KNOWN_ROUTES) {
      expect(found.has(known)).toBe(true)
    }
    // Exactly the routes today; if a 4th appears it must freeze (asserted below),
    // and this lower bound guarantees the enumerator never silently collapsed.
    expect(CAPTURE_ROUTES.length).toBeGreaterThanOrEqual(KNOWN_ROUTES.length)
  })

  it('THE INVARIANT: every module constructing FightRenderer references a freeze call', () => {
    const offenders = CAPTURE_ROUTES.filter(
      (f) => !callsAny(readFileSync(f, 'utf8'), FREEZE_CALLS),
    ).map(rel)
    // Naming the offending files is the whole point — a bare boolean would make
    // the failure a scavenger hunt.
    expect(offenders).toEqual([])
  })
})

describe('captureCoverage — scope of the invariant (documented, not blind)', () => {
  it('excludes direct-`new Engine` paths deliberately, and proves the detector CAN see them', () => {
    // FightScene3D constructs `new Engine` DIRECTLY (the dev-lab `?lab=1` /
    // legacy CombatScreen path — "the game we do not sell"), and FightRenderer.ts
    // is the shared renderer itself (no URL, freed by its constructors' callers).
    // Neither is a graded capture route, so neither is in the freeze invariant.
    // This is a NARROWING of a detector that can see more, not a blind spot: a
    // detector widened to `new Engine` finds FightScene3D. If FightScene3D ever
    // becomes a graded route, switch it to the shared FightRenderer (or fold it
    // in) — this assertion fails loudly if that file stops matching, forcing a
    // conscious re-decision rather than a silent gap.
    const directEngine = FILES.filter((f) => constructs(readFileSync(f, 'utf8'), 'Engine')).map(rel)
    expect(directEngine).toContain('three/FightScene3D.tsx')
    expect(directEngine).toContain('three/fight/FightRenderer.ts')
    // And those direct-Engine modules are NOT falsely pulled into the capture
    // routes (they don't say `new FightRenderer`), so excluding them costs the
    // invariant nothing.
    expect(CAPTURE_ROUTES.map(rel)).not.toContain('three/FightScene3D.tsx')
    expect(CAPTURE_ROUTES.map(rel)).not.toContain('three/fight/FightRenderer.ts')
  })
})
