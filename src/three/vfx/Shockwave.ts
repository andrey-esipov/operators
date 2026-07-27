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

type WaveMode = 'shock' | 'radial' | 'halo' | 'star' | 'crystal' | 'bolt' | 'beam'

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
      mode === 'shock' ? 0 : mode === 'radial' ? 1 : mode === 'halo' ? 2 : mode === 'star' ? 3 : mode === 'crystal' ? 4 : mode === 'bolt' ? 5 : 6
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
  uniform float uMode;   // 0 shock,1 radial,2 halo,3 star,4 crystal,5 bolt,6 beam
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

  // Structured hot core: a bright centre broken up by turbulence so it never
  // reads as a flat blown-out white blob. White only at the pinpoint; the body
  // is tinted so the flavour colour survives bloom + grade.
  vec3 hotCore(float r, float ang, vec3 tint, float radius, float seed){
    float body = smoothstep(radius, 0.0, r);
    float churn = 0.45 + 0.9 * fbm(vec2(cos(ang), sin(ang)) * 5.0 + vec2(seed, -uAge * 3.0));
    float pin = smoothstep(radius * 0.32, 0.0, r);      // tiny white pinpoint
    return tint * pow(body, 1.6) * churn * 2.2 + vec3(1.0) * pin * 1.6;
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
      // RADIAL: super burst — dense, uneven light shafts from a structured core.
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
      // structured, churning core instead of a flat white disc
      vec3 core = hotCore(r, ang, uColor2, 0.42, uSeed);
      float coreA = smoothstep(0.42, 0.0, r);
      float a = clamp((rays * radial * 0.95 + coreA) * grow * fade, 0.0, 1.0);
      vec3 col = uColor2 * (rays * radial * 2.4 + 0.25) + core;
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
      float hotcore = smoothstep(0.28, 0.0, r);
      vec3 col = uColor2 * (0.8 + body * 2.2) + vec3(1.0) * hotcore * 1.0;
      col *= uIntensity;
      if (a < 0.005) discard;
      gl_FragColor = vec4(col, a * 0.9);
    } else if (uMode < 3.5) {
      // STAR: a hard 6-point impact star (CRIT signature) — sharp, thin spikes
      // that narrow to a razor tip, with a bright core line down each one. The
      // sharp geometry gives crit an unmistakable silhouette, nothing like the
      // soft radial super sun or the electric ex ring.
      float grow = smoothstep(0.0, 0.05, uAge);
      float fade = 1.0 - smoothstep(0.24, 1.0, uAge);
      float ease = 1.0 - pow(1.0 - uAge, 2.6);
      float N = 6.0;
      float sector = 6.28318 / N;
      // angular distance to the nearest of 6 spoke axes
      float da = abs(mod(ang + sector * 0.5, sector) - sector * 0.5);
      float reach = 0.98 * ease;
      float along = smoothstep(reach, 0.0, r);                 // full near centre → tip
      float halfw = 0.30 * clamp(1.0 - r / max(reach, 0.001), 0.0, 1.0); // narrows to tip
      float spike = along * smoothstep(halfw, halfw * 0.15, da);
      float coreline = along * smoothstep(halfw * 0.35, 0.0, da); // bright white spine
      // small crisp impact ring at the base
      float baseRing = ring(r, 0.30 * ease, 0.04 * ease + 0.01);
      vec3 core = hotCore(r, ang, uColor2, 0.24, uSeed);
      float coreA = smoothstep(0.24, 0.0, r);
      float a = clamp((spike * 0.85 + coreline + baseRing + coreA) * grow * fade, 0.0, 1.0);
      vec3 col = uColor2 * (spike * 2.2 + baseRing * 2.0 + 0.2) + vec3(1.0) * coreline * 2.0 + core;
      col *= uIntensity;
      if (a < 0.005) discard;
      gl_FragColor = vec4(col, a);
    } else if (uMode < 4.5) {
      // CRYSTAL: an actual faceted glass polygon (SHATTER signature). The shell
      // is a hard regular-polygon boundary (flat facets, sharp corners), with
      // straight radial fracture lines lancing from the corners to the centre —
      // a shattering pane of armour, never a soft round ring.
      float grow = smoothstep(0.0, 0.04, uAge);
      float fade = 1.0 - smoothstep(0.32, 1.0, uAge);
      float ease = 1.0 - pow(1.0 - uAge, 1.9);
      float N = 7.0;
      float sector = 6.28318 / N;
      float rot = uSeed * 1.7;
      float da = mod(ang + rot + sector * 0.5, sector) - sector * 0.5; // -s/2..s/2
      // regular-polygon edge distance for this angle (flat facets)
      float edge = ease * 0.92 * (cos(sector * 0.5) / cos(da));
      // hard glassy shell band on the polygon boundary
      float shell = smoothstep(0.055, 0.0, abs(r - edge));
      // inner concentric facet (a second, smaller pane) for layered glass
      float edge2 = edge * 0.6;
      float shell2 = smoothstep(0.035, 0.0, abs(r - edge2)) * 0.6;
      // straight radial fracture lines running from each corner to the centre
      float corner = abs(abs(da) - sector * 0.5);       // 0 at a polygon corner
      float crack = smoothstep(0.02, 0.0, corner) * smoothstep(edge * 1.02, 0.0, r);
      // fine secondary chip cracks
      float chip = smoothstep(0.008, 0.0, abs(mod(ang * 3.0 + uSeed, sector) - sector * 0.5))
                   * smoothstep(edge, edge2, r) * 0.5;
      vec3 core = hotCore(r, ang, uColor2, 0.22, uSeed) * 0.8;
      float coreA = smoothstep(0.22, 0.0, r) * 0.8;
      float a = clamp((shell + shell2 + crack * 0.9 + chip + coreA) * grow * fade, 0.0, 1.0);
      // bright glassy rim (white) on the shell crest, flavour colour in the body
      vec3 col = uColor2 * (shell * 1.4 + shell2 + crack * 1.8 + chip * 1.5 + 0.2)
                 + vec3(1.0) * (shell * 1.3 + crack * 0.6) + core;
      col *= uIntensity;
      if (a < 0.005) discard;
      gl_FragColor = vec4(col, a);
    } else if (uMode < 5.5) {
      // BOLT: a crackling electric discharge (EX signature). Thin, jagged
      // lightning fingers of random length jitter around the centre and a torn
      // crackle-ring snaps around the rim — reads as raw electricity, clearly
      // distinct from combo's smooth violet ring.
      float grow = smoothstep(0.0, 0.03, uAge);
      float fade = 1.0 - smoothstep(0.22, 1.0, uAge);
      float ease = 1.0 - pow(1.0 - uAge, 2.4);
      float NB = 13.0;
      float lane = floor((ang + 3.14159) / 6.28318 * NB);
      float within = fract((ang + 3.14159) / 6.28318 * NB) - 0.5;   // -0.5..0.5 in lane
      // each bolt wanders sideways with noise as it travels outward
      float wander = (fbm(vec2(lane * 4.1 + uSeed, r * 7.0 - ease * 6.0)) - 0.5) * 0.7;
      float bolt = smoothstep(0.16, 0.0, abs(within - wander));
      // random per-lane length; only some lanes reach far
      float len = 0.35 + 0.65 * hash(lane + uSeed * 3.0);
      bolt *= smoothstep(ease * len, ease * len - 0.18, r);
      bolt *= smoothstep(0.02, 0.10, r);   // clear the very centre
      // flicker so it feels alive, not a static gear
      bolt *= 0.55 + 0.9 * fbm(vec2(lane * 2.0, r * 12.0) + uSeed * 4.0);
      // torn crackle ring
      float ringR = ease * 0.62 * (0.85 + 0.3 * fbm(vec2(cos(ang), sin(ang)) * 6.0 + uSeed));
      float crackle = smoothstep(0.05, 0.0, abs(r - ringR))
                      * (0.5 + 0.8 * pow(0.5 + 0.5 * sin(ang * 24.0 + uSeed * 8.0), 3.0));
      vec3 core = hotCore(r, ang, uColor2, 0.20, uSeed);
      float coreA = smoothstep(0.20, 0.0, r);
      float a = clamp((bolt + crackle + coreA) * grow * fade, 0.0, 1.0);
      // bolts are white-hot cyan cores
      vec3 col = uColor2 * (bolt * 1.6 + crackle * 2.0 + 0.2) + vec3(1.0) * (bolt * 1.4 + crackle * 0.6) + core;
      col *= uIntensity;
      if (a < 0.005) discard;
      gl_FragColor = vec4(col, a);
    } else {
      // BEAM: an anime super-flash column (SIGNATURE). A blinding vertical light
      // pillar with a thin horizontal lens crossbar and secondary radial spokes.
      // The strong vertical shape is unmistakably different from the round golden
      // ult sun, so the two biggest supers never collide.
      float grow = smoothstep(0.0, 0.04, uAge);
      float fade = 1.0 - smoothstep(0.28, 1.0, uAge);
      float ease = 1.0 - pow(1.0 - uAge, 2.0);
      // vertical pillar — narrow in x, tall in y, feathered edges + churn
      float pillarW = 0.14 + 0.05 * fbm(vec2(d.y * 6.0, uSeed));
      float pillar = smoothstep(pillarW, 0.0, abs(d.x)) * smoothstep(1.0, 0.1, abs(d.y) * 0.9);
      // thin horizontal lens crossbar
      float bar = smoothstep(0.035, 0.0, abs(d.y)) * smoothstep(1.0, 0.0, abs(d.x) * 0.85);
      // secondary radial spokes so the centre still bursts
      float spokes = pow(0.5 + 0.5 * sin(ang * 16.0 + uSeed * 6.0), 9.0) * smoothstep(0.9, 0.15, r) * 0.7;
      float grid = grow * ease;
      pillar *= grid; bar *= grid; spokes *= grid;
      vec3 core = hotCore(r, ang, uColor2, 0.34, uSeed);
      float coreA = smoothstep(0.34, 0.0, r);
      float a = clamp((pillar + bar + spokes + coreA) * fade, 0.0, 1.0);
      vec3 col = uColor2 * (pillar * 1.9 + bar * 1.6 + spokes * 2.0 + 0.2)
                 + vec3(1.0) * (bar * 0.8 + pillar * 0.4) + core;
      col *= uIntensity;
      if (a < 0.005) discard;
      gl_FragColor = vec4(col, a);
    }
  }
`
