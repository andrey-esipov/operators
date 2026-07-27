import type { FighterDef } from '../def'
import { OPERATOR } from './operator'
import { VANGUARD } from './vanguard'

/** Character registry. The sim reads every character through this map, so
 *  adding an archetype is purely data. Two today: a balanced shoto and a
 *  rushdown grappler that share no moveset. */
export const FIGHTERS: Record<string, FighterDef> = {
  [OPERATOR.id]: OPERATOR,
  [VANGUARD.id]: VANGUARD,
}

export function getFighterDef(id: string): FighterDef {
  const def = FIGHTERS[id]
  if (!def) throw new Error(`unknown fighter: ${id}`)
  return def
}

export { OPERATOR, VANGUARD }
