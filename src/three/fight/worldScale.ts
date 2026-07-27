import * as THREE from 'three'
import type { Vec2 } from '../../fight/types'
import { WORLD } from '../types'

/**
 * The single source of truth for turning simulation coordinates into Three.js
 * world coordinates.
 *
 * The sim (see src/fight/types.ts) speaks centimetres, x rightward, y up from
 * the floor. The render world speaks the units every existing subsystem was
 * built around: WORLD.FIGHTER_HEIGHT (3.4) units ≈ a 1.8 m human standing on
 * y = 0. Fixing one global scale — rather than deriving it per fighter from
 * `heightCm` — matters: if two fighters used different cm→unit ratios, a hit
 * landing at a shared world point would map to two different sim points and the
 * contact sparks would miss. Position mapping is global; only the *sprite quad
 * size* is allowed to key off an individual fighter's heightCm.
 */

/** A reference human height in cm, mapped to WORLD.FIGHTER_HEIGHT units. */
export const REFERENCE_HEIGHT_CM = 180

/** Multiply a centimetre value by this to get world units. */
export const CM_TO_WORLD = WORLD.FIGHTER_HEIGHT / REFERENCE_HEIGHT_CM

/** Multiply a world-unit value by this to get centimetres. */
export const WORLD_TO_CM = 1 / CM_TO_WORLD

/**
 * Fighters and their sprite planes live on thin, distinct z slabs so the two
 * never z-fight and so P1 reads slightly in front of P2 when they overlap. The
 * gap is a couple of centimetres of world depth — invisible to the camera but
 * enough for the depth buffer.
 */
export const FIGHTER_Z = {
  a: 0.02,
  b: -0.02,
} as const

/** Convert a sim ground position (cm) to a world-space foot point (units). */
export function simToWorld(pos: Vec2, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(pos.x * CM_TO_WORLD, WORLD.GROUND_Y + pos.y * CM_TO_WORLD, 0)
}

/** Horizontal-only convenience: sim cm x → world x. */
export function cmXToWorld(x: number): number {
  return x * CM_TO_WORLD
}

/** Vertical-only convenience: sim cm height → world y above the floor. */
export function cmYToWorld(y: number): number {
  return WORLD.GROUND_Y + y * CM_TO_WORLD
}
