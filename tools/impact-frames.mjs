// impact-frames.mjs — measures the CAMERA KICK on contact, live, across a real
// landed hit at each attack weight, and proves the kick scales with weight.
//
// ── Why this was rewritten (read before trusting any old `maxMag: 0`) ─────────
// The previous version filmed the impact by pausing the sim after a hit landed
// and stepping it frame-by-frame with page screenshots, then cross-correlating a
// static rafters band between frames to recover the camera translation in px.
// That design MISSES the kick by construction:
//
//   1. It swung LIVE (polling the defender's HP every ~8ms), so by the time the
//      HP drop was observed the sim had already run several real render frames
//      past contact. The impact kick is a ~7-frame sprung transient that has
//      largely decayed within ~120ms — it was already spent before the tool
//      called pause() and took its first screenshot.
//   2. Even once paused, screenshots are far too slow (~50-100ms each) to sample
//      a 60fps transient; a stepped filmstrip can only see whatever survived the
//      live gap above, which for a snappy kick is nothing.
//
// So the tool reported `maxMag: 0` and a "no camera kick on contact" verdict for
// a camera that, measured correctly, moves a fixed world point 2.1% of screen
// width on a heavy — a metric that lies, and one a visual critic filed as a
// top defect. A measurement tool that defames working code is worse than none.
//
// ── What it does now ─────────────────────────────────────────────────────────
// It samples LIVE requestAnimationFrame frames through the hit (never
// pause-then-step), reading the camera directly: each frame it projects a fixed
// world point (head height on the fighting plane) to NDC via __STAGE__.project
// and records the sim's hitstop + the defender's HP alongside it. No screenshots,
// so it captures the true 60fps envelope and is immune to the DPR/cleared-buffer
// grab hazards. This is the method calib_kick.mjs proved.
//
// ── The impact ladder (this file's second job) ───────────────────────────────
// Beyond the camera kick, this drives the FULL authored-reaction ladder — one
// rung per HitLevel: light / medium / heavy / sweep / launcher / crumple — so a
// visual reviewer can put ANY reaction on screen on demand (heavy + crumple are
// the frames nobody had ever visually judged, because CPU play almost never
// throws them). For each rung it stages a point-blank, deeply stunned dummy at a
// range the move reaches, settles the camera dead still, establishes a still
// baseline, coaxes out the REAL move that owns that level in the operator kit
// (a bare button, a held down+button for crouch normals, or a 236236 motion for
// the super), and measures the peak projection deviation through the hit.
//
// THE LEVEL A RUNG PRODUCES IS NEVER ASSUMED FROM THE KEY PRESSED. After contact
// it is read back from authoritative sim state — the attacker's live `move.id`,
// mapped through the same move->level table the sim consults (so it equals the
// `level` combat.ts stamps on the hit event, recovered without an events
// accessor on __PLAY__), and cross-checked against the defender's reaction
// (`stance==='juggle'` + upward vel => launcher; `'knockdown'` => sweep;
// `superFreeze` fired => crumple). A rung that silently degrades — a launcher
// that came out as a stand heavy because the crouch didn't register — is caught
// and reported unverified, never counted as a launcher. A move is only a
// measurement if it CONNECTED (hitstop > 0 AND the defender's HP dropped); a
// whiff is reported as a whiff, never as a "0 kick".
//
// crumple is SUPER-ONLY in this kit (grep the fighters: only super.P /
// super.storm carry level:'crumple'), so the crumple rung fires the super, which
// needs meter and a 236236 inside MOTION_WINDOW (12f). If that motion does not
// activate the super (move.id never becomes super.P, superFreeze never fires) the
// rung reports itself UNREACHABLE with the exact state it needs, rather than
// faking a crumple from a lesser hit.
//
// ── Two mutation controls (an assertion the failure mode cannot satisfy) ──────
//  1. KICK gate: with window.__MUT_NO_KICK__ set, addShake/punchIn no-op and the
//     heavy is re-measured; if the kick does not collapse toward the still
//     baseline the instrument is reading something other than the camera code.
//  2. LEVEL gate: the heavy rung is re-driven with the LIGHT input; the harness
//     must classify the produced level as 'light' from the live move.id and
//     REFUSE to verify it as heavy. A gate that still greens there is reading the
//     button, not the sim — the exact lying-harness shape this file already fixed
//     once, and must not reintroduce in a new coat.
//
//   node tools/impact-frames.mjs [--port 5661] [--out critique/impact-frames]
//                                [--query 'a=spiegel&b=lenny&p1=operator&p2=operator&cpu=dummy']
//                                [--level heavy]   run ONE rung (fast, for capture)
//                                [--capture]       freeze each verified rung on its
//                                                  impact apex and write a hero PNG
//                                [--peak N]        apex offset in frames (default 3)
//
// TEXT ONLY here: prints a per-rung table + writes a small JSON. With --capture it
// also writes hero-<level>.png files for a reviewer to consume; this tool never
// reads those bytes back.
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d)
const PORT = arg('port', '5399')
const OUT = arg('out', 'critique/impact-frames')
const QUERY = arg('query', 'a=spiegel&b=lenny&p1=operator&p2=operator&cpu=dummy')
const VW = 1600
const VH = 900
let SHA = 'unknown'
try { SHA = execSync('git rev-parse --short HEAD').toString().trim() } catch {}
const URL = `http://localhost:${PORT}/?${QUERY}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The impact ladder: one rung per authored HitLevel, each driven by the REAL
// operator move that owns that level (the harness runs p1=p2=operator). `input`
// is how the move is coaxed out — a bare `button`, a held `down`+button (crouch
// normals), or a `motion`+button (the super). `expectMove` is the move.id the
// sim must report for the rung to count (so a degraded move is caught by name).
// `gaps` are candidate point-blank separations in sim-cm, tried widest-first
// until the move lands its OWN level.
const LADDER = [
  { label: 'light',    target: 'light',    expectMove: 'st.LP',   input: { button: 'KeyU' },                   shake: 0.10, gaps: [104, 98, 92] },
  { label: 'medium',   target: 'medium',   expectMove: 'st.MP',   input: { button: 'KeyI' },                   shake: 0.16, gaps: [110, 104, 98] },
  { label: 'heavy',    target: 'heavy',    expectMove: 'st.HP',   input: { button: 'KeyO' },                   shake: 0.26, gaps: [116, 110, 104] },
  { label: 'sweep',    target: 'sweep',    expectMove: 'cr.HK',   input: { down: 'KeyS', button: 'KeyL' },      shake: 0.30, gaps: [124, 114, 104, 96] },
  { label: 'launcher', target: 'launcher', expectMove: 'cr.HP',   input: { down: 'KeyS', button: 'KeyO' },      shake: 0.34, gaps: [100, 92, 84, 78] },
  { label: 'crumple',  target: 'crumple',  expectMove: 'super.P', input: { seed: [2, 3, 6, 2, 3, 6], button: 'KeyO' }, shake: 0.36, gaps: [96, 88, 80, 74] },
]

// operator move.id -> authored hit.level, transcribed from
// src/fight/fighters/operator.ts. This is the SAME table the sim consults, so
// mapping the attacker's LIVE move.id through it yields exactly the `level`
// combat.ts stamps on the hit event — the authoritative level, recovered without
// an events accessor on __PLAY__. A move.id absent here maps to '' (unknown),
// which fails verification rather than passing silently.
const MOVE_LEVEL = {
  'st.LP': 'light',  'st.MP': 'medium',   'st.HP': 'heavy',
  'st.LK': 'light',  'st.MK': 'medium',   'st.HK': 'heavy',
  'cr.LP': 'light',  'cr.MP': 'medium',   'cr.HP': 'launcher',
  'cr.LK': 'light',  'cr.MK': 'medium',   'cr.HK': 'sweep',
  'f.MP':  'medium', 'f.HK':  'medium',
  'qcf.P': 'medium', 'dp.P':  'launcher', 'qcb.K': 'medium', 'charge.P': 'heavy',
  'super.P': 'crumple', 'throw.f': 'heavy',
}
const PEAK_OFFSET = Number(arg('peak', '3')) // frames past contact to the deform apex

// ── Body-reaction reachability guard ─────────────────────────────────────────
// The level-verify (measureRung) proves the SIM landed each rung's level — stance
// is authoritative. It CANNOT see what the victim's BODY actually renders, and the
// two are different claims. Only juggle (launcher) and knockdown (sweep) are
// body-distinct reactions; light/medium/heavy/crumple all share the one `hurt` reel
// (traced through combat.ts applyHit -> AnimationDriver; crumple = super.P, which is
// level:'crumple' with NO juggle flag + grounded victim, so it is 'hitstun'/'hurt'
// too). AND the juggle clip is authored on only a subset of skins — census on disk:
// chesky/lenny/spiegel carry it, the other eight fall back to `hurt`. So a launcher
// capture on a juggle-less victim is a hurt reel wearing a launcher label: exactly
// the silent-mislabel this project keeps finding. This binds the atlas to the
// capture — it reads the VICTIM skin's authored clips (source of truth on disk, per
// run, NOT a hardcoded list) and refuses to hand off a fallback body as a distinct
// pose. knockdown is on all 11 skins so sweep never falls back today, but the guard
// checks it rather than assume. Default victim (b=lenny) HAS juggle -> no change.
const VICTIM = new URLSearchParams(QUERY).get('b') || ''
const BODY_CLIP = { launcher: 'juggle', sweep: 'knockdown' } // others share the 'hurt' reel
function victimClipSet(skin) {
  try { return new Set(Object.keys(JSON.parse(readFileSync(`public/fighters/${skin}/assets.json`, 'utf8')).clips || {})) }
  catch { return null }
}
const VICTIM_CLIPS = victimClipSet(VICTIM)
// -> { needs, kind: 'shared' (expected hurt reel) | 'distinct' (real pose present)
//      | 'fallback' (should be distinct but the skin renders hurt) | 'unknown' }
function bodyStatusFor(target) {
  const needs = BODY_CLIP[target]
  if (!needs) return { needs: 'hurt', kind: 'shared' }
  if (!VICTIM_CLIPS) return { needs, kind: 'unknown' }
  return { needs, kind: VICTIM_CLIPS.has(needs) ? 'distinct' : 'fallback' }
}

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  // Match the GPU/occlusion flags the other shipped-play capture tools use
  // (shot.mjs, measure-impact-punch.mjs): --enable-gpu / --ignore-gpu-blocklist
  // so ANGLE/Metal is picked reliably, and the occlusion/backgrounding disables
  // so an offscreen (4000,4000) window keeps a live rAF instead of being throttled.
  args: [
    '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
    '--window-position=4000,4000', '--hide-scrollbars', '--mute-audio', '--no-sandbox',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion',
  ],
})
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.log('  [pageerror]', String(e.message).slice(0, 140)))

// StrictMode canvas-poison shim. On a loaded box the dev/dist-measure build's
// React StrictMode double-mount lands its cleanup mid-init(); FightRenderer.dispose()
// then calls THREE's forceContextLoss() -> WEBGL_lose_context.loseContext(), which
// PERMANENTLY poisons the shared <canvas> PlayableMatch reuses (it isn't keyed).
// The remount rebuilds a WebGLRenderer on that dead canvas and throws
// "Cannot read properties of null (reading 'precision')" -> the app shows
// "FAILED TO START" and __PLAY__ never mounts. This is the exact constraint
// documented in engineContextRelease.node.test.ts:92-98. loseContext() is used
// ONLY for teardown, never for rendering, so stubbing it to a no-op cannot touch
// any camera/VFX/reaction we measure; it only stops the transient StrictMode
// dispose from killing the canvas the live renderer needs. (Harness-side only —
// the durable app fix is to key PlayableMatch's canvas per that test's guidance.)
await page.addInitScript(() => {
  for (const proto of [self.WebGLRenderingContext, self.WebGL2RenderingContext]) {
    if (!proto) continue
    const orig = proto.prototype.getExtension
    proto.prototype.getExtension = function (name) {
      const ext = orig.call(this, name)
      if (name === 'WEBGL_lose_context' && ext) {
        return { loseContext: () => {}, restoreContext: () => (ext.restoreContext ? ext.restoreContext() : undefined) }
      }
      return ext
    }
  }
})

await page.goto(URL, { waitUntil: 'domcontentloaded' })

// Wait until the match is genuinely live: __PLAY__ ready + in the fight phase +
// __STAGE__ projector installed, held stable across several polls. The app can
// briefly tear these down on a React re-mount / phase reset, so this is called
// before EVERY pass, not just once — the second-run crash was a pass firing into
// a transiently-undefined __PLAY__.
async function waitReady(minStable = 15, maxPolls = 500) {
  let stable = 0
  for (let i = 0; i < maxPolls && stable < minStable; i++) {
    let ok = false
    try {
      ok = await page.evaluate(
        () => !!window.__PLAY__?.ready?.() && window.__PLAY__.state?.().phase === 'fight' && !!window.__STAGE__,
      )
    } catch {}
    stable = ok ? stable + 1 : 0
    await sleep(30)
  }
  return stable >= minStable
}

if (!(await waitReady())) { console.log('FAILED: never reached a stable fight with __PLAY__ + __STAGE__'); await browser.close(); process.exit(1) }
await page.mouse.click(VW / 2, VH / 2)
await sleep(200)

// Pin the two fighters point-blank with the dummy deeply stunned, so it neither
// walks nor retaliates and the only camera motion is what our own hit produces.
async function stage(gap) {
  await waitReady() // guard against a transient __PLAY__ teardown between passes
  await page.evaluate((g) => {
    const s = window.__PLAY__?.state?.()
    if (!s) return
    const [me, foe] = s.fighters
    // Full neutral reset on BOTH: a prior sweep/launcher leaves the dummy in
    // knockdown/juggle, which would leak into the next rung's reaction readout.
    for (const f of [me, foe]) {
      f.vel.x = 0; f.vel.y = 0; f.grounded = true; f.stance = 'idle'
      f.move = undefined; f.attackConnected = false; f.comboCount = 0
    }
    me.pos.x = -g / 2; me.facing = 1; me.stunRemaining = 0; me.health = 1000
    me.meter = 2000 // MAX_METER — the crumple rung's super needs meter to come out
    foe.pos.x = g / 2; foe.facing = -1; foe.stunRemaining = 600; foe.health = 1000
    foe.meter = 0
  }, gap)
}

// Perform a rung's input. Normals and specials go through real DOM keys, consumed
// by the product's KeyboardSource exactly as a player's keyboard is. The crumple
// super is the one exception (see the `inp.seed` branch): its motion is delivered
// through the sim's own input ring because a frame-tight double-QCF is not reliably
// executable through automated DOM keys. Either way the resulting move is read back
// from sim state, never assumed from what is pressed here.
async function doInput(inp) {
  if (inp.seed) {
    // Crumple is SUPER-ONLY (operator super.P, motion 236236 + hp, cost 1000).
    // Executing a frame-tight double-QCF through real DOM keys proved unreliable
    // here (measured): held slow enough for the browser not to coalesce the key
    // events, the FIRST qcf completes and fires the single-qcf special qcf.P
    // before the second arrives; held fast enough to stay inside MOTION_WINDOW
    // (12f), Chrome coalesces the rapid down/up pairs and the button is dropped
    // (moves=[]). So the motion is delivered by pushing the SAME facing-relative
    // digits the sim would log into its OWN input ring (state().inputLog[0]),
    // then pressing the button. Everything downstream is the unmodified product:
    // the sim's own detectMotion recognises 236236, startMove spends meter, arms
    // superFreeze and fires super.P — a genuine super with a genuine crumple hit.
    // Only the physical-keyboard->InputFrame step (the flaky part under
    // automation) is bypassed; the produced level is still read back from the
    // authoritative move.id + superFreeze, never assumed. If the super does not
    // come out (e.g. no meter) the rung reports UNVERIFIED, it cannot fake one.
    await page.evaluate((ds) => {
      const s = window.__PLAY__?.state?.()
      if (!s) return
      s.inputLog = s.inputLog || [[], []]
      for (const d of ds) s.inputLog[0].push(d & 0xf)
    }, inp.seed)
    await page.keyboard.press(inp.button)
    return
  }
  if (inp.down) {
    await page.keyboard.down(inp.down); await sleep(90)              // settle into crouch
    await page.keyboard.press(inp.button); await sleep(50)
    await page.keyboard.up(inp.down)
    return
  }
  await page.keyboard.press(inp.button)
}

// One live-RAF pass: settle, sample a still baseline, fire the rung's input, keep
// sampling through the hit. Each sample carries the fixed-point NDC + the sim's
// hitstop/HP/defender-x AND the authoritative reaction readouts (attacker move.id,
// defender stance/vel.y/grounded, superFreeze) the level verification needs.
async function firePass(rung, gap) {
  await stage(gap)
  await sleep(1300) // FULL camera settle — no dolly/zoom/kick motion left
  await page.evaluate(() => {
    window.__SAMP__ = []
    const P = [0, 3.0, 0] // fighting-plane point at head height — what the eye tracks
    let n = 0
    const tick = () => {
      const stg = window.__STAGE__, play = window.__PLAY__
      if (!stg || !play?.state) { if (++n < 240) requestAnimationFrame(tick); return }
      const ndc = stg.project(P[0], P[1], P[2])
      const s = play.state()
      const A = s.fighters[0], D = s.fighters[1]
      // gx = defender x. It stays put through the impact freeze and only starts
      // sliding once the knockback is applied — which is precisely how we tell the
      // KICK (camera motion while the fighters are frozen) apart from the camera
      // legitimately TRACKING the knockback slide afterwards.
      window.__SAMP__.push({
        n, x: ndc[0], y: ndc[1], hs: s.hitstop,
        hp: Math.round(D.health), gx: Math.round(D.pos.x),
        am: A.move ? A.move.id : '', st: D.stance,
        vy: +D.vel.y.toFixed(2), gr: D.grounded ? 1 : 0, sf: s.superFreeze || 0,
      })
      if (++n < 240) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await sleep(300) // ~18 still baseline frames
  await stage(gap) // re-pin the instant before firing so nothing has drifted
  await doInput(rung.input)
  // A motion super burns SUPER_FREEZE frames before its damage travels, so give
  // it a longer tail than a normal's instant contact.
  await sleep(rung.input.seed ? 1700 : 900)
  return page.evaluate(() => window.__SAMP__ || [])
}

// Reduce a sample run to the kick metrics. contact = first frame the sim reports
// hitstop (the freeze a landed hit triggers); landed also requires the defender's
// HP to have dropped. The KICK is measured over the FROZEN window — from contact
// until the defender starts sliding from the knockback — so the camera's later,
// legitimate tracking of the knockback slide is NOT counted as kick (that pan is
// reported separately as trackPeakPx). Deviation is measured from the still
// pre-contact mean, so a residual settling drift is subtracted out.
function analyse(samp) {
  const contact = samp.findIndex((r) => r.hs > 0)
  const landed = contact >= 0 && samp.some((r) => r.hp < 1000)
  const maxHitstop = samp.length ? Math.max(...samp.map((r) => r.hs)) : 0
  const bWin = contact > 6 ? samp.slice(3, contact - 1) : samp.slice(3, 15)
  const mx = bWin.reduce((a, r) => a + r.x, 0) / bWin.length
  const my = bWin.reduce((a, r) => a + r.y, 0) / bWin.length
  // NDC spans 2 across the frame, so an NDC delta d is d/2 of screen span.
  const pxOf = (r) => Math.hypot(((r.x - mx) / 2) * VW, ((r.y - my) / 2) * VH)
  const ndcOf = (r) => Math.hypot(r.x - mx, r.y - my)
  const baselinePx = Math.max(...bWin.map(pxOf))

  // Frozen kick window: from contact while the defender has not yet slid (the
  // impact freeze holds its position; the kick plays out here on sim-frame time).
  const gx0 = contact >= 0 ? samp[contact].gx : 0
  let end = contact
  if (contact >= 0) {
    while (end < samp.length && end < contact + 30 && Math.abs(samp[end].gx - gx0) <= 3) end++
  }
  const kickSlice = contact >= 0 ? samp.slice(contact, Math.max(contact + 1, end)) : []
  const peakPx = kickSlice.length ? Math.max(...kickSlice.map(pxOf)) : 0
  const peakNdc = kickSlice.length ? Math.max(...kickSlice.map(ndcOf)) : 0
  const peakPctW = kickSlice.length ? Math.max(...kickSlice.map((r) => Math.abs(r.x - mx))) / 2 * 100 : 0
  const peakPctH = kickSlice.length ? Math.max(...kickSlice.map((r) => Math.abs(r.y - my))) / 2 * 100 : 0

  // Post-slide tracking pan, for context only: the camera following the knocked-
  // back fighter. Legitimate camera work, but NOT the impact kick, so it is kept
  // out of the kick number and merely reported.
  const trackSlice = contact >= 0 ? samp.slice(end, Math.min(samp.length, end + 20)) : []
  const trackPeakPx = trackSlice.length ? Math.max(...trackSlice.map(pxOf)) : 0

  // ── Authoritative produced level, from sim state (never the key pressed) ────
  // amId = the attacker's active move.id AT contact (scan back a few frames if the
  // exact contact frame had already cleared it). Mapped through MOVE_LEVEL it is
  // the level combat.ts stamped on the hit event. The defender's reaction is an
  // independent cross-check: an upward juggle => launcher, a knockdown => sweep, a
  // superFreeze anywhere in the pass => the crumple super fired.
  let amId = ''
  for (let k = contact; contact >= 0 && k >= Math.max(0, contact - 4) && !amId; k--) amId = samp[k].am
  const moveLevel = MOVE_LEVEL[amId] || ''
  const rWin = contact >= 0 ? samp.slice(contact, Math.min(samp.length, contact + 12)) : []
  const launched = rWin.some((r) => r.st === 'juggle' && r.vy > 0.01)
  const knocked = rWin.some((r) => r.st === 'knockdown')
  const superSeen = samp.some((r) => r.sf > 0)
  const reactionLevel = launched ? 'launcher' : knocked ? 'sweep' : superSeen ? 'crumple' : 'hitstun-normal'
  const contactStance = contact >= 0 ? samp[contact].st : ''

  return {
    landed, contactIdx: contact, samples: samp.length, maxHitstop,
    kickWindowFrames: kickSlice.length,
    baselinePx: +baselinePx.toFixed(2),
    peakPx: +peakPx.toFixed(2),
    peakNdc: +peakNdc.toFixed(5),
    peakPctScreenWidth: +peakPctW.toFixed(3),
    peakPctScreenHeight: +peakPctH.toFixed(3),
    trackPeakPx: +trackPeakPx.toFixed(2),
    ratio: +(peakPx / Math.max(0.01, baselinePx)).toFixed(1),
    // authoritative level readouts
    amId, producedLevel: moveLevel, reactionLevel, superSeen, contactStance,
  }
}

// Verify a rung's REACTION is consistent with its target level, independent of
// the move.id path — the two must agree for the rung to count.
function reactionOkFor(target, m) {
  if (target === 'launcher') return m.reactionLevel === 'launcher'
  if (target === 'sweep') return m.reactionLevel === 'sweep'
  if (target === 'crumple') return m.superSeen === true
  return m.reactionLevel === 'hitstun-normal' // light/medium/heavy share one reaction
}

// Drive one rung across candidate ranges until it lands its OWN level. `verified`
// requires: it connected, the live move.id was the expected move, that move's
// level equals the target, AND the defender's reaction agrees. Any mismatch is
// kept (honest) rather than silently retried into a green.
async function measureRung(rung) {
  let best = null
  for (const gap of rung.gaps) {
    const samp = await firePass(rung, gap)
    const m = analyse(samp)
    const moveOk = m.amId === rung.expectMove
    const levelOk = m.producedLevel === rung.target
    const reactOk = reactionOkFor(rung.target, m)
    const verified = m.landed && moveOk && levelOk && reactOk
    best = { ...m, gapUsed: gap, moveOk, levelOk, reactOk, verified }
    if (verified) break
    await sleep(250)
  }
  return { label: rung.label, target: rung.target, expectMove: rung.expectMove, shake: rung.shake, ...best }
}

const ONLY = arg('level', '')                       // run ONE rung (fast, for capture)
const CAPTURE = process.argv.includes('--capture')  // freeze each verified rung + write a hero PNG
const fullRun = !ONLY
const rungs = ONLY ? LADDER.filter((r) => r.label === ONLY) : LADDER
// A full run owns the whole output dir, so it starts clean. A single-rung capture
// (--level X) only touches its OWN hero-<label>.png, so it must NOT wipe the dir —
// otherwise iterating one level at a time would delete the heroes captured before
// it. Each hero file is overwritten in place, so single-rung runs accumulate.
if (fullRun) rmDirSafe(OUT)
mkdirSync(OUT, { recursive: true })
if (!rungs.length) {
  console.log(`no such rung '${ONLY}' — use one of: ${LADDER.map((r) => r.label).join(', ')}`)
  await browser.close(); process.exit(2)
}

// Capture handoff: re-drive a verified rung and freeze on the impact apex so a
// reviewer gets a deterministic hero frame. Uses __PLAY__.pause + step to land
// EXACTLY on the money frame (contact + PEAK_OFFSET) rather than hoping a live
// grab catches the ~7-frame transient. This tool writes the PNG and never reads
// its bytes back (the context hazard is real).
async function captureHero(rung, gap) {
  await stage(gap); await sleep(1200); await stage(gap)
  await page.evaluate(() => {
    window.__CONTACT__ = -1; window.__WATCH__ = true; let n = 0
    const tick = () => {
      const s = window.__PLAY__?.state?.()
      if (s && window.__CONTACT__ < 0 && s.hitstop > 0 && s.fighters[1].health < 1000) window.__CONTACT__ = s.frame
      if (window.__WATCH__ && ++n < 260) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await doInput(rung.input)
  await page.waitForFunction(() => window.__CONTACT__ >= 0, { timeout: 5000 }).catch(() => {})
  const got = await page.evaluate((off) => {
    if (window.__CONTACT__ < 0) return false
    window.__PLAY__.pause(); window.__PLAY__.step(off); return true
  }, PEAK_OFFSET)
  // Wait for the frozen sim to actually CONSUME the stepped frames before grabbing,
  // rather than a wall-clock guess: a fixed sleep raced the RAF step budget and, for a
  // large --peak, could screenshot before the steps had run. stepsPending()==0 is the
  // deterministic "we are exactly at contact+PEAK_OFFSET" signal; then a short paint
  // settle so the compositor has the frozen frame on screen.
  await page.waitForFunction(() => (window.__PLAY__?.stepsPending?.() ?? 0) === 0, { timeout: 3000 }).catch(() => {})
  await sleep(120)
  let file = '', cap = null
  if (got) {
    // Capture-fidelity provenance, read from authoritative sim state at the frozen
    // instant. A frozen grab of a REACTION stance (hurt/juggle/knockdown) only tells
    // the truth if the victim is on a LIVE reaction frame, never the clamped last
    // frame -- the "5-key hurt was invisible" corpse (AnimationDriver.ts:80-91).
    // hitstop>0 here PROVES frame 0 (the impact pose): the renderer freezes the
    // reaction clock for the whole hitstop (FightRenderer._tickReactions: `if
    // (cur.hitstop > 0) continue`, advanced only on genuine sim steps, :297), and
    // resolveFrame at reactionFrame 0 returns clip.frames[0] not [last]
    // (reactionClip.test.ts:35-38). The corpse needs reactionFrame >= the clip's total
    // ticks (hurt 18 / juggle 25 / knockdown 23) -- unreachable while the freeze holds.
    // Recording it makes fidelity provable per hero, and reds if a future --peak steps
    // past the freeze (hitstop 0) into the settled recovery tail.
    cap = await page.evaluate(() => {
      const s = window.__PLAY__?.state?.(); const v = s?.fighters?.[1]
      return v ? { frame: s.frame, stance: v.stance, hitstop: s.hitstop } : null
    })
    // Encode a body-fallback INTO the filename so a hero handed off without the
    // JSON still can't be misread as a distinct pose it doesn't show.
    const bs = bodyStatusFor(rung.target)
    const tag = bs.kind === 'fallback' ? '-HURTFALLBACK' : bs.kind === 'unknown' ? '-BODYUNVERIFIED' : ''
    if (tag) console.log(`  ⚠️  ${rung.label}: victim '${VICTIM}' ${bs.kind === 'fallback' ? `has no '${bs.needs}' clip — this body is the shared HURT reel, NOT a ${rung.target} pose` : `atlas unreadable — body pose UNVERIFIED`}. Writing '${tag.slice(1)}' into the name so the label can't lie.`)
    file = `${OUT}/hero-${rung.label}${tag}.png`
    await page.screenshot({ path: file })
  }
  await page.evaluate(() => { window.__WATCH__ = false; window.__PLAY__.resume() })
  return { file, cap }
}

// ── Drive the ladder ─────────────────────────────────────────────────────────
const results = []
for (const rung of rungs) {
  const r = await measureRung(rung)
  r.body = bodyStatusFor(rung.target)
  if (CAPTURE && r.verified) { const h = await captureHero(rung, r.gapUsed); r.heroFrame = h.file; r.heroReaction = h.cap }
  results.push(r)
  await sleep(300)
}

const by = (l) => results.find((r) => r.label === l)
const heavy = by('heavy'), light = by('light'), medium = by('medium'), crumple = by('crumple')
const heavyRung = LADDER.find((r) => r.label === 'heavy')

// ── Mutation control #1: KICK gate. Silence addShake/punchIn via the DEV hook and
// re-fire the heavy; the projection must collapse toward the still baseline. Only
// on a full run (the single-rung mode is a capture path, not the audit).
let mutated = null, kickMutOk = true
if (fullRun && heavy) {
  await page.evaluate(() => { window.__MUT_NO_KICK__ = true })
  const mutSamp = await firePass(heavyRung, heavyRung.gaps[heavyRung.gaps.length - 1])
  mutated = { ...analyse(mutSamp), gapUsed: heavyRung.gaps[heavyRung.gaps.length - 1] }
  await page.evaluate(() => { window.__MUT_NO_KICK__ = false })
  // The kick must drop by at least 40% (ratio < 0.60) once addShake+punchIn are
  // silenced. 0.60 is OUR gate value, not a genre figure: it sits above the
  // residual that survives when the kick is genuinely off — 0.19 of full in the
  // standalone calibration (files/calib-evidence/calib_kick_mutation.json, -81%)
  // and 0.36 in this harness's own heavy mutation (-64%) — with margin, while
  // staying well under 1.0 so a no-op mutation (kick NOT actually silenced, ratio
  // ~1.0) still fails. The residual is legitimate: __MUT_NO_KICK__ guards BOTH the
  // shake and the punch-in dolly, so what is left is only the camera tracking the
  // knockback slide, not any impact kick.
  const KICK_DROP_MAX_RATIO = 0.60
  kickMutOk = !!heavy.landed && mutated.peakPx < heavy.peakPx * KICK_DROP_MAX_RATIO
}

// ── Mutation control #2: LEVEL gate. Re-drive the heavy rung with the LIGHT input,
// at a range the jab lands; the harness must read the produced level as 'light'
// from the live move.id and REFUSE to verify it as heavy. If it still reads heavy
// the classifier is looking at the button, not the sim — the lying-harness shape.
let levelGate = null, levelGateOk = true
if (fullRun && heavy) {
  const lr = LADDER.find((r) => r.label === 'light')
  const misGap = (light && light.landed && light.gapUsed) || lr.gaps[lr.gaps.length - 1]
  const samp = await firePass({ input: { button: 'KeyU' } }, misGap)
  const m = analyse(samp)
  levelGate = {
    misGap, amId: m.amId, producedLevel: m.producedLevel,
    wouldVerifyAsHeavy: m.producedLevel === 'heavy' && m.amId === 'st.HP',
  }
  levelGateOk = !!m.landed && m.producedLevel === 'light' && !levelGate.wouldVerifyAsHeavy
}

// ── Mutation control #3: CRUMPLE gate. crumple is delivered by seeding the sim's
// input ring, so prove that mechanism is not a backdoor that forces a crumple:
// seed a PARTIAL motion (a single quarter-circle 236, not the full 236236) + hp.
// The single QCF is the ordinary special qcf.P (level medium), NOT the super, so
// the harness MUST read producedLevel != crumple and superSeen == false. If a
// partial seed still verified as crumple the rung would be counting the seed, not
// the super — the same lying shape the level gate guards for the normals.
let crumpleGate = null, crumpleGateOk = true
if (fullRun && crumple) {
  const cr = LADDER.find((r) => r.label === 'crumple')
  const samp = await firePass({ input: { seed: [2, 3, 6], button: 'KeyO' } }, cr.gaps[cr.gaps.length - 1])
  const m = analyse(samp)
  crumpleGate = {
    amId: m.amId, producedLevel: m.producedLevel, superSeen: m.superSeen,
    wouldVerifyAsCrumple: m.producedLevel === 'crumple' || m.superSeen === true,
  }
  crumpleGateOk = !crumpleGate.wouldVerifyAsCrumple
}

// Headline preserved: the honest replacement for the old lying `maxMag`.
const maxMag = heavy && heavy.landed ? heavy.peakPx : 0

// ── Verdict. On a full run every CORE rung (all but crumple) must verify its own
// level AND all THREE mutation gates must bite (kick, level, crumple-seed). crumple
// is super-only + motion-seeded: its OWN verification status is reported LOUDLY but
// does not fail the run, so a reviewer is never blocked on heavy because the super
// didn't come out — yet the crumple GATE (a partial seed must NOT read as crumple)
// still binds, because that guards the seed mechanism from becoming a backdoor. On
// a single-rung run the verdict is simply whether that rung verified.
const core = results.filter((r) => r.label !== 'crumple')
const coreVerified = core.length > 0 && core.every((r) => r.verified)
const crumpleVerified = !!(crumple && crumple.verified)
// Capture fidelity: every hero we froze must sit on a LIVE reaction frame. hitstop>0
// at the frozen instant == reactionFrame 0 is held (the impact pose), which cannot be
// the clamped last-frame corpse (see captureHero + reactionClip.test.ts:35-38). Binds
// the verdict ONLY on a --capture run; a plain audit grabs no heroes so it stays true.
const heroesCaptured = results.filter((r) => r.heroReaction)
const heroesLive = heroesCaptured.length === 0 || heroesCaptured.every((r) => r.heroReaction.hitstop > 0)
const auditPass = fullRun ? (coreVerified && kickMutOk && levelGateOk && crumpleGateOk) : !!(results[0] && results[0].verified)
const pass = auditPass && (!CAPTURE || heroesLive)

const out = {
  build: SHA, viewport: { w: VW, h: VH }, query: QUERY, victim: VICTIM, peakOffset: PEAK_OFFSET, only: ONLY || null,
  rungs: results, mutatedHeavy: mutated, levelGate, crumpleGate, maxMag,
  checks: { coreVerified, crumpleVerified, kickMutOk, levelGateOk, crumpleGateOk, heroesLive },
  verdict: pass
    ? (fullRun
        ? `PASS: ${core.filter((r) => r.verified).length}/${core.length} core rungs verified their own level; all mutation gates bit${CAPTURE ? `; ${heroesCaptured.length} hero(es) frozen on a live impact pose` : ''}`
        : `PASS: rung '${ONLY}' verified its own level (${results[0].producedLevel})${CAPTURE ? '; hero frozen on a live impact pose' : ''}`)
    : !auditPass
      ? 'FAIL: see checks (a core rung did not verify its level, or a mutation gate did not bite)'
      : 'FAIL: capture fidelity — a hero was frozen past the hitstop freeze (settled/clamped body); see hero-fidelity lines and --peak',
}
writeFileSync(`${OUT}/impact.json`, JSON.stringify(out, null, 2))

// ── Report (text only) ───────────────────────────────────────────────────────
console.log(`impact-frames  build ${SHA}  impact ladder + live-RAF kick  (viewport ${VW}x${VH})`)
console.log('  rung      landed verified  move       lvl prod/target   reaction      hitstop  gap   peakPx  %scrW')
for (const r of results) {
  const lvl = `${r.producedLevel || '—'}/${r.target}`
  console.log(
    `  ${r.label.padEnd(8)} ${String(!!r.landed).padEnd(6)} ${String(!!r.verified).padEnd(8)} ` +
    `${String(r.amId || '—').padEnd(9)} ${lvl.padEnd(16)} ${String(r.reactionLevel || '—').padEnd(12)} ` +
    `${String(r.maxHitstop).padStart(6)}  ${String(r.gapUsed).padStart(4)}  ${String(r.peakPx).padStart(6)}  ${String(r.peakPctScreenWidth).padStart(5)}` +
    (r.body ? `  body=${r.body.kind === 'shared' ? 'hurt·shared' : r.body.kind === 'distinct' ? r.body.needs : r.body.kind === 'fallback' ? `HURT-FALLBACK(no-${r.body.needs})` : 'UNVERIFIED'}` : '') +
    (r.heroFrame ? `  hero=${r.heroFrame}` : ''),
  )
}
// Capture-fidelity readout: PROVE each hero froze on a LIVE reaction frame, not a
// clamped last-frame corpse. hitstop>0 at the frozen instant == reactionFrame 0 held
// (the impact pose); see captureHero + reactionClip.test.ts:35-38.
for (const r of heroesCaptured) {
  const c = r.heroReaction
  console.log(
    `  hero-fidelity ${r.label.padEnd(8)} frozen@frame ${String(c.frame).padStart(4)} stance=${String(c.stance).padEnd(9)} hitstop=${String(c.hitstop).padStart(2)} -> ` +
    (c.hitstop > 0
      ? 'LIVE impact pose (reactionFrame 0 held by the hitstop freeze; not the clamped last-frame corpse)'
      : '⚠️ hitstop=0 — stepped PAST the freeze into the recovery tail; body may read settled, re-check --peak'),
  )
}
if (mutated) console.log(`  MUT-kick  off   heavy peakPx ${heavy.peakPx}->${mutated.peakPx}px via __MUT_NO_KICK__  (want <${(heavy.peakPx * 0.6).toFixed(2)}=0.60x; ok=${kickMutOk})`)
if (levelGate) console.log(`  MUT-level      heavy rung driven with LIGHT input -> move=${levelGate.amId || '—'} producedLevel=${levelGate.producedLevel || '—'} wouldVerifyAsHeavy=${levelGate.wouldVerifyAsHeavy}  (want false; ok=${levelGateOk})`)
if (crumpleGate) console.log(`  MUT-crumple    crumple seed truncated to single-QCF 236 -> move=${crumpleGate.amId || '—'} producedLevel=${crumpleGate.producedLevel || '—'} superSeen=${crumpleGate.superSeen} wouldVerifyAsCrumple=${crumpleGate.wouldVerifyAsCrumple}  (want false; ok=${crumpleGateOk})`)
console.log(`  headline maxMag (heavy peak): ${maxMag}px${light && medium && heavy ? `  | light ${light.peakPx} medium ${medium.peakPx} heavy ${heavy.peakPx}` : ''}`)
if (crumple) {
  if (crumple.verified) console.log(`  crumple: REACHABLE — super.P landed (move=${crumple.amId}, superFreeze fired); level verified 'crumple'${crumple.heroFrame ? `, hero=${crumple.heroFrame}` : ''}`)
  else console.log(`  crumple: NOT verified this pass. crumple is SUPER-ONLY here; needs meter>=1000 (set) + a 236236+hp inside MOTION_WINDOW(12f). observed: move=${crumple.amId || '—'} producedLevel=${crumple.producedLevel || '—'} superSeen=${crumple.superSeen} landed=${crumple.landed}. Reported as the state it needs, not faked from a lesser hit.`)
}
console.log(`  checks: coreVerified=${coreVerified} crumpleVerified=${crumpleVerified} kickMutOk=${kickMutOk} levelGateOk=${levelGateOk} crumpleGateOk=${crumpleGateOk}${CAPTURE ? ` heroesLive=${heroesLive}` : ''}`)
console.log(`  ${out.verdict}`)

await browser.close()
process.exit(pass ? 0 : 1)

function rmDirSafe(d) {
  try { execSync(`rm -rf ${JSON.stringify(d)}`) } catch {}
}
