import { describe, expect, it } from 'vitest'
import { ROSTER } from './roster'
import { FIGHTERS } from '../fighters'

/**
 * The harness that other coherence tests trust. If it silently narrowed, every
 * roster-driven guard would pass with fewer subjects — re-opening the exact
 * blind spot the harness exists to close. So it is pinned from both sides.
 */
describe('roster harness', () => {
  it('is derived from the live registry, not a hand-typed list', () => {
    // If someone "helpfully" replaces the Object.keys derivation with a literal,
    // this reds the moment the literal drifts from the registry.
    expect([...ROSTER]).toEqual(Object.keys(FIGHTERS))
  })

  it('cannot silently shrink below the shipped archetypes (fail-closed)', () => {
    // A ratchet, not a cap: additions flow through untouched, but dropping a
    // shipped fighter from the registry reds here instead of quietly halving
    // coverage everywhere downstream.
    expect(ROSTER.length).toBeGreaterThanOrEqual(3)
    for (const known of ['operator', 'vanguard', 'warden']) {
      expect(ROSTER).toContain(known)
    }
  })
})
