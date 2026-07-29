#!/usr/bin/env node
// measure-impact-punch — does a normal hit actually charge the reactive screen
// grade on the SHIPPED fighter?
//
// The reactive post envelope in PostPipeline (bloom bump + chromatic-aberration
// spike + contrast + grain + anamorphic streak, all driven by `impact`) was
// authored to fire on every hit but was only ever charged by the card-game
// event bus (PostPipeline.onEvent). On the shipped `/` (`?play=1`) fighter that
// bus is never touched — the sim dispatches FightEvents straight to FightVfx and
// FightRenderer leaves the `emitEngine` bridge undefined — so before the
// FightVfx.punchPost wire, `impact` sat at 0.0000 on every normal hit.
//
// This is a PIXEL-FREE probe: it installs a per-frame rAF recorder that reads
// __PLAY__.state() (health / hitstop / move) and __POST__.impact() and lets a
// real CPU-vs-idle match play out, then classifies the impact peak that follows
// each hit by the attacker's move. No screenshots -> no GPU contention with the
// separation/critic capture fleets, and immune to the DPR cleared-buffer hazard.
//
// SHIPPED-PLAY instrument. Card-clean: only ?play=1 / __PLAY__ / __POST__.
//
//   node tools/measure-impact-punch.mjs --port 5783 [--seconds 40] [--out f.ndjson]
//   node tools/measure-impact-punch.mjs --port 5783 --assert
//
// --assert exits non-zero unless a normal hit measurably charges impact on the
// shipped route (consumption), enough hits are observed (vacuity), and the peak
// tracks weight (non-blindness: heavier hitstop -> larger peak).
import { writeFileSync } from 'node:fs'

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const has = (k) => process.argv.includes(k)
const PORT = arg('--port', '5783')
const SECONDS = Number(arg('--seconds', 40))
const OUT = arg('--out', '')
const ASSERT = has('--assert')

const { chromium } = await import('playwright-core')
const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: [
    '--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars', '--no-sandbox',
    // keep rAF at 60fps even though the window is parked offscreen
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion',
  ],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
const ev = async (fn, d, a) => { try { return await page.evaluate(fn, a) } catch (e) { console.error('ev:', e.message); return d } }

await page.goto(`http://localhost:${PORT}/?play=1&quality=ultra`, { waitUntil: 'domcontentloaded' })

let stable = 0
for (let i = 0; i < 400 && stable < 8; i++) {
  const ok = await ev(() => !!window.__PLAY__?.ready?.() && window.__PLAY__.state().phase === 'fight' && !!window.__POST__?.impact, false)
  stable = ok ? stable + 1 : 0
  await page.waitForTimeout(40)
}
if (stable < 8) { console.error('never settled on ?play=1 fight route'); await browser.close(); process.exit(2) }

await ev(() => {
  window.__REC__ = []
  const loop = () => {
    try {
      const s = window.__PLAY__.state()
      const a = s.fighters[0], b = s.fighters[1]
      window.__REC__.push([s.frame, s.hitstop | 0, +a.health.toFixed(2), +b.health.toFixed(2), +(window.__POST__.impact() ?? -1).toFixed(4), a.move?.id ?? '', b.move?.id ?? ''])
    } catch { /* between phases */ }
    window.__RECRAF__ = requestAnimationFrame(loop)
  }
  window.__RECRAF__ = requestAnimationFrame(loop)
})

const t0 = Date.now()
while ((Date.now() - t0) / 1000 < SECONDS) {
  await page.waitForTimeout(1000)
  const n = await ev(() => window.__REC__?.length ?? 0, 0)
  process.stderr.write(`  ${Math.round((Date.now() - t0) / 1000)}s frames=${n}\r`)
}
const samples = await ev(() => { cancelAnimationFrame(window.__RECRAF__); return window.__REC__ }, [])
await browser.close()

if (OUT) writeFileSync(OUT, samples.map((s) => JSON.stringify(s)).join('\n'))

// ---- analyze: a hit is a health drop; take the impact peak in the frames after
const IMP = 4
let maxImp = 0, nonzero = 0
const hits = []
for (let i = 1; i < samples.length; i++) {
  const im = samples[i][IMP]
  if (im > maxImp) maxImp = im
  if (im > 0.0005) nonzero++
  const d0 = samples[i - 1][2] - samples[i][2]
  const d1 = samples[i - 1][3] - samples[i][3]
  const dmg = Math.max(d0, d1)
  if (dmg > 0.1) {
    let peak = 0
    for (let j = i; j < Math.min(samples.length, i + 30); j++) peak = Math.max(peak, samples[j][IMP])
    hits.push({ frame: samples[i][0], hitstop: samples[i][1], dmg: +dmg.toFixed(1), impPeak: +peak.toFixed(4), move: d0 > d1 ? samples[i][6] : samples[i][5] })
  }
}
console.log(`\nframes=${samples.length}  impact max=${maxImp.toFixed(4)} nonzeroFrames=${nonzero}  hits=${hits.length}`)
const byHs = {}
for (const h of hits) (byHs[h.hitstop] ??= []).push(h.impPeak)
console.log('impact peak by hitstop (weight proxy):')
const rows = Object.keys(byHs).map(Number).sort((a, b) => a - b).map((k) => {
  const v = byHs[k]; const avg = v.reduce((s, x) => s + x, 0) / v.length
  console.log(`  hitstop=${k}: n=${v.length} avgImpactPeak=${avg.toFixed(4)} max=${Math.max(...v).toFixed(4)}`)
  return { hs: k, avg, n: v.length }
})

if (ASSERT) {
  const strikeHits = hits.filter((h) => h.move && h.move !== 'throw.f')
  const charged = strikeHits.filter((h) => h.impPeak > 0.02)
  const problems = []
  // consumption: strike hits must charge impact on the shipped route
  if (strikeHits.length < 5) problems.push(`vacuity: only ${strikeHits.length} strike hits observed (need >=5)`)
  if (charged.length < Math.ceil(strikeHits.length * 0.8)) problems.push(`consumption: only ${charged.length}/${strikeHits.length} strike hits charged impact>0.02`)
  if (maxImp < 0.1) problems.push(`consumption: max impact ${maxImp.toFixed(4)} < 0.1 — reactive grade looks dead`)
  // non-blindness: peak must track weight — the heaviest hitstop bucket must
  // out-punch the lightest, else the probe isn't actually reading weight.
  const withN = rows.filter((r) => r.n >= 1)
  if (withN.length >= 2) {
    const lo = withN[0], hi = withN[withN.length - 1]
    if (!(hi.avg > lo.avg * 1.15)) problems.push(`non-blindness: heaviest hitstop=${hi.hs} avg ${hi.avg.toFixed(4)} not > lightest hitstop=${lo.hs} avg ${lo.avg.toFixed(4)} * 1.15`)
  } else {
    problems.push('non-blindness: fewer than 2 weight buckets observed')
  }
  if (problems.length) { console.error('ASSERT FAILED:\n  ' + problems.join('\n  ')); process.exit(1) }
  console.log('ASSERT OK: normal hits charge the reactive screen-punch on the shipped route, scaling with weight.')
}
