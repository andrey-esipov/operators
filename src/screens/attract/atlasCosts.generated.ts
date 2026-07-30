// GENERATED from public/fighters/*/assets.json + assets.hero.json (real
// on-disk atlas byte sizes) by scripts/genAtlasCosts.ts — DO NOT hand-edit.
// Regenerate with:  npx tsx scripts/genAtlasCosts.ts
// scripts/atlasCostsPlugin.ts keeps it fresh at dev/build; freshness is gated
// by src/screens/attract/__tests__/atlasCostBake.node.test.ts.
export const ATLAS_COST_BYTES: Readonly<Record<string, number>> = Object.freeze({
  "altman": 2708994,
  "annie": 2317308,
  "cagan": 1926486,
  "catwu": 1781734,
  "chesky": 3177776,
  "doshi": 4127594,
  "lenny": 3930514,
  "madhavan": 1910178,
  "spiegel": 3387106,
  "taylor": 1740698,
  "turley": 3329242,
})

// Reduced "hero" opener-atlas sizes. On a reported-slow link the attract
// opener (bout 1) is served AND priced from these, so improving a fighter's
// FULL art can no longer cost it an opener pairing — see attractLoadCost.ts.
export const HERO_ATLAS_COST_BYTES: Readonly<Record<string, number>> = Object.freeze({
  "chesky": 766108,
  "doshi": 1025036,
  "lenny": 901548,
  "madhavan": 451140,
  "spiegel": 889730,
  "turley": 959676,
})
