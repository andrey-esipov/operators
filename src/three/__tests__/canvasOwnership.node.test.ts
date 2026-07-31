import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  auditEngineModules,
  engineOwningModules,
  rel,
  type ModulePredicate,
} from '../../__tests__/engineModules'

/**
 * EVERY ENGINE-OWNING COMPONENT MUST CREATE ITS OWN <canvas> ELEMENT.
 *
 * The obligation this gate enforces was created by `de764d8`, which added
 * `renderer.forceContextLoss()` to `Engine.dispose()` — the deterministic VRAM
 * free this project needed, and correct. What nobody wrote down is the debt it
 * incurred:
 *
 *   A canvas has at most ONE context per type for its entire lifetime.
 *   `getContext('webgl2')` does not mint a second one; it returns the object it
 *   already made. So after `forceContextLoss()` that element is permanently
 *   poisoned — every future `getContext` hands back the same LOST context.
 *
 * THREE's first act on a new renderer is
 * `gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.HIGH_FLOAT).precision`,
 * which returns null on a lost context. The user-visible result is the whole
 * screen replaced by "FAILED TO START — cannot read properties of null (reading
 * 'precision')". Not a degraded frame; no frame at all.
 *
 * React hands the SAME DOM node back across `<StrictMode>`'s
 * mount → cleanup → remount, so a component that binds its canvas through JSX
 * (`<canvas ref={canvasRef} />`) gives the second Engine a corpse. That was a
 * live P0: three of the four engine routes crashed on every dev mount, while the
 * fourth (`AttractMode`) survived only because a `key={segment}` added for bout
 * rotation happened to mint a fresh element.
 *
 * WHY THIS GATE HAD TO BE STRUCTURAL, NOT A COMMENT. The whole failure lives
 * outside the reach of every other instrument we own:
 *   - `tsc` is happy: a ref to a real canvas is well-typed either way.
 *   - vitest here is node-only with no DOM and no WebGL, so no test can build a
 *     canvas, call `forceContextLoss()`, or simulate a StrictMode remount.
 *   - the suite was 928 green across 105 files while 3 of 4 routes were dead.
 * So the property is asserted where it IS visible — in the source text of the
 * modules that own an engine.
 *
 * THE QUESTION, and its limits. This gate reads source, and a source-text gate
 * asserts existence, never execution (the `40ca750` lesson). It therefore claims
 * exactly one thing: no engine-owning module binds a canvas it did not create.
 * It does NOT claim the element is correctly parented, sized, or removed — those
 * are runtime properties and belong to a browser check. Naming that boundary is
 * the point: a gate that oversells is the next lying harness.
 *
 * The LIST comes from the shared `engineModules` enumerator (so a NEW engine
 * component joins automatically and cannot opt out by being unlisted); the
 * QUESTION below is ours. That is the "one list, two questions" seam.
 */

/** JSX that binds a canvas element to a React ref — the poisoned-reuse shape. */
const JSX_CANVAS_REF = /<canvas\b[^>]*\bref=/s

/** The imperative form that makes reuse impossible: a per-Engine element. */
const CREATES_CANVAS = /document\.createElement\(\s*['"]canvas['"]\s*\)/

const ownsItsCanvas: ModulePredicate = (src) => {
  const reasons: string[] = []
  if (JSX_CANVAS_REF.test(src)) {
    reasons.push(
      'binds a <canvas> through a JSX ref — React reuses that element across a ' +
        'StrictMode remount, and forceContextLoss() has permanently poisoned it',
    )
  }
  if (!CREATES_CANVAS.test(src)) {
    reasons.push(
      "never calls document.createElement('canvas'), so the element it hands the " +
        'Engine is owned by something else and may already be context-dead',
    )
  }
  return reasons
}

describe('every engine-owning component owns its own canvas element', () => {
  const modules = engineOwningModules({ requireEffect: true }).map(rel)

  it('flags no engine-owning module', () => {
    expect(auditEngineModules(ownsItsCanvas, { requireEffect: true })).toEqual([])
  })

  /**
   * VACUITY GUARD. The assertion above passes trivially if the enumerator
   * returns nothing — the exact way this project's gates have gone quietly dead
   * before. Pin the population, and pin it by NAME so shrinking it is a visible,
   * deliberate edit rather than a silent green.
   */
  it('actually examined all four engine routes', () => {
    expect(modules.length).toBeGreaterThanOrEqual(4)
    for (const expected of [
      'play/PlayableMatch.tsx', // `/` and ?play=1 — the buyer's route
      'screens/AttractMode.tsx', // the attract reel on the front door
      'three/dev/FightHarness.tsx', // ?fight=1 — what the capture fleet drives
      'three/FightScene3D.tsx', // ?lab=1
    ]) {
      expect(modules).toContain(expected)
    }
  })

  /**
   * POSITIVE CONTROL. A predicate that never fires is indistinguishable from a
   * compliant codebase. Prove the question can answer "no" by asking it of the
   * exact source shape that crashed, and of the fix that replaced it.
   */
  it('the predicate reds on the shape that actually crashed', () => {
    const broken = `
      const canvasRef = useRef<HTMLCanvasElement | null>(null)
      useEffect(() => { new Engine(canvasRef.current!) }, [])
      return <canvas ref={canvasRef} style={{ width: '100%' }} />
    `
    const reasons = ownsItsCanvas(broken, 'synthetic/Broken.tsx')
    expect(reasons.length).toBe(2)
    expect(reasons.join(' ')).toMatch(/JSX ref/)

    const fixed = `
      const hostRef = useRef<HTMLDivElement | null>(null)
      useEffect(() => {
        const canvas = document.createElement('canvas')
        hostRef.current!.appendChild(canvas)
        new Engine(canvas)
      }, [])
      return <div ref={hostRef} />
    `
    expect(ownsItsCanvas(fixed, 'synthetic/Fixed.tsx')).toEqual([])
  })

  /**
   * A keyed canvas is NOT an acceptable second path, and this test exists to say
   * so before someone re-introduces it as one. `key=` mints a fresh element only
   * when the key's VALUE CHANGES; a StrictMode remount reuses the same key, so
   * the element — and its dead context — comes straight back. It is the weaker
   * mechanism that made AttractMode look safe while the other three crashed.
   */
  it('a keyed JSX canvas is still a violation', () => {
    const keyed = `
      useEffect(() => { new Engine(canvasRef.current!) }, [segment])
      return <canvas key={segment} ref={canvasRef} />
    `
    expect(ownsItsCanvas(keyed, 'synthetic/Keyed.tsx')).not.toEqual([])
  })

  /**
   * The fix is only real if the element also LEAVES with the Engine. A canvas
   * left in the DOM after `dispose()` is a poisoned element sitting where a
   * future reader may reasonably reach for it (`querySelector('canvas')` is how
   * several of our capture tools find the viewport).
   */
  it('each engine module removes its canvas on cleanup', () => {
    const missing = engineOwningModules({ requireEffect: true })
      .filter((f) => !/canvas\.remove\(\)/.test(readFileSync(f, 'utf8')))
      .map(rel)
    expect(missing).toEqual([])
  })
})
