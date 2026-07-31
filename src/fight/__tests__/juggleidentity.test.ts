/**
 * Per-archetype juggle identity. Before this, `JUGGLE_ALLOWANCE` was a single
 * global constant set on every victim when launched, so a grappler, a zoner and
 * an all-rounder all juggled for exactly the same number of air hits — the
 * "a grappler and a zoner should not juggle identically" gap. The census tool
 * (tools/juggle-capacity.mjs) measured 4/4/4 before, 4/2/3 after.
 *
 * The allowance is now the JUGGLER'S archetype knob (`FighterDef.juggleAllowance`,
 * offset from the baseline constant): shoto 4, zoner 3, grappler 2. `juggleScale`
 * is parameterised by that starting allowance so the gravity arc keeps the SAME
 * SHAPE at every length — only the number of steps differs.
 *
 * TEETH (both directions, see report):
 *   - Revert `applyHit` to set `D.juggleLeft = JUGGLE_ALLOWANCE` (drop the
 *     per-archetype knob) → vanguard/warden juggle 4 again → the 2/3 counts and
 *     the "all three differ" assertion red.
 *   - Revert `juggleScale` to `JUGGLE_ALLOWANCE - juggleLeft` (ignore the passed
 *     allowance) → `juggleScale(2,2)` is no longer 1 and `juggleScale(1,2)` is no
 *     longer `1-STEP` → the shape-invariance assertions red.
 *
 * The gate that ENFORCES a spent allowance as immunity (what terminates a juggle)
 * is already regression-locked in antiair.test.ts ("a juggle victim that has
 * spent its allowance is immune"); this file only proves the allowance LENGTHS
 * differ per archetype, so it deliberately does not re-test the gate.
 */
import { describe, expect, it } from 'vitest'
import { createFight, step } from '../sim'
import { juggleScale } from '../combat'
import { getFighterDef, OPERATOR, VANGUARD, WARDEN } from '../fighters'
import { JUGGLE_ALLOWANCE, JUGGLE_GRAVITY_STEP } from '../constants'
import type { FightState, InputFrame } from '../types'

const NEU: InputFrame = { dir: 5 as never, held: new Set(), pressed: new Set() }

/**
 * Gate-isolation probe: launch a mirror victim with `charId`'s launcher, then
 * every cycle sit the attacker on top of the airborne victim and re-arm cr.HP one
 * frame before its active window so this step lands it. Count air extensions
 * until the victim's juggle allowance is spent (`juggleLeft` hits 0). This
 * isolates the ALLOWANCE from route execution — real routes reach these hits via
 * cancels; here we only want to know how many air hits the allowance permits.
 * Mirrors antiair.test.ts, which likewise injects airborne victim state directly.
 */
function airExtensions(charId: string): number {
  const active0 = getFighterDef(charId).moves['cr.HP'].active[0]
  let s: FightState = createFight(charId, charId)
  s.phase = 'fight'; s.phaseTimer = 0
  s.fighters[0].pos.x = -20; s.fighters[0].facing = 1
  s.fighters[1].pos.x = 20; s.fighters[1].facing = -1
  s.fighters[0].stance = 'attack'
  s.fighters[0].move = { id: 'cr.HP', frame: active0 - 1 }
  s.fighters[0].attackConnected = false

  let launched = false
  let airHits = 0
  for (let f = 0; f < 200; f++) {
    const A = s.fighters[0]
    const D = s.fighters[1]
    if (launched && !D.grounded && D.stance === 'juggle') {
      A.pos.x = D.pos.x
      A.pos.y = D.pos.y
      A.grounded = false
      A.stance = 'attack'
      A.move = { id: 'cr.HP', frame: active0 - 1 }
      A.attackConnected = false
    }
    const r = step(s, [NEU, NEU])
    s = r.state
    for (const e of r.events) {
      if (e.type === 'launch') {
        if (!launched) launched = true
        else airHits++
      }
    }
    const v = s.fighters[1]
    // Allowance spent: this is exactly the immunity antiair.test.ts locks.
    if (launched && v.stance === 'juggle' && v.juggleLeft <= 0) break
    // Safety: never let the probe run away (fresh-jumper / no-launch bugs).
    if (launched && v.grounded && v.stance !== 'juggle') break
  }
  return airHits
}

describe('per-archetype juggle identity', () => {
  it('each archetype declares a distinct juggle allowance derived from the baseline', () => {
    // Derived as offsets from the one central constant, not three loose copies.
    expect(OPERATOR.juggleAllowance).toBe(JUGGLE_ALLOWANCE)       // shoto baseline
    expect(WARDEN.juggleAllowance).toBe(JUGGLE_ALLOWANCE - 1)     // zoner: shorter
    expect(VANGUARD.juggleAllowance).toBe(JUGGLE_ALLOWANCE - 2)   // grappler: shortest
    // The whole point: they are NOT the same.
    const all = [OPERATOR.juggleAllowance, WARDEN.juggleAllowance, VANGUARD.juggleAllowance]
    expect(new Set(all).size).toBe(3)
  })

  it('a launched victim can be air-hit exactly its juggler\'s allowance, then it is spent', () => {
    // Measured through the running sim, not read off the def: this is what a
    // player actually gets. 4 / 2 / 3 — three visibly different route lengths.
    expect(airExtensions('operator')).toBe(4)
    expect(airExtensions('vanguard')).toBe(2)
    expect(airExtensions('warden')).toBe(3)
    // Same measurement, stated as the design goal: they are not equal.
    const counts = [airExtensions('operator'), airExtensions('vanguard'), airExtensions('warden')]
    expect(new Set(counts).size).toBe(3)
  })

  it('juggleScale keeps the same arc SHAPE at every allowance — only the length differs', () => {
    // A fresh launch (no hits spent) is always full height, whatever the length.
    expect(juggleScale(2, 2)).toBe(1)          // grappler's 2-hit route
    expect(juggleScale(3, 3)).toBe(1)          // zoner's 3-hit route
    expect(juggleScale(4, 4)).toBe(1)          // shoto's 4-hit route
    // One extension spent is taxed by exactly one STEP, again independent of the
    // route length — the arc steps down identically, there are just fewer steps.
    expect(juggleScale(1, 2)).toBeCloseTo(1 - JUGGLE_GRAVITY_STEP, 10)
    expect(juggleScale(2, 3)).toBeCloseTo(1 - JUGGLE_GRAVITY_STEP, 10)
    expect(juggleScale(3, 4)).toBeCloseTo(1 - JUGGLE_GRAVITY_STEP, 10)
    // Backwards-compatible default: omitting the allowance assumes the baseline,
    // so every pre-existing caller/test keeps its old meaning.
    expect(juggleScale(JUGGLE_ALLOWANCE - 1)).toBeCloseTo(1 - JUGGLE_GRAVITY_STEP, 10)
  })
})
