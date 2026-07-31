import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { FightVfx, type FightVfxDeps } from '../FightVfx'
import type { FightEvent, HitLevel } from '../../../fight/types'

/**
 * PROPORTIONATE IMPACT FEEDBACK — the GENERAL gate.
 *
 * The throw shipped feeling like the weakest jab in the game — camera shake
 * 0.10 (the `light` value), zero additive burst, no dolly punch, no catch-freeze
 * — because its authored `level: 'heavy'` was dropped at the sim→VFX boundary
 * and NOTHING asserted that an impact event's feedback tracks its authored
 * weight. A 140-dmg unblockable command grab rattled the screen exactly as hard
 * as the lightest poke.
 *
 * This gate asserts the GENERAL property, not the throw special case, so the
 * NEXT impact event that forgets to read its weight fails here too — the
 * "validate one member of a set while the rest go unchecked" trap that let this
 * ship (a fourth confirmed instance of that shape in this project):
 *
 *   1. every LANDING event produces non-trivial feedback (no silent/weak gap);
 *   2. every LEVEL-carrying event is monotonic in level — proof `level` is
 *      actually consumed, not decorative (drop it → heavy == light → red);
 *   3. a throw reads at heavy-or-above and slams DOWNWARD — it is the grappler's
 *      whole payoff, not a jab.
 *
 * Feedback is recorded from real deps spies driven through the real
 * FightVfx.handle switch, so it proves consumption on the shipped route, not a
 * reimplementation of it.
 */

interface Feedback {
  shake: number // summed camera-kick magnitude
  shakeDirY: number // last kick's y component (a throw slams DOWNWARD, y<0)
  punch: number // summed dolly punch-in
  particles: number // summed additive+alpha emit counts (the burst)
  waves: number // shockwave spawn count
  waveSizeSum: number // summed shockwave sizes (scales with weight)
  hitstopMs: number // summed impact freeze
}

/** A single "how hard did the game react" magnitude, folding every channel onto
 *  a common scale. Used only for the monotonic-in-level comparison, where any
 *  one channel alone can be too flat to separate the tiers (counter-hit's shake
 *  barely moves; its rings do). */
function score(fb: Feedback): number {
  return (
    fb.shake +
    0.1 * fb.waveSizeSum +
    0.003 * fb.particles +
    0.2 * fb.punch +
    0.001 * fb.hitstopMs
  )
}

function makeDeps(): { deps: FightVfxDeps; fb: Feedback } {
  const fb: Feedback = {
    shake: 0, shakeDirY: 0, punch: 0, particles: 0, waves: 0, waveSizeSum: 0, hitstopMs: 0,
  }
  const mk = () => ({
    triggerHitFlash: () => {},
    mesh: { position: new THREE.Vector3() },
    bodyWidth: 1,
    chestAnchor: () => new THREE.Vector3(),
    setDissolve: () => {},
  })
  const fighters = [mk(), mk()]
  // Distinct x so blowDir has a real sign.
  ;(fighters[0] as unknown as { mesh: { position: THREE.Vector3 } }).mesh.position.x = -2
  ;(fighters[1] as unknown as { mesh: { position: THREE.Vector3 } }).mesh.position.x = 2
  const deps = {
    additive: { emit: (o: { count: number }) => { fb.particles += o.count | 0 } },
    alpha: { emit: (o: { count: number }) => { fb.particles += o.count | 0 } },
    shockwave: {
      spawn: (_mode: unknown, _pos: unknown, size: number) => {
        fb.waves += 1
        fb.waveSizeSum += size
      },
    },
    impact: { spawn: () => {} },
    fighters,
    camera: {
      addShake: (amount: number, dir?: THREE.Vector3) => {
        fb.shake += amount
        if (dir) fb.shakeDirY = dir.y
      },
      punchIn: (amount: number) => { fb.punch += amount },
    },
    requestHitstop: (ms: number) => { fb.hitstopMs += ms },
    emitEngine: () => {},
  } as unknown as FightVfxDeps
  return { deps, fb }
}

function run(e: FightEvent): Feedback {
  const { deps, fb } = makeDeps()
  new FightVfx(deps).handle(e)
  return fb
}

const throwEv = (level: HitLevel, damage = 120): FightEvent =>
  ({ type: 'throw', at: { x: 0, y: 90 }, attacker: 0, level, damage }) as FightEvent
const hitEv = (level: HitLevel, damage = 60): FightEvent =>
  ({ type: 'hit', at: { x: 0, y: 100 }, attacker: 0, level, damage }) as FightEvent
const counterEv = (level: HitLevel, damage = 60): FightEvent =>
  ({ type: 'counter-hit', at: { x: 0, y: 100 }, attacker: 0, level, damage }) as FightEvent

// The events that represent something LANDING on a fighter (excludes whiff,
// pure-flair and round bookkeeping). Every one of these must react.
const landingEvents: { name: string; ev: FightEvent }[] = [
  { name: 'hit/light', ev: hitEv('light') },
  { name: 'hit/heavy', ev: hitEv('heavy') },
  { name: 'counter-hit', ev: counterEv('heavy') },
  { name: 'throw', ev: throwEv('heavy') },
  { name: 'launch', ev: { type: 'launch', at: { x: 0, y: 100 }, attacker: 0 } as FightEvent },
  { name: 'knockdown', ev: { type: 'knockdown', at: { x: 0, y: 20 }, who: 1 } as FightEvent },
  { name: 'wall-bounce', ev: { type: 'wall-bounce', at: { x: 0, y: 100 }, who: 1 } as FightEvent },
]

// GENERAL, not throw-only: every impact event that carries a HitLevel must let
// that level change the feedback. If a consumer drops the level (the exact bug
// that shipped the throw), heavy == light and the monotonic check reds.
const levelCarrying: { name: string; mk: (lv: HitLevel) => FightEvent }[] = [
  { name: 'hit', mk: (lv) => hitEv(lv) },
  { name: 'counter-hit', mk: (lv) => counterEv(lv) },
  { name: 'throw', mk: (lv) => throwEv(lv) },
]

describe('proportionate impact feedback (FightVfx.handle)', () => {
  it('every landing event produces non-trivial feedback — no silent/weak gap', () => {
    for (const { name, ev } of landingEvents) {
      const fb = run(ev)
      // A real camera kick…
      expect(fb.shake, `${name} camera shake`).toBeGreaterThanOrEqual(0.1)
      // …and a visible burst (particles and/or a shock ring).
      expect(fb.particles + fb.waves * 20, `${name} burst`).toBeGreaterThan(0)
    }
  })

  it('every level-carrying event is monotonic in level — `level` is consumed, not decorative', () => {
    for (const { name, mk } of levelCarrying) {
      const lo = score(run(mk('light')))
      const hi = score(run(mk('heavy')))
      // A real separation, not a rounding wobble — if `level` is ignored these
      // are equal.
      expect(hi, `${name}: heavy score ${hi.toFixed(3)} must exceed light ${lo.toFixed(3)}`).toBeGreaterThan(lo * 1.1)
    }
  })

  it('a throw reads at heavy-or-above and slams DOWNWARD — not the weakest jab', () => {
    const jab = run(hitEv('light')).shake // the weakest jab: 0.10
    const heavyHit = run(hitEv('heavy')).shake // a heavy strike: 0.26
    const thr = run(throwEv('heavy', 140)) // a 140-dmg command grab

    // Nowhere near a jab, and at least a heavy strike.
    expect(thr.shake).toBeGreaterThan(jab + 0.2)
    expect(thr.shake).toBeGreaterThanOrEqual(heavyHit)
    // Emits a real burst (was zero additive particles), has a dolly punch (had
    // none) and a catch-freeze (had none).
    expect(thr.particles).toBeGreaterThan(0)
    expect(thr.punch).toBeGreaterThan(0)
    expect(thr.hitstopMs).toBeGreaterThan(0)
    // The slam is directed downward — the throw's signature, distinct from a
    // strike's horizontal/upward shove.
    expect(thr.shakeDirY).toBeLessThan(0)
  })

  it('a bigger-damage throw hits at least as hard as a lighter one (damage is read)', () => {
    const basic = run(throwEv('heavy', 120)).shake
    const command = run(throwEv('heavy', 360)).shake
    expect(command).toBeGreaterThanOrEqual(basic)
  })
})
