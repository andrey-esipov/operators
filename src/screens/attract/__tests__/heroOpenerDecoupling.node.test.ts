/**
 * STRUCTURAL INVARIANT: the opener's modeled cost must not rise when a fighter's
 * FULL atlas grows. This is the property that makes the incentive permanently
 * correct — `combat-feel` can author bespoke supers forever and the slow-path
 * opener budget can never be the thing that rejects the better art, because the
 * opener is priced on the REDUCED hero variant, not the full one.
 *
 * On FAST the cap is already Infinity, so growth is free there. This gate protects
 * the SLOW path, where a finite seconds-derived budget used to make an atlas's
 * improvement cost it an opener pairing (the "shop-window inversion"). It proves
 * decoupling two independent ways:
 *
 *  1. POLICY (in-memory, deterministic): the shipped `isAllowedFirstBout` admits a
 *     pairing on the SLOW budget whenever its HERO sum fits — even when its FULL
 *     sum is over budget. If admission were still priced on the full atlas, those
 *     pairings would be rejected. So the admission decision reads hero bytes.
 *
 *  2. BAKE SEAM (real files, fixture): the readers the bake is built from are a
 *     pure function of the hero files. Growing a fixture's FULL atlas raises
 *     `readAtlasCosts` but leaves `readHeroAtlasCosts` — and therefore the baked
 *     opener price — byte-for-byte unchanged.
 *
 * MUTATION-PROVEN (see task report for red/green transcripts):
 *   • repricing `isAllowedFirstBout` back onto the full atlas reds the POLICY half
 *     (the discriminating pairings flip to rejected);
 *   • pointing `readHeroAtlasCosts` at `assets.json` (the full manifest) reds the
 *     BAKE-SEAM half (hero costs then move when the full atlas grows).
 *
 * NOT a VRAM claim: hero is a smaller DOWNLOAD; it decodes to fewer texels too,
 * but the resident VRAM budget is enforced separately (atlasVramBudget) and this
 * gate asserts nothing about it.
 */

import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isAllowedFirstBout,
  firstBoutCostBytes,
  firstBoutHeroCostBytes,
  SLOW_FIRST_BOUT_BUDGET_BYTES,
  FAST_FIRST_BOUT_BUDGET_BYTES,
} from '../attractLoadCost'
import { ROSTER } from '../../../fighthud/select/roster'
import { readAtlasCosts, readHeroAtlasCosts } from '../../../../scripts/atlasCosts.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Every real, reel-eligible opener: distinct skins of distinct archetypes (the
 *  director never opens on a moveset mirror). */
function eligiblePairs(): { a: string; b: string }[] {
  const pairs: { a: string; b: string }[] = []
  for (let i = 0; i < ROSTER.length; i++) {
    for (let j = i + 1; j < ROSTER.length; j++) {
      if (ROSTER[i].archetype === ROSTER[j].archetype) continue
      pairs.push({ a: ROSTER[i].skin, b: ROSTER[j].skin })
    }
  }
  return pairs
}

describe('hero opener decoupling — POLICY: slow admission is priced on the hero atlas', () => {
  it('admits every pairing whose HERO sum fits SLOW — including ones whose FULL sum does NOT', () => {
    const pairs = eligiblePairs()
    expect(pairs.length).toBeGreaterThanOrEqual(10) // vacuity: real openers exist

    // The discriminating set: pairings that a hero-priced budget admits but a
    // full-priced budget would REJECT. If this set is empty the test proves
    // nothing (hero and full would agree), so assert it is non-empty first.
    const heroFits = pairs.filter(
      (p) => firstBoutHeroCostBytes(p.a, p.b) <= SLOW_FIRST_BOUT_BUDGET_BYTES,
    )
    const discriminating = heroFits.filter(
      (p) => firstBoutCostBytes(p.a, p.b) > SLOW_FIRST_BOUT_BUDGET_BYTES,
    )
    expect(
      discriminating.length,
      'no pairing is admitted-by-hero-yet-over-budget-by-full — the hero price is not ' +
        'observably different from the full price, so this gate would be vacuous',
    ).toBeGreaterThan(0)

    // Every such pairing must be ADMITTED on the slow budget. Priced on full they
    // would each be rejected (their full sum is over budget by construction), so
    // this reddens the instant admission is repriced back onto the full atlas.
    for (const p of discriminating) {
      expect(
        isAllowedFirstBout(p.a, p.b, SLOW_FIRST_BOUT_BUDGET_BYTES),
        `${p.a}+${p.b}: hero ${firstBoutHeroCostBytes(p.a, p.b)} ≤ ${SLOW_FIRST_BOUT_BUDGET_BYTES} ` +
          `yet not admitted on slow — admission is being priced on the FULL atlas ` +
          `(${firstBoutCostBytes(p.a, p.b)}), re-coupling the opener to art quality`,
      ).toBe(true)
    }

    // And the admitted-on-slow set is EXACTLY the hero-fits set — admission tracks
    // hero, nothing else.
    const admitted = pairs.filter((p) => isAllowedFirstBout(p.a, p.b, SLOW_FIRST_BOUT_BUDGET_BYTES))
    expect(admitted.map((p) => `${p.a}+${p.b}`).sort()).toEqual(
      heroFits.map((p) => `${p.a}+${p.b}`).sort(),
    )

    // Sanity: the FAST/uncapped budget still admits everything (unchanged path).
    for (const p of pairs) {
      expect(isAllowedFirstBout(p.a, p.b, FAST_FIRST_BOUT_BUDGET_BYTES)).toBe(true)
    }
  })
})

describe('hero opener decoupling — BAKE SEAM: growing a FULL atlas cannot move the opener price', () => {
  it('readHeroAtlasCosts is invariant under full-atlas growth while readAtlasCosts rises', () => {
    // Build a self-contained fixture roster of plain byte blobs — the readers only
    // stat file sizes, so the bytes need no real image data. Layout mirrors
    // public/: <root>/fighters/<id>/{assets.json,atlas.webp,assets.hero.json,
    // atlas.hero.webp}, and we pass <root>/fighters as the readers' fightersDir.
    const root = mkdtempSync(resolve(HERE, '.herofix-'))
    try {
      const fightersDir = resolve(root, 'fighters')
      const ids = ['alpha', 'bravo', 'charlie', 'delta', 'echo'] // > 4 → vacuity
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]
        const dir = resolve(fightersDir, id)
        mkdirSync(dir, { recursive: true })
        const fullBytes = 200_000 + i * 10_000
        const heroBytes = 40_000 + i * 2_000 // < fullBytes * 0.6 for every i
        writeFileSync(resolve(dir, 'atlas.webp'), Buffer.alloc(fullBytes))
        writeFileSync(resolve(dir, 'atlas.hero.webp'), Buffer.alloc(heroBytes))
        writeFileSync(resolve(dir, 'assets.json'), JSON.stringify({ atlas: `/fighters/${id}/atlas.webp` }))
        writeFileSync(
          resolve(dir, 'assets.hero.json'),
          JSON.stringify({ atlas: `/fighters/${id}/atlas.hero.webp` }),
        )
      }

      const full0 = readAtlasCosts(fightersDir)
      const hero0 = readHeroAtlasCosts(fightersDir)

      // Vacuity: the fixture really produced a > 4-fighter roster, and every hero
      // blob is materially smaller than its full blob (so this models the real
      // reduction, not a degenerate hero==full case).
      expect(Object.keys(hero0).length).toBe(ids.length)
      expect(Object.keys(hero0).length).toBeGreaterThan(4)
      for (const id of ids) {
        expect(hero0[id]).toBeLessThan(full0[id] * 0.6)
      }

      // GROW one fighter's FULL atlas — exactly what `combat-feel` adding a bespoke
      // super does — leaving its hero atlas untouched.
      const grown = 'charlie'
      const grownDir = resolve(fightersDir, grown)
      const before = statSync(resolve(grownDir, 'atlas.webp')).size
      writeFileSync(resolve(grownDir, 'atlas.webp'), Buffer.alloc(before + 5_000_000))

      const full1 = readAtlasCosts(fightersDir)
      const hero1 = readHeroAtlasCosts(fightersDir)

      // The mutation is LIVE: the full cost of the grown fighter really rose.
      expect(full1[grown], 'the full atlas did not actually grow — mutation is dead').toBeGreaterThan(full0[grown])
      expect(full1).not.toEqual(full0)

      // THE INVARIANT: the hero cost map — the source of the opener price — is
      // byte-for-byte unchanged. Improving full art moved the opener price by zero.
      expect(hero1, 'a FULL-atlas grow changed the HERO cost map — opener cost is still coupled to art').toEqual(hero0)

      // Stated as the opener price itself: the hero-priced sum of any pairing
      // containing the grown fighter is identical before and after the grow.
      const partner = 'alpha'
      const openerBefore = hero0[grown] + hero0[partner]
      const openerAfter = hero1[grown] + hero1[partner]
      expect(openerAfter, 'the hero-priced opener cost rose when full art grew').toBe(openerBefore)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
