/**
 * The simulation core: a pure, fixed-timestep `step` plus the setup and
 * match-flow helpers around it.
 *
 * `step(state, inputs)` is a pure function — given the same state and the same
 * two InputFrames it always returns byte-identical output. It never reads the
 * clock and never calls Math.random (the only randomness in the whole system,
 * the AI's jitter, lives outside the sim and is itself seeded). That property
 * is what makes replays, rollback and the determinism test possible.
 */

import type {
  Direction,
  FightEvent,
  FightState,
  FighterState,
  InputFrame,
  Move,
  StepResult,
} from './types'
import type { FighterDef, SelectContext } from './def'
import type { Button } from './types'
import { getFighterDef } from './fighters'
import {
  AIR_PUSH,
  CROUCH_PUSH,
  STAND_PUSH,
} from './fighters/build'
import { resolveCombat } from './combat'
import { clampToStage, separate } from './collision'
import {
  detectDoubleTap,
  dirOf,
  encode,
  hasButton,
  heldOf,
  maskOf,
  releasedEdge,
  toRelative,
} from './input/motion'
import {
  AIR_DRAG,
  BACKDASH_FRAMES,
  BACKDASH_SPEED,
  CAMERA_MAX_ZOOM,
  CAMERA_MIN_ZOOM,
  CAMERA_TIGHT_DIST,
  CAMERA_WIDE_DIST,
  DASH_FRAMES,
  DASH_SPEED,
  GRAVITY,
  GROUND_FRICTION,
  INPUT_LOG_LEN,
  INTRO_FRAMES,
  JUMP_H_SPEED,
  JUMP_VELOCITY,
  KNOCKDOWN_FRAMES,
  KO_FRAMES,
  LANDING_LAG,
  MAX_HEALTH,
  MAX_METER,
  ROUND_END_FRAMES,
  ROUND_TIME_FRAMES,
  ROUNDS_TO_WIN,
  STAGE_HALF_W,
  START_X,
  VEL_EPSILON,
  WAKEUP_FRAMES,
  WALK_BACK_SPEED,
  WALK_FWD_SPEED,
  WALL_BOUNCE_DAMP,
  WALL_BOUNCE_MIN_VEL,
} from './constants'

const ALL_BUTTONS: Button[] = ['lp', 'mp', 'hp', 'lk', 'mk', 'hk']

/** Stances from which a fighter may start an action. Recovery lives inside the
 *  'attack' stance, so it's deliberately excluded — you can't act during it. */
function canAct(f: FighterState, hitstop: number): boolean {
  if (hitstop > 0 || f.stunRemaining > 0) return false
  switch (f.stance) {
    case 'idle':
    case 'walk-fwd':
    case 'walk-back':
    case 'crouch':
    case 'jump-rise':
    case 'jump-fall':
      return true
    default:
      return false
  }
}

const isDown = (d: Direction): boolean => d === 1 || d === 2 || d === 3
const isUp = (d: Direction): boolean => d === 7 || d === 8 || d === 9

// ── Setup ────────────────────────────────────────────────────────────────────

export function makeFighter(id: string, x: number, facing: 1 | -1): FighterState {
  const def = getFighterDef(id)
  return {
    id,
    pos: { x, y: 0 },
    vel: { x: 0, y: 0 },
    facing,
    stance: 'idle',
    health: def.health,
    maxHealth: def.health,
    meter: 0,
    stunRemaining: 0,
    comboCount: 0,
    juggleLeft: 0,
    grounded: true,
    attackConnected: false,
  }
}

export function createFight(p1: string, p2: string): FightState {
  return {
    frame: 0,
    fighters: [makeFighter(p1, -START_X, 1), makeFighter(p2, START_X, -1)],
    timer: ROUND_TIME_FRAMES,
    round: 1,
    wins: [0, 0],
    phase: 'intro',
    hitstop: 0,
    phaseTimer: INTRO_FRAMES,
    cameraFocus: { x: 0, y: 90 },
    cameraZoom: CAMERA_MIN_ZOOM,
    inputLog: [[], []],
  }
}

// ── Per-fighter geometry ─────────────────────────────────────────────────────

function pushWidth(f: FighterState, def: FighterDef): number {
  const mf = f.move ? def.moves[f.move.id]?.frames[f.move.frame] : undefined
  if (mf) return mf.pushbox.w
  if (f.stance === 'crouch') return CROUCH_PUSH.w
  if (!f.grounded) return AIR_PUSH.w
  return STAND_PUSH.w
}

// ── Input logging ────────────────────────────────────────────────────────────

function logInputs(s: FightState, inputs: [InputFrame, InputFrame]): void {
  if (!s.inputLog) s.inputLog = [[], []]
  for (let i = 0; i < 2; i++) {
    const f = s.fighters[i]
    const rel = toRelative(inputs[i].dir, f.facing)
    const packed = encode(rel, maskOf(inputs[i].pressed), maskOf(inputs[i].held))
    const log = s.inputLog[i]
    log.push(packed)
    if (log.length > INPUT_LOG_LEN) log.shift()
  }
}

function relDirOf(s: FightState, i: number): Direction {
  const log = s.inputLog?.[i]
  if (!log || log.length === 0) return 5
  return dirOf(log[log.length - 1])
}
function prevRelDir(s: FightState, i: number): Direction {
  const log = s.inputLog?.[i]
  if (!log || log.length < 2) return 5
  return dirOf(log[log.length - 2])
}

// ── Timers and stance transitions ────────────────────────────────────────────

function endMove(f: FighterState): void {
  f.move = undefined
  f.attackConnected = false
  f.stance = f.grounded ? 'idle' : 'jump-fall'
}

function onStunEnd(f: FighterState): void {
  switch (f.stance) {
    case 'hitstun':
    case 'blockstun':
      f.comboCount = 0
      f.stance = f.grounded ? 'idle' : 'jump-fall'
      break
    case 'dash':
    case 'backdash':
      f.stance = 'idle'
      f.vel.x = 0
      break
    case 'knockdown':
      f.stance = 'wakeup'
      f.stunRemaining = WAKEUP_FRAMES
      break
    case 'wakeup':
      f.stance = 'idle'
      f.comboCount = 0
      break
    default:
      // Landing lag and anything else recovers to a neutral stance.
      f.stance = f.grounded ? 'idle' : 'jump-fall'
  }
}

function advanceTimers(f: FighterState, def: FighterDef): void {
  if (f.stunRemaining > 0) {
    f.stunRemaining--
    if (f.stunRemaining === 0) onStunEnd(f)
  }
  if (f.stance === 'attack' && f.move) {
    f.move.frame++
    const m = def.moves[f.move.id]
    if (!m || f.move.frame >= m.frames.length) endMove(f)
  }
}

// ── Actions (the state machine proper) ───────────────────────────────────────

function buildContext(
  s: FightState, i: number, f: FighterState, input: InputFrame, relDir: Direction,
): SelectContext {
  const log = s.inputLog?.[i] ?? []
  const relMask = releasedEdge(log)
  const released = new Set<Button>()
  for (const b of ALL_BUTTONS) if (hasButton(relMask, b)) released.add(b)
  return {
    relDir,
    pressed: input.pressed,
    released,
    grounded: f.grounded,
    crouching: isDown(relDir),
    facing: f.facing,
    meter: f.meter,
    log,
  }
}

function startMove(
  f: FighterState, i: number, move: Move, events: FightEvent[],
): void {
  f.move = { id: move.id, frame: 0 }
  f.stance = 'attack'
  f.attackConnected = false
  if (f.grounded) f.vel.x = 0 // committing to a grounded move kills walk momentum
  if (move.cost) f.meter -= move.cost
  if (move.tag === 'super') {
    events.push({ type: 'super-flash', who: i as 0 | 1, moveId: move.id })
  }
}

function tryCancel(
  s: FightState, i: number, f: FighterState, def: FighterDef,
  input: InputFrame, relDir: Direction, events: FightEvent[],
): void {
  if (!f.move) return
  // Cancels are confirmed on contact — you can't special-cancel a move that
  // hasn't connected yet, which is what stops a jab being cancelled before it
  // even hits and lets real hit-confirms work.
  if (!f.attackConnected) return
  const fr = def.moves[f.move.id]?.frames[f.move.frame]
  if (!fr?.cancels || fr.cancels.length === 0) return
  const ctx = buildContext(s, i, f, input, relDir)
  const move = def.select(ctx)
  if (!move || move.id === f.move.id) return
  if (!fr.cancels.includes(move.tag)) return
  if (move.cost && f.meter < move.cost) return
  startMove(f, i, move, events)
}

function processActions(
  s: FightState, i: number, def: FighterDef,
  input: InputFrame, relDir: Direction, prevRel: Direction, events: FightEvent[],
): void {
  const f = s.fighters[i]

  // Committed dashes hold their velocity and can't be interrupted.
  if (f.stance === 'dash') {
    f.vel.x = f.facing * DASH_SPEED
    return
  }
  if (f.stance === 'backdash') {
    f.vel.x = -f.facing * BACKDASH_SPEED
    return
  }

  if (!canAct(f, s.hitstop)) {
    if (f.stance === 'attack') tryCancel(s, i, f, def, input, relDir, events)
    return
  }

  const ctx = buildContext(s, i, f, input, relDir)

  // Airborne: jumps commit, so only air attacks are allowed — no steering.
  if (!f.grounded) {
    const move = def.select(ctx)
    if (move) startMove(f, i, move, events)
    return
  }

  // Jump on a fresh up-press.
  if (isUp(relDir) && !isUp(prevRel)) {
    f.grounded = false
    f.vel.y = JUMP_VELOCITY
    f.vel.x = relDir === 9 ? f.facing * JUMP_H_SPEED : relDir === 7 ? -f.facing * JUMP_H_SPEED : 0
    f.stance = 'jump-rise'
    return
  }

  // Attacks (normals/specials/supers) resolved by the character.
  const move = def.select(ctx)
  if (move) {
    startMove(f, i, move, events)
    return
  }

  const log = ctx.log
  if (detectDoubleTap(log, 6)) {
    f.stance = 'dash'
    f.stunRemaining = DASH_FRAMES
    f.vel.x = f.facing * DASH_SPEED
    return
  }
  if (detectDoubleTap(log, 4)) {
    f.stance = 'backdash'
    f.stunRemaining = BACKDASH_FRAMES
    f.vel.x = -f.facing * BACKDASH_SPEED
    return
  }

  // Plain movement.
  if (isDown(relDir)) {
    f.stance = 'crouch'
    f.vel.x = 0
  } else if (relDir === 6) {
    f.stance = 'walk-fwd'
    f.vel.x = f.facing * WALK_FWD_SPEED
  } else if (relDir === 4) {
    f.stance = 'walk-back'
    f.vel.x = -f.facing * WALK_BACK_SPEED
  } else {
    f.stance = 'idle'
    f.vel.x = 0
  }
}

// ── Physics ──────────────────────────────────────────────────────────────────

function land(f: FighterState, events: FightEvent[]): void {
  f.grounded = true
  f.pos.y = 0
  f.vel.y = 0
  if (f.stance === 'juggle') {
    f.stance = 'knockdown'
    f.stunRemaining = KNOCKDOWN_FRAMES
    f.vel.x = 0
    events.push({ type: 'knockdown', at: { x: f.pos.x, y: 0 }, who: 0 })
  } else if (f.stance === 'attack') {
    endMove(f)
    f.stance = 'idle'
    f.stunRemaining = LANDING_LAG
    f.vel.x = 0
  } else {
    f.stance = 'idle'
    f.stunRemaining = LANDING_LAG
    f.vel.x = 0
  }
}

function integrate(f: FighterState, def: FighterDef, events: FightEvent[]): void {
  // Root motion from the active move frame (a lunge carrying the body forward).
  if (f.move) {
    const fr = def.moves[f.move.id]?.frames[f.move.frame]
    if (fr?.motion) {
      f.pos.x += f.facing * fr.motion.x
      f.pos.y += fr.motion.y
    }
  }

  if (!f.grounded) {
    f.vel.y -= GRAVITY
    f.pos.y += f.vel.y
    f.pos.x += f.vel.x
    f.vel.x *= AIR_DRAG
    if (f.stance === 'jump-rise' && f.vel.y <= 0) f.stance = 'jump-fall'
    if (f.pos.y <= 0) land(f, events)
  } else {
    f.pos.x += f.vel.x
    f.vel.x *= GROUND_FRICTION
    if (Math.abs(f.vel.x) < VEL_EPSILON) f.vel.x = 0
  }
}

function resolveCollisions(s: FightState, defs: [FighterDef, FighterDef]): void {
  const [f0, f1] = s.fighters
  const h0 = pushWidth(f0, defs[0]) / 2
  const h1 = pushWidth(f1, defs[1]) / 2
  clampToStage(f0, h0)
  clampToStage(f1, h1)
  if (f0.grounded && f1.grounded) separate(f0, f1, h0, h1)
  clampToStage(f0, h0)
  clampToStage(f1, h1)
}

/**
 * Wall-bounce for airborne juggle victims. Runs after integration but before the
 * clamp: if a launched fighter has crossed the wall plane with real speed, it
 * rebounds and reports a wall-bounce for the renderer to shake on. Only juggled
 * fighters bounce — a grounded fighter just walks into the wall and stops.
 */
function resolveWallBounce(
  s: FightState, defs: [FighterDef, FighterDef], events: FightEvent[],
): void {
  for (let i = 0; i < 2; i++) {
    const f = s.fighters[i]
    if (f.grounded || f.stance !== 'juggle') continue
    const half = pushWidth(f, defs[i]) / 2
    const min = -STAGE_HALF_W + half
    const max = STAGE_HALF_W - half
    const intoLeft = f.pos.x <= min && f.vel.x < -WALL_BOUNCE_MIN_VEL
    const intoRight = f.pos.x >= max && f.vel.x > WALL_BOUNCE_MIN_VEL
    if (!intoLeft && !intoRight) continue
    f.vel.x = -f.vel.x * WALL_BOUNCE_DAMP
    events.push({ type: 'wall-bounce', at: { x: f.pos.x, y: f.pos.y + 60 }, who: i as 0 | 1 })
  }
}

function updateFacing(s: FightState): void {
  const [f0, f1] = s.fighters
  for (let i = 0; i < 2; i++) {
    const f = s.fighters[i]
    const o = s.fighters[1 - i]
    if (!f.grounded) continue
    if (f.stance === 'idle' || f.stance === 'walk-fwd' || f.stance === 'walk-back' || f.stance === 'crouch') {
      if (o.pos.x > f.pos.x) f.facing = 1
      else if (o.pos.x < f.pos.x) f.facing = -1
    }
  }
  void f0
  void f1
}

function updateCamera(s: FightState): void {
  const [f0, f1] = s.fighters
  const mid = (f0.pos.x + f1.pos.x) / 2
  const dist = Math.abs(f0.pos.x - f1.pos.x)
  const t = Math.max(0, Math.min(1, (dist - CAMERA_TIGHT_DIST) / (CAMERA_WIDE_DIST - CAMERA_TIGHT_DIST)))
  s.cameraFocus = { x: mid, y: 90 }
  s.cameraZoom = CAMERA_MAX_ZOOM + (CAMERA_MIN_ZOOM - CAMERA_MAX_ZOOM) * t
}

// ── Match flow ───────────────────────────────────────────────────────────────

function resetForRound(s: FightState): void {
  s.fighters[0] = resetFighter(s.fighters[0], -START_X, 1)
  s.fighters[1] = resetFighter(s.fighters[1], START_X, -1)
  s.timer = ROUND_TIME_FRAMES
  s.inputLog = [[], []]
}

function resetFighter(f: FighterState, x: number, facing: 1 | -1): FighterState {
  return {
    ...f,
    pos: { x, y: 0 },
    vel: { x: 0, y: 0 },
    facing,
    stance: 'idle',
    health: f.maxHealth,
    // Meter persists between rounds — you keep what you built.
    stunRemaining: 0,
    move: undefined,
    comboCount: 0,
    juggleLeft: 0,
    grounded: true,
    attackConnected: false,
    lastHitAt: undefined,
  }
}

function checkRoundEnd(s: FightState, events: FightEvent[]): void {
  const h0 = s.fighters[0].health
  const h1 = s.fighters[1].health
  const timeout = s.timer <= 0
  if (h0 > 0 && h1 > 0 && !timeout) return

  let winner: 0 | 1 | null
  if (h0 <= 0 && h1 <= 0) winner = null // double KO
  else if (h0 <= 0) winner = 1
  else if (h1 <= 0) winner = 0
  else winner = h0 > h1 ? 0 : h1 > h0 ? 1 : null // time over → most health

  if (winner === 0) s.wins[0]++
  else if (winner === 1) s.wins[1]++
  else {
    // Draw / double KO both score, matching arcade convention.
    s.wins[0]++
    s.wins[1]++
  }

  if (h0 <= 0) {
    s.fighters[0].stance = 'ko'
    events.push({ type: 'ko', who: 0 })
  }
  if (h1 <= 0) {
    s.fighters[1].stance = 'ko'
    events.push({ type: 'ko', who: 1 })
  }
  events.push({ type: 'round-end', winner })

  const koRound = h0 <= 0 || h1 <= 0
  s.phase = koRound ? 'ko' : 'round-end'
  s.phaseTimer = koRound ? KO_FRAMES : ROUND_END_FRAMES
}

// ── The step function ────────────────────────────────────────────────────────

export function step(state: FightState, inputs: [InputFrame, InputFrame]): StepResult {
  const s: FightState = structuredClone(state)
  const events: FightEvent[] = []

  logInputs(s, inputs)

  if (s.phase === 'intro') {
    if ((s.phaseTimer ?? 0) >= INTRO_FRAMES) events.push({ type: 'round-start', round: s.round })
    s.phaseTimer = (s.phaseTimer ?? 0) - 1
    updateCamera(s)
    if ((s.phaseTimer ?? 0) <= 0) s.phase = 'fight'
    s.frame++
    return { state: s, events }
  }

  if (s.phase === 'ko') {
    s.phaseTimer = (s.phaseTimer ?? 0) - 1
    updateCamera(s)
    if ((s.phaseTimer ?? 0) <= 0) {
      s.phase = 'round-end'
      s.phaseTimer = ROUND_END_FRAMES
    }
    s.frame++
    return { state: s, events }
  }

  if (s.phase === 'round-end') {
    s.phaseTimer = (s.phaseTimer ?? 0) - 1
    updateCamera(s)
    if ((s.phaseTimer ?? 0) <= 0) {
      if (s.wins[0] >= ROUNDS_TO_WIN || s.wins[1] >= ROUNDS_TO_WIN) {
        s.phase = 'match-end'
      } else {
        s.round++
        resetForRound(s)
        s.phase = 'intro'
        s.phaseTimer = INTRO_FRAMES
      }
    }
    s.frame++
    return { state: s, events }
  }

  if (s.phase === 'match-end') {
    updateCamera(s)
    s.frame++
    return { state: s, events }
  }

  // ── phase === 'fight' ──
  if (s.hitstop > 0) {
    s.hitstop--
    updateCamera(s)
    s.frame++
    return { state: s, events }
  }

  const defs: [FighterDef, FighterDef] = [
    getFighterDef(s.fighters[0].id),
    getFighterDef(s.fighters[1].id),
  ]
  const relDirs: [Direction, Direction] = [relDirOf(s, 0), relDirOf(s, 1)]
  const prevRels: [Direction, Direction] = [prevRelDir(s, 0), prevRelDir(s, 1)]

  updateFacing(s)
  for (let i = 0; i < 2; i++) advanceTimers(s.fighters[i], defs[i])
  for (let i = 0; i < 2; i++) {
    processActions(s, i, defs[i], inputs[i], relDirs[i], prevRels[i], events)
  }
  for (let i = 0; i < 2; i++) integrate(s.fighters[i], defs[i], events)
  resolveWallBounce(s, defs, events)
  resolveCollisions(s, defs)
  resolveCombat(s, defs, relDirs, events)

  s.timer = Math.max(0, s.timer - 1)
  checkRoundEnd(s, events)
  updateCamera(s)
  s.frame++
  return { state: s, events }
}

/** Public helper mirroring the sim's own actionability test — handy for the AI
 *  and for tests that need to know when a fighter regains control. */
export function fighterCanAct(s: FightState, i: 0 | 1): boolean {
  return canAct(s.fighters[i], s.hitstop)
}

/** Whether a button mask in the log indicates the button is held — exported for
 *  the AI's motion feeding. */
export function heldButtons(packed: number): number {
  return heldOf(packed)
}

export { MAX_HEALTH, MAX_METER }
