/**
 * Fighter select-screen image paths, split by *display size* — the same contract
 * stageAssets.ts enforces for arenas, now for fighters.
 *
 * The v-next defect this exists to prevent: the select screen eagerly pulled all
 * six full sprite atlases (~24 MB post-WebP, ~127 MB before) just to paint a
 * 6-portrait grid, because the grid cropped its still straight out of the
 * multi-MB atlas. That is the stage regression (see stageAssets.ts) all over
 * again — a load race dressed up as a preload. The fix is a size contract:
 *
 *   - fighterPortrait(id): the small, pre-baked VS still (produced offline by
 *     tools/bake-vs-portraits.mjs) that the roster grid always shows — all six
 *     load when the screen opens. ~0.3–1.3 MB each. A committed budget gate —
 *     selectAssetBudget.node.test.ts — reddens the moment the grid points back
 *     at the atlas or the stills bloat.
 *   - fighterAtlas(id): the full multi-MB sprite sheet, pulled on demand ONLY for
 *     the animated hero (HeroRender / loadFighterAtlas) — one fighter at a time,
 *     never six-at-once up front.
 *
 * sprite-pipeline (bake-vs-portraits.mjs) PRODUCES the stills; src/fighthud/**
 * FRAMES them. Kept React-free so the node budget gate imports it without pulling
 * in the component tree, exactly as stageAssets.ts is imported.
 */

/** The always-loaded roster-grid still — small, display-sized, pre-baked. */
export function fighterPortrait(id: string): string {
  return `/fighters/${id}/portrait.png`
}

/** The still's metadata sidecar (native dims + feet anchor). */
export function fighterPortraitMeta(id: string): string {
  return `/fighters/${id}/portrait.json`
}

/** The full sprite atlas — animated hero on demand only, never the grid. */
export function fighterAtlas(id: string): string {
  return `/fighters/${id}/atlas.webp`
}
