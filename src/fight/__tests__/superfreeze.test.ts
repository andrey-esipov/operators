/**
 * Super-activation freeze — the world stops for a beat when a super comes out,
 * before its damage travels (SF6 Critical Art / Tekken Rage Art / Strive
 * Overdrive). The mechanism is a longer, differently-flagged hitstop: while
 * `FightState.superFreeze > 0` the whole world holds EXCEPT the super's owner,
 * whose wind-up keeps animating. See sim.step + advanceSuperOwner.
 *
 * Two properties, proven the two ways each is best proven:
 *
 *  A. THE WORLD HOLDS (controlled + real-match). When a super fires, the
 *     opponent, the round timer and physics freeze for exactly
 *     SUPER_FREEZE_FRAMES while the owner's move.frame advances then holds. The
 *     controlled rig fires a known super point-blank; the real-match rig catches
 *     a super the tiered AI throws in genuine play (meter from 0, no grants), so
 *     this is asserted on a freeze that actually occurs in a match, not only on
 *     an injected one — reachability itself is proven in superreachability.test.
 *
 *  B. THE HIT SURVIVES THE FREEZE. The owner animates its startup but is held
 *     one frame short of its active window, so the super's damage cannot travel
 *     until the world resumes. This is the subtle failure mode: if the owner ran
 *     freely through the freeze it would burn its active frames while combat was
 *     frozen and the hit would silently vanish. So we assert the super actually
 *     connects AFTER the freeze.
 *
 * Mutation-proven (see report):
 *  - Remove the `s.superFreeze = ...` set   -> no hold window -> A reds.
 *  - Let the owner advance uncapped in the  -> active frames spent during the
 *    freeze (drop the active[0]-1 cap)          freeze, super deals 0 -> B reds.
 */
import { describe, expect, it } from 'vitest'
import { createFight, step } from '../sim'
import { makeAI, type Difficulty } from '../ai'
import { getFighterDef } from '../fighters'
import { SUPER_FREEZE_FRAMES } from '../constants'
import { fightAtRange, inp, dir, NEU } from './helpers'
import type { FightState, FightEvent } from '../types'

// Operator's super.P: motion 236236 + hp, cost 1000, a melee super with its
// active window at frames [6,13]. active[0] is therefore 6 — the frame its
// damage becomes live and the frame the owner must be held short of.
const SUPER_ACTIVE0 = getFighterDef('operator').moves['super.P'].active[0]

/** Drive p0 through 236236+HP point-blank against an idle p1 (granted the bar so
 *  the super is reachable; reachability itself is proven elsewhere), collecting a
 *  per-frame trace from the frame the super starts. */
function fireSuperPointBlank() {
  let s: FightState = fightAtRange(70)
  s.fighters[0].meter = 1000
  const motion = [dir(2), dir(3), dir(6), dir(2), inp(3), inp(6, 'hp')]

  const trace: Array<{
    superFreeze: number
    ownerFrame: number | undefined
    oppX: number
    oppHealth: number
    timer: number
  }> = []
  let started = false
  for (let f = 0; f < 5 + SUPER_FREEZE_FRAMES + 40; f++) {
    const in0 = f < motion.length ? motion[f] : NEU
    s = step(s, [in0, NEU]).state
    if (!started && s.fighters[0].move?.id === 'super.P') started = true
    if (started) {
      trace.push({
        superFreeze: s.superFreeze ?? 0,
        ownerFrame: s.fighters[0].move?.frame,
        oppX: s.fighters[1].pos.x,
        oppHealth: s.fighters[1].health,
        timer: s.timer,
      })
    }
  }
  return trace
}

describe('super-activation freeze — the world holds', () => {
  const trace = fireSuperPointBlank()

  it('fires the super and arms a full-length freeze', () => {
    expect(trace.length).toBeGreaterThan(0)
    // The freeze is armed on the frame the super starts.
    expect(trace[0].superFreeze).toBe(SUPER_FREEZE_FRAMES)
  })

  it('holds the opponent and the round timer for exactly SUPER_FREEZE_FRAMES', () => {
    // The frozen window is the leading run of frames where superFreeze > 0.
    const frozen = trace.filter((t) => t.superFreeze > 0)
    expect(frozen.length).toBe(SUPER_FREEZE_FRAMES)

    // Across the whole frozen window the opponent and the round clock do not move
    // one unit. (A hitstop-less world would drift both immediately — that is the
    // "the world does not stop" defect this fixes.)
    const oppX0 = frozen[0].oppX
    const timer0 = frozen[0].timer
    const oppHp0 = frozen[0].oppHealth
    for (const t of frozen) {
      expect(t.oppX).toBe(oppX0)
      expect(t.timer).toBe(timer0)
      expect(t.oppHealth).toBe(oppHp0) // no damage travels during the freeze
    }
  })

  it('animates the owner through the freeze but holds it short of its active frame', () => {
    const frozen = trace.filter((t) => t.superFreeze > 0)
    // The owner's wind-up advances (it is not a statue)...
    const frames = frozen.map((t) => t.ownerFrame ?? -1)
    expect(Math.max(...frames)).toBeGreaterThan(frames[0]) // it moved
    // ...but never reaches its active frame during the freeze — the cap is what
    // stops the super's damage travelling into a frozen world and being lost.
    for (const fr of frames) expect(fr).toBeLessThan(SUPER_ACTIVE0)
    // And it settles: the last frozen frame holds exactly the last startup frame.
    expect(frames[frames.length - 1]).toBe(SUPER_ACTIVE0 - 1)
  })

  it('the super connects AFTER the freeze — the hit is not eaten by the hold', () => {
    // Property B: once the world resumes the owner reaches its active window and
    // the super lands. If the cap were missing the active frames would have been
    // spent inside the freeze and the opponent would take 0.
    const first = trace[0].oppHealth
    const last = trace[trace.length - 1].oppHealth
    expect(last).toBeLessThan(first)
    // ...and it lands only after the freeze, not during it.
    const damagedDuringFreeze = trace.some((t) => t.superFreeze > 0 && t.oppHealth < first)
    expect(damagedDuringFreeze).toBe(false)
  })
})

/**
 * The same hold, but on a super the AI actually throws in a real match — meter
 * from 0, both sides on the tiered AI, no grants. Proves the freeze isn't a
 * property of the injection rig above but of any super that occurs in play.
 */
function realMatchFreeze(p1: string, p2: string, d1: Difficulty, d2: Difficulty, seed: number) {
  const [s0, s1] = [seed >>> 0, (seed ^ 0x9e3779b9) >>> 0]
  const ai = [makeAI({ seed: s0, difficulty: d1 }), makeAI({ seed: s1, difficulty: d2 })]
  let s: FightState = createFight(p1, p2)
  for (let f = 0; f < 20000; f++) {
    const res = step(s, [ai[0].decide(s, 0), ai[1].decide(s, 1)])
    s = res.state
    const flash = (res.events as FightEvent[]).find((e) => e.type === 'super-flash')
    if (flash) {
      // Snapshot the moment the super fired, then keep the match running and
      // watch the world hold. We sample 40 frames — comfortably inside the
      // 60-frame freeze — so no resume-frame edge effects contaminate it.
      const who = (flash as { who: 0 | 1 }).who
      const opp = s.fighters[who === 0 ? 1 : 0]
      const oppX0 = opp.pos.x
      const oppHp0 = opp.health
      const timer0 = s.timer
      expect(s.superFreeze, 'freeze armed on the flash frame').toBe(SUPER_FREEZE_FRAMES)
      for (let k = 0; k < 40; k++) {
        const r = step(s, [ai[0].decide(s, 0), ai[1].decide(s, 1)])
        s = r.state
        const o = s.fighters[who === 0 ? 1 : 0]
        expect(o.pos.x, `opponent x held at freeze frame ${k}`).toBe(oppX0)
        expect(o.health, `opponent health held at freeze frame ${k}`).toBe(oppHp0)
        expect(s.timer, `round timer held at freeze frame ${k}`).toBe(timer0)
        expect((s.superFreeze ?? 0) > 0, `still frozen at frame ${k}`).toBe(true)
      }
      return true
    }
    if (s.phase === 'match-end') break
  }
  return false
}

describe('super-activation freeze — in a real match', () => {
  it('the world holds around a super the AI throws under real pacing', () => {
    const observed = realMatchFreeze('operator', 'vanguard', 'hard', 'medium', 0x51ac)
    expect(observed, 'no super fired in the match to observe').toBe(true)
  })
})
