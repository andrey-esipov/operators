/**
 * Internal simulation types that are NOT part of the frozen renderer contract.
 * These describe a character's data and how raw inputs map to moves — things
 * only the sim needs. Kept out of types.ts so the renderer/asset agents aren't
 * exposed to them.
 */

import type { Button, Direction, Move } from './types'

export interface SelectContext {
  /** Facing-relative direction held this frame (6 = toward opponent). */
  relDir: Direction
  pressed: ReadonlySet<Button>
  /** Buttons released this frame (for negative edge). */
  released: ReadonlySet<Button>
  grounded: boolean
  crouching: boolean
  facing: 1 | -1
  meter: number
  /** Packed, facing-relative input log for motion recognition. */
  log: number[]
}

export interface FighterDef {
  id: string
  name: string
  health: number
  moves: Record<string, Move>
  /**
   * Given this frame's inputs, decide which move (if any) should start. Motion
   * specials and supers are resolved here and take priority over normals. The
   * sim calls this only when the fighter is actually allowed to act.
   */
  select(ctx: SelectContext): Move | null
}
