/**
 * The AI must actually PERFORM a long combo. The engine has supported cancels
 * for a while (normals -> special -> super) plus launch + juggle, but both
 * scripted and AI play plateaued at ~3 hits, so the HUD's NICE@5 / GREAT@8 tiers
 * never fired — a combo system that, from the player's seat, does not exist.
 * These tests prove the CPU lands genuine extended routes — including real
 * airborne juggles — in a real, deterministic fight.
 *
 * The route the AI runs (operator): a rushdown light chain into a launcher
 * juggle — cr.LK > cr.LP > cr.LK > cr.LP > cr.LK > cr.HP(launch) > Surge Palm,
 * +super when meter is up. The Rising Uppercut pops the victim airborne and the
 * palm/super catch them falling, so the tail of every long route is a genuine
 * juggle rather than a flat ground string.
 *
 * THE TRAP THIS FILE IS BUILT TO AVOID: "a 5-hit combo occurred" is satisfied
 * by five unrelated pokes landing during a scramble. That is the same incidental
 * -vs-deliberate lie the parry test fell into. So the assertion here is not "5
 * hits happened" but "5 hits happened LINKED — the victim never returned to a
 * neutral, actionable stance between the first and the fifth." The victim's
 * `comboCount` already enforces this (the sim resets it to 0 the instant a stun
 * ends, in onStunEnd), but we do not lean on that reset rule alone: the detector
 * below independently watches the victim's stance and discards any run in which
 * a neutral frame appears mid-combo. A run only counts if it is unbroken.
 *
 * Mutation-proved (see the report): disabling the AI's combo starter, and
 * removing the AI's hitstop guard, each drop the longest linked combo below 5
 * -> red. Replacing the launcher (cr.HP) in the route with a non-launching
 * normal drops every airborne hit to zero -> the juggle assertion reds. The
 * damage band reds if scaling is removed (combo damage balloons). (Collapsing
 * CANCEL_WINDOW to 0 does NOT red it — the links connect during the attacker's
 * active frames, not the early-recovery window — so that is not claimed here.)
 */

import { describe, expect, it } from 'vitest'
import { HarnessSim } from '../harnessSim'

// Stances in which the victim is neutral / free to act. If any of these appears
// while a combo is open, the "combo" was really separate hits with a gap — not a
// link — and the run is discarded.
const NEUTRAL = new Set(['idle', 'crouch', 'walk-fwd', 'walk-back', 'dash', 'backdash'])

interface Combo {
  /** Number of linked hits (peak comboCount reached with no neutral gap). */
  len: number
  /** Total health the victim lost across the linked run. */
  dmg: number
  /** How many of the linked hits landed while the victim was airborne (juggle). */
  air: number
}

/** The longest UNBROKEN combo either fighter suffers in a `frames`-long fight:
 *  a maximal run of hits during which the victim's comboCount climbed without
 *  resetting AND the victim was never in a neutral stance between hits. Returns
 *  its length, the damage it dealt, and how many hits were airborne (juggle). */
function longestLinkedCombo(seed: number, p1: string, p2: string, frames = 2400): Combo {
  const h = new HarnessSim({ seed, p1, p2 } as never)
  let best: Combo = { len: 0, dmg: 0, air: 0 }
  const prevCC = [0, 0]
  const prevHP = [0, 0]
  const open = [false, false] // did a neutral frame break the current run?
  const startHP = [0, 0]
  const peak = [0, 0]
  const air = [0, 0]
  for (let k = 0; k < frames; k++) {
    const r = h.step()
    for (let vi = 0; vi < 2; vi++) {
      const f = r.state.fighters[vi]
      const cc = f.comboCount ?? 0
      if (cc > prevCC[vi]) {
        // A hit just landed on this fighter. A fresh run (cc === 1) records the
        // pre-hit health so damage is measured from the combo's start.
        if (cc === 1) {
          open[vi] = false
          startHP[vi] = prevHP[vi]
          air[vi] = 0
        }
        peak[vi] = cc
        if (!f.grounded || f.stance === 'juggle') air[vi]++
        if (!open[vi] && cc >= best.len) {
          best = { len: cc, dmg: startHP[vi] - f.health, air: air[vi] }
        }
      } else if (cc === 0) {
        peak[vi] = 0
      }
      // A neutral stance while a combo is open means the hits were not linked.
      if (peak[vi] > 0 && NEUTRAL.has(f.stance)) open[vi] = true
      prevCC[vi] = cc
      prevHP[vi] = f.health
    }
  }
  return best
}

describe('AI combo routes', () => {
  // operator vs operator: the archetype that owns the hit-confirm BnB — a
  // rushdown light chain into a launcher juggle (cr.LK > cr.LP > cr.LK > cr.LP >
  // cr.LK > cr.HP > Surge Palm, +super with meter). Measured across these seeds
  // the longest linked combo is 5-7; a value that never dips below 5 is the
  // property the HUD's NICE@5 tier needs, and the 7-hit peak proves the launcher
  // route lands whole.
  const seeds = [0x51ac, 0x1234, 0xbeef, 0x77, 0xabcd, 1, 2, 3]

  it('the AI lands a genuinely linked 5+ hit combo, not incidental pokes', () => {
    const combos = seeds.map((s) => longestLinkedCombo(s, 'operator', 'operator'))
    // Every seed produces an unbroken run of at least 5 linked hits. Because the
    // detector discards any run containing a mid-combo neutral frame, this is
    // impossible to satisfy with five scattered pokes — they would each reset
    // the counter and break the run. (Mutation-proved: with the AI's combo
    // starter disabled, every seed falls below 5; with the AI's hitstop guard
    // removed — so queued cancels drain into the frozen sim and desync from the
    // move they cancel — most seeds fall to 1-4. Either reds the assertion.)
    for (const c of combos) {
      expect(c.len).toBeGreaterThanOrEqual(5)
    }
    // And the launcher route lands whole often enough to reach its 7-hit peak.
    expect(Math.max(...combos.map((c) => c.len))).toBeGreaterThanOrEqual(7)
  })

  it('the AI\'s long routes are launcher juggles, not flat ground chains', () => {
    // The signature ask: a launcher should permit follow-ups in the air. A combo
    // that never leaves the floor is not a juggle, so we require the AI's long
    // routes to contain hits landed while the victim is AIRBORNE — the palm and
    // super catching the victim popped up by cr.HP. Measured: the seeds that
    // reach 7 all carry 2 airborne hits; ground-only 5-hit runs carry 0.
    const combos = seeds.map((s) => longestLinkedCombo(s, 'operator', 'operator'))
    // A clear majority of fights land a real juggle in their longest combo.
    const withAir = combos.filter((c) => c.air >= 1).length
    expect(withAir).toBeGreaterThanOrEqual(4)
    // And the peak-length routes are juggles specifically: the launcher popped
    // the victim and at least two follow-ups connected in the air. This is what
    // reds when the launcher (cr.HP) is swapped out of the route for a grounded
    // normal — every airborne hit becomes a grounded one and this drops to 0.
    const bigJuggles = combos.filter((c) => c.len >= 7 && c.air >= 2).length
    expect(bigJuggles).toBeGreaterThanOrEqual(3)
  })

  it('combo damage is expressive but not degenerate', () => {
    // A linked 5-7 hit route should clearly beat trading single pokes, yet
    // scaling must stop it from being a near-kill off one opening. Measured: the
    // ground-only 5-hit deals ~117, the 7-hit launcher juggle ~211, out of 1000
    // health.
    const best = seeds
      .map((s) => longestLinkedCombo(s, 'operator', 'operator'))
      .reduce((a, b) => (b.dmg > a.dmg ? b : a))
    const maxHealth = 1000
    // Expressive: worth more than any single normal (the heaviest is ~100).
    expect(best.dmg).toBeGreaterThan(120)
    // Not degenerate: a full route takes well under a third of the life bar, so a
    // round is at least ~4 clean openings, never two. If scaling were removed the
    // raw route sums far higher and this reds.
    expect(best.dmg).toBeLessThan(maxHealth * 0.33)
  })

  it('is deterministic: the same seed yields the same longest combo', () => {
    const a = longestLinkedCombo(0x51ac, 'operator', 'operator')
    const b = longestLinkedCombo(0x51ac, 'operator', 'operator')
    expect(a).toEqual(b)
  })
})
