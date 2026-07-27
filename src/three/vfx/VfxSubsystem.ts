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

  // crit-only hard geometric impact star
  starBurst?: boolean
  // ex-only crackling electric discharge
  bolt?: boolean
  // signature-only vertical super-flash pillar
  beam?: boolean
  // combo-only violet multi-hit flurry rosette
  combo?: boolean
}

const C = (hex: number) => new THREE.Color(hex)

const RECIPES: Record<HitFlavor, Recipe> = {
  light: {
    core: 0xffffff, energy: 0xffd27a, ember: 0xff9b3d, scale: 0.72,
    flashSize: 2.4, flashDecay: 0.16, flashSpikes: 0.6, streak: 0.7,
    flareSize: 1.2,
    sparkCount: 34, sparkSpeed: 10.5, sparkLife: 0.72,
    shardCount: 8,
    debrisCount: 0, debrisSpeed: 0,
    shock: false, shockSize: 0,
    groundRing: 0.9, scorch: 0, dust: 6,
    smokeCount: 4, emberCount: 8,
    lightPeak: 9, lightDecay: 0.2, lightRange: 8,
    radial: false,
  },
  heavy: {
    core: 0xfff0cf, energy: 0xff6a1e, ember: 0xd81e0a, scale: 1.05,
    flashSize: 3.4, flashDecay: 0.2, flashSpikes: 1.2, streak: 1.4,
    flareSize: 1.7,
    sparkCount: 70, sparkSpeed: 13.5, sparkLife: 0.66,
    shardCount: 16,
    debrisCount: 12, debrisSpeed: 7.5,
    shock: true, shockSize: 3.6,
    groundRing: 1.7, scorch: 0.9, dust: 14,
    smokeCount: 10, emberCount: 14,
    lightPeak: 16, lightDecay: 0.22, lightRange: 12,
    radial: false,
  },
  crit: {
    core: 0xffffff, energy: 0xffd35a, ember: 0xff7a12, scale: 1.35,
    flashSize: 2.1, flashDecay: 0.2, flashSpikes: 1.4, streak: 2.4,
    flareSize: 2.1,
    sparkCount: 140, sparkSpeed: 18.5, sparkLife: 0.8,
    shardCount: 30,
    debrisCount: 26, debrisSpeed: 9.5,
    shock: true, shockSize: 5.4,
    groundRing: 2.6, scorch: 1.4, dust: 22,
    smokeCount: 16, emberCount: 26,
    lightPeak: 24, lightDecay: 0.28, lightRange: 15,
    radial: false, starBurst: true,
  },
  combo: {
    core: 0xffffff, energy: 0xc77dff, ember: 0x8a2be2, scale: 1.05,
    flashSize: 2.4, flashDecay: 0.16, flashSpikes: 1.0, streak: 1.2,
    flareSize: 1.6,
    sparkCount: 70, sparkSpeed: 15, sparkLife: 0.62,
    shardCount: 16,
    debrisCount: 8, debrisSpeed: 7,
    shock: true, shockSize: 3.2,
    groundRing: 1.5, scorch: 0.6, dust: 11,
    smokeCount: 8, emberCount: 18,
    lightPeak: 17, lightDecay: 0.2, lightRange: 11,
    radial: false, combo: true,
  },
  ex: {
    core: 0xeafffb, energy: 0x22d3ee, ember: 0x2a7bd8, scale: 1.1,
    flashSize: 2.3, flashDecay: 0.2, flashSpikes: 0.7, streak: 1.8,
    flareSize: 2.0,
    sparkCount: 120, sparkSpeed: 16.5, sparkLife: 0.72,
    shardCount: 24,
    debrisCount: 10, debrisSpeed: 8,
    shock: true, shockSize: 4.0,
    groundRing: 1.9, scorch: 0.7, dust: 12,
    smokeCount: 10, emberCount: 24,
    lightPeak: 21, lightDecay: 0.26, lightRange: 14,
    radial: false, bolt: true,
  },
  ult: {
    core: 0xffffff, energy: 0xffcf4d, ember: 0xff6a00, scale: 1.5,
    flashSize: 1.3, flashDecay: 0.22, flashSpikes: 1.4, streak: 2.6,
    flareSize: 1.5,
    sparkCount: 130, sparkSpeed: 19, sparkLife: 0.85,
    shardCount: 40,
    debrisCount: 20, debrisSpeed: 9,
    shock: true, shockSize: 6.0,
    groundRing: 3.0, scorch: 1.6, dust: 26,
    smokeCount: 22, emberCount: 26,
    lightPeak: 15, lightDecay: 0.34, lightRange: 14,
    radial: true,
  },
  signature: {
    core: 0xffffff, energy: 0xff3ba0, ember: 0xf72585, scale: 1.55,
    flashSize: 1.5, flashDecay: 0.15, flashSpikes: 1.4, streak: 3.0,
    flareSize: 1.7,
    sparkCount: 240, sparkSpeed: 23, sparkLife: 0.95,
    shardCount: 56,
    debrisCount: 30, debrisSpeed: 11,
    shock: true, shockSize: 6.4,
    groundRing: 3.6, scorch: 2.2, dust: 36,
    smokeCount: 32, emberCount: 54,
    lightPeak: 23, lightDecay: 0.38, lightRange: 17,
    radial: false, beam: true,
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
          float a = (core * 1.1 + hot * 1.3 + star * 0.9 + streak * 1.1) * uAlpha;
          if (a < 0.003) discard;
          vec3 col = mix(uColor2, uColor, clamp(core * 0.55 + hot * 0.8, 0.0, 1.0));
          col += uColor2 * hot * 1.1 + vec3(1.0) * hot * 0.22;
          gl_FragColor = vec4(col * (1.0 + core * 0.7), a);
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
    const p0 = this.ctx.anchors.fighter(target).clone()
    p0.z += 0.35
    const offsets = [0, 0.07, 0.15]
    const scales = [0.95, 0.85, 1.25]
    offsets.forEach((dt, i) => {
      this.schedule(dt, () => {
        const jx = (Math.random() - 0.5) * 0.5
        const jy = (Math.random() - 0.5) * 0.5
        this.strike(target, attacker, r, power, scales[i], new THREE.Vector3(jx, jy, 0))
        // stacked expanding echo ring per hit — sells the rising combo count
        this.waves.spawn(
          'shock',
          p0.clone().add(new THREE.Vector3(jx, jy, 0)),
          (2.6 + i * 1.3) * r.scale,
          0.66 + i * 0.06,
          C(r.core),
          C(r.energy),
          1.3,
          1.0,
        )
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

    // 3. radial spark tracers — stretched, high-velocity
    this.additive.emit({
      position: p, count: Math.round(r.sparkCount * scale), speed: r.sparkSpeed,
      speedVariance: 0.65, color: core, color2: energy, size: 0.11, sizeVariance: 0.75,
      life: r.sparkLife, gravity: -13, drag: 2.2, shape: 'spark', stretch: 4.2,
      intensity: 3.2, jitter: 0.16, spin: 5,
    })

    // 3b. directional impact slash — a few very fast, hard-stretched tracers
    // fired along the punch vector so the hit reads as a violent shear, not a ring.
    this.additive.emit({
      position: p, count: Math.round((6 + r.shardCount * 0.4) * scale), speed: r.sparkSpeed * 1.7,
      speedVariance: 0.4, direction: away, spread: 0.28, color: C(0xffffff), color2: energy,
      size: 0.14, sizeVariance: 0.6, life: r.sparkLife * 0.7, gravity: -4, drag: 1.4,
      shape: 'spark', stretch: 7.5, intensity: 3.6, jitter: 0.05, spin: 0,
    })

    // 4. directional shard spray along the hit vector
    this.additive.emit({
      position: p, count: Math.round(r.shardCount * scale), speed: r.sparkSpeed * 1.35,
      speedVariance: 0.5, direction: away, spread: 0.8, color: core, color2: energy,
      size: 0.17, sizeVariance: 0.7, life: r.sparkLife * 1.25, gravity: -9, drag: 1.4,
      shape: 'shard', intensity: 2.6, jitter: 0.12, spin: 12,
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

    // 6. screen shock ring (chromatic) — routed per flavour so each hit owns a
    // distinct silhouette instead of one recoloured ring.
    if (r.bolt) {
      // EX: forked electric discharge owns the frame — NO halo washing it out.
      this.waves.spawn('bolt', p, r.shockSize * 1.2 * scale, 0.95, C(0xffffff), energy, 2.4 * mult)
    } else if (r.starBurst) {
      // CRIT: the hard impact star dominates — only a faint halo for depth.
      this.waves.spawn('star', p, r.shockSize * 1.5 * scale, 0.92, C(0xffffff), energy, 2.4 * mult)
      this.waves.spawn('halo', p, r.shockSize * 0.4 * scale, 0.5, core, energy, 0.85 * mult)
    } else if (r.beam) {
      // SIGNATURE: anime super-flash pillar. Bright magenta pillar owns the frame;
      // only a small tinted core behind it (a big halo here is what bloomed to a
      // pink blob) so the vertical structure survives the bloom. Narrowed in x
      // (stretchX 0.7) so it reads as a tall column, not a square burst.
      this.waves.spawn('beam', p, r.shockSize * 1.4 * scale, 1.05, C(0xffffff), energy, 2.3 * mult, 0.7)
      this.waves.spawn('halo', p, r.shockSize * 0.3 * scale, 0.46, core, energy, 0.6 * mult)
    } else if (r.combo) {
      // COMBO: violet multi-hit flurry rosette + a compact energy core. Snaps to
      // full size instantly so even the opening micro-hit reads on capture.
      this.waves.spawn('flurry', p, r.shockSize * 1.5 * scale, 0.9, C(0xffffff), energy, 2.2 * mult)
      this.waves.spawn('halo', p, r.shockSize * 0.4 * scale, 0.46, core, energy, 0.9 * mult)
    } else if (r.shock && !r.radial) {
      const shockPos = p.clone().add(away.clone().multiplyScalar(0.35 * scale))
      this.waves.spawn('shock', shockPos, r.shockSize * scale, 0.86, core, energy, 1.7 * mult, 1.18)
      // small tinted core behind the ring so the centre has mass (kills the donut)
      this.waves.spawn('halo', p, r.shockSize * 0.5 * scale, 0.5, core, energy, 1.1 * mult)
    } else {
      // LIGHT: a compact but crisp snap — small energy bloom + a tiny sharp star.
      // Kept alive ~0.9s so even the weakest hit reads on capture, not a bloom dot.
      this.waves.spawn('halo', p, 2.4 * scale, 0.9, core, energy, 1.6 * mult)
      this.waves.spawn('star', p, 3.4 * scale, 0.9, C(0xffffff), energy, 1.9 * mult)
    }
    if (r.radial) {
      // ULT: divine golden sunburst (sharp god-rays + shock ring) crowned with a
      // hard star-flare cross so the centre reads as structured light, not a ball.
      this.waves.spawn('radial', p, r.shockSize * 1.25 * scale, 0.95, C(0xffffff), energy, 1.5)
      this.waves.spawn('star', p, r.shockSize * 0.95 * scale, 0.6, C(0xffffff), energy, 1.4, 1.0)
      this.waves.spawn('shock', p, r.shockSize * 1.9 * scale, 0.9, core, ember, 1.1, 1.0)
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
    p.z += 0.35
    const feet = this.ctx.anchors.get(`fighter:${side}:feet`)?.clone() ?? p.clone().setY(WORLD.GROUND_Y)
    const white = C(0xffffff)
    const cyan = C(0x74e0ff)
    const deep = C(0x2a9bd8)
    const red = C(0xef233c)

    // ── Beat 1 (0ms): the CRACK — blinding cold flash, a hard white impact star
    // and the big faceted glass pane snapping open. This is the spectacular frame.
    // Central emission is kept lean so the CRYSTAL FACET lines are the brightest
    // feature and survive bloom as a shard shell (instead of a soft cyan orb) even
    // on dark, low-key stages.
    this.lights.pop(p, C(0xbfe9ff), 13, 0.3, 0.05, 13)
    // crystalline contact flash — cold, brief, so the CRYSTAL silhouette reads
    this.flashMat.uniforms.uColor.value.copy(white)
    this.flashMat.uniforms.uColor2.value.copy(cyan)
    this.flashMat.uniforms.uSpikes.value = 4.0
    this.flashMat.uniforms.uStreak.value = 2.0
    this.flash.position.copy(p)
    this.flash.scale.setScalar(1.4)
    this.flash.visible = true
    this.flashMax = 0.17
    this.flashLife = 0.17

    // hot white contact flare core
    this.additive.emit({
      position: p, count: 1, speed: 0, color: white, color2: cyan,
      size: 1.3, life: 0.4, gravity: 0, drag: 0.001, shape: 'flare', intensity: 1.1,
    })
    // sharp white impact star — the instant CRACK read (lean so it doesn't dome)
    this.waves.spawn('star', p, 5.2, 0.72, white, cyan, 1.3, 1.0)
    // the big faceted glass pane — shatter's identity, snaps to full size, bright
    // facet shell so the crystal reads as the dominant structure.
    this.waves.spawn('crystal', p, 7.8, 0.95, white, cyan, 3.2)
    // a second inner crimson-conviction pane for the two-tone armour rupture
    this.waves.spawn('crystal', p, 4.8, 0.85, C(0xffd9dd), red, 2.0)
    this.decals.spawn('ring', feet, 2.6, 0.5, cyan, deep, 1.5)
    this.decals.spawn('scorch', feet, 1.2, 1.4, deep, C(0x08202e), 0.7)

    // ── Beat 2 (55ms): the pane EXPLODES into flying glass — hard angular
    // splinters bursting out and skittering on the floor, plus a secondary ring.
    this.schedule(0.055, () => {
      this.lights.pop(p, cyan, 10, 0.28, 0.05, 13)
      // dense icy splinters bursting outward, stretched & spinning
      this.additive.emit({
        position: p, count: 130, speed: 16, speedVariance: 0.85, color: white, color2: cyan,
        size: 0.3, sizeVariance: 0.9, life: 1.15, gravity: -16, drag: 0.5, shape: 'shard',
        intensity: 2.8, jitter: 0.5, spin: 18, stretch: 3.6,
      })
      // heavier glass chunks with real ballistic bounce
      this.alpha.emit({
        position: p, count: 60, speed: 9, speedVariance: 0.7, color: C(0xbfe6ff), color2: C(0x5a9fd0),
        size: 0.18, sizeVariance: 0.8, life: 1.6, lifeVariance: 0.4, gravity: -18, drag: 0.4,
        shape: 'debris', bounce: true, restitution: 0.5, intensity: 0.9, spin: 16,
      })
      // crimson conviction shards snapping through the ice
      this.additive.emit({
        position: p, count: 46, speed: 8, speedVariance: 0.8, color: red, color2: C(0x7a0d16),
        size: 0.14, sizeVariance: 0.7, life: 0.8, gravity: -9, drag: 1.3, shape: 'shard',
        stretch: 2.8, intensity: 2.8, jitter: 0.3, spin: 8,
      })
      // secondary expanding glass ring
      this.waves.spawn('shock', p, 5.5, 0.7, white, cyan, 1.6, 1.0)
      // frost dust settling along the floor plane
      this.alpha.emit({
        position: feet.clone().add(new THREE.Vector3(0, 0.03, 0)), count: 30, speed: 6,
        speedVariance: 0.7, flatten: 0.95, color: C(0x8fb8cc), color2: C(0x24485a), size: 0.5,
        sizeVariance: 0.6, life: 1.0, gravity: -0.5, drag: 2.8, shape: 'dust', groundAlign: true,
        intensity: 0.7, spin: 0.5,
      })
      this.decals.spawn('ring', feet, 3.6, 0.55, cyan, deep, 1.4)
    })
  }

  // -- KO (the money shot) -------------------------------------------------

  private ko(loser: 'a' | 'b') {
    const p = this.ctx.anchors.fighter(loser).clone()
    const feet = this.ctx.anchors.get(`fighter:${loser}:feet`)?.clone() ?? p.clone().setY(WORLD.GROUND_Y)
    const white = C(0xffffff)
    const gold = C(0xffd166)
    const orange = C(0xff5a1f)
    // the KO'd fighter is launched backward — bias the whole blast that way
    const launch = new THREE.Vector3(loser === 'a' ? -1 : 1, 0.35, 0.2).normalize()

    // Beat 1 (0ms): blinding contact — brief flash + massive light + a HERO gold
    // star sheared along the launch. The star (not a white sun) carries the read.
    this.lights.pop(p, white, 26, 0.5, 0.04, 22)
    this.flashMat.uniforms.uColor.value.copy(C(0xffe6a3))
    this.flashMat.uniforms.uColor2.value.copy(orange)
    this.flashMat.uniforms.uSpikes.value = 2.2
    this.flashMat.uniforms.uStreak.value = 3.0
    this.flash.position.copy(p)
    this.flash.scale.setScalar(1.4)
    this.flash.visible = true
    this.flashMax = 0.16
    this.flashLife = 0.16
    this.additive.emit({
      position: p, count: 1, speed: 0, color: gold, color2: orange,
      size: 1.3, life: 0.3, gravity: 0, drag: 0.001, shape: 'flare', intensity: 1.4,
    })
    // hero directional gold star — the defining KO silhouette. Sized LARGE so its
    // spikes punch out well past the central hot mass (otherwise bloom fills the
    // gaps and the money shot reads as a blob instead of a star).
    this.waves.spawn('star', p, 10.5, 1.0, white, gold, 1.5, 1.5)
    // directional compression front punched along the launch vector
    this.waves.spawn('shock', p.clone().add(launch.clone().multiplyScalar(0.7)), 9.0, 0.95, white, orange, 0.85, 1.4)
    // immediate impact crater on the floor so the ground registers the finish
    this.decals.spawn('scorch', feet, 3.0, 2.4, orange, C(0x180402), 1.1)
    this.decals.spawn('ring', feet, 3.4, 0.5, gold, orange, 1.6)
    // dark smoke curtain framing the blast (keeps the centre from blowing to white)
    this.alpha.emit({
      position: p, count: 34, speed: 6.5, speedVariance: 0.8, color: C(0x2a1d24), color2: C(0x080509),
      size: 0.9, sizeVariance: 0.6, life: 1.3, gravity: 0.6, drag: 2.0, shape: 'smoke',
      intensity: 0.7, jitter: 0.5, spin: 1.0,
    })

    // Beat 2 (60ms): the blast — spark storm + debris + ground rupture, all
    // sheared along the launch vector so the force reads as directional.
    this.schedule(0.06, () => {
      this.lights.pop(p, gold, 20, 0.4, 0.08, 18)
      this.additive.emit({
        position: p, count: 240, speed: 21, speedVariance: 0.85, direction: launch, spread: 1.15,
        color: white, color2: orange, size: 0.13, sizeVariance: 0.9, life: 1.1, lifeVariance: 0.4,
        gravity: -14, drag: 1.1, shape: 'spark', stretch: 4.2, intensity: 2.7, jitter: 0.4, spin: 9,
      })
      // a radial minority so it still bursts in all directions
      this.additive.emit({
        position: p, count: 90, speed: 17, speedVariance: 0.85, color: white, color2: orange,
        size: 0.12, sizeVariance: 0.9, life: 1.0, lifeVariance: 0.4, gravity: -14, drag: 1.2,
        shape: 'spark', stretch: 3.4, intensity: 2.5, jitter: 0.4, spin: 9,
      })
      this.additive.emit({
        position: p, count: 70, speed: 16, speedVariance: 0.7, direction: launch,
        spread: 1.0, color: gold, color2: orange, size: 0.18, sizeVariance: 0.8, life: 1.4,
        shape: 'shard', intensity: 2.6, jitter: 0.4, spin: 12, stretch: 1.6,
      })
      // heavy ballistic debris flung along the launch, bouncing on the floor
      this.alpha.emit({
        position: p, count: 64, speed: 13, speedVariance: 0.8, direction: launch, spread: 0.9,
        flatten: 0.3, color: C(0x3a2a30), color2: C(0x140d16), size: 0.2, sizeVariance: 0.85,
        life: 1.9, lifeVariance: 0.4, gravity: -18, drag: 0.32, shape: 'debris', bounce: true,
        restitution: 0.44, intensity: 0.5, spin: 16, stretch: 0,
      })
      this.decals.spawn('ring', feet, 4.5, 0.55, gold, orange, 1.6)
      this.decals.spawn('scorch', feet, 2.6, 2.2, orange, C(0x2a0805), 1.0)
      // flat dust blast racing along the floor
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
      // Punchy: a brief opening spike (2-3 frames) then a fast decay. Kept short
      // and dim on purpose so the STRUCTURED silhouette waves — which live ~0.9s —
      // are what the eye (and the capture) actually reads, not a white blob.
      const a = t > 0.8 ? 1.15 : Math.pow(t, 1.6) * 1.35
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
