import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { existsSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Instrument routing gate — a capture/measurement tool that CLAIMS to observe the
 * shipped fighter must not secretly address the card battler.
 *
 * The defect this gate exists to prevent has bitten this project repeatedly and
 * expensively: `tools/shot.mjs` HARDCODED `?lab=1` and waited on `window.__OPS3D__`,
 * so every generic screenshot it ever took was of the LEGACY CARD BATTLER
 * (FightScene3D + VfxSubsystem) — the game we do not sell — while everyone read the
 * frames as the shipped fighter (FightRenderer + FightVfx/ProjectileLayer, reached
 * via `?fight=1`/__FIGHT__ and `?play=1`/__PLAY__). A "12.8% wash" super finding was
 * measured on the card game's gold sunburst and used to (nearly) dim the shipped
 * game's blue beam, which is defective in the OPPOSITE direction. Two applications,
 * one dev server, and no committed check that a tool points at the right one.
 *
 * `tools/instrument-manifest.json` is the committed classifier: every tools/*.mjs is
 * declared as shipped-fight / shipped-play / shipped-ui / shipped-audio / card-lab /
 * card-ui / analysis / generic / meta / dual / stranded. The manifest is a human
 * declaration of INTENT; this gate independently re-derives each tool's card contact
 * from source and reddens on any disagreement.
 *
 * WHY THIS CAN'T LIE (source-true, comment-safe, non-vacuous):
 *  - It parses each tool with the TypeScript scanner and inspects only STRING
 *    LITERALS (incl. template chunks) and IDENTIFIERS — so a card token quoted in a
 *    COMMENT ("don't use ?lab=1") is correctly ignored, and a real
 *    `window.__OPS3D__` call or a `?lab=1` URL chunk is not.
 *  - `window.__game` / `startMatch` ALONE are NOT treated as card tokens: that store
 *    is shared and the renderer depends on the route. The card-UI signal is the
 *    turn-based combat surface (`.combat-turn-prompt`, `MoveCard`, `castMove`), which
 *    the real-time fighter does not have.
 *  - Vacuity guard: the manifest must cover a substantial number of tools AND a large
 *    shipped set, and every declared file must exist and parse to non-empty source. A
 *    manifest that silently classifies nothing cannot pass green.
 *  - Completeness guard: the manifest set must EQUAL the set of git-TRACKED tools/*.mjs
 *    (committed reality — NOT transient working-tree scratch that other live agents may
 *    have uncommitted in this shared worktree). A new tool COMMITTED without a manifest
 *    entry reddens here; this is the "checks 6 of 8" blind spot that has produced three
 *    separate lying harnesses in this repo. Enumerating the tracked set (not readdir)
 *    also keeps the gate green on a clean checkout of this commit alone.
 *  - Positive controls: the card-lab detector must fire on `measure-impact.mjs`
 *    (?lab=1/__OPS3D__) and the second-class card-UI detector must fire on
 *    `hud-probe.mjs` (.combat-turn-prompt). If a "clean" walker found nothing, these
 *    known-dirty tools would prove it blind.
 *  - Synthetic mutation control: the EXACT predicate used on shipped tools, applied to
 *    a known card tool as if it were declared `shipped-fight`, MUST fail. This
 *    exercises the failure path directly, not just the happy path.
 *
 * What this gate is CONSTITUTIONALLY UNABLE to see (stated, not hidden):
 *  - A route assembled at runtime from concatenated variables or an env value, or a
 *    route supplied by the CALLER (the `generic` bucket) — the token is not in source.
 *    This is exactly why the fix for `shot.mjs` was to change its DEFAULT, not just to
 *    document it: a correct default protects callers this static gate cannot inspect.
 *  - Whether a shipped-declared tool measures the RIGHT shipped thing (e.g. beam vs
 *    melee super). That is a semantic claim; this gate only guarantees it is not the
 *    card game.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const TOOLS = resolve(HERE, '../../tools')
const MANIFEST = resolve(TOOLS, 'instrument-manifest.json')

const SHIPPED_BUCKETS = ['shipped-fight', 'shipped-play', 'shipped-ui', 'shipped-audio']
// Only these buckets are permitted to contain card tokens in code. Everything else
// (all shipped-*, analysis, generic, stranded) must be card-clean.
const ALLOWED_CARD_TOKEN_BUCKETS = ['card-lab', 'card-ui', 'dual', 'meta']

interface Manifest {
  tools: Record<string, { app: string; note?: string }>
}
const manifest: Manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))

interface Scanned {
  /** Concatenated text of every string literal + template chunk (comments excluded). */
  strings: string
  /** Every identifier name in the file. */
  idents: Set<string>
  /** Raw source length, to prove the file was actually read. */
  len: number
}

const SCAN_CACHE = new Map<string, Scanned>()
/**
 * Resolve a tool name to its file. Tools are written in either JavaScript or
 * TypeScript, so the extension is discovered rather than assumed — hardcoding
 * `.mjs` here is what previously let a tracked `.ts` tool slip past every check
 * in this file (see the enumeration note below).
 */
function toolFile(tool: string): { path: string; kind: ts.ScriptKind } {
  for (const [ext, kind] of [
    ['.mjs', ts.ScriptKind.JS],
    ['.ts', ts.ScriptKind.TS],
  ] as const) {
    const p = resolve(TOOLS, `${tool}${ext}`)
    if (existsSync(p)) return { path: p, kind }
  }
  throw new Error(`instrument-manifest names '${tool}' but neither tools/${tool}.mjs nor tools/${tool}.ts exists`)
}

function scan(tool: string): Scanned {
  const cached = SCAN_CACHE.get(tool)
  if (cached) return cached
  const { path, kind } = toolFile(tool)
  const src = readFileSync(path, 'utf8')
  const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, kind)
  const parts: string[] = []
  const idents = new Set<string>()
  const K = ts.SyntaxKind
  const visit = (node: ts.Node): void => {
    if (
      node.kind === K.StringLiteral ||
      node.kind === K.NoSubstitutionTemplateLiteral ||
      node.kind === K.TemplateHead ||
      node.kind === K.TemplateMiddle ||
      node.kind === K.TemplateTail
    ) {
      parts.push((node as ts.LiteralLikeNode).text)
    }
    if (ts.isIdentifier(node)) idents.add(node.text)
    ts.forEachChild(node, visit)
  }
  visit(sf)
  const result: Scanned = { strings: parts.join('\u0000'), idents, len: src.length }
  SCAN_CACHE.set(tool, result)
  return result
}

/** Card-battler route/handle/UI tokens found in a tool's CODE (not comments). */
function cardHits(s: Scanned): string[] {
  const hits: string[] = []
  for (const t of ['lab=1', 'cards=1']) if (s.strings.includes(t)) hits.push(t)
  if (s.idents.has('__OPS3D__') || s.strings.includes('__OPS3D__')) hits.push('__OPS3D__')
  if (s.strings.includes('combat-turn-prompt')) hits.push('combat-turn-prompt')
  if (s.idents.has('castMove') || s.strings.includes('castMove')) hits.push('castMove')
  if (s.idents.has('MoveCard') || s.strings.includes('MoveCard')) hits.push('MoveCard')
  return hits
}

const entries = Object.entries(manifest.tools)
// Enumerate the COMMITTED tool set (git-tracked), not readdir: this shared worktree
// holds other agents' uncommitted scratch, and the manifest must describe what
// ships in this commit. If git is unavailable the list is empty and the vacuity +
// completeness guards below redden loudly rather than passing on nothing.
//
// BOTH extensions. This enumerated only '*.mjs' until a tracked TypeScript tool
// (tools/measure-contact-sim.ts) was found sitting outside every check in this
// file — unclassified, unscanned, and invisible to the completeness guard that
// exists precisely to prove there is no blind spot. A tool is a tool whatever it
// is written in; the language is not the boundary this gate is about.
const tracked = execSync("git ls-files -- '*.mjs' '*.ts'", { cwd: TOOLS, encoding: 'utf8' })
  .split('\n')
  .map((f) => f.trim())
  .filter(Boolean)
  .map((f) => f.replace(/\.(mjs|ts)$/, ''))

describe('instrument routing: shipped-fighter tools must not address the card battler', () => {
  it('classifies a substantial, fully-populated tool set (vacuity guard)', () => {
    expect(entries.length).toBeGreaterThan(60)
    expect(tracked.length, 'git ls-files returned no tools — cannot enumerate the committed set').toBeGreaterThan(60)
    const shipped = entries.filter(([, v]) => SHIPPED_BUCKETS.includes(v.app))
    expect(shipped.length).toBeGreaterThan(20)
    // Every declared tool must exist and parse to real source — a manifest of
    // phantom files could make every rule below vacuously green.
    for (const [tool] of entries) expect(scan(tool).len, `${tool}.mjs is empty/unreadable`).toBeGreaterThan(0)
  })

  it('covers every git-tracked tool exactly once (completeness — no blind spot)', () => {
    const declared = new Set(entries.map(([k]) => k))
    const missing = tracked.filter((t) => !declared.has(t))
    const stale = [...declared].filter((t) => !tracked.includes(t))
    expect(missing, `git-tracked tools with no manifest entry:\n  ${missing.join('\n  ')}`).toEqual([])
    expect(stale, `manifest entries not tracked in git:\n  ${stale.join('\n  ')}`).toEqual([])
  })

  it('keeps the card-token escape hatch narrow (only card-lab/card-ui/dual/meta)', () => {
    // Prevents widening the exemption to smuggle a card tool past the rule below.
    expect([...ALLOWED_CARD_TOKEN_BUCKETS].sort()).toEqual(['card-lab', 'card-ui', 'dual', 'meta'])
    expect(entries.filter(([, v]) => v.app === 'dual').length).toBeLessThanOrEqual(1)
    expect(entries.filter(([, v]) => v.app === 'meta').length).toBeLessThanOrEqual(2)
  })

  it('every non-card-declared tool is card-clean in code (the core invariant)', () => {
    const violations: string[] = []
    for (const [tool, { app }] of entries) {
      if (ALLOWED_CARD_TOKEN_BUCKETS.includes(app)) continue
      const hits = cardHits(scan(tool))
      if (hits.length) violations.push(`${tool} (declared ${app}) → card tokens: ${hits.join(', ')}`)
    }
    expect(
      violations,
      `these tools claim not to touch the card battler but their source does:\n  ${violations.join('\n  ')}`,
    ).toEqual([])
  })

  it('every card-lab tool actually contains a card route/handle token (labels are truthful)', () => {
    const mislabeled: string[] = []
    for (const [tool, { app }] of entries) {
      if (app !== 'card-lab') continue
      const s = scan(tool)
      const hasRouteOrHandle = s.strings.includes('lab=1') || s.idents.has('__OPS3D__') || s.strings.includes('__OPS3D__')
      if (!hasRouteOrHandle) mislabeled.push(tool)
    }
    expect(
      mislabeled,
      `declared card-lab but no ?lab=1/__OPS3D__ found — repointed or mislabeled:\n  ${mislabeled.join('\n  ')}`,
    ).toEqual([])
  })

  it('the dual tool (shot.mjs) defaults to a shipped route, not the lab', () => {
    const dual = entries.filter(([, v]) => v.app === 'dual').map(([k]) => k)
    expect(dual).toContain('shot')
    const src = readFileSync(resolve(TOOLS, 'shot.mjs'), 'utf8')
    // The default of the --route arg must be a shipped route (fight|play).
    expect(
      /arg\(\s*['"]route['"]\s*,\s*['"](fight|play)['"]\s*\)/.test(src),
      'shot.mjs must default --route to a shipped route (fight|play)',
    ).toBe(true)
  })

  it('positive control: the card-lab detector fires on measure-impact.mjs', () => {
    // ?lab=1 + __OPS3D__. If this came back clean the "clean" checks above would be
    // a blind walker passing on everything.
    expect(cardHits(scan('measure-impact')).length).toBeGreaterThan(0)
  })

  it('positive control: the second-class card-UI detector fires on hud-probe.mjs', () => {
    // .combat-turn-prompt — a card tool that uses the shared __game store and never
    // touches ?lab=1. Proves the detector sees the turn-based UI, not just ThreeLab.
    expect(cardHits(scan('hud-probe'))).toContain('combat-turn-prompt')
  })

  it('synthetic mutation control: a card tool mislabeled shipped WOULD fail the core invariant', () => {
    // Apply the EXACT predicate the core invariant uses to measure-impact as if it
    // were declared shipped-fight. It must be non-clean — otherwise the invariant
    // could never catch the very defect it exists for.
    const pretendBucket = 'shipped-fight'
    const wouldBeChecked = !ALLOWED_CARD_TOKEN_BUCKETS.includes(pretendBucket)
    const hits = cardHits(scan('measure-impact'))
    expect(wouldBeChecked && hits.length > 0).toBe(true)
  })
})
