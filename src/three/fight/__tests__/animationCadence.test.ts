import { describe, expect, it } from 'vitest'
import { resolveFrame } from '../AnimationDriver'
import type { FighterAssets } from '../../../fight/types'

// Whole roster, imported statically (same discipline as reactionCoverage: a
// single-fighter audit is structurally blind to the rest of the cast).
import altman from '../../../../public/fighters/altman/assets.json'
import annie from '../../../../public/fighters/annie/assets.json'
import cagan from '../../../../public/fighters/cagan/assets.json'
import catwu from '../../../../public/fighters/catwu/assets.json'
import chesky from '../../../../public/fighters/chesky/assets.json'
import doshi from '../../../../public/fighters/doshi/assets.json'
import lenny from '../../../../public/fighters/lenny/assets.json'
import madhavan from '../../../../public/fighters/madhavan/assets.json'
import spiegel from '../../../../public/fighters/spiegel/assets.json'
import taylor from '../../../../public/fighters/taylor/assets.json'
import turley from '../../../../public/fighters/turley/assets.json'

const ROSTER: Array<[string, FighterAssets]> = (
  [
    ['altman', altman], ['annie', annie], ['cagan', cagan], ['catwu', catwu],
    ['chesky', chesky], ['doshi', doshi], ['lenny', lenny], ['madhavan', madhavan],
    ['spiegel', spiegel], ['taylor', taylor], ['turley', turley],
  ] as Array<[string, unknown]>
).map(([n, a]) => [n, a as FighterAssets])

/**
 * Animation-cadence policy.
 *
 * The sim runs at 60 fps (fight/constants), and a key held N sim frames renders
 * at an effective 60/N fps. Premium 2D-style fighters animate on twos/threes ON
 * PURPOSE — Guilty Gear Strive is the canonical case, running 3D models on a
 * deliberately reduced cadence so they read as hand-drawn rather than 3D. Smooth
 * per-frame (on-ones, 60 fps) motion on a sprite fighter reads as cheap. Two
 * things encode that intent so it can't silently drift back to smooth:
 *
 *  1. Frames HARD-CUT — they are never interpolated/cross-faded (that path is a
 *     smear). Positions interpolate for smoothness; frames snap. Proven below by
 *     driving the real resolver and asserting every result is a discrete integer
 *     index that is a member of the clip's own frame list.
 *
 *  2. Keys are HELD, not tweened. A single 1-frame smear accent (impact, snap)
 *     is legitimate, so the on-ones budget is a small fraction rather than zero,
 *     but the SUSTAINED cadence must be reduced: the typical (median) key holds
 *     at least MIN_MEDIAN_HOLD sim frames.
 *
 * Measured at authoring time across the whole roster (1652 holds): ~0.3% on-ones,
 * median hold 6 (~10 fps effective) — already firmly on threes-or-slower. (The
 * count rose 1620 -> 1650 when the kick contact-cel fix gave each of the 30
 * LK/MK clips across the six playable skins one active-window key: those clips
 * went from a 2-key [active, idle] reel to a 3-key [idle, active, idle] reel so
 * the contact pose lands on the move's active frame. It then rose 1650 -> 1652
 * when that derivation was generalized from kicks to EVERY strike so the contact
 * cel spans the WHOLE active window, not just its first frame: the five complete
 * playable skins only had durations re-timed (key COUNT unchanged, so no delta),
 * but madhavan is a partial skin missing its hp tween cels, so its derived 4-cel
 * HP layout [startup, wind, active, rec] substitutes idle-1 for the two absent
 * tweens rather than dropping the whole clip to a generic fallback — that is +1
 * key each on madhavan st.HP and j.HP. Both added keys are HELD (durations
 * [5,5,3,17] and [5,4,4,10]); neither is on-ones, and the median is unmoved.) The
 * floors below sit under that with margin so real art has room to breathe while a
 * regression toward 60 fps smoothness reddens.
 */
export const SIM_FPS = 60
/** At most this fraction of all holds may be single-frame smear accents. */
export const MAX_ON_ONES_FRACTION = 0.05
/** The typical (median) key must hold at least this many sim frames. */
export const MIN_MEDIAN_HOLD = 3

interface CadenceStats {
  count: number
  median: number
  onOnesFraction: number
  minHold: number
  effectiveFps: number
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function cadenceStats(holds: number[]): CadenceStats {
  const med = median(holds)
  return {
    count: holds.length,
    median: med,
    onOnesFraction: holds.length ? holds.filter((d) => d === 1).length / holds.length : 1,
    minHold: holds.length ? Math.min(...holds) : 0,
    effectiveFps: med > 0 ? SIM_FPS / med : SIM_FPS,
  }
}

/** The policy predicate: reduced, held cadence — not smooth on-ones. */
function meetsCadencePolicy(s: CadenceStats): boolean {
  return s.median >= MIN_MEDIAN_HOLD && s.onOnesFraction <= MAX_ON_ONES_FRACTION
}

/** Every hold across a fighter's clips (durations clamp to >=1, like the driver). */
function holdsOf(A: FighterAssets): number[] {
  const clips = A.clips as unknown as Record<string, { frames: number[]; durations: number[] }>
  const out: number[] = []
  for (const clip of Object.values(clips)) {
    for (const d of clip.durations ?? []) out.push(Math.max(1, d))
  }
  return out
}

describe('cadence instrument actually discriminates (mutation proof)', () => {
  // If these passed for a smooth on-ones reel, the roster checks below would be
  // decoration. Prove the predicate bites before trusting it on real data.
  it('rejects smooth per-frame (on-ones) motion', () => {
    expect(meetsCadencePolicy(cadenceStats([1, 1, 1, 1, 1, 1]))).toBe(false)
  })
  it('rejects a reel that is mostly on-ones even if some keys are held', () => {
    expect(meetsCadencePolicy(cadenceStats([1, 2, 1, 2, 1, 2]))).toBe(false)
  })
  it('accepts a reduced on-threes-or-slower cadence', () => {
    expect(meetsCadencePolicy(cadenceStats([5, 3, 6, 4, 7, 3]))).toBe(true)
  })
  it('accepts a reduced cadence carrying a single smear accent', () => {
    // one 1-frame smear inside a long held reel is under the on-ones budget.
    const holds = [1, ...Array(40).fill(5)]
    expect(meetsCadencePolicy(cadenceStats(holds))).toBe(true)
  })
})

describe('roster animates on a deliberately reduced cadence', () => {
  const allHolds = ROSTER.flatMap(([, A]) => holdsOf(A))
  const stats = cadenceStats(allHolds)

  it('holds keys rather than tweening them (roster-wide)', () => {
    expect(
      stats.onOnesFraction,
      `${(100 * stats.onOnesFraction).toFixed(1)}% of holds are single-frame — reads as smooth 60fps, not hand-drawn`,
    ).toBeLessThanOrEqual(MAX_ON_ONES_FRACTION)
    expect(
      stats.median,
      `median hold ${stats.median} (~${stats.effectiveFps.toFixed(0)}fps effective) is below the on-threes floor`,
    ).toBeGreaterThanOrEqual(MIN_MEDIAN_HOLD)
  })

  it('every fighter individually holds a reduced cadence', () => {
    for (const [name, A] of ROSTER) {
      const s = cadenceStats(holdsOf(A))
      expect(s.count, `${name} has no holds`).toBeGreaterThan(0)
      expect(
        meetsCadencePolicy(s),
        `${name}: median=${s.median} onOnes=${(100 * s.onOnesFraction).toFixed(0)}% — off cadence policy`,
      ).toBe(true)
    }
  })
})

describe('frames hard-cut, never interpolate', () => {
  // Drive the REAL resolver across a full timeline on both of its clocks and
  // assert every result is a discrete integer index drawn from the clip's own
  // frame list. If anyone made the driver blend keys (return a fractional or
  // out-of-list index for smoothness), this reddens — that is the 3D-smooth
  // regression the policy forbids.
  const A = lenny as unknown as FighterAssets
  const clips = A.clips as unknown as Record<string, { frames: number[]; durations: number[] }>

  it('looping idle snaps to member frames across >2 cycles', () => {
    const idle = clips.idle ?? clips.stance
    expect(idle, 'lenny has no idle/stance clip').toBeDefined()
    const members = new Set(idle!.frames)
    for (let g = 0; g < 400; g++) {
      const idx = resolveFrame(A, { stance: 'idle', globalFrame: g })
      expect(Number.isInteger(idx), `idle frame ${idx} at t=${g} is not an integer index`).toBe(true)
      expect(members.has(idx), `idle frame ${idx} at t=${g} is not one of the clip's keys`).toBe(true)
    }
  })

  it('reaction hurt snaps to member frames across its clock', () => {
    const hurt = clips.hurt
    expect(hurt, 'lenny has no hurt clip').toBeDefined()
    const members = new Set(hurt!.frames)
    for (let r = 0; r < 120; r++) {
      const idx = resolveFrame(A, { stance: 'hitstun', globalFrame: 0, reactionFrame: r })
      expect(Number.isInteger(idx), `hurt frame ${idx} at r=${r} is not an integer index`).toBe(true)
      expect(members.has(idx), `hurt frame ${idx} at r=${r} is not one of the clip's keys`).toBe(true)
    }
  })
})
