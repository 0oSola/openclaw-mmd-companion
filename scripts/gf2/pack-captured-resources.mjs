// 将实际人物依赖按原字节打包；文件内容摘要作为浏览器缓存版本。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { getGf2ResourceInputs } from '../../web/src/features/stage/gf2CapturedResourcePlan.js';

const root=path.resolve(process.argv[2] || 'output/gf2-barrack-materials/frame');
const readJson=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const inputs=getGf2ResourceInputs(readJson('frame.json'),readJson('pmx-reference.json'));
const files={},packs=[];let parts=[],size=0,total=0;
const limit=4*1024*1024;
function flush(){
 if(!parts.length)return;
 const raw=Buffer.concat(parts),bytes=gzipSync(raw,{level:6});
 const hash=createHash('sha256').update(bytes).digest('hex');
 const name=`pack-${hash}.bin.gz`,target=path.join(root,name);
 if(!fs.existsSync(target))fs.writeFileSync(target,bytes);
 packs.push({file:name,bytes:bytes.length,rawBytes:raw.length});
 parts=[];size=0;
}
for(const [name,type] of inputs){
 const bytes=fs.readFileSync(path.join(root,name));
 files[name]={offset:total,length:bytes.length,type};total+=bytes.length;
 let offset=0;
 while(offset<bytes.length){
  const length=Math.min(limit-size,bytes.length-offset);
  parts.push(bytes.subarray(offset,offset+length));size+=length;offset+=length;
  if(size===limit)flush();
 }
}
flush();
const manifest={version:2,chunkBytes:limit,packs,files};
const target=path.join(root,'resource-packs.json'),text=JSON.stringify(manifest);
if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==text){fs.writeFileSync(target+'.tmp',text);fs.renameSync(target+'.tmp',target);}
console.log(JSON.stringify({root,files:inputs.length,packs:packs.length,rawBytes:packs.reduce((n,p)=>n+p.rawBytes,0),transferBytes:packs.reduce((n,p)=>n+p.bytes,0)},null,2));
