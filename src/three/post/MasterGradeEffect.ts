import * as THREE from 'three'
import { Effect, EffectAttribute } from 'postprocessing'
import { whiteBalanceGain, type StageGrade } from './grades'

/**
 * The master grade + display transform.
 *
 * This single pointwise pass is the show LUT: it takes the linear HDR scene
 * (with bloom already added), applies a per-stage colour script in scene-linear,
 * runs a proper AgX tone map with an authored log-space "look", then finishes
 * in display space with a true black point, a filmic highlight rolloff, split
 * toning, a tinted vignette and filmic mid-tone grain.
 *
 * ── Character separation ─────────────────────────────────────────────────
 * The per-stage grade is intentionally strong, but a strong ENVIRONMENT grade
 * must not swallow the fighters — in SF6 / KOF XV the characters stay
 * chromatically separate from the arena so they read as the subject. To get
 * that here the pass grades every pixel twice: once with the full per-stage
 * colour script ("environment") and once with a neutral, chroma-true look that
 * keeps each fighter's own accent hue ("character"). A soft screen-space matte
 * (built from the fighters' projected anchors, uploaded from the pipeline) then
 * cross-fades to the character grade over the fighters. Both branches share the
 * exact same tone map, black point and contrast, so the fighters stay tonally
 * INTEGRATED (same lighting/value) while staying chromatically SEPARATE — the
 * environment can red-shift as hard as it likes and two fighters still read as
 * two distinct colours on every stage.
 *
 * ── Depth atmospherics ──────────────────────────────────────────────────
 * The scene depth (via EffectAttribute.DEPTH) drives an aerial-perspective
 * haze: far pixels lose contrast and lift toward a haze tint while near pixels
 * keep their full punch, so the frame gains real depth instead of reading flat.
 * The character matte is subtracted from the haze so the fighters never fog.
 *
 * Everything here is a per-texel operation, so crisp pixel-art edges pass
 * through untouched.
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
uniform float blackPoint;
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

// --- character matte (screen-space power windows over the two fighters) ---
uniform vec2  charA;
uniform vec2  charB;
uniform vec2  charHalf;
uniform float charFeather;
uniform float charAmount;     // master strength of the character grade
uniform float charChroma;     // how strongly the fighter's own chroma is kept
uniform float charLumaFollow; // how much the char branch follows env lighting
uniform float charPop;        // subject saturation pop inside the matte
uniform float charKey;        // subject brightness key-lift (subject reads bright)
uniform float charLift;       // subject shadow-lift gamma (<1 opens underlit fighters)
uniform float charFill;       // subject fill floor (lifts near-black fighters off same-hue bg)
uniform vec3  envTint;        // arena dominant hue direction (for chroma un-tint)
uniform float charUntint;     // strength of removing env-aligned chroma from fighters
uniform vec3  charTone;       // arena-complement hue to push neutralised fighters toward
uniform float charToneAmt;    // strength of the complementary subject accent (0 = off)
uniform float charDepth;      // linear distance to the fighter plane
uniform float charDepthWidth; // depth falloff past the fighter plane

// --- depth-weighted aerial perspective ---
uniform vec3  hazeColor;
uniform float hazeAmount;
uniform float hazeStart;
uniform float hazeEnd;
uniform float camNear;
uniform float camFar;

// --- background contrast floor (silhouette separation) ---
uniform float bgCeil;       // luminance the background is allowed to reach
uniform float bgKnock;      // how hard to compress everything above bgCeil
uniform float bgFloorStart; // depth where the compressor begins
uniform float bgFloorEnd;   // depth where it reaches full strength

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

// Parameterised AgX so the same tone curve can be run with the per-stage look
// (environment) or a neutral chroma-true look (characters).
vec3 agx(vec3 color, vec3 slope, vec3 offset, vec3 power, float sat) {
  color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
  color = AgXInsetMatrix * color;
  color = max(color, 1e-10);
  color = log2(color);
  color = (color - AgxMinEv) / (AgxMaxEv - AgxMinEv);
  color = clamp(color, 0.0, 1.0);
  color = agxContrast(color);

  float l = luma(color);
  // Guard the base off exactly 0. GLSL compiles pow(x,y) as exp2(y*log2(x)), and
  // log2(0) is -INF, so a zero base with a zero exponent evaluates 0 * -INF, which
  // ANGLE/Metal returns as NaN. lookPower is authored per stage, so a future 0
  // there would NaN the entire frame. This project has already shipped three
  // separate bugs from this exact expression; the clamp costs nothing.
  color = pow(max(color * slope + offset, 1e-5), power);
  color = clamp(l + sat * (color - l), 0.0, 1.0);

  color = AgXOutsetMatrix * color;
  color = pow(max(color, 0.0), vec3(2.2));
  color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
  return clamp(color, 0.0, 1.0);
}

// Shared display-referred value finishing: a TRUE black point (clean 0), a
// filmic shadow toe for density and a highlight shoulder for a confident
// rolloff, then S-curve contrast. Run identically on both branches so the
// fighters stay tonally locked to the scene.
vec3 finishValue(vec3 c) {
  // True black point — remap so the darkest authored value is a clean 0 and
  // the frame is no longer sitting milky in the mids.
  c = max(c - blackPoint, 0.0) / max(1.0 - blackPoint, 1e-3);

  // Filmic shadow toe (density without a hard floor).
  vec3 toeP = vec3(1.0) + black * 3.0 * (1.0 - clamp(c, 0.0, 1.0));
  c = pow(max(c, 0.0), toeP);

  // Confident highlight shoulder — a filmic knee that starts earlier and
  // compresses harder so bright practical lamps and specular hits roll off with
  // a gradient instead of clipping to flat white discs. The knee asymptotes, so
  // mid-tones and shadows are untouched while values above ~0.6 are progressively
  // tamed (a former 1.0 tops out near 0.74, restoring rolloff below the clip).
  c = c / (1.0 + max(c - 0.56, 0.0) * 1.0);

  // S-curve contrast around mid grey.
  c = clamp(0.5 + (c - 0.5) * contrast, 0.0, 1.0);

  // Neutral black anchor: desaturate ONLY the deepest shadows toward their own
  // luma so the true black point reads neutral instead of carrying the stage's
  // shadow tint (red on monetization, warm on distribution, teal on ipo-prep).
  // Coloured shadows and mids above ~0.11 luma keep their graded tint fully.
  float bl = luma(c);
  float nb = smoothstep(0.12, 0.0, bl);
  c = mix(c, vec3(bl), nb * 0.78);
  return c;
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Soft elliptical power window around a projected fighter.
float windowMask(vec2 uv, vec2 c, vec2 halfExtent) {
  vec2 n = (uv - c) / max(halfExtent, vec2(1e-3));
  float r = length(n);
  return 1.0 - smoothstep(1.0 - charFeather, 1.0, r);
}

float charMask(vec2 uv) {
  return max(windowMask(uv, charA, charHalf), windowMask(uv, charB, charHalf));
}

// Perspective depth (0..1) → linear eye-space distance.
float linearDepth(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * camNear * camFar) / (camFar + camNear - z * (camFar - camNear));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec3 sceneLin = max(inputColor.rgb, 0.0);

  // ── environment branch: full per-stage colour script ──────────────────
  vec3 cEnv = sceneLin * exposure * wbGain;
  cEnv = cEnv * gain + lift;
  cEnv = pow(max(cEnv, 0.0), 1.0 / max(gammaC, vec3(1e-3)));
  float linE = luma(cEnv);
  cEnv = max(mix(vec3(linE), cEnv, preSat), 0.0);
  cEnv = agx(cEnv, lookSlope, lookOffset, lookPower, lookSat);
  cEnv = finishValue(cEnv);

  // Split toning belongs to the environment (its stage colour identity).
  {
    float L = luma(cEnv);
    vec3 shN = shadowTint / max(luma(shadowTint), 1e-3);
    vec3 hiN = highlightTint / max(luma(highlightTint), 1e-3);
    float shW = (1.0 - smoothstep(0.0, splitBalance, L)) * splitStrength;
    float hiW = smoothstep(splitBalance, 1.0, L) * splitStrength;
    cEnv *= mix(vec3(1.0), shN, shW);
    cEnv *= mix(vec3(1.0), hiN, hiW);
  }

  float matte = clamp(charMask(uv) * charAmount, 0.0, 1.0);

  // Depth-gate the matte: only pixels near the fighter plane get the character
  // grade. This is what stops the elliptical power window from de-tinting the
  // FAR background inside it (which showed as a grey halo around the fighters);
  // the wall behind a fighter is farther than the fighter, so it is excluded
  // and keeps the full arena grade. The character billboard (and the floor at
  // their feet) sit at the fighter distance and pass.
  float dist = linearDepth(depth);
  float gate = 1.0 - smoothstep(charDepth, charDepth + charDepthWidth, dist);
  matte *= gate;

  // ── character branch: neutral look, fighter keeps its own hue ─────────
  vec3 c;
  if (matte > 0.001) {
    // Only a gentle share of the white balance so the arena reads consistent,
    // but the aggressive colour script is dropped entirely.
    vec3 cChar = sceneLin * exposure * mix(vec3(1.0), wbGain, 0.28);
    cChar = agx(cChar, vec3(1.0), vec3(0.0), vec3(1.0), 1.08);
    cChar = finishValue(cChar);

    // Partly follow the environment luminance (so the fighter sits in the same
    // light) but keep a strong share of the fighter's own clean value, then a
    // key-lift so the subject reads brighter than the arena — the AAA "the
    // character is the brightest, most saturated thing in frame" separation.
    float le = luma(cEnv);
    float lc = luma(cChar);
    vec3 charLit = cChar * mix(1.0, le / max(lc, 1e-3), charLumaFollow);
    charLit *= charKey;

    // Shadow-lift so an UNDERLIT fighter (dark, heavily-tinted stages such as
    // ai-native / ipo-prep, where a bare 1.x multiply cannot rescue a near-black
    // pixel) is opened up and reads as a lit subject rather than dissolving into
    // the arena. A gamma < 1 lifts shadows hard while leaving highlights, so it
    // only rescues where the fighter is dark and never blows out bright stages.
    // Base clamped off 0: charLift is a settable uniform, and pow(0.0, 0.0) is
    // 0 * -INF -> NaN on ANGLE/Metal. See the note in agxLook().
    charLit = pow(clamp(charLit, 1e-5, 1.0), vec3(charLift));

    // Neutral fill floor: on a dark stage whose dominant tint matches the
    // fighter (ai-native / ipo-prep blue, crisis red) a lift alone just makes a
    // brighter version of the SAME hue, so the subject still dissolves. A small
    // achromatic fill added to under-lit fighter pixels pushes them toward
    // neutral grey — which reads instantly against a saturated coloured arena —
    // and self-limits to zero on already-lit fighters, so bright stages are
    // untouched. Scaled by charUntint so the strongly monochrome stages (crisis
    // red, where the un-tint has almost no orthogonal chroma to reveal and the
    // fill is the ONLY separation lever) get a firmer neutral push and their two
    // fighters split by VALUE, while multi-hue stages (charUntint 0) are untouched.
    float dk = 1.0 - smoothstep(0.06, 0.52, luma(charLit));
    charLit += charFill * dk * (1.0 + charUntint * 0.7);

    // Subject pop so the characters read as the most saturated things in frame.
    // This runs BEFORE the arena un-tint so it boosts the fighter's OWN identity
    // chroma (the component orthogonal to the arena hue). The un-tint below then
    // strips the shared cast the pop would otherwise re-introduce.
    float cl = luma(charLit);
    charLit = mix(vec3(cl), charLit, 1.0 + charPop);

    // Environment-aligned chroma un-tint (LAST chroma op): remove the part of the
    // fighter's chroma that points the SAME way as the arena's dominant hue. On a
    // strongly monochrome stage (crisis/distribution red, ai-native/ipo-prep blue)
    // this is what stops the fighter from being a "same tinted silhouette" — the
    // shared cast is subtracted so the subject reads neutral/separate, while any
    // chroma ORTHOGONAL to the arena hue (the fighter's own identity colour) is
    // kept, so two fighters stay distinguishable. Running it after the pop means
    // the re-saturation cannot put the arena cast back. 0 on multi-hue stages.
    float idChroma = 0.0;
    if (charUntint > 0.001) {
      float lch = luma(charLit);
      vec3 chroma = charLit - lch;                       // signed chroma about luma
      vec3 tdir = normalize(envTint - luma(envTint) + 1e-5);
      float align = dot(chroma, tdir);                   // fighter chroma along arena hue
      vec3 ortho = chroma - tdir * align;                // fighter's own identity chroma
      idChroma = length(ortho);
      // Reveal-weight the strip by how much genuine identity chroma exists. The
      // crude ellipse also catches co-planar background/props at the fighter
      // depth; those are near-pure arena hue (ortho ~0) and un-tinting them would
      // only grey them into a flat desaturated box. Gating on orthogonal magnitude
      // leaves that background fully graded while still cleaning the shared cast
      // off real fighter pixels that carry their own albedo.
      float reveal = smoothstep(0.015, 0.10, idChroma);
      charLit -= tdir * max(align, 0.0) * charUntint * reveal; // subtract shared cast
      charLit = max(charLit, 0.0);
    }

    // Complementary subject accent: a merely NEUTRALISED fighter (grey, after the
    // un-tint) still reads as weak "absence of arena colour" on a single-hue stage.
    // Push those de-tinted pixels a step toward the arena's COMPLEMENT so the subject
    // becomes a positive accent colour — a cool/teal fighter in a red room, a warm
    // fighter in a cyan/blue room — the orange-teal separation AAA lighting uses. It
    // targets only LOW-chroma (neutralised) pixels via greyness, so a fighter's
    // surviving identity chroma (blue jeans, red hair) and any saturated background
    // inside the matte keep their own hue. Subtracting luma(charTone) makes it a pure
    // hue push that barely changes brightness. This also guarantees skin can never
    // sit at the arena hue — it kills the green-skin inversion on the teal stages.
    // 0 on multi-hue stages (charToneAmt 0), so they are untouched.
    if (charToneAmt > 0.001) {
      float lc2 = luma(charLit);
      float greyness = 1.0 - smoothstep(0.015, 0.14, length(charLit - lc2));
      charLit += (charTone - luma(charTone)) * lc2 * charToneAmt * greyness;
      charLit = max(charLit, 0.0);
    }

    // Blend how strongly we keep the character look vs the environment.
    vec3 charFinal = mix(cEnv, charLit, charChroma);

    // Subject gate: the elliptical matte also covers co-planar background at the
    // fighter depth, so something has to decide which pixels inside the ellipse
    // are actually the character.
    //
    // The previous gate fired on NEAR-BLACK pixels, on the theory that an
    // underlit fighter is the thing that needs rescuing. The polarity is exactly
    // backwards. Nothing distinguishes a black FIGHTER pixel from a black FLOOR
    // pixel by luminance, so on any stage with a dark floor the gate opened to
    // full strength on the empty ground inside the ellipse -- and the character
    // branch (a 0.70 shadow-lift gamma followed by a +0.25 achromatic fill)
    // turned that ground into a soft grey dome standing between the fighter's
    // feet. It is the "feet blob" in every screenshot of this game.
    //
    // The same term did equal damage on the fighter itself: hair, trousers and
    // boots are near-black by design, so they were lifted to the same neutral
    // grey as the floor. Lifting the dark parts of a character to grey is
    // precisely how you destroy a silhouette, which is the one thing a fighting
    // game cannot afford.
    //
    // Real subject evidence is CHROMA, not darkness. A fighter pixel carries its
    // own albedo hue; the arena ground beside it carries only the arena's light.
    // Gating on chroma leaves dark pixels dark -- which is what a silhouette is
    // made of -- and leaves bare floor completely untouched.
    float subjChroma = length(charLit - luma(charLit));
    float subj = clamp(
      max(smoothstep(0.02, 0.12, idChroma), smoothstep(0.035, 0.14, subjChroma)),
      0.0, 1.0
    );
    c = mix(cEnv, charFinal, matte * subj);
  } else {
    c = cEnv;
  }

  // ── depth-weighted aerial perspective (never touches the fighters) ─────
  if (hazeAmount > 0.001) {
    // Depth alone gates the haze: hazeStart sits WELL BEHIND the fighter plane
    // (~13 units) so the subject and the co-planar mid-ground stay perfectly
    // clear, and only the genuinely-far background (walls, skyline) fogs. This
    // is a monotonic function of depth, so it can never draw a fighter-shaped
    // clear window (the old (1 - matte) carve did — it stamped an elliptical
    // halo into the fog around each fighter). Removing the matte term deletes
    // that artifact entirely; the depth gate is the only protection needed.
    float fog = smoothstep(hazeStart, hazeEnd, dist) * hazeAmount;
    // Aerial perspective is DESATURATION-forward, not a grey wash: far loses
    // its local chroma/contrast and drifts only faintly toward the atmosphere
    // tint. A hard lift to a bright haze colour produced a milky rectangular
    // band where a flat far wall crossed the ramp (worst on ipo-prep, whose
    // back wall is already bright), so the drift is kept small and the chroma
    // drain does the depth work — near stays punchy + saturated, far reads
    // flatter + desaturated, i.e. classic aerial perspective without a band.
    float lo = luma(c);
    vec3 hazed = mix(c, vec3(lo), 0.6);         // drain far chroma (depth cue)
    hazed = mix(hazed, hazeColor, 0.1);          // faint drift toward atmosphere
    c = mix(c, hazed, fog);
  }

  // ── background contrast floor (silhouette separation) ──────────────────
  // A fighting game lives or dies on silhouette read. Measured across the
  // arenas at true neutral framing, background luminance ran 31 (crisis) to 176
  // (ai-native) while the fighters sat at 88..172 -- so on the bright stages the
  // ARENA was brighter than the characters and dark hair dissolved into a
  // backlit wall. Nothing in the per-stage grade prevents that, because each
  // stage is authored on its own and nobody owns the relationship between them.
  //
  // This is that missing owner: a depth-gated highlight compressor that scales
  // ONLY the luminance sitting above bgCeil. A stage already under the ceiling
  // (crisis) comes out bit-for-bit identical -- over is 0, so k is 1 -- while
  // a blown backdrop is pulled under the character plane. It also fixes LOCAL
  // separation, not just the frame mean: the brightest patch behind a head is
  // the furthest above the ceiling, so it is knocked hardest.
  //
  // Purely a monotonic function of depth and luminance, so it can never stamp a
  // fighter-shaped window the way a matte carve does. It runs BEFORE bloom in
  // the compiled pass (grade sorts first on EffectAttribute.DEPTH), so the
  // tamed backdrop also stops over-feeding the bloom threshold.
  if (bgKnock > 0.001) {
    float far = smoothstep(bgFloorStart, bgFloorEnd, dist);
    float Lb = luma(c);
    float over = max(0.0, Lb - bgCeil);
    // over <= Lb by construction, so the ratio is in [0,1] and needs no pow().
    float k = 1.0 - (over / max(Lb, 1e-4)) * bgKnock * far;
    c *= max(k, 0.04);
  }

  // Dynamic response: colour drain + danger cast (low HP / KO), keyed to the
  // environment (1 - matte) so the centred fighters stay clear while the arena
  // reddens and drains hard.
  float envW = 1.0 - matte;
  float L = luma(c);
  c = mix(c, vec3(L), desat * envW);
  c = mix(c, c * dangerTint, dangerAmt * envW);

  // Super / impact full-frame flash, as an EXPOSURE lift rather than a flat add.
  //
  // This used to be a straight "c += flash * warmTint". A flat add moves the
  // black point with it, so a signature at flash=0.55 lifted every pixel in the
  // frame by ~0.5 -- the arena went milk-grey, the stage lost its blacks, and the
  // whole shot read as a washed-out veil instead of a bright flash.
  //
  // A real bright light does not add a constant to the sensor, it multiplies the
  // exposure: highlights blow out, blacks stay black. Multiplying preserves 0
  // exactly, so the arena keeps its contrast while the hit core and the fighters'
  // lit sides slam into the shoulder. The small additive term is gated on
  // luminance so it only fills areas that already carry light (a bounce), and
  // cannot touch true black.
  float flashL = luma(c);
  c *= 1.0 + flash * 2.4;
  c += flash * 0.22 * vec3(0.9, 0.85, 0.7) * smoothstep(0.02, 0.30, flashL);

  // Tinted vignette with a natural falloff.
  float d = distance(uv, vec2(0.5));
  float vig = smoothstep(0.9, vigOffset, d);
  float vg = mix(1.0 - vigDarkness, 1.0, vig);
  c *= vg;
  c += vigColor * (1.0 - vig);

  // Filmic grain, weighted into the mid-tones.
  L = luma(c);
  float n = hash21(uv * 2048.0 + grainTime) - 0.5;
  float midW = 1.0 - pow(abs(L * 2.0 - 1.0), 1.5);
  c += n * grainAmount * midW;

  // Triangular-PDF ordered dither: breaks 8-bit banding in smooth gradients.
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
      ['blackPoint', new THREE.Uniform(0.02)],
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
      // character matte
      ['charA', new THREE.Uniform(new THREE.Vector2(-1, -1))],
      ['charB', new THREE.Uniform(new THREE.Vector2(-1, -1))],
      ['charHalf', new THREE.Uniform(new THREE.Vector2(0.09, 0.24))],
      ['charFeather', new THREE.Uniform(0.55)],
      ['charAmount', new THREE.Uniform(1)],
      ['charChroma', new THREE.Uniform(0.9)],
      ['charLumaFollow', new THREE.Uniform(0.42)],
      ['charPop', new THREE.Uniform(0.24)],
      ['charKey', new THREE.Uniform(1.12)],
      ['charLift', new THREE.Uniform(0.88)],
      ['charFill', new THREE.Uniform(0.05)],
      ['charTone', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
      ['charToneAmt', new THREE.Uniform(0)],
      ['envTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
      ['charUntint', new THREE.Uniform(0)],
      ['charDepth', new THREE.Uniform(13.0)],
      ['charDepthWidth', new THREE.Uniform(5.0)],
      // depth haze
      ['hazeColor', new THREE.Uniform(new THREE.Vector3(0.5, 0.55, 0.62))],
      ['hazeAmount', new THREE.Uniform(0.35)],
      ['hazeStart', new THREE.Uniform(26)],
      ['hazeEnd', new THREE.Uniform(95)],
      // background contrast floor
      ['bgCeil', new THREE.Uniform(0.40)],
      ['bgKnock', new THREE.Uniform(0.70)],
      ['bgFloorStart', new THREE.Uniform(16)],
      ['bgFloorEnd', new THREE.Uniform(30)],
      ['camNear', new THREE.Uniform(0.1)],
      ['camFar', new THREE.Uniform(320)],
    ])
    super('MasterGradeEffect', fragment, {
      attributes: EffectAttribute.DEPTH,
      uniforms,
    })
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
    ;(this.u('hazeColor').value as THREE.Vector3).set(...g.hazeColor)
    this.u('hazeAmount').value = g.hazeAmount
    ;(this.u('envTint').value as THREE.Vector3).set(...g.envTint)
    this.u('charUntint').value = g.charUntint
    ;(this.u('charTone').value as THREE.Vector3).set(...g.charTone)
    this.u('charToneAmt').value = g.charToneAmt
    this.u('charChroma').value = 0.9 * g.charStrength
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

  /** Global black point (true 0 anchor). */
  setBlackPoint(v: number) {
    this.u('blackPoint').value = v
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

  /** Static tuning of the character-separation behaviour. */
  setCharParams(opts: {
    amount?: number
    chroma?: number
    lumaFollow?: number
    pop?: number
    feather?: number
    key?: number
    lift?: number
    fill?: number
  }) {
    if (opts.amount !== undefined) this.u('charAmount').value = opts.amount
    if (opts.chroma !== undefined) this.u('charChroma').value = opts.chroma
    if (opts.lumaFollow !== undefined) this.u('charLumaFollow').value = opts.lumaFollow
    if (opts.pop !== undefined) this.u('charPop').value = opts.pop
    if (opts.feather !== undefined) this.u('charFeather').value = opts.feather
    if (opts.key !== undefined) this.u('charKey').value = opts.key
    if (opts.lift !== undefined) this.u('charLift').value = opts.lift
    if (opts.fill !== undefined) this.u('charFill').value = opts.fill
  }

  /** Linear distance to the fighter plane + falloff, for the matte depth gate. */
  setCharDepth(dist: number, width: number) {
    this.u('charDepth').value = dist
    this.u('charDepthWidth').value = width
  }

  /** Depth haze band tuning. */
  setHaze(start: number, end: number) {
    this.u('hazeStart').value = start
    this.u('hazeEnd').value = end
  }

  /**
   * Background contrast floor. `start`/`end` are the linear eye-space distances
   * over which the compressor ramps in; they are driven from the live fighter
   * plane so the characters are never inside the band. `ceil` is the luminance
   * the arena is allowed to reach and `knock` is how hard everything above it is
   * pulled down (0 disables the whole block).
   */
  setBgFloor(start: number, end: number, ceil?: number, knock?: number) {
    this.u('bgFloorStart').value = start
    this.u('bgFloorEnd').value = end
    if (ceil !== undefined) this.u('bgCeil').value = ceil
    if (knock !== undefined) this.u('bgKnock').value = knock
  }
}
