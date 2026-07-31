import { ATLAS_COST_BYTES, HERO_ATLAS_COST_BYTES } from './atlasCosts.generated'
/**
 * Attract-reel load-order policy — an ASSET concern, deliberately kept OUT of
 * the pure sim `AttractDirector`.
 *
 * The reel loads two fighter atlases per bout and frees them (with the WebGL
 * context) before the next, so peak VRAM is one bout. But download is serial and
 * the FIRST bout is the one a buyer waits on before the shop-window fight
 * appears. That "a buyer waits on it" is ROUTE-TRACED, not inferred from an
 * import edge (an import edge proves a surface CAN be reached, never that it IS):
 * a bare `/` resolves through `decideRoute` (appRoute.ts) to 'frontdoor' → the
 * `FrontDoor` shell mounts this reel after its title beat, and the opener-variant
 * line in AttractMode (`segment === 0 ? firstBoutAtlasVariant()`) is UNCONDITIONAL
 * — it runs on that shipped front-door mount, not only the `?attract=1` capture
 * route — so the opener this module prices is the first live gameplay a cold
 * visitor on the default URL actually downloads. `asset-delivery` measured the
 * choosable roster's atlases spanning ~0.66–5.75 MB each, so a purely random first
 * pairing can serve the ~11.5 MB worst case (spiegel + lenny) on a cold first visit.
 *
 * This bounds only the FIRST bout's combined download; bouts 2+ stay fully
 * random so every fighter still headlines. The bound is CONNECTION-AWARE and
 * expressed in buyer-facing seconds, not a fixed byte ceiling (see the long note
 * on the budgets below): a fast/unknown link loads the opener uncapped so our
 * best art headlines, and only a link the browser reports as slow is served the
 * lightest pairing. That replaced a fixed 10 MB ceiling whose fixed point, as
 * the art run grew atlases, was a reel opening on our WEAKEST art precisely
 * because we improved the strong ones.
 *
 * WHY THESE NUMBERS CAN'T QUIETLY LIE: they are no longer hand-maintained. The
 * costs are BAKED from the real files on disk into a committed generated module
 * (`./atlasCosts.generated.ts`, produced by scripts/genAtlasCosts.ts and kept
 * fresh at dev/build by scripts/atlasCostsPlugin.ts), so the byte the director
 * prices an opener with IS the byte on disk — the same one `firstBoutBudget` and
 * `atlasByteBudget` gate. There is no literal to drift from the shipped art, and
 * `atlasCostBake.node.test.ts` reddens if the committed bake ever goes stale.
 */

const MB = 1024 * 1024

/**
 * Per-skin atlas download cost in bytes, BAKED from the real files on disk into a
 * committed generated module (scripts/genAtlasCosts.ts → ./atlasCosts.generated.ts,
 * kept fresh at dev/build by scripts/atlasCostsPlugin.ts). Unlike the old
 * hand-copied literals it replaced, the committed values cannot SILENTLY drift from
 * the shipped art: atlasCostBake.node.test.ts reddens the moment they diverge from
 * disk. Keys are skin ids; a skin absent here (e.g. its atlas file is missing) is
 * treated as heavy by {@link firstBoutCostBytes} and so excluded from the cold
 * first bout rather than gambled onto it.
 */
export { ATLAS_COST_BYTES }

/**
 * Per-skin REDUCED "hero" opener-atlas cost in bytes, baked from the real
 * `atlas.hero.webp` files on disk alongside {@link ATLAS_COST_BYTES}. On a
 * reported-slow link the opener is served AND priced from these, so improving a
 * fighter's FULL art can no longer cost it an opener pairing. A skin absent here
 * has no hero variant and is treated as heavy by {@link firstBoutHeroCostBytes}.
 */
export { HERO_ATLAS_COST_BYTES }

/** A skin with no known cost is assumed heavier than any real atlas, so it is
 *  excluded from a cost-capped first bout rather than optimistically allowed on. */
const UNKNOWN_COST_BYTES = 12 * MB

/** Combined FULL-atlas download for a pairing — what bouts 2+ (and a fast-link
 *  opener) actually stream. Kept as the honest full-art figure that
 *  atlasByteBudget/atlasCostBake gate; the slow-link opener is priced on
 *  {@link firstBoutHeroCostBytes} instead. */
export function firstBoutCostBytes(skinA: string, skinB: string): number {
  return (ATLAS_COST_BYTES[skinA] ?? UNKNOWN_COST_BYTES) + (ATLAS_COST_BYTES[skinB] ?? UNKNOWN_COST_BYTES)
}

/** Combined HERO-atlas download for a pairing — what a reported-slow link's
 *  opener actually streams. Decoupled from {@link firstBoutCostBytes}: growing a
 *  fighter's full atlas does not change this until the hero is regenerated, and
 *  even then only at ~scale² of the full growth. */
export function firstBoutHeroCostBytes(skinA: string, skinB: string): number {
  return (HERO_ATLAS_COST_BYTES[skinA] ?? UNKNOWN_COST_BYTES) + (HERO_ATLAS_COST_BYTES[skinB] ?? UNKNOWN_COST_BYTES)
}

/**
 * FIRST-BOUT DOWNLOAD, RE-DERIVED FROM A FIXED BYTE CEILING INTO BUYER-FACING
 * SECONDS ON THE VIEWER'S ACTUAL CONNECTION.
 *
 * The opener used to be capped by a fixed 10 MB byte ceiling. That ceiling was a
 * RATCHET: every time the art run made a fighter's atlas better (heavier), its
 * pairings crossed the line and were dropped from the shop window — so improving
 * our best art DEMOTED it, the fixed point being a reel that opens on our
 * *lightest*, least-detailed fighters *because* we improved the heavy ones. A
 * gate that reddens on every legitimate art commit is a gate someone deletes.
 *
 * The constraint is really TIME-to-first-attract-frame, and it is dominated by
 * the connection, not by ±1 MB of atlas. Numbers below are MODELED — bytes ÷ a
 *  throttle rate (two cited third-party lab presets plus one in-house broadband
 *  anchor), NOT a live network measurement:
 *
 *   • Broadband (our 24 Mbps anchor, not a lab preset): the heaviest ~11.5 MB
 *     pairing loads in <4 s, so a byte cap buys nothing there and only withholds
 *     our best art.
 *   • Lighthouse slow-4G (1.6 Mbps): EVERY opener is slow — the choosable roster
 *     is size-homogeneous (5 of 6 atlases are 3.4–5.8 MB), spanning ~20 s
 *     (lightest pairing) to ~57 s (heaviest). 10.0 vs 10.9 MB is ~4 s on an
 *     already-failed ~50 s: the old ceiling was precision on a lost outcome.
 *
 * So the opener now adapts to the connection the browser REPORTS: FAST/unknown
 * links load it uncapped (best art headlines); only a link reported slow (or
 * Save-Data) is served the pool's lightest pairing. That INVERTS the ratchet —
 * better art reaches everyone who can load it, and improving an atlas no longer
 * costs a pairing. The `firstBoutBudget` gate asserts the modeled seconds, so it
 * reddens on time (a real slow-down), never on an atlas simply getting better.
 */

// MODELED throughput used only to turn bytes into reproducible SECONDS (decimal
// Mbps ÷ 8 = bytes/sec). Provenance is per-line and deliberately NOT lumped: two
// are named third-party lab presets (cited inline so the seconds reproduce against
// a public number); the third is our own anchor and is marked as such. A rate that
// grounds nothing external must not travel dressed as a "standard preset".
export const SLOW_4G_BYTES_PER_SEC = 1_600_000 / 8 //   200_000 — 🟢 Lighthouse `mobileSlow4G` 1.6 Mbps/150ms, which Lighthouse's report labels "Slow 4G" (GoogleChrome/lighthouse docs/throttling.md)
export const FAST_4G_BYTES_PER_SEC = 9_000_000 / 8 // 1_125_000 — 🟢 WebPageTest "4G" preset, 9 Mbps/170ms (WPO-Foundation/webpagetest connectivity.ini.sample)
export const CABLE_BYTES_PER_SEC = 24_000_000 / 8 //  3_000_000 — 🔴 OUR conservative desktop anchor, NOT a preset (closest WPT profiles: Cable 5 Mbps, FIOS 20). Sets only a loose broadband sanity bound.

/** MODELED seconds to fetch `bytes` at a named-profile throughput. A download
 *  model only — no decode, RTT or TCP-ramp term — and NOT a live measurement.
 *  Named for exactly what it computes (cf. the VRAM lesson: a proxy must be
 *  labelled a proxy, never dressed as a measurement). */
export function modeledFirstFrameSeconds(bytes: number, bytesPerSec: number): number {
  return bytes / bytesPerSec
}

/** FAST / unknown-connection budget: effectively uncapped. `Infinity` ⇒
 *  {@link isAllowedFirstBout} is always true ⇒ the director never re-rolls the
 *  opener for cost, so the heaviest (best) art can headline. There is
 *  deliberately no byte cap here to ratchet against; the `firstBoutBudget` gate
 *  guards absurd growth in *time* at a fast reference rate instead. */
export const FAST_FIRST_BOUT_BUDGET_BYTES = Number.POSITIVE_INFINITY

/**
 * SLOW / Save-Data budget, in buyer-facing SECONDS. ~33 s at Lighthouse slow-4G
 * (≈200 KB/s) is OUR OWN chosen ceiling — not an external norm — set generously
 * above the heaviest hero pairing (~2.78 MB ≈ 14 s) so it reddens on a real
 * slow-down, never on art getting heavier. The bytes it is measured against are
 * the HERO variant's, not the full atlas's — see the decoupling note below.
 *
 * DECOUPLING COST FROM ART — the structural fix, symmetric with `Infinity` on
 * FAST. On a slow link the opener DOWNLOADS a reduced hero atlas (half-res,
 * scripts/lib/heroAtlas.ts) and {@link isAllowedFirstBout} PRICES it on the hero
 * cost ({@link firstBoutHeroCostBytes}). Because the hero bytes are ~a quarter of
 * the full atlas's and decoupled from it, EVERY non-mirror roster pairing now
 * fits the 33 s ceiling — the heaviest, spiegel+lenny, is ~2.78 MB ≈ 14 s — so
 * the opener is drawn from the WHOLE pool: every fighter opens with all four of
 * its non-twin partners (spiegel included, which the old full-priced budget
 * excluded entirely), and none is over-represented — each appears in exactly 4 of
 * the 12 admitted pairs. That kills the ratchet by which improving a fighter's
 * full art shrank its opener chances: full art can now grow freely because the
 * opener no longer prices the full atlas at all.
 *
 * HONEST BOUND — what "decoupled" does and does not mean. Admission reads the hero
 * cost, so growing a fighter's FULL atlas leaves opener admission bit-for-bit
 * unchanged (gated structurally: a fixture grows a full atlas and the opener cost
 * is asserted invariant). It is NOT frozen forever: when combat-feel adds cels and
 * the hero is REGENERATED, the hero grows at ~scale² ≈ ¼ of the full growth, and
 * at the achieved sizes (pairs ~0.98–2.78 MB against the ~6.6 MB / 33 s budget)
 * there is ≥3.8 MB of headroom per pair — enough to absorb ~15 MB of full-atlas
 * growth before the lightest slow ceiling is even approached. TRUE zero-erosion
 * would need the hero to be a FRAME SUBSET (idle/establishing poses only), a
 * larger change named for later rather than pretended-done here.
 *
 * Bouts 2+ always stream FULL art ({@link firstBoutAtlasVariant} → 'full'), so a
 * slow visitor still meets every fighter's best art within COVERAGE_BOUND bouts
 * (gated in attractDirector.node.test.ts); the hero is a bout-1-only, slow-link
 * only cold-start tier. The bout-1(hero)→bout-2(full) upgrade seam is the one
 * thing needing visual sign-off — queued for the capture manifest, not asserted
 * here.
 */
export const SLOW_FIRST_BOUT_TARGET_SEC = 33
export const SLOW_FIRST_BOUT_BUDGET_BYTES = Math.round(SLOW_FIRST_BOUT_TARGET_SEC * SLOW_4G_BYTES_PER_SEC)

interface NetworkInformationLike {
  readonly effectiveType?: string
  readonly saveData?: boolean
}

/**
 * The first-bout download budget for the CURRENT viewer, read once from
 * `navigator.connection`. The absent-API path is the PRIMARY one, not a
 * degenerate fallback: `navigator.connection` is Chromium-only (Safari and
 * Firefox never expose it) and node/SSR has no `navigator` at all, so the common
 * case returns the FAST budget by design — most desktop visitors evaluating the
 * game are on broadband, and a byte cap would only cost them our best art. A
 * viewer is served the light pairing ONLY when the browser actively reports a
 * slow link (`effectiveType` 2g/3g/slow-2g) or Save-Data is enabled. Read via
 * `globalThis` so no DOM lib or ambient `navigator` global is required in the
 * node-typed test program.
 */
export function firstBoutBudgetBytes(): number {
  const conn = (globalThis as { navigator?: { connection?: NetworkInformationLike } }).navigator?.connection
  if (!conn) return FAST_FIRST_BOUT_BUDGET_BYTES
  if (conn.saveData === true) return SLOW_FIRST_BOUT_BUDGET_BYTES
  const et = conn.effectiveType
  if (et === 'slow-2g' || et === '2g' || et === '3g') return SLOW_FIRST_BOUT_BUDGET_BYTES
  return FAST_FIRST_BOUT_BUDGET_BYTES
}

/**
 * Which atlas variant the OPENER (bout 1) should download for the current viewer.
 * A finite (reported-slow / Save-Data) budget serves the reduced hero atlas so
 * cold-start cost is decoupled from full-art quality; a fast/unknown link — the
 * common desktop case — serves full art. Bouts 2+ are always 'full' (the caller
 * upgrades after the opener), so the hero is a bout-1-only, slow-link-only tier.
 */
export function firstBoutAtlasVariant(budgetBytes: number = firstBoutBudgetBytes()): 'full' | 'hero' {
  return budgetBytes === FAST_FIRST_BOUT_BUDGET_BYTES ? 'full' : 'hero'
}

/** May this pairing open the reel? True when the download it will ACTUALLY serve
 *  is within the budget for the viewer's connection class. The opener is priced on
 *  the variant it downloads: a finite (slow) budget serves — and so prices — the
 *  HERO atlas, which decouples admission from full-atlas growth; an infinite
 *  (fast) budget serves full art but admits everything anyway. `budgetBytes` is
 *  injectable so the gate can price each named profile deterministically. */
export function isAllowedFirstBout(
  skinA: string,
  skinB: string,
  budgetBytes: number = firstBoutBudgetBytes(),
): boolean {
  const cost = firstBoutAtlasVariant(budgetBytes) === 'hero'
    ? firstBoutHeroCostBytes(skinA, skinB)
    : firstBoutCostBytes(skinA, skinB)
  return cost <= budgetBytes
}
