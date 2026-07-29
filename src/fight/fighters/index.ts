import type { FighterDef } from '../def'
import { OPERATOR } from './operator'
import { VANGUARD } from './vanguard'
import { WARDEN } from './warden'
import { SKINS, applySkinDeltas } from './skins'

/** Archetype registry. The sim reads every MOVESET through this map, so adding
 *  an archetype is purely data. Three today: a balanced shoto, a rushdown
 *  grappler, and a fireball zoner — no shared moveset between them.
 *
 *  This stays exactly three entries. Per-FACE identity lives in the separate
 *  `SKINS` registry (see ./skins), resolved below — keeping faces out of here is
 *  what lets `roster.ts`'s `Object.keys(FIGHTERS)` stay archetype-complete. */
export const FIGHTERS: Record<string, FighterDef> = {
  [OPERATOR.id]: OPERATOR,
  [VANGUARD.id]: VANGUARD,
  [WARDEN.id]: WARDEN,
}

/** Resolved skin defs, memoised. `getFighterDef` runs every sim frame, so a
 *  skin must not re-clone its base each call; and callers get a STABLE
 *  reference per id, matching the archetype path (which returns the singleton). */
const skinDefs = new Map<string, FighterDef>()

/** Resolve any fighter id — archetype OR skin — to its def. Archetypes hit the
 *  map directly; a face is its base moveset with the face's deltas layered on
 *  (`applySkinDeltas`, immutable). Unknown ids still throw, so a typo'd skin
 *  can't silently fall through to a base. */
export function getFighterDef(id: string): FighterDef {
  const def = FIGHTERS[id]
  if (def) return def
  const cached = skinDefs.get(id)
  if (cached) return cached
  const skin = SKINS[id]
  if (skin) {
    const base = FIGHTERS[skin.base]
    if (!base) throw new Error(`skin ${id} names unknown base ${skin.base}`)
    const resolved = applySkinDeltas(base, id, skin)
    skinDefs.set(id, resolved)
    return resolved
  }
  throw new Error(`unknown fighter: ${id}`)
}

export { OPERATOR, VANGUARD, WARDEN }
export { SKINS, applySkinDeltas, resolveSimFighter } from './skins'
export type { FighterPick, SkinDef, MoveDelta, ArchetypeId } from './skins'
