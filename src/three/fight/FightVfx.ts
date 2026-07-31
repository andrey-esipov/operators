import * as THREE from 'three'
import type { FightEvent, HitLevel, Vec2 } from '../../fight/types'
import type { ParticlePool } from '../vfx/ParticlePool'
import type { Shockwave } from '../vfx/Shockwave'
import type { ImpactFlash } from '../vfx/ImpactFlash'
import type { Fighter } from './Fighter'
import type { FightCamera } from './FightCamera'
import { CM_TO_WORLD, simToWorld } from './worldScale'
import { WORLD } from '../types'

/**
 * Translates simulation events into impact VFX.
 *
 * The one rule that matters: effects fire on the reported contact point
 * (`event.at`), not on a fighter's centre. A spark that blooms from the middle
 * of a torso instead of the fist that landed there is the difference between a
 * hit that connects and one that looks like two sprites overlapping. Every
 * spawn here converts `event.at` (sim cm) to world space and emits there.
 *
 * Particle and shockwave primitives are reused wholesale from src/three/vfx;
 * this class only decides what to throw, how much, and where.
 */

interface HitTuning {
  count: number
  speed: number
  size: number
  hitstopMs: number
  hitstopScale: number
  shake: number
  push: number
  core: number
  /** Peak of the victim's white impact strobe, 0..1, scaled with hit weight. */
  flash: number
  /** Strength fed to PostPipeline.impactPunch — how hard this weight charges the
   *  reactive screen grade (bloom + chromatic + contrast + grain + anamorphic).
   *  Ascends with the hitstop ladder so a jab ticks the grade and a crumple
   *  slams it. See the punchPost call in hit(). */
  post: number
  /** Warmth bias of that grade, -1..1. Strikes run warm (orange); the launcher
   *  runs cool (the blue pop) mirroring its blue impact mark. */
  warm: number
  hot: THREE.Color
  cool: THREE.Color
}

const HIT: Record<HitLevel, HitTuning> = {
  light:   { count: 26, speed: 7,  size: 0.13, hitstopMs: 60,  hitstopScale: 0.14, shake: 0.10, push: 0.15, core: 1.0, flash: 0.55, post: 0.30, warm: 0.20, hot: new THREE.Color(0xffffff), cool: new THREE.Color(0xffd27a) },
  medium:  { count: 40, speed: 9,  size: 0.16, hitstopMs: 90,  hitstopScale: 0.09, shake: 0.16, push: 0.28, core: 1.3, flash: 0.72, post: 0.36, warm: 0.20, hot: new THREE.Color(0xffffff), cool: new THREE.Color(0xffb04a) },
  heavy:   { count: 64, speed: 12, size: 0.20, hitstopMs: 130, hitstopScale: 0.05, shake: 0.26, push: 0.5,  core: 1.7, flash: 0.9,  post: 0.44, warm: 0.35, hot: new THREE.Color(0xfff4e0), cool: new THREE.Color(0xff7a2a) },
  launcher:{ count: 72, speed: 13, size: 0.22, hitstopMs: 140, hitstopScale: 0.05, shake: 0.30, push: 0.6,  core: 1.8, flash: 1.0,  post: 0.46, warm: -0.60, hot: new THREE.Color(0xffffff), cool: new THREE.Color(0x8ad2ff) },
  sweep:   { count: 50, speed: 11, size: 0.19, hitstopMs: 110, hitstopScale: 0.06, shake: 0.22, push: 0.4,  core: 1.5, flash: 0.82, post: 0.40, warm: 0.30, hot: new THREE.Color(0xfff0dd), cool: new THREE.Color(0xffa030) },
  crumple: { count: 84, speed: 14, size: 0.24, hitstopMs: 170, hitstopScale: 0.03, shake: 0.36, push: 0.7,  core: 2.0, flash: 1.0,  post: 0.52, warm: 0.45, hot: new THREE.Color(0xffffff), cool: new THREE.Color(0xff5a3c) },
}

/**
 * The bold impact-frame mark, per weight — the one deliberate drawn graphic that
 * lands on top of the particle burst. See ImpactFlash for the "why".
 *
 * `mark` indexes public/impact/sparks (0 star4, 1 burst6, 2 impact8, 3 slash,
 * 4 shatter). `size` is the quad's world width; FIGHTER_HEIGHT is 3.4 world
 * units, so light 0.95 ≈ 28% of a body and crumple 2.15 ≈ 63% — deliberately an
 * order of magnitude larger than a single spark particle (~0.13–0.24), which is
 * the whole point: a jab and a heavy must not stamp the same mark.
 *
 * `tint` is CHANNEL-WEIGHTED and may exceed 1 on one axis while another is
 * suppressed — the Ion Storm lesson (commit 12c4d0b). The sheet is white, so the
 * tint owns the hue: hits push RED past 1 and pin BLUE low, so additive+bloom
 * saturate them oranger; the launcher pushes BLUE past 1 and suppresses RED so
 * it saturates bluer. Neither drives all three channels past 1, which is what
 * made the old super read as an identity-less white orb.
 *
 * `life` is short — 0.07–0.12s, ~4–7 frames — and it runs on the scaled sim
 * delta, so it is HELD through hitstop and released just after. `spin` is a base
 * in-plane tilt (the slash sits diagonal, like a cut).
 */
interface ImpactTuning {
  mark: number
  size: number
  life: number
  tint: THREE.Color
  intensity: number
  spin: number
}

/** Build a tint with channels assigned straight to r/g/b so deliberate >1
 *  values survive (the numeric path skips the sRGB→linear conversion that the
 *  hex constructor applies, which would otherwise clamp our HDR channels). */
function mkTint(r: number, g: number, b: number): THREE.Color {
  const c = new THREE.Color()
  c.r = r
  c.g = g
  c.b = b
  return c
}

/** Deterministic hash of a contact point → [-1, 1). Used to jitter the impact
 *  mark's rotation so repeated hits vary WITHOUT introducing Math.random (which
 *  would break the seeded, reload-stable renders the screenshot diffs rely on). */
function hash2(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return (s - Math.floor(s)) * 2 - 1
}

const IMPACT: Record<HitLevel, ImpactTuning> = {
  light:    { mark: 0, size: 0.95, life: 0.07, tint: mkTint(1.55, 0.92, 0.40), intensity: 1.5, spin: 0.0 },
  medium:   { mark: 1, size: 1.25, life: 0.08, tint: mkTint(1.70, 0.80, 0.34), intensity: 1.7, spin: 0.0 },
  heavy:    { mark: 2, size: 1.85, life: 0.10, tint: mkTint(1.90, 0.66, 0.26), intensity: 2.0, spin: 0.0 },
  launcher: { mark: 4, size: 2.05, life: 0.11, tint: mkTint(0.50, 0.95, 1.90), intensity: 2.1, spin: 0.0 },
  sweep:    { mark: 3, size: 1.55, life: 0.09, tint: mkTint(1.80, 0.72, 0.30), intensity: 1.8, spin: -0.5 },
  crumple:  { mark: 2, size: 2.15, life: 0.12, tint: mkTint(2.10, 0.52, 0.22), intensity: 2.2, spin: 0.0 },
}

export interface FightVfxDeps {
  additive: ParticlePool
  alpha: ParticlePool
  shockwave: Shockwave
  impact: ImpactFlash
  fighters: [Fighter, Fighter]
  camera: FightCamera
  /** Bridge to the engine's impact freeze. */
  requestHitstop: (ms: number, scale: number) => void
  /** Emit a translated card-game event so the reused LightRig flash + floor
   *  impact + engine hitstop curve all fire from one place. */
  emitEngine?: (attacker: 0 | 1, target: 0 | 1, level: HitLevel, power: number, kind: 'hit' | 'ko') => void
  /** Charge the reactive post grade (bloom + chromatic + contrast + grain +
   *  anamorphic) on a hit. This is the shipped-route path: emitEngine is left
   *  undefined by FightRenderer, so onEvent never fires and this is the ONLY way
   *  a normal hit reaches PostPipeline.impact. See PostPipeline.impactPunch. */
  punchPost?: (strength: number, warm: number, flash?: number) => void
}

export class FightVfx {
  private d: FightVfxDeps
  private p = new THREE.Vector3()
  private kd = new THREE.Vector3(1, 0, 0)

  constructor(deps: FightVfxDeps) {
    this.d = deps
  }

  handle(e: FightEvent) {
    switch (e.type) {
      case 'hit': return this.hit(e.at, e.attacker, e.level, e.damage)
      case 'counter-hit': return this.counterHit(e.at, e.attacker, e.level)
      case 'block': return this.block(e.at, e.attacker, e.chip ?? 0)
      case 'parry': return this.parry(e.at)
      case 'throw': return this.throwFx(e.at, e.attacker, e.level, e.damage)
      case 'launch': return this.launch(e.at)
      case 'knockdown': return this.knockdown(e.at)
      case 'wall-bounce': return this.wallBounce(e.at)
      case 'super-flash': return this.superFlash(e.who)
      case 'ko': return this.ko(e.who)
    }
  }

  /**
   * Screen-space direction of the blow: away from the attacker, toward the
   * victim, in the camera's XY plane. The camera kick rides this so a hit shoves
   * the frame the way the punch travels (a right-facing jab kicks the frame
   * right) instead of a directionless rattle — the difference between "impact"
   * and "vibration". Mesh x is fine for a sign; it's what block() already uses.
   */
  private blowDir(attacker: 0 | 1, up: number): THREE.Vector3 {
    const target = (attacker === 0 ? 1 : 0) as 0 | 1
    const a = this.d.fighters[attacker]?.mesh.position.x ?? 0
    const t = this.d.fighters[target]?.mesh.position.x ?? 0
    const dir = Math.sign(t - a) || 1
    return this.kd.set(dir, up, 0)
  }

  private world(at: Vec2): THREE.Vector3 {
    return simToWorld(at, this.p)
  }

  private hit(at: Vec2, attacker: 0 | 1, level: HitLevel, damage: number) {
    const t = HIT[level] ?? HIT.medium
    const power = Math.min(1, damage / 120)

    const target = (attacker === 0 ? 1 : 0) as 0 | 1
    // Anchor the spark to the sim's reported contact point. `event.at` is the
    // hitbox/hurtbox intersection the sim computed this frame: measured on the
    // real route it sits on the defender's struck surface — on the fist tip at
    // contact. The old reconstruction (defender centre + 0.35*bodyWidth toward
    // the attacker, from possibly-stale mesh positions) overshot ~0.5 world units
    // toward mid-stage on every hit, landing nearer the fighters' midpoint than
    // the real contact — the "spark floats at centre-stage instead of on the
    // fist" tell. Take x straight from the event; keep only a y safety-clamp so a
    // freak-low contact can't drop the spark to the floor (the old low-hit tell).
    const contactX = this.world(at).x
    const hitCm = THREE.MathUtils.clamp(at.y, 40, 175)
    const pos = this.p.set(
      contactX,
      WORLD.GROUND_Y + hitCm * CM_TO_WORLD,
      0.05,
    )

    // Sharp spark star at the exact contact point.
    this.d.additive.emit({
      position: pos, count: t.count, speed: t.speed, speedVariance: 0.6,
      color: t.hot, color2: t.cool, size: t.size, sizeVariance: 0.5,
      life: 0.34, lifeVariance: 0.4, gravity: -10, drag: 3.2,
      shape: 'spark', intensity: 1.6 + t.core, spawnRadius: 0.35, stretch: 3.0,
    })
    // A few slow fat embers that arc and fall, for weight.
    this.d.additive.emit({
      position: pos, count: Math.round(t.count * 0.35), speed: t.speed * 0.55,
      color: t.cool, color2: t.hot, size: t.size * 1.4, life: 0.55, lifeVariance: 0.5,
      gravity: -14, drag: 1.6, shape: 'ember', intensity: 1.2, spawnRadius: 0.22, bounce: true,
    })
    // Contact flare + a thin ring travelling across the silhouette. The 'shock'
    // ring's colour is owned by its *second* colour arg, so it must be the warm
    // flavour, not t.hot — passing white here made the ring a desaturated
    // white/grey donut whose chromatic split read as lens dirt trailing the
    // recoiling fist. The 'star' below already owns the white-hot core; the ring
    // is the shaped warm shock front, kept short so it doesn't linger as a smear.
    this.d.shockwave.spawn('star', pos, 0.5 + t.core * 0.4, 0.26, t.hot, t.cool, 1.3 + power)
    this.d.shockwave.spawn('shock', pos, 0.4 + t.core * 0.3, 0.26, t.hot, t.cool, 1.15, 1.4)

    // The bold impact-frame mark: one large, short-lived additive graphic laid
    // ON TOP of the fine particle spray. This is the deliberate drawn beat the
    // particles alone can't give (each particle is ~0.13–0.24 world units; this
    // mark is 0.95–2.15 — 28–63% of a body). Oriented to the blow so a left- and
    // a right-facing hit don't stamp the same mark, with a small deterministic
    // jitter (hashed from the contact point, so screenshot diffs stay stable) so
    // repeated hits vary. It runs on the scaled sim delta → held through hitstop,
    // then released a few frames later.
    const im = IMPACT[level] ?? IMPACT.medium
    const bd = this.blowDir(attacker, 0.16)
    const angle = Math.atan2(bd.y, bd.x) + im.spin + hash2(at.x, at.y) * 0.35
    this.d.impact.spawn(pos, im.mark, im.size, angle, im.tint, im.intensity, im.life)

    // Feel: freeze, shake, dolly punch, and flash the defender. The shake is a
    // directional shove along the blow, weight-scaled via t.shake (light 0.10 →
    // crumple 0.36) so a jab ticks the frame and a launcher rocks it.
    this.d.requestHitstop(t.hitstopMs, t.hitstopScale)
    this.d.camera.addShake(t.shake, bd)
    this.d.camera.punchIn(t.push)
    this.d.fighters[target]?.triggerHitFlash(t.flash)
    // Charge the reactive screen-punch (bloom + chromatic aberration + contrast +
    // grain + anamorphic streak). On the shipped `?play=1` route this call is the
    // ONLY thing that charges PostPipeline.impact: the sim's FightEvents are
    // dispatched straight to this class and never reach the card-game engine bus,
    // so onEvent — the effect's original charger — never fires. Measured live
    // before this wire: impact sat at 0.0000 across 45 hits of every weight class,
    // i.e. the entire reactive grade was dead on the game people actually play.
    // Weight-scaled from the HIT ladder (light 0.30 → crumple 0.52), lightly
    // modulated by combo power. No full-frame flash on a normal hit — that wash is
    // reserved for the KO (see ko()), per the anti-white-orb lesson.
    this.d.punchPost?.(t.post * (0.8 + power * 0.4), t.warm)
    this.d.emitEngine?.(attacker, target, level, power, 'hit')
  }

  /**
   * Counter-hit reward flourish — a colour callout PLUS a little extra screen
   * kick.
   *
   * The sim emits `counter-hit` ALONGSIDE the normal `hit` for the same contact
   * (combat.ts), so the base spark, the impact freeze, the light flash and the
   * base camera shake have ALREADY fired for this frame via hit(). This method
   * adds the "you got countered" magenta callout, and — because a counter is
   * meant to hit HARDER — a small ADDITIONAL camera kick that stacks on the base
   * shake this frame, so the same move on counter visibly rocks the frame more.
   * It deliberately does NOT call hit(), requestHitstop, emitEngine or
   * triggerHitFlash: doubling the FREEZE or the LIGHT is what risks the fighter
   * wash this subsystem has fought for 21 iterations, whereas a bit more camera
   * kick is exactly the extra weight a counter should read as. The distinct hue
   * still does the identifying: magenta is used by no other event (hit is orange,
   * block/parry are cyan). Fires for every counter the sim reports.
   */
  private counterHit(at: Vec2, attacker: 0 | 1, level: HitLevel) {
    const w = HIT[level] ?? HIT.medium
    // Extra kick on top of the base hit's shake — scales with weight so a
    // launcher-counter rocks harder than a jab-counter, and reuses the blow
    // direction so it shoves the same way, not against, the base shake.
    this.d.camera.addShake(0.12 + w.core * 0.05, this.blowDir(attacker, 0.2))
    this.d.camera.punchIn(0.12)
    // Anchor to the sim's contact point, same floor-clamp discipline as hit()/
    // block() so a low projectile counter can't drop the callout onto the floor.
    // z just in front of the hit spark (0.05) so the magenta reads over it.
    const contactX = this.world(at).x
    const hitCm = THREE.MathUtils.clamp(at.y, 40, 175)
    const pos = this.p.set(contactX, WORLD.GROUND_Y + hitCm * CM_TO_WORLD, 0.06)

    const white = new THREE.Color(0xffffff)
    // Signature counter magenta — vivid, unused elsewhere in the event palette.
    const mag = new THREE.Color(0xff2ea0)

    // The callout ring. For 'shock' the SECOND colour arg owns the ring hue (see
    // hit()'s note), so magenta must ride color2 to get a magenta front with a
    // white heart. Sized off the hit weight so a launcher-counter reads bigger.
    this.d.shockwave.spawn('shock', pos, 0.55 + w.core * 0.26, 0.28, white, mag, 1.35, 1.25)
    // A crisp inner star — 'star' hue is owned by the FIRST arg → a white heart
    // rimmed magenta, giving the ring a bright centre without a solid blob.
    this.d.shockwave.spawn('star', pos, 0.3 + w.core * 0.12, 0.2, white, mag, 1.2)
    // A few fast radial shards: zero gravity + heavy drag so they shoot out and
    // stop as clean rays instead of falling into a pom-pom. Kept modest (16) and
    // short (0.26s) — well under a hit's spark budget — so the overlay accents the
    // hit without adding light that could flatten the fighters.
    this.d.additive.emit({
      position: pos, count: 16, speed: 14, speedVariance: 0.6,
      color: mag, color2: white, size: 0.11, sizeVariance: 0.5,
      life: 0.26, lifeVariance: 0.4, gravity: 0, drag: 5.2,
      shape: 'streak', intensity: 1.7, spawnRadius: 0.12, stretch: 3.8,
    })
  }

  private block(at: Vec2, attacker: 0 | 1, chip: number) {
    // A block must read as a *deflection*, not a hit: a saturated-blue shield
    // clang with sparks that fan up-and-back off the guard, instantly telling
    // the eye "guarded, no damage" versus a hit's hot orange starburst. It gets
    // anchored to the defender's guard (below), not the raw contact point, which
    // can sit on the floor for a low and made blocks look like they had no VFX.
    const di = (attacker === 0 ? 1 : 0) as 0 | 1
    const def = this.d.fighters[di]
    const atk = this.d.fighters[attacker]
    const dir = Math.sign(atk.mesh.position.x - def.mesh.position.x) || 1
    // Anchor to the sim's contact height (accurate per-attack) but pin it to the
    // front edge of the defender's silhouette facing the attacker, and clamp the
    // height into a knee..upper-chest guard band (in cm) so a freak-low contact
    // can't drop the flash onto the floor — the old "stray floor spark" bug —
    // while a high block still reads up near the forearms.
    const guardCm = THREE.MathUtils.clamp(at.y, 55, 130)
    const guard = this.p
    guard.set(
      def.mesh.position.x + dir * def.bodyWidth * 0.4,
      WORLD.GROUND_Y + guardCm * CM_TO_WORLD,
      0.02,
    )

    // Deep, saturated blues so the flash still reads as *blue* after the additive
    // blend lifts it over the stage's warm key — a hit's hot orange core is the
    // opposite pole, which is what makes blocked-vs-hit legible at a glance.
    const cyan = new THREE.Color(0x2ea8ff)
    const ice = new THREE.Color(0x9fe2ff)

    // The "clang": a bold cyan shield ring is the dominant, unmistakable read —
    // a ring can't ball up into a stray orb the way a dense spark burst does.
    this.d.shockwave.spawn('shock', guard, 0.9, 0.26, cyan, ice, 1.6, 1.2)
    // A crisp inner star gives the ring a bright heart without a solid blob.
    this.d.shockwave.spawn('star', guard, 0.32, 0.18, ice, cyan, 1.1)
    // Deflection shards — few, fast, wide, zero gravity and heavy drag so they
    // shoot out and stop as radiating streaks rather than falling into a pom-pom.
    this.d.additive.emit({
      position: guard, count: 12, speed: 15, speedVariance: 0.7,
      color: ice, color2: cyan, size: 0.1, sizeVariance: 0.5,
      life: 0.2, lifeVariance: 0.4, gravity: 0, drag: 5.5,
      shape: 'streak', intensity: 1.7, spawnRadius: 0.12, stretch: 4.2,
      direction: new THREE.Vector3(-dir, 0.5, 0), spread: 1.5,
    })
    // Chip feel: a short blockstun freeze always (you DID guard), but a camera
    // kick ONLY when the block actually cost grey-life. Blocking a normal chips
    // nothing (constants.ts: "normals never chip"), and a screen shove when
    // nothing got through erases the difference between blocking a jab and eating
    // one — the whole point of the block read. So a no-chip block keeps its clang
    // but stays camera-silent; a chip block (special/super) gets a small kick
    // that scales a touch with the chip taken, always well under a clean hit.
    this.d.requestHitstop(45, 0.2)
    if (chip > 0) {
      const mag = 0.06 + Math.min(chip, 12) / 12 * 0.05
      this.d.camera.addShake(mag, this.kd.set(-dir, 0.12, 0))
    }
  }

  private parry(at: Vec2) {
    const pos = this.world(at)
    const cyan = new THREE.Color(0x59ffe0)
    this.d.shockwave.spawn('halo', pos, 0.9, 0.4, cyan, new THREE.Color(0xffffff), 1.6)
    this.d.additive.emit({
      position: pos, count: 30, speed: 9, color: new THREE.Color(0xffffff), color2: cyan,
      size: 0.12, life: 0.3, drag: 3, shape: 'spark', intensity: 1.8, spawnRadius: 0.3, stretch: 3.5,
    })
    this.d.requestHitstop(120, 0.05)
    this.d.camera.addShake(0.12)
  }

  /**
   * A throw is the grappler's whole payoff and the answer to a turtling
   * opponent — we treat a command grab as one of the loudest non-super beats in a
   * round. It is NOT a strike, so it deliberately skips the sharp spark star and
   * the hit-spark impact mark: its beat is a grab, a lift and a SLAM.
   *
   * Weight is derived from the SAME HIT[level] ladder every strike uses, so the
   * authored `level: 'heavy'` (warden/operator/vanguard) is genuinely CONSUMED —
   * a designer retuning a throw's level now actually moves the feel — and
   * `damage` (120 basic … 360 super-throw) pushes the biggest grabs further. The
   * throw then reads at heavy-or-ABOVE: a hard catch-freeze, a low ground shock
   * ring and dust plume in place of the spark star, a chunky ember debris burst,
   * and a big camera slam directed DOWNWARD (the body into the floor) — a
   * distinct signature from a strike's horizontal shove. The old path shook the
   * camera 0.10 (the weakest jab), emitted zero particles and dropped `level`.
   */
  private throwFx(at: Vec2, attacker: 0 | 1, level: HitLevel, damage: number) {
    const t = HIT[level] ?? HIT.heavy
    const power = Math.min(1, damage / 160) // 120→0.75 basic … 360→1 super-throw
    const pos = this.world(at)
    const warm = new THREE.Color(0xffd9a0)
    const deep = new THREE.Color(0xff8a3c)

    // The catch: a hard freeze — the throw's version of hitstop, a touch longer
    // than the same-level strike because the grab is a definitive commitment.
    this.d.requestHitstop(t.hitstopMs * 1.1, t.hitstopScale)

    // The slam kicks up the floor: a big dust cloud plus a burst of chunky
    // embers that arc and fall — weight-scaled debris, NOT fine strike sparks.
    this.dust(at, 1.1 + power * 0.7)
    this.d.additive.emit({
      position: pos, count: Math.round(t.count * 0.6), speed: t.speed * 0.7, speedVariance: 0.7,
      color: deep, color2: warm, size: t.size * 1.5, life: 0.5, lifeVariance: 0.5,
      gravity: -16, drag: 1.8, shape: 'ember', intensity: 1.2, spawnRadius: 0.3, bounce: true,
    })

    // The throw's bold graphic: a low, wide ground shock ring in place of the
    // strike's spark star, scaled by weight.
    this.d.shockwave.spawn('shock', pos, 0.7 + t.core * 0.4, 0.34, warm, deep, 1.0 + power * 0.6, 1.7)

    // Feel: a big camera slam heavier than the same-level strike (t.shake * 1.35
    // + a damage kicker) and directed mostly DOWNWARD, tilted slightly the way
    // the throw travels, plus a dolly punch. A 140-dmg command grab lands ~0.45
    // here vs the old 0.10 — above a heavy strike (0.26), just shy of a KO (0.5).
    const slam = this.blowDir(attacker, 0.2) // horizontal sign of the throw…
    slam.set(slam.x * 0.35, -1, 0) //          …re-aimed mostly DOWNWARD (the slam)
    this.d.camera.addShake(t.shake * 1.35 + power * 0.12, slam)
    this.d.camera.punchIn(t.push * 0.9 + 0.12)
  }

  private launch(at: Vec2) {
    const pos = this.world(at)
    const c = new THREE.Color(0x8ad2ff)
    this.d.additive.emit({
      position: pos, count: 46, speed: 12, color: new THREE.Color(0xffffff), color2: c,
      size: 0.16, life: 0.5, drag: 1.8, gravity: -6, shape: 'streak', intensity: 1.6,
      spawnRadius: 0.2, stretch: 5, direction: new THREE.Vector3(0, 1, 0), spread: 0.5, flatten: 0,
    })
    this.d.shockwave.spawn('radial', pos, 1.0, 0.4, new THREE.Color(0xffffff), c, 1.2)
    this.d.camera.addShake(0.18)
    this.d.camera.punchIn(0.3)
  }

  private knockdown(at: Vec2) {
    this.dust(at, 1.0)
    const pos = this.world(at)
    this.d.shockwave.spawn('shock', pos, 1.3, 0.5, new THREE.Color(0xd8c8a8), new THREE.Color(0x8a7a5a), 0.7, 2.2)
    this.d.camera.addShake(0.16)
  }

  private wallBounce(at: Vec2) {
    const pos = this.world(at)
    const hot = new THREE.Color(0xffffff)
    const c = new THREE.Color(0xff7a2a)
    this.d.additive.emit({
      position: pos, count: 60, speed: 13, color: hot, color2: c, size: 0.2,
      life: 0.4, drag: 2.4, gravity: -16, shape: 'shard', intensity: 1.8, spawnRadius: 0.3,
      stretch: 2.5, bounce: true,
    })
    this.d.shockwave.spawn('crystal', pos, 1.1, 0.42, hot, c, 1.4)
    this.d.requestHitstop(120, 0.05)
    this.d.camera.addShake(0.34, new THREE.Vector3(1, 0.2, 0))
    this.d.camera.punchIn(0.4)
  }

  private superFlash(who: 0 | 1) {
    const f = this.d.fighters[who]
    const pos = f.chestAnchor()
    const gold = new THREE.Color(0xffe08a)
    const white = new THREE.Color(0xffffff)
    this.d.shockwave.spawn('radial', pos, 2.6, 0.7, white, gold, 2.2)
    this.d.shockwave.spawn('halo', pos, 1.8, 0.6, gold, white, 1.8)
    this.d.additive.emit({
      position: pos, count: 90, speed: 14, color: white, color2: gold, size: 0.18,
      life: 0.6, drag: 1.6, gravity: 0, shape: 'streak', intensity: 2.0, spawnRadius: 0.4, stretch: 6,
    })
    // The signature freeze.
    this.d.requestHitstop(260, 0.02)
    this.d.camera.addShake(0.2)
    this.d.camera.punchIn(0.6)
  }

  private ko(who: 0 | 1) {
    const f = this.d.fighters[who]
    const pos = f.chestAnchor()
    const white = new THREE.Color(0xffffff)
    this.d.shockwave.spawn('radial', pos, 3.2, 0.9, white, new THREE.Color(0xff6a4a), 2.6)
    this.d.additive.emit({
      position: pos, count: 120, speed: 16, color: white, color2: new THREE.Color(0xff8a4a),
      size: 0.2, life: 0.8, drag: 1.4, gravity: -8, shape: 'spark', intensity: 2.2, spawnRadius: 0.5, stretch: 4,
    })
    f.setDissolve(1)
    this.d.requestHitstop(340, 0.01)
    this.d.camera.addShake(0.5)
    this.d.camera.punchIn(0.8)
    // The KO is the most-remembered single frame of the match; give it the full
    // reactive punch plus the short warm exposure lift the card route's
    // onEvent('ko') applied — both of which were dead on the shipped route for the
    // same emitEngine reason as a normal hit. framing owns the KO *camera* move;
    // this is only the post grade. flash stays in the punch-and-decay band
    // (clamped to 0.32 in impactPunch) so it lands as a bright accent, not a
    // whole-frame wash that would flatten the KO'd fighter into a silhouette.
    this.d.punchPost?.(1.7, 0.6, 0.26)
    this.d.emitEngine?.(who === 0 ? 1 : 0, who, 'heavy', 1, 'ko')
  }

  // ---- Derived (non-event) effects the sim doesn't emit directly ----------

  /** Kicked ground dust for dashes and landings. */
  dust(at: Vec2, strength: number) {
    const pos = this.world(at)
    pos.y = 0
    const tan = new THREE.Color(0xd8c8a8)
    const dark = new THREE.Color(0x6a5a44)
    this.d.alpha.emit({
      position: pos, count: Math.round(14 * strength + 6), speed: 3.2 * strength + 1.2,
      color: tan, color2: dark, size: 0.28 * strength + 0.12, life: 0.5, lifeVariance: 0.4,
      gravity: -2, drag: 3, shape: 'dust', intensity: 0.5, spawnRadius: 0.2,
      flatten: 0.85, groundAlign: true,
    })
  }

  dashDust(feet: Vec2, facing: 1 | -1) {
    const pos = this.world(feet)
    pos.y = 0
    const tan = new THREE.Color(0xe0d0b0)
    this.d.alpha.emit({
      position: pos, count: 16, speed: 4.5, color: tan, color2: new THREE.Color(0x6a5a44),
      size: 0.3, life: 0.45, gravity: -2, drag: 3.4, shape: 'dust', intensity: 0.55,
      spawnRadius: 0.15, direction: new THREE.Vector3(-facing, 0.5, 0), spread: 0.9, groundAlign: true,
    })
  }
}
