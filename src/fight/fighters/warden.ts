/**
 * "Warden" — the zoner. Where the Operator wants to be in your face and the
 * Vanguard wants to grab you, the Warden wants you exactly one fireball away
 * and hates it when you get in. Its identity is space control:
 *
 *  - Two fireballs at different speeds ("Ion Bolt"). The slow bolt builds a
 *    wall you walk your opponent into; the fast bolt punishes a jump or covers
 *    an approach. Controlling the *pace* of fireballs is the zoner's whole game,
 *    so the strength button picks the speed.
 *  - Long, low-damage pokes with quick recovery — it fences, it doesn't brawl.
 *  - A stationary launcher anti-air (cr.HP) instead of a dragon punch: it has no
 *    invincible reversal, so once you're in, it is in real trouble. That, plus a
 *    low health pool, is the price of controlling the ground.
 *  - A super fireball ("Ion Storm") that cashes out the zoning game from
 *    fullscreen.
 *
 * Fragile (health below the shoto), slow forward walk, strong backward walk —
 * everything says "keep your distance". The fireball *moves* themselves carry no
 * melee hitbox; the projectile (see `projectiles` below) is what strikes, so a
 * bolt thrown point-blank still only does bolt damage and leaves the Warden in
 * committal recovery. That is the counterplay: get in.
 */

import type { Button, Direction, Move } from '../types'
import type { FighterDef, ProjectileSpawn, SelectContext } from '../def'
import {
  AIR_HURT,
  AIR_PUSH,
  CROUCH_HURT,
  CROUCH_PUSH,
  mkHit,
  mkMove,
} from './build'
import { JUGGLE_ALLOWANCE } from '../constants'
import { detectMotion } from '../input/motion'

let spr = 0
const nextSprite = (): number => (spr += 3)

// ── Standing normals — longer reach, quicker recovery, less damage ───────────
const stLP = mkMove({
  id: 'st.LP', name: 'Jab', tag: 'normal', button: 'lp', sprite: nextSprite(),
  startup: 4, active: 2, recovery: 6, // busy 8
  hitbox: [{ x: 24, y: 104, w: 54, h: 24 }],
  cancels: ['special', 'super'],
  hit: { damage: 26, blockstun: 10 /* +2 */, hitstun: 13 /* +5 */, guard: 'high',
    level: 'light', kbx: 0.7, pushback: 0.5, hitstop: 8, meterGain: 11, meterGainOnBlock: 4 },
})
const stMP = mkMove({
  id: 'st.MP', name: 'Extend Palm', tag: 'normal', button: 'mp', sprite: nextSprite(),
  startup: 7, active: 3, recovery: 11, // total 21, busy 14 — a long disjoint poke
  hitbox: [{ x: 44, y: 100, w: 76, h: 30 }],
  cancels: ['special', 'super'],
  hit: { damage: 50, blockstun: 13 /* -1 */, hitstun: 16 /* +2 */, guard: 'high',
    level: 'medium', kbx: 1.2, pushback: 1.4, hitstop: 9, meterGain: 14, meterGainOnBlock: 6 },
})
const stHP = mkMove({
  // Stationary anti-air-ish: tall upward box, hits above and in front. Not
  // invincible — the Warden has no reversal — so it must be used pre-emptively.
  id: 'st.HP', name: 'Skyward Lance', tag: 'normal', button: 'hp', sprite: nextSprite(),
  startup: 9, active: 4, recovery: 18, // total 31, busy 22 — unsafe if blocked
  hitbox: [{ x: 18, y: 90, w: 60, h: 96 }],
  hit: { damage: 80, blockstun: 16 /* -6 */, hitstun: 22, guard: 'high', level: 'heavy',
    kbx: 2.0, pushback: 1.2, hitstop: 11, meterGain: 18, meterGainOnBlock: 7 },
})
const stLK = mkMove({
  id: 'st.LK', name: 'Shin Kick', tag: 'normal', button: 'lk', sprite: nextSprite(),
  startup: 5, active: 2, recovery: 8, // busy 10
  hitbox: [{ x: 28, y: 66, w: 60, h: 28 }],
  cancels: ['special', 'super'],
  hit: { damage: 28, blockstun: 11 /* +1 */, hitstun: 14 /* +4 */, guard: 'high',
    level: 'light', kbx: 0.7, pushback: 0.5, hitstop: 8, meterGain: 11, meterGainOnBlock: 4 },
})
const stMK = mkMove({
  id: 'st.MK', name: 'Long Kick', tag: 'normal', button: 'mk', sprite: nextSprite(),
  startup: 8, active: 3, recovery: 13, // total 24, busy 16 — whiff-punish range
  hitbox: [{ x: 52, y: 78, w: 84, h: 30 }],
  hit: { damage: 55, blockstun: 13 /* -3 */, hitstun: 17 /* +1 */, guard: 'high',
    level: 'medium', kbx: 1.6, pushback: 1.4, hitstop: 9, meterGain: 14, meterGainOnBlock: 6 },
})
const stHK = mkMove({
  id: 'st.HK', name: 'Sweeping Lance', tag: 'normal', button: 'hk', sprite: nextSprite(),
  startup: 12, active: 2, recovery: 20, // total 34, busy 22 — huge range, huge commit
  hitbox: [{ x: 56, y: 84, w: 96, h: 40 }],
  hit: { damage: 95, blockstun: 16 /* -6 */, hitstun: 24, guard: 'high', level: 'heavy',
    kbx: 3.0, pushback: 2.0, hitstop: 12, meterGain: 20, meterGainOnBlock: 8 },
})

// ── Crouching normals ────────────────────────────────────────────────────────
const crLP = mkMove({
  id: 'cr.LP', name: 'Crouch Jab', tag: 'normal', button: 'lp', sprite: nextSprite(),
  startup: 4, active: 2, recovery: 6, hurt: CROUCH_HURT, push: CROUCH_PUSH, // busy 8
  hitbox: [{ x: 22, y: 58, w: 52, h: 22 }],
  cancels: ['special', 'super'],
  hit: { damage: 24, blockstun: 10 /* +2 */, hitstun: 13 /* +5 */, guard: 'high',
    level: 'light', kbx: 0.6, pushback: 0.4, hitstop: 8, meterGain: 10, meterGainOnBlock: 4 },
})
const crMP = mkMove({
  id: 'cr.MP', name: 'Crouch Extend', tag: 'normal', button: 'mp', sprite: nextSprite(),
  startup: 6, active: 3, recovery: 11, hurt: CROUCH_HURT, push: CROUCH_PUSH, // busy 14
  hitbox: [{ x: 40, y: 64, w: 72, h: 28 }],
  cancels: ['special', 'super'],
  hit: { damage: 48, blockstun: 12 /* -2 */, hitstun: 15 /* +1 */, guard: 'high',
    level: 'medium', kbx: 1.0, pushback: 1.0, hitstop: 9, meterGain: 13, meterGainOnBlock: 6 },
})
const crHP = mkMove({
  // The Warden's only launcher and its dedicated anti-air. Tall box, pops up for
  // a light juggle, but startup-slow and horribly unsafe: it is a read, not a
  // panic button.
  id: 'cr.HP', name: 'Rising Spire', tag: 'normal', button: 'hp', sprite: nextSprite(),
  startup: 8, active: 4, recovery: 20, hurt: CROUCH_HURT, push: CROUCH_PUSH, // busy 24
  hitbox: [{ x: 12, y: 62, w: 54, h: 122 }],
  cancels: ['super'],
  hit: { damage: 80, blockstun: 16 /* -8 */, hitstun: 24, guard: 'high', level: 'launcher',
    kbx: 1.0, kby: 9, pushback: 1.0, hitstop: 11, meterGain: 18, meterGainOnBlock: 7, juggle: true },
})
const crLK = mkMove({
  id: 'cr.LK', name: 'Low Shin', tag: 'normal', button: 'lk', sprite: nextSprite(),
  startup: 4, active: 2, recovery: 7, hurt: CROUCH_HURT, push: CROUCH_PUSH, // busy 9
  hitbox: [{ x: 24, y: 18, w: 56, h: 22 }],
  cancels: ['special', 'super'],
  hit: { damage: 24, blockstun: 10 /* +1 */, hitstun: 13 /* +4 */, guard: 'low',
    level: 'light', kbx: 0.6, pushback: 0.4, hitstop: 8, meterGain: 10, meterGainOnBlock: 4 },
})
const crMK = mkMove({
  id: 'cr.MK', name: 'Low Sweep Poke', tag: 'normal', button: 'mk', sprite: nextSprite(),
  startup: 7, active: 3, recovery: 13, hurt: CROUCH_HURT, push: CROUCH_PUSH, // busy 16
  hitbox: [{ x: 50, y: 22, w: 88, h: 24 }],
  cancels: ['special', 'super'], // low hit-confirm into a bolt
  hit: { damage: 52, blockstun: 13 /* -3 */, hitstun: 17 /* +1 */, guard: 'low',
    level: 'medium', kbx: 1.2, pushback: 1.4, hitstop: 9, meterGain: 14, meterGainOnBlock: 6 },
})
const crHK = mkMove({
  id: 'cr.HK', name: 'Sweep', tag: 'normal', button: 'hk', sprite: nextSprite(),
  startup: 9, active: 3, recovery: 21, hurt: CROUCH_HURT, push: CROUCH_PUSH, // busy 24
  hitbox: [{ x: 44, y: 16, w: 90, h: 26 }],
  hit: { damage: 85, blockstun: 15 /* -9 */, hitstun: 28, guard: 'low', level: 'sweep',
    kbx: 3.0, pushback: 1.0, hitstop: 12, meterGain: 18, meterGainOnBlock: 8 },
})

// ── Jumping normals (overheads) ──────────────────────────────────────────────
const jLP = mkMove({
  id: 'j.LP', name: 'Jump Jab', tag: 'normal', button: 'lp', sprite: nextSprite(),
  airOk: true, startup: 5, active: 6, recovery: 6, hurt: AIR_HURT, push: AIR_PUSH,
  hitbox: [{ x: 16, y: 78, w: 54, h: 40 }],
  hit: { damage: 36, blockstun: 12, hitstun: 16, guard: 'overhead', level: 'light',
    kbx: 0.8, hitstop: 9, meterGain: 11, meterGainOnBlock: 4 },
})
const jMK = mkMove({
  id: 'j.MK', name: 'Jump Kick', tag: 'normal', button: 'mk', sprite: nextSprite(),
  airOk: true, startup: 8, active: 4, recovery: 8, hurt: AIR_HURT, push: AIR_PUSH,
  hitbox: [{ x: 28, y: 38, w: 66, h: 46 }],
  hit: { damage: 56, blockstun: 14, hitstun: 18, guard: 'overhead', level: 'medium',
    kbx: 1.2, hitstop: 10, meterGain: 14, meterGainOnBlock: 6 },
})
const jHP = mkMove({
  id: 'j.HP', name: 'Jump Lance', tag: 'normal', button: 'hp', sprite: nextSprite(),
  airOk: true, startup: 9, active: 4, recovery: 10, hurt: AIR_HURT, push: AIR_PUSH,
  hitbox: [{ x: 22, y: 68, w: 72, h: 52 }],
  hit: { damage: 85, blockstun: 16, hitstun: 20, guard: 'overhead', level: 'heavy',
    kbx: 2.0, hitstop: 11, meterGain: 18, meterGainOnBlock: 8 },
})

// ── Command normal — a slow overhead to open up a crouch-blocker ─────────────
const fMP = mkMove({
  id: 'f.MP', name: 'Falling Star', tag: 'command', button: 'mp', sprite: nextSprite(),
  startup: 20, active: 3, recovery: 16, forward: 16, // busy 19
  hitbox: [{ x: 26, y: 108, w: 62, h: 34 }],
  cancels: ['super'],
  hit: { damage: 60, blockstun: 16 /* -3 */, hitstun: 21 /* +2 */, guard: 'overhead',
    level: 'medium', kbx: 1.2, pushback: 1.0, hitstop: 10, meterGain: 14, meterGainOnBlock: 6 },
})

// ── Fireball moves — no melee hitbox; the projectile does the work ───────────
// Startup here is "frames until the bolt appears" (its first active frame). The
// long recovery is the whole balance lever: a whiffed or blocked-up-close bolt
// is a full punish.
const boltSlow = mkMove({
  id: 'qcf.slow', name: 'Ion Bolt', tag: 'special', motion: '236', button: 'lp', sprite: nextSprite(),
  startup: 13, active: 3, recovery: 26, // busy 29 — the "wall" bolt, very committal
  hitbox: [],
  hit: { damage: 0, blockstun: 0, hitstun: 0, guard: 'high', level: 'medium', hitstop: 0 },
})
const boltFast = mkMove({
  id: 'qcf.fast', name: 'Ion Bolt (Charged)', tag: 'special', motion: '236', button: 'hp', sprite: nextSprite(),
  startup: 11, active: 3, recovery: 22, // busy 25 — faster ball, covers approaches
  hitbox: [],
  hit: { damage: 0, blockstun: 0, hitstun: 0, guard: 'high', level: 'medium', hitstop: 0 },
})

// ── Super fireball ───────────────────────────────────────────────────────────
const ionStorm = mkMove({
  id: 'super.storm', name: 'Ion Storm', tag: 'super', motion: '236236', button: 'hp', cost: 1000,
  sprite: nextSprite(), startup: 8, active: 3, recovery: 34, // busy 37
  hitbox: [],
  hit: { damage: 0, blockstun: 0, hitstun: 0, guard: 'high', level: 'crumple', hitstop: 0 },
})

// ── Throw — okizeme after a knockdown ────────────────────────────────────────
const repelToss = mkMove({
  id: 'throw.f', name: 'Repel Toss', tag: 'command', sprite: nextSprite(),
  startup: 3, active: 2, recovery: 20,
  hitbox: [{ x: 18, y: 40, w: 44, h: 130 }],
  hit: { damage: 120, blockstun: 0, hitstun: 0, guard: 'throw', level: 'heavy',
    kbx: 6, pushback: 0, hitstop: 12, meterGain: 12, meterGainOnBlock: 0 },
})

const MOVES: Record<string, Move> = {
  [stLP.id]: stLP, [stMP.id]: stMP, [stHP.id]: stHP,
  [stLK.id]: stLK, [stMK.id]: stMK, [stHK.id]: stHK,
  [crLP.id]: crLP, [crMP.id]: crMP, [crHP.id]: crHP,
  [crLK.id]: crLK, [crMK.id]: crMK, [crHK.id]: crHK,
  [jLP.id]: jLP, [jMK.id]: jMK, [jHP.id]: jHP,
  [fMP.id]: fMP,
  [boltSlow.id]: boltSlow, [boltFast.id]: boltFast,
  [ionStorm.id]: ionStorm,
  [repelToss.id]: repelToss,
}

// ── Projectile table — which move spawns which fireball ──────────────────────
const PROJECTILES: Record<string, ProjectileSpawn> = {
  [boltSlow.id]: {
    kind: 'ion-bolt', speed: 5.0, originX: 62, originY: 96,
    hitbox: { x: -28, y: -22, w: 56, h: 44 },
    hit: mkHit({ damage: 50, blockstun: 15, hitstun: 18, chip: 8, guard: 'high', level: 'medium',
      kbx: 2.4, pushback: 0, hitstop: 10, meterGain: 14, meterGainOnBlock: 6, scaling: 0.85 }),
    life: 200,
  },
  [boltFast.id]: {
    kind: 'ion-bolt', speed: 9.0, originX: 62, originY: 96,
    hitbox: { x: -30, y: -22, w: 60, h: 44 },
    hit: mkHit({ damage: 60, blockstun: 16, hitstun: 20, chip: 10, guard: 'high', level: 'medium',
      kbx: 2.8, pushback: 0, hitstop: 10, meterGain: 16, meterGainOnBlock: 7, scaling: 0.85 }),
    life: 150,
  },
  [ionStorm.id]: {
    kind: 'super-beam', speed: 12.0, originX: 60, originY: 96,
    hitbox: { x: -44, y: -52, w: 84, h: 112 },
    hit: mkHit({ damage: 240, blockstun: 22, hitstun: 30, chip: 24, guard: 'high', level: 'crumple',
      kbx: 4.0, kby: 3, pushback: 0, hitstop: 15, meterGain: 0, meterGainOnBlock: 0, scaling: 0.5 }),
    life: 120,
  },
}

const PUNCHES: Button[] = ['lp', 'mp', 'hp']

function anyOf(set: ReadonlySet<Button>, bs: Button[]): boolean {
  return bs.some((b) => set.has(b))
}
function punchTriggered(ctx: SelectContext): boolean {
  return anyOf(ctx.pressed, PUNCHES) || anyOf(ctx.released, PUNCHES)
}
const isDown = (d: Direction): boolean => d === 1 || d === 2 || d === 3

/**
 * Input → move. Supers beat specials beat command normals beat normals. The two
 * fireball strengths are split by punch button: a heavy press throws the fast
 * bolt, anything else the slow one — the pace knob that makes a zoner a zoner.
 */
function select(ctx: SelectContext): Move | null {
  const { pressed, relDir, grounded, meter, log } = ctx

  // Super — full bar and a double-qcf. Fires the Ion Storm beam.
  if (meter >= (ionStorm.cost ?? 0) && punchTriggered(ctx) && detectMotion(log, '236236', 20)) {
    return ionStorm
  }

  // Fireballs (grounded). Heavy punch → fast bolt, else slow bolt.
  if (grounded && punchTriggered(ctx) && detectMotion(log, '236', 12)) {
    return pressed.has('hp') ? boltFast : boltSlow
  }

  // Airborne: air normals only.
  if (!grounded) {
    if (pressed.has('hp')) return jHP
    if (pressed.has('mp') || pressed.has('mk')) return jMK
    if (pressed.has('lp') || pressed.has('lk')) return jLP
    return null
  }

  // Throw — universal LP+LK.
  if (pressed.has('lp') && pressed.has('lk')) return repelToss

  // Command overhead on a forward hold.
  if (relDir === 6 && pressed.has('mp')) return fMP

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

export const WARDEN: FighterDef = {
  id: 'warden',
  name: 'Warden',
  health: 900,
  // Slow to advance, quick to retreat: everything about mobility says "stay out".
  walkFwd: 2.0,
  walkBack: 2.6,
  // Juggle identity: the zoner's juggle is a short repositioning tool — enough
  // to cash out an anti-air and reset to a zoning advantage, not a full combo.
  juggleAllowance: JUGGLE_ALLOWANCE - 1,
  moves: MOVES,
  projectiles: PROJECTILES,
  select,
}
