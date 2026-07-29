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
 *   • SLOW / Save-Data link: the director re-rolls to the pool's lightest
 *     pairing, so a reported-slow visitor waits ~20–32 s at slow-4G instead of
 *     ~57 s — the best a size-homogeneous heavy roster allows.
 *
 * HONESTY: every "second" here is MODELED — real on-disk bytes ÷ a cited
 * lab-throttling rate (Lighthouse slow-4G 1.6 Mbps, WebPageTest 4G 9 Mbps,
 * conservative cable 24 Mbps). It is a download model with no decode/RTT/TCP-ramp
 * term, NOT a live network measurement, and is named as such throughout.
 *
 * ANTI-VACUITY (this project has a documented history of gates that pass by
 * checking nothing): real bytes are read from disk for every choosable skin; the
 * SLOW budget is proven to admit ≥1 and exclude ≥1 REAL opener; the director is
 * driven on BOTH connection classes and proven to serve heavy art on fast and
 * only light art on slow; and the shipped budget constants are asserted so the
 * gate cannot drift from the policy it guards.
 *
 * MUTATION-PROVEN (see the task report for red/green transcripts): loosening the
 * SLOW target reddens the slow-4G bound; re-introducing a finite FAST byte cap
 * reddens the "heavy art can headline" assertion AND the new per-fighter coverage
 * guard (the ratchet returning, now caught per fighter — the exact "an atlas grew"
 * commit that used to re-roll silently); dropping the SLOW budget below the
 * lightest pairing reddens the admit-≥1 guard.
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

/** Every real, reel-eligible opener: distinct skins of DISTINCT archetypes (the
 *  director never shows a moveset mirror), priced from the bytes on disk. */
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

  it('the SLOW budget admits the light openers and excludes the heavy ones (real bytes)', () => {
    const pairs = realOpenerPairs()
    // C(6,2)=15 minus 3 archetype mirrors = 12 real openers; guard the count so a
    // roster/archetype change that empties this set cannot pass the gate blind.
    expect(pairs.length).toBeGreaterThanOrEqual(10)

    const admitted = pairs.filter((p) => p.bytes <= SLOW_FIRST_BOUT_BUDGET_BYTES)
    const excluded = pairs.filter((p) => p.bytes > SLOW_FIRST_BOUT_BUDGET_BYTES)

    // If nothing is admitted, a slow visitor's re-roll finds no light pairing and
    // falls through (after MAX_ATTEMPTS) to a heavy opener — the slow path is dead.
    expect(
      admitted.length,
      'SLOW budget admits no real opener — slow visitors fall through to heavy art',
    ).toBeGreaterThan(0)
    // If nothing is excluded, the budget constrains nothing and is vacuous.
    expect(
      excluded.length,
      'SLOW budget excludes no real opener — it is not constraining the first load',
    ).toBeGreaterThan(0)

    // Every admitted opener really does meet the slow-4G target it was sized for.
    for (const p of admitted) {
      const s = modeledFirstFrameSeconds(p.bytes, SLOW_4G_BYTES_PER_SEC)
      expect(s, `${p.a}+${p.b} admitted on slow but modeled ${s.toFixed(1)}s`).toBeLessThanOrEqual(
        SLOW_FIRST_BOUT_TARGET_SEC,
      )
    }
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
      let heavyHeadliners = 0
      let maxBytes = 0
      for (let s = 1; s <= SEEDS; s++) {
        const dir = new AttractDirector({ seed: s })
        const { a, b } = dir.matchup
        const bytes = realAtlasBytes(a.skin) + realAtlasBytes(b.skin)
        const cableSec = modeledFirstFrameSeconds(bytes, CABLE_BYTES_PER_SEC)
        expect(cableSec, `seed ${s} opener ${a.skin}+${b.skin} modeled ${cableSec.toFixed(2)}s on cable`).toBeLessThanOrEqual(
          CABLE_MAX_SEC,
        )
        if (bytes > HEAVY_OPENER_BYTES) heavyHeadliners++
        maxBytes = Math.max(maxBytes, bytes)
        dir.dispose()
        tested++
      }
      expect(tested).toBe(SEEDS) // vacuity: openers were really priced
      // The fix's whole point: heavy (best) art is no longer excluded from the
      // shop window. If this hits zero, a byte ceiling has ratcheted back in.
      expect(
        heavyHeadliners,
        'no heavy pairing ever headlined across 150 seeds — the opener byte ceiling is back',
      ).toBeGreaterThan(0)
      // Even the no-API fallback on a real fast-4G mobile link stays bounded.
      expect(modeledFirstFrameSeconds(maxBytes, FAST_4G_BYTES_PER_SEC)).toBeLessThanOrEqual(FAST_4G_MAX_SEC)
    },
    30_000,
  )

  it(
    'SLOW / Save-Data: a reported-slow visitor is served a light opener within the slow-4G target',
    () => {
      vi.stubGlobal('navigator', { connection: { effectiveType: '2g' } })
      let tested = 0
      let maxBytes = 0
      for (let s = 1; s <= SEEDS; s++) {
        const dir = new AttractDirector({ seed: s })
        const { a, b } = dir.matchup
        const bytes = realAtlasBytes(a.skin) + realAtlasBytes(b.skin)
        // The director actually re-rolled to an admitted (light) pairing — proof
        // the pure policy is CONSUMED by the shipped picker, not merely present.
        expect(bytes, `seed ${s} slow opener ${a.skin}+${b.skin} exceeded the SLOW budget`).toBeLessThanOrEqual(
          SLOW_FIRST_BOUT_BUDGET_BYTES,
        )
        const slowSec = modeledFirstFrameSeconds(bytes, SLOW_4G_BYTES_PER_SEC)
        expect(slowSec, `seed ${s} slow opener modeled ${slowSec.toFixed(1)}s`).toBeLessThanOrEqual(SLOW_HARD_MAX_SEC)
        maxBytes = Math.max(maxBytes, bytes)
        dir.dispose()
        tested++
      }
      expect(tested).toBe(SEEDS)
      // Vacuity: the slow path is genuinely lighter than the worst fast opener.
      expect(maxBytes).toBeLessThan(HEAVY_OPENER_BYTES)
    },
    30_000,
  )
})

describe('first-bout opener — every fighter keeps full shop-window coverage on the primary path', () => {
  /** Distinct-archetype partners a skin CAN open against — the director never
   *  shows a moveset mirror, so a skin's maximum coverage is the number of skins
   *  of a different archetype (2 skins/archetype ⇒ 4 today). This is the exact
   *  obligation the primary-path budget must honor for that skin. */
  function distinctArchetypePartners(skin: string): number {
    const arche = ROSTER.find((r) => r.skin === skin)!.archetype
    return ROSTER.filter((r) => r.skin !== skin && r.archetype !== arche).length
  }

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
