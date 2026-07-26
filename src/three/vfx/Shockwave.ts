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

type WaveMode = 'shock' | 'radial' | 'halo' | 'star' | 'crystal'

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
    stretchX = 1,
  ) {
    if (!this.enabled) return
    const w = this.pool[this.cursor]
    this.cursor = (this.cursor + 1) % this.pool.length
    w.life = duration
    w.max = duration
    w.mesh.position.copy(pos)
    w.mesh.scale.set(size * stretchX, size, 1)
    w.mat.uniforms.uColor.value.copy(color)
    w.mat.uniforms.uColor2.value.copy(color2)
    w.mat.uniforms.uMode.value =
      mode === 'shock' ? 0 : mode === 'radial' ? 1 : mode === 'halo' ? 2 : mode === 'star' ? 3 : 4
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
  float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }

  // Smooth value noise + fbm for turbulent, non-circular edges.
  float vnoise(vec2 p){
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f*f*(3.0-2.0*f);
    float a = hash2(i);
    float b = hash2(i+vec2(1.0,0.0));
    float c = hash2(i+vec2(0.0,1.0));
    float d = hash2(i+vec2(1.0,1.0));
    return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
  }
  float fbm(vec2 p){
    float s=0.0, a=0.5;
    for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.02; a*=0.5; }
    return s;
  }

  // A thin, bright ring at radius 'rad' with half-width 'w'.
  float ring(float r, float rad, float w){
    return smoothstep(w, 0.0, abs(r - rad));
  }

  void main(){
    vec2 d = vUv - 0.5;
    float r = length(d) * 2.0;
    float ang = atan(d.y, d.x);

    if (uMode < 0.5) {
      // SHOCK: a violent, turbulent compression front. The radius is warped
      // per-angle by fbm so it reads as a ragged blast wave, never a clean ring.
      float ease = 1.0 - pow(1.0 - uAge, 2.2);   // fast then settle
      // angular turbulence — wobble the front hard so it is asymmetric & torn
      float turb = fbm(vec2(cos(ang), sin(ang)) * 2.6 + uSeed * 3.0);
      float turb2 = fbm(vec2(cos(ang)*4.3, sin(ang)*4.3) + uSeed);
      float turb3 = fbm(vec2(cos(ang)*8.1, sin(ang)*8.1) - uSeed * 2.0);
      float base = ease * (0.86 + 0.30 * turb - 0.08 * turb3);   // strongly warped radius
      float sep  = 0.02 + ease * 0.055;
      float w = mix(0.15, 0.02, uAge) * (0.55 + 0.9 * turb2);
      // leading pressure front
      float lead = ring(r, base, w);
      // chromatic fringe just inside the front (R/G/B pulled apart = air bending)
      float rr = ring(r, base + sep, w * 0.7);
      float gg = ring(r, base,       w * 0.7);
      float bb = ring(r, base - sep, w * 0.7);
      // radial tendrils shooting past the front (energy licking outward)
      float tend = pow(0.5 + 0.5 * sin(ang * 9.0 + turb * 6.0 + uSeed * 5.0), 6.0);
      tend *= smoothstep(base + 0.20, base - 0.02, r) * smoothstep(base - 0.28, base, r);
      // erode the whole thing with noise so it tears rather than fades cleanly
      float erode = 0.5 + 0.7 * fbm(vec2(ang * 3.0, r * 6.0 - ease * 4.0) + uSeed * 2.0);
      float fade = (1.0 - smoothstep(0.35, 1.0, uAge));
      float front = (lead + tend * 0.75) * erode;
      // FLAVOUR COLOUR OWNS THE RING. Only a razor-thin hot core on the very
      // crest reads white; everything else is saturated identity colour so
      // violet/cyan/gold survive the bloom + colour grade instead of washing out.
      float crest = ring(r, base, w * 0.28);          // thin white-hot crest
      vec3 chroma = vec3(uColor2.r * rr, uColor2.g * gg, uColor2.b * bb); // tinted chromatic fringe
      vec3 col = uColor2 * front * 2.6 + vec3(crest) * (0.7 + 0.5 * turb2) + chroma * 1.1;
      float a = clamp(max(front, max(max(rr, gg), bb)) * fade, 0.0, 1.0);
      col *= uIntensity * (1.3 + fade * 0.8);
      if (a < 0.005) discard;
      gl_FragColor = vec4(col, a);
    } else if (uMode < 1.5) {
      // RADIAL: super burst — sharp, uneven light rays from the centre.
      float aa = ang * 22.0;
      // irregular ray lengths so it doesn't read as a perfect gear
      float raylen = 0.5 + 0.5 * hash(floor(ang * 22.0 / 6.2831 * 22.0) + uSeed);
      float rays = pow(0.5 + 0.5 * sin(aa + uSeed * 6.0), 8.0) * raylen;
      rays += pow(0.5 + 0.5 * sin(aa * 0.5 + 1.7), 12.0) * 0.7;
      // flicker/erode the rays with noise
      rays *= 0.6 + 0.7 * fbm(vec2(ang * 5.0, r * 3.0 - uAge * 3.0) + uSeed);
      float radial = smoothstep(1.0, 0.12, r);
      float grow = smoothstep(0.0, 0.1, uAge);
      float fade = 1.0 - smoothstep(0.3, 1.0, uAge);
      float core = smoothstep(0.28, 0.0, r);
      float a = clamp((rays * radial * 0.95 + core) * grow * fade, 0.0, 1.0);
      // energy colour owns the rays; white only at the pinpoint core so the
      // super reads as a coloured star-burst, not a featureless whiteout.
      vec3 col = uColor2 * (rays * radial * 2.4 + 0.3) + vec3(1.0) * core * 2.6;
      col *= uIntensity;
      if (a < 0.005) discard;
      gl_FragColor = vec4(col, a);
    } else if (uMode < 2.5) {
      // HALO: turbulent energy bloom — flavour-tinted, eroded so it churns.
      float grow = smoothstep(0.0, 0.1, uAge);
      float fade = 1.0 - smoothstep(0.15, 1.0, uAge);
      float body = smoothstep(1.0, 0.0, r);
      float churn = 0.55 + 0.7 * fbm(vec2(cos(ang), sin(ang)) * 3.0 + vec2(uSeed, -uAge * 2.0));
      float a = pow(body, 1.7) * grow * fade * churn;
      // hot white only at the very core; the disc body is saturated identity colour
      float hotcore = smoothstep(0.35, 0.0, r);
      vec3 col = uColor2 * (0.8 + body * 2.2) + vec3(1.0) * hotcore * 1.4;
      col *= uIntensity;
      if (a < 0.005) discard;
      gl_FragColor = vec4(col, a * 0.9);
    } else if (uMode < 3.5) {
      // STAR: a hard, angular impact star (CRIT signature) — sharp geometric
      // points, nothing like the soft radial super rays. Reads as a struck-metal
      // spark cross, giving crit its own unmistakable silhouette.
      float grow = smoothstep(0.0, 0.06, uAge);
      float fade = 1.0 - smoothstep(0.22, 1.0, uAge);
      float ease = 1.0 - pow(1.0 - uAge, 2.4);
      float lobes = pow(abs(cos(ang * 3.0)), 7.0);              // 6 hard points
      float lobesB = pow(abs(cos(ang * 2.0 + 0.7)), 12.0) * 0.7; // 4 sub-points
      float lobe = max(lobes, lobesB);
      float reach = (0.28 + 0.68 * lobe) * ease;
      float spike = smoothstep(reach, reach - 0.42, r) * (0.35 + lobe);
      // thin bright edge running down each spike
      float edge = smoothstep(0.06, 0.0, abs(r - reach)) * lobe;
      float core = smoothstep(0.24, 0.0, r);
      float a = clamp((spike * 0.85 + edge * 0.9 + core) * grow * fade, 0.0, 1.0);
      vec3 col = uColor2 * (spike * 2.0 + edge * 2.4 + 0.35) + vec3(1.0) * core * 2.4;
      col *= uIntensity;
      if (a < 0.005) discard;
      gl_FragColor = vec4(col, a);
    } else {
      // CRYSTAL: a faceted, brittle ice shell (SHATTER signature). The radius is
      // quantised into hard flat facets so the silhouette is angular and glassy,
      // with radial fracture lines lancing inward — never a soft round ring.
      float grow = smoothstep(0.0, 0.05, uAge);
      float fade = 1.0 - smoothstep(0.3, 1.0, uAge);
      float ease = 1.0 - pow(1.0 - uAge, 2.0);
      float facets = 9.0;
      float seg = floor((ang + 3.14159) / (6.28318 / facets));
      float fr = hash(seg + uSeed * 2.0);
      float rad = ease * (0.66 + 0.4 * fr);
      float w = mix(0.11, 0.015, uAge);
      float shell = ring(r, rad, w);
      // bevel highlight just inside each facet
      float bevel = smoothstep(0.05, 0.0, abs(r - rad + 0.05)) * 0.6;
      // radial fracture cracks
      float crack = pow(0.5 + 0.5 * sin(ang * facets + uSeed * 4.0), 22.0) * smoothstep(rad, 0.0, r);
      float core = smoothstep(0.26, 0.0, r);
      float a = clamp((shell + bevel + crack * 0.7 + core) * grow * fade, 0.0, 1.0);
      vec3 col = uColor2 * (shell * 2.4 + crack * 1.6 + 0.3) + vec3(1.0) * (core * 2.0 + bevel * 1.5);
      col *= uIntensity;
      if (a < 0.005) discard;
      gl_FragColor = vec4(col, a);
    }
  }
`
