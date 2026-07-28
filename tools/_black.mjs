import sharp from 'sharp';
import { readdirSync } from 'fs';
const files = readdirSync('fight-shots').filter(f=>f.endsWith('.png')).sort();
for (const f of files) {
  const { data, info } = await sharp(`fight-shots/${f}`).raw().toBuffer({ resolveWithObject: true });
  const N = info.width*info.height;
  let nearBlack=0, trueBlack=0;
  const hist=new Array(16).fill(0);
  for(let i=0;i<N;i++){const o=i*info.channels;const r=data[o],g=data[o+1],b=data[o+2];
    const l=0.2126*r+0.7152*g+0.0722*b;
    if(l<8) trueBlack++; if(l<16) nearBlack++;
    hist[Math.min(15,Math.floor(l/16))]++;
  }
  // internal structure test: within near-black pixels, what's the stddev after 8x gain?
  let sum=0,sum2=0,c=0;
  for(let i=0;i<N;i++){const o=i*info.channels;const l=0.2126*data[o]+0.7152*data[o+1]+0.0722*data[o+2];
    if(l<16){const g8=l*8; sum+=g8; sum2+=g8*g8; c++;}}
  const mean=sum/c, sd=Math.sqrt(sum2/c-mean*mean);
  console.log(`${f.padEnd(14)} trueBlack=${(100*trueBlack/N).toFixed(1)}% nearBlack=${(100*nearBlack/N).toFixed(1)}%  @8x gain: mean=${mean.toFixed(1)} sd=${sd.toFixed(1)}`);
}
