import * as THREE from 'three'
import { FightCamera } from '../../fight/FightCamera'
import { WORLD } from '../../types'

/**
 * SHARED CAMERA HARNESS FOR THE FOREGROUND-OCCLUDER GATES.
 *
 * Two gates ask different questions about the same subsystem:
 *
 *   foregroundOccluders.test.ts   does an occluder run DOWN a body?
 *   foregroundFootBand.test.ts    does one wall off the GROUND across the lane?
 *
 * Both need the fighters posed through the shipped fight camera, and this is a
 * plain `.ts`, not a `.test.ts`, so importing it does not re-register a sibling
 * suite (vitest's default include is `*.{test,spec}.*`). `src/__tests__/
 * engineModules.ts` is the same pattern.
 *
 * Factored rather than forked deliberately. Two copies of a camera solve is
 * exactly the drift this project has already closed twice — the shared engine
 * enumerator and the `auditEngineModules` seam. One list, several questions.
 * The `vi.mock` of the material bakery CANNOT live here: `vi.mock` is hoisted
 * per test file, so each gate declares its own.
 */

/**
 * The camera the WORLD-FIXED fighter bodies are seen through, settled to rest.
 *
 * Driven by the SHIPPED `FightCamera`, not a copy of its constants, so a future
 * reframing moves both gates with it instead of leaving them quietly measuring
 * an old composition. Its rest solve is deterministic (`restZ` derives from the
 * held 5.65 span), so settling the springs converges to a fixed pose.
 *
 * This is NOT the camera the foreground is projected through, and the
 * difference is load-bearing: using the neutral stage camera for both scored
 * the known-broken `distribution` posts at span 0 instead of 100, because the
 * fight camera rests closer (z 9.85 vs 11.4) and lower (y 2.03 vs 2.55) so
 * bodies project larger. Caught by mutation before either gate was trusted.
 */
export function restFightCamera(aspect = 16 / 9): THREE.PerspectiveCamera {
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
