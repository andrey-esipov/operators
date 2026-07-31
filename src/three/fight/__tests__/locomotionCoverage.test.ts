import { describe, expect, it } from 'vitest'
import { resolveFrame } from '../AnimationDriver'
import type { FighterAssets, Stance } from '../../../fight/types'

// Every playable fighter, imported statically — the same whole-roster coverage
// reactionCoverage.test.ts uses. A guard that resolves ONE skin is structurally
// blind: turley shipped with NO crouch/block/dash/backdash/jump-rise/jump-fall
// clips at all, so clipCandidates dropped each locomotion stance to looping
// `idle` and the fighter stood there BREATHING while crouching, blocking,
// dashing or jumping — the exact "wrong animation entirely" defect this file
// exists to kill. reactionCoverage guards the stances a fighter is PUT INTO
// (hit/knockdown/wakeup/juggle); locomotion — the stances a fighter DRIVES —
// was completely ungated, which is how a third of the pickable roster could be
// visibly broken while the whole suite stayed green.
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
import { ROSTER as SELECT_ROSTER } from '../../../fighthud/select/roster'

const ROSTER: Array<[string, FighterAssets]> = (
  [
    ['altman', altman], ['annie', annie], ['cagan', cagan], ['catwu', catwu],
    ['chesky', chesky], ['doshi', doshi], ['lenny', lenny], ['madhavan', madhavan],
    ['spiegel', spiegel], ['taylor', taylor], ['turley', turley],
  ] as Array<[string, unknown]>
).map(([n, a]) => [n, a as FighterAssets])

// The skins a player can actually pick (src/fighthud/select/roster.ts). Only a
// pickable fighter drives locomotion in a match, so the bar is held to these
// six. The other five are non-fightable card art. Tie the checked set to the
// real select roster — not a hardcoded list — so a NEWLY pickable fighter is
// automatically held to the same bar instead of slipping through un-imported.
const FIGHTABLE = new Set(SELECT_ROSTER.map((r) => r.skin))

// Each locomotion stance and the dedicated clip it must resolve to. These are
// the stances a fighter DRIVES (crouch/block/dash/backdash/jump), distinct from
// the reactions reactionCoverage covers. If the dedicated clip is missing,
// AnimationDriver.clipCandidates falls through to looping `idle` and the body
// plays the breathing loop instead of the pose — a WRONG-animation bug, not a
// frozen-frame one. NOTE: unlike the reaction gate this deliberately does NOT
// require >=2 keys — a single-cell stance (madhavan, and turley here) is the
// correct POSE held still, which is a real improvement over idle and a separate
// (Stage 2, real-art) concern. The bar in this file is only: never idle.
const LOCOMOTION: Array<{ stance: Stance; clip: string }> = [
  { stance: 'crouch', clip: 'crouch' },
  { stance: 'blockstun', clip: 'block' },
  { stance: 'dash', clip: 'dash' },
  { stance: 'backdash', clip: 'backdash' },
  { stance: 'jump-rise', clip: 'jump-rise' },
  { stance: 'jump-fall', clip: 'jump-fall' },
]

describe('every fightable fighter drives its own locomotion pose, never idle', () => {
  for (const [name, A] of ROSTER) {
    if (!FIGHTABLE.has(name)) continue // card skins don't drive locomotion in a match
    const clips = A.clips as unknown as Record<string, { frames: number[]; durations: number[] }>

    for (const { stance, clip: expected } of LOCOMOTION) {
      const clip = clips[expected]

      it(`${name}: ${stance} resolves to its own '${expected}' clip, not idle`, () => {
        // A missing dedicated clip is the whole defect: clipCandidates(stance)
        // ends in 'idle', so the stance silently resolves to the breathing loop.
        expect(
          clip,
          `${name} has no '${expected}' clip — ${stance} silently resolves to looping idle (the body just breathes)`,
        ).toBeDefined()
        expect(
          clip!.frames.length,
          `${name} '${expected}' clip has no frames`,
        ).toBeGreaterThanOrEqual(1)
      })

      it(`${name}: ${stance} draws only its own cells, never idle`, () => {
        if (!clip) return // covered (failed) by the test above
        const own = new Set(clip.frames)
        const total = clip.durations.reduce((a, b) => a + b, 0)
        const drawn = new Set<number>()
        // Sweep the clip's whole duration under both clocks the driver uses:
        // crouch loops off globalFrame; block runs off the reaction clock;
        // dash/backdash/jump are non-looping and clamp off globalFrame (they
        // hold their final airborne/settle pose, which is by design — so this
        // does NOT assert every key is walked, only that no cell drawn is idle).
        for (let t = 0; t < Math.max(total, 1); t++) {
          drawn.add(resolveFrame(A, { stance, globalFrame: 9_000 + t, reactionFrame: t }))
        }
        // If the dedicated clip were missing the driver would fall back to
        // looping idle and draw idle cells; every drawn cell belonging to the
        // stance's own clip proves the fighter plays the POSE, not breathing.
        for (const f of drawn) {
          expect(
            own.has(f),
            `${name} ${stance} drew cell ${f} outside its '${expected}' clip — the stance is falling through to idle`,
          ).toBe(true)
        }
      })
    }
  }
})

// Vacuity guard: the per-fighter bar above only bites skins this file imports.
// Tie the gate to the real select roster so a NEW pickable fighter can't ship
// with locomotion that silently resolves to idle just because nobody added its
// import here. (This project has 18+ documented gates that passed by checking
// nothing; an empty or under-covered roster must go RED, not silently green.)
describe('the locomotion guard covers the whole fightable roster', () => {
  const localNames = new Set(ROSTER.map(([n]) => n))
  it('checks every pickable fighter for real locomotion clips', () => {
    const missing = [...FIGHTABLE].filter((s) => !localNames.has(s))
    expect(missing, `fightable skins not covered by this gate: ${missing.join(', ')}`).toEqual([])
    // If the roster ever emptied this whole file would pass vacuously.
    expect(FIGHTABLE.size, 'fightable roster went empty — the locomotion guard is vacuous').toBeGreaterThanOrEqual(6)
  })
})
