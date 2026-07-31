/**
 * Stage image paths for the select screen, split by *display size* so the picker
 * never eagerly pulls the full-resolution arena renders just to paint a
 * thumbnail strip.
 *
 * The v10 critic caught the regression this exists to prevent: the stage phase
 * was fetching all eight 1.5–2.5 MB hero renders (~15 MB) up front and then
 * painting them into ~200 px ribbon plates — a load race dressed up as a
 * preload. The fix is a size contract:
 *
 *   - stageThumb(id): the small, display-sized image the 8-card ribbon always
 *     shows (all eight load when the stage phase opens). Kept tiny on purpose
 *     (~50 KB JPEG). A committed budget gate — selectAssetBudget.node.test.ts —
 *     reddens the moment this points back at the multi-MB renders or the thumbs
 *     bloat.
 *   - stageFull(id): the full 1536×1024 render, used ONLY for the single big
 *     hovered preview and the launch backdrop, and fetched on demand (per hover,
 *     with the already-loaded thumb as an instant placeholder), never all eight
 *     at once.
 *
 * stage-art owns producing the renders; this module owns the display-size
 * contract. If stage-art ships better-optimised thumbnails they drop straight in
 * at /stages/thumbs/<id>.jpg with no code change here.
 */

/** The always-loaded ribbon thumbnail — small, display-sized. */
export function stageThumb(id: string): string {
  return `/stages/thumbs/${id}.jpg`
}

/** The full-resolution render — big preview + launch backdrop only, on demand. */
export function stageFull(id: string): string {
  return `/stages/${id}.png`
}
