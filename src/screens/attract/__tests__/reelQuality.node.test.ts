/**
 * Attract-reel QUALITY gate — the reel is the shop window, so this asserts the
 * OUTCOME a buyer sees, not the mechanism that produces it.
 *
 * This gates DENSITY: the reel must stay dense with action and highlights. We
 * drive the real {@link AttractDirector} — the shipped hard-tier, meter-primed
 * config, the exact one that plays on the title screen — and require, PER SEED
 * (never an average, because the customer gets one bout order, not the mean
 * across seeds), floors on: contact fraction, supers/bout, bouts-that-show-a-
 * super, and KOs/bout. Four floors, not one, so a regression that keeps jabs
 * flowing but loses the supers (a meter or super-AI break) still reddens this —
 * the failure mode "still busy, but boring" cannot satisfy the assertion.
 *
 * (The opener's first-LOAD cost — the download a cold visit waits on — is gated
 * separately, in buyer-facing seconds, by firstBoutBudget.node.test.ts.)
 *
 * Anti-vacuity, because this project has a documented history of gates that pass
 * by asserting nothing: the classifier is proven to discriminate (a neutral
 * frame reads false, hit/hitstop/super/hitstun read true) and a real sim is
 * proven to have advanced (non-zero sim frames).
 *
 * Mutation-proven: forcing the contact classifier to `false` reddens the contact
 * floor; zeroing the director's `SUPER_PRIME` meter reddens the super floors.
 */

import { describe, it, expect } from 'vitest'
import { AttractDirector } from '../attractDirector'
import { measureReel, frameIsContact } from '../reelMetrics'
import type { FightState } from '../../../fight/types'

// ── density floors ───────────────────────────────────────────────────────────
// Observed across seeds: contact 0.70–0.72, supers/bout 3.0–4.0,
// bouts-with-super 0.8–1.0, KOs/bout 0.9–1.0. Each floor sits ~well below the
// observed spread so seed/matchup variance never trips it, but a real regression
// (density roughly halving, or highlights vanishing) does.
const RENDER_BUDGET = 12000 // 200s of reel per seed at 60fps — many bouts.
const CONTACT_FLOOR = 0.5
const SUPERS_PER_BOUT_FLOOR = 1.5
const BOUTS_WITH_SUPER_FLOOR = 0.5
const KOS_PER_BOUT_FLOOR = 0.6
const DENSITY_SEEDS = [0xa77ac7, 0x1234, 0xbeef, 0x55aa, 0x9999, 0xc0ffee]

describe('attract reel — action & highlight density (shipped hard-tier config)', () => {
  for (const seed of DENSITY_SEEDS) {
    it(`seed 0x${seed.toString(16)} stays dense with contact and highlights`, () => {
      const dir = new AttractDirector({ seed })
      const m = measureReel(dir, RENDER_BUDGET)

      // Vacuity: a real sim actually advanced through real bouts.
      expect(m.renderedFrames).toBe(RENDER_BUDGET)
      expect(m.simFramesAdvanced).toBeGreaterThan(0)
      expect(m.bouts).toBeGreaterThanOrEqual(2)

      // Outcome floors — the reel is worth watching.
      expect(m.contactFraction).toBeGreaterThanOrEqual(CONTACT_FLOOR)
      expect(m.supersPerBout).toBeGreaterThanOrEqual(SUPERS_PER_BOUT_FLOOR)
      expect(m.boutsWithSuperFraction).toBeGreaterThanOrEqual(BOUTS_WITH_SUPER_FLOOR)
      expect(m.kosPerBout).toBeGreaterThanOrEqual(KOS_PER_BOUT_FLOOR)
    })
  }
})

describe('attract reel — the contact classifier discriminates (not vacuous)', () => {
  it('reads neutral frames as neutral and action frames as contact', () => {
    // A real initial state, forced fully neutral: no freeze, both idle, no events.
    const neutral: FightState = structuredClone(new AttractDirector({ seed: 1 }).current)
    neutral.hitstop = 0
    neutral.superFreeze = 0
    neutral.fighters[0].stance = 'idle'
    neutral.fighters[1].stance = 'idle'
    expect(frameIsContact(neutral, [])).toBe(false)

    const hitstop = structuredClone(neutral)
    hitstop.hitstop = 4
    expect(frameIsContact(hitstop, [])).toBe(true)

    const superFreeze = structuredClone(neutral)
    superFreeze.superFreeze = 20
    expect(frameIsContact(superFreeze, [])).toBe(true)

    const hitstun = structuredClone(neutral)
    hitstun.fighters[1].stance = 'hitstun'
    expect(frameIsContact(hitstun, [])).toBe(true)

    // A landing hit event, even with an otherwise-neutral state, is contact.
    expect(
      frameIsContact(neutral, [{ type: 'hit', at: { x: 0, y: 0 }, attacker: 0, level: 'medium', damage: 50 }]),
    ).toBe(true)
    // A super flash is the marquee moment.
    expect(frameIsContact(neutral, [{ type: 'super-flash', who: 0, moveId: 'demo' }])).toBe(true)
    // A whiff is neutral spacing, not contact — the conservative direction.
    expect(frameIsContact(neutral, [{ type: 'whiff', at: { x: 0, y: 0 }, attacker: 0 }])).toBe(false)
  })
})
