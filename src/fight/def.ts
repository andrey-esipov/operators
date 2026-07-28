/**
 * Internal simulation types that are NOT part of the frozen renderer contract.
 * These describe a character's data and how raw inputs map to moves — things
 * only the sim needs. Kept out of types.ts so the renderer/asset agents aren't
 * exposed to them.
 */

import type { Box, Button, Direction, Hit, Move } from './types'

/**
 * How a move spawns a projectile. Internal (not part of the frozen contract):
 * the sim reads this to know which move id turns into a fireball, where it
 * appears and what it does on contact. The move's own frame data carries no
 * melee hitbox — the projectile carries the `Hit` — so a fireball never also
 * punches.
 */
export interface ProjectileSpawn {
  /** Renderer visual hint copied onto the live projectile. */
  kind: string
  /** Forward travel speed, cm/frame (positive; the sim applies facing). */
  speed: number
  /** Spawn origin relative to the caster: forward (x) and up (y), cm. */
  originX: number
  originY: number
  /** Hitbox authored facing-right; mirrored and placed at the projectile. */
  hitbox: Box
  /** Contact payload — reuses the melee `Hit`, so it blocks, chips and stuns
   *  identically. Keep its `pushback` at 0: the caster is nowhere near. */
  hit: Hit
  /** Frames before it despawns on its own if it connects with nothing. */
  life: number
}

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
  /** Forward walk speed (cm/frame). Falls back to the global default when
   *  unset, so mobility is a per-archetype knob: a rushdown grappler walks in
   *  faster and retreats worse than a balanced shoto. */
  walkFwd?: number
  /** Backward walk speed (cm/frame). Falls back to the global default. */
  walkBack?: number
  moves: Record<string, Move>
  /**
   * Move id → the projectile it spawns on its first active frame, if any. A
   * zoner's fireballs live here; melee-only characters omit it entirely, which
   * is why `FightState.projectiles` stays undefined for them.
   */
  projectiles?: Record<string, ProjectileSpawn>
  /**
   * Given this frame's inputs, decide which move (if any) should start. Motion
   * specials and supers are resolved here and take priority over normals. The
   * sim calls this only when the fighter is actually allowed to act.
   */
  select(ctx: SelectContext): Move | null
}
