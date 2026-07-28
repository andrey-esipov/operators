import sharp from 'sharp';
const f = process.argv[2] || '04-footsies';
const { data, info } = await sharp(`fight-shots/${f}.png`).raw().toBuffer({ resolveWithObject: true });
const W=info.width,H=info.height,C=info.channels;
console.log(`${f}  ${W}x${H}`);
const lum=(x,y)=>{const o=(y*W+x)*C;return 0.2126*data[o]+0.7152*data[o+1]+0.0722*data[o+2];};
// row profile
const rows=[]; for(let y=0;y<H;y++){let c=0;for(let x=0;x<W;x+=2) if(lum(x,y)<8)c++; rows.push(c/(W/2));}
// column profile
const cols=[]; for(let x=0;x<W;x++){let c=0;for(let y=0;y<H;y+=2) if(lum(x,y)<8)c++; cols.push(c/(H/2));}
const spans=(arr,thr,min)=>{const out=[];let s=null;for(let i=0;i<arr.length;i++){if(arr[i]>thr){if(s===null)s=i;}else{if(s!==null&&i-s>=min)out.push([s,i]);s=null;}}if(s!==null&&arr.length-s>=min)out.push([s,arr.length]);return out;};
console.log('ROW bands >85% black:', spans(rows,0.85,6).map(([a,b])=>`y${a}-${b} (${b-a}px, ${(100*(b-a)/H).toFixed(1)}% of height)`).join('  ')||'none');
console.log('COL bands >85% black:', spans(cols,0.85,10).map(([a,b])=>`x${a}-${b} (${b-a}px, ${(100*(b-a)/W).toFixed(1)}% of width)`).join('  ')||'none');
console.log('COL bands >60% black:', spans(cols,0.60,10).map(([a,b])=>`x${a}-${b} (${b-a}px)`).join('  ')||'none');
