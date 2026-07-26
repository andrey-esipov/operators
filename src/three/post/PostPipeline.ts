import * as THREE from 'three'
import {
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  KernelSize,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  BlendFunction,
  HueSaturationEffect,
  BrightnessContrastEffect,
  ScanlineEffect,
  type Effect,
} from 'postprocessing'
import type { EngineContext, FightEvent, FightRenderState, QualityTier, Subsystem } from '../types'
import { flagsFor } from '../core/QualityManager'
import type { RenderDriver } from '../core/Engine'

/**
 * Post-processing pipeline.
 *
 * The look we're going for: modern filmic base (ACES, bloom, subtle CA and
 * grain, strong vignette) with a *restrained* arcade CRT flavour on top —
 * enough scanline to remember where the game came from, not so much that it
 * reads as a filter slapped over everything.
 *
 * Impact response lives here too: hits punch exposure and chromatic
 * aberration for a few frames, which is most of what makes a hit feel loud.
 */
export class PostPipeline implements Subsystem, RenderDriver {
  readonly name = 'post'

  private ctx!: EngineContext
  private composer!: EffectComposer

  private bloom!: BloomEffect
  private ca!: ChromaticAberrationEffect
  private vignette!: VignetteEffect
  private noise!: NoiseEffect
  private tone!: ToneMappingEffect
  private hue!: HueSaturationEffect
  private bc!: BrightnessContrastEffect
  private scanline!: ScanlineEffect
  private smaa: SMAAEffect | null = null

  private baseCaOffset = new THREE.Vector2(0.00035, 0.00042)
  private impact = 0
  private impactColor = 0
  private time = 0
  private quality: QualityTier = 'high'

  /** Set from outside for the "world stops" moment on a big hit. */
  private freeze = 0

  async init(ctx: EngineContext) {
    this.ctx = ctx
    this.quality = ctx.quality
    this.build()
  }

  private build() {
    const { renderer, scene, camera } = this.ctx
    const flags = flagsFor(this.quality)

    this.composer?.dispose()
    this.composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: 0,
    })
    this.composer.addPass(new RenderPass(scene, camera))

    this.bloom = new BloomEffect({
      intensity: 1.15,
      luminanceThreshold: 0.62,
      luminanceSmoothing: 0.24,
      mipmapBlur: true,
      kernelSize: KernelSize.LARGE,
      radius: 0.72,
    })

    this.ca = new ChromaticAberrationEffect({
      offset: this.baseCaOffset.clone(),
      radialModulation: true,
      modulationOffset: 0.42,
    })

    this.vignette = new VignetteEffect({ offset: 0.24, darkness: 0.72 })

    this.noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true })
    this.noise.blendMode.opacity.value = 0.09

    this.scanline = new ScanlineEffect({ density: 1.28 })
    this.scanline.blendMode.opacity.value = 0.055

    this.hue = new HueSaturationEffect({ saturation: 0.12 })
    this.bc = new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.09 })

    this.tone = new ToneMappingEffect({
      mode: ToneMappingMode.AGX,
      resolution: 256,
      whitePoint: 8,
      middleGrey: 0.6,
      adaptive: false,
    })

    const effects: Effect[] = []
    if (flags.bloom) effects.push(this.bloom)
    effects.push(this.tone, this.bc, this.hue)
    if (flags.chromaticAberration) effects.push(this.ca)
    effects.push(this.vignette)
    if (flags.filmGrain) effects.push(this.noise, this.scanline)

    this.composer.addPass(new EffectPass(camera, ...effects))

    if (flags.aa === 'smaa') {
      this.smaa = new SMAAEffect({ preset: SMAAPreset.HIGH })
      this.composer.addPass(new EffectPass(camera, this.smaa))
    }

    // The engine's own tone mapping is disabled: the composer owns it now.
    renderer.toneMapping = THREE.NoToneMapping
  }

  onEvent(e: FightEvent) {
    if (e.kind === 'hit') {
      const strength =
        e.flavor === 'signature' ? 1 :
        e.flavor === 'ult' ? 0.85 :
        e.flavor === 'crit' ? 0.7 :
        e.flavor === 'combo' ? 0.55 :
        e.flavor === 'ex' ? 0.6 :
        e.flavor === 'heavy' ? 0.42 : 0.22
      this.impact = Math.min(1.4, this.impact + strength * (0.6 + e.power * 0.7))
      this.impactColor =
        e.flavor === 'ult' || e.flavor === 'signature' ? 1 :
        e.flavor === 'ex' ? -1 : 0
    }
    if (e.kind === 'ko') this.impact = 1.6
    if (e.kind === 'shatter') this.impact = Math.max(this.impact, 1.1)
  }

  update(dt: number, state: FightRenderState) {
    this.time += dt
    this.impact = Math.max(0, this.impact - dt * 3.4)
    const i = this.impact

    // Chromatic aberration spikes on impact then settles.
    this.ca.offset.set(
      this.baseCaOffset.x + i * 0.0042,
      this.baseCaOffset.y + i * 0.0031,
    )

    // Bloom blooms harder on impact.
    this.bloom.intensity = 1.15 + i * 1.5
    this.bloom.luminanceMaterial.threshold = Math.max(0.28, 0.62 - i * 0.3)

    // Contrast/saturation punch.
    this.bc.contrast = 0.09 + i * 0.22
    this.hue.saturation = 0.12 + i * 0.3 + (this.impactColor === 1 ? i * 0.12 : 0)

    // Low-health desaturation + heavier vignette — a real fighting-game tell.
    const worst = Math.min(state.a.hp01, state.b.hp01)
    const danger = Math.max(0, 1 - worst / 0.28)
    this.vignette.darkness = 0.72 + danger * 0.35 + i * 0.12
    this.vignette.offset = 0.24 - danger * 0.05

    // Grain crawls slightly with time so it never looks like a static overlay.
    this.noise.blendMode.opacity.value = 0.085 + danger * 0.03 + i * 0.05
  }

  render(_dt: number) {
    void _dt
    this.composer.render()
  }

  resize(width: number, height: number) {
    this.composer?.setSize(width, height)
  }

  setQuality(q: QualityTier) {
    this.quality = q
    this.build()
    this.resize(this.ctx.size.width, this.ctx.size.height)
  }

  dispose() {
    this.composer?.dispose()
  }

  /** Exposed for cinematics that want to drive the look directly. */
  setFreeze(v: number) {
    this.freeze = v
  }
  getFreeze() {
    return this.freeze
  }
}
