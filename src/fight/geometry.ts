/**
 * Box maths in world space. Frame data authors boxes relative to a fighter's
 * origin (feet, facing right); these helpers place them into the world for a
 * given position and facing, and test overlap.
 */

import type { Box, Vec2 } from './types'

/**
 * Resolve a frame-data box (authored facing right, origin at the feet) into an
 * absolute world-space rect for a fighter standing at `pos` facing `facing`.
 * When facing left the box is mirrored across the origin so a forward-poking
 * hitbox pokes the correct way.
 */
export function placeBox(box: Box, pos: Vec2, facing: 1 | -1): Box {
  const x = facing === 1 ? pos.x + box.x : pos.x - box.x - box.w
  return { x, y: pos.y + box.y, w: box.w, h: box.h }
}

/** Standard AABB overlap. Touching edges do not count as overlapping. */
export function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  )
}

/** Do any hitboxes overlap any hurtboxes? Used for hit detection. */
export function anyOverlap(as: Box[], bs: Box[]): boolean {
  for (const a of as) for (const b of bs) if (overlaps(a, b)) return true
  return false
}

/** Centre of a box, handy for spawning effects at the point of contact. */
export function centre(box: Box): Vec2 {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 }
}

/** First overlapping pair's shared centre, or null. Gives the renderer a spark
 *  origin without leaking box internals. */
export function contactPoint(as: Box[], bs: Box[]): Vec2 | null {
  for (const a of as) {
    for (const b of bs) {
      if (overlaps(a, b)) {
        const x = Math.max(a.x, b.x)
        const y = Math.max(a.y, b.y)
        const x2 = Math.min(a.x + a.w, b.x + b.w)
        const y2 = Math.min(a.y + a.h, b.y + b.h)
        return { x: (x + x2) / 2, y: (y + y2) / 2 }
      }
    }
  }
  return null
}
