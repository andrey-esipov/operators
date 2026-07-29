import { describe, expect, it } from 'vitest'
import type { FighterAssets } from '../../../fight/types'
import { ROSTER as SELECT_ROSTER } from '../../../fighthud/select/roster'

// Base manifests (assets.json) — the full-atlas variant.
import cheskyBase from '../../../../public/fighters/chesky/assets.json'
import spiegelBase from '../../../../public/fighters/spiegel/assets.json'
import doshiBase from '../../../../public/fighters/doshi/assets.json'
import lennyBase from '../../../../public/fighters/lenny/assets.json'
import madhavanBase from '../../../../public/fighters/madhavan/assets.json'
import turleyBase from '../../../../public/fighters/turley/assets.json'
// Hero manifests (assets.hero.json) — THE VARIANT THE OPENER LOADS FIRST.
import cheskyHero from '../../../../public/fighters/chesky/assets.hero.json'
import spiegelHero from '../../../../public/fighters/spiegel/assets.hero.json'
import doshiHero from '../../../../public/fighters/doshi/assets.hero.json'
import lennyHero from '../../../../public/fighters/lenny/assets.hero.json'
import madhavanHero from '../../../../public/fighters/madhavan/assets.hero.json'
import turleyHero from '../../../../public/fighters/turley/assets.hero.json'

// WHY THIS FILE EXISTS — the Stage-2 companion to locomotionCoverage.test.ts.
//
// The coverage gate's bar is only "the clip exists and isn't idle": a 1-cel
// static crouch sails through it (its own comment defers the single-cell case as
// "Stage 2, real-art"). That is the exact hole this file closes. Four of the six
// pickable fighters ship fully animated locomotion (crouch 4 cels, the rest 3);
// turley and madhavan ship a single held cel for crouch/block/dash/backdash —
// graded 2.5/5 "reads DEAD" in neutral by visual-critic, because a freeze is
// genre-sanctioned in hitstun but damning in neutral. Same rig, same clip: each
// static fighter's own archetype partner (doshi↔turley warden, spiegel↔madhavan
// vanguard) animates while it doesn't — so this is under-delivery, not a style.
//
// RICHNESS, not existence, is the measured quantity here. And it is measured
// against BOTH manifests: the opener (the shop window a buyer sees first) loads
// the HERO atlas, so a gate that read only base/assets.json could go green while
// the hero variant shipped a dead pose. They are identical today; pinning both
// independently means a hero-only regression reds on its own.

// Seed the checked population from the REAL select roster, never a literal list
// (matches locomotionCoverage.test.ts) — a NEWLY pickable fighter is then held
// to this bar automatically instead of slipping through un-listed. Card skins do
// not drive locomotion in a match, so richness only applies to what a player can
// actually pick.
const FIGHTABLE: string[] = [...new Set(SELECT_ROSTER.map((r) => r.skin))].sort()

// The two atlas variants a fighter ships, each keyed by skin. Typed as unknown
// so the raw JSON imports are cast to FighterAssets at the single read site.
const VARIANTS: Array<[string, Record<string, unknown>]> = [
  [
    'base',
    { chesky: cheskyBase, spiegel: spiegelBase, doshi: doshiBase, lenny: lennyBase, madhavan: madhavanBase, turley: turleyBase },
  ],
  [
    'hero',
    { chesky: cheskyHero, spiegel: spiegelHero, doshi: doshiHero, lenny: lennyHero, madhavan: madhavanHero, turley: turleyHero },
  ],
]

// The clips a fighter shows OUTSIDE attacks and hitstun — everything a player
// watches during neutral. The first six are input-DRIVEN and are exactly the set
// locomotionCoverage lists. The last three were added after a manifest census
// found the roster's WORST animation deficit living in them, outside every gate:
//
//               lenny chesky spiegel doshi | turley | madhavan
//   idle          10    10     10     10   |    6   |    4    <- 0 tweens
//   walk-fwd       8     8      8      8   |    8   |    4    <- 0 tweens
//   walk-back      8     8      8      8   |    8   |    4    <- 0 tweens
//
// Note turley is 8/8 on both walks: on the walk rows madhavan is alone, and the
// other five ship a byte-identical 8-cel structure. That is the uniformity
// discriminator at its strongest — five-of-six identical means the sixth is
// under-delivery, not a style choice.
//
// `idle` is not input-driven (it is the neutral fallback), so it is a slight
// category stretch to file it under "locomotion". It is pinned here anyway
// rather than given a population of its own: it is the single most-watched
// animation in the game and the shop-window pose in the attract reel, and a
// separate one-element population would carry a vacuity floor too weak to mean
// anything. The bar is stated per-clip below, so the mixed set costs nothing.
//
// Here we count cels (frames.length) rather than assert existence.
const CLIPS = ['crouch', 'block', 'dash', 'backdash', 'jump-rise', 'jump-fall', 'walk-fwd', 'walk-back', 'idle'] as const

// frames.length for a clip, or -1 if the clip is absent (which coverage already
// reds on; here a missing clip surfaces as an obvious out-of-band count).
function celCount(manifest: unknown, clip: string): number {
  const clips = (manifest as FighterAssets).clips
  const c = clips?.[clip]
  return c ? c.frames.length : -1
}

// ── Active characterization — today's shipped cel counts, pinned ──────────────
// A CHARACTERIZATION lock, not an aspiration. It reds on ANY drift in EITHER
// direction: a silent regression (someone rebakes an atlas and drops a cel) OR a
// silent partial-fix (art lands but nobody updates the target) both go red. The
// numbers below were measured from both manifests (base == hero today). When
// asset-delivery lands the +23-cel Stage-2 commission, UPDATE these counts in
// the SAME commit that un-skips the parity assertion below.
const TODAY: Record<string, Record<string, number>> = {
  chesky: { crouch: 4, block: 3, dash: 3, backdash: 3, 'jump-rise': 3, 'jump-fall': 3, 'walk-fwd': 8, 'walk-back': 8, idle: 10 },
  spiegel: { crouch: 4, block: 3, dash: 3, backdash: 3, 'jump-rise': 3, 'jump-fall': 3, 'walk-fwd': 8, 'walk-back': 8, idle: 10 },
  doshi: { crouch: 4, block: 3, dash: 3, backdash: 3, 'jump-rise': 3, 'jump-fall': 3, 'walk-fwd': 8, 'walk-back': 8, idle: 10 },
  lenny: { crouch: 4, block: 3, dash: 3, backdash: 3, 'jump-rise': 3, 'jump-fall': 3, 'walk-fwd': 8, 'walk-back': 8, idle: 10 },
  // Static single-cell DRIVEN locomotion — the Stage-2 deficit this file documents.
  // madhavan additionally halves the three continuously-visible clips; turley does
  // not (it is 8/8 on the walks and runs a genuinely tighter 32-frame idle cycle).
  madhavan: { crouch: 1, block: 1, dash: 1, backdash: 1, 'jump-rise': 2, 'jump-fall': 1, 'walk-fwd': 4, 'walk-back': 4, idle: 4 },
  turley: { crouch: 1, block: 1, dash: 1, backdash: 1, 'jump-rise': 2, 'jump-fall': 2, 'walk-fwd': 8, 'walk-back': 8, idle: 6 },
}

describe('locomotion richness — today\u2019s cel counts are pinned (drift-proof, both variants)', () => {
  for (const [variant, manifests] of VARIANTS) {
    it(`${variant}: every fightable fighter's locomotion cel counts match the characterization`, () => {
      let checked = 0
      const drift: string[] = []
      for (const skin of FIGHTABLE) {
        const expected = TODAY[skin]
        expect(expected, `${skin} is pickable but has no pinned counts in TODAY — add it`).toBeDefined()
        const m = manifests[skin]
        expect(m, `${variant} manifest for ${skin} was not imported by this gate`).toBeDefined()
        for (const clip of CLIPS) {
          const got = celCount(m, clip)
          checked++
          if (got !== expected[clip]) {
            drift.push(`${variant}/${skin} '${clip}': ${got} cels, characterization pins ${expected[clip]}`)
          }
        }
      }
      // Vacuity guard + iteration counter: the matrix must have actually run.
      // FIGHTABLE(6) * CLIPS(9) = 54 cel-count checks per variant. Both DIMENSIONS
      // are floored with literals so the counter can't pass vacuously: if CLIPS
      // emptied, `checked === FIGHTABLE.length * CLIPS.length` degenerates to
      // 0 === 0 and would pass — the exact "checks nothing" trap this project has
      // 18+ documented instances of. Flooring FIGHTABLE and CLIPS independently
      // (the firstBoutBudget idiom: floor the outer set AND the inner enumeration)
      // makes an emptied dimension red instead.
      expect(FIGHTABLE.length, 'fightable roster went empty — richness gate is vacuous').toBeGreaterThanOrEqual(6)
      expect(CLIPS.length, 'locomotion clip set went empty — richness gate is vacuous').toBeGreaterThanOrEqual(9)
      expect(checked, `expected ${FIGHTABLE.length * CLIPS.length} cel-count checks, ran ${checked}`).toBe(
        FIGHTABLE.length * CLIPS.length,
      )
      expect(
        drift,
        `locomotion cel counts drifted from the pin — update TODAY in the SAME commit that changed the art:\n${drift.join('\n')}`,
      ).toEqual([])
    })
  }

  it('imports every fightable fighter in BOTH variants (no skin un-covered)', () => {
    for (const [variant, manifests] of VARIANTS) {
      const missing = FIGHTABLE.filter((s) => !(s in manifests))
      expect(missing, `${variant}: fightable skins not imported by the richness gate: ${missing.join(', ')}`).toEqual([])
    }
    expect(FIGHTABLE.length, 'fightable roster went empty — richness gate is vacuous').toBeGreaterThanOrEqual(6)
  })
})

// ── Stage-2 parity target (SKIPPED until the art lands) ───────────────────────
// The shape every animated fighter already ships. This is the acceptance test
// for asset-delivery's Stage-2 commission. It is SKIPPED because it RED's today
// BY CONSTRUCTION. The commit that lands the art must (a) remove the .skip here
// and (b) update TODAY above, together.
//
// Per-clip floors are set to what the roster ALREADY DEMONSTRATES, never to an
// aspiration — an unmet-by-everyone target would be a wish, not a gate:
//   driven six  4/3/3/3/3/3  — four of six fighters ship exactly this.
//   walks       8 / 8        — FIVE of six ship exactly 8, byte-identical.
//                              madhavan alone is 4. This floor is not arguable.
//   idle        6            — deliberately turley's number, NOT the leaders' 10.
//                              turley's 6-cel/32-frame idle is a tighter cycle,
//                              plausibly a real style choice, so holding it to
//                              the leaders' shape would be over-claiming. 6 is
//                              the floor every fighter can be held to; madhavan
//                              at 4 fails it either way, which is the point.
//
// Remaining cels to clear this target: turley +11 (driven six only) and
// madhavan +22 (driven six +12, walks +8, idle +2) = 33.
const PARITY: Record<string, number> = {
  crouch: 4,
  block: 3,
  dash: 3,
  backdash: 3,
  'jump-rise': 3,
  'jump-fall': 3,
  'walk-fwd': 8,
  'walk-back': 8,
  idle: 6,
}

describe('locomotion richness — Stage-2 parity target', () => {
  it.skip('TODO(stage-2): every fightable fighter meets the 4/3/3/3/3/3 parity shape in both variants', () => {
    let checked = 0
    const shortfall: string[] = []
    for (const [variant, manifests] of VARIANTS) {
      for (const skin of FIGHTABLE) {
        const m = manifests[skin]
        for (const clip of CLIPS) {
          const got = celCount(m, clip)
          checked++
          if (got < PARITY[clip]) {
            shortfall.push(`${variant}/${skin} '${clip}': ${got} cels < parity ${PARITY[clip]}`)
          }
        }
      }
    }
    expect(FIGHTABLE.length, 'fightable roster went empty — parity gate is vacuous').toBeGreaterThanOrEqual(6)
    expect(CLIPS.length, 'locomotion clip set went empty — parity gate is vacuous').toBeGreaterThanOrEqual(9)
    expect(checked, `expected ${VARIANTS.length * FIGHTABLE.length * CLIPS.length} checks, ran ${checked}`).toBe(
      VARIANTS.length * FIGHTABLE.length * CLIPS.length,
    )
    expect(shortfall, `fighters below locomotion parity (Stage-2 commission unfinished):\n${shortfall.join('\n')}`).toEqual([])
  })
})

// ── In-between density: the MECHANISM behind the cel counts ───────────────────
// Cel count alone cannot distinguish the two ways to reach a number, and only
// one of them fixes the defect. A clip can gain four cels by adding four
// in-between TWEENS (smooth) or by adding four more held key poses (still pops).
// The census that found this gap showed madhavan's deficit is specifically an
// absence of in-betweens, not merely a smaller number:
//
//   lenny  idle       idle-1 tw-i1-i2 idle-2 tw-i2-i4 idle-4 tw-i4-i3a …   6 tweens
//   turley idle       idle-1 tw-i1-i2 idle-2 idle-3 tw-i3-i1a tw-i3-i1b    3 tweens
//   madhavan idle     idle-1 idle-2 idle-3 idle-2                          0 tweens
//
// madhavan runs the SAME loop tempo as the leaders (48 frames vs 49) at 40% the
// density, by holding each pose 12 frames (200ms at FPS 60) instead of 8 with
// six in-betweens. On the walks it holds 9 frames where the other five hold 5.
// That "same duration, fewer frames, longer holds" signature is exactly what a
// harsh critic graded 2.5/5 "reads DEAD" — so it is worth measuring directly
// rather than inferring from frames.length.
//
// Two instruments, both pinned as characterizations like TODAY above:
//   tweenCount — how many `tw-*` in-betweens the clip interleaves.
//   maxHold    — the longest single-cel dwell, in sim frames. Catches
//                pose-holding INDEPENDENT of cel count, which no other gate does.
const CONTINUOUS = ['idle', 'walk-fwd', 'walk-back'] as const

function tweenCount(manifest: unknown, clip: string): number {
  const a = manifest as FighterAssets
  const c = a.clips?.[clip]
  if (!c) return -1
  return c.frames.filter((i) => a.frames[i]?.name.startsWith('tw-')).length
}

function maxHold(manifest: unknown, clip: string): number {
  const a = manifest as FighterAssets
  const c = a.clips?.[clip]
  if (!c || c.durations.length === 0) return -1
  return Math.max(...c.durations)
}

const TWEENS_TODAY: Record<string, Record<string, number>> = {
  chesky: { idle: 6, 'walk-fwd': 4, 'walk-back': 4 },
  spiegel: { idle: 6, 'walk-fwd': 4, 'walk-back': 4 },
  doshi: { idle: 6, 'walk-fwd': 4, 'walk-back': 4 },
  lenny: { idle: 6, 'walk-fwd': 4, 'walk-back': 4 },
  turley: { idle: 3, 'walk-fwd': 4, 'walk-back': 4 },
  // Zero in-betweens anywhere continuously visible — the defect, stated exactly.
  madhavan: { idle: 0, 'walk-fwd': 0, 'walk-back': 0 },
}

const MAX_HOLD_TODAY: Record<string, Record<string, number>> = {
  chesky: { idle: 8, 'walk-fwd': 5, 'walk-back': 5 },
  spiegel: { idle: 8, 'walk-fwd': 5, 'walk-back': 5 },
  doshi: { idle: 8, 'walk-fwd': 5, 'walk-back': 5 },
  lenny: { idle: 8, 'walk-fwd': 5, 'walk-back': 5 },
  turley: { idle: 8, 'walk-fwd': 5, 'walk-back': 5 },
  // 12 frames = 200ms on one idle pose; 9 = 150ms on one walk pose.
  madhavan: { idle: 12, 'walk-fwd': 9, 'walk-back': 9 },
}

describe('in-between density — tweens and dwell are pinned (both variants)', () => {
  for (const [variant, manifests] of VARIANTS) {
    it(`${variant}: tween counts and max dwell match the characterization`, () => {
      let checked = 0
      const drift: string[] = []
      for (const skin of FIGHTABLE) {
        const m = manifests[skin]
        expect(m, `${variant} manifest for ${skin} was not imported by this gate`).toBeDefined()
        expect(TWEENS_TODAY[skin], `${skin} is pickable but has no pinned tween counts — add it`).toBeDefined()
        expect(MAX_HOLD_TODAY[skin], `${skin} is pickable but has no pinned dwell — add it`).toBeDefined()
        for (const clip of CONTINUOUS) {
          const tw = tweenCount(m, clip)
          const hold = maxHold(m, clip)
          checked += 2
          if (tw !== TWEENS_TODAY[skin][clip]) {
            drift.push(`${variant}/${skin} '${clip}': ${tw} tweens, pinned ${TWEENS_TODAY[skin][clip]}`)
          }
          if (hold !== MAX_HOLD_TODAY[skin][clip]) {
            drift.push(`${variant}/${skin} '${clip}': maxHold ${hold}f, pinned ${MAX_HOLD_TODAY[skin][clip]}f`)
          }
        }
      }
      // Same dual-dimension flooring as the cel-count matrix: an emptied CONTINUOUS
      // would make `checked === FIGHTABLE.length * CONTINUOUS.length * 2` degenerate
      // to 0 === 0 and pass.
      expect(FIGHTABLE.length, 'fightable roster went empty — density gate is vacuous').toBeGreaterThanOrEqual(6)
      expect(CONTINUOUS.length, 'continuous clip set went empty — density gate is vacuous').toBeGreaterThanOrEqual(3)
      expect(checked, `expected ${FIGHTABLE.length * CONTINUOUS.length * 2} density checks, ran ${checked}`).toBe(
        FIGHTABLE.length * CONTINUOUS.length * 2,
      )
      expect(
        drift,
        `in-between density drifted from the pin — update TWEENS_TODAY/MAX_HOLD_TODAY in the SAME commit that changed the art:\n${drift.join('\n')}`,
      ).toEqual([])
    })
  }
})

// ── Stage-2 density target (SKIPPED until the art lands) ──────────────────────
// Floors are again what the roster already demonstrates, not a wish:
//   walks  4 tweens / dwell <= 5f — five of six ship exactly this, identically.
//   idle   3 tweens / dwell <= 8f — turley's number, the conservative floor.
// madhavan fails all six cells of this target today; every other fighter passes
// it already, so un-skipping is gated purely on madhavan's art landing.
const TWEEN_PARITY: Record<string, number> = { idle: 3, 'walk-fwd': 4, 'walk-back': 4 }
const HOLD_CEILING: Record<string, number> = { idle: 8, 'walk-fwd': 5, 'walk-back': 5 }

describe('in-between density — Stage-2 target', () => {
  it.skip('TODO(stage-2): every fightable fighter interleaves tweens and holds no pose too long', () => {
    let checked = 0
    const shortfall: string[] = []
    for (const [variant, manifests] of VARIANTS) {
      for (const skin of FIGHTABLE) {
        const m = manifests[skin]
        for (const clip of CONTINUOUS) {
          checked += 2
          const tw = tweenCount(m, clip)
          const hold = maxHold(m, clip)
          if (tw < TWEEN_PARITY[clip]) {
            shortfall.push(`${variant}/${skin} '${clip}': ${tw} tweens < floor ${TWEEN_PARITY[clip]}`)
          }
          if (hold > HOLD_CEILING[clip]) {
            shortfall.push(`${variant}/${skin} '${clip}': dwell ${hold}f > ceiling ${HOLD_CEILING[clip]}f`)
          }
        }
      }
    }
    expect(FIGHTABLE.length, 'fightable roster went empty — density target is vacuous').toBeGreaterThanOrEqual(6)
    expect(CONTINUOUS.length, 'continuous clip set went empty — density target is vacuous').toBeGreaterThanOrEqual(3)
    expect(checked, `expected ${VARIANTS.length * FIGHTABLE.length * CONTINUOUS.length * 2} checks, ran ${checked}`).toBe(
      VARIANTS.length * FIGHTABLE.length * CONTINUOUS.length * 2,
    )
    expect(shortfall, `fighters below in-between density (Stage-2 commission unfinished):\n${shortfall.join('\n')}`).toEqual([])
  })
})
