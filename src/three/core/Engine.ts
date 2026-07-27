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

  private subsystems: Subsystem[] = []
  private driver: RenderDriver | null = null
  private lateUpdates = new Set<(dt: number) => void>()
  private rafId = 0
  private running = false
  private lastTime = 0
  private accumulatedDt = 0

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

  private state: FightRenderState | null = null
  private pendingEvents: FightEvent[] = []
  private eventListeners = new Set<(e: FightEvent) => void>()

  // Adaptive-quality sampling
  private frameTimes: number[] = []
  private lastAdapt = 0
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatio))
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
    const now = performance.now()
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

  setQuality(q: QualityTier) {
    if (q === this._quality) return
    this._quality = q
    this.maxPixelRatio = pixelRatioFor(q)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.maxPixelRatio))
    this.renderer.shadowMap.enabled = qualityRank(q) >= 1
    for (const s of this.subsystems) s.setQuality?.(q)
    this.resize(this.width, this.height)
  }

  /** Disable runtime downgrades (used while capturing reference screenshots). */
  setAdaptiveQuality(on: boolean) {
    this.adaptEnabled = on
  }

  resize(width: number, height: number) {
    if (width < 1 || height < 1) return
    this.width = width
    this.height = height
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
    this.lastTime = performance.now()
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
    const rawDt = Math.min(0.1, (now - this.lastTime) / 1000)
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
    this.frameTimes.push(rawDt * 1000)
    if (this.frameTimes.length > 90) this.frameTimes.shift()
    this.maybeAdapt(now)
  }

  /**
   * Adaptive quality. If we sustain <45fps for 1.5s, drop a tier. We never
   * auto-upgrade — oscillating between tiers is more distracting than a
   * slightly conservative setting.
   */
  private maybeAdapt(now: number) {
    if (!this.adaptEnabled) return
    if (this.frameTimes.length < 90) return
    if (now - this.lastAdapt < 1500) return
    const sorted = [...this.frameTimes].sort((a, b) => a - b)
    const p90 = sorted[Math.floor(sorted.length * 0.9)]
    if (p90 > 22.2) {
      const rank = qualityRank(this._quality)
      if (rank > 0) {
        const next = (['low', 'medium', 'high', 'ultra'] as QualityTier[])[rank - 1]
        this.setQuality(next)
        this.lastAdapt = now
        this.frameTimes.length = 0
      }
    }
  }

  /** Force N frames synchronously — used by the screenshot harness. */
  renderFrames(n: number, stepMs = 16.67) {
    for (let i = 0; i < n; i++) {
      this.frame(this.lastTime + stepMs)
    }
  }

  dispose() {
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
  }
}

function pixelRatioFor(q: QualityTier): number {
  switch (q) {
    case 'low': return 1
    case 'medium': return 1.35
    case 'high': return 1.75
    case 'ultra': return 2
  }
}

export { LAYER }
