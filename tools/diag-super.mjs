import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
mkdirSync('diag', { recursive: true })
const URL='http://localhost:5399/?fight=1&stage=ipo-prep&a=chesky&b=lenny&sim=mock'
const browser = await chromium.launch({ headless:false, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args:['--use-angle=metal','--window-position=4000,4000','--hide-scrollbars'] })
const page = await browser.newPage({ viewport:{width:1600,height:900}, deviceScaleFactor:1 })
page.on('console', m => { const t=m.text(); if(t.includes('[diag]')) console.log(t) })
await page.goto(URL, { waitUntil:'domcontentloaded' })
await page.waitForFunction(() => window.__FIGHT__?.ready?.() === true, null, { timeout:60000 })
const F = () => {}
// pause and step to super
const info = await page.evaluate(async () => {
  const F = window.__FIGHT__
  F.pause()
  let guard=0
  while (F.phase() !== 'super' && guard < 3000) { F.step(1); guard++ }
  // advance a few frames so the flash builds (super-flash at t===2, peak ~t 4-8)
  for (let i=0;i<6;i++) F.step(1)
  const scene = F.renderer.engine.scene
  const rows=[]
  scene.traverse(o => {
    if (!o.visible) return
    const m = o.material
    const blend = m ? (Array.isArray(m)?m[0]:m).blending : null
    rows.push({ type:o.type, name:o.name||'', ro:o.renderOrder,
      pos:o.position?[+o.position.x.toFixed(2),+o.position.y.toFixed(2),+o.position.z.toFixed(2)]:null,
      scale:o.scale?[+o.scale.x.toFixed(2),+o.scale.y.toFixed(2),+o.scale.z.toFixed(2)]:null,
      blend })
  })
  return { phase:F.phase(), frame:F.frame(), guard, rows }
})
console.log('phase', info.phase, 'frame', info.frame, 'guard', info.guard)
console.log('scene objects with mesh/plane:')
for (const r of info.rows) {
  if (r.type.includes('Mesh') || r.type.includes('Points') || r.type.includes('Sprite'))
    console.log(`  ${r.type} "${r.name}" ro=${r.ro} pos=${JSON.stringify(r.pos)} scale=${JSON.stringify(r.scale)} blend=${r.blend}`)
}
await page.screenshot({ path:'diag/super-mock-base.png' })
console.log('wrote diag/super-mock-base.png')
await browser.close()
