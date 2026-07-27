/**
 * Animated-PNG writer, zero external dependencies.
 *
 * The task asks for an animated preview per clip so motion is reviewable at a
 * glance without opening the game, and a still filmstrip cannot show a hitchy
 * walk or a punch that skips a beat. APNG rather than GIF because it keeps the
 * pixel-art palette and alpha exactly (GIF would dither and lose the clean
 * silhouette), and — critically — it needs nothing but node's built-in `zlib`,
 * so it adds no package to the shared, symlinked node_modules that two agents
 * are editing at once.
 *
 * Frames are RGBA of identical dimensions. Each APNG frame carries its own
 * delay, expressed in 60ths of a second, so a clip plays back at exactly the
 * durations the renderer will use (durations are authored in 60fps sim frames).
 */
import zlib from 'node:zlib'
import sharp from 'sharp'
import type { FighterAssets } from '../../src/fight/types'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

/** Filter-type-0 (None) scanlines then deflate — a valid, if unfiltered, stream. */
function deflateRGBA(rgba: Buffer, width: number, height: number): Buffer {
  const stride = width * 4
  const filtered = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0 // filter: None
    rgba.copy(filtered, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  return zlib.deflateSync(filtered, { level: 9 })
}

export interface ApngFrame {
  rgba: Buffer
  width: number
  height: number
  /** Delay in 60ths of a second. */
  delay60: number
}

/** Encode identically-sized RGBA frames into one looping APNG buffer. */
export function encodeApng(frames: ApngFrame[]): Buffer {
  if (!frames.length) throw new Error('encodeApng: no frames')
  const { width, height } = frames[0]
  for (const f of frames) {
    if (f.width !== width || f.height !== height) {
      throw new Error('encodeApng: all frames must share dimensions')
    }
  }

  const parts: Buffer[] = [SIGNATURE]

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace
  parts.push(chunk('IHDR', ihdr))

  const actl = Buffer.alloc(8)
  actl.writeUInt32BE(frames.length, 0)
  actl.writeUInt32BE(0, 4) // 0 = loop forever
  parts.push(chunk('acTL', actl))

  let seq = 0
  const fctl = (delay60: number): Buffer => {
    const b = Buffer.alloc(26)
    b.writeUInt32BE(seq++, 0)
    b.writeUInt32BE(width, 4)
    b.writeUInt32BE(height, 8)
    b.writeUInt32BE(0, 12) // x offset
    b.writeUInt32BE(0, 16) // y offset
    b.writeUInt16BE(Math.max(1, Math.round(delay60)), 20) // delay numerator
    b.writeUInt16BE(60, 22) // delay denominator: 60ths of a second
    b[24] = 0 // dispose: none
    b[25] = 0 // blend: source (overwrite) — every frame is fully painted
    return b
  }

  frames.forEach((f, i) => {
    const data = deflateRGBA(f.rgba, width, height)
    parts.push(chunk('fcTL', fctl(f.delay60)))
    if (i === 0) {
      // The first animation frame is also the default image: plain IDAT.
      parts.push(chunk('IDAT', data))
    } else {
      // fdAT = sequence number + frame data.
      const fd = Buffer.alloc(4 + data.length)
      fd.writeUInt32BE(seq++, 0)
      data.copy(fd, 4)
      parts.push(chunk('fdAT', fd))
    }
  })

  parts.push(chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(parts)
}

const CELL_BG = { r: 18, g: 20, b: 28, alpha: 1 }

/**
 * Render one clip off the packed atlas into APNG frames, each drawn with its
 * foot anchor on a shared baseline — the same registration the renderer uses,
 * so the preview shows exactly what the game will. A frame that slides its feet
 * or pops in size is immediately obvious in the loop.
 */
async function renderClipFrames(
  atlas: Buffer,
  assets: FighterAssets,
  clipName: string,
  cell: number,
): Promise<ApngFrame[] | null> {
  const clip = assets.clips[clipName]
  if (!clip || !clip.frames.length) return null

  const W = cell
  const H = cell
  const baselineY = Math.round(cell * 0.92)
  const originX = Math.round(cell * 0.5)

  // One scale for the whole clip so the character keeps a constant size, capped
  // so even a wide pose fits the cell.
  let maxH = 1
  let maxW = 1
  for (const fi of clip.frames) {
    maxH = Math.max(maxH, assets.frames[fi].rect.h)
    maxW = Math.max(maxW, assets.frames[fi].rect.w)
  }
  const scale = Math.min((H - 12) / maxH, (W - 8) / maxW, 1)

  const out: ApngFrame[] = []
  for (let k = 0; k < clip.frames.length; k++) {
    const meta = assets.frames[clip.frames[k]]
    const { x, y, w, h } = meta.rect
    const dw = Math.max(1, Math.round(w * scale))
    const dh = Math.max(1, Math.round(h * scale))
    const piece = await sharp(atlas)
      .extract({ left: x, top: y, width: w, height: h })
      .resize({ width: dw, height: dh, kernel: 'nearest' })
      .png()
      .toBuffer()

    let left = Math.round(originX - meta.anchor.x * scale)
    let top = Math.round(baselineY - meta.anchor.y * scale)
    left = Math.min(W - dw, Math.max(0, left))
    top = Math.min(H - dh, Math.max(0, top))

    const rgba = await sharp({ create: { width: W, height: H, channels: 4, background: CELL_BG } })
      .composite([{ input: piece, left, top }])
      .raw()
      .toBuffer()

    out.push({ rgba, width: W, height: H, delay60: clip.durations[k] ?? 8 })
  }
  return out
}

/** Encode a single clip's APNG, or null if the clip is missing. */
export async function clipApng(
  atlas: Buffer,
  assets: FighterAssets,
  clipName: string,
  cell = 220,
): Promise<Buffer | null> {
  const frames = await renderClipFrames(atlas, assets, clipName, cell)
  if (!frames) return null
  return encodeApng(frames)
}
