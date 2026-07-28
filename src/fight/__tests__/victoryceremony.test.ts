import { describe, expect, it } from 'vitest'
import { createFight, step } from '../sim'
import { makeAI } from '../ai'
import { resolveFrame } from '../../three/fight/AnimationDriver'
import type { FightState, FightEvent, FighterAssets, SpriteFrameMeta } from '../types'

/**
 * The victory ceremony. Every atlas ships a `victory` clip that had never been
 * drawn, because the `Stance` union had no state to request it and the renderer's
 * clip selector had no case to name it — the "authored but never consumed"
 * defect this project keeps rediscovering. This proves the whole chain now
 * closes: the sim asks for the pose at round-end, and the renderer resolves a
 * frame *inside the victory clip* rather than falling through to idle.
 *
 * The second test is the load-bearing one. Asserting `stance === 'victory'` is
 * exactly the assertion the failure mode satisfies — the stance can be set
 * perfectly while the clip still never draws (which is how the art stayed dead).
 * So it asserts the resolved frame index lands in the victory clip's own range.
 */

/** Run a real AI match and stop on the first frame the round-end beat is posed. */
function firstRoundEnd(seed: number): FightState {
  const [s0, s1] = [seed >>> 0, (seed ^ 0x9e3779b9) >>> 0]
  const ai = [makeAI({ seed: s0, difficulty: 'hard' }), makeAI({ seed: s1, difficulty: 'medium' })]
  let s: FightState = createFight('operator', 'vanguard')
  for (let f = 0; f < 20000; f++) {
    const res = step(s, [ai[0].decide(s, 0), ai[1].decide(s, 1)])
    s = res.state
    // The pose is struck on the handoff into round-end (after any KO freeze),
    // so the first round-end frame already carries it.
    if (s.phase === 'round-end') return s
    if (s.phase === 'match-end') return s
  }
  throw new Error('round never ended')
}

describe('victory ceremony', () => {
  it('poses the winner and keeps the loser down when a round ends', () => {
    const s = firstRoundEnd(0x51ac)
    const [f0, f1] = s.fighters
    // A decisive round: exactly one fighter is the winner.
    expect(f0.health).not.toBe(f1.health)
    const win = f0.health > f1.health ? 0 : 1
    expect(s.fighters[win].stance, 'winner').toBe('victory')
    expect(s.fighters[win === 0 ? 1 : 0].stance, 'loser').toBe('defeat')
  })

  it('resolves a frame inside the victory clip, not idle', () => {
    // Distinct, disjoint frame ranges per clip so "which clip drew" is provable
    // from the returned index alone.
    const dummy = (name: string): SpriteFrameMeta => ({
      name,
      rect: { x: 0, y: 0, w: 100, h: 200 },
      anchor: { x: 50, y: 200 },
    })
    const assets: FighterAssets = {
      id: 'test',
      atlas: '',
      heightCm: 180,
      frames: Array.from({ length: 9 }, (_, i) => dummy(`f${i}`)),
      clips: {
        idle: { frames: [0, 1], durations: [8, 8], loop: true },
        knockdown: { frames: [4], durations: [1], loop: false },
        ko: { frames: [5], durations: [1], loop: false },
        victory: { frames: [7, 8], durations: [10, 10], loop: false },
      },
    }

    // Victory must reach the victory clip's own frames (7 or 8) — never idle (0/1).
    const vIdx = resolveFrame(assets, { stance: 'victory', globalFrame: 0 })
    expect([7, 8]).toContain(vIdx)

    // Defeat has no dedicated clip, so it must fall to the grounded loser art
    // (ko frame 5), keeping the loser down — again never idle.
    const dIdx = resolveFrame(assets, { stance: 'defeat', globalFrame: 0 })
    expect(dIdx).toBe(5)
  })
})
