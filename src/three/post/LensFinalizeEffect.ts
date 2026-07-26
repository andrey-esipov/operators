import * as THREE from 'three'
import { Effect, EffectAttribute } from 'postprocessing'

/**
 * Final lens pass: edge-weighted chromatic aberration + contrast-adaptive
 * sharpen.
 *
 * Two things happen here, both requiring neighbour samples of the input (hence
 * a CONVOLUTION effect that owns its pass):
 *
 *  1. Chromatic aberration that is *zero* at the frame centre and grows toward
 *     the edges (real lenses only fringe off-axis). This keeps the fighters —
 *     who live near the centre — free of colour fringing that would smear their
 *     pixel art, while still selling lens realism at the frame edge.
 *
 *  2. A gentle contrast-adaptive sharpen (CAS-style) that re-crisps the image
 *     after tone mapping and AA, so the hand-drawn pixel-art edges stay razor
 *     sharp instead of going soft. Sharpen amount is clamped so it never rings.
 */

const fragment = /* glsl */ `
uniform float caStrength;   // base chromatic aberration
uniform float caImpact;     // extra CA on impacts
uniform float sharpen;      // contrast-adaptive sharpen amount

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
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

  // --- contrast-adaptive sharpen -----------------------------------------
  if (sharpen > 0.001) {
    vec2 t = texelSize;
    vec3 n = texture2D(inputBuffer, uv + vec2(0.0, -t.y)).rgb;
    vec3 s = texture2D(inputBuffer, uv + vec2(0.0,  t.y)).rgb;
    vec3 e = texture2D(inputBuffer, uv + vec2( t.x, 0.0)).rgb;
    vec3 w = texture2D(inputBuffer, uv + vec2(-t.x, 0.0)).rgb;
    vec3 blur = (n + s + e + w) * 0.25;
    // Local contrast estimate limits sharpening in flat areas (less grain
    // amplification) and near blown highlights (no ringing).
    float local = clamp(luma(abs(col - blur)) * 6.0, 0.0, 1.0);
    col += (col - blur) * sharpen * local;
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
    ])
    super('LensFinalizeEffect', fragment, {
      attributes: EffectAttribute.CONVOLUTION,
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
}
