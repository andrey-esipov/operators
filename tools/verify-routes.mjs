// Proves the fighter owns `/` and the legacy card game moved to `?cards=1`.
//
// The check is differential on purpose. Asserting "a canvas exists" on `/`
// would pass for either application, since the card game also renders WebGL.
// `window.__PLAY__` is published only by PlayableMatch, so requiring it to be
// present on one route and absent on the other cannot be satisfied by a build
// that serves the same app to both.
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:5399'

const browser = await chromium.launch({
  headless: false,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=metal', '--window-position=4000,4000', '--hide-scrollbars'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })

async function probe(path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
  // The route is lazy, so poll rather than sleeping a fixed amount.
  let hasPlay = false
  for (let i = 0; i < 60; i++) {
    hasPlay = await page.evaluate(() => Boolean(window.__PLAY__))
    if (hasPlay) break
    await page.waitForTimeout(250)
  }
  const text = (await page.evaluate(() => document.body.innerText)).slice(0, 200)
  return { hasPlay, text: text.replace(/\s+/g, ' ').trim() }
}

const results = []
const root = await probe('/')
results.push(['/ mounts the fighter', root.hasPlay === true, `__PLAY__=${root.hasPlay}`])

const cards = await probe('/?cards=1')
results.push(['?cards=1 mounts the card game', cards.hasPlay === false, `__PLAY__=${cards.hasPlay} · "${cards.text.slice(0, 60)}"`])

const legacy = await probe('/?play=1')
results.push(['?play=1 still reaches the fighter', legacy.hasPlay === true, `__PLAY__=${legacy.hasPlay}`])

await page.screenshot({ path: 'fight-shots/route-root.png' })
await browser.close()

let failed = 0
for (const [name, ok, detail] of results) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`)
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
