import { describe, expect, it } from 'vitest'
import { resolveFrame } from '../AnimationDriver'
import type { FighterAssets, Stance } from '../../../fight/types'

// Every playable fighter, imported statically. The previous reaction guard
// imported ONLY lenny, so it validated a fighter that happens to have the full
// reaction set and was structurally blind to altman/annie/doshi/turley shipping
// with NO reaction clips and cagan/catwu/madhavan/taylor shipping with reactions
// clamped to a single frame. Covering the whole roster is the point.
import altman from '../../../../public/fighters/altman/assets.json'
import annie from '../../../../public/fighters/annie/assets.json'
import cagan from '../../../../public/fighters/cagan/assets.json'
import catwu from '../../../../public/fighters/catwu/assets.json'
import chesky from '../../../../public/fighters/chesky/assets.json'
import doshi from '../../../../public/fighters/doshi/assets.json'
import lenny from '../../../../public/fighters/lenny/assets.json'
import madhavan from '../../../../public/fighters/madhavan/assets.json'
import spiegel from '../../../../public/fighters/spiegel/assets.json'
import taylor from '../../../../public/fighters/taylor/assets.json'
import turley from '../../../../public/fighters/turley/assets.json'

const ROSTER: Array<[string, FighterAssets]> = (
  [
    ['altman', altman], ['annie', annie], ['cagan', cagan], ['catwu', catwu],
    ['chesky', chesky], ['doshi', doshi], ['lenny', lenny], ['madhavan', madhavan],
    ['spiegel', spiegel], ['taylor', taylor], ['turley', turley],
  ] as Array<[string, unknown]>
).map(([n, a]) => [n, a as FighterAssets])

// A victim is *put into* these stances carrying no `move`, so they run off the
// reaction clock. If the named clip is missing, AnimationDriver.clipCandidates
// silently resolves the stance to looping `idle` and the struck body just keeps
// breathing — "the body registers nothing". `juggle` has no core-pose fallback
// (no airborne-hit art), so it legitimately degrades to the `hurt` reel:
// clipCandidates('juggle') === ['juggle','hurt','idle'].
const REACTIONS: Array<{ stance: Stance; clip: string; fallbackClip?: string }> = [
  { stance: 'hitstun', clip: 'hurt' },
  { stance: 'knockdown', clip: 'knockdown' },
  { stance: 'wakeup', clip: 'wakeup' },
  { stance: 'juggle', clip: 'juggle', fallbackClip: 'hurt' },
]

describe('every fighter plays a real reaction when hit, not idle', () => {
  for (const [name, A] of ROSTER) {
    const clips = A.clips as unknown as Record<string, { frames: number[]; durations: number[] }>

    for (const r of REACTIONS) {
      // The clip that should actually drive this stance: the dedicated one, or
      // the documented fallback (juggle -> hurt). Anything else means the driver
      // is dropping to idle.
      const driving = clips[r.clip] ?? (r.fallbackClip ? clips[r.fallbackClip] : undefined)

      it(`${name}: ${r.stance} resolves to a multi-key reaction`, () => {
        expect(driving, `${name} has no ${r.clip} clip for ${r.stance}`).toBeDefined()
        // A single-frame reaction is the old "clamped to one frame" defect: it
        // plays, but as one frozen pose. Depth means at least two hard-cut keys.
        expect(
          driving!.frames.length,
          `${name} ${r.stance} reaction is a frozen single frame`,
        ).toBeGreaterThanOrEqual(2)
      })

      it(`${name}: ${r.stance} draws only reaction frames (never idle)`, () => {
        if (!driving) return // covered (failed) by the test above
        const reactionFrames = new Set(driving.frames)
        const total = driving.durations.reduce((a, b) => a + b, 0)
        const drawn = new Set<number>()
        for (let t = 0; t < total; t++) {
          drawn.add(resolveFrame(A, { stance: r.stance, globalFrame: 9_000 + t, reactionFrame: t }))
        }
        // If the reaction were missing the driver would fall back to idle and
        // draw idle frames; every drawn frame belonging to the reaction proves
        // the body is playing the reel, not standing there breathing.
        for (const f of drawn) {
          expect(reactionFrames.has(f), `${name} ${r.stance} drew a non-reaction frame ${f}`).toBe(true)
        }
        // And it walks the whole reel across its duration rather than holding
        // one pose (the reaction-clock regression this file also guards against).
        expect(drawn.size, `${name} ${r.stance} did not advance through its keys`).toBe(driving.frames.length)
      })
    }
  }
})
