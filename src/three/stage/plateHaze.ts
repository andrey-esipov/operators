/**
 * Plate-relative atmospheric haze.
 *
 * The far haze bands (Atmosphere.groundFog) are ADDITIVE and carry the stage
 * accent colour, so they deposit a roughly fixed amount of light no matter what
 * is behind them. Measured on the shipped art, that constant is subtle over a
 * bright painting and overwhelming over a dark one:
 *
 *   painting midtone (visible band) -> rendered midtone
 *     crisis        27 -> 80    (3.0x, saturation -30%)
 *     ipo-prep      45 -> 123   (2.7x, saturation -57%)
 *
 * and the four darkest paintings were exactly the four arenas that stopped
 * matching the thumbnail they were picked from, while the four brightest were
 * exactly the four that still read correctly. That split is the signature of an
 * additive term, not of a hue or grade bug.
 *
 * Physically, atmospheric scattering is proportional to the light present in the
 * volume. The plate IS this scene's light, so haze opacity scales with the
 * plate's own luminance. Deriving the scale from the shipped pixels (rather than
 * from eight hand-authored numbers) means new art is correct on arrival and
 * cannot drift out of sync with a config the artist never sees.
 */

/**
 * Reference luminance at which the far bands run at full authored strength.
 *
 * 1.0 makes the rule exactly "opacity proportional to plate luminance" -- no
 * arbitrary constant to drift. Fitted against all eight paintings by sweeping
 * this value and scoring |rendered midtone - painting midtone| per stage:
 *
 *   ref 0.22 -> 44.4    (0.22 == today's behaviour on the bright stages)
 *   ref 0.45 -> 34.3
 *   ref 0.70 -> 30.5
 *   ref 1.00 -> 28.3    <- chosen
 *   haze off -> 26.4
 *
 * Deliberately NOT the error-minimising floor. The five-arm blind ranking that
 * set this grade found the most art-forward arm LOST: past a point the plate
 * stops reading as part of the scene and starts reading as pasted-on wallpaper.
 * 1.0 takes almost all of the available correction while still leaving 73% of
 * the authored haze on the brightest arena and 44% on the next.
 */
export const HAZE_REF_LUMA = 1.0

/** Never fully remove the bands: some atmospheric depth is always wanted. */
export const HAZE_MIN_SCALE = 0.12

/**
 * Scale for the far additive haze bands given the plate's visible-band median
 * luminance (0..1). Proportional, clamped, and monotone in `median`.
 */
export function hazeScaleFor(median: number, ref: number = HAZE_REF_LUMA): number {
  if (!Number.isFinite(median) || median <= 0) return HAZE_MIN_SCALE
  if (!Number.isFinite(ref) || ref <= 0) return 1
  return Math.min(1, Math.max(HAZE_MIN_SCALE, median / ref))
}

/**
 * Median luminance of the part of the painting the fight camera actually shows.
 *
 * Only the cover-fit visible window counts: the plane crops the art to
 * v 0.078..0.922, and sampling outside that window measures pixels no player
 * ever sees. Whole-image mean does NOT separate the broken arenas from the
 * healthy ones (monetization is darker on average than ipo-prep yet renders
 * correctly); the visible-band median separates them perfectly.
 */
export function plateBandMedian(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  channels = 4,
): number {
  const y0 = Math.floor(height * (0.078 + 0.21 * 0.844))
  const y1 = Math.max(y0 + 1, Math.floor(height * (0.078 + 0.44 * 0.844)))
  const x0 = Math.floor(width * 0.18)
  const x1 = Math.max(x0 + 1, Math.floor(width * 0.82))
  const lum: number[] = []
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * channels
      lum.push((0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255)
    }
  }
  if (!lum.length) return HAZE_REF_LUMA
  lum.sort((a, b) => a - b)
  return lum[Math.floor(lum.length / 2)]
}
