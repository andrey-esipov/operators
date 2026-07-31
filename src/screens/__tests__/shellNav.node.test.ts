import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SRC, rel, reachableFrom, engineOwningModules, auditEngineModules, DEFAULT_ENGINE_CTORS } from '../../__tests__/engineModules'

/**
 * Shell-navigation safety — the two obligations `2cec5fb` (route-as-state) is on
 * the hook for, each re-gated onto the SUBJECT rather than a source-text proxy.
 *
 * An earlier version of this file was a regex over two named source files —
 * "App.tsx and FightSelect.tsx contain no `location.assign`." It was rejected,
 * correctly, as the exact defect this project keeps rediscovering: it guarded
 * the property that was REMOVED (a reload string in two files) instead of the
 * obligation that was CREATED. Two failure modes walked straight through it:
 *
 *   (1) a reload laundered through a helper — `import { go } from './nav'` where
 *       `nav.ts` does `location.assign` is a full-page reload the two-file scan
 *       cannot see; and
 *   (2) the one that actually matters — before route-as-state, "the outgoing
 *       engine's VRAM is freed" was a PLATFORM guarantee (a full-page navigation
 *       tore the document down unconditionally). After it, the guarantee is a
 *       CONVENTION: every engine-owning component must remember to dispose its
 *       engine in unmount cleanup. Today all four do. The fifth won't — and a
 *       missed cleanup no longer costs nothing (the page used to be about to die);
 *       it leaks a live WebGL context for the whole session, and browsers cap
 *       live contexts (~16), so after enough navigations the driver force-kills
 *       the oldest — surfacing as visual corruption, not a clean error. The old
 *       gate stayed green through all of it because it never looked at the
 *       components at all.
 *
 * So this file asserts two OBLIGATIONS, not the absence of a string:
 *
 *   A. NO full-page navigation is reachable from the app shell — proven over the
 *      TRANSITIVE import graph (the technique `src/fight/__tests__/registrySeam`
 *      uses), so a reload laundered through any helper the shell can reach is
 *      caught, and a specifier sitting only in a comment (this file's own doc
 *      mentions `location.assign`) is NOT a false positive because detection is
 *      by AST, not text.
 *   B. EVERY component that constructs an engine (`new FightRenderer` / `new
 *      Engine`) disposes it in the cleanup of the very effect that built it —
 *      enumerated from the filesystem, so a NEW engine-owning component is pulled
 *      into the gate automatically and reddens if it forgets to dispose.
 *
 * The engine-module ENUMERATOR and the transitive-import walk that both gates
 * lean on are factored into `src/__tests__/engineModules.ts`, so this disposal
 * gate and impact-vfx's capture-quality gate ask their OWN question of ONE
 * shared list (rather than each carrying a private enumerator that drifts).
 *
 * WHY NEITHER CAN LIE VACUOUSLY (this project's signature failure is a checker
 * that passes because it looked at nothing / its matcher matches nothing):
 *   - POSITIVE CONTROLS ship with each gate: the reload detector must fire on
 *     known-bad source; the disposal matcher must pass a synthetic component that
 *     disposes AND flag one that doesn't. A broken matcher reddens its control
 *     instead of green-washing every real file.
 *   - NON-BLINDNESS: gate A asserts the reachable graph is substantial and
 *     includes the lazily-loaded nav screens (so the walk truly traversed the
 *     dynamic edges); gate B asserts the enumerated set includes the four known
 *     engine components (so the enumerator truly found them).
 *
 * WHAT THIS DOES *NOT* PROVE (named, so the gate is not itself a lying harness —
 * presence/structure is not runtime, the trap that bit the `forceContextLoss`
 * gate). Gate B proves each component disposes its engine ON THE CLEANUP PATH; it
 * does NOT prove React RUNS that cleanup on unmount (a platform contract the
 * coordinator's own invocation-order test would also rely on), nor that a
 * disposed context frees resident BYTES — that is the real-GL claim owned by
 * `engineContextRelease.node.test.ts` (mechanism: dispose → forceContextLoss) and
 * its Playwright fresh-canvas A/B. This gate is the complement: it proves the
 * mechanism engineContextRelease validates is actually WIRED at every mount site.
 *
 * Mutation-proven both directions (transcripts in the delivery report): deleting
 * `renderer?.dispose()` from a real component's cleanup reddens gate B naming the
 * file; injecting `window.location.reload()` into a reachable module the old
 * two-file scan never read reddens gate A naming that file; both restore
 * byte-identical to green (md5-verified).
 */

// Enumeration + import-graph plumbing (SRC, rel, reachableFrom, engineOwning
// modules, auditEngineModules) is imported from `src/__tests__/engineModules`.
// This file keeps only the two DETECTORS — its own questions — below.

// ── Gate A detector: assignment/call-form full-page navigation, by AST ──────────
// Matches `X.location.assign(...)` / `.replace(...)` / `.reload(...)` calls and
// `X.location.href = …` / `X.location.search = …` assignments. A READ of
// `location.search` is neither, so it is correctly ignored.
function isLocation(node: ts.Expression): boolean {
  if (ts.isIdentifier(node)) return node.text === 'location'
  if (ts.isPropertyAccessExpression(node)) return node.name.text === 'location'
  return false
}

function reloadFormsInSource(src: string): string[] {
  const sf = ts.createSourceFile('probe.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found = new Set<string>()
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const m = node.expression
      if (isLocation(m.expression) && ['assign', 'replace', 'reload'].includes(m.name.text)) {
        found.add(`location.${m.name.text}(`)
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left)
    ) {
      const l = node.left
      if (isLocation(l.expression) && ['href', 'search'].includes(l.name.text)) {
        found.add(`location.${l.name.text} =`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return [...found].sort()
}

// ── Gate B detector: engine constructed in an effect must be disposed in that ───
// effect's cleanup return. Walks up from each `new FightRenderer`/`new Engine` to
// the enclosing `useEffect` callback (skipping the async IIFE the loaders wrap the
// construction in), then checks the effect's returned cleanup disposes the bound
// identifier.
const ENGINE_CTORS = new Set<string>(DEFAULT_ENGINE_CTORS)

function enclosingEffectFn(node: ts.Node): ts.ArrowFunction | ts.FunctionExpression | null {
  let n: ts.Node | undefined = node.parent
  while (n) {
    const fn = n
    const parent: ts.Node | undefined = fn.parent
    if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && parent && ts.isCallExpression(parent)) {
      if (ts.isIdentifier(parent.expression) && parent.expression.text === 'useEffect' && parent.arguments[0] === fn) {
        return fn
      }
    }
    n = n.parent
  }
  return null
}

function bindingNameOf(newExpr: ts.NewExpression): string | null {
  const p = newExpr.parent
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text
  if (p && ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(p.left)) {
    return p.left.text
  }
  return null
}

function cleanupReturnOf(
  effectFn: ts.ArrowFunction | ts.FunctionExpression,
): ts.ArrowFunction | ts.FunctionExpression | null {
  const body = effectFn.body
  if (!body || !ts.isBlock(body)) return null
  for (const stmt of body.statements) {
    if (
      ts.isReturnStatement(stmt) &&
      stmt.expression &&
      (ts.isArrowFunction(stmt.expression) || ts.isFunctionExpression(stmt.expression))
    ) {
      return stmt.expression
    }
  }
  return null
}

function disposedRootsIn(fn: ts.Node): Set<string> {
  const roots = new Set<string>()
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'dispose' &&
      ts.isIdentifier(node.expression.expression)
    ) {
      roots.add(node.expression.expression.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(fn)
  return roots
}

/** Reasons a file fails the dispose-on-unmount obligation (empty = compliant). */
function engineDisposalViolations(src: string): string[] {
  const sf = ts.createSourceFile('probe.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const violations: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && ENGINE_CTORS.has(node.expression.text)) {
      const ctor = node.expression.text
      const effect = enclosingEffectFn(node)
      if (!effect) {
        violations.push(`${ctor} constructed outside a useEffect`)
      } else {
        const binding = bindingNameOf(node)
        const cleanup = cleanupReturnOf(effect)
        if (!binding) violations.push(`${ctor} not bound to an identifier (cannot verify disposal)`)
        else if (!cleanup) violations.push(`${ctor} '${binding}' constructed in an effect with no cleanup return`)
        else if (!disposedRootsIn(cleanup).has(binding)) {
          violations.push(`${ctor} '${binding}' not disposed in its effect cleanup`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return violations
}

/** React components that MOUNT a WebGL engine (construct FightRenderer/Engine in
 *  an effect) — a thin alias over the shared `engineOwningModules` enumerator, so
 *  this disposal gate and impact-vfx's capture-quality gate (in its own lane, at
 *  `src/play/__tests__/`) ask their own question of ONE list. `requireEffect`
 *  excludes the `FightRenderer` wrapper class (no effect; its disposal is a
 *  METHOD proven by engineContextRelease). */
function engineComponentFiles(): string[] {
  return engineOwningModules({ requireEffect: true })
}

const APP = resolve(SRC, 'App.tsx')
const shellReach = reachableFrom([APP])

describe('shell navigation — no full-page reload reachable from the app shell', () => {
  it('POSITIVE CONTROL: the reload detector fires on known-bad source (AST, not text)', () => {
    const knownBad = [
      `window.location.assign('/?a=x')`,
      `window.location.search = 'select=1'`,
      `window.location.href = '/'`,
      `window.location.replace('/x')`,
      `window.location.reload()`,
    ].join('\n')
    expect(reloadFormsInSource(knownBad)).toEqual(
      ['location.assign(', 'location.href =', 'location.reload(', 'location.replace(', 'location.search ='].sort(),
    )
    // A pure READ of location.search must NOT trip it — the reason a source-text
    // grep was wrong (App legitimately reads it to seed route state).
    expect(reloadFormsInSource(`const s = window.location.search`)).toEqual([])
    // A specifier in a comment must NOT trip it (this very file mentions one).
    expect(reloadFormsInSource(`// window.location.assign('/x') in a comment`)).toEqual([])
  })

  it('NON-BLINDNESS: the walk reaches a substantial graph incl. the lazy nav screens', () => {
    // If the walk silently found nothing (or didn't follow App's dynamic
    // import()s), "no reload reachable" would be vacuous. Prove it traversed.
    expect(shellReach.size).toBeGreaterThan(20)
    for (const screen of ['fighthud/select/FightSelect.tsx', 'screens/AttractMode.tsx', 'screens/FrontDoor.tsx', 'play/PlayableMatch.tsx']) {
      expect([...shellReach].map(rel)).toContain(screen)
    }
  })

  it('no module reachable from the shell performs a full-page navigation', () => {
    const offenders: string[] = []
    for (const f of shellReach) {
      const forms = reloadFormsInSource(readFileSync(f, 'utf8'))
      if (forms.length) offenders.push(`${rel(f)} → ${forms.join(', ')}`)
    }
    expect(offenders, `full-page navigation reachable from the shell:\n${offenders.join('\n')}`).toEqual([])
  })
})

describe('engine lifecycle — every engine-owning component disposes on unmount', () => {
  const components = engineComponentFiles()

  it('POSITIVE CONTROL: the disposal matcher passes a compliant component and flags a leaky one', () => {
    const compliant = `
      import { useEffect } from 'react'
      export function C() {
        useEffect(() => {
          let renderer: any = null
          void (async () => { renderer = new FightRenderer(canvas, {}) })()
          return () => { renderer?.dispose() }
        }, [])
        return null
      }`
    const leaky = `
      import { useEffect } from 'react'
      export function C() {
        useEffect(() => {
          let renderer: any = null
          void (async () => { renderer = new FightRenderer(canvas, {}) })()
          return () => { /* forgot to dispose */ }
        }, [])
        return null
      }`
    expect(engineDisposalViolations(compliant)).toEqual([])
    expect(engineDisposalViolations(leaky).length).toBeGreaterThan(0)
    // Also flag an engine built with no cleanup return at all.
    const noCleanup = `
      import { useEffect } from 'react'
      export function C() {
        useEffect(() => { const engine = new Engine({ canvas }) }, [])
        return null
      }`
    expect(engineDisposalViolations(noCleanup).length).toBeGreaterThan(0)
  })

  it('NON-BLINDNESS: the enumerator found the four known engine-owning components', () => {
    const rels = components.map(rel)
    for (const known of [
      'three/dev/FightHarness.tsx',
      'screens/AttractMode.tsx',
      'play/PlayableMatch.tsx',
      'three/FightScene3D.tsx',
    ]) {
      expect(rels).toContain(known)
    }
    expect(components.length).toBeGreaterThanOrEqual(4)
  })

  it('each engine-owning component disposes its engine in the constructing effect cleanup', () => {
    // Dogfoods the shared `auditEngineModules` seam: one enumerated list, this
    // gate's disposal question. impact-vfx's capture gate asks the same list its
    // own freeze-quality question — one walker, two predicates, no drift.
    const offenders = auditEngineModules(engineDisposalViolations, { requireEffect: true })
    expect(offenders, `engine-owning components that leak on unmount:\n${offenders.join('\n')}`).toEqual([])
  })
})
