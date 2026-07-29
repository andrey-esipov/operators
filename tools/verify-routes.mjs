// Proves a bare `/` is the FRONT DOOR and the fighter stays reachable for tools.
//
// This gate used to assert the opposite — "the fighter owns `/`" — which is
// exactly the defect it now guards against: a buyer who opened the game with no
// query string was dumped mid-fight instead of onto a title screen. The check is
// differential on purpose. Asserting "a canvas exists" would pass for either
// application, since both render WebGL. `window.__PLAY__` is published only by
// PlayableMatch, so requiring it ABSENT on `/` (plus a title marker) and PRESENT
// on `?play=1` / a matchup cannot be satisfied by a build that serves the same
// app to both — and specifically fails a build that regresses `/` back to the
// fighter.
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
const frontDoorRe = /OPERATORS|PRESS START|INSERT COIN/i

// The load-bearing case: a bare page load must land on the FRONT DOOR, not be
// dumped into a live fight. Differential on __PLAY__ (published only by the
// fighter) AND a title marker, so a build that regresses `/` back to the
// fighter fails on both counts.
const root = await probe('/')
results.push(['bare / shows the front door (no live fight)', root.hasPlay === false && frontDoorRe.test(root.text), `__PLAY__=${root.hasPlay} · "${root.text.slice(0, 60)}"`])

// The documented escape hatch must still boot straight to a live match.
const play = await probe('/?play=1')
results.push(['?play=1 still reaches the fighter', play.hasPlay === true, `__PLAY__=${play.hasPlay}`])

// An explicit matchup on `/` must still reach the fighter — the dozen capture
// tools that pass one rely on this, which is why `/` isn't gated wholesale.
const matchup = await probe('/?a=chesky&b=lenny')
results.push(['/?a=..&b=.. reaches the fighter', matchup.hasPlay === true, `__PLAY__=${matchup.hasPlay}`])

const cards = await probe('/?cards=1')
results.push(['?cards=1 mounts the card game', cards.hasPlay === false, `__PLAY__=${cards.hasPlay} · "${cards.text.slice(0, 60)}"`])

await page.screenshot({ path: 'fight-shots/route-root.png' })
await browser.close()

let failed = 0
for (const [name, ok, detail] of results) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`)
}
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
