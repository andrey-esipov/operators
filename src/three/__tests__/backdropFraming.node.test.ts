import { describe, expect, it } from 'vitest'
import { BACKDROP_PLANE, backdropUvTransform } from '../stage/backdropFraming'
import { WORLD } from '../types'

/**
 * Gate for the painted-backdrop framing.
 *
 * WHAT THIS PROVES: that the plane-UV -> texture-UV transform puts the whole
 * painting inside the visible frustum, centred, under a cover fit — i.e. the
 * fight shows the buyer the arena the stage-select thumbnail sold them.
 *
 * WHAT THIS DOES NOT PROVE: that the shader actually applies the transform, or
 * that the result is pretty. The first is covered by the uniform wiring in
 * StageSubsystem; the second was settled by a blind three-critic ranking and
 * cannot be asserted here.
 *
 * The regression it exists to stop: the plane is deliberately ~2.3x wider than
 * the frame so it still covers when the camera dollies. Map texture UVs
 * straight across it and the viewer sees a small, off-centre crop. That is
 * exactly what shipped — a 2.2x zoom into the LOWER THIRD of every painting,
 * because the plane is centred at y=8.5 while the frustum centre at plate depth
 * sits near y=-0.25.
 */

const NEUTRAL = {
  cameraZ: WORLD.CAMERA.position[2],
  cameraY: WORLD.CAMERA.position[1],
  targetY: WORLD.CAMERA.target[1],
  targetZ: WORLD.CAMERA.target[2],
  fovDeg: WORLD.CAMERA.fov,
  aspect: 16 / 9,
}

/** Texture UV seen at a given plane UV, i.e. what the vertex shader computes. */
function texUv(t: ReturnType<typeof backdropUvTransform>, planeU: number, planeV: number) {
  return [
    (planeU - t.pivot[0]) * t.scale[0] + 0.5,
    (planeV - t.pivot[1]) * t.scale[1] + 0.5,
  ] as const
}

/** Plane UV of the frustum edges, from the visible rect the transform reports. */
function visibleEdges(t: ReturnType<typeof backdropUvTransform>) {
  const halfU = t.visible.width / 2 / BACKDROP_PLANE.width
  const halfV = t.visible.height / 2 / BACKDROP_PLANE.height
  const centreV =
    (t.visible.centerY - (BACKDROP_PLANE.centerY - BACKDROP_PLANE.height / 2)) /
    BACKDROP_PLANE.height
  return { left: 0.5 - halfU, right: 0.5 + halfU, bottom: centreV - halfV, top: centreV + halfV }
}

describe('backdrop framing', () => {
  it('puts the centre of the painting at the centre of the screen', () => {
    const t = backdropUvTransform(NEUTRAL, BACKDROP_PLANE, 1.5)
    const e = visibleEdges(t)
    const [u, v] = texUv(t, (e.left + e.right) / 2, (e.bottom + e.top) / 2)
    expect(u).toBeCloseTo(0.5, 5)
    expect(v).toBeCloseTo(0.5, 5)
  })

  it('shows the full width of a 3:2 painting in a 16:9 frame', () => {
    const t = backdropUvTransform(NEUTRAL, BACKDROP_PLANE, 1.5)
    const e = visibleEdges(t)
    expect(texUv(t, e.left, 0.5)[0]).toBeCloseTo(0, 5)
    expect(texUv(t, e.right, 0.5)[0]).toBeCloseTo(1, 5)
  })

  it('cover-fits rather than stretches: the crop is vertical and symmetric', () => {
    const t = backdropUvTransform(NEUTRAL, BACKDROP_PLANE, 1.5)
    const e = visibleEdges(t)
    const bottom = texUv(t, 0.5, e.bottom)[1]
    const top = texUv(t, 0.5, e.top)[1]
    // 3:2 art in a 16:9 window keeps 1.5/1.778 = 84.4% of the height.
    expect(top - bottom).toBeCloseTo(1.5 / (16 / 9), 4)
    expect(bottom).toBeCloseTo(1 - top, 5)
    expect(bottom).toBeGreaterThan(0)
    expect(top).toBeLessThan(1)
  })

  it('never letterboxes: the visible rect is fully inside the texture', () => {
    for (const aspect of [4 / 3, 16 / 10, 16 / 9, 21 / 9]) {
      for (const texAspect of [1.5, 16 / 9, 2.0]) {
        const t = backdropUvTransform({ ...NEUTRAL, aspect }, BACKDROP_PLANE, texAspect)
        const e = visibleEdges(t)
        const [u0, v0] = texUv(t, e.left, e.bottom)
        const [u1, v1] = texUv(t, e.right, e.top)
        const why = `aspect=${aspect} tex=${texAspect}`
        expect(u0, why).toBeGreaterThanOrEqual(-1e-6)
        expect(v0, why).toBeGreaterThanOrEqual(-1e-6)
        expect(u1, why).toBeLessThanOrEqual(1 + 1e-6)
        expect(v1, why).toBeLessThanOrEqual(1 + 1e-6)
      }
    }
  })

  it('corrects the shipped defect: the naive mapping was a zoomed, low crop', () => {
    const t = backdropUvTransform(NEUTRAL, BACKDROP_PLANE, 1.5)
    const e = visibleEdges(t)
    // Naive mapping = plane UV used directly as texture UV. Screen centre would
    // have sampled the lower third of the painting...
    const naiveCentreV = (e.bottom + e.top) / 2
    expect(naiveCentreV).toBeLessThan(0.4)
    // ...and only a fraction of the image would have been on screen at all.
    expect(e.right - e.left).toBeLessThan(0.5)
    // The transform has to magnify by more than 2x to undo that.
    expect(t.scale[0]).toBeGreaterThan(2)
  })
})
