import { describe, it, expect } from 'vitest'
import { beamTint, coreQuadTint, energyTint, hotTint, BEAM_SPINE_RGB, presenceFor } from '../ProjectileFx'

/**
 * GATE — the Ion Storm super beam spine must not white-clip.
 *
 * THE MECHANISM (verified, not assumed). During a super, several ADDITIVE,
 * un-tone-mapped layers are drawn at the same screen position and SUM into the HDR
 * buffer before AgX + bloom:
 *   · beam        — the shaft, spine colour BEAM_SPINE_RGB, opacity pr.beam*0.92*flicker
 *   · trail       — energyTint('super-beam'), opacity pr.trailOpacity, along the shaft
 *   · aura        — energyTint('super-beam'), opacity pr.auraOpacity, around the head
 *   · core        — hotTint('super-beam'),    opacity pr.coreGlowOpacity, at the head
 *   · sprite quad — the ATLAS ART itself, multiplied by a per-kind coreBoost, at the head
 * Because every layer carries red, whichever layer's red is left UN-suppressed drives
 * the sum past 255 on all channels and the spine pins to WHITE. The critic measured
 * 38–61% of the super's bright pixels blown out this way. It took TWO un-suppressed
 * layers, found by measuring the shipped AgX-composited frame (a spine-column
 * white-clip count, % of bright pixels with all channels ≥248, over the super's life):
 *
 *   1. the BEAM tint was pure white (1,1,1), passing the texture's 135 of red straight
 *      through — it dominates the SHAFT. Fixed by beamTint() (red suppressed, blue >1).
 *   2. the SPRITE QUAD was a neutral grey (coreBoost on all three channels). The super's
 *      atlas art has a bright tip (SB_CORE≈[220,238,255]); grey×1.42 = (312,338,362) and
 *      that tip's SHOULDER pinned the HEAD to neutral white — the dominant driver at high
 *      resolution, and why fixing only the beam barely moved the head. Fixed by
 *      coreQuadTint() (red suppressed for the super only; bolts keep the neutral boost).
 *
 * Shipped-frame spine-column white-clip (all channels ≥248), before → both fixes:
 *   1600×900  peak 5.05% → 1.58%   ·   1920×1080 aggregate 42.3% → ~15%, peak 9.6% → 4.3%
 *   B−R at the spine stays ≫ 0 (blue-dominant) throughout, and the bright-pixel count is
 *   unchanged (the beam is just as HOT — the clip drops, the energy does not).
 *
 * THIS GATE composites the stack from the SAME constants the renderer uses and asserts
 * both fixes hold: the summed SHAFT stays blue-dominant, and the sprite-quad's own TIP
 * contribution reads electric-blue (B≫R) instead of neutral white. A future edit that
 * restores a white beam tint OR a grey super sprite-quad reds here.
 *
 * HONEST SCOPE. This is the PRE-BLOOM, pre-AgX accumulation — the level at which the clip
 * originates and where a per-layer tint acts. It reuses the exact tints/opacities/boost
 * the runtime uses; the only modelled numbers are soft-glow OVERLAP weights (how much of
 * each glow lands on a sample), held at conservative representative values — and the gate
 * keys on the tint-driven separation between white and suppressed, which is independent of
 * those weights (identical before/after). AgX highlight-desaturation means the very
 * dead-centre pinpoint still resolves white on the shipped frame no matter the tint; that
 * is inherent and the art keeps it a radius-6 point. This gate guards the SHOULDER — the
 * large region around it that must stay blue — not that pinpoint.
 */
describe('Ion Storm beam spine additive accumulation', () => {
  const P = presenceFor('super-beam')

  // Beam shaft opacity = pr.beam * 0.92 * flicker, flicker ∈ [0.86,1.0]
  // (ProjectileLayer place(): l.beamMat.opacity = pr.beam * 0.92 * flicker).
  const BEAM_K = 0.92
  const FLICKER = [0.86, 0.9, 0.93, 0.97, 1.0]

  // Representative soft-glow OVERLAP weights at a spine sample a little out from
  // the dead centre — the large blue region that goes white, NOT the tiny
  // legitimately-white core pinpoint. Conservative; the white↔blue separation the
  // gate asserts is beam-driven and holds across any plausible choice here.
  const BEAM_ALPHA = 1.0   // beam texture body alpha on the spine
  const TRAIL_W = 0.7 * 0.6 // f≈0.7 × glow alpha≈0.6
  const AURA_W = 0.5
  const CORE_W = 0.55

  const spineRGB: [number, number, number] = [BEAM_SPINE_RGB[0] / 255, BEAM_SPINE_RGB[1] / 255, BEAM_SPINE_RGB[2] / 255]

  /** Composite the additive stack at the spine for one flicker phase → 0..255 display. */
  function composite(flicker: number) {
    const bt = beamTint()
    const et = energyTint('super-beam')
    const ht = hotTint('super-beam')
    const beamK = P.beam * BEAM_K * flicker * BEAM_ALPHA
    const trailK = P.trailOpacity * TRAIL_W
    const auraK = P.auraOpacity * AURA_W
    const coreK = P.coreGlowOpacity * CORE_W

    const hdr = [
      spineRGB[0] * bt.r * beamK + et.r * trailK + et.r * auraK + ht.r * coreK,
      spineRGB[1] * bt.g * beamK + et.g * trailK + et.g * auraK + ht.g * coreK,
      spineRGB[2] * bt.b * beamK + et.b * trailK + et.b * auraK + ht.b * coreK,
    ]
    const disp = hdr.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255))
    return { r: disp[0], g: disp[1], b: disp[2] }
  }

  /** The beam's OWN contribution in isolation (pure beam constants, no glow weights). */
  function beamIsolated(flicker: number) {
    const bt = beamTint()
    const beamK = P.beam * BEAM_K * flicker * BEAM_ALPHA
    const disp = [
      Math.round(Math.min(1, spineRGB[0] * bt.r * beamK) * 255),
      Math.round(Math.min(1, spineRGB[1] * bt.g * beamK) * 255),
      Math.round(Math.min(1, spineRGB[2] * bt.b * beamK) * 255),
    ]
    return { r: disp[0], g: disp[1], b: disp[2] }
  }

  it('keeps the summed spine off the white clip and blue-dominant across the flicker', () => {
    for (const fl of FLICKER) {
      const { r, b } = composite(fl)
      // R must stay well below the 248 all-channels-white threshold so bloom spill
      // cannot tip it over. A white (1,1,1) beam tint puts R at 223–240 here.
      expect(r, `spine R at flicker ${fl}`).toBeLessThan(200)
      // Blue must dominate red by a clear margin. White tint collapses this to 15–32.
      expect(b - r, `spine B−R at flicker ${fl}`).toBeGreaterThanOrEqual(55)
    }
  })

  it('still reads HOT — B and G saturate (a searing blue-white lance, not a dull blue bar)', () => {
    for (const fl of FLICKER) {
      const { g, b } = composite(fl)
      // Guards the OVER-correction failure mode: a tint so red-suppressed that the
      // shaft stops saturating would drop these and read dull. Both must peg high.
      expect(b, `spine B at flicker ${fl}`).toBeGreaterThanOrEqual(250)
      expect(g, `spine G at flicker ${fl}`).toBeGreaterThanOrEqual(235)
    }
  })

  it('the beam layer itself is red-suppressed and blue-pinned (pure beam constants)', () => {
    for (const fl of FLICKER) {
      const { r, b } = beamIsolated(fl)
      // Beam-only, no head-glow weights: white (1,1,1) gives R≈124, B−R≈111.
      expect(r, `beam-isolated R at flicker ${fl}`).toBeLessThan(90)
      expect(b - r, `beam-isolated B−R at flicker ${fl}`).toBeGreaterThanOrEqual(150)
    }
  })

  it('the beam tint is not white and suppresses red below blue (the anti-pattern guard)', () => {
    const t = beamTint()
    // The exact trap: a pure-white pass-through tint. Red must sit well under blue.
    expect(t.r).toBeLessThan(t.b - 0.4)
    expect(t.r).toBeLessThan(0.6)
    expect(t.b).toBeGreaterThanOrEqual(1.0)
  })

  // ── Sprite-quad head tip ────────────────────────────────────────────────────
  // The main sprite quad draws the atlas art multiplied by coreQuadTint(kind,
  // coreBoost). The super's authored art has a bright TIP (SB_CORE in
  // scripts/generate-projectiles.ts). Under the OLD neutral-grey boost that tip's
  // shoulder summed to neutral white; the super's red-suppressed boost keeps it
  // electric-blue. Guards that lever independently of the beam.
  const SB_CORE: [number, number, number] = [220, 238, 255] // authored: generate-projectiles.ts

  /** The sprite quad's OWN tip contribution: atlas SB_CORE × coreQuadTint → display. */
  function spriteTip() {
    const t = coreQuadTint('super-beam', P.coreBoost)
    const disp = [
      Math.round(Math.min(1, (SB_CORE[0] / 255) * t.r) * 255),
      Math.round(Math.min(1, (SB_CORE[1] / 255) * t.g) * 255),
      Math.round(Math.min(1, (SB_CORE[2] / 255) * t.b) * 255),
    ]
    return { r: disp[0], g: disp[1], b: disp[2] }
  }

  it('the sprite-quad tip reads electric-blue, not neutral white (B ≫ R)', () => {
    const { r, g, b } = spriteTip()
    // Grey (coreBoost,coreBoost,coreBoost) drives this authored tip to (255,255,255)
    // — R at the clip, B−R = 0, a neutral-white smudge. The super's suppressed boost
    // must hold R off the all-channel-white threshold and keep blue clearly ahead.
    expect(r, 'sprite-tip R').toBeLessThan(240)
    expect(b - r, 'sprite-tip B−R').toBeGreaterThanOrEqual(40)
    // …while still SATURATING blue+green, so the tip is a searing blue-white pinpoint
    // rather than a dull blue dot (the over-correction failure mode).
    expect(g, 'sprite-tip G').toBeGreaterThanOrEqual(250)
    expect(b, 'sprite-tip B').toBeGreaterThanOrEqual(250)
  })

  it('the super sprite-quad tint suppresses red; non-super keeps the neutral boost byte-identical', () => {
    const s = coreQuadTint('super-beam', P.coreBoost)
    // Super: red pulled below blue and below the neutral grey level; blue at/above it.
    expect(s.r).toBeLessThan(s.b - 0.3)
    expect(s.r).toBeLessThan(P.coreBoost)
    expect(s.b).toBeGreaterThanOrEqual(P.coreBoost)
    // Bolts and any un-profiled kind MUST be untouched — an exact neutral grey boost.
    for (const kind of ['ion-bolt', 'mystery-kind']) {
      const g = coreQuadTint(kind, 1.35)
      expect(g.r, `${kind} R`).toBeCloseTo(1.35, 6)
      expect(g.g, `${kind} G`).toBeCloseTo(1.35, 6)
      expect(g.b, `${kind} B`).toBeCloseTo(1.35, 6)
    }
  })
})
