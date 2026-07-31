import { describe, expect, it } from 'vitest'
import { ROSTER, STAGES } from '../select/roster'

/**
 * The select screen is the first thing a player touches, so anything rendered
 * there is a shipping claim about how finished the game is.
 *
 * This exists because `THE MODEL FLOOR` shipped carrying `note: 'UNTESTED'` —
 * a QA marker meant to tell the capture tooling to assert that arena renders,
 * which instead rendered as a badge in the player-facing picker. A visual
 * critic found it, not a test. The dev intent was legitimate; riding it on a
 * player-facing field was not, so the flag now lives on `unverified` and this
 * guards the seam between the two.
 */
const DEV_MARKERS = [
  'UNTESTED', 'TEST', 'TODO', 'FIXME', 'WIP', 'TBD', 'PLACEHOLDER',
  'DEBUG', 'XXX', 'HACK', 'TEMP', 'DRAFT', 'BROKEN', 'UNUSED',
]

describe('no dev marker reaches the player-facing select screen', () => {
  for (const s of STAGES) {
    it(`stage ${s.id} shows no dev marker`, () => {
      const shown = [s.name, s.note ?? ''].join(' ').toUpperCase()
      for (const m of DEV_MARKERS) {
        expect(shown.includes(m), `stage ${s.id} displays dev marker "${m}"`).toBe(false)
      }
    })
  }

  for (const r of ROSTER) {
    it(`fighter ${r.skin} shows no dev marker`, () => {
      const shown = [r.name, r.shortName].join(' ').toUpperCase()
      for (const m of DEV_MARKERS) {
        expect(shown.includes(m), `fighter ${r.skin} displays dev marker "${m}"`).toBe(false)
      }
    })
  }

  it('keeps the QA signal, just off the player-facing field', () => {
    // The point was never to delete the flag — the capture tool still needs to
    // know which arena is unproven. Losing it would trade a cosmetic bug for a
    // coverage hole, so assert it survived the move.
    expect(STAGES.some((s) => s.unverified)).toBe(true)
  })
})
