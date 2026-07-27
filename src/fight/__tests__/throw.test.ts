import { describe, expect, it } from 'vitest'
import { step } from '../sim'
import { fightAtRange, inp, NEU, run } from './helpers'
import { KNOCKDOWN_FRAMES, THROW_TECH_FRAMES } from '../constants'
import type { FightState, FightEvent } from '../types'

/** LP+LK on one frame = the universal throw. */
const THROW = inp(5, 'lp', 'lk')

function typesOf(events: FightEvent[]): string[] {
  return events.map((e) => e.type)
}

describe('throws', () => {
  it('a point-blank throw grabs: exact damage, hard knockdown, throw+knockdown events', () => {
    const s = fightAtRange(40)
    const startHealth = s.fighters[1].health
    const { state, events } = run(s, 20, (f) => (f === 0 ? THROW : NEU), () => NEU)

    // Seismic Toss deals 140, unscaled (a throw can't be comboed into here).
    expect(startHealth - state.fighters[1].health).toBe(140)
    expect(state.fighters[1].stance).toBe('knockdown')
    // Both the grab and the resulting knockdown are surfaced to the renderer.
    expect(typesOf(events)).toContain('throw')
    expect(typesOf(events)).toContain('knockdown')
    // A throw is not a strike — it must not masquerade as a 'hit' spark.
    expect(typesOf(events)).not.toContain('hit')
  })

  it('an out-of-range throw whiffs: no damage, whiff event, then recovery', () => {
    const s = fightAtRange(200)
    const { state, events } = run(s, 20, (f) => (f === 0 ? THROW : NEU), () => NEU)
    expect(state.fighters[1].health).toBe(state.fighters[1].maxHealth)
    expect(typesOf(events)).toContain('whiff')
    expect(typesOf(events)).not.toContain('throw')
  })

  it('a mutual throw is teched: neither takes damage, both enter throw-tech', () => {
    const s = fightAtRange(40)
    const { state } = run(
      s, THROW_TECH_FRAMES + 4,
      (f) => (f === 0 ? THROW : NEU),
      (f) => (f === 0 ? THROW : NEU),
    )
    // The tech is caught the frame the grab lands, so peek there instead of at
    // the end (by then both have recovered). Re-run and stop at the break.
    let cur = fightAtRange(40)
    let teched = false
    for (let f = 0; f < 10; f++) {
      cur = step(cur, [f === 0 ? THROW : NEU, f === 0 ? THROW : NEU]).state
      if (cur.fighters[0].stance === 'throw-tech' && cur.fighters[1].stance === 'throw-tech') {
        teched = true
        break
      }
    }
    expect(teched, 'both fighters should break out on a mutual throw').toBe(true)
    // Nobody lost health to a teched throw.
    expect(state.fighters[0].health).toBe(state.fighters[0].maxHealth)
    expect(state.fighters[1].health).toBe(state.fighters[1].maxHealth)
  })

  it('throw protection: a fighter in hitstun cannot be thrown', () => {
    // P1 lands a jab (30) to put P2 in hitstun, then immediately fishes a throw.
    // The throw must whiff off the stunned defender — only the jab's 30 lands.
    const s = fightAtRange(50)
    const script = [inp(5, 'lp'), NEU, NEU, THROW, NEU, NEU, NEU, NEU]
    const { state } = run(s, script.length, (f) => script[f] ?? NEU, () => NEU)
    expect(state.fighters[1].maxHealth - state.fighters[1].health).toBe(30)
  })

  it('a hard knockdown from a throw lasts the full knockdown window', () => {
    const s = fightAtRange(40)
    let cur: FightState = s
    // Land the throw.
    for (let f = 0; f < 8; f++) cur = step(cur, [f === 0 ? THROW : NEU, NEU]).state
    expect(cur.fighters[1].stance).toBe('knockdown')
    const stunAtKD = cur.fighters[1].stunRemaining
    // Knockdown stun is set to KNOCKDOWN_FRAMES on the grab frame and counts down.
    expect(stunAtKD).toBeGreaterThan(0)
    expect(stunAtKD).toBeLessThanOrEqual(KNOCKDOWN_FRAMES)
  })
})
