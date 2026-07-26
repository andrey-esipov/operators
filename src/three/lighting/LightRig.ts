import * as THREE from 'three'
import type { EngineContext, FightEvent, FightRenderState, QualityTier, Subsystem } from '../types'
import { flagsFor } from '../core/QualityManager'
import { WORLD } from '../types'

/**
 * Shared lighting description consumed by both the standard-material stage
 * geometry and the custom fighter shader. Keeping one source of truth means
 * the fighters are lit by the same rig as the world they stand in — the single
 * biggest thing that stops 2.5D sprites looking pasted on.
 */
export interface LightingDescription {
  keyDir: THREE.Vector3
  keyColor: THREE.Color
  keyIntensity: number
  fillDir: THREE.Vector3
  fillColor: THREE.Color
  fillIntensity: number
  rimDir: THREE.Vector3
  rimColor: THREE.Color
  rimIntensity: number
  ambientColor: THREE.Color
  ambientIntensity: number
  /** Transient per-hit point light. w = radius. */
  flashPos: THREE.Vector4
  flashColor: THREE.Color
  flashIntensity: number
}

export interface StageLightingPreset {
  key: { color: number; intensity: number; dir: [number, number, number] }
  fill: { color: number; intensity: number; dir: [number, number, number] }
  rim: { color: number; intensity: number; dir: [number, number, number] }
  ambient: { color: number; intensity: number }
  /** Exponential-squared fog. */
  fog: { color: number; density: number }
  /** Background clear colour behind everything. */
  background: number
  /** Tone-mapping exposure for this stage. */
  exposure: number
}

const DEFAULT_PRESET: StageLightingPreset = {
  key: { color: 0xfff0dd, intensity: 3.1, dir: [-0.55, 0.72, 0.42] },
  fill: { color: 0x4466aa, intensity: 0.85, dir: [0.7, 0.25, 0.5] },
  rim: { color: 0x88ccff, intensity: 2.4, dir: [0.2, 0.45, -0.9] },
  ambient: { color: 0x2a2440, intensity: 0.55 },
  fog: { color: 0x0a0716, density: 0.021 },
  background: 0x05030b,
  exposure: 1.0,
}

/**
 * Owns every light in the scene plus the shared `LightingDescription` that the
 * fighter shader samples. Also runs the transient "impact flash" light that
 * pops on every hit — cheap, and it sells contact better than any particle.
 */
export class LightRig implements Subsystem {
  readonly name = 'lighting'

  private ctx!: EngineContext
  private key!: THREE.DirectionalLight
  private fill!: THREE.HemisphereLight
  private rim!: THREE.DirectionalLight
  private ambient!: THREE.AmbientLight
  private flash!: THREE.PointLight

  private preset: StageLightingPreset = DEFAULT_PRESET
  private targetPreset: StageLightingPreset = DEFAULT_PRESET
  private blend = 1

  private flashLife = 0
  private flashMax = 0
  private flashPeak = 0

  /** Live description other subsystems read every frame. */
  readonly description: LightingDescription = {
    keyDir: new THREE.Vector3(),
    keyColor: new THREE.Color(),
    keyIntensity: 0,
    fillDir: new THREE.Vector3(),
    fillColor: new THREE.Color(),
    fillIntensity: 0,
    rimDir: new THREE.Vector3(),
    rimColor: new THREE.Color(),
    rimIntensity: 0,
    ambientColor: new THREE.Color(),
    ambientIntensity: 0,
    flashPos: new THREE.Vector4(0, 2, 0, 6),
    flashColor: new THREE.Color(),
    flashIntensity: 0,
  }

  init(ctx: EngineContext) {
    this.ctx = ctx
    const flags = flagsFor(ctx.quality)

    this.key = new THREE.DirectionalLight(0xffffff, 3)
    this.key.castShadow = flags.shadows
    this.key.shadow.mapSize.set(flags.shadowMapSize, flags.shadowMapSize)
    this.key.shadow.camera.near = 0.5
    this.key.shadow.camera.far = 40
    this.key.shadow.camera.left = -10
    this.key.shadow.camera.right = 10
    this.key.shadow.camera.top = 10
    this.key.shadow.camera.bottom = -6
    this.key.shadow.bias = -0.0012
    this.key.shadow.normalBias = 0.035
    this.key.shadow.radius = 3
    ctx.scene.add(this.key)
    ctx.scene.add(this.key.target)

    this.rim = new THREE.DirectionalLight(0xffffff, 2)
    ctx.scene.add(this.rim)
    ctx.scene.add(this.rim.target)

    this.fill = new THREE.HemisphereLight(0x9fc4ff, 0x2a1a30, 0.8)
    ctx.scene.add(this.fill)

    this.ambient = new THREE.AmbientLight(0xffffff, 0.4)
    ctx.scene.add(this.ambient)

    this.flash = new THREE.PointLight(0xffffff, 0, 22, 1.9)
    this.flash.position.set(0, 1.8, 0.9)
    ctx.scene.add(this.flash)

    this.apply(DEFAULT_PRESET, true)
  }

  /** Cross-fade to a stage's lighting preset over `seconds`. */
  setPreset(p: StageLightingPreset, immediate = false) {
    this.targetPreset = p
    if (immediate) this.apply(p, true)
    else this.blend = 0
  }

  private apply(p: StageLightingPreset, immediate: boolean) {
    this.preset = immediate ? p : this.preset
    const d = this.description

    d.keyDir.set(...p.key.dir).normalize()
    d.keyColor.setHex(p.key.color)
    d.keyIntensity = p.key.intensity
    d.fillDir.set(...p.fill.dir).normalize()
    d.fillColor.setHex(p.fill.color)
    d.fillIntensity = p.fill.intensity
    d.rimDir.set(...p.rim.dir).normalize()
    d.rimColor.setHex(p.rim.color)
    d.rimIntensity = p.rim.intensity
    d.ambientColor.setHex(p.ambient.color)
    d.ambientIntensity = p.ambient.intensity

    this.key.color.copy(d.keyColor)
    this.key.intensity = d.keyIntensity
    this.key.position.copy(d.keyDir).multiplyScalar(14)
    this.key.target.position.set(0, WORLD.GROUND_Y + 1.2, 0)

    this.rim.color.copy(d.rimColor)
    this.rim.intensity = d.rimIntensity * 0.5
    this.rim.position.copy(d.rimDir).multiplyScalar(12)
    this.rim.target.position.set(0, WORLD.GROUND_Y + 1.4, 0)

    this.fill.color.copy(d.fillColor)
    this.fill.intensity = d.fillIntensity
    this.ambient.color.copy(d.ambientColor)
    this.ambient.intensity = d.ambientIntensity

    this.ctx.scene.fog = new THREE.FogExp2(p.fog.color, p.fog.density)
    ;(this.ctx.scene.background as THREE.Color)?.setHex?.(p.background)
    this.ctx.renderer.toneMappingExposure = p.exposure
  }

  onEvent(e: FightEvent) {
    if (e.kind === 'hit') {
      const pos = this.ctx.anchors.fighter(e.target)
      const strength =
        e.flavor === 'signature' ? 90 :
        e.flavor === 'ult' ? 70 :
        e.flavor === 'crit' ? 52 :
        e.flavor === 'combo' ? 42 :
        e.flavor === 'ex' ? 46 :
        e.flavor === 'heavy' ? 30 : 18
      const color =
        e.flavor === 'ult' || e.flavor === 'signature' ? 0xff5fc8 :
        e.flavor === 'ex' ? 0x4fe8ff :
        e.flavor === 'crit' ? 0xffffff :
        e.flavor === 'combo' ? 0xffd166 : 0xffe9b8
      this.flash.position.set(pos.x, pos.y, pos.z + 0.9)
      this.flash.color.setHex(color)
      this.description.flashColor.setHex(color)
      this.description.flashPos.set(pos.x, pos.y, pos.z + 0.9, 7)
      this.flashPeak = strength * (0.6 + e.power * 0.8)
      this.flashMax = e.flavor === 'light' ? 0.13 : 0.28
      this.flashLife = this.flashMax
    }
    if (e.kind === 'ko') {
      this.flashPeak = 120
      this.flashMax = 0.7
      this.flashLife = this.flashMax
      this.flash.color.setHex(0xffffff)
      this.description.flashColor.setHex(0xffffff)
      const pos = this.ctx.anchors.fighter(e.loser)
      this.flash.position.set(pos.x, pos.y, pos.z + 1.2)
      this.description.flashPos.set(pos.x, pos.y, pos.z + 1.2, 12)
    }
  }

  update(dt: number, _state: FightRenderState) {
    void _state
    // Preset cross-fade
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt * 1.6)
      this.preset = lerpPreset(this.preset, this.targetPreset, this.blend)
      this.apply(this.preset, true)
    }

    if (this.flashLife > 0) {
      this.flashLife = Math.max(0, this.flashLife - dt)
      // Sharp attack, exponential decay — reads as a real impact pop.
      const t = this.flashLife / this.flashMax
      const v = this.flashPeak * t * t
      this.flash.intensity = v
      this.description.flashIntensity = v
    } else if (this.flash.intensity !== 0) {
      this.flash.intensity = 0
      this.description.flashIntensity = 0
    }
  }

  setQuality(q: QualityTier) {
    const flags = flagsFor(q)
    this.key.castShadow = flags.shadows
    this.key.shadow.mapSize.set(flags.shadowMapSize, flags.shadowMapSize)
    if (this.key.shadow.map) {
      this.key.shadow.map.dispose()
      this.key.shadow.map = null as unknown as THREE.WebGLRenderTarget
    }
  }

  dispose() {
    for (const l of [this.key, this.rim, this.fill, this.ambient, this.flash]) {
      l.parent?.remove(l)
      ;(l as THREE.Light).dispose?.()
    }
  }
}

function lerpPreset(a: StageLightingPreset, b: StageLightingPreset, t: number): StageLightingPreset {
  const lerpN = (x: number, y: number) => x + (y - x) * t
  const lerpC = (x: number, y: number) =>
    new THREE.Color(x).lerp(new THREE.Color(y), t).getHex()
  const lerpV = (x: [number, number, number], y: [number, number, number]) =>
    [lerpN(x[0], y[0]), lerpN(x[1], y[1]), lerpN(x[2], y[2])] as [number, number, number]
  return {
    key: { color: lerpC(a.key.color, b.key.color), intensity: lerpN(a.key.intensity, b.key.intensity), dir: lerpV(a.key.dir, b.key.dir) },
    fill: { color: lerpC(a.fill.color, b.fill.color), intensity: lerpN(a.fill.intensity, b.fill.intensity), dir: lerpV(a.fill.dir, b.fill.dir) },
    rim: { color: lerpC(a.rim.color, b.rim.color), intensity: lerpN(a.rim.intensity, b.rim.intensity), dir: lerpV(a.rim.dir, b.rim.dir) },
    ambient: { color: lerpC(a.ambient.color, b.ambient.color), intensity: lerpN(a.ambient.intensity, b.ambient.intensity) },
    fog: { color: lerpC(a.fog.color, b.fog.color), density: lerpN(a.fog.density, b.fog.density) },
    background: lerpC(a.background, b.background),
    exposure: lerpN(a.exposure, b.exposure),
  }
}

export { DEFAULT_PRESET }
