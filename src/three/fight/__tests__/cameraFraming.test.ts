import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { FightCamera, type CameraFraming } from '../FightCamera'
import { WORLD } from '../../types'

/**
 * Neutral vertical-framing regression guard.
 *
 * The renderer critic measured our neutral frame as ~36% dead sky above the
 * heads and a floor line jammed at ~96% down (feet almost on the bottom edge,
 * ~4% apron) — airy-on-top, stuck-on-bottom — against a genre norm of ~15-22%
 * headroom and a floor line at ~75-80% (a ~20-25% apron). The character SIZE was
 * already genre-perfect (~59%); the defect was purely how the fixed vertical span
 * was WEIGHTED. FightCamera reserved the launch headroom statically; the fix
 * redistributes it (headTopBase 2.05->1.0, footBot 0.2->1.25, sum held at 5.65 so
 * the neutral size is unchanged) and adds launch sky dynamically instead.
 *
 * These tests drive the REAL FightCamera with no GPU: settle the framing springs,
 * then project the fighting-plane feet (y=0) and head (y=FIGHTER_HEIGHT) points
 * through the camera and read their vertical screen position. Screen fraction is
 * measured from the BOTTOM edge (0 = bottom, 1 = top). Every band below is the
 * externally-anchored genre target, and the OLD static split lands well outside
 * each one (headroom ~36% > 22%, apron ~4% < 20%), so a revert to it is RED — the
 * gate can genuinely fail. Several stage widths are covered because a frame check
 * that only sees one stage is presumed blind.
 */

const FOV = WORLD.CAMERA.fov
const DT = 1 / 60
const HEAD_Y = WORLD.FIGHTER_HEIGHT
// Neutral: two grounded fighters at conversational range. Vertical containment
// dominates here, so this is where the head/floor weighting is felt.
const NEUTRAL: CameraFraming = { ax: -2, bx: 2, topY: WORLD.FIGHTER_HEIGHT, pushIn: 0 }

// A spread of real stage widths (FightRenderer's default is +/-8.2).
const STAGES = [
  { name: 'narrow', bounds: { minX: -6, maxX: 6 } },
  { name: 'default', bounds: { minX: -8.2, maxX: 8.2 } },
  { name: 'wide', bounds: { minX: -12, maxX: 12 } },
]

/** Screen fraction from the BOTTOM edge (0..1) of a fighting-plane point at height y. */
function fracFromBottom(cam: THREE.PerspectiveCamera, y: number): number {
  const v = new THREE.Vector3(0, y, 0).project(cam)
  return v.y * 0.5 + 0.5
}

function settle(bounds: { minX: number; maxX: number }, framing: CameraFraming = NEUTRAL) {
  const cam = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 100)
  const fc = new FightCamera(cam, bounds)
  for (let i = 0; i < 240; i++) fc.update(DT, DT, framing)
  return { cam, fc }
}

/** Neutral composition of one settled frame: where feet/head sit and the gaps. */
function composition(bounds: { minX: number; maxX: number }) {
  const { cam } = settle(bounds)
  const feet = fracFromBottom(cam, 0)
  const head = fracFromBottom(cam, HEAD_Y)
  return {
    charHeight: head - feet, // fraction of screen height the standing fighter fills
    headroom: 1 - head, // empty screen above the head
    floorApron: feet, // floor below the feet, up from the bottom edge
    floorLineFromTop: 1 - feet, // genre quotes 75-80%
  }
}

describe('neutral vertical framing', () => {
  it('sizes the standing fighter into the genre band (~55-65%) on every stage', () => {
    for (const s of STAGES) {
      const c = composition(s.bounds)
      expect(c.charHeight, `${s.name} charHeight`).toBeGreaterThan(0.55)
      expect(c.charHeight, `${s.name} charHeight`).toBeLessThan(0.65)
    }
  })

  it('keeps standing headroom in the genre band (~15-22%), not the old ~36% dead sky', () => {
    for (const s of STAGES) {
      const c = composition(s.bounds)
      // Old static headTopBase=2.05 projects ~36% here -> this is RED for a revert.
      expect(c.headroom, `${s.name} headroom`).toBeGreaterThan(0.14)
      expect(c.headroom, `${s.name} headroom`).toBeLessThan(0.22)
    }
  })

  it('restores a real floor apron (~20-25%), not the old ~4% with feet on the edge', () => {
    for (const s of STAGES) {
      const c = composition(s.bounds)
      // Old footBot=0.2 projects ~4% here -> this is RED for a revert.
      expect(c.floorApron, `${s.name} floorApron`).toBeGreaterThan(0.19)
      expect(c.floorApron, `${s.name} floorApron`).toBeLessThan(0.26)
      // Floor line sits in the genre's 75-80%-from-top window.
      expect(c.floorLineFromTop, `${s.name} floorLine`).toBeGreaterThan(0.74)
      expect(c.floorLineFromTop, `${s.name} floorLine`).toBeLessThan(0.81)
    }
  })

  it('reserves launch headroom DYNAMICALLY — the frame lifts only when a launch climbs', () => {
    const bounds = { minX: -8.2, maxX: 8.2 }

    // Neutral: a head-height point sits high in frame (little sky above it).
    const { cam: camN } = settle(bounds)
    const headNeutral = fracFromBottom(camN, HEAD_Y)

    // A launch to topY high above the standing head: the camera should crane up
    // / pull out to contain it, which pushes a FIXED grounded head-height point
    // DOWN the screen (the sky it needed was added on demand, not parked at rest).
    const launch: CameraFraming = { ax: -2, bx: 2, topY: 8.0, pushIn: 0 }
    const { cam: camL } = settle(bounds, launch)
    const headOnLaunch = fracFromBottom(camL, HEAD_Y)

    // Dynamic reaction: the standing head-height point drops materially on launch.
    expect(headOnLaunch).toBeLessThan(headNeutral - 0.08)

    // Containment invariant preserved: the grounded feet must NOT be cropped off
    // the bottom while the camera favours the airborne head (the old bug this
    // whole system guards against).
    const feetOnLaunch = fracFromBottom(camL, 0)
    expect(feetOnLaunch).toBeGreaterThan(0)
    // And the launched head itself stays inside the frame with clearance.
    const launchedHead = fracFromBottom(camL, launch.topY)
    expect(launchedHead).toBeLessThan(1)
    expect(launchedHead).toBeGreaterThan(0)
  })
})
