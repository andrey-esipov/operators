import { describe, it, expect } from 'vitest'
import { decideRoute, hasMatchSignal, MATCH_PARAMS } from './appRoute'

/**
 * Reachability gate for the front door.
 *
 * The defect this locks down is a whole class we have shipped repeatedly:
 * "validate one member of a set while the member the customer actually gets goes
 * unchecked." A test that only ever asserts `?cards=1` or `?play=1` would show
 * the routing working perfectly while the single most-used URL — a bare `/` with
 * no query — dumped the buyer into someone else's fight. So the load-bearing
 * assertion here is specifically the empty-query case.
 */
describe('decideRoute — front door reachability', () => {
  it('a default page load with NO query string reaches the front door', () => {
    // The one the customer actually types. If this ever reads 'play' again, a
    // buyer is being dropped mid-fight instead of onto a title screen.
    expect(decideRoute('')).toBe('frontdoor')
    expect(decideRoute('?')).toBe('frontdoor')
  })

  it('the capture escape hatch ?play=1 still reaches a live match', () => {
    expect(decideRoute('?play=1')).toBe('play')
  })

  it('an explicit matchup on / still reaches a live match (capture tools)', () => {
    expect(decideRoute('?a=chesky&b=lenny')).toBe('play')
    expect(decideRoute('?a=chesky&b=lenny&p1=shoto&p2=rushdown&stage=pre-pmf&cpu=medium')).toBe('play')
  })

  it('each individual match param flips the empty landing into a match', () => {
    // Loop so a mutation that drops any one param from the set is caught, rather
    // than a single spot-check that a broken subset could still satisfy.
    for (const key of MATCH_PARAMS) {
      expect(decideRoute(`?${key}=x`)).toBe('play')
    }
    expect(decideRoute('?cpu=hard')).toBe('play')
    expect(decideRoute('?stage=ipo-prep')).toBe('play')
  })

  it('the dev/tool routes keep their exact precedence and are unchanged', () => {
    expect(decideRoute('?lab=1')).toBe('lab')
    expect(decideRoute('?fight=1')).toBe('fight')
    expect(decideRoute('?fighthud=1')).toBe('hud')
    expect(decideRoute('?select=1')).toBe('select')
    expect(decideRoute('?attract=1')).toBe('attract')
    expect(decideRoute('?cards=1')).toBe('cards')
  })

  it('a route flag wins over a stray match param (precedence is flags-first)', () => {
    expect(decideRoute('?lab=1&a=chesky')).toBe('lab')
    expect(decideRoute('?cards=1&stage=pre-pmf')).toBe('cards')
    expect(decideRoute('?select=1&cpu=hard')).toBe('select')
  })

  it('VACUITY GUARD: the front-door and match verdicts are genuinely distinct', () => {
    // If a no-op mutation collapsed the split (e.g. everything returned the same
    // kind), these would be equal and every assertion above would pass vacuously.
    expect(decideRoute('')).not.toBe(decideRoute('?play=1'))
    expect(decideRoute('')).not.toBe(decideRoute('?a=chesky&b=lenny'))
    expect(hasMatchSignal(new URLSearchParams(''))).toBe(false)
    expect(hasMatchSignal(new URLSearchParams('?play=1'))).toBe(true)
  })
})
