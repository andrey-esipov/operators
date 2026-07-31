/**
 * Portrait roster resolution. The playable match hands the HUD a fighter *name*
 * ("Brian Chesky") but not the atlas *id* ("chesky"), and the id is not
 * derivable from the name by rule (chesky = surname, lenny = given name), so we
 * map through the roster. These assertions fail on a specific regression — a
 * wrong id, a case-sensitivity break, a non-undefined miss — rather than "a
 * function exists". Verified can-fail by mutation (see report).
 */
import { describe, it, expect } from 'vitest'
import { rosterIdForName } from '../portraits'

describe('rosterIdForName', () => {
  it('maps a full display name to its atlas id', () => {
    expect(rosterIdForName('Brian Chesky')).toBe('chesky')
    expect(rosterIdForName('Lenny Rachitsky')).toBe('lenny')
    expect(rosterIdForName('Sam Altman')).toBe('altman')
  })

  it('is case- and whitespace-insensitive', () => {
    expect(rosterIdForName('brian chesky')).toBe('chesky')
    expect(rosterIdForName('  BRIAN CHESKY  ')).toBe('chesky')
  })

  it('also resolves the roster short name', () => {
    // shortName for Brian Chesky is 'CHESKY'
    expect(rosterIdForName('chesky')).toBe('chesky')
  })

  it('returns undefined for an unknown name or missing input', () => {
    expect(rosterIdForName('Nobody At All')).toBeUndefined()
    expect(rosterIdForName('')).toBeUndefined()
    expect(rosterIdForName(undefined)).toBeUndefined()
  })
})
