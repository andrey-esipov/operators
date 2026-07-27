import * as THREE from 'three'
import {
  BloomEffect,
  BlendFunction,
  EffectComposer,
  EffectPass,
  KernelSize,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  type Effect,
} from 'postprocessing'
import type { EngineContext, FightEvent, FightRenderState, QualityTier, Subsystem } from '../types'
import { flagsFor } from '../core/QualityManager'
import type { RenderDriver } from '../core/Engine'
import { MasterGradeEffect } from './MasterGradeEffect'
import { LensEffect } from './LensEffect'
import { LensFinalizeEffect } from './LensFinalizeEffect'
import { makeLensDirt } from './lensDirt'
import { gradeFor, mixGrades, NEUTRAL_GRADE, type StageGrade } from './grades'

/**
 * Post-processing pipeline — the show's final image authorship.
 *
 * Stack (ultra):
 *   RenderPass → [Bloom (multi-scale, energy-conserving) + Lens dirt/anamorphic
 *   + MasterGrade (AgX + per-stage colour script + split tone + vignette +
 *   grain)] → [edge-weighted chromatic aberration + contrast-adaptive sharpen]
 *   → SMAA.
 *
 * The design tension is pixel art vs. cinematic post: the grade is fully
 * pointwise so sprite edges pass through untouched, CA is zero at frame centre
 * (where the fighters live), and a CAS sharpen re-crisps anything AA softened.
 *
 * Everything reacts: hits punch bloom + CA + contrast + saturation; low HP
 * drains colour and pushes danger red + heavier vignette; supers slam contrast
 * and saturation; KO desaturates the frame.
 */
export class PostPipeline implements Subsystem, RenderDriver {
  readonly name = 'post'

  private ctx!: EngineContext
  private composer!: EffectComposer

  private bloom!: BloomEffect
  private lens!: LensEffect
  private grade!: MasterGradeEffect
  private finalize!: LensFinalizeEffect
  private smaa: SMAAEffect | null = null
  private dirtTexture!: THREE.Texture

  private quality: QualityTier = 'high'
  private time = 0

  // --- dynamic response state -------------------------------------------
  private impact = 0 // 0..~1.7, decays after hits
  private impactWarm = 0 // colour bias of the current impact (-1 cool .. +1 warm)
  private flash = 0 // full-frame flash on the biggest moments
  private superPunch = 0 // held high while a super meter is maxed / firing
  private koDrain = 0 // colour drain that ramps up and holds after a KO

  // --- stage grade cross-fade -------------------------------------------
  private currentGrade: StageGrade = NEUTRAL_GRADE
  private fromGrade: StageGrade = NEUTRAL_GRADE
  private targetGrade: StageGrade = NEUTRAL_GRADE
  private targetScenario: string | null = null
  private fade = 1 // 0..1 progress of the cross-fade

  private freeze = 0

  // Scratch objects for the per-frame character-matte projection.
  private _pv = new THREE.Vector3()
  private _charA = new THREE.Vector2(-1, -1)
  private _charB = new THREE.Vector2(-1, -1)
  private _charHalf = new THREE.Vector2(0.09, 0.24)

  async init(ctx: EngineContext) {
    this.ctx = ctx
    this.quality = ctx.quality
    this.dirtTexture = makeLensDirt(512)
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

    // --- bloom: multi-scale mipmap blur, energy-conserving --------------
    this.bloom = new BloomEffect({
      intensity: this.currentGrade.bloomIntensity,
      luminanceThreshold: this.currentGrade.bloomThreshold,
      luminanceSmoothing: 0.3,
      mipmapBlur: true,
      kernelSize: KernelSize.HUGE,
      radius: 0.85,
    })

    // --- lens dirt + anamorphic (reads the bloom buffer) ----------------
    this.lens = new LensEffect({
      bloomTexture: this.bloom.texture,
      dirtTexture: this.dirtTexture,
    })

    // --- master grade + AgX display transform ---------------------------
    this.grade = new MasterGradeEffect()
    this.grade.applyGrade(this.currentGrade)
    this.grade.setCamera(camera.near, camera.far)
    this.grade.setBlackPoint(0.03)

    // --- chromatic aberration + sharpen (own convolution pass) ----------
    this.finalize = new LensFinalizeEffect()

    const gradeEffects: Effect[] = []
    if (flags.bloom) {
      gradeEffects.push(this.bloom)
      gradeEffects.push(this.lens)
    }
    gradeEffects.push(this.grade)
    this.composer.addPass(new EffectPass(camera, ...gradeEffects))

    // Chromatic aberration + sharpen + FINAL character clarity. This pass runs
    // after bloom, so it is the authoritative last word on the fighters: it
    // re-asserts the neutral, separated character read that the environment's
    // saturated bloom bleeds back over (see LensFinalizeEffect).
    this.finalize.setCa(flags.chromaticAberration ? 0.0011 : 0, 0)
    this.finalize.setSharpen(0.32)
    this.grade.setCamera(camera.near, camera.far)
    this.finalize.setCamera(camera.near, camera.far)
    this.finalize.setCharClarity(this.currentGrade.envTint, this.currentGrade.charUntint)
    this.composer.addPass(new EffectPass(camera, this.finalize))

    if (flags.aa === 'smaa') {
      this.smaa = new SMAAEffect({ preset: SMAAPreset.HIGH })
      // SMAA resolves the full output colour itself; force a straight copy so the
      // pass does not alpha-blend against the stale (bloomed) buffer it ping-pongs
      // over, which would re-multiply the frame by the environment hue.
      this.smaa.blendMode.blendFunction = BlendFunction.SRC
      this.composer.addPass(new EffectPass(camera, this.smaa))
    } else {
      this.smaa = null
    }

    // The composer owns the final draw + tone map now.
    renderer.toneMapping = THREE.NoToneMapping
  }

  onEvent(e: FightEvent) {
    if (e.kind === 'hit') {
      const strength =
        e.flavor === 'signature' ? 1 :
        e.flavor === 'ult' ? 0.9 :
        e.flavor === 'crit' ? 0.72 :
        e.flavor === 'combo' ? 0.56 :
        e.flavor === 'ex' ? 0.62 :
        e.flavor === 'heavy' ? 0.44 : 0.24
      this.impact = Math.min(1.7, this.impact + strength * (0.65 + e.power * 0.7))
      this.impactWarm =
        e.flavor === 'ult' || e.flavor === 'signature' ? 1 :
        e.flavor === 'ex' ? -0.7 : 0.2
      if (e.flavor === 'signature' || e.flavor === 'ult') this.flash = Math.min(0.5, this.flash + 0.28)
      if (e.shattered) this.impact = Math.min(1.8, this.impact + 0.4)
    }
    if (e.kind === 'signature') this.flash = Math.min(0.55, this.flash + 0.3)
    if (e.kind === 'cast' && (e.flavor === 'ult' || e.flavor === 'signature')) {
      this.superPunch = Math.min(1, this.superPunch + 0.6)
      this.flash = Math.min(0.4, this.flash + 0.2)
    }
    if (e.kind === 'ko') {
      this.impact = 1.7
      this.flash = Math.min(0.6, this.flash + 0.4)
    }
    if (e.kind === 'shatter') this.impact = Math.max(this.impact, 1.15)
  }

  update(dt: number, state: FightRenderState) {
    this.time += dt

    // --- character matte projection ------------------------------------
    // Build the screen-space power windows over the two fighters from their
    // published anchors, so the grade can keep their chroma separate from the
    // arena. Fully self-contained (no dependency on layer tagging).
    this.updateCharMatte()

    // --- decays ---------------------------------------------------------
    this.impact = Math.max(0, this.impact - dt * 3.4)
    this.flash = Math.max(0, this.flash - dt * 2.6)
    const i = this.impact

    // --- stage grade cross-fade ----------------------------------------
    if (state.scenario !== this.targetScenario) {
      this.targetScenario = state.scenario
      this.fromGrade = this.currentGrade
      this.targetGrade = gradeFor(state.scenario)
      this.fade = 0
    }
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt / 0.6)
      const t = this.fade * this.fade * (3 - 2 * this.fade)
      this.currentGrade = mixGrades(this.fromGrade, this.targetGrade, t)
      this.grade.applyGrade(this.currentGrade)
      this.finalize.setCharClarity(this.currentGrade.envTint, this.currentGrade.charUntint)
    }
    const g = this.currentGrade

    // --- super punch: ramps while either meter is full ------------------
    const superMax = Math.max(state.a.super01, state.b.super01)
    const wantSuper = state.a.superReady || state.b.superReady ? 1 : superMax > 0.98 ? 0.8 : 0
    this.superPunch += (wantSuper - this.superPunch) * Math.min(1, dt * 4)

    // --- KO / defeat colour drain --------------------------------------
    const someoneDown =
      state.a.hp01 <= 0.001 ||
      state.b.hp01 <= 0.001 ||
      state.a.pose === 'lose' ||
      state.b.pose === 'lose'
    this.koDrain += ((someoneDown ? 1 : 0) - this.koDrain) * Math.min(1, dt * 2.5)

    // --- low-HP danger --------------------------------------------------
    const worst = Math.min(state.a.hp01, state.b.hp01)
    const danger = Math.max(0, 1 - worst / 0.3)
    const dangerPulse = danger * (0.6 + 0.4 * Math.sin(this.time * 6.0))

    // --- bloom ----------------------------------------------------------
    this.bloom.intensity = g.bloomIntensity + i * 1.5 + this.superPunch * 0.5
    this.bloom.luminanceMaterial.threshold = Math.max(
      0.24,
      g.bloomThreshold - i * 0.28 - this.superPunch * 0.12,
    )

    // --- lens dirt / anamorphic ----------------------------------------
    this.lens.setBloomTexture(this.bloom.texture)
    this.lens.setDirt(g.lensDirt * (1 + i * 0.4))
    this.lens.setAnamorphic(g.anamorphic * (1 + i * 0.6 + this.superPunch * 0.5), g.anamorphicTint)

    // --- grade dynamics -------------------------------------------------
    const contrast = g.contrast + i * 0.18 + this.superPunch * 0.14
    this.grade.setContrast(contrast)

    this.grade.setSatBoost(
      i * 0.35 + this.superPunch * 0.25 + (this.impactWarm > 0 ? i * this.impactWarm * 0.15 : 0),
    )

    // Danger drains + reddens; KO drains hard. Kept off the fighters via the
    // edge-weighted envW in the shader so gameplay stays readable.
    const desat = Math.max(danger * 0.5, this.koDrain * 0.85)
    const dangerAmt = dangerPulse * 0.55
    this.grade.setDanger(desat, dangerAmt)

    // Vignette tightens on danger / impact.
    this.grade.setVignette(
      g.vigOffset - danger * 0.06 - i * 0.02,
      Math.min(0.9, g.vigDarkness + danger * 0.28 + i * 0.1 + this.koDrain * 0.15),
    )

    // Under danger the vignette glow reddens at the frame edges — a strong,
    // readable "critical HP" tell that never touches the centred fighters.
    const dr = Math.max(danger, this.koDrain * 0.5)
    this.grade.setVigColor(
      g.vigColor[0] + dr * 0.28,
      g.vigColor[1] * (1 - dr * 0.7),
      g.vigColor[2] * (1 - dr * 0.7),
    )

    // Grain lifts a touch under stress so it reads as film, not static.
    this.grade.setGrain(g.grain + danger * 0.03 + i * 0.03, this.time * 24.0)

    // Warm/cool flash on the biggest hits + supers.
    this.grade.setFlash(this.flash)

    // --- chromatic aberration spike ------------------------------------
    // Static base kept low so even the extreme corners only lens-fringe
    // gently on high-contrast vertical edges; impacts/supers still spike it.
    this.finalize.setCa(
      flagsFor(this.quality).chromaticAberration ? 0.0011 : 0,
      i * 0.01 + this.superPunch * 0.002,
    )
  }

  render(_dt: number) {
    void _dt
    this.composer.render()
  }

  /**
   * Project both fighters' anchors into screen space and upload the soft power
   * windows the grade uses to keep character chroma separate from the arena.
   */
  private updateCharMatte() {
    const anchors = this.ctx.anchors
    const camera = this.ctx.camera
    const chestA = anchors.get('fighter:a') ?? anchors.fighter('a')
    const chestB = anchors.get('fighter:b') ?? anchors.fighter('b')

    const cax = this.projX(chestA)
    const cay = this.lastY
    const cbx = this.projX(chestB)
    const cby = this.lastY
    this._charA.set(cax, cay)
    this._charB.set(cbx, cby)

    // Vertical extent + a stable centre from each fighter's head/feet anchors.
    let halfH = 0.28
    const headA = anchors.get('fighter:a:head')
    const feetA = anchors.get('fighter:a:feet')
    if (headA && feetA) {
      this.projX(headA)
      const hy = this.lastY
      this.projX(feetA)
      const fy = this.lastY
      halfH = Math.max(0.18, Math.abs(hy - fy) * 0.5 * 1.5)
      this._charA.y = (hy + fy) * 0.5
    }
    const headB = anchors.get('fighter:b:head')
    const feetB = anchors.get('fighter:b:feet')
    if (headB && feetB) {
      this.projX(headB)
      const hy = this.lastY
      this.projX(feetB)
      const fy = this.lastY
      halfH = Math.max(halfH, Math.abs(hy - fy) * 0.5 * 1.5)
      this._charB.y = (hy + fy) * 0.5
    }

    // Horizontal extent from a fixed world offset around the chest. Kept generous
    // so the ellipse reliably spans each fighter across lunge/crouch poses; the
    // depth gate (below) is what keeps the far background at full arena grade, so
    // a wide window here only ever affects pixels on the fighter plane.
    this._pv.copy(chestA)
    this._pv.x += 0.95
    this._pv.project(camera)
    const offx = this._pv.x * 0.5 + 0.5
    let halfW = Math.abs(offx - cax) * 1.5
    if (!(halfW > 0.02)) halfW = 0.12
    halfW = Math.max(halfW, 0.11)
    this._charHalf.set(halfW, halfH)

    // Distance from camera to the fighter plane, so the grade can depth-gate the
    // matte and exclude the far background inside the power window. Span BOTH
    // fighters (they can be at slightly different distances mid-move) with a wide
    // falloff so neither drops out of the matte.
    const distA = this.ctx.camera.position.distanceTo(chestA)
    const distB = this.ctx.camera.position.distanceTo(chestB)
    const nearDist = Math.min(distA, distB)
    const spread = Math.abs(distA - distB)
    this.grade.setCharDepth(nearDist + 2.5, spread + 9.0)
    this.grade.setCharMatte(this._charA, this._charB, this._charHalf)

    // The finalize pass re-asserts the same matte after bloom (see below).
    this.finalize.setCharDepth(nearDist + 2.5, spread + 9.0)
    this.finalize.setCharMatte(this._charA, this._charB, this._charHalf)
  }

  private lastY = 0
  /** Project a world point, return its screen-space uv.x and stash uv.y. */
  private projX(v: THREE.Vector3): number {
    this._pv.copy(v).project(this.ctx.camera)
    this.lastY = this._pv.y * 0.5 + 0.5
    return this._pv.x * 0.5 + 0.5
  }

  resize(width: number, height: number) {
    this.composer?.setSize(width, height)
    // Keep lens dirt roughly square regardless of aspect so it doesn't smear.
    const aspect = width / Math.max(1, height)
    this.lens?.setDirtScale(aspect >= 1 ? aspect : 1, aspect >= 1 ? 1 : 1 / aspect)
  }

  setQuality(q: QualityTier) {
    this.quality = q
    this.build()
    this.resize(this.ctx.size.width, this.ctx.size.height)
  }

  dispose() {
    this.composer?.dispose()
    this.dirtTexture?.dispose()
  }

  /** Exposed for cinematics that want to drive the look directly. */
  setFreeze(v: number) {
    this.freeze = v
  }
  getFreeze() {
    return this.freeze
  }
}
