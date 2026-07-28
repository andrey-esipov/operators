/**
 * "Operator" — one fully-realised character. Frame data follows Third
 * Strike / SF6 conventions: lights are fast and plus or near-neutral on block,
 * mediums are your confirm buttons, heavies hit hard but are unsafe, the sweep
 * knocks down, the shoto kit is qcf lunge / dp reversal / qcb kick plus a charge
 * move, and one super cashes out a combo.
 *
 * Frame-advantage note used throughout: a move becomes actionable
 * `total - startup` frames after its first active frame (call this `busy`).
 * A hit is resolved on that first active frame, so
 *     onBlock = blockstun - busy      onHit = hitstun - busy
 * The chosen blockstun/hitstun below are annotated with the advantage they
 * produce, and the frame-advantage test asserts the sim actually delivers it.
 */

import type { Button, Direction, Move } from '../types'
import type { FighterDef, SelectContext } from '../def'
import { JUGGLE_ALLOWANCE, MAX_HEALTH } from '../constants'
import {
  AIR_HURT,
  AIR_PUSH,
  CROUCH_HURT,
  CROUCH_PUSH,
  mkMove,
} from './build'
import { detectCharge, detectMotion } from '../input/motion'

let spr = 0
const nextSprite = (): number => (spr += 3)

// ── Standing normals ────────────────────────────────────────────────────────
const stLP = mkMove({
  id: 'st.LP', name: 'Jab', tag: 'normal', button: 'lp', sprite: nextSprite(),
  startup: 3, active: 2, recovery: 6, // total 11, busy 8
  hitbox: [{ x: 22, y: 104, w: 50, h: 26 }],
  cancels: ['normal', 'special', 'super'],
  hit: { damage: 30, blockstun: 10 /* +2 */, hitstun: 13 /* +5 */, guard: 'high',
    level: 'light', kbx: 0.7, pushback: 0.4, hitstop: 8, meterGain: 12, meterGainOnBlock: 4 },
})
const stMP = mkMove({
  id: 'st.MP', name: 'Straight', tag: 'normal', button: 'mp', sprite: nextSprite(),
  startup: 5, active: 3, recovery: 9, // total 17, busy 12
  hitbox: [{ x: 24, y: 98, w: 58, h: 34 }],
  cancels: ['special', 'super'],
  hit: { damage: 60, blockstun: 12 /* ±0 */, hitstun: 15 /* +3 */, guard: 'high',
    level: 'medium', kbx: 1.1, pushback: 0.9, hitstop: 9, meterGain: 16, meterGainOnBlock: 6 },
})
const stHP = mkMove({
  id: 'st.HP', name: 'Smash', tag: 'normal', button: 'hp', sprite: nextSprite(),
  startup: 8, active: 3, recovery: 16, // total 27, busy 19
  hitbox: [{ x: 26, y: 96, w: 66, h: 40 }],
  cancels: ['special', 'super'],
  hit: { damage: 90, blockstun: 16 /* -3 */, hitstun: 21 /* +2 */, guard: 'high',
    level: 'heavy', kbx: 2.2, pushback: 1.8, hitstop: 11, meterGain: 22, meterGainOnBlock: 8 },
})
const stLK = mkMove({
  id: 'st.LK', name: 'Low-ish Kick', tag: 'normal', button: 'lk', sprite: nextSprite(),
  startup: 4, active: 2, recovery: 8, // total 14, busy 10
  hitbox: [{ x: 24, y: 70, w: 56, h: 30 }],
  cancels: ['normal', 'special', 'super'],
  hit: { damage: 30, blockstun: 11 /* +1 */, hitstun: 14 /* +4 */, guard: 'high',
    level: 'light', kbx: 0.7, pushback: 0.4, hitstop: 8, meterGain: 12, meterGainOnBlock: 4 },
})
const stMK = mkMove({
  id: 'st.MK', name: 'Roundhouse Poke', tag: 'normal', button: 'mk', sprite: nextSprite(),
  startup: 6, active: 3, recovery: 12, // total 21, busy 15 — a whiff-punish poke, no cancel
  hitbox: [{ x: 40, y: 80, w: 66, h: 32 }],
  hit: { damage: 60, blockstun: 13 /* -2 */, hitstun: 17 /* +2 */, guard: 'high',
    level: 'medium', kbx: 1.4, pushback: 1.2, hitstop: 9, meterGain: 16, meterGainOnBlock: 6 },
})
const stHK = mkMove({
  id: 'st.HK', name: 'High Kick', tag: 'normal', button: 'hk', sprite: nextSprite(),
  startup: 10, active: 2, recovery: 20, // total 32, busy 22 — big and unsafe
  hitbox: [{ x: 36, y: 96, w: 74, h: 44 }],
  hit: { damage: 100, blockstun: 16 /* -6 */, hitstun: 25 /* +3 */, guard: 'high',
    level: 'heavy', kbx: 3.0, pushback: 2.2, hitstop: 12, meterGain: 22, meterGainOnBlock: 8 },
})

// ── Crouching normals ───────────────────────────────────────────────────────
const crLP = mkMove({
  id: 'cr.LP', name: 'Crouch Jab', tag: 'normal', button: 'lp', sprite: nextSprite(),
  startup: 3, active: 2, recovery: 6, hurt: CROUCH_HURT, push: CROUCH_PUSH, // busy 8
  hitbox: [{ x: 22, y: 60, w: 50, h: 24 }],
  cancels: ['normal', 'special', 'super'],
  hit: { damage: 28, blockstun: 10 /* +2 */, hitstun: 13 /* +5 */, guard: 'high',
    level: 'light', kbx: 0.6, pushback: 0.4, hitstop: 8, meterGain: 11, meterGainOnBlock: 4 },
})
const crMP = mkMove({
  id: 'cr.MP', name: 'Crouch Straight', tag: 'normal', button: 'mp', sprite: nextSprite(),
  startup: 5, active: 3, recovery: 9, hurt: CROUCH_HURT, push: CROUCH_PUSH, // busy 12
  hitbox: [{ x: 24, y: 70, w: 56, h: 30 }],
  cancels: ['special', 'super'],
  hit: { damage: 55, blockstun: 12 /* ±0 */, hitstun: 15 /* +3 */, guard: 'high',
    level: 'medium', kbx: 1.0, pushback: 0.8, hitstop: 9, meterGain: 15, meterGainOnBlock: 6 },
})
const crHP = mkMove({
  // The anti-air launcher: hits high with a tall upward box and pops the
  // opponent into a juggle. Unsafe on block, as an uppercut should be.
  id: 'cr.HP', name: 'Rising Uppercut', tag: 'normal', button: 'hp', sprite: nextSprite(),
  startup: 7, active: 4, recovery: 18, hurt: CROUCH_HURT, push: CROUCH_PUSH, // busy 22
  hitbox: [{ x: 14, y: 60, w: 52, h: 120 }],
  cancels: ['special', 'super'],
  hit: { damage: 85, blockstun: 17 /* -5 */, hitstun: 24, guard: 'high', level: 'launcher',
    kbx: 1.0, kby: 9, pushback: 1.0, hitstop: 11, meterGain: 20, meterGainOnBlock: 8, juggle: true },
})
const crLK = mkMove({
  id: 'cr.LK', name: 'Low Jab', tag: 'normal', button: 'lk', sprite: nextSprite(),
  startup: 4, active: 2, recovery: 7, hurt: CROUCH_HURT, push: CROUCH_PUSH, // busy 9
  hitbox: [{ x: 22, y: 20, w: 52, h: 22 }],
  cancels: ['normal', 'special', 'super'],
  hit: { damage: 26, blockstun: 10 /* +1 */, hitstun: 13 /* +4 */, guard: 'low',
    level: 'light', kbx: 0.6, pushback: 0.4, hitstop: 8, meterGain: 11, meterGainOnBlock: 4 },
})
const crMK = mkMove({
  id: 'cr.MK', name: 'Low Poke', tag: 'normal', button: 'mk', sprite: nextSprite(),
  startup: 6, active: 3, recovery: 13, hurt: CROUCH_HURT, push: CROUCH_PUSH, // busy 16
  hitbox: [{ x: 40, y: 24, w: 72, h: 24 }],
  cancels: ['special', 'super'], // classic hit-confirm cancel target
  hit: { damage: 55, blockstun: 13 /* -3 */, hitstun: 17 /* +1 */, guard: 'low',
    level: 'medium', kbx: 1.2, pushback: 1.4, hitstop: 9, meterGain: 15, meterGainOnBlock: 6 },
})
const crHK = mkMove({
  id: 'cr.HK', name: 'Sweep', tag: 'normal', button: 'hk', sprite: nextSprite(),
  startup: 8, active: 3, recovery: 20, hurt: CROUCH_HURT, push: CROUCH_PUSH, // busy 23
  hitbox: [{ x: 36, y: 16, w: 78, h: 26 }],
  hit: { damage: 90, blockstun: 15 /* -8 */, hitstun: 28, guard: 'low', level: 'sweep',
    kbx: 3.0, pushback: 1.0, hitstop: 12, meterGain: 20, meterGainOnBlock: 8 },
})

// ── Jumping normals (aerials must be blocked standing → overhead) ────────────
const jLP = mkMove({
  id: 'j.LP', name: 'Jump Jab', tag: 'normal', button: 'lp', sprite: nextSprite(),
  airOk: true, startup: 4, active: 6, recovery: 6, hurt: AIR_HURT, push: AIR_PUSH,
  hitbox: [{ x: 14, y: 80, w: 52, h: 40 }],
  hit: { damage: 40, blockstun: 12, hitstun: 16, guard: 'overhead', level: 'light',
    kbx: 0.8, hitstop: 9, meterGain: 12, meterGainOnBlock: 4 },
})
const jMK = mkMove({
  id: 'j.MK', name: 'Jump Kick', tag: 'normal', button: 'mk', sprite: nextSprite(),
  airOk: true, startup: 7, active: 4, recovery: 8, hurt: AIR_HURT, push: AIR_PUSH,
  hitbox: [{ x: 26, y: 40, w: 64, h: 44 }],
  hit: { damage: 60, blockstun: 14, hitstun: 18, guard: 'overhead', level: 'medium',
    kbx: 1.2, hitstop: 10, meterGain: 16, meterGainOnBlock: 6 },
})
const jHP = mkMove({
  id: 'j.HP', name: 'Jump Smash', tag: 'normal', button: 'hp', sprite: nextSprite(),
  airOk: true, startup: 9, active: 4, recovery: 10, hurt: AIR_HURT, push: AIR_PUSH,
  hitbox: [{ x: 22, y: 70, w: 70, h: 50 }],
  hit: { damage: 90, blockstun: 16, hitstun: 20, guard: 'overhead', level: 'heavy',
    kbx: 2.0, hitstop: 11, meterGain: 22, meterGainOnBlock: 8 },
})
const jHK = mkMove({
  id: 'j.HK', name: 'Jump Axe', tag: 'normal', button: 'hk', sprite: nextSprite(),
  airOk: true, startup: 8, active: 3, recovery: 12, hurt: AIR_HURT, push: AIR_PUSH,
  hitbox: [{ x: 30, y: 30, w: 72, h: 52 }],
  hit: { damage: 95, blockstun: 16, hitstun: 20, guard: 'overhead', level: 'heavy',
    kbx: 2.4, hitstop: 11, meterGain: 22, meterGainOnBlock: 8 },
})

// ── Command normals ─────────────────────────────────────────────────────────
const fMP = mkMove({
  id: 'f.MP', name: 'Overhead Chop', tag: 'command', button: 'mp', sprite: nextSprite(),
  startup: 18, active: 3, recovery: 15, forward: 18, // busy 18
  hitbox: [{ x: 26, y: 110, w: 60, h: 34 }],
  cancels: ['special', 'super'],
  hit: { damage: 65, blockstun: 16 /* -2 */, hitstun: 21 /* +3 */, guard: 'overhead',
    level: 'medium', kbx: 1.2, pushback: 1.0, hitstop: 10, meterGain: 16, meterGainOnBlock: 6 },
})
const fHK = mkMove({
  id: 'f.HK', name: 'Step Kick', tag: 'command', button: 'hk', sprite: nextSprite(),
  startup: 12, active: 3, recovery: 18, forward: 40, // busy 21
  hitbox: [{ x: 44, y: 78, w: 74, h: 36 }],
  hit: { damage: 80, blockstun: 17 /* -4 */, hitstun: 23 /* +2 */, guard: 'high',
    level: 'medium', kbx: 2.2, pushback: 1.2, hitstop: 11, meterGain: 18, meterGainOnBlock: 6 },
})

// ── Specials ────────────────────────────────────────────────────────────────
const surgePalm = mkMove({
  id: 'qcf.P', name: 'Surge Palm', tag: 'special', motion: '236', sprite: nextSprite(),
  startup: 11, active: 4, recovery: 22, forward: 60, // busy 26
  hitbox: [{ x: 30, y: 80, w: 78, h: 46 }],
  cancels: ['super'],
  hit: { damage: 80, blockstun: 18 /* -8 */, hitstun: 24, guard: 'high', level: 'medium',
    kbx: 3.2, pushback: 1.0, hitstop: 12, meterGain: 24, meterGainOnBlock: 10, scaling: 0.9 },
})
const risingDragon = mkMove({
  // Reversal DP: 3f startup with strike invulnerability across the first active
  // frames, launches on hit, wildly unsafe on block. Kept grounded in the sim
  // (the "rise" is cosmetic) but the invuln + juggle are what matter.
  id: 'dp.P', name: 'Rising Dragon', tag: 'special', motion: '623', sprite: nextSprite(),
  startup: 3, active: 6, recovery: 20, // busy 26
  invuln: { from: 0, to: 5, kind: 'strike' },
  hitbox: [{ x: 10, y: 70, w: 56, h: 120 }],
  hit: { damage: 100, blockstun: 18, hitstun: 26, guard: 'high', level: 'launcher',
    kbx: 1.5, kby: 11, pushback: 0, hitstop: 11, meterGain: 10, meterGainOnBlock: 4, juggle: true },
})
const tornadoKick = mkMove({
  id: 'qcb.K', name: 'Tornado Kick', tag: 'special', motion: '214', sprite: nextSprite(),
  startup: 10, active: 3, recovery: 20, forward: 30, // busy 23
  hitbox: [{ x: 34, y: 60, w: 72, h: 60 }],
  cancels: ['super'],
  hit: { damage: 75, blockstun: 17 /* -6 */, hitstun: 22, guard: 'high', level: 'medium',
    kbx: 2.6, pushback: 0.6, hitstop: 11, meterGain: 22, meterGainOnBlock: 9, scaling: 0.9 },
})
const cannon = mkMove({
  // Charge special: hold back ~40f then forward + punch.
  id: 'charge.P', name: 'Cannon', tag: 'special', motion: '[4]6', sprite: nextSprite(),
  startup: 13, active: 4, recovery: 19, forward: 70, // busy 23
  hitbox: [{ x: 32, y: 70, w: 80, h: 48 }],
  cancels: ['super'],
  hit: { damage: 85, blockstun: 20 /* -3 */, hitstun: 24, guard: 'high', level: 'heavy',
    kbx: 3.4, pushback: 0.8, hitstop: 12, meterGain: 22, meterGainOnBlock: 10, scaling: 0.9 },
})

// ── Super ───────────────────────────────────────────────────────────────────
const palmBarrage = mkMove({
  id: 'super.P', name: 'Palm Barrage', tag: 'super', motion: '236236', cost: 1000,
  sprite: nextSprite(), startup: 6, active: 8, recovery: 30, // busy 38
  invuln: { from: 0, to: 9, kind: 'full' },
  hitbox: [{ x: 20, y: 40, w: 96, h: 120 }],
  hit: { damage: 300, blockstun: 22, hitstun: 30, guard: 'high', level: 'crumple', chip: 20,
    kbx: 4, kby: 4, pushback: 0, hitstop: 16, meterGain: 0, meterGainOnBlock: 0, scaling: 0.5 },
})

// ── Throw ───────────────────────────────────────────────────────────────────
// Unblockable, short-range, and techable (see combat). Big reward, but whiffs
// into 20 frames of recovery so a fished throw is a full punish. Damage/knockdown
// are applied by the throw path in combat; the Hit here supplies the numbers.
const seismicToss = mkMove({
  id: 'throw.f', name: 'Seismic Toss', tag: 'command', sprite: nextSprite(),
  startup: 3, active: 2, recovery: 20,
  hitbox: [{ x: 18, y: 40, w: 44, h: 130 }],
  hit: { damage: 140, blockstun: 0, hitstun: 0, guard: 'throw', level: 'heavy',
    kbx: 6, pushback: 0, hitstop: 12, meterGain: 14, meterGainOnBlock: 0 },
})

const MOVES: Record<string, Move> = {
  [stLP.id]: stLP, [stMP.id]: stMP, [stHP.id]: stHP,
  [stLK.id]: stLK, [stMK.id]: stMK, [stHK.id]: stHK,
  [crLP.id]: crLP, [crMP.id]: crMP, [crHP.id]: crHP,
  [crLK.id]: crLK, [crMK.id]: crMK, [crHK.id]: crHK,
  [jLP.id]: jLP, [jMK.id]: jMK, [jHP.id]: jHP, [jHK.id]: jHK,
  [fMP.id]: fMP, [fHK.id]: fHK,
  [surgePalm.id]: surgePalm, [risingDragon.id]: risingDragon,
  [tornadoKick.id]: tornadoKick, [cannon.id]: cannon,
  [palmBarrage.id]: palmBarrage,
  [seismicToss.id]: seismicToss,
}

const PUNCHES: Button[] = ['lp', 'mp', 'hp']
const KICKS: Button[] = ['lk', 'mk', 'hk']

function anyOf(set: ReadonlySet<Button>, bs: Button[]): boolean {
  return bs.some((b) => set.has(b))
}

/** Punch or kick fired this frame, counting negative edge (release). */
function punchTriggered(ctx: SelectContext): boolean {
  return anyOf(ctx.pressed, PUNCHES) || anyOf(ctx.released, PUNCHES)
}
function kickTriggered(ctx: SelectContext): boolean {
  return anyOf(ctx.pressed, KICKS) || anyOf(ctx.released, KICKS)
}

const isDown = (d: Direction): boolean => d === 1 || d === 2 || d === 3

/**
 * Map raw inputs to a move. Order matters: supers beat specials beat command
 * normals beat plain normals, so a clean 236236+P doesn't come out as a jab.
 */
function select(ctx: SelectContext): Move | null {
  const { pressed, relDir, grounded, meter, log } = ctx

  // Super — needs a full bar and a double-qcf. Wider window for the long motion.
  if (meter >= (palmBarrage.cost ?? 0) && punchTriggered(ctx) &&
      detectMotion(log, '236236', 20)) {
    return palmBarrage
  }

  // Specials (grounded only here; DP is a ground reversal).
  if (grounded) {
    if (punchTriggered(ctx) && detectMotion(log, '623', 12)) return risingDragon
    if (punchTriggered(ctx) && detectMotion(log, '236', 12)) return surgePalm
    if (kickTriggered(ctx) && detectMotion(log, '214', 12)) return tornadoKick
    if (punchTriggered(ctx) && detectCharge(log)) return cannon
  }

  // Airborne: only air normals are available (jumps commit).
  if (!grounded) {
    if (pressed.has('hp')) return jHP
    if (pressed.has('hk')) return jHK
    if (pressed.has('mp') || pressed.has('mk')) return jMK
    if (pressed.has('lp') || pressed.has('lk')) return jLP
    return null
  }

  // Throw — the universal LP+LK. Above normals so the punch/kick don't eat it,
  // below motions so a buffered special still wins. Combat decides range/tech.
  if (grounded && pressed.has('lp') && pressed.has('lk')) return seismicToss

  // Command normals — only on a forward hold, so they don't eat the standing
  // version while you're neutral.
  if (relDir === 6) {
    if (pressed.has('mp')) return fMP
    if (pressed.has('hk')) return fHK
  }

  // Crouching normals.
  if (isDown(relDir)) {
    if (pressed.has('hp')) return crHP
    if (pressed.has('hk')) return crHK
    if (pressed.has('mp')) return crMP
    if (pressed.has('mk')) return crMK
    if (pressed.has('lp')) return crLP
    if (pressed.has('lk')) return crLK
    return null
  }

  // Standing normals.
  if (pressed.has('hp')) return stHP
  if (pressed.has('hk')) return stHK
  if (pressed.has('mp')) return stMP
  if (pressed.has('mk')) return stMK
  if (pressed.has('lp')) return stLP
  if (pressed.has('lk')) return stLK
  return null
}

export const OPERATOR: FighterDef = {
  id: 'operator',
  name: 'Operator',
  health: MAX_HEALTH,
  // Juggle identity: the all-rounder shoto gets the full-length air route — the
  // baseline every other archetype is offset from.
  juggleAllowance: JUGGLE_ALLOWANCE,
  moves: MOVES,
  select,
}
