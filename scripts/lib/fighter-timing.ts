/**
 * Skin → per-move attack timing, the bridge the atlas build uses to lay out the
 * kick ladder from each archetype's real frame data (see frame-spec
 * `deriveAttackClip`). Kept in one place so the full pipeline (generate-animation-set)
 * and the manifest-only clip rebuild (rebuild-manifest-clips) read the SAME
 * timing and cannot diverge.
 *
 * The two axes the sim decouples: a *skin* (atlas art, e.g. `chesky`) and an
 * *archetype* (the moveset, e.g. `operator`). Only skins joined to an archetype
 * in the select roster have a moveset; the unplayable card-art skins return
 * undefined and fall back to the static kick clips.
 */
import { FIGHTERS } from '../../src/fight/fighters'
import { ROSTER } from '../../src/fighthud/select/roster'
import type { Move } from '../../src/fight/types'
import type { MoveTiming } from './frame-spec'

/** Recover startup/active/recovery from a built Move. `active` is the inclusive
 *  window [startup, startup+active-1] and `frames.length` is the full duration,
 *  so both phase lengths fall straight out — no second copy of the numbers. */
export function timingOf(move: Move): MoveTiming {
  const startup = move.active[0]
  const active = move.active[1] - move.active[0] + 1
  const recovery = move.frames.length - move.active[1] - 1
  return { startup, active, recovery }
}

/**
 * The move-id → timing map for a skin's archetype, or undefined when the skin
 * has no moveset (unplayable card art). Passed straight into `buildClips`.
 */
export function attackTimingForSkin(skinId: string): Map<string, MoveTiming> | undefined {
  const entry = ROSTER.find((r) => r.skin === skinId)
  if (!entry) return undefined
  const def = FIGHTERS[entry.archetype]
  if (!def) return undefined
  const timing = new Map<string, MoveTiming>()
  for (const [moveId, move] of Object.entries(def.moves)) {
    timing.set(moveId, timingOf(move))
  }
  return timing
}

/** The archetype a skin is joined to in the select roster, or undefined for the
 *  unplayable card-art skins. Read by the generator to decide which
 *  archetype-specific cel families a skin may bake. */
export function archetypeForSkin(skinId: string): string | undefined {
  return ROSTER.find((r) => r.skin === skinId)?.archetype
}
