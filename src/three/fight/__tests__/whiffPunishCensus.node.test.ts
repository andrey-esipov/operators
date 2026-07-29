import { writeFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { MatchSim } from '../../../play/MatchSim'
import { getFighterDef } from '../../../fight/fighters'
import { MAX_METER, REACH_BONUS } from '../../../fight/constants'
import { ROSTER, type ArchetypeId } from '../../../fighthud/select/roster'
import type { FightState } from '../../../fight/types'

/**
 * Whiff-punish distance census — "of the whiffs the attract reel shows, how many
 * are thrown inside punish range and go unpunished anyway?"
 *
 * WHY THIS EXISTS. An earlier AI census (aiMovesetCensus) reported a raw whiff
 * count over the FULL 9-matchup x 3-tier matrix — mirrors included, meter not
 * primed. Two of those axes are configs the attract reel STRUCTURALLY CANNOT
 * show: the reel never mirrors (`attractDirector.pickMatchup` rejects
 * `a.archetype === b.archetype`) and it primes both fighters to full meter
 * (`SUPER_PRIME = MAX_METER`) on `hard`. A raw whiff total pooled across those
 * axes answers a different question than "what does the shop window play." The
 * discipline this instrument enforces is: a measurement must carry its config.
 *
 * So this runs the REAL director config only — MatchSim, distinct-archetype
 * pairs, hard vs hard, both meter-primed — exactly as `AttractDirector.buildSim`
 * builds a bout, and records, per whiff:
 *
 *   • dist-at-commit  — |p0.x - p1.x| on the frame the poke goes active with no
 *     contact. This is the AI's own distance unit (`ai.ts`: o.dist =
 *     Math.abs(opp.pos.x - meF.pos.x)), so it is directly comparable to the
 *     punish gate `o.inRecovery && dist < 120 + R` (R = REACH_BONUS = 38).
 *   • min-dist-in-recovery — the closest the opponent got while the whiffer was
 *     still in the move (a more punish-FAVOURABLE "was it ever punishable" read).
 *   • punished — did the whiffer's stance go attack -> hitstun/juggle/knockdown
 *     before the move recovered (i.e. the opponent cashed the caught recovery).
 *
 * A whiff thrown OUTSIDE 120 + R is correctly unpunishable — that is safe
 * spacing, real footsies, not a defect. A whiff thrown INSIDE 120 + R that goes
 * unpunished is the only cell that could be an AI hole. This instrument reports
 * the DISTRIBUTION (histogram + mechanic bands), not just the split, because
 * "how far outside" is the whole question: a whiff at 130 and a whiff at 500
 * tell opposite stories about whether the reel reads tentative.
 *
 * It deliberately does NOT assert anything about the size of the in-range-
 * unpunished share: that is the exact number a sibling has pre-registered a
 * falsification threshold against, and baking a verdict into a gate here would
 * pre-judge it. The assertions below gate only INSTRUMENT VALIDITY — that the
 * census actually ran the director config and that the director config is
 * demonstrably NOT the mirror (its super rate is real where the mirror's is ~0).
 * The numbers themselves print under CENSUS_REPORT and are reported out of band.
 *
 * No GPU, no screenshots, fully deterministic (fixed seeds).
 */

const R = REACH_BONUS // 38 — the reach the AI's spacing gates are quoted against

/** The punish gate the whole question turns on: o.inRecovery && dist < 120 + R. */
const PUNISH_GATE = 120 + R // 158

/** Mechanic-anchored distance bands, by their UPPER bound (pos.x units). */
const BANDS: Array<{ hi: number; label: string }> = [
  { hi: 95 + R, label: `<${95 + R}  BnB-combo punish (o.dist<95+R -> full route)` },
  { hi: 120 + R, label: `${95 + R}-${120 + R}  special-punish (still inside gate)` },
  { hi: 150 + R, label: `${120 + R}-${150 + R}  past whiff-punish gate; reaction only` },
  { hi: 175 + R, label: `${150 + R}-${175 + R}  outside reaction; super/AA range` },
  { hi: Infinity, label: `>=${175 + R}  safe spacing / fullscreen approach` },
]

/** Fine histogram bins so "how far outside" is legible (130 vs 500). */
const BIN_W = 40
const BIN_MAX = 640

interface Whiff {
  dist: number
  minDist: number
  punished: boolean
  /** During the whiffer's RECOVERY (the exact window the AI's punish gate reads,
   *  move.frame > active[1]), was the opponent in an actionable neutral stance
   *  AND within the 120+R punish gate — i.e. genuinely free to cash the whiff? A
   *  whiff that is unpunished only because the opponent was itself committed or
   *  out of range is correctly-unpunishable footsies, NOT an AI hole; this flag
   *  is what separates the two so the unpunished share can't defame the AI. */
  oppFree: boolean
  atkArch: ArchetypeId
}

interface BoutResult {
  whiffs: Whiff[]
  superFlashes: number
  superByArch: Record<ArchetypeId, number>
  frames: number
  ended: boolean
}

const PUNISHED_STANCES = new Set(['hitstun', 'juggle', 'knockdown', 'wakeup'])
/** Stances from which a fighter can immediately start a punish (neutral/ground
 *  movement). Mirrors "the opponent could have acted" — not mid-move, not stunned,
 *  not airborne. */
const ACTIONABLE_STANCES = new Set(['idle', 'walk-fwd', 'walk-back', 'crouch'])

function dist(s: FightState): number {
  return Math.abs(s.fighters[0].pos.x - s.fighters[1].pos.x)
}

/** A whiff-punish tracker for one fighter: opened at the whiff frame, resolved
 *  when the whiffer either takes a hit (punished) or leaves the move cleanly. */
interface Pending {
  dist: number
  minDist: number
  atkArch: ArchetypeId
  /** Frame index (in the whiffer's move clock) after which it is in recovery. */
  activeEnd: number
  oppFree: boolean
}

/**
 * Drive ONE bout exactly as the director does — MatchSim, hard vs hard, both
 * meter-primed — and census its whiffs + supers. `arch` maps fighter index to
 * archetype for attribution.
 */
function runBout(
  p1: { skin: string; base: ArchetypeId },
  p2: { skin: string; base: ArchetypeId },
  seed: number,
  maxFrames: number,
): BoutResult {
  const sim = new MatchSim({
    p1: { skin: p1.skin, base: p1.base },
    p2: { skin: p2.skin, base: p2.base },
    controllers: [
      { kind: 'cpu', difficulty: 'hard', seed },
      { kind: 'cpu', difficulty: 'hard', seed: (seed ^ 0x9e3779b9) >>> 0 },
    ],
    seed,
  })
  // Prime meter on the live state before the first step — the director primes so
  // supers are available in the opening exchange. Omitting this is one of the
  // reasons the mirror census read 0 supers.
  sim.current.fighters[0].meter = MAX_METER
  sim.current.fighters[1].meter = MAX_METER

  const arch: [ArchetypeId, ArchetypeId] = [p1.base, p2.base]
  const skinOf: [string, string] = [p1.skin, p2.skin]
  const superByArch = { operator: 0, vanguard: 0, warden: 0 } as Record<ArchetypeId, number>
  const whiffs: Whiff[] = []
  let superFlashes = 0
  let ended = false
  let frames = 0

  // At most one in-flight whiff per fighter (a fighter can only be mid-one-move).
  const pending: (Pending | null)[] = [null, null]

  const resolve = (k: 0 | 1, punished: boolean) => {
    const p = pending[k]
    if (!p) return
    whiffs.push({ dist: p.dist, minDist: p.minDist, punished, oppFree: p.oppFree, atkArch: p.atkArch })
    pending[k] = null
  }

  for (let n = 0; n < maxFrames; n++) {
    const res = sim.step()
    const s = res.state
    frames = n + 1
    const d = dist(s)

    // Advance / resolve any in-flight whiff BEFORE opening new ones this frame.
    for (let k = 0 as 0 | 1; k <= 1; k = (k + 1) as 0 | 1) {
      const p = pending[k]
      if (!p) continue
      p.minDist = Math.min(p.minDist, d)
      const self = s.fighters[k]
      const opp = s.fighters[(1 - k) as 0 | 1]
      // Only while the whiffer is actually in RECOVERY (move.frame > active[1]) —
      // the exact predicate the AI's o.inRecovery punish gate reads — count the
      // opponent as a free punisher if it is actionable AND inside the gate.
      const inRecovery = !!self.move && self.move.frame > p.activeEnd
      if (inRecovery && d < PUNISH_GATE && ACTIONABLE_STANCES.has(opp.stance)) {
        p.oppFree = true
      }
      const st = self.stance
      if (PUNISHED_STANCES.has(st)) {
        resolve(k, true)
      } else if (st !== 'attack') {
        // Recovered cleanly to a neutral/movement stance without being hit.
        resolve(k, false)
      }
    }

    for (const e of res.events) {
      if (e.type === 'whiff') {
        const k = e.attacker
        // If one was somehow still pending (e.g. a cancel kept stance='attack'),
        // it was not punished — close it before opening the new one.
        if (pending[k]) resolve(k, false)
        const mvId = s.fighters[k].move?.id
        const mv = mvId ? getFighterDef(skinOf[k]).moves[mvId] : undefined
        // No def -> never mark in-recovery (activeEnd=Inf), which keeps oppFree
        // false: a conservative default that cannot inflate the "genuine hole".
        const activeEnd = mv ? mv.active[1] : Infinity
        pending[k] = { dist: d, minDist: d, atkArch: arch[k], activeEnd, oppFree: false }
      } else if (e.type === 'super-flash') {
        superFlashes++
        superByArch[arch[e.who]]++
      }
    }

    if (s.phase === 'match-end') { ended = true; break }
  }
  // Round/match ended (or cap hit) with whiffs still in flight — they were not
  // punished within the bout, so count them as unpunished.
  resolve(0, false)
  resolve(1, false)

  return { whiffs, superFlashes, superByArch, frames, ended }
}

/** Every distinct-SKIN, distinct-ARCHETYPE ordered pair the director can draw. */
function directorPairs(): Array<[typeof ROSTER[number], typeof ROSTER[number]]> {
  const out: Array<[typeof ROSTER[number], typeof ROSTER[number]]> = []
  for (const a of ROSTER) for (const b of ROSTER) {
    if (a.skin === b.skin) continue
    if (a.archetype === b.archetype) continue // the reel never mirrors a moveset
    out.push([a, b])
  }
  return out
}

/** The zoner mirror the corrected census was measured on — reported SEPARATELY,
 *  labelled, to show the contrast, not pooled into the director numbers. */
function wardenMirrorPairs(): Array<[string, string]> {
  const wardens = ROSTER.filter((e) => e.archetype === 'warden').map((e) => e.skin)
  const out: Array<[string, string]> = []
  for (const a of wardens) for (const b of wardens) if (a !== b) out.push([a, b])
  return out
}

interface Census {
  whiffs: Whiff[]
  bouts: number
  boutsWithSuper: number
  superFlashes: number
  superByArch: Record<ArchetypeId, number>
  frames: number
}

function census(
  pairs: Array<[{ skin: string; base: ArchetypeId }, { skin: string; base: ArchetypeId }]>,
  seeds: number[],
  maxFrames: number,
): Census {
  const whiffs: Whiff[] = []
  let bouts = 0
  let boutsWithSuper = 0
  let superFlashes = 0
  let frames = 0
  const superByArch = { operator: 0, vanguard: 0, warden: 0 } as Record<ArchetypeId, number>
  for (const [a, b] of pairs) {
    for (const seed of seeds) {
      const r = runBout(a, b, seed, maxFrames)
      bouts++
      frames += r.frames
      superFlashes += r.superFlashes
      if (r.superFlashes > 0) boutsWithSuper++
      for (const k of ['operator', 'vanguard', 'warden'] as ArchetypeId[]) superByArch[k] += r.superByArch[k]
      whiffs.push(...r.whiffs)
    }
  }
  return { whiffs, bouts, boutsWithSuper, superFlashes, superByArch, frames }
}

const pct = (n: number, d: number) => (d ? (100 * n / d).toFixed(1) : '0.0')

function bandReport(whiffs: Whiff[], key: 'dist' | 'minDist'): string {
  const lines: string[] = []
  let prevHi = 0
  for (const band of BANDS) {
    const inBand = whiffs.filter((w) => w[key] >= prevHi && w[key] < band.hi)
    const punished = inBand.filter((w) => w.punished).length
    const unpun = inBand.length - punished
    lines.push(
      `  ${band.label.padEnd(52)} n=${String(inBand.length).padStart(5)} ` +
      `(${pct(inBand.length, whiffs.length)}%)  punished=${String(punished).padStart(5)} ` +
      `unpunished=${String(unpun).padStart(5)}`,
    )
    prevHi = band.hi
  }
  return lines.join('\n')
}

function fineHistogram(whiffs: Whiff[], key: 'dist' | 'minDist'): string {
  const bins = new Map<number, number>()
  for (const w of whiffs) {
    const v = w[key]
    const bin = v >= BIN_MAX ? BIN_MAX : Math.floor(v / BIN_W) * BIN_W
    bins.set(bin, (bins.get(bin) ?? 0) + 1)
  }
  const maxN = Math.max(1, ...bins.values())
  const lines: string[] = []
  for (let lo = 0; lo <= BIN_MAX; lo += BIN_W) {
    const n = bins.get(lo) ?? 0
    const bar = '#'.repeat(Math.round((n / maxN) * 40))
    const hi = lo >= BIN_MAX ? '+' : `-${lo + BIN_W}`
    const mark = lo < PUNISH_GATE && lo + BIN_W > PUNISH_GATE ? ' <- 120+R gate' : ''
    lines.push(`  ${String(lo).padStart(3)}${hi.padEnd(5)} ${String(n).padStart(5)} ${bar}${mark}`)
  }
  return lines.join('\n')
}

describe('whiff-punish distance census (real director config)', () => {
  it('censuses whiff distances on the director config and proves it is not the mirror', { timeout: 180000 }, () => {
    const SEEDS = [12345, 1, 2, 3, 7, 11, 19, 23, 31, 41, 53, 67, 79, 97, 101, 127]
    const MAX_FRAMES = 6000 // ~100s at 60fps — well past any hard/hard KO

    const dir = census(
      directorPairs().map(([a, b]) => [
        { skin: a.skin, base: a.archetype },
        { skin: b.skin, base: b.archetype },
      ]),
      SEEDS,
      MAX_FRAMES,
    )

    const mir = census(
      wardenMirrorPairs().map(([a, b]) => [
        { skin: a, base: 'warden' as ArchetypeId },
        { skin: b, base: 'warden' as ArchetypeId },
      ]),
      SEEDS,
      MAX_FRAMES,
    )

    // The in-range (punishable) whiffs, by both the commit distance and the more
    // punish-favourable min-distance-during-recovery read.
    const inGateCommit = dir.whiffs.filter((w) => w.dist < PUNISH_GATE)
    const inGateMin = dir.whiffs.filter((w) => w.minDist < PUNISH_GATE)
    const unpunCommit = inGateCommit.filter((w) => !w.punished).length
    const unpunMin = inGateMin.filter((w) => !w.punished).length

    // Decompose the in-range UNPUNISHED whiffs into (a) genuine holes — the
    // opponent was actionable AND inside the gate during the whiffer's recovery
    // and still did not cash it — vs (b) excused — the opponent was itself
    // committed or out of range in that window, so no punish was on offer. Only
    // (a) is an AI hole; reporting the raw 74% without this split would defame
    // the AI exactly the way this project's lying harnesses do.
    const inGateUnpun = inGateCommit.filter((w) => !w.punished)
    const genuineHole = inGateUnpun.filter((w) => w.oppFree).length
    const excused = inGateUnpun.length - genuineHole

    if (process.env.CENSUS_REPORT) {
      const report =
        `\n=== WHIFF-PUNISH CENSUS — REAL DIRECTOR CONFIG ===\n` +
        `config: distinct-archetype pairs (never a mirror), hard vs hard, both meter-primed to MAX (MatchSim, as AttractDirector.buildSim)\n` +
        `${directorPairs().length} ordered skin pairs x ${SEEDS.length} seeds = ${dir.bouts} bouts, ${dir.frames} frames\n` +
        `total whiffs = ${dir.whiffs.length}\n` +
        `supers: ${dir.superFlashes} super-flashes over ${dir.boutsWithSuper}/${dir.bouts} bouts ` +
        `(${pct(dir.boutsWithSuper, dir.bouts)}% of bouts have >=1 super) ` +
        `[operator=${dir.superByArch.operator} vanguard=${dir.superByArch.vanguard} warden=${dir.superByArch.warden}]\n` +

        `\n--- distance AT COMMIT (spacing the poke was thrown at) ---\n` +
        bandReport(dir.whiffs, 'dist') +
        `\n\n--- fine histogram, dist at commit (bin=${BIN_W}) ---\n` +
        fineHistogram(dir.whiffs, 'dist') +

        `\n\n--- min distance DURING RECOVERY (closest the punisher got) ---\n` +
        bandReport(dir.whiffs, 'minDist') +

        `\n\n=== THE ANSWER ===\n` +
        `INSIDE punish range (dist<${PUNISH_GATE}) at commit: n=${inGateCommit.length} ` +
        `(${pct(inGateCommit.length, dir.whiffs.length)}% of all whiffs), ` +
        `unpunished=${unpunCommit} (${pct(unpunCommit, inGateCommit.length)}% of in-range)\n` +
        `INSIDE punish range by MIN dist in recovery: n=${inGateMin.length} ` +
        `(${pct(inGateMin.length, dir.whiffs.length)}% of all whiffs), ` +
        `unpunished=${unpunMin} (${pct(unpunMin, inGateMin.length)}% of in-range)\n` +
        `OUTSIDE ${PUNISH_GATE} (correctly-unpunishable safe spacing): ` +
        `${dir.whiffs.length - inGateCommit.length} (${pct(dir.whiffs.length - inGateCommit.length, dir.whiffs.length)}% of all whiffs)\n` +
        `\n  of the ${inGateUnpun.length} in-range UNPUNISHED whiffs (commit dist<${PUNISH_GATE}):\n` +
        `    GENUINE HOLE (opponent actionable & in-gate during the whiffer's recovery, still no punish): ` +
        `${genuineHole} (${pct(genuineHole, inGateUnpun.length)}% of in-range-unpunished, ${pct(genuineHole, dir.whiffs.length)}% of ALL whiffs)\n` +
        `    EXCUSED (opponent itself committed / out of range in that window — no punish was on offer): ` +
        `${excused} (${pct(excused, inGateUnpun.length)}%)\n` +

        `\n=== WARDEN/WARDEN ZONER MIRROR — SEPARATE, LABELLED (the config the reel CANNOT show) ===\n` +
        `${wardenMirrorPairs().length} ordered pairs x ${SEEDS.length} seeds = ${mir.bouts} bouts\n` +
        `total whiffs = ${mir.whiffs.length}\n` +
        `supers: ${mir.superFlashes} super-flashes over ${mir.boutsWithSuper}/${mir.bouts} bouts ` +
        `(${pct(mir.boutsWithSuper, mir.bouts)}% of bouts) [warden=${mir.superByArch.warden}]\n` +
        `mirror frames simulated = ${mir.frames} (proves the 0-super contrast is out-of-range zoning, not an unrun config)\n` +
        `--- distance AT COMMIT ---\n` +
        bandReport(mir.whiffs, 'dist') +
        `\n--- fine histogram, dist at commit ---\n` +
        fineHistogram(mir.whiffs, 'dist') + '\n'
      // eslint-disable-next-line no-console
      console.log(report)
      writeFileSync('.whiff-report.txt', report)
    }

    // ---- INSTRUMENT-VALIDITY GATES (deliberately NOT a verdict on the hole) ----

    // 1. The census actually ran a representative sample of the director config.
    expect(dir.bouts).toBeGreaterThanOrEqual(directorPairs().length * 8)
    expect(dir.frames).toBeGreaterThan(50000)
    expect(dir.whiffs.length).toBeGreaterThan(200)

    // 2. Every whiff carries a real config: an archetype that IS one of the two
    //    fighters' movesets, and a finite distance. A whiff with no distance is a
    //    lying row (the failure this whole instrument exists to prevent).
    expect(dir.whiffs.every((w) => Number.isFinite(w.dist) && w.dist >= 0)).toBe(true)
    expect(dir.whiffs.every((w) => w.minDist <= w.dist)).toBe(true)

    // 3. CONFIG IDENTITY — the director config is demonstrably NOT the mirror.
    //    On the director config supers are a real, frequent event (both sides
    //    primed, at least one non-zoner that closes distance); on the warden
    //    mirror both zoners sit at fullscreen out of the 175+R super gate all
    //    match, so supers are ~absent. The mirror must ALSO have run real frames,
    //    or "0 supers" would be a vacuous contrast (an unrun config, not an
    //    out-of-range one) — the exact lying-comparison shape this project fights.
    //    If these two ever converge, the census has silently drifted onto one
    //    config for both — the "a census's config is not the reel's config" bug.
    const dirSuperRate = dir.boutsWithSuper / dir.bouts
    const mirSuperRate = mir.boutsWithSuper / mir.bouts
    expect(mir.frames).toBeGreaterThan(50000) // the mirror genuinely ran
    expect(dirSuperRate).toBeGreaterThan(0.5) // reel: most bouts show a super
    expect(dirSuperRate).toBeGreaterThan(mirSuperRate + 0.3) // and far above the mirror

    // 4. The whiff population splits across the gate BOTH ways — if every whiff
    //    landed on one side, the distance measurement would be a constant (a
    //    degenerate instrument that can't answer the question).
    expect(inGateCommit.length).toBeGreaterThan(0)
    expect(dir.whiffs.length - inGateCommit.length).toBeGreaterThan(0)
  })
})
