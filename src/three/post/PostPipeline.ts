import * as THREE from 'three'
import {
  SelectiveBloomEffect,
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
import { DepthOfFieldEffect } from './DepthOfFieldEffect'
import { makeLensDirt } from './lensDirt'
import { gradeFor, mixGrades, NEUTRAL_GRADE, type StageGrade } from './grades'

declare global {
  interface Window {
    /**
     * Dev/QA handle on the post pipeline, used by the DOF probe. `dofDefeat(true)`
     * feeds the depth-of-field pass a pathological focus band (fighter plane
     * pushed into the far-blur zone) AND an off-screen character matte, defeating
     * ALL THREE fighter-protection guards at once — i.e. it INJECTS the "DOF
     * softened the fighters" failure with every other variable held constant, so
     * a probe can watch the fighter crop go from bit-exact to blurred in one build.
     * `hasDof()` reports whether the pass is actually present (quality/?nodof).
     * `sepDefeat(true)` forces the behind-fighter local separation to 0 so the
     * separation gate can prove the body/edge-contrast gain comes from that term.
     */
    __POST__?: {
      dofDefeat: (on: boolean) => void
      hasDof: () => boolean
      sepDefeat: (on: boolean) => void
      /** Current value of the reactive impact envelope (0..~1.7). Read-only QA
       *  probe: measure-impact-punch reads this frame-by-frame on the shipped
       *  route to prove a normal hit actually charges the screen-punch (it sat
       *  pinned at 0 before FightVfx.punchPost was wired). */
      impact: () => number
    }
    /** DEV mutation hook: force behind-fighter separation off (see the gate). */
    __MUT_SEP_BEHIND_OFF__?: boolean
  }
}

/**
 * Behind-fighter local separation strength (see MasterGradeEffect.setSepBehind).
 * Tuned so the darkening at the silhouette lifts the worst measured body-vs-wall
 * and edge contrast onto the gate floor across ALL stages, while feathering out
 * fast enough that it reads as contact occlusion, not a stamped box. Owned here
 * (not per-stage) so the guarantee is stage-independent.
 */
const SEP_BEHIND_STRENGTH = 0.85

/**
 * Post-processing pipeline — the show's final image authorship.
 *
 * Stack (ultra):
 *   RenderPass → DOF/bokeh (stage-depth defocus; fighters stay crisp) → [Bloom
 *   (multi-scale, energy-conserving) + Lens dirt/anamorphic + MasterGrade (AgX +
 *   per-stage colour script + split tone + vignette + grain)] → [edge-weighted
 *   chromatic aberration + contrast-adaptive sharpen] → SMAA.
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
  /**
   * Reads the ?nobloom / ?nolens / ?nograde / ?nofinalize / ?nobgfloor QA bisect
   * switches. Static because the pipeline shape is fixed at construction (see the
   * comment at the addPass site). Returns all-false outside a browser.
   */
  static qaFlags() {
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams()
    return {
      bloom: q.has('nobloom'),
      lens: q.has('nolens'),
      grade: q.has('nograde'),
      finalize: q.has('nofinalize'),
      bgFloor: q.has('nobgfloor'),
      dof: q.has('nodof'),
      sep: q.has('nosep'),
    }
  }
  readonly name = 'post'

  private ctx!: EngineContext
  private composer!: EffectComposer

  private bloom!: SelectiveBloomEffect
  /**
   * Meshes excluded from bloom. Populated by the fighter subsystem via
   * `excludeFromBloom()`; re-applied on every rebuild because a quality change
   * throws the old effect away along with its selection.
   */
  private readonly bloomExcluded = new Set<THREE.Object3D>()
  private bloomSynced = false
  private lens!: LensEffect
  private grade!: MasterGradeEffect
  private finalize!: LensFinalizeEffect
  private dof: DepthOfFieldEffect | null = null
  private dofDefeat = false
  /** ?nobgfloor — disables the background contrast floor for QA bisects. */
  private bgFloorOff = false
  /** ?nosep — disables behind-fighter local separation for QA bisects. */
  private sepOff = false
  /** __POST__.sepDefeat / dev mutation — forces behind-fighter separation off. */
  private sepDefeat = false
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
  private _offMatte = new THREE.Vector2(-1, -1)

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

    // --- depth-of-field / bokeh (own CONVOLUTION pass, runs on the raw render) --
    //
    // Placed FIRST, before bloom, so defocus happens at the "lens" and the bloom
    // that follows blooms an already-soft foreground instead of a hard black edge.
    // It reads scene depth: the camera-pinned foreground occluders sit at a fixed
    // near depth and defocus into bokeh; the world-space background softens with
    // distance; the fighters sit in the focus band and early-out BIT-EXACT (see
    // DepthOfFieldEffect for the three fighter-protection guards). Convolution
    // effects must own their pass, so this is a standalone EffectPass.
    //
    // ?nodof bisects it out; the depthOfField quality flag gates it off on low.
    const offDof = PostPipeline.qaFlags()
    this.dof = null
    if (flags.depthOfField && !offDof.dof) {
      this.dof = new DepthOfFieldEffect()
      this.dof.setCamera(camera.near, camera.far)
      // bgRamp: units past the focus band over which the world background reaches
      // full blur. fgRamp/fgBoost: the pinned foreground occluders sit ~4-6 units
      // in front of the fighters, so they must reach heavy bokeh over a short
      // ramp. maxRadius in device px at DPR 2. Tuned against native-1:1 captures.
      this.dof.setParams(7.0, 3.4, 1.7, 16)
      this.composer.addPass(new EffectPass(camera, this.dof))
    }

    // --- bloom: wide Gaussian, energy-conserving ------------------------
    //
    // mipmapBlur MUST stay false. On ANGLE/Metal the mipmap blur pass mints
    // NaN in its upsampling chain: the downsample mips read clean, but every
    // upsample mip comes back 100% NaN in one or more channels. Because the
    // deepest mip is fed by the entire frame, that NaN then sprays back across
    // the full-resolution bloom texture. BloomEffect blends with SCREEN
    // (dst + src - min(dst*src, 1)), so the NaN propagates into the composite
    // and the final clamp writes it out as exactly 0.
    //
    // The symptom was the whole game rendering in a single pure hue -- crisis
    // was pure red (G and B were NaN), hypergrowth pure cyan (R was NaN) --
    // with the surviving channel passing through byte-identical. A neutral grey
    // emitted from the master grade came out pure red, which is what proved the
    // damage happened after the grade rather than inside its colour script.
    // Measured across all 8 arenas: mean saturation was pinned at exactly
    // 1.000 with up to 100% of lit pixels holding a dead channel; on the
    // Gaussian path it drops to 0.45-0.86 with dead channels under 10%.
    //
    // SELECTIVE, and inverted: bloom the whole frame EXCEPT the fighters.
    // Measured on the settled combat frame, plain bloom doubled the fighters'
    // mean luminance (41 -> 85 on Chesky's head, 76 -> 164 on Doshi's torso)
    // and drove 5.7% of Doshi's torso to pure white. Faces stopped being faces.
    // The sprites are not at fault and neither is the grade -- `?nograde`
    // measured WORSE (11.4% blown), so the character grade was already holding
    // them back. The threshold is simply below where lit skin and a white
    // jacket sit, and bloom runs after the grade, so nothing downstream of it
    // can put the character read back.
    //
    // Real fighting games bloom the stage, the VFX and the supers, never the
    // character's diffuse -- that is what keeps a fighter legible against a
    // blown-out background. Excluding the fighter meshes gets that directly,
    // rather than raising the threshold globally and killing the stage glow
    // this pipeline is built around.
    this.bloom = new SelectiveBloomEffect(scene, camera, {
      intensity: this.currentGrade.bloomIntensity,
      luminanceThreshold: this.currentGrade.bloomThreshold,
      luminanceSmoothing: 0.3,
      mipmapBlur: false,
      kernelSize: KernelSize.HUGE,
      radius: 0.85,
    })
    this.bloom.inverted = true
    this.bloom.ignoreBackground = false
    this.bloomSynced = false

    // --- lens dirt + anamorphic (reads the bloom buffer) ----------------
    this.lens = new LensEffect({
      bloomTexture: this.bloom.texture,
      dirtTexture: this.dirtTexture,
    })

    // --- master grade + AgX display transform ---------------------------
    this.grade = new MasterGradeEffect()
    this.grade.applyGrade(this.currentGrade)
    this.grade.setCamera(camera.near, camera.far)
    this.grade.setBlackPoint(this.currentGrade.blackPoint)

    // --- chromatic aberration + sharpen (own convolution pass) ----------
    this.finalize = new LensFinalizeEffect()

    // QA bisect switches. `postprocessing` compiles every effect of an
    // EffectPass into a single shader, so a runtime blendFunction = SKIP is a
    // no-op -- the only way to remove a stage is to leave it out at construction.
    // Hence URL params: ?nobloom&nolens&nograde&nofinalize. These exist so a
    // "the frame is blown out / wrong hue" report can be bisected across post
    // in one capture run instead of by editing source. Do not remove.
    const off = PostPipeline.qaFlags()
    this.bgFloorOff = off.bgFloor
    if (off.bgFloor) this.grade.setBgFloor(1e6, 1e6 + 1, undefined, 0)
    this.sepOff = off.sep

    const gradeEffects: Effect[] = []
    if (flags.bloom && !off.bloom) {
      gradeEffects.push(this.bloom)
      if (!off.lens) gradeEffects.push(this.lens)
    }
    if (!off.grade) gradeEffects.push(this.grade)
    if (gradeEffects.length) this.composer.addPass(new EffectPass(camera, ...gradeEffects))

    // Chromatic aberration + sharpen + FINAL character clarity. This pass runs
    // after bloom, so it is the authoritative last word on the fighters: it
    // re-asserts the neutral, separated character read that the environment's
    // saturated bloom bleeds back over (see LensFinalizeEffect).
    this.finalize.setCa(flags.chromaticAberration ? 0.00015 : 0, 0)
    this.finalize.setSharpen(0.32)
    this.grade.setCamera(camera.near, camera.far)
    this.finalize.setCamera(camera.near, camera.far)
    this.finalize.setCharClarity(this.currentGrade.envTint, this.currentGrade.charUntint, this.currentGrade.castRecover, this.currentGrade.charTone, this.currentGrade.charToneAmt)
    if (!off.finalize) this.composer.addPass(new EffectPass(camera, this.finalize))

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

  /**
   * Collect every mesh tagged `userData.noBloom` into the (inverted) bloom
   * selection, i.e. exclude it from bloom. Subsystems tag their own meshes
   * rather than calling in here, so post stays a leaf dependency.
   *
   * Runs on build and again on the first frame: `PostPipeline` is added after
   * the fighter subsystem but `build()` can still race sprite creation, and a
   * quality change rebuilds the effect with an empty selection.
   */
  private syncBloomExclusions() {
    this.bloomExcluded.clear()
    this.ctx.scene.traverse((o) => {
      if (o.userData?.noBloom) this.bloomExcluded.add(o)
    })
    this.bloom.selection.set([...this.bloomExcluded])
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
      // Punch-and-decay, not a wash. setFlash drives an exposure lift of
      // 1 + flash*2.4 plus a warm (0.9,0.85,0.7) tint in the grade, so the old
      // 0.6 spike lifted the WHOLE frame ~2.4x and flattened both fighters into
      // near-unreadable yellow silhouettes at exactly the KO frame the player
      // wants to read. Peak lowered so it lands as a bright hit accent (~1.8x)
      // that clears in a few frames on the real-dt decay, mirroring fight-hud
      // shortening their own KO flash to punch-and-decay.
      this.flash = Math.min(0.32, this.flash + 0.26)
    }
    if (e.kind === 'shatter') this.impact = Math.max(this.impact, 1.15)
  }

  /**
   * Charge the reactive screen-punch from a FIGHT-ROUTE hit.
   *
   * {@link onEvent} is the card-game bus handler and the only thing that ever
   * charged `impact` — but it never fires on the shipped `/` (`?play=1`) fighter.
   * There the sim dispatches its own FightEvents straight to FightVfx, and
   * FightRenderer leaves the optional `emitEngine` bridge undefined, so
   * `engine.emit` (and therefore onEvent) is never called on a normal hit.
   * Measured on the live route before this method existed: the impact envelope
   * sat pinned at 0.0000 across 45 hits of every weight class, which means the
   * bloom bump (`+ i * 0.5`), chromatic-aberration spike (`i * 0.0075`), contrast
   * (`+ i * 0.18`), grain (`+ i * 0.03`) and anamorphic streak — all driven by
   * `i = this.impact` in update() — were dead on the game people actually play.
   * The designer's "aberration should live on impacts, not neutral" intent was
   * defeated by dead wiring, not by tuning.
   *
   * FightVfx.hit()/ko() call this directly with a weight-mapped strength so the
   * already-tuned reactive grade finally punches on contact. Kept as a thin,
   * clamped setter that reuses onEvent's exact envelope caps, so every bit of the
   * decay/curve tuning still lives in update() and there is one source of truth
   * for "how hot can a punch get." A normal hit passes no `flash`: the full-frame
   * exposure lift is reserved for the KO, because lifting the whole frame flattens
   * both fighters into unreadable silhouettes (the anti-wash lesson).
   */
  impactPunch(strength: number, warm: number, flash = 0) {
    this.impact = Math.min(1.7, this.impact + strength)
    this.impactWarm = Math.max(-1, Math.min(1, warm))
    if (flash > 0) this.flash = Math.min(0.32, this.flash + flash)
  }

  update(dt: number, state: FightRenderState) {
    this.time += dt

    // Fighter sprites are built during the fighter subsystem's init, which can
    // land after build(). Re-collect once on the first frame so the exclusion
    // is live before anything is drawn.
    if (!this.bloomSynced) {
      this.bloomSynced = true
      this.syncBloomExclusions()
    }

    // --- character matte projection ------------------------------------
    // Build the screen-space power windows over the two fighters from their
    // published anchors, so the grade can keep their chroma separate from the
    // arena. Fully self-contained (no dependency on layer tagging).
    this.updateCharMatte()

    // Dev/QA handle for the DOF probe (see the __POST__ global doc). Exposed here
    // rather than in build() so it always reflects the current pass presence.
    if (import.meta.env.DEV) {
      window.__POST__ = {
        dofDefeat: (on: boolean) => {
          this.dofDefeat = on
        },
        hasDof: () => !!this.dof,
        sepDefeat: (on: boolean) => {
          this.sepDefeat = on
        },
        impact: () => this.impact,
      }
    }

    // --- decays ---------------------------------------------------------
    // The impact envelope is deliberately front-loaded: it falls fastest while
    // it is high, so the hit glare reads as a SNAP (gone in ~5 frames) and then
    // leaves a short afterglow tail. A flat linear decay held the flare near
    // peak for a sixth of a second, which is what made a crit look like a
    // sustained supernova rather than a hit spark. Modern fighting games spike
    // and clear inside 8-10 frames; anything longer erases the hit reaction.
    //
    // Real dt, not the hitstop-scaled dt. The impact grade and the full-frame
    // flash are presentation accents, not world state: on the scaled clock they
    // barely decayed at all for the 100-320ms of the freeze, so the boosted
    // bloom and lifted exposure were held across exactly the frame the player
    // stares at. See EngineContext.realDt.
    const rdt = this.ctx.realDt()
    this.impact = Math.max(0, this.impact - rdt * (3.2 + this.impact * 6.5))
    this.flash = Math.max(0, this.flash - rdt * 5.0)
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
      this.finalize.setCharClarity(this.currentGrade.envTint, this.currentGrade.charUntint, this.currentGrade.castRecover, this.currentGrade.charTone, this.currentGrade.charToneAmt)
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
    // Impact drive is deliberately small. The VFX sprites already emit at
    // intensity 1.5-2.9 in linear HDR, so they are well above the bloom
    // threshold before any impact boost at all. Adding i * 1.5 on top of a base
    // of ~1.1 nearly tripled the bloom gain on every hit, and with a HUGE kernel
    // that turned a torso-sized hit spark into a full-frame white blowout that
    // erased the fighter being hit. The hit needs to feel like it PUNCHES, which
    // is what the fast impact envelope above delivers -- it does not need the
    // frame to go white. Threshold is nudged rather than crushed for the same
    // reason: dropping it to 0.42 pulled the fighters' lit skin into the bloom
    // and blew out their faces. Threshold is now RAISED slightly on impact
    // instead of lowered. That is deliberate and counter-intuitive: on the
    // frame of a hit the fighter is already flash-lit and the VFX cores are
    // already far above threshold, so the only thing a lower threshold recruits
    // is the character's own lit skin -- exactly the pixels that must stay
    // readable. Lifting it keeps the bloom on the genuinely hot stuff (the
    // spark, the flare, the arena neon) and off the face.
    //
    // The SUPER obeys the exact same rule, and used to violate it. The Ion
    // Storm beam is drawn additively and un-tone-mapped at 1.5-2.9 linear, so
    // its core sits FAR above threshold before the bloom pass ever runs -- it
    // does not need help to glow. The old super drive nonetheless pushed bloom
    // intensity up (+0.35) AND dropped the threshold (-0.08) while the beam
    // fired. That did to the beam exactly what the impact boost did to the
    // fighter's face: a HUGE-kernel SCREEN blend recruited the golden charge
    // flare's high-R/G bloom across the whole band and stacked it onto the
    // indigo core, driving every channel to 1.0 so the signature colour
    // clipped to white and only survived as a faint fringe. A saturated colour
    // has to stay BELOW the bloom clip to read as itself. So the super now
    // takes NO intensity boost (energy is not added to an already-clipping
    // core) and RAISES the threshold by the same amount it used to lower it,
    // keeping the bloom on the genuinely hottest specular/flare pixels while
    // the indigo body of the beam stays below the clip and keeps its hue. The
    // super's spectacle rides the anamorphic streak, contrast and warmth drives
    // below -- none of which whiten the core.
    this.bloom.intensity = g.bloomIntensity + i * 0.5
    this.bloom.luminanceMaterial.threshold = Math.max(
      0.34,
      g.bloomThreshold + i * 0.05 + this.superPunch * 0.08,
    )

    // Bloom kernel width is a discrete enum, so it is applied from the
    // destination grade rather than the cross-faded one (a lerped kernel index
    // is meaningless). A narrower kernel on stages that ask for it stops
    // mid-bright background highlights from blooming into big soft lens-dirt
    // "orbs" without dimming the genuine stage glow. Guarded so it only writes
    // on an actual change.
    const wantKernel = this.targetGrade.bloomKernel ?? KernelSize.HUGE
    if (this.bloom.kernelSize !== wantKernel) this.bloom.kernelSize = wantKernel

    // --- lens dirt / anamorphic ----------------------------------------
    this.lens.setBloomTexture(this.bloom.texture)
    this.lens.setDirt(g.lensDirt * (1 + i * 0.4))
    this.lens.setAnamorphic(g.anamorphic * (1 + i * 0.6 + this.superPunch * 0.5), g.anamorphicTint)

    // --- grade dynamics -------------------------------------------------
    const contrast = g.contrast + i * 0.18 + this.superPunch * 0.14
    this.grade.setContrast(contrast)
    // Per-stage true black anchor (single-hue arenas flood coloured light into
    // the shadows and need a firmer crush to reach a real black point).
    this.grade.setBlackPoint(g.blackPoint)

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
    // Base pushed to a bare whisper so neutral frames are effectively CA-free —
    // the residual bottom-corner fringing read as a rendering fault, not a lens.
    // At 0.0011 the whole background separated red/cyan; even 0.0004 left a
    // faint corner fringe at rest. A fighting game wants aberration to live on
    // impacts, not in neutral, so the base is near-zero and impacts/supers carry
    // it — spiked a touch harder to keep the punch now that the floor is lower.
    this.finalize.setCa(
      flagsFor(this.quality).chromaticAberration ? 0.00015 : 0,
      i * 0.0075 + this.superPunch * 0.0016,
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
    // Per-stage padding: TIGHT on cast-strip-only stages (hug the body so the
    // soft ellipse doesn't halo the background), TALL only where a complementary
    // accent must reach the bloomed faces.
    const pad = this.currentGrade.mattePad
    let halfH = 0.28
    const headA = anchors.get('fighter:a:head')
    const feetA = anchors.get('fighter:a:feet')
    if (headA && feetA) {
      this.projX(headA)
      const hy = this.lastY
      this.projX(feetA)
      const fy = this.lastY
      halfH = Math.max(0.14, Math.abs(hy - fy) * 0.5 * pad)
      this._charA.y = (hy + fy) * 0.5
    }
    const headB = anchors.get('fighter:b:head')
    const feetB = anchors.get('fighter:b:feet')
    if (headB && feetB) {
      this.projX(headB)
      const hy = this.lastY
      this.projX(feetB)
      const fy = this.lastY
      halfH = Math.max(halfH, Math.abs(hy - fy) * 0.5 * pad)
      this._charB.y = (hy + fy) * 0.5
    }

    // Horizontal extent from a fixed world offset around the chest. Hug the
    // fighter core rather than the whole silhouette: because no true per-fighter
    // matte exists, a wide window catches co-planar props/floor at the fighter
    // distance (the depth gate can't separate them) and reads as a desaturated
    // box. A tighter window keeps the treatment on the body where identity lives.
    this._pv.copy(chestA)
    this._pv.x += 0.66
    this._pv.project(camera)
    const offx = this._pv.x * 0.5 + 0.5
    let halfW = Math.abs(offx - cax) * 1.08
    if (!(halfW > 0.02)) halfW = 0.09
    halfW = Math.max(halfW, 0.085)
    this._charHalf.set(halfW, halfH)

    // Distance from camera to the fighter plane, so the grade can depth-gate the
    // matte and exclude the far background inside the power window. Gate TIGHT to
    // the fighter plane: pass everything up to just behind the farther fighter,
    // then ramp off fast so the wall/props a few units behind them keep the full
    // arena grade (otherwise the elliptical window de-tints the backdrop and reads
    // as a visible rectangular box around each fighter).
    const distA = this.ctx.camera.position.distanceTo(chestA)
    const distB = this.ctx.camera.position.distanceTo(chestB)
    const farDist = Math.max(distA, distB)
    this.grade.setCharDepth(farDist + 1.1, 2.4)
    this.grade.setCharMatte(this._charA, this._charB, this._charHalf)

    // Background contrast floor rides the same fighter plane. The ramp has to be
    // TIGHT: measured on ai-native and ipo-prep, the highlights that actually
    // sit against a fighter's head are the stage practicals a few units behind
    // them, not the distant skyline, and a wide 3.4..13.5 ramp left the gate at
    // ~0.06 there -- the floor was effectively off on the two stages that needed
    // it most. Start just past the farther fighter and reach full strength
    // within seven units. Fighters themselves sit at or nearer than farDist, so
    // the gate is exactly 0 on them.
    if (!this.bgFloorOff) this.grade.setBgFloor(farDist + 1.4, farDist + 7.0)

    // Behind-fighter local separation rides the SAME fighter plane + ellipse as
    // the matte/bgFloor, so it darkens only the wall directly behind each fighter
    // and never the fighters themselves. Forced to 0 by ?nosep, the __POST__
    // sepDefeat handle, or the DEV mutation global so the separation gate can
    // prove the body/edge-contrast lift comes from THIS term, not the instrument.
    const sepMutOff =
      import.meta.env.DEV && (globalThis as Record<string, unknown>).__MUT_SEP_BEHIND_OFF__
    const sepEnabled = !this.sepOff && !this.sepDefeat && !sepMutOff
    this.grade.setSepBehind(sepEnabled ? SEP_BEHIND_STRENGTH : 0)

    // The finalize pass re-asserts the same matte after bloom (see below).
    this.finalize.setCharDepth(farDist + 1.1, 2.4)
    this.finalize.setCharMatte(this._charA, this._charB, this._charHalf)

    // Depth-of-field focus band tracks the fighter plane so both fighters stay in
    // focus (CoC 0 → bit-exact early-out). center = midpoint of the two fighter
    // distances; half spans the gap between them plus slack so a launched fighter
    // pulled off the shared plane is still covered. The same screen-space matte is
    // fed as a second, depth-gated guard. Everything nearer (pinned occluders) or
    // farther (arena walls) than the band defocuses. Distances are euclidean; the
    // shader compares against eye-Z linear depth — fighters sit near screen centre
    // where the two nearly agree, and the slack + matte absorb the small error.
    if (this.dof) {
      if (this.dofDefeat) {
        // INJECTED FAILURE (dev/QA only): move the focus band ~6 units IN FRONT of
        // the fighter plane and send the matte off-screen, so the fighters fall a
        // moderate distance into the background blur (CoC ~0.7, not saturated) with
        // NO guard to protect them. They go visibly soft while the frame stays lit
        // and trustworthy — this is the red state the probe must see, proving the
        // green (guarded) build's crisp fighter crop is a real result, not a no-op.
        // (A previous version pinned focus to the camera; that over-blurred the
        // whole dark scene to near-black, indistinguishable from a cleared buffer.)
        const defeatCenter = Math.max(0.5, (distA + distB) * 0.5 - 6.0)
        this.dof.setFocus(defeatCenter, 0.4)
        this._offMatte.set(-1, -1)
        this.dof.setCharMatte(this._offMatte, this._offMatte, this._charHalf)
        this.dof.setCharDepth(0.0, 0.1)
      } else {
        const focusCenter = (distA + distB) * 0.5
        const focusHalf = Math.abs(distA - distB) * 0.5 + 1.5
        this.dof.setFocus(focusCenter, focusHalf)
        this.dof.setCharMatte(this._charA, this._charB, this._charHalf)
        this.dof.setCharDepth(farDist + 1.1, 2.4)
      }
    }
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
