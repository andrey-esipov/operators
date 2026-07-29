/// <reference path="./virtualAtlasCosts.d.ts" />
import { ATLAS_COST_BYTES } from 'virtual:atlas-costs'
/**
 * Attract-reel load-order policy — an ASSET concern, deliberately kept OUT of
 * the pure sim `AttractDirector`.
 *
 * The reel loads two fighter atlases per bout and frees them (with the WebGL
 * context) before the next, so peak VRAM is one bout. But download is serial and
 * the FIRST bout is the one a buyer waits on before the shop-window fight
 * appears. `asset-delivery` measured the choosable roster's atlases spanning
 * ~0.66–5.75 MB each, so a purely random first pairing can serve the ~11.5 MB
 * worst case (spiegel + lenny) on a cold first visit.
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
 * costs are BAKED from the real files on disk at build time (see
 * `virtual:atlas-costs` / scripts/atlasCostsPlugin.ts), so the byte the director
 * prices an opener with IS the byte on disk — the same one `firstBoutBudget` and
 * `atlasByteBudget` gate. There is no literal to drift from the shipped art, and
 * `atlasCostBake.node.test.ts` reddens if the bake is ever unwired.
 */

const MB = 1024 * 1024

/**
 * Per-skin atlas download cost in bytes, BAKED from the real files on disk at
 * build time by scripts/atlasCostsPlugin.ts — there is no committed table to go
 * stale (that was a real drift class: a hand-copied literal shadowing a binary
 * the art run keeps growing). Keys are skin ids; a skin absent here (e.g. its
 * atlas file is missing) is treated as heavy by {@link firstBoutCostBytes} and so
 * excluded from the cold first bout rather than gambled onto it.
 */
export { ATLAS_COST_BYTES }

/** A skin with no known cost is assumed heavier than any real atlas, so it is
 *  excluded from a cost-capped first bout rather than optimistically allowed on. */
const UNKNOWN_COST_BYTES = 12 * MB

export function firstBoutCostBytes(skinA: string, skinB: string): number {
  return (ATLAS_COST_BYTES[skinA] ?? UNKNOWN_COST_BYTES) + (ATLAS_COST_BYTES[skinB] ?? UNKNOWN_COST_BYTES)
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
 * cited lab-throttling rate, NOT a live network measurement:
 *
 *   • Broadband (24 Mbps): the heaviest ~11.5 MB pairing loads in <4 s, so a
 *     byte cap buys nothing there and only withholds our best art.
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

// MODELED throughput of named lab profiles, in BYTES/sec. These are the standard
// Lighthouse / WebPageTest throttling presets, cited so the seconds are
// reproducible; decimal Mbps ÷ 8 (the unit those tools quote).
export const SLOW_4G_BYTES_PER_SEC = 1_600_000 / 8 //   200_000 — Lighthouse "Slow 4G"
export const FAST_4G_BYTES_PER_SEC = 9_000_000 / 8 // 1_125_000 — WebPageTest "4G"
export const CABLE_BYTES_PER_SEC = 24_000_000 / 8 //  3_000_000 — conservative desktop broadband

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
 * SLOW / Save-Data budget. Caps the opener at "the lightest fighter (madhavan,
 * 0.66 MB) opposite anyone", i.e. every madhavan pairing up to ~6.4 MB
 * (madhavan+lenny) — so a reported-slow visitor waits ~20–32 s at slow-4G rather
 * than up to ~57 s, the best a size-homogeneous heavy roster allows.
 *
 * WHY THIS THRESHOLD AND NOT THE ~4 MB ABSOLUTE FLOOR: the director's cost
 * re-roll is a SOFT preference that relaxes after MAX_ATTEMPTS to guarantee
 * termination. A budget admitting only the single lightest pairing (~4 MB) makes
 * the re-roll succeed on ~1 draw in 15, so ~6% of slow visitors would exhaust
 * the cap and fall through to a heavy opener — a silent failure on the exact
 * route (a slow link) nobody instruments. Admitting all four madhavan pairings
 * (~8 draws in 30) drops that tail below 1e-5: a reliable ~32 s ceiling beats a
 * ~20 s one that betrays 1 in 16 of the very users it exists to protect.
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

/** May this pairing open the reel? True when its combined download is within the
 *  budget for the viewer's connection class. `budgetBytes` is injectable so the
 *  gate can price each named profile deterministically; production callers use
 *  the runtime {@link firstBoutBudgetBytes} default. */
export function isAllowedFirstBout(
  skinA: string,
  skinB: string,
  budgetBytes: number = firstBoutBudgetBytes(),
): boolean {
  return firstBoutCostBytes(skinA, skinB) <= budgetBytes
}
