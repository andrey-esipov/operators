import * as THREE from 'three'
import type {
  FightState,
  FighterState,
  FighterAssets,
  StepResult,
  Vec2,
  Stance,
} from '../../fight/types'
import { DT } from '../../fight/types'
import type { ScenarioId, Side } from '../../types'
import type { FightRenderState, FighterVisualState, EngineContext } from '../types'
import { WORLD } from '../types'
import { Engine } from '../core/Engine'
import { LightRig } from '../lighting/LightRig'
import { StageSubsystem } from '../stage/StageSubsystem'
import { stageConfig } from '../stage/StageRegistry'
import { PostPipeline } from '../post/PostPipeline'
import { ParticlePool, createPools, budgetFor } from '../vfx/ParticlePool'
import { Shockwave } from '../vfx/Shockwave'
import { ImpactFlash } from '../vfx/ImpactFlash'
import { loadImpactSheet } from './loadImpactSheet'
import { clamp } from '../camera/CameraMath'
import { Fighter, type FighterView } from './Fighter'
import { buildAtlasTextures, type AtlasSource } from './AtlasTextures'
import { FightCamera, type StageBounds } from './FightCamera'
import { FightVfx } from './FightVfx'
import { ProjectileLayer, type SuperFreezeView } from './ProjectileLayer'
import { simToWorld } from './worldScale'
// Type-only: the reactor is a pure event→sink mapper with no Three or audio-
// backend dependency, so importing its *type* costs nothing at runtime and
// pulls no audio code into the capture/harness builds that never set one.
import type { FightAudioReactor } from '../../audio/reactor'

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
  private impact!: ImpactFlash
  private vfx!: FightVfx
  private camera!: FightCamera
  private world!: FightWorld
  private projectiles = new ProjectileLayer()
  private post = new PostPipeline()
  private scenario: ScenarioId
  private bounds: StageBounds
  /**
   * Optional audio reactor — the sound mirror of `vfx`. Left null on the dev
   * harness and every headless capture path (they never call `setAudio`), so
   * no `AudioContext` is ever built there; only the playable route sets one.
   */
  private audio: FightAudioReactor | null = null

  private step: (() => StepResult) | null = null
  private latest: FightState | null = null
  private prev: FightState | null = null
  /**
   * The render-state object handed to the engine. Held by reference so its
   * `celebrate` flag can be updated in place each sim advance — the stage reads
   * it to fire victory-only set-dressing without any per-frame allocation.
   */
  private renderStateObj: FightRenderState | null = null

  /**
   * Set by dispose(). `init()` is async and interleaves with it: React's
   * StrictMode mounts, unmounts and remounts, so a cleanup can land while the
   * first init is still awaiting. Without this flag that init would run to
   * completion and call engine.start(), resurrecting a renderer nobody holds a
   * reference to — an invisible second rAF loop drawing over the live one on
   * the same canvas. That is exactly the failure that made the fighters
   * disappear: the orphan owned the canvas and its fighters had no atlas.
   */
  private disposed = false

  constructor(canvas: HTMLCanvasElement, opts: FightRendererOptions = {}) {
    this.engine = new Engine({ canvas, seed: opts.seed ?? 0xf16117 })
    this.scenario = opts.scenario ?? 'ipo-prep'
    this.bounds = opts.bounds ?? DEFAULT_BOUNDS
  }

  async init() {
    const engine = this.engine
    await engine.add(this.lightRig)
    if (this.disposed) return

    const budget = budgetFor(engine.quality)
    const pools = createPools(this.ctx(), budget)
    this.additive = pools.additive
    this.alpha = pools.alpha
    this.shockwave = new Shockwave(this.ctx())
    this.impact = new ImpactFlash(this.ctx())

    this.camera = new FightCamera(engine.camera, this.bounds)
    this.vfx = new FightVfx({
      additive: this.additive,
      alpha: this.alpha,
      shockwave: this.shockwave,
      impact: this.impact,
      fighters: this.fighters,
      camera: this.camera,
      requestHitstop: (ms, scale) => engine.requestHitstop(ms, scale),
      // Cross-seam wire (FightRenderer is the shared construction point for the
      // impact-vfx-owned FightVfx + PostPipeline): route a hit's reactive punch to
      // the post grade. Without this the shipped route never charges impact — see
      // PostPipeline.impactPunch and FightVfx.hit().
      punchPost: (strength, warm, flash) => this.post.impactPunch(strength, warm, flash),
    })

    this.world = new FightWorld(this)
    await engine.add(new StageSubsystem(() => this.lightRig), this.world, this.post)
    if (this.disposed) return

    engine.setRenderDriver(this.post)
    engine.scene.add(this.fighters[0].group, this.fighters[1].group)
    engine.scene.add(this.projectiles.group)
    this.projectiles.setCamera(engine.camera)
    // Warm the two shipped projectile atlases so the first bolt draws on the
    // frame it spawns, not a few frames late. Unknown kinds still lazy-load.
    void this.projectiles.preload(['ion-bolt', 'super-beam'])
    // Warm the impact-frame spark sheet so the first hit stamps its bold mark on
    // contact, not a few frames late. One shared white sheet; the hue is applied
    // per-hit at runtime. Mirrors the projectile preload's dispose-race guard.
    void loadImpactSheet()
      .then((sheet) => {
        if (this.disposed) {
          sheet.texture.dispose()
          return
        }
        this.impact.setSheet(sheet)
      })
      .catch((err) => {
        console.warn(`[impact] no spark sheet: ${err instanceof Error ? err.message : err}`)
      })
    this.lightRig.setPreset(stageConfig(this.scenario).lighting, true)
    this.renderStateObj = this.renderState()
    engine.setState(this.renderStateObj)
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
    this.renderStateObj = this.renderState()
    this.engine.setState(this.renderStateObj)
    // Point per-arena reverb at the new stage. StageId and ScenarioId are the
    // same eight-arena string union, so this is a pure re-tag.
    this.audio?.setStage(scenario)
  }

  /**
   * Attach (or detach) the audio reactor — the sound mirror of `vfx`. Only the
   * playable route calls this; harness/capture builds leave it null and stay
   * silent. Passing null detaches without disposing the backend.
   */
  setAudio(reactor: FightAudioReactor | null) {
    this.audio = reactor
  }

  setStep(step: () => StepResult) {
    this.step = step
  }

  setInitialState(state: FightState) {
    this.latest = state
    this.prev = state
  }

  /** Latest super-activation freeze state, for measurement. `freeze` is frames
   *  remaining (0 when not frozen); `who` is the owner. Read straight off the
   *  authoritative snapshot so a capture can log the freeze envelope frame by
   *  frame rather than inferring it from a phase label. */
  get superFreezeState(): { freeze: number; who: 0 | 1 | null } {
    return {
      freeze: this.latest?.superFreeze ?? 0,
      who: this.latest?.superFreezeWho ?? null,
    }
  }

  /** The owner-anchored super-freeze view the projectile layer needs to drive
   *  its charge envelope: the freeze countdown plus the OWNER's chest anchor and
   *  facing in world space. Null unless the sim is actively holding the world for
   *  a super. Built here because `latest` (the authoritative FightState) is
   *  private to the renderer; the layer never reaches into sim state itself. */
  superFreezeView(): SuperFreezeView | null {
    if (import.meta.env.DEV && (globalThis as Record<string, unknown>).__MUT_NO_SUPER__) return null
    const who = this.latest?.superFreezeWho ?? null
    const freeze = this.latest?.superFreeze ?? 0
    if (who === null || freeze <= 0) return null
    const anchor = this.fighters[who].chestAnchor()
    const facing = this.latest?.fighters[who]?.facing ?? 1
    return { freeze, who, ownerPos: anchor, facing }
  }

  // `reval` is required-but-nullable (NOT optional) by design. Passing the body
  // re-value is what lifts dark-neutral fighters (chesky/madhavan) off warm
  // stages and un-collides their palette. It was silently dropped on the attract
  // route because an earlier `reval?:` let a call site omit it with no type error
  // (P0: ~30% of attract bouts rendered the unfixed failure). Forcing every caller
  // to pass something — even `undefined` — makes "forgot to thread reval" a compile
  // error instead of an invisible visual regression on the shop-window reel. Do not
  // reintroduce the `?`: keep the bad state unrepresentable.
  async setFighterAssets(side: 0 | 1, assets: FighterAssets, atlas: AtlasSource, accent: string, reval: readonly [number, number, number] | undefined) {
    const tex = buildAtlasTextures(atlas, 8)
    this.fighters[side].setAssets(assets, tex, accent, reval)
  }

  reset() {
    this.fighters[0].setDissolve(0)
    this.fighters[1].setDissolve(0)
    this.audio?.reset()
  }

  dispose() {
    this.disposed = true
    this.engine.stop()
    this.audio?.dispose()
    this.fighters[0].dispose()
    this.fighters[1].dispose()
    this.projectiles.dispose()
    // ImpactFlash owns a loaded atlas texture + placeholder that live only in
    // shader uniforms (not the scene graph), so engine.dispose()'s scene walk
    // won't reclaim them — free them explicitly. Optional-chained because init()
    // is async and dispose() can race ahead of construction.
    this.impact?.dispose()
    this.engine.dispose()
  }

  // ---- Internals shared with FightWorld ----------------------------------

  _advance(realDt: number): { alpha: number; steps: number; simSteps: number } {
    if (!this.step || !this.latest) return { alpha: 0, steps: 0, simSteps: 0 }
    this._acc += realDt
    let steps = 0
    // `steps` counts render-loop iterations (wall-clock driven, so it keeps
    // ticking even on a frozen capture where the step callback returns the same
    // state). `simSteps` counts GENUINE sim-frame advances -- the same signal
    // that gates the animation clock below -- so it holds at 0 in a frozen gap
    // and rises by exactly 1 per `__PLAY__.step(1)`. The camera kick rides this,
    // not wall time, so the shove is frame-steppable and cannot decay away in
    // the wall-clock gaps between a capture tool's frames.
    let simSteps = 0
    while (this._acc >= DT && steps < 5) {
      this.prev = this.latest
      const res = this.step()
      this.latest = res.state
      for (const e of res.events) { this.vfx.handle(e); this.audio?.handle(e) }
      this._derived(this.prev, this.latest)
      this._acc -= DT
      // Only advance the animation clock when the sim actually advanced. A
      // frozen capture returns the *same* state without stepping (see
      // PlayableMatch's stepBudget), but this loop still runs on render ticks --
      // so an unconditional increment kept every looping clip (idle, walks,
      // block) playing during a "frozen" frame. That made looping animation
      // unmeasurable by construction: it advanced identically in the measured
      // pair and the zero-step control, cancelling out to exactly 1.00x. Tying
      // the clock to real sim advancement makes `step(n)` move the animation by
      // exactly n frames, and makes a frozen frame genuinely frozen.
      if (this.latest.frame !== this.prev.frame) {
        this._globalFrame++
        simSteps++
        this._tickReactions(this.prev, this.latest)
        // Derived audio (footsteps, meter charge, HP tension, phase/music) runs
        // only on genuine sim advancement — never on a frozen capture frame, so
        // a `step(0)` control produces zero derived sound.
        this.audio?.step(this.prev, this.latest)
      }
      steps++
    }
    // Level-triggered celebration signal for the stage. True only while the
    // match sits in a victory / round-over beat, so the IPO ticker-tape falls
    // at the payoff and never during neutral. Read from the authoritative sim
    // snapshot every advance (including while paused/frozen for capture), so it
    // tracks the real phase rather than a one-shot event that a freeze misses.
    if (this.renderStateObj) {
      const ph = this.latest.phase
      this.renderStateObj.celebrate = ph === 'ko' || ph === 'round-end' || ph === 'match-end'
    }
    return { alpha: clamp(this._acc / DT, 0, 1), steps, simSteps }
  }
  private _acc = 0
  private _globalFrame = 0
  /** Frames elapsed inside each fighter's current reaction. See `FighterView`. */
  private _reaction: [number, number] = [0, 0]

  /**
   * Advances each fighter's reaction clock, restarting it whenever a new
   * reaction begins. Two triggers, because one is not enough: entering a
   * reaction stance covers the first hit, and `stunRemaining` going *up*
   * covers the rest of a combo -- a second hit landing during hitstun keeps the
   * stance identical while re-arming the stun, and without that test the victim
   * would keep playing the tail of the first reaction through every follow-up.
   */
  private _tickReactions(prev: FightState, cur: FightState): void {
    for (let i = 0; i < 2; i++) {
      const p = prev.fighters[i]
      const c = cur.fighters[i]
      const restarted = c.stance !== p.stance || c.stunRemaining > p.stunRemaining
      if (restarted) {
        this._reaction[i] = 0
        continue
      }
      // Hitstop is the impact emphasis: the sim frame counter keeps moving but
      // the fight is deliberately frozen. The reaction must freeze with it, or
      // the victim animates straight through the one moment the freeze exists
      // to sell. Our design call (our own, not a cited genre spec) is snap to the impact pose, hold it for the
      // duration of the stop, then play the recovery out.
      if (cur.hitstop > 0) continue
      this._reaction[i] += 1
    }
  }

  get globalFrame() {
    return this._globalFrame
  }

  fighterViews(alpha: number): [FighterView, FighterView] | null {
    if (!this.latest || !this.prev) return null
    return [
      interpView(this.prev.fighters[0], this.latest.fighters[0], alpha, this._globalFrame, this._reaction[0]),
      interpView(this.prev.fighters[1], this.latest.fighters[1], alpha, this._globalFrame, this._reaction[1]),
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

  /**
   * Count the pixels the fighters actually paint, by rendering their groups
   * alone into an offscreen target and reading them back.
   *
   * Screenshot-based checks cannot distinguish "fighter drew nothing" from
   * "fighter drew and something painted over it" — a bug that cost this repo a
   * long debugging session, during which 11 screenshots of a completely
   * empty stage were reported as passing. Projecting world positions to screen
   * space does not help either: the maths is happy whether or not a single
   * texel is ever shaded. Reading back an isolated render of just these two
   * groups is the one signal that cannot be satisfied by an invisible fighter.
   */
  fighterCoverage(width = 320, height = 180) {
    const renderer = this.engine.renderer
    const scene = this.engine.scene
    const target = new THREE.WebGLRenderTarget(width, height)
    const parents = this.fighters.map((f) => f.group.parent)
    const probeScene = new THREE.Scene()
    // Lights live in the main scene; the sprite material needs them to shade.
    scene.traverse((o) => {
      if ((o as THREE.Light).isLight) probeScene.add((o as THREE.Light).clone())
    })
    probeScene.add(this.fighters[0].group, this.fighters[1].group)

    const prevTarget = renderer.getRenderTarget()
    renderer.setRenderTarget(target)
    renderer.setClearColor(0x000000, 0)
    renderer.clear(true, true, true)
    renderer.render(probeScene, this.engine.camera)

    const buf = new Uint8Array(width * height * 4)
    renderer.readRenderTargetPixels(target, 0, 0, width, height, buf)
    renderer.setRenderTarget(prevTarget)

    // Put the groups back exactly where they were before the probe.
    this.fighters.forEach((f, i) => parents[i]?.add(f.group))
    target.dispose()

    let lit = 0
    let minX = width, maxX = -1, minY = height, maxY = -1
    for (let i = 0; i < width * height; i++) {
      if (buf[i * 4 + 3] < 24) continue
      lit++
      const x = i % width
      const y = Math.floor(i / width)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    return {
      lit,
      total: width * height,
      fraction: lit / (width * height),
      // Normalised 0..1, origin bottom-left (WebGL readback order).
      bbox: lit ? { minX: minX / width, maxX: maxX / width, minY: minY / height, maxY: maxY / height } : null,
    }
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
    this.impact.update(scaledDt)
  }

  /** Reconcile the projectile sprites against the two most recent sim snapshots.
   *  Bolts run on the scaled delta so they freeze in place during hitstop like
   *  the rest of the world; the super atmosphere + charge run on the UNSCALED
   *  `renderDt` and the freeze view, so the "stop the world" beat stays alive and
   *  builds while sim time is held at zero. */
  updateProjectiles(alpha: number, scaledDt: number, renderDt: number) {
    this.projectiles.update(
      this.prev?.projectiles,
      this.latest?.projectiles,
      alpha,
      scaledDt,
      this.superFreezeView(),
      renderDt,
    )
  }

  /** Number of projectile sprites currently mounted. A liveness signal only —
   *  NOT proof anything painted (see projectileCoverage). */
  get projectileCount(): number {
    return this.projectiles.liveCount
  }

  /**
   * The projectile analogue of fighterCoverage: render just the projectile
   * group into an offscreen target and read back how many pixels it actually
   * lit. Projectiles are additive MeshBasic sprites, so a bright core writes
   * high RGB even where its alpha is partial — count on luminance, not alpha.
   *
   * This exists for the same reason fighterCoverage does: a screenshot cannot
   * tell "the bolt never drew" from "the bolt drew and something covered it",
   * and projecting the sim position to screen is happy whether or not a texel is
   * ever shaded. An isolated readback is the one check an invisible projectile
   * cannot satisfy — and, sampled across a span of frames, one that a bolt which
   * flashes for a single spawn frame and then vanishes cannot satisfy either.
   */
  projectileCoverage(width = 320, height = 180) {
    const renderer = this.engine.renderer
    const parent = this.projectiles.group.parent
    const target = new THREE.WebGLRenderTarget(width, height)
    const probeScene = new THREE.Scene()
    probeScene.add(this.projectiles.group)

    const prevTarget = renderer.getRenderTarget()
    renderer.setRenderTarget(target)
    renderer.setClearColor(0x000000, 0)
    renderer.clear(true, true, true)
    renderer.render(probeScene, this.engine.camera)

    const buf = new Uint8Array(width * height * 4)
    renderer.readRenderTargetPixels(target, 0, 0, width, height, buf)
    renderer.setRenderTarget(prevTarget)

    parent?.add(this.projectiles.group)
    target.dispose()

    let lit = 0
    let minX = width, maxX = -1, minY = height, maxY = -1
    for (let i = 0; i < width * height; i++) {
      const r = buf[i * 4], g = buf[i * 4 + 1], b = buf[i * 4 + 2]
      // Additive core writes bright RGB; a faint transparent halo does not.
      if (Math.max(r, g, b) < 40) continue
      lit++
      const x = i % width
      const y = Math.floor(i / width)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    return {
      lit,
      total: width * height,
      fraction: lit / (width * height),
      bbox: lit ? { minX: minX / width, maxX: maxX / width, minY: minY / height, maxY: maxY / height } : null,
    }
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
      celebrate: false,
    }
  }
}

// ---------------------------------------------------------------------------

function interpView(
  prev: FighterState,
  cur: FighterState,
  alpha: number,
  globalFrame: number,
  reactionFrame: number,
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
    reactionFrame,
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
    const { alpha, simSteps } = this.r._advance(realDt)
    // Sim-frame delta for the impact kick: DT per GENUINE sim advance, 0 in a
    // frozen gap. This is what makes the kick survive a frame-stepped capture
    // and hold through the hitstop freeze, instead of decaying on the wall clock.
    const kickDt = simSteps * DT

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
          viewportH: this.ctx.renderer.domElement.height,
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
        simToWorld(views[0].pos).y + heightWorld(),
        simToWorld(views[1].pos).y + heightWorld(),
      )
      this.r.cameraRef.update(realDt, kickDt, {
        ax,
        bx,
        topY,
        pushIn: this.ctx.hitstop() * 0.6,
      })
    }

    this.r.updateProjectiles(alpha, scaledDt, realDt)
    this.r.updateParticles(scaledDt)
  }

  dispose() {}
}

function heightWorld(): number {
  // Head height above the feet, in world units, for vertical framing. The
  // airborne offset is deliberately NOT added here: simToWorld already places
  // the feet at their airborne height (GROUND_Y + pos.y * CM_TO_WORLD), so a
  // jumping fighter's head is feetWorldY + this constant. Adding pos.y a second
  // time double-counts the entire jump/juggle height, which doubled topY, blew
  // zForY past the dolly clamp and shrank both fighters to a ~5% smear on every
  // launch — then lurched back in on landing.
  //
  // This is the fighter's FULL height (≈ WORLD.FIGHTER_HEIGHT), not the chest.
  // It was 1.9 (roughly chest height), which under-reported the head by ~1.5
  // world units: the camera framed to the chest and let the actual head ride
  // out of the top edge on any launch (measured: a modest juggle pinned the
  // launched head at the very top row, maxY 0.994 = cropped). Reporting the true
  // head lets FightCamera's containment solve for a dolly distance that actually
  // keeps the launched fighter in frame.
  return WORLD.FIGHTER_HEIGHT
}
