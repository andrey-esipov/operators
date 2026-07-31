// Occluder-over-fighter probe (Defect 1) — mutation-provable.
//
// The foreground "pylons" were authored as a screen-space framing device (see
// StageSet.foreground: "the true frame edges") but built as fixed-x WORLD
// geometry. The play camera (FightCamera) dollies across a wide range (the
// recent maxZ 18 -> 28 change widened it further), so a world-space box swings
// across the frame as the shot changes and lands over the fighter. The fix
// parents the occluders to a `frame` group whose world matrix each frame is
// C_live · V0 (V0 = the neutral view the occluders were composed against), so
// they hold their authored SCREEN position for any camera pose.
//
// This proves the fix AND — the house rule — proves it could fail, by flipping
// the exact toggle that re-injects the old behaviour
// (`__STAGE__.setFramePinned(false)` collapses the frame to identity = the
// authored world positions) with every other variable held constant.
//
// Camera control: the play route has NO debug-beat hook (that is the dev route's
// CameraDirector). FightCamera is driven purely by the two fighters' positions,
// so we compose each "shot" by parking the fighters via window.__PLAY__.state()
// while paused and letting the camera springs settle onto them.
//
// Metric — the KEY correction over two earlier naive versions.
//
//   v1 (union box): the two-fighter coverage UNION box is mostly empty background
//   and catches the (desirable) four-corner edge vignette, so it rewarded the
//   UN-framed world-space look. Useless.
//
//   v2 (foreground-toggle diff in a tight column): differencing foreground-shown
//   vs -hidden is blind to the actual defect — the pylon is near-BLACK and it
//   most often covers the DARK background beside the fighter or his dark shirt, so
//   |shown-hidden| is ~0 exactly where it matters. It ALSO still caught the pinned
//   vignette in the tall column (a pure false-positive on the fix).
//
//   v3 (this one): a REFERENCE-MASK body-occlusion. The fighters are NOT under the
//   `frame` group, so at a fixed placement they render at bit-identical pixels
//   whether the occluders are pinned, world-space, or hidden — only the foreground
//   moves. So we capture a foreground-HIDDEN reference (fighter fully visible),
//   build a body mask = the BRIGHT pixels of that reference inside A's projected
//   column (skin / denim / lit cloth — this EXCLUDES the dark background where the
//   vignette lives), then for each pin state measure the fraction of those body
//   pixels that go NEAR-BLACK, i.e. are painted over by the near-black occluder.
//   Directional, vignette-immune, and honest about black-on-dark (it only claims
//   occlusion of body it can actually see lit).
import { chromium } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import sharp from 'sharp'

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const PORT = arg('--port', '5410')
const STAGE = arg('--stage', 'pre-pmf')
const OUT = `tools/_out/occluder-${STAGE}`
const URL = `http://localhost:${PORT}/?stage=${STAGE}&cpu=dummy`

const W = 3200, H = 1800 // DPR 2 × 1600×900
const CH = 3 // decode stride: PNG screenshots here decode to RGB (no alpha). We force
             // this with .removeAlpha() so indexing never overflows a 3-channel buffer.
             // (A prior *4 stride overflowed on low-in-frame crops → false body=0.)
const CM_TO_WORLD = 3.4 / 180
const FIGHTER_H = 3.4
const A_HALF_W = 0.68 // world half-width of the tight column around fighter A
const T_BODY = 42 // luma above which a reference pixel is "visible fighter body"
const T_DARK = 24 // luma below which a body pixel is "painted over by the black occluder"

// Shots exercise the play camera across its range. The garage left pylon is
// authored at world x = -3.2 (= -169 cm). The defect only bites when the camera
// DOLLIES OUT from its neutral pose: at rest C_live≈C0 so a camera-pinned
// occluder and a world-space one project to nearly the same place (both fine);
// as the camera pulls out (a launch/juggle/super) they diverge, and the
// world-space pylon marches inward across the play area onto the downed fighter.
// So the control sits at rest, and the two defect shots park the DOWNED fighter A
// on the pylon while B is flung high/far to force a big pull-out.
const SHOTS = [
  { name: 'neutral', role: 'control', a: [-40, 0], b: [40, 0] },       // A clear of any pylon, rest camera
  { name: 'knockdown', role: 'defect', a: [-169, 0], b: [60, 430] },   // A downed on the pylon, juggle pull-out (the reported defect)
  { name: 'launch', role: 'defect', a: [-169, 0], b: [-30, 450] },     // A downed on the pylon, high juggle from the left (a second, distinct max pull-out)
]

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })

const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)))

await page.goto(URL, { waitUntil: 'domcontentloaded' })

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
    ok = await page.evaluate(
      () =>
        !!window.__PLAY__?.ready?.() &&
        window.__PLAY__.state().phase === 'fight' &&
        !!window.__STAGE__?.setFramePinned &&
        !!window.__STAGE__?.setForegroundVisible &&
        !!window.__STAGE__?.project,
    )
  } catch { ok = false }
  stable = ok ? stable + 1 : 0
  await page.waitForTimeout(30)
}
if (stable < 12) { console.log('FAILED: play route + __STAGE__ hooks (incl. project) never settled'); await browser.close(); process.exit(1) }
await page.mouse.click(800, 450) // dismiss the arcade boot gate

async function stageLuma(buf) {
  const { data, info } = await sharp(buf)
    .extract({ left: 0, top: Math.round(H * 0.14), width: W, height: Math.round(H * 0.7) })
    .resize(120).raw().toBuffer({ resolveWithObject: true })
  let sum = 0
  const n = data.length / info.channels
  for (let i = 0; i < data.length; i += info.channels) sum += (data[i] + data[i + 1] + data[i + 2]) / 3
  return sum / n
}

async function screenshotSafe() {
  // The only failure we guard is the ~1-in-9 truly-black cleared drawing buffer
  // (luma ≈ 0). A dark-but-valid juggle scene sits ~10–18, so the threshold is
  // low. The engine renders every rAF even while the sim is paused, so a plain
  // retake yields a fresh frame — we must NOT resume the sim (that would let an
  // airborne fighter fall and, worse, unsettle the camera we just froze).
  for (let i = 0; i < 8; i++) {
    const buf = await page.screenshot()
    if ((await stageLuma(buf)) >= 6) return buf
    await page.waitForTimeout(120)
  }
  return null
}

// A downscaled RGB fingerprint of the play area, for the stillness gate.
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

// House rule: a moving camera between the reference and the shown capture makes
// the body mask misalign and the silhouette edge reads as false "occlusion". So
// do not measure until the camera is FROZEN — two frames 280ms apart are ~equal.
async function settleCamera() {
  let prev = null
  for (let i = 0; i < 16; i++) {
    const buf = await screenshotSafe()
    if (!buf) return false
    const fp = await fingerprint(buf)
    if (prev && meanAbsDiff(prev, fp) < 0.8) return true
    prev = fp
    await page.waitForTimeout(280)
  }
  return true // best effort; assertions below still guard on body-pixel count
}

async function compose(shot) {
  await page.evaluate(() => { try { window.__PLAY__.resume() } catch {} })
  await page.evaluate(({ a, b }) => {
    const st = window.__PLAY__.state()
    const [fa, fb] = st.fighters
    fa.pos.x = a[0]; fa.pos.y = a[1]; fa.vel.x = 0; fa.vel.y = 0
    fb.pos.x = b[0]; fb.pos.y = b[1]; fb.vel.x = 0; fb.vel.y = 0
    window.__PLAY__.pause()
  }, shot)
  await page.waitForTimeout(900)
  await settleCamera() // block until the camera is frozen, not a fixed guess
}

// Project fighter A's tight silhouette column to a top-left pixel rect via the
// live camera. Reads A's settled sim pos back (it may micro-drift), converts to
// world, projects head/feet/±half-width, converts NDC (+y up) → pixels.
async function fighterARect() {
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

const luma = (buf, i) => buf[i] * 0.299 + buf[i + 1] * 0.587 + buf[i + 2] * 0.114
const ERODE = 4 // px: only count body pixels whose ±ERODE neighbours are also body,
                // so a residual 1–3px camera drift at the silhouette edge cannot
                // masquerade as occlusion.
const DROP = 70 // a body pixel only counts as OCCLUDED if it also fell this many
                // luma from the reference — a hard black occluder drops lit skin
                // ~150→~10; the pinned frame's subtle edge scrim drops it <30, so
                // this cleanly separates a real occluder from a grade difference.

// Fraction of A's INTERIOR visible body (bright in the foreground-HIDDEN
// reference, eroded off the silhouette edge) that a given state paints
// NEAR-BLACK **and** sharply darker than the reference — i.e. covers with the
// near-black occluder. Returns the body-pixel count so the caller can confirm
// the subject was in the mask (house rule: subject-in-crop before you compute).
function bodyOcclusion(ref, state, rect) {
  const { x0, y0, x1, y1 } = rect
  const isBody = (x, y) => luma(ref, (y * W + x) * CH) > T_BODY
  let body = 0, dark = 0
  for (let y = y0 + ERODE; y < y1 - ERODE; y++) {
    for (let x = x0 + ERODE; x < x1 - ERODE; x++) {
      if (
        isBody(x, y) &&
        isBody(x - ERODE, y) && isBody(x + ERODE, y) &&
        isBody(x, y - ERODE) && isBody(x, y + ERODE)
      ) {
        body++
        const i = (y * W + x) * CH
        const ls = luma(state, i)
        if (ls < T_DARK && luma(ref, i) - ls > DROP) dark++
      }
    }
  }
  return { body, dark, frac: body ? dark / body : 0 }
}

const rows = []

for (const shot of SHOTS) {
  await compose(shot)

  // Confirm the subject is in the crop before measuring (house rule).
  const cov = await page.evaluate(() => { window.__STAGE__.setForegroundVisible(true); return window.__PLAY__.coverage() })
  const aRect = await fighterARect()
  const aArea = (aRect.x1 - aRect.x0) * (aRect.y1 - aRect.y0)
  if (!cov?.bbox || cov.fraction < 0.008 || aArea < 200 * 200) {
    console.log(`  ${shot.name}: subject not in crop (cov=${cov?.fraction?.toFixed?.(3)}, aArea=${aArea}) — skip`)
    continue
  }

  // Reference: foreground HIDDEN. The fighter is not under the frame group, so
  // this is his fully-visible silhouette at this exact camera — the mask source.
  await page.evaluate(() => window.__STAGE__.setForegroundVisible(false))
  await page.waitForTimeout(120)
  const refBuf = await screenshotSafe()
  if (!refBuf) { console.log(`FAILED: ${shot.name} lost drawing buffer (ref)`); await browser.close(); process.exit(1) }
  const ref = await sharp(refBuf).removeAlpha().raw().toBuffer()
  // Save the reference crop too — if this is dark/misaligned, body-pixel count
  // will be ~0 and every occlusion reading is meaningless (house rule: prove the
  // subject is in the mask, don't trust a silent zero).
  await sharp(refBuf)
    .extract({ left: aRect.x0, top: aRect.y0, width: Math.max(1, aRect.x1 - aRect.x0), height: Math.max(1, aRect.y1 - aRect.y0) })
    .toFile(`${OUT}/${shot.name}_ref_Acol.png`)

  for (const pinned of [true, false]) {
    await page.evaluate((p) => window.__STAGE__.setFramePinned(p), pinned)
    await page.waitForTimeout(200)
    await page.evaluate(() => window.__STAGE__.setForegroundVisible(true))
    await page.waitForTimeout(80)
    const shownBuf = await screenshotSafe()
    if (!shownBuf) { console.log(`FAILED: ${shot.name}/${pinned} lost drawing buffer`); await browser.close(); process.exit(1) }
    const shown = await sharp(shownBuf).removeAlpha().raw().toBuffer()

    const occ = bodyOcclusion(ref, shown, aRect)

    // Save a native-res crop of the fighter column (shown) for eyeball review.
    await sharp(shownBuf)
      .extract({ left: aRect.x0, top: aRect.y0, width: Math.max(1, aRect.x1 - aRect.x0), height: Math.max(1, aRect.y1 - aRect.y0) })
      .toFile(`${OUT}/${shot.name}_pin-${pinned}_Acol.png`)
    await sharp(shownBuf).resize(1400).jpeg({ quality: 84 }).toFile(`${OUT}/${shot.name}_pin-${pinned}.jpg`)

    const row = { shot: shot.name, pinned, coverage: +cov.fraction.toFixed(3), aWorld: aRect.world, aBox: { w: aRect.x1 - aRect.x0, h: aRect.y1 - aRect.y0 }, bodyPx: occ.body, occ: +occ.frac.toFixed(3) }
    rows.push(row)
    console.log(`  ${shot.name.padEnd(10)} pin=${String(pinned).padEnd(5)} A@world(${row.aWorld.wx},${row.aWorld.fy}) body=${occ.body}px occludesA=${(row.occ * 100).toFixed(1)}%`)
  }
  await page.evaluate(() => window.__STAGE__.setFramePinned(true))
}

writeFileSync(`${OUT}/occluder.json`, JSON.stringify({ stage: STAGE, shots: SHOTS, rows, errors }, null, 2))

// ---- Assertions -----------------------------------------------------------
const get = (shot, pinned) => rows.find((r) => r.shot === shot && r.pinned === pinned)
let pass = true
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}: ${msg}`); if (!cond) pass = false }

const PIN_CLEAR = 0.03 // the fix must keep A's body ≤ this covered
const WORLD_BURY = 0.10 // the injected defect must cover ≥ this much of A's body
const MARGIN = 0.08 // and beat the pinned build by at least this

console.log('\n--- verdict ---')

// 1) Every shot measured a real subject (body pixels) in-crop.
for (const s of SHOTS) {
  const r = get(s.name, true)
  check(!!r && r.bodyPx > 4000, `${s.name}: fighter A body in crop (${r?.bodyPx ?? 0}px)`)
}

// 2) The defect: on the pull-out shots the WORLD-SPACE occluder is painted over
//    the downed fighter's body; PINNING clears it. Proven at two distinct camera
//    excursions (juggle `knockdown`, far+high `launch`). pin=false IS the
//    mutation — it re-injects the authored world positions and MUST make every
//    assertion the pinned build passes go red.
for (const s of SHOTS.filter((x) => x.role === 'defect')) {
  const p = s.name
  const on = get(p, true), off = get(p, false)
  if (!on || !off) { check(false, `${p}: missing a measurement`); continue }
  check(off.occ >= WORLD_BURY, `${p}: world-space buries A's body (${(off.occ * 100).toFixed(1)}% ≥ ${WORLD_BURY * 100}%) [mutation]`)
  check(off.occ - on.occ >= MARGIN, `${p}: pinning clears it (world ${(off.occ * 100).toFixed(1)}% − pinned ${(on.occ * 100).toFixed(1)}% ≥ ${MARGIN * 100}pt)`)
  check(on.occ <= PIN_CLEAR, `${p}: pinned keeps A's body clear (${(on.occ * 100).toFixed(1)}% ≤ ${PIN_CLEAR * 100}%)`)
}

// 3) Control: with A clear of any pylon, pinned and world-space agree (neither
//    covers A) — so the effect above is the pylon, not a probe artefact.
const cOn = get('neutral', true), cOff = get('neutral', false)
if (cOn && cOff) {
  check(cOn.occ <= PIN_CLEAR && cOff.occ <= PIN_CLEAR, `neutral control: neither pin state covers A (pinned ${(cOn.occ * 100).toFixed(1)}%, world ${(cOff.occ * 100).toFixed(1)}%)`)
}

console.log(errors.length ? `\n${errors.length} console errors (first 5):` : '\nno console errors')
for (const e of [...new Set(errors)].slice(0, 5)) console.log(`  ${e}`)
console.log(`\nartifacts in ${OUT}/`)
await browser.close()
process.exit(pass ? 0 : 1)
