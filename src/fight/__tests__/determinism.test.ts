import { describe, expect, it } from 'vitest'
import { createFight, step, fighterCanAct } from '../sim'
import { makeAI } from '../ai'
import type { Button, Direction, InputFrame } from '../types'
import { inp, run, serialize } from './helpers'

/** A deterministic but varied script so the replay exercises movement, jumps,
 *  attacks and motions rather than a single idle path. */
function scripted(seed: number): (frame: number) => InputFrame {
  const dirs: Direction[] = [5, 6, 6, 2, 3, 6, 4, 8, 5, 2, 1, 6]
  const btns: (Button | null)[] = ['lp', null, 'mp', null, 'hp', null, 'lk', null, 'mk', null, 'hk', null]
  return (frame: number) => {
    const d = dirs[(frame + seed) % dirs.length]
    const b = btns[(frame * 7 + seed) % btns.length]
    return b ? inp(d, b) : inp(d)
  }
}

describe('determinism', () => {
  it('replays a scripted match byte-for-byte', () => {
    const a = run(createFight('operator', 'operator'), 400, scripted(0), scripted(3))
    const b = run(createFight('operator', 'operator'), 400, scripted(0), scripted(3))
    expect(serialize(a.state)).toBe(serialize(b.state))
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events))
  })

  it('does not mutate the state passed in', () => {
    const s0 = createFight('operator', 'operator')
    const before = serialize(s0)
    const r1 = step(s0, [inp(6, 'lp'), inp(4)])
    // Original untouched…
    expect(serialize(s0)).toBe(before)
    // …and stepping the same input again yields the same result.
    const r2 = step(s0, [inp(6, 'lp'), inp(4)])
    expect(serialize(r1.state)).toBe(serialize(r2.state))
  })

  it('AI vs AI is reproducible frame-for-frame', () => {
    const play = () => {
      let s = createFight('operator', 'operator')
      const ai0 = makeAI({ seed: 11, aggression: 0.7 })
      const ai1 = makeAI({ seed: 22, aggression: 0.4 })
      for (let k = 0; k < 600; k++) {
        s = step(s, [ai0.decide(s, 0), ai1.decide(s, 1)]).state
      }
      return serialize(s)
    }
    expect(play()).toBe(play())
  })

  it('reports a mid-attack fighter as unable to act', () => {
    let s = createFight('operator', 'operator')
    s.phase = 'fight'
    s.phaseTimer = 0
    // Start a jab, then confirm control is locked out during its recovery.
    s = step(s, [inp(5, 'lp'), inp(5)]).state
    expect(s.fighters[0].stance).toBe('attack')
    s = step(s, [inp(5), inp(5)]).state
    expect(fighterCanAct(s, 0)).toBe(false)
  })
})
