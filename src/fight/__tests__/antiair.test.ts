/**
 * Regression lock for the juggle-gate bug (fixed in the air-block change): the
 * melee hit gate used `juggleLeft <= 0` as the "this juggle is exhausted, stop
 * hitting" sentinel — but a FRESH jumper also carries `juggleLeft === 0`, so the
 * gate silently refused every anti-air and air-to-air. Nothing in the harness
 * exercised it because the AI only ever launches grounded victims, so the broken
 * path was never reached. That is the exact shape this project keeps shipping: a
 * condition that is true for two unrelated reasons, with only one of them tested.
 *
 * The fix gates on the `'juggle'` STANCE, not the counter alone, so this test
 * pins BOTH reasons the condition can be true and proves they now behave
 * differently — which is the whole point of the fix:
 *
 *   1. A fresh airborne jumper (stance jump-fall, juggleLeft 0) MUST be hittable.
 *   2. A juggle victim that has spent its allowance (stance 'juggle', juggleLeft
 *      0) MUST be immune — that immunity is what ends a juggle.
 *
 * Same attacker, same geometry, same juggleLeft — only the stance differs, so the
 * two assertions isolate the gate exactly. Teeth, both directions (see report):
 *   - Revert the gate to `juggleLeft <= 0`  -> the fresh jumper is skipped ->
 *     property 1 reds (anti-air whiffs).
 *   - Delete the gate entirely              -> the exhausted juggle victim gets
 *     hit again -> property 2 reds (juggles never terminate).
 */
import { describe, expect, it } from 'vitest'
import { createFight, step } from '../sim'
import type { FightState, InputFrame, Button, Stance } from '../types'

function inp(dir: number, ...btns: Button[]): InputFrame {
  const s = new Set<Button>(btns)
  return { dir: dir as never, held: s, pressed: s }
}

/** Grounded attacker (p0, facing right) throws st.HP at p1, injected airborne at
 *  a height whose air hurtbox overlaps the attack, in `stance` with `juggleLeft`.
 *  p1 holds neutral (no air-block) so the only thing that can stop the hit is the
 *  juggle gate. Returns p1's health drop over the attack's active window. */
function antiAir(stance: Stance, juggleLeft: number): number {
  let s: FightState = createFight('operator', 'operator')
  s.phase = 'fight'; s.phaseTimer = 0
  s.fighters[0].pos.x = 0; s.fighters[0].facing = 1
  const d = s.fighters[1]
  d.pos.x = 60; d.facing = -1
  d.grounded = false; d.pos.y = 20; d.vel.y = 6
  d.stance = stance; d.juggleLeft = juggleLeft
  const startHp = d.health

  for (let f = 0; f < 16; f++) {
    const in0 = f === 0 ? inp(5, 'hp') : inp(5) // st.HP on frame 0, then release
    const r = step(s, [in0, inp(5)])            // p1 holds neutral: not blocking
    s = r.state
  }
  return startHp - s.fighters[1].health
}

describe('anti-air / air-to-air juggle gate', () => {
  it('a fresh airborne jumper (juggleLeft 0) CAN be anti-aired', () => {
    // The bug made this impossible: juggleLeft 0 read as "juggle exhausted".
    const dmg = antiAir('jump-fall', 0)
    expect(dmg).toBeGreaterThan(0)
  })

  it('a juggle victim that has spent its allowance (juggleLeft 0) is immune', () => {
    // Same juggleLeft, but the 'juggle' stance means the allowance is truly
    // spent — hitting again would make juggles infinite. This is the property
    // the gate must still protect, so a fix that just deleted the gate reds here.
    const dmg = antiAir('juggle', 0)
    expect(dmg).toBe(0)
  })
})
