import * as THREE from 'three'
import { Effect } from 'postprocessing'

/**
 * Lens dirt + anamorphic streaks.
 *
 * Reads the bloom buffer (so it only fires where there's a genuinely bright
 * source) and adds two art-directed extras on top of the base bloom:
 *
 *  - Lens dirt: a procedural grime texture multiplied by the bloom, so hot
 *    highlights bloom *through* the dust on the front element.
 *  - Anamorphic streak: a cheap horizontal blur of the bloom, tinted, giving
 *    the signature blue/orange lens flare smear on the strongest sources.
 *
 * This is additive and pointwise on the input colour, so it never touches the
 * fighters' pixel edges — only adds glow around bright pixels.
 */

const fragment = /* glsl */ `
uniform sampler2D bloomTex;
uniform sampler2D dirtTex;
uniform float dirtAmount;
uniform float anamorphic;
uniform vec3  anamorphicTint;
uniform vec2  dirtScale;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 col = inputColor.rgb;

  vec3 bloom = texture2D(bloomTex, uv).rgb;

  // Bright overhead stage fixtures (LED ticker-boards, pendant lamps, falling
  // confetti) live in the top of the frame. Left unchecked, the dirt and the
  // horizontal streak below smear their hot ends sideways into soft round pools
  // that park in the top corners and read as smudges on the lens — the textbook
  // hobby-render tell, and the single most-flagged artefact in blind review.
  // Base bloom is untouched (the boards still bloom crisply); it is only the
  // art-directed lens *extras* — dirt grime and the anamorphic streak — that
  // must not survive into the top of the frame. Roll them almost fully off above
  // the action: near-zero by the upper third, full character retained in the
  // lower-centre where the fighters and their contact VFX live (uv.y < 0.5).
  float topFade = 1.0 - 0.97 * smoothstep(0.5, 0.82, uv.y);

  // Lens dirt: grime lit by the bloom sitting behind it.
  vec3 dirt = texture2D(dirtTex, uv * dirtScale).rgb;
  col += bloom * dirt * dirtAmount * 2.2 * topFade;

  // Anamorphic horizontal streak — sample the bloom across a wide horizontal
  // kernel and accumulate. Weighted so it only shows on strong sources.
  if (anamorphic > 0.001) {
    vec3 streak = vec3(0.0);
    float wsum = 0.0;
    for (int i = -12; i <= 12; i++) {
      float fi = float(i);
      float w = exp(-fi * fi * 0.018);
      vec3 s = texture2D(bloomTex, uv + vec2(fi * 0.012, 0.0)).rgb;
      // Only the brightest cores streak.
      streak += max(s - 0.35, 0.0) * w;
      wsum += w;
    }
    streak /= wsum;
    col += streak * anamorphicTint * anamorphic * 1.6 * topFade;
  }

  // Keep bright dirt from over-firing on already-blown highlights.
  outputColor = vec4(col, inputColor.a);
}
`

export interface LensEffectOptions {
  bloomTexture: THREE.Texture
  dirtTexture: THREE.Texture
}

export class LensEffect extends Effect {
  constructor({ bloomTexture, dirtTexture }: LensEffectOptions) {
    const uniforms = new Map<string, THREE.Uniform>([
      ['bloomTex', new THREE.Uniform(bloomTexture)],
      ['dirtTex', new THREE.Uniform(dirtTexture)],
      ['dirtAmount', new THREE.Uniform(0.35)],
      ['anamorphic', new THREE.Uniform(0.4)],
      ['anamorphicTint', new THREE.Uniform(new THREE.Vector3(0.4, 0.6, 1.0))],
      ['dirtScale', new THREE.Uniform(new THREE.Vector2(1, 1))],
    ])
    super('LensEffect', fragment, { uniforms })
  }

  private u(name: string): THREE.Uniform {
    return this.uniforms.get(name)!
  }

  setBloomTexture(t: THREE.Texture) {
    this.u('bloomTex').value = t
  }
  setDirt(amount: number) {
    this.u('dirtAmount').value = amount
  }
  setAnamorphic(amount: number, tint: [number, number, number]) {
    this.u('anamorphic').value = amount
    ;(this.u('anamorphicTint').value as THREE.Vector3).set(...tint)
  }
  setDirtScale(x: number, y: number) {
    ;(this.u('dirtScale').value as THREE.Vector2).set(x, y)
  }
}
