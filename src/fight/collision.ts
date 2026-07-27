/**
 * Pushbox separation and stage-wall clamping.
 *
 * Two rules that fighters lean on constantly and that are easy to get subtly
 * wrong: fighters may never occupy the same horizontal space, and when one is
 * pinned against a wall the separation they'd otherwise share is transferred
 * entirely to the other. That transfer is what produces corner pushback — a
 * defender in the corner stops moving and the attacker slides back instead.
 */

import type { FighterState } from './types'
import { STAGE_HALF_W } from './constants'

/** Keep a fighter's pushbox inside the stage given its half-width. */
export function clampToStage(f: FighterState, halfWidth: number): void {
  const min = -STAGE_HALF_W + halfWidth
  const max = STAGE_HALF_W - halfWidth
  if (f.pos.x < min) f.pos.x = min
  else if (f.pos.x > max) f.pos.x = max
}

export function isCornered(f: FighterState, halfWidth: number): boolean {
  const min = -STAGE_HALF_W + halfWidth
  const max = STAGE_HALF_W - halfWidth
  return f.pos.x <= min + 0.001 || f.pos.x >= max - 0.001
}

/**
 * Resolve pushbox overlap between two fighters. Pushboxes are centred on each
 * fighter's position, so overlap is a 1-D problem. The interpenetration is
 * split evenly, then any share a wall refuses is handed to the other fighter —
 * that hand-off is the corner-pushback mechanic.
 */
export function separate(
  a: FighterState,
  b: FighterState,
  halfA: number,
  halfB: number,
): void {
  const left = a.pos.x <= b.pos.x ? a : b
  const right = left === a ? b : a
  const halfL = left === a ? halfA : halfB
  const halfR = right === a ? halfA : halfB

  const minSep = halfL + halfR
  const gap = right.pos.x - left.pos.x
  if (gap >= minSep) return
  const pen = minSep - gap

  const lMin = -STAGE_HALF_W + halfL
  const rMax = STAGE_HALF_W - halfR

  let newL = left.pos.x - pen / 2
  let newR = right.pos.x + pen / 2

  // Hand a wall-blocked share to the other fighter so they never overlap.
  if (newL < lMin) {
    newR += lMin - newL
    newL = lMin
  }
  if (newR > rMax) {
    const overflow = newR - rMax
    newR = rMax
    newL -= overflow
    if (newL < lMin) newL = lMin
  }

  left.pos.x = newL
  right.pos.x = newR
}
