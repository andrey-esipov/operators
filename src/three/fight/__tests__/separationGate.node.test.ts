import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSpriteUniforms } from '../SpriteFighterMaterial'
import { KEYLINE_INTENSITY, KEYLINE_WIDTH_FRAC } from '../Fighter'
import { STAGE_ORDER } from '../../stage/StageRegistry'

/**
 * CI-level guard for the fighter/background SEPARATION guarantee.
 *
 * The GPU gate (`tools/measure-separation.mjs`) is the real instrument — it
 * screenshots every stage × several fighters and asserts a CLEAR read on each:
 * achieved by EITHER the keyline (rim brightness + width floors) OR raw luminance
 * (a body-vs-local-bg |contrast| floor), failing only when NEITHER carries it. But
 * it needs a browser + a built bundle, so it cannot run in a headless unit suite.
 * This test is its cheap, deterministic complement: it proves — without a GPU —
 * that the two separation mechanisms are still AUTHORED **and** CONSUMED on the
 * shipped render path, that the gate still covers EVERY stage, and that its assert
 * is the two-path OUTCOME (not a single mechanism that can false-fail a good read).
 *
 * Both are direct answers to two documented failure shapes on this project:
 *
 *  1. "Authored but never consumed" (atlases never loaded, a DOF pass living
 *     only in comments, a 2,033-line audio engine never called). A keyline
 *     uniform that exists but is never added to the fragment output, or a
 *     `sepBehind` setter nobody calls, would sail through typecheck and ship a
 *     no-op. So every assertion below ties the term to its CONSUMPTION: the
 *     shader body must add the keyline to `color`; the pipeline must call
 *     `setSepBehind`; the renderer must feed `viewportH`.
 *
 *  2. "Validating one member of a set while N others go unchecked" (a guard that
 *     imported only `lenny` while 8 of 11 fighters were silently broken). The
 *     gate's stage list is therefore cross-checked against the canonical
 *     {@link STAGE_ORDER}: add a 9th stage and forget the gate, and this reddens.
 *
 * WHY THIS CAN'T LIE: it asserts on the STRUCTURE (uniform declared → consumed →
 * wired), not on the tuning magnitudes, so it stays green across re-tuning but
 * reddens the instant a term is deleted, disconnected, or the gate is narrowed.
 * Mutation-proven by hand: deleting the `color += uKeylineColor ...` line fails
 * "keyline is consumed"; removing the `setSepBehind` call fails "behind term is
 * wired"; dropping a stage from the gate default fails "gate covers every stage".
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const src = (rel: string) => readFileSync(resolve(HERE, rel), 'utf8')

const SPRITE = src('../SpriteFighterMaterial.ts')
const FIGHTER = src('../Fighter.ts')
const RENDERER = src('../FightRenderer.ts')
const GRADE = src('../../post/MasterGradeEffect.ts')
const PIPELINE = src('../../post/PostPipeline.ts')
const GATE = src('../../../../tools/measure-separation.mjs')

/** Index of the first occurrence, asserting presence. */
function at(hay: string, needle: string): number {
  const i = hay.indexOf(needle)
  expect(i, `expected to find: ${needle}`).toBeGreaterThanOrEqual(0)
  return i
}

describe('separation: silhouette keyline (fighter shader)', () => {
  it('authors the three keyline uniforms with sane, live defaults', () => {
    const u = createSpriteUniforms()
    expect(u.uKeylineColor.value).toBeDefined()
    // A bright cool white: blue channel is the strongest so the edge reads cool.
    const c = u.uKeylineColor.value
    expect(c.b).toBeGreaterThan(c.r)
    expect(c.b).toBeGreaterThan(0.7)
    expect(u.uKeylineIntensity.value).toBeGreaterThan(0)
    expect(u.uKeylineWidthPx.value).toBeGreaterThan(0)
  })

  it('declares AND consumes the keyline in the fragment shader (not a dead uniform)', () => {
    // declared
    at(SPRITE, 'uniform vec3 uKeylineColor;')
    at(SPRITE, 'uniform float uKeylineIntensity;')
    at(SPRITE, 'uniform float uKeylineWidthPx;')
    // marches OUTWARD along the alpha gradient to the silhouette, gated inside it
    at(SPRITE, 'base.a >= 0.5')
    at(SPRITE, 'texture2D(uAlbedo, vUv + stepUv * fk).a < 0.5')
    // and is actually ADDED to the emitted colour — the consumption that matters
    at(SPRITE, 'color += uKeylineColor * (uKeylineIntensity * keyline)')
  })

  it('adds the keyline BEFORE the highlight knee so the bright edge is tamed, not clipped', () => {
    const add = at(SPRITE, 'color += uKeylineColor * (uKeylineIntensity * keyline)')
    const knee = at(SPRITE, 'vec3 over = max(color - 0.82, 0.0)')
    expect(add).toBeLessThan(knee)
  })

  it('wires the keyline into the per-frame fighter update, resolution-scaled', () => {
    expect(KEYLINE_INTENSITY).toBeGreaterThan(0)
    expect(KEYLINE_WIDTH_FRAC).toBeGreaterThan(0)
    // width tracks the drawing-buffer height (constant screen fraction / DPR)
    at(FIGHTER, 'ctx.viewportH')
    at(FIGHTER, 'this.uniforms.uKeylineWidthPx.value = Math.max(2, KEYLINE_WIDTH_FRAC * vpH)')
    at(FIGHTER, 'this.uniforms.uKeylineIntensity.value = keylineOff ? 0 : KEYLINE_INTENSITY')
    // DEV mutation hook the separation gate flips to prove the rim gain is real
    at(FIGHTER, '__MUT_KEYLINE_OFF__')
  })

  it('feeds viewportH from the SHIPPED render loop (FightRenderer), not just the harness', () => {
    at(RENDERER, 'viewportH: this.ctx.renderer.domElement.height')
  })
})

describe('separation: behind-fighter local suppression (master grade)', () => {
  it('declares AND consumes the sepBehind uniform in the fragment shader', () => {
    at(GRADE, 'uniform float sepBehind;')
    // registered with a SAFE default of 0 — the pipeline turns it on live, so an
    // unwired build stays a no-op instead of stamping a halo.
    at(GRADE, "['sepBehind', new THREE.Uniform(0.0)]")
    // consumed: darkens only inside the character ellipse AND behind the plane
    at(GRADE, 'if (sepBehind > 0.001)')
    at(GRADE, 'smoothstep(bgFloorStart, bgFloorEnd, dist)')
    at(GRADE, 'charMask(uv) * behindFar * sepBehind')
    at(GRADE, 'c *= 1.0 - clamp(behind')
  })

  it('exposes a setSepBehind setter that writes the uniform', () => {
    at(GRADE, 'setSepBehind(strength: number)')
    at(GRADE, "this.u('sepBehind').value = strength")
  })

  it('wires setSepBehind from the pipeline with a positive live strength', () => {
    // a real positive strength (value not hardcoded here so re-tuning stays green)
    const m = PIPELINE.match(/const SEP_BEHIND_STRENGTH = ([0-9.]+)/)
    expect(m, 'SEP_BEHIND_STRENGTH must be declared').not.toBeNull()
    expect(Number(m![1])).toBeGreaterThan(0)
    at(PIPELINE, 'this.grade.setSepBehind(sepEnabled ? SEP_BEHIND_STRENGTH : 0)')
  })

  it('honours the ?nosep QA flag and the DEV mutation hook so the gate can defeat it', () => {
    at(PIPELINE, "sep: q.has('nosep')")
    at(PIPELINE, 'this.sepOff = off.sep')
    at(PIPELINE, '__MUT_SEP_BEHIND_OFF__')
    at(PIPELINE, 'sepDefeat')
  })
})

describe('separation: the gate covers EVERY stage (no single-member blind spot)', () => {
  it("the gate's default stage list equals the canonical STAGE_ORDER, exactly", () => {
    const m = GATE.match(/const STAGES = \(arg\('stages', '([^']+)'\)\)/)
    expect(m, "gate must define a default 'stages' list").not.toBeNull()
    const gateStages = m![1].split(',')
    // set equality both directions — a stage added to the game but not the gate
    // (or vice-versa) reddens here, so the gate can never silently cover a subset.
    expect([...gateStages].sort()).toEqual([...STAGE_ORDER].sort())
    expect(gateStages.length).toBe(8)
  })

  it('measures several distinct fighters, not one hero with complete art', () => {
    const m = GATE.match(/const PAIRS = \(arg\('pairs', '([^']+)'\)\)/)
    expect(m, "gate must define a default 'pairs' list").not.toBeNull()
    const pairs = m![1].split(',').map((p) => p.split(':'))
    expect(pairs.length).toBeGreaterThanOrEqual(3)
    const fighters = new Set(pairs.flat())
    expect(fighters.size).toBeGreaterThanOrEqual(6)
  })

  it('asserts the OUTCOME via two independently-sufficient paths, not a single mechanism', () => {
    // The gate must NOT AND four floors (that false-failed a value-separated read
    // on its starved rim counter). It asserts a clear read achieved by EITHER
    // mechanism, each with its own floor, failing only when NEITHER path holds.
    // Path A — the keyline carries it (both keyline floors together):
    at(GATE, 'p.rimPeakDelta >= FLOORS.rimPeakDelta && p.rimWidthPx >= FLOORS.rimWidthPx')
    // Path B — raw luminance carries it (keyline-INDEPENDENT body-vs-local-bg):
    at(GATE, 'Math.abs(p.contrast) >= FLOORS.lumContrast')
    // the OUTCOME: fail only when NEITHER path holds (not an AND of every floor,
    // and not an "exempt the rim when contrast is high" special-case).
    at(GATE, 'if (!keyline && !lumen) fails.push')
    // the luminance floor is a real, POSITIVE threshold (a level at which value
    // alone carries the read) — not the old signed -28 sanity bound.
    const m = GATE.match(/lumContrast: Number\(arg\('minLum', '([0-9.]+)'\)\)/)
    expect(m, 'gate must define a positive luminance-path floor lumContrast').not.toBeNull()
    expect(Number(m![1])).toBeGreaterThanOrEqual(45)
    // and the two keyline floors it ORs against are still positive.
    expect(GATE).toMatch(/rimPeakDelta: Number\(arg\('minPeak', '[1-9][0-9]*'\)\)/)
    expect(GATE).toMatch(/rimWidthPx: Number\(arg\('minRim', '[0-9.]+'\)\)/)
  })
})

describe('separation: the fragility ratchet caps keyline-only reads (mechanism-mix erosion)', () => {
  // The two-path OR gate above asserts the OUTCOME per read, which is correct — but by
  // construction it cannot see a read DECAY from luminance-carried to keyline-only: the
  // read still passes (the rim holds), so the gate stays green while value separation
  // silently erodes toward the "saved only by a stickered-on keyline" failure that
  // started this workstream. The ratchet closes that exact blind spot by gating the
  // COUNT of keyline-only reads. It is a FRAGILITY measure, not a mechanism proxy: it
  // never floors edgeContrast or requires the rim on any read — it only forbids the
  // MIX from drifting further onto the rim than today's high-water.
  it('authors a keyline-only ceiling with a live, positive default at the documented high-water', () => {
    const m = GATE.match(/const KEYLINE_ONLY_MAX = Number\(arg\('maxKeylineOnly', '([0-9]+)'\)\)/)
    expect(m, 'gate must declare KEYLINE_ONLY_MAX with a --maxKeylineOnly override').not.toBeNull()
    const ceiling = Number(m![1])
    // A 0 default would fire every run (decorative); a huge one would never fire.
    // Bracket it around the measured 25-27 high-water so a fresh checkout enforces
    // today's fragility, not 0/infinity.
    expect(ceiling).toBeGreaterThanOrEqual(20)
    expect(ceiling).toBeLessThanOrEqual(35)
  })

  it('CONSUMES the ceiling: keyline-only (viaA) is compared to it AND pushed to the fails[] the gate exits on', () => {
    // Authored-but-never-consumed is this project's signature no-op. Tie the const to
    // its enforcement: viaA must be computed, compared to the ceiling, and a breach
    // must push onto the SAME fails[] whose length drives process.exit(1).
    at(GATE, 'const viaA = reads.filter((r) => r.keyline && !r.lumen).length')
    at(GATE, 'viaA > KEYLINE_ONLY_MAX')
    expect(GATE).toMatch(/if \(risen\) fails\.push/)
    // exit is still driven by fails.length AFTER the ratchet has had its chance to push
    const push = at(GATE, 'if (risen) fails.push')
    const exit = at(GATE, "if (fails.length) { console.log('FAIL:')")
    expect(push).toBeLessThan(exit)
    // raw count printed whether it fires or not — transparent number, no hidden boolean
    at(GATE, 'fragility:   keyline-only ')
  })

  it('ratchets DOWN (reddens when keyline-only RISES), never inverted into a floor', () => {
    // Strictly "viaA GREATER THAN ceiling": a fragility ratchet reddens when MORE reads
    // fall onto the rim alone. A `<` would invert it into a floor that fails when value
    // separation IMPROVES — the opposite of the intent.
    at(GATE, 'const risen = viaA > KEYLINE_ONLY_MAX')
  })
})
