import sharp from 'sharp';
const f = process.argv[2] || '04-footsies';
const { data, info } = await sharp(`fight-shots/${f}.png`).raw().toBuffer({ resolveWithObject: true });
const W=info.width,H=info.height,C=info.channels;
const out = Buffer.alloc(W*H*3);
for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const o=(y*W+x)*C, q=(y*W+x)*3;
  const l=0.2126*data[o]+0.7152*data[o+1]+0.0722*data[o+2];
  if(l<8){ out[q]=255; out[q+1]=0; out[q+2]=255; }        // true black -> magenta
  else if(l<16){ out[q]=0; out[q+1]=255; out[q+2]=255; }  // near black -> cyan
  else { const g=Math.min(255,l*1.6); out[q]=g; out[q+1]=g; out[q+2]=g; }
}
await sharp(out,{raw:{width:W,height:H,channels:3}}).png().toFile(`fight-shots/_mask-${f}.png`);
console.log('wrote', `fight-shots/_mask-${f}.png`);
