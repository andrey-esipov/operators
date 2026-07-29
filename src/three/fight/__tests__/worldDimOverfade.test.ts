import { describe, it, expect } from 'vitest'
import { presenceFor, PRESENCE_KINDS, SUPER_WORLD_DIM } from '../ProjectileFx'

/**
 * GATE — a super's world-dim spotlight must not over-fade the world it exists to
 * pop the super AGAINST.
 *
 * THE MECHANISM (measured, not assumed). During a super the renderer draws a
 * full-frustum quad (normal-blended, renderOrder 8 — UNDER the fighters at 10) so
 * it darkens ONLY the background: a pure spotlight that makes the blue beam read.
 * Its opacity eases toward the strongest live `presence.worldDim`, and the freeze
 * pins it to `SUPER.DIM_PEAK` for the held 60 frames. At the shipped depth of 0.6
 * that spotlight was too deep: measured on the `/` route at the true impact-frame
 * set (1920×1080, warden Ion Storm), the held freeze dropped background luma −31%
 * (79→55) AND — the failure the critic's eye named ("a formless blue bloom orb
 * over a DESATURATED world-dim ... reads faded, not powerful") — saturation −26%
 * (0.27→0.206). A spotlight that grey-washes the stage reads FADED, because the
 * super has nothing coloured left to pop against. Dropping to 0.45 recovers the
 * freeze to luma −21% (→63) and saturation −15% (→0.23): still a clear cinematic
 * dim, no longer a grey crush. The super never clips either way (blown flat 0.39%,
 * = at-rest) so this is pure "faded", not "too hot" — the opposite of the earlier
 * beam-clip defect. Anchor is SF6: legible and ALIVE the whole way through.
 *
 * WHY A CEILING AT 0.5. The measurement brackets it: 0.6 crushes saturation −26%
 * (the shipped defect), 0.45 holds it at −15% (alive). 0.5 sits between — it
 * REJECTS the shipped over-fade and ACCEPTS the fix, so it is the boundary between
 * "cinematic dim" and "grey wash", not a value picked to flatter the new number.
 *
 * WHY GENERAL, NOT super-beam-ONLY. A gate that named `super-beam` would bless the
 * ONE event that dims the world today and leave the next world-dimming event
 * (another character's super, an install-time screen effect) unguarded — the
 * exact "assert one member of a set, N others go unchecked" bug this project has
 * shipped four times. So it iterates the WHOLE presence set and holds the ceiling
 * on every kind that dims at all.
 */

const WORLD_DIM_CEIL = 0.5

describe('world-dim spotlight does not over-fade the world', () => {
  it('holds the over-fade ceiling on EVERY world-dimming presence (general, not super-only)', () => {
    const dimming = PRESENCE_KINDS.map((k) => [k, presenceFor(k)] as const).filter(
      ([, p]) => p.worldDim > 0,
    )
    // The set is non-empty (super-beam dims) — otherwise this vacuously passes and
    // silently stops guarding the moment the only dimming kind is renamed.
    expect(dimming.length).toBeGreaterThan(0)
    for (const [kind, p] of dimming) {
      expect(
        p.worldDim,
        `${kind} world-dim ${p.worldDim} exceeds the over-fade ceiling ${WORLD_DIM_CEIL} — the spotlight grey-washes the world it should pop the super against (reads "faded")`,
      ).toBeLessThanOrEqual(WORLD_DIM_CEIL)
    }
  })

  it('the super beam reads the SHARED dim constant, so the freeze→beam hand-off cannot drift', () => {
    // SUPER.DIM_PEAK (the freeze dim, in ProjectileLayer) and this presence's
    // worldDim (the travelling-beam dim) are the SAME exported constant, so a step
    // at the hand-off is unrepresentable by construction rather than test-enforced.
    // This asserts the presence actually reads it (not a hand-copied duplicate).
    expect(presenceFor('super-beam').worldDim).toBe(SUPER_WORLD_DIM)
    // And the shared constant itself honours the ceiling.
    expect(SUPER_WORLD_DIM).toBeLessThanOrEqual(WORLD_DIM_CEIL)
    // A real dim still exists — a super with no world-dim would be the opposite
    // failure (no spotlight, the beam competes with a fully-lit stage).
    expect(SUPER_WORLD_DIM).toBeGreaterThan(0.2)
  })
})
