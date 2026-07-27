/**
 * measure-impact.mjs — per-flavour impact readability metric.
 *
 * Fresh page load per flavour. This matters: particle pools, the post impact
 * envelope and the light rig all carry state, so firing several hits into one
 * page gives numbers that drift upward with each hit and are not comparable.
 *
 *   node tools/measure-impact.mjs [--port 5173] [--stage hypergrowth]
 *                                 [--steps 3] [--png /tmp/dir]
 *
 * Reports, inside the defender's bounding box:
 *   blown%  share of pure-white pixels (min(R,G,B) > 250)
 *   wash%   share washed out by a *coloured* flare (R > 235 and G > 200).
 *           blown% alone is a trap: the contact flare is warm gold, so a blob
 *           that completely hides the character reads as min(R,G,B) ~ 180 and
 *           scores 0% blown. Two rounds of tuning were spent optimising blown%
 *           while the picture did not change. Trust wash% and detail.
 *   detail  mean absolute luminance gradient -- edge energy. This is the one
 *           that actually encodes "can I still see the character": a blob has
 *           almost no internal structure, a readable fighter has a lot. Compare
 *           against the `none` row; below ~65% of it the reaction is unreadable.
 *   hot%    share above 200 luma
 * Target: wash% under ~6, detail at or above 80% of the at-rest row.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d }
const port = arg('port', '5173'), stage = arg('stage', 'hypergrowth')
const steps = +arg('steps', '3'), png = arg('png', null)
const flavors = (arg('flavors', 'light,heavy,ex,combo,crit,ult,signature')).split(',')
if (png) mkdirSync(png, { recursive: true })

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio',
    '--window-position=4000,4000', '--window-size=1600,900'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })

const probe = `(() => {
  const e = window.__OPS3D__.engine, gl = e.renderer.getContext()
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, buf = new Uint8Array(w*h*4)
  e.driver.render(0); gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,buf)
  const x0=(w*0.55)|0,x1=(w*0.80)|0,y0=(h*0.32)|0,y1=(h*0.72)|0
  const L=(x,y)=>{const i=(y*w+x)*4; return (buf[i]+buf[i+1]+buf[i+2])/3}
  let box=0,bb=0,hot=0,wash=0,s=0,g=0,gn=0,fn=0,fb=0
  for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++){ const i=(y*w+x)*4
    box++; const l=(buf[i]+buf[i+1]+buf[i+2])/3; s+=l
    if(buf[i]>250&&buf[i+1]>250&&buf[i+2]>250) bb++
    if(buf[i]>235&&buf[i+1]>200) wash++
    if(l>200) hot++
    if(x+1<x1&&y+1<y1){ g+=Math.abs(L(x+1,y)-l)+Math.abs(L(x,y+1)-l); gn+=2 } }
  for(let i=0;i<buf.length;i+=16){ fn++
    if(buf[i]>250&&buf[i+1]>250&&buf[i+2]>250) fb++ }
  return { blown:+(bb/box*100).toFixed(1), wash:+(wash/box*100).toFixed(1),
           hot:+(hot/box*100).toFixed(1), detail:+(g/gn).toFixed(2),
           mean:+(s/box).toFixed(0), frameBlown:+(fb/fn*100).toFixed(2) }
})()`

const rows = []
for (const f of ['none', ...flavors]) {
  await page.goto(`http://localhost:${port}/?lab=1&hud=0&quality=ultra&stage=${stage}&a=chesky&b=lenny`,
    { waitUntil: 'load', timeout: 120000 })
  await page.waitForFunction(() => window.__OPS3D__?.ready?.() === true, null, { timeout: 120000 })
  await page.evaluate(() => window.__OPS3D__.engine.stop())
  await page.evaluate(() => window.__OPS3D__.step(20))
  if (f !== 'none') {
    await page.evaluate((fl) => window.__OPS3D__.hit(fl, 'b'), f)
    await page.evaluate((n) => window.__OPS3D__.step(n), steps)
  }
  rows.push({ flavor: f, ...(await page.evaluate(probe)) })
  if (png) writeFileSync(`${png}/${f}.png`, await page.screenshot())
}

const restDetail = rows[0].detail || 1
console.log('flavor'.padEnd(11), 'wash%'.padStart(6), 'blown%'.padStart(7), 'hot%'.padStart(6),
  'detail'.padStart(7), 'keep%'.padStart(6), 'mean'.padStart(5))
for (const r of rows) console.log(r.flavor.padEnd(11),
  String(r.wash).padStart(6), String(r.blown).padStart(7), String(r.hot).padStart(6),
  String(r.detail).padStart(7), (r.detail / restDetail * 100).toFixed(0).padStart(6),
  String(r.mean).padStart(5))
await browser.close()
