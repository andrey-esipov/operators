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
  private ch = newChannels()
  private set: SpriteTextureSet | null = null
  private prevSet: SpriteTextureSet | null = null
  private currentPose: FighterPose = 'stance'
  private loadToken = 0
  private poseBlend = 1
  private idlePhase: number
  private facing: number
  private baseX: number
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
          // Dense AO core directly under the feet + soft falloff penumbra.
          float core = 1.0 - smoothstep(0.0, 0.55, pow(r, uTight));
          float soft = 1.0 - smoothstep(0.0, 1.0, r);
          float a = clamp(core * 0.85 + soft * 0.35, 0.0, 1.0);
          gl_FragColor = vec4(uColor, a * uOpacity);
        }
      `,
    })
    this.shadow = new THREE.Mesh(geo, this.shadowMat)
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.position.set(0, 0.012, 0.05)
    this.shadow.renderOrder = -1
    this.group.add(this.shadow)
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

    const footW = Math.max(1.2, this.aspect * WORLD.FIGHTER_HEIGHT * 0.9)
    this.shadow.scale.set(footW / 2.6, footW / 2.6, 1)
  }

  setAccent(hex: string) {
    this.accent.set(hex)
    this.uniforms.uAccent.value.copy(this.accent)
  }

  // ---- impulses ----------------------------------------------------------

  attack(power: number) {
    // Anticipation first (pull back), then the spring drives the thrust.
    this.ch.lungeVel += 6.5 + power * 7
    this.ch.leanVel += 4.0 + power * 3.5
    this.ch.squashVelX += 2.2
    this.ch.squashVelY -= 1.4
    this.ch.yawVel += 2.2
  }

  takeHit(power: number, flavor: string) {
    const p = Math.min(1.6, 0.35 + power * 1.5)
    this.ch.knockVel += 5.5 * p
    this.ch.leanVel -= 7 * p
    this.ch.hopVel += (flavor === 'ult' || flavor === 'signature' ? 5.5 : 2.2) * p
    this.ch.squashVelX -= 3.2 * p
    this.ch.squashVelY += 2.4 * p
    this.ch.wobble = Math.min(1.4, this.ch.wobble + p * 0.9)
    this.ch.flash = 1
    this.ch.yawVel -= 3.4 * p
    const hitColor =
      flavor === 'ult' || flavor === 'signature' ? 0xff8fe0 :
      flavor === 'ex' ? 0x9ff3ff :
      flavor === 'crit' ? 0xffffff : 0xfff2c8
    this.uniforms.uHitColor.value.setHex(hitColor)
  }

  ko() {
    this.targetDissolve = 0
    this.ch.knockVel += 7
    this.ch.hopVel += 4
  }

  burnAway(on: boolean) {
    this.targetDissolve = on ? 1 : 0
  }

  setShattered(v: boolean) {
    this.shattered = v ? 1 : 0
  }

  // ---- frame -------------------------------------------------------------

  update(dt: number, vs: FighterVisualState, time: number, light: LightRig | undefined, camera: THREE.PerspectiveCamera) {
    if (!this.ready) return
    const c = this.ch

    // Pose cross-fade
    if (this.poseBlend < 1) {
      this.poseBlend = Math.min(1, this.poseBlend + dt * 11)
      this.uniforms.uPoseBlend.value = this.poseBlend
    }

    // Springs
    ;[c.lunge, c.lungeVel] = spring(c.lunge, c.lungeVel, 0, 210, 19, dt)
    ;[c.knock, c.knockVel] = spring(c.knock, c.knockVel, 0, 120, 13, dt)
    ;[c.hop, c.hopVel] = spring(c.hop, c.hopVel, 0, 150, 14, dt)
    ;[c.lean, c.leanVel] = spring(c.lean, c.leanVel, 0, 180, 17, dt)
    ;[c.squashX, c.squashVelX] = spring(c.squashX, c.squashVelX, 1, 260, 22, dt)
    ;[c.squashY, c.squashVelY] = spring(c.squashY, c.squashVelY, 1, 260, 22, dt)
    ;[c.yaw, c.yawVel] = spring(c.yaw, c.yawVel, 0, 150, 16, dt)
    c.wobble *= Math.exp(-dt * 7.5)
    c.flash *= Math.exp(-dt * 13)

    // Idle breathing — two out-of-phase sines so it never looks metronomic.
    const breath = Math.sin(time * 2.05 + this.idlePhase) * 0.5 + Math.sin(time * 3.31 + this.idlePhase * 1.7) * 0.22
    const lowHp = 1 - vs.hp01
    // Wounded fighters breathe harder and sag.
    const breathAmp = 0.022 + lowHp * 0.03
    const sag = lowHp * 0.05

    // Turn readiness: the active fighter squares up slightly.
    const readyPush = vs.active ? 0.08 : 0

    const dir = 1 // group is already mirrored via scale.x
    this.group.position.x =
      this.baseX + this.facing * (c.lunge * 0.34 - c.knock * 0.5 + readyPush * 0.4)
    this.group.position.y = WORLD.GROUND_Y + Math.max(0, c.hop * 0.16) + breath * breathAmp - sag
    this.group.rotation.y = c.yaw * 0.09 * this.facing
    this.group.rotation.z = -c.lean * 0.012 * this.facing

    this.uniforms.uSquash.value.set(
      c.squashX * (1 + breath * 0.006),
      c.squashY * (1 - breath * 0.008 - sag * 0.12),
    )
    this.uniforms.uLean.value = (c.lean * 0.032 + breath * 0.004) * dir
    this.uniforms.uWobble.value = c.wobble
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
    this.shadowMat.uniforms.uOpacity.value = 0.82 * Math.exp(-lift * 2.4) * (1 - this.dissolve)
    this.shadowMat.uniforms.uTight.value = 1 + lift * 2.4
    this.shadow.position.y = 0.012 - (this.group.position.y - WORLD.GROUND_Y)

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
      rig.update(dt, vs, this.time, this.light, this.ctx.camera)
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
      case 'hit':
        this.rigs[e.target].takeHit(e.power, e.flavor)
        break
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
