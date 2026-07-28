import sharp from 'sharp'
const W=1600,H=900
const { data } = await sharp('fight-shots/07-super.png').resize(W,H).removeAlpha().raw().toBuffer({resolveWithObject:true})
// luminance
const lum = new Float32Array(W*H)
for(let i=0;i<W*H;i++){ lum[i]=0.299*data[i*3]+0.587*data[i*3+1]+0.114*data[i*3+2] }
// vertical edges: for each column x, sum |lum[x]-lum[x-1]| over rows -> strong vertical line
const col = new Float32Array(W)
for(let x=1;x<W;x++){let s=0;for(let y=0;y<H;y++){s+=Math.abs(lum[y*W+x]-lum[y*W+x-1])} col[x]=s/H}
// horizontal edges: for each row y
const row = new Float32Array(H)
for(let y=1;y<H;y++){let s=0;for(let x=0;x<W;x++){s+=Math.abs(lum[y*W+x]-lum[(y-1)*W+x])} row[y]=s/W}
// top vertical edge columns
const topCols=[...col.keys()].sort((a,b)=>col[b]-col[a]).slice(0,12).sort((a,b)=>a-b)
const topRows=[...row.keys()].sort((a,b)=>row[b]-row[a]).slice(0,12).sort((a,b)=>a-b)
console.log('strong vertical edges (x, strength):')
for(const x of topCols) console.log('  x=',x, col[x].toFixed(1))
console.log('strong horizontal edges (y, strength):')
for(const y of topRows) console.log('  y=',y, row[y].toFixed(1))
