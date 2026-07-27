import { describe, expect, it } from 'vitest'
import { createFight, step, fighterCanAct } from '../sim'
import { makeAI } from '../ai'
import type { Button, Direction, FightState, InputFrame } from '../types'
import { fightAtRange, inp, run, serialize } from './helpers'

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

  // A byte-for-byte replay of two idle fighters is trivially deterministic —
  // and useless. This rig forces real combat (point-blank pressure) and asserts
  // it happened, so the replay guarantee is proven over a state that actually
  // hits, blocks, knocks back, spends meter and drains health. If combat ever
  // silently breaks, this fails on the "something happened" checks, not just on
  // a mismatch nobody would notice.
  it('replays a REAL fight (hits, damage, meter) identically', () => {
    // Point-blank so buttons connect. P1 pressures with a jab string that
    // chains and cancels; P2 mixes blocking with mashing a jab back.
    const p1: (f: number) => InputFrame = (f) =>
      f % 6 < 2 ? inp(2, 'lk') : f % 6 < 4 ? inp(2, 'mk') : inp(6)
    const p2: (f: number) => InputFrame = (f) =>
      f % 8 < 5 ? inp(4) : inp(5, 'lp')

    const play = (): { s: FightState; hits: number; dmg: number; meter: number } => {
      const r = run(fightAtRange(58), 300, p1, p2)
      const hits = r.events.filter((e) => e.type === 'hit').length
      const dmg =
        r.state.fighters[0].maxHealth - r.state.fighters[0].health +
        (r.state.fighters[1].maxHealth - r.state.fighters[1].health)
      const meter = r.state.fighters[0].meter + r.state.fighters[1].meter
      return { s: r.state, hits, dmg, meter }
    }

    const a = play()
    const b = play()

    // The replay is byte-identical…
    expect(serialize(a.s)).toBe(serialize(b.s))
    // …AND the thing we replayed was a genuine fight, not two statues. These
    // are the teeth: they go red the moment combat stops resolving.
    expect(a.hits).toBeGreaterThan(5)
    expect(a.dmg).toBeGreaterThan(0)
    expect(a.meter).toBeGreaterThan(0)
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
