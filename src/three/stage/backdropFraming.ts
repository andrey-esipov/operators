/**
 * Backdrop framing.
 *
 * The painted plate (`public/stages/<id>.png`) is the game's aesthetic — the
 * hand-authored Street-Fighter-lineage art the stage-select thumbnail shows the
 * buyer. The 3D set dresses in front of it; it does not replace it.
 *
 * The cyclorama mesh has to be much larger than the frame so it still covers
 * when the fight camera dollies, pans and pitches. That means plane UVs are NOT
 * texture UVs: mapping the texture across the whole oversized plane shows the
 * viewer a small, off-centre crop of the painting.
 *
 * Concretely, at the neutral camera the frustum covers 42.2 x 23.7 world units
 * at the plate's depth while the plane is 96 x 52 — so a direct mapping shows
 * the centre ~44% x ~46% of the art (a 2.2x zoom), and because the plane is
 * centred at y=8.5 while the frustum centre sits near y=-0.25, that crop is
 * taken from the LOWER THIRD of the image. The skyline the thumbnail promises
 * ends up above the top of the screen.
 *
 * This module computes the scale+pivot that makes the *visible* rectangle show
 * the whole painting under a cover fit, matching what `background-size: cover`
 * does for the select-screen thumbnail at the same aspect. Same art, same crop,
 * both places.
 *
 * The transform is derived from the NEUTRAL camera, not the live one, on
 * purpose: the plate stays world-fixed, so real camera movement slides it in
 * frame and produces genuine parallax instead of a UV-offset imitation.
 */

export interface BackdropFrustum {
  /** Camera position on the view axis (world z). */
  cameraZ: number
  /** Camera height, used to locate the frustum centre at plate depth. */
  cameraY: number
  /** Look-at height, which sets the pitch. */
  targetY: number
  /** Look-at distance along z (the target plane). */
  targetZ: number
  /** Vertical field of view in degrees. */
  fovDeg: number
  /** Viewport aspect (width / height). */
  aspect: number
}

export interface BackdropPlane {
  /** Plane width in world units. */
  width: number
  /** Plane height in world units. */
  height: number
  /** Plane centre height in world units. */
  centerY: number
  /** Plane depth in world units (negative = away from camera). */
  z: number
}

/**
 * The cyclorama's world placement. Single source of truth: the mesh is built
 * from it and the UV transform is solved against it, so the two cannot drift.
 *
 * The plane is intentionally far wider and taller than the frame — it has to
 * keep covering when the fight camera dollies out and pitches. That oversize is
 * exactly why the UV transform below is required.
 */
export const BACKDROP_PLANE: BackdropPlane = {
  width: 96,
  height: 52,
  centerY: 8.5,
  z: -30,
}

export interface BackdropUvTransform {  /** Multiplier applied to (planeUv - pivot). */
  scale: [number, number]
  /** Plane-UV point that maps to the centre of the texture. */
  pivot: [number, number]
  /** Visible rectangle at plate depth, in world units — exposed for tests. */
  visible: { width: number; height: number; centerY: number }
}

/**
 * Compute the plane-UV -> texture-UV transform so the visible frustum shows the
 * whole painting, cover-fitted.
 *
 * Texture UV is then `(planeUv - pivot) * scale + 0.5`.
 *
 * @param texAspect texture width / height (e.g. 1536/1024 = 1.5)
 */
export function backdropUvTransform(
  frustum: BackdropFrustum,
  plane: BackdropPlane,
  texAspect: number,
): BackdropUvTransform {
  const dist = frustum.cameraZ - plane.z
  const halfH = dist * Math.tan(((frustum.fovDeg / 2) * Math.PI) / 180)
  const halfW = halfH * frustum.aspect

  // Where the view axis crosses the plate. The camera looks from cameraY toward
  // targetY over targetZ of travel, so extend that slope out to the plate.
  const slope = (frustum.targetY - frustum.cameraY) / (frustum.cameraZ - frustum.targetZ)
  const centerY = frustum.cameraY + slope * dist

  // Cover fit: fill the visible rect with the texture, cropping the overflow on
  // whichever axis is proportionally longer.
  const visAspect = halfW / halfH
  let halfU = 0.5
  let halfV = 0.5
  if (texAspect > visAspect) halfU = 0.5 * (visAspect / texAspect)
  else halfV = 0.5 * (texAspect / visAspect)

  // Map the visible half-extent on the plane to that texture half-extent.
  const scaleX = (halfU * plane.width) / halfW
  const scaleY = (halfV * plane.height) / halfH

  // Pivot: the plane-UV of the frustum centre.
  const pivotX = 0.5
  const pivotY = (centerY - (plane.centerY - plane.height / 2)) / plane.height

  return {
    scale: [scaleX, scaleY],
    pivot: [pivotX, pivotY],
    visible: { width: halfW * 2, height: halfH * 2, centerY },
  }
}
