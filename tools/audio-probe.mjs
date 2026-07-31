#!/usr/bin/env node
/**
 * Audio-seam probe — the FIRST non-camera instrument in this critic's kit.
 *
 * For the project's entire history a 2,033-line audio engine was never called;
 * total silence went undetected because every instrument here is a camera and a
 * camera cannot hear. Commit 2735e9d ("join the seam") wired the renderer's
 * read-only combat-event list into a FightAudioReactor -> LiveFightAudioSink,
 * and exposed the sink's counters at `window.__PLAY__.audio()`.
 *
 * This probe reads those counters across a live fight. It can prove, honestly:
 *   - SEAM JOINED: `calls`/`impacts`/`footsteps`/`voices` climb => the reactor
 *     is being fed the same events the VFX consumes.
 *   - CONTEXT: `contextRunning` (AudioContext unlocked) and `musicStarted`.
 *
 * What it is CONSTITUTIONALLY UNABLE to see (state this in any verdict):
 *   - Whether an audible, correct, well-mixed waveform actually leaves the
 *     speakers. Headless Chrome starts the AudioContext SUSPENDED (autoplay
 *     policy) and the sink "fails silent", so counts can climb with zero sound.
 *   - Sample quality, mix balance, and frame-accurate sync to the hit.
 * So a green result means "wired and firing events", NOT "sounds good".
 *
 *   node tools/audio-probe.mjs --port 5412 --query "a=spiegel&b=lenny&cpu=normal" --secs 4
 */
import { chromium } from 'playwright-core'

const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d)
const PORT = arg('port', '5412')
const QUERY = arg('query', 'a=spiegel&b=lenny&p1=operator&p2=operator&cpu=normal')
const SECS = Number(arg('secs', '4'))
const URL = `http://localhost:${PORT}/?${QUERY}`
const EXE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-angle=metal', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 })
page.on('console', m => { if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 140)) })
console.log(`audio-probe  ${URL}  (${SECS}s live)`)
await page.goto(URL, { waitUntil: 'domcontentloaded' })

// wait for the play route
let ok = false
for (let i = 0; i < 80; i++) {
  try { ok = await page.evaluate(() => !!window.__PLAY__?.ready?.() && !!window.__PLAY__?.audio) } catch { ok = false }
  if (ok) break
  await page.waitForTimeout(150)
}
if (!ok) { console.log('FAILED: no __PLAY__.audio hook (is this beea557+?)'); await browser.close(); process.exit(1) }

const read = () => page.evaluate(() => window.__PLAY__.audio())
const phase = () => page.evaluate(() => window.__PLAY__.state().phase)

const base = await read()
console.log('  baseline:', JSON.stringify(base), 'phase=', await phase())

// let the sim run in real time so the AI trades hits + walks (footsteps)
await page.evaluate(() => window.__PLAY__.resume?.())
const samples = []
const t0 = Date.now()
while ((Date.now() - t0) / 1000 < SECS) {
  await page.waitForTimeout(500)
  samples.push({ t: ((Date.now() - t0) / 1000).toFixed(1), ...(await read()) })
}
await page.evaluate(() => window.__PLAY__.pause?.())
const final = await read()

console.log('  t(s)  calls impacts footsteps announces voices  ctxRun music')
for (const s of samples) {
  console.log(`  ${String(s.t).padStart(4)}  ${String(s.calls).padStart(5)} ${String(s.impacts).padStart(7)} ${String(s.footsteps).padStart(9)} ${String(s.announces).padStart(9)} ${String(s.voices).padStart(6)}  ${String(s.contextRunning).padStart(6)} ${String(s.musicStarted)}`)
}
const d = (k) => final[k] - base[k]
console.log(`  DELTAS  calls+${d('calls')} impacts+${d('impacts')} footsteps+${d('footsteps')} announces+${d('announces')} voices+${d('voices')}`)
console.log(`  contextRunning=${final.contextRunning}  musicStarted=${final.musicStarted}`)

// verdict
const fed = d('calls') > 0 || d('footsteps') > 0 || d('impacts') > 0
if (!fed) console.log('  VERDICT: SEAM NOT FIRING — counters flat over the window (reactor is NOT being fed).')
else if (!final.contextRunning) console.log('  VERDICT: SEAM JOINED (events firing) but AudioContext SUSPENDED — no audible output in this headless run. Cannot judge sound quality.')
else console.log('  VERDICT: SEAM JOINED and AudioContext RUNNING — events fire and would be audible. (Quality/mix still NOT judgeable by a counter.)')

await browser.close()
