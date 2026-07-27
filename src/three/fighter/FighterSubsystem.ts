import * as THREE from 'three'
import {
  WORLD,
  type EngineContext,
  type FightEvent,
  type FighterPose,
  type FighterVisualState,
  type FightRenderState,
  type QualityTier,
  type SpriteTextureSet,
  type Subsystem,
} from '../types'
import { spriteUrl } from '../bridge'
import {
  createFighterDepthMaterial,
  createFighterMaterial,
  createFighterUniforms,
  type FighterUniforms,
} from './FighterShader'
import type { LightRig } from '../lighting/LightRig'
import { flagsFor } from '../core/QualityManager'
import type { Side } from '../../types'

/**
 * Animation channels driven procedurally on top of the static pose art.
 * Real fighting games have 20+ frames per action; we have 4 stills, so all the
 * motion has to come from the rig: anticipation, thrust, recoil, settle.
 */
interface AnimChannels {
  /** Forward offset along the facing axis (world units). */
  lunge: number
  lungeVel: number
  /** Backward knockback from taking a hit. */
  knock: number
  knockVel: number
  /** Vertical hop. */
  hop: number
  hopVel: number
  /** Shear at the top of the body. */
  lean: number
  leanVel: number
  /** Squash (x, y) multipliers. */
  squashX: number
  squashY: number
  squashVelX: number
  squashVelY: number
  /** Damped travelling wobble amplitude. */
  wobble: number
  /** White-hot hit flash 0..1. */
  flash: number
  /** Yaw twist in radians. */
  yaw: number
  yawVel: number
}

function newChannels(): AnimChannels {
  return {
    lunge: 0, lungeVel: 0, knock: 0, knockVel: 0, hop: 0, hopVel: 0,
    lean: 0, leanVel: 0, squashX: 1, squashY: 1, squashVelX: 0, squashVelY: 0,
    wobble: 0, flash: 0, yaw: 0, yawVel: 0,
  }
}

/** Critically-damped spring — the workhorse for every channel. */
function spring(value: number, vel: number, target: number, stiffness: number, damping: number, dt: number) {
  const a = (target - value) * stiffness - vel * damping
  const nv = vel + a * dt
  return [value + nv * dt, nv] as const
}

class FighterRig {
  readonly group = new THREE.Group()
  readonly mesh: THREE.Mesh
  readonly uniforms: FighterUniforms
  readonly material: THREE.ShaderMaterial

  private shadow!: THREE.Mesh
  private shadowMat!: THREE.ShaderMaterial
  private castShadowMesh!: THREE.Mesh
  private castShadowMat!: THREE.ShaderMaterial
  private ch = newChannels()
  private set: SpriteTextureSet | null = null
  private prevSet: SpriteTextureSet | null = null
  private currentPose: FighterPose = 'stance'
  private loadToken = 0
  private poseBlend = 1
  private idlePhase: number
  private facing: number
  private baseX: number
  // Scripted attack timeline (anticipation → contact → follow-through).
  private atkT = -1
  private atkPow = 0
  // KO tumble timeline.
  private koT = -1
  // Secondary motion: the upper body / hair lags behind fast horizontal moves.
  private prevX: number
  private hairLag = 0
  private hairLagVel = 0
  private accent = new THREE.Color('#FFD60A')
  private superGlow = 0
  private shattered = 0
  private dissolve = 0
  private targetDissolve = 0
  private aspect = 1
  private ready = false

  readonly side: Side
  private ctx: EngineContext

  constructor(side: Side, ctx: EngineContext, idleOffset: number) {
    this.side = side
    this.ctx = ctx
    this.facing = side === 'a' ? 1 : -1
    this.baseX = side === 'a' ? -WORLD.FIGHTER_SEPARATION : WORLD.FIGHTER_SEPARATION
    this.idlePhase = idleOffset
    this.prevX = this.baseX

    this.uniforms = createFighterUniforms()
    this.uniforms.uFacing.value = this.facing
    this.material = createFighterMaterial(this.uniforms)

    const geo = new THREE.PlaneGeometry(1, 1, 12, 24)
    this.mesh = new THREE.Mesh(geo, this.material)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = false
    this.mesh.customDepthMaterial = createFighterDepthMaterial(this.uniforms)
    this.mesh.frustumCulled = false
    // Anchor the quad so its bottom edge sits on y = 0.
    this.mesh.position.y = 0.5
    this.group.add(this.mesh)

    this.group.position.set(this.baseX, WORLD.GROUND_Y, 0)
    // Mirror the right-hand fighter so both face the centre.
    this.group.scale.x = this.facing

    this.buildShadow()
    ctx.scene.add(this.group)
  }

  /**
   * Soft contact shadow. A real shadow map alone reads too hard for a
   * billboard, so we also lay down an elliptical gradient that tightens as the
   * fighter's feet approach the floor.
   */
  private buildShadow() {
    const geo = new THREE.PlaneGeometry(2.6, 1.5)
    this.shadowMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uOpacity: { value: 0.55 },
        uTight: { value: 1.0 },
        uColor: { value: new THREE.Color(0x04030a) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uOpacity; uniform float uTight; uniform vec3 uColor;
        void main() {
          vec2 d = (vUv - 0.5) * vec2(2.0, 2.0);
          float r = length(d * vec2(1.0, 1.45));
          // Dense AO core directly under the feet + a wide soft penumbra so the
          // footprint reads as ground occlusion, not a hard cutout disc.
          float core = 1.0 - smoothstep(0.0, 0.62, pow(r, uTight));
          float soft = 1.0 - smoothstep(0.0, 1.1, r);
          float a = clamp(core * 0.7 + soft * 0.5, 0.0, 1.0);
          gl_FragColor = vec4(uColor, a * uOpacity);
        }
      `,
    })
    this.shadow = new THREE.Mesh(geo, this.shadowMat)
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.position.set(0, 0.012, 0.05)
    this.shadow.renderOrder = -2
    this.group.add(this.shadow)

    this.buildCastShadow()
  }

  /**
   * Pose-accurate projected shadow. We take the fighter's own quad (same
   * subdivision + squash/lean deformation) and, in the vertex shader, project
   * every vertex onto the floor along the key-light direction. The result is a
   * real silhouette shadow anchored at the feet — the single biggest thing that
   * gives a billboard fighter physical mass, instead of a disconnected blob.
   */
  private buildCastShadow() {
    const geo = new THREE.PlaneGeometry(1, 1, 12, 24)
    this.castShadowMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      uniforms: {
        uAlbedo: this.uniforms.uAlbedo,
        uSquash: this.uniforms.uSquash,
        uLean: this.uniforms.uLean,
        uWobble: this.uniforms.uWobble,
        uTime: this.uniforms.uTime,
        uDissolve: this.uniforms.uDissolve,
        uKeyDir: this.uniforms.uKeyDir,
        uGroundY: { value: WORLD.GROUND_Y },
        uOpacity: { value: 0.5 },
        uColor: { value: new THREE.Color(0x02020a) },
        uProject: { value: 0.6 },
      },
      vertexShader: /* glsl */ `
        uniform vec2 uSquash; uniform float uLean; uniform float uWobble; uniform float uTime;
        uniform vec3 uKeyDir; uniform float uGroundY; uniform float uProject;
        varying vec2 vUv; varying float vFade;
        void main() {
          vUv = uv;
          vec3 p = position;
          float h = uv.y;
          p.x *= uSquash.x;
          p.y = (p.y + 0.5) * uSquash.y - 0.5;
          p.x += uLean * h * h;
          p.x += uWobble * sin(h * 9.0 - uTime * 26.0) * (1.0 - h * 0.35) * 0.09;
          vec4 world = modelMatrix * vec4(p, 1.0);
          float hgt = max(0.0, world.y - uGroundY);
          vec3 L = normalize(uKeyDir);
          vec2 disp = -(L.xy / max(L.y, 0.4)) * hgt * uProject;
          world.x += disp.x;
          world.z += disp.y;
          world.y = uGroundY + 0.02;
          // Fade the far (head) end of the shadow into a soft penumbra.
          vFade = 1.0 - smoothstep(0.15, 1.0, hgt / 3.4);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAlbedo; uniform float uOpacity; uniform vec3 uColor;
        uniform float uDissolve;
        varying vec2 vUv; varying float vFade;
        void main() {
          float a = texture2D(uAlbedo, vUv).a;
          if (a < 0.4 || uDissolve > 0.4) discard;
          gl_FragColor = vec4(uColor, a * uOpacity * vFade);
        }
      `,
    })
    this.castShadowMesh = new THREE.Mesh(geo, this.castShadowMat)
    this.castShadowMesh.frustumCulled = false
    this.castShadowMesh.renderOrder = -1
    this.group.add(this.castShadowMesh)
  }

  async setPose(pose: FighterPose, fighterId: string) {
    if (pose === this.currentPose && this.set) return
    const token = ++this.loadToken
    const url = spriteUrl(fighterId, pose)
    try {
      const set = await this.ctx.assets.spriteSet(url)
      if (token !== this.loadToken) return
      this.prevSet = this.set
      this.set = set
      this.currentPose = pose
      this.poseBlend = this.prevSet ? 0 : 1
      // Force NEAREST magnification on the albedo so the pixel art stays razor
      // crisp under the quad's stretch/skew deformation, while the derived
      // normal/height stay LINEAR so the *lighting* is smooth. This is the
      // hybrid that resolves "crisp pixels vs smooth light".
      for (const tex of [set.albedo, this.prevSet?.albedo]) {
        if (tex && tex.magFilter !== THREE.NearestFilter) {
          tex.magFilter = THREE.NearestFilter
          tex.needsUpdate = true
        }
      }
      this.uniforms.uPrevAlbedo.value = this.prevSet?.albedo ?? set.albedo
      this.uniforms.uAlbedo.value = set.albedo
      this.uniforms.uNormal.value = set.normal
      this.uniforms.uHeight.value = set.height
      this.uniforms.uPoseBlend.value = this.poseBlend
      this.applyFraming(set)
      this.ready = true
    } catch {
      // A missing pose PNG falls back to the stance we already have.
      if (!this.set && pose !== 'stance') void this.setPose('stance', fighterId)
    }
  }

  /**
   * Scale the quad so the *visible* pixels are always FIGHTER_HEIGHT tall and
   * the feet sit exactly on the ground, regardless of how much empty margin
   * the generator left around a given pose.
   */
  private applyFraming(set: SpriteTextureSet) {
    // bounds are in image space (y grows downward from the top of the PNG).
    const [x0, y0, x1, y1] = set.bounds
    const contentW = (x1 - x0) * set.width
    const contentH = (y1 - y0) * set.height_px
    this.aspect = contentW / Math.max(1, contentH)

    const quadH = WORLD.FIGHTER_HEIGHT / Math.max(0.05, y1 - y0)
    const quadW = quadH * (set.width / set.height_px)
    this.mesh.scale.set(quadW, quadH, 1)
    // Content bottom in UV space is (1 - y1); place it exactly on the ground.
    this.mesh.position.y = quadH * (y1 - 0.5)
    // Recentre horizontally on the content.
    this.mesh.position.x = -((x0 + x1) * 0.5 - 0.5) * quadW

    const footW = Math.max(1.5, this.aspect * WORLD.FIGHTER_HEIGHT * 1.05)
    this.shadow.scale.set(footW / 2.6, footW / 2.6, 1)

    // The projected cast shadow shares the body's exact quad transform so its
    // silhouette matches the pose 1:1.
    this.castShadowMesh.scale.copy(this.mesh.scale)
    this.castShadowMesh.position.copy(this.mesh.position)
  }

  setAccent(hex: string) {
    this.accent.set(hex)
    this.uniforms.uAccent.value.copy(this.accent)
  }

  // ---- impulses ----------------------------------------------------------

  attack(power: number) {
    // Kick off the scripted attack timeline. The timeline owns the big forward
    // reach + anticipation; the springs just add a little organic overshoot and
    // a yaw twist so it never looks perfectly mechanical.
    this.atkT = 0
    this.atkPow = Math.min(1, power)
    this.ch.yawVel += 1.4 + power * 1.8
    this.ch.wobble = Math.min(1.2, this.ch.wobble + 0.35 * power)
  }

  takeHit(power: number, flavor: string) {
    // Cancel any attack in progress — getting hit interrupts you.
    this.atkT = -1
    const p = Math.min(1.6, 0.35 + power * 1.5)
    this.ch.knockVel += 5.5 * p
    this.ch.leanVel -= 7 * p
    this.ch.hopVel += (flavor === 'ult' || flavor === 'signature' ? 5.5 : 2.2) * p
    this.ch.squashVelX -= 3.2 * p
    this.ch.squashVelY += 2.4 * p
    this.ch.wobble = Math.min(1.6, this.ch.wobble + p * 1.05)
    this.ch.flash = 1
    this.ch.yawVel -= 3.4 * p
    const hitColor =
      flavor === 'ult' || flavor === 'signature' ? 0xff8fe0 :
      flavor === 'ex' ? 0x9ff3ff :
      flavor === 'crit' ? 0xffffff : 0xfff2c8
    this.uniforms.uHitColor.value.setHex(hitColor)
  }

  ko() {
    // A real knockout: launch up-and-back, then tumble to the floor.
    this.atkT = -1
    this.koT = 0
    this.ch.knockVel += 6
    this.ch.hopVel += 5
    this.ch.wobble = Math.min(1.8, this.ch.wobble + 1.2)
  }

  burnAway(on: boolean) {
    this.targetDissolve = on ? 1 : 0
  }

  setShattered(v: boolean) {
    this.shattered = v ? 1 : 0
  }

  // ---- frame -------------------------------------------------------------

  update(dt: number, vs: FighterVisualState, time: number, light: LightRig | undefined, camera: THREE.PerspectiveCamera, animScale = 1) {
    if (!this.ready) return
    const c = this.ch
    // Hitstop: freeze the procedural animation (springs, timelines, idle) for a
    // few frames on impact so the hit reads with a hard, frame-perfect snap.
    // Lighting/anchors below still update every frame.
    const adt = dt * animScale

    // Pose cross-fade
    if (this.poseBlend < 1) {
      this.poseBlend = Math.min(1, this.poseBlend + adt * 11)
      this.uniforms.uPoseBlend.value = this.poseBlend
    }

    // Springs
    ;[c.lunge, c.lungeVel] = spring(c.lunge, c.lungeVel, 0, 210, 19, adt)
    ;[c.knock, c.knockVel] = spring(c.knock, c.knockVel, 0, 120, 13, adt)
    ;[c.hop, c.hopVel] = spring(c.hop, c.hopVel, 0, 150, 14, adt)
    ;[c.lean, c.leanVel] = spring(c.lean, c.leanVel, 0, 180, 17, adt)
    ;[c.squashX, c.squashVelX] = spring(c.squashX, c.squashVelX, 1, 260, 22, adt)
    ;[c.squashY, c.squashVelY] = spring(c.squashY, c.squashVelY, 1, 260, 22, adt)
    ;[c.yaw, c.yawVel] = spring(c.yaw, c.yawVel, 0, 150, 16, adt)
    c.wobble *= Math.exp(-adt * 7.5)
    // Hit flash decays on REAL time, not animation time. Everything else in
    // this block is deliberately frozen by hitstop -- that is what gives the
    // impact its weight. The white flash must not be: it is a 2-3 frame
    // contact accent, and freezing it holds the character as a flat white
    // silhouette for the entire 100-320ms hitstop, which is precisely the
    // frame the player is staring at. Measured before this fix: the defender's
    // bounding box was 43% pure white on a crit and the character had no
    // readable form at all. Decay rate is tuned so the flash is effectively
    // gone by ~70ms regardless of how long the freeze runs.
    c.flash *= Math.exp(-dt * 38)

    // --- Scripted attack: anticipation → contact → follow-through ----------
    // A pure spring can't do a proper wind-up (pull back before you punch), so
    // the strike runs on an explicit clock. Outputs are in world/uniform units.
    let scReach = 0, scLean = 0, scSquashX = 1, scSquashY = 1
    if (this.atkT >= 0) {
      this.atkT += adt
      const p = this.atkPow
      const t = this.atkT
      const wind = 0.11, strike = 0.08, rec = 0.30
      if (t < wind) {
        // Anticipation: coil back and drop the weight.
        const k = t / wind
        const e = k * k
        scReach = -0.14 * p * e
        scLean = -0.45 * p * e
        scSquashY = 1 - 0.05 * p * e
        scSquashX = 1 + 0.05 * p * e
      } else if (t < wind + strike) {
        // Contact: explode forward. Ease-out so the peak is the impact frame.
        const k = (t - wind) / strike
        const e = 1 - (1 - k) * (1 - k)
        scReach = THREE.MathUtils.lerp(-0.14 * p, 0.6 * p, e)
        scLean = THREE.MathUtils.lerp(-0.45 * p, 2.6 * p, e)
        scSquashX = 1 + 0.13 * p * e
        scSquashY = 1 - 0.07 * p * e
      } else if (t < wind + strike + rec) {
        // Follow-through: settle back with a soft ease.
        const k = (t - wind - strike) / rec
        const e = k * k * (3 - 2 * k)
        scReach = THREE.MathUtils.lerp(0.6 * p, 0, e)
        scLean = THREE.MathUtils.lerp(2.6 * p, 0, e)
      } else {
        this.atkT = -1
      }
    }

    // --- KO tumble ---------------------------------------------------------
    let koTilt = 0, koReach = 0, koDrop = 0, koSquash = 1
    if (this.koT >= 0) {
      this.koT += adt
      const T = 0.85
      const k = Math.min(1, this.koT / T)
      const e = 1 - (1 - k) * (1 - k)
      koTilt = e * 1.25                         // rotate backward, away from foe
      koReach = e * 0.55                         // slide back
      koDrop = Math.sin(Math.min(1, k) * Math.PI) * 0.22 // launch up, then fall
      koSquash = 1 + Math.max(0, Math.sin((k - 0.7) * 3.0)) * 0.08 * (k > 0.7 ? 1 : 0)
    }

    // Idle breathing — two out-of-phase sines so it never looks metronomic.
    const breath = Math.sin(time * 2.05 + this.idlePhase) * 0.5 + Math.sin(time * 3.31 + this.idlePhase * 1.7) * 0.22
    const lowHp = 1 - vs.hp01
    // Wounded fighters breathe harder and sag — quadratic so it only really
    // kicks in when badly hurt, leaving healthy idles untouched.
    const hurt = lowHp * lowHp
    const breathAmp = 0.022 + hurt * 0.088
    const sag = hurt * 0.15

    // Idle weight-shift: the body sways gently foot-to-foot when at rest, and
    // that sway fades out while a strike/knockback is playing.
    const restMix = THREE.MathUtils.clamp(1 - Math.abs(c.lunge) - Math.abs(c.knock) - Math.abs(scReach) * 2, 0, 1)
    const sway = Math.sin(time * 0.85 + this.idlePhase * 1.3) * restMix
    const swayAmt = 0.03 + lowHp * 0.012

    // Turn readiness: the active fighter squares up slightly.
    const readyPush = vs.active ? 0.08 : 0

    const dir = 1 // group is already mirrored via scale.x
    const newX =
      this.baseX +
      this.facing * (c.lunge * 0.34 - c.knock * 0.5 + readyPush * 0.4 + scReach - koReach) +
      sway * swayAmt
    // Secondary motion: derive horizontal velocity and let the upper body / hair
    // trail behind it (critically-damped), so fast moves get organic lag.
    const vx = (newX - this.prevX) / Math.max(1e-4, dt)
    this.prevX = newX
    const lagTarget = THREE.MathUtils.clamp(-vx * this.facing * 0.05, -0.5, 0.5)
    ;[this.hairLag, this.hairLagVel] = spring(this.hairLag, this.hairLagVel, lagTarget, 130, 14, adt)

    this.group.position.x = newX
    this.group.position.y =
      WORLD.GROUND_Y + Math.max(0, c.hop * 0.16) + koDrop + breath * breathAmp - sag
    this.group.rotation.y = c.yaw * 0.09 * this.facing
    this.group.rotation.z = (-c.lean * 0.012 - koTilt) * this.facing

    this.uniforms.uSquash.value.set(
      c.squashX * scSquashX * (1 + breath * 0.006),
      c.squashY * scSquashY * koSquash * (1 - breath * 0.008 - sag * 0.12),
    )
    this.uniforms.uLean.value =
      (c.lean * 0.032 + scLean * 0.032 + this.hairLag + breath * 0.004 + sway * 0.01 + hurt * 0.05) * dir
    this.uniforms.uWobble.value = c.wobble + Math.abs(this.hairLagVel) * 0.04
    this.uniforms.uHitFlash.value = c.flash
    this.uniforms.uTime.value = time
    const damage = THREE.MathUtils.clamp(1 - vs.hp01, 0, 1)
    this.uniforms.uDamage.value = damage
    // Sweat sheen + exertion breathing build with damage; a fresh hit spikes it.
    const targetSweat = damage * 0.7 + Math.min(0.3, c.flash * 0.3)
    this.uniforms.uSweat.value += (targetSweat - this.uniforms.uSweat.value) * Math.min(1, dt * 4)
    this.uniforms.uExertion.value = lowHp
    if (this.set) this.uniforms.uTexel.value = 1 / this.set.width
    this.uniforms.uCameraPos.value.copy(camera.position)

    // Super charge glow ramps in when the meter fills.
    const targetGlow = vs.superReady ? 0.55 + Math.sin(time * 6) * 0.16 : vs.super01 * 0.14
    this.superGlow += (targetGlow - this.superGlow) * Math.min(1, dt * 5)
    this.uniforms.uSuperGlow.value = this.superGlow

    const targetShatter = vs.shattered ? 1 : 0
    this.shattered += (targetShatter - this.shattered) * Math.min(1, dt * 6)
    this.uniforms.uShattered.value = this.shattered

    this.dissolve += (this.targetDissolve - this.dissolve) * Math.min(1, dt * 1.6)
    this.uniforms.uDissolve.value = this.dissolve

    // Contact shadow tracks vertical offset + squash.
    const lift = Math.max(0, this.group.position.y - WORLD.GROUND_Y)
    this.shadowMat.uniforms.uOpacity.value = 0.7 * Math.exp(-lift * 2.4) * (1 - this.dissolve)
    this.shadowMat.uniforms.uTight.value = 1 + lift * 2.4
    this.shadow.position.y = 0.012 - (this.group.position.y - WORLD.GROUND_Y)
    // Projected cast shadow: fade a touch when airborne (it detaches).
    this.castShadowMat.uniforms.uOpacity.value = 0.5 * Math.exp(-lift * 1.6) * (1 - this.dissolve)

    // Pull the shared lighting description into the material.
    if (light) {
      const d = light.description
      const u = this.uniforms
      u.uKeyDir.value.copy(d.keyDir)
      u.uKeyColor.value.copy(d.keyColor)
      u.uKeyIntensity.value = d.keyIntensity
      u.uFillDir.value.copy(d.fillDir)
      u.uFillColor.value.copy(d.fillColor)
      u.uFillIntensity.value = d.fillIntensity
      u.uRimDir.value.copy(d.rimDir)
      u.uRimColor.value.copy(d.rimColor)
      u.uRimIntensity.value = d.rimIntensity
      u.uAmbientColor.value.copy(d.ambientColor)
      u.uAmbientIntensity.value = d.ambientIntensity
      u.uFlashPos.value.copy(d.flashPos)
      u.uFlashColor.value.copy(d.flashColor)
      u.uFlashIntensity.value = d.flashIntensity
      // Floor bounce: warm-ish average of ambient + fill, so the lower body
      // catches colour reflected up from the stage instead of going dead.
      u.uBounceColor.value.copy(d.ambientColor).lerp(d.fillColor, 0.5)
    }

    // Publish the chest anchor for VFX/camera.
    this.ctx.anchors.set(
      `fighter:${this.side}`,
      new THREE.Vector3(this.group.position.x, this.group.position.y + WORLD.FIGHTER_HEIGHT * 0.52, 0),
    )
    this.ctx.anchors.set(
      `fighter:${this.side}:head`,
      new THREE.Vector3(this.group.position.x, this.group.position.y + WORLD.FIGHTER_HEIGHT * 0.9, 0),
    )
    this.ctx.anchors.set(
      `fighter:${this.side}:feet`,
      new THREE.Vector3(this.group.position.x, WORLD.GROUND_Y, 0),
    )
  }

  setQuality(q: QualityTier) {
    const flags = flagsFor(q)
    this.mesh.castShadow = flags.shadows
    const rank = q === 'ultra' ? 3 : q === 'high' ? 2 : q === 'medium' ? 1 : 0
    this.uniforms.uQuality.value = rank
    this.uniforms.uSelfShadow.value = rank >= 2 ? 1 : 0
  }

  dispose() {
    this.group.parent?.remove(this.group)
    this.mesh.geometry.dispose()
    this.material.dispose()
    this.shadow.geometry.dispose()
    this.shadowMat.dispose()
    this.castShadowMesh.geometry.dispose()
    this.castShadowMat.dispose()
  }
}

/**
 * Owns both fighter rigs and translates game state + events into animation.
 */
export class FighterSubsystem implements Subsystem {
  readonly name = 'fighters'
  private ctx!: EngineContext
  private rigs: Record<Side, FighterRig> | null = null
  private time = 0
  private lastIds: Record<Side, string> = { a: '', b: '' }
  private lastPoses: Record<Side, FighterPose> = { a: 'stance', b: 'stance' }
  private light: LightRig | undefined
  private getLightRig: () => LightRig | undefined
  // Frame-perfect hitstop: freezes both fighters for a beat on impact.
  private hitstop = 0
  private timeScale = 1

  constructor(getLightRig: () => LightRig | undefined) {
    this.getLightRig = getLightRig
  }

  init(ctx: EngineContext) {
    this.ctx = ctx
    this.rigs = {
      a: new FighterRig('a', ctx, 0),
      b: new FighterRig('b', ctx, 1.9),
    }
  }

  update(dt: number, state: FightRenderState) {
    if (!this.rigs) return
    this.time += dt
    this.light ??= this.getLightRig()

    // Hitstop drives a global animation freeze that eases back to full speed,
    // giving impacts a crisp, weighty snap instead of a smooth slide.
    if (this.hitstop > 0) this.hitstop = Math.max(0, this.hitstop - dt)
    const targetScale = this.hitstop > 0 ? 0.0 : 1
    // Ease out of the freeze over ~2 frames so it releases with a little punch.
    this.timeScale += (targetScale - this.timeScale) * Math.min(1, dt * (this.hitstop > 0 ? 60 : 22))

    for (const side of ['a', 'b'] as Side[]) {
      const vs = side === 'a' ? state.a : state.b
      const rig = this.rigs[side]
      if (vs.id !== this.lastIds[side]) {
        this.lastIds[side] = vs.id
        this.lastPoses[side] = vs.pose
        rig.setAccent(vs.accent)
        void rig.setPose(vs.pose, vs.id)
      } else if (vs.pose !== this.lastPoses[side]) {
        this.lastPoses[side] = vs.pose
        void rig.setPose(vs.pose, vs.id)
      }
      rig.setShattered(vs.shattered)
      rig.update(dt, vs, this.time, this.light, this.ctx.camera, this.timeScale)
    }
  }

  onEvent(e: FightEvent) {
    if (!this.rigs) return
    switch (e.kind) {
      case 'cast':
        this.rigs[e.attacker].attack(
          e.flavor === 'ult' || e.flavor === 'signature' ? 1 :
          e.flavor === 'heavy' || e.flavor === 'crit' ? 0.6 : 0.3,
        )
        break
      case 'hit': {
        this.rigs[e.target].takeHit(e.power, e.flavor)
        // Freeze on impact — heavier hits hold longer.
        const hs =
          e.flavor === 'ult' || e.flavor === 'signature' ? 0.11 :
          e.flavor === 'crit' ? 0.085 :
          e.flavor === 'ex' ? 0.075 :
          e.flavor === 'heavy' ? 0.065 :
          e.flavor === 'combo' ? 0.05 : 0.035
        this.hitstop = Math.max(this.hitstop, hs)
        this.timeScale = 0
        break
      }
      case 'shatter':
        this.rigs[e.side].setShattered(true)
        break
      case 'ko':
        this.rigs[e.loser].ko()
        break
      case 'round-start':
        this.rigs.a.burnAway(false)
        this.rigs.b.burnAway(false)
        break
    }
  }

  setQuality(q: QualityTier) {
    this.rigs?.a.setQuality(q)
    this.rigs?.b.setQuality(q)
  }

  dispose() {
    this.rigs?.a.dispose()
    this.rigs?.b.dispose()
    this.rigs = null
  }
}
