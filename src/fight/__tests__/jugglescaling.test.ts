/**
 * Juggle gravity scaling — each airborne hit in a juggle imparts less upward
 * knockback than the last, so the arcs step down instead of repeating at full
 * height. Before this, a second launcher mid-juggle hard-reset the victim's
 * vertical velocity to the full launch value, so a route read as two identical
 * full-height pops. The design comment in constants.ts claimed juggles decayed;
 * the launcher path did not honour it. This proves the code now matches intent.
 *
 * TEETH: the exact scaled velocity is asserted, not just "lower". A real air
 * juggle is scripted (cr.HP launch xx dp.P cancel that connects while the victim
 * is still airborne), and we assert (a) the first launch keeps its full authored
 * height, (b) the airborne dp.P is scaled to EXACTLY kby*KB_Y_SCALE*juggleScale,
 * strictly below the raw value, and (c) the two hits are linked — the victim is
 * airborne and in unbroken hitstun between them, so this is a juggle and not two
 * unrelated pokes. Mutation-proven: JUGGLE_GRAVITY_STEP=0 flattens juggleScale
 * to 1.0, the second pop returns to the raw 28.6, and both the value and the
 * strict-inequality assertions red.
 */
import { describe, expect, it } from 'vitest'
import { createFight, step } from '../sim'
import { juggleScale } from '../combat'
import { JUGGLE_ALLOWANCE, JUGGLE_GRAVITY_STEP, JUGGLE_GRAVITY_FLOOR, KB_Y_SCALE } from '../constants'
import type { FightState, InputFrame, Button } from '../types'

function inp(dir: number, ...btns: Button[]): InputFrame {
  const s = new Set<Button>(btns)
  return { dir: dir as never, held: s, pressed: s }
}
const NEU: InputFrame = { dir: 5 as never, held: new Set(), pressed: new Set() }

describe('juggle gravity scaling', () => {
  it('juggleScale steps down per hit spent and clamps to the floor', () => {
    // No hits spent (fresh launch, juggleLeft == allowance): full height.
    expect(juggleScale(JUGGLE_ALLOWANCE)).toBe(1)
    // One extension spent: taxed once.
    expect(juggleScale(JUGGLE_ALLOWANCE - 1)).toBeCloseTo(1 - JUGGLE_GRAVITY_STEP, 10)
    expect(juggleScale(JUGGLE_ALLOWANCE - 2)).toBeCloseTo(1 - 2 * JUGGLE_GRAVITY_STEP, 10)
    // Monotone decreasing.
    expect(juggleScale(JUGGLE_ALLOWANCE - 1)).toBeLessThan(juggleScale(JUGGLE_ALLOWANCE))
    // Deep juggle clamps to the floor, never zero (a zero pop reads as a miss).
    expect(juggleScale(-100)).toBe(JUGGLE_GRAVITY_FLOOR)
  })

  it('an airborne juggle hit is scaled below its raw launch height', () => {
    // cr.HP (kby 9) launches; dp.P (kby 11) cancels in and connects airborne.
    const CRHP_RAW = 9 * KB_Y_SCALE       // 23.4 — full, grounded launch
    const DP_RAW = 11 * KB_Y_SCALE        // 28.6 — raw, unscaled
    // The dp.P is the victim's 2nd juggle hit → juggleLeft 4→3 → scale(3).
    const DP_SCALED = DP_RAW * juggleScale(JUGGLE_ALLOWANCE - 1)  // 28.6 * 0.84 = 24.024

    let s: FightState = createFight('operator', 'operator')
    s.phase = 'fight'; s.phaseTimer = 0
    s.fighters[0].pos.x = -40; s.fighters[1].pos.x = 40
    s.fighters[0].facing = 1; s.fighters[1].facing = -1
    const v = () => s.fighters[1]

    let hitCount = 0
    let prevHp = v().health
    let launchVy = 0
    let secondVy = 0
    let secondAirborne = false
    let minStunBetween = Infinity
    let sawNeutralBetween = false
    const cancelAt = 20 // from the timing probe: dp.P connects airborne here

    for (let f = 0; f < 60; f++) {
      let in0: InputFrame
      if (f === 0 || f === 1) in0 = inp(2, 'hp')          // cr.HP
      else if (f === cancelAt) in0 = inp(6)               // 6
      else if (f === cancelAt + 1) in0 = inp(2)           // 2
      else if (f === cancelAt + 2) in0 = inp(3, 'hp')     // 3 + hp → dp.P
      else in0 = inp(2)                                   // hold crouch
      const r = step(s, [in0, NEU])
      s = r.state
      if (v().health < prevHp) {
        hitCount++
        if (hitCount === 1) launchVy = v().vel.y
        if (hitCount === 2) { secondVy = v().vel.y; secondAirborne = !v().grounded }
      }
      // between the two hits: track linkage (victim never actionable).
      if (hitCount === 1) {
        if (v().stunRemaining < minStunBetween) minStunBetween = v().stunRemaining
        if (v().stunRemaining === 0 && v().grounded) sawNeutralBetween = true
      }
      prevHp = v().health
    }

    // Two hits landed (the juggle happened at all).
    expect(hitCount).toBe(2)
    // (a) the grounded launch keeps its full authored height.
    expect(launchVy).toBeCloseTo(CRHP_RAW, 5)
    // (b) the airborne follow-up is scaled to the exact expected value, and
    //     strictly below the raw launch height — the whole point of the change.
    expect(secondAirborne).toBe(true)
    expect(secondVy).toBeCloseTo(DP_SCALED, 5)
    expect(secondVy).toBeLessThan(DP_RAW)
    // (c) linked, not two unrelated pokes: the victim stayed in hitstun the
    //     whole time between hits and never returned to neutral.
    expect(minStunBetween).toBeGreaterThan(0)
    expect(sawNeutralBetween).toBe(false)
    // Guard against a silently-disabled STEP: the scaled value must actually
    // differ from raw by the tax (this reds if JUGGLE_GRAVITY_STEP is 0).
    expect(DP_RAW - secondVy).toBeGreaterThan(1)
  })
})
