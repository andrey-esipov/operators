import * as THREE from 'three'
import type { Projectile } from '../../fight/types'
import { STAGE_HALF_W, PROJECTILE_MARGIN, SUPER_FREEZE_FRAMES } from '../../fight/constants'
import { simToWorld, cmYToWorld } from './worldScale'
import { energyTint, flashTint, hotTint, makeGlowMesh, hotCoreTexture, beamColumnTexture, beamCrackleTexture, beamCrackleScroll, BEAM_CRACKLE_PERIOD, beamTint, coreQuadTint, presenceFor, clashing, type Presence } from './ProjectileFx'
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
 *
 * Beyond the atlas, three things separate a shipped fireball from a sprite
 * sliding across the screen, and each is added here:
 *  - a motion TRAIL (a short history of the hot-point, drawn as fading glow
 *    blobs) so a fast bolt reads as light in motion, not a floating cutout;
 *  - a FLOOR POOL of light tracking under the bolt, so it belongs to the scene
 *    instead of being pasted on top;
 *  - two visibly different deaths — a bright IMPACT burst when it connects, and
 *    a soft FIZZLE when it merely runs out of life or leaves the stage.
 */

/** World units per source pixel for projectile art. Tuned so an `ion-bolt`
 *  (96px) reads as a fist-plus-forearm energy ball and a `super-beam` (176px
 *  wide) as a stage-spanning lance, both legible in a single frame at speed. */
const WORLD_PER_PX = 0.014

/** Just in front of both fighter z-slabs (±0.02) so a bolt reads over the
 *  characters it passes, never behind them. */
const PROJ_Z = 0.08

/** Number of trailing glow blobs behind the hot-point. Enough to read as a
 *  streak at bolt speed without becoming a solid bar. */
const TRAIL_SEG = 6

/** Fixed size of a beam's spark pool. Bounded by construction: sparks are
 *  recycled in place, never allocated per-frame, so the "storm" stays dense while
 *  the cost is a constant handful of additive quads per super. */
const SPARK_COUNT = 30

/** Opposing bolts crackle when their hot-points cross within this many world
 *  units — roughly a bolt's visible radius, so the burst reads as the two energy
 *  bodies touching, not a pop in the empty gap between them. Cosmetic only; the
 *  sim passes projectiles through each other (see ProjectileFx.clashing). */
const CLASH_WORLD_DIST = 0.7

// Per-kind opacities and scales (trail, floor, aura, spawn flash, impact) live
// in the Presence profile in ProjectileFx; the layer reads them off each Live,
// so a super can be an order of magnitude more present than a jab with no
// branching here and no change to the tuned ion-bolt look.

/** Ticks a fizzle (life-expiry / off-stage exit) takes to dissipate. */
const FIZZLE_TICKS = 12

/** Hard cap on how far the clip clocks (spawn flash, travel, impact death) may
 *  advance in a single render call. At a locked 60fps a frame is ~1 tick, so
 *  this never bites in real play; but a GC hitch, a hidden tab, or a paused
 *  frame-step can hand `update` a multi-hundred-ms dt, and without a clamp that
 *  one call would blow straight through a short one-shot clip — the ~12-tick
 *  IMPACT burst would appear and retire between two rendered frames and never be
 *  seen. Clamping to a ~15fps-floor's worth of ticks guarantees every death
 *  animation plays across several frames no matter how badly the loop stalls.
 *  This is the standard frame-time clamp a fixed-step game loop uses; it only
 *  ever slows a runaway dt, never speeds one up. */
const MAX_TICKS = 4

/** Past this |x| (cm) the sim retires a bolt for leaving the stage; matches the
 *  sim's own off-stage test so the renderer infers that death, not a hit. */
const OFFSTAGE_CM = STAGE_HALF_W + PROJECTILE_MARGIN

/**
 * The super-freeze envelope, DERIVED from `SUPER_FREEZE_FRAMES` so the VFX and
 * the sim's "stop the world" beat are ONE parameter, never two that can drift.
 * The original defect was exactly this desync: the freeze ran its full length
 * while the activation burst died at the midpoint, leaving ~24 static frames the
 * critic called "the super running out of things to show at its own midpoint."
 *
 * `SUPER_FREEZE_FRAMES` frames of held world get four beats, all as FRACTIONS of
 * the freeze so they rescale the instant the sim retunes the constant:
 *   - anticipation  t∈[0, .10)  the flash punches, the charge ignites small,
 *   - build         t∈[.10, .82) the charge GROWS — this is the back half that
 *                                was dead; it must visibly gather, not sit,
 *   - compress      t∈[.82, .96) the aura inhales while the core spikes white,
 *   - release       t∈[.96, 1]   the core flares as the beam is about to launch.
 * The beam then spawns on the first resumed frame and carries its own travel.
 */
const SUPER = {
  /** Peak of the world-dim held through the freeze. Matches super-beam's own
   *  `presence.worldDim` (0.6) so the freeze dim hands off to the travelling
   *  beam's dim with no visible step. */
  DIM_PEAK: 0.6,
  /** Charge core/aura live on this z, just behind the owner (drawn before the
   *  fighter at renderOrder 10) so the halo frames the body instead of washing
   *  over it — the TASK-3 "never erase the fighter" rule, by construction. */
  Z: 0.04,
  /** Number of inward-spiralling gather motes; enough to read as "power being
   *  pulled in" without becoming a swarm. */
  MOTES: 7,
} as const

/** Owner + freeze state handed to the layer each frame so the super envelope can
 *  be driven by the sim's authoritative "stop the world" countdown rather than
 *  by a self-firing timer that could tick to completion mid-freeze. `ownerPos`
 *  is the owner's chest anchor in world space; `freeze` is frames remaining. */
export interface SuperFreezeView {
  freeze: number
  who: 0 | 1
  ownerPos: THREE.Vector3
  facing: 1 | -1
}

type Phase = 'spawn' | 'travel' | 'impact' | 'fizzle'

interface TrailBlob {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
}

/** One additive spark in a beam's bounded particulate pool. Recycled in place —
 *  when its life runs out it is re-seeded at the beam, never allocated again, so
 *  the "storm" is dense but the pool is fixed-size and cheap. */
interface Spark {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  seed: number
}

interface Live {
  id: number
  kind: string
  /** Which fighter fired it, so opposing bolts can be detected for a clash. */
  owner: 0 | 1
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
  /** True once the sim no longer owns this projectile; playing out its death. */
  detached: boolean
  curFrame: number
  /** Energy colour for this kind's trail / pool / flash. */
  tint: THREE.Color
  /** Fading glow blobs behind the hot-point, newest first. */
  trail: TrailBlob[]
  /** Recent hot-point world positions, newest first (drives the trail). */
  history: THREE.Vector3[]
  /** Soft additive light washed on the floor under the bolt. */
  floor: THREE.Mesh
  floorMat: THREE.MeshBasicMaterial
  /** Expanding light burst, spawned only on a genuine impact. */
  flash: THREE.Mesh | null
  flashMat: THREE.MeshBasicMaterial | null
  /** Travelling volume of light behind the sprite (super only; else null). */
  aura: THREE.Mesh | null
  auraMat: THREE.MeshBasicMaterial | null
  /** Tight, near-white hot core laid over the aura for core contrast (super
   *  only; else null). */
  core: THREE.Mesh | null
  coreMat: THREE.MeshBasicMaterial | null
  /** Hard spawn flash: the mesh, its own clock, and the fixed birth point it
   *  fires from while the beam races away (super only; else null). */
  spawnFlash: THREE.Mesh | null
  spawnFlashMat: THREE.MeshBasicMaterial | null
  spawnClock: number
  spawnPos: THREE.Vector3
  /** Stretched electric COLUMN drawn muzzle→head — the caster→target lance
   *  (super only; else null). */
  beam: THREE.Mesh | null
  beamMat: THREE.MeshBasicMaterial | null
  /** Bounded, recycled particulate streaming off the beam (super only; else
   *  empty). `sparkEmit` accumulates fractional emissions between frames. */
  sparks: Spark[]
  sparkEmit: number
  /** This kind's presence profile and effective world-units-per-source-pixel
   *  (WORLD_PER_PX × spriteScale), used everywhere the sprite is sized. */
  presence: Presence
  wpp: number
  /** Last-seen sim values, to infer WHY the sim dropped the bolt. */
  lastX: number
  lastVx: number
  lastLife: number
}

export class ProjectileLayer {
  readonly group = new THREE.Group()
  private live = new Map<number, Live>()
  /** Short additive crackles where opposing bolts crossed. Each is independent of
   *  the two bolts that spawned it and self-retires when its clock runs out. */
  private clashBursts: {
    mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial
    core: THREE.Mesh; coreMat: THREE.MeshBasicMaterial
    clock: number; life: number; size: number
  }[] = []
  /** Opposing pairs (keyed by id) already crackling, so one crossing fires ONE
   *  burst; a key is dropped once the pair parts past a hysteresis band so a
   *  genuine re-cross can crackle again. */
  private clashedPairs = new Set<string>()
  private loaded = new Map<string, LoadedProjectile>()
  private loading = new Map<string, Promise<void>>()
  private warned = new Set<string>()
  private disposed = false
  private tmpWorld = new THREE.Vector3()
  private groundY = cmYToWorld(0)

  /** The live scene camera, needed to bill-board the full-screen super quads in
   *  front of it each frame. Set once by FightRenderer; null in headless tests
   *  and the coverage probe, where the super atmosphere simply never draws. */
  private camera: THREE.PerspectiveCamera | null = null

  // --- Full-screen super atmosphere (world-dim + activation flash) -----------
  // ONE pair of camera-space quads shared by the whole layer, not per bolt: a
  // super drops the world back behind the fighters and punches a screen flash; a
  // jab does neither. Built lazily the first time a super needs them, so an
  // all-ion-bolt match never allocates or draws any of this.
  private worldDimMesh: THREE.Mesh | null = null
  private worldDimMat: THREE.MeshBasicMaterial | null = null
  private superFlashMesh: THREE.Mesh | null = null
  private superFlashMat: THREE.MeshBasicMaterial | null = null
  /** Eased 0..peak opacities. `dimCur` tracks a STATE-derived target so it holds
   *  through a freeze; `flashCur` is a transient that punches on spawn and decays. */
  private dimCur = 0
  private flashCur = 0
  /** Render-frames left to hold the flash at its punched peak before it decays,
   *  so activation lands as a ~12-frame BEAT instead of a 5-frame blip nobody
   *  reads. Ticks down on render time, so a freeze still clears it to the pose. */
  private flashHold = 0
  /** Sim ids of flash-carrying (super) bolts seen last frame, so the activation
   *  flash fires exactly once when a genuinely new one is born. */
  private superSeen = new Set<number>()
  private flashColor = new THREE.Color(1.4, 1.5, 1.8)
  private tmpFwd = new THREE.Vector3()

  // --- Super charge (owner-anchored gather that fills the held freeze) --------
  // A hot core + halo + expanding shells + inward-spiralling motes, anchored at
  // the OWNER's chest, that ignite on the activation flash and GROW across the
  // whole `SUPER_FREEZE_FRAMES` beat. This is the fix for the dead back half: the
  // freeze holds the world for its full length but the owner only has a ~6-frame
  // wind-up clip and then a static hold, so the VFX must carry the remaining ~50
  // frames. Everything sits just BEHIND the fighter (renderOrder < 10) so the
  // halo frames the body rather than washing over it. Built lazily on the first
  // super freeze; disposed with the layer.
  private chargeGroup: THREE.Group | null = null
  private chargeCore: THREE.Mesh | null = null
  private chargeCoreMat: THREE.MeshBasicMaterial | null = null
  private chargeAura: THREE.Mesh | null = null
  private chargeAuraMat: THREE.MeshBasicMaterial | null = null
  private chargeRings: THREE.Mesh[] = []
  private chargeRingMats: THREE.MeshBasicMaterial[] = []
  private chargeMotes: THREE.Mesh[] = []
  private chargeMoteMats: THREE.MeshBasicMaterial[] = []
  private chargeMoteAngles: number[] = []
  /** Eased 0..1 overall charge presence. Tracks the freeze-progress envelope
   *  directly while frozen (so it visibly BUILDS, never eases into a plateau);
   *  decays to 0 on release so the hand-off to the launched beam is a flare-down
   *  rather than a pop. */
  private chargeCur = 0
  /** Render-frames elapsed since the charge ignited, cycling the expanding
   *  shells and orbiting motes so SOMETHING moves on every held frame — the one
   *  thing a still can't verify and a filmstrip proved was missing. */
  private chargeClock = 0
  /** Last owner chest anchor + facing, held through the release fade after the
   *  freeze clears (when the sim no longer reports an owner). */
  private chargePos = new THREE.Vector3()
  private chargeFacing: 1 | -1 = 1
  /** Previous freeze count, to detect the rising edge (0 → FREEZE_FRAMES) that
   *  marks activation — the one frame the screen flash should punch. */
  private prevFreeze = 0
  /** Whether the charge was active last frame, so the cycle clock resets cleanly
   *  at the START of each super rather than mid-build. */
  private chargePrevActive = false
  /** 0..1 gather progress, held through the release fade (when the sim no longer
   *  reports a freeze) so the motes stay converged as the charge flares down. */
  private chargeProg = 0
  private chargeEnergy = new THREE.Color()
  private chargeWhite = new THREE.Color()

  constructor() {
    this.group.name = 'projectiles'
    // Dev-only introspection: capture tooling needs to see WHAT each live bolt is
    // doing (phase, clip clock, impact-flash opacity) to prove the death beats
    // actually play, not merely that some pixels lit. Measuring the animation
    // directly is the only way to catch a burst that a screenshot's timing missed.
    if (import.meta.env.DEV) {
      ;(globalThis as Record<string, unknown>).__PROJDBG__ = () =>
        [...this.live.values()].map((l) => ({
          id: l.id,
          kind: l.kind,
          phase: l.phase,
          clock: Math.round(l.clock * 100) / 100,
          detached: l.detached,
          flashOpacity: l.flashMat ? Math.round(l.flashMat.opacity * 100) / 100 : null,
          spawnFlashOpacity: l.spawnFlashMat ? Math.round(l.spawnFlashMat.opacity * 100) / 100 : null,
          curFrame: l.curFrame,
        }))
      // Screen-wide super atmosphere state, so a native-res capture can assert
      // the world-dim and activation flash directly instead of inferring them
      // from a lit-pixel count that a mistimed screenshot could satisfy either way.
      ;(globalThis as Record<string, unknown>).__PROJATMO__ = () => ({
        dim: Math.round(this.dimCur * 1000) / 1000,
        flash: Math.round(this.flashCur * 1000) / 1000,
        dimVisible: !!this.worldDimMesh?.visible,
        flashVisible: !!this.superFlashMesh?.visible,
      })
      // Owner-anchored super charge, so a filmstrip capture can assert the back
      // half of the freeze is ALIVE (charge present + growing + cycling) rather
      // than inferring it from a lit-pixel count a mistimed frame could fake.
      ;(globalThis as Record<string, unknown>).__PROJCHARGE__ = () => ({
        charge: Math.round(this.chargeCur * 1000) / 1000,
        clock: Math.round(this.chargeClock * 100) / 100,
        visible: !!this.chargeGroup?.visible,
      })
    }
  }

  /** Hand the layer the live scene camera so it can bill-board its full-screen
   *  super quads in front of it. Called once by FightRenderer; without it the
   *  super atmosphere never draws (headless tests, the coverage probe). */
  setCamera(cam: THREE.PerspectiveCamera) {
    this.camera = cam
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
   * @param superState owner + freeze countdown while the sim holds the world for
   *   a super, or null/undefined when no super is freezing. Drives the charge
   *   envelope and the freeze-held world-dim; see updateSuperAtmosphere/Charge.
   * @param renderDt UNSCALED seconds this frame (does NOT freeze with hitstop).
   *   The super atmosphere + charge run on this so the held freeze stays alive;
   *   omitted in headless tests, where it falls back to `dt`.
   */
  update(
    prev: Projectile[] | undefined,
    cur: Projectile[] | undefined,
    alpha: number,
    dt: number,
    superState?: SuperFreezeView | null,
    renderDt?: number,
  ) {
    // Dev-only mutation hook: blank the whole projectile layer so a capture can
    // diff layer-on vs layer-off at the same seed and see EXACTLY what the bolts
    // paint (stage art and any overlay cancel in the diff). Also the house-rule
    // "disable the layer, watch the measurement fall to zero" proof — projCoverage
    // reads this same group, so hiding it drives the readback to 0.
    if (import.meta.env.DEV) {
      const muted = !!(globalThis as Record<string, unknown>).__MUT_NO_PROJ__
      this.group.visible = !muted
      if (muted) return
    }
    const ticks = Math.min(dt * 60, MAX_TICKS)
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
          // spawn() returns `Live | null`, but `l` is `Live | undefined` from the
          // map lookup — narrow through a local so the union stays assignable.
          const spawned = this.spawn(p)
          if (!spawned) continue
          l = spawned
        }
        // Interpolated world position of the sim hot-point.
        const pp = prevById.get(p.id)
        const px = pp ? pp.pos.x + (p.pos.x - pp.pos.x) * alpha : p.pos.x
        const py = pp ? pp.pos.y + (p.pos.y - pp.pos.y) * alpha : p.pos.y
        simToWorld({ x: px, y: py }, this.tmpWorld)
        l.facing = p.facing
        l.lastWorld.copy(this.tmpWorld)
        // Remember the latest sim truth so, once the bolt vanishes, we can tell a
        // hit from a mere expiry / off-stage exit and pick the right death.
        l.lastX = p.pos.x
        l.lastVx = p.vel.x
        l.lastLife = p.life
        this.place(l)
        this.pushTrail(l, true)
        this.advance(l, ticks)
        this.updateSparks(l, ticks, true)
      }
    }

    // Opposing bolts crossing -> a one-shot midpoint crackle. Cosmetic: the sim
    // passes projectiles through one another, so this only paints where their
    // energy overlaps. Runs after every live bolt is positioned this frame.
    this.updateClashes(seen)

    // Any tracked sprite the sim no longer owns starts (or continues) its death
    // in place, then retires when it finishes.
    for (const l of this.live.values()) {
      if (seen.has(l.id)) continue
      if (!l.detached) {
        l.detached = true
        l.clock = 0
        l.curFrame = -1
        if (this.diedOnContact(l)) {
          l.phase = 'impact'
          this.spawnFlash(l)
        } else {
          l.phase = 'fizzle'
        }
      }
      this.place(l)
      const done = this.animateOut(l, ticks)
      this.updateSparks(l, ticks, false)
      if (done) this.retire(l)
    }

    // Spawn flashes run on their own clock, independent of beam phase, so tick
    // every survivor once per frame. Retired beams are already gone from the map
    // (their flash disposed in retire), so this only touches live ones.
    for (const l of this.live.values()) this.tickSpawnFlash(l, ticks)
    this.tickClashBursts(ticks)

    // Full-screen super atmosphere + the owner-anchored charge. Both run on the
    // UNSCALED render delta (not `ticks`, which collapses to ~0 while the sim is
    // frozen for the super) so the held "stop the world" beat keeps easing and
    // building. The freeze view is the sim's authoritative countdown; when it's
    // null nothing super-related draws.
    const renderTicks = Math.min((renderDt ?? dt) * 60, MAX_TICKS)
    this.updateSuperAtmosphere(cur, renderTicks, superState ?? null)
    this.updateSuperCharge(superState ?? null, renderTicks)
  }

  /** Detect opposing-owner bolts crossing and fire a one-shot midpoint crackle.
   *  O(n^2) over live bolts, but n is a small handful (a zoner and a projectile
   *  opponent, plus the odd spread), so the pairwise scan is trivially cheap. */
  private updateClashes(seen: Set<number>) {
    const active: Live[] = []
    for (const l of this.live.values()) if (!l.detached && seen.has(l.id)) active.push(l)
    if (active.length < 2) {
      this.clashedPairs.clear()
      return
    }
    const near = new Set<string>()
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i]
        const b = active[j]
        if (a.owner === b.owner) continue
        const aPt = { owner: a.owner, x: a.lastWorld.x, y: a.lastWorld.y }
        const bPt = { owner: b.owner, x: b.lastWorld.x, y: b.lastWorld.y }
        const key = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`
        // Hysteresis: a pair stays "engaged" out to 1.6x the fire distance, so a
        // bolt loitering on the boundary can't strobe a fresh burst every frame.
        if (clashing(aPt, bPt, CLASH_WORLD_DIST * 1.6)) near.add(key)
        if (clashing(aPt, bPt, CLASH_WORLD_DIST) && !this.clashedPairs.has(key)) {
          this.spawnClashBurst(a, b)
          this.clashedPairs.add(key)
        }
      }
    }
    // Forget pairs that have parted (or where a bolt retired) so a genuine
    // re-cross crackles again rather than staying suppressed forever.
    for (const k of [...this.clashedPairs]) if (!near.has(k)) this.clashedPairs.delete(k)
  }

  /** A crackle where two opposing bolts crossed: a coloured glow wearing BOTH
   *  bolts' hues mixed, plus a tight white-hot core, at their midpoint. Additive
   *  and short — it flares and clears. It lives between the fighters (where the
   *  bolts met), not on them, so it accents the fireball war without washing the
   *  silhouettes. */
  private spawnClashBurst(a: Live, b: Live) {
    const mid = a.lastWorld.clone().lerp(b.lastWorld, 0.5)
    mid.z = PROJ_Z + 0.03
    const mixed = a.tint.clone().lerp(b.tint, 0.5)
    const glow = makeGlowMesh(mixed, 24)
    const glowMat = glow.material as THREE.MeshBasicMaterial
    glowMat.opacity = 0
    glow.position.copy(mid)
    this.group.add(glow)
    const core = makeGlowMesh(new THREE.Color(0xffffff), 25, hotCoreTexture())
    const coreMat = core.material as THREE.MeshBasicMaterial
    coreMat.opacity = 0
    core.position.copy(mid)
    this.group.add(core)
    this.clashBursts.push({ mesh: glow, mat: glowMat, core, coreMat, clock: 0, life: 0.3, size: 1.5 })
  }

  /** Grow + fade every live clash crackle, retiring (and disposing) any whose
   *  clock has run out. Opacity rides a sin envelope so each burst rises then
   *  clears, capped well below a blowout (outer 0.5, core 0.82 additive). */
  private tickClashBursts(ticks: number) {
    if (this.clashBursts.length === 0) return
    const dt = ticks / 60
    const survivors: typeof this.clashBursts = []
    for (const c of this.clashBursts) {
      c.clock += dt
      const t = c.clock / c.life
      if (t >= 1) {
        this.group.remove(c.mesh)
        ;(c.mesh.geometry as THREE.BufferGeometry).dispose()
        c.mat.dispose()
        this.group.remove(c.core)
        ;(c.core.geometry as THREE.BufferGeometry).dispose()
        c.coreMat.dispose()
        continue
      }
      const env = Math.sin(Math.min(1, t) * Math.PI)
      const scale = c.size * (0.5 + 0.9 * t)
      c.mesh.scale.setScalar(scale)
      c.mat.opacity = 0.5 * env
      c.core.scale.setScalar(scale * 0.5)
      c.coreMat.opacity = 0.82 * env
      survivors.push(c)
    }
    this.clashBursts = survivors
  }

  /** Did the sim drop this bolt because it CONNECTED, versus running out of life
   *  or leaving the stage? The sim emits no despawn reason, so infer it from the
   *  last-seen state: a bolt that still had life and was still on-stage was
   *  consumed by contact; otherwise it expired or flew off. */
  private diedOnContact(l: Live): boolean {
    const nextX = l.lastX + l.lastVx
    const wentOffstage = Math.abs(nextX) > OFFSTAGE_CM
    const expired = l.lastLife - 1 <= 0
    return !wentOffstage && !expired
  }

  private spawn(p: Projectile): Live | null {
    const loaded = this.loaded.get(p.kind)
    if (!loaded) return null
    const tint = energyTint(p.kind)
    // Strength from the sim's authored travel speed: two ion-bolt buttons share
    // one kind + art and differ ONLY in speed, so the renderer reads |vel.x| as
    // heat here (a fast/charged bolt hotter + leaner, a slow "wall" bolt heavier
    // + wider). See ProjectileFx.applyStrength. A super's ramp is 0, so its
    // authored presence is untouched.
    const presence = presenceFor(p.kind, Math.abs(p.vel.x))
    const wpp = WORLD_PER_PX * presence.spriteScale
    const geom = new THREE.PlaneGeometry(1, 1)
    const mat = new THREE.MeshBasicMaterial({
      map: loaded.texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      toneMapped: false, // pass through > 1 so the core survives to the bloom
      side: THREE.DoubleSide, // negative X scale (mirroring) flips winding
      // A per-kind boost drives the bright core over the bloom threshold. A jab
      // stays modest; a super pushes far harder so its core reads as a volume of
      // light rather than a decal. For most kinds this is a NEUTRAL grey multiply
      // (hue-preserving); the super red-suppresses it (see coreQuadTint) because
      // the atlas' bright tip × a grey boost was the last achromatic layer driving
      // the head's shoulder to neutral white under additive stacking.
      color: coreQuadTint(p.kind, presence.coreBoost),
    })
    const mesh = new THREE.Mesh(geom, mat)
    mesh.frustumCulled = false
    mesh.renderOrder = 20 // over fighters (10), under nothing that matters
    this.group.add(mesh)

    // Floor light pool: a wide, soft additive smear on the ground under the bolt.
    const floor = makeGlowMesh(tint, 12)
    const floorMat = floor.material as THREE.MeshBasicMaterial
    this.group.add(floor)

    // Trail blobs, mounted once and reused; laid out along the hot-point history.
    const trail: TrailBlob[] = []
    for (let i = 0; i < TRAIL_SEG; i++) {
      const bm = makeGlowMesh(tint, 14)
      bm.visible = false
      this.group.add(bm)
      trail.push({ mesh: bm, mat: bm.material as THREE.MeshBasicMaterial })
    }

    // Aura: a travelling body of light the sprite rides inside of. Only kinds
    // that ask for it (the super) get one; a bolt leaves this null.
    let aura: THREE.Mesh | null = null
    let auraMat: THREE.MeshBasicMaterial | null = null
    if (presence.aura > 0) {
      aura = makeGlowMesh(tint, 16)
      auraMat = aura.material as THREE.MeshBasicMaterial
      auraMat.opacity = 0
      this.group.add(aura)
    }

    // Core: a small hot center laid over the aura. Additive blending is
    // order-independent, so this simply sums a bright peak into the middle of the
    // volume — the core-contrast the broad aura lacks on a lit stage. Wears
    // `hotTint`: for an ion-bolt a near-white pop, but for the super a BLUE-HOT
    // tint (red suppressed, blue pinned past 1) so the marquee core reads as an
    // ionized electric-blue-white pinpoint instead of the neutral white smudge the
    // old flashTint×coreBoost clipped it to. Drawn on the TIGHT hotCoreTexture
    // (sharp centre) so it reads as a searing point, not one more mushy blob.
    let core: THREE.Mesh | null = null
    let coreMat: THREE.MeshBasicMaterial | null = null
    if (presence.coreGlow > 0) {
      core = makeGlowMesh(hotTint(p.kind), 18, hotCoreTexture())
      coreMat = core.material as THREE.MeshBasicMaterial
      coreMat.opacity = 0
      this.group.add(core)
    }

    // Spawn flash: a hard bright pop pinned to the birth point, announcing a
    // super has started. It stays put while the beam races away, so it reads as
    // the muzzle rather than a light stuck to the projectile.
    const spawnPos = new THREE.Vector3()
    simToWorld({ x: p.pos.x, y: p.pos.y }, spawnPos)
    let spawnFlash: THREE.Mesh | null = null
    let spawnFlashMat: THREE.MeshBasicMaterial | null = null
    if (presence.spawnFlash > 0) {
      spawnFlash = makeGlowMesh(hotTint(p.kind), 30)
      spawnFlashMat = spawnFlash.material as THREE.MeshBasicMaterial
      spawnFlashMat.opacity = 0
      spawnFlash.position.set(spawnPos.x, spawnPos.y, PROJ_Z + 0.02)
      this.group.add(spawnFlash)
    }

    // Beam column: the stretched electric shaft drawn from the muzzle to the head
    // each frame — the caster→target lance. Wears the baked blue-white column
    // texture (its own colour) under a RED-SUPPRESSED tint (see beamTint): the
    // shaft is one of several additive layers stacked here (aura, core, trail,
    // bloom), so a white pass-through tint let their reds sum to a blown-out white
    // spine. The tint pulls the beam's red down and its blue past 1 so the stack
    // stays blue-dominant. Sits over the aura but under the sprite bead + hot
    // core. Only a kind that opts in (the super) builds one.
    let beam: THREE.Mesh | null = null
    let beamMat: THREE.MeshBasicMaterial | null = null
    if (presence.beam > 0) {
      beam = makeGlowMesh(beamTint(), 17, beamColumnTexture())
      beamMat = beam.material as THREE.MeshBasicMaterial
      // Moving crackle carved into the beam's alpha (never added → clip-safe; see
      // beamCrackleTexture). repeat/offset are driven per-frame in place().
      beamMat.alphaMap = beamCrackleTexture()
      beamMat.opacity = 0
      this.group.add(beam)
    }

    // Particulate: a bounded, recycled pool of additive sparks that stream off the
    // shaft so the move earns the word "storm". Fixed size (never grows), each
    // spark re-seeded at the beam when its life runs out — see updateSparks.
    const sparks: Spark[] = []
    if (presence.beam > 0) {
      for (let i = 0; i < SPARK_COUNT; i++) {
        const sm = makeGlowMesh(energyTint(p.kind), 19)
        sm.visible = false
        this.group.add(sm)
        sparks.push({
          mesh: sm, mat: sm.material as THREE.MeshBasicMaterial,
          x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, size: 0, seed: i * 1.618,
        })
      }
    }

    const l: Live = {
      id: p.id,
      kind: p.kind,
      owner: p.owner,
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
      tint,
      trail,
      history: [],
      floor,
      floorMat,
      flash: null,
      flashMat: null,
      aura,
      auraMat,
      core,
      coreMat,
      spawnFlash,
      spawnFlashMat,
      spawnClock: 0,
      spawnPos,
      beam,
      beamMat,
      sparks,
      sparkEmit: 0,
      presence,
      wpp,
      lastX: p.pos.x,
      lastVx: p.vel.x,
      lastLife: p.life,
    }
    this.live.set(p.id, l)
    return l
  }

  /** Position + size the quad so the manifest anchor sits on the world point. */
  private place(l: Live) {
    const m = l.loaded.manifest
    const worldW = m.frameW * l.wpp
    const worldH = m.frameH * l.wpp
    // Mirror art for a left-facing owner: flip on X and mirror the anchor.
    const axEff = l.facing < 0 ? m.frameW - m.anchor.x : m.anchor.x
    l.mesh.scale.set(l.facing < 0 ? -worldW : worldW, worldH, 1)
    // Offset the (centre-pivoted) quad so `anchor` lands on lastWorld. Image y
    // grows downward, world y upward, hence the sign flip on the vertical term.
    l.mesh.position.set(
      l.lastWorld.x + (m.frameW / 2 - axEff) * l.wpp,
      l.lastWorld.y + (m.anchor.y - m.frameH / 2) * l.wpp,
      PROJ_Z,
    )

    // Floor pool tracks the bolt's x, glued to the ground. Footprint + brightness
    // are per-kind: a bolt lays a soft grounding smear, a super floods the floor
    // with a wide reactive light so the stage visibly answers the shot. A small
    // two-octave shimmer on the pool's brightness (phase-offset per bolt id) makes
    // the ground read as reacting to LIVE energy travelling over it rather than a
    // static decal sliding along — the cheap "light interaction with the stage"
    // tell. Kept to ±12% so it flickers as plasma, never strobes.
    const pr = l.presence
    const shimmer = 1 + 0.12 * (0.6 * Math.sin(l.clock * 0.24 + l.id) + 0.4 * Math.sin(l.clock * 0.61 + l.id * 1.7))
    l.floor.position.set(l.lastWorld.x, this.groundY + worldH * 0.05, PROJ_Z - 0.02)
    l.floor.scale.set(worldW * pr.floorScaleX, worldW * pr.floorScaleY, 1)
    l.floorMat.opacity = pr.floorOpacity * shimmer

    // Aura rides the hot-point, wrapping the sprite in a soft body of light so a
    // super reads as a glowing volume rather than a lone cutout.
    if (l.aura && l.auraMat) {
      const s = worldH * pr.aura
      l.aura.position.set(l.lastWorld.x, l.lastWorld.y, PROJ_Z - 0.01)
      l.aura.scale.set(s * 1.25, s, 1)
      l.auraMat.opacity = pr.auraOpacity
    }

    // Core rides the same hot-point, scaled small and wide so it reads as a
    // searing lance center rather than a round dot. Drawn just in front of the
    // aura (order among additive layers is irrelevant to the summed colour).
    if (l.core && l.coreMat) {
      const c = worldH * pr.coreGlow
      l.core.position.set(l.lastWorld.x, l.lastWorld.y, PROJ_Z - 0.005)
      l.core.scale.set(c * 1.5, c * 0.72, 1)
      l.coreMat.opacity = pr.coreGlowOpacity
    }

    // Beam column: the electric shaft from the muzzle to the current head. As the
    // head races out the shaft lengthens, so it reads as a lance thrust from the
    // caster toward the target rather than a bead floating in the gap. Rotated to
    // the muzzle→head axis; thickness a fraction of the sprite height with a fast
    // flicker so it crackles as live discharge, not a static bar.
    if (l.beam && l.beamMat) {
      const dx = l.lastWorld.x - l.spawnPos.x
      const dy = l.lastWorld.y - l.spawnPos.y
      const len = Math.hypot(dx, dy)
      const angle = Math.atan2(dy, dx)
      // Overhang a touch past the head so the leading edge caps the bead, and hold
      // a minimum so a just-born beam still shows a stub rather than nothing.
      const shaftLen = Math.max(worldH * 0.6, len + worldH * 0.4)
      const thick = worldH * (0.5 + 0.09 * Math.sin(l.clock * 0.9 + l.id))
      l.beam.position.set(
        (l.spawnPos.x + l.lastWorld.x) / 2,
        (l.spawnPos.y + l.lastWorld.y) / 2,
        PROJ_Z - 0.008,
      )
      l.beam.rotation.z = angle
      l.beam.scale.set(shaftLen, thick, 1)
      // Scroll the crackle alphaMap muzzle→head; repeat keeps ~one tile per
      // BEAM_CRACKLE_PERIOD world units so node density is length-invariant. This
      // moving spatial structure now carries the "live discharge" read, so the old
      // global opacity flicker is dialled back (0.86±0.14 → 0.93±0.07): it no
      // longer has to fake crackle by pulsing the whole bar, and its shallower dip
      // keeps the beam from compounding dim with the crackle's gaps.
      const am = l.beamMat.alphaMap
      if (am) {
        am.repeat.x = shaftLen / BEAM_CRACKLE_PERIOD
        am.offset.x = beamCrackleScroll(l.clock)
      }
      const flicker = 0.93 + 0.07 * Math.sin(l.clock * 1.7 + l.id * 2.3)
      l.beamMat.opacity = pr.beam * 0.92 * flicker
    }
  }

  /** Push the current hot-point onto the trail history and lay the blobs out
   *  along it with a size + brightness taper. `extend` is false once detached,
   *  so the trail stops growing and only fades. */
  private pushTrail(l: Live, extend: boolean) {
    if (extend) {
      l.history.unshift(l.lastWorld.clone())
      if (l.history.length > TRAIL_SEG + 1) l.history.pop()
    }
    const worldH = l.loaded.manifest.frameH * l.wpp
    const pr = l.presence
    const head = worldH * 0.62
    for (let i = 0; i < l.trail.length; i++) {
      const h = l.history[i + 1]
      const b = l.trail[i]
      if (!h) {
        b.mesh.visible = false
        continue
      }
      const f = 1 - i / TRAIL_SEG
      const size = Math.max(0.12, head * (0.85 * f + 0.15)) * pr.trailSize
      b.mesh.visible = true
      b.mesh.position.set(h.x, h.y, PROJ_Z - 0.005 * (i + 1))
      // Stretched along travel so the blobs blur into a streak, not a bead chain.
      b.mesh.scale.set(size * 1.4, size * 0.82, 1)
      b.mat.opacity = pr.trailOpacity * f
    }
  }

  /** Fade the trail + floor pool (+ aura, if any) toward `k` (0..1 of full). */
  private dimAux(l: Live, k: number) {
    const pr = l.presence
    for (let i = 0; i < l.trail.length; i++) {
      const f = 1 - i / TRAIL_SEG
      l.trail[i].mat.opacity = pr.trailOpacity * f * k
    }
    l.floorMat.opacity = pr.floorOpacity * k
    if (l.auraMat) l.auraMat.opacity = pr.auraOpacity * k
    if (l.coreMat) l.coreMat.opacity = pr.coreGlowOpacity * k
    // place() has already set the beam column to its live opacity this frame;
    // scale that down so the shaft bleeds off with the rest of the death.
    if (l.beamMat) l.beamMat.opacity *= k
  }

  /** Advance the beam's bounded spark pool one frame. While `emit` (the beam is
   *  live) every dead spark is immediately re-seeded on the shaft, so the pool
   *  stays saturated and the move reads as a storm; once the beam detaches `emit`
   *  is false and the pool drains as each spark lives out its last flight, so the
   *  particulate trails off rather than vanishing with the beam. Fixed-size and
   *  recycled — no per-frame allocation, no unbounded growth. */
  private updateSparks(l: Live, ticks: number, emit: boolean) {
    if (!l.sparks.length) return
    const worldH = l.loaded.manifest.frameH * l.wpp
    const dx = l.lastWorld.x - l.spawnPos.x
    const dy = l.lastWorld.y - l.spawnPos.y
    const len = Math.hypot(dx, dy) || 1
    const dirx = dx / len, diry = dy / len
    const perpx = -diry, perpy = dirx
    for (const s of l.sparks) {
      if (s.life <= 0) {
        if (!emit) { s.mesh.visible = false; continue }
        // Re-seed on the shaft, biased toward the hot head, thrown outward.
        const t = 0.25 + 0.75 * Math.random()
        const off = (Math.random() - 0.5) * worldH * 0.7
        s.x = l.spawnPos.x + dirx * len * t + perpx * off
        s.y = l.spawnPos.y + diry * len * t + perpy * off
        const outward = (Math.random() < 0.5 ? -1 : 1) * (0.03 + Math.random() * 0.09)
        const back = -(0.005 + Math.random() * 0.03) // drift back off the head
        s.vx = perpx * outward + dirx * back + (Math.random() - 0.5) * 0.02
        s.vy = perpy * outward + diry * back + (Math.random() - 0.5) * 0.02 + 0.012
        s.maxLife = 9 + Math.random() * 12
        s.life = s.maxLife
        s.size = worldH * (0.1 + Math.random() * 0.14)
      }
      s.life -= ticks
      s.x += s.vx * ticks
      s.y += s.vy * ticks
      s.vy -= 0.0016 * ticks // a little gravity so the sparks arc as they fall away
      const f = Math.max(0, s.life / s.maxLife)
      const sz = s.size * (0.5 + 0.5 * f)
      s.mesh.visible = f > 0
      s.mesh.position.set(s.x, s.y, PROJ_Z - 0.006)
      s.mesh.scale.set(sz, sz, 1)
      // Flicker each spark so the field twinkles as discharge rather than drifting embers.
      s.mat.opacity = f * (0.55 + 0.45 * Math.abs(Math.sin(l.clock * 2.1 + s.seed))) * 0.9
    }
  }

  /** Drive the fixed spawn flash on its own short clock: a hard bright pop that
   *  snaps to full almost instantly, then collapses and fades over
   *  `spawnFlashTicks`. Runs independently of the beam's phase clock so the flash
   *  lives and dies at the muzzle while the beam races away, then disposes itself.
   *  A no-op for kinds without a spawn flash. */
  private tickSpawnFlash(l: Live, ticks: number) {
    if (!l.spawnFlash || !l.spawnFlashMat) return
    l.spawnClock += ticks
    const pr = l.presence
    const dur = Math.max(1, pr.spawnFlashTicks)
    const t = Math.min(1, l.spawnClock / dur)
    // Fast attack over the first ~20% to full size, then bleed out while easing
    // down — a punch, not a swell.
    const grow = t < 0.2 ? t / 0.2 : 1
    const worldH = l.loaded.manifest.frameH * l.wpp
    const s = worldH * pr.spawnFlash * (0.5 + 0.5 * grow) * (1 - 0.25 * t)
    l.spawnFlash.position.set(l.spawnPos.x, l.spawnPos.y, PROJ_Z + 0.02)
    l.spawnFlash.scale.set(s, s, 1)
    l.spawnFlashMat.opacity = pr.spawnFlashOpacity * Math.pow(1 - t, 1.4)
    if (t >= 1) {
      this.group.remove(l.spawnFlash)
      ;(l.spawnFlash.geometry as THREE.BufferGeometry).dispose()
      l.spawnFlashMat.dispose()
      l.spawnFlash = null
      l.spawnFlashMat = null
    }
  }

  /** Lazily build the two camera-space quads the super atmosphere needs: a cool
   *  normal-blended dim slid behind the fighters (renderOrder 8, between the
   *  stage's top at 5 and the fighters at 10) and a hard additive flash over
   *  everything (renderOrder 30). Both bill-board to fill the frustum each frame. */
  private ensureSuperQuads() {
    if (this.worldDimMesh) return
    // World-dim: a flat, cool near-neutral. Normal-blended (NOT additive) so it
    // pulls every background hue toward this grey-blue — darken AND desaturate in
    // one op, which is what a lot of 2D fighters do instead of a true HSV pass.
    // depthTest off + renderOrder 8 wash the whole stage yet sit UNDER the
    // fighters (10) and the beam/trail/pool (12+), so only the world recedes.
    const dimGeo = new THREE.PlaneGeometry(1, 1)
    const dimMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x151824),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    })
    const dim = new THREE.Mesh(dimGeo, dimMat)
    dim.frustumCulled = false
    dim.renderOrder = 8
    dim.visible = false
    this.group.add(dim)
    this.worldDimMesh = dim
    this.worldDimMat = dimMat

    // Activation flash: the shared soft-glow disc blown up past the frustum so
    // the screen samples its bright interior — a hard, bloom-fed burst of light
    // rather than a flat filter. Additive + un-tone-mapped so it whites out hot.
    const flash = makeGlowMesh(this.flashColor, 30)
    flash.visible = false
    this.group.add(flash)
    this.superFlashMesh = flash
    this.superFlashMat = flash.material as THREE.MeshBasicMaterial
  }

  /** Place a bill-boarded full-screen quad a fixed distance in front of the
   *  camera, sized to cover the frustum times `cover`. Recomputed each frame so
   *  it survives the camera's dolly-zoom and any fov change on resize. */
  private fillFrustum(mesh: THREE.Mesh, cover: number) {
    const cam = this.camera!
    const D = Math.min(cam.far * 0.5, Math.max(cam.near * 2 + 0.05, 4))
    const h = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * D
    const w = h * cam.aspect
    this.tmpFwd.set(0, 0, -1).applyQuaternion(cam.quaternion)
    mesh.position.copy(cam.position).addScaledVector(this.tmpFwd, D)
    mesh.quaternion.copy(cam.quaternion)
    mesh.scale.set(w * cover, h * cover, 1)
  }

  /**
   * The super's screen-wide beats, done entirely inside this additive layer: a
   * world-dim that drops the stage back and a hard activation flash.
   *
   * Freeze-safety is by construction, now driven by the sim's AUTHORITATIVE
   * freeze countdown (`superState.freeze`) rather than inferred from a live bolt.
   * The old design read the dim target from the strongest `presence.worldDim`
   * among sim-owned bolts — but the super BEAM does not exist during the freeze
   * (it spawns on the first resumed frame), so across the entire held beat the
   * target was 0 and the world never dropped back. The dead back half followed
   * directly: an undimmed, fully-lit stage behind a static wind-up pose. Now the
   * freeze itself pins `dimTarget` to `SUPER.DIM_PEAK` for its whole length, and
   * that peak MATCHES the beam's own `worldDim` so the hand-off from freeze-dim
   * to travelling-beam-dim is seamless. The activation flash fires once, on the
   * rising edge of the freeze, and decays on render time so it clears to reveal
   * the charge rather than holding a white-out (the TASK-3 rule).
   */
  private updateSuperAtmosphere(
    cur: Projectile[] | undefined,
    ticks: number,
    superState: SuperFreezeView | null,
  ) {
    if (!this.camera) return

    // Target read from state: the strongest worldDim among sim-owned bolts, and
    // a one-shot flash the frame a new flash-carrying (super) bolt is born.
    let dimTarget = 0
    let flashPunch = 0
    const superIds = new Set<number>()
    if (cur) {
      for (const p of cur) {
        const l = this.live.get(p.id)
        const pr = l ? l.presence : presenceFor(p.kind)
        if (pr.worldDim > dimTarget) dimTarget = pr.worldDim
        if (pr.screenFlash > 0) {
          superIds.add(p.id)
          if (!this.superSeen.has(p.id)) {
            if (pr.screenFlash > flashPunch) flashPunch = pr.screenFlash
            this.flashColor.copy(hotTint(p.kind))
          }
        }
      }
    }
    this.superSeen = superIds

    // The freeze holds the world back for its FULL length: pin the dim to its
    // peak while frozen so the back half is no longer a lit, static stage. This
    // is the max() with any live-beam dim, so nothing regresses when the beam
    // later carries the same value on its own.
    const freeze = superState?.freeze ?? 0
    if (freeze > 0 && SUPER.DIM_PEAK > dimTarget) dimTarget = SUPER.DIM_PEAK

    // Activation flash on the freeze's RISING edge (0 → FREEZE_FRAMES): the one
    // frame the world stops. Fires from the beam's own flash tint so the freeze
    // burst and the eventual beam birth read as the same weapon lighting up.
    // Kept DELIBERATELY MODEST (0.5, not the beam-birth 0.9): the world-dim, the
    // FightVfx chest burst and the igniting charge already carry the activation,
    // so a full-strength screen flash here just ghosts the owner into the white —
    // the exact "blow out the frame" failure the house has fought for 21 rounds.
    if (freeze > this.prevFreeze && this.prevFreeze === 0) {
      flashPunch = Math.max(flashPunch, 0.5)
      this.flashColor.copy(hotTint('super-beam'))
    }
    this.prevFreeze = freeze

    // Nothing showing, nothing fading out, and never built: bail before touching
    // anything so an all-ion-bolt match pays exactly zero cost.
    if (
      dimTarget === 0 &&
      flashPunch === 0 &&
      this.dimCur < 0.002 &&
      this.flashCur < 0.002 &&
      !this.worldDimMesh
    ) {
      return
    }
    this.ensureSuperQuads()

    // Ease the dim: fast in (~a handful of frames), slow out, so the world drops
    // back hard on activation and returns gently as the impact resolves.
    const rate = dimTarget > this.dimCur ? 0.32 : 0.11
    this.dimCur += (dimTarget - this.dimCur) * Math.min(1, rate * ticks)

    // Flash: punch to a newly-born super's peak, hold a few render frames so it
    // lands as a beat, then decay on render time (a freeze clears it to the pose).
    if (flashPunch > this.flashCur) {
      this.flashCur = flashPunch
      this.flashHold = 3
    } else if (this.flashHold > 0) {
      this.flashHold = Math.max(0, this.flashHold - ticks)
    } else {
      this.flashCur = Math.max(0, this.flashCur - 0.09 * ticks)
    }

    const dm = this.worldDimMesh!
    if (this.dimCur > 0.002) {
      this.fillFrustum(dm, 1.2)
      this.worldDimMat!.opacity = this.dimCur
      dm.visible = true
    } else {
      dm.visible = false
    }

    const fm = this.superFlashMesh!
    if (this.flashCur > 0.002) {
      this.fillFrustum(fm, 3.1) // blown up so the screen sits in the hot interior
      this.superFlashMat!.color.copy(this.flashColor)
      this.superFlashMat!.opacity = this.flashCur
      fm.visible = true
    } else {
      fm.visible = false
    }
  }

  /** Build the owner-anchored charge rig once: a broad energy aura + a hot near-
   *  white core (both drawn BEHIND the fighter so the halo frames the body), two
   *  expanding energy pulses, and a ring of inward-spiralling gather motes drawn
   *  just in front. Lazy so a match with no warden super never allocates it. */
  private ensureSuperCharge() {
    if (this.chargeGroup) return
    this.chargeEnergy.copy(energyTint('super-beam'))
    this.chargeWhite.copy(flashTint('super-beam'))

    const g = new THREE.Group()
    g.name = 'super-charge'
    g.visible = false

    // renderOrder 9: after the world-dim (8), before the fighters (10) — the
    // aura/core/pulses read as light gathering behind the owner, never a wash
    // over the face. This is the TASK-3 "frame, don't erase" rule by geometry.
    const aura = makeGlowMesh(this.chargeEnergy, 9)
    aura.visible = false
    g.add(aura)
    this.chargeAura = aura
    this.chargeAuraMat = aura.material as THREE.MeshBasicMaterial

    const core = makeGlowMesh(this.chargeWhite, 9)
    core.visible = false
    g.add(core)
    this.chargeCore = core
    this.chargeCoreMat = core.material as THREE.MeshBasicMaterial

    for (let i = 0; i < 2; i++) {
      const pulse = makeGlowMesh(this.chargeEnergy, 9)
      pulse.visible = false
      g.add(pulse)
      this.chargeRings.push(pulse)
      this.chargeRingMats.push(pulse.material as THREE.MeshBasicMaterial)
    }

    // Motes at renderOrder 11 (just IN FRONT of the fighter) so the "power being
    // pulled in" reads, but small and faded as they converge so 7 additive
    // points can't stack into a hot blob over the chest.
    for (let i = 0; i < SUPER.MOTES; i++) {
      const mote = makeGlowMesh(this.chargeEnergy, 11)
      mote.visible = false
      g.add(mote)
      this.chargeMotes.push(mote)
      this.chargeMoteMats.push(mote.material as THREE.MeshBasicMaterial)
      this.chargeMoteAngles.push((i / SUPER.MOTES) * Math.PI * 2)
    }

    this.group.add(g)
    this.chargeGroup = g
  }

  /**
   * The owner-anchored super charge — the fix for the dead back half. The freeze
   * holds the world for its FULL `SUPER_FREEZE_FRAMES`, but the owner only has a
   * ~6-frame wind-up clip and then a static hold, so from roughly the midpoint on
   * nothing on screen moved. This gathers a hot core + halo at the owner's chest
   * that IGNITES on activation and visibly GROWS across the whole beat, with
   * expanding pulses and inward-spiralling motes guaranteeing motion on EVERY
   * held frame (the one thing a still can't prove and the baseline filmstrip
   * proved was missing). All timing is a FRACTION of the freeze, so it rescales
   * the instant the sim retunes the constant — the freeze and the VFX are one
   * parameter, never two that can drift into the mirrored-desync failure.
   *
   * Runs on the UNSCALED render delta: sim time is pinned at ~0 during the freeze
   * (Engine multiplies dt by the hitstop timeScale), so a sim-time clock would
   * itself freeze and rebuild the very defect this removes.
   */
  private updateSuperCharge(superState: SuperFreezeView | null, ticks: number) {
    const active = !!superState && superState.freeze > 0

    if (active) {
      // Gather progress across the held freeze, 0 at the first frozen frame → ~1
      // at the last. Anticipation ignites fast, then a long steady BUILD carries
      // the back half, then a brief peak/compress hand-off to the beam launch.
      const t = THREE.MathUtils.clamp(1 - superState!.freeze / SUPER_FREEZE_FRAMES, 0, 1)
      let env: number
      if (t < 0.12) env = THREE.MathUtils.smoothstep(t, 0, 0.12) * 0.55
      else if (t < 0.82) env = 0.55 + THREE.MathUtils.smoothstep(t, 0.12, 0.82) * 0.45
      else env = 1
      this.chargeCur = env
      this.chargeProg = t
      this.chargePos.copy(superState!.ownerPos)
      this.chargeFacing = superState!.facing
      if (!this.chargePrevActive) this.chargeClock = 0
    } else {
      // Release: flare down on render time; the beam's spawnFlash (born on the
      // first resumed frame) covers the hand-off so this reads as a launch, not
      // a cut. chargeProg holds, so the motes stay gathered as it fades.
      this.chargeCur = Math.max(0, this.chargeCur - 0.16 * ticks)
    }
    this.chargePrevActive = active

    if (this.chargeCur < 0.002 && !this.chargeGroup) return
    this.ensureSuperCharge()
    const g = this.chargeGroup!
    if (this.chargeCur < 0.002) {
      g.visible = false
      return
    }
    g.visible = true
    this.chargeClock += ticks

    const c = this.chargeCur
    const prog = this.chargeProg
    const clk = this.chargeClock
    // Gather in front of the torso (toward the palms), a torso-scaled distance
    // ahead so it belongs to the owner without drifting off-body.
    const cx = this.chargePos.x + this.chargeFacing * 0.4
    const cy = this.chargePos.y
    const cz = SUPER.Z
    const breathe = 1 + 0.1 * Math.sin(clk * 0.5)

    // Aura: broad energy halo that grows with the build and breathes.
    const auraD = THREE.MathUtils.lerp(1.6, 2.9, prog) * breathe
    this.chargeAura!.position.set(cx, cy, cz)
    this.chargeAura!.scale.set(auraD, auraD, 1)
    this.chargeAuraMat!.opacity = 0.42 * c
    this.chargeAura!.visible = true

    // Core: hot near-white centre that brightens as it builds and INHALES
    // (compresses) into the launch — the classic "wind the weapon" tell.
    const compress = 1 - THREE.MathUtils.smoothstep(prog, 0.82, 1) * 0.28
    const coreD = THREE.MathUtils.lerp(0.7, 1.3, prog) * breathe * compress
    this.chargeCore!.position.set(cx, cy, cz)
    this.chargeCore!.scale.set(coreD, coreD, 1)
    this.chargeCoreMat!.opacity = (0.5 + 0.38 * prog) * c
    this.chargeCore!.visible = true

    // Two energy pulses, half a cycle apart, so a shell is always mid-flight —
    // the per-frame motion guarantee that a filmstrip (not a still) checks.
    const period = 15
    for (let i = 0; i < this.chargeRings.length; i++) {
      const phase = ((clk / period) + i * 0.5) % 1
      const d = THREE.MathUtils.lerp(0.8, 3.6, phase)
      const m = this.chargeRings[i]
      const mat = this.chargeRingMats[i]
      m.position.set(cx, cy, cz)
      m.scale.set(d, d, 1)
      mat.opacity = Math.pow(1 - phase, 1.3) * 0.34 * c
      m.visible = mat.opacity > 0.004
    }

    // Motes: spiral inward and gather into the core, fading as they merge so the
    // convergence point never stacks into a blowout.
    const rad = THREE.MathUtils.lerp(1.95, 0.12, Math.pow(prog, 0.85))
    const moteSz = 0.3 * (0.7 + 0.3 * prog)
    for (let i = 0; i < this.chargeMotes.length; i++) {
      const ang = this.chargeMoteAngles[i] - clk * 0.14
      const wob = 0.9 + 0.1 * Math.sin(clk * 0.7 + i)
      const mx = cx + Math.cos(ang) * rad * wob
      const my = cy + Math.sin(ang) * rad * wob * 0.85
      const m = this.chargeMotes[i]
      const mat = this.chargeMoteMats[i]
      m.position.set(mx, my, SUPER.Z)
      m.scale.set(moteSz, moteSz, 1)
      mat.opacity = 0.55 * c * (1 - 0.7 * prog)
      m.visible = mat.opacity > 0.004
    }
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

  /** Play out a detached bolt's death. Impact runs the bright impact clip and an
   *  expanding flash while the trail retracts; fizzle just softly dissipates the
   *  last travel frame. Returns true when the death is finished. */
  private animateOut(l: Live, ticks: number): boolean {
    l.clock += ticks
    if (l.phase === 'impact') {
      const clip = l.loaded.manifest.clips.impact
      const total = clipTotal(clip)
      const { idx, done } = frameAt(clip, l.clock)
      if (idx !== l.curFrame) {
        l.curFrame = idx
        this.blit(l, idx)
      }
      const t = total > 0 ? Math.min(1, l.clock / total) : 1
      this.dimAux(l, 1 - t) // trail + pool + aura bleed off as the burst takes over
      if (l.flash && l.flashMat) {
        const worldH = l.loaded.manifest.frameH * l.wpp
        // impactScale makes a super's contact a visibly bigger event than a jab's;
        // impactOpacity lets it punch to full white where a bolt stays softer.
        const s = worldH * (0.8 + 2.2 * t) * l.presence.impactScale
        l.flash.position.set(l.lastWorld.x, l.lastWorld.y, PROJ_Z + 0.01)
        l.flash.scale.set(s, s, 1)
        l.flashMat.opacity = Math.max(0, 1 - t) * l.presence.impactOpacity
      }
      return done
    }
    // fizzle: hold the last travel frame and dissolve it.
    const t = Math.min(1, l.clock / FIZZLE_TICKS)
    l.mat.opacity = 1 - t
    const worldW = l.loaded.manifest.frameW * l.wpp
    const worldH = l.loaded.manifest.frameH * l.wpp
    const grow = 1 + 0.25 * t
    l.mesh.scale.set((l.facing < 0 ? -worldW : worldW) * grow, worldH * grow, 1)
    this.dimAux(l, 1 - t)
    return t >= 1
  }

  private spawnFlash(l: Live) {
    const mesh = makeGlowMesh(l.tint, 22)
    mesh.renderOrder = 22
    this.group.add(mesh)
    l.flash = mesh
    l.flashMat = mesh.material as THREE.MeshBasicMaterial
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
    this.group.remove(l.floor)
    ;(l.floor.geometry as THREE.BufferGeometry).dispose()
    l.floorMat.dispose()
    for (const b of l.trail) {
      this.group.remove(b.mesh)
      ;(b.mesh.geometry as THREE.BufferGeometry).dispose()
      b.mat.dispose()
    }
    if (l.flash) {
      this.group.remove(l.flash)
      ;(l.flash.geometry as THREE.BufferGeometry).dispose()
      l.flashMat?.dispose()
    }
    if (l.aura) {
      this.group.remove(l.aura)
      ;(l.aura.geometry as THREE.BufferGeometry).dispose()
      l.auraMat?.dispose()
    }
    if (l.core) {
      this.group.remove(l.core)
      ;(l.core.geometry as THREE.BufferGeometry).dispose()
      l.coreMat?.dispose()
    }
    if (l.spawnFlash) {
      this.group.remove(l.spawnFlash)
      ;(l.spawnFlash.geometry as THREE.BufferGeometry).dispose()
      l.spawnFlashMat?.dispose()
    }
    this.disposeBeamExtras(l)
    this.live.delete(l.id)
  }

  /** Remove + dispose the beam column and every spark in the pool. Shared by the
   *  per-beam retire and the whole-layer dispose so a beam's extra meshes never
   *  leak on either path. */
  private disposeBeamExtras(l: Live) {
    if (l.beam) {
      this.group.remove(l.beam)
      ;(l.beam.geometry as THREE.BufferGeometry).dispose()
      l.beamMat?.dispose()
      l.beam = null
      l.beamMat = null
    }
    for (const s of l.sparks) {
      this.group.remove(s.mesh)
      ;(s.mesh.geometry as THREE.BufferGeometry).dispose()
      s.mat.dispose()
    }
    l.sparks = []
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
      this.group.remove(l.floor)
      ;(l.floor.geometry as THREE.BufferGeometry).dispose()
      l.floorMat.dispose()
      for (const b of l.trail) {
        this.group.remove(b.mesh)
        ;(b.mesh.geometry as THREE.BufferGeometry).dispose()
        b.mat.dispose()
      }
      if (l.flash) {
        this.group.remove(l.flash)
        ;(l.flash.geometry as THREE.BufferGeometry).dispose()
        l.flashMat?.dispose()
      }
      if (l.aura) {
        this.group.remove(l.aura)
        ;(l.aura.geometry as THREE.BufferGeometry).dispose()
        l.auraMat?.dispose()
      }
      if (l.core) {
        this.group.remove(l.core)
        ;(l.core.geometry as THREE.BufferGeometry).dispose()
        l.coreMat?.dispose()
      }
      if (l.spawnFlash) {
        this.group.remove(l.spawnFlash)
        ;(l.spawnFlash.geometry as THREE.BufferGeometry).dispose()
        l.spawnFlashMat?.dispose()
      }
      this.disposeBeamExtras(l)
    }
    this.live.clear()
    for (const c of this.clashBursts) {
      this.group.remove(c.mesh)
      ;(c.mesh.geometry as THREE.BufferGeometry).dispose()
      c.mat.dispose()
      this.group.remove(c.core)
      ;(c.core.geometry as THREE.BufferGeometry).dispose()
      c.coreMat.dispose()
    }
    this.clashBursts = []
    this.clashedPairs.clear()
    this.disposeSuperQuads()
    this.disposeSuperCharge()
    for (const res of this.loaded.values()) res.texture.dispose()
    this.loaded.clear()
  }

  /** Tear down the shared super-atmosphere quads (if they were ever built). */
  private disposeSuperQuads() {
    if (this.worldDimMesh) {
      this.group.remove(this.worldDimMesh)
      ;(this.worldDimMesh.geometry as THREE.BufferGeometry).dispose()
      this.worldDimMat?.dispose()
      this.worldDimMesh = null
      this.worldDimMat = null
    }
    if (this.superFlashMesh) {
      this.group.remove(this.superFlashMesh)
      ;(this.superFlashMesh.geometry as THREE.BufferGeometry).dispose()
      this.superFlashMat?.dispose()
      this.superFlashMesh = null
      this.superFlashMat = null
    }
  }

  /** Tear down the owner-anchored super-charge rig (if it was ever built). */
  private disposeSuperCharge() {
    if (!this.chargeGroup) return
    const meshes: Array<THREE.Mesh | null> = [
      this.chargeAura,
      this.chargeCore,
      ...this.chargeRings,
      ...this.chargeMotes,
    ]
    for (const m of meshes) {
      if (!m) continue
      ;(m.geometry as THREE.BufferGeometry).dispose()
      ;(m.material as THREE.Material).dispose()
    }
    this.group.remove(this.chargeGroup)
    this.chargeGroup = null
    this.chargeAura = null
    this.chargeAuraMat = null
    this.chargeCore = null
    this.chargeCoreMat = null
    this.chargeRings = []
    this.chargeRingMats = []
    this.chargeMotes = []
    this.chargeMoteMats = []
    this.chargeMoteAngles = []
  }
}

/** Total ticks a clip runs (sum of per-frame durations). */
function clipTotal(clip: ProjectileClip): number {
  let total = 0
  for (const d of clip.durations) total += d
  return total
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
