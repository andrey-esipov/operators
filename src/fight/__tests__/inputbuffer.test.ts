import { describe, expect, it } from 'vitest'
import { step } from '../sim'
import { fightAtRange, inp, dir, NEU } from './helpers'
import type { FightState } from '../types'

/**
 * The input buffer. In every modern fighter a button pressed a hair before a
 * fighter is actionable — in the tail of blockstun, hitstun, or a move's
 * recovery — is remembered and comes out on the first free frame. Without it a
 * player who presses at the natural moment (as the stun visibly ends) gets
 * nothing, and the game feels unresponsive in a way they can't articulate.
 *
 * This rig proves the buffer both FIRES and is BOUNDED — the second half
 * matters just as much, because a buffer with no window is indistinguishable
 * from "the fighter mashes out an attack on wakeup no matter what," which would
 * be its own bug. p0 jabs p1 once; p1 blocks; then p1 presses a jab exactly
 * once, `stunLeft` frames before it becomes free, and holds neutral after. We
 * report whether p1's jab actually came out.
 *
 * Mutation-proved (see report): making `bufferedPressed` return the live set
 * unchanged (buffer disabled) makes the in-window press vanish -> the FIRES
 * case reds. Removing the window bound (buffer the whole log) makes the
 * far-too-early press come out anyway -> the BOUNDED case reds.
 */
function jabFiresWhenPressedDuringBlockstun(stunLeftAtPress: number): boolean {
  let s: FightState = fightAtRange(55)
  let injected = false
  let sawBlock = false
  for (let f = 0; f < 60; f++) {
    // p0 throws a single jab on frame 0, then stops, so p1 is stunned exactly
    // once and every later stance change is p1's own doing.
    const p0 = f === 0 ? inp(6, 'lp') : NEU
    let p1 = dir(6) // p1 holds back to block
    const D = s.fighters[1]
    if (D.stance === 'blockstun') sawBlock = true
    if (sawBlock && !injected && D.stance === 'blockstun' && D.stunRemaining === stunLeftAtPress) {
      p1 = inp(6, 'lp') // the buffered press, while still in blockstun
      injected = true
    } else if (injected) {
      p1 = dir(5) // released — no live press on any later frame
    }
    s = step(s, [p0, p1]).state
    // After the press, the only way p1 can be attacking is the buffered jab: no
    // live press is fed again, and p0 has long since stopped.
    if (injected && s.fighters[1].stance === 'attack') return true
  }
  return false
}

describe('input buffer', () => {
  it('fires a press made a couple frames before becoming actionable', () => {
    // Pressed with 2 frames of blockstun left — inside the ACTION_BUFFER window.
    // The jab must come out on the first free frame instead of being dropped.
    expect(jabFiresWhenPressedDuringBlockstun(2)).toBe(true)
  })

  it('does not fire a press made far outside the buffer window', () => {
    // Pressed with 9 frames of blockstun left — well beyond ACTION_BUFFER. The
    // stale press must NOT be resurrected, or the buffer is really an autopilot
    // that attacks on wakeup regardless of intent.
    expect(jabFiresWhenPressedDuringBlockstun(9)).toBe(false)
  })

  it('is deterministic', () => {
    expect(jabFiresWhenPressedDuringBlockstun(2)).toBe(
      jabFiresWhenPressedDuringBlockstun(2),
    )
  })
})
