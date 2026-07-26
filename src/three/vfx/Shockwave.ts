import * as THREE from 'three'
import type { EngineContext, QualityTier } from '../types'

/**
 * Screen-facing shock & energy geometry.
 *
 * Without a scene grab-pass we can't do true refraction, so heavy-hit
 * distortion is faked the way most shipping fighters actually do it: a bright
 * compression rim plus chromatically-separated trailing rings. As the wave
 * expands the R/G/B rings pull apart, which the eye reads as the air bending.
 *
 * Modes:
 *   shock  — expanding chromatic ring (heavy / crit / ex impacts)
 *   radial — radial light streaks bursting outward (supers)
 *   halo   — soft energy disc that flashes and fades (contact bloom)
 */

type WaveMode = 'shock' | 'radial' | 'halo'

interface Wave {
  mesh: THREE.Mesh
  mat: THREE.ShaderMaterial
  life: number
  max: number
}

export class Shockwave {
  private pool: Wave[] = []
  private cursor = 0
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private enabled = true

  constructor(ctx: EngineContext) {
    this.scene = ctx.scene
    this.camera = ctx.camera
    const geo = new THREE.PlaneGeometry(1, 1)
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uAge: { value: 1 },
          uColor: { value: new THREE.Color(0xffffff) },
          uColor2: { value: new THREE.Color(0xff7a1a) },
          uMode: { value: 0 },
          uIntensity: { value: 1 },
          uSeed: { value: Math.random() * 10 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
        `,
        fragmentShader: WAVE_FRAG,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.frustumCulled = false
      mesh.renderOrder = 28
      mesh.visible = false
      this.scene.add(mesh)
      this.pool.push({ mesh, mat, life: 0, max: 1 })
    }
    this.configure(ctx.quality)
  }

  configure(q: QualityTier) {
    this.enabled = q !== 'low'
  }

  spawn(
    mode: WaveMode,
    pos: THREE.Vector3,
    size: number,
    duration: number,
    color: THREE.Color,
    color2: THREE.Color,
    intensity = 1,
  ) {
    if (!this.enabled) return
    const w = this.pool[this.cursor]
    this.cursor = (this.cursor + 1) % this.pool.length
    w.life = duration
    w.max = duration
    w.mesh.position.copy(pos)
    w.mesh.scale.setScalar(size)
    w.mat.uniforms.uColor.value.copy(color)
    w.mat.uniforms.uColor2.value.copy(color2)
    w.mat.uniforms.uMode.value = mode === 'shock' ? 0 : mode === 'radial' ? 1 : 2
    w.mat.uniforms.uIntensity.value = intensity
    w.mat.uniforms.uSeed.value = Math.random() * 10
    w.mat.uniforms.uAge.value = 0
    w.mesh.visible = true
  }

  update(dt: number) {
    for (const w of this.pool) {
      if (w.life <= 0) continue
      w.life = Math.max(0, w.life - dt)
      w.mat.uniforms.uAge.value = 1 - w.life / w.max
      // Billboard toward the camera.
      w.mesh.quaternion.copy(this.camera.quaternion)
      if (w.life <= 0) w.mesh.visible = false
    }
  }

  dispose() {
    for (const w of this.pool) {
      w.mesh.parent?.remove(w.mesh)
      w.mat.dispose()
      w.mesh.geometry.dispose()
    }
    this.pool = []
  }
}

const WAVE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uAge;    // 0..1
  uniform vec3  uColor;
  uniform vec3  uColor2;
  uniform float uMode;   // 0 shock, 1 radial, 2 halo
  uniform float uIntensity;
  uniform float uSeed;

  float hash(float x){ return fract(sin(x*127.1)*43758.5453); }

  // A thin, bright ring at radius 'rad' with half-width 'w'.
  float ring(float r, float rad, float w){
    return smoothstep(w, 0.0, abs(r - rad));
  }

  void main(){
    vec2 d = vUv - 0.5;
    float r = length(d) * 2.0;
    float ang = atan(d.y, d.x);

    if (uMode < 0.5) {
      // SHOCK: a violent compression front — a bright white leading rim with a
      // subtle chromatic fringe trailing behind it (refraction, not neon rings).
      float ease = 1.0 - pow(1.0 - uAge, 2.2);   // fast then settle
      float base = ease;                          // ring radius 0..1
      float sep  = 0.015 + ease * 0.045;          // tight chromatic fringe
      float w = mix(0.12, 0.022, uAge);
      // bright achromatic leading edge (the pressure front)
      float lead = ring(r, base, w);
      // thin chromatic fringe just inside the front
      float rr = ring(r, base + sep, w * 0.7);
      float gg = ring(r, base,       w * 0.7);
      float bb = ring(r, base - sep, w * 0.7);
      // ragged, energetic edge
      float ragged = 0.75 + 0.25 * hash(floor(ang * 7.0) + uSeed);
      float fade = (1.0 - smoothstep(0.35, 1.0, uAge));
      vec3 fringe = vec3(rr, gg, bb) * 0.5;
      vec3 tint = (uColor + uColor2) * 0.5;
      // white-hot front + flavour-tinted body + faint chromatic edge
      vec3 col = (vec3(lead) * 1.4 + tint * lead * 0.8 + fringe) * ragged;
      float a = max(lead, max(max(rr, gg), bb)) * fade;
      col *= uIntensity * (1.6 + fade);
      if (a < 0.005) discard;
      gl_FragColor = vec4(col, a);
    } else if (uMode < 1.5) {
      // RADIAL: super burst — sharp light rays from the centre.
      float rays = 0.0;
      float aa = ang * 24.0;
      rays = pow(0.5 + 0.5 * sin(aa + uSeed * 6.0), 8.0);
      rays += pow(0.5 + 0.5 * sin(aa * 0.5 + 1.7), 12.0) * 0.7;
      float radial = smoothstep(1.0, 0.15, r);
      float grow = smoothstep(0.0, 0.12, uAge);
      float fade = 1.0 - smoothstep(0.3, 1.0, uAge);
      float core = smoothstep(0.35, 0.0, r);
      float a = (rays * radial * 0.9 + core) * grow * fade;
      vec3 col = mix(uColor2, uColor, radial) * uIntensity * (1.5 + core * 3.0);
      if (a < 0.005) discard;
      gl_FragColor = vec4(col, a);
    } else {
      // HALO: soft energy disc bloom.
      float grow = smoothstep(0.0, 0.1, uAge);
      float fade = 1.0 - smoothstep(0.15, 1.0, uAge);
      float body = smoothstep(1.0, 0.0, r);
      float a = pow(body, 1.6) * grow * fade;
      vec3 col = mix(uColor2, uColor, body) * uIntensity * (1.0 + body * 2.0);
      if (a < 0.005) discard;
      gl_FragColor = vec4(col, a * 0.9);
    }
  }
`
