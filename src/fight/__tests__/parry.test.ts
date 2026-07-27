/**
 * Parry — the defining mechanic of our Third Strike reference point. Tap toward
 * a high/overhead (or straight down for a low) in a tight window just before it
 * lands: take zero damage, bank meter, and come out plus enough to punish.
 *
 * Note on directions: the defender here is fighter[1] on the RIGHT, facing left,
 * so its *relative forward* (toward the opponent) is absolute direction 4. Down
 * is facing-symmetric, so a low parry is absolute 2 for either side. The helpers
 * feed absolute directions, hence `hold(4)` for a high parry below.
 *
 * Every assertion was mutation-checked (see the report): disabling parry, taxing
 * the parrier with damage, or letting a held direction re-parry all turn a test
 * red.
 */

import { describe, expect, it } from 'vitest'
import { step, fighterCanAct } from '../sim'
import { PARRY_METER } from '../constants'
import { fightAtRange, hold, inp, NEU } from './helpers'
import type { FightEvent, FightState, InputFrame } from '../types'

function play(
  s: FightState, n: number, f0: (k: number) => InputFrame, f1: (k: number) => InputFrame,
): { state: FightState; events: FightEvent[]; byFrame: FightEvent[][] } {
  let cur = s
  const events: FightEvent[] = []
  const byFrame: FightEvent[][] = []
  for (let k = 0; k < n; k++) {
    const r = step(cur, [f0(k), f1(k)])
    cur = r.state
    events.push(...r.events)
    byFrame.push(r.events)
  }
  return { state: cur, events, byFrame }
}

const types = (es: FightEvent[]): string[] => es.map((e) => e.type)

describe('parry', () => {
  it('a high parry (tap forward) negates a high attack: zero damage, meter gained', () => {
    // Attacker throws st.MP (a high). Defender taps relative-forward two frames
    // in, arming the parry just before the active frame.
    const s = fightAtRange(70)
    const { state, events } = play(
      s, 12,
      (k) => (k === 0 ? inp(5, 'mp') : NEU),
      (k) => (k < 2 ? NEU : hold(4)),
    )
    expect(types(events)).toContain('parry')
    // Took nothing at all — not even chip.
    expect(state.fighters[1].health).toBe(state.fighters[1].maxHealth)
    // And banked exactly the parry meter reward.
    expect(state.fighters[1].meter).toBe(PARRY_METER)
    // A parry is neither a block nor a hit.
    expect(types(events)).not.toContain('hit')
    expect(types(events)).not.toContain('block')
  })

  it('a low parry (tap down) negates a low attack', () => {
    // cr.MK is a low; the defender taps straight down to low-parry it.
    const s = fightAtRange(60)
    const { state, events } = play(
      s, 12,
      (k) => (k === 0 ? inp(2, 'mk') : inp(2)),
      (k) => (k < 2 ? NEU : hold(2)),
    )
    expect(types(events)).toContain('parry')
    expect(state.fighters[1].health).toBe(state.fighters[1].maxHealth)
    expect(state.fighters[1].meter).toBe(PARRY_METER)
  })

  it('parrying the wrong height fails: forward tap does not parry a low', () => {
    // Tapping forward against a LOW neither blocks it (low block is down-back)
    // nor parries it (low parry is down) — so it simply connects.
    const s = fightAtRange(60)
    const { state, events } = play(
      s, 12,
      (k) => (k === 0 ? inp(2, 'mk') : inp(2)),
      (k) => (k < 2 ? NEU : hold(4)), // forward — wrong for a low
    )
    expect(types(events)).toContain('hit')
    expect(types(events)).not.toContain('parry')
    expect(state.fighters[1].health).toBeLessThan(state.fighters[1].maxHealth)
  })

  it('a parry leaves the defender plus: they recover before the attacker', () => {
    // After the parry there must be a frame where the defender can act and the
    // attacker, still in the recovery of the whiffed-into-parry move, cannot.
    const s = fightAtRange(70)
    let cur = s
    let parryFrame = -1
    let plusProven = false
    for (let k = 0; k < 40; k++) {
      const r = step(cur, [k === 0 ? inp(5, 'mp') : NEU, k < 2 ? NEU : hold(4)])
      cur = r.state
      if (r.events.some((e) => e.type === 'parry')) parryFrame = k
      if (parryFrame >= 0 && k > parryFrame) {
        if (fighterCanAct(cur, 1) && !fighterCanAct(cur, 0)) {
          plusProven = true
          break
        }
        // If the attacker recovers first, the reward is wrong — fail loudly.
        if (fighterCanAct(cur, 0) && !fighterCanAct(cur, 1)) break
      }
    }
    expect(parryFrame, 'the attack should have been parried').toBeGreaterThanOrEqual(0)
    expect(plusProven, 'defender should be actionable while attacker is still recovering').toBe(true)
  })

  it('anti-mash: a held direction only parries once, not every later hit', () => {
    // The defender holds forward the WHOLE time — a single fresh edge at frame 0.
    // A jab arriving right after that edge parries; a second jab 40 frames later,
    // long past the leniency window, must NOT parry — it connects.
    const s = fightAtRange(70)
    let cur = s
    const tagged: string[] = []
    for (let k = 0; k < 60; k++) {
      const atk = k === 0 || k === 40 ? inp(5, 'mp') : NEU
      const r = step(cur, [atk, hold(4)])
      cur = r.state
      for (const e of r.events) {
        if (e.type === 'parry' || e.type === 'hit') tagged.push(`${k}:${e.type}`)
      }
    }
    // First interaction is a parry; the late one is a clean hit.
    expect(tagged.some((t) => t.endsWith(':parry'))).toBe(true)
    expect(tagged.some((t) => t.endsWith(':hit'))).toBe(true)
    // And specifically: the LAST tagged interaction is a hit, not a parry.
    expect(tagged[tagged.length - 1].endsWith(':hit')).toBe(true)
  })
})
