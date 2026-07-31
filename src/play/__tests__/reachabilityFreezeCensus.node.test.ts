import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { rel, SRC, shippedSourceUnder } from '../../__tests__/engineModules'
import { decideRoute, matchupSearch, SELECT_SEARCH, type RouteKind } from '../../appRoute'

/**
 * reachabilityFreezeCensus — the complete-set gate on the "freeze adaptive quality
 * by DEFAULT, because no buyer lands here" primitive.
 *
 * WHY THIS EXISTS. Twice this project shipped one defect shape: a developer asserted
 * a code path was dev-only ("no buyer lands here") and froze adaptive quality by
 * default on it — and the assertion was false, so a buyer's machine was pinned to
 * the boot tier on a path they actually reach (34167c6 in FightScene3D froze the
 * interactive card game; addbd38/5be4175 in AttractMode froze the bare `/` front
 * door reel). captureCoverage already gates the FORM those took — an UNCONDITIONAL
 * freeze inside an already-sanctioned component — via `freezeIsCaptureGated` and the
 * capture-prop censuses. What NOTHING gated was the PRIMITIVE itself: a
 * `{ captureRoute: true }` call, or the `installLabProbe` wrapper, can be added to
 * ANY file that holds an Engine handle, and unless that file also happens to be an
 * engine-owning route component, captureCoverage's enumerator never sees it. This
 * gate closes that gap: it enumerates EVERY freeze-by-default surface tree-wide
 * (`.ts` + `.tsx`, from the shared `shippedSourceUnder` walk) and asserts the
 * complete set is EXACTLY the three sanctioned dev routes — a new one reds BY NAME.
 *
 * WHAT IT GUARANTEES, AND — read this — WHAT IT DOES NOT.
 * It CANNOT prove a route is dev-only. Reachability is a mount-graph + idle-timer +
 * future-code property, not a source-text one: `attract` is reached from a bare `/`
 * only after AttractMode is mounted six seconds deep inside FrontDoor's idle timer —
 * a fact no file-level scan can see, and exactly how the false "no buyer lands here"
 * claim fooled everyone. This gate makes a strictly weaker, and sufficient,
 * guarantee: a freeze-by-default surface cannot enter the tree SILENTLY. A new one
 * forces a review — the reviewer must trace the route to appRoute.ts and either
 * sanction it (add it to the allow-list WITH its route, which the oracle-anchor
 * block then holds to a dev-only param) or remove the freeze. It converts an
 * invisible omission into a named, blocking decision. It does not, and cannot, make
 * that decision correct; it only makes it HAPPEN. Overstating this — claiming the
 * gate proves dev-only — would be the very part-for-whole failure ("an import edge
 * is not reachability"; "the super's VFX is not the super's frame") that this whole
 * line of work is about.
 *
 * TWO GATES, COMPOSED. captureCoverage: "a SANCTIONED surface must not be reachable
 * by a buyer" (prop-scope + `if (capture)` guard). THIS gate: "the SET of surfaces
 * is exactly the sanctioned three, and each of their routes is oracle-dev-only"
 * (complete-set + anchored routes). Neither subsumes the other; the BOUNDARY test
 * below pins the one form this gate deliberately leaves to captureCoverage, so the
 * division of labour cannot silently rot.
 *
 * INSTRUMENT. Detection is AST, never text-match — a `captureRoute` in a comment,
 * string, or import cannot forge a surface, and `{ captureRoute: false }` (an
 * explicit opt-OUT) is correctly ignored. Known blind spots, stated so they are not
 * silent: a freeze hidden behind an object `{ ...spread }`, a `{ captureRoute }`
 * shorthand bound to a non-literal, a value computed at runtime, or a NEW freeze
 * primitive named something other than `captureRoute` / `installLabProbe`, would not
 * be seen. Mutation-proven in both directions and on the oracle clause independently
 * (before/after transcript in the delivery report).
 *
 * WALK REUSE (not a fork). The file walk is the SHARED `shippedSourceUnder` from
 * `src/__tests__/engineModules` — the same enumeration captureCoverage's engine
 * census walks — so there is genuinely ONE tree walk, not two that drift. (It is
 * imported from that NON-test module on purpose: importing a `.test.ts` file to
 * reuse a helper re-registers its entire `describe`/`it` suite into this file and
 * double-runs it — proven empirically; the delivery report has the transcript.)
 */

// The freeze-by-default primitives, as they appear at a CALL site:
//   applyCaptureQuality(engine, search, { captureRoute: true })   // bare freeze
//   openCaptureSession(engine, search, { captureRoute: true })    // fused freeze
//   installLabProbe(engine, search)                               // freeze + __LAB__
// `captureRoute: true` is the shared tell of the first two (it is what flips
// `applyCaptureQuality` from "freeze only if a ?quality= pin is present" to "freeze
// by default"); `installLabProbe` wraps `openCaptureSession(..., { captureRoute: true })`
// and so is detected by name.

/** A sanctioned freeze surface: the file it lives in, the route it serves, and the
 *  query param that reaches that route. The route is the anchor the oracle block
 *  holds to a dev-only param — the allow-list is not just "these files may freeze",
 *  it is "these files may freeze BECAUSE their route is dev-only per appRoute.ts". */
type AllowedSurface = { file: string; route: RouteKind; param: string }

const ALLOWED_FREEZE_SURFACES: readonly AllowedSurface[] = [
  // ?fight=1 — the FightHarness dev/capture harness. Its own source comment reads
  // "no buyer ever lands here — so freeze the tier by DEFAULT (captureRoute)": the
  // exact reachability claim this gate refuses to leave un-anchored.
  { file: 'three/dev/FightHarness.tsx', route: 'fight', param: '?fight=1' },
  // ?attract=1 — the standalone reel-capture route (App.tsx passes `capture`). The
  // buyer's FrontDoor mount of the same component passes NO capture, so its freeze
  // never runs there — that scoping is captureCoverage's; the route here is attract.
  { file: 'screens/AttractMode.tsx', route: 'attract', param: '?attract=1' },
  // ?lab=1 — the ThreeLab measure sandbox (installLabProbe, gated behind `capture`).
  // The card-game FightStage mount passes no capture; again captureCoverage scopes
  // that. The sanctioned route is lab.
  { file: 'three/FightScene3D.tsx', route: 'lab', param: '?lab=1' },
]

/** The primitive-DEFINITION module. Its internal
 *  `openCaptureSession(engine, search, { captureRoute: true })` (the body of
 *  `installLabProbe`) is plumbing that BUILDS the primitive, not a route opting into
 *  it. Excluded from the census; a self-check below proves it WOULD match, so the
 *  exclusion removes a KNOWN match rather than hiding an unknown one. */
const DEFINITION_MODULE = 'play/captureQuality.ts'

/** Parse a source string as TSX so JSX routes parse without a program. */
function parse(src: string): ts.SourceFile {
  return ts.createSourceFile('m.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

/** The freeze-by-default surface in a source string, or null. A CALL passing
 *  `{ captureRoute: true }`, or a CALL to `installLabProbe`. AST only: a mention in
 *  a comment, string, or import is not a CallExpression / is a StringLiteral and
 *  does not count, and `{ captureRoute: false }` is an opt-out, not a surface. */
function freezeSurfaceKind(src: string): 'captureRoute' | 'installLabProbe' | null {
  const sf = parse(src)
  let kind: 'captureRoute' | 'installLabProbe' | null = null
  const visit = (n: ts.Node) => {
    if (kind) return
    if (ts.isCallExpression(n)) {
      if (ts.isIdentifier(n.expression) && n.expression.text === 'installLabProbe') {
        kind = 'installLabProbe'
        return
      }
      for (const arg of n.arguments) {
        if (!ts.isObjectLiteralExpression(arg)) continue
        for (const p of arg.properties) {
          if (
            ts.isPropertyAssignment(p) &&
            ts.isIdentifier(p.name) &&
            p.name.text === 'captureRoute' &&
            p.initializer.kind === ts.SyntaxKind.TrueKeyword
          ) {
            kind = 'captureRoute'
            return
          }
        }
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return kind
}

/** Every freeze-by-default surface on disk, as { src-relative file, kind }. Walks
 *  the SHARED shipped-source enumeration (`.ts` + `.tsx`, tests excluded), minus the
 *  primitive-definition module. A new surface anywhere joins automatically. */
function freezeSurfacesOnDisk(): Array<{ file: string; kind: 'captureRoute' | 'installLabProbe' }> {
  const def = join(SRC, DEFINITION_MODULE)
  const out: Array<{ file: string; kind: 'captureRoute' | 'installLabProbe' }> = []
  for (const abs of shippedSourceUnder(SRC)) {
    if (abs === def) continue
    const kind = freezeSurfaceKind(readFileSync(abs, 'utf8'))
    if (kind) out.push({ file: rel(abs), kind })
  }
  return out
}

/** The two-directional verdict, given found surfaces and the allow-list.
 *  `unsanctioned`: a surface on a file the allow-list does NOT sanction (a new
 *  freeze the buyer might reach). `stale`: an allow-listed file with NO surface (a
 *  decorative allow-list entry that has stopped being load-bearing). Either
 *  non-empty = red, BY NAME. Built as a pure function so the disk census and the
 *  synthetic reproductions below run the identical logic. */
function censusVerdict(
  found: ReadonlyArray<{ file: string }>,
  allow: ReadonlyArray<{ file: string }>,
): { unsanctioned: string[]; stale: string[] } {
  const foundFiles = new Set(found.map((f) => f.file))
  const allowFiles = new Set(allow.map((a) => a.file))
  const unsanctioned = [...foundFiles].filter((f) => !allowFiles.has(f)).sort()
  const stale = [...allowFiles].filter((f) => !foundFiles.has(f)).sort()
  return { unsanctioned, stale }
}

// --- oracle-anchor support: in-app navigation targets (the pushState side) ---

/** Callees that navigate the shell (the `route-as-state` pushState family) plus the
 *  legacy full-reload forms the route table replaced (`location.assign/replace`). */
const NAV_CALLEES = new Set(['navigate', 'pushState', 'replaceState', 'assign', 'replace'])

/** Every STRING-LITERAL navigation target in the given sources — string args to a
 *  nav-family call, and the RHS of a `location.search = '...'` / `.href = '...'`
 *  assignment. Literal-only by design: a computed target (`?${flag}=1`) is a
 *  future-code property no static scan can resolve (see header). This is what a
 *  regression of the form `navigate('?fight=1')` would add, and what the anchor
 *  runs `decideRoute` over. */
function navTargetLiterals(files: ReadonlyArray<{ file: string; source: string }>): string[] {
  const out: string[] = []
  const calleeName = (e: ts.Expression): string | null => {
    if (ts.isIdentifier(e)) return e.text
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) return e.name.text
    return null
  }
  const asLiteral = (n: ts.Node): string | null =>
    ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : null
  for (const { source } of files) {
    const sf = parse(source)
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const name = calleeName(n.expression)
        if (name && NAV_CALLEES.has(name)) {
          for (const a of n.arguments) {
            const lit = asLiteral(a)
            if (lit !== null) out.push(lit)
          }
        }
      }
      if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(n.left) &&
        ts.isIdentifier(n.left.name) &&
        (n.left.name.text === 'search' || n.left.name.text === 'href')
      ) {
        const lit = asLiteral(n.right)
        if (lit !== null) out.push(lit)
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  return out
}

function navTargetLiteralsOnDisk(): string[] {
  const def = join(SRC, DEFINITION_MODULE)
  const files = shippedSourceUnder(SRC)
    .filter((abs) => abs !== def)
    .map((abs) => ({ file: rel(abs), source: readFileSync(abs, 'utf8') }))
  return navTargetLiterals(files)
}

describe('reachabilityFreezeCensus — detector self-checks (non-vacuity)', () => {
  it('detects a { captureRoute: true } arg and the installLabProbe wrapper; ignores opt-out, comments, strings, imports, bare identifiers', () => {
    expect(freezeSurfaceKind('openCaptureSession(e, s, { captureRoute: true })')).toBe('captureRoute')
    expect(freezeSurfaceKind('applyCaptureQuality(e, s, { captureRoute: true })')).toBe('captureRoute')
    expect(freezeSurfaceKind('installLabProbe(engine, window.location.search)')).toBe('installLabProbe')
    // opt-out and non-literal captureRoute are NOT a by-default freeze
    expect(freezeSurfaceKind('openCaptureSession(e, s, { captureRoute: false })')).toBe(null)
    expect(freezeSurfaceKind('const captureRoute = true')).toBe(null)
    // comment / string / import cannot forge a surface (AST, not text)
    expect(freezeSurfaceKind('// openCaptureSession(e, s, { captureRoute: true })')).toBe(null)
    expect(freezeSurfaceKind('const doc = "installLabProbe(e, s)"')).toBe(null)
    expect(freezeSurfaceKind('import { installLabProbe } from "../play/captureQuality"')).toBe(null)
  })

  it('the census verdict fires in BOTH directions (else the allow-list is decoration)', () => {
    // unsanctioned: a NEW surface alongside the real three → only the new file reds
    const v1 = censusVerdict(
      [...ALLOWED_FREEZE_SURFACES, { file: 'screens/FrontDoor.tsx' }],
      ALLOWED_FREEZE_SURFACES,
    )
    expect(v1.unsanctioned).toEqual(['screens/FrontDoor.tsx'])
    expect(v1.stale).toEqual([])
    // stale: an allow-listed file with no surface found (freeze removed, entry left)
    const v2 = censusVerdict([], ALLOWED_FREEZE_SURFACES)
    expect(v2.stale).toEqual(ALLOWED_FREEZE_SURFACES.map((a) => a.file).sort())
    expect(v2.unsanctioned).toEqual([])
    // clean: exactly the allow-list → empty both ways
    const clean = censusVerdict(ALLOWED_FREEZE_SURFACES, ALLOWED_FREEZE_SURFACES)
    expect(clean.unsanctioned).toEqual([])
    expect(clean.stale).toEqual([])
  })

  it('the DEFINITION module itself matches the detector — so its exclusion is load-bearing, not a silent hole', () => {
    // captureQuality.ts contains openCaptureSession(engine, search, { captureRoute: true })
    // inside installLabProbe. If the walk did not exclude it, it would false-positive
    // as a surface — so the exclusion removes a KNOWN match, not an unknown one.
    expect(freezeSurfaceKind(readFileSync(join(SRC, DEFINITION_MODULE), 'utf8'))).not.toBe(null)
  })
})

describe('reachabilityFreezeCensus — the complete freeze-surface set is exactly the sanctioned dev routes', () => {
  it('every freeze-by-default surface on disk is allow-listed, and every allow-list entry is still a real surface (reds BY NAME both ways)', () => {
    const found = freezeSurfacesOnDisk()
    const verdict = censusVerdict(found, ALLOWED_FREEZE_SURFACES)

    // A NEW surface on any non-sanctioned file — the ungated-primitive gap this gate
    // exists to close — reds here naming the file. Prove its route is not
    // customer-reachable (appRoute.ts) and add it to ALLOWED_FREEZE_SURFACES with its
    // route (the anchor block then holds that route to a dev-only param), or remove
    // the freeze.
    expect(
      verdict.unsanctioned,
      `Unsanctioned freeze-by-default surface(s) — a { captureRoute: true } / installLabProbe call on a file not in ALLOWED_FREEZE_SURFACES: ${verdict.unsanctioned.join(', ')}`,
    ).toEqual([])
    // A stale allow-list entry (surface removed but entry left behind) reds here —
    // the allow-list stays load-bearing, never decoration.
    expect(
      verdict.stale,
      `Stale allow-list entr(y/ies) — allow-listed but no freeze surface found: ${verdict.stale.join(', ')}`,
    ).toEqual([])

    // Anti-vacuity: the census actually found the three known surfaces (not an empty
    // walk passing by collapse), and each maps to the primitive we expect.
    expect(found.map((f) => f.file).sort()).toEqual(ALLOWED_FREEZE_SURFACES.map((a) => a.file).sort())
    expect(found.length).toBe(3)
    const byFile = new Map(found.map((f) => [f.file, f.kind]))
    expect(byFile.get('three/dev/FightHarness.tsx')).toBe('captureRoute')
    expect(byFile.get('screens/AttractMode.tsx')).toBe('captureRoute')
    expect(byFile.get('three/FightScene3D.tsx')).toBe('installLabProbe')
  })
})

describe('reachabilityFreezeCensus — every sanctioned freeze route is oracle-dev-only (independently load-bearing)', () => {
  const FREEZE_ROUTES = new Set<RouteKind>(ALLOWED_FREEZE_SURFACES.map((a) => a.route))
  const navSample = { a: 'a', b: 'b', p1: 'p1', p2: 'p2', stage: 's', cpu: 'c' }

  it('positive control: each allow-listed param maps to its freeze route via decideRoute (the anchor is not asserting over dead params)', () => {
    for (const s of ALLOWED_FREEZE_SURFACES) {
      expect(decideRoute(s.param)).toBe(s.route)
    }
    // and the freeze routes are genuinely a proper subset — a customer route is NOT
    // one of them (else "not a freeze route" would be vacuously unsatisfiable).
    expect(FREEZE_ROUTES.has(decideRoute(''))).toBe(false) // bare `/` → frontdoor
  })

  it('the in-app navigation BUILDERS (SELECT_SEARCH, matchupSearch) never resolve to a freeze route', () => {
    // The load-bearing negative: the only searches the shell pushState's are
    // SELECT_SEARCH (→ select) and a built matchup (→ play). If EITHER resolved to
    // fight/attract/lab, a buyer click would land on a frozen dev surface. This is
    // the clause that makes "no buyer navigates to a freeze route" a proven property
    // of the actual builders, not a hope.
    expect(FREEZE_ROUTES.has(decideRoute(SELECT_SEARCH))).toBe(false)
    expect(FREEZE_ROUTES.has(decideRoute(matchupSearch(navSample)))).toBe(false)
  })

  it('no in-app navigate()/assign()/location= literal anywhere in src resolves to a freeze route', () => {
    // Tree-wide scan of every string-literal nav target. Today the set carries no
    // freeze route (the shell navigates via the SELECT_SEARCH / matchupSearch
    // identifiers asserted above, not literals), so this clause is proven CAPABLE by
    // the self-check below rather than by a live match — and it reds the moment
    // someone adds `navigate('?fight=1')` or `location.assign('?lab=1')`.
    for (const litnav of navTargetLiteralsOnDisk()) {
      expect(
        FREEZE_ROUTES.has(decideRoute(litnav)),
        `in-app nav target "${litnav}" resolves to a freeze route — a buyer can reach a frozen dev surface`,
      ).toBe(false)
    }
  })

  it('self-check: the nav-literal scanner + decideRoute WOULD red on a synthetic navigate to a freeze route (the clause is not vacuous by construction)', () => {
    // Independently load-bearing: this proves the scan clause CAN fire on its own,
    // so it is a real second clause, not a costume over the caller-set assertion.
    const targets = navTargetLiterals([{ file: 'x.tsx', source: "onClick={() => navigate('?fight=1')}" }])
    expect(targets).toContain('?fight=1')
    expect(FREEZE_ROUTES.has(decideRoute('?fight=1'))).toBe(true) // so the live loop above WOULD fire
    // location.assign form too, so the whole nav family is covered, not just navigate.
    const assigned = navTargetLiterals([{ file: 'y.tsx', source: "window.location.assign('?lab=1')" }])
    expect(assigned).toContain('?lab=1')
  })
})

describe('reachabilityFreezeCensus — would-red-on-the-defects-we-actually-shipped', () => {
  const read = (p: string) => readFileSync(join(SRC, p), 'utf8')
  // The three real surfaces, read from disk, as the clean baseline the synthetic
  // defect is added ON TOP of — so the reproduction proves the injected file is what
  // reds, not some pre-existing state.
  const realSurfaces = () => ALLOWED_FREEZE_SURFACES.map((a) => ({ file: a.file, source: read(a.file) }))
  const surfacesOf = (files: Array<{ file: string; source: string }>) =>
    files.filter((f) => freezeSurfaceKind(f.source))

  it('5be4175 shape — a freeze-by-default surface on the buyer FRONT DOOR reds BY NAME', () => {
    // 5be4175/addbd38 froze the tier for the attract reel on the bare `/` front door
    // (decideRoute('') === 'frontdoor', the case the customer hits). Reproduced as
    // its census shape: a freeze primitive appearing on a buyer-reachable component
    // that is not a sanctioned dev route.
    const injected = [
      ...realSurfaces(),
      {
        file: 'screens/FrontDoor.tsx',
        source: 'applyCaptureQuality(engine, window.location.search, { captureRoute: true })',
      },
    ]
    const verdict = censusVerdict(surfacesOf(injected), ALLOWED_FREEZE_SURFACES)
    expect(verdict.unsanctioned).toEqual(['screens/FrontDoor.tsx'])
    // ...and FrontDoor genuinely serves a customer route: decideRoute('') is the
    // bare `/` front door, never a sanctioned freeze route — that is why a freeze
    // here is the defect, not merely an un-listed file.
    expect(decideRoute('')).toBe('frontdoor')
    expect(ALLOWED_FREEZE_SURFACES.some((a) => a.route === 'frontdoor')).toBe(false)
  })

  it('34167c6 shape — a freeze-by-default surface on the card-game seam (FightStage, route=cards) reds BY NAME', () => {
    // 34167c6 froze the tier unconditionally in FightScene3D, which the interactive
    // card game reaches via FightStage (route === 'cards', a buyer surface).
    // Reproduced as its census shape: a freeze primitive on that buyer seam.
    const injected = [
      ...realSurfaces(),
      { file: 'three/FightStage.tsx', source: 'installLabProbe(engine, window.location.search)' },
    ]
    const verdict = censusVerdict(surfacesOf(injected), ALLOWED_FREEZE_SURFACES)
    expect(verdict.unsanctioned).toEqual(['three/FightStage.tsx'])
  })

  it('BOUNDARY (honest, pinned so it cannot rot): the file-set census does NOT catch an allow-listed surface losing its capture guard — that is captureCoverage.freezeIsCaptureGated', () => {
    // The EXACT historical mechanism was an UNCONDITIONAL freeze inside an
    // already-sanctioned component. Those files are allow-listed here whether or not
    // the freeze is guarded, so THIS census stays green on that form — BY DESIGN.
    // Claiming otherwise would be the part-for-whole overstatement this file's header
    // warns against. That form is gated by captureCoverage ("AttractMode RESPECTS the
    // prop" / the FightScene3D prop-scope block). The two gates compose: this one owns
    // "a surface on a new/unsanctioned file"; captureCoverage owns "a sanctioned
    // surface reachable by a buyer".
    const unguarded = ALLOWED_FREEZE_SURFACES.map((a) => ({
      file: a.file,
      source:
        a.file === 'screens/AttractMode.tsx'
          ? 'applyCaptureQuality(engine, window.location.search, { captureRoute: true })' // no if (capture)
          : read(a.file),
    }))
    const verdict = censusVerdict(surfacesOf(unguarded), ALLOWED_FREEZE_SURFACES)
    expect(verdict.unsanctioned).toEqual([]) // green — allow-listed file; the missing guard is invisible to a file-set census
    expect(verdict.stale).toEqual([])
  })
})
