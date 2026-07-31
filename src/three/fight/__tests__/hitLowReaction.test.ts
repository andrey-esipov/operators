import { describe, expect, it } from 'vitest'
import { resolveFrame } from '../AnimationDriver'
import type { FighterAssets, Stance } from '../../../fight/types'

// The whole roster, imported statically. A crouch-hit gate that validated only
// one skin would be structurally blind to the other ten shipping a wrong or
// missing `hit-low` — the exact "validate one member of a set while N others go
// unchecked" shape that has bitten this project before. Every skin is asserted.
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

type ClipMap = Record<string, { frames: number[]; durations: number[] }>

// A crouching victim in hitstun must render the low hit pose (`hit-low`), not the
// standing hurt reel. Selection is carried by the `low` flag on the AnimQuery
// (set from FighterState.hitLow, itself set in combat.applyHit when the victim
// was crouching). `hit-low` ships in every atlas but was never requested before
// this wiring — clipCandidates('hitstun') asked only ['hurt','hit','idle'].
describe('a crouching victim plays hit-low, a standing one plays hurt', () => {
  for (const [name, A] of ROSTER) {
    const clips = A.clips as unknown as ClipMap
    const hitLow = clips['hit-low']
    const hurt = clips['hurt']

    it(`${name} has distinct hit-low and hurt impact poses`, () => {
      expect(hitLow?.frames.length).toBeGreaterThan(0)
      expect(hurt?.frames.length).toBeGreaterThan(0)
      // If these were the same cell, the low reaction would be indistinguishable
      // from the standing one and the whole wiring would be cosmetically inert.
      expect(hitLow.frames[0]).not.toBe(hurt.frames[0])
    })

    it(`${name} routes crouch-hitstun to hit-low and standing-hitstun to hurt`, () => {
      const low = resolveFrame(A, { stance: 'hitstun' as Stance, low: true, reactionFrame: 0, globalFrame: 9_000 })
      const stand = resolveFrame(A, { stance: 'hitstun' as Stance, low: false, reactionFrame: 0, globalFrame: 9_000 })
      expect(low).toBe(hitLow.frames[0])
      expect(stand).toBe(hurt.frames[0])
      // The teeth: these two selections must diverge. If clipCandidates ever
      // stops reading `low` (the mutation), `low` collapses onto `stand` and this
      // reds for all eleven skins at once.
      expect(low).not.toBe(stand)
    })
  }

  it('degrades to hurt when a skin has no hit-low (no regression for partial atlases)', () => {
    const clips = lenny.clips as unknown as ClipMap
    // A synthetic atlas identical to lenny but with hit-low stripped: the low
    // request must fall through hit-low -> hurt and render the standing reel,
    // exactly the pre-wiring behaviour, so a fighter without the pose is unharmed.
    const stripped = {
      ...(lenny as unknown as FighterAssets),
      clips: Object.fromEntries(Object.entries(clips).filter(([k]) => k !== 'hit-low')),
    } as unknown as FighterAssets
    const low = resolveFrame(stripped, { stance: 'hitstun' as Stance, low: true, reactionFrame: 0, globalFrame: 9_000 })
    expect(low).toBe(clips['hurt'].frames[0])
  })
})
