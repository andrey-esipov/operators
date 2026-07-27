/**
 * Input encoding and motion recognition.
 *
 * The pure sim keeps a per-fighter ring of recent inputs so that motion inputs
 * (236, 623, charge…) can be recognised inside step() without any external
 * state. Each frame is packed into a single integer: the direction is stored
 * FACING-RELATIVE (6 always means "toward the opponent") so a quarter-circle-
 * forward is the same physical motion on both sides, exactly as the contract
 * describes. Buttons are not mirrored.
 *
 * Layout of the packed int:
 *   bits 0-3   facing-relative direction (1-9)
 *   bits 4-9   buttons pressed this frame (one bit per Button)
 *   bits 10-15 buttons held this frame
 */

import type { Button, Direction } from '../types'
import {
  CHARGE_MIN,
  CHARGE_RELEASE_WINDOW,
  DOUBLE_TAP_WINDOW,
  MOTION_WINDOW,
} from '../constants'

const BUTTON_BIT: Record<Button, number> = {
  lp: 0,
  mp: 1,
  hp: 2,
  lk: 3,
  mk: 4,
  hk: 5,
}

const ALL_BUTTONS: Button[] = ['lp', 'mp', 'hp', 'lk', 'mk', 'hk']

/** Mirror a raw stick direction into facing-relative space (facing left flips
 *  the horizontal component; verticals are untouched). */
export function toRelative(dir: Direction, facing: 1 | -1): Direction {
  if (facing === 1) return dir
  const flip: Record<Direction, Direction> = {
    1: 3, 2: 2, 3: 1, 4: 6, 5: 5, 6: 4, 7: 9, 8: 8, 9: 7,
  }
  return flip[dir]
}

/** Inverse of {@link toRelative} — turn a facing-relative intent (used by the
 *  AI) back into a raw stick direction for an InputFrame. The mirror is its own
 *  inverse, so this just delegates. */
export function toAbsolute(rel: Direction, facing: 1 | -1): Direction {
  return toRelative(rel, facing)
}

export function maskOf(buttons: ReadonlySet<Button>): number {
  let m = 0
  for (const b of ALL_BUTTONS) if (buttons.has(b)) m |= 1 << BUTTON_BIT[b]
  return m
}

export function encode(relDir: Direction, pressed: number, held: number): number {
  return (relDir & 0xf) | ((pressed & 0x3f) << 4) | ((held & 0x3f) << 10)
}

export function dirOf(packed: number): Direction {
  return (packed & 0xf) as Direction
}
export function pressedOf(packed: number): number {
  return (packed >> 4) & 0x3f
}
export function heldOf(packed: number): number {
  return (packed >> 10) & 0x3f
}
export function hasButton(mask: number, b: Button): boolean {
  return (mask & (1 << BUTTON_BIT[b])) !== 0
}

/** Is `dir` a forward direction (6/9/3)? Relative space, so "toward opponent". */
function isForward(d: Direction): boolean {
  return d === 6 || d === 9 || d === 3
}
/** Back directions (4/7/1). */
function isBack(d: Direction): boolean {
  return d === 4 || d === 7 || d === 1
}

/**
 * Recognise a numpad motion (e.g. "236", "623", "236236") as a subsequence of
 * the recent facing-relative directions, matched newest-first within `window`
 * frames. Intermediate stray directions are tolerated — real sticks roll
 * through diagonals — which is the leniency that stops a clean input being
 * dropped. The final digit need not be the very last frame, so pressing the
 * button a frame or two after finishing the motion still counts.
 */
export function detectMotion(
  log: number[],
  motion: string,
  window: number = MOTION_WINDOW,
): boolean {
  const need = motion.split('').map((c) => Number(c) as Direction)
  let ptr = need.length - 1
  const start = Math.max(0, log.length - window)
  for (let i = log.length - 1; i >= start && ptr >= 0; i--) {
    if (dirOf(log[i]) === need[ptr]) ptr--
  }
  return ptr < 0
}

/**
 * Charge motion: hold back for at least CHARGE_MIN frames, then forward within
 * the release window. Returns true on the frame forward is registered.
 */
export function detectCharge(log: number[]): boolean {
  // Find the most recent forward within the release window.
  let fwd = -1
  const start = Math.max(0, log.length - CHARGE_RELEASE_WINDOW)
  for (let i = log.length - 1; i >= start; i--) {
    if (isForward(dirOf(log[i]))) {
      fwd = i
      break
    }
  }
  if (fwd < 0) return false
  // Count the uninterrupted back charge immediately preceding it.
  let held = 0
  for (let i = fwd - 1; i >= 0; i--) {
    if (isBack(dirOf(log[i]))) held++
    else break
  }
  return held >= CHARGE_MIN
}

/** Double-tap of a direction (66 dash / 44 backdash) within the tap window. */
export function detectDoubleTap(log: number[], dir: Direction): boolean {
  if (log.length === 0 || dirOf(log[log.length - 1]) !== dir) return false
  const start = Math.max(0, log.length - DOUBLE_TAP_WINDOW)
  let sawGap = false
  for (let i = log.length - 2; i >= start; i--) {
    const d = dirOf(log[i])
    if (d !== dir) {
      sawGap = true
    } else if (sawGap) {
      return true // earlier tap, then a gap, then the current tap
    }
  }
  return false
}

/** Buttons that went from held to released between the last two logged frames
 *  — the basis for negative-edge special activation. */
export function releasedEdge(log: number[]): number {
  if (log.length < 2) return 0
  const prev = heldOf(log[log.length - 2])
  const now = heldOf(log[log.length - 1])
  return prev & ~now
}
