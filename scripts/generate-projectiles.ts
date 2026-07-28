/**
 * Procedural projectile art for the Warden zoner (and any future fireball).
 *
 * WHY PROCEDURAL, NOT gpt-image-2. Character sprites go through the AI pipeline
 * because the hard problem there is *preserving a person's identity* across
 * poses — exactly what a diffusion edit is good at. A fireball has the opposite
 * problem profile:
 *   - No identity to hold, so the AI's one advantage is irrelevant.
 *   - It MUST loop seamlessly at speed; independently sampled AI frames boil and
 *     never tile.
 *   - It must read instantly against a busy stage: a hard white core, a bright
 *     high-contrast corona, and an unmistakable direction of travel. That wants
 *     pixel-exact control, not a prompt.
 *   - It's tiny and moves fast, so per-frame $0.17 diffusion is pure waste.
 * So these are drawn from maths: additive glows + a directional tail + (for the
 * super) rotating lightning, all phased on sin(2*pi*t) so the travel loop wraps
 * with no seam.
 *
 * Output per kind under public/projectiles/<kind>/:
 *   - atlas.png     — horizontal strip of every frame
 *   - frames.json   — { kind, frameW, frameH, anchor, travelDir, frames[], clips{} }
 *                     clips = spawn (once), travel (loop), impact (once), mirroring
 *                     the FighterAssets clip shape the renderer already speaks.
 * Review APNGs (one per clip) go under public/projectiles/<kind>/review/ which is
 * gitignored.
 *
 * Kinds match src/fight/fighters/warden.ts `ProjectileSpawn.kind`: 'ion-bolt'
 * (both bolt speeds) and 'super-beam' (Ion Storm). The renderer selects art by
 * that kind; speed/life/hitbox live in the sim, not here.
 *
 *   npx tsx scripts/generate-projectiles.ts            # generate both kinds
 *   npx tsx scripts/generate-projectiles.ts --prove    # prove every validator can fail
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

// ── Drawing field: additive RGB, alpha = brightest coverage seen ─────────────
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

  /**
   * Anisotropic gaussian glow. `elong` stretches along `angle` (radians), so a
   * beam can be drawn as one elongated blob. Colour is added (so overlaps blow
   * out to white, which is what a hot core should do); alpha takes the max
   * weight so the glow fades to transparent at its rim.
   */
  glow(cx: number, cy: number, sigma: number, color: Vec3, intensity: number, elong = 1, angle = 0): void {
    const reach = Math.ceil(sigma * elong * 3) + 1
    const ca = Math.cos(-angle)
    const sa = Math.sin(-angle)
    const x0 = Math.max(0, Math.floor(cx - reach))
    const x1 = Math.min(this.w - 1, Math.ceil(cx + reach))
    const y0 = Math.max(0, Math.floor(cy - reach))
    const y1 = Math.min(this.h - 1, Math.ceil(cy + reach))
    const inv2s2 = 1 / (2 * sigma * sigma)
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx
        const dy = y - cy
        // rotate into the glow's local frame, then squash the long axis
        const lx = (dx * ca - dy * sa) / elong
        const ly = dx * sa + dy * ca
        const d2 = lx * lx + ly * ly
        const w = Math.exp(-d2 * inv2s2) * intensity
        if (w < 0.004) continue
        const i = y * this.w + x
        this.r[i] += color[0] * w
        this.g[i] += color[1] * w
        this.b[i] += color[2] * w
        if (w > this.a[i]) this.a[i] = w
      }
    }
  }

  /** A jagged bright polyline — lightning tendril for the super. */
  tendril(cx: number, cy: number, angle: number, length: number, color: Vec3, intensity: number, seed: number): void {
    const steps = 10
    let x = cx
    let y = cy
    let a = angle
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      const seg = length / steps
      // deterministic wobble so the whole thing is reproducible
      a += Math.sin(seed * 12.9898 + s * 3.31) * 0.5
      x += Math.cos(a) * seg
      y += Math.sin(a) * seg
      this.glow(x, y, 2.4 * (1 - t) + 1, color, intensity * (1 - t * 0.7))
    }
  }

  toRGBA(): Buffer {
    const n = this.w * this.h
    const out = Buffer.alloc(n * 4)
    for (let i = 0; i < n; i++) {
      out[i * 4] = Math.min(255, this.r[i])
      out[i * 4 + 1] = Math.min(255, this.g[i])
      out[i * 4 + 2] = Math.min(255, this.b[i])
      out[i * 4 + 3] = Math.min(255, this.a[i] * 255)
    }
    return out
  }
}

const TAU = Math.PI * 2

// ── ion-bolt ─────────────────────────────────────────────────────────────────
const ION_W = 96
const ION_H = 96
const ION_CORE: Vec3 = [255, 255, 255]
const ION_MID: Vec3 = [140, 225, 255]
const ION_EDGE: Vec3 = [40, 150, 255]

function ionTravel(phase: number): Frame {
  const f = new Field(ION_W, ION_H)
  const cy = ION_H / 2
  const head = ION_W / 2 + 14 // lead well to the right so the tail has room
  const puls = 1 + 0.14 * Math.sin(phase * TAU)
  // Comet tail streaking BACK (left): bright and long so travel reads instantly.
  for (let t = 1; t <= 9; t++) {
    const tx = head - t * 7
    const ty = cy + 2.2 * Math.sin(phase * TAU + t * 0.7)
    const col = t <= 3 ? ION_MID : ION_EDGE
    f.glow(tx, ty, Math.max(2, 11 - t * 1.0), col, (0.8 - t * 0.07) * puls)
  }
  f.glow(head, cy, 13 * puls, ION_EDGE, 0.8)
  f.glow(head, cy, 7.5, ION_MID, 1.0)
  f.glow(head, cy, 4.4 * puls, ION_CORE, 1.25)
  return { rgba: f.toRGBA(), w: ION_W, h: ION_H }
}

function ionSpawn(k: number, n: number): Frame {
  const f = new Field(ION_W, ION_H)
  const cy = ION_H / 2
  const head = ION_W / 2 + 14
  const s = Math.min(1, 0.15 + (k / (n - 1)) * 0.95)
  const flash = k <= 1 ? 1.5 : 1
  f.glow(head, cy, 16 * s, ION_EDGE, 0.7 * s)
  f.glow(head, cy, 8 * s, ION_MID, 1.0 * s)
  f.glow(head, cy, 5 * s, ION_CORE, 1.2 * s * flash)
  return { rgba: f.toRGBA(), w: ION_W, h: ION_H }
}

function ionImpact(k: number, n: number): Frame {
  const f = new Field(ION_W, ION_H)
  const cy = ION_H / 2
  const cx = ION_W / 2 + 14
  const t = k / (n - 1)
  const ring = 6 + t * 30
  const fade = 1 - t
  // expanding shock ring
  for (let a = 0; a < 12; a++) {
    const ang = (a / 12) * TAU
    f.glow(cx + Math.cos(ang) * ring, cy + Math.sin(ang) * ring, 4 * fade + 1, ION_MID, 0.9 * fade)
  }
  f.glow(cx, cy, (8 + t * 6), ION_EDGE, 0.6 * fade)
  f.glow(cx, cy, 5 * fade + 1, ION_CORE, 1.3 * fade)
  return { rgba: f.toRGBA(), w: ION_W, h: ION_H }
}

// ── super-beam ───────────────────────────────────────────────────────────────
const SB_W = 176
const SB_H = 128
const SB_CORE: Vec3 = [255, 255, 255]
const SB_MID: Vec3 = [205, 150, 255]
const SB_EDGE: Vec3 = [90, 120, 255]
const SB_ARC: Vec3 = [180, 230, 255]

function beamTravel(phase: number): Frame {
  const f = new Field(SB_W, SB_H)
  const cy = SB_H / 2
  const head = SB_W / 2 + 16
  const puls = 1 + 0.12 * Math.sin(phase * TAU)
  // long trailing tail
  for (let t = 1; t <= 9; t++) {
    const tx = head - t * 10
    const ty = cy + 3 * Math.sin(phase * TAU + t * 0.5)
    f.glow(tx, ty, Math.max(3, 16 - t * 1.4), SB_EDGE, (0.55 - t * 0.05) * puls, 1.4, 0)
  }
  // rotating lightning tendrils
  for (let i = 0; i < 3; i++) {
    const ang = phase * TAU + (i / 3) * TAU
    f.tendril(head, cy, ang, 42, SB_ARC, 0.9, i + 1)
  }
  f.glow(head, cy, 26 * puls, SB_EDGE, 0.8, 1.6, 0)
  f.glow(head, cy, 14, SB_MID, 1.05, 1.4, 0)
  f.glow(head, cy, 8 * puls, SB_CORE, 1.3, 1.3, 0)
  return { rgba: f.toRGBA(), w: SB_W, h: SB_H }
}

function beamSpawn(k: number, n: number): Frame {
  const f = new Field(SB_W, SB_H)
  const cy = SB_H / 2
  const head = SB_W / 2 + 16
  const s = Math.min(1, 0.2 + (k / (n - 1)) * 0.9)
  const flash = k <= 1 ? 1.4 : 1
  f.glow(head, cy, 26 * s, SB_EDGE, 0.7 * s, 1.6, 0)
  f.glow(head, cy, 14 * s, SB_MID, 1.0 * s, 1.4, 0)
  f.glow(head, cy, 8 * s, SB_CORE, 1.25 * s * flash, 1.3, 0)
  return { rgba: f.toRGBA(), w: SB_W, h: SB_H }
}

function beamImpact(k: number, n: number): Frame {
  const f = new Field(SB_W, SB_H)
  const cy = SB_H / 2
  const cx = SB_W / 2 + 16
  const t = k / (n - 1)
  const ring = 10 + t * 54
  const fade = 1 - t
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * TAU
    f.glow(cx + Math.cos(ang) * ring, cy + Math.sin(ang) * ring * 0.8, 6 * fade + 1, SB_MID, 0.9 * fade)
  }
  for (let i = 0; i < 4; i++) {
    f.tendril(cx, cy, (i / 4) * TAU + t * 2, 30 + t * 20, SB_ARC, 0.8 * fade, i + 5)
  }
  f.glow(cx, cy, 14 + t * 10, SB_EDGE, 0.6 * fade, 1.5, 0)
  f.glow(cx, cy, 8 * fade + 1, SB_CORE, 1.3 * fade, 1.3, 0)
  return { rgba: f.toRGBA(), w: SB_W, h: SB_H }
}

// ── kind assembly ────────────────────────────────────────────────────────────
interface KindSpec {
  kind: string
  w: number
  h: number
  anchorX: number
  travelN: number
  spawnN: number
  impactN: number
  travel: (phase: number) => Frame
  spawn: (k: number, n: number) => Frame
  impact: (k: number, n: number) => Frame
}

const KINDS: KindSpec[] = [
  {
    kind: 'ion-bolt', w: ION_W, h: ION_H, anchorX: ION_W / 2 + 14,
    travelN: 8, spawnN: 4, impactN: 6, travel: ionTravel, spawn: ionSpawn, impact: ionImpact,
  },
  {
    kind: 'super-beam', w: SB_W, h: SB_H, anchorX: SB_W / 2 + 16,
    travelN: 10, spawnN: 5, impactN: 8, travel: beamTravel, spawn: beamSpawn, impact: beamImpact,
  },
]

interface Built {
  spec: KindSpec
  spawn: Frame[]
  travel: Frame[]
  impact: Frame[]
}

function build(spec: KindSpec): Built {
  const spawn = Array.from({ length: spec.spawnN }, (_, k) => spec.spawn(k, spec.spawnN))
  const travel = Array.from({ length: spec.travelN }, (_, k) => spec.travel(k / spec.travelN))
  const impact = Array.from({ length: spec.impactN }, (_, k) => spec.impact(k, spec.impactN))
  return { spec, spawn, travel, impact }
}

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

/** Directionality via a peak-split energy ratio: find the brightest column (the
 *  head), then compare luminous energy to its left vs right. A trailing tail
 *  puts far more energy on one side (|ratio| -> large); a symmetric blob splits
 *  evenly (~0). Translation-invariant, so the atlas anchor offset can't fake it. */
function directionality(fr: Frame, _cx: number): number {
  const col = new Float64Array(fr.w)
  for (let y = 0; y < fr.h; y++) {
    for (let x = 0; x < fr.w; x++) {
      const i = (y * fr.w + x) * 4
      const a = fr.rgba[i + 3]
      if (a <= 20) continue
      col[x] += (0.299 * fr.rgba[i] + 0.587 * fr.rgba[i + 1] + 0.114 * fr.rgba[i + 2]) * (a / 255)
    }
  }
  let peak = 0
  for (let x = 1; x < fr.w; x++) if (col[x] > col[peak]) peak = x
  let left = 0
  let right = 0
  for (let x = 0; x < fr.w; x++) {
    if (x < peak) left += col[x]
    else if (x > peak) right += col[x]
  }
  if (left + right === 0) return 0
  return (left - right) / (left + right)
}

function meanAbsDiff(a: Frame, b: Frame): number {
  let s = 0
  const n = a.w * a.h * 4
  for (let i = 0; i < n; i++) s += Math.abs(a.rgba[i] - b.rgba[i])
  return s / n
}

/** Ratio of the wrap-around step (last→first) to the median in-loop step. A
 *  seamless loop keeps this near 1; a discontinuity spikes it. */
function loopWrapRatio(frames: Frame[]): number {
  const steps: number[] = []
  for (let i = 0; i < frames.length; i++) {
    steps.push(meanAbsDiff(frames[i], frames[(i + 1) % frames.length]))
  }
  const wrap = steps[steps.length - 1]
  const body = steps.slice(0, -1).sort((a, b) => a - b)
  const med = body[Math.floor(body.length / 2)] || 1e-6
  return wrap / med
}

interface Check { name: string; ok: boolean; value: string }

function checkKind(b: Built): Check[] {
  const anchor = b.spec.anchorX
  const allTravel = b.travel
  const mid = allTravel[Math.floor(allTravel.length / 2)]
  const cov = coverage(mid)
  const core = coreLuma(mid)
  const dir = directionality(mid, anchor)
  const wrap = loopWrapRatio(allTravel)
  return [
    { name: 'coverage in [1%,60%]', ok: cov >= 0.01 && cov <= 0.60, value: `${(cov * 100).toFixed(2)}%` },
    { name: 'hot core (p99 luma >= 230)', ok: core >= 230, value: core.toFixed(0) },
    { name: 'directional tail (|ratio| >= 0.15)', ok: Math.abs(dir) >= 0.15, value: dir.toFixed(4) },
    { name: 'seamless loop (wrap ratio <= 3)', ok: wrap <= 3, value: wrap.toFixed(2) },
  ]
}

// ── packing + output ─────────────────────────────────────────────────────────
interface FrameMeta { name: string; rect: { x: number; y: number; w: number; h: number } }
interface ClipMeta { frames: number[]; durations: number[]; loop: boolean }

async function writeKind(b: Built, outDir: string): Promise<void> {
  const { spec } = b
  const ordered: { tag: string; frame: Frame }[] = [
    ...b.spawn.map((frame, i) => ({ tag: `spawn-${i}`, frame })),
    ...b.travel.map((frame, i) => ({ tag: `travel-${i}`, frame })),
    ...b.impact.map((frame, i) => ({ tag: `impact-${i}`, frame })),
  ]
  const PAD = 4
  const atlasW = ordered.length * (spec.w + PAD) + PAD
  const atlasH = spec.h + PAD * 2
  const atlas = Buffer.alloc(atlasW * atlasH * 4)
  const frames: FrameMeta[] = []
  let cx = PAD
  for (const { tag, frame } of ordered) {
    for (let y = 0; y < spec.h; y++) {
      const srcOff = y * spec.w * 4
      const dstOff = ((y + PAD) * atlasW + cx) * 4
      frame.rgba.copy(atlas, dstOff, srcOff, srcOff + spec.w * 4)
    }
    frames.push({ name: tag, rect: { x: cx, y: PAD, w: spec.w, h: spec.h } })
    cx += spec.w + PAD
  }

  const idxOf = (tag: string) => frames.findIndex((f) => f.name === tag)
  const seq = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => idxOf(`${prefix}-${i}`))
  const clips: Record<string, ClipMeta> = {
    spawn: { frames: seq('spawn', spec.spawnN), durations: seq('spawn', spec.spawnN).map(() => 2), loop: false },
    travel: { frames: seq('travel', spec.travelN), durations: seq('travel', spec.travelN).map(() => 3), loop: true },
    impact: { frames: seq('impact', spec.impactN), durations: seq('impact', spec.impactN).map(() => 2), loop: false },
  }

  fs.mkdirSync(outDir, { recursive: true })
  await sharp(atlas, { raw: { width: atlasW, height: atlasH, channels: 4 } }).png().toFile(path.join(outDir, 'atlas.png'))
  const manifest = {
    kind: spec.kind,
    atlas: 'atlas.png',
    frameW: spec.w,
    frameH: spec.h,
    anchor: { x: spec.anchorX, y: spec.h / 2 },
    // The art is drawn travelling RIGHT; the renderer mirrors X for a left-facing
    // owner. Impact plays where the projectile dies.
    travelDir: 'right',
    frames,
    clips,
  }
  fs.writeFileSync(path.join(outDir, 'frames.json'), JSON.stringify(manifest, null, 2))

  // Review APNGs (gitignored) so quality is eyeballable without the game.
  const reviewDir = path.join(outDir, 'review')
  fs.mkdirSync(reviewDir, { recursive: true })
  const apng = (name: string, list: Frame[], delay: number) => {
    const af: ApngFrame[] = list.map((fr) => ({ rgba: fr.rgba, width: fr.w, height: fr.h, delay60: delay }))
    fs.writeFileSync(path.join(reviewDir, `${name}.png`), encodeApng(af))
  }
  apng('spawn', b.spawn, 4)
  apng('travel', b.travel, 4)
  apng('impact', b.impact, 4)
  // A full lifecycle loop for a natural read.
  apng('lifecycle', [...b.spawn, ...b.travel, ...b.travel, ...b.impact], 4)
}

// ── prove mode: every validator must go RED on the failure it guards ─────────
function solidFrame(w: number, h: number, rgb: Vec3, alpha: number): Frame {
  const rgba = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = rgb[0]; rgba[i * 4 + 1] = rgb[1]; rgba[i * 4 + 2] = rgb[2]; rgba[i * 4 + 3] = alpha
  }
  return { rgba, w, h }
}

function symmetricBlob(w: number, h: number): Frame {
  const f = new Field(w, h)
  f.glow(w / 2, h / 2, 10, [80, 80, 80], 0.6) // dim, centred, no core, no tail
  return { rgba: f.toRGBA(), w, h }
}

function prove(): number {
  console.log('=== proving projectile validators can FAIL ===\n')
  const spec = KINDS[0] // ion-bolt geometry
  const good = build(spec)
  const goodMid = good.travel[Math.floor(good.travel.length / 2)]
  let allProven = true

  const line = (label: string, passOnGood: boolean, failOnBad: boolean, gv: string, bv: string) => {
    const proven = passOnGood && failOnBad
    if (!proven) allProven = false
    console.log(`  [${proven ? 'PROVEN' : 'BROKEN'}] ${label}`)
    console.log(`      good input  -> ${passOnGood ? 'pass' : 'FAIL'} (${gv})`)
    console.log(`      bad  input  -> ${failOnBad ? 'fail' : 'PASS'} (${bv})   <- must fail`)
  }

  // 1. coverage: blank frame has zero coverage
  {
    const blank = solidFrame(spec.w, spec.h, [0, 0, 0], 0)
    const g = coverage(goodMid), badv = coverage(blank)
    line('coverage rejects a blank frame', g >= 0.01 && g <= 0.60, !(badv >= 0.01 && badv <= 0.60), `${(g * 100).toFixed(2)}%`, `${(badv * 100).toFixed(2)}%`)
  }
  // 2. hot core: a dim uniform fill has no near-white core
  {
    const dim = solidFrame(spec.w, spec.h, [40, 40, 40], 255)
    const g = coreLuma(goodMid), badv = coreLuma(dim)
    line('hot-core rejects a dim uniform fill', g >= 230, !(badv >= 230), g.toFixed(0), badv.toFixed(0))
  }
  // 3. directionality: a symmetric blob has no travel direction
  {
    const blob = symmetricBlob(spec.w, spec.h)
    const g = directionality(goodMid, spec.anchorX), badv = directionality(blob, spec.anchorX)
    line('directionality rejects a symmetric blob', Math.abs(g) >= 0.15, !(Math.abs(badv) >= 0.15), g.toFixed(4), badv.toFixed(4))
  }
  // 4. seamless loop: a cycle whose last frame is a white flash is discontinuous
  {
    const broken = good.travel.slice()
    broken[broken.length - 1] = solidFrame(spec.w, spec.h, [255, 255, 255], 255)
    const g = loopWrapRatio(good.travel), badv = loopWrapRatio(broken)
    line('loop-seam rejects a discontinuous cycle', g <= 3, !(badv <= 3), g.toFixed(2), badv.toFixed(2))
  }

  console.log(`\n${allProven ? 'ALL VALIDATORS PROVEN FAIL-CAPABLE' : 'SOME VALIDATORS NEVER FAILED — do not trust them'}`)
  return allProven ? 0 : 1
}

async function main(): Promise<void> {
  if (process.argv.includes('--prove')) {
    process.exit(prove())
  }
  const root = path.resolve(process.cwd(), 'public/projectiles')
  console.log('=== generating procedural projectiles ===')
  let anyFail = false
  for (const spec of KINDS) {
    const b = build(spec)
    const checks = checkKind(b)
    const outDir = path.join(root, spec.kind)
    await writeKind(b, outDir)
    console.log(`\n${spec.kind}  (${spec.w}x${spec.h}, ${b.spawn.length + b.travel.length + b.impact.length} frames)`)
    for (const c of checks) {
      console.log(`  [${c.ok ? 'OK ' : 'BAD'}] ${c.name.padEnd(34)} = ${c.value}`)
      if (!c.ok) anyFail = true
    }
    console.log(`  -> ${path.relative(process.cwd(), outDir)}/{atlas.png, frames.json, review/*.png}`)
  }
  if (anyFail) { console.log('\nFAILED: a generated projectile did not pass its own validators'); process.exit(1) }
  console.log('\nAll projectiles generated and passed validation.')
}

main().catch((e) => { console.error(e); process.exit(1) })
