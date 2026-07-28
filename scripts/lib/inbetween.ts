/**
 * Frame inbetweening by optical-flow morph.
 *
 * The key poses are generated independently off one stance reference, which is
 * what keeps identity from drifting — but it is the wrong tool for the frames
 * *between* two poses. Editing an inbetween independently produces a frame that
 * is individually plausible and collectively jittery, because nothing ties it
 * to the two neighbours it is supposed to sit between. An inbetween is defined
 * by its endpoints, so it should be *derived* from them, not invented.
 *
 * So we treat it as interpolation, conditioned on both neighbours: estimate the
 * dense motion from A to B, then render the frame at parameter t by pulling each
 * output pixel from where it came from in A and where it is going in B and
 * blending. Because the endpoints are the same character, already segmented and
 * foot-registered onto the same canvas, this stays on-model for free and moves
 * mass along the motion instead of cross-dissolving (which would ghost two
 * bodies at t=0.5). It is deterministic, free and resumable — no API, no cost.
 *
 * `npx tsx scripts/lib/inbetween.ts --prove` shows the morph produces a single
 * blob at the midpoint of a translating shape where a crossfade would leave two.
 */
import sharp from 'sharp'

interface Raw {
  data: Uint8Array
  w: number
  h: number
}

async function toRaw(buf: Buffer): Promise<Raw> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), w: info.width, h: info.height }
}

/** Alpha-weighted luma at a coarse resolution, for motion estimation. */
async function lumaField(buf: Buffer, res: number): Promise<Float32Array> {
  const { data, info } = await sharp(buf)
    .resize(res, res, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const f = new Float32Array(res * res)
  const s = info.channels
  for (let i = 0; i < res * res; i++) {
    const a = data[i * s + (s - 1)] / 255
    const l = (data[i * s] * 0.299 + data[i * s + 1] * 0.587 + data[i * s + 2] * 0.114) / 255
    f[i] = l * a // background (a=0) reads as 0 so it never anchors a match
  }
  return f
}

function sampleF(f: Float32Array, res: number, x: number, y: number): number {
  if (x < 0) x = 0
  else if (x > res - 1) x = res - 1
  if (y < 0) y = 0
  else if (y > res - 1) y = res - 1
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(res - 1, x0 + 1)
  const y1 = Math.min(res - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  const a = f[y0 * res + x0]
  const b = f[y0 * res + x1]
  const c = f[y1 * res + x0]
  const d = f[y1 * res + x1]
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy
}

/** Nearest/bilinear upscale of a flow-res field to a larger res, scaling vectors. */
function upsampleFlow(src: Float32Array, from: number, to: number): Float32Array {
  const out = new Float32Array(to * to)
  const s = to / from
  for (let y = 0; y < to; y++)
    for (let x = 0; x < to; x++) out[y * to + x] = sampleF(src, from, x / s, y / s) * s
  return out
}

/**
 * One block-matching refinement pass at a single resolution, seeded by the
 * (already-upsampled) incoming flow. Searches a small window around each seed.
 */
function refine(
  A: Float32Array,
  B: Float32Array,
  res: number,
  fx: Float32Array,
  fy: Float32Array,
  radius: number,
): { fx: Float32Array; fy: Float32Array } {
  const patch = 2
  const maxDisp = res * 0.6
  const nfx = new Float32Array(res * res)
  const nfy = new Float32Array(res * res)
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const i = y * res + x
      if (A[i] < 0.02) {
        nfx[i] = fx[i]
        nfy[i] = fy[i]
        continue
      }
      let bestX = fx[i]
      let bestY = fy[i]
      let bestCost = Infinity
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const cx = fx[i] + dx
          const cy = fy[i] + dy
          if (Math.hypot(cx, cy) > maxDisp) continue
          let cost = 0
          for (let py = -patch; py <= patch; py++) {
            for (let px = -patch; px <= patch; px++) {
              const av = sampleF(A, res, x + px, y + py)
              const bv = sampleF(B, res, x + px + cx, y + py + cy)
              cost += Math.abs(av - bv)
            }
          }
          cost += Math.hypot(dx, dy) * 0.0015 // gentle bias toward the seed
          if (cost < bestCost) {
            bestCost = cost
            bestX = cx
            bestY = cy
          }
        }
      }
      nfx[i] = bestX
      nfy[i] = bestY
    }
  }
  return { fx: boxBlur(nfx, res, 2), fy: boxBlur(nfy, res, 2) }
}

/**
 * Coarse-to-fine block-matching flow A→B over an image pyramid. The pyramid is
 * what lets a large pose displacement be found at all: at the coarsest level a
 * 45px move is only a few pixels and fits in a small search window, then each
 * finer level refines it. A single-level small-window search (the first cut of
 * this) silently found nothing and degenerated to a crossfade — which the
 * --prove blob-count check caught.
 */
async function estimateFlow(aBuf: Buffer, bBuf: Buffer, finestRes: number): Promise<{ fx: Float32Array; fy: Float32Array; res: number }> {
  const levels: number[] = []
  for (let r = finestRes; r >= 16; r = Math.floor(r / 2)) levels.unshift(r)
  let fx = new Float32Array(levels[0] * levels[0])
  let fy = new Float32Array(levels[0] * levels[0])
  let prevRes = levels[0]
  for (let li = 0; li < levels.length; li++) {
    const res = levels[li]
    const [A, B] = await Promise.all([lumaField(aBuf, res), lumaField(bBuf, res)])
    if (li > 0) {
      fx = upsampleFlow(fx, prevRes, res)
      fy = upsampleFlow(fy, prevRes, res)
    }
    // Coarsest level needs a wide window to catch the whole displacement; finer
    // levels only fix up the residual.
    const radius = li === 0 ? 10 : 3
    ;({ fx, fy } = refine(A, B, res, fx, fy, radius))
    prevRes = res
  }
  return { fx, fy, res: finestRes }
}

function boxBlur(src: Float32Array, res: number, r: number): Float32Array {
  const tmp = new Float32Array(res * res)
  const out = new Float32Array(res * res)
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      let s = 0
      let n = 0
      for (let k = -r; k <= r; k++) {
        const xx = x + k
        if (xx < 0 || xx >= res) continue
        s += src[y * res + xx]
        n++
      }
      tmp[y * res + x] = s / n
    }
  }
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      let s = 0
      let n = 0
      for (let k = -r; k <= r; k++) {
        const yy = y + k
        if (yy < 0 || yy >= res) continue
        s += tmp[yy * res + x]
        n++
      }
      out[y * res + x] = s / n
    }
  }
  return out
}

export interface MorphOptions {
  /** Motion-estimation resolution. Higher is sharper flow but slower. */
  flowRes?: number
}

/**
 * Forward-splat a frame along `tt`·flow, scattering each source pixel
 * bilinearly into an accumulation buffer. Forward splatting (as opposed to
 * backward sampling of a one-sided flow) moves the actual mass along the
 * motion, so a rigid translation lands exactly with no holes and no ghost.
 */
function forwardSplat(
  raw: Raw,
  fx: Float32Array,
  fy: Float32Array,
  res: number,
  tt: number,
): { color: Float32Array; weight: Float32Array } {
  const { data, w, h } = raw
  const color = new Float32Array(w * h * 3)
  const weight = new Float32Array(w * h)
  const sx = w / res
  const sy = h / res
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3]
      if (a <= 4) continue
      const vx = sampleF(fx, res, x / sx, y / sy) * sx * tt
      const vy = sampleF(fy, res, x / sx, y / sy) * sy * tt
      const tx = x + vx
      const ty = y + vy
      const x0 = Math.floor(tx)
      const y0 = Math.floor(ty)
      const fxp = tx - x0
      const fyp = ty - y0
      const aw = a / 255
      const corners: [number, number, number][] = [
        [x0, y0, (1 - fxp) * (1 - fyp)],
        [x0 + 1, y0, fxp * (1 - fyp)],
        [x0, y0 + 1, (1 - fxp) * fyp],
        [x0 + 1, y0 + 1, fxp * fyp],
      ]
      const r = data[(y * w + x) * 4]
      const g = data[(y * w + x) * 4 + 1]
      const b = data[(y * w + x) * 4 + 2]
      for (const [cx, cy, cw] of corners) {
        if (cx < 0 || cy < 0 || cx >= w || cy >= h || cw <= 0) continue
        const wq = cw * aw
        const idx = cy * w + cx
        color[idx * 3] += r * wq
        color[idx * 3 + 1] += g * wq
        color[idx * 3 + 2] += b * wq
        weight[idx] += wq
      }
    }
  }
  return { color, weight }
}

/**
 * Render the inbetween frame at parameter `t` (0 = A, 1 = B) by flow morph.
 * Both inputs must be the same WxH RGBA (they are: registered canvases). We
 * estimate flow in BOTH directions and forward-splat A toward B and B toward A,
 * meeting at the midpoint, then blend by t.
 */
export async function morph(aBuf: Buffer, bBuf: Buffer, t: number, opts: MorphOptions = {}): Promise<Buffer> {
  const res = opts.flowRes ?? 128
  const [A, B] = await Promise.all([toRaw(aBuf), toRaw(bBuf)])
  const { w, h } = A
  const [fAB, fBA] = await Promise.all([estimateFlow(aBuf, bBuf, res), estimateFlow(bBuf, aBuf, res)])
  const sa = forwardSplat(A, fAB.fx, fAB.fy, res, t) // A moves t of the way to B
  const sb = forwardSplat(B, fBA.fx, fBA.fy, res, 1 - t) // B moves (1-t) of the way to A

  const out = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const aA = Math.min(1, sa.weight[i])
    const aB = Math.min(1, sb.weight[i])
    const wA = aA * (1 - t)
    const wB = aB * t
    const o = i * 4
    const wsum = wA + wB
    if (wsum <= 1e-4) {
      out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0
      continue
    }
    const cA = sa.weight[i] > 1e-4
    const cB = sb.weight[i] > 1e-4
    const rA = cA ? sa.color[i * 3] / sa.weight[i] : 0
    const gA = cA ? sa.color[i * 3 + 1] / sa.weight[i] : 0
    const bA = cA ? sa.color[i * 3 + 2] / sa.weight[i] : 0
    const rB = cB ? sb.color[i * 3] / sb.weight[i] : 0
    const gB = cB ? sb.color[i * 3 + 1] / sb.weight[i] : 0
    const bB = cB ? sb.color[i * 3 + 2] / sb.weight[i] : 0
    out[o] = Math.round((rA * wA + rB * wB) / wsum)
    out[o + 1] = Math.round((gA * wA + gB * wB) / wsum)
    out[o + 2] = Math.round((bA * wA + bB * wB) / wsum)
    out[o + 3] = Math.round(255 * (aA * (1 - t) + aB * t))
  }
  return closePinholes(sharp(out, { raw: { width: w, height: h, channels: 4 } }), w, h)
}

/**
 * Close 1px scatter pinholes: an alpha median-ish fill where a transparent pixel
 * is surrounded by opaque ones. Cheap and only touches isolated holes.
 */
async function closePinholes(img: sharp.Sharp, w: number, h: number): Promise<Buffer> {
  const { data } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const px = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  const out = Buffer.from(px)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (px[i * 4 + 3] > 24) continue
      let n = 0
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const j = (y + dy) * w + (x + dx)
        if (px[j * 4 + 3] > 24) {
          n++
          r += px[j * 4]
          g += px[j * 4 + 1]
          b += px[j * 4 + 2]
          a += px[j * 4 + 3]
        }
      }
      if (n >= 3) {
        out[i * 4] = Math.round(r / n)
        out[i * 4 + 1] = Math.round(g / n)
        out[i * 4 + 2] = Math.round(b / n)
        out[i * 4 + 3] = Math.round(a / n)
      }
    }
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
}

// ── Falsifiability proof ────────────────────────────────────────────────────
// The claim that separates this from a crossfade: at t=0.5 a translating shape
// morphs to a SINGLE blob at the midpoint, where a crossfade leaves TWO ghosts
// at half alpha. Prove it by counting connected blobs in the morphed alpha.
async function disc(w: number, h: number, cx: number, cy: number, r: number): Promise<Buffer> {
  const buf = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (Math.hypot(x - cx, y - cy) < r) {
        const o = (y * w + x) * 4
        buf[o] = 240
        buf[o + 1] = 80
        buf[o + 2] = 80
        buf[o + 3] = 255
      }
    }
  return sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
}

function analyzeAlpha(data: Uint8Array, w: number, h: number) {
  // Column-wise alpha mass → find distinct horizontal lobes (blobs), and the
  // alpha-weighted centroid x. A crossfade shows two lobes; a morph shows one.
  const col = new Float32Array(w)
  let mass = 0
  let cxAcc = 0
  for (let x = 0; x < w; x++) {
    let s = 0
    for (let y = 0; y < h; y++) s += data[(y * w + x) * 4 + 3]
    col[x] = s
    mass += s
    cxAcc += s * x
  }
  const peak = Math.max(...col)
  const thr = peak * 0.25
  let lobes = 0
  let inLobe = false
  for (let x = 0; x < w; x++) {
    if (col[x] > thr && !inLobe) {
      lobes++
      inLobe = true
    } else if (col[x] <= thr) inLobe = false
  }
  return { lobes, centroidX: mass ? cxAcc / mass : 0, mass }
}

async function prove(): Promise<void> {
  const W = 128
  const H = 128
  const r = 16
  const A = await disc(W, H, 34, 64, r)
  const B = await disc(W, H, 94, 64, r) // translated 60px right

  const mid = await morph(A, B, 0.5, { flowRes: 96 })
  const { data } = await sharp(mid).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const m = analyzeAlpha(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), W, H)

  // Control: a naive crossfade of the same two frames.
  const cross = await sharp(A).composite([{ input: B, blend: 'over' }]).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  // Build a real 50/50 crossfade manually (composite 'over' isn't 50/50).
  const xa = (await sharp(A).ensureAlpha().raw().toBuffer()) as Buffer
  const xb = (await sharp(B).ensureAlpha().raw().toBuffer()) as Buffer
  const xf = Buffer.alloc(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    for (let c = 0; c < 4; c++) xf[i * 4 + c] = Math.round((xa[i * 4 + c] + xb[i * 4 + c]) / 2)
  }
  const cm = analyzeAlpha(new Uint8Array(xf.buffer, xf.byteOffset, xf.byteLength), W, H)
  void cross

  const midExpected = 64
  const morphOneBlob = m.lobes === 1
  const morphCentred = Math.abs(m.centroidX - midExpected) < 10
  const crossTwoBlobs = cm.lobes === 2

  console.log(`morph   @0.5: lobes=${m.lobes} centroidX=${m.centroidX.toFixed(1)} (want 1 lobe near ${midExpected})`)
  console.log(`crossfade@0.5: lobes=${cm.lobes} centroidX=${cm.centroidX.toFixed(1)} (a crossfade splits into 2)`)
  const ok = morphOneBlob && morphCentred && crossTwoBlobs
  console.log(`\n${ok ? '✅' : '❌'} morph moves mass to a single midpoint blob; crossfade does not`)
  if (!ok) process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--prove')) prove()
  else console.log('usage: tsx scripts/lib/inbetween.ts --prove')
}
