import { describe, expect, it, vi } from 'vitest'
import { Engine } from '../Engine'

/**
 * ENGINE → ADAPTOR FORWARDING GATE — the integration hop the two unit gates cannot see.
 *
 * The mid-super-demote fix spans three mechanisms, each unit-gated on its own:
 *   1. WHICH frames are transient        → scriptedTransient.node.test.ts (the predicate)
 *   2. WHAT the controller does with it  → qualityAdaptor.node.test.ts (the four-way A/B/M1/M2)
 *   3. THIS: that Engine.runAdapt actually READS this.state.scriptedTransient and
 *      forwards it, as a strict boolean, into adaptor.sample()'s 4th argument.
 *
 * Hop 3 is where a silent regression hides: a mutation to the forwarding line
 * (drop the read, flip the `=== true` to `!= null`, hardcode false) leaves BOTH
 * unit suites fully green while the feature is dead in the shipped Engine — the
 * exact "validated a member, not the wiring" failure this project keeps catching.
 * So it gets its own behavioural gate.
 *
 * Technique (mirrors engineContextRelease.node.test.ts): invoke the REAL committed
 * Engine.prototype.runAdapt against a hand-built stand-in `this` that carries only
 * the fields the method touches. adaptor.sample is a spy, so we read back exactly
 * what the Engine passed. No WebGLRenderer, no canvas, no GPU.
 *
 * The `=== true` coercion is load-bearing and separately asserted: an ABSENT
 * scriptedTransient (the default for every non-super frame, and the initial
 * render-state) must forward FALSE, never a truthy-undefined that would silently
 * exempt ordinary gameplay from adaptation.
 */

type RunAdapt = (this: unknown, now: number, wallDtMs: number) => void
const runAdapt = (Engine.prototype as unknown as { runAdapt: RunAdapt }).runAdapt

function fakeEngine(state: unknown) {
  const sample = vi.fn(() => ({ kind: 'none' as const }))
  const setQuality = vi.fn()
  const self = {
    adaptEnabled: true,
    state,
    _quality: 'ultra' as const,
    adaptor: { sample },
    setQuality,
  }
  return { self, sample, setQuality }
}

/** The isTransient boolean the Engine handed to adaptor.sample() this frame. */
function forwardedFlag(state: unknown): unknown {
  const { self, sample } = fakeEngine(state)
  runAdapt.call(self, 1000, 16.7)
  expect(sample, 'Engine.runAdapt must reach adaptor.sample() every adaptive frame').toHaveBeenCalledTimes(1)
  const call = sample.mock.calls[0] as unknown as [number, number, string, unknown]
  return call[3]
}

describe('Engine.runAdapt forwards the scripted-transient flag to the adaptor', () => {
  it('forwards TRUE when the render state marks the frame scripted-transient', () => {
    expect(forwardedFlag({ scriptedTransient: true })).toBe(true)
  })

  it('forwards FALSE when the render state explicitly clears the flag', () => {
    expect(forwardedFlag({ scriptedTransient: false })).toBe(false)
  })

  it('forwards strict FALSE when the flag is ABSENT — an undefined field must not exempt ordinary play', () => {
    // The `this.state?.scriptedTransient === true` coercion. A mutation to
    // `!= null` or `!== false` would turn this truthy-undefined into a silent
    // blanket exemption; this is the assertion that reds it.
    const forwarded = forwardedFlag({})
    expect(forwarded, 'an absent flag must forward the boolean false, not undefined').toBe(false)
    expect(typeof forwarded, 'the 4th argument must be a strict boolean').toBe('boolean')
  })

  it('forwards strict FALSE when there is no render state yet (optional-chaining guard)', () => {
    expect(forwardedFlag(undefined)).toBe(false)
  })

  it('does not sample at all while adaptation is disabled (the early-return guard)', () => {
    const { self, sample } = fakeEngine({ scriptedTransient: true })
    self.adaptEnabled = false
    runAdapt.call(self, 1000, 16.7)
    expect(sample, 'a pinned/disabled adaptor must never sample').not.toHaveBeenCalled()
  })
})
