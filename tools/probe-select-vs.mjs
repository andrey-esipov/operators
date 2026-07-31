// VS face-off beat probe — owned by src/fighthud/**.
//
// The 'launch' phase runs a tiny beat machine before it hands off to the match:
//   'vs'  (portraits slam in from the sides, VS clashes centre)
//    ↓  ~1500ms
//   'fight' (VS swaps to FIGHT! + the tonal stinger)
//    ↓  ~2350ms
//   window.location.assign(...)   ← the ONE navigation, a user stage-lock result
//
// A pretty VS screenshot proves nothing on its own — this project has shipped
// "looks done, isn't" ceremony before. So this asserts the *window*: VS must be
// on screen early, FIGHT! must arrive inside a bounded slice (not merely
// "eventually"), fsel-launch must be present the whole time, and both fighters'
// portraits must actually be mounted. Screenshots are a by-product, taken at
// native 1:1 (DSF1, 1920x1080).
//
// Falsifiable: neuter the fight-beat timer in FightSelect (never setLaunchBeat
// 'fight') and the "reached FIGHT! within window" assertion goes red.

import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const PORT = arg('--port', '5411')
const OUT = 'play-shots/select'
const URL = `http://localhost:${PORT}/?select=1`

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--no-sandbox'],
})
// Native 1:1 review resolution.
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

async function driveToStageLock(page) {
  await page.waitForFunction(() => window.__SELECT__?.ready?.(), null, { timeout: 30000 })
  // Prove the preload actually resolved before we compose — the black-box race fix.
  await page.waitForFunction(() => window.__SELECT__?.state?.().portraitsReady === true, null, { timeout: 15000 })
  // Drive through both locks and into the stage. setCursor only commits on the
  // next render, and confirm() reads the committed snapshot — so each setCursor
  // gets its own tick before the confirm, or confirm would lock the *previous*
  // cursor (that bug once photographed SPIEGEL as P2 while a green run claimed
  // MADHAVAN). We assert the composed matchup below to keep it honest.
  await page.evaluate((p1) => window.__SELECT__.setCursor(p1), P1_IDX)
  await page.waitForTimeout(90)
  await page.evaluate(() => window.__SELECT__.confirm()) // lock P1 → p2
  await page.waitForTimeout(90)
  await page.evaluate((p2) => window.__SELECT__.setCursor(p2), P2_IDX)
  await page.waitForTimeout(90)
  await page.evaluate(() => window.__SELECT__.confirm()) // lock P2 → stage
  await page.waitForTimeout(90)
  await page.evaluate((st) => window.__SELECT__.setCursor(st), STAGE_IDX)
  await page.waitForTimeout(120)
  return page.evaluate(() => window.__SELECT__.state())
}

const P1_IDX = 0 // chesky
const P2_IDX = 4 // madhavan
const STAGE_IDX = 1 // hypergrowth / rocket deck

// ── Pass 1: the timing gate. Evaluate-ONLY (no screenshots inside the loop) so
// nothing can stall sampling. A full-page screenshot costs ~150–400ms under the
// concurrent-build load on this box; taken mid-beat it once starved the loop to
// a single fight sample and made the hold flake to ~0ms. Hero shots move to a
// second, dedicated drive below where a stall harms nothing.
await page.goto(URL, { waitUntil: 'domcontentloaded' })
const composed = await driveToStageLock(page)
const matchupOk = composed.p1 === 'chesky' && composed.p2 === 'madhavan' && composed.stage === null
console.log(`  composed p1=${composed.p1} p2=${composed.p2} phase=${composed.phase}`)

const t0 = Date.now()
let navigated = false
page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigated = true })
await page.evaluate(() => window.__SELECT__.confirm()) // stage lock → launch beat begins

const samples = []
while (Date.now() - t0 < 2280 && !navigated) {
  let snap
  try {
    snap = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="fsel-launch"]')
      const names = Array.from(document.querySelectorAll('.fsel-vs-name')).map((n) => n.textContent)
      const rect = (sel) => {
        const r = document.querySelector(sel)?.getBoundingClientRect()
        return r ? { l: Math.round(r.left), r: Math.round(r.right) } : null
      }
      return {
        launch: !!el,
        beat: el?.getAttribute('data-beat') ?? null,
        arts: document.querySelectorAll('.fsel-vs-art .fsel-crop, .fsel-vs-art .fsel-crop-loading').length,
        names,
        vsWord: !!document.querySelector('.fsel-vs-word'),
        fightWord: !!document.querySelector('.fsel-fight'),
        a: rect('.fsel-vs-fighter.a'),
        b: rect('.fsel-vs-fighter.b'),
      }
    })
  } catch (e) {
    if (/context was destroyed|navigation|Target closed|detached/i.test(String(e))) { navigated = true; break }
    throw e
  }
  samples.push({ t: Date.now() - t0, ...snap })
  await page.waitForTimeout(40)
}

// Derive the envelope from the samples.
const firstVs = samples.find((s) => s.beat === 'vs')
const firstFight = samples.find((s) => s.beat === 'fight')
const launchAlways = samples.length > 0 && samples.every((s) => s.launch)
const artsSeen = Math.max(0, ...samples.map((s) => s.arts))
const vsNames = (samples.find((s) => s.names && s.names.length >= 2)?.names ?? []).map((n) => (n || '').toUpperCase())
const namesOk = vsNames.includes('CHESKY') && vsNames.includes('MADHAVAN')
const fightAt = firstFight ? firstFight.t : null
// FIGHT! lettering must actually mount (not just the data-beat flip) and hold on
// screen for a real beat before the match loads — a swap that flashes for one
// frame reads as a glitch, not a callout.
const fightWordSamples = samples.filter((s) => s.fightWord)
const fightWordFirst = fightWordSamples[0]?.t ?? null
const fightWordLast = fightWordSamples.length ? fightWordSamples[fightWordSamples.length - 1].t : null
const fightWordHold = fightWordFirst != null ? fightWordLast - fightWordFirst : 0
// Density-independent persistence bound: FIGHT! must still be on screen at the
// END of the sampling window (loop horizon 2280ms; the real nav is at 2350ms).
// Present at fightWordFirst AND present at the last pre-nav sample proves the
// hold as a WINDOW, not as a span between two samples that a sparse loop could
// collapse to ~0. This is what makes the gate immune to the load-flake that
// starved sampling to a single fight frame.
const lastSample = samples[samples.length - 1]
const fightHeldToEnd = !navigated && !!lastSample && lastSample.beat === 'fight' && !!lastSample.fightWord && lastSample.t >= 2000
// Overflow guard: the fighters slide outward as FIGHT! widens the centre. During
// the FIGHT! hold they must keep a real margin inside the 1920px viewport — not
// touch the edge (this shot once clipped CHESKY's card to l=-6, shadow cut).
// Scope to fight-beat samples: the VS entrance legitimately slams the fighters
// in from the screen sides, so measuring across the whole beat would read that
// intended fly-in as a clip. Measure the live rects, don't trust the eye.
const rectSamples = samples.filter((s) => s.beat === 'fight' && s.a && s.b)
const minLeft = rectSamples.length ? Math.min(...rectSamples.map((s) => s.a.l)) : -1
const maxRight = rectSamples.length ? Math.max(...rectSamples.map((s) => s.b.r)) : 9999
const noClip = rectSamples.length > 0 && minLeft >= 40 && maxRight <= 1880

console.log(`  samples=${samples.length} firstVs@${firstVs?.t ?? '—'}ms firstFight@${fightAt ?? '—'}ms FIGHT!lettering@${fightWordFirst ?? '—'}ms hold~${fightWordHold}ms heldToEnd=${fightHeldToEnd}(last@${lastSample?.t ?? '—'}ms) artsSeen=${artsSeen} names=${JSON.stringify(vsNames)} fighters[l=${minLeft},r=${maxRight}] navigated=${navigated}`)
if (errors.length) console.log(`  ${errors.length} console errors: ${JSON.stringify(errors.slice(0, 3))}`)

const checks = [
  ['composed the driven matchup (chesky vs madhavan)', matchupOk],
  ['VS screen shows both driven names', namesOk],
  ['launch overlay present through the beat', launchAlways],
  ['both fighter portraits mounted (arts>=2)', artsSeen >= 2],
  ['fighters keep a margin inside the viewport (no clip)', noClip],
  ['VS beat shown early (firstVs < 900ms)', !!firstVs && firstVs.t < 900],
  ['FIGHT! beat arrives in window (1200–2100ms)', fightAt != null && fightAt >= 1200 && fightAt <= 2100],
  ['FIGHT! lettering actually renders', fightWordFirst != null],
  ['FIGHT! holds ≥350ms before hand-off', fightWordHold >= 350],
  ['FIGHT! still on screen just before hand-off (held to end)', fightHeldToEnd],
  ['VS then FIGHT ordering', !!firstVs && !!firstFight && firstVs.t < firstFight.t],
  ['no console errors', errors.length === 0],
]

let failed = 0
for (const [label, ok] of checks) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++ }

// ── Pass 2: hero shots. A second, dedicated drive on a FRESH page whose only job
// is two native 1:1 frames for human review. A fresh page is critical: Pass 1
// leaves a pending 2350ms location.assign() queued on its page, which would race
// (and usually clobber) a same-page re-goto, landing on the fight page where
// __SELECT__ never exists. Because this pass never samples after a screenshot,
// the ~150–400ms screenshot cost can't distort any measurement. Same matchup, so
// the frames show the fighters the gate actually proved.
try {
  const shotPage = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  await shotPage.goto(URL, { waitUntil: 'domcontentloaded' })
  const composed2 = await driveToStageLock(shotPage)
  if (composed2.p1 === 'chesky' && composed2.p2 === 'madhavan') {
    const h0 = Date.now()
    await shotPage.evaluate(() => window.__SELECT__.confirm())
    mkdirSync(OUT, { recursive: true })
    // VS beat holds ~0–1500ms: grab it mid-hold at ~700ms.
    await shotPage.waitForTimeout(700)
    if (await shotPage.$('.fsel-vs-word')) writeFileSync(`${OUT}/select-vs.png`, await shotPage.screenshot())
    // FIGHT! swaps in at ~1500ms; grab it settled at ~1800ms — well before the
    // 2350ms hand-off, leaving margin for the ~300ms screenshot itself.
    const toFight = 1800 - (Date.now() - h0)
    if (toFight > 0) await shotPage.waitForTimeout(toFight)
    if (await shotPage.$('.fsel-fight')) writeFileSync(`${OUT}/select-fight.png`, await shotPage.screenshot())
  }
  await shotPage.close()
} catch (e) {
  console.log(`  (hero-shot pass skipped: ${String(e).slice(0, 80)})`)
}

await browser.close()
if (failed) { console.log(`\n=== ${failed} VS-beat check(s) failed ===`); process.exit(1) }
console.log(`\n=== VS beat proven; open ${OUT}/select-vs.png and select-fight.png ===`)
