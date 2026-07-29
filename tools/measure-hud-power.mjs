// measure-hud-power.mjs — does the SUPER GAUGE express POWER, or only "charged"?
//
// Finding #4: the HUD signals DANGER (the health bar flashes when you are about
// to lose) but never signals POWER (it never tells you when you are about to be
// able to DO something). The super gauge lit ONE binary "charged" state at
// meter >= 1000 and read "READY" identically whether you could afford ONE super
// or TWO — hiding a real, spendable distinction the sim honours today.
//
// This drives the ACTUAL shipped model (src/fighthud/meterModel.ts — the exact
// affordableSupers + powerTier the SuperGauge now runs) across the whole meter
// range and asserts the graded power read is real, monotone, and boundary-exact
// against the sim's own spend gate (`f.meter < move.cost`, cost 1000, cap 2000).
//
// GUARDS, the shape the audio / weight / stage-identity instruments established:
//   • NON-VACUITY — powerTier must take >= 3 DISTINCT values across the range.
//     A dead model that returns one tier forever cannot pass; this proves the
//     read RESPONDS to meter, it is not a constant dressed as a gauge.
//   • POSITIVE CONTROL — powerTier(0) === 'charging' and powerTier(MAX) ===
//     'max', and they differ. If an empty and a maxed meter read the same, the
//     whole "power read" is a lie and this fails loudly.
//   • ASSERTION — the ladder is boundary-exact (0 supers below 1000, 1 at 1000,
//     2 at 2000), clamps at MAX_SUPERS (never 3), is monotone non-decreasing,
//     and the FORWARD EX spec is internally consistent (band 250..500 strictly
//     below one super; affordableEx true only inside the band with enough meter)
//     while — flagged, not asserted-as-live — having NO shipped caller yet.
//
// Card-clean: imports only the shipped HUD meter model. Run with `npx tsx`.
//   node tools/measure-hud-power.mjs           # human table
//   node tools/measure-hud-power.mjs --json     # machine readable
//   node tools/measure-hud-power.mjs --assert   # exit 1 if the power read broke

import {
  SUPER_COST,
  MAX_SUPERS,
  EX_COST_MIN,
  EX_COST_MAX,
  affordableSupers,
  powerTier,
  affordableEx,
} from '../src/fighthud/meterModel.ts'
import { MAX_METER } from '../src/fight/constants.ts'

const args = new Set(process.argv.slice(2))

// Sample the whole meter range plus every boundary the sim cares about.
const SAMPLES = [0, 1, 500, 999, 1000, 1001, 1500, 1999, 2000, MAX_METER, MAX_METER + 500]
const ladder = SAMPLES.map((meter) => ({
  meter,
  supers: affordableSupers(meter),
  tier: powerTier(meter),
}))

const tiers = new Set(ladder.map((r) => r.tier))
const distinctTiers = tiers.size

// Monotonicity: affordableSupers never decreases as meter rises.
let monotone = true
for (let i = 1; i < ladder.length; i++) {
  if (ladder[i].meter >= ladder[i - 1].meter && ladder[i].supers < ladder[i - 1].supers) monotone = false
}

// Boundary exactness vs the sim's spend gate (`f.meter < cost` ⇒ can't spend).
const boundaries = {
  belowOne: affordableSupers(SUPER_COST - 1) === 0,
  atOne: affordableSupers(SUPER_COST) === 1,
  belowTwo: affordableSupers(2 * SUPER_COST - 1) === 1,
  atTwo: affordableSupers(2 * SUPER_COST) === 2,
  clamped: affordableSupers(MAX_METER + 5000) === MAX_SUPERS,
}

const tierMap = {
  chargingBelow: powerTier(SUPER_COST - 1) === 'charging',
  readyAtOne: powerTier(SUPER_COST) === 'ready',
  maxAtTwo: powerTier(2 * SUPER_COST) === 'max',
}

// Forward EX spec (NOT live): band below a super, and affordableEx gated to it.
const exSpec = {
  bandBelowSuper: EX_COST_MAX < SUPER_COST && EX_COST_MIN >= 1,
  bandOrdered: EX_COST_MIN < EX_COST_MAX,
  inBandAffordable: affordableEx(EX_COST_MIN, EX_COST_MIN) === true && affordableEx(EX_COST_MAX, EX_COST_MAX) === true,
  poorRejected: affordableEx(EX_COST_MIN - 1, EX_COST_MIN) === false,
  belowBandRejected: affordableEx(MAX_METER, EX_COST_MIN - 1) === false,
  aboveBandRejected: affordableEx(MAX_METER, EX_COST_MAX + 1) === false,
}

const posControl = powerTier(0) === 'charging' && powerTier(MAX_METER) === 'max' && powerTier(0) !== powerTier(MAX_METER)

if (args.has('--json')) {
  console.log(JSON.stringify({ ladder, distinctTiers, monotone, boundaries, tierMap, exSpec, posControl }, null, 2))
  process.exit(0)
}

console.log('METER POWER LADDER  (SUPER_COST=%d  MAX_SUPERS=%d  MAX_METER=%d)', SUPER_COST, MAX_SUPERS, MAX_METER)
for (const r of ladder) {
  console.log('  meter %s\tsupers=%d\ttier=%s', String(r.meter).padStart(5), r.supers, r.tier)
}
console.log('')
console.log('  distinct tiers (non-vacuity, need >=3): %d', distinctTiers)
console.log('  positive control (charging@0 != max@MAX): %s', posControl)
console.log('  monotone non-decreasing:                 %s', monotone)
console.log('  boundaries exact:', JSON.stringify(boundaries))
console.log('  tier map:        ', JSON.stringify(tierMap))
console.log('  EX forward-spec (NOT wired):', JSON.stringify(exSpec))

if (args.has('--assert')) {
  const fails = []
  if (distinctTiers < 3) fails.push(`NON-VACUITY: only ${distinctTiers} distinct tiers (<3) — power read is not graded`)
  if (!posControl) fails.push('POSITIVE CONTROL: empty and maxed meter read the same tier')
  if (!monotone) fails.push('MONOTONICITY: affordableSupers decreased as meter rose')
  for (const [k, v] of Object.entries(boundaries)) if (!v) fails.push(`BOUNDARY: ${k} wrong`)
  for (const [k, v] of Object.entries(tierMap)) if (!v) fails.push(`TIER MAP: ${k} wrong`)
  for (const [k, v] of Object.entries(exSpec)) if (!v) fails.push(`EX SPEC: ${k} wrong`)
  console.log('')
  if (fails.length) {
    console.log('ASSERT: FAIL')
    for (const f of fails) console.log('    \u2717 ' + f)
    process.exit(1)
  }
  console.log('ASSERT: PASS \u2014 graded power read is real, boundary-exact, monotone; EX spec consistent (forward, unwired)')
}
