/**
 * The AI must actually PARRY — parry is our Third Strike reference point's
 * signature mechanic, and a parry the AI never performs is, from the player's
 * seat, a feature that does not exist (the same failure the super had). The
 * parry *mechanic* is covered in parry.test.ts (normals) and projectiles.test.ts
 * (fireballs); this file proves parries happen inside a real, deterministic
 * AI-vs-AI fight — a deliberate melee parry read, and an incoming fireball
 * getting parried in live play.
 *
 * Teeth, and TWO caught lies:
 *  1. An earlier version flagged a "fireball parry" whenever a bolt merely sat
 *     near the parrying fighter — satisfied by any melee parry while a fireball
 *     was on screen. A fireball parry is now proven the only way it can be: a
 *     specific bolt, owned by the attacker, present last frame and GONE the
 *     instant the parry fires — consumed by the parry, not blocked, hit or
 *     expired.
 *  2. This file used to claim the fireball parry exercised the AI's dedicated
 *     "reaction-corrected projectile read" branch. It does not: I measured that
 *     branch and it is effectively dead — the operator parries incoming bolts
 *     *incidentally* while walking forward to close distance, and disabling the
 *     branch changes nothing. So the melee test's teeth are against the parry
 *     AI (zeroing parryChance reds it), while the fireball test's teeth are
 *     against the sim's projectile-parry *mechanic* (zeroing parryChance does
 *     NOT red it — only breaking the mechanic does). The distinction is stated
 *     in each test, and in the report.
 *
 * Assertions are durable properties (a deliberate parry contributes above the
 * incidental floor; a fireball is parried at all), not literal frame/count
 * anchors that drift on every balance pass. Determinism has its own test below.
 */

import { describe, expect, it } from 'vitest'
import { HarnessSim } from '../harnessSim'

interface ParryHit {
  frame: number
  /** True only when a bolt owned by the attacker, present last frame and
   *  closing on the defender, vanished on this exact frame — i.e. the parry
   *  consumed it. Distinguishes a real fireball parry from a melee parry that
   *  merely coincides with a fireball being on screen. */
  fireball: boolean
}

function parries(seed: number, p1: string, p2: string, frames = 2400): ParryHit[] {
  const h = new HarnessSim({ seed, p1, p2 } as never)
  const out: ParryHit[] = []
  let prev: { id: number; owner: number; x: number }[] = []
  for (let k = 0; k < frames; k++) {
    const r = h.step()
    const cur = (r.state.projectiles ?? []).map((p) => ({ id: p.id, owner: p.owner, x: p.pos.x }))
    const liveIds = new Set(cur.map((p) => p.id))
    for (const e of r.events) {
      if (e.type !== 'parry') continue
      const defender = 1 - e.attacker
      const meX = r.state.fighters[defender].pos.x
      const consumed = prev.some(
        (p) => p.owner !== defender && !liveIds.has(p.id) && Math.abs(p.x - meX) < 110,
      )
      out.push({ frame: k, fireball: consumed })
    }
    prev = cur
  }
  return out
}

describe('AI parries', () => {
  it('reads and parries committed melee attacks in a live fight', () => {
    // operator vs vanguard: neither has a projectile, so this isolates the
    // melee (attackGuard) parry read with a stable rng stream.
    //
    // Teeth without brittleness: a fighter walking forward in neutral will
    // *incidentally* parry — a forward tap arms a parry whether or not the AI
    // meant it — so a bare `>= 1` is vacuous (it survives disabling the parry
    // AI entirely). Measured on this exact seed: parry AI on -> 4 parries, parry
    // AI off (parryChance 0, incidental only) -> 1. So `>= 3` sits in the gap:
    // it proves the deliberate parry read contributes, reds when parryChance is
    // zeroed, and does not re-break every time a balance pass shifts the count
    // by one the way the old exact `=== 4` did.
    const a = parries(0x51ac, 'operator', 'vanguard')
    expect(a.length).toBeGreaterThanOrEqual(3)
    // Teeth against a false fireball-parry claim: no projectiles exist in this
    // matchup, so none of these parries may be flagged as consuming a bolt.
    expect(a.every((p) => !p.fireball)).toBe(true)
  })

  it('is deterministic: the same seed parries on the same frames every run', () => {
    const a = parries(0x51ac, 'warden', 'operator')
    const b = parries(0x51ac, 'warden', 'operator')
    expect(a.map((p) => p.frame)).toEqual(b.map((p) => p.frame))
    expect(a.map((p) => p.fireball)).toEqual(b.map((p) => p.fireball))
  })

  it('incoming fireballs get parried in a live zoner fight (mechanic reachable)', () => {
    // warden throws bolts; in a real warden-vs-operator fight, at least one bolt
    // is parried rather than blocked or eaten — the zoner-breaking answer must
    // be reachable in live play, not just in the isolated mechanic test.
    //
    // HONEST SCOPE — read before trusting this: the teeth here are against the
    // sim's projectile-*parry* mechanic (updateProjectiles line ~485), NOT
    // against the AI's dedicated "read the fireball" branch. I measured that
    // branch and it is effectively dead: disabling it changes the fireball-parry
    // count by noise (12 vs 14 over 8 seeds) because the operator is already
    // walking forward to close distance and parries bolts incidentally. So the
    // player-visible feature (fireballs get parried) is real and covered; the
    // deliberate-AI-read is not, and no count assertion on this event can cover
    // it while incidental parries dominate. Flagged in the report.
    //
    // Mutation-proved: forcing updateProjectiles to skip the parry branch drops
    // fireball parries to 0 -> red. (Zeroing parryChance does NOT red it, which
    // is exactly why the old "projectile read" framing was a lie.)
    const a = parries(0x7777, 'warden', 'operator')
    const fireballs = a.filter((p) => p.fireball)
    expect(fireballs.length).toBeGreaterThanOrEqual(1)
  })
})
