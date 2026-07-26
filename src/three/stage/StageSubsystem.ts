import * as THREE from 'three'
import {
  WORLD,
  type EngineContext,
  type FightRenderState,
  type QualityTier,
  type Subsystem,
} from '../types'
import type { ScenarioId } from '../../types'
import { stageConfig } from './StageRegistry'
import type { LightRig } from '../lighting/LightRig'
import { flagsFor } from '../core/QualityManager'

/**
 * The stage.
 *
 * Structure (back to front):
 *   1. Backdrop plate — the existing generated stage art, pushed far back,
 *      slightly desaturated and fog-tinted so it reads as distance, and
 *      parallaxed against the camera.
 *   2. Mid-depth haze cards — two soft gradient planes that separate the
 *      backdrop from the play space.
 *   3. Floor — a real lit plane with an emissive grid and a mirrored
 *      reflection of the fighters, which is what makes the arena feel solid.
 *   4. Side pillars / stage frame — geometry that catches the rim light and
 *      gives the composition edges.
 */
export class StageSubsystem implements Subsystem {
  readonly name = 'stage'

  private ctx!: EngineContext
  private root = new THREE.Group()
  private backdrop!: THREE.Mesh
  private backdropMat!: THREE.ShaderMaterial
  private floor!: THREE.Mesh
  private floorMat!: THREE.ShaderMaterial
  private haze: THREE.Mesh[] = []
  private frame = new THREE.Group()
  private current: ScenarioId | null = null
  private time = 0
  private getLightRig: () => LightRig | undefined

  constructor(getLightRig: () => LightRig | undefined) {
    this.getLightRig = getLightRig
  }

  async init(ctx: EngineContext) {
    this.ctx = ctx
    ctx.scene.add(this.root)

    this.buildBackdrop()
    this.buildHaze()
    this.buildFloor()
    this.buildFrame()
  }

  private buildBackdrop() {
    const geo = new THREE.PlaneGeometry(1, 1, 48, 24)
    this.backdropMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: null },
        uHasMap: { value: 0 },
        uTime: { value: 0 },
        uTint: { value: new THREE.Color(0x223044) },
        uFogColor: { value: new THREE.Color(0x0a0716) },
        uFogAmount: { value: 0.42 },
        uExposure: { value: 1 },
        uParallax: { value: new THREE.Vector2(0, 0) },
        uSkyTop: { value: new THREE.Color(0x11081f) },
        uSkyBottom: { value: new THREE.Color(0x2c1440) },
        uVignette: { value: 0.55 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        uniform vec2 uParallax;
        void main() {
          vUv = uv + uParallax;
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
          vec3 col = mix(uSkyBottom, uSkyTop, uv.y);
          if (uHasMap > 0.5) {
            vec3 t = texture2D(uMap, uv).rgb;
            // Desaturate + push toward the fog colour with distance up the
            // frame, so the plate reads as atmosphere rather than wallpaper.
            float lum = dot(t, vec3(0.299, 0.587, 0.114));
            t = mix(vec3(lum), t, 0.82);
            col = t;
          }
          col *= uExposure;
          col = mix(col, uFogColor, uFogAmount * (0.35 + 0.65 * (1.0 - uv.y)));
          col = mix(col, col * uTint * 2.0, 0.16);

          // Slow luminance breathing so the backdrop is never dead still.
          col *= 1.0 + sin(uTime * 0.35) * 0.012;

          vec2 d = uv - 0.5;
          float vig = 1.0 - smoothstep(0.28, 0.86, length(d * vec2(1.05, 1.25)));
          col *= mix(1.0, vig, uVignette);

          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
      depthWrite: false,
      fog: false,
    })
    this.backdrop = new THREE.Mesh(geo, this.backdropMat)
    this.backdrop.position.set(0, 7.5, -26)
    this.backdrop.scale.set(74, 42, 1)
    this.backdrop.renderOrder = -100
    this.root.add(this.backdrop)
  }

  private buildHaze() {
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uColor: { value: new THREE.Color(0x0a0716) },
          uOpacity: { value: 0.35 - i * 0.12 },
          uTime: { value: 0 },
          uSeed: { value: i * 3.7 },
        },
        vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: /* glsl */ `
          precision highp float;
          varying vec2 vUv; uniform vec3 uColor; uniform float uOpacity; uniform float uTime; uniform float uSeed;
          float hash(vec2 p){ p=fract(p*vec2(233.34,851.73)); p+=dot(p,p+23.45); return fract(p.x*p.y); }
          float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
            return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
          void main(){
            float n = noise(vUv * vec2(3.0, 1.6) + vec2(uTime * 0.02 + uSeed, uSeed));
            n = n * 0.6 + noise(vUv * vec2(7.0, 3.0) - vec2(uTime * 0.035, 0.0)) * 0.4;
            float grad = smoothstep(0.0, 0.65, 1.0 - vUv.y);
            gl_FragColor = vec4(uColor, n * grad * uOpacity);
          }
        `,
      })
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
      m.position.set(0, 4.5 - i * 1.6, -16 + i * 7)
      m.scale.set(52 - i * 12, 16 - i * 4, 1)
      m.renderOrder = -90 + i
      this.haze.push(m)
      this.root.add(m)
    }
  }

  private buildFloor() {
    const geo = new THREE.PlaneGeometry(60, 46, 1, 1)
    this.floorMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0x1c1330) },
        uGridColor: { value: new THREE.Color(0xf77f00) },
        uGridIntensity: { value: 0.6 },
        uReflectivity: { value: 0.6 },
        uTime: { value: 0 },
        uFogColor: { value: new THREE.Color(0x0a0716) },
        uFogDensity: { value: 0.02 },
        uKeyDir: { value: new THREE.Vector3(0, 1, 0) },
        uKeyColor: { value: new THREE.Color(0xffffff) },
        uKeyIntensity: { value: 3 },
        uAmbient: { value: new THREE.Color(0x2a2440) },
        uAmbientIntensity: { value: 0.6 },
        uFlashPos: { value: new THREE.Vector4(0, 2, 0, 6) },
        uFlashColor: { value: new THREE.Color(0xffffff) },
        uFlashIntensity: { value: 0 },
        uImpact: { value: new THREE.Vector4(0, 0, 0, 0) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        varying vec3 vWorld;
        uniform vec3 uColor;
        uniform vec3 uGridColor;
        uniform float uGridIntensity;
        uniform float uReflectivity;
        uniform float uTime;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        uniform vec3 uKeyDir; uniform vec3 uKeyColor; uniform float uKeyIntensity;
        uniform vec3 uAmbient; uniform float uAmbientIntensity;
        uniform vec4 uFlashPos; uniform vec3 uFlashColor; uniform float uFlashIntensity;
        uniform vec4 uImpact;

        float gridLine(float c, float w) {
          float g = abs(fract(c - 0.5) - 0.5) / max(fwidth(c), 1e-4);
          return 1.0 - smoothstep(0.0, w, g);
        }

        void main() {
          vec3 N = vec3(0.0, 1.0, 0.0);
          vec3 V = normalize(cameraPosition - vWorld);

          // Base plate with a subtle brushed variation.
          vec3 base = uColor;

          // Two grid frequencies: a tight tile and a bold lane marker.
          float fine = max(gridLine(vWorld.x * 0.5, 1.2), gridLine(vWorld.z * 0.5, 1.2));
          float bold = max(gridLine(vWorld.x * 0.125, 1.6), gridLine(vWorld.z * 0.125, 1.6));
          float distFade = 1.0 - smoothstep(6.0, 30.0, length(vWorld.xz));
          vec3 grid = uGridColor * (fine * 0.22 + bold * 0.7) * uGridIntensity * distFade;

          // Centre-stage pool of light.
          float pool = 1.0 - smoothstep(1.5, 11.0, length(vWorld.xz - vec2(0.0, 0.6)));
          vec3 lit = base * (uAmbient * uAmbientIntensity + uKeyColor * uKeyIntensity * 0.16 * (0.35 + pool * 0.8));

          // Grazing-angle sheen — the cue that the floor is polished.
          float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
          vec3 sheen = uKeyColor * fres * uReflectivity * 0.35;

          // Impact ring: expanding shock ripple from the last hit.
          float ring = 0.0;
          if (uImpact.w > 0.001) {
            float d = length(vWorld.xz - uImpact.xy);
            float r = uImpact.z;
            ring = smoothstep(0.35, 0.0, abs(d - r)) * uImpact.w;
          }

          // Point-light flash bounce.
          vec3 toFlash = uFlashPos.xyz - vWorld;
          float fd = length(toFlash);
          float atten = uFlashIntensity / (1.0 + fd * fd * 2.4);
          vec3 flash = uFlashColor * atten * max(dot(N, normalize(toFlash)), 0.0);

          vec3 col = lit + grid + sheen + flash + uGridColor * ring * 2.2;

          float depth = length(cameraPosition - vWorld);
          float fogF = 1.0 - exp(-uFogDensity * uFogDensity * depth * depth);
          col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
    })
    this.floor = new THREE.Mesh(geo, this.floorMat)
    this.floor.rotation.x = -Math.PI / 2
    this.floor.position.y = WORLD.GROUND_Y
    this.floor.position.z = -4
    this.floor.receiveShadow = true
    this.root.add(this.floor)
  }

  /** Simple side framing so the composition has hard edges near the camera. */
  private buildFrame() {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x120b1e,
      roughness: 0.75,
      metalness: 0.2,
    })
    for (const sign of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 12, 1.4), mat)
      pillar.position.set(sign * 9.4, 5, -2.5)
      pillar.castShadow = true
      pillar.receiveShadow = true
      this.frame.add(pillar)
    }
    this.root.add(this.frame)
  }

  private async applyStage(id: ScenarioId) {
    this.current = id
    const cfg = stageConfig(id)

    this.getLightRig()?.setPreset(cfg.lighting, false)

    this.backdropMat.uniforms.uFogColor.value.setHex(cfg.lighting.fog.color)
    this.backdropMat.uniforms.uTint.value.setHex(cfg.accent)
    this.backdropMat.uniforms.uSkyTop.value.setHex(cfg.lighting.background)
    this.backdropMat.uniforms.uSkyBottom.value.setHex(cfg.lighting.fog.color)

    this.floorMat.uniforms.uColor.value.setHex(cfg.floor.color)
    this.floorMat.uniforms.uGridColor.value.setHex(cfg.floor.gridColor)
    this.floorMat.uniforms.uGridIntensity.value = cfg.floor.gridIntensity
    this.floorMat.uniforms.uReflectivity.value = cfg.floor.reflectivity
    this.floorMat.uniforms.uFogColor.value.setHex(cfg.lighting.fog.color)
    this.floorMat.uniforms.uFogDensity.value = cfg.lighting.fog.density

    for (const h of this.haze) {
      ;(h.material as THREE.ShaderMaterial).uniforms.uColor.value.setHex(cfg.lighting.fog.color)
    }

    try {
      const tex = await this.ctx.assets.texture(cfg.backdrop)
      if (this.current !== id) return
      this.backdropMat.uniforms.uMap.value = tex
      this.backdropMat.uniforms.uHasMap.value = 1
    } catch {
      this.backdropMat.uniforms.uHasMap.value = 0
    }
  }

  update(dt: number, state: FightRenderState) {
    this.time += dt
    if (state.scenario !== this.current) void this.applyStage(state.scenario)

    this.backdropMat.uniforms.uTime.value = this.time
    // Backdrop parallax against the camera — tiny values, big depth payoff.
    const cam = this.ctx.camera
    this.backdropMat.uniforms.uParallax.value.set(
      -cam.position.x * 0.0018,
      -(cam.position.y - WORLD.CAMERA.position[1]) * 0.0022,
    )

    for (const h of this.haze) {
      ;(h.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time
    }

    this.floorMat.uniforms.uTime.value = this.time
    const light = this.getLightRig()
    if (light) {
      const d = light.description
      this.floorMat.uniforms.uKeyDir.value.copy(d.keyDir)
      this.floorMat.uniforms.uKeyColor.value.copy(d.keyColor)
      this.floorMat.uniforms.uKeyIntensity.value = d.keyIntensity
      this.floorMat.uniforms.uAmbient.value.copy(d.ambientColor)
      this.floorMat.uniforms.uAmbientIntensity.value = d.ambientIntensity
      this.floorMat.uniforms.uFlashPos.value.copy(d.flashPos)
      this.floorMat.uniforms.uFlashColor.value.copy(d.flashColor)
      this.floorMat.uniforms.uFlashIntensity.value = d.flashIntensity
    }

    // Decay the impact ring.
    const imp = this.floorMat.uniforms.uImpact.value as THREE.Vector4
    if (imp.w > 0.001) {
      imp.z += dt * 14
      imp.w = Math.max(0, imp.w - dt * 1.8)
    }
  }

  onEvent(e: { kind: string; target?: 'a' | 'b'; power?: number }) {
    if (e.kind === 'hit' && e.target) {
      const p = this.ctx.anchors.fighter(e.target)
      const imp = this.floorMat.uniforms.uImpact.value as THREE.Vector4
      imp.set(p.x, p.z, 0.2, 0.5 + (e.power ?? 0) * 0.9)
    }
  }

  setQuality(q: QualityTier) {
    const flags = flagsFor(q)
    this.floor.receiveShadow = flags.shadows
    this.frame.visible = flags.shadows
  }

  dispose() {
    this.root.parent?.remove(this.root)
    this.root.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose()
    })
  }
}
