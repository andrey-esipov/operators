import fs from 'node:fs'
import path from 'node:path'
import { removeFlatBackground, registerFrame, findAnchor } from './lib/sprite-pipeline'
import { FRAMES, STANCE_FRAME } from './lib/frame-spec'
const id = process.argv[2] || 'doshi'
const CANVAS=512, TARGET_H=380, ORIGIN={x:256,y:470}
const ratio = new Map(FRAMES.map(f=>[f.name,f.heightRatio])); ratio.set(STANCE_FRAME,1)
const rawDir = path.resolve('.sprite-gen', id, 'raw')
const files = fs.readdirSync(rawDir).filter(f=>f.endsWith('.png'))
;(async()=>{
  let maxDrift=0, crashes=0
  for (const f of files.sort()) {
    const name=f.replace('.png','')
    const hr = ratio.get(name) ?? 1
    const raw = fs.readFileSync(path.join(rawDir,f))
    try {
      const seg = await removeFlatBackground(raw)
      const reg = await registerFrame(seg,{canvasW:CANVAS,canvasH:CANVAS,targetHeight:TARGET_H,originX:ORIGIN.x,originY:ORIGIN.y,heightRatio:hr})
      const a = await findAnchor(reg)
      const fd = Math.abs(a.footX-ORIGIN.x), bd = Math.abs(a.bottom-ORIGIN.y)
      maxDrift=Math.max(maxDrift,fd,bd)
      const flag = (fd>2.5||bd>2.5)?' <-- DRIFT':''
      console.log(name.padEnd(28), `hr=${hr}`.padEnd(9), `footDrift=${fd.toFixed(2)}`.padEnd(18), `bottomDrift=${bd.toFixed(2)}`.padEnd(18), flag)
    } catch(e){ crashes++; console.log(name.padEnd(28),'CRASH',(e as Error).message) }
  }
  console.log(`\nmax drift ${maxDrift.toFixed(2)}px, crashes ${crashes}`)
})()
