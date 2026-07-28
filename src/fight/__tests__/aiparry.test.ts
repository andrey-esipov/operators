/**
 * The AI must actually PARRY — parry is our Third Strike reference point's
 * signature mechanic, and a parry the AI never performs is, from the player's
 * seat, a feature that does not exist (the same failure the super had). The
 * parry *mechanic* is covered in parry.test.ts (normals) and projectiles.test.ts
 * (fireballs); this file proves the AI reads a live attack and parries it inside
 * a real, deterministic AI-vs-AI fight — including parrying a fireball, which
 * exercises the separate projectile-parry read.
 *
 * Teeth: exact parry counts, exact first-parry frames, and — for the zoner — a
 * check that the first parry genuinely lands on an incoming projectile (a
 * projectile owned by the attacker sat next to the defender the prior frame),
 * not merely that a 'parry' event fired. Mutation-checked (see report): zeroing
 * parryChance, or removing either parry branch, turns these red.
 */

import { describe, expect, it } from 'vitest'
import { HarnessSim } from '../harnessSim'
import type { FightState } from '../types'

interface ParryHit {
  frame: number
  onProjectile: boolean
}

/** Run a deterministic AI fight and log every parry with whether it landed on
 *  an incoming enemy projectile (owner != defender, adjacent the prior frame). */
function parries(seed: number, p1: string, p2: string, frames = 2000): ParryHit[] {
  const h = new HarnessSim({ seed, p1, p2 } as never)
  const out: ParryHit[] = []
  let prevProj: { owner: number; x: number }[] = []
  for (let k = 0; k < frames; k++) {
    const r = h.step()
    for (const e of r.events) {
      if (e.type !== 'parry') continue
      const defender = 1 - e.attacker
      const meX = (r.state as FightState).fighters[defender].pos.x
      const onProjectile = prevProj.some(
        (p) => p.owner !== defender && Math.abs(p.x - meX) < 95,
      )
      out.push({ frame: k, onProjectile })
    }
    prevProj = (r.state.projectiles ?? []).map((p) => ({ owner: p.owner, x: p.pos.x }))
  }
  return out
}

describe('AI parries', () => {
  it('reads and parries a live attack in a real fight, on an exact frame', () => {
    const a = parries(0x51ac, 'operator', 'vanguard')
    expect(a.length).toBeGreaterThanOrEqual(1)
    // Deterministic anchor: this exact frame drifts red if the parry read, the
    // reaction delay, or the rng stream changes underneath it.
    expect(a[0].frame).toBe(1237)
  })

  it('is deterministic: the same seed parries on the same frames every run', () => {
    const a = parries(0x51ac, 'warden', 'operator')
    const b = parries(0x51ac, 'warden', 'operator')
    expect(a.map((p) => p.frame)).toEqual(b.map((p) => p.frame))
  })

  it('parries an incoming fireball in the zoner matchup (projectile read)', () => {
    const a = parries(0x51ac, 'warden', 'operator')
    expect(a.length).toBe(6)
    // The very first parry lands on an incoming projectile — proving the AI's
    // projectile-parry branch fires, not just its normal-attack branch.
    expect(a[0]).toEqual({ frame: 357, onProjectile: true })
    expect(a.some((p) => p.onProjectile)).toBe(true)
  })
})
