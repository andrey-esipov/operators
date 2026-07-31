import { describe, expect, it } from 'vitest'
import { createFight, step, fighterCanAct } from '../sim'
import { getFighterDef } from '../fighters'
import type { Button, Direction, FightState, InputFrame } from '../types'

/**
 * FRAME-DATA HONESTY / PUNISH COHERENCE — the whole moveset, driven through the
 * running sim, not read off the authored numbers.
 *
 * `frameadvantage.test.ts` locks four operator normals via real inputs. That is
 * the right method (measure recovery-vs-stun from the sim) but a thin slice:
 * nothing guards Vanguard or Warden, and nothing states the coherence rules a
 * buyable fighter has to hold to — that a jab is safe, that a big heavy is not,
 * that hitting is never worse than blocking. `tools/frame-data.mjs` prints the
 * full tables but a tool nobody runs guards nothing. This file turns the tables
 * into asserted, mutation-proved law across all three archetypes.
 *
 * HOW ADVANTAGE IS MEASURED (identical primitive to frameadvantage.test.ts):
 * the attacker presses the move point-blank; the defender either holds the
 * correct guard or eats it; we step until each fighter regains control and take
 * the difference. Positive = attacker acts first (plus), negative = defender
 * acts first (the move is punishable by that many frames). Hitstop freezes both
 * fighters equally, so it falls out of the difference.
 *
 * WHY THIS IS NOT CIRCULAR: the number comes from two INDEPENDENT sim runs
 * (when does the attacker act; when does the defender act), never from the
 * authored blockstun/recovery. A regression that desyncs recovery from the
 * annotation moves the measured number and reds a specific assertion below —
 * proven per case in the comments (e.g. "+2f recovery on Warden cr.HP →
 * on-block -8 → -10, ANCHORS red").
 */

type CharId = 'operator' | 'vanguard' | 'warden'
const CHARS: CharId[] = ['operator', 'vanguard', 'warden']
const NEU: InputFrame = { dir: 5, held: new Set(), pressed: new Set() }

/** Point-blank rig: attacker (left, facing +) vs a same-character dummy (right).
 *  Gap 66 puts them close enough that the FIRST active frame connects, which is
 *  the spacing frame data is quoted at. */
function rig(atkId: CharId): FightState {
  const s = createFight(atkId, atkId)
  s.phase = 'fight'
  s.phaseTimer = 0
  s.fighters[0].pos.x = -33
  s.fighters[1].pos.x = 33
  s.fighters[0].facing = 1
  s.fighters[1].facing = -1
  return s
}

/** The input that produces a grounded normal: crouch (dir 2) for cr.*, stand
 *  (dir 5) otherwise, plus the button. */
function moveInput(moveId: string): InputFrame {
  const crouch = moveId.startsWith('cr.')
  const btn = moveId.slice(3).toLowerCase() as Button
  const set = new Set<Button>([btn])
  return { dir: crouch ? 2 : 5, held: set, pressed: set }
}

/** On the right side, "back" (block high) is absolute 6; down-back (block low)
 *  is 3. The defender must crouch-block a low or it will not block at all. */
function blockInput(guard: string): InputFrame {
  const d: Direction = guard === 'low' ? 3 : 6
  return { dir: d, held: new Set(), pressed: new Set() }
}

interface Adv {
  /** defenderFree - attackerFree. */
  adv: number
  /** Did the defender actually enter block/hit stun? Guards a silent whiff. */
  reacted: boolean
  /** Did BOTH fighters regain control within the window? Guards a measurement
   *  that never resolved from returning a garbage advantage that an inequality
   *  assertion might accidentally satisfy — the classic lying-harness shape. */
  resolved: boolean
}

/** Drive `moveId` point-blank and return on-block ('block') or on-hit ('hit')
 *  advantage, measured from the running sim. */
function measure(atkId: CharId, moveId: string, mode: 'block' | 'hit'): Adv {
  const def = getFighterDef(atkId)
  const move = def.moves[moveId]
  const defIn = mode === 'block' ? blockInput(move.hit.guard) : NEU
  let s = rig(atkId)
  let reacted = false
  let everAttack = false
  let attackerFree = -1
  let defenderFree = -1
  for (let f = 0; f < 200; f++) {
    const p1 = f === 0 ? moveInput(moveId) : NEU
    s = step(s, [p1, defIn]).state
    const A = s.fighters[0]
    const D = s.fighters[1]
    if (A.stance === 'attack') everAttack = true
    const stunned =
      D.stance === 'blockstun' || D.stance === 'hitstun' ||
      D.stance === 'juggle' || D.stance === 'knockdown'
    if (!reacted && stunned) reacted = true
    if (everAttack && attackerFree < 0 && fighterCanAct(s, 0)) attackerFree = f
    const defBusy =
      D.stunRemaining > 0 || D.stance === 'blockstun' || D.stance === 'hitstun' ||
      D.stance === 'juggle' || D.stance === 'knockdown' || D.stance === 'wakeup'
    if (reacted && defenderFree < 0 && !defBusy) defenderFree = f
    if (attackerFree >= 0 && defenderFree >= 0) break
  }
  const resolved = attackerFree >= 0 && defenderFree >= 0
  return { adv: defenderFree - attackerFree, reacted, resolved }
}

function onBlock(c: CharId, m: string): number {
  const r = measure(c, m, 'block')
  expect(r.reacted, `${c} ${m} must be blocked`).toBe(true)
  expect(r.resolved, `${c} ${m} on-block must resolve both fighters`).toBe(true)
  return r.adv
}
function onHit(c: CharId, m: string): number {
  const r = measure(c, m, 'hit')
  expect(r.reacted, `${c} ${m} must connect`).toBe(true)
  expect(r.resolved, `${c} ${m} on-hit must resolve both fighters`).toBe(true)
  return r.adv
}

const LIGHTS = ['st.LP', 'st.LK', 'cr.LP', 'cr.LK']
const HEAVIES = ['st.HP', 'st.HK', 'cr.HP', 'cr.HK'] // the HP/HK buttons: heavy, launcher, sweep
const MEDIUMS = ['st.MP', 'st.MK', 'cr.MP', 'cr.MK']
const ALL_NORMALS = [...LIGHTS, ...MEDIUMS, ...HEAVIES]

/**
 * RULE 1 — a jab is safe. Every light is plus-or-neutral on block, so light
 * pressure and frame traps exist for all three archetypes. Measured today:
 * operator +2/+1/+2/+1, vanguard +3/+2/+3/+2, warden +2/+1/+2/+1.
 *
 * MUTATION TOOTH: bump any light's `recovery` by 2 (e.g. operator st.LP
 * 6 → 8) and its on-block falls +2 → 0... still >= 0. Bump by 3 → -1, and this
 * reds. Proven live: +3f recovery on operator st.LP made this fail with
 * "operator st.LP on-block -1 to be >= 0".
 */
describe('coherence rule 1: every light normal is safe on block', () => {
  for (const c of CHARS) {
    for (const m of LIGHTS) {
      it(`${c} ${m} is >= 0 on block (safe pressure)`, () => {
        expect(onBlock(c, m), `${c} ${m} on-block`).toBeGreaterThanOrEqual(0)
      })
    }
  }
})

/**
 * RULE 2 — a big button is not free. Every HP/HK button (heavy, launcher, sweep)
 * is punishable on block: -3 or worse, i.e. at least the 3f jab's reach into it.
 * The SINGLE deliberate exception is Vanguard's st.HP "Haymaker" at exactly -2 —
 * a grappler's barely-safe neutral poke that feeds tick-throw pressure, the same
 * design lineage as its 1150 health. We assert it is -2 (not safer, not
 * punishable) so the exception can neither widen into "safe +" nor silently
 * become punishable and erase the identity.
 *
 * This is the mission's "is anything unpunishable-on-block that should not be?"
 * rendered as a test: the answer is "no — every heavy is -3 or worse, and the
 * one safe heavy is a named, bounded grappler tool."
 *
 * MUTATION TOOTH (both directions):
 *  - drop Warden cr.HP recovery 20 → 17 (on-block -8 → -5, still punishable) —
 *    stays green; drop to 14 → -2 and the "<= -3" assertion reds. Proven live.
 *  - give Vanguard st.HP recovery 17 → 15 (on-block -2 → 0) and the exact
 *    "=== -2" assertion reds. Proven live.
 */
describe('coherence rule 2: every heavy button is punishable on block', () => {
  for (const c of CHARS) {
    for (const m of HEAVIES) {
      const isException = c === 'vanguard' && m === 'st.HP'
      it(`${c} ${m} ${isException ? 'is the deliberate -2 exception' : 'is <= -3 (punishable)'}`, () => {
        const adv = onBlock(c, m)
        if (isException) {
          expect(adv, 'Vanguard Haymaker is deliberately barely-safe').toBe(-2)
        } else {
          expect(adv, `${c} ${m} on-block`).toBeLessThanOrEqual(-3)
        }
      })
    }
  }

  it('Vanguard st.HP is the ONLY heavy that is safe (> -3) across the cast', () => {
    const safe: string[] = []
    for (const c of CHARS) {
      for (const m of HEAVIES) {
        if (onBlock(c, m) > -3) safe.push(`${c} ${m}`)
      }
    }
    expect(safe).toEqual(['vanguard st.HP'])
  })
})

/**
 * RULE 3 — hitting is never worse than blocking. hitstun exceeds blockstun on
 * every move, so on-hit advantage must strictly beat on-block for every normal.
 * Violating it (a move minus-er on hit than on block) is a data inversion that
 * would make landing a clean hit a liability. Measured gap is +3..+6 on
 * grounded normals and huge on sweeps (hard knockdown).
 *
 * MUTATION TOOTH: set any move's hitstun <= its blockstun (e.g. operator st.MP
 * hitstun 15 → 12 == blockstun) and on-hit collapses to on-block, reding the
 * strict ">". Proven live: hitstun 12 on st.MP failed "on-hit 0 to be > 0".
 */
describe('coherence rule 3: on-hit is strictly better than on-block', () => {
  for (const c of CHARS) {
    for (const m of ALL_NORMALS) {
      it(`${c} ${m}: on-hit > on-block`, () => {
        expect(onHit(c, m), `${c} ${m} on-hit vs on-block`).toBeGreaterThan(onBlock(c, m))
      })
    }
  }
})

/**
 * RULE 4 — the sweep pays a hard knockdown. Every cr.HK is deeply minus on block
 * (-8/-9, the most punishable button) but yields a long okizeme window on hit:
 * the victim is floored, so on-hit reads +20 or more (knockdown + wakeup), an
 * order of magnitude past a normal's +2..+6. This locks the risk/reward that
 * makes the sweep a knockdown tool, not a poke.
 *
 * MUTATION TOOTH: if a sweep stopped causing knockdown (guard/level downgraded
 * so the victim only takes hitstun), on-hit would crash from +26 to ~+4 and the
 * ">= 20" reds. Proven live by forcing the sweep's on-hit path to plain hitstun.
 */
describe('coherence rule 4: sweeps trade block-punishability for a hard knockdown', () => {
  for (const c of CHARS) {
    it(`${c} cr.HK is <= -8 on block but >= +20 on hit (knockdown)`, () => {
      expect(onBlock(c, 'cr.HK'), `${c} cr.HK on-block`).toBeLessThanOrEqual(-8)
      expect(onHit(c, 'cr.HK'), `${c} cr.HK on-hit`).toBeGreaterThanOrEqual(20)
    })
  }
})

/**
 * ARCHETYPE IDENTITY ANCHORS — a curated readable table of the numbers that
 * carry design meaning, each mutation-proof because it is exact. Doubles as the
 * living frame-data reference for these key buttons.
 *
 *  - operator st.LP +2 cross-checks frameadvantage.test.ts (the injection-free
 *    input path agrees with this rig — two files, one number).
 *  - vanguard st.LP +3: the grappler's plus jab, the plus frames that set up
 *    ticks; -2 st.HP its safe neutral button (see rule 2).
 *  - warden st.HP -6 / cr.HP -8: the zoner's grounded heavies are MORE minus
 *    than the rushdown's — its game is at range, so committing a point-blank
 *    heavy is meant to hurt.
 */
describe('archetype identity anchors (exact, readable)', () => {
  it('operator: jab +2, st.HK -6, cr.HP launcher -5', () => {
    expect(onBlock('operator', 'st.LP')).toBe(2)
    expect(onBlock('operator', 'st.HK')).toBe(-6)
    expect(onBlock('operator', 'cr.HP')).toBe(-5)
  })
  it('vanguard: plus jab +3, Haymaker st.HP -2, command launcher cr.HP -6', () => {
    expect(onBlock('vanguard', 'st.LP')).toBe(3)
    expect(onBlock('vanguard', 'st.HP')).toBe(-2)
    expect(onBlock('vanguard', 'cr.HP')).toBe(-6)
  })
  it('warden the zoner: grounded heavies bite harder — st.HP -6, cr.HP -8', () => {
    expect(onBlock('warden', 'st.HP')).toBe(-6)
    expect(onBlock('warden', 'cr.HP')).toBe(-8)
  })
})
