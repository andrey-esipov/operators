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

  // --- form / material / grounding (2.5D upgrade) ---
  /** 0..3 render tier; gates expensive loops (self-shadow taps). */
  uQuality: { value: number }
  /** Cavity/AO strength derived from the height field. */
  uAO: { value: number }
  /** Height-march self-shadow strength (arm-on-torso etc). */
  uSelfShadow: { value: number }
  /** Warm bounce colour reflected up from the stage floor. */
  uBounceColor: { value: THREE.Color }
  uBounceIntensity: { value: number }
  /** Texel size of the sprite (1/width) for edge/AO taps. */
  uTexel: { value: number }
  /** Sweat / sheen amount, ramps with damage + exertion. */
  uSweat: { value: number }
  /** Breathing exertion 0..1 (drives subtle warmth + sheen at low HP). */
  uExertion: { value: number }

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
    uParallax: { value: 0.014 },
    uSilhouette: { value: 0 },
    uFogColor: { value: new THREE.Color(0x0a0716) },
    uFogDensity: { value: 0.02 },

    uQuality: { value: 3 },
    uAO: { value: 1 },
    uSelfShadow: { value: 1 },
    uBounceColor: { value: new THREE.Color(0x25324a) },
    uBounceIntensity: { value: 0.35 },
    uTexel: { value: 1 / 1024 },
    uSweat: { value: 0 },
    uExertion: { value: 0 },
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

  uniform float uQuality;
  uniform float uAO;
  uniform float uSelfShadow;
  uniform vec3  uBounceColor;
  uniform float uBounceIntensity;
  uniform float uTexel;
  uniform float uSweat;
  uniform float uExertion;

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

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  // Classify skin from albedo: warm, ordered r>=g>=b, mid-bright, moderate sat.
  // Returns 0..1 mask. Robust enough to separate faces/hands/arms from denim,
  // cotton and hair so each can take a different material response.
  float skinMask(vec3 c) {
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float sat = (mx - mn) / max(mx, 1e-4);
    float warm = clamp((c.r - c.b) * 3.0, 0.0, 1.0);
    float ordered = smoothstep(-0.02, 0.02, c.r - c.g) * smoothstep(-0.04, 0.03, c.g - c.b);
    float bright = smoothstep(0.14, 0.4, mx) * (1.0 - smoothstep(0.94, 1.0, mx));
    float satOk = smoothstep(0.10, 0.22, sat) * (1.0 - smoothstep(0.62, 0.9, sat));
    return clamp(warm * ordered * bright * satOk, 0.0, 1.0);
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

    // Sharpen form with a fresh derivative of the height field. The baked
    // normal is smooth (distance transform); this re-injects crisp fold/muscle
    // detail so the body reads as sculpted volume rather than a soft balloon.
    float t = uTexel;
    float hC = texture2D(uHeight, uvP).r;
    float hL = texture2D(uHeight, uvP + vec2(-t, 0.0)).r;
    float hR = texture2D(uHeight, uvP + vec2( t, 0.0)).r;
    float hD = texture2D(uHeight, uvP + vec2(0.0, -t)).r;
    float hU = texture2D(uHeight, uvP + vec2(0.0,  t)).r;
    vec3 nDetail = normalize(vec3((hL - hR) * 2.6 * uFacing, (hD - hU) * 2.6, 1.0));
    // Broad normal: mostly the smooth baked normal, only a touch of detail —
    // drives the low-frequency diffuse form so the body reads as a rounded
    // torso, not a bubbly embossed "pillow-shaded" UI button.
    vec3 Nbroad = normalize(vec3(nTex.xy + nDetail.xy * 0.30, max(nTex.z, 0.34)));
    // Detailed normal: full crease/fold detail for specular, cavity, self-shadow.
    vec3 N = normalize(vec3(nTex.xy + nDetail.xy * 0.72, max(nTex.z, 0.18)));

    vec3 V = normalize(vViewDir);
    vec3 albedo = base.rgb;
    float lumA = luma(albedo);

    // ---- Material segmentation -------------------------------------------
    float skin = skinMask(albedo);
    float mn = min(albedo.r, min(albedo.g, albedo.b));
    float mx = max(albedo.r, max(albedo.g, albedo.b));
    float sat = (mx - mn) / max(mx, 1e-4);
    // Metal / bright hardware & sneaker rubber: desaturated + bright.
    float metal = smoothstep(0.5, 0.85, lumA) * (1.0 - smoothstep(0.16, 0.32, sat));
    // Dark hair / leather: low luma, low-mid sat — takes a tight anisotropic-ish
    // sheen. Cloth is everything else: matte.
    float dark = (1.0 - smoothstep(0.06, 0.28, lumA));
    // Denim: blue-dominant, mid luma. Dead matte + slightly cool so it never
    // reads like the same plastic as skin or a cotton shirt.
    float denim = smoothstep(0.0, 0.05, albedo.b - albedo.r) * smoothstep(0.07, 0.2, sat)
                  * smoothstep(0.05, 0.2, lumA) * (1.0 - smoothstep(0.7, 0.9, lumA));
    float cloth = clamp(1.0 - skin - metal, 0.0, 1.0);

    // Interior mask: ~1 deep inside the silhouette, →0 within a few px of the
    // edge. Keeps the rim glow off the ink outline so the pixel silhouette
    // stays razor-crisp instead of blooming into a halo.
    float aR = 4.0 * t;
    float aWide =
        texture2D(uAlbedo, uvP + vec2( aR, 0.0)).a +
        texture2D(uAlbedo, uvP + vec2(-aR, 0.0)).a +
        texture2D(uAlbedo, uvP + vec2(0.0,  aR)).a +
        texture2D(uAlbedo, uvP + vec2(0.0, -aR)).a;
    float interior = smoothstep(2.2, 3.9, aWide);

    // ---- Cavity / ambient occlusion from the height field -----------------
    // Compare the local height to a wider low-frequency average; recessed
    // pixels (folds, between limbs, under jaw) darken. This is the single
    // biggest thing that turns a flat fill into sculpted form.
    float wide = 0.0;
    wide += texture2D(uHeight, uvP + vec2( 3.0 * t,  3.0 * t)).r;
    wide += texture2D(uHeight, uvP + vec2(-3.0 * t,  3.0 * t)).r;
    wide += texture2D(uHeight, uvP + vec2( 3.0 * t, -3.0 * t)).r;
    wide += texture2D(uHeight, uvP + vec2(-3.0 * t, -3.0 * t)).r;
    wide += texture2D(uHeight, uvP + vec2( 6.0 * t, 0.0)).r;
    wide += texture2D(uHeight, uvP + vec2(-6.0 * t, 0.0)).r;
    wide += texture2D(uHeight, uvP + vec2(0.0,  6.0 * t)).r;
    wide += texture2D(uHeight, uvP + vec2(0.0, -6.0 * t)).r;
    wide *= 0.125;
    float cavity = clamp((hC - wide) * 3.4 + 0.56, 0.0, 1.0);
    float ao = mix(1.0, cavity, uAO * 0.85);
    // Grounding: the lower body sits in floor contact occlusion.
    float footAO = mix(0.55, 1.0, smoothstep(0.0, 0.16, vHeightNorm));
    ao *= mix(1.0, footAO, uAO);

    // ---- Height-march self-shadow ----------------------------------------
    // Walk a few texels toward the key light along the surface; if the terrain
    // rises above us we're occluded. Gives real arm-over-torso shadows.
    float selfShadow = 1.0;
    if (uSelfShadow > 0.001 && uQuality > 1.5) {
      vec3 Lk = normalize(uKeyDir); Lk.x *= uFacing;
      vec2 ldir = normalize(vec2(Lk.x, Lk.y) + 1e-4);
      float occ = 0.0;
      for (int i = 1; i <= 6; i++) {
        float fi = float(i);
        float hs = texture2D(uHeight, uvP + ldir * (5.0 * t) * fi).r;
        occ = max(occ, (hs - hC) - 0.045 * fi);
      }
      selfShadow = 1.0 - clamp(occ * 6.0, 0.0, 0.5) * uSelfShadow;
    }

    // ---- Direct lighting --------------------------------------------------
    vec3 Lkey = normalize(uKeyDir);
    float ndlKey = dot(Nbroad, Lkey);
    // Skin scatters light so its terminator is soft & warm; cloth/metal keep a
    // crisper terminator that actually reads as a lit form.
    float wrapAmt = mix(0.32, 0.62, skin);
    float wrapKey = clamp((ndlKey + wrapAmt) / (1.0 + wrapAmt), 0.0, 1.0);
    wrapKey = pow(wrapKey, mix(1.25, 1.0, skin));
    vec3 diffuse = uKeyColor * uKeyIntensity * wrapKey * selfShadow;

    // Subsurface: on skin, the shadowed side glows warm (translucency).
    float sss = pow(clamp(1.0 - abs(ndlKey), 0.0, 1.0), 2.0) * (1.0 - wrapKey);
    vec3 subsurface = uKeyColor * vec3(1.0, 0.42, 0.32) * sss * skin * uKeyIntensity * 0.5;

    float ndlFill = dot(Nbroad, normalize(uFillDir));
    diffuse += uFillColor * uFillIntensity * (ndlFill * 0.5 + 0.5);

    // Floor bounce: soft up-from-below light on the lower body, stage-tinted.
    float bounce = clamp(-Nbroad.y * 0.5 + 0.5, 0.0, 1.0) * (1.0 - smoothstep(0.0, 0.5, vHeightNorm));
    diffuse += uBounceColor * uBounceIntensity * bounce;
    // Denim reads cooler & darker than skin/cotton — subtle desaturation toward
    // the fill/bounce hue sells it as heavy cotton twill, not plastic.
    diffuse *= mix(1.0, 0.9, denim);

    // ---- Specular (material-aware) ---------------------------------------
    vec3 H = normalize(Lkey + V);
    float ndh = max(dot(N, H), 0.0);
    // Skin: broad soft sheen. Cotton: almost none. Denim: dead matte.
    // Metal/hair: tight bright glint. Kept far apart so materials never read as
    // one uniform "wet plastic" surface.
    float specSkin  = pow(ndh, 22.0) * 0.20 * skin;
    float specCloth = pow(ndh, 44.0) * 0.025 * cloth * (1.0 - denim);
    float specMetal = pow(ndh, 95.0) * 1.25 * (metal + dark * 0.4);
    vec3 specular = uKeyColor * (specSkin + specCloth + specMetal) * uKeyIntensity * 0.3 * selfShadow;
    // Sweat sheen at low HP / exertion: extra broad wet highlight, skin only.
    specular += uKeyColor * pow(ndh, 40.0) * skin * uSweat * 0.6 * uKeyIntensity * 0.3;
    specular *= base.a;

    // ---- Rim / back light -------------------------------------------------
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.1);
    float rimTerm = clamp(dot(N, normalize(uRimDir)) * 0.5 + 0.5, 0.0, 1.0);
    // Matte fabrics barely catch a rim; skin / hair / metal do.
    float matte = clamp(denim + cloth * 0.6, 0.0, 1.0);
    vec3 rim = uRimColor * uRimIntensity * fres * rimTerm * mix(1.0, 0.4, matte);
    // Accent rim: the fighter's identity colour, mostly reserved for super state
    // so neutral frames don't halo. Gated by interior mask + alpha so it never
    // bleeds past the silhouette into the bounding box.
    rim += uAccent * fres * (0.10 + uSuperGlow * 2.0);
    rim *= mix(0.12, 1.0, interior) * base.a;

    // ---- Impact point light ----------------------------------------------
    vec3 toFlash = uFlashPos.xyz - vWorldPos;
    float dist = length(toFlash);
    float atten = uFlashIntensity / (1.0 + dist * dist * 1.6);
    vec3 flashL = uFlashColor * atten * max(dot(N, normalize(toFlash)) * 0.5 + 0.5, 0.0);

    vec3 ambient = uAmbientColor * uAmbientIntensity;

    // Direct terms are fully occluded by cavity + contact AO; ambient is only
    // partly occluded so shadow cores keep the material's local colour (a purple
    // jacket stays purple in shadow) instead of crushing to muddy black.
    vec3 lit = albedo * (diffuse + flashL) * ao
             + albedo * ambient * mix(0.7, 1.0, ao)
             + subsurface * ao
             + specular + rim * albedo * 0.5 + rim * 0.2;
    vec3 color = lit;

    // ---- Damage state: grime + bruise that KEEPS volume -------------------
    // Multiply toward a darker warm-grey (dirt/bruising) rather than pushing to
    // flat luminance, so the lit form survives at low HP. A light desaturation
    // adds the "beaten up" read without pancaking the shading.
    color *= mix(vec3(1.0), vec3(1.02, 0.80, 0.75), uDamage * 0.5);
    float dlum = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(color, vec3(dlum), uDamage * 0.12);

    // ---- Super charge: energy scanline crawl over the body ----------------
    if (uSuperGlow > 0.001) {
      float band = sin((vUv.y * 30.0) - uTime * 5.0) * 0.5 + 0.5;
      band = pow(band, 6.0);
      // Wrap the glow around the lit form and keep it strictly inside the
      // silhouette (interior * alpha) so it never blows out into a halo.
      color += uAccent * band * uSuperGlow * 1.1 * interior * base.a * (0.45 + 0.55 * wrapKey);
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
      float texel = uTexel * 1.4;
      float aSum = 0.0;
      aSum += texture2D(uAlbedo, uvP + vec2( texel, 0.0)).a;
      aSum += texture2D(uAlbedo, uvP + vec2(-texel, 0.0)).a;
      aSum += texture2D(uAlbedo, uvP + vec2(0.0,  texel)).a;
      aSum += texture2D(uAlbedo, uvP + vec2(0.0, -texel)).a;
      float edge = clamp(1.0 - aSum * 0.25, 0.0, 1.0);
      edge = smoothstep(0.25, 0.85, edge);
      // Tint the ink line slightly with the scene ambient so it sits in the
      // world instead of reading as a pure-black cutout sticker border.
      vec3 inkCol = mix(uOutlineColor, uAmbientColor * 0.5, 0.35);
      color = mix(color, inkCol, edge * uOutline * base.a);
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
