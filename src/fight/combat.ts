/**
 * Combat resolution: hitbox/hurtbox overlap, blocking rules, damage scaling,
 * meter, knockback, launches and knockdowns.
 *
 * Detection and application are split into two passes so that when both
 * fighters have an active hitbox on the same frame they genuinely trade —
 * applying one hit first would wipe the other's move before it was tested.
 */

import type { Box, Direction, FightEvent, FightState, FighterState, Hit } from './types'
import type { FighterDef } from './def'
import { anyOverlap, contactPoint, placeBox } from './geometry'
import { dirOf, hasButton, pressedOf } from './input/motion'
import {
  AIR_HURT,
  CROUCH_HURT,
  STAND_HURT,
} from './fighters/build'
import {
  BACKDASH_FRAMES,
  BACKDASH_INVULN,
  COMBO_SCALING,
  JUGGLE_ALLOWANCE,
  KNOCKDOWN_FRAMES,
  MAX_METER,
  MIN_DAMAGE,
  MIN_SCALE,
  PARRY_FREEZE,
  PARRY_LOCK,
  PARRY_METER,
  PARRY_WINDOW,
  THROW_TECH_FRAMES,
  THROW_TECH_PUSH,
  THROW_TECH_WINDOW,
} from './constants'

/** Progressive combo scaling with a floor — long combos taper, never vanish. */
export function scaleDamage(base: number, comboCount: number, moveScaling: number): number {
  const idx = Math.min(comboCount, COMBO_SCALING.length - 1)
  let scale = COMBO_SCALING[idx] * moveScaling
  if (scale < MIN_SCALE) scale = MIN_SCALE
  return Math.max(MIN_DAMAGE, Math.round(base * scale))
}

function moveFrame(f: FighterState, def: FighterDef) {
  if (!f.move) return undefined
  const m = def.moves[f.move.id]
  if (!m) return undefined
  return m.frames[f.move.frame]
}

/** Hurtboxes a fighter presents this frame, already placed in world space. A
 *  grounded knocked-down fighter shows none — you can't OTG them, which is one
 *  guard against ground-loop infinites. */
function hurtboxesOf(f: FighterState, def: FighterDef): Box[] {
  if (f.stance === 'knockdown' || f.stance === 'wakeup' || f.stance === 'ko') return []
  const mf = moveFrame(f, def)
  const boxes = mf
    ? mf.hurtboxes
    : [f.stance === 'crouch' ? CROUCH_HURT : !f.grounded ? AIR_HURT : STAND_HURT]
  return boxes.map((b) => placeBox(b, f.pos, f.facing))
}

/** Whether a fighter is currently invulnerable and to what. Covers move-data
 *  invuln (a DP's reversal frames) and the early frames of a backdash. */
function invulnOf(f: FighterState, def: FighterDef): 'none' | 'full' | 'strike' | 'throw' {
  if (f.stance === 'backdash' && BACKDASH_FRAMES - f.stunRemaining < BACKDASH_INVULN) {
    return 'full'
  }
  const mf = moveFrame(f, def)
  if (mf?.invuln && mf.invuln !== 'none') return mf.invuln
  return 'none'
}

/** Can this defender block the incoming guard, given the direction they hold? */
function isBlocking(d: FighterState, guard: Hit['guard'], relDir: Direction): boolean {
  if (!d.grounded || d.stunRemaining > 0 || d.stance === 'attack') return false
  if (guard === 'throw' || guard === 'unblockable') return false
  // 4 = standing back, 1 = crouching back.
  if (guard === 'low') return relDir === 1
  if (guard === 'overhead') return relDir === 4
  return relDir === 4 || relDir === 1 // high: either guard blocks
}

/** Is this fighter in a state where a parry attempt is even possible? Not
 *  stunned (hitstun/blockstun), not committed to their own move, not on the
 *  floor or mid-juggle. Neutral, walking, crouching and airborne are all fine —
 *  a parry is a defensive read you make while free. */
function canParry(d: FighterState): boolean {
  if (d.stunRemaining > 0) return false
  switch (d.stance) {
    case 'attack':
    case 'juggle':
    case 'knockdown':
    case 'wakeup':
    case 'throw-tech':
    case 'ko':
    case 'dash':
    case 'backdash':
      return false
    default:
      return true
  }
}

/** The exact direction that parries a given guard. High/overhead (and airborne
 *  attacks) parry FORWARD (6); lows parry straight DOWN (2). Throws and
 *  unblockables cannot be parried. Chosen distinct from the block directions
 *  (back / down-back) so blocking and parrying never collapse into one input. */
function parryDirFor(guard: Hit['guard']): Direction | null {
  if (guard === 'throw' || guard === 'unblockable') return null
  if (guard === 'low') return 2
  return 6
}

/** Was there a FRESH tap into `dir` within the last `window` frames? Fresh
 *  means a real edge (the previous frame was a different direction), so holding
 *  forward to walk does not arm a perpetual parry — you must re-tap. This is the
 *  anti-mash property that makes parry a read rather than a hold. */
function freshTapWithin(log: number[], dir: Direction, window: number): boolean {
  const start = Math.max(0, log.length - window)
  for (let i = log.length - 1; i >= start; i--) {
    if (dirOf(log[i]) !== dir) continue
    const prev = i > 0 ? dirOf(log[i - 1]) : 5
    if (prev !== dir) return true
  }
  return false
}

/** Did the defender parry this incoming hit? Combines "can I parry right now"
 *  with "did I tap the right direction in the window". */
function isParrying(d: FighterState, guard: Hit['guard'], log: number[]): boolean {
  if (!canParry(d)) return false
  const dir = parryDirFor(guard)
  if (dir === null) return false
  return freshTapWithin(log, dir, PARRY_WINDOW)
}

interface Pending {
  ai: 0 | 1
  blocked: boolean
  parried: boolean
  hit: Hit
  at: { x: number; y: number }
}

/**
 * Resolve all attacks for the frame. Mutates `s` and appends events. `relDirs`
 * is each fighter's facing-relative direction this frame, needed for blocking.
 */
export function resolveCombat(
  s: FightState,
  defs: [FighterDef, FighterDef],
  relDirs: [Direction, Direction],
  events: FightEvent[],
): void {
  const pending: Pending[] = []

  for (let ai = 0 as 0 | 1; ai <= 1; ai = (ai + 1) as 0 | 1) {
    const A = s.fighters[ai]
    const defA = defs[ai]
    if (A.stance !== 'attack' || !A.move || A.attackConnected) continue
    const move = defA.moves[A.move.id]
    if (!move) continue
    const fi = A.move.frame
    if (fi < move.active[0] || fi > move.active[1]) continue
    const fr = move.frames[fi]
    if (!fr || fr.hitboxes.length === 0) continue

    const di = (1 - ai) as 0 | 1
    const D = s.fighters[di]
    const defD = defs[di]

    // Throws resolve on their own path: unblockable, grounded-only, techable,
    // and immediate (they never "trade" in the pending pass). Doing this before
    // the strike logic keeps a grab from being gated by juggle/strike-invuln.
    if (move.hit.guard === 'throw') {
      if (!throwable(D)) continue
      const invD = invulnOf(D, defD)
      if (invD === 'full' || invD === 'throw') continue
      const hb = fr.hitboxes.map((b) => placeBox(b, A.pos, A.facing))
      const hu = hurtboxesOf(D, defD)
      if (!anyOverlap(hb, hu)) continue
      const at = contactPoint(hb, hu) ?? { x: A.pos.x, y: A.pos.y + 90 }
      resolveThrow(s, ai, di, move.hit, at, events)
      continue
    }

    // Juggle gating: an airborne defender out of allowance can't be hit.
    if (!D.grounded && D.juggleLeft <= 0) continue

    const inv = invulnOf(D, defD)
    if (inv === 'full' || inv === 'strike') continue // all our attacks are strikes

    const hitboxes = fr.hitboxes.map((b) => placeBox(b, A.pos, A.facing))
    const hurt = hurtboxesOf(D, defD)
    if (!anyOverlap(hitboxes, hurt)) continue

    const at = contactPoint(hitboxes, hurt) ?? { x: A.pos.x, y: A.pos.y + 90 }
    const logD = s.inputLog?.[di] ?? []
    // Parry is checked before block: it needs a distinct forward/down tap, so it
    // never collides with a back/down-back block, but a fighter who read the hit
    // and tapped in should get the parry rather than merely blocking.
    const parried = isParrying(D, move.hit.guard, logD)
    pending.push({
      ai,
      blocked: !parried && isBlocking(D, move.hit.guard, relDirs[di]),
      parried,
      hit: move.hit,
      at,
    })
  }

  if (pending.length === 0) {
    // Report whiffs so the renderer can play swing audio.
    for (let ai = 0 as 0 | 1; ai <= 1; ai = (ai + 1) as 0 | 1) {
      const A = s.fighters[ai]
      const move = A.move ? defs[ai].moves[A.move.id] : undefined
      if (move && A.move && A.move.frame === move.active[0] && !A.attackConnected) {
        events.push({ type: 'whiff', at: { x: A.pos.x, y: A.pos.y + 90 }, attacker: ai })
      }
    }
    return
  }

  for (const p of pending) {
    const A = s.fighters[p.ai]
    const D = s.fighters[(1 - p.ai) as 0 | 1]
    A.attackConnected = true
    s.hitstop = Math.max(s.hitstop, p.hit.hitstop)
    if (p.parried) resolveParry(s, A, D, p.at, p.ai, events)
    else if (p.blocked) applyBlock(A, D, p.hit, p.at, p.ai, events)
    else applyHit(A, D, p.hit, p.at, p.ai, events)
  }
}

/**
 * A parried hit: the defender eats nothing — no damage, no chip, no knockback —
 * banks meter, and recovers almost immediately (PARRY_LOCK frames) while the
 * attacker is left in the full recovery of a move that "connected", so the
 * parrier comes out heavily plus. Both fighters share a PARRY_FREEZE hitstop for
 * the signature flash; because it is equal on both sides it does not eat into
 * the advantage. The attacker's move is NOT reset (attackConnected is already
 * set by the caller), so it cannot re-hit on a later active frame.
 */
function resolveParry(
  s: FightState, A: FighterState, D: FighterState, at: Pending['at'], ai: 0 | 1, events: FightEvent[],
): void {
  void A
  s.hitstop = Math.max(s.hitstop, PARRY_FREEZE)
  D.meter = Math.min(MAX_METER, D.meter + PARRY_METER)
  // Snap the defender out of any block/walk into a short, actionable recovery.
  D.stance = D.grounded ? 'idle' : 'jump-fall'
  D.stunRemaining = PARRY_LOCK
  D.vel.x = 0
  D.lastHitAt = at
  events.push({ type: 'parry', at, attacker: ai })
}

// ── Throws ───────────────────────────────────────────────────────────────────

/** Can this fighter be grabbed right now? Grounded, not stunned (throws don't
 *  work through hitstun/blockstun — that's throw protection), and not already on
 *  the floor, airborne, KO'd or mid-tech. Attacking/walking/crouching is fair
 *  game: throws beat buttons. */
function throwable(d: FighterState): boolean {
  if (!d.grounded || d.stunRemaining > 0) return false
  switch (d.stance) {
    case 'juggle':
    case 'knockdown':
    case 'wakeup':
    case 'throw-tech':
    case 'ko':
      return false
    default:
      return true
  }
}

/** Did the fighter mash a throw (LP+LK on one frame) within `window` frames?
 *  That is the tech: a throw attempt of one's own while being grabbed breaks it. */
function attemptedThrow(log: number[], window: number): boolean {
  const start = Math.max(0, log.length - window)
  for (let i = log.length - 1; i >= start; i--) {
    const p = pressedOf(log[i])
    if (hasButton(p, 'lp') && hasButton(p, 'lk')) return true
  }
  return false
}

function resolveThrow(
  s: FightState, ai: 0 | 1, di: 0 | 1, hit: Hit, at: { x: number; y: number }, events: FightEvent[],
): void {
  const A = s.fighters[ai]
  const D = s.fighters[di]
  A.attackConnected = true
  s.hitstop = Math.max(s.hitstop, hit.hitstop)

  const log = s.inputLog?.[di] ?? []
  if (attemptedThrow(log, THROW_TECH_WINDOW)) {
    // Teched: both break out to neutral, no damage, shared recovery. Both moves
    // are aborted so neither can grab again on the next frame.
    A.move = undefined
    A.attackConnected = false
    A.stance = 'throw-tech'
    A.stunRemaining = THROW_TECH_FRAMES
    A.vel.x = -A.facing * THROW_TECH_PUSH
    D.move = undefined
    D.attackConnected = false
    D.stance = 'throw-tech'
    D.stunRemaining = THROW_TECH_FRAMES
    D.vel.x = A.facing * THROW_TECH_PUSH
    D.lastHitAt = at
    // No dedicated tech event exists in the frozen contract, and inventing one
    // would hand the renderer a type it can't switch on. The paired transition
    // to the 'throw-tech' stance is the signal; the renderer reads that.
    return
  }

  // Clean throw: unscaled damage, hard knockdown, meter to the thrower only.
  A.meter = Math.min(MAX_METER, A.meter + hit.meterGain)
  D.health = Math.max(0, D.health - hit.damage)
  D.move = undefined
  D.attackConnected = false
  D.comboCount = 0
  D.grounded = true
  D.vel.x = A.facing * hit.knockback.x
  D.vel.y = 0
  D.stance = 'knockdown'
  D.stunRemaining = KNOCKDOWN_FRAMES
  D.lastHitAt = at
  events.push({ type: 'throw', at, attacker: ai })
  events.push({ type: 'knockdown', at, who: di })
}

function applyBlock(
  A: FighterState, D: FighterState, hit: Hit, at: Pending['at'], ai: 0 | 1, events: FightEvent[],
): void {
  D.health = Math.max(0, D.health - hit.chip)
  D.meter = Math.min(MAX_METER, D.meter + hit.meterGainOnBlock)
  A.meter = Math.min(MAX_METER, A.meter + Math.floor(hit.meterGainOnBlock * 0.5))
  D.stance = 'blockstun'
  D.stunRemaining = hit.blockstun
  D.vel.x = A.facing * hit.knockback.x * 0.5
  A.vel.x += -A.facing * hit.pushback
  D.lastHitAt = at
  events.push({ type: 'block', at, attacker: ai })
}

function applyHit(
  A: FighterState, D: FighterState, hit: Hit, at: Pending['at'], ai: 0 | 1, events: FightEvent[],
): void {
  const dmg = scaleDamage(hit.damage, D.comboCount, hit.scaling)
  D.health = Math.max(0, D.health - dmg)
  D.comboCount += 1
  A.meter = Math.min(MAX_METER, A.meter + hit.meterGain)
  D.meter = Math.min(MAX_METER, D.meter + Math.floor(hit.meterGain * 0.3))

  D.vel.x = A.facing * hit.knockback.x
  D.move = undefined
  D.attackConnected = false
  D.lastHitAt = at

  if (hit.juggle) {
    if (D.grounded) {
      D.grounded = false
      D.juggleLeft = JUGGLE_ALLOWANCE
    } else {
      D.juggleLeft = Math.max(0, D.juggleLeft - 1)
    }
    D.vel.y = hit.knockback.y
    D.stance = 'juggle'
    D.stunRemaining = hit.hitstun
    events.push({ type: 'launch', at, attacker: ai })
  } else if (hit.level === 'sweep') {
    D.stance = 'knockdown'
    D.stunRemaining = KNOCKDOWN_FRAMES
    events.push({ type: 'knockdown', at, who: (1 - ai) as 0 | 1 })
  } else if (!D.grounded) {
    D.juggleLeft = Math.max(0, D.juggleLeft - 1)
    D.stance = 'juggle'
    D.stunRemaining = hit.hitstun
    D.vel.y += hit.knockback.y
  } else {
    D.stance = 'hitstun'
    D.stunRemaining = hit.hitstun
  }

  A.vel.x += -A.facing * hit.pushback
  events.push({ type: 'hit', at, attacker: ai, level: hit.level, damage: dmg })
}
