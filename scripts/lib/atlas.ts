/**
 * Atlas packing.
 *
 * Registration hands us a stack of frames on identical, mostly-empty canvases
 * — every silhouette sitting on the same origin. Shipping those whole would
 * waste most of the GPU texture on transparency, so each frame is trimmed to
 * its opaque bounds and the trimmed rects are packed onto one atlas.
 *
 * The subtlety that is easy to get subtly wrong: the foot anchor. Before
 * trimming, every frame's feet are at a known canvas origin. Trimming moves
 * the pixels — the anchor has to be re-expressed relative to each frame's new
 * top-left, or the whole point of registration (feet on a fixed world point)
 * is lost the moment the art is packed. So the anchor is recomputed from the
 * trim offset, and `assertAnchorsPreserved` re-derives the foot point straight
 * from the packed pixels and checks it against the stored metadata.
 */
import sharp from 'sharp'
import { findAnchor, footAnchorX } from './sprite-pipeline'
import type { Box, FighterAssets, SpriteFrameMeta, Vec2 } from '../../src/fight/types'
import { CLIPS, FALLBACK_CLIPS, FRAME_ORDER, frameIndex, resolveClip, deriveAttackClip, type MoveTiming } from './frame-spec'

/**
 * Max GPU texture dimension we allow. 8192 is the WebGL2 spec floor that every
 * desktop GPU exceeds (most report 16384); it lets a fighter author at 2x so the
 * sprite isn't a 4x upscale on a retina display. A fighter that packs to exactly
 * 8192 has zero headroom — adding frames past that would force multi-page atlases,
 * which the single-`atlas` FighterAssets contract cannot express without a change.
 */
const MAX_ATLAS = 8192
const PADDING = 2

export interface RegisteredFrame {
  name: string
  /** Registered RGBA png on the shared canvas. */
  buf: Buffer
  /** Foot origin on that canvas (same for every frame by construction). */
  origin: Vec2
}

interface TrimmedFrame {
  name: string
  buf: Buffer
  w: number
  h: number
  /** Anchor within the trimmed image. */
  anchor: Vec2
}

/** Trim a registered frame to its opaque bounds, carrying the anchor across. */
async function trim(f: RegisteredFrame): Promise<TrimmedFrame> {
  const a = await findAnchor(f.buf)
  const cropped = await sharp(f.buf)
    .extract({ left: a.left, top: a.top, width: a.width, height: a.height })
    .png()
    .toBuffer()
  // The foot origin was at f.origin on the full canvas; after cropping to the
  // bbox its coordinates shift by the crop's top-left.
  return {
    name: f.name,
    buf: cropped,
    w: a.width,
    h: a.height,
    anchor: { x: f.origin.x - a.left, y: f.origin.y - a.top },
  }
}

/**
 * Shelf packer. Frames vary in size (a lying knockdown is wide and short, a
 * jump is tall and narrow) but there are only a few dozen, so a tallest-first
 * shelf pack lands them tightly enough without the complexity of a full
 * bin-packer. Returns placements and the chosen power-of-two atlas size.
 */
function shelfPack(
  frames: TrimmedFrame[],
): { placements: Map<string, Box>; width: number; height: number } {
  const order = [...frames].sort((a, b) => b.h - a.h)

  // Grow the atlas width through the power-of-two sizes until everything fits
  // within MAX_ATLAS in both dimensions.
  for (let width = 512; width <= MAX_ATLAS; width *= 2) {
    const placements = new Map<string, Box>()
    let shelfY = 0
    let shelfX = 0
    let shelfH = 0
    let ok = true
    for (const f of order) {
      const fw = f.w + PADDING
      const fh = f.h + PADDING
      if (fw > width) { ok = false; break }
      if (shelfX + fw > width) {
        shelfY += shelfH
        shelfX = 0
        shelfH = 0
      }
      placements.set(f.name, { x: shelfX, y: shelfY, w: f.w, h: f.h })
      shelfX += fw
      if (fh > shelfH) shelfH = fh
    }
    if (!ok) continue
    const usedH = shelfY + shelfH
    if (usedH > MAX_ATLAS) continue
    // WebGL2 (three r180 is WebGL2-only) fully supports non-power-of-two
    // textures with mipmaps and ClampToEdge, so round the packed height up to a
    // small multiple instead of the next power of two. The pow2 rounding wasted
    // up to ~2x the GPU memory and wire size — a fighter whose frames pack to
    // 4341px tall was being stored in an 8192px texture (256MB vs ~136MB). Width
    // stays a power of two (it's chosen by the shelf loop and frames fill it).
    const height = Math.ceil(usedH / 8) * 8
    return { placements, width, height }
  }
  throw new Error(`frames do not fit in a ${MAX_ATLAS}x${MAX_ATLAS} atlas`)
}

export interface PackResult {
  atlas: Buffer
  assets: FighterAssets
}

export async function packAtlas(
  fighterId: string,
  atlasPath: string,
  frames: RegisteredFrame[],
  heightCm: number,
  attackTiming?: Map<string, MoveTiming>,
): Promise<PackResult> {
  const trimmed = await Promise.all(frames.map(trim))
  const byName = new Map(trimmed.map((t) => [t.name, t]))

  const { placements, width, height } = shelfPack(trimmed)

  const composites = trimmed.map((t) => {
    const p = placements.get(t.name)!
    return { input: t.buf, left: p.x, top: p.y }
  })
  const atlas = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .png()
    .toBuffer()

  // Emit frames in the canonical FRAME_ORDER so `frames[i]` lines up with the
  // index every clip and MoveFrame.sprite refers to.
  const frameMeta: SpriteFrameMeta[] = FRAME_ORDER.filter((n) => byName.has(n)).map((name) => {
    const t = byName.get(name)!
    const rect = placements.get(name)!
    return { name, rect, anchor: t.anchor }
  })

  const clips = buildClips(frameMeta.map((m) => m.name), attackTiming)

  const assets: FighterAssets = {
    id: fighterId,
    atlas: atlasPath,
    frames: frameMeta,
    clips,
    heightCm,
  }
  return { atlas, assets }
}

/**
 * Remap every CLIP to indices into this fighter's packed frames.
 *
 * Attack clips in the derived kick ladder (see DERIVED_ATTACKS) are laid out
 * from `attackTiming` — the fighter's own per-move startup/active/recovery — so
 * the contact cel sits on the active window by construction, per archetype.
 * Without timing (the unplayable card-art skins have no moveset) every clip uses
 * the static CLIPS entry, which is the prior behaviour exactly.
 *
 * A clip whose rich (authored) form references a pose this fighter never
 * generated drops to a core-pose-only fallback (see FALLBACK_CLIPS) so the
 * stance still plays a real reel; if neither resolves, the clip is skipped
 * rather than emitted with a hole.
 *
 * Lives here so the full atlas pipeline builds every clip in one place; the
 * derived kick ladder specifically is shared with the manifest-only rebuild
 * (scripts/rebuild-manifest-clips.ts) through `deriveAttackClip`, so the two
 * cannot disagree about where a kick's contact cel lands — the same discipline
 * as the shared resolveClip.
 */
export function buildClips(
  frameNames: string[],
  attackTiming?: Map<string, MoveTiming>,
): FighterAssets['clips'] {
  const nameToMeta = new Map(frameNames.map((n, i) => [n, i]))
  const clips: FighterAssets['clips'] = {}
  for (const clipName of Object.keys(CLIPS)) {
    const timing = attackTiming?.get(clipName)
    const derived = timing ? deriveAttackClip(clipName, timing) : null
    const built = resolveClip(derived ?? CLIPS[clipName], nameToMeta) ??
      resolveClip(FALLBACK_CLIPS[clipName], nameToMeta)
    if (built) clips[clipName] = built
  }
  return clips
}

/**
 * Re-derive each frame's foot point straight from the packed atlas pixels and
 * confirm it matches the anchor we stored. This is the check that catches a
 * trim/offset arithmetic slip — if it passes, a frame drawn with its anchor on
 * the fighter's world position really does put the feet there.
 */
export async function assertAnchorsPreserved(
  atlas: Buffer,
  assets: FighterAssets,
  tolerance = 1.5,
): Promise<{ ok: boolean; report: string[] }> {
  const report: string[] = []
  let ok = true
  const { data, info } = await sharp(atlas).ensureAlpha().raw().toBuffer({ resolveWithObject: true })

  for (const f of assets.frames) {
    const { x, y, w, h } = f.rect
    // Silhouette bounding box within this rect; the pivot rule is applied below.
    let top = h, bottom = -1, left = w, right = -1
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        if (data[((y + yy) * info.width + (x + xx)) * 4 + 3] <= 8) continue
        if (yy < top) top = yy
        if (yy > bottom) bottom = yy
        if (xx < left) left = xx
        if (xx > right) right = xx
      }
    }
    if (bottom < 0) { report.push(`${f.name}: empty rect`); ok = false; continue }
    // Same pose-adaptive pivot rule findAnchor uses (shared footAnchorX), so the
    // check re-derives exactly what registration pinned — upright band midpoint
    // or prone contact-centroid — rather than a second, divergent copy.
    const footX = footAnchorX(
      (xx, yy) => data[((y + yy) * info.width + (x + xx)) * 4 + 3],
      left, right, top, bottom,
    )
    const dx = Math.abs(footX - f.anchor.x)
    const dy = Math.abs((bottom + 1) - f.anchor.y)
    if (dx > tolerance || dy > tolerance) {
      report.push(`${f.name}: anchor drift dx=${dx.toFixed(1)} dy=${dy.toFixed(1)}`)
      ok = false
    }
  }
  return { ok, report }
}

export { frameIndex }
