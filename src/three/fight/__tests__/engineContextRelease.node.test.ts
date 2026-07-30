import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine } from '../../core/Engine'

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
 * ── WHY THIS IS A REACHABILITY GATE, NOT A SOURCE-TEXT GATE ───────────────────
 * An earlier version of this gate asserted the mechanism by REGEX over the
 * committed source: `/this\.renderer\.forceContextLoss\(\)/.test(disposeBody)`.
 * A reviewer defeated it. Leaving the call textually present but UNREACHABLE —
 *
 *     for (const s of this.subsystems) s.dispose()
 *     this.subsystems.length = 0            // ← body zeroes the list here
 *     ...
 *     if (this.subsystems.length === 0) return   // ← unconditionally true by now
 *     this.renderer.forceContextLoss()           // ← provably dead code
 *
 * — kept the regex green while the release never ran. That is the source-gate
 * disease this project keeps rediscovering: **a text gate asserts code EXISTS,
 * never that it RUNS.** Same family as an optional `emitEngine?:` that compiles
 * un-wired — presence mistaken for reachability.
 *
 * So the two claims this gate used to conflate are now SPLIT by what each needs:
 *
 *  1. "forceContextLoss() is REACHED when dispose() runs." — Needs NO GPU. We run
 *     the REAL `Engine.prototype.dispose` against a duck-typed stand-in whose
 *     collaborators are spies, and assert the `forceContextLoss` spy actually
 *     fired. An unreachable call (guard / early return / dead branch) fails to
 *     fire the spy → RED. This is what the tests below enforce, deterministically
 *     and CI-safe, on every push. Crucially the stand-in's `subsystems` starts
 *     NON-EMPTY, so the body's `subsystems.length = 0` executes and the reviewer's
 *     `if (this.subsystems.length === 0) return` mutation is exercised on the live
 *     path — the spy does not fire and the gate reddens.
 *  2. "A lost context FREES the VRAM." — Genuinely needs a real driver +
 *     display; `gl.isContextLost()` is the honest signal and it is unavailable
 *     (vacuous skip) or SwiftShader (doesn't model a real driver's VRAM) in
 *     headless CI. That claim stays where it can be measured for real: the
 *     runnable Playwright fresh-canvas A/B that ships alongside as the
 *     reproducible real-GL instrument for anyone with a GPU. This lane does NOT
 *     assert it — asserting VRAM bytes here would be a lying harness.
 *
 * `renderer.info.memory.textures` is deliberately NOT used as a signal anywhere:
 * measured, it holds at N (not 0) after the context was provably lost, because
 * three decrements it only on an explicit `texture.dispose()`, never on
 * `renderer.dispose()` or context loss. It counts un-disposed THREE.Texture JS
 * references, not resident bytes; naming it a residency signal would be the
 * "vramFreed" lie. It is not one.
 *
 * ── WHY THIS CAN'T LIE ────────────────────────────────────────────────────────
 *  - It imports and invokes the REAL Engine.dispose — a renamed / deleted method
 *    throws at call time, so it can't pass vacuously over a missing mechanism. A
 *    cheap source vacuity guard additionally asserts the on-disk body is real and
 *    non-empty.
 *  - Keystone (reachability): the `forceContextLoss` spy fired exactly once when
 *    the real dispose() ran. Kills "present but unreachable".
 *  - Ordering (what three documents): `renderer.dispose()` fired BEFORE
 *    `forceContextLoss()`, asserted by observed invocation order, not text order.
 *    Reintroducing the leak by dropping forceContextLoss fails the keystone;
 *    reordering fails the ordering assertion. No single edit slips the leak back.
 *  - Non-vacuity: the teardown collaborators (`stop`, a subsystem's `dispose`,
 *    `assets.dispose`) all fired, proving the body actually executed rather than
 *    short-circuiting before the keystone.
 *
 * Mutation-proven (transcripts in the delivery report): deleting the
 * `forceContextLoss()` line, and making it unreachable via an early return, BOTH
 * red the keystone; moving it above `renderer.dispose()` reds the ordering test.
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

/**
 * A minimal duck-typed stand-in for an Engine, carrying a spy for every
 * collaborator `dispose()` touches. `subsystems` is deliberately NON-EMPTY so
 * the body's `this.subsystems.length = 0` runs on the live path — that is the
 * line that makes an `if (this.subsystems.length === 0) return` guard placed
 * before the keystone unconditionally dead, so exercising it here is what turns
 * the reviewer's unreachability mutation RED. `scene.traverse` is a no-op spy
 * that ignores its callback, so the real THREE.Mesh disposal branch never runs
 * and no GPU / WebGLRenderer is required.
 */
function fakeEngine() {
  const renderer = { dispose: vi.fn(), forceContextLoss: vi.fn() }
  const subsystem = { name: 'spy-subsystem', dispose: vi.fn() }
  const assets = { dispose: vi.fn() }
  const scene = { traverse: vi.fn() }
  const stop = vi.fn()
  // `dispose()` detaches the `webglcontextlost` listener the constructor
  // installed. A real Engine always has a canvas (it is `readonly` and assigned
  // in the constructor), so the stand-in models one rather than letting the
  // production code go defensively optional to satisfy a test double.
  const canvas = { removeEventListener: vi.fn() }
  const self = {
    stop,
    renderer,
    assets,
    scene,
    canvas,
    subsystems: [subsystem],
    lateUpdates: new Set<(dt: number) => void>(),
    eventListeners: new Set<(e: unknown) => void>(),
  }
  return { self, renderer, subsystem, assets, stop, canvas }
}

/** Run the REAL committed Engine.dispose() against the stand-in as `this`. */
function runDispose(self: ReturnType<typeof fakeEngine>['self']): void {
  ;(Engine.prototype.dispose as (this: unknown) => void).call(self as unknown as Engine)
}

describe('Engine.dispose releases the WebGL context', () => {
  it('REACHES renderer.forceContextLoss() when dispose() actually runs (keystone)', () => {
    // The load-bearing claim, proved by BEHAVIOUR not by text. Measured A/B: with
    // this call reached, gl.isContextLost() flips true synchronously at dispose;
    // without it (deleted OR made unreachable), the context and its VRAM survive
    // for non-deterministic GC — the cross-boundary leak a full-page reload hid.
    const { self, renderer } = fakeEngine()
    runDispose(self)
    expect(
      renderer.forceContextLoss.mock.calls.length,
      'Engine.dispose() must REACH this.renderer.forceContextLoss() when it runs — ' +
        'the only deterministic way this codebase frees a scene\u2019s VRAM before the ' +
        'next loads. A textually-present-but-unreachable call does not fire this spy.',
    ).toBe(1)
  })

  it('frees three\u2019s own resources (renderer.dispose) BEFORE forcing the loss', () => {
    // three's documented ordering: dispose() releases tracked programs / render
    // targets / lists, then forceContextLoss() reclaims the context itself.
    // Asserted by OBSERVED invocation order, so it can't be defeated by text order.
    const { self, renderer } = fakeEngine()
    runDispose(self)
    expect(renderer.dispose, 'Engine.dispose() must call this.renderer.dispose()').toHaveBeenCalledTimes(1)
    expect(renderer.forceContextLoss, 'Engine.dispose() must call this.renderer.forceContextLoss()').toHaveBeenCalledTimes(1)
    const disposeOrder = renderer.dispose.mock.invocationCallOrder[0]
    const forceOrder = renderer.forceContextLoss.mock.invocationCallOrder[0]
    expect(
      disposeOrder < forceOrder,
      'this.renderer.dispose() must run BEFORE this.renderer.forceContextLoss()',
    ).toBe(true)
  })

  it('runs the full teardown body before the keystone (non-vacuity)', () => {
    // If the body short-circuited before the keystone, these collaborators would
    // not all fire. Their firing proves dispose() executed the real teardown path
    // — so the keystone assertion above is about a reachable call, not a stub.
    const { self, subsystem, assets, stop, canvas } = fakeEngine()
    runDispose(self)
    expect(stop, 'dispose() must stop the loop').toHaveBeenCalledTimes(1)
    expect(subsystem.dispose, 'dispose() must dispose each subsystem').toHaveBeenCalledTimes(1)
    expect(assets.dispose, 'dispose() must dispose the asset cache').toHaveBeenCalledTimes(1)
    // A `webglcontextlost` listener that outlives its Engine closes over a
    // disposed renderer and keeps answering for it. Detaching is part of the
    // teardown body, so it belongs in the same non-vacuity proof.
    expect(
      canvas.removeEventListener,
      'dispose() must detach the webglcontextlost listener',
    ).toHaveBeenCalledTimes(1)
    // The body zeroes the subsystem list; this is precisely why a guard reading
    // `this.subsystems.length === 0` placed before the keystone is dead on arrival.
    expect(self.subsystems.length, 'dispose() must clear the subsystem list').toBe(0)
  })

  it('reads a real, non-empty Engine.dispose() body (source vacuity guard)', () => {
    // Cheap secondary guard: the behavioural tests already fail loudly if dispose
    // is renamed/removed (the call throws), but this also asserts the on-disk body
    // is real, so the whole file can't quietly degrade to a no-op.
    const src = existsSync(ENGINE_SRC) ? readFileSync(ENGINE_SRC, 'utf8') : ''
    const body = methodBody(src, 'dispose')
    expect(src.length, `Engine.ts not found at ${ENGINE_SRC}`).toBeGreaterThan(500)
    expect(body.length, 'Engine.dispose() body could not be extracted').toBeGreaterThan(40)
    expect(body).toContain('this.renderer')
  })
})
