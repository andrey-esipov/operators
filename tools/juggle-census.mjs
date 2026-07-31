#!/usr/bin/env node
/**
 * juggle-census.mjs — does the JUGGLE state ever actually happen in play?
 *
 * `e4acfd9` shipped 7-hit launcher juggle routes and `0fe7e25` fixed air melee
 * (jumpers were un-hittable because `juggleLeft <= 0` matched both "juggle
 * exhausted" and "fresh jumper"). Both are unit-proven. But a mechanic that the
 * AI never performs is one a player never sees, and this project has already
 * shipped a super that fired correctly for five sessions while every capture of
 * it photographed a light punch.
 *
 * So: sample real matches at high rate and count how often each stance is
 * entered. This does not ask "can a juggle happen" — the unit tests answer that.
 * It asks "does one happen in front of a player."
 *
 * Deliberately NOT a pass/fail gate. It reports a census; I read it.
 */
import { chromium } from 'playwright-core'

const PORT = Number(process.env.PORT || 5412)
const MATCHES = Number(process.env.MATCHES || 3)
const SECONDS = Number(process.env.SECONDS || 40)

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})

const totals = new Map()
const entries = new Map()
let airborneHitstun = 0
let maxAirY = 0
let samples = 0

for (let m = 0; m < MATCHES; m++) {
  // Setup is idempotent, so retry it; capture is not, so a failure there is
  // fatal. A quiet re-latch during capture would film a restarted match under
  // the requested label, which is how this project got 11 green screenshots of
  // an empty stage.
  let page = null
  for (let attempt = 1; attempt <= 4 && !page; attempt++) {
    const p = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 })
    try {
      await p.goto(`http://localhost:${PORT}/?a=lenny&b=chesky&cpu=hard&stage=pre-pmf`, { waitUntil: 'domcontentloaded' })
      await p.waitForFunction(() => window.__PLAY__?.ready?.() === true, { timeout: 20000 })
      page = p
    } catch (e) {
      process.stdout.write(`  setup attempt ${attempt} failed (${e.name}); retrying\n`)
      await p.close().catch(() => {})
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
  if (!page) { console.error('FATAL: could not reach a live match after 4 attempts'); process.exit(1) }
  await page.waitForTimeout(800)

  // CONTROL: a passive player cannot distinguish "the AI never blocks" from
  // "nobody ever attacked the AI". My first run had exactly that ambiguity and
  // I nearly reported it as an AI defect. So drive the human side with real
  // pressure -- approach, attack, retreat, block -- and let the CPU respond.
  const KEYS = { l: 'KeyA', r: 'KeyD', u: 'KeyW', d: 'KeyS', lp: 'KeyU', hp: 'KeyO', lk: 'KeyJ', hk: 'KeyL' }
  let beat = 0
  const drive = async () => {
    beat++
    const phase = beat % 12
    const tap = async (k, ms = 70) => {
      await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k)
    }
    if (phase < 3) await tap(KEYS.r, 110)            // close distance
    else if (phase === 3) await tap(KEYS.lp)          // poke
    else if (phase === 4) await tap(KEYS.hp)          // heavy - launcher candidate
    else if (phase === 5) await tap(KEYS.u, 90)       // jump (air interaction)
    else if (phase === 6) await tap(KEYS.hk)          // heavy kick
    else if (phase === 7) { await page.keyboard.down(KEYS.l); await page.waitForTimeout(320); await page.keyboard.up(KEYS.l) } // walk back = block
    else if (phase === 8) await tap(KEYS.lk)
    else if (phase === 9) { await page.keyboard.down(KEYS.l); await page.waitForTimeout(400); await page.keyboard.up(KEYS.l) }
    else await tap(KEYS.r, 90)
  }

  const prev = ['', '']
  const t0 = Date.now()
  let nextDrive = 0
  while (Date.now() - t0 < SECONDS * 1000) {
    if (Date.now() > nextDrive) { await drive(); nextDrive = Date.now() + 120 }
    const s = await page.evaluate(() => {
      const st = window.__PLAY__.state()
      return st.fighters.map((f) => ({ st: f.stance, y: f.pos.y, jl: f.juggleLeft ?? null }))
    })
    samples++
    for (let i = 0; i < 2; i++) {
      const cur = s[i].st
      totals.set(cur, (totals.get(cur) || 0) + 1)
      if (cur !== prev[i]) {
        entries.set(cur, (entries.get(cur) || 0) + 1)
        prev[i] = cur
      }
      if (cur === 'hitstun' && s[i].y > 5) { airborneHitstun++; maxAirY = Math.max(maxAirY, s[i].y) }
      if (s[i].y > maxAirY) maxAirY = s[i].y
    }
    await page.waitForTimeout(20)
  }
  await page.close()
  process.stdout.write(`  match ${m + 1}/${MATCHES} sampled\n`)
}

await browser.close()

console.log('')
console.log(`=== STANCE CENSUS — ${MATCHES} matches x ${SECONDS}s, ${samples} samples ===`)
console.log('')
console.log('  stance          entered   samples')
const all = [...new Set([...totals.keys(), ...entries.keys()])].sort()
for (const k of all) {
  const e = entries.get(k) || 0
  const t = totals.get(k) || 0
  const flag = e === 0 ? '   <<< NEVER ENTERED' : ''
  console.log(`  ${k.padEnd(14)} ${String(e).padStart(6)}  ${String(t).padStart(8)}${flag}`)
}

// The 18 stances the contract says the renderer can show.
const DECLARED = ['idle', 'walk-fwd', 'walk-back', 'crouch', 'jump-rise', 'jump-fall',
  'dash', 'backdash', 'attack', 'blockstun', 'hitstun', 'juggle', 'knockdown',
  'wakeup', 'throw-tech', 'ko', 'victory', 'defeat']
const missing = DECLARED.filter((d) => !entries.has(d))
console.log('')
console.log(`  airborne hitstun samples: ${airborneHitstun}   max fighter y: ${maxAirY.toFixed(1)}cm`)
console.log('')
console.log(`  DECLARED stances never observed in play (${missing.length}/18):`)
console.log(`    ${missing.length ? missing.join(', ') : '(none — every declared stance occurred)'}`)
