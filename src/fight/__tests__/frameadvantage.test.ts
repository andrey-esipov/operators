import { describe, expect, it } from 'vitest'
import { step, fighterCanAct } from '../sim'
import { fightAtRange, inp, dir, NEU } from './helpers'
import type { FightState } from '../types'

/**
 * Drive attacker P1 through a single normal that the blocking P2 holds against,
 * and measure how many frames separate each fighter regaining control. That
 * difference *is* the on-block frame advantage — measured from the running sim,
 * not read off the data.
 */
function measureOnBlock(startMove: () => ReturnType<typeof inp>): number {
  let s: FightState = fightAtRange(62)
  // P2 stands and holds back (away from P1 on its left → absolute 6).
  const p2Block = dir(6)

  let enteredAttack = false
  let blocked = false
  let attackerFree = -1
  let defenderFree = -1

  for (let f = 0; f < 120; f++) {
    const p1 = f === 0 ? startMove() : NEU
    s = step(s, [p1, p2Block]).state
    const A = s.fighters[0]
    const D = s.fighters[1]
    if (A.stance === 'attack') enteredAttack = true
    if (D.stance === 'blockstun') blocked = true
    if (enteredAttack && attackerFree < 0 && fighterCanAct(s, 0)) attackerFree = f
    if (blocked && defenderFree < 0 && D.stunRemaining === 0 && D.stance !== 'blockstun') {
      defenderFree = f
    }
    if (attackerFree >= 0 && defenderFree >= 0) break
  }

  expect(blocked, 'the attack must actually be blocked').toBe(true)
  expect(attackerFree, 'attacker must recover').toBeGreaterThanOrEqual(0)
  expect(defenderFree, 'defender must recover').toBeGreaterThanOrEqual(0)
  return defenderFree - attackerFree
}

describe('frame advantage on block', () => {
  it('the jab is +2: attacker acts two frames before the defender', () => {
    expect(measureOnBlock(() => inp(5, 'lp'))).toBe(2)
  })

  it('st.LK is +1 on block', () => {
    expect(measureOnBlock(() => inp(5, 'lk'))).toBe(1)
  })

  it('st.MP is neutral (0) on block', () => {
    expect(measureOnBlock(() => inp(5, 'mp'))).toBe(0)
  })

  it('st.HK is punishable at -6 on block', () => {
    expect(measureOnBlock(() => inp(5, 'hk'))).toBe(-6)
  })
})
