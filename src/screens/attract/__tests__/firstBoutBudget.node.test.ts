/**
 * FIRST-BOUT DOWNLOAD gate — the buyer-facing constraint, in SECONDS.
 *
 * The opener is the load a cold visitor waits on before the shop-window fight
 * appears. It used to be capped by a fixed 10 MB byte ceiling, which was a
 * RATCHET: as the art run made a fighter's atlas better (heavier), its pairings
 * crossed the line and were dropped from the opener — so improving our best art
 * demoted it, converging on a reel that opens on our WEAKEST fighters. A gate
 * that reddens on every legitimate art commit gets deleted by someone in a hurry.
 *
 * This gate reprices the constraint as TIME on the viewer's actual connection
 * (see attractLoadCost). It asserts, per named connection profile, the modeled
 * seconds-to-first-attract-frame of the opener the shipped {@link AttractDirector}
 * ACTUALLY serves at that connection class — so it reddens when the wait gets
 * slower, and NOT when an atlas simply gets better:
 *
 *   • FAST / unknown link (broadband desktop, and every Safari/Firefox visitor —
 *     `navigator.connection` is Chromium-only): the opener is uncapped, so our
 *     heaviest (best) art can headline. The heaviest ~11.5 MB pairing is <4 s on
 *     cable and ~10 s on fast-4G; the gate guards only against absurd growth.
 *   • SLOW / Save-Data link: the opener DOWNLOADS the reduced hero atlas and is
 *     priced on it (see attractLoadCost), which decouples cold-start cost from
 *     full-art quality. Every real pairing now fits the ~33 s slow-4G target, so
 *     every fighter opens with all its partners and none dominates — the
 *     size-bimodal inversion (madhavan in 100% of openers, spiegel in 0%) is gone.
 *
 * HONESTY: every "second" here is MODELED — real on-disk bytes ÷ a throttle rate.
 * Two of the three rates are cited third-party lab presets (🟢 Lighthouse "Slow 4G"
 * 1.6 Mbps; 🟢 WebPageTest "4G" 9 Mbps); the cable rate (🔴 24 Mbps) is OUR OWN
 * conservative desktop anchor, not a preset, and sets only a loose sanity bound. It
 * is a download model with no decode/RTT/TCP-ramp term, NOT a live network
 * measurement, and is named as such throughout. FAST assertions read the FULL bytes
 * on disk (what a fast link serves); SLOW assertions read the HERO bytes on disk.
 *
 * ANTI-VACUITY (this project has a documented history of gates that pass by
 * checking nothing): real bytes are read from disk for every choosable skin; the
 * SLOW section proves every hero pairing is MATERIALLY lighter than its full
 * pairing (so "priced on hero" is not a no-op) and that every fighter opens with
 * all partners on slow, and applies OUR authored coverage envelope (a ≥25% per-
 * fighter opener floor + a ≤50% concentration ceiling, justified at the constant)
 * checked per fighter and BY NAME over the whole roster, with self-checks proving
 * each half fires independently;
 * the director is driven on BOTH connection classes and proven to serve heavy art
 * on fast and rotate the whole pool on slow; and the shipped budget constants are
 * asserted so the gate cannot drift from the policy it guards.
 *
 * MUTATION-PROVEN (see the task report for red/green transcripts): loosening the
 * SLOW target reddens the slow-4G bound; re-introducing a finite FAST byte cap
 * reddens the "heavy art can headline" assertion AND the per-fighter FAST coverage
 * guard; repricing the SLOW opener back onto the FULL atlas (or a hero==full
 * miswire) collapses SLOW coverage and reddens the per-fighter opener FLOOR by
 * name (spiegel → 0%), the exact inversion the hero tier removes; and a synthetic
 * one-fighter-dominant distribution reddens the CONCENTRATION CEILING by name with
 * the floor still green (self-checks), so neither half is a one-directional no-op.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AttractDirector } from '../attractDirector'
import {
  firstBoutBudgetBytes,
  modeledFirstFrameSeconds,
  SLOW_4G_BYTES_PER_SEC,
  FAST_4G_BYTES_PER_SEC,
  CABLE_BYTES_PER_SEC,
  SLOW_FIRST_BOUT_BUDGET_BYTES,
  SLOW_FIRST_BOUT_TARGET_SEC,
  FAST_FIRST_BOUT_BUDGET_BYTES,
} from '../attractLoadCost'
import { ROSTER } from '../../../fighthud/select/roster'

const HERE = dirname(fileURLToPath(import.meta.url))
// __tests__ → attract → screens → src → repo root, then /public.
const PUBLIC_DIR = resolve(HERE, '../../../../public')

/** Real on-disk atlas size for a skin, resolved through its manifest exactly as
 *  the shipping atlas gate does. 0 when the file is missing. */
function realAtlasBytes(skin: string): number {
  const manifestPath = resolve(PUBLIC_DIR, 'fighters', skin, 'assets.json')
  if (!existsSync(manifestPath)) return 0
  const atlasField =
    (JSON.parse(readFileSync(manifestPath, 'utf-8')) as { atlas?: string }).atlas ??
    `/fighters/${skin}/atlas.webp`
  const diskPath = resolve(PUBLIC_DIR, atlasField.replace(/^\/+/, ''))
  return existsSync(diskPath) ? statSync(diskPath).size : 0
}

/** Real on-disk REDUCED hero-atlas size for a skin — the download a reported-slow
 *  opener actually serves — resolved through `assets.hero.json` exactly as the
 *  loader/bake do. 0 when the fighter ships no hero variant. */
function realHeroAtlasBytes(skin: string): number {
  const manifestPath = resolve(PUBLIC_DIR, 'fighters', skin, 'assets.hero.json')
  if (!existsSync(manifestPath)) return 0
  const atlasField =
    (JSON.parse(readFileSync(manifestPath, 'utf-8')) as { atlas?: string }).atlas ??
    `/fighters/${skin}/atlas.hero.webp`
  const diskPath = resolve(PUBLIC_DIR, atlasField.replace(/^\/+/, ''))
  return existsSync(diskPath) ? statSync(diskPath).size : 0
}

/** Every real, reel-eligible opener: distinct skins of DISTINCT archetypes (the
 *  director never shows a moveset mirror), priced from the FULL bytes on disk —
 *  what a FAST link serves. */
function realOpenerPairs(): { a: string; b: string; bytes: number }[] {
  const pairs: { a: string; b: string; bytes: number }[] = []
  for (let i = 0; i < ROSTER.length; i++) {
    for (let j = i + 1; j < ROSTER.length; j++) {
      if (ROSTER[i].archetype === ROSTER[j].archetype) continue
      pairs.push({
        a: ROSTER[i].skin,
        b: ROSTER[j].skin,
        bytes: realAtlasBytes(ROSTER[i].skin) + realAtlasBytes(ROSTER[j].skin),
      })
    }
  }
  return pairs
}

/** The same eligible openers priced from the HERO bytes on disk — what a
 *  reported-SLOW link actually serves and what the director prices admission on. */
function realHeroOpenerPairs(): { a: string; b: string; bytes: number }[] {
  const pairs: { a: string; b: string; bytes: number }[] = []
  for (let i = 0; i < ROSTER.length; i++) {
    for (let j = i + 1; j < ROSTER.length; j++) {
      if (ROSTER[i].archetype === ROSTER[j].archetype) continue
      pairs.push({
        a: ROSTER[i].skin,
        b: ROSTER[j].skin,
        bytes: realHeroAtlasBytes(ROSTER[i].skin) + realHeroAtlasBytes(ROSTER[j].skin),
      })
    }
  }
  return pairs
}

/** Distinct-archetype partners a skin CAN open against — the director never shows
 *  a moveset mirror, so a skin's maximum opener coverage is the number of skins of
 *  a different archetype (2 skins/archetype ⇒ 4 today). */
function distinctArchetypePartners(skin: string): number {
  const arche = ROSTER.find((r) => r.skin === skin)!.archetype
  return ROSTER.filter((r) => r.skin !== skin && r.archetype !== arche).length
}

/** Per-fighter coverage-envelope violations over a distribution of opener
 *  appearances (skin → number of reels it opened in), against a floor and ceiling
 *  on each fighter's SHARE of `totalReels`. Returns a human-named entry for every
 *  violation. Iterates the FULL ROSTER — a fighter absent from `appearances`
 *  scores 0 — so a shrunken or empty admitted pool reds by NAMING the starved
 *  fighters instead of passing because the survivors happen to be balanced. Floor
 *  and ceiling are SEPARATE entries, so each half is independently load-bearing:
 *  starving a fighter reds the floor; concentrating on one reds the ceiling. */
function coverageViolations(
  appearances: Record<string, number>,
  totalReels: number,
  floor: number,
  ceil: number,
): string[] {
  const out: string[] = []
  for (const r of ROSTER) {
    const frac = (appearances[r.skin] ?? 0) / totalReels
    const pct = (frac * 100).toFixed(0)
    if (frac < floor) out.push(`${r.skin} opens in ${pct}% of reels — below the ${(floor * 100).toFixed(0)}% coverage floor`)
    if (frac > ceil) out.push(`${r.skin} opens in ${pct}% of reels — above the ${(ceil * 100).toFixed(0)}% concentration ceiling`)
  }
  return out
}

// AUTHORED COVERAGE ENVELOPE for the opener distribution. These are OUR
// thresholds, pre-registered to catch a re-concentration regression — NOT a
// figure from any published source or genre convention. Justification: the
// admitted opener set is structurally uniform — every fighter opens against ALL
// its distinct-archetype partners, so with 2 skins/archetype each sits in 4 of
// the 12 admitted pairs = 33.3% of reels (measured min across the shipped fixed-
// seed run is 31.3%, max 37.3%). The ≥25% FLOOR sits below that with real
// headroom AND equals the least-covered fighter's share if the roster grows to 7
// skins (a 3rd in one archetype ⇒ 4 of 16 non-mirror pairs), so legitimate roster
// growth does not red it while a ~20%-relative coverage loss does. The ≤50%
// CEILING is the anti-domination bound: the broken bimodal state put one fighter
// in 100% of openers; 50% reddens that while the achieved 37.3% clears it. Both
// are strict (exactly-25%/exactly-50% pass) and checked per fighter BY NAME.
const OPENER_COVERAGE_FLOOR_FRAC = 0.25
const OPENER_CONCENTRATION_CEIL_FRAC = 0.5

// A pairing heavier than this only exists among the detailed atlases, so seeing
// one open the reel proves our best art is not excluded (the ratchet is broken).
const HEAVY_OPENER_BYTES = 9_000_000

// Per-profile time bounds the buyer actually experiences. Each sits above the
// achieved modeled figure with headroom, so the gate reddens on a real slow-down
// (or a loosened policy), never on an atlas simply getting better:
//   cable   heaviest opener ~3.8 s  → bound 6 s  (reds only past ~18 MB)
//   fast-4G heaviest opener ~10.2 s → bound 14 s (reds only past ~15.7 MB)
//   slow-4G heaviest ADMITTED ~32 s → bound 35 s (reds if the SLOW cap loosens)
const CABLE_MAX_SEC = 6
const FAST_4G_MAX_SEC = 14
const SLOW_HARD_MAX_SEC = 35
const SEEDS = 150

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('first-bout download — real bytes & non-triviality (vacuity)', () => {
  it('has a real atlas on disk for every choosable skin', () => {
    let counted = 0
    for (const r of ROSTER) {
      expect(realAtlasBytes(r.skin), `missing atlas for ${r.skin}`).toBeGreaterThan(0)
      counted++
    }
    // Vacuity: the whole choosable roster was priced, not an empty set.
    expect(counted).toBe(ROSTER.length)
    expect(ROSTER.length).toBeGreaterThan(4)
  })

  it('the SLOW opener is priced on the reduced HERO atlas, so every real pairing now fits the slow-4G target (decoupling)', () => {
    const heroPairs = realHeroOpenerPairs()
    const fullPairs = realOpenerPairs()
    // C(6,2)=15 minus 3 archetype mirrors = 12 real openers; guard the count so a
    // roster/archetype change that empties this set cannot pass the gate blind.
    expect(heroPairs.length).toBeGreaterThanOrEqual(10)
    expect(heroPairs.length).toBe(fullPairs.length)

    // THE DECOUPLING WIN. Under the old FULL pricing the roster was byte-bimodal,
    // so only the four madhavan pairs fit and spiegel never opened. Pricing the
    // opener on the HERO atlas makes EVERY real pairing fit the 33 s slow-4G
    // target — nothing is excluded, which is the point: cost no longer tracks art.
    // PROVENANCE: what carries this is the MARGIN, not the exact bytes. Admission
    // is priced on the HERO atlases (read from disk here); the heaviest hero pair
    // is ~2.65 MiB against the 6.6 MB budget, so no plausible working-tree state of
    // the FULL atlases — which are irrelevant to slow admission and may be mid-
    // rebake for any fighter — can close that gap. The full bytes only set the FAST
    // headroom bounds, never who is admitted on slow.
    const overBudget = heroPairs.filter((p) => p.bytes > SLOW_FIRST_BOUT_BUDGET_BYTES)
    expect(
      overBudget.length,
      `hero-priced openers over the slow budget: ${overBudget
        .map((p) => `${p.a}+${p.b} ${(p.bytes / 1e6).toFixed(2)}MB`)
        .join(', ')}`,
    ).toBe(0)
    for (const p of heroPairs) {
      const s = modeledFirstFrameSeconds(p.bytes, SLOW_4G_BYTES_PER_SEC)
      expect(s, `${p.a}+${p.b} hero opener modeled ${s.toFixed(1)}s`).toBeLessThanOrEqual(
        SLOW_FIRST_BOUT_TARGET_SEC,
      )
    }

    // VACUITY against a hero==full miswire (the exact bug the structural decoupling
    // gate guards): every hero pairing must be MATERIALLY lighter than the same
    // FULL pairing, or "priced on hero" is a no-op that decoupled nothing and the
    // "everything fits" result above is an accident of a loose budget, not the tier.
    const fullByKey = new Map(fullPairs.map((p) => [`${p.a}+${p.b}`, p.bytes]))
    for (const p of heroPairs) {
      const full = fullByKey.get(`${p.a}+${p.b}`)!
      expect(p.bytes, `${p.a}+${p.b} hero (${p.bytes}) not materially lighter than full (${full})`).toBeLessThan(
        full * 0.6,
      )
    }
  })

  it('every fighter opens on SLOW with ALL its partners and none dominates — the shop-window consequence, now reachable', () => {
    // THE PROPERTY THE OLD FULL-PRICED BUDGET COULD NOT REACH. Because the roster
    // was byte-bimodal, the slow opener admitted ONLY madhavan pairs: madhavan was
    // the cold-start face in 100% of openers and spiegel in 0%. The previous gate
    // could only assert a runway FLOOR (≥2 admitted) and explicitly conceded that
    // per-fighter coverage was "unreachable under a fast-cold-start budget". Hero
    // pricing decouples cost from art, so the whole pool is affordable and this
    // asserts the consequence DIRECTLY — a per-fighter coverage FLOOR and a
    // concentration CEILING. Today they read 4/4 partners and 33%; a regression to
    // full pricing (or a hero==full miswire) collapses coverage toward one fighter
    // and drives concentration to 100%, reddening this immediately.
    const pairs = realHeroOpenerPairs()
    expect(pairs.length).toBeGreaterThanOrEqual(10) // vacuity: real openers exist
    const admitted = pairs.filter((p) => p.bytes <= SLOW_FIRST_BOUT_BUDGET_BYTES)
    expect(admitted.length, 'no hero opener fits the slow budget — the tier is mis-sized').toBeGreaterThan(0)

    const appearances: Record<string, number> = {}
    const partnersOf: Record<string, Set<string>> = {}
    for (const r of ROSTER) {
      appearances[r.skin] = 0
      partnersOf[r.skin] = new Set()
    }
    for (const p of admitted) {
      appearances[p.a]++
      appearances[p.b]++
      partnersOf[p.a].add(p.b)
      partnersOf[p.b].add(p.a)
    }

    // COVERAGE FLOOR: every fighter opens on slow with ALL its distinct-archetype
    // partners (≥1 is the reviewer's floor; today it is the full 4/4).
    let checked = 0
    for (const r of ROSTER) {
      const obligation = distinctArchetypePartners(r.skin)
      expect(obligation, `${r.skin} has no distinct-archetype partner — roster shape broke`).toBeGreaterThan(0)
      expect(
        partnersOf[r.skin].size,
        `${r.skin} opens on SLOW with only ${partnersOf[r.skin].size}/${obligation} partners — the slow ` +
          `opener has re-concentrated off this fighter (a full-priced or hero==full regression).`,
      ).toBe(obligation)
      checked++
    }
    expect(checked).toBe(ROSTER.length) // vacuity: every fighter really checked
    expect(ROSTER.length).toBeGreaterThan(4)

    // AUTHORED COVERAGE ENVELOPE on the admitted set (deterministic: the director
    // draws uniformly over `admitted`, so each fighter's share of reels is exactly
    // its admitted-pair count / |admitted|). Assert the ≥25% floor and ≤50% ceiling
    // per fighter and BY NAME, independently. Uniform coverage puts each at
    // 4/12 = 33%; the broken bimodal state put one fighter at 100% and starved the
    // rest — this reddens EITHER failure and says which fighter.
    expect(
      coverageViolations(appearances, admitted.length, OPENER_COVERAGE_FLOOR_FRAC, OPENER_CONCENTRATION_CEIL_FRAC),
      'SLOW admitted-set coverage envelope breached',
    ).toEqual([])
  })

  it('prices this gate against the SHIPPED budget constants (no drift)', () => {
    // Bind the gate to the real policy: if someone changes the budgets, these
    // reprice with them rather than the gate asserting a stale copy.
    expect(SLOW_4G_BYTES_PER_SEC).toBe(200_000)
    expect(FAST_4G_BYTES_PER_SEC).toBe(1_125_000)
    expect(CABLE_BYTES_PER_SEC).toBe(3_000_000)
    expect(SLOW_FIRST_BOUT_BUDGET_BYTES).toBe(Math.round(SLOW_FIRST_BOUT_TARGET_SEC * SLOW_4G_BYTES_PER_SEC))
    expect(FAST_FIRST_BOUT_BUDGET_BYTES).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('first-bout download — connection class → budget mapping', () => {
  const FAST = FAST_FIRST_BOUT_BUDGET_BYTES
  const SLOW = SLOW_FIRST_BOUT_BUDGET_BYTES
  const cases: [string, { effectiveType?: string; saveData?: boolean } | undefined, number][] = [
    ['no navigator (Safari / Firefox / SSR) → FAST — the primary path', undefined, FAST],
    ['effectiveType 4g → FAST', { effectiveType: '4g' }, FAST],
    ['unknown effectiveType → FAST', { effectiveType: 'wifi' }, FAST],
    ['effectiveType 3g → SLOW', { effectiveType: '3g' }, SLOW],
    ['effectiveType 2g → SLOW', { effectiveType: '2g' }, SLOW],
    ['effectiveType slow-2g → SLOW', { effectiveType: 'slow-2g' }, SLOW],
    ['Save-Data on an otherwise-fast link → SLOW', { effectiveType: '4g', saveData: true }, SLOW],
  ]
  for (const [name, conn, expected] of cases) {
    it(name, () => {
      vi.stubGlobal('navigator', conn === undefined ? undefined : { connection: conn })
      expect(firstBoutBudgetBytes()).toBe(expected)
    })
  }
})

describe('first-bout download — the shipped director honors the budget per connection', () => {
  it(
    'FAST / default: openers are quick on broadband AND our best (heavy) art can headline',
    () => {
      // node has no navigator → FAST budget → uncapped opener. This is the path a
      // broadband desktop visitor and every Safari/Firefox visitor actually get.
      let tested = 0
      let maxBytes = 0
      for (let s = 1; s <= SEEDS; s++) {
        const dir = new AttractDirector({ seed: s })
        const { a, b } = dir.matchup
        const bytes = realAtlasBytes(a.skin) + realAtlasBytes(b.skin)
        const cableSec = modeledFirstFrameSeconds(bytes, CABLE_BYTES_PER_SEC)
        expect(cableSec, `seed ${s} opener ${a.skin}+${b.skin} modeled ${cableSec.toFixed(2)}s on cable`).toBeLessThanOrEqual(
          CABLE_MAX_SEC,
        )
        maxBytes = Math.max(maxBytes, bytes)
        dir.dispose()
        tested++
      }
      expect(tested).toBe(SEEDS) // vacuity: openers were really priced
      // THE FIX'S WHOLE POINT: heavy (best) art is not excluded from the shop
      // window. This used to be phrased as "some pairing exceeded 9 MB", which was
      // a PROXY — an absolute byte count standing in for "our best art headlines".
      // Deleting 28 double-exposed in-between cels per fighter cut every atlas by
      // 35-41% (roster download ~32 MB -> ~19.9 MB) and the art got BETTER, yet the
      // old form reddened and its message blamed a byte ceiling that had not moved.
      // A proxy that reddens when the art improves is the defect this file exists
      // to catch, one level up. So assert the property directly and invariantly:
      // the single heaviest pairing that EXISTS is one the director actually opens
      // on. That cannot be satisfied by art getting cheaper, and it still reds the
      // instant a cap re-excludes the top of the range.
      const heaviestPossible = Math.max(...realOpenerPairs().map((p) => p.bytes))
      expect(heaviestPossible, 'no real opener pairings were priced').toBeGreaterThan(0)
      expect(
        maxBytes,
        `the heaviest pairing (${heaviestPossible} B) never headlined across ${SEEDS} seeds — ` +
          'a byte ceiling is excluding our best art from the opener',
      ).toBe(heaviestPossible)
      // Even the no-API fallback on a real fast-4G mobile link stays bounded.
      expect(modeledFirstFrameSeconds(maxBytes, FAST_4G_BYTES_PER_SEC)).toBeLessThanOrEqual(FAST_4G_MAX_SEC)
    },
    30_000,
  )

  it(
    'SLOW / Save-Data: the shipped director serves a HERO-priced opener within target, rotating the WHOLE pool',
    () => {
      vi.stubGlobal('navigator', { connection: { effectiveType: '2g' } })
      let tested = 0
      let maxHeroBytes = 0
      const appearances: Record<string, number> = {}
      for (const r of ROSTER) appearances[r.skin] = 0
      for (let s = 1; s <= SEEDS; s++) {
        const dir = new AttractDirector({ seed: s })
        const { a, b } = dir.matchup
        // On a slow link the opener DOWNLOADS the hero variant, so price the
        // served bytes on hero — proof the hero policy is CONSUMED by the shipped
        // picker, not merely present. (Full pricing here would wrongly reject the
        // heavy pairings the director now legitimately opens on slow.)
        const heroBytes = realHeroAtlasBytes(a.skin) + realHeroAtlasBytes(b.skin)
        expect(
          heroBytes,
          `seed ${s} slow opener ${a.skin}+${b.skin} hero download exceeded the SLOW budget`,
        ).toBeLessThanOrEqual(SLOW_FIRST_BOUT_BUDGET_BYTES)
        const slowSec = modeledFirstFrameSeconds(heroBytes, SLOW_4G_BYTES_PER_SEC)
        expect(slowSec, `seed ${s} slow opener modeled ${slowSec.toFixed(1)}s`).toBeLessThanOrEqual(SLOW_HARD_MAX_SEC)
        maxHeroBytes = Math.max(maxHeroBytes, heroBytes)
        appearances[a.skin]++
        appearances[b.skin]++
        dir.dispose()
        tested++
      }
      expect(tested).toBe(SEEDS)
      // THE INVERSION IS RESOLVED IN PRACTICE, not just in the static admitted set:
      // across the shipped seed run every fighter opens on slow — including spiegel,
      // which the old full-priced budget excluded entirely — and none dominates.
      // Seeds are FIXED (1..SEEDS), so this distribution is deterministic, not a
      // sampled estimate: measured spread is min 31.3% / max 37.3%, clearing the
      // authored 25%/50% envelope with headroom. This upgrades the old `>0` liveness
      // check to a real per-fighter coverage FLOOR and an independent concentration
      // CEILING, each reddening BY NAME (see coverageViolations + its self-checks).
      const totalAppearances = ROSTER.reduce((n, r) => n + appearances[r.skin], 0)
      expect(totalAppearances, 'opener tally is empty — the seed loop counted nothing').toBe(2 * SEEDS)
      expect(
        coverageViolations(appearances, SEEDS, OPENER_COVERAGE_FLOOR_FRAC, OPENER_CONCENTRATION_CEIL_FRAC),
        `SLOW director coverage envelope breached across ${SEEDS} seeds`,
      ).toEqual([])
      // Vacuity: the slow path genuinely serves the reduced tier, not full atlases.
      expect(maxHeroBytes).toBeLessThan(HEAVY_OPENER_BYTES)
    },
    30_000,
  )
})

describe('first-bout opener — every fighter keeps full shop-window coverage on the primary path', () => {
  it('the FAST / default budget admits EVERY fighter with ALL its partners — the ratchet cannot return per-fighter', () => {
    // THE PROPERTY THE OLD FIXED CEILING SILENTLY BROKE. Under a fixed byte cap,
    // as the art run made a fighter's atlas heavier its pairings crossed the line
    // and it appeared in fewer openers — until our BEST art headlined LEAST. The
    // existing FAST test proves SOME heavy pair headlines (aggregate); this proves
    // the per-fighter obligation that the uncapped primary-path budget creates:
    // on the connection class almost every buyer is on, NO fighter is demoted from
    // the shop window, however heavy its atlas becomes. It reddens the instant a
    // finite FAST cap re-enters and excludes ANY fighter's pairing — i.e. the exact
    // commit ("chesky's atlas grew") that used to pass silently while re-rolling.
    const budget = FAST_FIRST_BOUT_BUDGET_BYTES
    const pairs = realOpenerPairs()
    expect(pairs.length).toBeGreaterThanOrEqual(10) // vacuity: real openers exist

    const partnersOf: Record<string, Set<string>> = {}
    for (const r of ROSTER) partnersOf[r.skin] = new Set()
    for (const p of pairs) {
      if (p.bytes <= budget) {
        partnersOf[p.a].add(p.b)
        partnersOf[p.b].add(p.a)
      }
    }

    let checked = 0
    for (const r of ROSTER) {
      const obligation = distinctArchetypePartners(r.skin)
      expect(obligation, `${r.skin} has no distinct-archetype partner — roster/archetype shape broke`).toBeGreaterThan(0)
      expect(
        partnersOf[r.skin].size,
        `${r.skin} can open with only ${partnersOf[r.skin].size}/${obligation} partners on the PRIMARY path — ` +
          `a finite FAST byte cap has demoted a fighter from the shop window (its atlas got heavier and dropped ` +
          `pairings). That is the ratchet the seconds-based budget exists to prevent.`,
      ).toBe(obligation)
      checked++
    }
    // Vacuity: every roster fighter was actually checked, not an empty set.
    expect(checked).toBe(ROSTER.length)
    expect(ROSTER.length).toBeGreaterThan(4)
  })
})

describe('first-bout opener — the coverage-envelope check is itself non-vacuous (self-checks)', () => {
  // coverageViolations is the load-bearing assertion behind BOTH the structural and
  // the director-driven coverage gates above. These self-checks prove it actually
  // fires — in both directions, independently, and by name — rather than being a
  // green no-op. Each feeds a synthetic distribution over the real ROSTER; totalReels
  // is chosen so shares are exact. (Shares sum to 2.0 because every reel shows two
  // fighters, which is why one fighter can exceed 50% while all others clear 25%.)
  const FLOOR = OPENER_COVERAGE_FLOOR_FRAC
  const CEIL = OPENER_CONCENTRATION_CEIL_FRAC
  const skins = ROSTER.map((r) => r.skin)

  it('passes a healthy uniform distribution (no false positive)', () => {
    // 12 reels, each fighter in 4 ⇒ 33% each: inside [25%, 50%].
    const d = Object.fromEntries(skins.map((s) => [s, 4]))
    expect(coverageViolations(d, 12, FLOOR, CEIL)).toEqual([])
  })

  it('FLOOR fires by name on starved fighters while the ceiling stays green', () => {
    // The reviewer's "admitted set shrank to two balanced pairings" case: four
    // fighters at exactly 50%, two dropped to 0%. The survivors sit AT the ceiling
    // (not over), so a ceiling-only gate would PASS this — the floor must catch the
    // two absent fighters.
    const d: Record<string, number> = {}
    for (const s of skins) d[s] = 0
    for (let i = 0; i < 4; i++) d[skins[i]] = 50 // 50% each — at the ceiling, not over
    const starved = skins.slice(4)
    const v = coverageViolations(d, 100, FLOOR, CEIL)
    expect(v.length).toBe(starved.length)
    for (const s of starved) {
      expect(v.some((m) => m.startsWith(`${s} `) && m.includes('coverage floor'))).toBe(true)
    }
    expect(v.some((m) => m.includes('concentration ceiling'))).toBe(false) // ceiling independent & green
  })

  it('CEILING fires by name on a concentrated fighter while the floor stays green', () => {
    // The independent-load-bearing case: one fighter over 50%, everyone else still
    // above 25% (60 + 5×28 = 200 = 2×100). A floor-only gate would PASS this — the
    // ceiling must catch the dominator.
    const [hot, ...rest] = skins
    const d: Record<string, number> = { [hot]: 60 }
    for (const s of rest) d[s] = 28
    const v = coverageViolations(d, 100, FLOOR, CEIL)
    expect(v.length).toBe(1)
    expect(v[0].startsWith(`${hot} `) && v[0].includes('concentration ceiling')).toBe(true)
    expect(v.some((m) => m.includes('coverage floor'))).toBe(false) // floor independent & green
  })

  it('names EVERY violator, never collapsing to the first (both clauses can fire at once)', () => {
    // A total collapse onto one fighter reds the ceiling for it AND the floor for the
    // other five — proof the check enumerates the whole roster, not just the first miss.
    const [hot, ...rest] = skins
    const d: Record<string, number> = { [hot]: 100 }
    for (const s of rest) d[s] = 0
    const v = coverageViolations(d, 100, FLOOR, CEIL)
    expect(v.some((m) => m.startsWith(`${hot} `) && m.includes('ceiling'))).toBe(true)
    for (const s of rest) expect(v.some((m) => m.startsWith(`${s} `) && m.includes('floor'))).toBe(true)
    expect(v.length).toBe(rest.length + 1)
  })
})
