import path from "node:path";
import sharp from "sharp";
const root = "C:\\w\\rk3-face-v14d\\experiments\\koleda-v14d-face-shadow\\gate\\evidence\\hair-component-isolation-20260822";
function s2l(v){const c=v/255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);}
async function readRaw(p){const{data,info}=await sharp(p).raw().toBuffer({resolveWithObject:true});return{data,width:info.width,height:info.height};}
const [fin,pbr,toon]=await Promise.all([
  readRaw(path.join(root,"final","capture","authoritative-camera.all.raw-canvas.png")),
  readRaw(path.join(root,"pbr-only","capture","authoritative-camera.all.raw-canvas.png")),
  readRaw(path.join(root,"toon-only","capture","authoritative-camera.all.raw-canvas.png"))]);
const W=fin.width,H=fin.height,N=W*H;
const aligned=[]; const misaligned=[];
for(let i=0;i<N;i++){const o=i*4;const a=Math.max(fin.data[o+3],pbr.data[o+3],toon.data[o+3]);if(a<=8)continue;
  let dfp=0; for(let c=0;c<3;c++){const d=Math.abs(s2l(fin.data[o+c])-s2l(pbr.data[o+c]));if(d>dfp)dfp=d;}
  let closure=0; for(let c=0;c<3;c++){const f=s2l(fin.data[o+c]),p=s2l(pbr.data[o+c]),t=s2l(toon.data[o+c]);const cl=Math.abs(f-(0.62*p+0.38*t));if(cl>closure)closure=cl;}
  (dfp<0.03?aligned:misaligned).push(closure);
}
function q(arr,p){if(!arr.length)return 0;const s=[...arr].sort((x,y)=>x-y);return s[Math.floor(s.length*p)];}
function mx(arr){if(!arr.length)return 0;let m=0;for(const v of arr){if(v>m)m=v;}return m;}
function stats(label,arr){console.log(label+": n="+arr.length+" p50="+q(arr,0.5).toFixed(5)+" p90="+q(arr,0.9).toFixed(5)+" p99="+q(arr,0.99).toFixed(5)+" max="+mx(arr).toFixed(5));}
stats("对齐区(头发团块内部)",aligned);
stats("未对齐区(发丝/高光边缘)",misaligned);
const hairOnly=[]; const nonHair=[];
for(let i=0;i<N;i++){const o=i*4;const a=Math.max(fin.data[o+3],pbr.data[o+3],toon.data[o+3]);if(a<=8)continue;
  let dpt=0; for(let c=0;c<3;c++){const d=Math.abs(s2l(pbr.data[o+c])-s2l(toon.data[o+c]));if(d>dpt)dpt=d;}
  let closure=0; for(let c=0;c<3;c++){const f=s2l(fin.data[o+c]),p=s2l(pbr.data[o+c]),t=s2l(toon.data[o+c]);const cl=Math.abs(f-(0.62*p+0.38*t));if(cl>closure)closure=cl;}
  (dpt>0.02?hairOnly:nonHair).push(closure);
}
stats("头发有效像素(pbr!=toon)",hairOnly);
stats("非头发像素(pbr≈toon)",nonHair);
