import { describe, it, expect } from 'vitest'
import { isScriptedTransient } from '../scriptedTransient'

// Gate for the predicate that decides WHICH frames the quality adaptor excludes
// from its demote decision. The load-bearing property is NARROWNESS: ordinary
// `fight` frames must NOT be flagged, or a genuinely slow machine would stop
// demoting during real gameplay — the exact "suppression that swallows real
// evidence" failure this whole change is careful to avoid. Pure function, so the
// scope is pinned here rather than left to an integration test that can't run in
// node.
describe('isScriptedTransient — the frames excluded from demotion', () => {
  it('flags a super freeze (any frames remaining)', () => {
    expect(isScriptedTransient('fight', 42)).toBe(true)
    expect(isScriptedTransient('fight', 1)).toBe(true)
  })

  it('flags KO / round-end / match-end celebration beats', () => {
    expect(isScriptedTransient('ko', 0)).toBe(true)
    expect(isScriptedTransient('round-end', undefined)).toBe(true)
    expect(isScriptedTransient('match-end', 0)).toBe(true)
  })

  it('does NOT flag ordinary fight frames — a slow machine must still demote in neutral', () => {
    // THE load-bearing case. If this ever returns true, real gameplay stops
    // demoting and the adaptor goes blind on exactly the hardware it exists for.
    expect(isScriptedTransient('fight', 0)).toBe(false)
    expect(isScriptedTransient('fight', undefined)).toBe(false)
  })

  it('does NOT flag the intro (a pre-fight beat, deliberately out of scope)', () => {
    expect(isScriptedTransient('intro', 0)).toBe(false)
  })
})
