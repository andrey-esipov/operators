import sharp from 'sharp'
const W=1600,H=900
async function raw(p){ return (await sharp(p).resize(W,H).removeAlpha().raw().toBuffer()) }
const base = await raw('diag/bis-base.png')
for(const v of ['no-radial','no-halo','no-both28','no-addpool','no-wide']){
  const b = await raw(`diag/bis-${v}.png`)
  let minX=W,minY=H,maxX=0,maxY=0,cnt=0,sum=0
  const diffImg = Buffer.alloc(W*H*3)
  for(let i=0;i<W*H;i++){
    const d=Math.abs(base[i*3]-b[i*3])+Math.abs(base[i*3+1]-b[i*3+1])+Math.abs(base[i*3+2]-b[i*3+2])
    if(d>30){ cnt++; sum+=d; const x=i%W,y=(i/W)|0; if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y; diffImg[i*3]=255 }
  }
  console.log(`${v.padEnd(12)} px=${cnt} bbox=(${minX},${minY})-(${maxX},${maxY}) mean=${cnt?(sum/cnt).toFixed(0):0}`)
  await sharp(diffImg,{raw:{width:W,height:H,channels:3}}).png().toFile(`diag/diffmap-${v}.png`)
}
