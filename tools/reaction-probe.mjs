#!/usr/bin/env node
/**
 * reaction-probe — the two reads the critic capped the motion score on.
 *
 *   --mode latency    spark -> first victim pose change, in sim frames (target <=2)
 *   --mode footplant  does the walk cycle actually scissor, or does the fighter glide
 *
 * ---------------------------------------------------------------------------
 * STATUS: THE LATENCY MODE DOES NOT PRODUCE A REPRODUCIBLE NUMBER. DO NOT GATE
 * ON IT, AND DO NOT REBUILD IT THIS WAY.
 * ---------------------------------------------------------------------------
 * It is committed as a record of a negative result, because the approach is the
 * obvious one and someone will otherwise build it again.
 *
 * Measured outcome, `--mode latency`, active-fraction of the post-hitstop
 * reaction window:
 *
 *     HEAD, run 1 ......................................... 71%  (10/14)
 *     HEAD, run 2 ......................................... 29%  (4/14)
 *     196742b, reactions provably clamped to one frame .... 33%  (6/18)
 *
 * Run-to-run variance on ONE build (71 -> 29) is larger than the difference
 * between a working build and a broken one (71 vs 33). The number is noise.
 *
 * Three things defeat the pixel approach, and they compound:
 *   1. The crop is the victim's half of the screen, which also contains the
 *      ATTACKER, who animates normally on both builds.
 *   2. The hit spark is a NEW object. No rigid alignment can remove something
 *      that did not exist in the previous frame, so the contact frame reads
 *      high on every build, fixed or broken.
 *   3. The floor is derived from each run's own median, so it moves with
 *      whatever else happens to be on screen that run.
 *
 * What would actually answer the question is not pixels at all: expose the
 * resolved atlas frame index per fighter through the dev hook and assert it
 * advances during a reaction. That is immune to the attacker, the spark, the
 * camera and translation, because it reads the thing itself instead of a proxy
 * for it. `src/three/fight/__tests__/reactionClip.test.ts` already does exactly
 * this at unit level, including a baked-in mutation that collapses the clip to
 * one frame -- which is why the reaction fix is genuinely proven and this tool
 * adds nothing to that proof.
 *
 * `alignedResidual()` below is still worth keeping and reusing: it is a correct
 * translation-invariant change measure, and it is the thing that exposed the
 * first version of this tool as a liar.
 * ---------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------
 * Why the spark doesn't need a hand-drawn mask (the v1 reasoning — it was wrong)
 * ---------------------------------------------------------------------------
 * The obvious way to measure "when did the victim first react" is per-pixel
 * change. It doesn't work: the hit spark is the brightest thing in frame, it
 * appears on the contact frame, and it swamps the pose. Every previous attempt
 * on this project to solve that class of problem used a hand-tuned crop, and a
 * hand-tuned crop is what once put an *empty rectangle* in the motion tool and
 * returned a confident "6.0 keys/sec" about a region the fighter had jumped out
 * of.
 *
 * So this measures a property the spark cannot have. Hit sparks are additive:
 * they only ever ADD light. A pose change moves an opaque dark silhouette
 * through the frame, which necessarily makes some pixels DARKER -- the limb
 * arrives where background used to be.
 *
 *   spark        -> brightening only
 *   pose change  -> brightening AND darkening
 *
 * Counting only pixels that got darker is therefore structurally immune to the
 * spark, rather than immune-if-the-rectangle-is-right. That is the difference
 * between an assertion the failure mode can satisfy and one it cannot, which is
 * the single recurring lesson of this project's fourteen lying harnesses.
 *
 * It also gives the tool a free discriminator: it reports the brightening
 * channel too, so you can SEE the spark land on one frame and the pose follow
 * on another. If those two ever coincide exactly, the separation has failed and
 * the number should not be trusted.
 * ---------------------------------------------------------------------------
 */
import { chromium } from 'playwright-core'
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const PORT = arg('--port', '5410')
const MODE = arg('--mode', 'latency')
const OUT = arg('--out', 'reaction-probe')
const QUERY = arg('--query', 'a=spiegel&b=lenny&p1=warden&p2=operator&cpu=easy')
// The mutation control. With --step 0 the sim never advances, so there is no
// pose change to find and latency must come back "none". A run that still
// reports a latency under --step 0 is measuring renderer drift, not animation.
const STEP = Number(arg('--step', '1'))
const FRAMES = Number(arg('--frames', '24'))
// Frames to keep capturing after contact. Must outlast hitstop, or the whole
// reaction window is spent inside the freeze and every build looks identical.
const AFTER = Number(arg('--after', '26'))
const SHA = arg('--build', execSync('git rev-parse --short HEAD').toString().trim())

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
page.on('console', (m) => { if (m.type() === 'error') console.log('  console error:', m.text()) })

let reloaded = false
page.on('framenavigated', (f) => { if (f === page.mainFrame()) reloaded = true })

const key = async (k, ms = 60) => { await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k) }

/** Setup is idempotent, so a reload here is recoverable; during capture it is fatal. */
async function setup() {
  for (let attempt = 1; attempt <= 6; attempt++) {
    await page.goto(`http://localhost:${PORT}/?${QUERY}`, { waitUntil: 'domcontentloaded' })
    // Reset AFTER the goto: our own navigation fires `framenavigated` too, so
    // arming the flag first makes the tool report a reload on every single
    // attempt and never settle. Cost me a run.
    reloaded = false
    try {
      await page.waitForFunction(() => window.__PLAY__?.ready?.(), null, { timeout: 30000 })
      await page.waitForTimeout(2500)
      await key('KeyJ')
      await page.waitForTimeout(400)
      if (await page.evaluate(() => window.__PLAY__.state().phase) !== 'fight') {
        await page.waitForFunction(() => window.__PLAY__.state().phase === 'fight', null, { timeout: 20000 })
      }
      if (reloaded) throw new Error('vite reloaded during setup')
      return
    } catch (e) {
      console.log(`  setup retry ${attempt}/6 — ${e.message.split('\n')[0]}`)
    }
  }
  throw new Error('setup never settled')
}

await setup()
console.log(`reaction-probe  mode=${MODE}  build ${SHA}  step=${STEP}`)

const st = () => page.evaluate(() => {
  const s = window.__PLAY__.state()
  return {
    frame: s.frame, hitstop: s.hitstop, phase: s.phase,
    f: s.fighters.map((x) => ({
      x: x.pos.x, y: x.pos.y, stance: x.stance, stun: x.stunRemaining ?? 0,
      hp: x.health, combo: x.comboCount ?? 0,
    })),
  }
})

/** Step the frozen sim and wait for it to actually consume the step. */
async function advance(n) {
  try { await page.evaluate((k) => window.__PLAY__.step(k), n) }
  catch (e) {
    console.log(`FAILED: page reloaded mid-capture (${e.name}). Any number from here is a restarted match.`)
    await browser.close(); process.exit(1)
  }
  for (let w = 0; w < 25; w++) {
    if ((await page.evaluate(() => window.__PLAY__.stepsPending())) <= 0) break
    await page.waitForTimeout(16)
  }
  if (reloaded) {
    console.log('FAILED: page reloaded mid-capture.')
    await browser.close(); process.exit(1)
  }
}

const grey = async (b) => sharp(b).greyscale().raw().toBuffer({ resolveWithObject: true })

/**
 * Signed change split into the two channels that separate a spark from a pose.
 * `darker` is the spark-immune one; `brighter` exists so the spark is visible
 * as its own event and the separation can be checked rather than assumed.
 */
/**
 * Best-alignment residual: how much of the change survives after the best rigid
 * translation is removed.
 *
 * ---------------------------------------------------------------------------
 * Why this replaced a simpler measurement that was lying
 * ---------------------------------------------------------------------------
 * v1 of this tool counted pixels that got darker and called that "the victim's
 * pose changed". It reported a clean 0-frame latency on HEAD -- and then, run
 * against `196742b` (the commit immediately BEFORE reaction animations were
 * un-frozen, where all four reaction clips provably rendered a single clamped
 * frame), it reported 0-frame latency again.
 *
 * The reason is that a hit knocks the victim BACKWARDS. A frozen sprite that
 * merely translates moves its silhouette across the frame and darkens plenty of
 * pixels. So the assertion "the silhouette changed" was satisfied by the exact
 * failure mode it was supposed to detect -- the signature of every one of this
 * project's fifteen lying harnesses, this one authored by me.
 *
 * The fix is to measure a property translation cannot fake. Search a small
 * window of rigid shifts, take the one that best explains the change, and report
 * what is LEFT OVER. Pure translation aligns to near-zero residual. A genuine
 * pose change -- a head thrown back, an arm folding -- cannot be undone by
 * sliding the image, so its residual stays high.
 * ---------------------------------------------------------------------------
 */
function alignedResidual(a, b, maxDx = 10, maxDy = 6) {
  const W = a.info.width, H = a.info.height
  let best = Infinity, bx = 0, by = 0
  for (let dy = -maxDy; dy <= maxDy; dy++) {
    for (let dx = -maxDx; dx <= maxDx; dx++) {
      let sum = 0, n = 0
      // Step 2 px for speed; the shift search does not need every pixel.
      for (let y = Math.max(0, -dy); y < Math.min(H, H - dy); y += 2) {
        const rowA = y * W, rowB = (y + dy) * W
        for (let x = Math.max(0, -dx); x < Math.min(W, W - dx); x += 2) {
          sum += Math.abs(a.data[rowA + x] - b.data[rowB + x + dx]); n++
        }
      }
      const m = n ? sum / n : Infinity
      if (m < best) { best = m; bx = dx; by = dy }
    }
  }
  return { residual: best, dx: bx, dy: by }
}

function channels(prev, curr, th) {
  let darker = 0, brighter = 0
  for (let p = 0; p < curr.data.length; p++) {
    const d = curr.data[p] - prev.data[p]
    if (d < -th) darker++
    else if (d > th) brighter++
  }
  return { darker, brighter }
}

if (MODE === 'latency') {
  // Capture the whole play area; the victim's half is extracted afterwards,
  // once sim state has told us who actually got hit. Choosing the crop up front
  // would mean guessing the victim before the hit exists -- and a crop chosen
  // ahead of the subject is exactly what once put an empty rectangle in the
  // motion tool and returned a confident reading about a region the fighter had
  // jumped out of.
  const FULL = { x: 0, y: 80, width: 1280, height: 580 }

  // ── Step THROUGH contact, rather than freezing after it ──
  // The first version resumed the sim, watched for an HP drop, then froze. That
  // lands 1+ frames *past* contact, so the victim is already in `juggle` on
  // frame 0 and the brightest thing in the capture is hitstop releasing, not the
  // hit. It measured the wrong event and reported a confident 0.
  //
  // So: freeze first, hold attack, and advance one frame at a time watching sim
  // state. Contact is then a known frame index inside the capture, not a guess.
  await page.evaluate(() => window.__PLAY__.pause())
  // Put the fighters in range deterministically rather than waiting for the AI
  // to close distance. `state()` returns the live sim object -- verified on this
  // project by mutating a value and reading it back -- so this is a placement,
  // not a mock. 40 stepped frames of a light punch from neutral range produced
  // no contact at all, which is a capture problem, not a game problem.
  await page.evaluate((gap) => {
    const s = window.__PLAY__.state()
    s.fighters[0].pos.x = -gap / 2
    s.fighters[1].pos.x = gap / 2
  }, Number(arg('--gap', '78')))
  await advance(1)
  await page.keyboard.down('KeyJ')

  const shots = []
  let contactAt = -1
  let victim = -1
  let prev = await st()
  for (let i = 0; i < FRAMES && (contactAt < 0 || i < contactAt + AFTER); i++) {
    // Interleaved zero-step control, the pattern motion-strip.mjs mutation-proved.
    // Without it this is dominated by the camera: the first version reported
    // darker/brighter within 0.01% of each other on most frames (f12: 21830 vs
    // 21827), the signature of the whole frame translating rather than a fighter
    // moving. `pause()` freezes the sim, never the renderer.
    const before = await page.screenshot({ clip: FULL })
    await advance(0)
    const control = await page.screenshot({ clip: FULL })
    await advance(STEP)
    const stepped = await page.screenshot({ clip: FULL })
    const s = await st()
    if (contactAt < 0) {
      for (const k of [0, 1]) if (s.f[k].hp < prev.f[k].hp) { contactAt = i; victim = k }
    }
    prev = s
    shots.push({ before, control, stepped, s })
  }
  await page.keyboard.up('KeyJ')
  await page.evaluate(() => window.__PLAY__.resume())
  if (contactAt < 0) {
    console.log(`FAILED: no hit landed inside ${FRAMES} stepped frames — nothing to measure.`)
    await browser.close(); process.exit(1)
  }
  console.log(`  contact on frame ${contactAt}, victim = fighter ${victim} (${shots[contactAt].s.f[victim].stance}, hitstop ${shots[contactAt].s.hitstop})`)
  // The victim's half, extracted now that we know which half that is. The spark
  // is deliberately left inside it -- the darkening channel plus the control is
  // what excludes it, and leaving it in is what lets the tool prove it did.
  const halfBox = { left: victim === 0 ? 0 : 640, top: 0, width: 640, height: 580 }
  const cut = (b) => sharp(b).extract(halfBox).greyscale().raw().toBuffer({ resolveWithObject: true })
  // Downscaled copy for the shift search. 160px wide keeps the search cheap and
  // makes one search pixel ~4 real pixels, which is finer than any pose change
  // worth calling a pose change.
  const small = (b) => sharp(b).extract(halfBox).greyscale().resize(160).raw().toBuffer({ resolveWithObject: true })

  const TH = 18
  const series = []
  for (let i = 0; i < shots.length; i++) {
    const [b, c, s2] = await Promise.all([cut(shots[i].before), cut(shots[i].control), cut(shots[i].stepped)])
    const [bs, cs, ss] = await Promise.all([small(shots[i].before), small(shots[i].control), small(shots[i].stepped)])
    const drift = channels(b, c, TH)      // renderer only — camera, atmosphere
    const moved = channels(c, s2, TH)     // renderer + one sim step
    // Translation-invariant. `driftRes` is what the renderer alone leaves behind
    // after alignment (camera dolly aligns away; atmosphere does not), and is
    // the floor this frame's pose signal has to clear.
    const driftRes = alignedResidual(bs, cs)
    const moveRes = alignedResidual(cs, ss)
    series.push({
      i,
      darker: Math.max(0, moved.darker - drift.darker),
      brighter: Math.max(0, moved.brighter - drift.brighter),
      driftDark: drift.darker,
      pose: Math.max(0, moveRes.residual - driftRes.residual),
      shift: moveRes.dx,
      driftRes: driftRes.residual,
      st: shots[i].s,
    })
  }

  // The spark is searched for from contact onward, not globally: the brightest
  // frame in a longer capture is often hitstop releasing, which is a different
  // event and produced a confident, wrong 0 in the first version of this tool.
  const after = series.filter((r) => r.i >= contactAt)
  const maxBright = Math.max(...after.map((r) => r.brighter))
  const sparkAt = after.find((r) => r.brighter === maxBright)
  // Floor for "the pose actually changed": the quietest darkening in the run,
  // scaled. Derived from the run itself rather than a constant, so a change of
  // stage or zoom can't silently move the threshold.
  // Floor from the run's own quiet frames, on the translation-invariant channel.
  const sortedPose = [...series.map((r) => r.pose)].sort((a, b) => a - b)
  const quiet = sortedPose[Math.floor(sortedPose.length * 0.5)]
  const POSE = Math.max(quiet * 2.0, 1.5)
  const poseAt = series.find((r) => r.i >= contactAt && r.pose > POSE)

  console.log(`\n  frame   POSE  shiftPx  spark(bright)  stance      stun  hitstop`)
  for (const r of series) {
    const mark = r.i === contactAt ? ' <- CONTACT' : (poseAt && r.i === poseAt.i ? ' <- first pose change' : '')
    console.log(`  ${String(r.i).padStart(5)}  ${r.pose.toFixed(2).padStart(5)}  ${String(r.shift).padStart(7)}  ${String(r.brighter).padStart(13)}  ${r.st.f[victim].stance.padEnd(10)} ${String(r.st.f[victim].stun).padStart(5)} ${String(r.st.hitstop).padStart(8)}${mark}`)
  }

  console.log(`\n  POSE = residual change after the best rigid shift is removed, so pure`)
  console.log(`  knockback translation cannot satisfy it. floor ${POSE.toFixed(2)} (run median ${quiet.toFixed(2)})`)
  // ── The verdict ──
  // Sub-frame latency AT contact is not measurable this way and the tool says so
  // rather than inventing a number: the spark is a NEW object in the frame, and
  // no rigid shift can align away an object that did not exist a frame earlier.
  // So the contact frame reads high on every build, fixed or broken.
  //
  // What DOES separate a working reaction from a frozen one is the window after
  // hitstop releases. A live reaction plays its recovery out; a clamped clip sits
  // on one frame forever. That is measured here.
  const release = series.find((r) => r.i > contactAt && r.st.hitstop === 0)
  const window = series.filter((r) => release && r.i >= release.i)
  const active = window.filter((r) => r.pose > POSE)
  const peak = window.length ? Math.max(...window.map((r) => r.pose)) : 0

  console.log(`\n  contact ...................... f${contactAt}`)
  console.log(`  hitstop released ............. ${release ? 'f' + release.i : 'NEVER (capture too short — raise --after)'}`)
  console.log(`  frames in reaction window .... ${window.length}`)
  console.log(`  frames with real pose change . ${active.length}`)
  console.log(`  peak pose signal ............. ${peak.toFixed(2)}  (floor ${POSE.toFixed(2)})`)
  const frac = window.length ? active.length / window.length : 0
  console.log(`  ACTIVE FRACTION .............. ${(frac * 100).toFixed(0)}%  (${active.length}/${window.length})`)

  // ── Calibration, stated honestly rather than dressed up as a gate ──
  // Run head-to-head against `196742b`, the commit immediately before reaction
  // animations were un-frozen:
  //
  //     HEAD (reactions play) .... 10/14 = 71%
  //     196742b (all four clips clamped to one frame) .... 6/18 = 33%
  //
  // A 2.2x separation, in the right direction. But 33% is NOT zero, and that
  // matters: the crop is the victim's half of the screen, which also contains
  // the ATTACKER (who animates normally on both builds) and the spark's decay.
  // So the floor is contaminated by things that were never broken.
  //
  // Therefore this prints a number and refuses to print a verdict. An earlier
  // version of this tool did emit PASS/FAIL -- and returned PASS on the build
  // where reactions provably never played, which is the exact shape of the
  // fifteen lying harnesses catalogued on this project. Two samples is not a
  // threshold, and a green light nobody can fail is worse than no light.
  console.log(`\n  Calibration: 71% on a build where reactions play, 33% on 196742b where`)
  console.log(`  all four reaction clips were clamped to a single frame. Higher is better,`)
  console.log(`  but the crop also contains the attacker and the spark decay, so the broken`)
  console.log(`  build does not read zero. NO PASS/FAIL IS EMITTED: n=1 per build is a`)
  console.log(`  measurement, not a threshold, and a gate the failure mode passes is worse`)
  console.log(`  than no gate. Compare runs; do not trust a single number.`)
  if (STEP === 0) console.log(`  [--step 0: the sim never advances, so any active fraction here is renderer drift.]`)
  if (poseAt) console.log(`  (first post-contact pose change at f${poseAt.i}; spark peak f${sparkAt.i})`)

  writeFileSync(`${OUT}/latency.json`, JSON.stringify({ sha: SHA, step: STEP, victim, contactAt, releaseAt: release?.i ?? null, activeFrames: active.length, windowFrames: window.length, activeFraction: frac, peak, series: series.map((r) => ({ i: r.i, pose: r.pose, shift: r.shift, brighter: r.brighter, hitstop: r.st.hitstop, stance: r.st.f[victim].stance })) }, null, 2))
  for (let i = 0; i < shots.length; i++) writeFileSync(`${OUT}/lat-${String(i).padStart(2, '0')}.png`, shots[i].stepped)
}

if (MODE === 'footplant') {
  // ── Does the walk cycle scissor, or does the fighter glide? ──
  // Measured as the horizontal SEPARATION of the two feet over a walk, which is
  // camera-independent by construction: the camera dollies and zooms constantly,
  // so any absolute screen position would be measuring the camera. A real walk
  // oscillates between a passing position (feet together) and a stride (feet
  // apart). A glide holds the separation constant -- the fighter translates
  // with the legs locked, which is exactly what moonwalking is.
  await page.evaluate(() => window.__PLAY__.pause())
  const rows = []
  for (let i = 0; i < FRAMES; i++) {
    await page.keyboard.down('ArrowRight')
    await advance(STEP)
    await page.keyboard.up('ArrowRight')
    const s = await st()
    const buf = await page.screenshot({ clip: { x: 40, y: 80, width: 600, height: 580 } })
    const g = await grey(buf)
    const W = g.info.width, H = g.info.height
    // The contact band: the lowest rows carrying fighter-dark pixels. Feet are
    // the darkest thing at floor level (dark sneakers on a lit floor).
    let bandY = -1
    for (let y = H - 1; y >= H * 0.55; y--) {
      let dark = 0
      for (let x = 0; x < W; x++) if (g.data[y * W + x] < 60) dark++
      if (dark >= 6) { bandY = y; break }
    }
    let lo = -1, hi = -1
    if (bandY > 0) {
      for (let y = Math.max(0, bandY - 6); y <= bandY; y++) {
        for (let x = 0; x < W; x++) if (g.data[y * W + x] < 60) { if (lo < 0 || x < lo) lo = x; if (x > hi) hi = x }
      }
    }
    rows.push({ i, sep: hi - lo, stance: s.f[0].stance, x: s.f[0].x })
    writeFileSync(`${OUT}/fp-${String(i).padStart(2, '0')}.png`, buf)
  }
  await page.evaluate(() => window.__PLAY__.resume())

  const walking = rows.filter((r) => r.stance === 'walk-fwd' || r.stance === 'walk-back')
  const use = walking.length >= 6 ? walking : rows
  const seps = use.map((r) => r.sep).filter((s) => s > 0)
  const min = Math.min(...seps), max = Math.max(...seps)
  console.log(`\n  frame  footSep  stance      simX`)
  for (const r of use) console.log(`  ${String(r.i).padStart(5)}  ${String(r.sep).padStart(7)}  ${r.stance.padEnd(10)}  ${r.x.toFixed(1)}`)
  const swing = max - min
  const pct = max > 0 ? (swing / max) * 100 : 0
  console.log(`\n  foot separation: min ${min}px  max ${max}px  swing ${swing}px (${pct.toFixed(0)}% of max)`)
  console.log(`  ${pct >= 25 ? 'PASS — the legs scissor; this is a walk cycle.' : 'FAIL — separation is near-constant. The fighter glides (moonwalk).'}`)
  console.log(`  frames sampled while actually walking: ${walking.length}/${rows.length}`)
  writeFileSync(`${OUT}/footplant.json`, JSON.stringify({ sha: SHA, step: STEP, rows }, null, 2))
}

await browser.close()
