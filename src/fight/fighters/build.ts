/**
 * Helpers for authoring moves. Writing a full MoveFrame[] by hand — hurtboxes,
 * pushboxes and hitboxes for every startup/active/recovery frame — is where
 * fighting-game data usually rots, so moves are described declaratively here
 * and the per-frame array is generated. The generator is the single place that
 * decides "hitboxes are only live during the active window", which keeps the
 * whole moveset honest.
 */

import type { Box, Hit, HitLevel, Guard, Move, MoveFrame, MoveTag, Vec2 } from '../types'
import { PUSHBOX_H, PUSHBOX_W, REACH_BONUS, KB_X_SCALE, KB_Y_SCALE } from '../constants'

// Standard body boxes, authored facing right with the origin at the feet.
export const STAND_HURT: Box = { x: -24, y: 0, w: 48, h: 168 }
export const CROUCH_HURT: Box = { x: -26, y: 0, w: 52, h: 104 }
export const AIR_HURT: Box = { x: -24, y: 0, w: 48, h: 150 }

export const STAND_PUSH: Box = { x: -PUSHBOX_W / 2, y: 0, w: PUSHBOX_W, h: PUSHBOX_H }
export const CROUCH_PUSH: Box = { x: -PUSHBOX_W / 2, y: 0, w: PUSHBOX_W, h: 104 }
export const AIR_PUSH: Box = { x: -28, y: 0, w: 56, h: 150 }

export interface HitSpec {
  damage: number
  hitstun: number
  blockstun: number
  guard: Guard
  level: HitLevel
  chip?: number
  /** Horizontal knockback (cm/frame); positive = away from attacker. */
  kbx?: number
  /** Vertical knockback — the pop-up on launchers. */
  kby?: number
  /** How far the attacker slides back on contact. */
  pushback?: number
  hitstop: number
  meterGain?: number
  meterGainOnBlock?: number
  scaling?: number
  juggle?: boolean
}

export function mkHit(s: HitSpec): Hit {
  // Scale the authored impulse into values that read as contact. Throws are
  // excluded: their toss distance is authored directly (see KB_X_SCALE doc).
  const isThrow = s.guard === 'throw'
  const kx = (s.kbx ?? 0) * (isThrow ? 1 : KB_X_SCALE[s.level])
  const ky = (s.kby ?? 0) * (isThrow ? 1 : KB_Y_SCALE)
  return {
    damage: s.damage,
    hitstun: s.hitstun,
    blockstun: s.blockstun,
    chip: s.chip ?? 0,
    guard: s.guard,
    level: s.level,
    knockback: { x: kx, y: ky },
    pushback: s.pushback ?? 0,
    hitstop: s.hitstop,
    meterGain: s.meterGain ?? 0,
    meterGainOnBlock: s.meterGainOnBlock ?? 0,
    scaling: s.scaling ?? 1,
    juggle: s.juggle,
  }
}

export interface MoveSpec {
  id: string
  name: string
  tag: MoveTag
  motion?: string
  button?: Move['button']
  cost?: number
  startup: number
  active: number
  recovery: number
  hitbox: Box[]
  hit: HitSpec
  hurt?: Box
  push?: Box
  airOk?: boolean
  /** Total forward root-motion (cm) spread evenly across the active frames —
   *  what makes a lunge carry the body. Negative moves the fighter back. */
  forward?: number
  /** Per-frame vertical impulse pairs for rising moves like a dragon punch. */
  rise?: { frame: number; y: number }[]
  /** Invulnerability window [from,to] inclusive, in move-frame indices. */
  invuln?: { from: number; to: number; kind: 'full' | 'strike' | 'throw' }
  /** What the active frames may be cancelled into (empty = no cancels). */
  cancels?: MoveTag[]
  /** First sprite index for this move; frames step through phase sprites. */
  sprite?: number
}

/**
 * Expand a MoveSpec into a fully-populated Move. Startup frames carry only the
 * body hurtbox, active frames add the attack hitboxes, recovery frames drop
 * them again.
 */
export function mkMove(spec: MoveSpec): Move {
  const total = spec.startup + spec.active + spec.recovery
  const hurt = spec.hurt ?? STAND_HURT
  const push = spec.push ?? STAND_PUSH
  const base = spec.sprite ?? 0
  const perActiveForward = spec.forward ? spec.forward / spec.active : 0

  const frames: MoveFrame[] = []
  // Extend every attack's forward reach by REACH_BONUS so moves still connect
  // now that the wider pushbox holds fighters further apart. Reach is the far
  // edge, so we grow width and leave the near edge (x) where it was authored.
  const reach = spec.hitbox.map((b) => ({ ...b, w: b.w + REACH_BONUS }))
  for (let f = 0; f < total; f++) {
    const isStartup = f < spec.startup
    const isActive = f >= spec.startup && f < spec.startup + spec.active
    const phase = isStartup ? 0 : isActive ? 1 : 2

    let motion: Vec2 | undefined
    if (isActive && perActiveForward) motion = { x: perActiveForward, y: 0 }
    const riseHere = spec.rise?.find((r) => r.frame === f)
    if (riseHere) motion = { x: motion?.x ?? 0, y: riseHere.y }

    let invuln: MoveFrame['invuln']
    if (spec.invuln && f >= spec.invuln.from && f <= spec.invuln.to) {
      invuln = spec.invuln.kind
    }

    frames.push({
      sprite: base + phase,
      hitboxes: isActive ? reach : [],
      hurtboxes: [hurt],
      pushbox: push,
      motion,
      invuln,
      cancels: isActive ? spec.cancels : undefined,
    })
  }

  return {
    id: spec.id,
    name: spec.name,
    tag: spec.tag,
    motion: spec.motion,
    button: spec.button,
    cost: spec.cost,
    frames,
    active: [spec.startup, spec.startup + spec.active - 1],
    hit: mkHit(spec.hit),
    airOk: spec.airOk,
  }
}
