/**
 * Per-arena channel-health check.
 *
 * Guards against the class of bug where a whole colour channel dies frame-wide
 * and the game renders in a single pure hue. That shipped undetected for hours
 * because every screenshot still "looked like a graded frame" -- it was only
 * measuring the pixels that exposed it.
 *
 * Watch two numbers per stage:
 *   meanSat   pinned at exactly 1.000 means at least one channel is dead
 *             everywhere. Healthy arenas land around 0.15-0.86.
 *   zeroR/G/B percentage of LIT pixels (max > 12) holding an exact 0 in that
 *             channel. Anything near 100 is a dead channel, not art direction.
 *
 * Usage: node tools/verify-color.mjs [port] [tag]
 * Writes /tmp/verify-<tag>-<stage>.png alongside the table.
 */
import { chromium } from 'playwright-core'
import { writeFileSync } from 'node:fs'
const port = process.argv[2] || '5210'
const tag = process.argv[3] || 'fixed'
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false,
  args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--hide-scrollbars','--mute-audio','--window-position=4000,4000','--window-size=1400,800'],
})
const page = await browser.newPage({ viewport: { width: 1400, height: 800 }, deviceScaleFactor: 1 })
page.on('pageerror', e => console.log('PAGEERROR', String(e)))
const stages = ['pre-pmf','hypergrowth','plateau','ai-native','monetization','crisis','ipo-prep','distribution']
console.log('stage           meanR  meanG  meanB   meanSat   zeroG%  zeroB%  zeroR%')
for (const s of stages) {
  await page.goto(`http://localhost:${port}/?lab=1&hud=0&quality=ultra&stage=${s}&a=chesky&b=lenny`, { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(() => window.__OPS3D__?.ready?.() === true, null, { timeout: 60000 })
  await page.evaluate(() => window.__OPS3D__.settle(40))
  const r = await page.evaluate(() => {
    const gl = window.__OPS3D__.engine.renderer.getContext()
    const w = 320, h = 180
    const px = new Uint8Array(4*w*h)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
    let R=0,G=0,B=0,n=0,sat=0,zg=0,zb=0,zr=0
    for(let i=0;i<px.length;i+=4){
      const r=px[i],g=px[i+1],b=px[i+2]
      R+=r;G+=g;B+=b;n++
      const mx=Math.max(r,g,b),mn=Math.min(r,g,b); sat+=mx?(mx-mn)/mx:0
      // only count "dead channel" on pixels that are not simply black
      if (mx > 12) { if (g===0) zg++; if (b===0) zb++; if (r===0) zr++ }
    }
    return { R:+(R/n).toFixed(1), G:+(G/n).toFixed(1), B:+(B/n).toFixed(1), sat:+(sat/n).toFixed(3),
             zg:+(100*zg/n).toFixed(1), zb:+(100*zb/n).toFixed(1), zr:+(100*zr/n).toFixed(1) }
  })
  console.log(`${s.padEnd(14)} ${String(r.R).padStart(5)} ${String(r.G).padStart(6)} ${String(r.B).padStart(6)}   ${String(r.sat).padStart(6)}  ${String(r.zg).padStart(6)} ${String(r.zb).padStart(6)} ${String(r.zr).padStart(6)}`)
  const d = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'))
  writeFileSync(`/tmp/verify-${tag}-${s}.png`, Buffer.from(d.split(',')[1],'base64'))
}
await browser.close()
