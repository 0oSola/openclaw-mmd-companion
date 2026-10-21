// 依据捕获帧的实际输入网格，保存当前 PMX 顶点身份对应的单帧对照数据。
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import * as T from '../../web/node_modules/three/build/three.module.js';
import {Parser} from '../../web/node_modules/three-stdlib/libs/mmdparser.js';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,all)=>i%2?a:[...a,[v.replace(/^--/,''),all[i+1]]],[]));
if(!args.capture||!args.frame||!args.pmx||!args.pose||!args.output)throw new Error('需要 --capture --frame --pmx --pose --output，补充布局使用 --extra');
const capture=path.resolve(args.capture),frame=path.resolve(args.frame),output=path.resolve(args.output);
fs.mkdirSync(output,{recursive:true});
const binary=fs.readFileSync(args.pmx),pmx=new Parser().parsePmx(binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength),true);
const poseBuffer=fs.readFileSync(args.pose),pose=new Float32Array(poseBuffer.buffer.slice(poseBuffer.byteOffset,poseBuffer.byteOffset+poseBuffer.byteLength));
const manifest=JSON.parse(fs.readFileSync(path.join(frame,'frame.json'))),draws=new Map(manifest.draws.map(d=>[d.eventId,d]));
const layouts=new Map();for(const dir of [path.join(capture,'capture-assets'),...(args.extra?[path.resolve(args.extra)]:[])])for(const l of JSON.parse(fs.readFileSync(path.join(dir,'input-layouts.json'))))layouts.set(l.eventId,{...l,dir});
const drawByMaterial={Face:2500,UpperTeeth:2500,LowerTeeth:2500,Tongue:2500,EyeWhite:2500,Brows:2510,Lashes:2510,Eyes:2539,'Eyes+':2625,EyeShadow:2648,BodySkin:2483,FingerNails:2319,'Cth1-Top':2469,'Cth1-Glove':2469,'Cth1-Cape':3356,'Cth1-Cape2':3368,'Cth2-Shoes':2459,'Cth2-Pants':2459,'Cth2-Pouch':2459,'Cth3-Mask':2447,'Cth4-Glove':2435,'Cth5-ShoesZip':2402,Glock:2389,GunSilencer:2419,HairA:2578,HairB:2589};
const half=x=>{const h=T.DataUtils.toHalfFloat(x),a=T.DataUtils.fromHalfFloat(h),b=T.DataUtils.fromHalfFloat(h+1),da=Math.abs(x-a),db=Math.abs(x-b);return db<da||(db===da&&(h&1))?h+1:h;};
const key=uv=>half(uv[0])+','+half(uv[1]),sources=new Map(),staticVertices=new Map(),staticNormals=new Map();
if(args.static){const aliases={2319:2483,3356:2469,3368:2469,2589:2578};for(const row of JSON.parse(fs.readFileSync(path.join(args.static,'report.json')))){if(!row.captureUvIndexIdentity)throw new Error('静止源网格与本次捕获顶点顺序不同');const raw=fs.readFileSync(path.join(args.static,row.file)),v=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));staticVertices.set(row.eventId,v);if(args.normals==='true'){const b=fs.readFileSync(path.join(args.static,row.eventId+'-normals.bin'));staticNormals.set(row.eventId,new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)));}}for(const [dst,src]of Object.entries(aliases)){staticVertices.set(+dst,staticVertices.get(src));staticNormals.set(+dst,staticNormals.get(src));}}
const readFloat=(file)=>{const b=fs.readFileSync(file);return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
function source(eid){
 if(sources.has(eid))return sources.get(eid);
 const layout=layouts.get(eid),d=draws.get(eid),buffers=new Map(layout.buffers.map(b=>[b.slot,{...b,raw:fs.readFileSync(path.join(layout.dir,b.file))}]));
 const read=(name,index,v)=>{const a=layout.attributes.find(x=>x.semantic===name&&x.semanticIndex===index),b=buffers.get(a.slot),offset=v*b.stride+a.offset;
  if(a.format==='R8G8B8A8_UNORM')return Array.from(b.raw.subarray(offset,offset+4),v=>v/255);
  const size={R16G16_FLOAT:2,R32G32_FLOAT:2,R32G32B32_FLOAT:3,R32G32B32A32_FLOAT:4}[a.format];
  if(!size)throw new Error(a.format);return Array.from({length:size},(_,i)=>a.format==='R16G16_FLOAT'?T.DataUtils.fromHalfFloat(b.raw.readUInt16LE(offset+i*2)):b.raw.readFloatLE(offset+i*4));};
 const raw=fs.readFileSync(path.join(layout.dir,layout.indexBuffer.file)),indices=[];
 for(let i=layout.indexOffset;i<layout.indexOffset+layout.count;i++)indices.push((layout.indexBuffer.stride===2?raw.readUInt16LE(i*2):raw.readUInt32LE(i*4))+layout.baseVertex);
 const cb=readFloat(path.join(frame,d.vertexBlocks.find(b=>b.slot===1).file)),matrix=new T.Matrix4().fromArray(cb),normalMatrix=new T.Matrix3().getNormalMatrix(matrix),direction=new T.Matrix3().setFromMatrix4(matrix);
 const vertices=new Map(),lookup=new Map();
 for(const i of new Set(indices)){
  const uv=read('TEXCOORD',0,i),uv1=read('TEXCOORD',1,i),color=read('COLOR',0,i),p=new T.Vector3().fromArray(read('POSITION',0,i)).applyMatrix4(matrix),n=new T.Vector3().fromArray(read('NORMAL',0,i)).applyMatrix3(normalMatrix).normalize(),t=read('TANGENT',0,i),tangent=new T.Vector3().fromArray(t).applyMatrix3(direction).normalize();
  const v={index:i,uv,uv1:uv1.slice(0,2),color,p:p.toArray(),n:n.toArray(),t:[...tangent.toArray(),t[3]]};vertices.set(i,v);
  const k=key(uv);if(!lookup.has(k))lookup.set(k,[]);lookup.get(k).push(v);
 }
 const triangleKeys=new Set(),trianglePositions=new Set();
 for(const v of vertices.values())v.positionKey=v.p.map(x=>Math.round(x*1e6)).join(',');
 for(let i=0;i<indices.length;i+=3){triangleKeys.add(indices.slice(i,i+3).map(v=>key(vertices.get(v).uv)).sort().join('|'));trianglePositions.add(indices.slice(i,i+3).map(v=>vertices.get(v).positionKey).sort().join('|'));}
 for(const v of vertices.values())v.eventId=eid;
 const bind=staticVertices.get(eid),positionLookup=new Map();
 if(bind)for(const v of vertices.values()){const cell=[0,1,2].map(j=>Math.floor(bind[v.index*3+j]*1000)).join(',');if(!positionLookup.has(cell))positionLookup.set(cell,[]);positionLookup.get(cell).push(v);}
 const result={vertices,lookup,indices,triangleKeys,trianglePositions,positionLookup,matrix:matrix.elements,headInverse:Array.from(cb.slice(16,32))};sources.set(eid,result);return result;
}
const count=pmx.vertices.length,stride=19,packed=new Float32Array(count*stride),rows=[],mapping=[],parts=[];let faceOffset=0;
for(const material of pmx.materials){
 const triangles=pmx.faces.slice(faceOffset,faceOffset+material.faceCount);faceOffset+=material.faceCount;
 const ids=[...new Set(triangles.flatMap(t=>t.indices))],eid=drawByMaterial[material.name],row={material:material.name,eventId:eid??null,vertices:ids.length,exactUv:0,nearestUv:0,unmapped:0,ambiguous:0,maxUvDistance:0};
 if(!eid){row.unmapped=ids.length;rows.push(row);continue;}
 const sourceIds=material.name.startsWith('Cth1-Cape')?[eid,2469]:[eid],src=source(eid),selected=new Map();
 for(const i of ids){
  const uv=[pmx.vertices[i].uv[0],1-pmx.vertices[i].uv[1]];let candidates=sourceIds.flatMap(id=>source(id).lookup.get(key(uv))||[]),uvDistance=0;
  const bp=pmx.vertices[i].position,bindPosition=[bp[0]*.08,bp[1]*.08,-bp[2]*.08],cell=bindPosition.map(x=>Math.floor(x*1000)),spatial=[];
  for(const id of sourceIds)if(staticVertices.has(id))for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const v of source(id).positionLookup.get([cell[0]+x,cell[1]+y,cell[2]+z].join(','))||[])if(Math.hypot(v.uv[0]-uv[0],v.uv[1]-uv[1])<.002)spatial.push(v);
  if(spatial.length)candidates=spatial;
  if(!candidates.length)candidates=undefined;
  if(!candidates){let min=Infinity;for(const v of src.vertices.values()){const dist=(v.uv[0]-uv[0])**2+(v.uv[1]-uv[1])**2;if(dist<min){min=dist;candidates=[v];}else if(dist===min)candidates.push(v);}uvDistance=Math.sqrt(min);if(uvDistance>.002){row.unmapped++;mapping.push({vertex:i,eventId:eid,source:null,uvDistance});continue;}row.nearestUv++;}else row.exactUv++;
  row.maxUvDistance=Math.max(row.maxUvDistance,uvDistance);if(candidates.length>1)row.ambiguous++;
  const target=[pose[i*3],pose[i*3+1],-pose[i*3+2]];
  const score=v=>{
   const bind=staticVertices.get(v.eventId);
   if(bind){const p=pmx.vertices[i].position,expected=[p[0]*.08,p[1]*.08,-p[2]*.08];return -expected.reduce((s,x,j)=>s+(bind[v.index*3+j]-x)**2,0);}
   return -v.p.reduce((s,p,j)=>s+(p-target[j])**2,0);
  };
  candidates.sort((a,b)=>{
   const delta=score(b)-score(a);if(Math.abs(delta)>1e-12)return delta;
   const normal=pmx.vertices[i].normal,expected=[normal[0],normal[1],-normal[2]],error=v=>{const n=staticNormals.get(v.eventId);return n?1-expected.reduce((s,x,j)=>s+x*n[v.index*3+j],0):0;};
   const nd=error(a)-error(b);if(Math.abs(nd)>1e-5)return nd;
   return (a.uv[0]-uv[0])**2+(a.uv[1]-uv[1])**2-(b.uv[0]-uv[0])**2-(b.uv[1]-uv[1])**2;
  });const v=candidates[0];uvDistance=Math.hypot(v.uv[0]-uv[0],v.uv[1]-uv[1]);packed.set([...v.p,...v.n,...v.t,...v.color,...v.uv,...v.uv1,1],i*stride);selected.set(i,v);mapping.push({vertex:i,eventId:v.eventId,source:v.index,uvDistance,staticDistance:staticVertices.has(v.eventId)?Math.sqrt(-score(v)):null});
 }
 const partitions=new Map();
 for(const tri of triangles){
  const signature=tri.indices.map(i=>key([pmx.vertices[i].uv[0],1-pmx.vertices[i].uv[1]])).sort().join('|');
  let eventId=sourceIds.find(id=>source(id).triangleKeys.has(signature));
  if(!eventId){const votes=tri.indices.map(i=>selected.get(i)?.eventId||eid);eventId=votes.find(x=>votes.filter(v=>v===x).length>=2)||eid;}
  if(!partitions.has(eventId))partitions.set(eventId,[]);partitions.get(eventId).push(...tri.indices);
 }
 row.parts=[...partitions].map(([eventId,indices])=>({eventId,triangles:indices.length/3}));row.faceCount=material.faceCount;row.flags=material.flag;
 row.exactUv=0;row.nearestUv=0;row.maxUvDistance=0;
 for(const [i,v]of selected){const uv=[pmx.vertices[i].uv[0],1-pmx.vertices[i].uv[1]];if(key(uv)===key(v.uv))row.exactUv++;else row.nearestUv++;row.maxUvDistance=Math.max(row.maxUvDistance,Math.hypot(v.uv[0]-uv[0],v.uv[1]-uv[1]));}
 row.sourceTriangleMatches=triangles.filter(t=>sourceIds.some(id=>source(id).trianglePositions.has(t.indices.map(i=>selected.get(i)?.positionKey||'missing').sort().join('|')))).length;
 for(const [eventId,indices]of partitions)parts.push({material:material.name,eventId,indices});
 if(row.unmapped){
  row.alternateUvMatches={};
  for(const item of mapping.filter(x=>x.eventId===eid&&x.source===null)){
   const uv=[pmx.vertices[item.vertex].uv[0],1-pmx.vertices[item.vertex].uv[1]];
   for(const alternate of new Set(Object.values(drawByMaterial)))if(alternate!==eid&&source(alternate).lookup.has(key(uv)))row.alternateUvMatches[alternate]=(row.alternateUvMatches[alternate]||0)+1;
  }
 }
 rows.push(row);
}
const report={sourceFrame:manifest.frame,pmxSha256:createHash('sha256').update(binary).digest('hex'),vertexCount:count,strideFloats:stride,file:'pmx-reference.bin',headInverse:source(2500).headInverse,materials:rows,source:'原帧输入网格按材质、静止位置、法线与UV对应；未有静止数据的面部按UV及当前姿态位置对应。仅用于单帧校准，不是VMD骨骼动作'};
fs.writeFileSync(path.join(output,report.file),Buffer.from(packed.buffer));fs.writeFileSync(path.join(output,'pmx-reference.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(output,'pmx-reference-mapping.json'),JSON.stringify(mapping));fs.writeFileSync(path.join(output,'pmx-reference-parts.json'),JSON.stringify(parts));
fs.writeFileSync(path.join(output,'pmx-bind.json'),JSON.stringify({vertices:pmx.vertices.map(v=>({position:[v.position[0]*.08,v.position[1]*.08,-v.position[2]*.08],uv:[v.uv[0],1-v.uv[1]]})),parts}));
console.log(JSON.stringify({vertexCount:count,materials:rows}));
