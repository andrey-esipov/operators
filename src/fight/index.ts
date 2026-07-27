/**
 * Public surface of the fighting-game simulation. The renderer and game loop
 * import from here; nothing reaches into the module internals.
 */

export * from './types'
export { FPS, DT } from './types'

export { step, createFight, makeFighter, fighterCanAct } from './sim'
export { scaleDamage } from './combat'
export { FighterAI, makeAI, type AIOptions, type Difficulty } from './ai'
export { makeRng, type Rng } from './rng'

export {
  type InputSource,
  KeyboardSource,
  GamepadSource,
  DEFAULT_KEYMAP,
  DEFAULT_PAD_BUTTONS,
  neutralInput,
  toNumpad,
  type KeyMap,
} from './input/sources'

export {
  toRelative,
  toAbsolute,
  detectMotion,
  detectCharge,
  detectDoubleTap,
} from './input/motion'

export { FIGHTERS, getFighterDef, OPERATOR } from './fighters'
export type { FighterDef, SelectContext } from './def'

export * as constants from './constants'
