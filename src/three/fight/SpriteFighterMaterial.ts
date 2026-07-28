import * as THREE from 'three'
import type { LightingDescription } from '../lighting/LightRig'

/**
 * The material a live fighter sprite is drawn with.
 *
 * A frame is a sub-rect of the character's packed atlas. We light the
 * synthesised normal map with the *stage's own* key/fill/rim rig (passed in
 * from LightRig every frame) so the character is lit by the world it stands in
 * rather than pasted onto it — the single biggest thing separating a 2.5D
 * fighter from a sticker. On top of that:
 *
 *  - a wrapped (half-Lambert) key so the shadow side never crushes to flat
 *    black,
 *  - a fresnel rim in both the stage's rim colour (grounds it in the scene) and
 *    the fighter's accent (keeps its identity readable against any backdrop),
 *  - the scene's exponential fog re-derived in-shader, so the sprite recedes
 *    into the same haze as the geometry instead of floating in front of it,
 *  - a per-hit white flash, and a KO dissolve,
 *  - feet-pivoted squash / stretch / lean in the vertex stage for weight,
 *  - a resolution-independent, fwidth-based alpha edge that stays a crisp cel
 *    silhouette at any zoom instead of the muddy bilinear ramp.
 *
 * Registration (which pixel of the frame lands on the fighter's world
 * position) is entirely a function of uSize + uPivot, computed on the CPU by
 * the Fighter from the frame's rect and anchor. Getting that wrong makes the
 * character swim, so it is driven by data, never guessed in the shader.
 */

export interface SpriteFighterUniforms {
  [key: string]: THREE.IUniform
  uAlbedo: { value: THREE.Texture | null }
  uNormal: { value: THREE.Texture | null }
  uHeight: { value: THREE.Texture | null }
  uUvOffset: { value: THREE.Vector2 }
  uUvScale: { value: THREE.Vector2 }
  uSize: { value: THREE.Vector2 }
  uPivot: { value: THREE.Vector2 }
  uFacing: { value: number }
  uSquash: { value: THREE.Vector2 }
  uLean: { value: number }

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
  uBounceColor: { value: THREE.Color }

  uAccent: { value: THREE.Color }
  uHitFlash: { value: number }
  uHitColor: { value: THREE.Color }
  uDissolve: { value: number }
  uOpacity: { value: number }
  uFogColor: { value: THREE.Color }
  uFogDensity: { value: number }
  uCameraPos: { value: THREE.Vector3 }
  uTexel: { value: THREE.Vector2 }
  uTime: { value: number }
}

export function createSpriteUniforms(): SpriteFighterUniforms {
  return {
    uAlbedo: { value: null },
    uNormal: { value: null },
    uHeight: { value: null },
    uUvOffset: { value: new THREE.Vector2(0, 0) },
    uUvScale: { value: new THREE.Vector2(1, 1) },
    uSize: { value: new THREE.Vector2(1, 1) },
    uPivot: { value: new THREE.Vector2(0.5, 0) },
    uFacing: { value: 1 },
    uSquash: { value: new THREE.Vector2(1, 1) },
    uLean: { value: 0 },

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
    uAmbientIntensity: { value: 0.55 },
    uFlashPos: { value: new THREE.Vector4(0, 2, 0, 6) },
    uFlashColor: { value: new THREE.Color(0xffffff) },
    uFlashIntensity: { value: 0 },
    uBounceColor: { value: new THREE.Color(0x2a1a30) },

    uAccent: { value: new THREE.Color(0xffa53c) },
    uHitFlash: { value: 0 },
    uHitColor: { value: new THREE.Color(0xffffff) },
    uDissolve: { value: 0 },
    uOpacity: { value: 1 },
    uFogColor: { value: new THREE.Color(0x0a0716) },
    uFogDensity: { value: 0.02 },
    uCameraPos: { value: new THREE.Vector3(0, 2.5, 11) },
    uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    uTime: { value: 0 },
  }
}

/** Sync the stage's live lighting description into the sprite's uniforms. */
export function applyLighting(u: SpriteFighterUniforms, d: LightingDescription) {
  u.uKeyDir.value.copy(d.keyDir)
  u.uKeyColor.value.copy(d.keyColor)
  u.uKeyIntensity.value = d.keyIntensity
  u.uFillDir.value.copy(d.fillDir)
  u.uFillColor.value.copy(d.fillColor)
  u.uFillIntensity.value = d.fillIntensity
  u.uRimDir.value.copy(d.rimDir)
  u.uRimColor.value.copy(d.rimColor)
  u.uRimIntensity.value = d.rimIntensity
  u.uAmbientColor.value.copy(d.ambientColor)
  u.uAmbientIntensity.value = d.ambientIntensity
  u.uFlashPos.value.copy(d.flashPos)
  u.uFlashColor.value.copy(d.flashColor)
  u.uFlashIntensity.value = d.flashIntensity
}

const VERT = /* glsl */ `
  precision highp float;

  uniform vec2 uUvOffset;
  uniform vec2 uUvScale;
  uniform vec2 uSize;
  uniform vec2 uPivot;
  uniform float uFacing;
  uniform vec2 uSquash;
  uniform float uLean;

  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vViewDir;

  void main() {
    // Base geometry carries x,y in [0,1] (0,0 = bottom-left of the frame).
    vec2 g = uv;

    // UV into the atlas sub-rect. Textures are loaded flipY=false, so v grows
    // downward in image space: the top of the frame (head) is g.y = 1.
    vUv = uUvOffset + vec2(g.x, 1.0 - g.y) * uUvScale;

    // Offset from the feet pivot, in world units, before deformation.
    vec2 off = vec2((g.x - uPivot.x) * uSize.x, (g.y - uPivot.y) * uSize.y);
    // Feet-pivoted squash/stretch, then a lean shear that grows toward the head.
    off *= uSquash;
    off.x += off.y * uLean;
    off.x *= uFacing;

    vec4 world = modelMatrix * vec4(off.x, off.y, 0.0, 1.0);
    vWorld = world.xyz;
    vViewDir = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D uAlbedo;
  uniform sampler2D uNormal;
  uniform sampler2D uHeight;
  uniform float uFacing;

  uniform vec3 uKeyDir;
  uniform vec3 uKeyColor;
  uniform float uKeyIntensity;
  uniform vec3 uFillDir;
  uniform vec3 uFillColor;
  uniform float uFillIntensity;
  uniform vec3 uRimDir;
  uniform vec3 uRimColor;
  uniform float uRimIntensity;
  uniform vec3 uAmbientColor;
  uniform float uAmbientIntensity;
  uniform vec4 uFlashPos;
  uniform vec3 uFlashColor;
  uniform float uFlashIntensity;
  uniform vec3 uBounceColor;

  uniform vec3 uAccent;
  uniform float uHitFlash;
  uniform vec3 uHitColor;
  uniform float uDissolve;
  uniform float uOpacity;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform vec2 uTexel;
  uniform float uTime;

  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vViewDir;

  float hash(vec2 p){ p=fract(p*vec2(233.34,851.73)); p+=dot(p,p+23.45); return fract(p.x*p.y); }

  void main() {
    vec4 base = texture2D(uAlbedo, vUv);

    // Resolution-independent crisp silhouette: harden the feathered alpha to a
    // ~1px antialiased edge using screen-space derivatives. Keeps the cel edge
    // sharp at any zoom instead of the muddy bilinear ramp, without aliasing.
    float aa = max(fwidth(base.a), 0.0008);
    float alpha = smoothstep(0.5 - aa, 0.5 + aa, base.a);
    if (alpha < 0.004) discard;

    // Interior mask (1 well inside the body, 0 at the very edge) so rim terms
    // don't spill past the silhouette into a halo.
    float interior = smoothstep(0.0, 0.16, base.a - 0.55);

    // Unpack the tangent-space normal. Mirror x with facing so lighting flips
    // with the character.
    vec3 N = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
    N.x *= uFacing;
    N = normalize(N);

    float height = texture2D(uHeight, vUv).r;

    // Form-shaping normal: the synthesised height field saturates across wide
    // interiors (torso), so raw normals barely tilt away from camera and the
    // body reads flat and evenly lit — the "cutout composited into the scene"
    // tell. Exaggerate the lateral tilt for the diffuse dots only (key + fill)
    // so the stage's directional rig sculpts a real warm-key / cool-shadow
    // gradient across the form. Rim/fresnel stay on raw N so the silhouette
    // edge and halo gating are untouched.
    vec3 Nl = normalize(vec3(N.xy * 1.7, N.z));

    // ---- Key: wrapped half-Lambert, never crushes to flat black -----------
    vec3 keyDir = normalize(uKeyDir);
    float ndl = dot(Nl, keyDir);
    float wrap = clamp((ndl + 0.34) / 1.34, 0.0, 1.0);
    wrap = pow(wrap, 1.15);
    vec3 diffuse = uKeyColor * uKeyIntensity * wrap;

    // ---- Fill: soft directional + a hemispheric floor ---------------------
    float ndf = dot(Nl, normalize(uFillDir)) * 0.5 + 0.5;
    vec3 fill = uFillColor * uFillIntensity * (0.24 + 0.76 * ndf);

    // ---- Ambient + warm floor bounce on the lower body --------------------
    float lowBody = 1.0 - smoothstep(0.0, 0.4, vUv.y); // near feet (v grows down)
    vec3 ambient = uAmbientColor * uAmbientIntensity + uBounceColor * lowBody * 0.5;

    // ---- Fresnel rim (stage rim colour + accent identity) -----------------
    // The accent rim keeps the fighter's identity readable against any
    // backdrop, but it is a thin edge highlight, not a glow — kept low and
    // interior-gated so it never blooms into a halo around the silhouette.
    float fres = pow(1.0 - clamp(dot(N, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 2.8);
    float rimTerm = clamp(dot(N, normalize(uRimDir)) * 0.5 + 0.5, 0.0, 1.0);
    vec3 stageRim = uRimColor * uRimIntensity * fres * rimTerm;
    vec3 accentRim = uAccent * fres * 0.5;
    vec3 rim = (stageRim + accentRim) * interior;

    // ---- Transient impact point light -------------------------------------
    vec3 toFlash = uFlashPos.xyz - vWorld;
    float fd = length(toFlash);
    float atten = uFlashIntensity / (1.0 + fd * fd * 0.6);
    float fnl = clamp(dot(N, normalize(toFlash)) * 0.5 + 0.5, 0.0, 1.0);
    vec3 flash = uFlashColor * atten * fnl;

    // ---- Compose ----------------------------------------------------------
    // A gentle cavity/AO term from the height field keeps folds and the far
    // side reading as volume rather than a flat cutout.
    float ao = mix(0.72, 1.0, height);
    vec3 albedo = base.rgb;
    vec3 color = albedo * (ambient + diffuse * ao + fill * ao) + rim * (0.5 + 0.5 * albedo) + flash;

    // KO dissolve: burn the silhouette away from the edges inward with a hot rim.
    if (uDissolve > 0.0) {
      float n = hash(floor(vUv / uTexel * 0.25));
      float edge = uDissolve * 1.15;
      if (n < edge - 0.08) discard;
      if (n < edge) color += uAccent * 3.0;
    }

    // Per-hit white flash.
    color = mix(color, uHitColor, clamp(uHitFlash, 0.0, 1.0));

    // Match the scene's FogExp2 so the fighter sits in the same atmosphere.
    float dist = length(cameraPosition - vWorld);
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    color = mix(color, uFogColor, clamp(fog, 0.0, 1.0));

    // Output linear scene colour; the post pipeline owns tonemapping and the
    // final sRGB encode (same convention as the existing fighter/stage shaders).
    gl_FragColor = vec4(color, alpha * uOpacity);
  }
`

/** A 1x1 quad with x,y in [0,1] and matching uv. Feet pivot handled in shader. */
export function makeUnitQuad(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geo.setIndex([0, 1, 2, 0, 2, 3])
  return geo
}

export function createSpriteMaterial(u: SpriteFighterUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthTest: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  })
}
