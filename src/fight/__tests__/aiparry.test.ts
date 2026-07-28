/**
 * The AI must actually PARRY — parry is our Third Strike reference point's
 * signature mechanic, and a parry the AI never performs is, from the player's
 * seat, a feature that does not exist (the same failure the super had). The
 * parry *mechanic* is covered in parry.test.ts (normals) and projectiles.test.ts
 * (fireballs); this file proves the AI reads a live threat and parries it inside
 * a real, deterministic AI-vs-AI fight — both a committed melee attack and an
 * incoming fireball, the latter exercising the separate, reaction-corrected
 * projectile read.
 *
 * Teeth, and a caught lie: an earlier version of this test flagged a "fireball
 * parry" whenever a bolt merely sat near the parrying fighter — an assertion a
 * plain melee parry satisfies whenever a fireball happens to be on screen, and
 * mutation testing exposed it (disabling the projectile branch left it green).
 * A fireball parry is now proven the only way it can be: a specific bolt, owned
 * by the attacker, that existed last frame and is GONE the instant the parry
 * fires — it was consumed by the parry, not blocked, hit or expired. Every
 * count and frame here is a deterministic anchor; mutation-checked (see report)
 * by zeroing parryChance and by disabling each parry branch in turn.
 */

import { describe, expect, it } from 'vitest'
import { HarnessSim } from '../harnessSim'

interface ParryHit {
  frame: number
  /** True only when a bolt owned by the attacker, present last frame and
   *  closing on the defender, vanished on this exact frame — i.e. the parry
   *  consumed it. Distinguishes a real fireball parry from a melee parry that
   *  merely coincides with a fireball being on screen. */
  fireball: boolean
}

function parries(seed: number, p1: string, p2: string, frames = 2400): ParryHit[] {
  const h = new HarnessSim({ seed, p1, p2 } as never)
  const out: ParryHit[] = []
  let prev: { id: number; owner: number; x: number }[] = []
  for (let k = 0; k < frames; k++) {
    const r = h.step()
    const cur = (r.state.projectiles ?? []).map((p) => ({ id: p.id, owner: p.owner, x: p.pos.x }))
    const liveIds = new Set(cur.map((p) => p.id))
    for (const e of r.events) {
      if (e.type !== 'parry') continue
      const defender = 1 - e.attacker
      const meX = r.state.fighters[defender].pos.x
      const consumed = prev.some(
        (p) => p.owner !== defender && !liveIds.has(p.id) && Math.abs(p.x - meX) < 110,
      )
      out.push({ frame: k, fireball: consumed })
    }
    prev = cur
  }
  return out
}

describe('AI parries', () => {
  it('reads and parries a committed melee attack, on an exact frame', () => {
    // operator vs vanguard: neither has a projectile, so this isolates the
    // melee (attackGuard) parry read with a stable rng stream.
    const a = parries(0x51ac, 'operator', 'vanguard')
    expect(a.length).toBe(2)
    expect(a.every((p) => !p.fireball)).toBe(true) // no fireballs exist here
    // Deterministic anchor: drifts red if the parry read, the reaction delay,
    // or the rng stream changes underneath it.
    expect(a[0].frame).toBe(1237)
  })

  it('is deterministic: the same seed parries on the same frames every run', () => {
    const a = parries(0x51ac, 'warden', 'operator')
    const b = parries(0x51ac, 'warden', 'operator')
    expect(a.map((p) => p.frame)).toEqual(b.map((p) => p.frame))
    expect(a.map((p) => p.fireball)).toEqual(b.map((p) => p.fireball))
  })

  it('parries an incoming fireball in the zoner matchup (projectile read)', () => {
    const a = parries(0x51ac, 'warden', 'operator')
    expect(a.length).toBe(5)
    // At least one parry consumes an incoming bolt — proving the AI's
    // reaction-corrected projectile-parry branch fires, not just its melee one.
    const fireballs = a.filter((p) => p.fireball)
    expect(fireballs.length).toBeGreaterThanOrEqual(1)
    expect(fireballs[0].frame).toBe(357)
  })
})
