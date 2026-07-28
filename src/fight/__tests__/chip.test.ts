/**
 * Chip damage on blockable strike specials. Before this, only warden's
 * projectiles and the two crumple supers chipped; every other special — every
 * fireball, dragon punch and rush — dealt ZERO on block, so a cornered defender
 * could hold back against committed specials forever at no cost. Blockable strike
 * specials/supers now chip `round(damage * SPECIAL_CHIP_RATIO)`, derived in one
 * place (mkMove) so no move carries a hand-typed chip number and the whole roster
 * moves together if the ratio changes.
 *
 * The rule has three deliberate exclusions, each pinned below:
 *   - NORMALS never chip (blocking a poke must stay free — turtling is supposed
 *     to work against pokes; airblock.test.ts independently locks st.HP chip 0).
 *   - THROWS / command grabs are unblockable, so chip is meaningless (guard
 *     'throw' → 0, even at tag super, e.g. vanguard's Backbreaker).
 *   - AUTHORED chip wins: a move that sets its own chip keeps it (operator's
 *     Palm Barrage is tuned to 20, not the 38 the ratio would give; warden's
 *     bolts keep 8/10/24 — those live in the projectile table, not here).
 *
 * TEETH (both directions, see report):
 *   - SPECIAL_CHIP_RATIO -> 0 : the six strike specials chip 0 -> the derivation
 *     and behavioural assertions red.
 *   - Drop the `spec.hit.chip === undefined` guard in mkMove (always override) ->
 *     operator's authored super chip becomes 38, not 20 -> the "authored wins"
 *     assertion reds.
 *   - Broaden the rule to normals (drop the tag check) -> a normal gains chip ->
 *     the "normals never chip" assertion reds.
 *   - Revert applyBlock to not subtract hit.chip -> the behavioural block costs 0
 *     -> that assertion reds.
 */
import { describe, expect, it } from 'vitest'
import { createFight, step } from '../sim'
import { getFighterDef, OPERATOR, VANGUARD, WARDEN } from '../fighters'
import { SPECIAL_CHIP_RATIO } from '../constants'
import type { FightState, InputFrame, Move } from '../types'

const DEFS = [
  ['operator', OPERATOR],
  ['vanguard', VANGUARD],
  ['warden', WARDEN],
] as const

/** Moves that deliberately author their own chip — the derivation must LEAVE
 *  THESE ALONE. Keyed `${charId}/${moveId}`. Operator's Palm Barrage is a crumple
 *  super hand-tuned to 20 (the ratio would give round(300*0.125)=38). Vanguard/
 *  warden supers are throws or damage-0 spawners, caught by the other branches. */
const AUTHORED: Record<string, number> = { 'operator/super.P': 20 }

const isStrike = (m: Move) =>
  (m.tag === 'special' || m.tag === 'super') && m.hit.guard !== 'throw' && m.hit.damage > 0

describe('chip damage on blockable strike specials', () => {
  it('every blockable strike special/super chips round(damage * ratio), unless it authors its own', () => {
    let derived = 0
    let authored = 0
    for (const [id, def] of DEFS) {
      for (const [mid, m] of Object.entries(def.moves)) {
        if (!isStrike(m)) continue
        const key = `${id}/${mid}`
        if (key in AUTHORED) {
          expect(m.hit.chip, key).toBe(AUTHORED[key])
          authored++
        } else {
          expect(m.hit.chip, key).toBe(Math.round(m.hit.damage * SPECIAL_CHIP_RATIO))
          expect(m.hit.chip, key).toBeGreaterThan(0)
          derived++
        }
      }
    }
    // The gap this closes: six real strike specials (operator's 4, vanguard's 2)
    // that used to chip nothing now do. If this drops, a special stopped chipping.
    expect(derived).toBe(6)
    expect(authored).toBe(1)
  })

  it('normals and command normals never chip — blocking a poke stays free', () => {
    for (const [id, def] of DEFS) {
      for (const [mid, m] of Object.entries(def.moves)) {
        if (m.tag === 'special' || m.tag === 'super') continue
        expect(m.hit.chip, `${id}/${mid}`).toBe(0)
      }
    }
  })

  it('throws and command grabs never chip — they are unblockable', () => {
    for (const [id, def] of DEFS) {
      for (const [mid, m] of Object.entries(def.moves)) {
        if (m.hit.guard === 'throw') expect(m.hit.chip, `${id}/${mid}`).toBe(0)
      }
    }
  })

  it('blocking a strike special costs the blocker exactly its chip, not its damage', () => {
    // operator Surge Palm (qcf.P): damage 80, chip 10. Inject the attacker onto
    // its first active frame point-blank; the defender holds back (absolute 6 ==
    // back while facing left) so the only outcome is a clean high block.
    const move = getFighterDef('operator').moves['qcf.P']
    const chip = move.hit.chip
    const active0 = move.active[0]

    let s: FightState = createFight('operator', 'operator')
    s.phase = 'fight'; s.phaseTimer = 0
    s.fighters[0].pos.x = -18; s.fighters[0].facing = 1
    s.fighters[1].pos.x = 18; s.fighters[1].facing = -1
    s.fighters[0].stance = 'attack'
    s.fighters[0].move = { id: 'qcf.P', frame: active0 - 1 }
    s.fighters[0].attackConnected = false
    const startHp = s.fighters[1].health

    const back: InputFrame = { dir: 6 as never, held: new Set(), pressed: new Set() }
    let blocked = false
    for (let f = 0; f < 12; f++) {
      const r = step(s, [{ dir: 5 as never, held: new Set(), pressed: new Set() }, back])
      s = r.state
      for (const e of r.events) if (e.type === 'block') blocked = true
    }
    expect(blocked).toBe(true)
    // Took the chip, and ONLY the chip — a failed block would be ~80, a no-chip
    // special would be 0. Both are excluded by asserting the exact chip.
    expect(startHp - s.fighters[1].health).toBe(chip)
    expect(chip).toBeGreaterThan(0)
  })
})
