import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
mkdirSync('diag', { recursive: true })
// region (410,210)-(900,520) in 1600x900
const region = { left: 380, top: 180, width: 560, height: 380 }
for (const [name, src] of [['super','fight-shots/07-super.png'],['hitstun','fight-shots/05-hitstun.png']]) {
  await sharp(src).extract(region).png().toFile(`diag/crop-${name}.png`)
  // brighten 1.6x to make any seam obvious
  await sharp(src).extract(region).linear(1.8, 0).png().toFile(`diag/crop-${name}-bright.png`)
}
console.log('wrote diag/crop-*.png')
