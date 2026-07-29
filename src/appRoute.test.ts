import { describe, it, expect } from 'vitest'
import { decideRoute, hasMatchSignal, MATCH_PARAMS, SELECT_SEARCH, matchupSearch } from './appRoute'

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

/**
 * Nav-target round-trip — the pushState side of the route-as-state shell.
 *
 * The shell no longer reloads between screens: it `history.pushState`s a search
 * string and re-derives the surface with {@link decideRoute}. That makes the
 * *builders* load-bearing — if `SELECT_SEARCH` or `matchupSearch` produced a
 * string `decideRoute` reads as a different screen, a click would strand the
 * viewer on a blank shell with no reload to paper over it. This block proves the
 * builder → decider round-trip that the reloads used to make trivially true.
 *
 * These are behavioural assertions on pure functions, not source text: the
 * failure mode (a builder that emits the wrong or an incomplete query) cannot
 * satisfy them. What they do NOT cover — that `App`'s handlers actually call
 * `navigate`, and that React swaps screens without a document reload — is React
 * runtime behaviour with no jsdom in this suite; that half is the source gate in
 * `screens/__tests__/shellNav.node.test.ts` plus the live browser proof.
 */
describe('decideRoute — pushState nav targets round-trip', () => {
  // Distinct sentinel per field, so a builder that DROPS a field or SWAPS two
  // (emits p1's value under p2, say) reddens instead of passing on coincidental
  // equality of two identical values.
  const sample = { a: 'skinA', b: 'skinB', p1: 'archP1', p2: 'archP2', stage: 'stageS', cpu: 'cpuC' }

  it('SELECT_SEARCH pushes to the select screen', () => {
    // The target both the front door and the standalone attract reel push when
    // the viewer leaves the reel to pick a fighter.
    expect(decideRoute(SELECT_SEARCH)).toBe('select')
  })

  it('a built matchup search boots straight into the live match', () => {
    // What FightSelect hands to onLaunch when a player locks in. Must resolve to
    // the same 'play' a capture tool's explicit-matchup URL resolves to.
    expect(decideRoute(matchupSearch(sample))).toBe('play')
  })

  it('every matchup field survives the build → parse round-trip', () => {
    const parsed = new URLSearchParams(matchupSearch(sample))
    expect(parsed.get('a')).toBe(sample.a)
    expect(parsed.get('b')).toBe(sample.b)
    expect(parsed.get('p1')).toBe(sample.p1)
    expect(parsed.get('p2')).toBe(sample.p2)
    expect(parsed.get('stage')).toBe(sample.stage)
    expect(parsed.get('cpu')).toBe(sample.cpu)
  })

  it('matchupSearch emits a well-formed, non-empty query with a leading ?', () => {
    const s = matchupSearch(sample)
    expect(s.startsWith('?')).toBe(true)
    expect(s.length).toBeGreaterThan(1)
  })

  it('VACUITY GUARD: the two nav targets land on genuinely different screens', () => {
    // If a mutation collapsed decideRoute so every input returned one kind, both
    // round-trips above would pass while proving nothing. Nail the split, and
    // specifically that a matchup never trips the select flag (ordering hazard:
    // decideRoute checks select=1 before the match signal).
    expect(decideRoute(SELECT_SEARCH)).not.toBe(decideRoute(matchupSearch(sample)))
    expect(decideRoute(matchupSearch(sample))).not.toBe('select')
  })
})
