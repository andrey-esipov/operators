import type { FighterAssets, SpriteFrameMeta, Box } from '../../fight/types'

/**
 * Harness-only atlas builder. NOT the real sprite pipeline — that lands via
 * `scripts/**` and emits `FighterAssets` directly. This exists so the renderer
 * can be driven and judged before the pipeline is ready. It takes the four
 * static pose PNGs a fighter already ships (stance/attack/win/lose, rendered on
 * a grey chroma-key) and packs them into one atlas with correct per-frame rects
 * and feet anchors, exactly matching the frozen contract.
 *
 * The important, non-fake part is the registration maths: the feet anchor is
 * measured from the actual silhouette (the horizontal centre of the bottom-most
 * body rows), so a pose that leans doesn't drag the body sideways when it plays.
 */

const POSES = ['stance', 'attack', 'win', 'lose'] as const
const PAD = 18 // gutter so the atlas builder's dilate/feather never crosses frames
const MARGIN = 14 // breathing room around each cropped silhouette

interface Extracted {
  canvas: HTMLCanvasElement
  w: number
  h: number
  /** Feet in px from the crop's top-left. */
  feetX: number
  feetY: number
}

function isBackdrop(r: number, g: number, b: number): boolean {
  const nearMid = Math.abs(r - 128) < 34 && Math.abs(g - 128) < 34 && Math.abs(b - 128) < 34
  const neutral = Math.abs(r - g) < 18 && Math.abs(g - b) < 18 && Math.abs(r - b) < 18
  return nearMid && neutral
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`mockAtlas: failed to load ${url}`))
    img.src = url
  })
}

function extract(img: HTMLImageElement): Extracted {
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  const c = document.createElement('canvas')
  c.width = iw
  c.height = ih
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, iw, ih).data

  const hasAlpha = (() => {
    for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true
    return false
  })()

  let minX = iw, minY = ih, maxX = 0, maxY = 0, any = false
  const solid = (x: number, y: number): boolean => {
    const i = (y * iw + x) * 4
    if (hasAlpha) return data[i + 3] > 128
    return !isBackdrop(data[i], data[i + 1], data[i + 2])
  }
  for (let y = 0; y < ih; y++) {
    for (let x = 0; x < iw; x++) {
      if (!solid(x, y)) continue
      any = true
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (!any) {
    minX = 0; minY = 0; maxX = iw - 1; maxY = ih - 1
  }

  const bx = Math.max(0, minX - MARGIN)
  const by = Math.max(0, minY - MARGIN)
  const bw = Math.min(iw, maxX + MARGIN) - bx + 1
  const bh = Math.min(ih, maxY + MARGIN) - by + 1

  // Feet: mean x of the solid pixels in the bottom few rows of the silhouette,
  // so an off-centre or leaning pose still pivots on the actual foot contact.
  const footBandTop = Math.max(minY, maxY - Math.round((maxY - minY) * 0.06) - 2)
  let sumX = 0, count = 0
  for (let y = footBandTop; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) if (solid(x, y)) { sumX += x; count++ }
  }
  const feetImgX = count > 0 ? sumX / count : (minX + maxX) / 2
  const feetImgY = maxY + 1 // the ground line sits just below the lowest pixel

  // Copy the crop into its own canvas, KEEPING the grey backdrop — the atlas
  // texture builder re-keys it and handles the halo-safe feather/dilate.
  const out = document.createElement('canvas')
  out.width = bw
  out.height = bh
  const octx = out.getContext('2d')!
  octx.drawImage(c, bx, by, bw, bh, 0, 0, bw, bh)

  return {
    canvas: out,
    w: bw,
    h: bh,
    feetX: feetImgX - bx,
    feetY: feetImgY - by,
  }
}

export interface MockAtlas {
  assets: FighterAssets
  atlas: HTMLCanvasElement
}

/**
 * Build a contract-faithful `FighterAssets` + packed atlas canvas for one
 * fighter id from its four pose PNGs under `public/sprites/<id>/`.
 */
export async function buildMockAtlas(id: string, heightCm = 178): Promise<MockAtlas> {
  const imgs = await Promise.all(POSES.map((p) => loadImage(`/sprites/${id}/${p}.png`)))
  const cuts = imgs.map(extract)

  // Pack in a horizontal strip; atlas height is the tallest frame.
  let atlasW = PAD
  let atlasH = 0
  for (const c of cuts) {
    atlasW += c.w + PAD
    atlasH = Math.max(atlasH, c.h)
  }
  atlasH += PAD * 2

  const atlas = document.createElement('canvas')
  atlas.width = atlasW
  atlas.height = atlasH
  const actx = atlas.getContext('2d')!
  // Fill the gutters with the same neutral grey so the chroma-key treats the
  // whole margin as backdrop rather than leaving black seams.
  actx.fillStyle = 'rgb(128,128,128)'
  actx.fillRect(0, 0, atlasW, atlasH)

  const frames: SpriteFrameMeta[] = []
  let cx = PAD
  cuts.forEach((c, i) => {
    const rect: Box = { x: cx, y: PAD, w: c.w, h: c.h }
    actx.drawImage(c.canvas, cx, PAD)
    frames.push({ name: POSES[i], rect, anchor: { x: c.feetX, y: c.feetY } })
    cx += c.w + PAD
  })

  const idx = (name: (typeof POSES)[number]) => POSES.indexOf(name)

  const clips: FighterAssets['clips'] = {
    idle: { frames: [idx('stance')], durations: [1], loop: true },
    stance: { frames: [idx('stance')], durations: [1], loop: true },
    walk: { frames: [idx('stance')], durations: [1], loop: true },
    crouch: { frames: [idx('stance')], durations: [1], loop: true },
    jump: { frames: [idx('stance')], durations: [1], loop: false },
    attack: { frames: [idx('attack')], durations: [1], loop: false },
    guard: { frames: [idx('stance')], durations: [1], loop: false },
    hurt: { frames: [idx('lose')], durations: [1], loop: false },
    juggle: { frames: [idx('lose')], durations: [1], loop: false },
    knockdown: { frames: [idx('lose')], durations: [1], loop: false },
    ko: { frames: [idx('lose')], durations: [1], loop: false },
    lose: { frames: [idx('lose')], durations: [1], loop: false },
    win: { frames: [idx('win')], durations: [1], loop: true },
  }

  const assets: FighterAssets = {
    id,
    atlas: `mock:${id}`,
    frames,
    clips,
    heightCm,
  }
  return { assets, atlas }
}
