import * as THREE from 'three'
import type { FightEvent, HitLevel, Vec2 } from '../../fight/types'
import type { ParticlePool } from '../vfx/ParticlePool'
import type { Shockwave } from '../vfx/Shockwave'
import type { Fighter } from './Fighter'
import type { FightCamera } from './FightCamera'
import { simToWorld } from './worldScale'

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
  hot: THREE.Color
  cool: THREE.Color
}

const HIT: Record<HitLevel, HitTuning> = {
  light:   { count: 26, speed: 7,  size: 0.13, hitstopMs: 60,  hitstopScale: 0.14, shake: 0.10, push: 0.15, core: 1.0, hot: new THREE.Color(0xffffff), cool: new THREE.Color(0xffd27a) },
  medium:  { count: 40, speed: 9,  size: 0.16, hitstopMs: 90,  hitstopScale: 0.09, shake: 0.16, push: 0.28, core: 1.3, hot: new THREE.Color(0xffffff), cool: new THREE.Color(0xffb04a) },
  heavy:   { count: 64, speed: 12, size: 0.20, hitstopMs: 130, hitstopScale: 0.05, shake: 0.26, push: 0.5,  core: 1.7, hot: new THREE.Color(0xfff4e0), cool: new THREE.Color(0xff7a2a) },
  launcher:{ count: 72, speed: 13, size: 0.22, hitstopMs: 140, hitstopScale: 0.05, shake: 0.30, push: 0.6,  core: 1.8, hot: new THREE.Color(0xffffff), cool: new THREE.Color(0x8ad2ff) },
  sweep:   { count: 50, speed: 11, size: 0.19, hitstopMs: 110, hitstopScale: 0.06, shake: 0.22, push: 0.4,  core: 1.5, hot: new THREE.Color(0xfff0dd), cool: new THREE.Color(0xffa030) },
  crumple: { count: 84, speed: 14, size: 0.24, hitstopMs: 170, hitstopScale: 0.03, shake: 0.36, push: 0.7,  core: 2.0, hot: new THREE.Color(0xffffff), cool: new THREE.Color(0xff5a3c) },
}

export interface FightVfxDeps {
  additive: ParticlePool
  alpha: ParticlePool
  shockwave: Shockwave
  fighters: [Fighter, Fighter]
  camera: FightCamera
  /** Bridge to the engine's impact freeze. */
  requestHitstop: (ms: number, scale: number) => void
  /** Emit a translated card-game event so the reused LightRig flash + floor
   *  impact + engine hitstop curve all fire from one place. */
  emitEngine?: (attacker: 0 | 1, target: 0 | 1, level: HitLevel, power: number, kind: 'hit' | 'ko') => void
}

export class FightVfx {
  private d: FightVfxDeps
  private p = new THREE.Vector3()

  constructor(deps: FightVfxDeps) {
    this.d = deps
  }

  handle(e: FightEvent) {
    switch (e.type) {
      case 'hit': return this.hit(e.at, e.attacker, e.level, e.damage)
      case 'block': return this.block(e.at)
      case 'parry': return this.parry(e.at)
      case 'throw': return this.throwFx(e.at)
      case 'launch': return this.launch(e.at)
      case 'knockdown': return this.knockdown(e.at)
      case 'wall-bounce': return this.wallBounce(e.at)
      case 'super-flash': return this.superFlash(e.who)
      case 'ko': return this.ko(e.who)
    }
  }

  private world(at: Vec2): THREE.Vector3 {
    return simToWorld(at, this.p)
  }

  private hit(at: Vec2, attacker: 0 | 1, level: HitLevel, damage: number) {
    const t = HIT[level] ?? HIT.medium
    const pos = this.world(at)
    const power = Math.min(1, damage / 120)

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
    // Contact flare + a thin ring travelling across the silhouette.
    this.d.shockwave.spawn('star', pos, 0.5 + t.core * 0.4, 0.26, t.hot, t.cool, 1.3 + power)
    this.d.shockwave.spawn('shock', pos, 0.4 + t.core * 0.3, 0.34, t.cool, t.hot, 1.0, 1.4)

    // Feel: freeze, shake, dolly punch, and flash the defender.
    this.d.requestHitstop(t.hitstopMs, t.hitstopScale)
    this.d.camera.addShake(t.shake)
    this.d.camera.punchIn(t.push)
    const target = (attacker === 0 ? 1 : 0) as 0 | 1
    this.d.fighters[target]?.triggerHitFlash(0.9)
    this.d.emitEngine?.(attacker, target, level, power, 'hit')
  }

  private block(at: Vec2) {
    const pos = this.world(at)
    const cool = new THREE.Color(0x8fd0ff)
    const white = new THREE.Color(0xeaf6ff)
    this.d.additive.emit({
      position: pos, count: 22, speed: 6, color: white, color2: cool, size: 0.1,
      life: 0.22, gravity: -6, drag: 4, shape: 'spark', intensity: 1.4,
      spawnRadius: 0.2, stretch: 2.2, direction: new THREE.Vector3(0, 1, 0.2), spread: 1.1,
    })
    this.d.shockwave.spawn('shock', pos, 0.42, 0.22, cool, white, 0.9, 1.2)
    this.d.camera.addShake(0.06)
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

  private throwFx(at: Vec2) {
    const pos = this.world(at)
    this.dust(at, 0.6)
    this.d.shockwave.spawn('shock', pos, 0.5, 0.3, new THREE.Color(0xffd9a0), new THREE.Color(0xff8a3c), 0.8)
    this.d.camera.addShake(0.1)
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
