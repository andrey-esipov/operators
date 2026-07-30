import * as THREE from 'three'
import {
  LAYER,
  WORLD,
  qualityRank,
  type AnchorRegistry,
  type EngineContext,
  type FightEvent,
  type FightRenderState,
  type QualityTier,
  type Subsystem,
} from '../types'
import { AssetCache } from './AssetCache'
import { detectQuality } from './QualityManager'
import { QualityAdaptor, affordablePixelRatio } from './QualityAdaptor'
import type { Side } from '../../types'

/**
 * Something that owns the final draw call — i.e. the post-processing pipeline.
 * If no driver is registered the engine falls back to a plain forward render.
 */
export interface RenderDriver {
  render(dt: number): void
  resize(width: number, height: number): void
}

export interface EngineOptions {
  canvas: HTMLCanvasElement
  /** Fixed seed so screenshots are byte-comparable between runs. */
  seed?: number
  quality?: QualityTier
  /** Cap for devicePixelRatio. Higher = sharper but heavier. */
  maxPixelRatio?: number
}

/**
 * The render engine.
 *
 * Owns the WebGL context, the scene graph root, the frame loop, quality
 * adaptation and the event bus. Everything visual is implemented as a
 * `Subsystem` registered here — the engine itself has no opinion about how
 * the fight looks.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly assets: AssetCache

  /**
   * The element this Engine's context lives on. Held so `dispose()` can detach
   * the context-loss listener it installed — a listener that outlived its
   * Engine would fire for the *next* Engine mounted on a reused element.
   */
  readonly canvas: HTMLCanvasElement

  /**
   * Called when the GPU takes the context away from us — driver reset, GPU
   * hang, or (the common one here) Chrome silently evicting the oldest context
   * once a document exceeds ~16 live ones. Without a listener the canvas simply
   * stops updating and the player sees a permanently black screen with no error
   * anywhere, which is indistinguishable from a renderer catastrophe. Routes
   * set this to surface an honest, actionable state instead.
   *
   * NOT called for our own `dispose()`, which loses the context deliberately.
   */
  onContextLost: (() => void) | null = null

  /** True from the top of `dispose()`, so our own context loss is not reported. */
  private _disposing = false

  /**
   * Bound once as a field so `removeEventListener` in `dispose()` can pass the
   * identical reference — a fresh arrow per call would silently fail to detach.
   */
  private onCanvasContextLost = (e: Event) => {
    if (this._disposing) return
    e.preventDefault()
    this.stop()
    this.onContextLost?.()
  }

  private subsystems: Subsystem[] = []
  private driver: RenderDriver | null = null
  private lateUpdates = new Set<(dt: number) => void>()
  private rafId = 0
  private running = false
  private lastTime = 0
  private accumulatedDt = 0
  /** Non-null only while stepFixed is driving the engine. See stepFixed. */
  private virtualNow: number | null = null

  private _quality: QualityTier
  private maxPixelRatio: number
  private width = 1
  private height = 1

  /** Global time scale — cinematics slow the world down. */
  timeScale = 1
  /** Target time scale; `timeScale` eases toward it. */
  private targetTimeScale = 1
  private timeScaleSnap = false

  // Hitstop. Tracked in unscaled wall time so a freeze can't extend itself.
  private hitstopUntil = 0
  private hitstopScale = 1
  private hitstopTotal = 0
  private hitstopEnv = 0
  /** Unscaled dt of the frame being updated; surfaced as ctx.realDt(). */
  private lastRawDt = 0

  private state: FightRenderState | null = null
  private pendingEvents: FightEvent[] = []
  private eventListeners = new Set<(e: FightEvent) => void>()

  // Adaptive-quality controller — pure policy, unit-tested without a GPU.
  private adaptor = new QualityAdaptor()
  private adaptEnabled = true

  readonly anchors: AnchorRegistry
  private anchorMap = new Map<string, THREE.Vector3>()

  private rngState: number

  /** Frames rendered since start — useful for deterministic screenshot gates. */
  frameCount = 0
  /** Rolling average frame time in ms. */
  avgFrameMs = 16.7

  constructor(opts: EngineOptions) {
    this.rngState = (opts.seed ?? 0x9e3779b9) >>> 0
    this._quality = opts.quality ?? detectQuality()
    this.maxPixelRatio = opts.maxPixelRatio ?? pixelRatioFor(this._quality)

    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      antialias: false, // post pipeline owns AA (SMAA/TAA)
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      preserveDrawingBuffer: true, // screenshot capture for the critic loop
    })
    this.canvas = opts.canvas
    // `preventDefault()` is what makes a later `webglcontextrestored` possible
    // at all — without it the browser never offers to give the context back.
    // We do not yet rebuild on restore, so the honest contract is: report the
    // loss to whoever owns this Engine and let them show a real state. Silence
    // was the old behaviour and it looked exactly like a crash.
    this.canvas.addEventListener('webglcontextlost', this.onCanvasContextLost)
    this.renderer.setPixelRatio(this.effectivePixelRatio())
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    // ACES gives the filmic highlight rolloff modern fighters use. The post
    // pipeline may override this with its own tonemap pass.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.shadowMap.enabled = qualityRank(this._quality) >= 1
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.info.autoReset = false

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x05030b)

    const cam = WORLD.CAMERA
    this.camera = new THREE.PerspectiveCamera(cam.fov, 16 / 9, cam.near, cam.far)
    this.camera.position.set(...cam.position)
    this.camera.lookAt(new THREE.Vector3(...cam.target))
    this.camera.layers.enableAll()

    this.assets = new AssetCache(this.renderer)

    const self = this
    this.anchors = {
      set(name, v) {
        const existing = self.anchorMap.get(name)
        if (existing) existing.copy(v)
        else self.anchorMap.set(name, v.clone())
      },
      get(name) {
        return self.anchorMap.get(name)
      },
      fighter(side: Side) {
        return (
          self.anchorMap.get(`fighter:${side}`) ??
          new THREE.Vector3(
            side === 'a' ? -WORLD.FIGHTER_SEPARATION : WORLD.FIGHTER_SEPARATION,
            1.6,
            0,
          )
        )
      },
    }
  }

  get quality() {
    return this._quality
  }

  /**
   * Read-only telemetry: cost of frames the adaptor discarded from its demote
   * decision because they were flagged scripted-transient (super freeze, KO /
   * victory cinematic). Reachable ON PURPOSE and consumed by nothing here — it is
   * the signal that a machine can't render supers (which no tier currently helps),
   * surfaced rather than silently swallowed. See QualityAdaptor property 5.
   */
  transientCostReport() {
    return this.adaptor.transientCostReport()
  }

  /** Deterministic xorshift32. */
  readonly rng = (): number => {
    let x = this.rngState
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.rngState = x >>> 0
    return this.rngState / 0xffffffff
  }

  private context(): EngineContext {
    return {
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      size: { width: this.width, height: this.height },
      quality: this._quality,
      rng: this.rng,
      assets: this.assets,
      emit: (e) => this.emit(e),
      onLateUpdate: (fn) => {
        this.lateUpdates.add(fn)
        return () => this.lateUpdates.delete(fn)
      },
      anchors: this.anchors,
      requestHitstop: (ms: number, scale?: number) => this.requestHitstop(ms, scale),
      timeScale: () => this.timeScale,
      hitstop: () => this.hitstopEnv,
      realDt: () => this.lastRawDt,
    }
  }

  async add(...systems: Subsystem[]) {
    for (const s of systems) {
      this.subsystems.push(s)
      await s.init(this.context())
      s.resize?.(this.width, this.height)
    }
  }

  get<T extends Subsystem>(name: string): T | undefined {
    return this.subsystems.find((s) => s.name === name) as T | undefined
  }

  setRenderDriver(d: RenderDriver | null) {
    this.driver = d
    if (d) d.resize(this.width, this.height)
  }

  onEvent(fn: (e: FightEvent) => void): () => void {
    this.eventListeners.add(fn)
    return () => this.eventListeners.delete(fn)
  }

  emit(e: FightEvent) {
    this.pendingEvents.push(e)
  }

  setState(s: FightRenderState) {
    this.state = s
  }

  /**
   * Request a slow-motion factor. `snap` jumps immediately (impact freeze),
   * otherwise the engine eases into it over ~120ms.
   */
  setTimeScale(v: number, snap = false) {
    this.targetTimeScale = v
    this.timeScaleSnap = snap
    if (snap) this.timeScale = v
  }

  /**
   * Freeze the world on impact. Snaps to `scale` immediately, holds for
   * `durationMs` of wall time, then releases. Overlapping requests take the
   * harder freeze and the later release, so a crit landing inside a combo
   * hitstop deepens it rather than cutting it short.
   */
  requestHitstop(durationMs: number, scale = 0.02) {
    const now = this.now()
    const end = now + Math.max(0, durationMs)
    if (end > this.hitstopUntil) {
      this.hitstopUntil = end
      this.hitstopTotal = Math.max(1, end - now)
    }
    this.hitstopScale = Math.min(this.hitstopScale, Math.max(0, scale))
    this.hitstopEnv = 1
    this.timeScale = this.hitstopScale
    this.timeScaleSnap = true
  }

  setQuality(q: QualityTier, fromAdaptor = false) {
    if (q === this._quality) return
    this._quality = q
    this.maxPixelRatio = pixelRatioFor(q)
    this.renderer.setPixelRatio(this.effectivePixelRatio())
    this.renderer.shadowMap.enabled = qualityRank(q) >= 1
    for (const s of this.subsystems) s.setQuality?.(q)
    this.resize(this.width, this.height)
    // An adaptor-initiated change already cleared its own window in `commit()`
    // and must KEEP its ceiling + oscillation memory (that state is what makes a
    // demotion reversible). Only a foreign caller — the dev knob — fully resets
    // the controller, so it re-learns the forced tier as the new boot ceiling.
    if (!fromAdaptor) this.adaptor.reset()
  }

  /** Disable runtime downgrades (used while capturing reference screenshots). */
  setAdaptiveQuality(on: boolean) {
    this.adaptEnabled = on
  }

  /**
   * The pixel ratio we actually hand three.js: the tier's nominal cap, further
   * clamped to a fill BUDGET for the current CSS viewport. This is where the
   * 1080p/dpr2 catastrophe (pixelRatio 2.0 => 8.3M px => ~5fps) is defused —
   * `affordablePixelRatio` holds the rendered pixel count near the measured
   * ~30fps knee regardless of how large the device DPR claims to be.
   */
  private effectivePixelRatio(cssW = this.width, cssH = this.height): number {
    const hasWin = typeof window !== 'undefined'
    const dpr = hasWin ? window.devicePixelRatio || 1 : 1
    const w = cssW && cssW > 0 ? cssW : (hasWin && window.innerWidth) || 1920
    const h = cssH && cssH > 0 ? cssH : (hasWin && window.innerHeight) || 1080
    return affordablePixelRatio(w, h, dpr, this.maxPixelRatio)
  }

  resize(width: number, height: number) {
    if (width < 1 || height < 1) return
    this.width = width
    this.height = height
    // Re-evaluate the fill-aware pixel-ratio cap for the new CSS size before
    // sizing the drawing buffer — a wider viewport is more fill, so the
    // affordable ratio drops.
    this.renderer.setPixelRatio(this.effectivePixelRatio(width, height))
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    // Keep the vertical framing constant when the window gets narrower than
    // 16:9 — otherwise the fighters walk out of frame on portrait screens.
    const base = WORLD.CAMERA.fov
    const aspect = width / height
    this.camera.fov = aspect < 16 / 9
      ? THREE.MathUtils.radToDeg(
          2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(base) / 2) * ((16 / 9) / aspect)),
        )
      : base
    this.camera.updateProjectionMatrix()
    for (const s of this.subsystems) s.resize?.(width, height)
    this.driver?.resize(width, height)
  }

  start() {
    if (this.running) return
    this.running = true
    this.lastTime = this.now()
    const loop = (now: number) => {
      if (!this.running) return
      this.rafId = requestAnimationFrame(loop)
      this.frame(now)
    }
    this.rafId = requestAnimationFrame(loop)
  }

  stop() {
    this.running = false
    cancelAnimationFrame(this.rafId)
  }

  /**
   * Advance the simulation by exactly n frames of exactly dtMs each, with the
   * RAF loop stopped.
   *
   * Screenshot QA was previously done by counting RAF frames and letting each
   * one take whatever wall time it took. That is not reproducible: the frames
   * right after an impact are exactly the frames that compile new shaders and
   * allocate new particles, so their dt spikes to tens of milliseconds. Two
   * captures of "the same" moment could differ by more than 100ms of effect
   * age, which made every frame-by-frame visual comparison in this project a
   * coin flip -- including comparisons used to accept or reject work.
   *
   * The virtual clock is threaded through this.now() rather than
   * performance.now() so hitstop, which is measured in wall time on purpose,
   * advances in lockstep with dt instead of expiring instantly.
   */
  stepFixed(n: number, dtMs = 1000 / 60) {
    const wasRunning = this.running
    this.stop()
    if (this.virtualNow === null) this.virtualNow = performance.now()
    this.lastTime = this.virtualNow
    for (let i = 0; i < n; i++) {
      this.virtualNow += dtMs
      this.frame(this.virtualNow)
    }
    // Rebase off the virtual clock unconditionally. Doing this only when the
    // engine happened to be running leaked `virtualNow` forward: a later
    // start() would read this.now(), still get the (ahead) virtual value, seed
    // lastTime with it, and the first real rAF frame would then compute a
    // negative dt. Stepping a stopped engine is exactly what the lab and the
    // screenshot harness do, so this was the common path, not the rare one.
    const real = performance.now()
    if (this.hitstopUntil > 0) this.hitstopUntil += real - (this.virtualNow ?? real)
    this.virtualNow = null
    this.lastTime = real
    if (wasRunning) this.start()
  }

  /**
   * Wall clock, or the virtual clock while stepFixed is driving the engine.
   */
  private now() {
    return this.virtualNow ?? performance.now()
  }

  /**
   * Impact freeze is engine-owned so every subsystem rides the identical
   * curve. Durations follow fighting-game convention: light hits barely
   * register, supers and KOs stop the world.
   */
  private applyImpactHitstop(e: FightEvent) {
    if (e.kind === 'hit') {
      const base: Record<string, [number, number]> = {
        light: [45, 0.12],
        heavy: [80, 0.06],
        ex: [95, 0.05],
        crit: [130, 0.02],
        combo: [110, 0.04],
        signature: [150, 0.02],
        ult: [180, 0.015],
      }
      const [ms, scale] = base[e.flavor] ?? base.light
      // Bigger damage bites harder, but never past the next tier's feel.
      const k = 0.75 + 0.45 * Math.min(1, e.power)
      this.requestHitstop(ms * k, scale)
      if (e.shattered) this.requestHitstop(220, 0.01)
      return
    }
    if (e.kind === 'shatter') this.requestHitstop(220, 0.01)
    else if (e.kind === 'ko') this.requestHitstop(320, 0.008)
    else if (e.kind === 'signature') this.requestHitstop(180, 0.015)
  }

  private frame(now: number) {
    // Clamp BOTH ends. The upper bound is the long-standing GC/tab-restore
    // guard. The lower bound matters just as much: `now` is the rAF timestamp
    // but `lastTime` can be left on the virtual step clock (see stepFixed), and
    // when that clock has run ahead of wall time the subtraction goes negative.
    // Measured -336ms in the lab. A negative dt runs every spring, timer and
    // integrator in the engine BACKWARDS -- camera modes never reach their end
    // and hitstop envelopes invert. Never let one reach a subsystem.
    //
    // `wallDtMs` keeps the UNCLAMPED delta for ONE consumer only: the quality
    // adaptor, which must tell a genuinely slow frame apart from an unmeasurable
    // gap (tab-restore/GC). Handing it the clamped value made a 10s restore and a
    // 101ms hitch identical — both read as the worst case and floored the tier.
    const wallDtMs = now - this.lastTime
    const rawDt = Math.max(0, Math.min(0.1, wallDtMs / 1000))
    this.lastTime = now
    // Hitstop overrides the eased time scale while it's active. Measured in
    // unscaled wall time so the freeze can't stretch itself.
    if (now < this.hitstopUntil) {
      this.hitstopEnv = (this.hitstopUntil - now) / this.hitstopTotal
      this.timeScale = this.hitstopScale
      this.timeScaleSnap = false
    } else {
      if (this.hitstopEnv > 0) {
        // Release: decay the envelope so shake/pacing can ride the recovery.
        this.hitstopEnv = Math.max(0, this.hitstopEnv - rawDt * 6)
        this.hitstopScale = 1
        // Snap back hard. The freeze is the effect; a slow ramp out of it
        // just reads as mushy slow-motion and kills the impact.
        this.timeScale += (this.targetTimeScale - this.timeScale) * Math.min(1, rawDt * 45)
        this.timeScaleSnap = false
      } else if (!this.timeScaleSnap) {
        this.timeScale += (this.targetTimeScale - this.timeScale) * Math.min(1, rawDt * 12)
      } else {
        this.timeScaleSnap = false
      }
    }
    const dt = rawDt * this.timeScale
    this.lastRawDt = rawDt
    this.accumulatedDt += dt

    // Drain the event queue before updating so subsystems see events on the
    // same frame they were emitted.
    if (this.pendingEvents.length) {
      const batch = this.pendingEvents
      this.pendingEvents = []
      for (const e of batch) {
        this.applyImpactHitstop(e)
        for (const s of this.subsystems) s.onEvent?.(e)
        for (const fn of this.eventListeners) fn(e)
      }
    }

    const state = this.state
    if (state) {
      for (const s of this.subsystems) s.update(dt, state)
    }
    for (const fn of this.lateUpdates) fn(dt)

    const t0 = performance.now()
    if (this.driver) this.driver.render(dt)
    else this.renderer.render(this.scene, this.camera)
    const frameMs = performance.now() - t0

    this.frameCount++
    this.avgFrameMs += (frameMs - this.avgFrameMs) * 0.05
    this.runAdapt(now, wallDtMs)
  }

  /**
   * Adaptive quality. Delegates the whole decision to the pure QualityAdaptor,
   * which demotes when the windowed p90 sits above the 45fps line (or jumps to
   * the floor on a catastrophic read) AND promotes back up on a sustained healthy
   * window, so a demotion is reversible rather than a one-way fuse.
   *
   * We pass the UNCLAMPED wall-clock frame time on purpose. The sim's 100ms dt
   * clamp is load-bearing upstream, but it is NOT a measurement — it normalises a
   * multi-second stall to exactly 100ms, which the old policy then scored as 2x
   * catastrophic and used to floor the tier during the boot transient. The
   * adaptor separates "slow" from "unmeasurable" itself (it discards samples at
   * the discontinuity ceiling and excludes the boot grace), which it can only do
   * if it sees the real delta.
   */
  private runAdapt(now: number, wallDtMs: number) {
    if (!this.adaptEnabled) return
    // A super freeze / KO / victory cinematic is a bounded scripted event whose
    // frame cost the adaptor must EXCLUDE from its demote decision (it can't be
    // reduced by demoting — see QualityAdaptor property 5). The signal rides the
    // render state, refreshed this same frame by the sim advance in the subsystem
    // update loop above, so it is current by the time we sample.
    const isTransient = this.state?.scriptedTransient === true
    const action = this.adaptor.sample(now, wallDtMs, this._quality, isTransient)
    if (action.kind !== 'none') this.setQuality(action.to, true)
  }

  /** Force N frames synchronously — used by the screenshot harness. */
  renderFrames(n: number, stepMs = 16.67) {
    for (let i = 0; i < n; i++) {
      this.frame(this.lastTime + stepMs)
    }
  }

  dispose() {
    this._disposing = true
    this.canvas.removeEventListener('webglcontextlost', this.onCanvasContextLost)
    this.stop()
    for (const s of this.subsystems) s.dispose()
    this.subsystems.length = 0
    this.lateUpdates.clear()
    this.eventListeners.clear()
    this.assets.dispose()
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.geometry) m.geometry.dispose()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose()
    })
    this.renderer.dispose()
    // `renderer.dispose()` frees three's tracked resources (programs, render
    // targets, render lists) but leaves the WebGL context — and the textures and
    // buffers uploaded into it — for non-deterministic browser GC. That is why a
    // full-page navigation was, in this codebase, the only deterministic way to
    // free a scene's VRAM before the next one loaded. Forcing the context loss
    // here reclaims that VRAM synchronously at dispose, so dispose-before-mount
    // (the keyed-canvas bout rotation, and the client-side boot transitions this
    // unblocks) stays inside the atlas VRAM budget without throwing the document
    // away. `forceContextLoss` DOES fire `webglcontextlost`, but `_disposing`
    // is already true and the listener is already detached above, so our own
    // deliberate loss is never reported to the route as a failure —
    // and `forceContextLoss` is a no-op if WEBGL_lose_context is unavailable.
    this.renderer.forceContextLoss()
  }
}

// Nominal per-tier pixel-ratio CAPS. These are ceilings, not targets:
// `Engine.effectivePixelRatio` clamps them further to a fill budget for the
// current viewport (see QualityAdaptor.affordablePixelRatio). ultra/high top out
// at 1.5 — 2.0 is never right for a fill-bound renderer, where doubling the
// ratio quadruples the pixel count — a 4x FILL swing that, being superlinear,
// costs even more frame time. Our call: clamp here and spend the budget on post.
function pixelRatioFor(q: QualityTier): number {
  switch (q) {
    case 'low': return 1
    case 'medium': return 1.35
    case 'high': return 1.5
    case 'ultra': return 1.5
  }
}

export { LAYER }
