import * as THREE from 'three'
import {
  WORLD,
  type EngineContext,
  type FightRenderState,
  type QualityTier,
  type Subsystem,
  type FightEvent,
} from '../types'
import type { ScenarioId } from '../../types'
import { stageConfig } from './StageRegistry'
import type { LightRig } from '../lighting/LightRig'
import { flagsFor } from '../core/QualityManager'
import { ReflectiveFloor, type FloorLook } from './ReflectiveFloor'
import { buildStageScene } from './StageBuilds'
import { DustField, groundFog } from './Atmosphere'
import type { StageBuild } from './StageKit'
import { BACKDROP_PLANE, backdropUvTransform } from './backdropFraming'

declare global {
  interface Window {
    /**
     * Dev-only readback of the stage celebration gate — the exact boolean the
     * IPO ticker-tape reads. Lets an external probe verify the
     * phase -> renderState.celebrate -> build.celebrate plumbing deterministically,
     * without leaning on sparse confetti pixels or the win-screen UI overlay
     * (whose cyan "ENTER TO CONTINUE" prompt otherwise pollutes a pixel probe).
     */
    __STAGE__?: {
      celebrate: () => boolean
      /** Dev/QA: hide the foreground framing occluders (used by the occluder
       *  probe to difference a frame with and without them). */
      setForegroundVisible: (v: boolean) => void
      /** Dev/QA: hide the whole mid-ground build, leaving the painted cyclorama
       *  and the floor. Lets a probe measure how much of the painting the
       *  procedural set is actually covering, with nothing else changed. */
      setBuildVisible: (v: boolean) => void
      /** Dev/QA: retune the backdrop grade live, so a variant sweep can be
       *  captured without a rebuild between arms. */
      setBackdropGrade: (g: { exposure?: number; fog?: number; vignette?: number }) => void
      /** Dev/QA: toggle camera-pinning of the foreground frame. `false` restores
       *  the original world-space behaviour — i.e. injects Defect 1 — so a probe
       *  can watch the occlusion spike with every other variable held constant. */
      setFramePinned: (v: boolean) => void
      framePinned: () => boolean
      /** Dev/QA: project a world point through the LIVE play camera to NDC
       *  ([-1,1], +y up). Lets the occluder probe build a tight screen box around
       *  the downed fighter — instead of the loose two-fighter coverage union —
       *  so it measures occlusion of the fighter's silhouette, not the framing. */
      project: (x: number, y: number, z: number) => [number, number]
      /** Dev/QA: scale the whole light rig (1 = normal, 0 = dark). The decal
       *  light-coupling probe dims the rig and watches which surfaces move: a
       *  lit painted decal darkens with it, an unlit `toneMapped:false` sticker
       *  does not — proving decals actually take the stage's directional light. */
      setLightScale: (s: number) => void
    }
  }
}

/**
 * The stage.
 *
 * Structure, back to front:
 *   1. Sky gradient + far backdrop cyclorama — the hand-painted plate, cover-fit
 *      to the frame so the fight shows the SAME image the stage-select thumbnail
 *      sells (see backdropFraming.ts). It is graded to sit behind the geometry,
 *      not to be erased by it: this layer carries most of each arena's identity.
 *      It was previously "pushed deep and heavily fogged," which combined with a
 *      mis-centred 2.2x crop and a saturated DOF gather to render all eight
 *      arenas as near-identical dark boxes.
 *   2. Mid-ground architecture (per-stage `StageBuild`) — real lit/shadowed
 *      geometry: towers, gantries, screen walls, trusses, crowds. This is the
 *      layer that gives each arena a distinct, memorable silhouette and life.
 *   3. Atmosphere — parallaxing dust field, ground fog, volumetric shafts.
 *   4. Reflective floor — a real planar reflector that mirrors the fighters and
 *      the set, which is what makes the arena read as a solid, wet-sealed floor.
 *   5. Foreground occluders (in the build) — dark rails/cables near camera.
 *
 * Everything structural is lit by the shared LightRig, so the fighters and the
 * world share one rig. Practical point lights motivated by the set are added
 * here per stage.
 */
export class StageSubsystem implements Subsystem {
  readonly name = 'stage'

  private ctx!: EngineContext
  private root = new THREE.Group()
  /**
   * Camera-pinned frame for the foreground occluders. Its world matrix is
   * re-derived every frame as `C_live · V0`, where `C_live` is the live camera
   * world matrix and `V0` the *neutral* view matrix the occluders were authored
   * against. That makes an occluder authored at world M render at
   * `P · V_live · (C_live · V0) · M = P · V0 · M` — its exact neutral-pose
   * screen position — no matter where the shot dollies. In short: the framing
   * is rigidly attached to the camera, as it was always designed to be.
   */
  private frame = new THREE.Group()
  private neutralView = new THREE.Matrix4()
  /** When false, the frame collapses to identity and occluders revert to their
   *  authored world positions (the original Defect-1 behaviour). Dev toggle. */
  private framePinned = true
  private backdrop!: THREE.Mesh
  private backdropMat!: THREE.ShaderMaterial
  private floor!: ReflectiveFloor
  private dust!: DustField
  private fog!: { group: THREE.Group; update: (t: number) => void }
  private build: StageBuild | null = null
  private practicals: THREE.PointLight[] = []
  private disposeLateUpdate: (() => void) | null = null

  private current: ScenarioId | null = null
  private time = 0
  /** Aspect of the loaded plate (w/h). Drives the cover fit. */
  private plateAspect = 1.5
  /** Inputs the current UV transform was solved for, so we only resolve on change. */
  private framedAspect = -1
  private framedPlate = -1
  private getLightRig: () => LightRig | undefined
  private quality: QualityTier

  constructor(getLightRig: () => LightRig | undefined) {
    this.getLightRig = getLightRig
    this.quality = 'high'
  }

  async init(ctx: EngineContext) {
    this.ctx = ctx
    this.quality = ctx.quality
    ctx.scene.add(this.root)

    // The camera-pinned frame for foreground occluders. Driven manually every
    // frame (the camera is not in the scene graph), so its local matrix IS its
    // world transform — hence matrixAutoUpdate off and a per-frame world flush.
    this.frame.matrixAutoUpdate = false
    this.root.add(this.frame)
    this.computeNeutralView()

    this.buildBackdrop()
    this.buildFloor()
    this.buildAtmosphere()

    // Populate the planar reflection strictly before the post composer runs.
    // Pin the frame first (camera is now posed for this frame), then hide the
    // foreground framing from the reflection — a frame edge should not appear
    // mirrored in the floor.
    this.disposeLateUpdate = ctx.onLateUpdate(() => {
      this.updateFrame()
      this.floor?.updateReflection(
        ctx.renderer,
        ctx.scene,
        ctx.camera,
        this.build?.foreground ? [this.build.foreground] : [],
      )
    })
  }

  /** Neutral view matrix V0 = C0⁻¹ from the canonical framing the occluders
   *  were composed against. Computed once; the frame math re-anchors to it. */
  private computeNeutralView() {
    const c0 = new THREE.PerspectiveCamera(
      WORLD.CAMERA.fov,
      1,
      WORLD.CAMERA.near,
      WORLD.CAMERA.far,
    )
    c0.position.set(...WORLD.CAMERA.position)
    c0.up.set(0, 1, 0)
    c0.lookAt(new THREE.Vector3(...WORLD.CAMERA.target))
    c0.updateMatrixWorld(true)
    this.neutralView.copy(c0.matrixWorldInverse)
  }

  /** Re-anchor the foreground frame to the live camera (or collapse to the
   *  authored world positions when unpinned). Runs in late-update, after the
   *  camera director has posed the camera for this frame. */
  private updateFrame() {
    const cam = this.ctx.camera
    if (this.framePinned) {
      cam.updateMatrixWorld()
      this.frame.matrix.multiplyMatrices(cam.matrixWorld, this.neutralView)
    } else {
      this.frame.matrix.identity()
    }
    // matrixAutoUpdate is off, so nothing else marks this dirty for us.
    this.frame.matrixWorldNeedsUpdate = true
  }

  // -- far backdrop cyclorama ------------------------------------------------
  private buildBackdrop() {
    const geo = new THREE.PlaneGeometry(1, 1, 32, 16)
    this.backdropMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: null },
        uHasMap: { value: 0 },
        uTime: { value: 0 },
        uTint: { value: new THREE.Color(0x223044) },
        uFogColor: { value: new THREE.Color(0x0a0716) },
        // The plate is the art. These used to stack into a ~75% brightness cut
        // and a ~35% saturation drain on top of a 2.2x mis-centred crop, which
        // is how eight hand-painted arenas turned into one dark box.
        //
        // These values are not taste-by-assertion: five treatments spanning
        // "cinematic, background subordinate" to "art-forward, plate almost
        // untouched" were captured on four stages and ranked BLIND under
        // shuffled labels by three independent critics. All three picked this
        // one. Two useful facts came out of that:
        //   - Exposure and fog dominate. The losing arm shared this arm's exact
        //     defocus cap and still placed last on every board.
        //   - More is not better. The most art-forward arm (exposure 1.25, fog
        //     0.06) lost to this one; the plate stops reading as part of the
        //     scene and starts reading as pasted-on wallpaper.
        // Move these only against another blind ranking.
        uFogAmount: { value: 0.12 },
        uExposure: { value: 1.18 },
        uParallax: { value: new THREE.Vector2(0, 0) },
        uSkyTop: { value: new THREE.Color(0x11081f) },
        uSkyBottom: { value: new THREE.Color(0x2c1440) },
        uVignette: { value: 0.2 },
        // Plane UV -> texture UV. The plane is deliberately far larger than the
        // frame so it still covers when the camera dollies; without this the
        // viewer sees a small off-centre crop. See backdropFraming.ts.
        uUvScale: { value: new THREE.Vector2(1, 1) },
        uUvPivot: { value: new THREE.Vector2(0.5, 0.5) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        uniform vec2 uParallax;
        uniform vec2 uUvScale;
        uniform vec2 uUvPivot;
        void main() {
          vUv = (uv - uUvPivot) * uUvScale + 0.5 + uParallax;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uMap;
        uniform float uHasMap;
        uniform vec3 uTint;
        uniform vec3 uFogColor;
        uniform float uFogAmount;
        uniform float uExposure;
        uniform vec3 uSkyTop;
        uniform vec3 uSkyBottom;
        uniform float uVignette;
        uniform float uTime;

        void main() {
          vec2 uv = clamp(vUv, 0.0, 1.0);
          vec3 col = mix(uSkyBottom, uSkyTop, pow(uv.y, 1.15));
          if (uHasMap > 0.5) {
            vec3 t = texture2D(uMap, uv).rgb;
            float lum = dot(t, vec3(0.299, 0.587, 0.114));
            // Keep nearly all of the painting's chroma. The old 0.72 drained a
            // third of the saturation the art was authored with.
            t = mix(vec3(lum), t, 0.94);
            // Gentle S-curve for depth. Applied at half strength: full
            // smoothstep crushes the dark two-thirds of these plates (a 0.3
            // midtone fell to 0.22 before any of the other attenuations).
            t = mix(t, t*t*(3.0 - 2.0*t), 0.5);
            col = mix(col, t, 0.97);
          }
          col *= uExposure;
          // Distance haze — the plate dissolves into fog toward the bottom
          // (nearer the floor line) so 3D geometry reads in front of it.
          col = mix(col, uFogColor, uFogAmount * (0.5 + 0.5 * (1.0 - uv.y)));
          col = mix(col, col * uTint * 2.0, 0.12);
          col *= 1.0 + sin(uTime * 0.35) * 0.01;

          vec2 d = uv - 0.5;
          float vig = 1.0 - smoothstep(0.24, 0.9, length(d * vec2(1.02, 1.25)));
          col *= mix(1.0, vig, uVignette);

          // Ordered dither to kill visible gradient banding on the sky.
          float dnoise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          col += (dnoise - 0.5) * (1.5/255.0);

          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
      depthWrite: false,
      fog: false,
    })
    this.backdrop = new THREE.Mesh(geo, this.backdropMat)
    this.backdrop.position.set(0, BACKDROP_PLANE.centerY, BACKDROP_PLANE.z)
    this.backdrop.scale.set(BACKDROP_PLANE.width, BACKDROP_PLANE.height, 1)
    this.backdrop.renderOrder = -100
    this.root.add(this.backdrop)
  }

  private buildFloor() {
    const flags = flagsFor(this.quality)
    const texSize = flags.reflections ? Math.min(1280, Math.round(this.ctx.size.width || 1280)) : 512
    this.floor = new ReflectiveFloor(70, texSize, flags.reflections)
    this.root.add(this.floor.mesh)
  }

  private buildAtmosphere() {
    const flags = flagsFor(this.quality)
    const count = Math.round(THREE.MathUtils.clamp(flags.particleBudget * 0.18, 120, 900))
    this.dust = new DustField(count, new THREE.Vector3(34, 12, 26), 0xffca7a, 0.1)
    this.dust.setPixelRatio(this.ctx.renderer.getPixelRatio())
    this.root.add(this.dust.points)

    this.fog = groundFog(0x0a0716, 40)
    this.root.add(this.fog.group)
  }

  private clearBuild() {
    if (this.build) {
      this.build.dispose()
      this.build = null
    }
    for (const p of this.practicals) {
      p.parent?.remove(p)
      p.dispose()
    }
    this.practicals = []
  }

  private async applyStage(id: ScenarioId) {
    this.current = id
    const cfg = stageConfig(id)
    const flags = flagsFor(this.quality)

    this.getLightRig()?.setPreset(cfg.lighting, false)

    // Backdrop tint.
    this.backdropMat.uniforms.uFogColor.value.setHex(cfg.lighting.fog.color)
    this.backdropMat.uniforms.uTint.value.setHex(cfg.accent)
    this.backdropMat.uniforms.uSkyTop.value.setHex(cfg.lighting.background)
    this.backdropMat.uniforms.uSkyBottom.value.setHex(cfg.lighting.fog.color)

    // Floor look.
    const look: FloorLook = {
      base: cfg.floor.color,
      grid: cfg.floor.gridColor,
      gridIntensity: cfg.floor.gridIntensity,
      reflectivity: cfg.floor.reflectivity,
      roughness: cfg.floorRoughness,
      tint: cfg.floorTint,
      trim: cfg.trim,
      pattern: cfg.floor.pattern,
    }
    this.floor.applyLook(look)

    // Atmosphere colours. Near steam banks glow with a luminous per-stage tint
    // (fog colour lifted toward the mote colour) so they read as particulate in
    // the light; the far additive haze bands take the brighter accent so they
    // read as luminous atmospheric depth behind the set.
    this.dust.setColor(cfg.motes.color)
    const steamColor = new THREE.Color(cfg.lighting.fog.color).lerp(new THREE.Color(cfg.motes.color), 0.6)
    const fogKids = this.fog.group.children as THREE.Mesh[]
    fogKids.forEach((m, i) => {
      const isFar = i >= fogKids.length - 3
      ;(m.material as THREE.ShaderMaterial).uniforms.uColor.value.copy(isFar ? new THREE.Color(cfg.accent) : steamColor)
    })

    // Rebuild the mid-ground architecture.
    this.clearBuild()
    this.build = buildStageScene(id, cfg, flags)
    this.root.add(this.build.root)
    // Foreground occluders ride the camera-pinned frame, not the world set.
    this.frame.add(this.build.foreground)

    // Practical point lights motivated by the set.
    const maxPracticals = flags.shadows ? cfg.practicals.length : Math.min(1, cfg.practicals.length)
    for (let i = 0; i < maxPracticals; i++) {
      const pr = cfg.practicals[i]
      const light = new THREE.PointLight(pr.color, pr.intensity, pr.distance, 2)
      light.position.set(...pr.pos)
      this.root.add(light)
      this.practicals.push(light)
    }

    // Load and bind the far backdrop plate.
    try {
      const tex = await this.ctx.assets.texture(cfg.backdrop)
      if (this.current !== id) return
      this.backdropMat.uniforms.uMap.value = tex
      this.backdropMat.uniforms.uHasMap.value = 1
      const img = tex.image as { width?: number; height?: number } | undefined
      this.plateAspect = img?.width && img?.height ? img.width / img.height : 1.5
      this.syncBackdropFraming()
    } catch {
      this.backdropMat.uniforms.uHasMap.value = 0
    }
  }

  /**
   * Map the visible frustum onto the whole painting.
   *
   * Recomputed on aspect change rather than every frame, and derived from the
   * NEUTRAL camera rather than the live one: the plate stays world-fixed, so a
   * dollying camera slides it in frame and yields real parallax. Driving this
   * off the live camera would pin the art to the viewport and flatten it.
   */
  private syncBackdropFraming() {
    const aspect = this.ctx.camera.aspect || 16 / 9
    if (aspect === this.framedAspect && this.plateAspect === this.framedPlate) return
    this.framedAspect = aspect
    this.framedPlate = this.plateAspect
    const t = backdropUvTransform(
      {
        cameraZ: WORLD.CAMERA.position[2],
        cameraY: WORLD.CAMERA.position[1],
        targetY: WORLD.CAMERA.target[1],
        targetZ: WORLD.CAMERA.target[2],
        fovDeg: WORLD.CAMERA.fov,
        aspect,
      },
      BACKDROP_PLANE,
      this.plateAspect,
    )
    this.backdropMat.uniforms.uUvScale.value.set(t.scale[0], t.scale[1])
    this.backdropMat.uniforms.uUvPivot.value.set(t.pivot[0], t.pivot[1])
  }

  update(dt: number, state: FightRenderState) {
    this.time += dt
    if (state.scenario !== this.current) void this.applyStage(state.scenario)

    const cam = this.ctx.camera

    this.backdropMat.uniforms.uTime.value = this.time
    // Viewport aspect changes the visible rect, and therefore the crop. Cheap
    // guarded no-op once solved.
    if (this.backdropMat.uniforms.uHasMap.value > 0.5) this.syncBackdropFraming()
    this.backdropMat.uniforms.uParallax.value.set(
      -cam.position.x * 0.0016,
      -(cam.position.y - WORLD.CAMERA.position[1]) * 0.002,
    )

    // Floor lighting sync + animation.
    this.floor.setTime(this.time)
    const light = this.getLightRig()
    const cfg = stageConfig(state.scenario)
    if (light) {
      const d = light.description
      this.floor.syncLighting(d, cam.position, cfg.lighting.fog.color, cfg.lighting.fog.density)
    }
    this.floor.decay(dt)

    // Live contact shadows / reflection pools under each fighter.
    this.floor.setContacts(this.ctx.anchors.fighter('a'), this.ctx.anchors.fighter('b'))

    // Atmosphere.
    this.dust.update(this.time, dt, cfg.motes.drift + 0.4)
    this.fog.update(this.time)

    // Animated set-dressing. Relay the match's celebration beat first so
    // victory-only effects (the IPO ticker-tape) fire only at a round-over
    // moment, never during neutral play.
    if (this.build) {
      this.build.celebrate = state.celebrate ?? false
      this.build.update(this.time, dt)
      // Expose the live gate so the confetti probe can assert the celebration
      // plumbing is wired to the real phase — not a pixel heuristic a static
      // win-screen prompt could satisfy.
      if (import.meta.env.DEV)
        window.__STAGE__ = {
          celebrate: () => this.build?.celebrate ?? false,
          setForegroundVisible: (v: boolean) => {
            if (this.build) this.build.foreground.visible = v
          },
          setBuildVisible: (v: boolean) => {
            if (this.build) this.build.root.visible = v
          },
          setBackdropGrade: (g: { exposure?: number; fog?: number; vignette?: number }) => {
            const u = this.backdropMat.uniforms
            if (g.exposure !== undefined) u.uExposure.value = g.exposure
            if (g.fog !== undefined) u.uFogAmount.value = g.fog
            if (g.vignette !== undefined) u.uVignette.value = g.vignette
          },
          setFramePinned: (v: boolean) => {
            this.framePinned = v
          },
          framePinned: () => this.framePinned,
          project: (x: number, y: number, z: number) => {
            const cam = this.ctx.camera
            cam.updateMatrixWorld()
            const v = new THREE.Vector3(x, y, z).project(cam)
            return [v.x, v.y]
          },
          setLightScale: (s: number) => {
            this.getLightRig()?.debugSetLightScale(s)
          },
        }
    }

    // Practical flicker for "crisis"/warm bulbs realism.
    if (this.practicals.length && (state.scenario === 'crisis' || state.scenario === 'pre-pmf')) {
      const f = 0.9 + 0.1 * Math.sin(this.time * 13.0) * Math.sin(this.time * 7.3)
      for (let i = 0; i < this.practicals.length; i++) {
        this.practicals[i].intensity = cfg.practicals[i].intensity * f
      }
    }
  }

  onEvent(e: FightEvent) {
    if (e.kind === 'hit') {
      const p = this.ctx.anchors.fighter(e.target)
      this.floor.impact(p.x, p.z, e.power ?? 0)
    }
    if (e.kind === 'ko') {
      const p = this.ctx.anchors.fighter(e.loser)
      this.floor.impact(p.x, p.z, 1)
    }
  }

  setQuality(q: QualityTier) {
    if (q === this.quality) return
    const prev = this.quality
    this.quality = q
    const prevFlags = flagsFor(prev)
    const flags = flagsFor(q)

    // Reflection capability changed → rebuild the floor object.
    if (prevFlags.reflections !== flags.reflections) {
      this.floor.mesh.parent?.remove(this.floor.mesh)
      this.floor.dispose()
      this.buildFloor()
    }
    // Rebuild the set so crowd/shaft/practical gating re-applies.
    if (this.current) {
      const id = this.current
      this.current = null
      void this.applyStage(id)
    }
  }

  resize() {
    this.dust?.setPixelRatio(this.ctx.renderer.getPixelRatio())
  }

  dispose() {
    this.disposeLateUpdate?.()
    this.clearBuild()
    this.floor?.dispose()
    this.dust?.dispose()
    this.root.parent?.remove(this.root)
    this.root.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose?.()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose()
    })
  }
}
