/**
 * Shared sprite pipeline: Azure gpt-image-2 access + the segmentation and
 * registration maths that turn one-off generated poses into animation frames.
 *
 * The generator gives us a character floating somewhere on a flat #808080
 * field at an arbitrary scale. That is fine for a static portrait and useless
 * for animation — played back raw, the character swims around the screen
 * because nothing pins it to the ground. Everything below exists to fix that:
 * segment the character off the grey, find where the feet actually are, and
 * re-seat every frame on a shared origin so a sequence holds still.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

// ── Azure config ──────────────────────────────────────────────────────────
export interface AzureConfig {
  endpoint: string
  apiKey: string
  deployment: string
  apiVersion: string
}

export function loadAzureConfig(): AzureConfig {
  const gstackPath = path.join(os.homedir(), '.gstack', 'openai.json')
  let file: { azure?: Record<string, string> } = {}
  try {
    if (fs.existsSync(gstackPath)) file = JSON.parse(fs.readFileSync(gstackPath, 'utf-8'))
  } catch {
    // fall through to env
  }
  const azure = file?.azure || {}
  return {
    endpoint: (process.env.AZURE_OPENAI_ENDPOINT || azure.endpoint || '').replace(/\/$/, ''),
    apiKey: process.env.AZURE_OPENAI_API_KEY || azure.api_key || '',
    deployment:
      process.env.AZURE_OPENAI_IMAGE_DEPLOYMENT || azure.image_deployment || 'gpt-image-2',
    // Deliberately ignores azure.api_version. That file is shared with other
    // tools and pins 2024-02-01, which 404s on images/edits — only
    // 2025-04-01-preview exposes it. Since identity preservation depends
    // entirely on the edits endpoint, a stale config value must not win here.
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || EDITS_API_VERSION,
  }
}

/** The only API version that serves images/edits on this resource. */
const EDITS_API_VERSION = '2025-04-01-preview'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Azure returns 429 freely at this volume and the sprite set needs ~1000
 * generations, so a bare call is not usable. Back off and retry rather than
 * dropping frames — a missing frame is a hole in an animation.
 */
async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 6): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      const msg = (e as Error).message || ''
      const retryable = msg.includes('429') || msg.includes('500') || msg.includes('503')
        || msg.includes('timeout') || msg.includes('aborted') || msg.includes('fetch failed')
      if (!retryable || i === attempts - 1) break
      // Exponential backoff with jitter; 429s here clear on the order of tens
      // of seconds, so start high rather than at the usual 1s.
      const wait = Math.round(8000 * Math.pow(1.8, i) * (0.75 + Math.random() * 0.5))
      console.log(`    [retry ${i + 1}/${attempts - 1}] ${label}: ${msg.slice(0, 70)} — waiting ${(wait / 1000).toFixed(0)}s`)
      await sleep(wait)
    }
  }
  throw lastErr
}

/** Edit an existing sprite into a new pose, preserving character identity. */
export async function editPose(
  referencePng: Buffer,
  prompt: string,
  opts: { size?: string; quality?: string; label?: string } = {},
): Promise<Buffer> {
  const cfg = loadAzureConfig()
  if (!cfg.endpoint || !cfg.apiKey) throw new Error('Azure config not found')

  const url = `${cfg.endpoint}/openai/deployments/${cfg.deployment}/images/edits?api-version=${cfg.apiVersion}`

  return withRetry(async () => {
    const form = new FormData()
    form.append('image', new Blob([new Uint8Array(referencePng)], { type: 'image/png' }), 'ref.png')
    form.append('prompt', prompt)
    form.append('size', opts.size ?? '1024x1024')
    form.append('quality', opts.quality ?? 'high')
    form.append('n', '1')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 300_000)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'api-key': cfg.apiKey },
        body: form,
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`Azure ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const data = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> }
      const first = data.data?.[0]
      if (!first) throw new Error('No image in response')
      if (first.b64_json) return Buffer.from(first.b64_json, 'base64')
      if (first.url) return Buffer.from(await (await fetch(first.url)).arrayBuffer())
      throw new Error('No b64 or url in response')
    } finally {
      clearTimeout(timeout)
    }
  }, opts.label ?? 'editPose')
}

/**
 * Run tasks with bounded concurrency. The image endpoint rate-limits hard, so
 * firing a whole fighter's frame set at once just burns retries.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++
        if (i >= items.length) return
        out[i] = await fn(items[i], i)
      }
    }),
  )
  return out
}

// ── Segmentation ──────────────────────────────────────────────────────────
/**
 * Knock the flat grey field out to alpha.
 *
 * Plain colour-distance thresholding also eats the character's own grey
 * pixels — shoe rubber, steel props, hair highlights — and punches holes
 * through the middle of the sprite. So we only treat grey as background when
 * it is reachable from the border: flood fill inward from the edges and stop
 * at the outline. Interior greys keep their alpha because nothing outside can
 * reach them.
 */
export async function removeFlatBackground(
  png: Buffer,
  opts: { tolerance?: number } = {},
): Promise<Buffer> {
  const tol = opts.tolerance ?? 42
  const img = sharp(png).ensureAlpha()
  const { width, height } = await img.metadata()
  if (!width || !height) throw new Error('bad image')
  const raw = await img.raw().toBuffer()

  // Sample the border to learn the actual background colour rather than
  // trusting #808080 — the generator drifts a few values either way.
  let br = 0, bg = 0, bb = 0, n = 0
  const sample = (x: number, y: number) => {
    const i = (y * width + x) * 4
    br += raw[i]; bg += raw[i + 1]; bb += raw[i + 2]; n++
  }
  for (let x = 0; x < width; x += 4) { sample(x, 0); sample(x, height - 1) }
  for (let y = 0; y < height; y += 4) { sample(0, y); sample(width - 1, y) }
  br /= n; bg /= n; bb /= n

  const isBg = (i: number) => {
    const dr = raw[i] - br, dg = raw[i + 1] - bg, db = raw[i + 2] - bb
    return Math.sqrt(dr * dr + dg * dg + db * db) <= tol
  }

  // Flood fill from every border pixel that reads as background.
  const seen = new Uint8Array(width * height)
  const stack: number[] = []
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const p = y * width + x
    if (seen[p]) return
    if (!isBg(p * 4)) return
    seen[p] = 1
    stack.push(p)
  }
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1) }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y) }
  while (stack.length) {
    const p = stack.pop()!
    const x = p % width, y = (p / width) | 0
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1)
  }

  // Enclosed pockets. A fist cocked beside the hip, or the triangle between a
  // pulled-back arm and the torso, is background the border fill can never
  // reach — the silhouette walls it off. Left opaque it renders as a grey slab
  // welded to the character, so sweep the remaining background-coloured
  // components too.
  //
  // Selection is by colour distance and size, not by flatness. Flatness was
  // the obvious guard and it silently failed: a real pocket measured a
  // luminance spread of 26 because the boundary ring where background meets
  // the character's dark outline is anti-aliased, even though the interior is
  // perfectly uniform. The tight tolerance below is what does the actual work
  // — at 0.55x the base tolerance the arm-gap pocket was the only component
  // over 20px in the frame, with genuine character greys (shoe rubber, denim
  // shading) all falling outside it.
  const pocketTol = tol * 0.55
  const isPocketBg = (i: number) => {
    const dr = raw[i] - br, dg = raw[i + 1] - bg, db = raw[i + 2] - bb
    return Math.sqrt(dr * dr + dg * dg + db * db) <= pocketTol
  }
  // A pocket bigger than this is not a limb gap — it means the border fill
  // failed and we are about to delete the character. Refuse.
  const maxPocket = width * height * 0.12

  for (let start = 0; start < width * height; start++) {
    if (seen[start] || !isPocketBg(start * 4)) continue
    const comp: number[] = []
    const queue = [start]
    seen[start] = 2
    while (queue.length) {
      const p = queue.pop()!
      comp.push(p)
      const x = p % width, y = (p / width) | 0
      const nb: Array<[number, number]> = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const q = ny * width + nx
        if (seen[q] || !isPocketBg(q * 4)) continue
        seen[q] = 2
        queue.push(q)
      }
    }
    // Too small to be a limb gap (stray dither inside the artwork), or too
    // large to be anything but a segmentation failure — leave it opaque.
    if (comp.length < 24 || comp.length > maxPocket) {
      for (const p of comp) seen[p] = 0
    }
  }

  const out = Buffer.from(raw)
  for (let p = 0; p < width * height; p++) if (seen[p]) out[p * 4 + 3] = 0
  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer()
}

// ── Registration ──────────────────────────────────────────────────────────
export interface Anchor {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
  /** Horizontal centre of the ground-contact band — the pivot to align on. */
  footX: number
}

/**
 * Above this width/height ratio a pose is treated as prone (a knockdown, a
 * sprawled KO) rather than upright, and the horizontal pivot switches rule.
 * Upright poses here top out around 1.0 (a crouch); prone poses measure 2.5-3.4.
 */
export const WIDE_ASPECT = 1.5
/** Fraction of silhouette height, measured up from the floor, that counts as the
 *  ground-contact mass for a prone pose. */
export const CONTACT_FRAC = 0.4

/**
 * The horizontal pivot the whole pipeline aligns on, given an alpha sampler and
 * the silhouette's bounding box. ONE implementation, shared by registration
 * (`findAnchor`) and the atlas re-derivation (`assertAnchorsPreserved`), so the
 * two can never drift apart on the definition of "the point it stands on".
 *
 * Upright pose (tall): the midpoint of the ground-contact band (bottom slice).
 * Bounding-box centre reads as a limp when animated — a thrown punch widens the
 * box to the right and drags the whole body left — whereas the bottom band
 * tracks the feet and barely moves when the arms do.
 *
 * Prone pose (wide): that band is no longer "the feet". It is a long horizontal
 * strip whose left/right extremes are sprawled limb tips, and those extremes are
 * NOT preserved through the registration resize — a 3.4-aspect knockdown drifts
 * 19.5px between being pinned and being re-derived. So a prone pose registers on
 * the alpha-weighted centroid of its lower contact mass instead: mass-weighted,
 * so a thin flung limb barely moves it, and linear under scaling, so it survives
 * the resize (measured <0.6px self-drift on every pose, upright and prone).
 */
export function footAnchorX(
  alphaAt: (x: number, y: number) => number,
  left: number,
  right: number,
  top: number,
  bottom: number,
  alphaThreshold = 8,
): number {
  const bboxW = right - left + 1
  const bboxH = bottom - top + 1
  const aspect = bboxW / bboxH

  if (aspect >= WIDE_ASPECT) {
    // Prone: alpha-weighted centroid of the bottom CONTACT_FRAC of the body.
    const yStart = Math.max(top, Math.round(bottom - CONTACT_FRAC * bboxH))
    let sumX = 0, mass = 0
    for (let y = yStart; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const al = alphaAt(x, y)
        if (al <= alphaThreshold) continue
        sumX += x * al
        mass += al
      }
    }
    if (mass > 0) return sumX / mass
  }

  // Upright: midpoint of the ground-contact band (bottom 6%, min 3px).
  const bandH = Math.max(3, Math.round(bboxH * 0.06))
  let fl = Infinity, fr = -Infinity
  for (let y = bottom; y > bottom - bandH && y >= 0; y--) {
    for (let x = left; x <= right; x++) {
      if (alphaAt(x, y) <= alphaThreshold) continue
      if (x < fl) fl = x
      if (x > fr) fr = x
    }
  }
  return fr >= 0 ? (fl + fr) / 2 : (left + right) / 2
}

/**
 * Locate the character and, crucially, the point it stands on. The horizontal
 * pivot rule (upright band vs prone contact-centroid) lives in `footAnchorX`,
 * shared with the atlas anchor check.
 */
export async function findAnchor(pngWithAlpha: Buffer, alphaThreshold = 8): Promise<Anchor> {
  const { data, info } = await sharp(pngWithAlpha)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width, height } = info

  let left = width, right = -1, top = height, bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= alphaThreshold) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  if (right < 0) throw new Error('empty sprite after segmentation')

  const footX = footAnchorX(
    (x, y) => data[(y * width + x) * 4 + 3],
    left, right, top, bottom, alphaThreshold,
  )

  return { left, right, top, bottom, width: right - left + 1, height: bottom - top + 1, footX }
}

/**
 * Re-seat a frame on a shared canvas so its feet land on a fixed origin and
 * its height matches a common scale. This is what makes a sequence animate
 * instead of swim.
 *
 * `heightRatio` lets a caller preserve deliberate height changes (a crouch is
 * genuinely shorter than a stance) instead of stretching every pose to the
 * same size — pass the pose's height relative to the neutral stance.
 */
export async function registerFrame(
  pngWithAlpha: Buffer,
  opts: {
    canvasW: number
    canvasH: number
    /** Target silhouette height in px for a neutral standing pose. */
    targetHeight: number
    /** Where the feet sit on the canvas. */
    originX: number
    originY: number
    /** Pose height relative to neutral (1 = same height as stance). */
    heightRatio?: number
  },
): Promise<Buffer> {
  const a = await findAnchor(pngWithAlpha)
  const desired = opts.targetHeight * (opts.heightRatio ?? 1)

  // Start from the height-matching scale, then cap it so the whole silhouette
  // still fits on the canvas once it is pinned by its foot pivot at the origin.
  //
  // A wide-and-short pose (a lying knockdown, a full roundhouse) scaled purely
  // to hit a target *height* balloons in *width* — enough to spill past the
  // canvas edge, which is exactly the "Image to composite must have same
  // dimensions or smaller" crash sharp throws. The wrong fix is to clamp the
  // composite position: that slides the feet off the shared origin and every
  // frame swims again. Instead we shrink the pose just enough that, placed with
  // its foot pivot exactly on (originX, originY), it clears all four edges. The
  // pivot never moves, so registration stays pixel-exact; only an oversized
  // pose loses a little size.
  const m = 2 // keep a hair of margin off every edge
  const leftReach = a.footX - a.left // px from bbox-left to the foot pivot
  const rightReach = a.width - leftReach // px from the pivot to bbox-right
  const limits = [desired / a.height]
  if (leftReach > 0) limits.push((opts.originX - m) / leftReach)
  if (rightReach > 0) limits.push((opts.canvasW - opts.originX - m) / rightReach)
  limits.push((opts.originY - m) / a.height) // top edge (feet at originY, head up)
  limits.push((opts.canvasH - m) / a.height) // total height sanity
  const scale = Math.max(1e-3, Math.min(...limits))

  const scaledW = Math.max(1, Math.round(a.width * scale))
  const scaledH = Math.max(1, Math.round(a.height * scale))
  const cropped = await sharp(pngWithAlpha)
    .extract({ left: a.left, top: a.top, width: a.width, height: a.height })
    .resize({ width: scaledW, height: scaledH, kernel: 'nearest' })
    .toBuffer()

  // Foot pivot in the cropped+scaled frame, then offset so it hits the origin.
  // The scale cap above guarantees these stay within [0, canvas - size], but
  // clamp defensively so a rounding pixel can never re-trigger the crash.
  const footInCrop = leftReach * scale
  const left = Math.min(opts.canvasW - scaledW, Math.max(0, Math.round(opts.originX - footInCrop)))
  const top = Math.min(opts.canvasH - scaledH, Math.max(0, Math.round(opts.originY - scaledH)))

  return sharp({
    create: {
      width: opts.canvasW,
      height: opts.canvasH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: cropped, left, top }])
    .png()
    .toBuffer()
}
