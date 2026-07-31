/**
 * "Vanguard" — a grappler/rushdown archetype that plays nothing like the
 * shoto Operator. Where Operator zones and confirms at midrange with a fireball
 * lunge and a DP, Vanguard has NO ranged tool at all: it must walk you down (it
 * walks forward faster and retreats worse — it commits) and win the scramble up
 * close with heavy, plus-on-block buttons and a long-range command grab that
 * beats blocking outright.
 *
 * Design contrasts, on purpose:
 *  - Bigger health pool (a grappler eats hits getting in).
 *  - Faster forward walk, slower back walk (mobility that only goes forward).
 *  - Slower, chunkier normals that reward more and stay plus so it keeps its
 *    turn, versus Operator's fast, cancel-heavy jab pressure.
 *  - Its "special" offence is a command grab (half-circle-forward) and a super
 *    command grab, not a projectile — throws are its answer to defence.
 *  - A reversal knee that launches, but shorter-range and meterless-costly than
 *    a DP, so it's a worse abstract reversal but a better damage engine up close.
 *
 * Frame-advantage convention matches operator.ts: busy = total - startup,
 * onBlock = blockstun - busy, onHit = hitstun - busy.
 */

import type { Button, Direction, Move } from '../types'
import type { FighterDef, SelectContext } from '../def'
import {
  AIR_HURT,
  AIR_PUSH,
  CROUCH_HURT,
  CROUCH_PUSH,
  mkMove,
} from './build'
import { JUGGLE_ALLOWANCE } from '../constants'
import { detectMotion } from '../input/motion'

let spr = 900
const nextSprite = (): number => (spr += 3)

// ── Standing normals — slower and chunkier than Operator's, but plus and
//    high-damage so Vanguard keeps its turn once it's in. ─────────────────────
const stLP = mkMove({
  id: 'st.LP', name: 'Hook Jab', tag: 'normal', button: 'lp', sprite: nextSprite(),
  startup: 4, active: 2, recovery: 6, // total 12, busy 8
  hitbox: [{ x: 22, y: 108, w: 52, h: 30 }],
  cancels: ['normal', 'special', 'super'],
  hit: { damage: 34, blockstun: 11 /* +3 */, hitstun: 14 /* +6 */, guard: 'high',
    level: 'light', kbx: 0.6, pushback: 0.3, hitstop: 10, meterGain: 12, meterGainOnBlock: 4 },
})
const stMP = mkMove({
  id: 'st.MP', name: 'Elbow', tag: 'normal', button: 'mp', sprite: nextSprite(),
  startup: 6, active: 3, recovery: 9, // total 18, busy 12
  hitbox: [{ x: 24, y: 100, w: 60, h: 36 }],
  cancels: ['special', 'super'],
  hit: { damage: 68, blockstun: 13 /* +1 */, hitstun: 17 /* +5 */, guard: 'high',
    level: 'medium', kbx: 0.9, pushback: 0.6, hitstop: 13, meterGain: 16, meterGainOnBlock: 6 },
})
const stHP = mkMove({
  id: 'st.HP', name: 'Haymaker', tag: 'normal', button: 'hp', sprite: nextSprite(),
  startup: 10, active: 3, recovery: 17, // total 30, busy 20
  hitbox: [{ x: 26, y: 98, w: 72, h: 46 }],
  cancels: ['super'],
  hit: { damage: 110, blockstun: 18 /* -2 */, hitstun: 24 /* +4 */, guard: 'high',
    level: 'heavy', kbx: 2.4, pushback: 1.4, hitstop: 15, meterGain: 24, meterGainOnBlock: 8 },
})
const stLK = mkMove({
  id: 'st.LK', name: 'Shin Kick', tag: 'normal', button: 'lk', sprite: nextSprite(),
  startup: 5, active: 2, recovery: 8, // total 15, busy 10
  hitbox: [{ x: 24, y: 66, w: 58, h: 32 }],
  cancels: ['normal', 'special', 'super'],
  hit: { damage: 34, blockstun: 12 /* +2 */, hitstun: 15 /* +5 */, guard: 'high',
    level: 'light', kbx: 0.6, pushback: 0.3, hitstop: 10, meterGain: 12, meterGainOnBlock: 4 },
})
const stMK = mkMove({
  id: 'st.MK', name: 'Knee Strike', tag: 'normal', button: 'mk', sprite: nextSprite(),
  startup: 8, active: 3, recovery: 11, // total 22, busy 14
  hitbox: [{ x: 32, y: 74, w: 64, h: 36 }],
  cancels: ['special', 'super'],
  hit: { damage: 66, blockstun: 15 /* +1 */, hitstun: 19 /* +5 */, guard: 'high',
    level: 'medium', kbx: 1.2, pushback: 1.0, hitstop: 13, meterGain: 16, meterGainOnBlock: 6 },
})
const stHK = mkMove({
  id: 'st.HK', name: 'Body Blow', tag: 'normal', button: 'hk', sprite: nextSprite(),
  startup: 12, active: 2, recovery: 20, // total 34, busy 22 — big and unsafe
  hitbox: [{ x: 34, y: 90, w: 78, h: 50 }],
  hit: { damage: 115, blockstun: 18 /* -6 */, hitstun: 28 /* +4 */, guard: 'high',
    level: 'heavy', kbx: 3.2, pushback: 2.0, hitstop: 16, meterGain: 24, meterGainOnBlock: 8 },
})

// ── Crouching normals ───────────────────────────────────────────────────────
const crLP = mkMove({
  id: 'cr.LP', name: 'Crouch Hook', tag: 'normal', button: 'lp', sprite: nextSprite(),
  startup: 4, active: 2, recovery: 6, hurt: CROUCH_HURT, push: CROUCH_PUSH, // busy 8
  hitbox: [{ x: 22, y: 58, w: 50, h: 26 }],
  cancels: ['normal', 'special', 'super'],
  hit: { damage: 30, blockstun: 11 /* +3 */, hitstun: 14 /* +6 */, guard: 'high',
    level: 'light', kbx: 0.5, pushback: 0.3, hitstop: 10, meterGain: 11, meterGainOnBlock: 4 },
})
const crMP = mkMove({
  id: 'cr.MP', name: 'Crouch Elbow', tag: 'normal', button: 'mp', sprite: nextSprite(),
  startup: 6, active: 3, recovery: 10, hurt: CROUCH_HURT, push: CROUCH_PUSH, // busy 13
  hitbox: [{ x: 24, y: 68, w: 58, h: 32 }],
  cancels: ['special', 'super'],
  hit: { damage: 60, blockstun: 13 /* ±0 */, hitstun: 17 /* +4 */, guard: 'high',
    level: 'medium', kbx: 0.9, pushback: 0.7, hitstop: 12, meterGain: 15, meterGainOnBlock: 6 },
})
const crHP = mkMove({
  // Anti-air launcher, like Operator's but slower and higher-reward. Special-
  // cancellable so the launch converts into a juggle: the grappler cancels it
  // into Rising Knee (dp.K) for a short, heavy air combo. (Operator's launcher
  // is likewise special-cancellable; before this, Vanguard's only cancelled into
  // super, so its cr.HP launch popped the victim up with nothing to catch them —
  // a launcher that could not launch a combo.)
  id: 'cr.HP', name: 'Uppercut', tag: 'normal', button: 'hp', sprite: nextSprite(),
  startup: 9, active: 4, recovery: 19, hurt: CROUCH_HURT, push: CROUCH_PUSH, // busy 24
  hitbox: [{ x: 14, y: 58, w: 54, h: 126 }],
  cancels: ['special', 'super'],
  hit: { damage: 95, blockstun: 17 /* -7 */, hitstun: 26, guard: 'high', level: 'launcher',
    kbx: 1.0, kby: 10, pushback: 1.0, hitstop: 15, meterGain: 20, meterGainOnBlock: 8, juggle: true },
})
const crLK = mkMove({
  id: 'cr.LK', name: 'Low Shin', tag: 'normal', button: 'lk', sprite: nextSprite(),
  startup: 4, active: 2, recovery: 7, hurt: CROUCH_HURT, push: CROUCH_PUSH, // busy 9
  hitbox: [{ x: 22, y: 18, w: 54, h: 22 }],
  cancels: ['normal', 'special', 'super'],
  hit: { damage: 28, blockstun: 11 /* +2 */, hitstun: 14 /* +5 */, guard: 'low',
    level: 'light', kbx: 0.5, pushback: 0.3, hitstop: 10, meterGain: 11, meterGainOnBlock: 4 },
})
const crMK = mkMove({
  id: 'cr.MK', name: 'Low Sweep Kick', tag: 'normal', button: 'mk', sprite: nextSprite(),
  startup: 7, active: 3, recovery: 13, hurt: CROUCH_HURT, push: CROUCH_PUSH, // busy 17
  hitbox: [{ x: 40, y: 22, w: 74, h: 24 }],
  cancels: ['special', 'super'],
  hit: { damage: 60, blockstun: 14 /* -3 */, hitstun: 18 /* +1 */, guard: 'low',
    level: 'medium', kbx: 1.1, pushback: 1.2, hitstop: 12, meterGain: 15, meterGainOnBlock: 6 },
})
const crHK = mkMove({
  id: 'cr.HK', name: 'Sweep', tag: 'normal', button: 'hk', sprite: nextSprite(),
  startup: 9, active: 3, recovery: 21, hurt: CROUCH_HURT, push: CROUCH_PUSH, // busy 24
  hitbox: [{ x: 38, y: 16, w: 82, h: 26 }],
  hit: { damage: 95, blockstun: 15 /* -9 */, hitstun: 28, guard: 'low', level: 'sweep',
    kbx: 3.0, pushback: 1.0, hitstop: 16, meterGain: 20, meterGainOnBlock: 8 },
})

// ── Jumping normals (overheads) ─────────────────────────────────────────────
const jLP = mkMove({
  id: 'j.LP', name: 'Jump Hook', tag: 'normal', button: 'lp', sprite: nextSprite(),
  airOk: true, startup: 5, active: 6, recovery: 6, hurt: AIR_HURT, push: AIR_PUSH,
  hitbox: [{ x: 14, y: 78, w: 54, h: 42 }],
  hit: { damage: 44, blockstun: 12, hitstun: 16, guard: 'overhead', level: 'light',
    kbx: 0.7, hitstop: 11, meterGain: 12, meterGainOnBlock: 4 },
})
const jMK = mkMove({
  id: 'j.MK', name: 'Jump Knee', tag: 'normal', button: 'mk', sprite: nextSprite(),
  airOk: true, startup: 7, active: 4, recovery: 8, hurt: AIR_HURT, push: AIR_PUSH,
  hitbox: [{ x: 26, y: 38, w: 66, h: 46 }],
  hit: { damage: 64, blockstun: 14, hitstun: 18, guard: 'overhead', level: 'medium',
    kbx: 1.1, hitstop: 13, meterGain: 16, meterGainOnBlock: 6 },
})
const jHP = mkMove({
  id: 'j.HP', name: 'Jump Hammer', tag: 'normal', button: 'hp', sprite: nextSprite(),
  airOk: true, startup: 9, active: 4, recovery: 10, hurt: AIR_HURT, push: AIR_PUSH,
  hitbox: [{ x: 22, y: 68, w: 74, h: 52 }],
  hit: { damage: 98, blockstun: 16, hitstun: 20, guard: 'overhead', level: 'heavy',
    kbx: 1.9, hitstop: 15, meterGain: 22, meterGainOnBlock: 8 },
})
const jHK = mkMove({
  id: 'j.HK', name: 'Jump Stomp', tag: 'normal', button: 'hk', sprite: nextSprite(),
  airOk: true, startup: 8, active: 3, recovery: 12, hurt: AIR_HURT, push: AIR_PUSH,
  hitbox: [{ x: 30, y: 28, w: 74, h: 54 }],
  hit: { damage: 100, blockstun: 16, hitstun: 20, guard: 'overhead', level: 'heavy',
    kbx: 2.2, hitstop: 15, meterGain: 22, meterGainOnBlock: 8 },
})

// ── Command normal — a forward-lunging overhead that closes the last step. ───
const fHP = mkMove({
  id: 'f.HP', name: 'Lunging Overhead', tag: 'command', button: 'hp', sprite: nextSprite(),
  startup: 20, active: 3, recovery: 14, forward: 46, // busy 17
  hitbox: [{ x: 30, y: 112, w: 66, h: 38 }],
  cancels: ['super'],
  hit: { damage: 72, blockstun: 17 /* ±0 */, hitstun: 24 /* +7 */, guard: 'overhead',
    level: 'medium', kbx: 1.0, pushback: 0.8, hitstop: 14, meterGain: 18, meterGainOnBlock: 6 },
})

// ── Specials ────────────────────────────────────────────────────────────────
// Gut Wrench: the command grab. Half-circle-forward + punch. Longer range and
// more damage than the universal LP+LK throw, and it beats blocking. Still
// techable via the shared throw-tech path — but on a grappler the threat forces
// the opponent to keep mashing tech, which opens them up to strikes.
const gutWrench = mkMove({
  id: 'hcf.P', name: 'Gut Wrench', tag: 'special', motion: '41236', sprite: nextSprite(),
  startup: 6, active: 2, recovery: 24, // whiffs into a big punish, as a grab should
  hitbox: [{ x: 20, y: 40, w: 72, h: 150 }],
  hit: { damage: 165, blockstun: 0, hitstun: 0, guard: 'throw', level: 'heavy',
    kbx: 6, pushback: 0, hitstop: 17, meterGain: 16, meterGainOnBlock: 0 },
})
// Bull Rush: a forward-charging strike that carries Vanguard across the screen —
// its only real approach tool, since it has no fireball.
const bullRush = mkMove({
  id: 'qcf.K', name: 'Bull Rush', tag: 'special', motion: '236', sprite: nextSprite(),
  startup: 12, active: 4, recovery: 22, forward: 96, // busy 26
  hitbox: [{ x: 32, y: 70, w: 82, h: 60 }],
  hit: { damage: 85, blockstun: 18 /* -8 */, hitstun: 24, guard: 'high', level: 'heavy',
    kbx: 2.8, pushback: 0.4, hitstop: 15, meterGain: 22, meterGainOnBlock: 9, scaling: 0.9 },
})
// Rising Knee: the reversal. Strike-invuln launcher like a DP, but shorter reach
// and slightly slower, so it's a worse abstract reversal than Operator's dragon.
const risingKnee = mkMove({
  id: 'dp.K', name: 'Rising Knee', tag: 'special', motion: '623', sprite: nextSprite(),
  startup: 4, active: 6, recovery: 22, // busy 28
  invuln: { from: 0, to: 5, kind: 'strike' },
  hitbox: [{ x: 10, y: 66, w: 52, h: 116 }],
  hit: { damage: 95, blockstun: 18, hitstun: 26, guard: 'high', level: 'launcher',
    kbx: 1.4, kby: 10, pushback: 0, hitstop: 14, meterGain: 10, meterGainOnBlock: 4, juggle: true },
})

// ── Super — a command-grab super. Unblockable, huge damage, and (like the
//    normal grab) resolved on the throw path. ────────────────────────────────
const backbreaker = mkMove({
  id: 'super.P', name: 'Backbreaker', tag: 'super', motion: '632146', cost: 1000,
  sprite: nextSprite(), startup: 5, active: 3, recovery: 34,
  invuln: { from: 0, to: 7, kind: 'full' },
  hitbox: [{ x: 18, y: 40, w: 88, h: 160 }],
  hit: { damage: 360, blockstun: 0, hitstun: 0, guard: 'throw', level: 'heavy',
    kbx: 5, pushback: 0, hitstop: 21, meterGain: 0, meterGainOnBlock: 0 },
})

const seismicToss = mkMove({
  // Universal short throw, shared shape with Operator's but a touch more damage.
  id: 'throw.f', name: 'Body Slam', tag: 'command', sprite: nextSprite(),
  startup: 3, active: 2, recovery: 20,
  hitbox: [{ x: 18, y: 40, w: 46, h: 132 }],
  hit: { damage: 150, blockstun: 0, hitstun: 0, guard: 'throw', level: 'heavy',
    kbx: 6, pushback: 0, hitstop: 15, meterGain: 14, meterGainOnBlock: 0 },
})

const MOVES: Record<string, Move> = {
  [stLP.id]: stLP, [stMP.id]: stMP, [stHP.id]: stHP,
  [stLK.id]: stLK, [stMK.id]: stMK, [stHK.id]: stHK,
  [crLP.id]: crLP, [crMP.id]: crMP, [crHP.id]: crHP,
  [crLK.id]: crLK, [crMK.id]: crMK, [crHK.id]: crHK,
  [jLP.id]: jLP, [jMK.id]: jMK, [jHP.id]: jHP, [jHK.id]: jHK,
  [fHP.id]: fHP,
  [gutWrench.id]: gutWrench, [bullRush.id]: bullRush, [risingKnee.id]: risingKnee,
  [backbreaker.id]: backbreaker,
  [seismicToss.id]: seismicToss,
}

const PUNCHES: Button[] = ['lp', 'mp', 'hp']
const KICKS: Button[] = ['lk', 'mk', 'hk']

function anyOf(set: ReadonlySet<Button>, bs: Button[]): boolean {
  return bs.some((b) => set.has(b))
}
function punchTriggered(ctx: SelectContext): boolean {
  return anyOf(ctx.pressed, PUNCHES) || anyOf(ctx.released, PUNCHES)
}
function kickTriggered(ctx: SelectContext): boolean {
  return anyOf(ctx.pressed, KICKS) || anyOf(ctx.released, KICKS)
}
const isDown = (d: Direction): boolean => d === 1 || d === 2 || d === 3

function select(ctx: SelectContext): Move | null {
  const { pressed, relDir, grounded, meter, log } = ctx

  // Super command grab — full bar + a 632146 roll.
  if (meter >= (backbreaker.cost ?? 0) && punchTriggered(ctx) &&
      detectMotion(log, '632146', 22)) {
    return backbreaker
  }

  if (grounded) {
    if (kickTriggered(ctx) && detectMotion(log, '623', 12)) return risingKnee
    // Command grab before the running kick so a half-circle+P doesn't fall
    // through to a normal.
    if (punchTriggered(ctx) && detectMotion(log, '41236', 16)) return gutWrench
    if (kickTriggered(ctx) && detectMotion(log, '236', 12)) return bullRush
  }

  if (!grounded) {
    if (pressed.has('hp')) return jHP
    if (pressed.has('hk')) return jHK
    if (pressed.has('mp') || pressed.has('mk')) return jMK
    if (pressed.has('lp') || pressed.has('lk')) return jLP
    return null
  }

  // Universal throw.
  if (grounded && pressed.has('lp') && pressed.has('lk')) return seismicToss

  // Command normal — forward + HP overhead lunge.
  if (relDir === 6 && pressed.has('hp')) return fHP

  if (isDown(relDir)) {
    if (pressed.has('hp')) return crHP
    if (pressed.has('hk')) return crHK
    if (pressed.has('mp')) return crMP
    if (pressed.has('mk')) return crMK
    if (pressed.has('lp')) return crLP
    if (pressed.has('lk')) return crLK
    return null
  }

  if (pressed.has('hp')) return stHP
  if (pressed.has('hk')) return stHK
  if (pressed.has('mp')) return stMP
  if (pressed.has('mk')) return stMK
  if (pressed.has('lp')) return stLP
  if (pressed.has('lk')) return stLK
  return null
}

export const VANGUARD: FighterDef = {
  id: 'vanguard',
  name: 'Vanguard',
  health: 1150,
  walkFwd: 3.1,
  walkBack: 1.5,
  // Juggle identity: the grappler gets the SHORTEST air route. It trades air
  // time for a faster hard knockdown into its command-grab okizeme — that is
  // where a grappler's damage lives, not in a long juggle.
  juggleAllowance: JUGGLE_ALLOWANCE - 2,
  moves: MOVES,
  select,
}
