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
import { makeAI, type Difficulty } from '../ai'
import { createFight, step } from '../sim'
import { getFighterDef } from '../fighters'
import { inp, NEU } from './helpers'
import type { FightState } from '../types'

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
  // Freeze the frame where a committed high attack is still in its STARTUP:
  // fighter 0 mid-`st.MP` (a high), fighter 1 idle and facing it at strike
  // range. Stepping the real sim to reach it guarantees a state the engine can
  // actually produce, rather than a hand-forged one that could drift from it.
  function committedHighStartup(gap: number): FightState | null {
    let s = createFight('operator', 'operator')
    s.phase = 'fight'
    s.phaseTimer = 0
    s.fighters[0].pos.x = -gap / 2
    s.fighters[1].pos.x = gap / 2
    s.fighters[0].facing = 1
    s.fighters[1].facing = -1
    for (let k = 0; k < 10; k++) {
      const a = s.fighters[0]
      const mv = a.move ? getFighterDef(a.id).moves[a.move.id] : null
      // Startup frames only: the attack is committed and observable, but has not
      // reached its active frames — so nothing has connected, there is no
      // hitstop, and the defender is free to react. (Snapshotting during the
      // *active* frames instead catches the hit landing, which freezes the AI in
      // hitstop and it can do nothing at all.)
      if (a.stance === 'attack' && mv && a.move &&
          a.move.frame >= 2 && a.move.frame < mv.active[0]) {
        return s
      }
      s = step(s, [inp(5, 'mp'), NEU]).state
    }
    return null
  }

  // How many of `samples` decisions on that frozen read are the deliberate
  // parry — a bare relative-forward tap *into* the attack. The defender is
  // stationary here, so a forward tap has exactly one source: the parry read.
  // (Proven by the floor below: zeroing parryChance drops this to a clean 0.)
  function parryReads(diff: Difficulty, seed: number, gap = 70, samples = 50): number {
    const base = committedHighStartup(gap)
    if (!base) throw new Error('could not stage a committed-high startup')
    const ai = makeAI({ difficulty: diff, seed })
    const fwd = base.fighters[1].facing === 1 ? 6 : 4
    let reads = 0
    // Warm the reaction ring first: the AI reacts to what it saw reactionFrames
    // ago, so the earliest samples predate its awareness of the attack.
    for (let k = 0; k < 30 + samples; k++) {
      const d = ai.decide(base, 1)
      if (k >= 30 && d.pressed.size === 0 && d.dir === fwd) reads++
    }
    return reads
  }

  it('reads a committed high attack and parries it, scaling with tier', () => {
    // WHY THIS IS A FROZEN READ AND NOT A LIVE FIGHT (and why it USED to be a
    // live fight): a fighter walking forward in neutral *incidentally* arms a
    // parry — a forward tap parries whether or not the AI meant it. In a full
    // AI-vs-AI fight those incidental parries dominate and swing with the
    // matchup, so a live parry count cannot isolate the deliberate read.
    // Measured over 8 seeds, operator-vs-vanguard, parryChance-on vs
    // parryChance-zero come out statistically indistinguishable (≈7 vs ≈9 — the
    // floor is actually HIGHER, pure noise).
    //
    // The old version of this test asserted a live `>= 3` on a single seed. It
    // was green when written (that seed happened to read 4 vs an incidental 1),
    // but the combo router — which lands hit-confirmed BnBs off whiff punishes —
    // compressed the neutral where deliberate parries happen, and on that seed
    // the read fell to 2 against an incidental floor of 2. A test whose pass
    // depended on one seed's noise, satisfiable with the parry AI disabled: the
    // exact lying-test shape this repo keeps producing.
    //
    // So we ISOLATE the read: freeze the frame where the opponent has committed
    // to a high and the AI is stationary facing it. The only forward tap the AI
    // can make now is the parry read. Measured, aggregated over the 8 seeds
    // below (50 samples each, 400 total per tier):
    //   parryChance on ->  hard 228 / medium 110 / easy 17  (≈ each tier's rate)
    //   parryChance 0  ->  hard   0 / medium   0 / easy  0  (the mutation floor)
    // A clean zero floor means every parry counted here is deliberate.
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8]
    const sum = (d: Difficulty) => seeds.reduce((a, s) => a + parryReads(d, s), 0)
    const hard = sum('hard')
    const medium = sum('medium')
    const easy = sum('easy')
    // The read scales with tier. This is impossible to satisfy incidentally —
    // the floor for every tier is zero — so zeroing parryChance makes all three
    // 0 and breaks both orderings at once. (Mutation-proved: I set every tier's
    // parryChance to 0 and both `toBeGreaterThan` below went red.)
    expect(hard).toBeGreaterThan(medium)
    expect(medium).toBeGreaterThan(easy)
    // Even the weakest tier reads *some* parry — the branch is live for all of
    // them, not just the hard AI.
    expect(easy).toBeGreaterThan(0)
    // ...and the aggressive tier parries a read high more often than not, so a
    // deliberate parry is its dominant answer to a committed strike, not a rare
    // flicker. (Measured 228/400; the 0.4 bar leaves headroom for tuning.)
    expect(hard).toBeGreaterThan(seeds.length * 50 * 0.4)
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
