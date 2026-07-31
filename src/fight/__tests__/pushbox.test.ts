import { describe, expect, it } from 'vitest'
import { step } from '../sim'
import { fightAtRange, inp, dir, NEU } from './helpers'
import { PUSHBOX_W, STAGE_HALF_W } from '../constants'
import type { FightState } from '../types'

describe('pushbox separation', () => {
  it('two fighters walking together never overlap pushboxes', () => {
    const minSep = PUSHBOX_W // full pushbox width; centres may not get closer
    let worst = Infinity
    let s: FightState = fightAtRange(240)
    for (let k = 0; k < 240; k++) {
      s = step(s, [dir(6), dir(6)]).state // both press toward each other
      const gap = Math.abs(s.fighters[0].pos.x - s.fighters[1].pos.x)
      worst = Math.min(worst, gap)
    }
    expect(worst).toBeGreaterThanOrEqual(minSep - 0.01)
  })

  it('neither fighter is ever pushed outside the stage', () => {
    let s: FightState = fightAtRange(80)
    for (let k = 0; k < 300; k++) {
      s = step(s, [dir(6), dir(4)]).state
      for (const f of s.fighters) {
        expect(f.pos.x).toBeGreaterThanOrEqual(-STAGE_HALF_W - 0.01)
        expect(f.pos.x).toBeLessThanOrEqual(STAGE_HALF_W + 0.01)
      }
    }
  })
})

describe('corner pushback', () => {
  it('a cornered defender stays put and the attacker slides back', () => {
    // Pin P2 in the right corner, P1 adjacent on its left.
    const s = fightAtRange(62)
    const wall = STAGE_HALF_W - PUSHBOX_W / 2
    s.fighters[1].pos.x = wall
    s.fighters[0].pos.x = wall - 62
    s.fighters[0].facing = 1
    s.fighters[1].facing = -1

    const attackerStartX = s.fighters[0].pos.x

    // P1 throws a heavy; P2 blocks (holds back = absolute 6, into the wall).
    let cur = s
    let sawBlock = false
    for (let f = 0; f < 40; f++) {
      const r = step(cur, [f === 0 ? inp(5, 'hp') : NEU, dir(6)])
      cur = r.state
      if (r.events.some((e) => e.type === 'block')) sawBlock = true
    }

    expect(sawBlock, 'the heavy must be blocked in the corner').toBe(true)
    // Defender did not get pushed through / away from the wall.
    expect(cur.fighters[1].pos.x).toBeGreaterThanOrEqual(wall - 0.5)
    // Attacker absorbed the pushback and slid away from the corner.
    expect(cur.fighters[0].pos.x).toBeLessThan(attackerStartX - 3)
  })
})
