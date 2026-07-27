/**
 * The harness sim is what actually feeds the renderer, so it gets the same
 * scrutiny as the core sim. Two properties matter and both are the kind this
 * repo has historically faked:
 *
 *  1. It is DETERMINISTIC — same seed, same fight, byte-for-byte. The
 *     screenshot tool relies on this to land on the same moment every run.
 *  2. It produces a REAL fight, not two idle dummies. A green "it ran 1600
 *     frames" means nothing if nobody threw a punch, so the liveliness test
 *     asserts hits, blocks, throws, a juggle and an actual KO all happen. Feed
 *     the renderer a stalemate and this test goes red.
 */

import { describe, expect, it } from 'vitest'
import { HarnessSim } from '../harnessSim'
import type { FightEvent, FightState } from '../types'

/** Compact, total fingerprint of a step: every event plus both fighters' key
 *  fields. No Sets here, so JSON is a faithful hash. */
function fingerprint(state: FightState, events: FightEvent[]): string {
  const f = state.fighters.map((x) => [
    x.pos.x.toFixed(3), x.pos.y.toFixed(3), x.vel.x.toFixed(3),
    x.health, x.meter, x.stance, x.stunRemaining, x.move?.id ?? '-', x.move?.frame ?? -1,
  ])
  return JSON.stringify({ ph: state.phase, hs: state.hitstop, f, e: events })
}

function runHashes(seed: number, frames: number): string[] {
  const sim = new HarnessSim({ seed })
  const out: string[] = []
  for (let i = 0; i < frames; i++) {
    const r = sim.step()
    out.push(fingerprint(r.state, r.events))
  }
  return out
}

describe('harness sim', () => {
  it('is deterministic: same seed replays byte-for-byte', () => {
    const a = runHashes(0xabcdef, 600)
    const b = runHashes(0xabcdef, 600)
    // Every single frame's full fingerprint must match — not just the endpoint.
    expect(a).toEqual(b)
    expect(a.length).toBe(600)
  })

  it('a different seed produces a genuinely different fight', () => {
    const a = runHashes(0xabcdef, 600)
    const b = runHashes(0x123456, 600)
    // They may agree during the fixed intro, but the fights must diverge.
    const diverged = a.some((h, i) => h !== b[i])
    expect(diverged).toBe(true)
  })

  it('produces a real fight: hits, blocks, throws, a juggle and a KO all happen', () => {
    const sim = new HarnessSim({ seed: 12345 })
    const ev: Record<string, number> = {}
    const seenPhases = new Set<string>()
    let sawZeroHealth = false
    let sawRoundEnd = false

    for (let f = 0; f < 2000; f++) {
      const r = sim.step()
      for (const e of r.events) ev[e.type] = (ev[e.type] ?? 0) + 1
      seenPhases.add(sim.phase)
      if (r.state.fighters[0].health === 0 || r.state.fighters[1].health === 0) sawZeroHealth = true
      if (r.state.phase === 'round-end') sawRoundEnd = true
    }

    // A real fight lands a meaningful number of hits and mixes in defence.
    expect(ev.hit ?? 0).toBeGreaterThanOrEqual(10)
    expect(ev.block ?? 0).toBeGreaterThanOrEqual(1)
    expect(ev.throw ?? 0).toBeGreaterThanOrEqual(1)
    // Combos happen (a launcher pops someone into a juggle).
    expect(ev.launch ?? 0).toBeGreaterThanOrEqual(1)
    // And it actually resolves: a life bar empties and a round ends.
    expect(sawZeroHealth).toBe(true)
    expect(sawRoundEnd).toBe(true)
    // The beat labels cover the full readable vocabulary the capture tool prints.
    for (const p of ['neutral', 'attack', 'hitstun', 'juggle', 'ko']) {
      expect(seenPhases.has(p), `expected to see phase '${p}'`).toBe(true)
    }
  })

  it('exposes the MockSim surface: frame increments and tracks state.frame', () => {
    const sim = new HarnessSim({ seed: 7 })
    expect(sim.frame).toBe(0)
    let prev = sim.frame // 0 before the first step
    for (let i = 0; i < 50; i++) {
      const r = sim.step()
      expect(sim.frame).toBe(r.state.frame) // frame mirrors authoritative state
      expect(sim.frame).toBe(prev + 1) // and advances exactly one per step
      expect(typeof sim.phase).toBe('string')
      expect(sim.phase.length).toBeGreaterThan(0)
      prev = sim.frame
    }
  })
})
