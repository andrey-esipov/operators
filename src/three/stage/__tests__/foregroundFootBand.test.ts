import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'

// Same stub, and the same reason, as `foregroundOccluders.test.ts`: the material
// bakery rasterises procedural maps onto a <canvas>, which does not exist in the
// vitest 'node' environment. THREE object construction, matrix math and
// Vector3.project() are pure CPU, so the geometry measured here is the real
// shipped geometry — only the pixels of the material maps are faked, and this
// gate never looks at a pixel. `vi.mock` is hoisted per test file, so this
// cannot be shared with the sibling gate even though the camera solve is.
vi.mock('../../materials/procedural', () => {
  const tex = () => new THREE.Texture()
  return {
    bakeMaterial: () => ({
      map: tex(), roughnessMap: tex(), normalMap: tex(), metalnessMap: tex(),
      defaults: { normalScale: 1 },
    }),
    surface: () => new THREE.MeshStandardMaterial(),
    applyAoUv: () => {},
    disposeMaterialCache: () => {},
  }
})

import { buildStageScene } from '../StageBuilds'
import { stageConfig, STAGE_ORDER, STAGES } from '../StageRegistry'
import { flagsFor } from '../../core/QualityManager'
import { measureFootBandRun, neutralStageCamera } from '../foregroundSpan'
import { restFightCamera } from './stageHarness'

/**
 * NO FOREGROUND OCCLUDER MAY WALL OFF THE GROUND ACROSS THE FIGHT LANE.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS EXISTS FOR
 * ---------------------------------------------------------------------------
 * `ipo-prep` shipped a marble balustrade rail spanning x[-1, 1] — 100% of frame
 * width — at y[-0.73, -0.47], straddling the ground line the fighters stand on
 * (y = -0.55). It was the only full-width visible foreground element in the
 * game. Two blind critics on different model families, with no access to this
 * source and no knowledge of each other, independently ranked it the single
 * worst element on screen: "a massive horizontal black slab covering the ground
 * plane" and "a near-black apron spanning the bottom 25-30%, reading as a dead
 * bar, not a floor".
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SECOND METRIC AND NOT A LOOSER THRESHOLD ON THE FIRST
 * ---------------------------------------------------------------------------
 * This is the part worth reading. The sibling gate `foregroundOccluders` scores
 * an occluder's VERTICAL run down a body. A horizontal bar spans almost nothing
 * vertically: this one covered the body's lowest ~8% of NDC and scored 8.93%
 * against a 40% ceiling — a comfortable pass — while being the worst thing in
 * the game. The same geometry reads 100% here.
 *
 * Two gates over one subsystem returning opposite verdicts is not a bug in
 * either. A gate built for one defect SHAPE is silent on another shape. Do NOT
 * "fix" this by widening SPAN_CEILING: the span metric is correct about its own
 * question, and loosening it would blind the gate that caught `distribution`'s
 * fence post without doing anything about this.
 *
 * Body occlusion and ground contact are separate axes with separate severities.
 * A blind critic put the second one plainly: "in a 2D fighter, grounding the
 * characters is sacred."
 *
 * ---------------------------------------------------------------------------
 * WHY AN UNBROKEN RUN AND NOT COVERAGE
 * ---------------------------------------------------------------------------
 * Coverage cannot tell a full-width slab from two wings with the lane open
 * between them — the same area of ink, opposite reads. `alarm` carries MORE
 * foreground mass than stages the critics criticised and both let it pass,
 * because its centre is open. The open centre, not the total mass, is what
 * discriminates, so the metric measures the longest CONTIGUOUS blocked run
 * across the lane. `measureFootBandRun` also collapses the band vertically
 * first — a column counts as blocked if ANY row in the foot band is occluded
 * there — because a slab that dips low centrally and rides high at the edges is
 * still one wall to the eye.
 *
 * ---------------------------------------------------------------------------
 * WHY THE THRESHOLD IS 40 AND NOT EITHER SAMPLE'S VALUE
 * ---------------------------------------------------------------------------
 *   known-GOOD, roster max    10.1   `crisis` — corner desk masses at foot
 *                                    level, which BOTH critics explicitly
 *                                    passed ("frames, they don't maim")
 *   known-BAD                  100   `ipo-prep` before the fix
 *
 * 40 sits between them with ~4x margin above the worst passing stage and 2.5x
 * below the failing one, fitted to NEITHER. Same discipline as the sibling
 * gate's 40 (between 17.86 and 100) and the separation gate's floor of 50
 * (between 113 and 22). A threshold set AT a sample's value is a curve fit and
 * reddens on the next legitimate art change — which is how good gates get
 * disabled by someone in a hurry.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS GATE DOES NOT PROVE
 * ---------------------------------------------------------------------------
 * It measures geometry, not pixels. A bar can be authored outside a fighter and
 * still smear over him through foreground bokeh, which is exactly how the
 * `atrium` sub-floor bar read as amputating feet it never geometrically
 * touched. Geometric bounds are not screen bounds at a blurred depth. The
 * band-luminance profile over rendered frames owns that question; this gate
 * owns the structural one, and passing here is necessary, not sufficient.
 */

const FOOT_BAND_CEILING = 40

function measureAll() {
  const fgCam = neutralStageCamera()
  const bodyCam = restFightCamera()
  return STAGE_ORDER.map((id) => {
    const build = buildStageScene(id, stageConfig(id), flagsFor('ultra'))
    const runPct = measureFootBandRun(build.foreground, fgCam, bodyCam)
    build.dispose()
    return { id, runPct }
  })
}

describe('foreground occluders never wall off the ground across the fight lane', () => {
  it('measures every stage that EXISTS, not just every stage that is listed', () => {
    // Vacuity guard, and the non-tautological form of it. `measureAll()` maps
    // over STAGE_ORDER, so asserting the result equals STAGE_ORDER cannot fail
    // — it is true by construction. The real failure mode is a stage added to
    // the `STAGES` registry that never reaches STAGE_ORDER: it would ship,
    // never be measured, and this gate would stay green while saying "every
    // stage". So the population is checked against the OTHER declaration of it.
    //
    // Several defects on this project shared the shape "a constant validated
    // against one member of a set while N others go unchecked". This is that
    // shape aimed at the gate itself.
    const measured = measureAll().map((r) => r.id)
    const declared = Object.keys(STAGES)
    expect([...measured].sort()).toEqual([...declared].sort())
    expect(measured.length).toBe(8)
  })

  it('proves every stage HAS a foreground before asserting none of them wall it off', () => {
    // An absence assertion must first prove there is something to be absent
    // from. A build that silently produced no foreground — a registry typo, a
    // broken style switch, a dispose that ran early — scores 0 and sails
    // through the real assertion below for the worst possible reason.
    for (const id of STAGE_ORDER) {
      const build = buildStageScene(id, stageConfig(id), flagsFor('ultra'))
      let occluders = 0
      build.foreground.traverse((n) => {
        const m = n as THREE.Mesh
        // Counted the way the rasteriser counts: basic materials are additive
        // rim LIGHT, not occlusion, so a foreground of nothing but rim strips
        // must not satisfy this.
        if (m.isMesh && m.geometry
          && !(m.material as THREE.MeshBasicMaterial)?.isMeshBasicMaterial) occluders++
      })
      build.dispose()
      expect(occluders, `${id} authors no occluding foreground at all`).toBeGreaterThan(0)
    }
  })

  it('proves the metric can report a wall before asserting there is none', () => {
    // An absence assertion must first prove it can detect a presence. Without
    // this, a `measureFootBandRun` that returned 0 unconditionally — a rasteriser
    // regression, an empty foreground, a bad camera — would make the real
    // assertion below pass for the worst possible reason. This project has
    // shipped a probe that passed while reporting `checked 0`.
    //
    // The control is the SHIPPED broken geometry: a full-width bar at the depth
    // and height `ipo-prep` actually used, so the positive case is a real
    // regression rather than a synthetic shape chosen to be easy to catch.
    const fgCam = neutralStageCamera()
    const bodyCam = restFightCamera()
    const wall = new THREE.Group()
    // MeshStandardMaterial, NOT MeshBasicMaterial: the rasteriser deliberately
    // skips basic materials because the additive rim strips are LIGHT, not
    // occlusion, and counting them would inflate every stage with the one
    // foreground element the critics praised. My first draft of this control
    // used a basic material and scored 0 — the control caught its own error
    // instead of passing for the wrong reason, which is the whole point of it.
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(8.4, 0.26, 0.5),
      new THREE.MeshStandardMaterial(),
    )
    bar.position.set(0, 1.35, 6.4)
    wall.add(bar)
    wall.updateMatrixWorld(true)

    expect(
      measureFootBandRun(wall, fgCam, bodyCam),
      'the positive control did not register — this gate cannot see a wall',
    ).toBeGreaterThan(90)
  })

  it('no stage walls off the ground across the fight lane', () => {
    const rows = measureAll()
    const worst = [...rows].sort((a, b) => b.runPct - a.runPct)[0]
    for (const r of rows) {
      expect(
        r.runPct,
        `${r.id} blocks ${r.runPct.toFixed(1)}% of the fight lane in an unbroken `
        + `run at foot height (ceiling ${FOOT_BAND_CEILING}). A full-width bar at `
        + `the floor severs ground contact; open the CENTRE rather than dimming `
        + `or shrinking it, the way 'alarm' does.`,
      ).toBeLessThan(FOOT_BAND_CEILING)
    }
    // Pin the roster max so erosion toward the ceiling is visible in a diff
    // rather than arriving silently one art commit at a time. A two-path OR gate
    // on this project once decayed from +7.3 to -20 while staying green because
    // only the pass/fail was watched, never the margin.
    expect(worst.runPct).toBeLessThan(20)
  })
})
