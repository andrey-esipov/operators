// Why do 7 of 8 stages never reach camera mode 'neutral'?
//
// Three standing hypotheses, none previously measured:
//   1. a second startMode('intro', 3.0) fires on every 'round-start'
//   2. Engine timeScale is shrinking dt so modeTime crawls
//   3. CameraDirector.debugHold pins the mode
//
// This steps the engine in fixed chunks and prints mode/modeTime/modeDur plus
// timeScale and debugHold every chunk, per stage. Whichever number misbehaves
// names the cause; no bisecting required.
import { chromium } from 'playwright-core'

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`)
  return i > -1 ? process.argv[i + 1] : d
}
const port = arg('port', '5173')
const chunks = Number(arg('chunks', '8'))
const per = Number(arg('per', '30'))

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
page.on('pageerror', (e) => console.log('  pageerror:', e.message))

const STAGES = arg('stages', '').split(',').filter(Boolean)

await page.goto(`http://localhost:${port}/?lab=1`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__OPS3D__, { timeout: 30000 })

const stages =
  STAGES.length > 0
    ? STAGES
    : await page.evaluate(async () => {
        const m = await import('/src/three/stage/StageRegistry.ts')
        return m.STAGE_ORDER
      })

console.log('stages:', stages.join(', '), '\n')

const reload = process.argv.includes('--reload')

for (const id of stages) {
  if (reload) {
    // One page load per stage. Without this the camera's modeTime carries over
    // between stages, so only the FIRST stage measured actually pays the 3s
    // intro and every later one starts already past it.
    await page.goto(`http://localhost:${port}/?lab=1&stage=${id}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => !!window.__OPS3D__, { timeout: 30000 })
  } else {
    await page.evaluate((s) => window.__OPS3D__.setStage?.(s), id).catch(() => {})
  }
  await page.waitForFunction(() => window.__OPS3D__.ready?.() !== false, { timeout: 20000 }).catch(() => {})

  const rows = []
  for (let c = 0; c < chunks; c++) {
    await page.evaluate((n) => window.__OPS3D__.step(n), per)
    rows.push(
      await page.evaluate(() => {
        const c = window.__opsCamera
        const e = window.__OPS3D__.engine
        return {
          mode: c?.mode ?? '?',
          t: +(c?.modeTime ?? -1).toFixed(2),
          dur: +(c?.modeDur ?? -1).toFixed(2),
          hold: c?.debugHold ? JSON.stringify(c.debugHold) : '-',
          ts: +(e?.timeScale ?? -1).toFixed(3),
        }
      }),
    )
  }
  const last = rows[rows.length - 1]
  const reached = rows.some((r) => r.mode === 'neutral')
  console.log(
    `${reached ? 'OK  ' : 'FAIL'} ${id.padEnd(14)} final=${last.mode.padEnd(8)}` +
      ` t=${last.t}/${last.dur} timeScale=${last.ts} hold=${last.hold}`,
  )
  if (!reached) console.log('       trace:', rows.map((r) => `${r.mode}@${r.t}`).join(' → '))
}

await browser.close()
