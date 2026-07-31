import { MAX_METER } from '../fight/constants'

/**
 * Meter POWER model — the affordability counterpart to the health bar's danger
 * read. The HUD already screams when you are about to LOSE (low-health flash);
 * finding #4 is that it never tells you when you are about to be able to DO
 * something. This module is the single source of truth for "what can this meter
 * pay for right now", so the SuperGauge can render a graded power readout
 * instead of a binary "charged" light.
 *
 * LIVE today: every super declares `cost: 1000` (warden Ion Storm, operator
 * Palm Barrage, vanguard Backbreaker) and the sim's spend gate is generic
 * (`if (move.cost && f.meter < move.cost) return`, sim.ts). MAX_METER is 2000,
 * so at a full meter exactly TWO supers are affordable — a real distinction the
 * gauge currently hides behind one "READY" state.
 */

/** One full super stock. Matches every super's `cost: 1000` in src/fight/fighters/*. */
export const SUPER_COST = 1000

/** Supers a maxed meter can pay for: floor(2000 / 1000) = 2. Live, from the sim. */
export const MAX_SUPERS = Math.floor(MAX_METER / SUPER_COST)

/**
 * EX specials — a RULED future currency (coordinator directive): EX moves will
 * cost 250–500 meter, so a full meter buys several EX or a super-plus-EX mix.
 *
 * FORWARD SPEC, NOT WIRED. Nothing in the fight engine spends this band yet — no
 * move in src/fight/fighters/* declares a cost in [250,500] (verified), and the
 * sim has no EX branch. These constants exist so that WHEN an EX move lands,
 * this model is already the single source of truth for its cost; they are
 * deliberately NOT surfaced as a usable affordance in the HUD, so we do not
 * manufacture an "authored but never consumed" lie. `affordableEx` below is
 * exercised only by meterModel's own gate until a real EX move exists — at which
 * point the SuperGauge can light an EX pip off the same function. Flagged, not
 * fixed: surfacing EX is blocked on the engine, and on the attract/return-shell
 * ordering the coordinator is sequencing.
 */
export const EX_COST_MIN = 250
export const EX_COST_MAX = 500

/** How many supers the meter can pay for right now (live). 0..MAX_SUPERS. */
export function affordableSupers(meter: number): number {
  if (!Number.isFinite(meter) || meter <= 0) return 0
  return Math.min(MAX_SUPERS, Math.floor(meter / SUPER_COST))
}

export type PowerTier = 'charging' | 'ready' | 'max'

/**
 * Graded power read for the gauge row. 'charging' = cannot afford a super yet;
 * 'ready' = one super in pocket; 'max' = the meter can pay for two, the "spend
 * something now" state the HUD currently withholds. Monotonic in meter by
 * construction (it is a function of affordableSupers).
 */
export function powerTier(meter: number): PowerTier {
  const n = affordableSupers(meter)
  if (n >= MAX_SUPERS) return 'max'
  if (n >= 1) return 'ready'
  return 'charging'
}

/**
 * Whether `meter` can pay for an EX move of the given `cost`. Pure and correct
 * today, but has NO caller on the shipped route yet (see EX_COST_* above): it
 * validates that the cost sits in the ruled EX band AND the meter covers it, so
 * the moment an EX move is authored the gauge can consume this directly. Kept
 * honest by its own gate, not by a runtime that does not exist.
 */
export function affordableEx(meter: number, cost: number): boolean {
  if (!Number.isFinite(meter) || !Number.isFinite(cost)) return false
  if (cost < EX_COST_MIN || cost > EX_COST_MAX) return false
  return meter >= cost
}
