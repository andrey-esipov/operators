import { describe, it, expect } from 'vitest'
import { HarnessSim } from '../../../fight/harnessSim'
import { getFighterDef } from '../../../fight/fighters'
import type { Difficulty } from '../../../fight/ai'
import type { HitLevel } from '../../../fight/types'

/**
 * AI moveset census + strength instrument.
 *
 * WHY THIS EXISTS. A per-fight event census (built for the spacing/kick task)
 * turned up the single most consequential finding of the session: the CPU AI
 * lands lights and mediums almost exclusively. Across a wide matrix the *heavy*
 * tier — the game's most expensive VFX (big impact mark, the tuned 14/15f
 * hitstop ladder, the strongest camera kick) — reached a viewer a literal
 * handful of times, and the *sweep* tier NEVER. The attract reel, the 30
 * seconds that decide a purchase, was a jab-and-poke loop that hid the most
 * carefully tuned content in the game.
 *
 * The failure that let that ship was the assertion SHAPE: a census that only
 * checks `landed > 0` is satisfied by a single land in 170k frames and still
 * means nobody ever sees the move. So this instrument does two things a `>0`
 * gate cannot:
 *
 *   1. It records the per-HitLevel AND per-move-id landed distribution across
 *      the full 9-matchup x 3-tier x 4-seed matrix, and asserts every authored
 *      GROUND HitLevel lands at a MEANINGFUL rate — a per-completed-match floor
 *      defended below, not merely `>0`. A move that is authored, wired, and
 *      verified but never reaches the reel is exactly the "never-consumed
 *      defect" class this project keeps shipping; this gate can actually fail on
 *      it (proven: it is red on the pre-fix AI — see the commit message).
 *
 *   2. It measures AI STRENGTH (round win-rate per tier + mean round length) so
 *      a future edit that makes the CPU flashier by making it WORSE — throwing
 *      unsafe heavies at neutral and getting punished — reds the gate instead of
 *      passing silently. Spectacle bought with a dumber AI is a downgrade.
 *
 * It drives the REAL tiered `HarnessSim` (the same CPU-vs-CPU sim that backs the
 * attract reel and dev harness), so what it measures is exactly what a viewer
 * sees. No GPU, no screenshots, fully deterministic.
 */

const ROSTER = ['operator', 'vanguard', 'warden'] as const
const SEEDS = [12345, 1, 2, 3]
const TIERS: Difficulty[] = ['easy', 'medium', 'hard']
const LEVELS: HitLevel[] = ['light', 'medium', 'heavy', 'launcher', 'sweep', 'crumple']

/** Every ORDERED matchup (mirror matches included), 9 in all. */
function matchups(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const a of ROSTER) for (const b of ROSTER) out.push([a, b])
  return out
}

interface MoveTally {
  id: string
  level: HitLevel
  guard: string
  hits: number
  counter: number
  blocked: number
  whiffed: number
}

interface RoundResult {
  winner: 0 | 1 | null
  length: number
}

interface FightResult {
  frames: number
  matchEnded: boolean
  levelHits: Record<HitLevel, number>
  levelCounter: Record<HitLevel, number>
  byMove: Map<string, MoveTally>
  rounds: RoundResult[]
}

function zeroLevels(): Record<HitLevel, number> {
  return { light: 0, medium: 0, heavy: 0, launcher: 0, sweep: 0, crumple: 0 }
}

/**
 * Run one full deterministic match to match-end, tallying every landed hit by
 * BOTH its HitLevel and the attacker's move id, plus per-round winner/length.
 *
 * Move-id attribution: the `hit` event carries `attacker` + `level` but not the
 * move id. On the frame the hit resolves, the attacker is still mid-attack, so
 * the post-step `fighters[attacker].move.id` IS the move that connected. We
 * cross-check that the move's authored level equals the event level, so a
 * mis-attribution (e.g. a hit read on the wrong frame) shows up as a mismatch
 * rather than silently corrupting the by-move table.
 */
function runFight(
  seed: number, d1: Difficulty, d2: Difficulty, p1: string, p2: string,
  byMove: Map<string, MoveTally>, maxFrames = 20000,
): FightResult {
  const sim = new HarnessSim({ seed, difficulty1: d1, difficulty2: d2, p1, p2 })
  const ids = [p1, p2]
  const levelHits = zeroLevels()
  const levelCounter = zeroLevels()
  const rounds: RoundResult[] = []
  let roundStart = 0
  let matchEnded = false
  let frames = 0
  // Last move id each fighter was actively attacking with. On the hit frame the
  // attacker is normally still mid-move, but a few moves (lunging specials) clear
  // their move state the same frame they connect; falling back to the last active
  // move recovers those instead of dropping them into a '<none>' bucket. A truly
  // ownerless hit (a projectile, which strikes while its owner stands neutral)
  // stays '<none>', which is correct — it is not a move-in-progress.
  const lastAtk: (string | undefined)[] = [undefined, undefined]

  for (let n = 0; n < maxFrames; n++) {
    const res = sim.step()
    const s = res.state
    frames = n + 1
    for (const e of res.events) {
      if (e.type === 'hit' || e.type === 'counter-hit' || e.type === 'block' || e.type === 'whiff') {
        if (e.type === 'hit') levelHits[e.level]++
        else if (e.type === 'counter-hit') levelCounter[e.level]++
        const mv = s.fighters[e.attacker].move
        const mid = mv ? mv.id : (lastAtk[e.attacker] ?? '<none>')
        const key = `${ids[e.attacker]}:${mid}`
        let t = byMove.get(key)
        if (!t) {
          const def = getFighterDef(ids[e.attacker])
          const authored = def.moves[mid]?.hit?.level ?? (e.type === 'hit' || e.type === 'counter-hit' ? e.level : 'light')
          const guard = def.moves[mid]?.hit?.guard ?? 'high'
          t = { id: `${ids[e.attacker]}.${mid}`, level: authored, guard, hits: 0, counter: 0, blocked: 0, whiffed: 0 }
          byMove.set(key, t)
        }
        if (e.type === 'hit') t.hits++
        else if (e.type === 'counter-hit') t.counter++
        else if (e.type === 'block') t.blocked++
        else t.whiffed++
      } else if (e.type === 'round-start') {
        roundStart = n
      } else if (e.type === 'round-end') {
        rounds.push({ winner: e.winner, length: n - roundStart })
      }
    }
    for (let k = 0; k < 2; k++) {
      const f = s.fighters[k]
      if (f.move && f.stance === 'attack') lastAtk[k] = f.move.id
    }
    if (s.phase === 'match-end') { matchEnded = true; break }
  }
  return { frames, matchEnded, levelHits, levelCounter, byMove, rounds }
}

/** Sum a census over the full symmetric matrix (both AIs at the same tier). */
function censusMatrix() {
  const byLevel = zeroLevels()
  const byLevelCH = zeroLevels()
  const byMove = new Map<string, MoveTally>()
  let matches = 0
  let completed = 0
  let frames = 0
  // Per (tier) round win/length, keyed for the strength readout.
  const perTier: Record<string, { rounds: number; frames: number }> = {}

  for (const tier of TIERS) {
    perTier[tier] = { rounds: 0, frames: 0 }
    for (const [p1, p2] of matchups()) {
      for (const seed of SEEDS) {
        const r = runFight(seed, tier, tier, p1, p2, byMove)
        matches++
        if (r.matchEnded) completed++
        frames += r.frames
        for (const k of LEVELS) { byLevel[k] += r.levelHits[k]; byLevelCH[k] += r.levelCounter[k] }
        for (const rd of r.rounds) { perTier[tier].rounds++; perTier[tier].frames += rd.length }
      }
    }
  }
  return { byLevel, byLevelCH, byMove, matches, completed, frames, perTier }
}

/**
 * Asymmetric strength probe: run `dTop` vs `dBot` across the matrix and return
 * the top side's round win-rate + mean round length. Used to prove an AI change
 * did not make the CPU weaker (a flashier-but-dumber AI is a downgrade).
 */
function strength(dTop: Difficulty, dBot: Difficulty) {
  let topWins = 0
  let botWins = 0
  let draws = 0
  let roundFrames = 0
  let rounds = 0
  const scratch = new Map<string, MoveTally>()
  for (const [p1, p2] of matchups()) {
    for (const seed of SEEDS) {
      // p1 is the top-tier side.
      const r = runFight(seed, dTop, dBot, p1, p2, scratch)
      for (const rd of r.rounds) {
        rounds++
        roundFrames += rd.length
        if (rd.winner === 0) topWins++
        else if (rd.winner === 1) botWins++
        else draws++
      }
    }
  }
  const decisive = topWins + botWins
  return {
    winRate: decisive ? topWins / decisive : 0,
    topWins, botWins, draws, rounds,
    meanRoundLen: rounds ? roundFrames / rounds : 0,
  }
}

const pct = (n: number, d: number) => (d ? (100 * n / d).toFixed(2) : '0.00')

describe('AI moveset census', () => {
  it('every authored ground HitLevel lands at a meaningful rate across the matrix', { timeout: 180000 }, () => {
    const c = censusMatrix()
    const totalHits = LEVELS.reduce((s, k) => s + c.byLevel[k], 0)
    const totalContact = totalHits + LEVELS.reduce((s, k) => s + c.byLevelCH[k], 0)

    if (process.env.CENSUS_REPORT) {
      const rows = LEVELS.map((k) => {
        const contact = c.byLevel[k] + c.byLevelCH[k]
        return `  ${k.padEnd(9)} hits=${String(c.byLevel[k]).padStart(5)} ch=${String(c.byLevelCH[k]).padStart(4)} ` +
          `contact=${String(contact).padStart(5)} (${pct(contact, totalContact)}% of contact, ${(contact / c.completed).toFixed(2)}/match)`
      })
      // Safety profile of the committal STRIKE tiers: how often heavy/sweep LAND
      // vs get blocked or whiffed. Throw-guard moves are excluded — a command
      // throw is authored level 'heavy' (it does heavy-tier damage) but it is not
      // a heavy *strike*, it emits a 'throw'/'whiff' not a 'hit', and a whiffed
      // throw is a normal part of the scramble, not the "AI flails a big button"
      // tell. Counting them would defame the strike numbers (they added ~440
      // phantom "heavy whiffs"). A high blocked/whiffed share among real strikes
      // is the exact bad-AI tell a reviewer names, so the instrument isolates it.
      const safety = (k: HitLevel) => {
        let land = 0, blk = 0, whf = 0
        for (const m of c.byMove.values()) {
          if (m.level !== k || m.guard === 'throw') continue
          land += m.hits + m.counter; blk += m.blocked; whf += m.whiffed
        }
        const att = land + blk + whf
        return `  ${k.padEnd(9)} land=${String(land).padStart(4)} blocked=${String(blk).padStart(4)} whiffed=${String(whf).padStart(4)} ` +
          `→ ${pct(land, att)}% land / ${pct(blk, att)}% blocked / ${pct(whf, att)}% whiffed`
      }
      // eslint-disable-next-line no-console
      console.log(
        `\n=== CENSUS: ${c.matches} matches (${c.completed} completed), ${c.frames} frames ===\n` +
        rows.join('\n') +
        `\n\n=== BY MOVE (landed/blocked/whiffed >= 1) ===\n` +
        [...c.byMove.values()]
          .sort((a, b) => (b.hits + b.counter) - (a.hits + a.counter))
          .map((m) => `  ${m.id.padEnd(20)} [${m.level.padEnd(8)}] hits=${String(m.hits).padStart(5)} ch=${String(m.counter).padStart(4)} blk=${String(m.blocked).padStart(4)} whf=${String(m.whiffed).padStart(4)}`)
          .join('\n') +
        `\n\n=== SAFETY PROFILE (committal tiers) ===\n` +
        safety('heavy') + '\n' + safety('sweep') + '\n' + safety('launcher') +
        `\n\n=== MEAN ROUND LENGTH by tier ===\n` +
        TIERS.map((t) => `  ${t.padEnd(7)} ${(c.perTier[t].frames / Math.max(1, c.perTier[t].rounds)).toFixed(0)}f over ${c.perTier[t].rounds} rounds`).join('\n'),
      )
    }

    // The matrix must actually have run a representative sample.
    expect(c.completed).toBeGreaterThan(80)
    expect(c.frames).toBeGreaterThan(100000)

    // MEANINGFUL-RATE FLOOR — defended, not `>0`.
    //
    // The unit is "lands per completed match", because the attract reel is
    // per-match footage: if a level lands >= F times in an average match, a
    // typical 30-60s clip of that match shows it. Floors are per-level because
    // the levels have honestly different natural frequencies:
    //   - light/medium are the fast pokes that open every exchange -> high.
    //   - heavy/sweep are committal buttons; a competent AI uses them as
    //     whiff-punishes / spaced footsie / combo enders, not every poke, so a
    //     realistic floor is ~1 per match, i.e. a viewer reliably sees each at
    //     least once per fight.
    //   - launcher rides anti-airs + BnB starters -> comfortably above 1.
    //   - crumple is the super: gated behind a full meter bar, so it is
    //     legitimately the rarest and floored lowest (still > pre-fix).
    // These floors sit far below what the fixed AI actually produces (see the
    // report) and far ABOVE the pre-fix failure mode (heavy ~0.03/match,
    // sweep 0/match), so the gate discriminates "seen" from "invisible" without
    // being a threshold tuned to just-pass.
    const perMatch = (k: HitLevel) => (c.byLevel[k] + c.byLevelCH[k]) / c.completed
    const FLOOR: Record<HitLevel, number> = {
      light: 3.0, medium: 3.0, heavy: 1.0, launcher: 1.0, sweep: 0.6, crumple: 0.25,
    }
    for (const k of LEVELS) {
      expect(
        perMatch(k),
        `${k} landed ${(perMatch(k)).toFixed(3)}/match, floor ${FLOOR[k]}/match — authored VFX that never reaches the reel`,
      ).toBeGreaterThanOrEqual(FLOOR[k])
    }
  })

  it('the fixed AI is not weaker: sharper tiers still beat softer ones', { timeout: 180000 }, () => {
    // Strength guard. If a future edit trades AI quality for spectacle, the
    // higher tier stops dominating and this reds. Thresholds are deliberately
    // loose (the point is to catch a COLLAPSE, not to pin an exact rate) but
    // structural: hard must beat medium, and medium must beat easy, by a clear
    // margin, on the same matrix the census runs.
    const hardVsMed = strength('hard', 'medium')
    const medVsEasy = strength('medium', 'easy')

    if (process.env.CENSUS_REPORT) {
      // eslint-disable-next-line no-console
      console.log(
        `\n=== AI STRENGTH ===\n` +
        `  hard vs medium: win ${(100 * hardVsMed.winRate).toFixed(1)}% ` +
        `(${hardVsMed.topWins}-${hardVsMed.botWins}, ${hardVsMed.draws} draws), mean round ${hardVsMed.meanRoundLen.toFixed(0)}f\n` +
        `  medium vs easy: win ${(100 * medVsEasy.winRate).toFixed(1)}% ` +
        `(${medVsEasy.topWins}-${medVsEasy.botWins}, ${medVsEasy.draws} draws), mean round ${medVsEasy.meanRoundLen.toFixed(0)}f`,
      )
    }

    expect(hardVsMed.winRate).toBeGreaterThan(0.55)
    expect(medVsEasy.winRate).toBeGreaterThan(0.55)
  })
})
