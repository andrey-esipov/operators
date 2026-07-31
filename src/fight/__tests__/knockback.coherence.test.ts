/**
 * Horizontal knockback must read as WEIGHT for EVERY archetype — not just the
 * operator that impact.test.ts and knockback.test.ts happen to instantiate.
 *
 * Why this file exists: displacement is `kbx * KB_X_SCALE[level]` (build.ts
 * mkHit), and `kbx` is authored PER MOVE, PER ARCHETYPE (operator st.HP 2.2,
 * vanguard st.HP 2.4, warden st.HP 2.0). The two existing horizontal guards pin
 * only the operator's values, so collapsing the grappler's signature heavy shove
 * (vanguard st.HP kbx 2.4 -> 0.3, an 87% nerf) left the ENTIRE suite green —
 * measured, not assumed. That is the same "validated one member of a set" shape
 * the project keeps re-shipping, so this closes it at the roster level: the loop
 * is `describe.each(ROSTER)`, so a fourth fighter is covered the day it lands.
 *
 * TEETH (mutation-proven, see report):
 *  - vanguard st.HP kbx 2.4 -> 0.3  -> heavy falls below medium -> monotonicity
 *    AND the heavy-shove floor red for `vanguard` (green before this file).
 *  - warden  st.HP kbx 2.0 -> 0.3  -> same, for `warden`.
 * The thresholds (heavy >= 40, light < 20) match knockback.test.ts's already-
 * mutation-justified operator floors, so they read as a shove/poke for all three
 * without hard-coding brittle per-archetype bands that legitimate tuning trips.
 */
import { describe, expect, it } from 'vitest'
import { createFight, step } from '../sim'
import type { FightState, InputFrame, Button } from '../types'
import { ROSTER } from './roster'

function inp(dir: number, ...btns: Button[]): InputFrame {
  const s = new Set<Button>(btns)
  return { dir: dir as never, held: s, pressed: s }
}

/** Land one clean grounded normal at point-blank in a mirror match; return the
 *  victim's horizontal displacement from the contact frame to rest. Identical
 *  measurement to impact.test.ts, but parametrised over the attacker archetype so
 *  we read each fighter's OWN authored kbx rather than the operator's. */
function horiz(p: string, btn: Button): number {
  let s: FightState = createFight(p, p)
  s.phase = 'fight'; s.phaseTimer = 0
  s.fighters[0].pos.x = 0; s.fighters[0].facing = 1
  s.fighters[1].pos.x = 66; s.fighters[1].facing = -1
  let cV = 0, hitFrame = -1
  for (let f = 0; f < 40; f++) {
    const r = step(s, [f === 0 ? inp(5, btn) : inp(5), inp(5)])
    s = r.state
    if (hitFrame < 0 && r.events.some(e => e.type === 'hit')) {
      hitFrame = f; cV = s.fighters[1].pos.x
    }
  }
  if (hitFrame < 0) return -1
  return s.fighters[1].pos.x - cV
}

describe.each(ROSTER)('horizontal knockback reads as weight — %s', (p) => {
  const light = horiz(p, 'lp')
  const medium = horiz(p, 'mp')
  const heavy = horiz(p, 'hp')

  it('all three grounded normals connect at point-blank', () => {
    expect(light, 'lp must connect').toBeGreaterThan(0)
    expect(medium, 'mp must connect').toBeGreaterThan(0)
    expect(heavy, 'hp must connect').toBeGreaterThan(0)
  })

  it('displacement is strictly monotonic light < medium < heavy', () => {
    // The per-archetype teeth: collapsing THIS fighter's heavy kbx drops the
    // heavy below the medium and reds here, where impact.test.ts (operator only)
    // stays green.
    expect(light).toBeLessThan(medium)
    expect(medium).toBeLessThan(heavy)
  })

  it('a heavy reads as a shove (>= 40 units) for this archetype', () => {
    expect(heavy).toBeGreaterThanOrEqual(40)
  })

  it('a light stays a poke (< 20 units) — kbx not flattened to a global multiply', () => {
    expect(light).toBeLessThan(20)
  })
})
