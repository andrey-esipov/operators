import * as THREE from 'three'
import type { Projectile } from '../../fight/types'
import { simToWorld } from './worldScale'
import {
  loadProjectileAtlas,
  type LoadedProjectile,
  type ProjectileClip,
} from './loadProjectileAtlas'

/**
 * Draws the sim's live projectiles as bright, bloom-eligible energy sprites.
 *
 * Design constraints that shaped this:
 *
 *  - Driven by DATA, not a switch. A sprite is chosen from `Projectile.kind`
 *    and its art loaded on demand; adding a new kind is a `frames.json`, never a
 *    code change here.
 *  - Bright by intent. Fighters were pulled OUT of the (inverted) selective
 *    bloom to stop their diffuse blowing out; projectiles are exactly the thing
 *    that SHOULD bloom, so these meshes are deliberately NOT tagged
 *    `userData.noBloom`, render additively and un-tone-mapped so the core reads
 *    as light against a busy stage.
 *  - Tracked by id from spawn to despawn. One `Projectile.id` maps to one live
 *    sprite that runs its lifecycle (spawn → travel-loop → impact) rather than
 *    popping a fresh sprite each frame. When the sim drops a projectile (it hit,
 *    expired or was parried) the sprite detaches from sim data and finishes its
 *    impact burst in place, so the hit reads even though the sim object is gone.
 *  - Mirrored, not duplicated. Art is authored travelling right; a left-facing
 *    owner flips the quad on X (and the anchor with it).
 */

/** World units per source pixel for projectile art. Tuned so an `ion-bolt`
 *  (96px) reads as a fist-plus-forearm energy ball and a `super-beam` (176px
 *  wide) as a stage-spanning lance, both legible in a single frame at speed. */
const WORLD_PER_PX = 0.014

/** Just in front of both fighter z-slabs (±0.02) so a bolt reads over the
 *  characters it passes, never behind them. */
const PROJ_Z = 0.08

type Phase = 'spawn' | 'travel' | 'impact'

interface Live {
  id: number
  kind: string
  loaded: LoadedProjectile
  mesh: THREE.Mesh
  geom: THREE.PlaneGeometry
  mat: THREE.MeshBasicMaterial
  facing: 1 | -1
  phase: Phase
  /** Ticks (60fps) elapsed within the current phase clip. */
  clock: number
  /** Last world position, so a detached sprite bursts where it died. */
  lastWorld: THREE.Vector3
  /** True once the sim no longer owns this projectile; playing out impact. */
  detached: boolean
  curFrame: number
}

export class ProjectileLayer {
  readonly group = new THREE.Group()
  private live = new Map<number, Live>()
  private loaded = new Map<string, LoadedProjectile>()
  private loading = new Map<string, Promise<void>>()
  private warned = new Set<string>()
  private disposed = false
  private tmpWorld = new THREE.Vector3()

  constructor() {
    this.group.name = 'projectiles'
  }

  /** Warm the atlases for kinds we expect, so the first bolt draws on the frame
   *  it spawns rather than a few frames late while the fetch resolves. */
  async preload(kinds: string[]) {
    await Promise.all(kinds.map((k) => this.ensureLoaded(k)))
  }

  private ensureLoaded(kind: string): Promise<void> {
    if (this.loaded.has(kind)) return Promise.resolve()
    const inFlight = this.loading.get(kind)
    if (inFlight) return inFlight
    const p = loadProjectileAtlas(kind)
      .then((res) => {
        if (this.disposed) {
          res.texture.dispose()
          return
        }
        this.loaded.set(kind, res)
      })
      .catch((err) => {
        if (!this.warned.has(kind)) {
          this.warned.add(kind)
          console.warn(`[projectile] no art for kind "${kind}": ${err instanceof Error ? err.message : err}`)
        }
      })
      .finally(() => {
        this.loading.delete(kind)
      })
    this.loading.set(kind, p)
    return p
  }

  /**
   * Reconcile the live sprites against this frame's sim projectiles.
   *
   * @param prev  projectiles from the previous sim snapshot (for interpolation)
   * @param cur   projectiles from the latest sim snapshot
   * @param alpha 0..1 interpolation fraction between prev and cur
   * @param dt    scaled seconds this frame (freezes with hitstop, like the world)
   */
  update(
    prev: Projectile[] | undefined,
    cur: Projectile[] | undefined,
    alpha: number,
    dt: number,
  ) {
    const ticks = dt * 60
    const prevById = new Map<number, Projectile>()
    if (prev) for (const p of prev) prevById.set(p.id, p)
    const seen = new Set<number>()

    if (cur) {
      for (const p of cur) {
        seen.add(p.id)
        if (!this.loaded.has(p.kind)) {
          void this.ensureLoaded(p.kind)
          continue // no art yet; draw nothing rather than a wrong sprite
        }
        let l = this.live.get(p.id)
        if (!l) {
          l = this.spawn(p)
          if (!l) continue
        }
        // Interpolated world position of the sim hot-point.
        const pp = prevById.get(p.id)
        const px = pp ? pp.pos.x + (p.pos.x - pp.pos.x) * alpha : p.pos.x
        const py = pp ? pp.pos.y + (p.pos.y - pp.pos.y) * alpha : p.pos.y
        simToWorld({ x: px, y: py }, this.tmpWorld)
        l.facing = p.facing
        l.lastWorld.copy(this.tmpWorld)
        this.place(l)
        this.advance(l, ticks)
      }
    }

    // Any tracked sprite the sim no longer owns starts (or continues) its
    // impact burst in place, then retires when the burst finishes.
    for (const l of this.live.values()) {
      if (seen.has(l.id)) continue
      if (!l.detached) {
        l.detached = true
        l.phase = 'impact'
        l.clock = 0
        l.curFrame = -1
      }
      this.place(l)
      const done = this.advance(l, ticks)
      if (done) this.retire(l)
    }
  }

  private spawn(p: Projectile): Live | null {
    const loaded = this.loaded.get(p.kind)
    if (!loaded) return null
    const geom = new THREE.PlaneGeometry(1, 1)
    const mat = new THREE.MeshBasicMaterial({
      map: loaded.texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      toneMapped: false, // pass through > 1 so the core survives to the bloom
      side: THREE.DoubleSide, // negative X scale (mirroring) flips winding
      // A modest boost pushes the bright core over the bloom threshold without
      // clipping the whole sprite to white.
      color: new THREE.Color(1.35, 1.35, 1.35),
    })
    const mesh = new THREE.Mesh(geom, mat)
    mesh.frustumCulled = false
    mesh.renderOrder = 20 // over fighters (10), under nothing that matters
    this.group.add(mesh)
    const l: Live = {
      id: p.id,
      kind: p.kind,
      loaded,
      mesh,
      geom,
      mat,
      facing: p.facing,
      phase: 'spawn',
      clock: 0,
      lastWorld: new THREE.Vector3(),
      detached: false,
      curFrame: -1,
    }
    this.live.set(p.id, l)
    return l
  }

  /** Position + size the quad so the manifest anchor sits on the world point. */
  private place(l: Live) {
    const m = l.loaded.manifest
    const worldW = m.frameW * WORLD_PER_PX
    const worldH = m.frameH * WORLD_PER_PX
    // Mirror art for a left-facing owner: flip on X and mirror the anchor.
    const axEff = l.facing < 0 ? m.frameW - m.anchor.x : m.anchor.x
    l.mesh.scale.set(l.facing < 0 ? -worldW : worldW, worldH, 1)
    // Offset the (centre-pivoted) quad so `anchor` lands on lastWorld. Image y
    // grows downward, world y upward, hence the sign flip on the vertical term.
    l.mesh.position.set(
      l.lastWorld.x + (m.frameW / 2 - axEff) * WORLD_PER_PX,
      l.lastWorld.y + (m.anchor.y - m.frameH / 2) * WORLD_PER_PX,
      PROJ_Z,
    )
  }

  /** Advance the current clip by `ticks`, blit the resolved frame, and handle
   *  spawn→travel promotion. Returns true when a non-looping clip has finished. */
  private advance(l: Live, ticks: number): boolean {
    l.clock += ticks
    const clip = this.clipFor(l)
    const { idx, done } = frameAt(clip, l.clock)
    if (idx !== l.curFrame) {
      l.curFrame = idx
      this.blit(l, idx)
    }
    if (l.phase === 'spawn' && done) {
      // Roll straight into the travel loop the same frame the spawn ends.
      l.phase = 'travel'
      l.clock = 0
      l.curFrame = -1
      return false
    }
    return done // meaningful only for the one-shot impact phase
  }

  private clipFor(l: Live): ProjectileClip {
    const c = l.loaded.manifest.clips
    return l.phase === 'spawn' ? c.spawn : l.phase === 'impact' ? c.impact : c.travel
  }

  /** Rewrite the quad's UVs to frame `idx`'s atlas rect (flipY=true convention),
   *  so all sprites of a kind share one texture with no per-sprite GPU upload. */
  private blit(l: Live, idx: number) {
    const m = l.loaded.manifest
    const rect = m.frames[idx]?.rect
    if (!rect) return
    const { atlasW, atlasH } = l.loaded
    const u0 = rect.x / atlasW
    const u1 = (rect.x + rect.w) / atlasW
    const v1 = 1 - rect.y / atlasH
    const v0 = 1 - (rect.y + rect.h) / atlasH
    const uv = l.geom.attributes.uv as THREE.BufferAttribute
    // PlaneGeometry(1,1) vertex order: TL, TR, BL, BR.
    uv.setXY(0, u0, v1)
    uv.setXY(1, u1, v1)
    uv.setXY(2, u0, v0)
    uv.setXY(3, u1, v0)
    uv.needsUpdate = true
  }

  private retire(l: Live) {
    this.group.remove(l.mesh)
    l.geom.dispose()
    l.mat.dispose()
    this.live.delete(l.id)
  }

  /** Count of sprites currently in the scene — cheap liveness signal for tests
   *  and probes (NOT proof anything painted; see FightRenderer.projectileCoverage). */
  get liveCount(): number {
    return this.live.size
  }

  dispose() {
    this.disposed = true
    for (const l of this.live.values()) {
      this.group.remove(l.mesh)
      l.geom.dispose()
      l.mat.dispose()
    }
    this.live.clear()
    for (const res of this.loaded.values()) res.texture.dispose()
    this.loaded.clear()
  }
}

/**
 * Resolve which `frames[]` index a clip shows at tick `t`, and whether a
 * non-looping clip has run to its end. `frames`/`durations` are parallel arrays;
 * `durations[i]` is the tick count for frame i. Looping clips wrap; one-shots
 * hold the final frame and report `done`.
 *
 * Exported for the lifecycle test — this is the timing that decides spawn→travel
 * promotion and impact-burst retirement, so it earns a regression guard.
 */
export function frameAt(clip: ProjectileClip, t: number): { idx: number; done: boolean } {
  let total = 0
  for (const d of clip.durations) total += d
  if (total <= 0) return { idx: clip.frames[0] ?? 0, done: true }
  let done = false
  let local = t
  if (clip.loop) {
    local = local % total
  } else if (local >= total) {
    done = true
    local = total - 1
  }
  let acc = 0
  for (let i = 0; i < clip.frames.length; i++) {
    acc += clip.durations[i]
    if (local < acc) return { idx: clip.frames[i], done }
  }
  return { idx: clip.frames[clip.frames.length - 1], done }
}
