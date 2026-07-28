/**
 * Silhouette edge conditioning for packed sprite atlases.
 *
 * Extracted from AtlasTextures so the offline probe (scripts/lib/atlas-quality)
 * can measure the EXACT alpha the fighter shader samples on screen, not a
 * re-implementation that can drift. The house rules here were paid for in real
 * money: a metric that re-derives the pipeline instead of sharing it eventually
 * disagrees with the pipeline and lies. footAnchorX is shared between
 * registration and the atlas check for the same reason. This is that, for the
 * edge.
 *
 * Two silhouette sources exist across the roster:
 *
 *  - Native alpha: the atlas already carries a real coverage-antialiased edge
 *    (an ink keyline in RGB + a sub-pixel soft-alpha ramp, baked at export by
 *    scripts/lib/keyline + edge-aa). This is what the modern roster ships.
 *
 *  - Chroma backdrop: older / mock frames rendered opaque on gpt-image-2's flat
 *    neutral grey, with no usable alpha. These must be keyed and feathered here.
 *
 * The critical rule: when the atlas already carries a real coverage ramp, DO
 * NOT re-threshold it to a hard mask and re-feather. The re-feather collapses an
 * 8-level sub-pixel ramp to a 3-level (255/175/96/0) stair; the fighter
 * material's `smoothstep(0.5 - fwidth, 0.5 + fwidth, a)` then rides that stair,
 * quantising the edge crossing to pixel boundaries. That is exactly the
 * "staircase with a keyline whose weight wanders" the edge pass was built to
 * kill — reintroduced at texture-upload time, after the atlas was made correct.
 */

/** gpt-image-2 renders on a flat neutral grey; used when a frame has no alpha. */
export function isBackdrop(r: number, g: number, b: number): boolean {
  const nearMid = Math.abs(r - 128) < 32 && Math.abs(g - 128) < 32 && Math.abs(b - 128) < 32
  const neutral = Math.abs(r - g) < 16 && Math.abs(g - b) < 16 && Math.abs(r - b) < 16
  return nearMid && neutral
}

export function despeckle(mask: Uint8Array, w: number, h: number) {
  const src = mask.slice()
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      let c = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          if (src[p + dy * w + dx] !== 0) c++
        }
      if (src[p] !== 0 && c <= 1) mask[p] = 0
      else if (src[p] === 0 && c >= 7) mask[p] = 255
    }
  }
}

/**
 * Grow opaque RGB outward into transparent pixels by `iters` rings. Each pass a
 * transparent pixel that borders coloured pixels adopts their average colour.
 * Alpha is untouched — this only pre-loads sensible colour under the feather so
 * the half-transparent edge blends onto skin/cloth, not the backdrop (no halo).
 */
export function dilateColor(px: Uint8ClampedArray, mask: Uint8Array, w: number, h: number, iters: number) {
  const filled = mask.slice()
  for (let it = 0; it < iters; it++) {
    const snapshot = filled.slice()
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x
        if (snapshot[p] !== 0) continue
        let r = 0, g = 0, b = 0, c = 0
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= h) continue
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            if (xx < 0 || xx >= w) continue
            const q = yy * w + xx
            if (snapshot[q] === 0) continue
            const qi = q * 4
            r += px[qi]; g += px[qi + 1]; b += px[qi + 2]; c++
          }
        }
        if (c > 0) {
          const i = p * 4
          px[i] = r / c; px[i + 1] = g / c; px[i + 2] = b / c
          filled[p] = 255
        }
      }
    }
  }
}

/**
 * 1px neighbour-count feather of a HARD mask. Only used for the chroma-key
 * fallback path, where there is no real coverage information to preserve and any
 * smooth edge is better than a binary one. Deliberately coarse: three output
 * levels. Never run this over a native coverage ramp — see the file header.
 */
export function featherAlpha(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (mask[p] !== 0) { out[p] = 255; continue }
      let c = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          if (mask[yy * w + xx] !== 0) c++
        }
      }
      out[p] = c >= 5 ? 175 : c >= 3 ? 96 : 0
    }
  }
  return out
}

export interface ConditionedAlpha {
  /** Hard silhouette mask (255/0) for downstream normal + height derivation. */
  mask: Uint8Array
  /** Per-pixel luminance inside the silhouette (0 outside). */
  lum: Float32Array
  /** Whether the source carried a real alpha silhouette (vs chroma backdrop). */
  useNativeAlpha: boolean
  /** Whether that native alpha is a real coverage ramp (vs a binary edge). */
  hasCoverageRamp: boolean
}

/**
 * Condition an atlas' RGBA buffer in place for use as the albedo texture, and
 * return the hard mask + luminance the caller needs for normal/height maps.
 *
 * Mutates `px`:
 *   - RGB is dilated outward under the transparent margin (halo prevention).
 *   - Alpha is EITHER preserved verbatim (native coverage ramp) OR replaced with
 *     the coarse chroma-key feather (backdrop / binary-alpha path).
 */
export function conditionAlbedoAlpha(px: Uint8ClampedArray, w: number, h: number): ConditionedAlpha {
  const n = w * h

  // A frame carries usable native alpha if a meaningful fraction of pixels are
  // not fully opaque. Transparent atlas padding counts here, so any real
  // exported atlas trips this; only fully-opaque chroma frames fall through.
  // Separately, `hasCoverageRamp` asks whether that alpha is actually
  // antialiased: partial (16..240) pixels form the sub-pixel edge. The modern
  // roster (lenny, altman, annie, chesky, doshi, spiegel, turley) carries
  // 4-5.6% partial pixels; the mock/older atlases (cagan, catwu, madhavan,
  // taylor) are hard binary at 0%. We must only PRESERVE a real ramp — feathering
  // a real ramp destroys it, but preserving a binary edge would leave a harder
  // edge than the old feather gave, a regression for those four.
  let alphaCarriers = 0
  let partial = 0
  for (let i = 3; i < px.length; i += 4) {
    const a = px[i]
    if (a < 250) alphaCarriers++
    if (a > 16 && a < 240) partial++
  }
  const useNativeAlpha = alphaCarriers > n * 0.02
  const hasCoverageRamp = useNativeAlpha && partial > n * 0.001

  const mask = new Uint8Array(n)
  const lum = new Float32Array(n)
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3]
    const solid = useNativeAlpha ? a > 128 : !isBackdrop(r, g, b)
    mask[p] = solid ? 255 : 0
    lum[p] = solid ? (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 : 0
  }

  despeckle(mask, w, h)

  // Dilate silhouette colour into the margin BEFORE deciding alpha, so a
  // partially-transparent edge pixel blends onto the character's own colour.
  dilateColor(px, mask, w, h, 4)

  if (hasCoverageRamp) {
    // Preserve the baked coverage-AA ramp exactly. The dilateColor pass above
    // only rewrote RGB under mask==0 pixels; the true sub-pixel alpha in px is
    // left untouched so the shader sees the smooth edge the atlas shipped.
  } else {
    const soft = featherAlpha(mask, w, h)
    for (let p = 0, i = 3; p < n; p++, i += 4) px[i] = soft[p]
  }

  return { mask, lum, useNativeAlpha, hasCoverageRamp }
}
