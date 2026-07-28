/**
 * Shared contract for the real-time fighter.
 *
 * The simulation, the renderer and the sprite pipeline are built in parallel
 * against this file. It is deliberately the only thing they share: the sim
 * never imports Three, the renderer never mutates sim state, and the asset
 * pipeline's only job is to emit something matching `FighterAssets`.
 *
 * Rule for anyone extending this: the sim owns truth, the renderer owns
 * appearance. If a field only affects how something looks (a flash colour, a
 * shake magnitude) it does not belong in `FightState` — derive it from events.
 */

/** Simulation runs at a fixed step. Everything in frame data counts in these. */
export const FPS = 60
export const DT = 1 / FPS

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * World units are centimetres, x rightward, y up from the floor. Cm rather
 * than pixels so frame data stays meaningful if art is ever re-rendered at a
 * different resolution.
 */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Vec2 {
  x: number
  y: number
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type Button = 'lp' | 'mp' | 'hp' | 'lk' | 'mk' | 'hk'

/**
 * Direction as a numpad notation digit (1-9, 5 = neutral), the standard in
 * fighting games and what motion inputs are expressed in. Stored relative to
 * the raw stick, not the facing — the sim mirrors it when a character turns
 * around, so a quarter-circle-forward is the same motion on both sides.
 */
export type Direction = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export interface InputFrame {
  dir: Direction
  /** Buttons held this frame. */
  held: ReadonlySet<Button>
  /** Buttons that went down on this frame specifically. */
  pressed: ReadonlySet<Button>
}

// ---------------------------------------------------------------------------
// Frame data
// ---------------------------------------------------------------------------

/**
 * How a move connects. This drives blocking rules: an overhead must be blocked
 * standing, a low must be blocked crouching, a throw ignores blocking entirely.
 */
export type Guard = 'high' | 'low' | 'overhead' | 'unblockable' | 'throw'

export type HitLevel = 'light' | 'medium' | 'heavy' | 'launcher' | 'sweep' | 'crumple'

export interface Hit {
  damage: number
  /** Frames the defender is stunned on hit. */
  hitstun: number
  /** Frames the defender is stunned when they block. */
  blockstun: number
  /** Chip damage dealt through a block. */
  chip: number
  guard: Guard
  level: HitLevel
  /** Impulse applied to the defender, in cm/frame. */
  knockback: Vec2
  /** Impulse applied to the attacker — what makes a heavy feel weighty. */
  pushback: number
  /** Frames both fighters freeze on contact. The single biggest feel lever. */
  hitstop: number
  /** Meter granted to attacker / defender. */
  meterGain: number
  meterGainOnBlock: number
  /** Multiplies into combo scaling. 1 = no extra decay. */
  scaling: number
  /** If set, the defender is launched into a juggle state. */
  juggle?: boolean
}

/**
 * One frame of a move. Hitboxes are what the attack strikes with, hurtboxes
 * are what can be struck — a move with a hitbox but no overlapping hurtbox on
 * the arm is a "disjointed" attack, which is a real balance lever.
 */
export interface MoveFrame {
  /** Index into the fighter's sprite atlas. */
  sprite: number
  hitboxes: Box[]
  hurtboxes: Box[]
  /** Collision box that stops fighters walking through each other. */
  pushbox: Box
  /** Root motion for this frame, cm. Lets a lunge carry the body forward. */
  motion?: Vec2
  /** Invulnerability window — how a dragon punch beats a jab. */
  invuln?: 'none' | 'full' | 'strike' | 'throw'
  /** Cancel window: what this frame may be cancelled into. */
  cancels?: MoveTag[]
}

export type MoveTag = 'normal' | 'command' | 'special' | 'super' | 'jump' | 'dash'

export interface Move {
  id: string
  name: string
  tag: MoveTag
  /** Motion input in numpad notation, e.g. '236' for a quarter-circle. */
  motion?: string
  button?: Button
  /** Meter cost in units of 1000 (one full bar). */
  cost?: number
  frames: MoveFrame[]
  /** Which frames deal damage. Outside this the hitboxes are inert. */
  active: [number, number]
  hit: Hit
  /** Whether the move may be performed in the air. */
  airOk?: boolean
}

// ---------------------------------------------------------------------------
// Fighter state
// ---------------------------------------------------------------------------

export type Stance =
  | 'idle'
  | 'walk-fwd'
  | 'walk-back'
  | 'crouch'
  | 'jump-rise'
  | 'jump-fall'
  | 'dash'
  | 'backdash'
  | 'attack'
  | 'blockstun'
  | 'hitstun'
  | 'juggle'
  | 'knockdown'
  | 'wakeup'
  | 'throw-tech'
  | 'ko'
  | 'victory'
  | 'defeat'

export interface FighterState {
  id: string
  pos: Vec2
  vel: Vec2
  facing: 1 | -1
  stance: Stance
  health: number
  maxHealth: number
  meter: number
  /** Counts down; while non-zero the fighter cannot act. */
  stunRemaining: number
  /** Active move, if any, and how far into it we are. */
  move?: { id: string; frame: number }
  /** Hits taken in the current combo — drives damage scaling. */
  comboCount: number
  /** Juggle allowance left, so infinite air loops are impossible. */
  juggleLeft: number
  grounded: boolean
  /** Set the frame a move connects, for the renderer to spawn effects from. */
  lastHitAt?: Vec2
  /**
   * Sim-owned bookkeeping (additive; the renderer/asset pipeline can ignore
   * it). True once the current active move has connected, so a move with a
   * multi-frame active window strikes at most once per use.
   */
  attackConnected?: boolean
}

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------

/**
 * A live projectile — a fireball and its kin. Additive to the contract: it
 * exists so a zoner archetype can control space at range. A renderer or asset
 * pipeline that predates projectiles can ignore `FightState.projectiles`
 * entirely; nothing else in the state references this type.
 *
 * The sim owns every projectile's motion and collision; the renderer only draws
 * one at `pos`, flipped by `facing`, choosing art from `kind`.
 */
export interface Projectile {
  /** Identity stable across frames, so the renderer can track one fireball from
   *  spawn to despawn rather than popping a new sprite each frame. */
  id: number
  /** Which fighter fired it (index into `fighters`). */
  owner: 0 | 1
  /** World position of the projectile origin, cm. */
  pos: Vec2
  /** Velocity, cm/frame. */
  vel: Vec2
  /** Travel facing: 1 = rightward, -1 = leftward. Renderer mirrors art by this. */
  facing: 1 | -1
  /** Hitbox authored facing-right; the sim mirrors and places it at `pos`. */
  hitbox: Box
  /** What it does on contact. Reuses the normal `Hit` shape, so a projectile
   *  blocks, chips and stuns exactly like a melee hit. */
  hit: Hit
  /** Frames left before it despawns on its own. */
  life: number
  /** Visual hint for the renderer to choose art, e.g. 'fireball', 'super-beam'. */
  kind: string
}

// ---------------------------------------------------------------------------
// Match state
// ---------------------------------------------------------------------------

export interface FightState {
  frame: number
  fighters: [FighterState, FighterState]
  /** Frames remaining in the round, at 60fps. */
  timer: number
  round: number
  wins: [number, number]
  phase: 'intro' | 'fight' | 'ko' | 'round-end' | 'match-end'
  /** Non-zero while the world is frozen for impact. */
  hitstop: number
  /**
   * Super-activation freeze: the world holds for a beat when a super comes out,
   * before its damage travels — the genre's "stop the world" moment (SF6
   * Critical Art, Tekken Rage Art, Strive Overdrive). Additive and optional, so
   * anything built before supers froze safely ignores it.
   *
   * `superFreeze` is frames remaining in the freeze. `superFreezeWho` is the
   * fighter whose animation keeps advancing THROUGH the freeze — the owner winds
   * up while everyone/everything else holds; that asymmetry is what reads as
   * power. Renderer binds a background dim + full-screen flash to
   * `superFreeze > 0` (and can key the flash colour off the owner).
   */
  superFreeze?: number
  superFreezeWho?: 0 | 1
  /**
   * Countdown for the current non-fight phase (intro / ko / round-end), in
   * frames. Additive, sim-owned; the renderer can also use it to time intro and
   * KO flourishes.
   */
  phaseTimer?: number
  /** Camera is derived, not authored — sim reports where the action is. */
  cameraFocus: Vec2
  cameraZoom: number
  /**
   * Sim-owned input history (additive; renderer/asset pipeline can ignore it).
   * One packed, facing-relative ring per fighter so motion-input recognition
   * stays inside the pure step() with nothing to thread in from outside.
   */
  inputLog?: [number[], number[]]
  /**
   * Live projectiles. Optional and additive: undefined or empty for characters
   * that never spawn one, and safely ignorable by anything built before
   * projectiles existed. The sim spawns, integrates and despawns these.
   */
  projectiles?: Projectile[]
}

/**
 * Things that happened this frame. The renderer reads these to fire sparks,
 * shake and audio; nothing in the sim depends on them, so dropping an event
 * can never desync the simulation.
 */
export type FightEvent =
  | { type: 'hit'; at: Vec2; attacker: 0 | 1; level: HitLevel; damage: number }
  | { type: 'block'; at: Vec2; attacker: 0 | 1 }
  | { type: 'parry'; at: Vec2; attacker: 0 | 1 }
  | { type: 'whiff'; at: Vec2; attacker: 0 | 1 }
  | { type: 'throw'; at: Vec2; attacker: 0 | 1 }
  | { type: 'launch'; at: Vec2; attacker: 0 | 1 }
  | { type: 'knockdown'; at: Vec2; who: 0 | 1 }
  | { type: 'wall-bounce'; at: Vec2; who: 0 | 1 }
  | { type: 'ko'; who: 0 | 1 }
  | { type: 'super-flash'; who: 0 | 1; moveId: string }
  | { type: 'round-start'; round: number }
  | { type: 'round-end'; winner: 0 | 1 | null }

export interface StepResult {
  state: FightState
  events: FightEvent[]
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/**
 * What the sprite pipeline emits per fighter. The renderer consumes only this,
 * so the pipeline can change how it generates art without touching rendering.
 */
export interface SpriteFrameMeta {
  /** Name of the pose, matching the generator's frame spec. */
  name: string
  /** Pixel rect within the packed atlas. */
  rect: Box
  /**
   * Where the character's feet sit within the rect, in pixels. Every frame is
   * drawn so this point lands on the fighter's world position — the reason a
   * punch doesn't drag the body sideways.
   */
  anchor: Vec2
}

export interface FighterAssets {
  id: string
  atlas: string
  frames: SpriteFrameMeta[]
  /** Named animations, each a list of indices into `frames` with durations. */
  clips: Record<string, { frames: number[]; durations: number[]; loop: boolean }>
  /** Height of the character in cm, to map pixels to world units. */
  heightCm: number
}
