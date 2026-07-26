import * as THREE from 'three'

/**
 * The fighter material.
 *
 * The art is a flat pixel-art PNG. We turn it into a lit, shaded, volumetric-
 * feeling character by:
 *
 *  - relief-mapping the albedo with the derived height map (parallax offset,
 *    so the silhouette shifts slightly as the camera moves — reads as depth)
 *  - lighting the derived normal map with the stage's own key/fill/rim rig
 *  - a wrapped diffuse term (half-Lambert) so the shadow side never goes flat
 *    black, which is what makes naive sprite lighting look like a sticker
 *  - a Fresnel-driven rim in the fighter's accent colour
 *  - per-hit white-hot flash + chromatic edge fringe
 *  - a dissolve/ash burn for KO
 *  - vertex squash/stretch + lean so the sprite has weight
 *
 * Everything is driven by uniforms so a single material instance can animate
 * without recompiling.
 */

export interface FighterUniforms {
  uAlbedo: { value: THREE.Texture | null }
  uNormal: { value: THREE.Texture | null }
  uHeight: { value: THREE.Texture | null }
  uPrevAlbedo: { value: THREE.Texture | null }
  uPoseBlend: { value: number }

  uKeyDir: { value: THREE.Vector3 }
  uKeyColor: { value: THREE.Color }
  uKeyIntensity: { value: number }
  uFillDir: { value: THREE.Vector3 }
  uFillColor: { value: THREE.Color }
  uFillIntensity: { value: number }
  uRimDir: { value: THREE.Vector3 }
  uRimColor: { value: THREE.Color }
  uRimIntensity: { value: number }
  uAmbientColor: { value: THREE.Color }
  uAmbientIntensity: { value: number }
  uFlashPos: { value: THREE.Vector4 }
  uFlashColor: { value: THREE.Color }
  uFlashIntensity: { value: number }

  uAccent: { value: THREE.Color }
  uTime: { value: number }
  uHitFlash: { value: number }
  uHitColor: { value: THREE.Color }
  uDissolve: { value: number }
  uDamage: { value: number }
  uSuperGlow: { value: number }
  uShattered: { value: number }
  uOutline: { value: number }
  uOutlineColor: { value: THREE.Color }
  uFacing: { value: number }
  uSquash: { value: THREE.Vector2 }
  uLean: { value: number }
  uWobble: { value: number }
  uCameraPos: { value: THREE.Vector3 }
  uParallax: { value: number }
  uSilhouette: { value: number }
  uFogColor: { value: THREE.Color }
  uFogDensity: { value: number }
  [key: string]: THREE.IUniform
}

export function createFighterUniforms(): FighterUniforms {
  return {
    uAlbedo: { value: null },
    uNormal: { value: null },
    uHeight: { value: null },
    uPrevAlbedo: { value: null },
    uPoseBlend: { value: 1 },

    uKeyDir: { value: new THREE.Vector3(-0.5, 0.7, 0.5) },
    uKeyColor: { value: new THREE.Color(0xfff0dd) },
    uKeyIntensity: { value: 3 },
    uFillDir: { value: new THREE.Vector3(0.7, 0.25, 0.5) },
    uFillColor: { value: new THREE.Color(0x4466aa) },
    uFillIntensity: { value: 0.8 },
    uRimDir: { value: new THREE.Vector3(0.2, 0.4, -0.9) },
    uRimColor: { value: new THREE.Color(0x88ccff) },
    uRimIntensity: { value: 2.2 },
    uAmbientColor: { value: new THREE.Color(0x2a2440) },
    uAmbientIntensity: { value: 0.5 },
    uFlashPos: { value: new THREE.Vector4(0, 2, 0, 6) },
    uFlashColor: { value: new THREE.Color(0xffffff) },
    uFlashIntensity: { value: 0 },

    uAccent: { value: new THREE.Color(0xffd60a) },
    uTime: { value: 0 },
    uHitFlash: { value: 0 },
    uHitColor: { value: new THREE.Color(0xffffff) },
    uDissolve: { value: 0 },
    uDamage: { value: 0 },
    uSuperGlow: { value: 0 },
    uShattered: { value: 0 },
    uOutline: { value: 1 },
    uOutlineColor: { value: new THREE.Color(0x0a0614) },
    uFacing: { value: 1 },
    uSquash: { value: new THREE.Vector2(1, 1) },
    uLean: { value: 0 },
    uWobble: { value: 0 },
    uCameraPos: { value: new THREE.Vector3() },
    uParallax: { value: 0.028 },
    uSilhouette: { value: 0 },
    uFogColor: { value: new THREE.Color(0x0a0716) },
    uFogDensity: { value: 0.02 },
  }
}

export const FIGHTER_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform vec2  uSquash;
  uniform float uLean;
  uniform float uWobble;
  uniform float uFacing;

  varying vec2  vUv;
  varying vec3  vWorldPos;
  varying vec3  vViewDir;
  varying float vHeightNorm;

  void main() {
    vUv = uv;
    vec3 p = position;

    // Normalised height up the quad (0 = feet, 1 = head).
    float h = uv.y;
    vHeightNorm = h;

    // Squash & stretch about the feet.
    p.x *= uSquash.x;
    p.y = (p.y + 0.5) * uSquash.y - 0.5;

    // Lean: shear the top of the quad forward. Weighted by height so the feet
    // stay planted — this is what gives the sprite a sense of mass.
    p.x += uLean * h * h;

    // Impact wobble: a damped travelling wave up the body.
    p.x += uWobble * sin(h * 9.0 - uTime * 26.0) * (1.0 - h * 0.35) * 0.09;

    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorldPos = world.xyz;
    vViewDir = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

export const FIGHTER_FRAGMENT = /* glsl */ `
  precision highp float;

  uniform sampler2D uAlbedo;
  uniform sampler2D uNormal;
  uniform sampler2D uHeight;
  uniform sampler2D uPrevAlbedo;
  uniform float uPoseBlend;

  uniform vec3  uKeyDir;
  uniform vec3  uKeyColor;
  uniform float uKeyIntensity;
  uniform vec3  uFillDir;
  uniform vec3  uFillColor;
  uniform float uFillIntensity;
  uniform vec3  uRimDir;
  uniform vec3  uRimColor;
  uniform float uRimIntensity;
  uniform vec3  uAmbientColor;
  uniform float uAmbientIntensity;
  uniform vec4  uFlashPos;
  uniform vec3  uFlashColor;
  uniform float uFlashIntensity;

  uniform vec3  uAccent;
  uniform float uTime;
  uniform float uHitFlash;
  uniform vec3  uHitColor;
  uniform float uDissolve;
  uniform float uDamage;
  uniform float uSuperGlow;
  uniform float uShattered;
  uniform float uOutline;
  uniform vec3  uOutlineColor;
  uniform float uFacing;
  uniform float uParallax;
  uniform float uSilhouette;
  uniform vec3  uFogColor;
  uniform float uFogDensity;

  varying vec2  vUv;
  varying vec3  vWorldPos;
  varying vec3  vViewDir;
  varying float vHeightNorm;

  // Cheap hash for dissolve noise.
  float hash(vec2 p) {
    p = fract(p * vec2(233.34, 851.73));
    p += dot(p, p + 23.45);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
  }

  void main() {
    // ---- Parallax relief offset -------------------------------------------
    // Shift the sample point along the view vector proportional to height.
    // Subtle (a few pixels) but it makes the character feel like it occupies
    // space rather than sitting on a pane of glass.
    vec2 uvBase = vUv;
    float h0 = texture2D(uHeight, uvBase).r;
    vec2 viewOffset = vec2(vViewDir.x, vViewDir.y) * (h0 - 0.5) * uParallax;
    vec2 uvP = clamp(uvBase - viewOffset, vec2(0.001), vec2(0.999));

    vec4 base = texture2D(uAlbedo, uvP);
    if (uPoseBlend < 0.999) {
      vec4 prev = texture2D(uPrevAlbedo, uvP);
      base = mix(prev, base, uPoseBlend);
    }
    if (base.a < 0.02) discard;

    // ---- Normal -----------------------------------------------------------
    vec3 nTex = texture2D(uNormal, uvP).xyz * 2.0 - 1.0;
    // Mirror X for the right-hand fighter so lighting stays physically sane.
    nTex.x *= uFacing;
    vec3 N = normalize(vec3(nTex.x, nTex.y, max(nTex.z, 0.08)));

    vec3 V = normalize(vViewDir);
    vec3 albedo = base.rgb;

    // ---- Direct lighting --------------------------------------------------
    // Half-Lambert wrap: keeps the shadow side readable and coloured rather
    // than crushed to black.
    float ndlKey = dot(N, normalize(uKeyDir));
    float wrapKey = pow(ndlKey * 0.5 + 0.5, 1.55);
    vec3 diffuse = uKeyColor * uKeyIntensity * wrapKey;

    float ndlFill = dot(N, normalize(uFillDir));
    diffuse += uFillColor * uFillIntensity * (ndlFill * 0.5 + 0.5);

    // ---- Specular (Blinn-Phong, tight) ------------------------------------
    vec3 H = normalize(normalize(uKeyDir) + V);
    float spec = pow(max(dot(N, H), 0.0), 42.0);
    // Only the brighter parts of the art get a highlight — stops skin and
    // dark fabric from looking equally glossy.
    float gloss = smoothstep(0.35, 0.9, dot(albedo, vec3(0.299, 0.587, 0.114)));
    vec3 specular = uKeyColor * spec * gloss * 0.55 * uKeyIntensity * 0.3;

    // ---- Rim / back light -------------------------------------------------
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.6);
    float rimTerm = clamp(dot(N, normalize(uRimDir)) * 0.5 + 0.5, 0.0, 1.0);
    vec3 rim = uRimColor * uRimIntensity * fres * rimTerm;
    // Accent rim: the fighter's identity colour, strongest at the silhouette.
    rim += uAccent * fres * (0.55 + uSuperGlow * 2.4);

    // ---- Impact point light ----------------------------------------------
    vec3 toFlash = uFlashPos.xyz - vWorldPos;
    float dist = length(toFlash);
    float atten = uFlashIntensity / (1.0 + dist * dist * 1.6);
    vec3 flashL = uFlashColor * atten * max(dot(N, normalize(toFlash)) * 0.5 + 0.5, 0.0);

    vec3 ambient = uAmbientColor * uAmbientIntensity;

    vec3 color = albedo * (diffuse + ambient + flashL) + specular + rim * albedo * 0.6 + rim * 0.35;

    // ---- Damage state: desaturate + bruise toward the accent's complement --
    float lum = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(color, mix(vec3(lum), vec3(lum) * vec3(1.15, 0.72, 0.72), 0.65), uDamage * 0.45);

    // ---- Super charge: energy scanline crawl over the body ----------------
    if (uSuperGlow > 0.001) {
      float band = sin((vUv.y * 34.0) - uTime * 5.0) * 0.5 + 0.5;
      band = pow(band, 6.0);
      color += uAccent * band * uSuperGlow * 1.5;
    }

    // ---- Shattered: cracked-glass chroma split ---------------------------
    if (uShattered > 0.001) {
      float crack = noise(vUv * 26.0 + vec2(0.0, uTime * 0.4));
      float lines = smoothstep(0.62, 0.66, crack) - smoothstep(0.70, 0.74, crack);
      color += vec3(0.9, 0.25, 0.35) * lines * uShattered * 2.2;
    }

    // ---- Hit flash --------------------------------------------------------
    color = mix(color, uHitColor * 2.4, clamp(uHitFlash, 0.0, 1.0));

    // ---- Ink outline ------------------------------------------------------
    // Sample the alpha ring around the fragment; where the sprite is about to
    // end, darken. Preserves the Street-Fighter linework read at any zoom.
    if (uOutline > 0.001) {
      float texel = 1.6 / 1024.0;
      float aSum = 0.0;
      aSum += texture2D(uAlbedo, uvP + vec2( texel, 0.0)).a;
      aSum += texture2D(uAlbedo, uvP + vec2(-texel, 0.0)).a;
      aSum += texture2D(uAlbedo, uvP + vec2(0.0,  texel)).a;
      aSum += texture2D(uAlbedo, uvP + vec2(0.0, -texel)).a;
      float edge = clamp(1.0 - aSum * 0.25, 0.0, 1.0);
      edge = smoothstep(0.25, 0.85, edge);
      color = mix(color, uOutlineColor, edge * uOutline * base.a);
    }

    float alpha = base.a;

    // ---- Silhouette mode (used for the KO freeze frame) -------------------
    if (uSilhouette > 0.001) {
      color = mix(color, uAccent * 0.15, uSilhouette);
    }

    // ---- Dissolve (KO burn-away) -----------------------------------------
    if (uDissolve > 0.001) {
      float n = noise(vUv * 12.0) * 0.65 + noise(vUv * 41.0) * 0.35;
      // Burn from the feet up.
      float threshold = uDissolve * 1.25 - vHeightNorm * 0.25;
      float edgeW = 0.09;
      if (n < threshold - edgeW) discard;
      float burn = smoothstep(threshold - edgeW, threshold, n);
      color = mix(vec3(3.0, 1.1, 0.25), color, burn);
      alpha *= smoothstep(threshold - edgeW * 2.2, threshold, n);
    }

    // ---- Fog --------------------------------------------------------------
    float depth = length(cameraPosition - vWorldPos);
    float fogF = 1.0 - exp(-uFogDensity * uFogDensity * depth * depth);
    color = mix(color, uFogColor, clamp(fogF, 0.0, 1.0) * 0.55);

    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`

export function createFighterMaterial(uniforms: FighterUniforms): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: FIGHTER_VERTEX,
    fragmentShader: FIGHTER_FRAGMENT,
    transparent: true,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
    alphaTest: 0.01,
  })
  mat.toneMapped = true
  return mat
}

/**
 * Depth-only material used for shadow casting so the sprite's alpha punches a
 * correct silhouette into the shadow map.
 */
export function createFighterDepthMaterial(uniforms: FighterUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uAlbedo: uniforms.uAlbedo,
      uSquash: uniforms.uSquash,
      uLean: uniforms.uLean,
      uWobble: uniforms.uWobble,
      uTime: uniforms.uTime,
      uDissolve: uniforms.uDissolve,
    },
    vertexShader: /* glsl */ `
      uniform vec2 uSquash; uniform float uLean; uniform float uWobble; uniform float uTime;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        float h = uv.y;
        p.x *= uSquash.x;
        p.y = (p.y + 0.5) * uSquash.y - 0.5;
        p.x += uLean * h * h;
        p.x += uWobble * sin(h * 9.0 - uTime * 26.0) * (1.0 - h * 0.35) * 0.09;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAlbedo; uniform float uDissolve;
      varying vec2 vUv;
      void main() {
        float a = texture2D(uAlbedo, vUv).a;
        if (a < 0.5 || uDissolve > 0.4) discard;
        gl_FragColor = vec4(1.0);
      }
    `,
  })
}
