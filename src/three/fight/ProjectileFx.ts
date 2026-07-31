import * as THREE from 'three'

/**
 * Shared visual-FX helpers for projectile rendering: a procedural soft-glow
 * texture, a per-kind energy tint, and an additive glow-mesh factory.
 *
 * These back the parts of a shipped fireball that the sprite atlas alone does
 * NOT give you — the motion trail, the light it spills on the floor, and the
 * impact flash. They are deliberately additive and un-tone-mapped so they read
 * as emitted light (and feed the bloom), never as a pasted-on decal.
 */

let glowTex: THREE.Texture | null = null

/**
 * A radial white core → transparent edge, rasterised once and shared. An
 * additive quad wearing this reads as a soft light bloom rather than a hard
 * disc, so a trail blob or floor pool melts into the scene instead of cutting a
 * circle out of it.
 */
export function softGlowTexture(): THREE.Texture {
  if (glowTex) return glowTex
  const S = 64
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0.0, 'rgba(255,255,255,1)')
  g.addColorStop(0.32, 'rgba(255,255,255,0.6)')
  g.addColorStop(0.68, 'rgba(255,255,255,0.14)')
  g.addColorStop(1.0, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  glowTex = tex
  return tex
}

let coreTex: THREE.Texture | null = null

/**
 * A TIGHT hot-core gradient: near-white out to ~15% of the radius, then a fast
 * roll-off to nothing by ~70%. Where {@link softGlowTexture} is a gentle haze
 * (good for a trail blob or a floor pool that must MELT into the scene), this is
 * the opposite — a searing point with a sharp edge. It backs ONLY the bolt/beam
 * hot core, which the genre uses for core-contrast: on a lit stage a soft glow
 * washes to a flat pale puff, and the fix is a crisp bright centre, not more
 * overall brightness (which just blooms the fighters out). Sharing the soft
 * texture for the core is exactly what made the isolated bolt read as a mushy
 * blue haze with no defined middle.
 */
export function hotCoreTexture(): THREE.Texture {
  if (coreTex) return coreTex
  const S = 64
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0.0, 'rgba(255,255,255,1)')
  g.addColorStop(0.15, 'rgba(255,255,255,0.88)')
  g.addColorStop(0.4, 'rgba(255,255,255,0.28)')
  g.addColorStop(0.7, 'rgba(255,255,255,0.05)')
  g.addColorStop(1.0, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  coreTex = tex
  return tex
}

let beamTex: THREE.Texture | null = null
let beamCrackleTex: THREE.Texture | null = null

/**
 * The beam column texture's darkest body (coreV=0) and hottest spine (coreV=1)
 * colours, 0..255. Exported so the accumulation gate (beamClip.test.ts) can
 * composite the shaft from the SAME numbers the texture bakes rather than a copy
 * that can silently drift, and `beamColumnTexture()` derives its per-row ramp
 * from them so the two can never disagree. B is pinned at 255 for both — the
 * shaft never washes cyan; the coreV ramp only lifts R and G toward the spine.
 */
export const BEAM_BODY_RGB: readonly [number, number, number] = [40, 92, 255]
export const BEAM_SPINE_RGB: readonly [number, number, number] = [135, 188, 255]

/**
 * A horizontal BEAM-COLUMN gradient: a long electric-blue shaft with a thin
 * blue-white hot filament down its spine, a softer blue body around it, feathered
 * at the tail (the muzzle end melts into the caster's hand) and tapering to a
 * bright leading edge (the head). Stretched between the muzzle and the beam head
 * it draws the caster→target lance the marquee super was missing — the critic's
 * "no beam geometry at all". Colour is baked BLUE-DOMINANT (body [40,92,255],
 * spine [135,188,255]) rather than left white, so even summed additively the
 * shaft holds its ion hue instead of clipping to a neutral smear. The texture is
 * only half the story: the material tint (see `beamTint`) actively SUPPRESSES red
 * on top of this, because at runtime the shaft is one of several additive layers
 * stacked at the same screen position (aura + core + trail + bloom) and a white
 * pass-through tint let every layer's red sum past 255 → white (see beamClip).
 */
export function beamColumnTexture(): THREE.Texture {
  if (beamTex) return beamTex
  const W = 256, H = 64
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(W, H)
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  for (let y = 0; y < H; y++) {
    const vc = Math.abs((y + 0.5) / H - 0.5) * 2 // 0 at spine, 1 at edge
    const bodyV = Math.exp(-((vc / 0.62) ** 2))
    const coreV = Math.exp(-((vc / 0.17) ** 2))
    const vprof = Math.min(1, bodyV * 0.55 + coreV)
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W
      // Feather the muzzle tail, keep a bright leading head, tiny edge taper.
      const uEnv = smooth(0, 0.12, u) * (1 - 0.3 * smooth(0.92, 1, u))
      const a = Math.max(0, Math.min(1, vprof * uEnv))
      const i = (y * W + x) * 4
      // R and G ramp from the body colour up to the blue-white spine as coreV→1;
      // B is pinned (body B === spine B === 255). Derived from the exported
      // BEAM_*_RGB so the shaft the gate composites is the shaft that ships.
      img.data[i] = BEAM_BODY_RGB[0] + coreV * (BEAM_SPINE_RGB[0] - BEAM_BODY_RGB[0])
      img.data[i + 1] = BEAM_BODY_RGB[1] + coreV * (BEAM_SPINE_RGB[1] - BEAM_BODY_RGB[1])
      img.data[i + 2] = BEAM_BODY_RGB[2] + coreV * (BEAM_SPINE_RGB[2] - BEAM_BODY_RGB[2])
      img.data[i + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  beamTex = tex
  return tex
}

// ── Beam crackle: moving high-frequency structure ALONG the shaft ─────────────
//
// MEASURED DEFECT (critic: "no crackle, a smooth shaft"). beamColumnTexture above
// is smooth along its LENGTH: its colour is a function of the across-axis only
// (constant along u) and its along-length alpha is a single monotonic
// feather→plateau→taper envelope — 0 local maxima, detrended-std 0.023. The only
// motion the shaft had came from two SPATIALLY-UNIFORM global oscillators in
// ProjectileLayer.place(): an opacity flicker (measured 16.2 Hz, ±12%) and a
// thickness wobble (8.7 Hz, ±7%). Those are fine in rate/amplitude but they
// brighten/thin the WHOLE bar together, so they read as a breathing bar, never as
// crackle. Live electrical discharge needs high-frequency SPATIAL variation that
// TRAVELS — bright nodes and dark gaps racing muzzle→head. No change to the global
// pulse can supply that; the structure has to live along the shaft and move.
//
// Carried as an alphaMap that MULTIPLIES the beam's alpha (final alpha =
// opacity × column-alpha × crackle). Values sit in [~0.5, 1.0] with peaks pinned
// at 1.0, so it only ever multiplies DOWN — carving moving dark gaps WITHOUT
// adding energy. It therefore cannot push any channel toward the white clip the
// beam-tint / coreQuadTint fix just closed (if anything it lowers the summed
// spine), and its peaks stay hot so the beam does not go dull. That resolves the
// critic's two super notes with one mechanism: sharper definition (gaps break up
// the smooth blur) at strictly ≤ current energy (no re-blowout).
//
// beamCrackleRow is the pure 1-D generator, period-1 tileable via INTEGER
// frequencies so the alphaMap scrolls seamlessly across its RepeatWrapping. It is
// exported (no GL/canvas) so crackle.test.ts can gate its spatial content —
// ~10 local maxima per tile vs the column's 0 — and its clip-safe range.
export function beamCrackleRow(W: number, lo = 0.5): Float32Array {
  const out = new Float32Array(W)
  const TAU = Math.PI * 2
  for (let x = 0; x < W; x++) {
    const u = x / W // period-1: u=0 and u=1 are the same phase (seamless tile)
    let s =
      0.5 * Math.sin(TAU * u * 5) +
      0.34 * Math.sin(TAU * u * 9 + 1.3) +
      0.28 * Math.sin(TAU * u * 13 + 4.0)
    s /= 1.12 // → ~[-1, 1]
    let v = 0.5 + 0.5 * s // → [0, 1]
    v = Math.pow(Math.max(0, v), 0.6) // bias bright, sharpen the dips into gaps
    out[x] = lo + (1 - lo) * v // → [lo, 1], peaks at 1.0 (energy-preserving at nodes)
  }
  return out
}

// World length of one crackle tile. place() sets alphaMap.repeat.x =
// shaftLen / BEAM_CRACKLE_PERIOD so node density stays constant as the lance grows
// (≈10 nodes/tile → a ~12u full-screen beam shows ~24 travelling nodes) instead of
// the pattern stretching. Larger ⇒ chunkier, fewer nodes.
export const BEAM_CRACKLE_PERIOD = 5.0
// Tiles the pattern scrolls per frame (clock advances ~1/frame at 60fps). Negative
// so the crackle flows muzzle→head with the beam's travel. 0.05 tile/frame ⇒ node
// world-velocity ≈ BEAM_CRACKLE_PERIOD * 0.05 * 60 ≈ 15 u/s — a fast live flow.
export const BEAM_CRACKLE_SCROLL = 0.05
// U-offset for the alphaMap at a clip clock (frames). Pure + monotonic so
// crackle.test.ts can assert the crackle actually MOVES (a frozen scroll reds it).
export function beamCrackleScroll(clock: number): number {
  return -clock * BEAM_CRACKLE_SCROLL
}

// Bakes beamCrackleRow into a tileable grayscale strip used as the beam's alphaMap.
// Cached singleton: like beamColumnTexture it outlives any one beam (material
// .dispose() frees the material, not its textures), and only one super beam is
// ever live at a time, so the per-frame repeat/offset that place() writes on it is
// never contended. NoColorSpace — it is a mask, not colour, so it must not be
// sRGB-decoded on sample. Needs a canvas, so it is never called in vitest-node.
export function beamCrackleTexture(): THREE.Texture {
  if (beamCrackleTex) return beamCrackleTex
  const W = 256,
    H = 32
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(W, H)
  const row = beamCrackleRow(W)
  for (let y = 0; y < H; y++) {
    // Small per-row phase shift so gaps tilt/shimmer across the beam's thickness
    // rather than being perfectly vertical bands (cosmetic; the gated along-length
    // content is beamCrackleRow itself).
    const shift = Math.round((y / H) * 7)
    for (let x = 0; x < W; x++) {
      const g = Math.round(row[(x + shift) % W] * 255)
      const i = (y * W + x) * 4
      img.data[i] = g
      img.data[i + 1] = g
      img.data[i + 2] = g
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.NoColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  beamCrackleTex = tex
  return tex
}

/**
 * The additive TINT worn by the beam-column material. NOT white.
 *
 * The shaft is one of several additive, un-tone-mapped layers stacked at the
 * same screen position during a super: the travelling aura underneath, the
 * blue-hot core on top, the trail blobs along the shaft, then the bloom pass over
 * all of it. Every one of those contributes red. The column texture already bakes
 * a genuinely blue-dominant shaft (spine [135,188,255]); a white (1,1,1) tint
 * passed that 135 of red through at full strength, and once the aura's, core's,
 * trail's and bloom's red piled on top the SUM crossed 255 on every channel and
 * the spine pinned to white — the "38–61% of bright pixels blown out" the critic
 * measured. Fixing only the core (commit 12c4d0b) did not help, because the
 * clipping is an ACCUMULATION across layers, not any single layer.
 *
 * So this tint does what the core's (0.42,0.74,1.95) fix did, at the layer that
 * spans the whole spine: it actively SUPPRESSES red (0.46) and pushes blue past 1
 * (1.12), so the beam's own contribution to the stack stays blue-dominant. Under
 * heavy additive stacking the summed spine then holds R well below B/G (measured:
 * head-adjacent R 240→173, B−R 15→82) instead of racing them to white, while B
 * and G still saturate so the shaft reads HOT (a searing blue-white lance), not a
 * dull blue bar. Green is kept moderate (0.80) — enough luminance that the shaft
 * still blooms bright, not so much that it greys back toward white. Gated by
 * beamClip.test.ts (a deterministic composite of the real per-layer constants);
 * tuned against that additive-accumulation model, not by eye.
 */
export function beamTint(): THREE.Color {
  return new THREE.Color(0.46, 0.8, 1.12)
}

/**
 * Per-kind additive light colour, as an RGB multiplier applied to the sprite's
 * energy. Values above 1 push a channel hot; the point is to bias toward one
 * dominant channel so the glow survives tone-mapping into the bloom. An unknown
 * kind still gets a warm light rather than an untinted grey, so a newly authored
 * projectile lights the scene the day its `frames.json` lands.
 */
const TINTS: Record<string, [number, number, number]> = {
  'ion-bolt': [0.34, 0.78, 1.2],
  // Blue pinned well above green so that when the aura/trail/floor/column stack
  // additively and the blue channel clips at 255, green does NOT catch up and
  // wash the body to cyan-white. A composite layer-diff (measure-beam-iso) showed
  // the old [.40,.72,1.5] body clipping to cyan (B-dom -23); dropping green to
  // .46 keeps the stacked body blue-dominant (the critic's "stays indigo").
  'super-beam': [0.34, 0.46, 1.6],
}

export function energyTint(kind: string): THREE.Color {
  const t = TINTS[kind] ?? [1.15, 1.0, 0.82]
  return new THREE.Color(t[0], t[1], t[2])
}

/**
 * How PRESENT a kind should read on screen. A fireball and a super beam are the
 * same code path with wildly different budgets: an `ion-bolt` is a jab you
 * throw ten of, a `super-beam` is the single most expensive moment in the match
 * and has to announce itself. Rather than branch on kind all through the layer,
 * every visual knob a kind might crank lives here, and the layer just reads the
 * profile. The DEFAULT reproduces the tuned ion-bolt look exactly, so a kind
 * with no entry (and ion-bolt itself) is untouched by any of this.
 */
export interface Presence {
  /** Multiplier on authored sprite size (and its anchor math). */
  spriteScale: number
  /** Whole-sprite colour multiply; pushes the core past the bloom threshold. */
  coreBoost: number
  /** Peak additive opacity of the freshest trail blob. */
  trailOpacity: number
  /** Multiplier on trail-blob size (a super drags a fatter wake). */
  trailSize: number
  /** Floor light-pool footprint (× sprite width) and brightness. */
  floorScaleX: number
  floorScaleY: number
  floorOpacity: number
  /** Travelling volumetric glow behind the sprite, as a multiple of sprite
   *  height. 0 disables it (an ion-bolt is a hard bead, not a volume). */
  aura: number
  auraOpacity: number
  /** A small, intense, near-white hot core laid OVER the broad aura (additive
   *  blending is order-independent, so it simply sums a bright peak into the
   *  center). Size is × sprite height; 0 disables it. This is the CORE-CONTRAST
   *  lever: on a bright stage the aura alone washes to a flat pale haze, and the
   *  fix the genre uses is a searing hot center with a sharp falloff, not more
   *  overall brightness. Scaled slightly wide so it reads as a lance, not a dot. */
  coreGlow: number
  coreGlowOpacity: number
  /** Hard spawn flash: a screen-scale burst the instant the projectile is born,
   *  as a multiple of sprite height. 0 disables it — only a super gets one. */
  spawnFlash: number
  spawnFlashTicks: number
  spawnFlashOpacity: number
  /** Impact-burst flash size multiplier and peak opacity. */
  impactScale: number
  impactOpacity: number
  /** Full-screen super atmosphere, both 0 for a jab. `worldDim` is the peak
   *  opacity of a cool, near-neutral quad slid BEHIND the fighters (renderOrder
   *  8, between the stage's top at 5 and the fighters at 10): normal-blended, it
   *  drops the whole world back and pulls its hues toward grey-blue, so the
   *  characters and the beam pop out of a receded stage — darken-plus-desaturate
   *  in one pass, the way most 2D fighters fake it rather than a true HSV grade.
   *  `screenFlash` is the peak opacity of a hard additive full-screen burst the
   *  instant the shot is born. Only a super darkens the stage or flashes the
   *  screen; an ion-bolt leaves both at 0 and nothing here runs. */
  worldDim: number
  screenFlash: number
  /** A stretched additive COLUMN drawn from the muzzle to the beam head — the
   *  caster→target "lance" the critic found missing ("no beam geometry at all").
   *  0 disables it (an ion-bolt is a travelling bead, not a connected beam); a
   *  super sets it to 1 to draw the electric column that ties the caster to the
   *  strike. Purely a super lever — the whole read of "a discharge with structure"
   *  rather than "a glow floating in the gap" lives here. */
  beam: number
  /** How strongly the sim's projectile SPEED maps to visual strength (0 = ignore
   *  speed and use the profile verbatim). Both ion-bolt buttons spawn the SAME
   *  kind and art and differ ONLY in speed (lp = slow "wall", hp = fast
   *  "charged"), so without this a charged bolt is pixel-identical to a lobbed
   *  one — the archetype's whole read (a zoner whose fireballs ARE the gameplay)
   *  collapses to one fireball. A positive ramp reads speed as HEAT: the fast
   *  bolt gets a hotter core, a longer/fatter streak, a punchier muzzle and a
   *  slightly larger silhouette; the slow bolt stays a heavier, rounder ball with
   *  a wider floor wash. A super sets this to 0 — its presence is authored and
   *  already maxed, and must never be re-scaled by how fast the beam happens to
   *  travel. See applyStrength for the exact spread. */
  strengthRamp: number
}

/** The tuned ion-bolt numbers — every kind starts here. The ion-bolt now carries
 *  a modest spawn muzzle (a birth TELL: a hard little pop of light at the palm
 *  the instant the bolt appears, so a fireball announces itself instead of just
 *  sliding into frame), a small travelling AURA and a tight hot CORE (so the bolt
 *  reads as a lit energy object rather than the pale tan dot the bare atlas
 *  sprite gave — a native on/off isolation showed the old bolt paint as a soft
 *  floor haze with a near-dark centre, the exact "washes to a flat pale haze"
 *  failure the coreGlow lever was written to fix), and opts INTO the
 *  speed→strength ramp (strengthRamp: 1) so the light and heavy buttons read
 *  apart. The aura/core are LOCAL additive light on the bolt, kept far below a
 *  super's budget and nowhere near the full-screen worldDim/screenFlash levers
 *  (still 0 here) that are the real blow-out risk. A super overrides all of it. */
const DEFAULT_PRESENCE: Presence = {
  spriteScale: 1,
  coreBoost: 1.35,
  trailOpacity: 0.6,
  trailSize: 1,
  floorScaleX: 1.15,
  floorScaleY: 0.36,
  floorOpacity: 0.3,
  aura: 1.1,
  auraOpacity: 0.15,
  coreGlow: 0.8,
  coreGlowOpacity: 0.78,
  spawnFlash: 1.6,
  spawnFlashTicks: 8,
  spawnFlashOpacity: 0.62,
  impactScale: 1,
  impactOpacity: 0.9,
  worldDim: 0,
  screenFlash: 0,
  beam: 0,
  strengthRamp: 1,
}

/**
 * World-dim depth for the whole super (freeze charge AND travelling beam).
 *
 * MEASURED DEFECT (critic v12: the shipped super "reads FADED — a formless blue
 * bloom orb over a DESATURATED world-dim"). The dim is a full-frustum quad that
 * darkens ONLY the background (renderOrder 8, under the fighters at 10), so it is
 * a pure spotlight. At the shipped 0.6 it over-crushed that background: measured
 * on the `/` route at the true impact-frame set (1920×1080, warden Ion Storm), the
 * held 60-frame freeze dropped background luma −31% (79→55) and — the part the
 * critic's eye caught — saturation −26% (0.27→0.206). A spotlight that grey-washes
 * the world it is meant to pop the super AGAINST reads "faded", not "powerful".
 * Dropping to 0.45 recovers the freeze to luma −21% (→63) and saturation −15%
 * (→0.23) — the world stays cinematically dimmed (a clear spotlight survives) but
 * is no longer crushed to grey — while the super never clips (blown flat at 0.39%,
 * = at-rest) and the beam still reads (travel maskPct 30%+, blueDom > 0). SF6, not
 * GGST: legible and alive the whole way through, not a flashbulb over a dead stage.
 *
 * SINGLE SOURCE OF TRUTH. The freeze-dim (`SUPER.DIM_PEAK` in ProjectileLayer) and
 * the travelling-beam-dim (this presence's `worldDim`) MUST be equal or the
 * freeze→beam hand-off shows a visible step — a bug the atmosphere code's own
 * comment documents as having shipped once. Two hand-tuned copies can silently
 * drift; ONE exported constant that both read makes that drift unrepresentable
 * (the required-agreement is enforced by construction, not by a test that someone
 * must remember to keep). A gate then guards only the remaining freedom: the value
 * staying below the over-fade ceiling.
 */
export const SUPER_WORLD_DIM = 0.45

/**
 * Per-kind overrides. `super-beam` is dialled up across the board: a wider,
 * brighter core; a fat bright wake; a floor wash several times larger; a
 * travelling volume of light around the lance; a hard screen-scale spawn flash
 * that fires the frame it is born; and an impact burst far bigger than a jab's.
 * This is the difference between "a slightly bigger fireball" and "a super".
 */
const PRESENCE: Record<string, Partial<Presence>> = {
  'super-beam': {
    spriteScale: 1.4,
    coreBoost: 1.42,
    trailOpacity: 0.92,
    trailSize: 1.7,
    floorScaleX: 3.4,
    floorScaleY: 2.5,
    floorOpacity: 0.6,
    aura: 2.7,
    auraOpacity: 0.55,
    coreGlow: 0.95,
    coreGlowOpacity: 1,
    spawnFlash: 5.5,
    spawnFlashTicks: 12,
    spawnFlashOpacity: 0.85,
    impactScale: 2.7,
    impactOpacity: 1,
    worldDim: SUPER_WORLD_DIM,
    screenFlash: 0.5,
    strengthRamp: 0,
    beam: 1,
  },
}

/**
 * Every kind with a per-kind presence override. Exported so a gate can iterate
 * the WHOLE set and assert a house rule on each — e.g. no kind may over-fade the
 * world — instead of spot-checking one member and leaving the next addition
 * unguarded (the "validate one of a set, N go unchecked" shape this codebase has
 * shipped repeatedly). presenceFor() folds each over DEFAULT_PRESENCE, so a kind
 * absent here still resolves (to the default) — the gate reads through presenceFor.
 */
export const PRESENCE_KINDS: readonly string[] = Object.keys(PRESENCE)

/**
 * Map a projectile's SPEED onto a 0..1 strength and push the profile that far
 * from its slow baseline toward a hotter, leaner "charged" read. The mapping is
 * a smoothstep over speed 4→10, so it needs no exact per-fighter numbers baked
 * in and degrades gracefully if the sim retunes bolt speeds (a faster bolt just
 * reads hotter). `ramp` scales the whole spread, so a kind can opt into a weaker
 * response or (0) none at all. Mutates the passed profile in place.
 *
 * Every lever moves in the SAME direction a heavier hit would: the fast bolt is
 * brighter (coreBoost), a touch larger (spriteScale), drags a longer fatter
 * streak (trailSize/Opacity), pops a harder muzzle (spawnFlash), lands a bigger
 * impact and burns a HOTTER, tighter core (coreGlowOpacity up, coreGlow size
 * down); the slow "wall" bolt keeps the WIDER, softer floor wash and a rounder,
 * larger travelling aura so it reads as a heavy grounded ball rather than a lean
 * dart. Deliberately does NOT touch worldDim/screenFlash — those stay a
 * super-only budget so a fast ion-bolt can never start dimming the stage or
 * hard-flashing the whole screen, the two full-screen blow-out levers.
 */
function applyStrength(p: Presence, speed: number, ramp: number): void {
  const s = THREE.MathUtils.smoothstep(speed, 4, 10) * ramp
  const L = (a: number, b: number) => a + (b - a) * s
  p.coreBoost *= L(0.9, 1.28)
  p.spriteScale *= L(0.97, 1.06)
  p.trailSize *= L(0.82, 1.42)
  p.trailOpacity *= L(0.9, 1.12)
  p.floorScaleX *= L(1.18, 0.98)
  p.floorScaleY *= L(1.12, 0.9)
  p.floorOpacity *= L(1.06, 0.9)
  p.spawnFlash *= L(0.8, 1.35)
  p.impactScale *= L(0.9, 1.18)
  p.impactOpacity = Math.min(1, p.impactOpacity * L(0.96, 1.08))
  // Core reads as HEAT: the fast bolt's core burns brighter (opacity) and tighter
  // (smaller footprint, sharper falloff); the slow bolt's core is dimmer and
  // broader. The aura is the opposite — a rounder, larger, slightly stronger
  // volume on the slow "wall", leaner on the fast dart. Both stay well under a
  // super's aura/core and never touch the full-screen wash levers.
  p.coreGlowOpacity = Math.min(1, p.coreGlowOpacity * L(0.88, 1.16))
  p.coreGlow *= L(1.14, 0.9)
  p.aura *= L(1.18, 0.86)
  p.auraOpacity = Math.min(0.4, p.auraOpacity * L(1.1, 0.92))
}

/**
 * Resolve the effective presence for a projectile. `speed` (|vel.x|, cm/frame)
 * is optional: when supplied and the kind opted into a strength ramp, the
 * profile is pushed along the slow→fast axis (see applyStrength) so two buttons
 * of the same kind read apart. Omitting it (or a kind with strengthRamp 0)
 * returns the authored profile verbatim, so headless callers and supers are
 * untouched.
 */
export function presenceFor(kind: string, speed?: number): Presence {
  const p: Presence = { ...DEFAULT_PRESENCE, ...(PRESENCE[kind] ?? {}) }
  if (p.strengthRamp > 0 && speed != null && speed > 0) applyStrength(p, speed, p.strengthRamp)
  return p
}

/** A near-white flash colour (a super's spawn burst is hot light, not just a
 *  bigger tinted glow), nudged slightly toward the kind's energy hue. */
export function flashTint(kind: string): THREE.Color {
  return energyTint(kind).lerp(new THREE.Color(1.6, 1.6, 1.75), 0.6)
}

/**
 * The HOT-CORE / super-flash colour. For most kinds this is `flashTint` — a
 * near-white pop, correct for a small ion-bolt muzzle. But a super's core is the
 * one place the whole failure lived: multiplied and additively summed, a
 * near-white core clips every channel to 255 and the marquee beam "resolves to a
 * fuzzy white bloom oval with no colour" (VERDICT-v9). Ion Storm therefore gets a
 * BLUE-HOT core instead: blue pinned well above 1 so it survives tone-map and
 * bloom, red held DOWN so the centre reads as ionized electric-blue-white rather
 * than neutral white. The green is kept moderate — enough that the very centre
 * still blooms to a hot blue-white pinpoint, not so much that the body greys out.
 * This is the "keep the core below the white clip so it stays indigo" fix the
 * critic asked for, applied to the emitter's own additive layers (the bloom pass
 * is renderer-aaa's to preserve hue on top of this). */
export function hotTint(kind: string): THREE.Color {
  if (kind === 'super-beam') return new THREE.Color(0.42, 0.74, 1.95)
  return flashTint(kind)
}

/**
 * Colour multiply for the MAIN sprite quad — the atlas art itself. Historically a
 * neutral grey (`coreBoost` on all three channels) so the boost lifts the art over
 * the bloom threshold WITHOUT shifting its authored hue. That is right for a bolt,
 * whose art is dim and cool. But it was the LAST achromatic layer left in the super
 * stack once the core (12c4d0b), the energy tints and the beam tint were all
 * red-suppressed — and the super's atlas art carries a deliberately bright tip
 * (`SB_CORE ≈ [220,238,255]` in scripts/generate-projectiles.ts). Grey × coreBoost
 * 1.42 drives that tip to (312,338,362): every channel clips, and summed additively
 * over the already-hot core/aura/beam the head's SHOULDER (the ring just off the
 * dead centre, where AgX still preserves hue) pinned to NEUTRAL white — the residual
 * blow-out the critic measured after the core-only fix. The very centre is a
 * different animal: fully overdriven, AgX desaturates it to a white pinpoint no
 * per-layer tint can recolour, and the art deliberately keeps that a radius-6 point.
 * So the super gets the same channel-weighted treatment as every other layer, aimed
 * at the SHOULDER: red pulled DOWN (0.64) so the summed ring keeps R below the
 * all-channel clip and reads electric-blue, green and blue kept high (0.90 / 1.0) so
 * the tip still saturates to a searing blue-white. Now EVERY additive layer in the
 * super stack is blue-dominant, so the accumulation cannot race red to white however
 * the layers pile up (the mechanism, not a symptom tint). Non-super kinds keep the
 * exact neutral boost — byte-identical, bolts untouched.
 */
export function coreQuadTint(kind: string, coreBoost: number): THREE.Color {
  if (kind === 'super-beam') return new THREE.Color(coreBoost * 0.64, coreBoost * 0.9, coreBoost)
  return new THREE.Color(coreBoost, coreBoost, coreBoost)
}

/**
 * A unit-quad additive glow mesh wearing the shared soft-glow texture. The
 * caller owns scale, position and per-frame opacity; this only fixes the bits
 * that make it behave as light: additive blend, no depth write, no tone-map.
 * `depthTest` is off so a floor pool or trail never gets z-killed by stage
 * geometry it is meant to wash over.
 */
export function makeGlowMesh(tint: THREE.Color, renderOrder: number, tex?: THREE.Texture): THREE.Mesh {
  const geom = new THREE.PlaneGeometry(1, 1)
  const mat = new THREE.MeshBasicMaterial({
    map: tex ?? softGlowTexture(),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    color: tint.clone(),
    opacity: 1,
  })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = renderOrder
  return mesh
}

/** One bolt's hot-point this frame, for the renderer-only clash test. */
export interface ClashPoint {
  owner: 0 | 1
  x: number
  y: number
}

/**
 * Do two live bolts clash this frame? True ONLY for OPPOSING owners whose
 * hot-points sit within `threshold` world units (squared-distance, inclusive of
 * the boundary). A fighter's own spread never crackles against itself.
 *
 * This is deliberately COSMETIC: the sim rules that projectiles pass through one
 * another (combat.updateProjectiles: "Projectiles ignore one another — the
 * simplest rule that still zones"), so the renderer paints an energy crackle
 * where two opposing bolts cross WITHOUT touching the simulation — no trade, no
 * despawn, nothing that could desync. Pure (numbers only) so it unit-tests
 * without a scene or a GL context, which is the only honest way to prove an
 * additive burst's TRIGGER (the burst itself defeats pixel differencing).
 */
export function clashing(a: ClashPoint, b: ClashPoint, threshold: number): boolean {
  if (a.owner === b.owner) return false
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy <= threshold * threshold
}
