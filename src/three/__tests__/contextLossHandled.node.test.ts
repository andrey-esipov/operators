import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * A LOST WEBGL CONTEXT MUST BE REPORTED, NOT SWALLOWED.
 *
 * Chrome caps the number of live WebGL contexts per document at roughly 16 and
 * evicts the OLDEST one silently when you cross the line — no exception, no
 * console message, no event unless you asked for one. The canvas simply stops
 * updating. A player sees a black rectangle where the game was and has no way
 * to tell that from a crash, and neither do we: this project shipped with ZERO
 * `webglcontextlost` listeners tree-wide, so every such loss was invisible.
 *
 * That is not hypothetical here. `Engine.dispose()` ends in
 * `forceContextLoss()`, and the four engine-owning routes mount and dispose
 * across bout rotations and screen transitions, so contexts are created and
 * destroyed continuously within one long-lived document.
 *
 * THE THREE PROPERTIES THIS GATE PINS, and why each is load-bearing:
 *
 *   1. `preventDefault()` on the event. This is not decoration — per spec it is
 *      the ONLY thing that makes a later `webglcontextrestored` possible at all.
 *      Drop it and recovery is permanently off the table for this canvas.
 *
 *   2. The listener is added and removed through ONE bound reference. An inline
 *      arrow at either site makes `removeEventListener` a silent no-op, and a
 *      listener that outlives its Engine fires for the NEXT Engine mounted on a
 *      reused element — closing over a disposed renderer.
 *
 *   3. `_disposing` is set BEFORE `forceContextLoss()`. We lose our own context
 *      deliberately on every dispose. Without the guard, every normal teardown
 *      would report itself to the route as a GPU failure, and the honest error
 *      state added here would fire on the happy path — turning a fix into a
 *      worse bug than the one it replaced.
 *
 * WHAT THIS GATE DOES NOT PROVE, stated so nobody reads more into a green run
 * than it earns: it asserts these calls EXIST in the source, never that the
 * browser dispatches the event or that the route repaints. vitest here is
 * node-only — no DOM, no WebGL, no way to construct an Engine at all. The
 * executable half was verified separately by losing a real context in a real
 * GPU browser via `WEBGL_lose_context` and observing the route's error state.
 * A source-text gate is a denylist of the tricks you already imagined; it is
 * the floor, not the ceiling.
 */

const ENGINE = 'src/three/core/Engine.ts'

function read(p: string): string {
  const src = readFileSync(resolve(process.cwd(), p), 'utf8')
  // Guard against asserting on an empty/moved file, which would let every
  // "must contain" check below fail loudly but every "ordering" check pass
  // vacuously on a missing file.
  expect(src.length, `${p} is empty or unreadable`).toBeGreaterThan(1000)
  return src
}

describe('a lost WebGL context is reported to the route', () => {
  it('Engine registers a webglcontextlost listener', () => {
    const src = read(ENGINE)
    expect(
      /addEventListener\(\s*'webglcontextlost'/.test(src),
      'Engine never listens for webglcontextlost — a GPU eviction would be silent',
    ).toBe(true)
  })

  it('the handler calls preventDefault, without which restore is impossible', () => {
    const src = read(ENGINE)
    const handler = src.match(/onCanvasContextLost\s*=\s*\(([\s\S]*?)\n  \}/)
    expect(handler, 'onCanvasContextLost handler not found').not.toBeNull()
    expect(
      /preventDefault\(\)/.test(handler![0]),
      'handler does not preventDefault — the browser will never offer the context back',
    ).toBe(true)
  })

  it('the handler is a bound field, so removeEventListener can detach it', () => {
    const src = read(ENGINE)
    // Both sites must name the SAME field. An inline arrow at either end makes
    // removal a no-op that no type checker and no runtime error will report.
    expect(
      /addEventListener\(\s*'webglcontextlost'\s*,\s*this\.onCanvasContextLost\s*\)/.test(src),
      'listener is not registered via the bound this.onCanvasContextLost field',
    ).toBe(true)
    expect(
      /removeEventListener\(\s*'webglcontextlost'\s*,\s*this\.onCanvasContextLost\s*\)/.test(src),
      'listener is never detached via the same bound reference',
    ).toBe(true)
  })

  it('our own dispose() cannot report itself as a GPU failure', () => {
    const src = read(ENGINE)

    // The guard must be READ by the handler...
    const handler = src.match(/onCanvasContextLost\s*=\s*\(([\s\S]*?)\n  \}/)
    expect(
      /_disposing/.test(handler![0]),
      'handler does not check _disposing — every normal teardown would report a GPU failure',
    ).toBe(true)

    // ...and SET before we deliberately drop the context ourselves. Ordering is
    // the whole assertion: setting it after forceContextLoss() is the same as
    // not setting it.
    const setAt = src.indexOf('this._disposing = true')
    const lossAt = src.indexOf('this.renderer.forceContextLoss()')
    expect(setAt, '_disposing is never set to true').toBeGreaterThan(-1)
    expect(lossAt, 'dispose() no longer calls forceContextLoss()').toBeGreaterThan(-1)
    expect(
      setAt,
      '_disposing must be set BEFORE forceContextLoss(), or the guard is dead code',
    ).toBeLessThan(lossAt)

    const detachAt = src.indexOf("removeEventListener('webglcontextlost'")
    expect(
      detachAt,
      'the listener must be detached BEFORE forceContextLoss()',
    ).toBeLessThan(lossAt)
  })

  it('the buyer-facing route consumes the callback', () => {
    // A hook nothing subscribes to is this project's signature defect: authored,
    // correct, never consumed. `?play=1` / bare `/` is the route a buyer lands
    // on, so it is the one that must not go silently black.
    const src = read('src/play/PlayableMatch.tsx')
    expect(
      /onContextLost\s*=/.test(src),
      'PlayableMatch never sets onContextLost — the hook exists but nothing reads it',
    ).toBe(true)
  })
})
