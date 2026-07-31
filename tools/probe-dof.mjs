// Depth-of-field probe (Defect 2) — mutation-provable.
//
// StageSet.ts claims four times that the stage depth layers are "blurred into
// bokeh by DOF", but the strings DOF/bokeh existed ONLY in comments — the real
// chain was RenderPass -> SelectiveBloom -> Lens -> MasterGrade -> LensFinalize
// -> SMAA, so the pillars/window-bank/stairs rendered hard-edged and aliased.
// DepthOfFieldEffect adds the missing pass (its own EffectPass, right after
// RenderPass, before bloom). The non-negotiable constraint: DOF must defocus the
// STAGE only and leave the FIGHTERS crisp (a naive full-screen DOF would undo
// the 2.05x sprite upscale + keyline + coverage-AA the fighters depend on).
//
// This proves BOTH halves, each mutation-gated:
//
//   (A) the stage actually defocuses      — stage-band edge energy ON <= 0.70x OFF
//       control that the band isn't empty — stage-band edge energy OFF >= floor
//   (B) the fighters are NOT softened      — fighter interior edge energy ON within
//                                            +/-15% of OFF
//   (C) the metric can SEE a softened fighter (so B is not a blind no-op) — with
//       __POST__.dofDefeat(true) injecting a fighter-plane focus miss, fighter
//       interior edge energy DEFEAT <= 0.65x ON.
//   (D) the pass is actually present when it should be (house rule: a silent tier
//       drop must not let us measure a no-DOF frame) — __POST__.hasDof() is true on
//       the ON/DEFEAT load and false on the ?nodof load.
//
// Measurement hygiene:
//  * native 1:1, DPR 2 (3200x1800).
//  * &nofinalize kills the CAS sharpen + chromatic aberration that would re-crisp
//    the DOF-blurred stage and mask the effect; grade (tone map) stays on so we
//    don't clip. ON, DEFEAT and OFF ALL get &nofinalize — apples to apples.
//  * grain-robust metric: MasterGrade adds animated grain AFTER dof, so we sum
//    gradient magnitude only where it exceeds T_EDGE (grain is a few luma; real
//    sprite/stage edges are 40-150). Smooth blurred regions read ~0.
//  * fighter metric runs on the ERODED INTERIOR of a body mask taken from the OFF
//    (crisp, no-DOF) frame, so the silhouette boundary (whose background side DOES
//    legitimately blur) never contaminates the "are the fighters crisp" reading.
//  * fresh PAGE per URL (goto-reload on one page proved flaky); fighters parked
//    via __PLAY__.state() and the camera frozen (settleCamera) before every shot.
import { chromium } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import sharp from 'sharp'

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const PORT = arg('--port', '5410')
const STAGE = arg('--stage', 'pre-pmf')
const OUT = `tools/_out/dof-${STAGE}`
const BASE = `http://localhost:${PORT}/?stage=${STAGE}&cpu=dummy&quality=ultra&nofinalize`

const W = 3200, H = 1800
const CH = 3
const CM_TO_WORLD = 3.4 / 180
const FIGHTER_H = 3.4
const A_HALF_W = 0.68

// A rest-camera mid shot: both fighters on the floor, well separated, so fighter
// A's column is clean sprite and the upper-centre band is pure far stage (window
// bank / stairs / screens) sitting BEHIND the focus plane -> it must defocus.
const POSE = { a: [-70, 0], b: [70, 0] }
// Far-stage band (fraction of frame): above the fighters' heads, between them.
const STAGE_RECT = { x0: Math.round(0.28 * W), y0: Math.round(0.12 * H), x1: Math.round(0.72 * W), y1: Math.round(0.36 * H) }

const T_EDGE = 24  // gradient magnitude above this = a real edge (grain is < ~16)
const T_BODY = 42  // luma above this in the OFF frame = visible fighter body
const ERODE = 5    // interior-only guard: absorbs small cross-load camera drift

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})

const errors = []
const luma = (b, i) => b[i] * 0.299 + b[i + 1] * 0.587 + b[i + 2] * 0.114

async function stageLuma(buf) {
  const { data, info } = await sharp(buf)
    .extract({ left: 0, top: Math.round(H * 0.14), width: W, height: Math.round(H * 0.7) })
    .resize(120).raw().toBuffer({ resolveWithObject: true })
  let sum = 0
  const n = data.length / info.channels
  for (let i = 0; i < data.length; i += info.channels) sum += (data[i] + data[i + 1] + data[i + 2]) / 3
  return sum / n
}

async function screenshotSafe(page) {
  // Guard the ~1-in-9 cleared drawing buffer (luma ~0). A dark-but-valid stage
  // sits well above 6. Per-attempt timeout so an ANGLE hiccup can't wedge us.
  for (let i = 0; i < 10; i++) {
    let buf = null
    try { buf = await page.screenshot({ timeout: 8000 }) } catch { buf = null }
    if (buf && (await stageLuma(buf)) >= 6) return buf
    await page.waitForTimeout(150)
  }
  return null
}

async function fingerprint(buf) {
  return sharp(buf)
    .extract({ left: 0, top: Math.round(H * 0.12), width: W, height: Math.round(H * 0.76) })
    .resize(200).removeAlpha().raw().toBuffer()
}
function meanAbsDiff(a, b) {
  let d = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) d += Math.abs(a[i] - b[i])
  return d / n
}
async function settleCamera(page) {
  let prev = null
  for (let i = 0; i < 16; i++) {
    const buf = await screenshotSafe(page)
    if (!buf) return false
    const fp = await fingerprint(buf)
    if (prev && meanAbsDiff(prev, fp) < 0.8) return true
    prev = fp
    await page.waitForTimeout(280)
  }
  return true
}

async function openAndCompose(url) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)))
  await page.goto(url, { waitUntil: 'domcontentloaded' })

  const overlay = await page.evaluate(() => {
    const el = document.querySelector('vite-error-overlay')
    if (!el) return null
    return el.shadowRoot?.querySelector('.message')?.textContent?.trim().slice(0, 300) ?? 'present'
  })
  if (overlay) { console.log(`FAILED: vite error overlay covers the page —\n  ${overlay}`); await browser.close(); process.exit(1) }

  let stable = 0
  for (let i = 0; i < 400 && stable < 12; i++) {
    let ok = false
    try {
      ok = await page.evaluate(() =>
        !!window.__PLAY__?.ready?.() &&
        window.__PLAY__.state().phase === 'fight' &&
        !!window.__STAGE__?.project &&
        !!window.__POST__)
    } catch { ok = false }
    stable = ok ? stable + 1 : 0
    await page.waitForTimeout(30)
  }
  if (stable < 12) { console.log(`FAILED: route/__STAGE__/__POST__ never settled (${url})`); await browser.close(); process.exit(1) }
  await page.mouse.click(800, 450)

  await page.evaluate(({ a, b }) => {
    try { window.__PLAY__.resume() } catch {}
    const st = window.__PLAY__.state()
    const [fa, fb] = st.fighters
    fa.pos.x = a[0]; fa.pos.y = a[1]; fa.vel.x = 0; fa.vel.y = 0
    fb.pos.x = b[0]; fb.pos.y = b[1]; fb.vel.x = 0; fb.vel.y = 0
    window.__PLAY__.pause()
  }, POSE)
  await page.waitForTimeout(900)
  await settleCamera(page)
  return page
}

async function fighterARect(page) {
  const ndc = await page.evaluate(({ hw, fh, cm }) => {
    const a = window.__PLAY__.state().fighters[0]
    const wx = a.pos.x * cm, fy = a.pos.y * cm
    const P = window.__STAGE__.project
    const L = P(wx - hw, fy, 0.02), R = P(wx + hw, fy, 0.02)
    const top = P(wx, fy + fh, 0.02), bot = P(wx, fy, 0.02)
    return { lx: L[0], rx: R[0], ty: top[1], by: bot[1], wx, fy }
  }, { hw: A_HALF_W, fh: FIGHTER_H, cm: CM_TO_WORLD })
  const toPx = (nx, ny) => [((nx * 0.5) + 0.5) * W, (1 - ((ny * 0.5) + 0.5)) * H]
  const [x0] = toPx(ndc.lx, 0), [x1] = toPx(ndc.rx, 0)
  const [, yTop] = toPx(0, ndc.ty), [, yBot] = toPx(0, ndc.by)
  return {
    x0: Math.max(0, Math.round(Math.min(x0, x1))),
    x1: Math.min(W, Math.round(Math.max(x0, x1))),
    y0: Math.max(0, Math.round(Math.min(yTop, yBot))),
    y1: Math.min(H, Math.round(Math.max(yTop, yBot))),
    world: { wx: +ndc.wx.toFixed(2), fy: +ndc.fy.toFixed(2) },
  }
}

// Interior body mask from the crisp OFF frame (eroded off the silhouette edge).
function buildBodyMask(ref, rect) {
  const { x0, y0, x1, y1 } = rect
  const w = x1 - x0
  const m = new Uint8Array(w * (y1 - y0))
  const isBody = (x, y) => luma(ref, (y * W + x) * CH) > T_BODY
  let count = 0
  for (let y = y0 + ERODE; y < y1 - ERODE; y++) {
    for (let x = x0 + ERODE; x < x1 - ERODE; x++) {
      if (isBody(x, y) && isBody(x - ERODE, y) && isBody(x + ERODE, y) && isBody(x, y - ERODE) && isBody(x, y + ERODE)) {
        m[(y - y0) * w + (x - x0)] = 1
        count++
      }
    }
  }
  return { m, w, count }
}
// Mean strong-edge energy over the masked interior (grain excluded by T_EDGE).
function maskedEdgeEnergy(buf, rect, mask) {
  const { x0, y0, x1, y1 } = rect
  const { m, w } = mask
  let sum = 0, n = 0
  for (let y = y0 + 1; y < y1 - 1; y++) {
    for (let x = x0 + 1; x < x1 - 1; x++) {
      if (!m[(y - y0) * w + (x - x0)]) continue
      const i = (y * W + x) * CH
      const g = Math.abs(luma(buf, i + CH) - luma(buf, i - CH)) + Math.abs(luma(buf, i + W * CH) - luma(buf, i - W * CH))
      n++
      if (g > T_EDGE) sum += g
    }
  }
  return n ? sum / n : 0
}
// Mean strong-edge energy over a plain rect (for the far-stage band).
function rectEdgeEnergy(buf, r) {
  let sum = 0, n = 0
  for (let y = r.y0 + 1; y < r.y1 - 1; y++) {
    for (let x = r.x0 + 1; x < r.x1 - 1; x++) {
      const i = (y * W + x) * CH
      const g = Math.abs(luma(buf, i + CH) - luma(buf, i - CH)) + Math.abs(luma(buf, i + W * CH) - luma(buf, i - W * CH))
      n++
      if (g > T_EDGE) sum += g
    }
  }
  return n ? sum / n : 0
}
const cropSave = (buf, r, name) =>
  sharp(buf).extract({ left: r.x0, top: r.y0, width: Math.max(1, r.x1 - r.x0), height: Math.max(1, r.y1 - r.y0) }).toFile(`${OUT}/${name}.png`)

// ---- Capture ON + DEFEAT on one load, OFF on a fresh load -------------------
const onPage = await openAndCompose(BASE)
const hasDofOn = await onPage.evaluate(() => window.__POST__?.hasDof?.())
const onBuf = await screenshotSafe(onPage)
if (!onBuf) { console.log('FAILED: lost drawing buffer (ON)'); await browser.close(); process.exit(1) }
const aRectOn = await fighterARect(onPage)

await onPage.evaluate(() => window.__POST__.dofDefeat(true))
await onPage.waitForTimeout(500)
const hasDofDef = await onPage.evaluate(() => window.__POST__?.hasDof?.())
const defBuf = await screenshotSafe(onPage)
if (!defBuf) { console.log('FAILED: lost drawing buffer (DEFEAT)'); await browser.close(); process.exit(1) }
await onPage.evaluate(() => window.__POST__.dofDefeat(false))
await onPage.close()

const offPage = await openAndCompose(BASE + '&nodof')
const hasDofOff = await offPage.evaluate(() => window.__POST__?.hasDof?.())
const offBuf = await screenshotSafe(offPage)
if (!offBuf) { console.log('FAILED: lost drawing buffer (OFF)'); await browser.close(); process.exit(1) }
const aRectOff = await fighterARect(offPage)
await offPage.close()

// ---- Measure ----------------------------------------------------------------
const onRaw = await sharp(onBuf).removeAlpha().raw().toBuffer()
const defRaw = await sharp(defBuf).removeAlpha().raw().toBuffer()
const offRaw = await sharp(offBuf).removeAlpha().raw().toBuffer()

// Fighter mask + rect come from the crisp OFF frame; applied identically to all
// three (same parked pose + frozen camera -> same pixels within ERODE).
const mask = buildBodyMask(offRaw, aRectOff)
const drift = (() => { // cross-load drift proxy inside the fighter rect
  const r = aRectOff
  let d = 0, n = 0
  for (let y = r.y0; y < r.y1; y += 3) for (let x = r.x0; x < r.x1; x += 3) { const i = (y * W + x) * CH; d += Math.abs(luma(onRaw, i) - luma(offRaw, i)); n++ }
  return n ? d / n : 0
})()

const fOn = maskedEdgeEnergy(onRaw, aRectOff, mask)
const fOff = maskedEdgeEnergy(offRaw, aRectOff, mask)
const fDef = maskedEdgeEnergy(defRaw, aRectOff, mask)
const sOn = rectEdgeEnergy(onRaw, STAGE_RECT)
const sOff = rectEdgeEnergy(offRaw, STAGE_RECT)
const sDef = rectEdgeEnergy(defRaw, STAGE_RECT)

await cropSave(onBuf, aRectOff, 'fighter_on')
await cropSave(defBuf, aRectOff, 'fighter_defeat')
await cropSave(offBuf, aRectOff, 'fighter_off')
await cropSave(onBuf, STAGE_RECT, 'stage_on')
await cropSave(offBuf, STAGE_RECT, 'stage_off')
await sharp(onBuf).resize(1400).jpeg({ quality: 86 }).toFile(`${OUT}/full_on.jpg`)
await sharp(offBuf).resize(1400).jpeg({ quality: 86 }).toFile(`${OUT}/full_off.jpg`)

const R = (a, b) => (b ? +(a / b).toFixed(3) : 0)
const summary = {
  stage: STAGE, pose: POSE, hasDof: { on: hasDofOn, defeat: hasDofDef, off: hasDofOff },
  fighter: { on: +fOn.toFixed(2), off: +fOff.toFixed(2), defeat: +fDef.toFixed(2), maskPx: mask.count, drift: +drift.toFixed(2),
    on_over_off: R(fOn, fOff), defeat_over_on: R(fDef, fOn) },
  stageBand: { on: +sOn.toFixed(2), off: +sOff.toFixed(2), defeat: +sDef.toFixed(2), on_over_off: R(sOn, sOff) },
  aRectOn: aRectOn.world, aRectOff: aRectOff.world,
}
writeFileSync(`${OUT}/dof.json`, JSON.stringify({ ...summary, errors }, null, 2))
console.log(JSON.stringify(summary, null, 2))

// ---- Assertions -------------------------------------------------------------
let pass = true
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`); if (!cond) pass = false }
console.log('\n--- verdict ---')

// D) pass presence — never measure a silently-dropped tier.
check(hasDofOn === true, `DOF present on ON load (hasDof=${hasDofOn})`)
check(hasDofDef === true, `DOF present on DEFEAT load (hasDof=${hasDofDef})`)
check(hasDofOff === false, `DOF absent on ?nodof load (hasDof=${hasDofOff})`)

// house rule: subject really in the mask, band really has edges.
check(mask.count > 4000, `fighter body in mask (${mask.count}px)`)
check(sOff >= 3.0, `stage band has real edges in OFF (energy ${sOff.toFixed(2)} >= 3.0) [not an empty rect]`)
check(drift < 8, `fighter aligned across loads (rect drift ${drift.toFixed(2)} < 8)`)

// A) the stage defocuses.
check(R(sOn, sOff) <= 0.70, `stage band defocuses: ON ${sOn.toFixed(2)} <= 0.70 x OFF ${sOff.toFixed(2)} (ratio ${R(sOn, sOff)})`)

// B) the fighters are NOT softened.
check(Math.abs(fOn - fOff) <= 0.15 * fOff, `fighter interior preserved: |ON ${fOn.toFixed(2)} - OFF ${fOff.toFixed(2)}| <= 15% (ratio ${R(fOn, fOff)})`)

// C) mutation — the metric CAN see a softened fighter, so B is meaningful.
check(R(fDef, fOn) <= 0.65, `[mutation] dofDefeat softens fighter: DEFEAT ${fDef.toFixed(2)} <= 0.65 x ON ${fOn.toFixed(2)} (ratio ${R(fDef, fOn)})`)

console.log(errors.length ? `\n${errors.length} console errors (first 5):` : '\nno console errors')
for (const e of [...new Set(errors)].slice(0, 5)) console.log(`  ${e}`)
console.log(`\nartifacts in ${OUT}/`)
await browser.close()
process.exit(pass ? 0 : 1)
