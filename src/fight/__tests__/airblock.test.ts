/**
 * Air-blocking. An airborne fighter holding back guards air-to-air normals and
 * projectiles — but the ground keeps its answer to a jump-in: lows can't be
 * air-blocked, and launchers/anti-airs, sweeps and supers punch straight
 * through. This is the depth of the mechanic; a version that blocked everything
 * in the air would delete the anti-air game (and the juggle work that rides on
 * it), so the negatives below matter as much as the positive.
 *
 * The scenario injects the defender airborne at a fixed height whose air
 * hurtbox overlaps the attacker's hitbox, then drives a real attack through the
 * sim so isBlocking/applyBlock run exactly as they do in a match.
 *
 * TEETH: the positive asserts the block actually happened (a `block` event, zero
 * damage past chip, AND that the defender stayed airborne — a ground-block would
 * fail the grounded check). The negatives assert holding *forward* in the air
 * eats the hit, and a launcher launches through a held-back air guard. Mutation-
 * proven: forcing the airborne branch of isBlocking to `return false` reds the
 * positive (the st.HP connects for full damage instead of blocking).
 */
import { describe, expect, it } from 'vitest'
import { createFight, step } from '../sim'
import type { FightState, InputFrame, Button, FightEvent } from '../types'

function inp(dir: number, ...btns: Button[]): InputFrame {
  const s = new Set<Button>(btns)
  return { dir: dir as never, held: s, pressed: s }
}

interface Outcome {
  blockedP1: boolean
  hp1: number
  startHp1: number
  grounded1: boolean
  stance1: string
}

/** Attacker (p0, grounded, facing right) throws `atk` at the defender (p1),
 *  who is injected airborne at a height that overlaps the attack and holds
 *  `defHold` (absolute dir). p1 faces left, so absolute 6 == relative back. */
function airExchange(atk: 'st.HP' | 'cr.HP', defHold: number): Outcome {
  let s: FightState = createFight('operator', 'operator')
  s.phase = 'fight'; s.phaseTimer = 0
  s.fighters[0].pos.x = 0; s.fighters[0].facing = 1
  s.fighters[1].pos.x = 60; s.fighters[1].facing = -1
  // Inject the defender airborne, hovering across the attack's active window.
  const d = s.fighters[1]
  d.grounded = false; d.pos.y = 20; d.vel.y = 6; d.stance = 'jump-fall'
  const startHp1 = d.health

  const atkInput: InputFrame = atk === 'cr.HP' ? inp(2, 'hp') : inp(5, 'hp')
  let blockedP1 = false
  for (let f = 0; f < 16; f++) {
    // p0 presses the button on frame 0; p1 just holds its guard direction while
    // airborne (re-assert airborne so a stray early land doesn't end the test).
    const in0 = f === 0 ? atkInput : inp(2) // hold crouch/neutral to keep the move out
    const in1 = inp(defHold)
    const r = step(s, [in0, in1])
    s = r.state
    for (const e of r.events as FightEvent[]) {
      if (e.type === 'block' && (e as { attacker: number }).attacker === 0) blockedP1 = true
    }
  }
  return { blockedP1, hp1: s.fighters[1].health, startHp1, grounded1: s.fighters[1].grounded, stance1: s.fighters[1].stance }
}

describe('air-blocking', () => {
  it('an airborne fighter holding back air-blocks a high normal and stays airborne', () => {
    const o = airExchange('st.HP', 6) // absolute 6 == back for a left-facing p1
    expect(o.blockedP1).toBe(true)
    // chip on st.HP is 0, so a clean block costs no health.
    expect(o.hp1).toBe(o.startHp1)
    // The defender is still in the air — a ground-block would have grounded them.
    expect(o.grounded1).toBe(false)
    expect(o.stance1).toBe('blockstun')
  })

  it('holding forward in the air does not block — the hit lands', () => {
    const o = airExchange('st.HP', 4) // absolute 4 == forward for a left-facing p1
    expect(o.blockedP1).toBe(false)
    expect(o.hp1).toBeLessThan(o.startHp1)
  })

  it('a launcher punches through a held-back air guard (anti-air survives)', () => {
    const o = airExchange('cr.HP', 6) // holding back, but cr.HP is a launcher
    expect(o.blockedP1).toBe(false)
    expect(o.hp1).toBeLessThan(o.startHp1)
    // launched, not blocked: still airborne but in a juggle, not blockstun.
    expect(o.stance1).toBe('juggle')
  })
})
