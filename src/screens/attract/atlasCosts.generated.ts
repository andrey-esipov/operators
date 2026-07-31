// GENERATED from public/fighters/*/assets.json + assets.hero.json (real
// on-disk atlas byte sizes) by scripts/genAtlasCosts.ts — DO NOT hand-edit.
// Regenerate with:  npx tsx scripts/genAtlasCosts.ts
// scripts/atlasCostsPlugin.ts keeps it fresh at dev/build; freshness is gated
// by src/screens/attract/__tests__/atlasCostBake.node.test.ts.
export const ATLAS_COST_BYTES: Readonly<Record<string, number>> = Object.freeze({
  "altman": 2581468,
  "annie": 2197254,
  "cagan": 1926486,
  "catwu": 1781734,
  "chesky": 3042420,
  "doshi": 3919670,
  "lenny": 3782324,
  "madhavan": 1910178,
  "spiegel": 3192308,
  "taylor": 1740698,
  "turley": 3172774,
})

// Reduced "hero" opener-atlas sizes. On a reported-slow link the attract
// opener (bout 1) is served AND priced from these, so improving a fighter's
// FULL art can no longer cost it an opener pairing — see attractLoadCost.ts.
export const HERO_ATLAS_COST_BYTES: Readonly<Record<string, number>> = Object.freeze({
  "chesky": 731724,
  "doshi": 972512,
  "lenny": 867918,
  "madhavan": 451140,
  "spiegel": 854970,
  "turley": 920794,
})
