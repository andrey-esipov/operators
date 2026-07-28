import { describe, it, expect } from 'vitest'
import { presenceFor } from '../ProjectileFx'

/**
 * The two ion-bolt buttons (lp = slow "wall", hp = fast "charged") spawn the
 * SAME kind and art and differ ONLY in the sim's travel speed. presenceFor maps
 * that speed to a visual strength so they don't render pixel-identical — the
 * whole point of a zoner whose fireballs ARE the gameplay. Each assertion below
 * is chosen to go red if the ramp is removed or flattened (e.g. deleting the
 * applyStrength call makes slow and fast equal, failing every `toBeGreaterThan`),
 * not merely "a presence exists".
 *
 * Speeds mirror warden.ts: boltSlow 5, boltFast 9, super-beam 12.
 */
describe('presenceFor speed→strength ramp', () => {
  const slow = presenceFor('ion-bolt', 5)
  const fast = presenceFor('ion-bolt', 9)

  it('reads a faster bolt as hotter and larger', () => {
    // A charged bolt must have a brighter core and a slightly bigger silhouette,
    // or the strength read collapses to "same fireball, moving faster".
    expect(fast.coreBoost).toBeGreaterThan(slow.coreBoost)
    expect(fast.spriteScale).toBeGreaterThan(slow.spriteScale)
    // The hot CORE reads as heat: the fast bolt's core burns brighter (higher
    // opacity) and tighter (smaller footprint) than the slow bolt's.
    expect(fast.coreGlowOpacity).toBeGreaterThan(slow.coreGlowOpacity)
    expect(fast.coreGlow).toBeLessThan(slow.coreGlow)
  })

  it('reads a faster bolt as a longer, leaner streak', () => {
    expect(fast.trailSize).toBeGreaterThan(slow.trailSize)
    expect(fast.trailOpacity).toBeGreaterThan(slow.trailOpacity)
  })

  it('keeps the SLOW bolt a heavier, wider grounded ball', () => {
    // The slow "wall" bolt trades heat for footprint: a wider, brighter floor
    // wash. If this inverts, the two buttons stop reading as distinct weights.
    expect(slow.floorScaleX).toBeGreaterThan(fast.floorScaleX)
    expect(slow.floorScaleY).toBeGreaterThan(fast.floorScaleY)
  })

  it('pops a punchier muzzle and bigger impact for the fast bolt', () => {
    expect(fast.spawnFlash).toBeGreaterThan(slow.spawnFlash)
    expect(fast.impactScale).toBeGreaterThan(slow.impactScale)
  })

  it('gives the ion-bolt a spawn muzzle tell and a hot core at all', () => {
    // Both bolts must announce their birth; a 0 here is the old "slides into
    // frame with no tell" look.
    expect(slow.spawnFlash).toBeGreaterThan(0)
    expect(fast.spawnFlash).toBeGreaterThan(0)
    // And both must carry a hot CORE (+ travelling aura). A 0 here is the old
    // "pale tan dot": the bare atlas sprite with no lit centre, which a native
    // on/off isolation caught reading as a soft floor haze with a dark middle.
    expect(slow.coreGlow).toBeGreaterThan(0)
    expect(fast.coreGlow).toBeGreaterThan(0)
    expect(slow.coreGlowOpacity).toBeGreaterThan(0)
    expect(slow.aura).toBeGreaterThan(0)
  })

  it('never dims the stage or hard-flashes the whole screen (super-only budget)', () => {
    // worldDim and screenFlash are the two FULL-SCREEN levers — the real TASK-3
    // blow-out risk. A fireball, thrown ten times a match, must never touch them.
    for (const p of [slow, fast]) {
      expect(p.worldDim).toBe(0)
      expect(p.screenFlash).toBe(0)
    }
  })

  it('keeps the ion-bolt core/aura well under a super, so it lights not washes', () => {
    // The core/aura are LOCAL additive light on the bolt (not a screen wash), but
    // they still feed bloom — so they are bounded FAR below a super's authored
    // budget. If a retune ever cranks a fireball's aura/core toward super levels
    // this fails, catching the "fireballs washing out the fighters" regression
    // that this VFX subsystem has fought across 21 iterations.
    const sup = presenceFor('super-beam')
    for (const p of [slow, fast]) {
      expect(p.aura).toBeLessThan(sup.aura)
      expect(p.auraOpacity).toBeLessThan(sup.auraOpacity)
      expect(p.coreGlow).toBeLessThan(sup.coreGlow)
      expect(p.coreGlowOpacity).toBeLessThanOrEqual(sup.coreGlowOpacity)
      // Hard ceilings independent of the super, so this holds even if the super
      // is ever dialled DOWN: a fireball aura stays a dim local glow.
      expect(p.auraOpacity).toBeLessThan(0.3)
      expect(p.aura).toBeLessThan(1.6)
    }
  })

  it('leaves the super presence untouched by its travel speed', () => {
    // strengthRamp 0 → the authored super numbers must be identical whether or
    // not a speed is supplied. A regression that ramped the super would rescale
    // the single most expensive moment in the match by how fast the beam flies.
    const superNoSpeed = presenceFor('super-beam')
    const superFast = presenceFor('super-beam', 12)
    expect(superFast).toEqual(superNoSpeed)
    expect(superFast.worldDim).toBeCloseTo(0.6)
    expect(superFast.spawnFlash).toBeCloseTo(5.5)
  })

  it('returns the profile verbatim when no speed is supplied', () => {
    // Headless callers (the super-atmosphere dim scan) pass no speed and must get
    // the base ion-bolt profile, not a ramped one.
    const bare = presenceFor('ion-bolt')
    expect(bare.coreBoost).toBeCloseTo(1.35)
    expect(bare.trailSize).toBeCloseTo(1)
  })
})
