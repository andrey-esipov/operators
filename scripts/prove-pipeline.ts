/**
 * Adversarial proof that the pipeline's checks can actually FAIL.
 *
 * This repo has a documented history of green probes guarding broken things —
 * an assertion that a degenerate output still satisfies is worse than no
 * assertion, because it manufactures false confidence. So before trusting any
 * validator here, this harness feeds each one the exact failure it exists to
 * catch and asserts it goes RED, then feeds it a known-good input and asserts
 * GREEN. A check that cannot be shown failing is treated as a bug.
 *
 * Every case prints EXPECT-FAIL / EXPECT-PASS and the actual outcome; the
 * process exits non-zero if any check did not behave as demanded, so this is
 * itself a test that cannot silently lie.
 *
 *   npx tsx scripts/prove-pipeline.ts            # uses cached doshi frames
 *   npx tsx scripts/prove-pipeline.ts chesky
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import sharp from 'sharp'
import { removeFlatBackground, registerFrame, findAnchor } from './lib/sprite-pipeline'
import { referenceHistogram, validateFrame } from './lib/sprite-validate'
import { packAtlas, assertAnchorsPreserved, type RegisteredFrame } from './lib/atlas'
import { encodeApng, type ApngFrame } from './lib/apng'
import { STANCE_FRAME } from './lib/frame-spec'

const CANVAS = 512, TARGET_H = 380, ORIGIN = { x: 256, y: 470 }

let failures = 0
function check(label: string, expectFail: boolean, actualFail: boolean, detail: string) {
  const want = expectFail ? 'FAIL' : 'PASS'
  const got = actualFail ? 'FAIL' : 'PASS'
  const ok = expectFail === actualFail
  if (!ok) failures++
  console.log(`  [${ok ? 'OK ' : 'BUG'}] expect-${want} got-${got}  ${label}  — ${detail}`)
}

async function reg(seg: Buffer, heightRatio = 1): Promise<Buffer> {
  return registerFrame(seg, { canvasW: CANVAS, canvasH: CANVAS, targetHeight: TARGET_H, originX: ORIGIN.x, originY: ORIGIN.y, heightRatio })
}

/**
 * Erase the deep interior of a segmented sprite, leaving a thin opaque shell —
 * a void the body fully encloses on every side, which is what an over-eager
 * segmentation pocket-sweep eating the torso actually produces. Only pixels
 * whose whole (2r+1)² neighbourhood is opaque are cleared, so a ~r-thick opaque
 * ring always remains and the hole cannot leak to the exterior.
 */
async function punchHole(seg: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(seg).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info
  const a = await findAnchor(seg)
  const r = 5
  const opaque = (x: number, y: number) => data[(y * width + x) * 4 + 3] > 8
  const clear: number[] = []
  for (let y = a.top + r; y <= a.bottom - r; y++) {
    for (let x = a.left + r; x <= a.right - r; x++) {
      let deep = true
      for (let dy = -r; dy <= r && deep; dy++) for (let dx = -r; dx <= r; dx++) {
        if (!opaque(x + dx, y + dy)) { deep = false; break }
      }
      if (deep) clear.push((y * width + x) * 4 + 3)
    }
  }
  for (const i of clear) data[i] = 0
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer()
}

async function main() {
  const id = process.argv[2] || 'doshi'
  const rawDir = path.resolve('.sprite-gen', id, 'raw')
  const stancePath = path.resolve('public/sprites', id, 'stance.png')
  console.log(`\n=== proving pipeline checks on ${id} ===`)

  const stanceRaw = fs.readFileSync(stancePath)
  const stanceSeg = await removeFlatBackground(stanceRaw)
  const refHist = await referenceHistogram(stanceSeg)

  // A known-good frame straight from the accepted cache.
  const goodRaw = fs.readFileSync(path.join(rawDir, 'mp-active.png'))
  const goodSeg = await removeFlatBackground(goodRaw)
  const goodReg = await reg(goodSeg, 0.99)

  // ---------------------------------------------------------------------------
  console.log('\n[1] validateFrame — identity (wrong character)')
  {
    // Good: the real mp-active against its own fighter's histogram.
    const r = await validateFrame(goodSeg, goodReg, refHist, { name: 'mp-active', aspect: [0.55, 1.0] }, ORIGIN)
    check('same character', false, !r.passed, `identity=${r.metrics.identity.toFixed(3)} rejects=[${r.rejects.join('|')}]`)

    // Fail: a DIFFERENT fighter's stance judged against this fighter's histogram.
    const otherId = id === 'lenny' ? 'chesky' : 'lenny'
    const otherSeg = await removeFlatBackground(fs.readFileSync(path.resolve('public/sprites', otherId, 'stance.png')))
    const otherReg = await reg(otherSeg, 1)
    const rf = await validateFrame(otherSeg, otherReg, refHist, { name: 'mp-active', aspect: [0.55, 1.0] }, ORIGIN)
    const idReject = rf.rejects.some((s) => s.startsWith('identity'))
    check(`wrong character (${otherId})`, true, !rf.passed && idReject, `identity=${rf.metrics.identity.toFixed(3)} rejects=[${rf.rejects.join('|')}]`)
  }

  // ---------------------------------------------------------------------------
  console.log('\n[2] validateFrame — segmentation (grey background retained)')
  {
    // Fail: feed the RAW image (background never removed) as if it were
    // segmented. The grey field is fully opaque, so density fills the box.
    const rawAsSeg = await sharp(stanceRaw).ensureAlpha().png().toBuffer()
    const rr = await reg(rawAsSeg, 1).catch(() => rawAsSeg)
    const r = await validateFrame(rawAsSeg, rr, refHist, { name: 'idle', aspect: [0.28, 0.62] }, ORIGIN)
    const segReject = r.rejects.some((s) => s.startsWith('segmentation') || s.startsWith('presence'))
    check('background retained', true, !r.passed && segReject, `density=${r.metrics.density.toFixed(1)}% rejects=[${r.rejects.join('|')}]`)
  }

  // ---------------------------------------------------------------------------
  console.log('\n[3] validateFrame — blank / empty frame')
  {
    const blank = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
    const r = await validateFrame(blank, blank, refHist, { name: 'idle' }, ORIGIN)
    check('fully transparent frame', true, !r.passed, `rejects=[${r.rejects.join('|')}]`)
  }

  // ---------------------------------------------------------------------------
  console.log('\n[4] validateFrame — segmentation hole (body erased)')
  {
    // Punch an enclosed void through the torso of the compact stance — the one
    // failure identity/coverage cannot see, so only the hole check can catch it.
    const holed = await punchHole(stanceSeg)
    const holedReg = await reg(holed, 1).catch(() => holed)
    const r = await validateFrame(holed, holedReg, refHist, { name: 'idle', aspect: [0.28, 0.62] }, ORIGIN)
    const holeReject = r.rejects.some((s) => s.includes('enclosed hole'))
    check('enclosed hole through torso', true, !r.passed && holeReject, `holeFrac=${(r.metrics.holeFrac * 100).toFixed(1)}% identity=${r.metrics.identity.toFixed(3)} rejects=[${r.rejects.join('|')}]`)
  }

  // ---------------------------------------------------------------------------
  console.log('\n[5] validateFrame — foot-anchor drift')
  {
    // Shove the registered sprite sideways so its feet no longer sit on origin.
    const shifted = await sharp({ create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp(goodReg).extract({ left: 0, top: 0, width: CANVAS - 40, height: CANVAS }).toBuffer(), left: 40, top: 0 }])
      .png().toBuffer()
    const r = await validateFrame(goodSeg, shifted, refHist, { name: 'mp-active', aspect: [0.55, 1.0] }, ORIGIN)
    const driftReject = r.rejects.some((s) => s.startsWith('registration'))
    check('feet shoved 40px off origin', true, !r.passed && driftReject, `footDrift=${r.metrics.footDrift.toFixed(1)}px rejects=[${r.rejects.join('|')}]`)
  }

  // ---------------------------------------------------------------------------
  console.log('\n[6] assertAnchorsPreserved — packed atlas anchor integrity')
  {
    const frames: RegisteredFrame[] = [
      { name: STANCE_FRAME, buf: await reg(stanceSeg, 1), origin: ORIGIN },
      { name: 'mp-active', buf: goodReg, origin: ORIGIN },
    ]
    const { atlas, assets } = await packAtlas(id, `/fighters/${id}/atlas.webp`, frames, 180)
    const good = await assertAnchorsPreserved(atlas, assets)
    check('honest anchors', false, !good.ok, `report=[${good.report.join('|')}]`)

    // Corrupt a stored anchor and confirm the re-derived-from-pixels check trips.
    const tampered = { ...assets, frames: assets.frames.map((f, i) => i === 0 ? { ...f, anchor: { x: f.anchor.x + 25, y: f.anchor.y } } : f) }
    const bad = await assertAnchorsPreserved(atlas, tampered)
    check('anchor metadata lies by 25px', true, !bad.ok, `report=[${bad.report.join('|')}]`)
  }

  // ---------------------------------------------------------------------------
  console.log('\n[7] APNG preview — structurally valid & genuinely animated')
  {
    // Build three visibly different frames and one where all three are identical.
    const mk = async (fill: { r: number; g: number; b: number }): Promise<ApngFrame> => ({
      rgba: await sharp({ create: { width: 32, height: 32, channels: 4, background: { ...fill, alpha: 1 } } }).raw().toBuffer(),
      width: 32, height: 32, delay60: 8,
    })
    const animated = encodeApng([await mk({ r: 200, g: 40, b: 40 }), await mk({ r: 40, g: 200, b: 40 }), await mk({ r: 40, g: 40, b: 200 })])
    const stfor = await mk({ r: 128, g: 128, b: 128 })
    const still = encodeApng([stfor, stfor, stfor])

    const good = verifyApng(animated)
    check('distinct frames read back as animated', false, !good.ok, good.detail)
    const bad = verifyApng(still)
    check('identical frames are NOT called animated', true, !bad.ok, bad.detail)
  }

  console.log(`\n=== ${failures === 0 ? 'ALL CHECKS BEHAVED (each can fail and pass as demanded)' : failures + ' VALIDATOR(S) MISBEHAVED'} ===`)
  process.exit(failures === 0 ? 0 : 1)
}

/**
 * Independent APNG reader (sharp/libvips cannot read APNG). Parses chunks,
 * inflates every frame, and reports whether the file is a valid multi-frame
 * animation whose frames actually differ. "ok" means: parses, >=2 frames, and
 * at least two frames have different pixels — a static loop returns ok=false so
 * the check has a way to go red.
 */
function verifyApng(buf: Buffer): { ok: boolean; detail: string } {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return { ok: false, detail: 'not a PNG' }
  let o = 8
  let numFrames = 0
  let width = 0, height = 0
  const frameData: Buffer[] = []
  let cur: Buffer[] = []
  let started = false
  while (o + 8 <= buf.length) {
    const len = buf.readUInt32BE(o)
    const type = buf.toString('ascii', o + 4, o + 8)
    const data = buf.subarray(o + 8, o + 8 + len)
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4) }
    else if (type === 'acTL') numFrames = data.readUInt32BE(0)
    else if (type === 'fcTL') { if (started) { frameData.push(Buffer.concat(cur)); cur = [] } started = true }
    else if (type === 'IDAT') cur.push(data)
    else if (type === 'fdAT') cur.push(data.subarray(4)) // strip sequence number
    else if (type === 'IEND') { if (cur.length) frameData.push(Buffer.concat(cur)) }
    o += 12 + len
  }
  if (numFrames < 2) return { ok: false, detail: `acTL frames=${numFrames}` }
  if (frameData.length !== numFrames) return { ok: false, detail: `acTL=${numFrames} but ${frameData.length} frame streams` }
  // Inflate + strip per-row filter byte (encoder always writes filter 0).
  const pixels: Buffer[] = []
  for (const fd of frameData) {
    const raw = zlib.inflateSync(fd)
    const stride = width * 4
    const out = Buffer.alloc(stride * height)
    for (let y = 0; y < height; y++) raw.copy(out, y * stride, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    pixels.push(out)
  }
  let anyDiffer = false
  for (let i = 1; i < pixels.length; i++) if (!pixels[i].equals(pixels[0])) anyDiffer = true
  return { ok: anyDiffer, detail: `frames=${numFrames} ${width}x${height} distinct=${anyDiffer}` }
}

main().catch((e) => { console.error(e); process.exit(1) })
