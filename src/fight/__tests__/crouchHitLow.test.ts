/**
 * The renderer can only play the low hit reaction (`hit-low`) if the sim tells it
 * the victim was crouching when struck. That signal is `FighterState.hitLow`, set
 * in `combat.applyHit` at the moment a non-launching, non-knockdown hit resolves.
 * This gates the SIM half of the wiring end to end: we run the real fight loop,
 * land one move on a crouching vs a standing victim, and read the flag off the
 * stepped state — the same `FighterState` the renderer interpolates into a
 * FighterView. A unit test on applyHit in isolation would not prove the flag
 * survives a real `step`; this does.
 *
 * Teeth: if applyHit stops reading the pre-hit stance (the mutation), the crouch
 * case collapses to `false` and the first assertion reds. A vacuous "landed at
 * all" check would pass either way, so we assert the flag's VALUE per stance.
 */

import { describe, expect, it } from 'vitest'
import { createFight, step } from '../sim'
import { inp, dir } from './helpers'
import type { Button, Direction, FightState } from '../types'

/** Land exactly one move from fighter 0 on fighter 1 at point-blank while fighter
 *  1 holds `victimDir` (2 = crouch, 5 = stand). Returns whether a hit reaction
 *  began and the `hitLow` flag captured on that first hitstun frame. */
function landOn(victimDir: Direction, btn: Button): { landed: boolean; hitLow: boolean } {
  const s = createFight('operator', 'operator') as FightState
  s.phase = 'fight'
  s.phaseTimer = 0
  s.fighters[0].pos = { x: -1.2, y: 0 }
  s.fighters[1].pos = { x: 1.2, y: 0 }
  s.fighters[0].facing = 1
  s.fighters[1].facing = -1
  let st = s
  let landed = false
  let hitLow = false
  for (let k = 0; k < 60; k++) {
    // Fighter 0 presses the button once (neutral direction so it stays grounded);
    // fighter 1 only ever holds a direction, so it never blocks (block needs
    // holding away, dir 6 here) — a held `2` is a pure crouch.
    const atk = k === 0 ? inp(5, btn) : dir(5)
    st = step(st, [atk, dir(victimDir)]).state
    const v = st.fighters[1]
    if (!landed && v.stance === 'hitstun') {
      landed = true
      hitLow = !!v.hitLow
    }
  }
  return { landed, hitLow }
}

describe('combat marks a crouch-hit so the renderer can select hit-low', () => {
  it('a hit that connects on a crouching victim sets hitLow', () => {
    const r = landOn(2, 'hp')
    expect(r.landed).toBe(true)
    expect(r.hitLow).toBe(true)
  })

  it('the same hit on a standing victim leaves hitLow unset', () => {
    const r = landOn(5, 'hp')
    expect(r.landed).toBe(true)
    expect(r.hitLow).toBe(false)
  })
})
