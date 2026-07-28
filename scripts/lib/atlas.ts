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
import { findAnchor } from './sprite-pipeline'
import type { Box, FighterAssets, SpriteFrameMeta, Vec2 } from '../../src/fight/types'
import { CLIPS, FRAME_ORDER, frameIndex } from './frame-spec'

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
    let height = 512
    while (height < usedH) height *= 2
    return { placements, width, height }
  }
  throw new Error('frames do not fit in a 4096x4096 atlas')
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

  // Build clips, remapping frame names to indices into frameMeta. Skip any
  // clip that references a frame we failed to produce, rather than emit a clip
  // that points at a hole.
  const nameToMeta = new Map(frameMeta.map((m, i) => [m.name, i]))
  const clips: FighterAssets['clips'] = {}
  for (const [clipName, spec] of Object.entries(CLIPS)) {
    const indices: number[] = []
    const durations: number[] = []
    let complete = true
    for (let i = 0; i < spec.frames.length; i++) {
      const idx = nameToMeta.get(spec.frames[i])
      if (idx === undefined) { complete = false; break }
      indices.push(idx)
      durations.push(spec.durations[i])
    }
    if (complete && indices.length) clips[clipName] = { frames: indices, durations, loop: spec.loop }
  }

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
    // Bottom band of the silhouette within this rect — same ground-contact
    // logic findAnchor uses, but computed against the packed atlas.
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
    const bandH = Math.max(3, Math.round((bottom - top + 1) * 0.06))
    let fl = w, fr = -1
    for (let yy = bottom; yy > bottom - bandH && yy >= 0; yy--) {
      for (let xx = 0; xx < w; xx++) {
        if (data[((y + yy) * info.width + (x + xx)) * 4 + 3] <= 8) continue
        if (xx < fl) fl = xx
        if (xx > fr) fr = xx
      }
    }
    const footX = fr >= 0 ? (fl + fr) / 2 : (left + right) / 2
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
