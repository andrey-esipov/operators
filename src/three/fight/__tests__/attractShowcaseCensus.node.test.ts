import { describe, it, expect } from 'vitest'
import { HarnessSim } from '../../../fight/harnessSim'
import { getFighterDef } from '../../../fight/fighters'
import type { Difficulty } from '../../../fight/ai'
import type { HitLevel } from '../../../fight/types'

/**
 * ATTRACT-REEL SHOWCASE CENSUS — per-BOUT occurrence of the marquee impacts.
 *
 * WHY THIS IS DISTINCT FROM `aiMovesetCensus`. The sibling census asserts each
 * ground HitLevel lands at a meaningful AGGREGATE rate (a per-match floor summed
 * across the whole matrix). That is the right gate for "does the move ever reach
 * the reel at all". It cannot answer the question a buyer actually poses: *in
 * the one bout I happen to watch, do I see the expensive stuff?* A level can
 * clear a 1.0/match aggregate floor while being ABSENT from most individual
 * bouts — a handful of bouts carry it, the rest show none. This instrument
 * measures PER-BOUT OCCURRENCE: the fraction of completed bouts in which the
 * viewer sees >=1 super performed AND >=1 heavy-or-above impact land.
 *
 * OUR CHOSEN TARGET (this is OUR merchandising bar, stated as ours — NOT a
 * genre-sourced figure; the fleet masquerade rule forbids dressing a
 * self-authored number as an outside fact): a buyer watching one attract bout
 * should see at least one super and at least one heavy-or-above impact.
 *
 * The attract reel runs the HARD tier (FrontDoor -> AttractMode ->
 * AttractDirector -> MatchSim, difficulty 'hard' both sides), so HARD is the
 * tier this instrument measures. `HarnessSim` wraps the identical
 * `createFight`/`step` + `makeAI` core `MatchSim` uses, so a matched tier
 * reproduces the reel's AI exactly.
 *
 * "heavy-or-above impact" is defined by our own measured CAMERA-KICK magnitude
 * curve (light 4.29 < medium 6.87 < sweep 9.46 < heavy 11.43 < launcher 13.61 <
 * crumple 16.80 px): the levels whose kick is >= heavy's, i.e.
 * {heavy, launcher, crumple}. Sweep (9.46) sits BELOW heavy and is reported
 * separately, not folded in. A super is tracked by ANIMATION PERFORMED (the
 * fighter enters its `tag:'super'` move), because the cinematic itself is the
 * spectacle whether or not it connects — vanguard's super is a command grab
 * (emits a throw) and warden's is a projectile, so a hit-event-only test would
 * miss two of the three supers entirely.
 *
 * WHAT THE MEASUREMENT FOUND (and it corrects a premise). At the reel's HARD
 * tier, EVERY reel-reachable matchup shows a super AND a heavy-or-above impact
 * in 100% of sampled bouts — operator/vanguard/warden in all six cross-archetype
 * pairings. The ONLY 0%-super configuration in the whole matrix is the
 * same-archetype MIRROR (e.g. warden-v-warden), which the reel PROVABLY never
 * shows: both `attractDirector` pickers hard-reject same-archetype pairs
 * (`pickOpenerPair` line ~207, `pickCoveragePair` line ~226), opener included.
 * So the "a buyer may watch a whole demo without a super or a heavy" concern is
 * real ONLY for the mirror — a harness config, not a front-door-reachable bout.
 * This is the import-edge != reachability rule applied to a SIM CONFIG: the
 * harness CAN run a warden mirror; the reel never DOES.
 *
 * WHAT THIS GATE DEFENDS. Because the reachable set already clears the target,
 * this lands GREEN and load-bearing: it asserts that >=90% of reel-reachable
 * bouts show a super AND >=90% show a heavy-or-above (our merchandising floor —
 * see below), so a future AI or roster change that lets a reachable matchup go
 * dark (warden losing its super trigger, a normal demoted) reds the gate. The
 * mirror is reported for context but never asserted, because no reel bout can be
 * one. The 90% floor is OUR chosen bar, not a genre figure; pre-registering it
 * makes it checkable, not externally grounded.
 */

const ROSTER = ['operator', 'vanguard', 'warden'] as const
const SEEDS = [12345, 1, 2, 3]
const REEL_TIER: Difficulty = 'hard'
const LEVELS: HitLevel[] = ['light', 'medium', 'sweep', 'heavy', 'launcher', 'crumple']
const HEAVY_PLUS: HitLevel[] = ['heavy', 'launcher', 'crumple']

function matchups(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const a of ROSTER) for (const b of ROSTER) out.push([a, b])
  return out
}

/** The set of `tag:'super'` move ids a fighter owns. Non-empty for the whole
 *  roster; an EMPTY set here is the exact vacuity failure the self-control below
 *  guards — a super detector fed no ids can never see a super. */
function superIds(id: string): Set<string> {
  const def = getFighterDef(id)
  return new Set(
    Object.values(def.moves)
      .filter((m) => m.tag === 'super')
      .map((m) => m.id),
  )
}

interface BoutOutcome {
  completed: boolean
  sawSuper: boolean
  sawHeavyPlus: boolean
  levelSeen: Record<HitLevel, boolean>
  superPerformed: number
}

function zeroSeen(): Record<HitLevel, boolean> {
  return { light: false, medium: false, sweep: false, heavy: false, launcher: false, crumple: false }
}

/** One deterministic bout to match-end. Tracks, per bout: which HitLevels landed
 *  at least once, and how many DISTINCT super performances occurred (rising edge
 *  of a fighter entering its super move — so a 40-frame super counts once, not
 *  40 times). */
function runBout(seed: number, tier: Difficulty, p1: string, p2: string, maxFrames = 20000): BoutOutcome {
  const sim = new HarnessSim({ seed, difficulty1: tier, difficulty2: tier, p1, p2 })
  const sup: [Set<string>, Set<string>] = [superIds(p1), superIds(p2)]
  const levelSeen = zeroSeen()
  const prevInSuper: [boolean, boolean] = [false, false]
  let superPerformed = 0
  let completed = false

  for (let n = 0; n < maxFrames; n++) {
    const res = sim.step()
    const s = res.state
    for (const e of res.events) {
      if (e.type === 'hit' || e.type === 'counter-hit') levelSeen[e.level] = true
    }
    for (let k = 0; k < 2; k++) {
      const mid = s.fighters[k].move?.id
      const inSuper = mid !== undefined && sup[k].has(mid)
      if (inSuper && !prevInSuper[k]) superPerformed++
      prevInSuper[k] = inSuper
    }
    if (s.phase === 'match-end') { completed = true; break }
  }

  const sawSuper = superPerformed > 0
  const sawHeavyPlus = HEAVY_PLUS.some((l) => levelSeen[l])
  return { completed, sawSuper, sawHeavyPlus, levelSeen, superPerformed }
}

interface Agg {
  bouts: number
  completed: number
  sawSuper: number
  sawHeavyPlus: number
  sawBoth: number
  levelBouts: Record<HitLevel, number>
  totalSuperPerformed: number
}

function newAgg(): Agg {
  return { bouts: 0, completed: 0, sawSuper: 0, sawHeavyPlus: 0, sawBoth: 0, levelBouts: zeroCount(), totalSuperPerformed: 0 }
}

/** True when the reel would actually pick this pairing: it never shows a moveset
 *  mirror (`attractDirector.pickCoveragePair`: "a different archetype ... never a
 *  moveset mirror"), so a same-character bout is measurable in the harness but
 *  never reachable on the front door. */
function reelReachable(p1: string, p2: string): boolean {
  return p1 !== p2
}

function runTier(tier: Difficulty): { agg: Agg; reel: Agg; wardenMirror: Agg; perMatch: Map<string, Agg> } {
  const agg = newAgg()
  const reel = newAgg()
  const wardenMirror = newAgg()
  const perMatch = new Map<string, Agg>()
  for (const [p1, p2] of matchups()) {
    for (const seed of SEEDS) {
      const o = runBout(seed, tier, p1, p2)
      const target = (a: Agg) => {
        a.bouts++
        if (o.completed) a.completed++
        if (o.sawSuper) a.sawSuper++
        if (o.sawHeavyPlus) a.sawHeavyPlus++
        if (o.sawSuper && o.sawHeavyPlus) a.sawBoth++
        for (const l of LEVELS) if (o.levelSeen[l]) a.levelBouts[l]++
        a.totalSuperPerformed += o.superPerformed
      }
      target(agg)
      if (reelReachable(p1, p2)) target(reel)
      if (p1 === 'warden' && p2 === 'warden') target(wardenMirror)
      const key = `${p1} v ${p2}`
      let pm = perMatch.get(key)
      if (!pm) { pm = newAgg(); perMatch.set(key, pm) }
      target(pm)
    }
  }
  return { agg, reel, wardenMirror, perMatch }
}

function zeroCount(): Record<HitLevel, number> {
  return { light: 0, medium: 0, sweep: 0, heavy: 0, launcher: 0, crumple: 0 }
}

const pct = (n: number, d: number) => (d ? (100 * n / d).toFixed(1) : '0.0')

describe('attract-reel showcase census (per-bout marquee occurrence)', () => {
  it('measures per-bout super + heavy-or-above occurrence at the reel tier', { timeout: 180000 }, () => {
    const { agg, reel, wardenMirror, perMatch } = runTier(REEL_TIER)

    if (process.env.SHOWCASE_REPORT) {
      const line = (label: string, a: Agg) =>
        `  ${label.padEnd(18)} bouts=${String(a.bouts).padStart(3)} completed=${String(a.completed).padStart(3)} ` +
        `super=${pct(a.sawSuper, a.bouts).padStart(5)}% heavy+=${pct(a.sawHeavyPlus, a.bouts).padStart(5)}% BOTH=${pct(a.sawBoth, a.bouts).padStart(5)}% ` +
        `(superPerf=${a.totalSuperPerformed})`
      const levels = LEVELS.map((l) => `${l}=${pct(agg.levelBouts[l], agg.bouts)}%`).join('  ')
      const perMatchLines = [...perMatch.entries()]
        .map(([k, a]) => {
          const [pa, pb] = k.split(' v ')
          const tag = reelReachable(pa, pb) ? '' : '   [MIRROR — reel never shows this]'
          return `  ${k.padEnd(20)} super=${pct(a.sawSuper, a.bouts).padStart(5)}% heavy+=${pct(a.sawHeavyPlus, a.bouts).padStart(5)}%${tag}`
        })
        .join('\n')
      // eslint-disable-next-line no-console
      console.log(
        `\n=== ATTRACT SHOWCASE CENSUS @ tier '${REEL_TIER}' (9 matchups x ${SEEDS.length} seeds) ===\n` +
        line('all matchups', agg) + '\n' +
        line('reel-reachable', reel) + '   <- non-mirror only; what the front door can actually show\n' +
        line('warden mirror', wardenMirror) + '   <- harness-only; NOT reel-reachable\n' +
        `  per-level per-bout occurrence:  ${levels}\n\n` +
        `  per-matchup super / heavy+ occurrence:\n${perMatchLines}\n\n` +
        `  TARGET (ours): a buyer watching one attract bout sees >=1 super AND >=1 heavy-or-above impact.\n`,
      )
    }

    // --- Anti-vacuity self-controls: prove the detectors actually fire, so the
    //     load-bearing floor below cannot pass via a dead detector. ---
    // 1. The matrix actually ran to completion (the sim reaches match-end).
    expect(agg.bouts).toBe(ROSTER.length * ROSTER.length * SEEDS.length)
    expect(agg.completed).toBeGreaterThan(0)
    // 2. The super detector is FED real ids for every fighter — an empty id set
    //    is the vacuity failure that would make sawSuper permanently false.
    for (const id of ROSTER) expect(superIds(id).size).toBeGreaterThan(0)
    // 3. The super PERFORMANCE detector fires on real sim data (not just the id
    //    lookup): across the matrix at least one super is actually thrown. Proves
    //    the rising-edge loop works end-to-end, so a reported 0% for a cell is a
    //    real absence, never a dead detector.
    expect(agg.totalSuperPerformed).toBeGreaterThan(0)
    // 4. The heavy-plus detector reads real events end-to-end.
    expect(agg.sawHeavyPlus).toBeGreaterThan(0)

    // --- LOAD-BEARING merchandising floor (our chosen bar, not a genre figure).
    //     Scoped to the REEL-REACHABLE set — the cross-archetype bouts the front
    //     door can actually pick — because the mirror is unreachable there. At
    //     HEAD this is 100%/100%; the 0.90 floor tolerates one benign seed
    //     dropping out while still redding a genuine regression (a reachable
    //     matchup going super- or heavy-dark). The mirror is deliberately NOT in
    //     `reel`, and folding it back in would drag the fraction below the floor
    //     — which is exactly the reachability distinction this gate encodes. ---
    const MERCH_FLOOR = 0.9
    expect(reel.bouts).toBeGreaterThan(0)
    expect(reel.sawSuper / reel.bouts).toBeGreaterThanOrEqual(MERCH_FLOOR)
    expect(reel.sawHeavyPlus / reel.bouts).toBeGreaterThanOrEqual(MERCH_FLOOR)
  })
})
