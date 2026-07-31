function OLD(c,{contrast,black,blackPoint}){
  c=Math.max(c-blackPoint,0)/Math.max(1-blackPoint,1e-3);
  const t=1+black*3*(1-Math.min(Math.max(c,0),1)); c=Math.pow(Math.max(c,0),t);
  c=c/(1+Math.max(c-0.56,0)); return Math.min(Math.max(0.5+(c-0.5)*contrast,0),1);
}
function NEW(c,{contrast,black,blackPoint}){
  const bp=(c-blackPoint)/Math.max(1-blackPoint,1e-3);
  const knee=Math.max(blackPoint*0.5,0.004);
  c=Math.max(0.5*(bp+Math.sqrt(bp*bp+knee*knee))-knee*0.5,0);
  const t=1+black*3*(1-Math.min(Math.max(c,0),1)); c=Math.pow(Math.max(c,1e-5),t);
  c=c/(1+Math.max(c-0.56,0));
  const lo=Math.pow(Math.min(Math.max(c,1e-5),1),contrast), hi=Math.pow(Math.min(Math.max(1-c,1e-5),1),contrast);
  return Math.min(Math.max(lo/Math.max(lo+hi,1e-5),0),1);
}
const gs={'default':{contrast:1.0,black:0.05,blackPoint:0.03},
          'fighting-game':{contrast:1.2,black:0.15,blackPoint:0.095},
          'ipo-prep':{contrast:1.05,black:0.09,blackPoint:0.055}};
for(const[n,g]of Object.entries(gs)){
  const cut=f=>{for(let i=0;i<=20000;i++){const x=i/20000; if(f(x,g)*255>8)return x;}return 1;};
  const S=f=>[0.05,0.10,0.15,0.20,0.25,0.30,0.5,0.75,1.0].map(x=>(f(x,g)*255).toFixed(0).padStart(3)).join(' ');
  console.log(`${n}`);
  console.log(`  OLD <8/255 below ${(cut(OLD)*100).toFixed(1).padStart(5)}%   ${S(OLD)}`);
  console.log(`  NEW <8/255 below ${(cut(NEW)*100).toFixed(1).padStart(5)}%   ${S(NEW)}`);
}
