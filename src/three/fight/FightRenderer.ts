import * as THREE from 'three'
import type {
  FightState,
  FighterState,
  FightEvent,
  FighterAssets,
  StepResult,
  Vec2,
  Stance,
} from '../../fight/types'
import { DT } from '../../fight/types'
import type { ScenarioId, Side } from '../../types'
import type { FightRenderState, FighterVisualState, EngineContext } from '../types'
import { Engine } from '../core/Engine'
import { LightRig } from '../lighting/LightRig'
import { StageSubsystem } from '../stage/StageSubsystem'
import { stageConfig } from '../stage/StageRegistry'
import { PostPipeline } from '../post/PostPipeline'
import { ParticlePool, createPools, budgetFor } from '../vfx/ParticlePool'
import { Shockwave } from '../vfx/Shockwave'
import { clamp } from '../camera/CameraMath'
import { Fighter, type FighterView } from './Fighter'
import { buildAtlasTextures, type AtlasSource } from './AtlasTextures'
import { FightCamera, type StageBounds } from './FightCamera'
import { FightVfx } from './FightVfx'
import { simToWorld, CM_TO_WORLD } from './worldScale'

/**
 * Top-level controller that turns a running simulation into a rendered fight.
 *
 * The core design decision here is the split between simulation rate and render
 * rate. The sim is authoritative and steps at a fixed 60Hz; the renderer runs
 * as fast as the display allows. So we accumulate real wall-clock time, advance
 * the sim in whole fixed steps, and interpolate fighter POSITIONS between the
 * two most recent snapshots by the leftover fraction. Positions interpolate;
 * animation frames never do — a sprite's pose is a discrete authored thing and
 * blending toward the next one just smears it. Events fire the instant the sim
 * step that produced them is consumed, so a spark lands on the exact frame the
 * hit resolved.
 */

export interface FightRendererOptions {
  seed?: number
  scenario?: ScenarioId
  bounds?: StageBounds
}

const DEFAULT_BOUNDS: StageBounds = { minX: -8.2, maxX: 8.2 }

export class FightRenderer {
  readonly engine: Engine
  private lightRig = new LightRig()
  private fighters: [Fighter, Fighter] = [new Fighter('a'), new Fighter('b')]
  private additive!: ParticlePool
  private alpha!: ParticlePool
  private shockwave!: Shockwave
  private vfx!: FightVfx
  private camera!: FightCamera
  private world!: FightWorld
  private post = new PostPipeline()
  private scenario: ScenarioId
  private bounds: StageBounds

  private step: (() => StepResult) | null = null
  private latest: FightState | null = null
  private prev: FightState | null = null

  constructor(canvas: HTMLCanvasElement, opts: FightRendererOptions = {}) {
    this.engine = new Engine({ canvas, seed: opts.seed ?? 0xf16117 })
    this.scenario = opts.scenario ?? 'ipo-prep'
    this.bounds = opts.bounds ?? DEFAULT_BOUNDS
  }

  async init() {
    const engine = this.engine
    await engine.add(this.lightRig)

    const budget = budgetFor(engine.quality)
    const pools = createPools(this.ctx(), budget)
    this.additive = pools.additive
    this.alpha = pools.alpha
    this.shockwave = new Shockwave(this.ctx())

    this.camera = new FightCamera(engine.camera, this.bounds)
    this.vfx = new FightVfx({
      additive: this.additive,
      alpha: this.alpha,
      shockwave: this.shockwave,
      fighters: this.fighters,
      camera: this.camera,
      requestHitstop: (ms, scale) => engine.requestHitstop(ms, scale),
    })

    this.world = new FightWorld(this)
    await engine.add(new StageSubsystem(() => this.lightRig), this.world, this.post)

    engine.setRenderDriver(this.post)
    engine.scene.add(this.fighters[0].group, this.fighters[1].group)
    this.lightRig.setPreset(stageConfig(this.scenario).lighting, true)
    engine.setState(this.renderState())
    engine.start()
  }

  /** The particle factory needs a context before any subsystem is added. */
  private ctx() {
    // Engine.context is private; reconstruct the minimal slice the pools need.
    return {
      scene: this.engine.scene,
      camera: this.engine.camera,
      renderer: this.engine.renderer,
      size: { width: 1, height: 1 },
      quality: this.engine.quality,
      rng: this.engine.rng,
    } as unknown as Parameters<typeof createPools>[0]
  }

  setStage(scenario: ScenarioId) {
    this.scenario = scenario
    this.lightRig.setPreset(stageConfig(this.scenario).lighting, false)
    this.engine.setState(this.renderState())
  }

  setStep(step: () => StepResult) {
    this.step = step
  }

  setInitialState(state: FightState) {
    this.latest = state
    this.prev = state
  }

  async setFighterAssets(side: 0 | 1, assets: FighterAssets, atlas: AtlasSource, accent: string) {
    const tex = buildAtlasTextures(atlas, 8)
    this.fighters[side].setAssets(assets, tex, accent)
  }

  reset() {
    this.fighters[0].setDissolve(0)
    this.fighters[1].setDissolve(0)
  }

  dispose() {
    this.fighters[0].dispose()
    this.fighters[1].dispose()
    this.engine.dispose()
  }

  // ---- Internals shared with FightWorld ----------------------------------

  _advance(realDt: number): { alpha: number; steps: number } {
    if (!this.step || !this.latest) return { alpha: 0, steps: 0 }
    this._acc += realDt
    let steps = 0
    while (this._acc >= DT && steps < 5) {
      this.prev = this.latest
      const res = this.step()
      this.latest = res.state
      for (const e of res.events) this.vfx.handle(e)
      this._derived(this.prev, this.latest)
      this._acc -= DT
      this._globalFrame++
      steps++
    }
    return { alpha: clamp(this._acc / DT, 0, 1), steps }
  }
  private _acc = 0
  private _globalFrame = 0

  get globalFrame() {
    return this._globalFrame
  }

  fighterViews(alpha: number): [FighterView, FighterView] | null {
    if (!this.latest || !this.prev) return null
    return [
      interpView(this.prev.fighters[0], this.latest.fighters[0], alpha, this._globalFrame),
      interpView(this.prev.fighters[1], this.latest.fighters[1], alpha, this._globalFrame),
    ]
  }

  /** Dash and landing dust are derived from state transitions, not events. */
  private _derived(prev: FightState, next: FightState) {
    for (let i = 0; i < 2; i++) {
      const p = prev.fighters[i]
      const n = next.fighters[i]
      // Dash kick-off.
      if ((n.stance === 'dash' || n.stance === 'backdash') && p.stance !== n.stance) {
        this.vfx.dashDust(n.pos, n.facing)
      }
      // Landing: was airborne, now grounded.
      if (n.grounded && !p.grounded) {
        const fall = Math.min(1.4, Math.abs(p.vel.y) * 0.06 + 0.4)
        this.vfx.dust(n.pos, fall)
      }
    }
  }

  fighter(side: 0 | 1) {
    return this.fighters[side]
  }
  get vfxRef() {
    return this.vfx
  }
  get cameraRef() {
    return this.camera
  }
  get lightRef() {
    return this.lightRig
  }
  get scenarioId() {
    return this.scenario
  }
  updateParticles(scaledDt: number) {
    this.additive.update(scaledDt)
    this.alpha.update(scaledDt)
    this.shockwave.update(scaledDt)
  }

  /** Minimal synthetic render-state so the reused StageSubsystem has a scenario. */
  private renderState(): FightRenderState {
    const vis = (side: Side): FighterVisualState => ({
      id: side === 'a' ? 'a' : 'b',
      side,
      accent: '#ffffff',
      pose: 'stance',
      hp01: 1,
      super01: 0,
      conviction01: 1,
      superReady: false,
      shattered: false,
      active: false,
      statuses: [],
    })
    return {
      scenario: this.scenario,
      a: vis('a'),
      b: vis('b'),
      timeLeft: 99,
      round: 1,
      cinematic: false,
    }
  }
}

// ---------------------------------------------------------------------------

function interpView(
  prev: FighterState,
  cur: FighterState,
  alpha: number,
  globalFrame: number,
): FighterView {
  // Positions interpolate for smoothness; everything discrete comes from `cur`.
  const pos: Vec2 = {
    x: prev.pos.x + (cur.pos.x - prev.pos.x) * alpha,
    y: prev.pos.y + (cur.pos.y - prev.pos.y) * alpha,
  }
  return {
    pos,
    vel: cur.vel,
    facing: cur.facing,
    stance: cur.stance as Stance,
    move: cur.move,
    health: cur.health,
    maxHealth: cur.maxHealth,
    grounded: cur.grounded,
    globalFrame,
  }
}

/**
 * The subsystem the engine actually ticks. It owns the per-frame order:
 * advance the sim on real time, place both fighters from the interpolated
 * snapshot, run the camera once they are placed, then integrate particles on
 * the scaled delta so they hang in the air during hitstop.
 */
class FightWorld {
  readonly name = 'fight-world'
  private r: FightRenderer
  private ctx!: EngineContext
  private fogColor = new THREE.Color()
  private bounceColor = new THREE.Color()

  constructor(r: FightRenderer) {
    this.r = r
  }

  init(ctx: EngineContext) {
    this.ctx = ctx
  }

  update(scaledDt: number) {
    const realDt = this.ctx.realDt()
    const { alpha } = this.r._advance(realDt)

    const cfg = stageConfig(this.r.scenarioId)
    this.fogColor.setHex(cfg.lighting.fog.color)
    this.bounceColor.setHex(cfg.floor.color).lerp(this.fogColor, 0.4)
    const light = this.r.lightRef.description

    const views = this.r.fighterViews(alpha)
    if (views) {
      for (let i = 0; i < 2; i++) {
        const f = this.r.fighter(i as 0 | 1)
        f.update(views[i], {
          light,
          fogColor: this.fogColor,
          fogDensity: cfg.lighting.fog.density,
          bounceColor: this.bounceColor,
          dt: scaledDt,
          realDt,
        })
        const side: Side = i === 0 ? 'a' : 'b'
        this.ctx.anchors.set(`fighter:${side}`, f.chestAnchor())
      }

      // Camera frames both fighters once they are in place.
      const a = this.r.fighter(0)
      const b = this.r.fighter(1)
      const ax = a.chestAnchor().x
      const bx = b.chestAnchor().x
      const topY = Math.max(
        simToWorld(views[0].pos).y + heightWorld(views[0]),
        simToWorld(views[1].pos).y + heightWorld(views[1]),
      )
      this.r.cameraRef.update(realDt, {
        ax,
        bx,
        topY,
        pushIn: this.ctx.hitstop() * 0.6,
      })
    }

    this.r.updateParticles(scaledDt)
  }

  dispose() {}
}

function heightWorld(v: FighterView): number {
  // Rough head height above feet for framing; airborne pos.y already in feet.
  return 1.9 + Math.max(0, v.pos.y) * CM_TO_WORLD
}
