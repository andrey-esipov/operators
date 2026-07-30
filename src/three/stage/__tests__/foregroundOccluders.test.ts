import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'

// The material bakery rasterises procedural maps onto a <canvas>, which does not
// exist in the vitest 'node' environment. Stub it with plain data textures so we
// can build all eight arenas headlessly. THREE object construction, matrix math
// and Vector3.project() are pure CPU and need no GL context, so the geometry
// this measures is the real shipped geometry — only the pixels of the material
// maps are faked, and this gate never looks at a pixel.
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
import { stageConfig, STAGE_ORDER } from '../StageRegistry'
import { flagsFor } from '../../core/QualityManager'
import { measureForegroundSpan, neutralStageCamera, BODY_HALF_W } from '../foregroundSpan'
import { FightCamera } from '../../fight/FightCamera'
import { WORLD } from '../../types'
import { StageBuild } from '../StageKit'

/**
 * NO FOREGROUND OCCLUDER MAY RUN THE LENGTH OF A FIGHTER'S BODY.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS EXISTS FOR
 * ---------------------------------------------------------------------------
 * `distribution` shipped three identical 5.0-tall fence posts at
 * x = -3.3/-2.7/-2.1 while P1 stands at x = -2.55. The innermost ran the full
 * height of his body and the 1:1 frame showed a black pole straight down
 * Chesky's arm and torso — the character read as cut in half. Two blind critics
 * named the foreground occluders as the top remaining defect independently and
 * unprompted.
 *
 * ---------------------------------------------------------------------------
 * WHY THE THRESHOLD IS 40 AND NOT EITHER SAMPLE'S VALUE
 * ---------------------------------------------------------------------------
 * Both anchors are stated so a future reader can re-derive the number instead
 * of trusting it:
 *
 *   known-GOOD, roster max   17.86   `crisis` — black desk masses at foot level
 *   known-BAD                  100   `distribution` before the fix
 *
 * 40 sits between them with 2.2x margin above the worst passing stage and 2.5x
 * below the failing one. It is fitted to NEITHER — the same discipline the
 * separation gate used when it set a floor of 50 between known-good 113 and
 * known-bad 22. A threshold set at a sample's value is a curve fit, and it
 * reddens on the next legitimate art change.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS GATE IS FAITHFUL RATHER THAN APPROXIMATE
 * ---------------------------------------------------------------------------
 * It was calibrated against the real-GPU instrument before being trusted. The
 * same eight stages captured through offscreen-headed Chrome on the live route
 * produced, and this headless build reproduces, all forty numbers exactly:
 *
 *   stage         coverage  onP1  onP2  spanP1  spanP2
 *   pre-pmf          16.26     0  1.25       0    3.57
 *   ai-native         6.31     0     0       0       0
 *   hypergrowth      12.56     0     0       0       0
 *   plateau           5.59     0     0       0       0
 *   crisis           16.48  6.25  7.05   17.86   17.86
 *   monetization     15.58  0.71  1.25    8.93   10.71
 *   distribution      2.87     0     0       0       0
 *   ipo-prep         15.71  8.93  8.93    8.93    8.93
 *
 * ---------------------------------------------------------------------------
 * KNOWN LIMITATION, STATED RATHER THAN HIDDEN
 * ---------------------------------------------------------------------------
 * Measured at NEUTRAL (round-start) spacing only. Fighters walk into corners,
 * so "no occluder ever overlaps a fighter" is unsatisfiable and would be a
 * gate nobody could keep green. Neutral is the frame every screenshot, every
 * attract opener and the store page shows. It does NOT cover an occluder a
 * fighter walks into mid-match: `hypergrowth` reads 0/0 here while an in-match
 * capture showed a wedge swallowing a fighter's feet after he had walked into
 * it. That case belongs to a different instrument.
 */

const SPAN_CEILING = 40
const KNOWN_GOOD_MAX = 17.86 // crisis, measured
const KNOWN_BAD = 100 // distribution before the fix, measured
/** Shipped foreground depth -- `Z` in StageSet.foreground(). */
const FG_Z = 4.8

/**
 * The camera the WORLD-FIXED fighter bodies are seen through.
 *
 * Driven by the SHIPPED `FightCamera`, not a copy of its constants, so a future
 * reframing moves this gate with it instead of leaving it quietly measuring an
 * old composition. Its rest solve is deterministic (`restZ` derives from the
 * held 5.65 span), so settling the springs converges to a fixed pose.
 *
 * This is NOT the same camera the foreground is projected through, and the
 * difference is load-bearing: using the neutral stage camera for both scored
 * the known-broken posts at span 0 instead of 100, because the fight camera
 * rests closer (z 9.85 vs 11.4) and lower (y 2.03 vs 2.55) so bodies project
 * larger. Caught by mutation before this gate was trusted.
 */
function restFightCamera(aspect = 16 / 9): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(
    WORLD.CAMERA.fov, aspect, WORLD.CAMERA.near, WORLD.CAMERA.far,
  )
  const fc = new FightCamera(cam, { minX: -8, maxX: 8 })
  const framing = {
    ax: -WORLD.FIGHTER_SEPARATION,
    bx: WORLD.FIGHTER_SEPARATION,
    topY: WORLD.FIGHTER_HEIGHT,
    pushIn: 0,
  }
  for (let i = 0; i < 900; i++) fc.update(1 / 60, 1 / 60, framing)
  cam.updateMatrixWorld(true)
  return cam
}

/**
 * World x at which an occluder pinned at depth `z` LANDS ON a fighter standing
 * at world `bodyX`.
 *
 * They are not the same number, and assuming they were is what made my first
 * synthetic control silently score 0. The foreground sits at z = 4.8, i.e.
 * 6.6 units from the neutral camera, while the fighter stands at z = 0, i.e.
 * 9.85 units from the fight camera. Nearer geometry projects WIDER, so a post
 * at the fighter's own world x appears well outboard of him. The broken
 * `distribution` posts bear this out: the one that ran down P1's body was at
 * x = -2.1, comfortably inboard of his x = -2.55.
 *
 * Solved rather than hardcoded. Neither camera yaws, so screen x is linear in
 * world x at fixed z, and two probes give the exact inverse. Derived means the
 * control follows a future reframing instead of quietly testing empty air.
 */
function pinnedXOver(bodyX: number, z: number, fgCam: THREE.Camera, bodyCam: THREE.Camera): number {
  const target = new THREE.Vector3(bodyX, WORLD.GROUND_Y + WORLD.FIGHTER_HEIGHT * 0.5, 0)
    .project(bodyCam).x
  const a = new THREE.Vector3(0, WORLD.GROUND_Y + WORLD.FIGHTER_HEIGHT * 0.5, z).project(fgCam).x
  const b = new THREE.Vector3(1, WORLD.GROUND_Y + WORLD.FIGHTER_HEIGHT * 0.5, z).project(fgCam).x
  return (target - a) / (b - a)
}

function measureAll() {
  const fgCam = neutralStageCamera()
  const bodyCam = restFightCamera()
  return STAGE_ORDER.map((id) => {
    const build = buildStageScene(id, stageConfig(id), flagsFor('ultra'))
    const r = measureForegroundSpan(build.foreground, fgCam, bodyCam)
    build.dispose()
    return { id, ...r }
  })
}

describe('foreground occluders never span a fighter vertically', () => {
  it('measures the CANONICAL stage list, not a hand-written subset', () => {
    // Vacuity guard. Three separate defects on this project shared the shape
    // "a constant validated against one member of a set while N others go
    // unchecked", so the population is asserted to be the shipped one.
    const measured = measureAll().map((r) => r.id)
    expect(measured).toEqual(STAGE_ORDER)
    expect(measured.length).toBe(8)
  })

  it('proves it is looking at real geometry before asserting an absence', () => {
    // An absence assertion must first prove presence. Every stage authors a
    // foreground, so a build that silently produced none would make the span
    // assertion below pass for the worst possible reason.
    const rows = measureAll()
    for (const r of rows) {
      expect(r.coverage, `${r.id} has no measurable foreground at all`).toBeGreaterThan(1)
    }
  })

  it('no stage runs an occluder down a fighter at neutral spacing', () => {
    const rows = measureAll()
    const failures = rows
      .filter((r) => Math.max(r.spanP1, r.spanP2) >= SPAN_CEILING)
      .map((r) => `${r.id} spans ${Math.max(r.spanP1, r.spanP2)}% of a body's rows`)
    expect(failures, failures.join('; ')).toEqual([])

    // Report where the roster actually sits, so an erosion toward the ceiling
    // is visible in the data rather than only at the moment it crosses. A
    // boolean gate cannot show a margin shrinking.
    const worst = Math.max(...rows.map((r) => Math.max(r.spanP1, r.spanP2)))
    expect(worst).toBeLessThan(SPAN_CEILING)
    expect(worst).toBeCloseTo(KNOWN_GOOD_MAX, 1)
  })

  it('POSITIVE CONTROL: the metric reds on a post through the body', () => {
    // The gate asserts an absence on every real stage, so without this it could
    // be green because the metric always returns 0. Reconstructs the exact
    // defect: a tall thin post standing in the P1 lane, in front of the
    // fighters, at the shipped foreground depth.
    const fgCam = neutralStageCamera()
    const bodyCam = restFightCamera()
    const x = pinnedXOver(-WORLD.FIGHTER_SEPARATION, FG_Z, fgCam, bodyCam)
    // Sanity-check the derivation itself, so a broken solve cannot quietly
    // place the post off-screen and report a clean absence.
    expect(x).toBeGreaterThan(-WORLD.FIGHTER_SEPARATION)
    expect(x).toBeLessThan(0)

    const b = new StageBuild()
    b.beginForeground()
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 5.0, 8),
      new THREE.MeshStandardMaterial(),
    )
    post.position.set(x, 2.2, FG_Z)
    b.add(post)
    b.endForeground()

    const r = measureForegroundSpan(b.foreground, fgCam, bodyCam)
    expect(r.spanP1).toBeGreaterThanOrEqual(SPAN_CEILING)
    expect(r.spanP1).toBeCloseTo(KNOWN_BAD, 0)
    // ...and it must NOT smear onto the other fighter, or the metric is just
    // reacting to any foreground content rather than locating the obstruction.
    expect(r.spanP2).toBe(0)
    b.dispose()
  })

  it('POSITIVE CONTROL: an occluder BESIDE a fighter is framing, not obstruction', () => {
    // The discriminator has to cut both ways. The same post moved outboard of
    // the body lane must read clean — otherwise the gate would forbid the
    // foreground framing the composition needs, and the honest fix would be to
    // delete the foreground rather than compose it.
    const fgCam = neutralStageCamera()
    const bodyCam = restFightCamera()
    const onBody = pinnedXOver(-WORLD.FIGHTER_SEPARATION, FG_Z, fgCam, bodyCam)
    const outboard = pinnedXOver(-WORLD.FIGHTER_SEPARATION - BODY_HALF_W * 3, FG_Z, fgCam, bodyCam)
    expect(outboard).toBeLessThan(onBody)

    const b = new StageBuild()
    b.beginForeground()
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 5.0, 8),
      new THREE.MeshStandardMaterial(),
    )
    post.position.set(outboard, 2.2, FG_Z)
    b.add(post)
    b.endForeground()

    const r = measureForegroundSpan(b.foreground, fgCam, bodyCam)
    expect(r.spanP1).toBeLessThan(SPAN_CEILING)
    b.dispose()
  })
})
