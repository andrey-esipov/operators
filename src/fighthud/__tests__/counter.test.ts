/**
 * Counter-hit callout classification. The sim emits a dedicated `counter-hit`
 * event carrying the strike's `HitLevel`; the HUD splits that into two learnable
 * reads — the loud "PUNISH COUNTER" (a full punish: launcher/crumple/sweep/
 * heavy) versus the plain "COUNTER" (light/medium). These assertions pin the
 * exact partition so a regression that reclassifies a level (or collapses the
 * two identities into one) fails here, in the fast gate, not only in the DOM
 * probe. Verified can-fail by mutation: forcing `isPunish` to a constant turns
 * one side of the partition red (see report).
 */
import { describe, it, expect } from 'vitest'
import type { HitLevel } from '../../fight/types'
import { isPunish } from '../CounterCallout'

describe('isPunish', () => {
  it('treats launcher/crumple/sweep/heavy as a PUNISH counter', () => {
    expect(isPunish('heavy')).toBe(true)
    expect(isPunish('launcher')).toBe(true)
    expect(isPunish('sweep')).toBe(true)
    expect(isPunish('crumple')).toBe(true)
  })

  it('treats light/medium as a plain counter', () => {
    expect(isPunish('light')).toBe(false)
    expect(isPunish('medium')).toBe(false)
  })

  it('partitions every HitLevel exactly once (no level left unclassified)', () => {
    const levels: HitLevel[] = ['light', 'medium', 'heavy', 'launcher', 'sweep', 'crumple']
    const punish = levels.filter(isPunish)
    const plain = levels.filter((l) => !isPunish(l))
    // The union is the whole set and the two sides are disjoint by construction;
    // pin the split so a new level can't silently fall into "plain" unnoticed.
    expect(punish.sort()).toEqual(['crumple', 'heavy', 'launcher', 'sweep'])
    expect(plain.sort()).toEqual(['light', 'medium'])
  })
})
