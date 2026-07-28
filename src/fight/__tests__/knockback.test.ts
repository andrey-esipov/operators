/**
 * Impact must READ. Contact used to be weightless: a launcher lifted a ~180-unit
 * fighter barely 36 units (a quarter of body height) and a heavy shoved ~12 units
 * — a slow drift, not a hit. These are exactly the values that silently decay
 * back toward zero if KB_X_SCALE / KB_Y_SCALE or the friction curve are ever
 * "simplified", and a screenshot looks fine while the feel is gone. So this guard
 * asserts FLOORS on the actual post-hit trajectory, measured from the running sim.
 *
 * Teeth (mutation-checked, see report):
 *  - KB_Y_SCALE -> 1.0 collapses the launcher apex to ~36 units  -> reds.
 *  - KB_X_SCALE.heavy -> 1.0 collapses heavy pushback to ~12 units -> reds.
 * A vacuous "the victim moved at all" check would survive both, so we pin real,
 * body-scaled floors (sim units are ~centimetres: a fighter stands ~180 tall).
 */

import { describe, expect, it } from 'vitest'
import { createFight, step } from '../sim'
import { inp, dir } from './helpers'
import type { Button, Direction, FightState } from '../types'

/**
 * Land exactly one move from fighter 0 on a neutral, non-blocking fighter 1 at
 * point-blank, then feed both fighters neutral. We watch ONLY fighter 1's
 * trajectory AFTER it enters a hit reaction, so we isolate the knockback impulse
 * from walking, pushbox separation and the attacker's own motion.
 */
function land(p1: string, d: Direction, btn: Button): { apex: number; horiz: number } {
  const s = createFight(p1, 'operator') as FightState
  s.phase = 'fight'
  s.phaseTimer = 0
  s.fighters[0].pos = { x: -1.2, y: 0 }
  s.fighters[1].pos = { x: 1.2, y: 0 }
  s.fighters[0].facing = 1
  s.fighters[1].facing = -1
  let st = s
  let inReaction = false
  let xAtHit = 0
  let apex = 0
  let horiz = 0
  for (let k = 0; k < 120; k++) {
    const atk = k === 0 ? inp(d, btn) : dir(5)
    st = step(st, [atk, dir(5)]).state
    const v = st.fighters[1]
    if (!inReaction && (v.stance === 'hitstun' || v.stance === 'juggle' || v.stance === 'knockdown')) {
      inReaction = true
      xAtHit = v.pos.x
    }
    if (inReaction) {
      apex = Math.max(apex, v.pos.y)
      horiz = Math.max(horiz, Math.abs(v.pos.x - xAtHit))
    }
  }
  return { apex, horiz }
}

describe('knockback reads as impact', () => {
  it('a launcher lifts the victim to roughly a body height, not a hop', () => {
    // operator cr.HP is the anti-air launcher (juggle: true). Its apex must clear
    // a body-height-ish arc the eye can track through a juggle — not the old ~36.
    const { apex } = land('operator', 2, 'hp')
    expect(apex).toBeGreaterThanOrEqual(130)
  })

  it('every archetype launcher clears the same floor', () => {
    // Not just the operator: the launch multiplier is global, so a dead constant
    // would drop all three at once.
    for (const p of ['operator', 'vanguard', 'warden']) {
      const { apex } = land(p, 2, 'hp')
      expect(apex).toBeGreaterThanOrEqual(130)
    }
  })

  it('a heavy displaces the victim on the order of half a body width', () => {
    // operator st.HP is a heavy. Its horizontal knockback must read as a shove
    // (>= 40 units) rather than the old ~12-unit drift.
    const { horiz } = land('operator', 5, 'hp')
    expect(horiz).toBeGreaterThanOrEqual(40)
  })

  it('a light barely moves the victim — impact scales with strength', () => {
    // The other side of the teeth: if scaling ever became a flat global multiply,
    // a jab would fling the victim too. A light must stay a light.
    const { horiz } = land('operator', 5, 'lp')
    expect(horiz).toBeLessThan(20)
  })
})
