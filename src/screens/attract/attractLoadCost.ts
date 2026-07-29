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
 * ~0.6–5.5 MB each, so a purely random first pairing can serve the ~10.9 MB
 * worst case (spiegel + lenny) on a cold first visit.
 *
 * This caps only the FIRST bout's combined download, by excluding the heaviest
 * pairings. Bouts 2+ stay fully random, so every fighter — including the
 * heaviest, most-detailed atlases — still headlines; nothing is permanently
 * demoted and no light fighter is over-shown. The cut is modest by design (see
 * the task report): the roster is size-homogeneous, so a bigger first-load win
 * would require forcing the two light outliers together, which trades away
 * variety and first-impression art quality.
 *
 * WHY THESE NUMBERS CAN'T QUIETLY LIE: they are no longer hand-maintained. The
 * costs are BAKED from the real files on disk at build time (see
 * `virtual:atlas-costs` / scripts/atlasCostsPlugin.ts), so the byte the director
 * prices an opener with IS the byte on disk — the same one `reelQuality` and
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
 *  excluded from the first bout rather than optimistically allowed onto it. */
const UNKNOWN_COST_BYTES = 12 * MB

/**
 * Combined-download ceiling for the FIRST bout. At 10 MB it excludes the four
 * heaviest openers (spiegel+lenny ~10.9, doshi+lenny ~10.2, spiegel+doshi ~10.1,
 * chesky+lenny ~10.0 MB — the mutual pairings among the four heavy atlases)
 * while still admitting most matchups, including a heavy, detailed fighter
 * opposite a lighter one, so the opener is not biased toward the weakest art.
 *
 * The `reelQuality` gate re-prices the director's ACTUAL opener against the REAL
 * bytes on disk, so this ceiling is enforced against shipped art, not against the
 * (approximate) table above — if an atlas is re-encoded and a currently-admitted
 * opener crosses the line, the gate reddens with the offending pairing rather
 * than silently serving a heavier first load.
 */
export const FIRST_BOUT_COST_CEILING_BYTES = 10 * MB

export function firstBoutCostBytes(skinA: string, skinB: string): number {
  return (ATLAS_COST_BYTES[skinA] ?? UNKNOWN_COST_BYTES) + (ATLAS_COST_BYTES[skinB] ?? UNKNOWN_COST_BYTES)
}

/** May this pairing open the reel? True when its combined download is within the
 *  first-bout ceiling. */
export function isAllowedFirstBout(skinA: string, skinB: string): boolean {
  return firstBoutCostBytes(skinA, skinB) <= FIRST_BOUT_COST_CEILING_BYTES
}
