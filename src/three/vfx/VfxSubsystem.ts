import * as THREE from 'three'
import type {
  EngineContext,
  FightEvent,
  FightRenderState,
  HitFlavor,
  QualityTier,
  Subsystem,
} from '../types'
import { budgetFor, createPools, ParticlePool } from './ParticlePool'
import { stageConfig } from '../stage/StageRegistry'
import type { ScenarioId } from '../../types'

interface FlavorRecipe {
  sparkCount: number
  sparkSpeed: number
  shardCount: number
  ringScale: number
  smokeCount: number
  emberCount: number
  color: number
  color2: number
  intensity: number
}

const RECIPES: Record<HitFlavor, FlavorRecipe> = {
  light: {
    sparkCount: 28, sparkSpeed: 6.5, shardCount: 6, ringScale: 0.45,
    smokeCount: 4, emberCount: 6, color: 0xfff3c4, color2: 0xff9b3d, intensity: 1.5,
  },
  heavy: {
    sparkCount: 64, sparkSpeed: 10, shardCount: 16, ringScale: 0.8,
    smokeCount: 10, emberCount: 14, color: 0xfff0b0, color2: 0xff7a1a, intensity: 2.1,
  },
  crit: {
    sparkCount: 120, sparkSpeed: 14.5, shardCount: 30, ringScale: 1.15,
    smokeCount: 16, emberCount: 26, color: 0xffffff, color2: 0xffd166, intensity: 3.2,
  },
  combo: {
    sparkCount: 96, sparkSpeed: 12, shardCount: 24, ringScale: 1.0,
    smokeCount: 12, emberCount: 20, color: 0xffe08a, color2: 0xf77f00, intensity: 2.6,
  },
  ex: {
    sparkCount: 104, sparkSpeed: 13, shardCount: 26, ringScale: 1.05,
    smokeCount: 12, emberCount: 22, color: 0xc9fbff, color2: 0x00b4d8, intensity: 3.0,
  },
  ult: {
    sparkCount: 180, sparkSpeed: 17, shardCount: 44, ringScale: 1.5,
    smokeCount: 24, emberCount: 40, color: 0xffd9f4, color2: 0xf72585, intensity: 3.6,
  },
  signature: {
    sparkCount: 260, sparkSpeed: 21, shardCount: 64, ringScale: 2.0,
    smokeCount: 34, emberCount: 60, color: 0xffffff, color2: 0xf72585, intensity: 4.4,
  },
}

/**
 * Combat VFX.
 *
 * Impact anatomy — every hit fires the same five-layer stack, scaled by
 * flavour. Layering is the whole trick: one puff of sparks looks cheap, five
 * simultaneous systems with different speeds, lifetimes and blend modes read
 * as an expensive effect.
 *
 *   1. core flash sprite (single hot billboard, 60ms)
 *   2. radial spark burst (fast, additive, gravity)
 *   3. directional shard spray along the hit vector
 *   4. expanding shock ring (screen-aligned annulus)
 *   5. slow smoke + drifting embers for the tail
 */
export class VfxSubsystem implements Subsystem {
  readonly name = 'vfx'

  private ctx!: EngineContext
  private additive!: ParticlePool
  private alpha!: ParticlePool
  private flash!: THREE.Mesh
  private flashMat!: THREE.ShaderMaterial
  private flashLife = 0
  private flashMax = 0.001
  private time = 0
  private ambientTimer = 0
  private quality: QualityTier = 'high'

  init(ctx: EngineContext) {
    this.ctx = ctx
    this.quality = ctx.quality
    const pools = createPools(ctx, budgetFor(ctx.quality))
    this.additive = pools.additive
    this.alpha = pools.alpha
    this.buildFlash()
  }

  private buildFlash() {
    this.flashMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(0xffffff) },
        uAlpha: { value: 0 },
        uSpikes: { value: 1 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv; uniform vec3 uColor; uniform float uAlpha; uniform float uSpikes;
        void main(){
          vec2 d = vUv - 0.5;
          float r = length(d) * 2.0;
          float core = pow(max(0.0, 1.0 - r), 3.0);
          // 4-point anamorphic star
          float ang = atan(d.y, d.x);
          float star = pow(max(0.0, cos(ang * 2.0)), 24.0) + pow(max(0.0, cos(ang * 2.0 + 1.5707)), 24.0);
          star *= pow(max(0.0, 1.0 - r * 0.62), 2.4) * uSpikes;
          float a = (core * 2.0 + star * 1.2) * uAlpha;
          if (a < 0.003) discard;
          gl_FragColor = vec4(uColor * (1.0 + core * 2.0), a);
        }
      `,
    })
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.flashMat)
    this.flash.frustumCulled = false
    this.flash.renderOrder = 30
    this.flash.visible = false
    this.ctx.scene.add(this.flash)
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
        if (e.flavor === 'ult' || e.flavor === 'signature') this.charge(e.attacker)
        break
    }
  }

  private impact(target: 'a' | 'b', attacker: 'a' | 'b', flavor: HitFlavor, power: number) {
    const p = this.ctx.anchors.fighter(target).clone()
    p.z += 0.35
    const r = RECIPES[flavor]
    const scale = 0.65 + power * 0.7
    const c1 = new THREE.Color(r.color)
    const c2 = new THREE.Color(r.color2)
    const away = new THREE.Vector3(attacker === 'a' ? 1 : -1, 0.18, 0.35).normalize()

    // 1. core flash
    this.flashMat.uniforms.uColor.value.copy(c1)
    this.flashMat.uniforms.uSpikes.value = flavor === 'light' ? 0.5 : 1.4
    this.flash.position.copy(p)
    this.flash.scale.setScalar((1.6 + r.ringScale * 1.8) * scale)
    this.flash.visible = true
    this.flashMax = flavor === 'light' ? 0.09 : 0.2
    this.flashLife = this.flashMax

    // 2. radial sparks
    this.additive.emit({
      position: p, count: Math.round(r.sparkCount * scale), speed: r.sparkSpeed,
      speedVariance: 0.6, color: c1, color2: c2, size: 0.1, sizeVariance: 0.6,
      life: 0.42, gravity: -11, drag: 2.4, shape: 'spark',
      intensity: r.intensity, jitter: 0.22, spin: 6,
    })

    // 3. directional shards along the hit vector
    this.additive.emit({
      position: p, count: Math.round(r.shardCount * scale), speed: r.sparkSpeed * 1.35,
      speedVariance: 0.5, direction: away, spread: 0.85, color: c1, color2: c2,
      size: 0.14, sizeVariance: 0.7, life: 0.55, gravity: -8, drag: 1.5,
      shape: 'shard', intensity: r.intensity * 0.9, jitter: 0.15, spin: 12,
    })

    // 4. shock ring
    this.additive.emit({
      position: p, count: 1, speed: 0, color: c1, color2: c2,
      size: 1.1 * r.ringScale * scale, sizeVariance: 0, life: 0.34,
      gravity: 0, drag: 0.001, shape: 'ring', intensity: r.intensity * 1.2, spin: 0,
    })

    // 5. tail: smoke + embers
    this.alpha.emit({
      position: p, count: Math.round(r.smokeCount * scale), speed: 2.2,
      speedVariance: 0.8, color: new THREE.Color(0x2a1d2e), color2: new THREE.Color(0x0d0812),
      size: 0.55, sizeVariance: 0.6, life: 1.15, gravity: 1.1, drag: 1.9,
      shape: 'smoke', intensity: 0.8, jitter: 0.35, spin: 1.2,
    })
    this.additive.emit({
      position: p, count: Math.round(r.emberCount * scale), speed: 3.4,
      speedVariance: 0.9, color: c2, color2: new THREE.Color(0x3a0d05),
      size: 0.055, sizeVariance: 0.8, life: 1.5, gravity: -3.4, drag: 1.1,
      shape: 'ember', intensity: r.intensity * 0.7, jitter: 0.4, spin: 2,
    })

    // Ground scatter — dust kicked off the floor under the impact.
    const feet = this.ctx.anchors.get(`fighter:${target}:feet`)
    if (feet) {
      this.alpha.emit({
        position: feet.clone().add(new THREE.Vector3(0, 0.06, 0.2)),
        count: Math.round(10 * scale), speed: 3.2, speedVariance: 0.7,
        direction: new THREE.Vector3(attacker === 'a' ? 0.7 : -0.7, 0.55, 0.35),
        spread: 0.9, color: new THREE.Color(0x3d2f45), color2: new THREE.Color(0x120c18),
        size: 0.42, sizeVariance: 0.6, life: 0.9, gravity: -2.2, drag: 2.6,
        shape: 'smoke', intensity: 0.9, jitter: 0.3, spin: 1,
      })
    }
  }

  private shatter(side: 'a' | 'b') {
    const p = this.ctx.anchors.fighter(side).clone()
    const c1 = new THREE.Color(0xffdce4)
    const c2 = new THREE.Color(0xef233c)
    this.additive.emit({
      position: p, count: 90, speed: 9, speedVariance: 0.7, color: c1, color2: c2,
      size: 0.2, sizeVariance: 0.8, life: 1.1, gravity: -13, drag: 1.1,
      shape: 'shard', intensity: 3.0, jitter: 0.6, spin: 14,
    })
    this.additive.emit({
      position: p, count: 1, speed: 0, color: c2, color2: c1,
      size: 2.6, life: 0.6, gravity: 0, drag: 0.001, shape: 'ring', intensity: 3.4,
    })
  }

  private ko(loser: 'a' | 'b') {
    const p = this.ctx.anchors.fighter(loser).clone()
    this.additive.emit({
      position: p, count: 300, speed: 18, speedVariance: 0.8,
      color: new THREE.Color(0xffffff), color2: new THREE.Color(0xff5a1f),
      size: 0.16, sizeVariance: 0.9, life: 1.4, gravity: -12, drag: 1.3,
      shape: 'spark', intensity: 4.2, jitter: 0.5, spin: 9,
    })
    this.additive.emit({
      position: p, count: 1, speed: 0, color: new THREE.Color(0xffffff),
      color2: new THREE.Color(0xffd166), size: 4.5, life: 0.8, gravity: 0,
      drag: 0.001, shape: 'ring', intensity: 5,
    })
    this.alpha.emit({
      position: p, count: 40, speed: 4.5, speedVariance: 0.8,
      color: new THREE.Color(0x33252e), color2: new THREE.Color(0x0a0610),
      size: 1.1, sizeVariance: 0.7, life: 2.2, gravity: 0.8, drag: 1.6,
      shape: 'smoke', intensity: 0.9, jitter: 0.8, spin: 0.8,
    })
  }

  private charge(side: 'a' | 'b') {
    const p = this.ctx.anchors.fighter(side).clone()
    // Implosion: particles spawned outward with negative drag read as suction
    // once the size curve shrinks them into the body.
    this.additive.emit({
      position: p, count: 120, speed: 7.5, speedVariance: 0.5,
      color: new THREE.Color(0xffd9f4), color2: new THREE.Color(0xf72585),
      size: 0.13, sizeVariance: 0.6, life: 0.85, gravity: 2.2, drag: 4.5,
      shape: 'streak', intensity: 3.4, jitter: 2.4, spin: 3,
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
    this.additive.update(dt)
    this.alpha.update(dt)
    this.ambient(dt, state.scenario)

    if (this.flashLife > 0) {
      this.flashLife = Math.max(0, this.flashLife - dt)
      const t = this.flashLife / this.flashMax
      this.flashMat.uniforms.uAlpha.value = t * t * 1.6
      this.flash.lookAt(this.ctx.camera.position)
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
  }

  dispose() {
    this.additive.dispose()
    this.alpha.dispose()
    this.flash.geometry.dispose()
    this.flashMat.dispose()
    this.flash.parent?.remove(this.flash)
  }
}
