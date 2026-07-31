// OPERATORS — Three.js render layer: shared contracts.
//
// Every subsystem (stage, fighters, VFX, post, camera, lighting) talks to the
// engine through the interfaces in this file and NOTHING else. That keeps the
// subsystems independently ownable and swappable.

import type * as THREE from 'three'
import type { ScenarioId, Side } from '../types'

/** Render quality tier. Chosen automatically at boot, adapts at runtime. */
export type QualityTier = 'low' | 'medium' | 'high' | 'ultra'

export const QUALITY_ORDER: QualityTier[] = ['low', 'medium', 'high', 'ultra']

/** Numeric rank so subsystems can gate features with `>=`. */
export function qualityRank(q: QualityTier): number {
  return QUALITY_ORDER.indexOf(q)
}

/** Visual pose of a fighter. Mapped from the game's turn state. */
export type FighterPose =
  | 'stance'
  | 'attack'
  | 'win'
  | 'lose'
  | 'ult'
  | 'hurt'
  | 'guard'

/** Per-fighter snapshot the renderer reads every frame. Pure data — no refs. */
export interface FighterVisualState {
  /** Fighter def id (e.g. 'chesky'). Drives sprite/asset resolution. */
  id: string
  side: Side
  /** Hex accent colour, e.g. '#F77F00'. */
  accent: string
  pose: FighterPose
  /** Normalised health, 0..1. */
  hp01: number
  /** Normalised super meter, 0..1. */
  super01: number
  /** Normalised conviction, 0..1. */
  conviction01: number
  superReady: boolean
  shattered: boolean
  /** True when it is this fighter's turn. */
  active: boolean
  /** Status effect keys currently applied. */
  statuses: string[]
}

/** Whole-scene snapshot. Rebuilt (cheaply) whenever the game state changes. */
export interface FightRenderState {
  scenario: ScenarioId
  a: FighterVisualState
  b: FighterVisualState
  /** Seconds remaining on the round clock. */
  timeLeft: number
  round: number
  /** True while any cinematic owns the camera. */
  cinematic: boolean
  /**
   * True only during a victory / round-over celebration beat (sim phase
   * `ko` | `round-end` | `match-end`). Stage-owned festive effects (the IPO
   * ticker-tape, etc.) gate on this so they never fire during neutral play.
   * Optional so preview/lab render states can omit it (treated as `false`).
   */
  celebrate?: boolean
  /**
   * True while a bounded, scripted event is on screen — a super freeze OR a
   * `ko` | `round-end` | `match-end` celebration beat. The quality adaptor reads
   * this to EXCLUDE such frames from its demote decision: their cost is not
   * evidence of sustained fill load, and (source-proven) the super/cinematic VFX
   * has no quality hook to reduce it, so demoting on it is pure loss. Distinct
   * from `celebrate` (super freezes are transient but not a celebration) and from
   * `cinematic` (a camera-ownership flag). Optional so preview/lab render states
   * omit it (treated as `false` — adaptation behaves exactly as before).
   */
  scriptedTransient?: boolean
}

/** Impact strength buckets. Drives camera shake, particle counts, light pops. */
export type HitFlavor =
  | 'light'
  | 'heavy'
  | 'crit'
  | 'combo'
  | 'ult'
  | 'ex'
  | 'signature'

/**
 * Discrete, one-shot events. The engine fans these out to every subsystem's
 * `onEvent`. Events are fire-and-forget: subsystems must not assume ordering
 * relative to `update`.
 */
export type FightEvent =
  | {
      kind: 'hit'
      attacker: Side
      target: Side
      flavor: HitFlavor
      /** Raw damage number. */
      damage: number
      /** 0..1 normalised impact strength (damage relative to max HP). */
      power: number
      /** True if this hit broke conviction. */
      shattered?: boolean
    }
  | { kind: 'whiff'; attacker: Side }
  | { kind: 'cast'; attacker: Side; flavor: HitFlavor }
  | { kind: 'ko'; winner: Side; loser: Side }
  | { kind: 'shatter'; side: Side }
  | { kind: 'signature'; attacker: Side; target: Side }
  | { kind: 'round-start'; round: number }
  | { kind: 'round-end'; winner: Side | 'time' }
  | { kind: 'intro' }
  | { kind: 'read'; side: Side }
  | { kind: 'heal'; side: Side; amount: number }
  | { kind: 'status'; side: Side; status: string }

/** Named render layers so subsystems can selectively include/exclude. */
export const LAYER = {
  DEFAULT: 0,
  /** Objects that should bloom hard regardless of luminance. */
  BLOOM: 1,
  /** Backdrop-only; excluded from DOF near-field. */
  BACKDROP: 2,
  /** Fighters. */
  FIGHTER: 3,
  /** Foreground occluders (rendered in front, blurred by DOF). */
  FOREGROUND: 4,
} as const

/** Everything a subsystem needs from the engine. Handed to `init`. */
export interface EngineContext {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  /** Canvas backing store size in CSS pixels. */
  size: { width: number; height: number }
  quality: QualityTier
  /** Seeded RNG — deterministic across reloads for screenshot diffing. */
  rng: () => number
  /** Shared texture/asset cache. */
  assets: AssetCacheLike
  /** Emit an event into the engine bus (subsystems can trigger each other). */
  emit: (e: FightEvent) => void
  /** Register a per-frame callback ordered after all subsystem updates. */
  onLateUpdate: (fn: (dt: number) => void) => () => void
  /**
   * World-space anchor lookup so VFX/camera can find where a fighter is
   * without depending on the fighter subsystem's internals.
   */
  anchors: AnchorRegistry
  /**
   * Freeze-frame on impact. Snaps the engine time scale to `scale` for
   * `durationMs` (unscaled wall time), then eases back to 1. Overlapping
   * requests take the harder freeze and the later end time, so a crit landing
   * during a combo hitstop extends rather than truncates it.
   */
  requestHitstop: (durationMs: number, scale?: number) => void
  /** Live engine time scale (1 = realtime, <1 = hitstop/slow-mo). */
  timeScale: () => number
  /**
   * 0..1 hitstop envelope: 1 the instant a freeze starts, decaying to 0 as it
   * releases. Lets shake and beat pacing lock to the actual freeze curve
   * instead of re-deriving it from event timing.
   */
  hitstop: () => number
  /**
   * Unscaled wall-clock delta for the frame currently being updated, in
   * seconds. `Subsystem.update` receives `rawDt * timeScale`, which is correct
   * for anything that should freeze with the world -- poses, physics, particle
   * motion. It is wrong for short-lived *presentation* accents.
   *
   * A hit sets timeScale to ~0.02 for 100-320ms. Anything decaying on the
   * scaled dt therefore does not decay at all for the duration of the freeze.
   * A contact white-out authored as "a brief 2-3 frame spike" becomes a solid
   * blob held for a third of a second -- and that held frame is exactly the one
   * the player is staring at. This was measured as the largest single cause of
   * the defending fighter being erased on impact.
   *
   * Rule of thumb: if it represents something IN the world, use `dt`. If it is
   * a flash, a bloom kick or any accent whose whole design is "brief", use
   * `realDt()`.
   */
  realDt: () => number
}

/** Named world-space points other subsystems can query. */
export interface AnchorRegistry {
  set(name: string, v: THREE.Vector3): void
  get(name: string): THREE.Vector3 | undefined
  /** Convenience: `fighter:a` / `fighter:b` chest-height anchor. */
  fighter(side: Side): THREE.Vector3
}

export interface AssetCacheLike {
  texture(url: string): Promise<THREE.Texture>
  /** Chroma-keyed fighter sprite → {albedo, normal, height} texture set. */
  spriteSet(url: string): Promise<SpriteTextureSet>
  /** Loads still in flight. Screenshot harnesses gate on this reaching 0. */
  pending(): number
  dispose(): void
}

export interface SpriteTextureSet {
  albedo: THREE.Texture
  normal: THREE.Texture
  height: THREE.Texture
  width: number
  height_px: number
  /** Tight alpha bounding box in UV space (x0,y0,x1,y1) for auto-framing. */
  bounds: [number, number, number, number]
}

/**
 * A render subsystem. Implementations live in their own folder and are the
 * unit of parallel ownership.
 */
export interface Subsystem {
  /** Stable name, used for logging + the debug overlay. */
  readonly name: string
  init(ctx: EngineContext): void | Promise<void>
  /** Called once per frame with the interpolated delta in seconds. */
  update(dt: number, state: FightRenderState): void
  onEvent?(e: FightEvent): void
  setQuality?(q: QualityTier): void
  /** Called when the drawing surface changes size. */
  resize?(width: number, height: number): void
  dispose(): void
}

/** World-space layout constants shared by every subsystem. */
export const WORLD = {
  /** Fighters stand on y = 0. */
  GROUND_Y: 0,
  /** Half-distance between the two fighters at neutral spacing. */
  FIGHTER_SEPARATION: 2.55,
  /** Fighter quad height in world units (≈ a 1.8m human). */
  FIGHTER_HEIGHT: 3.4,
  /** Camera default framing. */
  CAMERA: {
    position: [0, 2.55, 11.4] as [number, number, number],
    target: [0, 1.78, 0] as [number, number, number],
    fov: 32,
    near: 0.1,
    far: 320,
  },
} as const
