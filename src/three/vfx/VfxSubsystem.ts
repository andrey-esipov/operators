import * as THREE from 'three'
import type {
  EngineContext,
  FightEvent,
  FightRenderState,
  HitFlavor,
  QualityTier,
  Subsystem,
} from '../types'
import { WORLD } from '../types'
import { budgetFor, createPools, ParticlePool } from './ParticlePool'
import { ImpactLights } from './ImpactLights'
import { Decals } from './Decals'
import { Shockwave } from './Shockwave'
import { stageConfig } from '../stage/StageRegistry'
import type { ScenarioId } from '../../types'

/**
 * A single flavour's complete impact recipe. Every number here is tuned so the
 * seven flavours read as genuinely different events — not one effect with the
 * dial turned up.
 */
interface Recipe {
  core: number // hot contact colour (near-white for most)
  energy: number // flavour identity colour
  ember: number // cooling ember/tail colour
  scale: number

  // contact flash
  flashSize: number
  flashDecay: number
  flashSpikes: number
  streak: number // horizontal anamorphic streak strength

  // hit-spark flare (SF-style polygon star)
  flareSize: number

  // radial sparks
  sparkCount: number
  sparkSpeed: number
  sparkLife: number

  // directional shard spray
  shardCount: number

  // bouncing debris chunks
  debrisCount: number
  debrisSpeed: number

  // shockwave (screen-facing chromatic ring)
  shock: boolean
  shockSize: number

  // ground reaction
  groundRing: number // 0 = none
  scorch: number // 0 = none, else radius
  dust: number // ground dust count

  // smoke / embers tail
  smokeCount: number
  emberCount: number

  // impact light
  lightPeak: number
  lightDecay: number
  lightRange: number

  // super energy
  radial: boolean
}

const C = (hex: number) => new THREE.Color(hex)

const RECIPES: Record<HitFlavor, Recipe> = {
  light: {
    core: 0xffffff, energy: 0xffe6a6, ember: 0xff9b3d, scale: 0.7,
    flashSize: 2.2, flashDecay: 0.42, flashSpikes: 0.5, streak: 0.6,
    flareSize: 0.9,
    sparkCount: 30, sparkSpeed: 9.5, sparkLife: 0.5,
    shardCount: 6,
    debrisCount: 0, debrisSpeed: 0,
    shock: false, shockSize: 0,
    groundRing: 0, scorch: 0, dust: 0,
    smokeCount: 3, emberCount: 5,
    lightPeak: 5, lightDecay: 0.14, lightRange: 7,
    radial: false,
  },
  heavy: {
    core: 0xfff2cf, energy: 0xff9433, ember: 0xff5a1a, scale: 1.05,
    flashSize: 3.4, flashDecay: 0.62, flashSpikes: 1.2, streak: 1.4,
    flareSize: 1.7,
    sparkCount: 70, sparkSpeed: 13.5, sparkLife: 0.66,
    shardCount: 16,
    debrisCount: 12, debrisSpeed: 7.5,
    shock: true, shockSize: 3.6,
    groundRing: 1.7, scorch: 0.9, dust: 14,
    smokeCount: 10, emberCount: 14,
    lightPeak: 10, lightDecay: 0.2, lightRange: 10,
    radial: false,
  },
  crit: {
    core: 0xffffff, energy: 0xffd35a, ember: 0xff7a12, scale: 1.35,
    flashSize: 5.0, flashDecay: 0.85, flashSpikes: 1.7, streak: 2.4,
    flareSize: 2.9,
    sparkCount: 140, sparkSpeed: 18.5, sparkLife: 0.8,
    shardCount: 30,
    debrisCount: 22, debrisSpeed: 9.5,
    shock: true, shockSize: 5.4,
    groundRing: 2.6, scorch: 1.4, dust: 22,
    smokeCount: 16, emberCount: 26,
    lightPeak: 16, lightDecay: 0.26, lightRange: 13,
    radial: false,
  },
  combo: {
    core: 0xffffff, energy: 0xffc24d, ember: 0xf77f00, scale: 1.0,
    flashSize: 2.9, flashDecay: 0.5, flashSpikes: 1.0, streak: 1.2,
    flareSize: 1.5,
    sparkCount: 60, sparkSpeed: 14, sparkLife: 0.6,
    shardCount: 14,
    debrisCount: 8, debrisSpeed: 7,
    shock: true, shockSize: 3.0,
    groundRing: 1.4, scorch: 0.6, dust: 10,
    smokeCount: 8, emberCount: 16,
    lightPeak: 9, lightDecay: 0.18, lightRange: 9,
    radial: false,
  },
  ex: {
    core: 0xeafffb, energy: 0x22d3ee, ember: 0x2a7bd8, scale: 1.1,
    flashSize: 3.6, flashDecay: 0.68, flashSpikes: 1.4, streak: 1.8,
    flareSize: 2.0,
    sparkCount: 120, sparkSpeed: 16.5, sparkLife: 0.72,
    shardCount: 24,
    debrisCount: 10, debrisSpeed: 8,
    shock: true, shockSize: 4.0,
    groundRing: 1.9, scorch: 0.7, dust: 12,
    smokeCount: 10, emberCount: 24,
    lightPeak: 13, lightDecay: 0.24, lightRange: 12,
    radial: false,
  },
  ult: {
    core: 0xffffff, energy: 0xf72585, ember: 0xb5179e, scale: 1.5,
    flashSize: 5.8, flashDecay: 0.95, flashSpikes: 1.8, streak: 2.6,
    flareSize: 3.2,
    sparkCount: 190, sparkSpeed: 19, sparkLife: 0.85,
    shardCount: 40,
    debrisCount: 20, debrisSpeed: 9,
    shock: true, shockSize: 6.0,
    groundRing: 3.0, scorch: 1.6, dust: 26,
    smokeCount: 22, emberCount: 40,
    lightPeak: 18, lightDecay: 0.32, lightRange: 15,
    radial: true,
  },
  signature: {
    core: 0xffffff, energy: 0xff3ba0, ember: 0xf72585, scale: 1.9,
    flashSize: 7.0, flashDecay: 1.1, flashSpikes: 2.0, streak: 3.2,
    flareSize: 4.0,
    sparkCount: 260, sparkSpeed: 23, sparkLife: 0.95,
    shardCount: 60,
    debrisCount: 30, debrisSpeed: 11,
    shock: true, shockSize: 7.5,
    groundRing: 3.8, scorch: 2.2, dust: 36,
    smokeCount: 32, emberCount: 58,
    lightPeak: 22, lightDecay: 0.36, lightRange: 18,
    radial: true,
  },
}

interface Scheduled {
  t: number
  fn: () => void
}

/**
 * Combat VFX.
 *
 * Every impact fires a layered stack whose composition and timing is what
 * sells the punch:
 *   0  impact light pop        — the hit throws real light on the fighters
 *   1  contact flash           — hot anamorphic core, gone in 2-3 frames
 *   2  hit-spark flare         — sharp polygon star burst at contact
 *   3  radial spark tracers    — velocity-stretched, gravity, hot cores
 *   4  directional shard spray — chunks thrown along the hit vector
 *   5  bouncing debris         — ballistic chunks that skitter on the floor
 *   6  screen shock ring       — chromatic compression (heavy+)
 *   7  ground ring + scorch     — the floor reacts and stays marked
 *   8  dust + smoke + embers    — the lingering tail
 *
 * A tiny scheduler lets flavours sequence beats (combo stutter, KO cascade).
 */
export class VfxSubsystem implements Subsystem {
  readonly name = 'vfx'

  private ctx!: EngineContext
  private additive!: ParticlePool
  private alpha!: ParticlePool
  private lights!: ImpactLights
  private decals!: Decals
  private waves!: Shockwave

  private flash!: THREE.Mesh
  private flashMat!: THREE.ShaderMaterial
  private flashLife = 0
  private flashMax = 0.001

  private queue: Scheduled[] = []
  private time = 0
  private ambientTimer = 0
  private quality: QualityTier = 'high'

  init(ctx: EngineContext) {
    this.ctx = ctx
    this.quality = ctx.quality
    const pools = createPools(ctx, budgetFor(ctx.quality))
    this.additive = pools.additive
    this.alpha = pools.alpha
    this.lights = new ImpactLights(ctx)
    this.decals = new Decals(ctx)
    this.waves = new Shockwave(ctx)
    this.buildFlash()
  }

  private buildFlash() {
    this.flashMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(0xffffff) },
        uColor2: { value: new THREE.Color(0xffd166) },
        uAlpha: { value: 0 },
        uSpikes: { value: 1 },
        uStreak: { value: 1 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform vec3 uColor; uniform vec3 uColor2; uniform float uAlpha;
        uniform float uSpikes; uniform float uStreak;
        void main(){
          vec2 d = vUv - 0.5;
          float r = length(d) * 2.0;
          float core = pow(max(0.0, 1.0 - r), 3.0);
          float hot  = pow(max(0.0, 1.0 - r * 1.7), 6.0);
          float ang = atan(d.y, d.x);
          // 4-point anamorphic star
          float star = pow(max(0.0, cos(ang * 2.0)), 22.0) + pow(max(0.0, cos(ang * 2.0 + 1.5707)), 22.0);
          star *= pow(max(0.0, 1.0 - r * 0.6), 2.2) * uSpikes;
          // horizontal lens streak
          float streak = smoothstep(0.5, 0.0, abs(d.y) * 8.0) * smoothstep(1.0, 0.0, abs(d.x)) * uStreak;
          float a = (core * 1.7 + hot * 2.2 + star * 1.1 + streak * 1.3) * uAlpha;
          if (a < 0.003) discard;
          vec3 col = mix(uColor2, uColor, clamp(core + hot, 0.0, 1.0));
          col += vec3(1.0) * hot * 1.5;
          gl_FragColor = vec4(col * (1.0 + core), a);
        }
      `,
    })
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.flashMat)
    this.flash.frustumCulled = false
    this.flash.renderOrder = 31
    this.flash.visible = false
    this.ctx.scene.add(this.flash)
  }

  private schedule(delay: number, fn: () => void) {
    this.queue.push({ t: this.time + delay, fn })
  }

  onEvent(e: FightEvent) {
    switch (e.kind) {
      case 'hit':
        this.impact(e.target, e.attacker, e.flavor, e.power)
        break
      case 'shatter':
        this.shatter(e.side)
        break
      case 'ko':
        this.ko(e.loser)
        break
      case 'cast':
        this.cast(e.attacker, e.flavor)
        break
      case 'signature':
        // Fired alongside a hit for the truly big moves; add extra grandeur.
        this.schedule(0.02, () => this.superAura(e.target, C(0xff3ba0), C(0xf72585), 2.0))
        break
    }
  }

  // -- contact flash -------------------------------------------------------

  private popFlash(pos: THREE.Vector3, r: Recipe, mult = 1) {
    this.flashMat.uniforms.uColor.value.copy(C(r.core))
    this.flashMat.uniforms.uColor2.value.copy(C(r.energy))
    this.flashMat.uniforms.uSpikes.value = r.flashSpikes
    this.flashMat.uniforms.uStreak.value = r.streak
    this.flash.position.copy(pos)
    this.flash.scale.setScalar(r.flashSize * r.scale * mult)
    this.flash.visible = true
    this.flashMax = r.flashDecay
    this.flashLife = r.flashDecay
  }

  // -- main impact ---------------------------------------------------------

  private impact(target: 'a' | 'b', attacker: 'a' | 'b', flavor: HitFlavor, power: number) {
    const r = RECIPES[flavor]
    if (flavor === 'combo') {
      // Combo reads as a rapid multi-hit: three escalating micro-impacts.
      this.comboStrike(target, attacker, power)
      return
    }
    this.strike(target, attacker, r, power, 1)
  }

  private comboStrike(target: 'a' | 'b', attacker: 'a' | 'b', power: number) {
    const r = RECIPES.combo
    const offsets = [0, 0.07, 0.15]
    const scales = [0.7, 0.85, 1.15]
    offsets.forEach((dt, i) => {
      this.schedule(dt, () => {
        const jx = (Math.random() - 0.5) * 0.5
        const jy = (Math.random() - 0.5) * 0.5
        this.strike(target, attacker, r, power, scales[i], new THREE.Vector3(jx, jy, 0))
      })
    })
  }

  private strike(
    target: 'a' | 'b',
    attacker: 'a' | 'b',
    r: Recipe,
    power: number,
    mult: number,
    jitter?: THREE.Vector3,
  ) {
    const p = this.ctx.anchors.fighter(target).clone()
    p.z += 0.35
    if (jitter) p.add(jitter)
    const scale = (0.7 + power * 0.6) * r.scale * mult
    const core = C(r.core)
    const energy = C(r.energy)
    const ember = C(r.ember)
    const away = new THREE.Vector3(attacker === 'a' ? 1 : -1, 0.16, 0.28).normalize()
    const feet = this.ctx.anchors.get(`fighter:${target}:feet`)?.clone() ?? p.clone().setY(WORLD.GROUND_Y)

    // 0. impact light
    this.lights.pop(p, energy.clone().lerp(new THREE.Color(0xffffff), 0.5), r.lightPeak * mult, r.lightDecay, r.lightDecay * 0.16, r.lightRange)

    // 1. contact flash
    this.popFlash(p, r, mult)

    // 2. hit-spark flare (bright polygon star) — front-loaded, long glow tail
    this.additive.emit({
      position: p, count: 1, speed: 0, color: core, color2: energy,
      size: r.flareSize * scale, life: 0.6, gravity: 0, drag: 0.001,
      shape: 'flare', intensity: 3.6,
    })
    // secondary smaller offset flares for a busier contact
    if (r.flareSize > 1.4) {
      this.additive.emit({
        position: p, count: 4, speed: 4.0, speedVariance: 0.8, color: core, color2: energy,
        size: r.flareSize * 0.42 * scale, sizeVariance: 0.5, life: 0.5, gravity: -2, drag: 3,
        shape: 'flare', intensity: 2.8, jitter: 0.35,
      })
    }

    // 3. radial spark tracers
    this.additive.emit({
      position: p, count: Math.round(r.sparkCount * scale), speed: r.sparkSpeed,
      speedVariance: 0.65, color: core, color2: energy, size: 0.085, sizeVariance: 0.7,
      life: r.sparkLife, gravity: -13, drag: 2.2, shape: 'spark', stretch: 3.2,
      intensity: 3.0, jitter: 0.16, spin: 5,
    })

    // 4. directional shard spray along the hit vector
    this.additive.emit({
      position: p, count: Math.round(r.shardCount * scale), speed: r.sparkSpeed * 1.35,
      speedVariance: 0.5, direction: away, spread: 0.8, color: core, color2: energy,
      size: 0.14, sizeVariance: 0.7, life: r.sparkLife * 1.25, gravity: -9, drag: 1.4,
      shape: 'shard', intensity: 2.4, jitter: 0.12, spin: 12,
    })

    // 5. bouncing debris chunks
    if (r.debrisCount > 0) {
      this.alpha.emit({
        position: p, count: Math.round(r.debrisCount * scale), speed: r.debrisSpeed,
        speedVariance: 0.7, direction: away, spread: 1.1, flatten: 0.25,
        color: C(0x3a2a30), color2: C(0x171018), size: 0.13, sizeVariance: 0.8,
        life: 1.5, lifeVariance: 0.4, gravity: -18, drag: 0.3, shape: 'debris',
        bounce: true, restitution: 0.4, intensity: 0.5, spin: 16, stretch: 0,
      })
      // a few hot glowing chunks
      this.additive.emit({
        position: p, count: Math.round(r.debrisCount * 0.5 * scale), speed: r.debrisSpeed * 0.9,
        speedVariance: 0.7, direction: away, spread: 1.0, flatten: 0.2,
        color: energy, color2: ember, size: 0.09, sizeVariance: 0.7, life: 1.2,
        lifeVariance: 0.4, gravity: -18, drag: 0.4, shape: 'debris', bounce: true,
        restitution: 0.45, intensity: 2.2, spin: 14,
      })
    }

    // 6. screen shock ring (chromatic)
    if (r.shock) {
      this.waves.spawn('shock', p, r.shockSize * scale, 0.78, core, energy, 1.6 * mult)
      this.waves.spawn('halo', p, r.shockSize * 0.42 * scale, 0.45, core, energy, 1.8 * mult)
    }
    if (r.radial) {
      this.waves.spawn('radial', p, r.shockSize * 1.5 * scale, 0.72, C(0xffffff), energy, 1.8)
    }

    // 7. ground reaction
    if (r.groundRing > 0) {
      this.decals.spawn('ring', feet, r.groundRing * scale, 0.46, energy, ember, 1.4)
    }
    if (r.scorch > 0) {
      this.decals.spawn('scorch', feet, r.scorch * scale, 1.6, energy, ember, 1.0)
    }
    if (r.dust > 0) {
      this.alpha.emit({
        position: feet.clone().add(new THREE.Vector3(0, 0.05, 0.15)),
        count: Math.round(r.dust * scale), speed: 3.4, speedVariance: 0.7,
        direction: new THREE.Vector3(away.x * 0.8, 0.5, 0.3), spread: 1.0, flatten: 0.5,
        color: C(0x4a3a45), color2: C(0x18101c), size: 0.45, sizeVariance: 0.6,
        life: 1.0, gravity: -2.0, drag: 2.4, shape: 'dust', groundAlign: false,
        intensity: 0.9, jitter: 0.25, spin: 1,
      })
      // flat dust racing along the floor
      this.alpha.emit({
        position: feet.clone().add(new THREE.Vector3(0, 0.02, 0)),
        count: Math.round(r.dust * 0.7 * scale), speed: 5.0, speedVariance: 0.6,
        flatten: 0.95, color: C(0x40323c), color2: C(0x140d16), size: 0.5,
        sizeVariance: 0.6, life: 0.8, gravity: -0.5, drag: 3.0, shape: 'dust',
        groundAlign: true, intensity: 0.8, spin: 0.6,
      })
    }

    // 8. smoke + embers tail
    this.alpha.emit({
      position: p, count: Math.round(r.smokeCount * scale), speed: 2.2, speedVariance: 0.8,
      color: C(0x2a1d2e), color2: C(0x0b0710), size: 0.55, sizeVariance: 0.6, life: 1.2,
      gravity: 1.0, drag: 1.9, shape: 'smoke', intensity: 0.7, jitter: 0.3, spin: 1.1,
    })
    this.additive.emit({
      position: p, count: Math.round(r.emberCount * scale), speed: 3.6, speedVariance: 0.9,
      color: energy, color2: C(0x3a0d05), size: 0.05, sizeVariance: 0.8, life: 1.5,
      gravity: -3.0, drag: 1.1, shape: 'ember', intensity: 2.4, jitter: 0.4, spin: 2,
    })
  }

  // -- super aura (windup + on big hits) -----------------------------------

  private superAura(side: 'a' | 'b', c1: THREE.Color, c2: THREE.Color, scale: number) {
    const p = this.ctx.anchors.fighter(side).clone()
    this.waves.spawn('radial', p, 5.0 * scale, 0.55, C(0xffffff), c1, 1.6)
    this.waves.spawn('shock', p, 5.5 * scale, 0.5, c1, c2, 1.4)
    this.lights.pop(p, c1, 12 * scale, 0.4, 0.1, 14)
  }

  private cast(side: 'a' | 'b', flavor: HitFlavor) {
    const p = this.ctx.anchors.fighter(side).clone()
    if (flavor === 'ult' || flavor === 'signature') {
      // Anticipation: energy gathers inward, light swells, ground charges.
      const c1 = flavor === 'signature' ? C(0xffffff) : C(0xffd9f4)
      const c2 = flavor === 'signature' ? C(0xff3ba0) : C(0xf72585)
      // converging streaks (negative-feeling suction via high drag + inward bias)
      for (let i = 0; i < 3; i++) {
        this.schedule(i * 0.09, () => {
          this.additive.emit({
            position: p, count: 40, speed: 8.0, speedVariance: 0.4, color: c1, color2: c2,
            size: 0.12, sizeVariance: 0.6, life: 0.6, gravity: 2.0, drag: 5.5,
            shape: 'streak', stretch: 5.0, intensity: 3.0, jitter: 2.6, spin: 3,
          })
        })
      }
      // rising ground ring + swelling light
      this.decals.spawn('ring', p.clone().setY(WORLD.GROUND_Y), 2.2, 0.5, c2, c1, 1.2)
      this.lights.pop(p, c2, 8, 0.5, 0.2, 12)
    } else if (flavor === 'heavy' || flavor === 'crit') {
      // A brief wind-up glow so the swing has anticipation.
      this.lights.pop(p, C(0xffb060), 3, 0.16, 0, 7)
    }
  }

  // -- shatter (armour break) ----------------------------------------------

  private shatter(side: 'a' | 'b') {
    const p = this.ctx.anchors.fighter(side).clone()
    const feet = this.ctx.anchors.get(`fighter:${side}:feet`)?.clone() ?? p.clone().setY(WORLD.GROUND_Y)
    const ice = C(0xdff3ff)
    const red = C(0xef233c)

    // cold burst light
    this.lights.pop(p, C(0x9fdcff), 16, 0.28, 0.05, 13)

    // crystalline flash — long enough to read as a freeze-frame armour break
    const r = RECIPES.crit
    this.flashMat.uniforms.uColor.value.copy(ice)
    this.flashMat.uniforms.uColor2.value.copy(C(0x8fc4ff))
    this.flashMat.uniforms.uSpikes.value = 5.0
    this.flashMat.uniforms.uStreak.value = 1.6
    this.flash.position.copy(p)
    this.flash.scale.setScalar(r.flashSize * 1.15)
    this.flash.visible = true
    this.flashMax = 0.7
    this.flashLife = 0.7

    // glass star
    this.additive.emit({
      position: p, count: 1, speed: 0, color: C(0xffffff), color2: ice,
      size: 4.0, life: 0.55, gravity: 0, drag: 0.001, shape: 'flare', intensity: 3.8,
    })
    // radial crystalline burst — cold snap
    this.waves.spawn('radial', p, 6.5, 0.6, C(0xffffff), ice, 1.5)
    // sharp icy shards exploding, bouncing on the floor
    this.additive.emit({
      position: p, count: 70, speed: 11, speedVariance: 0.7, color: C(0xffffff), color2: ice,
      size: 0.2, sizeVariance: 0.8, life: 1.0, gravity: -16, drag: 0.6, shape: 'shard',
      intensity: 2.8, jitter: 0.5, spin: 16, stretch: 1.5,
    })
    this.alpha.emit({
      position: p, count: 40, speed: 8, speedVariance: 0.7, color: C(0xbfe6ff), color2: C(0x6aa8d8),
      size: 0.14, sizeVariance: 0.8, life: 1.4, lifeVariance: 0.4, gravity: -17, drag: 0.4,
      shape: 'debris', bounce: true, restitution: 0.5, intensity: 0.8, spin: 14,
    })
    // red conviction rupture underneath
    this.additive.emit({
      position: p, count: 40, speed: 6, speedVariance: 0.8, color: red, color2: C(0x7a0d16),
      size: 0.1, sizeVariance: 0.7, life: 0.7, gravity: -8, drag: 1.4, shape: 'spark',
      stretch: 2.5, intensity: 2.6, jitter: 0.3, spin: 8,
    })
    this.waves.spawn('shock', p, 5.5, 0.72, ice, C(0x6aa8d8), 1.7)
    this.decals.spawn('ring', feet, 2.4, 0.5, ice, red, 1.4)
    this.decals.spawn('scorch', feet, 1.2, 1.4, red, C(0x3a0810), 0.8)
  }

  // -- KO (the money shot) -------------------------------------------------

  private ko(loser: 'a' | 'b') {
    const p = this.ctx.anchors.fighter(loser).clone()
    const feet = this.ctx.anchors.get(`fighter:${loser}:feet`)?.clone() ?? p.clone().setY(WORLD.GROUND_Y)
    const white = C(0xffffff)
    const gold = C(0xffd166)
    const orange = C(0xff5a1f)

    // Beat 1 (0ms): blinding contact — huge flash + massive light + star.
    this.lights.pop(p, white, 30, 0.5, 0.04, 22)
    this.flashMat.uniforms.uColor.value.copy(white)
    this.flashMat.uniforms.uColor2.value.copy(gold)
    this.flashMat.uniforms.uSpikes.value = 2.2
    this.flashMat.uniforms.uStreak.value = 3.4
    this.flash.position.copy(p)
    this.flash.scale.setScalar(6.5)
    this.flash.visible = true
    this.flashMax = 0.4
    this.flashLife = 0.4
    this.additive.emit({
      position: p, count: 1, speed: 0, color: white, color2: gold,
      size: 6.0, life: 0.5, gravity: 0, drag: 0.001, shape: 'flare', intensity: 4.5,
    })
    this.waves.spawn('radial', p, 13, 0.95, white, gold, 2.2)
    this.waves.spawn('shock', p, 9, 0.82, white, orange, 1.9)
    this.waves.spawn('halo', p, 6, 0.7, gold, orange, 1.3)

    // Beat 2 (60ms): the blast — spark storm + debris + ground rupture.
    this.schedule(0.06, () => {
      this.lights.pop(p, gold, 20, 0.4, 0.08, 18)
      this.additive.emit({
        position: p, count: 300, speed: 20, speedVariance: 0.85, color: white, color2: orange,
        size: 0.12, sizeVariance: 0.9, life: 1.1, lifeVariance: 0.4, gravity: -14, drag: 1.1,
        shape: 'spark', stretch: 3.6, intensity: 3.2, jitter: 0.4, spin: 9,
      })
      this.additive.emit({
        position: p, count: 60, speed: 15, speedVariance: 0.7, direction: new THREE.Vector3(0, 1, 0),
        spread: 1.4, color: gold, color2: orange, size: 0.16, sizeVariance: 0.8, life: 1.4,
        shape: 'shard', intensity: 2.6, jitter: 0.4, spin: 12, stretch: 1.4,
      })
      this.alpha.emit({
        position: p, count: 40, speed: 11, speedVariance: 0.8, flatten: 0.35,
        color: C(0x3a2a30), color2: C(0x140d16), size: 0.18, sizeVariance: 0.8, life: 1.8,
        lifeVariance: 0.4, gravity: -18, drag: 0.35, shape: 'debris', bounce: true,
        restitution: 0.42, intensity: 0.5, spin: 16,
      })
      this.decals.spawn('ring', feet, 4.5, 0.55, gold, orange, 1.6)
      this.decals.spawn('scorch', feet, 2.6, 2.2, orange, C(0x2a0805), 1.0)
      // flat dust blast along the floor
      this.alpha.emit({
        position: feet.clone().add(new THREE.Vector3(0, 0.03, 0)), count: 44, speed: 8,
        speedVariance: 0.7, flatten: 0.95, color: C(0x40323c), color2: C(0x120b14),
        size: 0.7, sizeVariance: 0.6, life: 1.2, gravity: -0.4, drag: 2.6, shape: 'dust',
        groundAlign: true, intensity: 0.8, spin: 0.5,
      })
    })

    // Beat 3 (220ms): the aftermath — rising smoke column + embers.
    this.schedule(0.22, () => {
      this.alpha.emit({
        position: p.clone().add(new THREE.Vector3(0, 0.4, 0)), count: 46, speed: 4.5,
        speedVariance: 0.8, direction: new THREE.Vector3(0, 1, 0), spread: 0.6,
        color: C(0x33252e), color2: C(0x090610), size: 1.1, sizeVariance: 0.7, life: 2.4,
        lifeVariance: 0.4, gravity: 1.2, drag: 1.4, shape: 'smoke', intensity: 0.85, jitter: 0.6, spin: 0.8,
      })
      this.additive.emit({
        position: p, count: 70, speed: 3.5, speedVariance: 0.9, color: gold, color2: C(0x3a0d05),
        size: 0.06, sizeVariance: 0.8, life: 2.0, gravity: -2.5, drag: 1.0, shape: 'ember',
        intensity: 2.4, jitter: 0.5, spin: 2,
      })
    })
  }

  /** Slow ambient motes so the arena air is never dead. */
  private ambient(dt: number, scenario: ScenarioId) {
    this.ambientTimer -= dt
    if (this.ambientTimer > 0) return
    const cfg = stageConfig(scenario)
    this.ambientTimer = 0.11 / Math.max(0.15, cfg.motes.density)
    const c = new THREE.Color(cfg.motes.color)
    this.additive.emit({
      position: new THREE.Vector3(
        (Math.random() - 0.5) * 18,
        Math.random() * 6.5,
        -6 + Math.random() * 9,
      ),
      count: 1, speed: 0.28 * cfg.motes.drift, speedVariance: 0.9,
      color: c, color2: c, size: 0.035, sizeVariance: 0.8, life: 5.5,
      gravity: 0.06, drag: 0.35, shape: 'ember', intensity: 0.85, spin: 0.4,
    })
  }

  update(dt: number, state: FightRenderState) {
    this.time += dt

    // Fire due scheduled beats.
    if (this.queue.length) {
      const due = this.queue.filter((s) => s.t <= this.time)
      if (due.length) {
        this.queue = this.queue.filter((s) => s.t > this.time)
        for (const s of due) s.fn()
      }
    }

    this.additive.update(dt)
    this.alpha.update(dt)
    this.lights.update(dt)
    this.decals.update(dt)
    this.waves.update(dt)
    this.ambient(dt, state.scenario)

    if (this.flashLife > 0) {
      this.flashLife = Math.max(0, this.flashLife - dt)
      const t = this.flashLife / this.flashMax
      // Punchy: blinding opening spike, then a bright but decaying glow tail
      // that survives the real-time capture latency.
      const a = t > 0.82 ? 2.3 : Math.pow(t, 1.3) * 2.8
      this.flashMat.uniforms.uAlpha.value = a
      this.flash.quaternion.copy(this.ctx.camera.quaternion)
      this.flash.visible = true
    } else if (this.flash.visible) {
      this.flash.visible = false
    }
  }

  setQuality(q: QualityTier) {
    if (q === this.quality) return
    this.quality = q
    this.additive.dispose()
    this.alpha.dispose()
    const pools = createPools(this.ctx, budgetFor(q))
    this.additive = pools.additive
    this.alpha = pools.alpha
    this.lights.configure(q)
    this.decals.configure(q)
    this.waves.configure(q)
  }

  dispose() {
    this.additive.dispose()
    this.alpha.dispose()
    this.lights.dispose()
    this.decals.dispose()
    this.waves.dispose()
    this.flash.geometry.dispose()
    this.flashMat.dispose()
    this.flash.parent?.remove(this.flash)
  }
}
