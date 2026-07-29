import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FighterDef as SimFighterDef } from '../def'
import type { FighterDef as CardFighterDef } from '../../types'

/**
 * Registry-seam guard — the fight SIMULATION and RENDERER must never source a
 * fighter from the CARD BATTLER's 40-face data registry.
 *
 * The trap this exists to spring. This project ships two unrelated games that
 * both have a `FighterDef` and both call something "the roster":
 *
 *   - the real-time FIGHTER — moveset data in `src/fight/fighters/{operator,
 *     vanguard,warden}.ts`, typed by `FighterDef` in `src/fight/def.ts`
 *     (`health`, `moves: Record<string, Move>`, a `select()` brain);
 *   - the turn-based CARD BATTLER — a 40-entry array in `src/data/fighters.ts`,
 *     typed by a *different* `FighterDef` in `src/types.ts` (`maxHp`, `ult`,
 *     `voiceLines`, `moves: Move[]`, and the per-skin `accent`/`reval` the fight
 *     shader legitimately reads for palette).
 *
 * The two types collide on the bare name `FighterDef`, and the card registry is
 * the fat, obvious, autocomplete-first file. So the predicted defect — voiced by
 * the visual critic — is: *"someone 'fixes the roster' by editing the 40-face
 * data registry and never touches the moveset."* The card battler has been a
 * gravity well repeatedly this session; every prior instance was found
 * forensically, after it shipped. This gate is the one chance to catch the class
 * in front of the fact, by making the wrong-registry wiring impossible to land
 * green.
 *
 * TWO INDEPENDENT MECHANISMS, each naming the exact proxy it asserts on:
 *
 *  1. IMPORT-GRAPH REACHABILITY (runtime, this file, executed by vitest). The
 *     proxy is a REAL, RESOLVABLE module edge — parsed by the TypeScript
 *     preprocessor, which reads actual `import` / `export … from` / dynamic
 *     `import()` / `require()` syntax (static, type-only and mixed alike) and so
 *     ignores a specifier that appears only in a comment or an unrelated string
 *     literal. From every shipped module under `src/fight/**` and
 *     `src/three/fight/**` we follow those edges TRANSITIVELY and assert the card
 *     registry is not in the reachable set. The proxy is REACHABILITY, not the
 *     presence of the text "data/fighters" — a commented-out import or a logging
 *     string cannot redden it, and a laundered edge through a shared util cannot
 *     hide from it.
 *
 *  2. TYPE NON-INTERCHANGEABILITY (compile-time, enforced by `tsc -b --force`
 *     via tsconfig.vitest.json — NOT by vitest, whose esbuild transform strips
 *     types and would wave a broken assertion straight through). The proxy is
 *     mutual non-assignability of the two `FighterDef` interfaces: if a refactor
 *     ever makes either assignable to the other — the precondition for one to be
 *     silently substituted for the other — the assertion below stops compiling.
 *
 * WHY THIS CAN'T LIE (the non-blindness controls, per this project's most
 * common failure — a walker that passes because it silently finds nothing):
 *  - the card registry must EXIST on disk, else "unreachable" is vacuous;
 *  - the walk must reach a substantial graph AND known sim modules (`sim.ts`,
 *    `def.ts`, `fighters/index.ts`), proving it actually traversed;
 *  - POSITIVE CONTROL: the SAME walker, pointed at `PlayableMatch.tsx` (which
 *    legitimately imports the card registry for palette), MUST reach it. A
 *    resolver that found nothing would fail this control instead of green-washing
 *    the invariant.
 *
 * Note the scope is the SIM and RENDERER, not the whole fight ROUTE:
 * `PlayableMatch.tsx` reads `getFighter().accent/reval` on purpose, so a
 * "route-wide" ban would be false. The invariant that actually matters is that
 * the SIMULATION's fighter data comes only from `src/fight/fighters/`.
 *
 * Sibling gates: `src/__tests__/instrumentRouting.node.test.ts` guards the
 * capture TOOLS against the same card battler; `firstLoadBudget.node.test.ts`
 * walks the entry graph for `three`. This one guards the shipped fight app graph.
 *
 * Mutation-proven by hand: add `import '../data/fighters'` to `src/fight/sim.ts`
 * and the SIM invariant reddens, naming the importer; point either type alias
 * above at the other module and `tsc -b --force` reddens. Both restored
 * byte-identical (md5) confirm recovery.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * MECHANISM 2 — compile-time type non-interchangeability (checked by tsc).
 * ──────────────────────────────────────────────────────────────────────────*/

/** `true` iff A is assignable to B. Tuple-wrapped so unions don't distribute. */
type IsAssignable<A, B> = [A] extends [B] ? true : false
/** Compiles only for `false`; receiving `true` is the type error we want. */
type ExpectFalse<T extends false> = T

// If either `FighterDef` becomes assignable to the other — someone unifies the
// shapes, or re-points one of these imports at the other module so the card type
// can flow where the sim type is expected — the matching `IsAssignable` flips to
// `true`, `ExpectFalse<true>` violates `T extends false`, and this file stops
// compiling under `tsc -b --force`. Exported so `noUnusedLocals` can't elide it.
export type _CardFighterDefIsNotASimFighterDef = ExpectFalse<IsAssignable<CardFighterDef, SimFighterDef>>
export type _SimFighterDefIsNotACardFighterDef = ExpectFalse<IsAssignable<SimFighterDef, CardFighterDef>>

/* ────────────────────────────────────────────────────────────────────────────
 * MECHANISM 1 — runtime import-graph reachability (executed by vitest).
 * ──────────────────────────────────────────────────────────────────────────*/

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '../..') // src/
const CARD_REGISTRY = resolve(SRC, 'data/fighters.ts')
const rel = (abs: string) => abs.replace(SRC + '/', '')

const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

/** Resolve a *relative* specifier to a real source file, or null. Bare
 *  (node_modules) specifiers return null — external edges can't reach our src. */
function resolveRelative(fromFile: string, spec: string): string | null {
  const clean = spec.split('?')[0] // drop ?raw / ?url / ?worker query suffixes
  if (!clean.startsWith('.')) return null
  const base = resolve(dirname(fromFile), clean)
  const cands: string[] = []
  if (extname(base)) {
    cands.push(base)
    // NodeNext-style `./x.js` can denote `./x.ts`. Remap defensively: a MISSED
    // edge is a false green, the one direction this safety gate must never fail.
    if (/\.jsx?$/.test(base)) cands.push(base.replace(/\.jsx?$/, '.ts'), base.replace(/\.jsx?$/, '.tsx'))
  }
  for (const e of EXTS) cands.push(base + e)
  for (const e of EXTS) cands.push(resolve(base, 'index' + e))
  return cands.find((c) => existsSync(c)) ?? null
}

/** Every module specifier a file references — static import, `export … from`,
 *  dynamic `import()`, `require()`, type-only and value alike — via the
 *  TypeScript preprocessor. Because it reads real syntax, specifiers quoted in a
 *  COMMENT or sitting in an unrelated string literal are correctly ignored. */
function edgesOf(file: string): string[] {
  return ts.preProcessFile(readFileSync(file, 'utf8'), true, true).importedFiles.map((f) => f.fileName)
}

/** Shipped source files under a directory — excludes `__tests__/` and any
 *  `*.test.*` / `*.probe.*`, which are not shipped modules and may legitimately
 *  reference either registry. */
function shippedRootsUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === '__tests__') continue
      out.push(...shippedRootsUnder(p))
    } else if (/\.(ts|tsx)$/.test(ent.name) && !/\.(test|probe)\./.test(ent.name)) {
      out.push(p)
    }
  }
  return out
}

/** Transitive closure of in-`src` files reachable from `roots` (roots included). */
function reachableFrom(roots: string[]): Set<string> {
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

/** Which reachable files import `target` DIRECTLY — for an actionable failure. */
function directImportersOf(target: string, files: Iterable<string>): string[] {
  const out: string[] = []
  for (const f of files) {
    if (f === target) continue
    let specs: string[]
    try {
      specs = edgesOf(f)
    } catch {
      continue
    }
    if (specs.some((s) => resolveRelative(f, s) === target)) out.push(rel(f))
  }
  return out.sort()
}

const simRoots = shippedRootsUnder(resolve(SRC, 'fight'))
const rendRoots = shippedRootsUnder(resolve(SRC, 'three/fight'))
const simReach = reachableFrom(simRoots)
const rendReach = reachableFrom(rendRoots)
const playableMatchReach = reachableFrom([resolve(SRC, 'play/PlayableMatch.tsx')])

describe('registry seam: the fight sim/renderer must not reach the card battler registry', () => {
  it('the card registry exists on disk (else "unreachable" would be vacuous)', () => {
    expect(existsSync(CARD_REGISTRY), `${rel(CARD_REGISTRY)} not found — the gate would pass on nothing`).toBe(true)
  })

  it('collected real shipped roots for both graphs (vacuity — not mis-rooted/empty)', () => {
    // Honest floors below the true shipped counts (18 sim, 16 renderer at time of
    // writing) with margin for churn — their JOB is to catch an empty/mis-rooted
    // walk, not to pin an exact census. Edge-following is proven by the POSITIVE
    // CONTROL below, not here.
    expect(simRoots.length, 'no shipped modules under src/fight — walker mis-rooted').toBeGreaterThan(12)
    expect(rendRoots.length, 'no shipped modules under src/three/fight — walker mis-rooted').toBeGreaterThan(10)
    for (const known of ['fight/sim.ts', 'fight/def.ts', 'fight/fighters/index.ts']) {
      expect(simReach.has(resolve(SRC, known)), `sim graph missing ${known}`).toBe(true)
    }
    expect(
      rendReach.has(resolve(SRC, 'three/fight/FightRenderer.ts')),
      'renderer graph missing FightRenderer.ts',
    ).toBe(true)
  })

  it('POSITIVE CONTROL: the same walker DOES reach the card registry from PlayableMatch', () => {
    // PlayableMatch legitimately imports getFighter() for accent/reval. If the
    // walker came back clean HERE, every "unreachable" below would be a blind
    // resolver passing on everything.
    expect(
      playableMatchReach.has(CARD_REGISTRY),
      'walker failed to reach the card registry from a file that provably imports it — resolver is blind',
    ).toBe(true)
  })

  it('no shipped fight-SIM module (src/fight/**) reaches the card registry', () => {
    const reached = simReach.has(CARD_REGISTRY)
    const importers = reached ? directImportersOf(CARD_REGISTRY, simReach) : []
    expect(
      reached,
      `src/fight/** now reaches ${rel(CARD_REGISTRY)} via:\n  ${importers.join('\n  ')}\n` +
        `The fight sim's fighter data must come ONLY from src/fight/fighters/. ` +
        `Edit the moveset there — not the 40-face card registry.`,
    ).toBe(false)
  })

  it('no shipped fight-RENDERER module (src/three/fight/**) reaches the card registry', () => {
    const reached = rendReach.has(CARD_REGISTRY)
    const importers = reached ? directImportersOf(CARD_REGISTRY, rendReach) : []
    expect(
      reached,
      `src/three/fight/** now reaches ${rel(CARD_REGISTRY)} via:\n  ${importers.join('\n  ')}\n` +
        `The renderer receives fighter assets through setFighterAssets(); it must ` +
        `not pull from the card registry.`,
    ).toBe(false)
  })

  it('the two FighterDef types stay non-interchangeable (enforced by tsc; documented here)', () => {
    // This assertion is COMPILE-TIME: the `ExpectFalse<IsAssignable<…>>` aliases
    // near the top of this file are checked by `tsc -b --force`, not by vitest
    // (esbuild erases types). The runtime facts we CAN check are that both
    // interfaces still exist as DISTINCT declarations in different modules — so a
    // deletion or a merge that would make the type guard vacuous is visible here
    // too (and would independently break the `import type` above under tsc).
    const simDef = readFileSync(resolve(SRC, 'fight/def.ts'), 'utf8')
    const cardDef = readFileSync(resolve(SRC, 'types.ts'), 'utf8')
    expect(simDef).toMatch(/export interface FighterDef\b/)
    expect(cardDef).toMatch(/export interface FighterDef\b/)
    expect(resolve(SRC, 'fight/def.ts')).not.toBe(resolve(SRC, 'types.ts'))
  })
})
