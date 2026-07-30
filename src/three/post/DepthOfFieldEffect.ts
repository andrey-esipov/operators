import * as THREE from 'three'
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing'

/**
 * Depth-of-field / bokeh — the stage-depth defocus the arena art was authored
 * around. Four comments in StageSet.ts promise occluders "blurred into bokeh by
 * DOF" (edge pylons at moderate bokeh, corner masses at heavy bokeh), but no such
 * pass existed: the chain went RenderPass → bloom → … → SMAA, so the foreground
 * pillars reached the screen as hard-edged, aliased, pure-black rectangles — the
 * literal root of the "pillars carry zero information" complaint. This builds the
 * missing pass.
 *
 * A scene-depth gather DOF (CONVOLUTION | DEPTH): each pixel's circle of confusion
 * (CoC) grows with its distance from a focus band, and it gathers a golden-angle
 * disk of neighbours scaled by that CoC. Because it runs on real scene depth:
 *   - the camera-pinned foreground occluders (Defect 1) sit at a fixed, near
 *     camera-space depth → they defocus into soft bokeh at every camera pose;
 *   - the world-space background (walls, window banks) sits behind the fighters
 *     → it softens with distance, giving the frame real depth separation;
 *   - the fighters sit in the focus band → CoC 0 → untouched.
 *
 * NON-NEGOTIABLE: the fighters must stay crisp. Three independent guards ensure
 * a fighter pixel is returned BIT-EXACT:
 *   1. CoC is 0 across the focus band, which tracks the fighter plane each frame,
 *      so a fighter pixel early-outs to inputColor before any tap is taken.
 *   2. A depth-gated screen-space character matte forces CoC to 0 over the two
 *      fighters even if a sprite's alpha edge reads an odd depth.
 *   3. The gather rejects any tap that is a SHARP pixel NEARER the camera than the
 *      centre, so a defocused background never sucks the in-focus fighter in front
 *      of it into its blur (no fighter-coloured halo in the soft background).
 * A defocused FOREGROUND pillar is still allowed to bleed over what's behind it —
 * that is the soft-occluder edge we want — but it only ever softens the PILLAR's
 * own pixels; the fighter's pixels are the ones that early-out, so they never move.
 *
 * NaN-safety: on ANGLE/Metal the buffer can carry NaN in unlit channels of a
 * monochrome stage; every tap (and the centre) is scrubbed with max(…, 0.0) so a
 * single poisoned texel can't spray a dead channel across the gather.
 */

const TAPS = 28

const fragment = /* glsl */ `
uniform float camNear;
uniform float camFar;
uniform float focusCenter;    // linear eye distance to the sharp plane (fighters)
uniform float focusHalf;      // half-width of the sharp band (both fighters inside)
uniform float bgRamp;         // units past the band over which background CoC → 1
uniform float bgMaxCoc;       // ceiling on background CoC (see cocOf)
uniform float fgRamp;         // units before the band over which foreground CoC → 1
uniform float fgBoost;        // extra CoC multiplier for foreground (heavier bokeh)
uniform float maxRadius;      // max gather radius, in pixels

uniform vec2  charA;          // fighter A centre (uv)
uniform vec2  charB;          // fighter B centre (uv)
uniform vec2  charHalf;       // matte ellipse half-extent (uv)
uniform float charFeather;    // matte edge softness
uniform float charDepth;      // linear distance to the fighter plane (matte depth gate)
uniform float charDepthWidth; // depth falloff past the fighter plane

float linearDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * camNear * camFar) / (camFar + camNear - z * (camFar - camNear));
}

float windowMask(vec2 uv, vec2 c, vec2 halfExtent) {
  vec2 n = (uv - c) / max(halfExtent, vec2(1e-3));
  return 1.0 - smoothstep(1.0 - charFeather, 1.0, length(n));
}

// Circle of confusion from a linear eye distance: 0 inside the focus band, ramps
// up in front (foreground, heavier) and behind (background).
//
// Background and foreground are capped separately on purpose. The near
// occluders WANT heavy bokeh — that is the cinematic depth cue. The far
// backdrop does not: this is a 2D fighter whose stages are hand-painted art,
// and the plate sits ~41 world units out, which saturates the background ramp
// and used to hand it the full maxRadius gather. At 16px on a 1280 frame that
// dissolved eight painted arenas into coloured mush. bgMaxCoc keeps a real but
// gentle far defocus for depth separation while the painting stays legible.
float cocOf(float d) {
  float dev = d - focusCenter;
  if (dev >  focusHalf) return clamp((dev - focusHalf) / bgRamp, 0.0, 1.0) * bgMaxCoc;
  if (dev < -focusHalf) return clamp((-dev - focusHalf) / fgRamp, 0.0, 1.0) * fgBoost;
  return 0.0;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec3 c0 = max(inputColor.rgb, 0.0);
  float cd = linearDepth(depth);
  float coc = cocOf(cd);

  // Guard 1+2: force the fighters sharp. The matte is depth-gated to the fighter
  // plane so a far-background pixel that merely falls inside the ellipse still
  // defocuses (no rectangular sharp box behind the fighters).
  float matte = max(windowMask(uv, charA, charHalf), windowMask(uv, charB, charHalf));
  matte *= 1.0 - smoothstep(charDepth, charDepth + charDepthWidth, cd);
  coc *= (1.0 - clamp(matte, 0.0, 1.0));

  // Early-out: anything in focus is returned BIT-EXACT (fighters included).
  if (coc < 0.004) { outputColor = vec4(c0, inputColor.a); return; }

  float radius = clamp(coc, 0.0, 1.0) * maxRadius; // pixels
  vec2 px = texelSize;                              // uv per pixel
  vec3 sum = c0;
  float wsum = 1.0;
  for (int i = 0; i < ${TAPS}; i++) {
    float t = float(i) + 0.5;
    float ang = t * 2.399963229;                    // golden angle → even spiral
    float rr = sqrt(t / float(${TAPS})) * radius;    // sqrt → uniform disk area
    vec2 suv = uv + vec2(cos(ang), sin(ang)) * rr * px;
    vec3 s = max(texture2D(inputBuffer, suv).rgb, 0.0);
    float sd = linearDepth(readDepth(suv));
    float sc = cocOf(sd);
    // Guard 3: drop a tap only if it is BOTH nearer than the centre AND itself in
    // focus — i.e. the sharp subject sitting in front of this defocused pixel.
    // That stops the in-focus fighter bleeding into a background blur, while still
    // letting a defocused foreground pillar feather over what's behind it.
    float w = (sd < cd - 0.35 && sc < 0.02) ? 0.0 : 1.0;
    sum += s * w;
    wsum += w;
  }
  outputColor = vec4(sum / max(wsum, 1.0), inputColor.a);
}
`

export class DepthOfFieldEffect extends Effect {
  constructor() {
    const uniforms = new Map<string, THREE.Uniform>([
      ['camNear', new THREE.Uniform(0.1)],
      ['camFar', new THREE.Uniform(100)],
      ['focusCenter', new THREE.Uniform(11)],
      ['focusHalf', new THREE.Uniform(1.5)],
      ['bgRamp', new THREE.Uniform(5.5)],
      ['bgMaxCoc', new THREE.Uniform(0.16)],
      ['fgRamp', new THREE.Uniform(3.0)],
      ['fgBoost', new THREE.Uniform(1.5)],
      ['maxRadius', new THREE.Uniform(14)],
      ['charA', new THREE.Uniform(new THREE.Vector2(-1, -1))],
      ['charB', new THREE.Uniform(new THREE.Vector2(-1, -1))],
      ['charHalf', new THREE.Uniform(new THREE.Vector2(0.09, 0.24))],
      ['charFeather', new THREE.Uniform(0.42)],
      ['charDepth', new THREE.Uniform(13.0)],
      ['charDepthWidth', new THREE.Uniform(2.4)],
    ])
    super('DepthOfFieldEffect', fragment, {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      blendFunction: BlendFunction.SRC,
      uniforms,
    })
  }

  private u(name: string): THREE.Uniform {
    return this.uniforms.get(name)!
  }

  /** Camera near/far for depth linearisation. */
  setCamera(near: number, far: number) {
    this.u('camNear').value = near
    this.u('camFar').value = far
  }

  /**
   * The sharp band, in linear eye distance. `center` tracks the fighter plane and
   * `half` is wide enough to keep both fighters (and a little slack) in focus.
   */
  setFocus(center: number, half: number) {
    this.u('focusCenter').value = center
    this.u('focusHalf').value = half
  }

  /** Blur shape: how fast CoC ramps behind/in front, foreground boost, max radius. */
  setParams(bgRamp: number, fgRamp: number, fgBoost: number, maxRadius: number, bgMaxCoc: number) {
    this.u('bgRamp').value = bgRamp
    this.u('fgRamp').value = fgRamp
    this.u('fgBoost').value = fgBoost
    this.u('maxRadius').value = maxRadius
    this.u('bgMaxCoc').value = bgMaxCoc
  }

  /** Ceiling on background CoC. See the cocOf comment. */
  setBgMaxCoc(v: number) {
    this.u('bgMaxCoc').value = v
  }

  /** Screen-space character matte (same projection the grade/finalize use). */
  setCharMatte(a: THREE.Vector2, b: THREE.Vector2, half: THREE.Vector2) {
    ;(this.u('charA').value as THREE.Vector2).copy(a)
    ;(this.u('charB').value as THREE.Vector2).copy(b)
    ;(this.u('charHalf').value as THREE.Vector2).copy(half)
  }

  /** Distance to the fighter plane, for the matte depth gate. */
  setCharDepth(depth: number, width: number) {
    this.u('charDepth').value = depth
    this.u('charDepthWidth').value = width
  }
}
