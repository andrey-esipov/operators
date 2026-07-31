import { chromium } from 'playwright-core'
const PORT = '5399'
const URL = `http://localhost:${PORT}/?fight=1&stage=pre-pmf&a=chesky&b=lenny`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await chromium.launch({ headless: false, executablePath: CHROME, args: ['--use-angle=metal','--window-position=4000,4000','--hide-scrollbars'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
page.setDefaultTimeout(35000)
async function boot(){ await page.goto(URL,{waitUntil:'load',timeout:30000}); await page.waitForFunction(()=>!!window.__FIGHT__?.renderer,{timeout:30000}); await page.evaluate(()=>window.__FIGHT__.pause()) }
for(let a=0;a<6;a++){try{await boot();break}catch(e){await new Promise(r=>setTimeout(r,1200))}}
await page.evaluate(()=>window.__FIGHT__.step(126))
for(let f=126;f<=142;f+=2){
  const r = await page.evaluate(async ()=>{
    const THREE = await import('/node_modules/.vite/deps/three.js?v=probe')
    const F=window.__FIGHT__; const cam=F.renderer.engine.camera
    const dump=[]
    for(let i=0;i<2;i++){const fr=F.renderer.fighter(i); const m=fr.mesh; const u=m.material.uniforms
      m.updateWorldMatrix(true,false)
      // bottom-centre corner world y (gy=0, gx=pivot.x)
      const oyBot=(0-u.uPivot.value.y)*u.uSize.value.y*u.uSquash.value.y
      const wBot=new THREE.Vector3(0,oyBot,0).applyMatrix4(m.matrixWorld)
      const p=wBot.clone().project(cam)
      dump.push({feetY:+m.position.y.toFixed(2), pivY:+u.uPivot.value.y.toFixed(3), szY:+u.uSize.value.y.toFixed(2), sqY:+u.uSquash.value.y.toFixed(2), belowFoot:+oyBot.toFixed(3), botWorldY:+wBot.y.toFixed(2), botSy:+(1-(p.y*0.5+0.5)).toFixed(4)})}
    return {frame:F.frame(), camY:+cam.position.y.toFixed(2), camZ:+cam.position.z.toFixed(2), a:dump[0], b:dump[1]}
  })
  console.log(JSON.stringify(r))
  await page.evaluate(()=>window.__FIGHT__.step(2))
}
await browser.close()
