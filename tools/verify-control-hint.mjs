import { chromium } from 'playwright-core'
const b = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
async function run(label, pressAt) {
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } })
  await p.goto('http://localhost:5399/', { waitUntil: 'domcontentloaded' })
  await p.waitForFunction(() => window.__PLAY__?.ready?.(), null, { timeout: 30000 })
  const ov = await p.evaluate(() => document.querySelector('vite-error-overlay')?.shadowRoot?.querySelector('.message')?.textContent ?? null)
  if (ov) { console.log('OVERLAY:', ov); process.exit(1) }
  const t0 = Date.now()
  let pressed = false, goneAt = null, fightAt = null
  while (Date.now() - t0 < 8000) {
    const el = Date.now() - t0
    if (pressAt !== null && !pressed && el >= pressAt) { pressed = true; await p.keyboard.press('d') }
    const r = await p.evaluate(() => ({ ph: window.__PLAY__.state().phase, hint: !!document.querySelector('kbd') }))
    if (r.ph === 'fight' && fightAt === null) fightAt = el
    if (!r.hint && goneAt === null) { goneAt = el; break }
    await p.waitForTimeout(50)
  }
  console.log(`${label.padEnd(22)} fight@${String(fightAt).padStart(5)}ms  hint gone@${goneAt === null ? '  never' : String(goneAt).padStart(5) + 'ms'}`)
  await p.close()
  return goneAt
}
const noInput = await run('no input', null)
const early = await run('presses D at 600ms', 600)
await b.close()
const ok = noInput !== null && noInput > 3000 && noInput < 4600 && early !== null && early < 1400
console.log(ok ? '\nPASS  readable floor honoured, input dismisses immediately' : '\nFAIL')
process.exit(ok ? 0 : 1)
