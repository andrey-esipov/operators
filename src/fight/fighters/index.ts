import type { FighterDef } from '../def'
import { OPERATOR } from './operator'

/** Character registry. One fully-realised fighter today; the sim reads every
 *  character through this map, so adding a second is purely data. */
export const FIGHTERS: Record<string, FighterDef> = {
  [OPERATOR.id]: OPERATOR,
}

export function getFighterDef(id: string): FighterDef {
  const def = FIGHTERS[id]
  if (!def) throw new Error(`unknown fighter: ${id}`)
  return def
}

export { OPERATOR }
