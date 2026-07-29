import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * WebGL context-release keystone gate — the teardown half of the VRAM story that
 * {@link ./atlasVramBudget.node.test.ts} tells the residency half of. The budget
 * gate proves a match FITS in 512 MB; this gate proves the previous scene's VRAM
 * is actually GIVEN BACK before the next one loads. Both must hold for the
 * client-side boot transitions (title → attract → select → fight) to stay inside
 * the atlas VRAM budget without throwing the whole document away on every screen.
 *
 * ── WHAT MAKES RELEASE DETERMINISTIC ─────────────────────────────────────────
 * `Engine.dispose()` must call `renderer.forceContextLoss()`. Measured, headed,
 * on Apple M1 Metal (ANGLE) and again on headless SwiftShader, driving the REAL
 * renderer via a fresh-canvas A/B:
 *
 *   dispose() + forceContextLoss()  →  gl.isContextLost() === true   (synchronous)
 *   dispose() alone                 →  gl.isContextLost() === false  (context lives)
 *
 * A lost context has ALL its GPU resources reclaimed by the driver by spec, so
 * `isContextLost()===true` at the moment dispose() returns IS the deterministic
 * free. `renderer.dispose()` on its own frees three's tracked programs / render
 * targets / lists but LEAVES the context (and every texture + buffer uploaded
 * into it) for non-deterministic browser GC — i.e. exactly the leak that made a
 * full-page reload the only way this codebase could bound VRAM across a screen
 * boundary. Delete the `forceContextLoss()` line and that leak returns.
 *
 * ── WHY THIS IS A SOURCE GATE, NOT A LIVE-GL GATE ────────────────────────────
 * The honest live signal is `gl.isContextLost()`, which needs a real GPU + a
 * display. In headless CI it is either unavailable (→ the test skips and passes
 * vacuously — this project's single most common failure mode) or runs on
 * SwiftShader, whose teardown does not model a real driver's VRAM. A live-GL
 * assertion in the shared vitest lane would therefore be flaky or vacuous: a
 * lying harness. So this gate asserts the MECHANISM in the committed source,
 * where it is deterministic and CI-safe, and reddens the instant someone removes
 * the call the A/B proves is load-bearing. The runnable Playwright A/B ships
 * alongside as the reproducible real-GL instrument for anyone with a GPU.
 *
 * `renderer.info.memory.textures` is deliberately NOT used as the signal here: I
 * measured it holding at N (not 0) after the context was provably lost, because
 * three decrements that counter only on an explicit `texture.dispose()`, never on
 * `renderer.dispose()` or context loss. It counts un-disposed THREE.Texture JS
 * references, not resident bytes — a gate asserting it returns to baseline would
 * read RED while VRAM was actually freed. Naming it a residency signal would be
 * the "vramFreed" lie; it is not one.
 *
 * ── WHY THIS CAN'T LIE (two independent ties + vacuity guards) ────────────────
 *  - The dispose() body is extracted by brace-matching the REAL Engine.ts on
 *    disk and asserted non-empty, so a renamed / emptied method can't pass the
 *    checks vacuously.
 *  - Tie 1 (the keystone): the body forces context loss on the renderer.
 *  - Tie 2 (the ordering three documents): the body also calls the renderer's own
 *    dispose(), BEFORE forcing the loss. Reintroducing the leak by dropping
 *    forceContextLoss reddens Tie 1; reordering or dropping the standard dispose
 *    reddens Tie 2. No single edit slips the leak back in silently.
 *
 * Mutation-proven: deleting the `this.renderer.forceContextLoss()` line from
 * Engine.dispose() fails "forces WebGL context loss (deterministic VRAM release)";
 * moving it above `this.renderer.dispose()` fails "frees three's own resources
 * before forcing the loss".
 *
 * ── CONSTRAINT THIS GATE DOCUMENTS FOR THE TRANSITION WORK ────────────────────
 * forceContextLoss() PERMANENTLY poisons the canvas it runs on: measured, a new
 * WebGLRenderer built on that same <canvas> throws `Cannot read properties of
 * null (reading 'precision')`; a fresh <canvas> works. So every client-side
 * transition MUST mount the next scene on a NEW (keyed) canvas — never reuse the
 * outgoing one. The attract reel already keys its canvas; the `?fight=1` dev
 * harness does not, which is why it dies under React StrictMode's double-mount.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const ENGINE_SRC = resolve(HERE, '../../core/Engine.ts')

/** Extract a method body by brace-matching from its declaration in real source. */
function methodBody(src: string, method: string): string {
  const decl = new RegExp(`\\n\\s*${method}\\s*\\([^)]*\\)\\s*\\{`).exec(src)
  if (!decl) return ''
  let i = src.indexOf('{', decl.index)
  const start = i + 1
  let depth = 1
  for (i = start; i < src.length && depth > 0; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') depth--
  }
  return depth === 0 ? src.slice(start, i - 1) : ''
}

describe('Engine.dispose releases the WebGL context', () => {
  const src = existsSync(ENGINE_SRC) ? readFileSync(ENGINE_SRC, 'utf8') : ''
  const body = methodBody(src, 'dispose')

  it('reads a real, non-empty Engine.dispose() to gate', () => {
    // Vacuity guard: if the file moved or the method was renamed/emptied, the
    // mechanism checks below would pass over nothing. Fail loudly instead.
    expect(src.length, `Engine.ts not found at ${ENGINE_SRC}`).toBeGreaterThan(500)
    expect(body.length, 'Engine.dispose() body could not be extracted').toBeGreaterThan(40)
    expect(body).toContain('this.renderer')
  })

  it('forces WebGL context loss (deterministic VRAM release keystone)', () => {
    // The load-bearing call. Measured A/B: with it, gl.isContextLost() flips true
    // synchronously at dispose; without it, the context (and its VRAM) survives
    // for non-deterministic GC. Removing this line reintroduces the cross-boundary
    // leak that a full-page reload used to hide.
    expect(
      /this\.renderer\.forceContextLoss\s*\(\s*\)/.test(body),
      'Engine.dispose() must call this.renderer.forceContextLoss() — the only ' +
        'deterministic way this codebase frees a scene\u2019s VRAM before the next loads',
    ).toBe(true)
  })

  it('frees three\u2019s own resources before forcing the loss', () => {
    // three's documented ordering: dispose() releases tracked programs / render
    // targets / lists, then forceContextLoss() reclaims the context itself.
    const disposeAt = body.search(/this\.renderer\.dispose\s*\(\s*\)/)
    const forceAt = body.search(/this\.renderer\.forceContextLoss\s*\(\s*\)/)
    expect(disposeAt, 'Engine.dispose() must call this.renderer.dispose()').toBeGreaterThanOrEqual(0)
    expect(forceAt, 'Engine.dispose() must call this.renderer.forceContextLoss()').toBeGreaterThanOrEqual(0)
    expect(
      disposeAt < forceAt,
      'this.renderer.dispose() must run BEFORE this.renderer.forceContextLoss()',
    ).toBe(true)
  })
})
