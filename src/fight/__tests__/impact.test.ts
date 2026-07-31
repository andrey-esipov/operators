/**
 * Impact reads: knockback asymmetry and hitstop weight.
 *
 * These pin the two properties a hit needs in order to read as a *hit* rather
 * than a collision, both of which a capture once suggested were missing (they
 * weren't — the reaction animation was frozen on one frame, a renderer bug fixed
 * separately). The value here is the lock: if a future change ever flattens
 * either property, this reds.
 *
 * 1. KNOCKBACK ASYMMETRY. The victim must travel dramatically further than the
 *    attacker on contact, and heavier hits must skew that further — a light is a
 *    quick poke, a heavy blows you away. Measured from the contact frame to rest
 *    at point-blank, driven through the real sim.
 * 2. HITSTOP WEIGHT. The single freeze-frame must lengthen with hit strength;
 *    identical hitstop across light and heavy would delete the sense of weight.
 *
 * TEETH: exact hitstop frame counts per level and tight displacement bands, plus
 * strict monotonicity and a heavy-dominates-light ordering. Mutation-proven:
 * collapsing KB_X_SCALE.heavy to the light value reds the weight skew; giving the
 * attacker the victim's knockback (symmetric recoil) reds every asymmetry ratio;
 * flattening any heavy's authored hitstop to a light's reds the exact-frame lock.
 */
import { describe, expect, it } from 'vitest'
import { createFight, step } from '../sim'
import type { FightState, InputFrame, Button } from '../types'

function inp(dir: number, ...btns: Button[]): InputFrame {
  const s = new Set<Button>(btns)
  return { dir: dir as never, held: s, pressed: s }
}

interface Impact {
  hitstop: number
  dA: number // attacker displacement from contact (signed; negative = pushed back)
  dV: number // victim displacement from contact (positive = knocked away)
  ratio: number // |dV| / |dA|
}

/** Land one clean grounded normal at point-blank; measure both fighters'
 *  displacement from the contact frame to rest, and the hitstop at contact. */
function land(btn: Button, moveDir: number): Impact {
  let s: FightState = createFight('operator', 'operator')
  s.phase = 'fight'; s.phaseTimer = 0
  s.fighters[0].pos.x = 0; s.fighters[0].facing = 1
  s.fighters[1].pos.x = 66; s.fighters[1].facing = -1
  const atk = inp(moveDir, btn)
  let cA = 0, cV = 0, hitFrame = -1, hitstop = 0
  for (let f = 0; f < 40; f++) {
    const r = step(s, [f === 0 ? atk : inp(5), inp(5)])
    s = r.state
    if (hitFrame < 0 && r.events.some(e => e.type === 'hit')) {
      hitFrame = f; cA = s.fighters[0].pos.x; cV = s.fighters[1].pos.x; hitstop = s.hitstop
    }
  }
  expect(hitFrame, `${btn} must connect`).toBeGreaterThanOrEqual(0)
  const dA = s.fighters[0].pos.x - cA
  const dV = s.fighters[1].pos.x - cV
  return { hitstop, dA, dV, ratio: Math.abs(dV) / Math.max(0.01, Math.abs(dA)) }
}

describe('impact: knockback asymmetry', () => {
  const light = land('lp', 5)
  const medium = land('mp', 5)
  const heavy = land('hp', 5)

  it('the victim is driven back, the attacker barely moves — at every level', () => {
    // Victim always travels well over twice the attacker's slide.
    expect(light.ratio).toBeGreaterThan(2.5)
    expect(medium.ratio).toBeGreaterThan(2.0)
    expect(heavy.ratio).toBeGreaterThan(5.0)
    // And it's the victim that flies away from the attacker, not toward.
    expect(light.dV).toBeGreaterThan(0)
    expect(medium.dV).toBeGreaterThan(0)
    expect(heavy.dV).toBeGreaterThan(0)
  })

  it('heavier hits knock the victim further and skew the asymmetry further', () => {
    // Victim displacement is strictly increasing with weight.
    expect(medium.dV).toBeGreaterThan(light.dV)
    expect(heavy.dV).toBeGreaterThan(medium.dV)
    // A heavy is not just bigger — it is disproportionately one-sided.
    expect(heavy.ratio).toBeGreaterThan(light.ratio)
    // Tight bands so a silent regression in scaling can't hide (deterministic).
    expect(light.dV).toBeGreaterThan(4.5); expect(light.dV).toBeLessThan(5.3)
    expect(medium.dV).toBeGreaterThan(10.3); expect(medium.dV).toBeLessThan(11.4)
    expect(heavy.dV).toBeGreaterThan(50); expect(heavy.dV).toBeLessThan(56)
  })
})

describe('impact: hitstop weight', () => {
  it('freeze-on-contact lengthens with hit strength (exact frames)', () => {
    // Operator normals' authored hitstop: light 10, medium 12, heavy 14 —
    // raised into the SF6 contact-freeze band (light ~9-11, medium ~11-13,
    // heavy ~13-16), snappier than GGST's heavier 12/16/19 ladder.
    expect(land('lp', 5).hitstop).toBe(10)
    expect(land('mp', 5).hitstop).toBe(12)
    expect(land('hp', 5).hitstop).toBe(14)
  })

  it('hitstop is strictly increasing light < medium < heavy', () => {
    const l = land('lp', 5).hitstop
    const m = land('mp', 5).hitstop
    const h = land('hp', 5).hitstop
    expect(l).toBeLessThan(m)
    expect(m).toBeLessThan(h)
  })
})
