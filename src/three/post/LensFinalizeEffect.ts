import * as THREE from 'three'
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing'

/**
 * Final lens pass: edge-weighted chromatic aberration + contrast-adaptive
 * sharpen + authoritative character clarity.
 *
 * Three things happen here, all requiring neighbour samples of the input (hence
 * a CONVOLUTION effect that owns its pass). It also reads scene DEPTH so the
 * character clarity can be gated to the fighter plane.
 *
 *  1. Chromatic aberration that is *zero* at the frame centre and grows toward
 *     the edges (real lenses only fringe off-axis). This keeps the fighters —
 *     who live near the centre — free of colour fringing that would smear their
 *     pixel art, while still selling lens realism at the frame edge.
 *
 *  2. A gentle contrast-adaptive sharpen (CAS-style) that re-crisps the image
 *     after tone mapping and AA, so the hand-drawn pixel-art edges stay razor
 *     sharp instead of going soft. Sharpen amount is clamped so it never rings.
 *
 *  3. Character clarity: the master grade neutralises the fighters so they read
 *     chromatically separate from the arena, but the environment's saturated
 *     BLOOM bleeds that colour back over the characters downstream of the grade
 *     (bloom is composited around/over the fighters). This pass runs AFTER
 *     bloom, so it is the last word: inside a depth-gated screen-space matte it
 *     subtracts the part of the fighter chroma that points along the arena's
 *     dominant hue (envTint) — killing the bloom cast — and nudges the residual
 *     toward neutral, so two fighters stay separated from the arena and from
 *     each other. `charClarity` is 0 on multi-hue stages, so they are untouched.
 */

const fragment = /* glsl */ `
uniform float caStrength;   // base chromatic aberration
uniform float caImpact;     // extra CA on impacts
uniform float sharpen;      // contrast-adaptive sharpen amount

uniform vec2  charA;        // fighter A centre (uv)
uniform vec2  charB;        // fighter B centre (uv)
uniform vec2  charHalf;     // ellipse half-extent (uv)
uniform float charFeather;  // ellipse edge softness
uniform vec3  envTint;      // arena dominant hue
uniform float charClarity;  // strength of the final un-tint (0 on multi-hue stages)
uniform float camNear;
uniform float camFar;
uniform float charDepth;      // linear distance to the fighter plane
uniform float charDepthWidth; // depth falloff past the fighter plane
uniform float charKeyFin;     // value lift so re-neutralised fighters read as lit

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float windowMask(vec2 uv, vec2 c, vec2 halfExtent) {
  vec2 n = (uv - c) / max(halfExtent, vec2(1e-3));
  float rr = length(n);
  return 1.0 - smoothstep(1.0 - charFeather, 1.0, rr);
}

float linearDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * camNear * camFar) / (camFar + camNear - z * (camFar - camNear));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec2 center = uv - 0.5;
  float r = length(center) * 2.0;         // 0 centre → ~1.4 corner
  float edge = r * r * r;                   // fringe grows cubically: near-zero
                                            // across the mid-frame, only the
                                            // extreme corners actually split

  // --- chromatic aberration ----------------------------------------------
  float amt = (caStrength + caImpact) * edge;
  vec2 dir = center * amt;
  vec3 col;
  col.r = texture2D(inputBuffer, uv + dir).r;
  col.g = texture2D(inputBuffer, uv).g;
  col.b = texture2D(inputBuffer, uv - dir).b;
  float a = inputColor.a;
  // The grade's final clamp() does NOT scrub NaN on ANGLE/Metal, so a monochrome
  // stage can hand us NaN in the unlit channels (they read as 0 on screen but
  // poison luma()/chroma maths downstream). max() maps to fmax and returns the
  // finite operand, giving a guaranteed-finite colour to work from here on.
  col = max(col, vec3(0.0));

  // --- contrast-adaptive sharpen -----------------------------------------
  if (sharpen > 0.001) {
    vec2 t = texelSize;
    // Neighbour taps must be NaN-scrubbed too: on a monochrome stage the raw
    // buffer carries NaN in the unlit channels, and feeding that into the blur
    // re-poisons col (the max() above only cleaned the centre tap). Scrub each.
    vec3 n = max(texture2D(inputBuffer, uv + vec2(0.0, -t.y)).rgb, 0.0);
    vec3 s = max(texture2D(inputBuffer, uv + vec2(0.0,  t.y)).rgb, 0.0);
    vec3 e = max(texture2D(inputBuffer, uv + vec2( t.x, 0.0)).rgb, 0.0);
    vec3 w = max(texture2D(inputBuffer, uv + vec2(-t.x, 0.0)).rgb, 0.0);
    vec3 blur = (n + s + e + w) * 0.25;
    // Local contrast estimate limits sharpening in flat areas (less grain
    // amplification) and near blown highlights (no ringing).
    float local = clamp(luma(abs(col - blur)) * 6.0, 0.0, 1.0);
    col += (col - blur) * sharpen * local;
  }

  // --- final character clarity (authoritative, post-bloom) ----------------
  if (charClarity > 0.001) {
    float matte = max(windowMask(uv, charA, charHalf), windowMask(uv, charB, charHalf));
    // Depth-gate to the fighter plane so the arena behind the fighters is not
    // desaturated (which would read as a flat box halo around them).
    float dist = linearDepth(depth);
    matte *= 1.0 - smoothstep(charDepth, charDepth + charDepthWidth, dist);
    // Chroma gate: the grade pass already partly neutralised the fighter before
    // bloom, so inside the matte the fighter reads as PARTLY desaturated while any
    // co-planar background/prop at the same depth is still FULLY the arena hue.
    // Without a true silhouette matte the ellipse catches that background and the
    // un-tint hits it harder than the fighter, which reads as a desaturated box.
    // Suppress the un-tint on near-fully-saturated pixels so only the (already
    // partly neutral) subject is touched and the background box disappears.
    float mx = max(max(col.r, col.g), col.b);
    float sat = mx < 1e-4 ? 0.0 : (mx - min(min(col.r, col.g), col.b)) / mx;
    float subject = 1.0 - smoothstep(0.88, 0.995, sat);
    float strength = clamp(charClarity, 0.0, 1.0) * matte * subject;
    if (strength > 0.001) {
      float L = luma(col);
      vec3 chroma = col - L;                              // signed chroma about luma
      vec3 tdir = normalize(envTint - luma(envTint) + 1e-5);
      float align = dot(chroma, tdir);                    // component along the arena hue
      // Keep ONLY the chroma orthogonal to the arena hue (the fighter's own
      // identity colour); drop the shared bloom cast entirely. Rebuild about the
      // pixel's own luma so brightness is preserved (no darkening from removing
      // the dominant channel), then lift a touch so the subject reads as lit.
      vec3 ortho = chroma - tdir * align;
      vec3 target = (vec3(L) + ortho) * charKeyFin;
      col = mix(col, max(target, 0.0), strength);
    }
  }

  outputColor = vec4(col, a);
}
`

export class LensFinalizeEffect extends Effect {
  constructor() {
    const uniforms = new Map<string, THREE.Uniform>([
      ['caStrength', new THREE.Uniform(0.0025)],
      ['caImpact', new THREE.Uniform(0)],
      ['sharpen', new THREE.Uniform(0.35)],
      ['charA', new THREE.Uniform(new THREE.Vector2(-1, -1))],
      ['charB', new THREE.Uniform(new THREE.Vector2(-1, -1))],
      ['charHalf', new THREE.Uniform(new THREE.Vector2(0.09, 0.24))],
      ['charFeather', new THREE.Uniform(0.55)],
      ['envTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
      ['charClarity', new THREE.Uniform(0)],
      ['camNear', new THREE.Uniform(0.1)],
      ['camFar', new THREE.Uniform(100)],
      ['charDepth', new THREE.Uniform(13.0)],
      ['charDepthWidth', new THREE.Uniform(5.0)],
      ['charKeyFin', new THREE.Uniform(1.08)],
    ])
    super('LensFinalizeEffect', fragment, {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      blendFunction: BlendFunction.SRC,
      uniforms,
    })
  }

  private u(name: string): THREE.Uniform {
    return this.uniforms.get(name)!
  }

  setCa(base: number, impact: number) {
    this.u('caStrength').value = base
    this.u('caImpact').value = impact
  }
  setSharpen(v: number) {
    this.u('sharpen').value = v
  }

  /** Camera near/far for depth linearisation. */
  setCamera(near: number, far: number) {
    this.u('camNear').value = near
    this.u('camFar').value = far
  }

  /** Screen-space character matte, uploaded from the pipeline each frame. */
  setCharMatte(a: THREE.Vector2, b: THREE.Vector2, half: THREE.Vector2) {
    ;(this.u('charA').value as THREE.Vector2).copy(a)
    ;(this.u('charB').value as THREE.Vector2).copy(b)
    ;(this.u('charHalf').value as THREE.Vector2).copy(half)
  }

  /** Distance to the fighter plane, for the depth gate. */
  setCharDepth(depth: number, width: number) {
    this.u('charDepth').value = depth
    this.u('charDepthWidth').value = width
  }

  /** Per-stage arena hue + clarity strength (0 on multi-hue stages). */
  setCharClarity(envTint: [number, number, number], clarity: number) {
    ;(this.u('envTint').value as THREE.Vector3).set(...envTint)
    this.u('charClarity').value = clarity
  }
}
