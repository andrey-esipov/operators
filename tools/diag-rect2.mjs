import sharp from 'sharp'
const W=1600,H=900
// draw a magenta 2px box at (410,210)-(900,520) over a 1.35x brightened super
const box = Buffer.from(
  `<svg width="${W}" height="${H}"><rect x="410" y="210" width="490" height="310" fill="none" stroke="magenta" stroke-width="3"/></svg>`)
await sharp('fight-shots/07-super.png').resize(W,H).linear(1.35,0)
  .composite([{ input: box }]).png().toFile('diag/super-box.png')
// also a heavy 2.2x brighten of just the region, no fighters clip
await sharp('fight-shots/07-super.png').resize(W,H).extract({left:360,top:170,width:600,height:380}).linear(2.4,-20).png().toFile('diag/super-region-hot.png')
console.log('ok')
