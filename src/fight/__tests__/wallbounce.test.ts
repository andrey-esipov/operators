import { describe, expect, it } from 'vitest'
import { step } from '../sim'
import { fightAtRange, NEU } from './helpers'
import { STAGE_HALF_W } from '../constants'
import type { FightState } from '../types'

/** Put fighter 1 airborne in a juggle state, flying hard into the right wall. */
function juggledIntoWall(): FightState {
  const s = fightAtRange(200)
  const D = s.fighters[1]
  D.stance = 'juggle'
  D.grounded = false
  D.pos = { x: STAGE_HALF_W - 30, y: 100 }
  D.vel = { x: 10, y: 4 }
  D.stunRemaining = 30
  D.juggleLeft = 3
  return s
}

describe('wall bounce', () => {
  it('a juggled fighter slammed into the wall rebounds and reports it', () => {
    const s = juggledIntoWall()
    const before = s.fighters[1].vel.x
    const { state, events } = step(s, [NEU, NEU])

    const bounce = events.find((e) => e.type === 'wall-bounce')
    expect(bounce, 'a wall-bounce event must fire').toBeDefined()
    expect(bounce && bounce.type === 'wall-bounce' && bounce.who).toBe(1)
    // Horizontal velocity reversed direction (was flying right, now pushed left).
    expect(state.fighters[1].vel.x).toBeLessThan(0)
    expect(before).toBeGreaterThan(0)
  })

  it('does not bounce a fighter drifting gently into the corner', () => {
    const s = juggledIntoWall()
    s.fighters[1].vel.x = 1 // below WALL_BOUNCE_MIN_VEL
    const { events } = step(s, [NEU, NEU])
    expect(events.some((e) => e.type === 'wall-bounce')).toBe(false)
  })

  it('does not bounce a grounded fighter walking into the wall', () => {
    // Two grounded fighters mashing forward into the corner never wall-bounce —
    // that is a juggle-only mechanic.
    let s = fightAtRange(60)
    s.fighters[1].pos.x = STAGE_HALF_W - 40
    let sawBounce = false
    for (let f = 0; f < 60; f++) {
      const r = step(s, [{ dir: 6, held: new Set(), pressed: new Set() }, { dir: 6, held: new Set(), pressed: new Set() }])
      s = r.state
      if (r.events.some((e) => e.type === 'wall-bounce')) sawBounce = true
    }
    expect(sawBounce).toBe(false)
  })
})
