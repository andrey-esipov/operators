/**
 * HITSTOP WEIGHT COHERENCE — the tactile half of impact weight, across ALL three
 * archetypes, plus the counter-hit freeze, driven through the running sim.
 *
 * WHY THIS FILE EXISTS. `impact.test.ts` locks the hitstop ladder (light 10 <
 * medium 12 < heavy 14) but ONLY for the operator — it runs `createFight(
 * 'operator','operator')` and tests lp/mp/hp. That is the canonical lying-harness
 * shape this project has been burned by repeatedly: a guard that validates the
 * one character it imported while the others could be flat or inverted and
 * nothing would red. Vanguard and Warden hitstop, and the counter-hit bonus that
 * is the single most important weight signal (SF6/Tekken/GGST all freeze harder
 * on a counter), had NO test at all. This file turns the whole weight hierarchy
 * into asserted, mutation-proved law.
 *
 * CALIBRATION (external reference, aaa-targets / _reference-research.md):
 *   - SF6 contact-freeze bands: light ~9-11f, medium ~11-13f, heavy ~13-16f.
 *   - GGST (published, heavier): L1 12 / L2 14 / L3 16 / L4 19 / L5 21.
 *   - Counter emphasis: GGST mid CH +8f / large CH +16f; SF6 punish counter +3-6f.
 * The ladder was RAISED into the SF6 band (operator/warden 10 / 12 / 14, and the
 * grappler vanguard heavier at 10 / 13 / 15) with a +6 counter bonus — the
 * "original Street Fighter lineage, snappier than GGST" read the project is going
 * for: in-band with SF6, deliberately short of GGST's exaggeration. The counter
 * bonus landed at +8 first, which is GGST's mid-CH number, not SF6's: it put a
 * heavy counter at 23f (383ms) against an SF6 punish-counter band of +3-6f. Held
 * to +6 — the top of that band — because the anchor decides ties, and quietly
 * importing Strive's emphasis while calling it an SF read is how a house style
 * drifts. The previous 8 / 9 / 11 with a +4 counter sat BELOW both bands (under
 * SF6's own light and heavy floors) and read as systematically weightless. These
 * asserts pin the raised calibration, so a drift back toward flat/cheap OR up
 * into GGST-wide is caught.
 *
 * METHOD (identical primitive to impact.test.ts): press the move point-blank
 * through the real sim, read `s.hitstop` on the frame the `hit` event fires.
 * Hitstop is a sim value, so this measures what actually freezes the world, not
 * the authored annotation. Every helper asserts the hit CONNECTED, so a move
 * that whiffs can't make an assertion pass silently.
 *
 * MUTATION-PROVEN (each done in-place, red confirmed, restored byte-identical):
 *   - flatten vanguard st.HP hitstop 15 -> 12 (dropping it below operator's 14):
 *     the vanguard exact-ladder + the "grappler hits heaviest" anchor go red, and
 *     operator-only impact.test.ts stays green — exactly the blind spot this file
 *     closes.
 *   - COUNTER_HITSTOP_BONUS 6 -> 0: every counter assertion reds across all three
 *     archetypes, and the felt-floor guard reds too.
 *   - COUNTER_HITSTOP_BONUS 6 -> 5: the felt-floor guard reds. The floor sits
 *     exactly ON the shipped value, so the constant cannot be tuned down at all
 *     without going red — "barely perceptible" is now unreachable by drift, and
 *     any future reduction has to argue with a failing test rather than slip
 *     through as a one-character edit.
 *   - warden fireball projectile hitstop 13 -> 11 (below its medium normal 12):
 *     the projectile-weight assertion reds (the zoner's spacing tool goes light).
 */
import { describe, expect, it } from 'vitest'
import { createFight, step } from '../sim'
import { COUNTER_HITSTOP_BONUS } from '../constants'
import type { FightState, InputFrame, Button } from '../types'

type CharId = 'operator' | 'vanguard' | 'warden'

function inp(dir: number, ...btns: Button[]): InputFrame {
  const s = new Set<Button>(btns)
  return { dir: dir as never, held: s, pressed: s }
}

/** Point-blank same-char rig: gap 66 so the first active frame connects, the
 *  spacing frame data is quoted at (matches framedata.coherence.test.ts). */
function rig(id: CharId): FightState {
  const s = createFight(id, id)
  s.phase = 'fight'
  s.phaseTimer = 0
  s.fighters[0].pos.x = -20
  s.fighters[0].facing = 1
  s.fighters[1].pos.x = 46
  s.fighters[1].facing = -1
  return s
}

/** Land one grounded normal vs a neutral dummy; return the freeze and whether a
 *  counter fired (it must not — the dummy is idle). Asserts the hit connected. */
function landHitstop(id: CharId, btn: Button): number {
  let s = rig(id)
  for (let f = 0; f < 40; f++) {
    const r = step(s, [f === 0 ? inp(5, btn) : inp(5), inp(5)])
    s = r.state
    if (r.events.some((e) => e.type === 'hit')) {
      expect(r.events.some((e) => e.type === 'counter-hit'), `${id} ${btn} vs idle must not counter`).toBe(false)
      return s.hitstop
    }
  }
  throw new Error(`${id} ${btn} never connected`)
}

/** Force a counter: attacker jab (fast) and defender a slow heavy on the same
 *  frame. The jab beats the heavy's startup, so it lands as a counter. Returns
 *  the freeze; asserts the counter actually fired (so a timing regression that
 *  turned it into a clean hit can't let the +bonus assertion pass on 10==10). */
function landCounterHitstop(id: CharId, fast: Button, slow: Button): number {
  let s = rig(id)
  for (let f = 0; f < 40; f++) {
    const r = step(s, [f === 0 ? inp(5, fast) : inp(5), f === 0 ? inp(5, slow) : inp(5)])
    s = r.state
    if (r.events.some((e) => e.type === 'hit')) {
      expect(r.events.some((e) => e.type === 'counter-hit'), `${id} ${fast} must counter ${slow}'s startup`).toBe(true)
      return s.hitstop
    }
  }
  throw new Error(`${id} counter ${fast} never connected`)
}

/** Fire a projectile and read the freeze when it hits the far dummy. Asserts a
 *  hit landed (the projectile is the only thing that can — the move carries no
 *  melee hitbox). */
function landProjectileHitstop(id: CharId, motion: number[], btn: Button): number {
  let s = createFight(id, id)
  s.phase = 'fight'
  s.phaseTimer = 0
  s.fighters[0].pos.x = -120
  s.fighters[0].facing = 1
  s.fighters[1].pos.x = 120
  s.fighters[1].facing = -1
  for (let f = 0; f < 200; f++) {
    let in0: InputFrame = inp(5)
    if (f < motion.length) in0 = inp(motion[f], ...(f === motion.length - 1 ? [btn] : []))
    const r = step(s, [in0, inp(5)])
    s = r.state
    if (r.events.some((e) => e.type === 'hit')) return s.hitstop
  }
  throw new Error(`${id} projectile ${btn} never connected`)
}

describe('hitstop weight ladder — every archetype (not just operator)', () => {
  // Exact authored freeze per archetype, measured through the sim. Teeth: a
  // silent flatten of any tier reds a specific line here.
  const EXPECT: Record<CharId, [number, number, number]> = {
    operator: [10, 12, 14],
    vanguard: [10, 13, 15],
    warden: [10, 12, 14],
  }

  for (const id of ['operator', 'vanguard', 'warden'] as CharId[]) {
    it(`${id}: light < medium < heavy, strictly increasing (exact frames)`, () => {
      const l = landHitstop(id, 'lp')
      const m = landHitstop(id, 'mp')
      const h = landHitstop(id, 'hp')
      expect([l, m, h]).toEqual(EXPECT[id])
      expect(l).toBeLessThan(m)
      expect(m).toBeLessThan(h)
    })
  }

  it('grappler identity: vanguard freezes heavier than the shoto at medium AND heavy', () => {
    // The grappler's normals hit with more weight — a concrete, readable
    // archetype anchor that a "one moveset, different numbers" regression breaks.
    expect(landHitstop('vanguard', 'mp')).toBeGreaterThan(landHitstop('operator', 'mp'))
    expect(landHitstop('vanguard', 'hp')).toBeGreaterThan(landHitstop('operator', 'hp'))
  })
})

describe('counter-hit freezes harder — the tactile half of the counter reward', () => {
  // A counter that does not hit the brakes harder reads as a normal hit no
  // matter what the HUD says. This is proven for ALL three archetypes so the
  // reward can never silently apply to only the character a test imported.
  for (const id of ['operator', 'vanguard', 'warden'] as CharId[]) {
    it(`${id}: counter jab freezes exactly COUNTER_HITSTOP_BONUS longer than a clean jab`, () => {
      const clean = landHitstop(id, 'lp')
      const counter = landCounterHitstop(id, 'lp', 'hp')
      expect(counter).toBe(clean + COUNTER_HITSTOP_BONUS)
      expect(counter).toBeGreaterThan(clean)
    })
  }

  it('the bonus is a real, felt amount — a distinctly bigger event, not a tick', () => {
    // Guards the constant from being tuned back down into the noise floor. The
    // old +4 sat inside a normal hit's perceptual range and read as "barely
    // there"; the calibrated value is +8 (GGST mid counter-hit emphasis). Floor
    // at 6 (the top of SF6's +3-6 punish-counter range) so a regression toward
    // the imperceptible +3-4 reds — that drift is exactly what this raise fixed,
    // so the guard must forbid it, not merely rubber-stamp any positive number.
    expect(COUNTER_HITSTOP_BONUS).toBeGreaterThanOrEqual(6)
  })
})

describe('zoner weight lives on the projectile, not the (empty) move', () => {
  it('warden fireball freezes with real weight — above its own medium normal', () => {
    // The move that throws the fireball carries no melee hitbox (hitstop 0 on the
    // move); the freeze the player feels is authored on the PROJECTILE. A naive
    // move-only ladder test would read 0 here and miss the zoner entirely.
    const fireball = landProjectileHitstop('warden', [2, 3, 6], 'lp')
    const medium = landHitstop('warden', 'mp')
    expect(fireball).toBeGreaterThan(0)
    expect(fireball).toBeGreaterThanOrEqual(medium)
  })
})
