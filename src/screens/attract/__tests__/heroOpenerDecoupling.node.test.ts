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
 *  2. BAKE SEAM (real files, real fixture): the readers the bake is built from are
 *     a pure function of the hero files. We rebuild the real roster on disk at its
 *     committed sizes and reproduce `combat-feel`'s actual, uncommitted lenny
 *     rebake (5,755,142 B → 6,145,122 B, +390 KB). Under the OLD full-priced opener
 *     that grow evicts `lenny+madhavan` — lenny's only affordable slow partner —
 *     and lenny falls out of the slow shop window entirely (4 openers → 3). Under
 *     hero pricing the identical grow moves `readHeroAtlasCosts`, and the admitted
 *     slow-opener SET it implies, by exactly ZERO bytes and zero pairings.
 *
 * MUTATION-PROVEN (see task report for red/green transcripts):
 *   • repricing `isAllowedFirstBout` back onto the full atlas reds the POLICY half
 *     (the discriminating pairings flip to rejected);
 *   • pointing `readHeroAtlasCosts` at `assets.json` (the full manifest) reds the
 *     BAKE-SEAM half — the hero cost map, and the admitted-opener set, then move
 *     when lenny's full atlas grows.
 *
 * NOT a VRAM claim: hero is a smaller DOWNLOAD; it decodes to fewer texels too,
 * but the resident VRAM budget is enforced separately (atlasVramBudget) and this
 * gate asserts nothing about it.
 */

import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
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

/** The SLOW admitted-opener SET implied by a cost map: every non-mirror opener
 *  whose summed atlas cost fits the slow budget. This is exactly the set the
 *  director can open on when the connection is slow (archetype-mirror reject,
 *  then the seconds-derived budget gate). Priced on hero bytes it is invariant
 *  to full-atlas growth; priced on full bytes it shrinks as art improves. */
function admittedSlowOpeners(cost: Record<string, number>): string[] {
  return eligiblePairs()
    .filter((p) => (cost[p.a] ?? Infinity) + (cost[p.b] ?? Infinity) <= SLOW_FIRST_BOUT_BUDGET_BYTES)
    .map((p) => `${p.a}+${p.b}`)
    .sort()
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

describe("hero opener decoupling — BAKE SEAM: combat-feel's real lenny rebake must not move the slow opener", () => {
  // This fixture is NOT hypothetical. In the shared worktree `combat-feel` grew
  // `public/fighters/lenny/atlas.webp` from its committed 5,755,142 B to an
  // uncommitted 6,145,122 B (+389,980 B, +6.8%) while lenny's hero atlas stayed
  // put. We rebuild the WHOLE real roster on disk at its committed sizes and
  // reproduce exactly that grow, then assert the slow opener is unmoved.
  //
  // Committed sizes (bytes on disk at HEAD; the same values the freshness gate in
  // atlasCostBake pins). Hero < full for every fighter by construction.
  const COMMITTED_FULL: Record<string, number> = {
    chesky: 5_040_682, spiegel: 5_710_006, doshi: 4_935_818,
    lenny: 5_755_142, madhavan: 662_420, turley: 3_373_706,
  }
  const COMMITTED_HERO: Record<string, number> = {
    chesky: 1_209_068, spiegel: 1_454_122, doshi: 1_161_734,
    lenny: 1_326_452, madhavan: 131_630, turley: 900_768,
  }
  const LENNY_COMMITTED_FULL = 5_755_142
  const LENNY_REBAKED_FULL = 6_145_122 // combat-feel's uncommitted working-tree size

  // Build the real roster as plain byte blobs — the readers only stat file sizes,
  // so the bytes need no real image data. Layout mirrors public/:
  // <root>/fighters/<skin>/{assets.json,atlas.webp,assets.hero.json,atlas.hero.webp}.
  function buildRealRoster(): { root: string; fightersDir: string } {
    // `mkdtempSync` creates the temp dir up front, but everything after it can throw
    // — e.g. a ROSTER skin absent from COMMITTED_FULL makes Buffer.alloc(undefined)
    // throw. The caller's try/finally only owns cleanup once this RETURNS, so a throw
    // here would strand a multi-MB temp dir under src/ (untracked, un-ignored, and a
    // `git add` hazard that fires exactly when someone adds a fighter). Own the
    // failure-path cleanup here so a half-built roster can never leak.
    const root = mkdtempSync(resolve(HERE, '.herofix-'))
    try {
      const fightersDir = resolve(root, 'fighters')
      for (const { skin } of ROSTER) {
        const fullBytes = COMMITTED_FULL[skin]
        const heroBytes = COMMITTED_HERO[skin]
        if (fullBytes === undefined || heroBytes === undefined) {
          throw new Error(
            `heroOpenerDecoupling fixture: ROSTER skin '${skin}' has no committed ` +
              `${fullBytes === undefined ? 'COMMITTED_FULL' : 'COMMITTED_HERO'} size. ` +
              `Add it alongside the fighter so the fixture can model the real roster.`,
          )
        }
        const dir = resolve(fightersDir, skin)
        mkdirSync(dir, { recursive: true })
        writeFileSync(resolve(dir, 'atlas.webp'), Buffer.alloc(fullBytes))
        writeFileSync(resolve(dir, 'atlas.hero.webp'), Buffer.alloc(heroBytes))
        writeFileSync(resolve(dir, 'assets.json'), JSON.stringify({ atlas: `/fighters/${skin}/atlas.webp` }))
        writeFileSync(
          resolve(dir, 'assets.hero.json'),
          JSON.stringify({ atlas: `/fighters/${skin}/atlas.hero.webp` }),
        )
      }
      return { root, fightersDir }
    } catch (err) {
      rmSync(root, { recursive: true, force: true })
      throw err
    }
  }

  it('the HERO cost map and the admitted slow-opener SET are byte-identical before and after lenny grows', () => {
    const { root, fightersDir } = buildRealRoster()
    try {
      const full0 = readAtlasCosts(fightersDir)
      const hero0 = readHeroAtlasCosts(fightersDir)

      // Vacuity: the fixture really is the whole roster (> 4), reproduced the real
      // committed sizes, and hero is materially smaller than full for everyone.
      expect(Object.keys(hero0).sort()).toEqual(ROSTER.map((r) => r.skin).sort())
      expect(Object.keys(hero0).length).toBeGreaterThan(4)
      expect(full0.lenny, 'fixture did not reproduce lenny committed size').toBe(LENNY_COMMITTED_FULL)
      for (const { skin } of ROSTER) expect(hero0[skin]).toBeLessThan(full0[skin])

      const heroSet0 = admittedSlowOpeners(hero0)
      const fullSet0 = admittedSlowOpeners(full0)

      // GROW lenny's FULL atlas to combat-feel's real working-tree size, leaving
      // its hero atlas untouched — exactly the live rebake sitting on disk.
      writeFileSync(resolve(fightersDir, 'lenny', 'atlas.webp'), Buffer.alloc(LENNY_REBAKED_FULL))

      const full1 = readAtlasCosts(fightersDir)
      const hero1 = readHeroAtlasCosts(fightersDir)

      // The grow is LIVE: lenny's FULL cost really rose to the rebaked size.
      expect(full1.lenny, 'lenny full did not actually grow — fixture is dead').toBe(LENNY_REBAKED_FULL)
      expect(full1.lenny).toBeGreaterThan(full0.lenny)

      // ─────────────── THE INVARIANT (the property under gate) ───────────────
      // Same modelled opener price map: growing full art moved the hero map by 0 B.
      expect(hero1, 'a FULL-atlas grow moved the HERO cost map — opener still coupled to art').toEqual(hero0)
      // Same admitted opener SET: not just the same total, the same *pairings*.
      const heroSet1 = admittedSlowOpeners(hero1)
      expect(heroSet1, 'the hero-priced slow opener SET changed when lenny full grew').toEqual(heroSet0)
      expect(heroSet1).toContain('lenny+madhavan') // lenny really is in the slow window
      expect(heroSet1.length, 'all non-mirror pairs should open on slow under hero pricing').toBe(12)
      expect(heroSet1.filter((k) => k.includes('lenny')).length, 'lenny keeps all its non-mirror partners under hero').toBe(4)

      // ─────────── DISCRIMINATION (the fixture is a REAL crossing) ───────────
      // Priced on the FULL atlas, the identical grow DOES move the set and evicts
      // lenny — proving the invariant above is meaningful, not a fixture whose
      // grow never crosses the budget. This is the defect, reproduced.
      const fullSet1 = admittedSlowOpeners(full1)
      expect(fullSet0, 'full-priced set should have admitted lenny+madhavan before the grow').toContain('lenny+madhavan')
      expect(fullSet1, 'full-priced set should EVICT lenny+madhavan after the grow — else the fixture is not a crossing').not.toContain('lenny+madhavan')
      expect(fullSet1).not.toEqual(fullSet0)
      // Under full pricing lenny disappears from the slow window entirely: madhavan
      // was its ONLY affordable partner, so the shop window drops a whole face.
      expect(fullSet1.filter((k) => k.includes('lenny')), 'lenny should vanish from the full-priced slow window').toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
