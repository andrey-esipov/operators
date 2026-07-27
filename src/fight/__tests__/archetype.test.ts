/**
 * The two archetypes must actually PLAY differently, not just carry different
 * names. These tests pin the concrete differences a player would feel: Vanguard
 * moves in faster and retreats slower than Operator, its command grab out-ranges
 * the universal throw and ignores blocking, and the two share no special-move
 * vocabulary (Operator has a fireball-motion palm and no command grab; Vanguard
 * has a command grab and no fireball).
 *
 * Every assertion here was checked against a mutation: neutralise the mobility
 * override, shrink the command-grab box, or alias the movesets, and the matching
 * test goes red (see the report). None of them pass on a stubbed-out archetype.
 */

import { describe, expect, it } from 'vitest'
import { createFight, step } from '../sim'
import { OPERATOR, VANGUARD } from '../fighters'
import { WALK_FWD_SPEED } from '../constants'
import { dir, hold, inp, NEU } from './helpers'
import type { FightEvent, FightState, InputFrame } from '../types'

function rig(p0: string, p1: string, gap: number): FightState {
  const s = createFight(p0, p1)
  s.phase = 'fight'
  s.phaseTimer = 0
  s.fighters[0].pos.x = -gap / 2
  s.fighters[1].pos.x = gap / 2
  s.fighters[0].facing = 1
  s.fighters[1].facing = -1
  return s
}

function play(
  s: FightState, n: number, f0: (k: number) => InputFrame, f1: (k: number) => InputFrame,
): { state: FightState; events: FightEvent[] } {
  let cur = s
  const events: FightEvent[] = []
  for (let k = 0; k < n; k++) {
    const r = step(cur, [f0(k), f1(k)])
    cur = r.state
    events.push(...r.events)
  }
  return { state: cur, events }
}

/** Forward walk displacement of fighter[0] over `n` frames, from a wide gap so
 *  the pushboxes never touch. */
function walkForward(id: string, n: number): number {
  const s = rig(id, 'operator', 400)
  const x0 = s.fighters[0].pos.x
  const { state } = play(s, n, () => dir(6), () => NEU)
  return state.fighters[0].pos.x - x0
}

describe('archetypes play differently', () => {
  it('Vanguard walks in faster and its speed is an exact per-fighter value', () => {
    const N = 20
    const op = walkForward('operator', N)
    const van = walkForward('vanguard', N)

    // Operator uses the global default; Vanguard overrides it. Both are exact —
    // walk speed is applied as a flat per-frame velocity.
    expect(op).toBeCloseTo(WALK_FWD_SPEED * N, 5) // 2.4 * 20 = 48
    expect(van).toBeCloseTo((VANGUARD.walkFwd as number) * N, 5) // 3.1 * 20 = 62
    // The grappler closes ground meaningfully faster than the shoto.
    expect(van).toBeGreaterThan(op)
    expect(van - op).toBeCloseTo(14, 5)
  })

  it('Vanguard retreats slower than it advances — mobility that commits forward', () => {
    // A rushdown grappler should walk back worse than it walks forward, unlike a
    // balanced character. Compare its own forward vs back speed.
    const N = 20
    const s = rig('vanguard', 'operator', 400)
    const x0 = s.fighters[0].pos.x
    const { state } = play(s, N, () => dir(4), () => NEU)
    const back = x0 - state.fighters[0].pos.x
    expect(back).toBeCloseTo((VANGUARD.walkBack as number) * N, 5) // 1.5 * 20 = 30
    expect(back).toBeLessThan((VANGUARD.walkFwd as number) * N)
  })

  it("the command grab out-ranges the universal throw at the same spacing", () => {
    // Gap 100: too far for the universal LP+LK throw, in range for Gut Wrench.
    const GAP = 100
    const gwScript = [dir(4), hold(1), hold(2), hold(3), inp(6, 'lp')]

    const gw = play(
      rig('vanguard', 'operator', GAP), 16,
      (k) => gwScript[k] ?? NEU, () => NEU,
    )
    const ut = play(
      rig('vanguard', 'operator', GAP), 16,
      (k) => (k === 0 ? inp(5, 'lp', 'lk') : NEU), () => NEU,
    )

    const gwTypes = gw.events.map((e) => e.type)
    const utTypes = ut.events.map((e) => e.type)

    // Command grab connects: exact 165 damage, a throw + knockdown surfaced.
    expect(OPERATOR.health - gw.state.fighters[1].health).toBe(165)
    expect(gwTypes).toContain('throw')
    expect(gwTypes).toContain('knockdown')

    // The universal throw at the identical spacing simply cannot reach.
    expect(ut.state.fighters[1].health).toBe(ut.state.fighters[1].maxHealth)
    expect(utTypes).toContain('whiff')
    expect(utTypes).not.toContain('throw')
  })

  it('the command grab beats blocking (throws are unblockable)', () => {
    // Defender crouch-blocks (relative down-back = absolute 3 for the right-side
    // fighter): stationary AND guarding. The grab lands anyway.
    const gwScript = [dir(4), hold(1), hold(2), hold(3), inp(6, 'lp')]
    const { state, events } = play(
      rig('vanguard', 'operator', 80), 16,
      (k) => gwScript[k] ?? NEU, () => dir(3),
    )
    expect(OPERATOR.health - state.fighters[1].health).toBe(165)
    expect(events.map((e) => e.type)).toContain('throw')
  })

  it('the two archetypes share no special vocabulary', () => {
    // Operator: a fireball-motion palm and a DP, no command grab.
    expect(OPERATOR.moves['qcf.P']).toBeDefined() // Surge Palm (236)
    expect(OPERATOR.moves['hcf.P']).toBeUndefined()
    // Vanguard: a command grab and a running kick, no fireball palm.
    expect(VANGUARD.moves['hcf.P']).toBeDefined() // Gut Wrench (41236)
    expect(VANGUARD.moves['qcf.P']).toBeUndefined()

    // And they are simply different characters: distinct health and mobility.
    expect(VANGUARD.health).not.toBe(OPERATOR.health)
    expect(VANGUARD.health).toBe(1150)
    expect(OPERATOR.health).toBe(1000)
    expect(VANGUARD.walkFwd).toBeGreaterThan(WALK_FWD_SPEED)
  })
})
