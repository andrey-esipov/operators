import { describe, expect, it } from 'vitest'
import { createFight, step } from '../sim'
import { makeAI, type Difficulty } from '../ai'
import { MAX_METER } from '../constants'
import type { FightState, FightEvent } from '../types'

/**
 * The super exists in PLAY, not just in isolation. `aisuper.test.ts` proves an
 * archetype *can* reach its super when handed the meter — but a super that is
 * reachable-yet-never-chosen passes that test forever, which is exactly the
 * failure this project keeps shipping. So this runs the REAL sim loop, both
 * sides on the tiered AI, meter starting at 0 with no grants, all the way to
 * match-end, and asserts the flagship actually fires under real pacing.
 *
 * Two independent properties, one per failure branch the design can take:
 *   (a) meter reaches super cost in a real round  — guards "meter too slow"
 *   (b) the AI actually spends it                  — guards "gate outranked"
 * If either regresses to zero, a capture of the most expensive move in the game
 * becomes impossible, and the bug hides behind a green aisuper.test.ts.
 *
 * Mutation-proved (see report): forcing the super gate closed drops supers to 0
 * and reds (b); starving METER_MULT keeps peak meter under cost and reds (a).
 */
function realMatch(p1: string, p2: string, d1: Difficulty, d2: Difficulty, seed: number) {
  const [s0, s1] = [seed >>> 0, (seed ^ 0x9e3779b9) >>> 0]
  const ai = [makeAI({ seed: s0, difficulty: d1 }), makeAI({ seed: s1, difficulty: d2 })]
  let s: FightState = createFight(p1, p2)
  let supers = 0
  let peakMeter = 0
  for (let f = 0; f < 20000; f++) {
    const res = step(s, [ai[0].decide(s, 0), ai[1].decide(s, 1)])
    s = res.state
    peakMeter = Math.max(peakMeter, s.fighters[0].meter, s.fighters[1].meter)
    for (const ev of res.events as FightEvent[]) {
      if (ev.type === 'super-flash') supers++
    }
    if (s.phase === 'match-end') break
  }
  return { supers, peakMeter }
}

// Fixed pairings/seeds so the counts below are deterministic. All melee-vs-melee
// and mixed; each is a full best-of-three to match-end.
const MATCHES: Array<[string, string, Difficulty, Difficulty, number]> = [
  ['operator', 'vanguard', 'hard', 'medium', 0x51ac], // the shipping default matchup
  ['operator', 'vanguard', 'hard', 'hard', 0x1234],
  ['warden', 'operator', 'hard', 'hard', 0x77aa],
  ['vanguard', 'warden', 'medium', 'medium', 0x0bad],
]

describe('super reachability in a real match', () => {
  const results = MATCHES.map((m) => ({ key: `${m[0]} vs ${m[1]}`, ...realMatch(...m) }))

  it('meter reaches super cost under real pacing in every match', () => {
    // Super cost is 1000 (half the 2000 bar). If a real round can't bank that,
    // no one — AI or human — can ever spend it. Guards branch (a).
    for (const r of results) {
      expect(r.peakMeter, `${r.key} peak meter`).toBeGreaterThanOrEqual(1000)
    }
    expect(1000).toBeLessThan(MAX_METER) // cost must be affordable within the cap
  })

  it('the AI actually fires supers in every match, at a genre-sane rate', () => {
    // Every match must produce at least one super (guards branch (b): the gate
    // is not perpetually outranked), and the total must stay in a believable
    // band — a super that fires constantly stops being a moment. Observed: 3-4
    // per match; the floor/ceiling leave room for tuning without going silent
    // or degenerate.
    for (const r of results) {
      expect(r.supers, `${r.key} supers`).toBeGreaterThanOrEqual(1)
    }
    const total = results.reduce((n, r) => n + r.supers, 0)
    expect(total).toBeGreaterThanOrEqual(6) // well below the ~15 observed
    expect(total).toBeLessThanOrEqual(40) // and not a super every few seconds
  })
})
