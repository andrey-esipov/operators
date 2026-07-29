// GENERATED from public/fighters/*/assets.json + assets.hero.json (real
// on-disk atlas byte sizes) by scripts/genAtlasCosts.ts — DO NOT hand-edit.
// Regenerate with:  npx tsx scripts/genAtlasCosts.ts
// scripts/atlasCostsPlugin.ts keeps it fresh at dev/build; freshness is gated
// by src/screens/attract/__tests__/atlasCostBake.node.test.ts.
export const ATLAS_COST_BYTES: Readonly<Record<string, number>> = Object.freeze({
  "altman": 3630030,
  "annie": 3344488,
  "cagan": 750052,
  "catwu": 626190,
  "chesky": 5040682,
  "doshi": 5311018,
  "lenny": 6017834,
  "madhavan": 662420,
  "spiegel": 5710006,
  "taylor": 617354,
  "turley": 3711940,
})

// Reduced "hero" opener-atlas sizes. On a reported-slow link the attract
// opener (bout 1) is served AND priced from these, so improving a fighter's
// FULL art can no longer cost it an opener pairing — see attractLoadCost.ts.
export const HERO_ATLAS_COST_BYTES: Readonly<Record<string, number>> = Object.freeze({
  "chesky": 1209068,
  "doshi": 1161734,
  "lenny": 1326452,
  "madhavan": 131630,
  "spiegel": 1454122,
  "turley": 900768,
})
