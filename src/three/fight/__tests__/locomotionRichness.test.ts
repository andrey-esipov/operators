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
//               lenny chesky spiegel doshi | turley | madhavan  (AT DISCOVERY)
//   idle          10    10     10     10   |    6   |    4    <- 0 tweens
//   walk-fwd       8     8      8      8   |    8   |    4    <- 0 tweens
//   walk-back      8     8      8      8   |    8   |    4    <- 0 tweens
//
// turley was 8/8 on both walks, so on the walk rows madhavan was alone and the
// other five shipped a byte-identical 8-cel structure — the uniformity
// discriminator at its strongest: five-of-six identical means the sixth is
// under-delivery, not a style choice.
//
// That deficit is now CLOSED (madhavan reads 6/8/8, matching turley on idle and
// the whole roster on the walks). The table is kept as the discovery record, and
// the numbers below are the live pins. See the density block for the mechanism
// and for why cel count alone would not have been a sufficient gate.
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
  chesky: { crouch: 2, block: 2, dash: 3, backdash: 3, 'jump-rise': 3, 'jump-fall': 3, 'walk-fwd': 4, 'walk-back': 4, idle: 10 },
  spiegel: { crouch: 2, block: 2, dash: 3, backdash: 3, 'jump-rise': 3, 'jump-fall': 3, 'walk-fwd': 4, 'walk-back': 4, idle: 10 },
  doshi: { crouch: 2, block: 2, dash: 3, backdash: 3, 'jump-rise': 3, 'jump-fall': 3, 'walk-fwd': 4, 'walk-back': 4, idle: 10 },
  lenny: { crouch: 2, block: 2, dash: 3, backdash: 3, 'jump-rise': 3, 'jump-fall': 3, 'walk-fwd': 4, 'walk-back': 4, idle: 10 },
  // Static single-cell DRIVEN locomotion — the Stage-2 deficit this file documents.
  // The three continuously-visible clips are now at parity for BOTH static
  // fighters: madhavan's 15 missing tweens were synthesised from key poses it
  // already shipped (see the density block below), bringing idle to turley's
  // shape and both walks to the roster's. What remains here is the driven six.
  madhavan: { crouch: 1, block: 1, dash: 1, backdash: 1, 'jump-rise': 2, 'jump-fall': 2, 'walk-fwd': 4, 'walk-back': 4, idle: 6 },
  // turley is FULLY AT PARITY and is no longer part of the Stage-2 deficit. It
  // cost no new art: `.sprite-gen/turley/raw` held 17 cels that had never been
  // shipped (crouch-2, block-absorb, dash-ready, backdash-ready, jump-rise-2,
  // jump-land, idle-4 …), so regenerating `--offline` resolved the richer clips
  // from cels already paid for. Zero clips lost, zero gained. Its driven six now
  // read 4/3/3/3/3/3 — identical to doshi, its own warden partner, which is the
  // blind A/B this file's header names as the refutation of the "intentional
  // minimal style" defence. idle reached 10, the roster-leader number.
  turley: { crouch: 2, block: 2, dash: 3, backdash: 3, 'jump-rise': 3, 'jump-fall': 3, 'walk-fwd': 4, 'walk-back': 4, idle: 10 },
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
// aspiration — an unmet-by-everyone target would be a wish, not a gate.
//
// THIS TARGET IS COUNTED IN HAND-DRAWN CELS, NOT TOTAL CELS, AND THAT IS THE
// WHOLE POINT. It used to read `crouch 4, block 3, walk-fwd 8, walk-back 8`,
// justified as "all six ship exactly 8. Not arguable." Those numbers were
// 4 drawn + 4 synthesised, 2 + 2, and 2 + 1. Roughly half of what this gate
// held up as the standard was the double-exposure defect, so the commission it
// specified was literally "give madhavan more ghosted cels" — the target was
// payable in the bug. Once the in-betweens were stripped, every one of those
// numbers fell to what had actually been DRAWN, which is what they should have
// counted from the start.
//
// This is the same costume as the old tween-count floor two blocks down, in the
// aspirational target rather than the floor, and it survived the first pass
// because that pass fixed the floor and read this as merely stale. A gate and
// the goal it aims at can carry the same defect independently; fixing one does
// not fix the other.
//
// Counting drawings makes the target unsatisfiable by the generator: no morph,
// however good, can raise a drawn-cel count. Only an animator can.
//
// Every floor below is the number FIVE OF SIX fighters demonstrate today,
// measured, not reasoned about. Note dash/backdash: they ship 3 CELS but only
// 2 distinct drawings, because the cycle returns to its first pose. The old
// matrix pinned 3 there and called it "never tweened, unchanged" — true, but it
// was still counting a repeat as if it were a third drawing. Cel counts flatter
// on both axes: they count a synthesised cel and a repeated cel alike.
//
//   crouch / block / dash / backdash   2 each
//   jump-rise / jump-fall              3 each
//   walk-fwd / walk-back               4 each  — madhavan ALREADY meets these
//   idle                               4       — madhavan ships 3
//
// The commission this specifies is now exact and small: madhavan owes SEVEN
// drawings — one each on crouch, block, dash, backdash, jump-rise, jump-fall
// and idle. The previous framing, "+22 cels", overstated the ask by counting
// in-betweens a morph would have manufactured. Seven drawings is a day of work,
// not a commission, and it closes the roster's only remaining parity gap.
const PARITY: Record<string, number> = {
  crouch: 2,
  block: 2,
  dash: 2,
  backdash: 2,
  'jump-rise': 3,
  'jump-fall': 3,
  'walk-fwd': 4,
  'walk-back': 4,
  idle: 4,
}

describe('locomotion richness — Stage-2 parity target', () => {
  it.skip('TODO(stage-2): every fightable fighter meets the 4/3/3/3/3/3 parity shape in both variants', () => {
    let checked = 0
    const shortfall: string[] = []
    for (const [variant, manifests] of VARIANTS) {
      for (const skin of FIGHTABLE) {
        const m = manifests[skin]
        for (const clip of CLIPS) {
          // drawingCount, not celCount: the target is denominated in drawings
          // so that it cannot be satisfied by synthesising in-betweens.
          const got = drawingCount(m, clip)
          checked++
          if (got < PARITY[clip]) {
            shortfall.push(`${variant}/${skin} '${clip}': ${got} drawn cels < parity ${PARITY[clip]}`)
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
//                      ^ AT DISCOVERY. turley now ships 6 tweens / 10 cels,
//                        regenerated from its own cached raws (see TODAY).
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
  chesky: { idle: 6, 'walk-fwd': 0, 'walk-back': 0 },
  spiegel: { idle: 6, 'walk-fwd': 0, 'walk-back': 0 },
  doshi: { idle: 6, 'walk-fwd': 0, 'walk-back': 0 },
  lenny: { idle: 6, 'walk-fwd': 0, 'walk-back': 0 },
  turley: { idle: 6, 'walk-fwd': 0, 'walk-back': 0 },
  // Was { idle: 0, 'walk-fwd': 0, 'walk-back': 0 } — zero in-betweens anywhere
  // continuously visible. All 15 missing tweens were morphed from key poses
  // madhavan already shipped, so this reached parity with no new art.
  madhavan: { idle: 3, 'walk-fwd': 0, 'walk-back': 0 },
}

const MAX_HOLD_TODAY: Record<string, Record<string, number>> = {
  chesky: { idle: 8, 'walk-fwd': 8, 'walk-back': 8 },
  spiegel: { idle: 8, 'walk-fwd': 8, 'walk-back': 8 },
  doshi: { idle: 8, 'walk-fwd': 8, 'walk-back': 8 },
  lenny: { idle: 8, 'walk-fwd': 8, 'walk-back': 8 },
  turley: { idle: 8, 'walk-fwd': 8, 'walk-back': 8 },
  // Was { idle: 12, 'walk-fwd': 9, 'walk-back': 9 } — 200ms on one idle pose and
  // 150ms on one walk pose, the "same tempo, fewer frames, longer holds"
  // signature. Interleaving the tweens restored the roster's dwell exactly.
  madhavan: { idle: 8, 'walk-fwd': 8, 'walk-back': 8 },
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

// ── Stage-2 density target — LIVE, and RESTRUCTURED onto an ungameable axis ──
//
// 🔴 THIS GATE USED TO REWARD THE DEFECT IT EXISTS TO CATCH, and that is why it
// no longer floors tween COUNT. It previously required >= 4 in-betweens per walk
// and a dwell <= 5f. Both were satisfiable by synthesising in-betweens — and a
// pixel census then found that HALF the roster's synthesised cels were
// double-exposed: the optical-flow morph cross-dissolves ALPHA, so wherever the
// flow fails across a limb the alpha lands mid-range and the cel ships a
// 50%-translucent ghost limb. A blind critic scored the walk 3/10 and the juggle
// 1/10 ("total chimera — you cannot parse a single body").
//
// So a fighter with 8 walk cels, 4 of them melting, scored HIGHER here than one
// with 4 clean drawn keys. The count floor was not merely blind to the defect;
// it paid for it. Removing those tweens moved the walk 3 -> 6/10 and reddened
// this gate — a gate reddening on a visual improvement is a gate measuring the
// wrong thing.
//
// The two floors below are on quantities the morph CANNOT manufacture:
//   drawingFloor — distinct HAND-DRAWN cels. Synthesising in-betweens cannot
//                  raise it, so the only way to pass is to draw. "Fewer, better
//                  frames" is the premium 2D fighting aesthetic; players forgive
//                  low frame counts and never forgive a melting head.
//   dwell PARITY — the original defect was madhavan running the roster's tempo
//                  at 40% the density by holding each pose 12f where others held
//                  8. That is a UNIFORMITY failure, not an absolute one, and
//                  uniformity is exactly the line between a house style and a
//                  bug. Asserting parity catches the real case while permitting
//                  a deliberate roster-wide retime (like this one) to pass.
//
// ⚠️ idle's floor is 3, not 4, and the reason is a finding this axis surfaced the
// moment it replaced the tween count: madhavan's idle interleaves only THREE
// drawn poses (idle-1, idle-2, idle-3 — it never reaches idle-4, where the other
// five do), so its loop is idle-1 idle-2 idle-3 idle-2. The old tween floor could
// not see this, because madhavan passed it on 3 SYNTHESISED cels. One drawing is
// the entire gap. The floor is set at what all six actually meet so this gate
// stays a working guard rather than a permanently-red TODO; the per-fighter
// shortfall is already pinned by name in the TODAY matrix above (madhavan idle: 6
// against the roster's 10), which reds if it regresses AND reds if it is fixed
// without updating the pin.
const DRAWING_FLOOR: Record<string, number> = { idle: 3, 'walk-fwd': 4, 'walk-back': 4 }

/** Distinct hand-drawn (non-`tw-`) cels a clip interleaves. */
function drawingCount(manifest: unknown, clip: string): number {
  const a = manifest as FighterAssets
  const c = a.clips?.[clip]
  if (!c) return -1
  return new Set(c.frames.filter((i) => !a.frames[i]?.name.startsWith('tw-')).map((i) => a.frames[i]?.name)).size
}

describe('in-between density — Stage-2 target', () => {
  it('every fightable fighter interleaves tweens and holds no pose too long', () => {
    let checked = 0
    const shortfall: string[] = []
    // clip -> dwell -> which fighters ship it, so a parity break names both sides.
    const dwellsByClip: Record<string, Record<number, string[]>> = {}
    for (const [variant, manifests] of VARIANTS) {
      for (const skin of FIGHTABLE) {
        const m = manifests[skin]
        for (const clip of CONTINUOUS) {
          checked += 2
          const drawn = drawingCount(m, clip)
          const hold = maxHold(m, clip)
          if (drawn < DRAWING_FLOOR[clip]) {
            shortfall.push(`${variant}/${skin} '${clip}': ${drawn} drawn cels < floor ${DRAWING_FLOOR[clip]}`)
          }
          const key = `${variant}/${clip}`
          ;((dwellsByClip[key] ??= {})[hold] ??= []).push(skin)
        }
      }
    }
    // Dwell parity: within one clip, every fighter must hold for the same time.
    for (const [key, byDwell] of Object.entries(dwellsByClip)) {
      const groups = Object.entries(byDwell)
      if (groups.length > 1) {
        shortfall.push(
          `${key}: dwell is NOT uniform across the roster — ` +
            groups.map(([f, skins]) => `${f}f: ${skins.join(',')}`).join(' | '),
        )
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
