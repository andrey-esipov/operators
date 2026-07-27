/**
 * Shared test helpers: input builders and a small frame-runner. Kept separate
 * so the tests read as behaviour, not plumbing.
 */

import type { Button, Direction, FightEvent, FightState, InputFrame } from '../types'
import { createFight, step } from '../sim'

/** Input frame with the given direction and buttons pressed this frame. */
export function inp(dir: Direction, ...buttons: Button[]): InputFrame {
  const set = new Set<Button>(buttons)
  return { dir, held: set, pressed: set }
}

/** Direction hold with no buttons. */
export function dir(d: Direction): InputFrame {
  return { dir: d, held: new Set(), pressed: new Set() }
}

/** A button held (not freshly pressed) — for motion tails. */
export function hold(d: Direction, ...buttons: Button[]): InputFrame {
  const set = new Set<Button>(buttons)
  return { dir: d, held: set, pressed: new Set() }
}

export const NEU: InputFrame = dir(5)

export type Feeder = (frame: number, state: FightState) => InputFrame

export interface RunResult {
  state: FightState
  events: FightEvent[]
  /** Events grouped by the frame index they fired on. */
  byFrame: FightEvent[][]
}

/** Run `n` frames, feeding each fighter from its feeder. Returns the final
 *  state and every event, both flat and grouped by frame. */
export function run(state: FightState, n: number, f0: Feeder, f1: Feeder): RunResult {
  let s = state
  const events: FightEvent[] = []
  const byFrame: FightEvent[][] = []
  for (let k = 0; k < n; k++) {
    const r = step(s, [f0(k, s), f1(k, s)])
    s = r.state
    events.push(...r.events)
    byFrame.push(r.events)
  }
  return { state: s, events, byFrame }
}

/** A fight forced into the fight phase with the two fighters `gap` cm apart,
 *  centred and facing each other — the standard rig for combat unit tests. */
export function fightAtRange(gap: number): FightState {
  const s = createFight('operator', 'operator')
  s.phase = 'fight'
  s.phaseTimer = 0
  s.fighters[0].pos.x = -gap / 2
  s.fighters[1].pos.x = gap / 2
  s.fighters[0].facing = 1
  s.fighters[1].facing = -1
  return s
}

/** Stable string form for equality checks. FightState holds no Sets, so this is
 *  total. */
export function serialize(s: FightState): string {
  return JSON.stringify(s)
}
