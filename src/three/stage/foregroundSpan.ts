import * as THREE from 'three'
import { WORLD } from '../types'

/**
 * Camera-pinned foreground occlusion, measured against the fighters' bodies.
 *
 * ONE implementation, TWO callers: the live dev hook on `__STAGE__` (real GPU,
 * live camera) and the load-invariant gate (headless build, neutral camera).
 * Forking it would give us two numbers that drift, which is the exact class the
 * shared engine-module enumerator closed earlier.
 *
 * ---------------------------------------------------------------------------
 * WHY VERTICAL SPAN AND NOT AREA
 * ---------------------------------------------------------------------------
 * Every scalar before this one measured QUANTITY, and the eye is responding to
 * GEOMETRY. Measured at neutral on the shipped roster:
 *
 *   ipo-prep      reads FINE    frac 8.93   span  8.93   5 of 56 rows, full
 *                                                        width, at the feet
 *   crisis        reads FINE    frac 7.05   span 17.86   10 of 56 rows, outer
 *                                                        corner, at the feet
 *   distribution  reads BROKEN  frac 10.71  span   100   56 of 56 rows, a
 *                                                        2-cell vertical bar
 *
 * `frac` cannot separate its own labelled cases -- 8.93 (fine) vs 10.71
 * (broken). `span` separates them 8.93 vs 100. The mechanism is perceptual: an
 * element crossing horizontally near the floor reads as DEPTH, something
 * standing in front of the arena; one running the length of the body reads as
 * the character being CUT IN HALF.
 *
 * ---------------------------------------------------------------------------
 * WHY TRIANGLES AND NOT A BOUNDING BOX
 * ---------------------------------------------------------------------------
 * The first version rasterised the screen-space AABB of eight projected bbox
 * corners. Pixels falsified it: `monetization` scored 49.6% of both bodies
 * covered while the 1:1 frame shows both fighters completely clear. A slab near
 * the camera has a near face much larger than its far face, and the AABB is the
 * union of the two, so it claims a band the geometry never fills. Walking the
 * real triangles dropped that number to 0.71 and made the metric agree with the
 * frame on its own worst case.
 */

/** Rasterisation lattice. Coarse on purpose: this is a composition question, so
 *  sub-degree precision would be false confidence, and a fixed lattice keeps the
 *  number comparable across stages and across the two callers. */
const GX = 160
const GY = 90

/**
 * ASSUMED body half-width in world units. Not measured from the atlas -- stated
 * rather than hidden. It is deliberately generous: at 0.55 the box is wider than
 * the drawn sprite, so the metric errs toward flagging an occluder that in fact
 * clears the art, never the reverse.
 */
export const BODY_HALF_W = 0.55

export interface ForegroundSpan {
  /** Fraction of the whole frame the foreground covers, 0-100. */
  coverage: number
  /** Fraction of each fighter's body box covered ("how much"), 0-100. */
  overlapP1: number
  overlapP2: number
  /** Fraction of each body's ROWS containing any cover ("what shape"), 0-100. */
  spanP1: number
  spanP2: number
}

const ZERO: ForegroundSpan = { coverage: 0, overlapP1: 0, overlapP2: 0, spanP1: 0, spanP2: 0 }

/**
 * TWO cameras, and conflating them makes the metric blind to its own known-bad
 * case. I proved that by mutation before shipping the gate.
 *
 *   fgCam    -- projects the CAMERA-PINNED foreground.
 *   bodyCam  -- projects the WORLD-FIXED fighter bodies.
 *
 * Live, they are the same object: `updateFrame()` has already baked
 * `cam.matrixWorld * neutralView` into the foreground's world matrix, so
 * projecting it through the live camera yields the neutral projection, while
 * the bodies (untouched) yield the live one. One camera, two different
 * effective frames.
 *
 * Headless, the foreground sits at its AUTHORED positions with no pin applied,
 * so it must be projected through the neutral camera and the bodies through the
 * fight camera's rest pose. Passing the neutral camera for both scored the
 * known-broken `distribution` posts at span 0 where the real GPU run measured
 * 100 -- because the fight camera rests CLOSER (z 9.85 vs 11.4) and LOWER
 * (y 2.03 vs 2.55), so a body projects visibly larger than the neutral camera
 * makes it. A gate that cannot see the defect it was written for is worse than
 * no gate, and only the mutation showed it.
 */
export function measureForegroundSpan(
  fg: THREE.Object3D | null | undefined,
  fgCam: THREE.Camera,
  bodyCam: THREE.Camera = fgCam,
): ForegroundSpan {
  if (!fg) return { ...ZERO }
  const cam = fgCam
  cam.updateMatrixWorld()
  bodyCam.updateMatrixWorld()
  fg.updateMatrixWorld(true)

  const grid = new Uint8Array(GX * GY)
  const corner = new THREE.Vector3()

  const rasterTri = (sx: number[], sy: number[]) => {
    const x0 = Math.max(0, Math.floor(Math.min(sx[0], sx[1], sx[2])))
    const x1 = Math.min(GX - 1, Math.ceil(Math.max(sx[0], sx[1], sx[2])))
    const y0 = Math.max(0, Math.floor(Math.min(sy[0], sy[1], sy[2])))
    const y1 = Math.min(GY - 1, Math.ceil(Math.max(sy[0], sy[1], sy[2])))
    const area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0])
    if (Math.abs(area) < 1e-9) return
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const px = gx + 0.5, py = gy + 0.5
        const w0 = ((sx[1] - sx[0]) * (py - sy[0]) - (sy[1] - sy[0]) * (px - sx[0])) / area
        const w1 = ((sx[2] - sx[1]) * (py - sy[1]) - (sy[2] - sy[1]) * (px - sx[1])) / area
        const w2 = ((sx[0] - sx[2]) * (py - sy[2]) - (sy[0] - sy[2]) * (px - sx[2])) / area
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) grid[gy * GX + gx] = 1
      }
    }
  }

  fg.traverse((n) => {
    const m = n as THREE.Mesh
    if (!m.isMesh || !m.geometry) return
    // Additive rim strips are LIGHT, not occlusion. Counting them would inflate
    // the number with the one foreground element the critics praised.
    if ((m.material as THREE.MeshBasicMaterial)?.isMeshBasicMaterial) return
    const posAttr = m.geometry.getAttribute('position')
    if (!posAttr) return
    const idx = m.geometry.getIndex()
    const triCount = idx ? idx.count / 3 : posAttr.count / 3
    for (let t = 0; t < triCount; t++) {
      const sx: number[] = [], sy: number[] = []
      let behind = false
      for (let k = 0; k < 3; k++) {
        const vi = idx ? idx.getX(t * 3 + k) : t * 3 + k
        corner.fromBufferAttribute(posAttr, vi).applyMatrix4(m.matrixWorld).project(cam)
        if (corner.z > 1) { behind = true; break }
        sx.push(((corner.x + 1) / 2) * GX)
        sy.push(((1 - corner.y) / 2) * GY)
      }
      if (behind) continue
      rasterTri(sx, sy)
    }
  })

  let hit = 0
  for (let i = 0; i < grid.length; i++) hit += grid[i]

  // Neutral fighter bodies, from the shipped constants rather than live state:
  // the question is about the STAGE's geometry, so a live fighter's drift would
  // put a time term back into a number that must be reproducible.
  const bodyOverlap = (cx: number) => {
    const p = new THREE.Vector3()
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i < 4; i++) {
      p.set(
        i & 1 ? cx + BODY_HALF_W : cx - BODY_HALF_W,
        i & 2 ? WORLD.GROUND_Y + WORLD.FIGHTER_HEIGHT : WORLD.GROUND_Y,
        0,
      ).project(bodyCam)
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x)
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y)
    }
    const cx0 = Math.max(0, Math.floor(((x0 + 1) / 2) * GX))
    const cx1 = Math.min(GX - 1, Math.ceil(((x1 + 1) / 2) * GX))
    const cy0 = Math.max(0, Math.floor(((1 - y1) / 2) * GY))
    const cy1 = Math.min(GY - 1, Math.ceil(((1 - y0) / 2) * GY))
    let on = 0, cells = 0, rows = 0, rowsHit = 0
    for (let gy = cy0; gy <= cy1; gy++) {
      rows++
      let any = 0
      for (let gx = cx0; gx <= cx1; gx++) { cells++; on += grid[gy * GX + gx]; any |= grid[gy * GX + gx] }
      rowsHit += any
    }
    return { frac: cells ? on / cells : 0, span: rows ? rowsHit / rows : 0 }
  }

  const p1 = bodyOverlap(-WORLD.FIGHTER_SEPARATION)
  const p2 = bodyOverlap(WORLD.FIGHTER_SEPARATION)
  const pc = (v: number) => Math.round(v * 10000) / 100
  return {
    coverage: pc(hit / grid.length),
    overlapP1: pc(p1.frac),
    overlapP2: pc(p2.frac),
    spanP1: pc(p1.span),
    spanP2: pc(p2.span),
  }
}

/**
 * The camera the foreground is pinned to.
 *
 * `StageSubsystem.updateFrame()` sets `frame.matrix = cam.matrixWorld *
 * neutralView`, so a foreground object authored at world P always lands on
 * screen exactly where THIS camera would put it, whatever the live camera is
 * doing. That is what makes a headless gate faithful rather than approximate:
 * for the foreground the neutral camera is not a stand-in, it is the definition.
 *
 * `aspect` matters because the lattice is measured in NDC. 16:9 is the framing
 * every capture, the attract opener and the store page use.
 */
export function neutralStageCamera(aspect = 16 / 9): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(WORLD.CAMERA.fov, aspect, WORLD.CAMERA.near, WORLD.CAMERA.far)
  c.position.set(...WORLD.CAMERA.position)
  c.up.set(0, 1, 0)
  c.lookAt(new THREE.Vector3(...WORLD.CAMERA.target))
  c.updateMatrixWorld(true)
  return c
}
