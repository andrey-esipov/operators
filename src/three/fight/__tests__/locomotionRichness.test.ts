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

// The six locomotion clips a fighter DRIVES — the same set locomotionCoverage
// lists. Here we count their cels (frames.length) rather than assert existence.
const CLIPS = ['crouch', 'block', 'dash', 'backdash', 'jump-rise', 'jump-fall'] as const

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
  chesky: { crouch: 4, block: 3, dash: 3, backdash: 3, 'jump-rise': 3, 'jump-fall': 3 },
  spiegel: { crouch: 4, block: 3, dash: 3, backdash: 3, 'jump-rise': 3, 'jump-fall': 3 },
  doshi: { crouch: 4, block: 3, dash: 3, backdash: 3, 'jump-rise': 3, 'jump-fall': 3 },
  lenny: { crouch: 4, block: 3, dash: 3, backdash: 3, 'jump-rise': 3, 'jump-fall': 3 },
  // Static single-cell locomotion — the Stage-2 deficit this file documents.
  madhavan: { crouch: 1, block: 1, dash: 1, backdash: 1, 'jump-rise': 2, 'jump-fall': 1 },
  turley: { crouch: 1, block: 1, dash: 1, backdash: 1, 'jump-rise': 2, 'jump-fall': 2 },
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
      // FIGHTABLE(6) * CLIPS(6) = 36 cel-count checks per variant. Both DIMENSIONS
      // are floored with literals so the counter can't pass vacuously: if CLIPS
      // emptied, `checked === FIGHTABLE.length * CLIPS.length` degenerates to
      // 0 === 0 and would pass — the exact "checks nothing" trap this project has
      // 18+ documented instances of. Flooring FIGHTABLE and CLIPS independently
      // (the firstBoutBudget idiom: floor the outer set AND the inner enumeration)
      // makes an emptied dimension red instead.
      expect(FIGHTABLE.length, 'fightable roster went empty — richness gate is vacuous').toBeGreaterThanOrEqual(6)
      expect(CLIPS.length, 'locomotion clip set went empty — richness gate is vacuous').toBeGreaterThanOrEqual(6)
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
// The shape every animated fighter already ships: crouch 4, the rest 3. This is
// the acceptance test for asset-delivery's re-scoped +23-cel commission —
// turley +11 (crouch+3, block+2, dash+2, backdash+2, jump-rise+1, jump-fall+1)
// and madhavan +12 (…jump-fall+2) — bringing both static fighters to parity with
// their animated archetype partners. It is SKIPPED because it RED's today BY
// CONSTRUCTION (turley/madhavan sit below the shape). The commit that lands the
// art must (a) remove the .skip here and (b) update TODAY above, together.
const PARITY: Record<string, number> = {
  crouch: 4,
  block: 3,
  dash: 3,
  backdash: 3,
  'jump-rise': 3,
  'jump-fall': 3,
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
    expect(CLIPS.length, 'locomotion clip set went empty — parity gate is vacuous').toBeGreaterThanOrEqual(6)
    expect(checked, `expected ${VARIANTS.length * FIGHTABLE.length * CLIPS.length} checks, ran ${checked}`).toBe(
      VARIANTS.length * FIGHTABLE.length * CLIPS.length,
    )
    expect(shortfall, `fighters below locomotion parity (Stage-2 commission unfinished):\n${shortfall.join('\n')}`).toEqual([])
  })
})
