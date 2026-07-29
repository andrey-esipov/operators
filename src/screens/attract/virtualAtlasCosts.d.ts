declare module 'virtual:atlas-costs' {
  /**
   * Skin id → real on-disk atlas size in bytes, baked at dev/build/test time from
   * `public/fighters/<id>/atlas.webp` by `scripts/atlasCostsPlugin.ts`. There is
   * deliberately no committed table: the values cannot drift from the shipped art.
   */
  export const ATLAS_COST_BYTES: Readonly<Record<string, number>>
}
