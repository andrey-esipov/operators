/**
 * Okizeme — the getup game. After a knockdown the downed fighter is invulnerable
 * through knockdown+wakeup, then actionable on the first frame off the ground.
 * That frame is a rock-paper-scissors: the attacker's meaty beats a passive
 * getup, an invulnerable reversal beats the meaty, and a baited reversal loses to
 * a block. This file proves all three resolve, AND that the AI actually performs
 * a reversal in a live match — the property that makes okizeme exist for a player
 * rather than only in a test.
 *
 * The traps this dodges, both named in the brief:
 *  - "a wakeup option exists" is the assertion the failure mode satisfies: the
 *    reversal can be reachable in isolation while the AI never chooses it (which
 *    is exactly what happened — the AI's reversal lookup checked a move-level
 *    `invuln` field that mkMove never sets, so it silently returned null and the
 *    AI never reversed once across 70 knockdowns). So the reachability leg runs a
 *    full AI-vs-AI match with NO setup and counts reversals that actually fired.
 *  - The mechanic legs assert the INVULN directly (defender takes exactly 0 while
 *    an attack is active on its wakeup frame). Zeroing dp.P's invuln makes that
 *    non-zero — the teeth are on the invulnerability, not on a coincidence.
 *
 * Mutation-proved (see report): zero dp.P invuln -> leg 2 reds (reversal no
 * longer beats the meaty); reversalChance -> 0 -> leg 4 reds (AI stops
 * reversing); reverting the frames-scan fix in getReversal -> leg 4 reds.
 */

import { describe, expect, it } from 'vitest'
import { step } from '../sim'
import { HarnessSim } from '../harnessSim'
import { getFighterDef } from '../fighters'
import { fightAtRange, dir, inp, NEU } from './helpers'
import { KNOCKDOWN_FRAMES, WAKEUP_FRAMES, COUNTER_DAMAGE_MULT } from '../constants'
import type { Difficulty } from '../ai'
import type { FightState, InputFrame } from '../types'

const JAB_DMG = getFighterDef('operator').moves['st.LP'].hit.damage
const DP_DMG = getFighterDef('operator').moves['dp.P'].hit.damage
const WAKE = KNOCKDOWN_FRAMES + WAKEUP_FRAMES // frame the defender becomes actionable

/** Seed a defender (p1, on the right facing -1) into a fresh knockdown at `gap`,
 *  the way a launcher or sweep ends — the real entry into okizeme. */
function knockdown(gap: number): FightState {
  const s = fightAtRange(gap)
  const d = s.fighters[1]
  d.stance = 'knockdown'
  d.stunRemaining = KNOCKDOWN_FRAMES
  d.grounded = true
  return s
}

/** Run one okizeme exchange. p0 either meaties a jab timed onto the wake frame
 *  or baits (holds down-back = block); p1 either does nothing or reverses with a
 *  623+HP DP fed across the last three wakeup frames. Facing -1 flips relative
 *  6/2/3 to absolute 4/2/1. Returns damage dealt each way and p1's move history. */
function exchange(opts: { meaty: boolean; reversal: boolean }): {
  p0dmg: number
  p1dmg: number
  reversedWith: string | null
  punishable: boolean
  counterHits: number
} {
  let s = knockdown(78)
  const p0h0 = s.fighters[0].health
  const p1h0 = s.fighters[1].health
  let reversedWith: string | null = null
  let punishable = false
  let counterHits = 0
  for (let f = 0; f < WAKE + 40; f++) {
    let p0: InputFrame = NEU
    if (opts.meaty && f === WAKE - 3) p0 = inp(6, 'lp')
    if (!opts.meaty) p0 = dir(1) // bait: block low
    let p1: InputFrame = NEU
    if (opts.reversal) {
      if (f === WAKE - 3) p1 = dir(4)
      else if (f === WAKE - 2) p1 = dir(2)
      else if (f === WAKE - 1) p1 = inp(1, 'hp')
    }
    const r = step(s, [p0, p1])
    s = r.state
    for (const ev of r.events) if (ev.type === 'counter-hit') counterHits++
    const A = s.fighters[0]
    const B = s.fighters[1]
    if (B.stance === 'attack' && B.move && B.move.id === 'dp.P') reversedWith = 'dp.P'
    // Punish window: attacker recovered (actionable stance) while the defender is
    // still committed to dp.P recovery — the price a baited reversal pays.
    const p0Free = A.stance === 'idle' || A.stance === 'crouch' ||
      A.stance === 'walk-fwd' || A.stance === 'walk-back'
    if (p0Free && B.stance === 'attack' && B.move?.id === 'dp.P') punishable = true
  }
  return {
    p0dmg: p0h0 - s.fighters[0].health,
    p1dmg: p1h0 - s.fighters[1].health,
    reversedWith,
    punishable,
    counterHits,
  }
}

const REVERSALS = new Set(['dp.P', 'dp.K'])

/** Count wakeup reversals that fire organically in a full AI-vs-AI match: the
 *  defender was in 'wakeup' last frame and starts a reversal special this frame.
 *  No knockdown is seeded — every one is earned in live play. */
function organicReversals(d1: Difficulty, d2: Difficulty, seeds: number): number {
  let total = 0
  for (let sd = 0; sd < seeds; sd++) {
    const h = new HarnessSim({ seed: 1000 + sd * 7, difficulty1: d1, difficulty2: d2 } as never)
    const prev: (string | undefined)[] = [undefined, undefined]
    for (let k = 0; k < 6000; k++) {
      const r = h.step()
      for (let i = 0 as 0 | 1; i < 2; i++) {
        const f = r.state.fighters[i]
        if (prev[i] === 'wakeup' && f.stance === 'attack' &&
            f.move && REVERSALS.has(f.move.id) && f.move.frame <= 1) {
          total++
        }
        prev[i] = f.stance
      }
      if (r.state.phase === 'match-end') break
    }
  }
  return total
}

describe('okizeme: the getup rock-paper-scissors', () => {
  it('a meaty attack beats a defender who does nothing on wakeup', () => {
    const r = exchange({ meaty: true, reversal: false })
    // The jab is active on the defender's first actionable frame: it connects for
    // exactly its damage, and the attacker takes nothing.
    expect(r.p1dmg).toBe(JAB_DMG)
    expect(r.p0dmg).toBe(0)
  })

  it('an invulnerable reversal beats the meaty clean — and PUNISH COUNTERs it', () => {
    const r = exchange({ meaty: true, reversal: true })
    // The DP's startup invuln eats the meaty: the defender takes EXACTLY zero
    // while the jab is active on them. That 0 is the invulnerability — break it
    // and this reds. The reversal then launches the attacker, who is still stuck
    // in the meaty jab's recovery — a textbook PUNISH COUNTER, so the DP deals
    // its damage scaled by the counter multiplier and fires a counter-hit event.
    expect(r.reversedWith).toBe('dp.P')
    expect(r.p1dmg).toBe(0)
    expect(r.p0dmg).toBe(Math.round(DP_DMG * COUNTER_DAMAGE_MULT))
    expect(r.counterHits).toBeGreaterThanOrEqual(1)
  })

  it('a baited reversal whiffs into a punish — it is not a free button', () => {
    const r = exchange({ meaty: false, reversal: true })
    // Attacker blocks instead of pressing: the DP is blocked (nobody is hurt) and
    // the attacker recovers first, catching the defender in DP recovery. This is
    // what stops the reversal being a guaranteed escape.
    expect(r.reversedWith).toBe('dp.P')
    expect(r.p0dmg).toBe(0)
    expect(r.p1dmg).toBe(0)
    expect(r.counterHits).toBe(0)
    expect(r.punishable).toBe(true)
  })

  it('the AI performs wakeup reversals in a live match, harder tiers far more', () => {
    // Reachability under real pacing — no seeded knockdown. A hard AI must reverse
    // several times across the sample; an easy AI barely ever does. If the AI's
    // reversal is unreachable (the frames-scan bug) or gated off (reversalChance
    // 0), hard drops to 0 and this reds — the assertion the "exists" trap can't
    // satisfy.
    const hard = organicReversals('hard', 'hard', 10)
    const easy = organicReversals('easy', 'easy', 10)
    expect(hard).toBeGreaterThanOrEqual(4)
    expect(hard).toBeGreaterThan(easy)
  }, 30000)
})
