/**
 * The skin seam.
 *
 * Operators carries TWO character axes that the sim used to collapse into one:
 *
 *   • the SKIN (`?a`/`?b`) — a roster FACE: its atlas, name, accent. Six of them.
 *   • the ARCHETYPE (`?p1`/`?p2`) — the MOVESET. Three of them: operator (shoto),
 *     vanguard (grappler), warden (zoner).
 *
 * `FightSelect.launch()` used to hand the sim only the archetype, so `chesky`
 * and `lenny` — two faces onto `operator` — were byte-identical fighters. There
 * was nowhere per-face frame data could live. This module is that place: a
 * skin-keyed layer of DELTAS over an archetype base, so chesky can hit a hair
 * harder than lenny while both still fight as `operator`.
 *
 * It lands INERT. Every face below declares only its base and carries no
 * overrides, so `getFighterDef('chesky')` is byte-for-byte `getFighterDef(
 * 'operator')` with a different `id` today. The decoupling is the deliverable;
 * the numbers diverge later, as design work, one authored delta at a time.
 *
 * Deliberately NOT sourced from the card battler's 40-face registry
 * (`src/data/fighters.ts`, a different `FighterDef` type carrying visual
 * metadata only). `registrySeam.node.test.ts` enforces that no shipped module
 * under `src/fight/**` can reach it; this module imports only sim types, so the
 * seam stays clean. The select screen's presentation roster
 * (`src/fighthud/select/roster.ts`) pairs the same faces to the same
 * archetypes; a coherence test keeps the two registries in agreement.
 */

import type { FighterDef } from '../def'
import type { Hit, Move } from '../types'

/** The three movesets a face can build on. Kept a closed union so a skin whose
 *  `base` is misspelled fails to compile rather than throwing at fight start. */
export type ArchetypeId = 'operator' | 'vanguard' | 'warden'

/**
 * A per-move override layered onto the archetype's base move of the SAME id.
 *
 * Only `hit` is reachable, and that is on purpose: it is the field the sim
 * re-resolves from `getFighterDef(id).moves[id]` every active frame
 * (`combat.ts`), so a delta here actually reaches the strike. Fields the sim
 * reads off the object `FighterDef.select()` returns instead — notably
 * `move.cost`, consumed at `startMove` from the archetype's own closure — are
 * deliberately absent: a `cost` delta would author cleanly and then never be
 * consumed, which is precisely the "authored-but-never-consumed" defect class
 * this codebase keeps finding. EX specials (which DO need `cost`) will be new
 * move ids on the base moveset, selected by `select()`, not cost deltas here.
 *
 * The frame TIMELINE (`frames`, `active`) is not overridable: it is atlas-driven
 * and shared across a base's faces. A skin tunes numbers, not animation.
 */
export interface MoveDelta {
  /** Partial override of the base move's contact payload — damage, hitstun,
   *  hitstop, knockback, meter gain, etc. Shallow-merged onto the base `hit`. */
  hit?: Partial<Hit>
}

/**
 * How one roster FACE diverges from its archetype BASE. No overrides (the
 * shipped state today) means byte-identical to the base but for `id`.
 */
export interface SkinDef {
  /** Archetype moveset this face fights as. */
  base: ArchetypeId
  /** Starting-health override, so a face can be chunkier or frailer than its
   *  base. Consumed by `makeFighter` off the resolved def. Omit to inherit. */
  health?: number
  /** Per-move `hit` overrides, keyed by base move id. A key naming a move the
   *  base does not have is ignored — a delta cannot invent a move. */
  moves?: Record<string, MoveDelta>
}

/**
 * The sim-side skin registry: six faces onto three archetypes. This is the
 * skin→base mapping the sim needs and NOTHING more (no atlas, no accent — those
 * belong to the renderer's registries). It intentionally mirrors the pairing in
 * `src/fighthud/select/roster.ts`; `skinSeam.node.test.ts` fails if they drift.
 */
export const SKINS: Record<string, SkinDef> = {
  chesky: { base: 'operator' },
  lenny: { base: 'operator' },
  spiegel: { base: 'vanguard' },
  madhavan: { base: 'vanguard' },
  doshi: { base: 'warden' },
  turley: { base: 'warden' },
}

/**
 * Immutably layer a skin's deltas onto a base def. Returns a NEW def and NEVER
 * mutates the base or its moves — two faces share one base object, so mutating
 * it would leak one skin's numbers into the other and into the archetype
 * itself. Any delta keyed to a move the base lacks is dropped.
 */
export function applySkinDeltas(base: FighterDef, id: string, skin: SkinDef): FighterDef {
  const moves: Record<string, Move> = {}
  for (const [mid, mv] of Object.entries(base.moves)) {
    const d = skin.moves?.[mid]
    moves[mid] = d?.hit ? { ...mv, hit: { ...mv.hit, ...d.hit } } : mv
  }
  return { ...base, id, health: skin.health ?? base.health, moves }
}

/**
 * The two decoupled axes a match carries. `skin` is REQUIRED: a pick that names
 * no skin is the collapse this seam exists to make impossible, so the type
 * makes that state unrepresentable rather than merely asserting against it. The
 * compiler, not a runtime test, rejects `FightSelect` handing the sim a bare
 * archetype again — see `_FighterPickRequiresSkin` below.
 */
export interface FighterPick {
  /** Roster face (`?a`/`?b`). */
  skin: string
  /** Archetype moveset (`?p1`/`?p2`). */
  base: string
}

/**
 * Reconcile a pick to a `getFighterDef` id.
 *
 * When the skin's natural base IS the requested base — every select-screen
 * launch and every coherent capture — the SKIN wins, so its deltas apply and
 * the face reaches the sim. When a capture tool deliberately forces a FOREIGN
 * base (`?a=spiegel&p1=warden`, to photograph a vanguard face throwing warden's
 * fireballs), or the skin is unknown (`?a=reid`, which the renderer degrades to
 * a letter badge), the explicit BASE wins: we never graft a face's deltas onto
 * an alien moveset, and we never call `getFighterDef` with an id it can't
 * resolve. Both branches return a real registry key.
 *
 * Today, with no deltas authored, the coherent branch is observationally
 * identical to the old archetype-only path but for the resolved `id` — which is
 * the point: the seam changes what CAN diverge, not what does yet.
 */
export function resolveSimFighter(pick: FighterPick): string {
  const def = SKINS[pick.skin]
  return def && def.base === pick.base ? pick.skin : pick.base
}

// ── Compile-time guard (checked by `tsc -b`, not vitest) ─────────────────────
//
// `skin` must stay a REQUIRED field of FighterPick. Making it optional is
// exactly the shape the collapse needs to creep back — a sim you can construct
// without naming a face. If anyone does, `'skin' extends RequiredKeys<...>`
// flips to false and this stops compiling, failing the build rather than a
// test (strictly stronger — a runtime guard can be routed around, a type error
// cannot). Mirrors the `ExpectFalse` non-assignability guard in
// registrySeam.node.test.ts. Exported so `noUnusedLocals` can't elide it.
type RequiredKeys<T> = {
  [K in keyof T]-?: Record<never, never> extends Pick<T, K> ? never : K
}[keyof T]
type ExpectTrue<T extends true> = T
export type _FighterPickRequiresSkin = ExpectTrue<
  'skin' extends RequiredKeys<FighterPick> ? true : false
>
