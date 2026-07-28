/**
 * Procedural "impact-frame" spark sheet — the bold single graphic that lands at
 * the contact point on a hit, on TOP of the fine particle burst.
 *
 * WHY PROCEDURAL, NOT gpt-image-2 (same reasoning as generate-projectiles.ts).
 * An impact mark has no identity to preserve, must read instantly against a busy
 * stage as one deliberate drawn shape (a star / slash / shatter), and wants
 * pixel-exact control of its spikes and hot core, not a prompt. So each mark is
 * drawn from maths: additive glows + tapering spikes.
 *
 * DESIGN. The sheet is drawn in WHITE (luminance carries the SHAPE only). The
 * HUE is applied at runtime by ImpactFlash with a deliberately channel-weighted
 * tint (red pushed >1, blue suppressed) so additive blending + bloom saturate
 * the mark WARMER instead of washing it to a featureless white orb — the exact
 * lesson of the Ion Storm super fix (commit 12c4d0b). One white sheet therefore
 * serves every weight; the sim's HitLevel picks which mark, how big, and the
 * tint. A jab and a heavy never produce the same mark: different shape, size,
 * hue and lifetime.
 *
 * Output under public/impact/sparks/:
 *   - atlas.png   — horizontal strip of every mark (one 128px cell each)
 *   - frames.json — { sheet, atlas, frameW, frameH, marks[] } (rects in px)
 * Review APNG (gitignored) under public/impact/sparks/review/ shows the marks
 * warm-tinted so they are eyeballable without the game.
 *
 * Marks (indices are the contract ImpactFlash + FightVfx map weight onto):
 *   0 star4    — crisp 4-point star           (light jab: small, fast)
 *   1 burst6   — 6-point hit star             (medium)
 *   2 impact8  — bold 8-point POW star        (heavy / crumple)
 *   3 slash    — directional cut streak       (sweep)
 *   4 shatter  — jagged asymmetric shard burst (launcher)
 *
 *   npx tsx scripts/generate-impact-sparks.ts          # generate the sheet
 *   npx tsx scripts/generate-impact-sparks.ts --prove  # prove every validator can fail
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { encodeApng, type ApngFrame } from './lib/apng'

type Vec3 = [number, number, number]

interface Frame {
  rgba: Buffer
  w: number
  h: number
}

const TAU = Math.PI * 2
const CELL = 128

// ── Drawing field: additive luminance, alpha = brightest coverage seen ───────
class Field {
  r: Float32Array
  g: Float32Array
  b: Float32Array
  a: Float32Array
  constructor(public w: number, public h: number) {
    const n = w * h
    this.r = new Float32Array(n)
    this.g = new Float32Array(n)
    this.b = new Float32Array(n)
    this.a = new Float32Array(n)
  }

  /** Isotropic gaussian glow, added (overlaps blow out to white, as a hot core
   *  should); alpha takes the max weight so the glow fades to transparent. */
  glow(cx: number, cy: number, sigma: number, color: Vec3, intensity: number): void {
    const reach = Math.ceil(sigma * 3) + 1
    const x0 = Math.max(0, Math.floor(cx - reach))
    const x1 = Math.min(this.w - 1, Math.ceil(cx + reach))
    const y0 = Math.max(0, Math.floor(cy - reach))
    const y1 = Math.min(this.h - 1, Math.ceil(cy + reach))
    const inv2s2 = 1 / (2 * sigma * sigma)
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx
        const dy = y - cy
        const w = Math.exp(-(dx * dx + dy * dy) * inv2s2) * intensity
        if (w < 0.004) continue
        const i = y * this.w + x
        this.r[i] += color[0] * w
        this.g[i] += color[1] * w
        this.b[i] += color[2] * w
        if (w > this.a[i]) this.a[i] = w
      }
    }
  }

  /** A tapering spike: a straight run of shrinking glows from the core outward
   *  along `angle`. Bright, narrow base → thin, dim tip = a crisp radial ray. */
  spike(cx: number, cy: number, angle: number, length: number, baseSigma: number, color: Vec3, intensity: number): void {
    const steps = Math.max(6, Math.round(length / 2))
    const ca = Math.cos(angle)
    const sa = Math.sin(angle)
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      const d = t * length
      // Sigma tapers to a thin tip; intensity falls off faster than linear so the
      // spike reads as a sharp ray, not a fat wedge.
      const sigma = baseSigma * (1 - 0.82 * t) + 0.6
      const inten = intensity * Math.pow(1 - t, 1.35)
      this.glow(cx + ca * d, cy + sa * d, sigma, color, inten)
    }
  }

  toRGBA(tint: Vec3 = [1, 1, 1]): Buffer {
    const n = this.w * this.h
    const out = Buffer.alloc(n * 4)
    for (let i = 0; i < n; i++) {
      out[i * 4] = Math.min(255, this.r[i] * tint[0])
      out[i * 4 + 1] = Math.min(255, this.g[i] * tint[1])
      out[i * 4 + 2] = Math.min(255, this.b[i] * tint[2])
      out[i * 4 + 3] = Math.min(255, this.a[i] * 255)
    }
    return out
  }
}

const WHITE: Vec3 = [255, 255, 255]
// Bright, but capped below full so the drawn core is a hot near-white pin rather
// than a baked pure-white disc — the runtime tint (not the art) owns whether the
// bloomed result saturates warm or washes out.
const CORE: Vec3 = [235, 235, 235]

/** Bright core + a ring of `points` tapering spikes. `jitterLen`/`jitterAng`
 *  add controlled irregularity so a shatter reads as chaos, a star as order. */
function starMark(points: number, spikeLen: number, baseSigma: number, coreSigma: number, opts: {
  secondary?: number // extra shorter spikes offset between the primaries
  jitterLen?: number
  jitterAng?: number
  seed?: number
} = {}): Frame {
  const f = new Field(CELL, CELL)
  const cx = CELL / 2
  const cy = CELL / 2
  const seed = opts.seed ?? 1
  const rnd = (k: number) => {
    const s = Math.sin(seed * 91.7 + k * 12.9898) * 43758.5453
    return s - Math.floor(s) // 0..1 deterministic
  }
  for (let p = 0; p < points; p++) {
    const jAng = ((opts.jitterAng ?? 0) * (rnd(p) - 0.5)) * TAU
    const ang = (p / points) * TAU + jAng
    const jl = 1 + (opts.jitterLen ?? 0) * (rnd(p + 100) - 0.5) * 2
    f.spike(cx, cy, ang, spikeLen * jl, baseSigma, WHITE, 0.95)
  }
  if (opts.secondary) {
    for (let p = 0; p < opts.secondary; p++) {
      const ang = ((p + 0.5) / opts.secondary) * TAU
      f.spike(cx, cy, ang, spikeLen * 0.55, baseSigma * 0.7, WHITE, 0.6)
    }
  }
  // Hot core: a soft mid halo under a tight bright pin.
  f.glow(cx, cy, coreSigma * 2.2, WHITE, 0.5)
  f.glow(cx, cy, coreSigma, CORE, 1.15)
  return { rgba: f.toRGBA(), w: CELL, h: CELL }
}

/** A directional cut: one bold elongated streak plus a fainter parallel one and
 *  a hot glint where they cross. Drawn along the diagonal so the runtime can
 *  rotate it to the blow direction. */
function slashMark(): Frame {
  const f = new Field(CELL, CELL)
  const cx = CELL / 2
  const cy = CELL / 2
  const ang = -Math.PI / 5 // authored diagonal; runtime rotates to the blow
  // Two-sided main streak: spikes out both ways from the centre so it's a full
  // cut, not a half-ray. The near half is fatter (the "entry" of the slash).
  f.spike(cx, cy, ang, 52, 4.2, WHITE, 1.0)
  f.spike(cx, cy, ang + Math.PI, 40, 3.0, WHITE, 0.85)
  // A thinner parallel streak, offset perpendicular, for a layered blade read.
  const px = Math.cos(ang + Math.PI / 2) * 9
  const py = Math.sin(ang + Math.PI / 2) * 9
  f.spike(cx + px, cy + py, ang, 34, 2.0, WHITE, 0.6)
  f.spike(cx + px, cy + py, ang + Math.PI, 26, 1.6, WHITE, 0.5)
  // Hot glint at the crossing.
  f.glow(cx, cy, 7, WHITE, 0.55)
  f.glow(cx, cy, 3.2, CORE, 1.2)
  return { rgba: f.toRGBA(), w: CELL, h: CELL }
}

interface MarkSpec { name: string; make: () => Frame }

const MARKS: MarkSpec[] = [
  { name: 'star4', make: () => starMark(4, 40, 3.4, 4.5, { secondary: 4, seed: 2 }) },
  { name: 'burst6', make: () => starMark(6, 46, 3.6, 5.2, { secondary: 6, seed: 3 }) },
  { name: 'impact8', make: () => starMark(8, 52, 4.0, 6.0, { secondary: 8, jitterLen: 0.18, seed: 4 }) },
  { name: 'slash', make: () => slashMark() },
  { name: 'shatter', make: () => starMark(7, 50, 4.4, 5.0, { jitterLen: 0.6, jitterAng: 0.16, seed: 7 }) },
]

// ── validators (each returns a raw number; thresholds live in checks) ────────
function coverage(fr: Frame): number {
  let lit = 0
  for (let i = 0; i < fr.w * fr.h; i++) if (fr.rgba[i * 4 + 3] > 40) lit++
  return lit / (fr.w * fr.h)
}

/** 99th-percentile luma among visible pixels — proves a genuine hot core. */
function coreLuma(fr: Frame): number {
  const lum: number[] = []
  for (let i = 0; i < fr.w * fr.h; i++) {
    const a = fr.rgba[i * 4 + 3]
    if (a <= 40) continue
    lum.push(0.299 * fr.rgba[i * 4] + 0.587 * fr.rgba[i * 4 + 1] + 0.114 * fr.rgba[i * 4 + 2])
  }
  if (!lum.length) return 0
  lum.sort((a, b) => a - b)
  return lum[Math.floor(lum.length * 0.99)]
}

/** Radial anisotropy: bin the luminance in a radial band (excluding the
 *  isotropic core) into angular bins and return peak/mean. A star concentrates
 *  its energy into a few angular bins (its spikes) → well above 1; a uniform
 *  disc spreads evenly → ~1. Integrating over a BAND (not a single ring) makes
 *  it robust to how long each mark's spikes are. This is what proves the mark is
 *  a SHAPED graphic, not a soft blob. */
function spikiness(fr: Frame): number {
  const cx = fr.w / 2
  const cy = fr.h / 2
  const rMin = fr.w * 0.11
  const rMax = fr.w * 0.44
  const BINS = 72
  const bins = new Float64Array(BINS)
  for (let y = 0; y < fr.h; y++) {
    for (let x = 0; x < fr.w; x++) {
      const dx = x - cx
      const dy = y - cy
      const r = Math.hypot(dx, dy)
      if (r < rMin || r > rMax) continue
      const p = (y * fr.w + x) * 4
      const lum = (0.299 * fr.rgba[p] + 0.587 * fr.rgba[p + 1] + 0.114 * fr.rgba[p + 2]) * (fr.rgba[p + 3] / 255)
      const ang = Math.atan2(dy, dx)
      const bin = (Math.floor(((ang + Math.PI) / TAU) * BINS) % BINS + BINS) % BINS
      bins[bin] += lum
    }
  }
  let sum = 0
  let peak = 0
  for (let i = 0; i < BINS; i++) {
    sum += bins[i]
    if (bins[i] > peak) peak = bins[i]
  }
  const mean = sum / BINS
  return mean > 1 ? peak / mean : 0
}

function meanAbsDiff(a: Frame, b: Frame): number {
  let s = 0
  const n = a.w * a.h * 4
  for (let i = 0; i < n; i++) s += Math.abs(a.rgba[i] - b.rgba[i])
  return s / n
}

interface Check { name: string; ok: boolean; value: string }

function checkMark(name: string, fr: Frame): Check[] {
  const cov = coverage(fr)
  const core = coreLuma(fr)
  const spk = spikiness(fr)
  return [
    { name: `${name}: coverage in [1%,55%]`, ok: cov >= 0.01 && cov <= 0.55, value: `${(cov * 100).toFixed(2)}%` },
    { name: `${name}: hot core (p99 luma >= 220)`, ok: core >= 220, value: core.toFixed(0) },
    { name: `${name}: shaped not blob (spikiness >= 1.6)`, ok: spk >= 1.6, value: spk.toFixed(2) },
  ]
}

// ── output ───────────────────────────────────────────────────────────────────
interface MarkMeta { name: string; rect: { x: number; y: number; w: number; h: number } }

async function writeSheet(frames: Frame[], outDir: string): Promise<void> {
  const PAD = 4
  const atlasW = frames.length * (CELL + PAD) + PAD
  const atlasH = CELL + PAD * 2
  const atlas = Buffer.alloc(atlasW * atlasH * 4)
  const marks: MarkMeta[] = []
  let cx = PAD
  for (let m = 0; m < frames.length; m++) {
    const frame = frames[m]
    for (let y = 0; y < CELL; y++) {
      const srcOff = y * CELL * 4
      const dstOff = ((y + PAD) * atlasW + cx) * 4
      frame.rgba.copy(atlas, dstOff, srcOff, srcOff + CELL * 4)
    }
    marks.push({ name: MARKS[m].name, rect: { x: cx, y: PAD, w: CELL, h: CELL } })
    cx += CELL + PAD
  }

  fs.mkdirSync(outDir, { recursive: true })
  await sharp(atlas, { raw: { width: atlasW, height: atlasH, channels: 4 } }).png().toFile(path.join(outDir, 'atlas.png'))
  const manifest = {
    sheet: 'impact-sparks',
    atlas: 'atlas.png',
    frameW: CELL,
    frameH: CELL,
    // Marks are drawn WHITE; the runtime applies a channel-weighted tint per
    // hit weight. Index order is the contract FightVfx maps HitLevel onto.
    marks,
  }
  fs.writeFileSync(path.join(outDir, 'frames.json'), JSON.stringify(manifest, null, 2))

  // Review APNG (gitignored): warm-tint each white mark so it's eyeballable, and
  // cycle through them.
  const reviewDir = path.join(outDir, 'review')
  fs.mkdirSync(reviewDir, { recursive: true })
  const warm: Vec3 = [1, 0.62, 0.3]
  const af: ApngFrame[] = MARKS.map((spec) => {
    const f = spec.make() // re-render to apply the review tint via toRGBA
    return { rgba: retint(f, warm), width: CELL, height: CELL, delay60: 24 }
  })
  fs.writeFileSync(path.join(reviewDir, 'marks.png'), encodeApng(af))
}

/** Re-tint a white-drawn frame's RGB for review previews (alpha untouched). */
function retint(fr: Frame, tint: Vec3): Buffer {
  const out = Buffer.from(fr.rgba)
  for (let i = 0; i < fr.w * fr.h; i++) {
    out[i * 4] = Math.min(255, fr.rgba[i * 4] * tint[0])
    out[i * 4 + 1] = Math.min(255, fr.rgba[i * 4 + 1] * tint[1])
    out[i * 4 + 2] = Math.min(255, fr.rgba[i * 4 + 2] * tint[2])
  }
  return out
}

// ── prove mode: every validator must go RED on the failure it guards ─────────
function solidFrame(rgb: Vec3, alpha: number): Frame {
  const rgba = Buffer.alloc(CELL * CELL * 4)
  for (let i = 0; i < CELL * CELL; i++) {
    rgba[i * 4] = rgb[0]; rgba[i * 4 + 1] = rgb[1]; rgba[i * 4 + 2] = rgb[2]; rgba[i * 4 + 3] = alpha
  }
  return { rgba, w: CELL, h: CELL }
}

/** A uniform centred disc: bright core, NO spikes — the "soft blob" a real mark
 *  must beat on the spikiness validator. */
function discFrame(): Frame {
  const f = new Field(CELL, CELL)
  f.glow(CELL / 2, CELL / 2, CELL * 0.34, WHITE, 1.2)
  return { rgba: f.toRGBA(), w: CELL, h: CELL }
}

function prove(): number {
  console.log('=== proving impact-spark validators can FAIL ===\n')
  const good = MARKS[2].make() // impact8 — the boldest mark
  let allProven = true
  const line = (label: string, passOnGood: boolean, failOnBad: boolean, gv: string, bv: string) => {
    const proven = passOnGood && failOnBad
    if (!proven) allProven = false
    console.log(`  [${proven ? 'PROVEN' : 'BROKEN'}] ${label}`)
    console.log(`      good input  -> ${passOnGood ? 'pass' : 'FAIL'} (${gv})`)
    console.log(`      bad  input  -> ${failOnBad ? 'fail' : 'PASS'} (${bv})   <- must fail`)
  }

  // 1. coverage: a blank frame has zero coverage
  {
    const blank = solidFrame([0, 0, 0], 0)
    const g = coverage(good), badv = coverage(blank)
    line('coverage rejects a blank frame', g >= 0.01 && g <= 0.55, !(badv >= 0.01 && badv <= 0.55), `${(g * 100).toFixed(2)}%`, `${(badv * 100).toFixed(2)}%`)
  }
  // 2. hot core: a dim uniform fill has no near-white core
  {
    const dim = solidFrame([40, 40, 40], 255)
    const g = coreLuma(good), badv = coreLuma(dim)
    line('hot-core rejects a dim uniform fill', g >= 220, !(badv >= 220), g.toFixed(0), badv.toFixed(0))
  }
  // 3. spikiness: a uniform disc is not a shaped star
  {
    const disc = discFrame()
    const g = spikiness(good), badv = spikiness(disc)
    line('spikiness rejects a soft blob', g >= 1.6, !(badv >= 1.6), g.toFixed(2), badv.toFixed(2))
  }
  // 4. distinctness: two identical marks are not distinct
  {
    const diffOk = MARKS.map((m) => m.make())
    let minPair = Infinity
    for (let i = 0; i < diffOk.length; i++) {
      for (let j = i + 1; j < diffOk.length; j++) minPair = Math.min(minPair, meanAbsDiff(diffOk[i], diffOk[j]))
    }
    const dup = meanAbsDiff(good, MARKS[2].make()) // same mark twice
    line('distinctness rejects identical marks', minPair >= 1.0, !(dup >= 1.0), minPair.toFixed(3), dup.toFixed(3))
  }

  console.log(`\n${allProven ? 'ALL VALIDATORS PROVEN FAIL-CAPABLE' : 'SOME VALIDATORS NEVER FAILED — do not trust them'}`)
  return allProven ? 0 : 1
}

async function main(): Promise<void> {
  if (process.argv.includes('--prove')) {
    process.exit(prove())
  }
  const frames = MARKS.map((m) => m.make())

  // Gate: every mark must pass its checks before we write the sheet.
  let ok = true
  const distinct: number[] = []
  for (let i = 0; i < frames.length; i++) {
    for (const c of checkMark(MARKS[i].name, frames[i])) {
      console.log(`  ${c.ok ? 'ok ' : 'XX '} ${c.name} = ${c.value}`)
      if (!c.ok) ok = false
    }
  }
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) distinct.push(meanAbsDiff(frames[i], frames[j]))
  }
  const minDistinct = Math.min(...distinct)
  const distinctOk = minDistinct >= 1.0
  console.log(`  ${distinctOk ? 'ok ' : 'XX '} marks pairwise-distinct (min meanAbsDiff >= 1.0) = ${minDistinct.toFixed(3)}`)
  if (!distinctOk) ok = false
  if (!ok) {
    console.error('\nimpact-spark checks FAILED — sheet not written')
    process.exit(1)
  }

  const outDir = path.join(process.cwd(), 'public', 'impact', 'sparks')
  await writeSheet(frames, outDir)
  console.log(`\nwrote ${frames.length} marks -> ${path.relative(process.cwd(), outDir)}/atlas.png (+ frames.json, review/marks.png)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
