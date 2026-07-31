import * as THREE from 'three'
import { qualityRank, type EngineContext, type QualityTier } from '../types'

/**
 * Impact illumination.
 *
 * A small pool of point lights that flash on contact. This is the single
 * biggest "expensive" tell in a modern fighter: the hit actually throws light
 * onto the fighters and the floor for a few frames, so the punch reads as a
 * real energy event rather than a decal pasted over the scene.
 *
 * Lights are cheap in count but we still gate them by quality — extra dynamic
 * lights cost a full lighting recompute per fragment.
 */
interface Flash {
  light: THREE.PointLight
  life: number
  max: number
  peak: number
  hold: number
}

export class ImpactLights {
  private pool: Flash[] = []
  private scene: THREE.Scene
  private cursor = 0
  private enabled = true

  constructor(ctx: EngineContext) {
    this.scene = ctx.scene
    this.configure(ctx.quality)
  }

  private countFor(q: QualityTier): number {
    switch (q) {
      case 'low': return 0
      case 'medium': return 2
      case 'high': return 4
      case 'ultra': return 5
    }
  }

  configure(q: QualityTier) {
    // Rebuild the pool to match the tier.
    for (const f of this.pool) {
      f.light.parent?.remove(f.light)
      f.light.dispose()
    }
    this.pool = []
    const n = this.countFor(q)
    this.enabled = n > 0 && qualityRank(q) >= 1
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 14, 2.0)
      l.castShadow = false
      l.visible = false
      this.scene.add(l)
      this.pool.push({ light: l, life: 0, max: 1, peak: 0, hold: 0 })
    }
  }

  /**
   * Fire a light pop.
   * @param peak    intensity at the spike
   * @param decay   seconds to fade
   * @param hold    seconds of near-full intensity before the fade (0..decay)
   * @param range   falloff distance
   */
  pop(
    pos: THREE.Vector3,
    color: THREE.Color,
    peak: number,
    decay: number,
    hold = 0,
    range = 10,
  ) {
    if (!this.enabled || this.pool.length === 0) return
    const f = this.pool[this.cursor]
    this.cursor = (this.cursor + 1) % this.pool.length
    f.light.position.copy(pos)
    f.light.color.copy(color)
    f.light.distance = range
    f.light.decay = 1.7
    f.peak = peak
    f.max = decay
    f.life = decay
    f.hold = hold
    f.light.visible = true
    f.light.intensity = peak
  }

  update(dt: number) {
    for (const f of this.pool) {
      if (f.life <= 0) continue
      f.life = Math.max(0, f.life - dt)
      const t = f.life / f.max // 1 -> 0
      let k: number
      const holdFrac = f.max > 0 ? f.hold / f.max : 0
      if (t > 1 - 0.06) {
        // brief super-bright spike on the first frames
        k = 1.15
      } else if (t > 1 - holdFrac - 0.06) {
        k = 1.0
      } else {
        const u = holdFrac < 1 ? t / Math.max(0.0001, 1 - holdFrac) : t
        k = u * u
      }
      f.light.intensity = f.peak * k
      if (f.life <= 0) f.light.visible = false
    }
  }

  dispose() {
    for (const f of this.pool) {
      f.light.parent?.remove(f.light)
      f.light.dispose()
    }
    this.pool = []
  }
}
