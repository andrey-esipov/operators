import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { FightVfx, type FightVfxDeps } from '../FightVfx'
import type { FightEvent, HitLevel } from '../../../fight/types'

/**
 * The counter-hit flourish is a bright ADDITIVE overlay, so a pixel diff can
 * never prove it (a new magenta ring is a NEW object — nothing to difference
 * against). Instead we drive real `FightEvent`s through the real switch with
 * recording mock deps and assert on the CALLS the class makes. Every assertion
 * is written so that deleting the `counter-hit` case, or turning it into a
 * second hit, turns a claim red — that is the mutation proof.
 */

interface Rec {
  shockwaves: { mode: string; size: number; color: THREE.Color; color2: THREE.Color; intensity: number }[]
  bursts: { count: number; color: THREE.Color; color2: THREE.Color; intensity: number }[]
  hitstops: number[]
  engineEmits: number[]
  flashes: number[]
}

function makeDeps(): { deps: FightVfxDeps; rec: Rec } {
  const rec: Rec = { shockwaves: [], bursts: [], hitstops: [], engineEmits: [], flashes: [] }
  const fighter = {
    // Only fields counterHit/hit could touch; recorded so we can prove the
    // counter does NOT flash the defender (that belongs to the paired hit).
    triggerHitFlash: (v: number) => rec.flashes.push(v),
    mesh: { position: new THREE.Vector3() },
    bodyWidth: 1,
    chestAnchor: () => new THREE.Vector3(),
    setDissolve: () => {},
  }
  const deps = {
    additive: { emit: (o: Record<string, unknown>) => rec.bursts.push({
      count: o.count as number, color: o.color as THREE.Color,
      color2: o.color2 as THREE.Color, intensity: o.intensity as number }) },
    alpha: { emit: () => {} },
    shockwave: { spawn: (mode: string, _p: unknown, size: number, _d: number,
      color: THREE.Color, color2: THREE.Color, intensity = 1) =>
      rec.shockwaves.push({ mode, size, color, color2, intensity }) },
    impact: { spawn: () => {} },
    fighters: [fighter, fighter],
    camera: { addShake: () => {}, punchIn: () => {} },
    requestHitstop: (ms: number) => rec.hitstops.push(ms),
    emitEngine: () => rec.engineEmits.push(1),
  } as unknown as FightVfxDeps
  return { deps, rec }
}

const counter = (level: HitLevel = 'medium'): FightEvent =>
  ({ type: 'counter-hit', at: { x: 0, y: 100 }, attacker: 0, level, damage: 40 })

/** Magenta family: red + blue both present, green suppressed. Robust across
 *  sRGB and linear colour-management, and distinct from hit-orange (green high),
 *  block/parry-cyan (red low) and white (green high). */
function isMagenta(c: THREE.Color): boolean {
  return c.r > 0.6 && c.b > 0.12 && c.g < 0.5 * c.b && c.g < 0.5 * c.r
}

describe('counter-hit flourish', () => {
  it('fires a visible flourish (ring + star + shards) on a counter', () => {
    const { deps, rec } = makeDeps()
    new FightVfx(deps).handle(counter())
    // If the switch case is removed, handle() returns undefined and nothing
    // spawns — both of these go red.
    expect(rec.shockwaves.length).toBeGreaterThanOrEqual(2)
    expect(rec.bursts.length).toBeGreaterThanOrEqual(1)
  })

  it('uses the signature magenta hue (distinct from hit/block/parry)', () => {
    const { deps, rec } = makeDeps()
    new FightVfx(deps).handle(counter())
    const cols = [
      ...rec.shockwaves.flatMap((s) => [s.color, s.color2]),
      ...rec.bursts.flatMap((b) => [b.color, b.color2]),
    ]
    // Retuning the callout to orange/white/cyan (i.e. losing its distinct read)
    // turns this red.
    expect(cols.some(isMagenta)).toBe(true)
  })

  it('is a pure visual overlay: no second freeze, light flash, or defender flash', () => {
    const { deps, rec } = makeDeps()
    new FightVfx(deps).handle(counter())
    // The paired `hit` event already fired all of these this frame. Doubling any
    // of them over-freezes or over-lights (the fighter-wash regression). If the
    // counter were ever implemented by calling hit(), these would be non-zero.
    expect(rec.hitstops).toHaveLength(0)
    expect(rec.engineEmits).toHaveLength(0)
    expect(rec.flashes).toHaveLength(0)
  })

  it('stays on a modest particle budget so it never washes the fighters', () => {
    const { deps, rec } = makeDeps()
    new FightVfx(deps).handle(counter('launcher'))
    const total = rec.bursts.reduce((n, b) => n + b.count, 0)
    // Well under a single clean hit's spark budget (launcher hit = 72). A guard,
    // not a description: bloating the counter burst past a hit trips it.
    expect(total).toBeLessThan(40)
    for (const s of rec.shockwaves) expect(s.intensity).toBeLessThan(2)
  })

  it('scales the ring with hit weight (a launcher-counter reads bigger)', () => {
    // Two runs differ only by level → the callout ring the counter spawns must
    // grow with weight. Proves w.core is actually read, not ignored.
    const light = makeDeps(); new FightVfx(light.deps).handle(counter('light'))
    const heavy = makeDeps(); new FightVfx(heavy.deps).handle(counter('launcher'))
    const ringSize = (r: Rec) => r.shockwaves.find((s) => s.mode === 'shock')?.size ?? 0
    expect(ringSize(heavy.rec)).toBeGreaterThan(ringSize(light.rec))
    expect(heavy.rec.shockwaves.some((s) => isMagenta(s.color2) || isMagenta(s.color))).toBe(true)
  })
})
