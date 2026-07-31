import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
mkdirSync('diag', { recursive: true })
const URL='http://localhost:5399/?fight=1&stage=ipo-prep&a=chesky&b=lenny&sim=mock'
const browser = await chromium.launch({ headless:false, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args:['--use-angle=metal','--window-position=4000,4000','--hide-scrollbars'] })
const page = await browser.newPage({ viewport:{width:1600,height:900}, deviceScaleFactor:1 })
await page.goto(URL, { waitUntil:'domcontentloaded' })
await page.waitForFunction(() => window.__FIGHT__?.ready?.() === true, null, { timeout:60000 })

// step to super + 6 frames, then tag candidate meshes and stash refs on window
await page.evaluate(async () => {
  const F = window.__FIGHT__
  F.pause()
  let g=0; while (F.phase()!=='super' && g<3000){F.step(1);g++}
  for(let i=0;i<6;i++) F.step(1)
  const scene = F.renderer.engine.scene
  const cands = { radial:null, halo:null, addPool:[], wide:[] }
  scene.traverse(o=>{
    if(o.type.includes('Mesh')){
      const s=o.scale
      if(o.renderOrder===28 && Math.abs(s.x-2.6)<0.01) cands.radial=o
      if(o.renderOrder===28 && Math.abs(s.x-1.8)<0.01) cands.halo=o
      if(o.renderOrder===20) cands.addPool.push(o)
      if(o.renderOrder===-1) cands.wide.push(o)
    }
  })
  window.__CANDS = cands
})
async function shot(name, mutate){
  await page.evaluate((mut)=>{
    const F=window.__FIGHT__, C=window.__CANDS
    // reset all visible
    C.radial&&(C.radial.visible=true); C.halo&&(C.halo.visible=true)
    C.addPool.forEach(o=>o.visible=true); C.wide.forEach(o=>o.visible=true)
    if(mut==='radial') C.radial&&(C.radial.visible=false)
    if(mut==='halo') C.halo&&(C.halo.visible=false)
    if(mut==='both28'){C.radial&&(C.radial.visible=false);C.halo&&(C.halo.visible=false)}
    if(mut==='addpool') C.addPool.forEach(o=>o.visible=false)
    if(mut==='wide') C.wide.forEach(o=>o.visible=false)
    F.step(1,0) // re-render frozen frame
  }, mutate)
  await page.screenshot({ path:`diag/bis-${name}.png` })
}
await shot('base', 'none')
await shot('no-radial','radial')
await shot('no-halo','halo')
await shot('no-both28','both28')
await shot('no-addpool','addpool')
await shot('no-wide','wide')
console.log('wrote diag/bis-*.png')
await browser.close()
