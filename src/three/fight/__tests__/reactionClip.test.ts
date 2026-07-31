import { describe, expect, it } from 'vitest'
import { resolveFrame } from '../AnimationDriver'
import type { FighterAssets } from '../../../fight/types'
import assets from '../../../../public/fighters/lenny/assets.json'

const A = assets as unknown as FighterAssets
const clips = A.clips as unknown as Record<string, { frames: number[]; durations: number[] }>

// A victim carries no `move` -- only attackers do -- and every reaction clip is
// non-looping. `frameAt` clamps a non-looping clip at `min(elapsed, total - 1)`,
// so driving one from the unbounded `globalFrame` counter pins it to its last
// frame forever. That made a 5-key hurt animation invisible in play: the struck
// fighter snapped to the final recovery pose and held it for the whole hitstop.
describe('reaction clips play instead of clamping to their last frame', () => {
  const reactions: Array<[string, string]> = [
    ['hitstun', 'hurt'],
    ['juggle', 'juggle'],
    ['knockdown', 'knockdown'],
    ['wakeup', 'wakeup'],
  ]

  for (const [stance, clipName] of reactions) {
    const clip = clips[clipName]

    it(`${stance} walks through ${clipName}'s keys`, () => {
      expect(clip.frames.length).toBeGreaterThan(1)
      const total = clip.durations.reduce((a, b) => a + b, 0)
      const seen = new Set<number>()
      for (let t = 0; t < total; t++) {
        seen.add(resolveFrame(A, { stance: stance as never, globalFrame: 9_000 + t, reactionFrame: t }))
      }
      expect(seen.size).toBe(clip.frames.length)
    })

    it(`${stance} starts on the impact pose, not the recovery pose`, () => {
      const first = resolveFrame(A, { stance: stance as never, globalFrame: 9_000, reactionFrame: 0 })
      expect(first).toBe(clip.frames[0])
      expect(first).not.toBe(clip.frames[clip.frames.length - 1])
    })

    // The mutation: strip the reaction clock and the old defect returns, so a
    // regression that drops `reactionFrame` on the way through the view fails
    // here rather than silently reverting the animation to a single pose.
    it(`${stance} collapses to one frame without a reaction clock`, () => {
      const seen = new Set<number>()
      for (let gf = 9_000; gf < 9_040; gf++) seen.add(resolveFrame(A, { stance: stance as never, globalFrame: gf }))
      expect([...seen]).toEqual([clip.frames[clip.frames.length - 1]])
    })
  }
})
