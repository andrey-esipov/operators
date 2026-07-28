/**
 * Reaction latency, read at the SOURCE — stance and stun counters directly, no
 * pixels. A pixel probe can't answer this: knockback translates the sprite, the
 * spark is a new object no alignment removes, and run-to-run variance beats the
 * between-build signal (see the withdrawn probe, commit 2255cb9). The truth is in
 * the sim state, so that is what we assert.
 *
 * Answers three questions the critic capped the motion score on:
 *   Q1 latency: frames between the hit registering and the victim's stance
 *      changing. Proven to be 0 — applyHit flips stance the same frame contact is
 *      detected.
 *   Q2 outlast: the reaction must outlast the freeze — real recovery after
 *      hitstop, not stun that ends when the freeze does. Proven: stun is longer
 *      than hitstop AND is preserved across the freeze (it does not tick while
 *      hitstop > 0), so the whole hitstun animates after the world resumes.
 *   Q3 hitstop light vs heavy: already answered in impact.test.ts (light 8 <
 *      medium 9 < heavy 11, exact + monotonic, mutation-proven) — not re-done.
 *
 * Mutation-proven (see report): making stance lag a frame reds Q1; ticking stun
 * during hitstop (the exact regression the reaction-clock fix warned about) reds
 * Q2's preservation assertion.
 */
import { describe, expect, it } from 'vitest'
import { fightAtRange, inp, dir, NEU } from './helpers'
import { step } from '../sim'
import { getFighterDef } from '../fighters'
import type { FightState, InputFrame } from '../types'

// Operator st.LP: hitstun 13, hitstop 10 — the fastest normal, so if its reaction
// outlasts its freeze, every heavier hit (longer stun) does too.
const LP = getFighterDef('operator').moves['st.LP'].hit

/** Fire st.LP point-blank and return a per-frame trace of the victim (p1). */
function jabTrace() {
  let s: FightState = fightAtRange(64)
  const trace: Array<{
    frame: number
    stance: string
    stun: number
    hitstop: number
    health: number
  }> = []
  for (let f = 0; f < 40; f++) {
    const in0: InputFrame = f === 0 ? inp(5, 'lp') : dir(5)
    s = step(s, [in0, NEU]).state
    trace.push({
      frame: f,
      stance: s.fighters[1].stance,
      stun: s.fighters[1].stunRemaining,
      hitstop: s.hitstop,
      health: s.fighters[1].health,
    })
  }
  return trace
}

describe('reaction latency (sim-level, no pixels)', () => {
  const trace = jabTrace()
  const contact = trace.find((t) => t.health < trace[0].health)!

  it('Q1: the victim reacts on the exact contact frame — 0-frame latency', () => {
    expect(contact, 'the jab must connect').toBeTruthy()
    // The SAME frame health drops, the stance is already hitstun and the full
    // hitstun is loaded. There is no in-between frame where the victim has taken
    // damage but is still standing in idle — that gap is what "unresponsive"
    // would look like, and it is zero.
    expect(contact.stance).toBe('hitstun')
    expect(contact.stun).toBe(LP.hitstun)
  })

  it('Q2: the reaction outlasts the freeze (real recovery after hitstop)', () => {
    // The stun must be longer than the freeze, or the victim would be actionable
    // the instant the world unfreezes and there would be no recoil to see.
    expect(LP.hitstun).toBeGreaterThan(LP.hitstop)

    // And the stun is PRESERVED through the freeze: while hitstop > 0 the stun
    // counter holds at its loaded value instead of ticking down — this is the
    // regression the reaction-clock fix warned about (animating the victim THROUGH
    // the freeze). Every frozen frame must still read full hitstun.
    const frozen = trace.filter((t) => t.hitstop > 0 && t.stance === 'hitstun')
    expect(frozen.length).toBe(LP.hitstop)
    for (const t of frozen) expect(t.stun).toBe(LP.hitstun)

    // After the freeze, the stun counts all the way down in real time — recovery
    // animates for the FULL hitstun, not hitstun-minus-hitstop. Because the freeze
    // preserved the counter, the victim is in hitstun for hitstop + hitstun frames
    // total (10 frozen + 13 recovering here), and the whole reaction is on screen
    // after the world resumes. If stun leaked during the freeze this count would
    // fall below hitstun.
    const recovering = trace.filter((t) => t.hitstop === 0 && t.stance === 'hitstun')
    expect(recovering.length).toBe(LP.hitstun)
  })
})
