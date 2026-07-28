import { FIGHTERS } from '../fighters'

/**
 * The canonical roster, derived from the SAME registry the sim reads
 * (fighters/index.ts). Iterating this in a test makes that test archetype-
 * complete BY CONSTRUCTION: add a fighter to FIGHTERS and every roster-driven
 * test covers it on the next run — no author has to remember to widen a loop.
 *
 * This primitive exists because the project has now shipped the identical blind
 * spot THREE times — a guard that validated ONE member of a set while the rest
 * went unchecked:
 *   1. reaction animations imported only `lenny` (8 of 11 fighters silently mute)
 *   2. the hitstop ladder asserted `operator` only (vanguard/warden unguarded)
 *   3. horizontal knockback asserted `operator` only (per-archetype kbx unguarded)
 * The house rule that motivated it: any test that instantiates one member of a
 * set is presumed blind until proven otherwise. Deriving the subject list from
 * the registry is how you stop re-proving it by hand.
 */
export const ROSTER: readonly string[] = Object.keys(FIGHTERS)
