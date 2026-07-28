import type { FighterDef } from '../def'
import { OPERATOR } from './operator'
import { VANGUARD } from './vanguard'
import { WARDEN } from './warden'

/** Character registry. The sim reads every character through this map, so
 *  adding an archetype is purely data. Three today: a balanced shoto, a
 *  rushdown grappler, and a fireball zoner — no shared moveset between them. */
export const FIGHTERS: Record<string, FighterDef> = {
  [OPERATOR.id]: OPERATOR,
  [VANGUARD.id]: VANGUARD,
  [WARDEN.id]: WARDEN,
}

export function getFighterDef(id: string): FighterDef {
  const def = FIGHTERS[id]
  if (!def) throw new Error(`unknown fighter: ${id}`)
  return def
}

export { OPERATOR, VANGUARD, WARDEN }
