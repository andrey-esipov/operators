import * as THREE from 'three'
import { Effect } from 'postprocessing'
import { whiteBalanceGain, type StageGrade } from './grades'

/**
 * The master grade + display transform.
 *
 * This single pointwise pass is the show LUT: it takes the linear HDR scene
 * (with bloom already added), applies a per-stage colour script in scene-linear,
 * runs a proper AgX tone map with an authored log-space "look", then finishes
 * in display space with split toning, a tinted vignette and filmic mid-tone
 * grain. AgX gives the highlight rolloff modern fighters use — highlights bloom
 * and clip gracefully instead of turning to white mud.
 *
 * Everything here is a per-texel operation, so crisp pixel-art edges pass
 * through untouched — the softening risks (CA, sharpen, AA) live in other
 * passes where they can be tuned carefully.
 */

const fragment = /* glsl */ `
uniform float exposure;
uniform vec3  wbGain;
uniform vec3  lift;
uniform vec3  gammaC;
uniform vec3  gain;
uniform float preSat;
uniform vec3  lookSlope;
uniform vec3  lookOffset;
uniform vec3  lookPower;
uniform float lookSat;
uniform float contrast;
uniform float black;
uniform vec3  shadowTint;
uniform vec3  highlightTint;
uniform float splitBalance;
uniform float splitStrength;
uniform float vigOffset;
uniform float vigDarkness;
uniform vec3  vigColor;
uniform float grainAmount;
uniform float grainTime;
uniform float desat;
uniform vec3  dangerTint;
uniform float dangerAmt;
uniform float flash;

const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
  0.6274, 0.0691, 0.0164,
  0.3293, 0.9195, 0.0880,
  0.0433, 0.0113, 0.8956
);
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
   1.6605, -0.1246, -0.0182,
  -0.5876,  1.1329, -0.1006,
  -0.0728, -0.0083,  1.1187
);
const mat3 AgXInsetMatrix = mat3(
  0.856627153315983, 0.137318972929847, 0.11189821299995,
  0.0951212405381588, 0.761241990602591, 0.0767994186031903,
  0.0482516061458583, 0.101439036467562, 0.811302368396859
);
const mat3 AgXOutsetMatrix = mat3(
   1.1271005818144368, -0.1413297634984383, -0.14132976349843826,
  -0.11060664309660323, 1.157823702216272, -0.11060664309660294,
  -0.016493938717834573, -0.016493938717834257, 1.2519364065950405
);
const float AgxMinEv = -12.47393;
const float AgxMaxEv = 4.026069;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4
       - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

vec3 agx(vec3 color) {
  color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
  color = AgXInsetMatrix * color;
  color = max(color, 1e-10);
  color = log2(color);
  color = (color - AgxMinEv) / (AgxMaxEv - AgxMinEv);
  color = clamp(color, 0.0, 1.0);
  color = agxContrast(color);

  // Authored look in the AgX log domain — this is where the per-stage
  // personality lives (slope/offset/power tint + saturation).
  float l = luma(color);
  color = pow(max(color * lookSlope + lookOffset, 0.0), lookPower);
  color = clamp(l + lookSat * (color - l), 0.0, 1.0);

  color = AgXOutsetMatrix * color;
  color = pow(max(color, 0.0), vec3(2.2));
  color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
  return clamp(color, 0.0, 1.0);
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb, 0.0);

  // --- scene-linear grade -------------------------------------------------
  c *= exposure * wbGain;
  c = c * gain + lift;
  c = pow(max(c, 0.0), 1.0 / max(gammaC, vec3(1e-3)));
  float lin = luma(c);
  c = max(mix(vec3(lin), c, preSat), 0.0);

  // --- filmic tone map ----------------------------------------------------
  c = agx(c);

  // --- display-referred finishing ----------------------------------------
  // Filmic shadow toe for density: raise the darks to a higher power so
  // shadows gain weight, while highlights (c->1) stay untouched. Unlike a
  // subtract-and-clip this never flattens detail to a hard black floor, so
  // dark clothing keeps its internal shading and shadow gradients don't band.
  vec3 toeP = vec3(1.0) + black * 3.0 * (1.0 - clamp(c, 0.0, 1.0));
  c = pow(max(c, 0.0), toeP);

  // S-curve contrast around mid grey.
  c = clamp(0.5 + (c - 0.5) * contrast, 0.0, 1.0);

  // Split toning: hue-shift shadows and highlights while preserving luma.
  float L = luma(c);
  vec3 shN = shadowTint / max(luma(shadowTint), 1e-3);
  vec3 hiN = highlightTint / max(luma(highlightTint), 1e-3);
  float shW = (1.0 - smoothstep(0.0, splitBalance, L)) * splitStrength;
  float hiW = smoothstep(splitBalance, 1.0, L) * splitStrength;
  c *= mix(vec3(1.0), shN, shW);
  c *= mix(vec3(1.0), hiN, hiW);

  // Dynamic response: colour drain + danger cast (low HP / KO).
  // Bias the danger grade toward the frame edges so the centred fighters
  // stay readable — the environment reddens hard, the sprites stay clear.
  float envW = mix(0.32, 1.25, smoothstep(0.1, 0.62, distance(uv, vec2(0.5))));
  L = luma(c);
  c = mix(c, vec3(L), desat * envW);
  c = mix(c, c * dangerTint, dangerAmt * envW);

  // Super / impact full-frame flash (kept subtle, warm).
  c += flash * vec3(0.9, 0.85, 0.7);

  // Tinted vignette with a natural falloff.
  float d = distance(uv, vec2(0.5));
  float vig = smoothstep(0.9, vigOffset, d);
  float vg = mix(1.0 - vigDarkness, 1.0, vig);
  c *= vg;
  c += vigColor * (1.0 - vig);

  // Filmic grain, weighted into the mid-tones so it never reads as a flat
  // overlay on shadows or highlights.
  L = luma(c);
  float n = hash21(uv * 2048.0 + grainTime) - 0.5;
  float midW = 1.0 - pow(abs(L * 2.0 - 1.0), 1.5);
  c += n * grainAmount * midW;

  // Triangular-PDF ordered dither: two independent hashes give a TPDF noise
  // of ~+/-1 LSB that breaks 8-bit quantisation banding in smooth gradients
  // (spotlight haze, sky falloff) without any visible texture.
  float d1 = hash21(uv * vec2(1234.5, 6789.1) + grainTime);
  float d2 = hash21(uv * vec2(4321.9, 9876.3) + grainTime * 1.37 + 7.0);
  c += (d1 + d2 - 1.0) * (1.6 / 255.0);

  outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
}
`

export class MasterGradeEffect extends Effect {
  private baseLookSat = 1

  constructor() {
    const uniforms = new Map<string, THREE.Uniform>([
      ['exposure', new THREE.Uniform(1)],
      ['wbGain', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
      ['lift', new THREE.Uniform(new THREE.Vector3(0, 0, 0))],
      ['gammaC', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
      ['gain', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
      ['preSat', new THREE.Uniform(1)],
      ['lookSlope', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
      ['lookOffset', new THREE.Uniform(new THREE.Vector3(0, 0, 0))],
      ['lookPower', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
      ['lookSat', new THREE.Uniform(1)],
      ['contrast', new THREE.Uniform(1)],
      ['black', new THREE.Uniform(0.025)],
      ['shadowTint', new THREE.Uniform(new THREE.Vector3(0.5, 0.55, 0.7))],
      ['highlightTint', new THREE.Uniform(new THREE.Vector3(1, 0.95, 0.85))],
      ['splitBalance', new THREE.Uniform(0.5)],
      ['splitStrength', new THREE.Uniform(0.12)],
      ['vigOffset', new THREE.Uniform(0.62)],
      ['vigDarkness', new THREE.Uniform(0.5)],
      ['vigColor', new THREE.Uniform(new THREE.Vector3(0.06, 0.05, 0.09))],
      ['grainAmount', new THREE.Uniform(0.05)],
      ['grainTime', new THREE.Uniform(0)],
      ['desat', new THREE.Uniform(0)],
      ['dangerTint', new THREE.Uniform(new THREE.Vector3(1, 0.5, 0.45))],
      ['dangerAmt', new THREE.Uniform(0)],
      ['flash', new THREE.Uniform(0)],
    ])
    super('MasterGradeEffect', fragment, { uniforms })
  }

  private u(name: string): THREE.Uniform {
    return this.uniforms.get(name)!
  }

  /** Upload a (possibly cross-faded) stage grade. */
  applyGrade(g: StageGrade) {
    this.u('exposure').value = g.exposure
    ;(this.u('wbGain').value as THREE.Vector3).copy(whiteBalanceGain(g.temperature, g.tint))
    ;(this.u('lift').value as THREE.Vector3).set(...g.lift)
    ;(this.u('gammaC').value as THREE.Vector3).set(...g.gamma)
    ;(this.u('gain').value as THREE.Vector3).set(...g.gain)
    this.u('preSat').value = g.preSat
    ;(this.u('lookSlope').value as THREE.Vector3).set(...g.lookSlope)
    ;(this.u('lookOffset').value as THREE.Vector3).set(...g.lookOffset)
    ;(this.u('lookPower').value as THREE.Vector3).set(...g.lookPower)
    this.u('lookSat').value = g.lookSat
    this.baseLookSat = g.lookSat
    ;(this.u('shadowTint').value as THREE.Vector3).set(...g.shadowTint)
    ;(this.u('highlightTint').value as THREE.Vector3).set(...g.highlightTint)
    this.u('splitBalance').value = g.splitBalance
    this.u('splitStrength').value = g.splitStrength
    this.u('black').value = g.black
    ;(this.u('vigColor').value as THREE.Vector3).set(...g.vigColor)
  }

  /** Uniforms that the pipeline animates every frame on top of the grade. */
  setContrast(v: number) {
    this.u('contrast').value = v
  }
  setVignette(offset: number, darkness: number) {
    this.u('vigOffset').value = offset
    this.u('vigDarkness').value = darkness
  }
  setVigColor(r: number, g: number, b: number) {
    ;(this.u('vigColor').value as THREE.Vector3).set(r, g, b)
  }
  setGrain(amount: number, time: number) {
    this.u('grainAmount').value = amount
    this.u('grainTime').value = time
  }
  setDanger(desat: number, amt: number) {
    this.u('desat').value = desat
    this.u('dangerAmt').value = amt
  }
  setFlash(v: number) {
    this.u('flash').value = v
  }
  /** Runtime saturation punch on top of the stage look (supers/impacts). */
  setSatBoost(add: number) {
    this.u('lookSat').value = this.baseLookSat + add
  }
}
