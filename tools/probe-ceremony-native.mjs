// Native-1:1 overflow gate for the match-ceremony letterforms.
//
// The announcement layer (.fhud-announce) is `overflow:hidden` over the full
// viewport, so a word wider than the screen is *silently clipped* — the exact
// failure this project keeps getting burned by. A green text-scan (probe-
// ceremony.mjs) proves the right WORD shows; it does NOT prove the word fits.
// This tool measures the live bounding rect of every letterform against the
// 1920x1080 clip box and fails on any overflow.
//
// Two things make it a real gate rather than a rubber stamp:
//   1. NATIVE 1:1 (1920x1080, DPR1). vw units make the fonts here LARGER than
//      probe-ceremony's 1600px DPR2 capture, so this is the stronger overflow
//      case. Always the harder test, never the easier one.
//   2. ENVELOPE, not a single frame. The slam-in overshoots to scale 1.14 at
//      ~250ms before settling to 1.0 (Announcements.tsx keyframes). A word that
//      fits when settled can still clip at the peak, so we sample the rect every
//      rAF across the whole slam and gate on the widest extent seen — the
//      house rule "assert the window, not eventual truth" applied to geometry.
//
// Coverage the text-scan skips: ROUND 1/3 callouts, non-perfect K.O. vs
// PERFECT (discriminated), and TIME OVER (driven by zeroing the round timer so
// checkRoundEnd resolves with no KO) — beats that have never appeared in a
// capture. The WINS kicker is stress-tested with the roster's longest display
// name ("Aparna Chennapragada", 20 chars) so the widest real name is proven.
//
// Proven able to fail: bump any per-beat clamp in hud.css past the viewport
// (e.g. time-over main to clamp(76px, 40vw, 900px)) and that beat's overflow
// check goes red while the others stay green (see the mutation note in the
// report).

import { chromium } from 'playwright-core'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d)
const PORT = arg('--port', '5412')
const A = arg('--a', 'aparna') // longest display name -> worst-case WINS kicker
const B = arg('--b', 'stewart')
const OUT = arg('--out', 'fighthud-shots/ceremony-native')
const VW = 1920
const VH = 1080
const SAMPLE_MS = 600 // covers the 500ms slam-in incl. the ~250ms scale-1.14 peak
const TOL = 1 // px; sub-pixel rounding only, not a clip budget
const SHA = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return '?'
  }
})()

const base = `http://localhost:${PORT}/?fighthud=1&a=${A}&b=${B}&paused=1`

// Drive bodies run inside the page against window.__FIGHTHUD__. The sim primes
// a round-start(1) at frame 0, and AnimatePresence mode="wait" keeps an exiting
// banner in the DOM for ~0.25s, so we (A) wait for the primed banner to clear,
// (B) drive to the target, (C) wait for the TARGET banner (data-kind + main
// text) to actually mount, then (D) envelope-sample its slam-in. Recording only
// target-matching frames keeps a stale/exiting banner out of the measurement.
const SAMPLER = `
async (beat, kind, main, sampleMs) => {
  const F = window.__FIGHTHUD__
  const stepToFight = () => { for (let i = 0; i < 400 && F.state().phase !== 'fight'; i++) F.step(1) }
  const raf = () => new Promise((r) => requestAnimationFrame(r))
  const active = () => {
    const a = document.querySelector('.fhud-announce')
    if (!a) return null
    const m = (a.querySelector('.fhud-word-main .fhud-word-fill')?.textContent || '').trim()
    return { kind: a.getAttribute('data-kind'), main: m }
  }
  const norm = (x) => (x || '').trim().toUpperCase()

  // (A) wait out the primed ROUND 1 (life 1500ms + 250ms exit).
  { const t0 = performance.now(); while (document.querySelector('.fhud-announce-stack') && performance.now() - t0 < 2000) await raf() }

  // (B) drive to the target beat. sim.step() structuredClones state every frame,
  // so we re-read F.state() AFTER stepping and mutate that live object — the next
  // F.step clones it, carrying our health/timer edit into checkRoundEnd.
  switch (beat) {
    case 'round1': F.inject([{ type: 'round-start', round: 1 }]); break
    case 'round3': F.inject([{ type: 'round-start', round: 3 }]); break
    case 'fight': stepToFight(); break
    case 'ko': {
      stepToFight()
      const s = F.state()
      s.wins[0] = 0; s.wins[1] = 0
      s.fighters[0].health = Math.floor(s.fighters[0].maxHealth * 0.42) // winner NOT full -> no PERFECT
      s.fighters[1].health = 0
      for (let i = 0; i < 60 && F.state().phase === 'fight'; i++) F.step(1)
      break
    }
    case 'perfect': {
      stepToFight()
      const s = F.state()
      s.wins[0] = 0; s.wins[1] = 0
      s.fighters[0].health = s.fighters[0].maxHealth // winner full -> PERFECT
      s.fighters[1].health = 0
      for (let i = 0; i < 60 && F.state().phase === 'fight'; i++) F.step(1)
      break
    }
    case 'timeover': {
      stepToFight()
      const s = F.state()
      s.timer = 0 // both alive + timer 0 -> checkRoundEnd resolves with NO ko event
      for (let i = 0; i < 60 && F.state().phase === 'fight'; i++) F.step(1)
      break
    }
    case 'wins': {
      stepToFight()
      const s = F.state()
      s.wins[0] = 1; s.wins[1] = 0 // one KO makes it 2-0 -> match-end
      s.fighters[1].health = 0
      for (let i = 0; i < 600 && F.state().phase !== 'match-end'; i++) F.step(1)
      break
    }
  }
  const phase = F.state().phase

  // (C) wait for the TARGET banner to mount (kind + main both match).
  let matched = false
  { const t0 = performance.now()
    while (performance.now() - t0 < 2500) {
      const a = active()
      if (a && a.kind === kind && norm(a.main) === norm(main)) { matched = true; break }
      await raf()
    } }

  // (D) envelope-sample the slam-in; record only target-matching frames.
  const clsOf = (el) =>
    el.className.includes('kicker') ? 'kicker' : el.className.includes('sub') ? 'sub' : 'main'
  const env = { l: Infinity, r: -Infinity, t: Infinity, b: -Infinity, samples: 0 }
  const words = {}
  const start = performance.now()
  await new Promise((resolve) => {
    const tick = () => {
      const a = active()
      if (a && a.kind === kind && norm(a.main) === norm(main)) {
        for (const el of document.querySelectorAll('.fhud-announce-stack .fhud-word')) {
          const r = el.getBoundingClientRect()
          env.l = Math.min(env.l, r.left); env.r = Math.max(env.r, r.right)
          env.t = Math.min(env.t, r.top); env.b = Math.max(env.b, r.bottom)
          const cls = clsOf(el)
          const w = words[cls] || {
            l: Infinity, r: -Infinity, t: Infinity, b: -Infinity,
            text: (el.querySelector('.fhud-word-fill')?.textContent || '').trim(),
            font: getComputedStyle(el).fontSize,
          }
          w.l = Math.min(w.l, r.left); w.r = Math.max(w.r, r.right)
          w.t = Math.min(w.t, r.top); w.b = Math.max(w.b, r.bottom)
          words[cls] = w
        }
        env.samples++
      }
      if (performance.now() - start < sampleMs) requestAnimationFrame(tick)
      else resolve()
    }
    requestAnimationFrame(tick)
  })
  return { phase, matched, env, words, kind: document.querySelector('.fhud-announce')?.getAttribute('data-kind') || null }
}`

const BEATS = [
  { beat: 'round1', main: '1', kind: 'round', want: ['ROUND', '1'] },
  { beat: 'round3', main: '3', kind: 'round', want: ['ROUND', '3'] },
  { beat: 'fight', main: 'FIGHT!', kind: 'fight', want: ['FIGHT!'], phase: 'fight' },
  { beat: 'ko', main: 'K.O.', kind: 'ko', want: ['K.O.'], notWord: 'PERFECT', phase: 'ko' },
  { beat: 'perfect', main: 'K.O.', kind: 'perfect', want: ['K.O.', 'PERFECT'], phase: 'ko' },
  { beat: 'timeover', main: 'TIME OVER', kind: 'time-over', want: ['TIME OVER'], phase: 'round-end' },
  { beat: 'wins', main: 'WINS', kind: 'win', want: ['WINS'], phase: 'match-end', longName: true },
]

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--no-sandbox'],
})
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

console.log(`ceremony native-1:1 overflow gate  ${VW}x${VH} DPR1  ${A} vs ${B}  build ${SHA} -> ${OUT}/`)

const checks = []
const rows = []
const errors = []

let idx = 0
for (const spec of BEATS) {
  const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => errors.push(`[${spec.beat}] ${String(e)}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${spec.beat}] ${m.text()}`))
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__FIGHTHUD__?.ready?.(), null, { timeout: 30000 })

  const res = await page.evaluate(
    `(${SAMPLER})(${JSON.stringify(spec.beat)}, ${JSON.stringify(spec.kind)}, ${JSON.stringify(spec.main)}, ${SAMPLE_MS})`,
  )
  const label = String(idx).padStart(2, '0') + '-' + spec.beat
  writeFileSync(`${OUT}/${label}.png`, await page.screenshot())

  const wordsFlat = Object.values(res.words).map((w) => w.text.toUpperCase())
  const present = (w) => wordsFlat.some((t) => t === w.toUpperCase())
  const includes = (w) => wordsFlat.some((t) => t.includes(w.toUpperCase()))

  // Overflow: widest extent across the whole slam must stay inside the clip box.
  const e = res.env
  const overflow =
    e.l < -TOL || e.r > VW + TOL || e.t < -TOL || e.b > VH + TOL
  const marginL = Math.round(e.l)
  const marginR = Math.round(VW - e.r)
  const marginT = Math.round(e.t)
  const marginB = Math.round(VH - e.b)

  checks.push([`${spec.beat}: target banner mounted (${res.env.samples} samples)`, res.matched === true && res.env.samples > 0])
  checks.push([`${spec.beat}: banner present, shows ${spec.want.join('+')}`, spec.want.every((w) => present(w) || includes(w))])
  checks.push([`${spec.beat}: no horizontal clip (L=${marginL}px R=${marginR}px, ${res.env.samples} samples)`, e.l >= -TOL && e.r <= VW + TOL])
  checks.push([`${spec.beat}: no vertical clip (T=${marginT}px B=${marginB}px)`, e.t >= -TOL && e.b <= VH + TOL])
  if (spec.phase) checks.push([`${spec.beat}: reached ${spec.phase} phase`, res.phase === spec.phase])
  if (spec.kind) checks.push([`${spec.beat}: data-kind=${spec.kind}`, res.kind === spec.kind])
  if (spec.notWord) checks.push([`${spec.beat}: does NOT show ${spec.notWord} (discriminates)`, !present(spec.notWord)])
  if (spec.longName) {
    const k = res.words.kicker
    checks.push([`${spec.beat}: long name "${k?.text}" fits (r=${k ? Math.round(k.r) : '?'} <= ${VW})`, !!k && k.r <= VW + TOL && k.l >= -TOL])
  }

  rows.push({
    beat: spec.beat,
    phase: res.phase,
    kind: res.kind,
    words: res.words,
    env: { l: Math.round(e.l), r: Math.round(e.r), t: Math.round(e.t), b: Math.round(e.b), samples: e.samples },
    margins: { L: marginL, R: marginR, T: marginT, B: marginB },
    overflow,
  })
  console.log(
    `  ${label}: kind=${res.kind} phase=${res.phase} words=${JSON.stringify(wordsFlat)} ` +
      `extent[l=${Math.round(e.l)} r=${Math.round(e.r)} t=${Math.round(e.t)} b=${Math.round(e.b)}] ` +
      `margins[L=${marginL} R=${marginR} T=${marginT} B=${marginB}] ${overflow ? 'OVERFLOW' : 'ok'}`,
  )
  await page.close()
  idx++
}

let failed = 0
console.log('')
for (const [lbl, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${lbl}`)
  if (!ok) failed++
}
writeFileSync(`${OUT}/result.json`, JSON.stringify({ build: SHA, viewport: [VW, VH], rows, errors }, null, 2))
if (errors.length) console.log(`\n  ${errors.length} console errors: ${JSON.stringify(errors.slice(0, 4))}`)

await browser.close()
if (failed) {
  console.log(`\n=== ${failed} FAILURE(S) ===`)
  process.exit(1)
}
console.log('\n=== ALL PASS ===')
