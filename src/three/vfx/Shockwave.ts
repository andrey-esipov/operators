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

type WaveMode = 'shock' | 'radial' | 'halo' | 'star' | 'crystal' | 'bolt' | 'beam' | 'flurry'

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
      mode === 'shock' ? 0 : mode === 'radial' ? 1 : mode === 'halo' ? 2 : mode === 'star' ? 3 : mode === 'crystal' ? 4 : mode === 'bolt' ? 5 : mode === 'beam' ? 6 : 7
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
  uniform float uMode;   // 0 shock,1 radial,2 halo,3 star,4 crystal,5 bolt,6 beam,7 flurry
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
    float churn = 0.5 + 0.85 * fbm(vec2(cos(ang), sin(ang)) * 5.0 + vec2(seed, -uAge * 3.0));
    float pin = smoothstep(radius * 0.20, 0.0, r);      // tiny white pinpoint
    // Flavour colour owns the core body; white is confined to a small pin so the
    // centre never resolves to a flat blown-out blob.
    return tint * pow(body, 1.95) * churn * 1.7 + vec3(1.0) * pin * 0.7;
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
      // RADIAL: ULT divine sunburst. Long, SHARP god-rays radiate from a small
      // defined core over a TRANSPARENT disc (no flat fill) so the ray structure
      // always reads instead of blooming into one solid orange ball. A crisp
      // expanding gold ring marks the super's shock front.
      float grow = smoothstep(0.0, 0.03, uAge);
      float fade = 1.0 - smoothstep(0.30, 1.0, uAge);
      // primary long rays (12) + sharp secondary rays (24) with per-spoke length
      float rays = pow(0.5 + 0.5 * sin(ang * 12.0 + uSeed * 6.0), 14.0);
      rays += pow(0.5 + 0.5 * sin(ang * 24.0 + 1.7 + uSeed), 22.0) * 0.5;
      float rayLen = 0.55 + 0.45 * hash(floor((ang + 3.14159) / 6.2831 * 12.0) + uSeed);
      // rays reach outward from just past the core and taper to nothing
      float along = smoothstep(rayLen, 0.12, r) * smoothstep(0.07, 0.2, r);
      rays *= along;
      rays *= 0.7 + 0.55 * fbm(vec2(ang * 5.0, r * 3.0 - uAge * 3.0) + uSeed);
      // crisp expanding golden ring — the super's shock front
      float ringR = 0.28 + 0.58 * (1.0 - pow(1.0 - uAge, 2.0));
      float goldRing = ring(r, ringR, 0.055) * (1.0 - smoothstep(0.55, 1.0, uAge));
      // small, defined churning core (never a big flat disc)
      vec3 core = hotCore(r, ang, uColor2, 0.16, uSeed);
      float coreA = smoothstep(0.16, 0.0, r);
      float body = rays + goldRing * 0.9;
      float a = clamp((body + coreA * 0.32) * grow * fade, 0.0, 1.0);
      // Rays own the frame; the central core is kept very dim so it never blooms
      // into a solid dome that swallows the god-ray silhouette. Rays boosted so the
      // long spokes punch out past the hot centre on bright, heavily-graded stages.
      vec3 col = uColor2 * (body * 2.9) + vec3(1.0) * goldRing * 0.3 + core * 0.25;
      col *= uIntensity;
      if (a < 0.004) discard;
      gl_FragColor = vec4(col, a);
    } else if (uMode < 2.5) {
      // HALO: turbulent energy bloom — flavour-tinted, eroded so it churns.
      float grow = smoothstep(0.0, 0.1, uAge);
      float fade = 1.0 - smoothstep(0.15, 1.0, uAge);
      float body = smoothstep(1.0, 0.0, r);
      float churn = 0.55 + 0.7 * fbm(vec2(cos(ang), sin(ang)) * 3.0 + vec2(uSeed, -uAge * 2.0));
      float a = pow(body, 1.7) * grow * fade * churn;
      // hot white only at the very core; the disc body is saturated identity colour
      float hotcore = smoothstep(0.24, 0.0, r);
      vec3 col = uColor2 * (0.9 + body * 2.2) + vec3(1.0) * hotcore * 0.45;
      col *= uIntensity;
      if (a < 0.005) discard;
      gl_FragColor = vec4(col, a * 0.9);
    } else if (uMode < 3.5) {
      // STAR: a hard 6-point impact star (CRIT signature) — sharp, thin spikes
      // that narrow to a razor tip, with a bright core line down each one. The
      // sharp geometry gives crit an unmistakable silhouette, nothing like the
      // soft radial super sun or the electric ex ring.
      float grow = smoothstep(0.0, 0.035, uAge);
      float fade = 1.0 - smoothstep(0.24, 1.0, uAge);
      // SNAP to full size in ~3 frames (with a tiny overshoot pop) then hold — a
      // real impact star cracks open instantly, it does not slowly grow.
      float ease = smoothstep(0.0, 0.05, uAge) * (1.0 + 0.14 * (1.0 - smoothstep(0.05, 0.15, uAge)));
      float N = 6.0;
      float sector = 6.28318 / N;
      // angular distance to the nearest of 6 spoke axes
      float da = abs(mod(ang + sector * 0.5, sector) - sector * 0.5);
      float reach = 0.98 * ease;
      float along = smoothstep(reach, 0.0, r);                 // full near centre → tip
      float halfw = 0.30 * clamp(1.0 - r / max(reach, 0.001), 0.0, 1.0); // narrows to tip
      float spike = along * smoothstep(halfw, halfw * 0.08, da);
      float coreline = along * smoothstep(halfw * 0.35, 0.0, da); // bright white spine
      // small crisp impact ring at the base
      float baseRing = ring(r, 0.30 * ease, 0.04 * ease + 0.01);
      vec3 core = hotCore(r, ang, uColor2, 0.20, uSeed);
      float coreA = smoothstep(0.20, 0.0, r);
      // Spikes own the silhouette; the centre is only a small churning core (not a
      // filled disc) so under heavy bloom the STAR shape survives instead of
      // melting into a solid bright ball.
      float a = clamp((spike * 0.95 + coreline + baseRing + coreA * 0.32) * grow * fade, 0.0, 1.0);
      vec3 col = uColor2 * (spike * 2.6 + baseRing * 2.0) + vec3(1.0) * coreline * 0.6 + core * 0.9;
      col *= uIntensity;
      if (a < 0.005) discard;
      gl_FragColor = vec4(col, a);
    } else if (uMode < 4.5) {
      // CRYSTAL: an actual faceted glass polygon (SHATTER signature). The shell
      // is a hard regular-polygon boundary (flat facets, sharp corners), with
      // straight radial fracture lines lancing from the corners to the centre —
      // a shattering pane of armour, never a soft round ring.
      float grow = smoothstep(0.0, 0.035, uAge);
      float fade = 1.0 - smoothstep(0.32, 1.0, uAge);
      // SNAP open — the armour pane cracks to full size instantly, then holds
      // as a flash-frozen shatter before it fades.
      float ease = smoothstep(0.0, 0.045, uAge) * (1.0 + 0.10 * (1.0 - smoothstep(0.045, 0.16, uAge)));
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
      vec3 core = hotCore(r, ang, uColor2, 0.16, uSeed) * 0.28;
      float coreA = smoothstep(0.16, 0.0, r) * 0.3;
      float a = clamp((shell + shell2 + crack * 0.9 + chip + coreA) * grow * fade, 0.0, 1.0);
      // bright glassy rim (white) on the shell crest, flavour colour in the body
      vec3 col = uColor2 * (shell * 2.3 + shell2 * 1.5 + crack * 2.4 + chip * 1.8 + 0.09)
                 + vec3(1.0) * (shell * 1.15 + crack * 0.5) + core;
      col *= uIntensity;
      if (a < 0.005) discard;
      gl_FragColor = vec4(col, a);
    } else if (uMode < 5.5) {
      // BOLT: forked lightning discharge (EX signature). A few BOLD, well-separated
      // jagged bolts fork outward from the centre with splitting branches. Kept
      // sparse with wide DARK gaps between lanes (like the crit star's spikes) so
      // heavy scene bloom renders them as distinct electric forks instead of fusing
      // them into a soft plasma ball.
      float grow = smoothstep(0.0, 0.03, uAge);
      float fade = 1.0 - smoothstep(0.30, 1.0, uAge);
      // SNAP the discharge to full length instantly — lightning strikes, it does
      // not grow. This is what makes the forks read as electric, not a soft star.
      float ease = smoothstep(0.0, 0.04, uAge);
      float NB = 6.0;
      float lane = floor((ang + 3.14159) / 6.28318 * NB);
      float within = fract((ang + 3.14159) / 6.28318 * NB) - 0.5;   // -0.5..0.5 in lane
      // main bolt wanders hard sideways as it climbs outward
      float wander = (fbm(vec2(lane * 4.1 + uSeed, r * 6.0 - ease * 5.0)) - 0.5) * 0.7;
      // NARROW filament with a hard falloff so the dark gaps between bolts stay
      // black — a fat soft bolt would bloom into its neighbours and fill the disc.
      float w = mix(0.11, 0.028, clamp(r, 0.0, 1.0));   // tapers toward the tip
      float bolt = smoothstep(w, 0.0, abs(within - wander));
      float len = 0.62 + 0.38 * hash(lane + uSeed * 3.0);
      bolt *= smoothstep(ease * len, ease * len - 0.12, r);
      bolt *= smoothstep(0.02, 0.10, r);   // clear the very centre
      // a forked branch splitting off partway out
      float bwander = wander + (hash(lane + 7.0) - 0.5) * 0.8;
      float branch = smoothstep(w * 0.7, 0.0, abs(within - bwander))
                     * smoothstep(0.34, 0.46, r)
                     * smoothstep(ease * len * 0.9, ease * len * 0.9 - 0.11, r);
      bolt = max(bolt, branch * 0.8);
      // flicker so it feels alive, not a static gear (kept above 0 so bolts never
      // vanish, but never a flat fill)
      bolt *= 0.7 + 0.5 * fbm(vec2(lane * 2.0, r * 10.0) + uSeed * 4.0);
      // a few crackle sparks pinned ONTO the bolt tips (not a full rim ring, which
      // was what filled the gaps and produced the plasma ball)
      float tip = smoothstep(ease * len, ease * len - 0.05, r) * smoothstep(ease * len - 0.12, ease * len, r);
      float crackle = bolt * tip * (0.4 + 0.9 * pow(0.5 + 0.5 * sin(ang * 40.0 + uSeed * 8.0), 4.0));
      vec3 core = hotCore(r, ang, uColor2, 0.12, uSeed) * 0.35;
      float coreA = smoothstep(0.12, 0.0, r) * 0.4;
      float a = clamp((bolt * 1.25 + crackle + coreA) * grow * fade, 0.0, 1.0);
      // saturated cyan body with a thin white filament along the strike; core kept
      // dim so the forked bolts own the silhouette instead of a plasma orb.
      vec3 col = uColor2 * (bolt * 2.9 + crackle * 2.2 + 0.05) + vec3(1.0) * (bolt * 0.6 + crackle * 0.35) + core;
      col *= uIntensity;
      if (a < 0.005) discard;
      gl_FragColor = vec4(col, a);
    } else if (uMode < 6.5) {
      // BEAM: an anime super-flash column (SIGNATURE). A blinding vertical light
      // pillar with a thin horizontal lens crossbar and secondary radial spokes.
      // The strong vertical shape is unmistakably different from the round golden
      // ult sun, so the two biggest supers never collide. Kept structurally lean
      // (small hot core, feathered pillar) so it survives bloom as a PILLAR and
      // never floods into a flat pink blob.
      float grow = smoothstep(0.0, 0.04, uAge);
      float fade = 1.0 - smoothstep(0.28, 1.0, uAge);
      float ease = 1.0 - pow(1.0 - uAge, 2.0);
      // vertical pillar — narrow in x, tall in y, feathered edges + churn.
      // A dark seam is carved down the very centre so the pillar reads as two
      // bright rails (structure) instead of one solid slab that blooms to white.
      float pillarW = 0.11 + 0.045 * fbm(vec2(d.y * 6.0, uSeed));
      float pillar = smoothstep(pillarW, 0.0, abs(d.x)) * smoothstep(1.0, 0.1, abs(d.y) * 0.9);
      float rails = smoothstep(0.028, pillarW * 0.55, abs(d.x)); // carve centre seam
      pillar *= 0.35 + 0.65 * rails;
      // thin horizontal lens crossbar
      float bar = smoothstep(0.03, 0.0, abs(d.y)) * smoothstep(1.0, 0.0, abs(d.x) * 0.85);
      // secondary radial spokes so the centre still bursts
      float spokes = pow(0.5 + 0.5 * sin(ang * 16.0 + uSeed * 6.0), 9.0) * smoothstep(0.9, 0.15, r) * 0.6;
      float grid = grow * ease;
      pillar *= grid; bar *= grid; spokes *= grid;
      // small, tight core — a big soft core is exactly what blooms into a blob
      vec3 core = hotCore(r, ang, uColor2, 0.20, uSeed);
      float coreA = smoothstep(0.20, 0.0, r);
      float a = clamp((pillar + bar + spokes + coreA * 0.8) * fade, 0.0, 1.0);
      // saturated magenta owns the body; white confined to the thin crossbar/spine
      vec3 col = uColor2 * (pillar * 1.7 + bar * 1.5 + spokes * 1.9 + 0.2)
                 + vec3(1.0) * (bar * 0.45 + pillar * 0.16) + core * 0.85;
      col *= uIntensity;
      if (a < 0.005) discard;
      gl_FragColor = vec4(col, a);
    } else {
      // FLURRY: COMBO signature. A violet rosette of many sharp, UNEVEN impact
      // blades — a rapid multi-hit barrage frozen mid-strike — wrapped in two
      // expanding concentric hit-rings (the rising combo counter). Blades snap to
      // full length instantly (a combo is fast) and every blade is a different
      // length, so it reads as chaotic violence, never the clean symmetric crit
      // star or the soft golden ult sun.
      float grow = smoothstep(0.0, 0.03, uAge);
      float fade = 1.0 - smoothstep(0.26, 1.0, uAge);
      float ease = smoothstep(0.0, 0.04, uAge);
      float N = 8.0;                           // fewer, bolder blades — reads as hits
      float sector = 6.28318 / N;
      float rot = uSeed * 2.0 + uAge * 1.4;    // slight swirl — energy whipping round
      float idx = floor((ang + rot + 3.14159) / sector);
      float da = mod(ang + rot + sector * 0.5, sector) - sector * 0.5;
      // per-blade length varies wildly for a ragged, hand-thrown barrage
      float len = 0.5 + 0.5 * hash(idx + uSeed * 3.0);
      float reach = len * ease;
      float along = smoothstep(reach, 0.0, r);
      float halfw = 0.19 * clamp(1.0 - r / max(reach, 0.001), 0.0, 1.0); // narrows to tip
      float blade = along * smoothstep(halfw, halfw * 0.1, abs(da));
      float coreline = along * smoothstep(halfw * 0.4, 0.0, abs(da));    // bright spine
      // two expanding hit-rings — the combo count rising
      float g = 1.0 - pow(1.0 - uAge, 2.0);
      float r1 = 0.30 * g;
      float r2 = 0.60 * g;
      float rings = ring(r, r1, 0.03) + ring(r, r2, 0.024) * 0.7;
      rings *= (1.0 - smoothstep(0.4, 1.0, uAge));
      vec3 core = hotCore(r, ang, uColor2, 0.16, uSeed);
      float coreA = smoothstep(0.16, 0.0, r) * 0.7;
      float a = clamp((blade * 0.95 + coreline + rings + coreA) * grow * fade, 0.0, 1.0);
      vec3 col = uColor2 * (blade * 2.4 + rings * 2.0)
                 + vec3(1.0) * (coreline * 0.55 + rings * 0.25) + core * 0.9;
      col *= uIntensity;
      if (a < 0.004) discard;
      gl_FragColor = vec4(col, a);
    }
  }
`
