import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { FightVfx, type FightVfxDeps } from '../FightVfx'
import type { FightEvent, HitLevel } from '../../../fight/types'

/**
 * The bold impact-frame mark is a NEW additive object drawn on top of the
 * particle burst, so — like the counter-hit flourish — a pixel diff can't prove
 * it. We drive real `hit` events through the real FightVfx switch with recording
 * mock deps and assert on the exact `impact.spawn(...)` calls. Every assertion is
 * written so the failure mode it guards would satisfy NO weaker claim:
 *   - drop the emit  → "one mark per hit" goes red
 *   - flatten weights → "heavy larger than light" goes red
 *   - collapse marks  → "distinct mark per weight" goes red
 *   - white the tint  → "channel-weighted, not white orb" goes red
 *   - drop orientation → "left/right hit face opposite" goes red
 * This is the proof the mark is CONSUMED at the sim→VFX boundary, and tuned.
 */

interface Spawned {
  pos: THREE.Vector3
  mark: number
  size: number
  angle: number
  tint: THREE.Color
  intensity: number
  life: number
}

function makeDeps(): { deps: FightVfxDeps; marks: Spawned[] } {
  const marks: Spawned[] = []
  // Two DISTINCT fighters with settable positions so blowDir has a real sign.
  const mk = () => ({
    triggerHitFlash: () => {},
    mesh: { position: new THREE.Vector3() },
    bodyWidth: 1,
    chestAnchor: () => new THREE.Vector3(),
    setDissolve: () => {},
  })
  const fighters = [mk(), mk()]
  const deps = {
    additive: { emit: () => {} },
    alpha: { emit: () => {} },
    shockwave: { spawn: () => {} },
    impact: {
      spawn: (
        pos: THREE.Vector3,
        mark: number,
        size: number,
        angle: number,
        tint: THREE.Color,
        intensity: number,
        life: number,
      ) => marks.push({ pos: pos.clone(), mark, size, angle, tint: tint.clone(), intensity, life }),
    },
    fighters,
    camera: { addShake: () => {}, punchIn: () => {} },
    requestHitstop: () => {},
    emitEngine: () => {},
  } as unknown as FightVfxDeps
  return { deps, marks }
}

const hit = (level: HitLevel, atX = 0): FightEvent =>
  ({ type: 'hit', at: { x: atX, y: 100 }, attacker: 0, level, damage: 60 }) as FightEvent

/** Warm HDR tint: red pushed past 1, blue pinned low — additive+bloom saturate
 *  it ORANGER, not to a featureless white orb (the Ion Storm lesson). */
function isWarmHDR(c: THREE.Color): boolean {
  return c.r > 1 && c.b < c.r && c.b < 0.6
}
/** Cool HDR tint: blue pushed past 1, red suppressed — saturates BLUER. */
function isCoolHDR(c: THREE.Color): boolean {
  return c.b > 1 && c.r < c.b && c.r < 1
}

describe('impact-frame mark (FightVfx.hit → impact.spawn)', () => {
  it('emits exactly one bold mark per hit — it is consumed, not dropped', () => {
    const { deps, marks } = makeDeps()
    new FightVfx(deps).handle(hit('medium'))
    expect(marks).toHaveLength(1)
  })

  it('scales with weight: a jab and a heavy do NOT stamp the same size', () => {
    const light = makeDeps(); new FightVfx(light.deps).handle(hit('light'))
    const heavy = makeDeps(); new FightVfx(heavy.deps).handle(hit('heavy'))
    const crumple = makeDeps(); new FightVfx(crumple.deps).handle(hit('crumple'))
    const l = light.marks[0].size
    const h = heavy.marks[0].size
    const c = crumple.marks[0].size
    // Ordered and separated by a real margin, not a rounding wobble.
    expect(h).toBeGreaterThan(l + 0.5)
    expect(c).toBeGreaterThan(h)
    // And an order of magnitude larger than a single spark particle (~0.13–0.24)
    // — the whole point of a bold single mark vs a spray of fine dots.
    expect(l).toBeGreaterThan(0.6)
  })

  it('picks a distinct mark per weight (per the sheet contract)', () => {
    const levels: HitLevel[] = ['light', 'medium', 'heavy', 'launcher', 'sweep']
    const idx = levels.map((lv) => {
      const d = makeDeps(); new FightVfx(d.deps).handle(hit(lv))
      return d.marks[0].mark
    })
    // light→0 medium→1 heavy→2 launcher→4 sweep→3 — five different glyphs.
    expect(new Set(idx).size).toBe(5)
    expect(idx).toEqual([0, 1, 2, 4, 3])
  })

  it('is short-lived — a held impact frame (~2–8 frames), never a lingering smear', () => {
    const levels: HitLevel[] = ['light', 'medium', 'heavy', 'launcher', 'sweep', 'crumple']
    for (const lv of levels) {
      const d = makeDeps(); new FightVfx(d.deps).handle(hit(lv))
      const life = d.marks[0].life
      expect(life).toBeGreaterThanOrEqual(2 / 60) // ≥2 frames
      expect(life).toBeLessThanOrEqual(8 / 60) // ≤8 frames
    }
  })

  it('orients to the blow — left- and right-facing hits face opposite ways', () => {
    // attacker 0 on the LEFT of target 1 → blow points +x → cos(angle) > 0.
    const leftAtk = makeDeps()
    ;(leftAtk.deps.fighters[0] as unknown as { mesh: { position: THREE.Vector3 } }).mesh.position.x = -2
    ;(leftAtk.deps.fighters[1] as unknown as { mesh: { position: THREE.Vector3 } }).mesh.position.x = 2
    new FightVfx(leftAtk.deps).handle(hit('heavy'))
    // attacker 0 on the RIGHT of target 1 → blow points -x → cos(angle) < 0.
    const rightAtk = makeDeps()
    ;(rightAtk.deps.fighters[0] as unknown as { mesh: { position: THREE.Vector3 } }).mesh.position.x = 2
    ;(rightAtk.deps.fighters[1] as unknown as { mesh: { position: THREE.Vector3 } }).mesh.position.x = -2
    new FightVfx(rightAtk.deps).handle(hit('heavy'))
    expect(Math.cos(leftAtk.marks[0].angle)).toBeGreaterThan(0)
    expect(Math.cos(rightAtk.marks[0].angle)).toBeLessThan(0)
  })

  it('tints channel-weighted, never a featureless white orb (Ion Storm lesson)', () => {
    const warm: HitLevel[] = ['light', 'medium', 'heavy', 'sweep', 'crumple']
    for (const lv of warm) {
      const d = makeDeps(); new FightVfx(d.deps).handle(hit(lv))
      const t = d.marks[0].tint
      expect(isWarmHDR(t)).toBe(true)
      // The failure that made the super a white orb was ALL channels >1. Assert
      // at least one channel stays below 1 for every weight.
      expect(Math.min(t.r, t.g, t.b)).toBeLessThan(1)
    }
    // The launcher is the deliberate cool counter-example — blue past 1, red low.
    const launch = makeDeps(); new FightVfx(launch.deps).handle(hit('launcher'))
    const lt = launch.marks[0].tint
    expect(isCoolHDR(lt)).toBe(true)
    expect(Math.min(lt.r, lt.g, lt.b)).toBeLessThan(1)
  })
})
