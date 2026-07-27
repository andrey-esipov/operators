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

interface Pending {
  ai: 0 | 1
  blocked: boolean
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

    // Juggle gating: an airborne defender out of allowance can't be hit.
    if (!D.grounded && D.juggleLeft <= 0) continue

    const inv = invulnOf(D, defD)
    if (inv === 'full' || inv === 'strike') continue // all our attacks are strikes

    const hitboxes = fr.hitboxes.map((b) => placeBox(b, A.pos, A.facing))
    const hurt = hurtboxesOf(D, defD)
    if (!anyOverlap(hitboxes, hurt)) continue

    const at = contactPoint(hitboxes, hurt) ?? { x: A.pos.x, y: A.pos.y + 90 }
    pending.push({ ai, blocked: isBlocking(D, move.hit.guard, relDirs[di]), hit: move.hit, at })
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
    if (p.blocked) applyBlock(A, D, p.hit, p.at, p.ai, events)
    else applyHit(A, D, p.hit, p.at, p.ai, events)
  }
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
