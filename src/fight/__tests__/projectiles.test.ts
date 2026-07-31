/**
 * Projectiles and the Warden zoner. Every assertion here is chosen to fail if
 * the projectile life-cycle regresses in a specific way — exact velocity, exact
 * scaled damage, exact chip, exact parry meter, a bounded despawn — rather than
 * "a projectile exists". Each was mutation-tested (see the report) by breaking
 * the code it covers and watching it go red.
 */

import { describe, it, expect } from 'vitest'
import { createFight, step } from '../sim'
import { HarnessSim } from '../harnessSim'
import { WARDEN, OPERATOR, VANGUARD } from '../fighters'
import { PARRY_METER } from '../constants'
import type { Button, Direction, FightEvent, FightState, InputFrame } from '../types'

function inp(dir: Direction, ...b: Button[]): InputFrame {
  const set = new Set<Button>(b)
  return { dir, held: set, pressed: set }
}
const NEU: InputFrame = { dir: 5, held: new Set(), pressed: new Set() }

/** Warden (left, facing +1) vs Operator (right, facing -1), `gap` cm apart. */
function wardenRig(gap: number): FightState {
  const s = createFight('warden', 'operator')
  s.phase = 'fight'
  s.phaseTimer = 0
  s.fighters[0].pos.x = -gap / 2
  s.fighters[1].pos.x = gap / 2
  s.fighters[0].facing = 1
  s.fighters[1].facing = -1
  return s
}

/** The three-frame qcf motion ending on a punch — a fireball. */
function qcf(button: Button): InputFrame[] {
  return [inp(2), inp(3), inp(6, button)]
}

/** Run `n` frames feeding fighter 0 the motion then neutral, fighter 1 from
 *  `def`. Returns final state and flat events with the frame they fired on. */
function fireAt(
  s: FightState, n: number, motion: InputFrame[], def: (k: number) => InputFrame,
): { state: FightState; events: Array<[number, FightEvent]> } {
  const events: Array<[number, FightEvent]> = []
  for (let k = 0; k < n; k++) {
    const in0 = k < motion.length ? motion[k] : NEU
    const r = step(s, [in0, def(k)])
    s = r.state
    for (const e of r.events) events.push([k, e])
  }
  return { state: s, events }
}

describe('projectile spawn and travel', () => {
  it('spawns exactly one ion-bolt owned by the caster, moving at the bolt speed', () => {
    let s = wardenRig(520)
    const motion = qcf('lp')
    // Step until the bolt appears.
    let spawnFrame = -1
    for (let k = 0; k < 20 && spawnFrame < 0; k++) {
      const in0 = k < motion.length ? motion[k] : NEU
      s = step(s, [in0, NEU]).state
      if (s.projectiles && s.projectiles.length > 0) spawnFrame = k
    }
    expect(spawnFrame).toBeGreaterThan(0)
    expect(s.projectiles).toHaveLength(1)
    const p = s.projectiles![0]
    expect(p.owner).toBe(0)
    expect(p.kind).toBe('ion-bolt')
    expect(p.facing).toBe(1)
    // Slow bolt is 5 cm/frame; facing +1 → +5 exactly.
    expect(p.vel.x).toBe(5)

    // Over the next 10 frames with no contact it advances by exactly 5/frame.
    const x0 = p.pos.x
    for (let k = 0; k < 10; k++) s = step(s, [NEU, NEU]).state
    expect(s.projectiles).toHaveLength(1)
    expect(s.projectiles![0].pos.x).toBeCloseTo(x0 + 50, 6)
  })

  it('the heavy bolt travels faster than the light bolt', () => {
    const speedOf = (btn: Button): number => {
      let s = wardenRig(520)
      const motion = qcf(btn)
      for (let k = 0; k < 20; k++) {
        const in0 = k < motion.length ? motion[k] : NEU
        s = step(s, [in0, NEU]).state
        if (s.projectiles && s.projectiles.length > 0) return s.projectiles[0].vel.x
      }
      return 0
    }
    expect(speedOf('lp')).toBe(5)
    expect(speedOf('hp')).toBe(9)
  })
})

describe('projectile contact', () => {
  it('a clean bolt deals exactly its scaled damage once, then despawns', () => {
    const s = wardenRig(520)
    const h0 = s.fighters[1].health
    const r = fireAt(s, 120, qcf('lp'), () => NEU)
    const hits = r.events.filter(([, e]) => e.type === 'hit')
    expect(hits).toHaveLength(1)
    // 50 base × COMBO_SCALING[0] (1.0) × move scaling 0.85 = 42.5 → 43.
    const hit = hits[0][1] as Extract<FightEvent, { type: 'hit' }>
    expect(hit.damage).toBe(43)
    expect(hit.attacker).toBe(0)
    expect(h0 - r.state.fighters[1].health).toBe(43)
    // Consumed on contact — not left flying.
    expect(r.state.projectiles ?? []).toHaveLength(0)
  })

  it('is blocked for chip only when the defender holds back', () => {
    const s = wardenRig(300)
    const h0 = s.fighters[1].health
    // Right-side defender: absolute 6 = relative back = block.
    const r = fireAt(s, 120, qcf('lp'), () => ({ dir: 6, held: new Set(), pressed: new Set() }))
    const kinds = r.events.map(([, e]) => e.type)
    expect(kinds).toContain('block')
    expect(kinds).not.toContain('hit')
    // Chip is exactly 8, and blocking still costs it — not zero.
    expect(h0 - r.state.fighters[1].health).toBe(8)
  })

  it('is parried on a fresh forward tap in the window: no damage, full parry meter', () => {
    // Find the impact frame first (clean), then tap forward just before it.
    const impactFrame = (() => {
      const probe = fireAt(wardenRig(300), 120, qcf('lp'), () => NEU)
      const hit = probe.events.find(([, e]) => e.type === 'hit')
      return hit ? hit[0] : -1
    })()
    expect(impactFrame).toBeGreaterThan(0)

    const s = wardenRig(300)
    const h0 = s.fighters[1].health
    const m0 = s.fighters[1].meter
    // Right-side defender parries forward with absolute 4 (= relative 6), a
    // single fresh tap two frames before impact.
    const tap = impactFrame - 2
    const r = fireAt(s, 120, qcf('lp'), (k) => (k === tap ? inp(4) : NEU))
    const kinds = r.events.map(([, e]) => e.type)
    expect(kinds).toContain('parry')
    expect(kinds).not.toContain('hit')
    expect(h0 - r.state.fighters[1].health).toBe(0)
    expect(r.state.fighters[1].meter - m0).toBe(PARRY_METER)
  })
})

describe('projectile despawn', () => {
  it('flies past a hurtbox-less target and despawns near the far wall', () => {
    const s = wardenRig(300)
    // A knocked-down opponent presents no hurtbox, so the bolt cannot connect
    // and must travel until it leaves the stage.
    s.fighters[1].stance = 'knockdown'
    s.fighters[1].stunRemaining = 999
    const motion = qcf('lp')
    let ever = false
    let maxX = -Infinity
    let gone = -1
    let cur = s
    for (let k = 0; k < 230; k++) {
      const in0 = k < motion.length ? motion[k] : NEU
      cur = step(cur, [in0, NEU]).state
      const n = cur.projectiles?.length ?? 0
      if (n > 0) {
        ever = true
        maxX = Math.max(maxX, cur.projectiles![0].pos.x)
      } else if (ever && gone < 0) {
        gone = k
      }
    }
    // It genuinely existed and flew (guards against a vacuous "never spawned").
    expect(ever).toBe(true)
    expect(maxX).toBeGreaterThan(480) // crossed the wall plane
    // And it is gone by the end — not stuck flying forever.
    expect(cur.projectiles ?? []).toHaveLength(0)
    // Crucially, it despawned by leaving the stage (~f140), NOT by its `life`
    // timer running out (~f215). Asserting a tight upper bound isolates the
    // off-stage despawn: without it the bolt survives to life-expiry and this
    // fails, so the test can't pass on the wrong code path.
    expect(gone).toBeGreaterThan(0)
    expect(gone).toBeLessThan(180)
  })
})

describe('the Warden is a distinct zoner archetype', () => {
  it('carries a projectile table, is frailer, and has no dragon punch', () => {
    // Only the zoner spawns fireballs.
    expect(WARDEN.projectiles).toBeDefined()
    expect(Object.keys(WARDEN.projectiles!).length).toBeGreaterThanOrEqual(2)
    expect(OPERATOR.projectiles).toBeUndefined()
    expect(VANGUARD.projectiles).toBeUndefined()
    // Fragile: below the shoto's health.
    expect(WARDEN.health).toBeLessThan(OPERATOR.health)
    // No invincible reversal in the kit — a real zoner weakness.
    const hasReversal = Object.values(WARDEN.moves).some((m) =>
      m.frames.some((fr) => fr.invuln === 'full' || fr.invuln === 'strike'),
    )
    expect(hasReversal).toBe(false)
  })

  it('produces a deterministic fireball fight: same seed replays byte-for-byte', () => {
    const run = (seed: number): { hash: string; sawProjectile: boolean } => {
      const h = new HarnessSim({ seed, p1: 'warden', p2: 'operator' })
      let sawProjectile = false
      let last = ''
      for (let k = 0; k < 1200; k++) {
        const r = h.step()
        if ((r.state.projectiles?.length ?? 0) > 0) sawProjectile = true
        last = JSON.stringify(r.state)
      }
      return { hash: last, sawProjectile }
    }
    const a = run(0x1234)
    const b = run(0x1234)
    // The fight must actually throw fireballs, or "determinism" is vacuous.
    expect(a.sawProjectile).toBe(true)
    expect(a.hash).toBe(b.hash)
    // A different seed diverges — the harness isn't ignoring the seed.
    const c = run(0x9999)
    expect(a.hash).not.toBe(c.hash)
  })
})
