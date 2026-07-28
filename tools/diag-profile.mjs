import sharp from 'sharp'
const W=1600,H=900
const { data } = await sharp('fight-shots/07-super.png').resize(W,H).removeAlpha().raw().toBuffer({resolveWithObject:true})
const lum=(x,y)=>{const i=(y*W+x)*3;return 0.299*data[i]+0.587*data[i+1]+0.114*data[i+2]}
// warmth = R - B (positive = warm)
const warm=(x,y)=>{const i=(y*W+x)*3;return data[i]-data[i+2]}
// horizontal scan at y=300 (above fighters' mid, in the reported rect y210-520)
console.log('HORIZONTAL scan y=300 (warm=R-B), every 40px:')
let row=''
for(let x=200;x<1200;x+=40){ row+=`${x}:${warm(x,300)>0?'+':''}${warm(x,300)|0} ` }
console.log(row)
console.log('\nVERTICAL scan x=600 (warm), every 30px:')
let col=''
for(let y=120;y<650;y+=30){ col+=`${y}:${warm(600,y)>0?'+':''}${warm(600,y)|0} ` }
console.log(col)
// Look for a sharp warmth STEP by computing gradient of smoothed warmth along y at several x
console.log('\nColumn-avg warmth per 20px band, x in [420,880], to find top edge:')
for(let y=160;y<560;y+=20){
  let s=0,n=0; for(let x=440;x<860;x+=8){s+=warm(x,y);n++}
  console.log(`  y=${y}: ${(s/n).toFixed(1)}`)
}
