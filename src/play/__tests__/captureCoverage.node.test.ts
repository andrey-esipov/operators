import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  rel,
  SRC,
  engineOwningModules,
  auditEngineModules,
  constructsAny,
  type ModulePredicate,
} from '../../__tests__/engineModules'

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
 * REUSE, NOT FORK (now real, and the coordinator's central ask): the ENUMERATOR
 * — "every shipped module that constructs `new Engine`/`new FightRenderer` in a
 * `useEffect`" — is framing's shared `src/__tests__/engineModules`, the same list
 * its shellNav disposal gate walks. One list, two questions: shellNav asks "does
 * it DISPOSE the engine on unmount?"; this gate asks "does it FREEZE capture
 * quality?" — both via `auditEngineModules(predicate, { requireEffect: true })`.
 * A new engine route auto-joins the list and is auto-required by BOTH, with no
 * edit to either test. This gate carried a private copy of the walker while
 * engineModules was uncommitted WIP; that copy is deleted now that the shared
 * module is in HEAD, closing the "two lists that silently drift" defect this gate
 * exists to prevent. What stays local is the QUESTION — `callsAny(FREEZE_CALLS)`
 * — because the list is shared but the freeze predicate is ours alone.
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

/** Parse a source string as TSX so JSX routes parse without a program. */
function parse(src: string): ts.SourceFile {
  return ts.createSourceFile('m.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

/** True iff the source CALLS any of `names` — an AST CallExpression whose callee
 *  is one of the identifiers. A function *declaration* named the same, or a
 *  mention in a comment, is not a CallExpression and does not count. This is this
 *  gate's QUESTION and stays local: the enumerated LIST is shared (framing's
 *  `engineModules`), but the freeze predicate is ours. */
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

// The freeze is applied through one of three entry points, all of which reduce to
// `Engine.setAdaptiveQuality(false)`: PlayableMatch/FightHarness use the fused
// `openCaptureSession`; AttractMode uses bare `applyCaptureQuality`; FightScene3D
// (the `?lab=1` sandbox path) uses `installLabProbe`, which wraps
// `openCaptureSession` to fuse the freeze with the `window.__LAB__` tier probe.
// Any of the three satisfies the invariant that the freeze mechanism is PRESENT;
// whether FightScene3D's is correctly SCOPED to the sandbox (and not the shipped
// buyer path) is a separate property, guarded by the prop-scope block below.
const FREEZE_CALLS = ['openCaptureSession', 'applyCaptureQuality', 'installLabProbe'] as const

// The gate's QUESTION, in the shape `auditEngineModules` expects: given an
// engine-owning module's source, return the reasons it violates the freeze
// obligation ([] = compliant). shellNav passes a DISPOSAL predicate to the same
// enumerator; this passes a FREEZE predicate. One list, two questions.
const freezeViolations: ModulePredicate = (src) =>
  callsAny(src, FREEZE_CALLS)
    ? []
    : ['constructs an engine in an effect but never applies a capture-quality freeze']

// The engine-owning COMPONENTS: shipped modules that construct `new Engine` or
// `new FightRenderer` AND reference `useEffect`, from framing's shared enumerator.
// `requireEffect` is exactly what separates these effect-mounted route components
// from the shared `FightRenderer` class (ctor construction, no effect, no URL) —
// proven on the real files in the scope block below.
const CAPTURE_ROUTES = engineOwningModules({ requireEffect: true })

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
  it('the freeze detector counts a CALL, not a declaration or a comment', () => {
    expect(callsAny('openCaptureSession(e, s, { captureRoute: true })', FREEZE_CALLS)).toBe(true)
    expect(callsAny('applyCaptureQuality(e, s)', FREEZE_CALLS)).toBe(true)
    expect(callsAny('installLabProbe(engine, window.location.search)', FREEZE_CALLS)).toBe(true)
    // A module that only DEFINES the function (captureQuality.ts) does not "call"
    // it, so it is never mistaken for a route that froze.
    expect(callsAny('export function applyCaptureQuality() {}', FREEZE_CALLS)).toBe(false)
    expect(callsAny('// openCaptureSession(e, s)', FREEZE_CALLS)).toBe(false)
  })

  it('the shared construction detector sees a real `new FightRenderer(` / `new Engine(` and ignores comments/strings', () => {
    // `constructsAny` is framing's, imported — a light guard that MY non-vacuity
    // still holds if its semantics ever drift (framing tests it too; cheap here).
    expect(constructsAny('const r = new FightRenderer(canvas, {})', ['FightRenderer'])).toBe(true)
    expect(constructsAny('const e = new Engine({ canvas })', ['Engine'])).toBe(true)
    expect(constructsAny('// new FightRenderer(canvas)\nconst x = 1', ['FightRenderer'])).toBe(false)
    expect(constructsAny('const s = "new FightRenderer("', ['FightRenderer'])).toBe(false)
  })

  it('the freeze predicate CAN fire — an engine route that never freezes is an offender (else the invariant is vacuous)', () => {
    const bad = 'import { FightRenderer } from "x"\nconst r = new FightRenderer(c)\n// never freezes'
    expect(freezeViolations(bad, 'bad.tsx')).not.toEqual([])
    const good = 'const r = new FightRenderer(c)\nopenCaptureSession(e, s, { captureRoute: true })'
    expect(freezeViolations(good, 'good.tsx')).toEqual([])
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
    // Dogfoods the shared `auditEngineModules` seam: ONE enumerated list, this
    // gate's freeze question — the same call shape shellNav uses for disposal.
    const offenders = auditEngineModules(freezeViolations, { requireEffect: true })
    // Naming the offending files is the whole point — a bare boolean would make
    // the failure a scavenger hunt.
    expect(offenders).toEqual([])
  })
})

describe('captureCoverage — scope of the invariant (documented, not blind)', () => {
  it('includes FightScene3D (a real `?lab=1` capture surface) but excludes the shared renderer class', () => {
    // FightScene3D constructs `new Engine` DIRECTLY in a useEffect — the `?lab=1`
    // dev/legacy surface that ~11 capture tools drive (they self-declare their
    // output inadmissible as SHIPPED evidence, but it still renders and drifts, so
    // it must freeze too). It IS an engine-owning component and is required above.
    //
    // `three/fight/FightRenderer.ts` also constructs `new Engine`, but in its
    // CONSTRUCTOR, not a useEffect — it is the shared renderer the routes mount,
    // freed by its callers, with no URL to read. The requireEffect filter excludes
    // it. This is a NARROWING of a detector that can see more, not a blind spot:
    // the raw (no-effect) enumeration finds BOTH; only the effect-mounted
    // components are required to freeze.
    const rawEngine = engineOwningModules({ ctors: ['Engine'] }).map(rel)
    expect(rawEngine).toContain('three/FightScene3D.tsx')
    expect(rawEngine).toContain('three/fight/FightRenderer.ts')
    expect(CAPTURE_ROUTES.map(rel)).toContain('three/FightScene3D.tsx')
    expect(CAPTURE_ROUTES.map(rel)).not.toContain('three/fight/FightRenderer.ts')
  })

  it('the requireEffect filter is what draws that line, on the real shipped files', () => {
    // With the effect filter the shared FightRenderer class (ctor construction, no
    // effect) drops out; without it, it is present. Proven on shipped source, not
    // synthetic strings — a stronger check than a hand-written fixture, and it
    // exercises framing's enumerator the way both gates actually call it.
    const withEffect = new Set(engineOwningModules({ requireEffect: true }).map(rel))
    const withoutEffect = new Set(engineOwningModules({}).map(rel))
    expect(withoutEffect.has('three/fight/FightRenderer.ts')).toBe(true)
    expect(withEffect.has('three/fight/FightRenderer.ts')).toBe(false)
  })
})

/** The `capture` prop on a `<FightScene3D>` element in a component's source:
 *  'set' (present), 'none' (element present, no capture prop), or 'absent' (no
 *  such element). AST over JsxOpeningElement/JsxSelfClosingElement, so a `capture`
 *  in a comment or string cannot forge a 'set' — only a real JSX attribute counts.
 *  This is the twin of `callsAny`: `callsAny` proves the freeze CALL is present in
 *  the module; this proves the freeze is WIRED to the right seam via the prop. */
function captureProp(src: string, tagName: string): 'set' | 'none' | 'absent' {
  let result: 'set' | 'none' | 'absent' = 'absent'
  const visit = (n: ts.Node) => {
    const tag = ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n) ? n : null
    if (tag && ts.isIdentifier(tag.tagName) && tag.tagName.text === tagName) {
      result = tag.attributes.properties.some(
        (p) => ts.isJsxAttribute(p) && ts.isIdentifier(p.name) && p.name.text === 'capture',
      )
        ? 'set'
        : 'none'
    }
    ts.forEachChild(n, visit)
  }
  visit(parse(src))
  return result
}
const fightSceneCaptureProp = (src: string) => captureProp(src, 'FightScene3D')
const attractModeCaptureProp = (src: string) => captureProp(src, 'AttractMode')

/** True iff EVERY `applyCaptureQuality` call in the source sits inside an `if`
 *  whose condition references `capture` — i.e. the freeze can never run
 *  unconditionally. This is the load-bearing half the call-site scope gate cannot
 *  see: the props decide who PASSES `capture`; this decides the component RESPECTS
 *  it. Without it, deleting the `if (capture)` guard re-freezes the buyer reel
 *  while every call-site test stays green. Manual ancestry so a nested `if` still
 *  counts; `captureRoute` etc. cannot false-match (word-boundary regex). */
function freezeIsCaptureGated(src: string): boolean {
  const sf = parse(src)
  let sawFreeze = false
  let unguarded = false
  const mentionsCapture = (e: ts.Expression) => /(^|[^.\w])capture([^.\w]|$)/.test(e.getText(sf))
  const visit = (n: ts.Node, guarded: boolean) => {
    if (ts.isIfStatement(n)) {
      const thenGuarded = guarded || mentionsCapture(n.expression)
      visit(n.expression, guarded)
      visit(n.thenStatement, thenGuarded)
      if (n.elseStatement) visit(n.elseStatement, guarded)
      return
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'applyCaptureQuality') {
      sawFreeze = true
      if (!guarded) unguarded = true
    }
    ts.forEachChild(n, (c) => visit(c, guarded))
  }
  visit(sf, false)
  return sawFreeze && !unguarded
}

/** Every `.tsx` under src/ except tests and the given file, walked from disk so a
 *  new mount joins the census automatically instead of waiting to be hand-listed. */
function tsxFilesUnder(dir: string, exclude: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'node_modules') continue
      out.push(...tsxFilesUnder(abs, exclude))
    } else if (e.name.endsWith('.tsx') && !e.name.endsWith('.test.tsx') && abs !== exclude) {
      out.push(abs)
    }
  }
  return out
}

/** Census of every <AttractMode> mount in shipped src (the definition file itself
 *  excluded), as { src-relative file, whether it passes `capture` }. Enumerated
 *  from disk — NOT hand-listed — so a mount added ANYWHERE on any route is forced
 *  into the set and must be classified here. This is the gate that makes the
 *  off-by-one that reached AttractMode's own census comment ("two mounts" when
 *  there are three) structurally impossible: a fourth mount reds by name, and a
 *  mount that wrongly opts into the freeze (the 34167c6 class) reds by name. */
function attractModeMountCensus(): Array<{ file: string; capture: boolean }> {
  const def = join(SRC, 'screens/AttractMode.tsx')
  const mounts: Array<{ file: string; capture: boolean }> = []
  for (const abs of tsxFilesUnder(SRC, def)) {
    const sf = parse(readFileSync(abs, 'utf8'))
    const visit = (n: ts.Node) => {
      const tag = ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n) ? n : null
      if (tag && ts.isIdentifier(tag.tagName) && tag.tagName.text === 'AttractMode') {
        const capture = tag.attributes.properties.some(
          (p) => ts.isJsxAttribute(p) && ts.isIdentifier(p.name) && p.name.text === 'capture',
        )
        mounts.push({ file: rel(abs), capture })
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  return mounts
}

describe('captureCoverage — the freeze is scoped to the capture sandbox, never the card-game consumer', () => {
  // FightScene3D is SHARED between two consumers, NEITHER of which is the shipped
  // fighter (that is PlayableMatch → FightRenderer; the front door routes to
  // `?play=1`, never here — appRoute.ts / instrumentRouting). It backs (a) the
  // `?lab=1` capture/measure sandbox (ThreeLab) and (b) FightStage ← CombatScreen,
  // reached only via `route === 'cards'` (the legacy card game). The freeze +
  // `window.__LAB__` install are gated behind the `capture` prop so they run ONLY
  // on the sandbox. 34167c6 called the freeze UNCONDITIONALLY inside FightScene3D
  // on the false premise "no buyer is ever here" — which froze the interactive
  // card-game route too and would have leaked a __LAB__ global onto its page. This
  // block is the guard that regression cannot return: THE INVARIANT above proves
  // the freeze CALL is present; this proves it is wired to the sandbox seam and
  // NOT the card-game seam. The module-level enumerator cannot see this — the
  // freeze call is present in FightScene3D either way; only the PROP at the two
  // call sites decides who runs it. So the property lives at the JSX call sites,
  // checked here by AST.
  const read = (p: string) => readFileSync(join(SRC, p), 'utf8')

  it('self-check: the JSX capture-prop detector distinguishes set / none / absent (and ignores comments)', () => {
    expect(fightSceneCaptureProp('const x = <FightScene3D state={s} capture />')).toBe('set')
    expect(fightSceneCaptureProp('const x = <FightScene3D state={s} onReady={r} />')).toBe('none')
    expect(fightSceneCaptureProp('const x = <div />')).toBe('absent')
    // A `capture` in a trailing comment must not read as the prop being set.
    expect(fightSceneCaptureProp('const x = <FightScene3D state={s} /> // capture')).toBe('none')
  })

  it('the CARD-GAME seam (FightStage ← CombatScreen, route=cards) must NOT opt into capture', () => {
    // If this reddens, an interactive card-game player just lost adaptive quality
    // AND got a __LAB__ global on their page — the exact 34167c6 over-freeze.
    // FightStage is the single seam CombatScreen mounts, and CombatScreen is
    // reached only via `route === 'cards'` (App.tsx), never the shipped fighter.
    expect(fightSceneCaptureProp(read('three/FightStage.tsx'))).toBe('none')
  })

  it('the SANDBOX seam (ThreeLab → ?lab=1) MUST opt into capture', () => {
    // If this reddens, ?lab=1 captures drift through the adaptive tier again and
    // window.__LAB__ never appears, so no capture tool can certify the tier held —
    // the observability gap the coordinator and visual-critic both flagged.
    expect(fightSceneCaptureProp(read('three/dev/ThreeLab.tsx'))).toBe('set')
  })

  it('FightScene3D installs the __LAB__ probe specifically (installLabProbe, not bare applyCaptureQuality)', () => {
    // THE INVARIANT accepts ANY FREEZE_CALL, so reverting FightScene3D to
    // `applyCaptureQuality` would still be green there while __LAB__ silently
    // vanished (freeze without a probe = the observability gap all over again).
    // Pin the __LAB__ path explicitly.
    expect(callsAny(read('three/FightScene3D.tsx'), ['installLabProbe'])).toBe(true)
  })
})

describe('captureCoverage — the attract-reel freeze is scoped to the capture route, never the buyer front door', () => {
  // AttractMode is SHARED between two mounts, established by tracing to the route
  // table (not the import graph): (a) the standalone `?attract=1` reel-capture
  // route (App.tsx, `route === 'attract'`), a dev/capture surface, and (b) the
  // customer FRONT DOOR (FrontDoor.tsx), reached at bare `/` (route ===
  // 'frontdoor', appRoute.ts) — the case the customer actually hits — which
  // mounts the reel after a 6 s idle as a live demo. addbd38 froze the tier
  // UNCONDITIONALLY inside AttractMode on the premise "no buyer lands here"; the
  // route table falsifies that, and the freeze pinned the buyer's front-door reel
  // to the boot tier (a weak machine could not demote and was forced to the
  // static fallback) — the 34167c6 over-freeze, one layer down. The freeze is now
  // gated behind the `capture` prop. THE INVARIANT proves the freeze CALL is
  // present; this block proves only the capture mount is WIRED to it AND that
  // AttractMode actually respects the prop.
  const read = (p: string) => readFileSync(join(SRC, p), 'utf8')

  it('self-check: the detector reads the capture prop on <AttractMode> (and ignores comments)', () => {
    expect(attractModeCaptureProp('const x = <AttractMode onExit={f} capture />')).toBe('set')
    expect(attractModeCaptureProp('const x = <AttractMode onExit={f} />')).toBe('none')
    expect(attractModeCaptureProp('const x = <div />')).toBe('absent')
    // A `capture` in a trailing comment must not read as the prop being set.
    expect(attractModeCaptureProp('const x = <AttractMode onExit={f} /> // capture')).toBe('none')
  })

  it('the BUYER seam (FrontDoor, bare `/` front door) must NOT opt into capture', () => {
    // If this reddens, a buyer idling on the title just lost adaptive quality on
    // the attract reel — pinned to the boot tier, forced to the static fallback on
    // a weak machine. FrontDoor is reached at bare `/` (route === 'frontdoor'),
    // the case the customer actually hits.
    expect(attractModeCaptureProp(read('screens/FrontDoor.tsx'))).toBe('none')
  })

  it('the CAPTURE seam (App.tsx `?attract=1` standalone) MUST opt into capture', () => {
    // If this reddens, `?attract=1` reel captures drift through the adaptive tier
    // again — the defect the freeze exists to close.
    expect(attractModeCaptureProp(read('App.tsx'))).toBe('set')
  })

  it('AttractMode RESPECTS the prop: its freeze is guarded by `capture`, never unconditional', () => {
    // The call-site tests above prove who PASSES capture; this proves AttractMode
    // acts on it. Deleting the `if (capture)` guard re-freezes the buyer reel
    // while leaving every call-site test green — this is the guard against that.
    expect(freezeIsCaptureGated(read('screens/AttractMode.tsx'))).toBe(true)
  })

  it('CENSUS (enumerated from disk): exactly one mount freezes, and the full set is the three traced routes', () => {
    const mounts = attractModeMountCensus()
    const froze = mounts.filter((m) => m.capture).map((m) => m.file).sort()
    const all = mounts.map((m) => m.file).sort()
    // SAFETY: exactly one mount opts into the freeze, and it is the ?attract=1
    // capture route. A new mount that wrongly passes `capture` freezes a
    // non-capture surface (the 34167c6 class) and reddens here BY NAME.
    expect(froze).toEqual(['App.tsx'])
    // CENSUS: the exhaustive mount set, each traced to the route table —
    //   App.tsx                ?attract=1 standalone reel-capture route  (freezes)
    //   screens/FrontDoor.tsx  bare `/` front door, the buyer beat        (no freeze)
    //   screens/MainMenu.tsx   ?cards=1 legacy card game in-menu preview  (no freeze)
    // Walked from disk, so a mount added ANYWHERE forces itself into this list:
    // the off-by-one that reached AttractMode's own comment ("two mounts") cannot
    // silently recur. When a real fourth mount lands, name it here AND confirm its
    // capture default is buyer-safe (false) unless it is a genuine capture route.
    expect(all).toEqual(['App.tsx', 'screens/FrontDoor.tsx', 'screens/MainMenu.tsx'])
  })
})
