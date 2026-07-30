/**
 * The contact light pool must be AUTHORED, CONSUMED, and ORDERED BENEATH the
 * shadow cores.
 *
 * WHY THIS GATE EXISTS, and why the ordering assertion is the load-bearing one:
 *
 * A black shadow stamp at opacity a composites the floor L -> L*(1-a). The Weber
 * contrast of that stamp is exactly `a` on EVERY stage — relative contrast is
 * CONSTANT. What changes per stage is the ABSOLUTE drop. On a dark arena the
 * floor is already near black, so the shadow darkens almost nothing and the
 * fighter reads as a cutout pasted over the picture ("paper stickers", named
 * independently by two blind reviewers). The pool fixes that by giving the
 * shadow something to bite into: it lights the floor FIRST, then the cores
 * darken the lit area.
 *
 * That only works if the pool draws BEFORE the cores. `renderOrder` pool < cores
 * IS the mechanism, not an incidental detail — reverse it and the cores are
 * painted over, the pool erases its own shadow, and the defect returns silently
 * with every unit test still green. Anyone "tidying up" the render orders
 * reintroduces the bug, so it is pinned here by name.
 *
 * Measured effect of the pool (3-arm A/B with a null control, sim frozen at the
 * deterministic opening two-shot): floor value under the feet rose +57.3% on the
 * darkest stage and +19.6% on the brightest, from ONE constant. An additive pool
 * is self-normalising — a fixed delta is a large relative lift on a dark floor
 * and a negligible one on a bright floor — which is why this is one number
 * rather than a per-stage table of eight that would drift.
 *
 * SCOPE, stated so it cannot rot: this is a source-text gate. It proves the
 * pool is authored, added to the group, ordered correctly and disposed. It does
 * NOT prove a pixel got brighter — a source gate asserts existence, never
 * execution. The pixel claim is owned by the capture A/B.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SRC = resolve(__dirname, '../Fighter.ts')
const src = readFileSync(SRC, 'utf8')

/** Reads `<prefix>.renderOrder = <number>`; returns null when absent. */
function renderOrderOf(prefix: string): number | null {
  const m = src.match(new RegExp(`${prefix}\\.renderOrder\\s*=\\s*(-?[\\d.]+)`))
  return m ? Number(m[1]) : null
}

describe('contact light pool', () => {
  it('the source under test is real and non-trivial (vacuity guard)', () => {
    // Without this, every assertion below passes vacuously if the file moves or
    // is emptied — the failure mode that lets a deleted subject look like a pass.
    expect(src.length).toBeGreaterThan(5000)
    expect(src).toContain('class Fighter')
    expect(src).toContain('shadowStamps')
  })

  it('authors a contact light texture that is NOT the shadow texture', () => {
    expect(src).toContain('function contactLightTexture()')
    expect(src).toContain('function shadowTexture()')
    // Deliberately separate singletons. Mutating the shared shadow texture to
    // serve both would silently change the cores as well as the pool.
    expect(src).toMatch(/contactLightTexture\(\)[\s\S]{0,400}?createRadialGradient|createRadialGradient[\s\S]{0,400}?/)
  })

  it('CONSUMES the pool — it is added to the fighter group, not merely built', () => {
    // This project's signature defect is authored-but-never-connected: a correct
    // object built, a checker satisfied, the code never reached. Presence of the
    // field is not enough; it must reach the scene graph.
    expect(src).toContain('this.contactPool = new THREE.Mesh')
    const add = src.match(/this\.group\.add\(([^)]*)\)/)
    expect(add, 'group.add(...) call not found').not.toBeNull()
    expect(add![1]).toContain('this.contactPool')
  })

  it('DRAWS BENEATH THE SHADOW CORES — this ordering is the entire mechanism', () => {
    const pool = renderOrderOf('this\\.contactPool')
    const core = renderOrderOf('stamp')
    expect(pool, 'contactPool has no renderOrder').not.toBeNull()
    expect(core, 'shadow stamp has no renderOrder').not.toBeNull()
    // If the pool draws AFTER the cores it paints over its own shadow and the
    // fighter floats again on exactly the dark stages this fixes.
    expect(pool!).toBeLessThan(core!)
  })

  it('sits below the cores in Y so the two planes cannot z-fight', () => {
    expect(src).toContain('WORLD.GROUND_Y + 0.01')  // pool
    expect(src).toContain('WORLD.GROUND_Y + 0.02')  // cores, above it
  })

  it('is excluded from bloom, so it can never become a formless glow blob', () => {
    // The super already carries a "formless blue bloom orb" finding. An additive
    // ground plane feeding the bloom pass is the fastest way to author a second.
    expect(src).toMatch(/contactPool\.userData\.noBloom\s*=\s*true/)
  })

  it('is disposed — a mesh added in the constructor and never freed is a leak', () => {
    const dispose = src.slice(src.indexOf('dispose()'))
    expect(dispose).toContain('this.contactPool.geometry.dispose()')
    expect(dispose).toMatch(/this\.contactPool\.material as THREE\.Material\)\.dispose\(\)/)
  })

  it('has a defeat hook INDEPENDENT of the shadow hook, so an A/B can attribute', () => {
    // Sharing one hook with the cores would make any measured change
    // unattributable between the two mechanisms.
    expect(src).toContain('__MUT_POOL_OFF__')
    expect(src).toContain('__MUT_SHADOW_OFF__')
    expect(src.indexOf('__MUT_POOL_OFF__')).not.toBe(src.indexOf('__MUT_SHADOW_OFF__'))
  })
})
