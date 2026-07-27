import fs from 'node:fs'
import path from 'node:path'
import { removeFlatBackground } from './scripts/lib/sprite-pipeline'
import { referenceHistogram } from './scripts/lib/sprite-validate'
import sharp from 'sharp'

// re-implement histogram+cosine inline to compare all probe raws vs stance,
// and cross-fighter (chesky stance vs another fighter) as a negative control.
async function hist(png: Buffer) {
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const h = new Float64Array(512); let t = 0
  for (let i = 0; i < data.length; i += 4) { if (data[i+3] <= 16) continue
    h[((data[i]>>5)<<6)|((data[i+1]>>5)<<3)|(data[i+2]>>5)]++; t++ }
  if (t) for (let i=0;i<h.length;i++) h[i]/=t; return h
}
function cos(a: Float64Array, b: Float64Array){let d=0,na=0,nb=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i]}return d/(Math.sqrt(na)*Math.sqrt(nb))}

async function main(){
  const dir='.sprite-probe/chesky'
  const stanceSeg = await removeFlatBackground(fs.readFileSync('public/sprites/chesky/stance.png'))
  const ref = await hist(stanceSeg)
  console.log('--- same character (chesky probe frames vs chesky stance) ---')
  for (const f of fs.readdirSync(dir).filter(f=>f.startsWith('raw-')).sort()){
    const seg = await removeFlatBackground(fs.readFileSync(path.join(dir,f)))
    console.log(`  ${f.padEnd(22)} identity ${cos(ref, await hist(seg)).toFixed(3)}`)
  }
  console.log('--- different characters (other stances vs chesky stance) [negative control] ---')
  for (const fid of ['altman','annie','doshi','reid','feifei','boris']){
    const p=`public/sprites/${fid}/stance.png`; if(!fs.existsSync(p))continue
    const seg = await removeFlatBackground(fs.readFileSync(p))
    console.log(`  ${fid.padEnd(22)} identity ${cos(ref, await hist(seg)).toFixed(3)}`)
  }
}
main().catch(e=>{console.error(e);process.exit(1)})
