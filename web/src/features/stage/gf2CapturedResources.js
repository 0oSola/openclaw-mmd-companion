// 这里只复用源字节；可变常量和 GPU 对象仍由每个渲染实例独立建立。
export async function loadGf2CapturedResources(base,fetchImpl,onProgress,timings){
 const begin=performance.now();
 const response=await fetchImpl(new URL('resource-packs.json',base));
 if(!response.ok)throw new Error(`抓帧资源 resource-packs.json 返回 ${response.status}`);
 const manifest=await response.json();
 if(manifest.version!==2)throw new Error('抓帧资源包版本不支持，请重新生成资源包');
 timings.manifestMs=performance.now()-begin;
 const packs=new Array(manifest.packs.length);let next=0,loaded=0;
 onProgress?.({loaded,total:packs.length,unit:'资源包'});
 timings.downloadMs=0;timings.unpackMs=0;
 await Promise.all(Array.from({length:Math.min(3,packs.length)},async()=>{
  while(next<packs.length){
   const index=next++,item=manifest.packs[index],start=performance.now();
   const response=await fetchImpl(new URL(item.file,base));
   if(!response.ok)throw new Error(`抓帧资源 ${item.file} 返回 ${response.status}`);
   const compressed=await response.arrayBuffer(),received=performance.now();
   const bytes=await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
   if(bytes.byteLength!==item.rawBytes)throw new Error(`抓帧资源 ${item.file} 长度不符`);
   timings.downloadMs+=received-start;timings.unpackMs+=performance.now()-received;
   packs[index]=bytes;loaded++;onProgress?.({loaded,total:packs.length,unit:'资源包'});
  }
 }));
 timings.resourcesMs=performance.now()-begin;
 timings.resourceCount=Object.keys(manifest.files).length;timings.requestCount=packs.length+1;
 timings.transferBytes=manifest.packs.reduce((n,p)=>n+p.bytes,0);
 const decoder=new TextDecoder();
 return async(name,type='arrayBuffer')=>{
  const item=manifest.files[name];
  if(!item)throw new Error(`抓帧资源包缺少 ${name}，请重新生成资源包`);
  const bytes=new ArrayBuffer(item.length),view=new Uint8Array(bytes);
  let offset=item.offset,written=0;
  while(written<item.length){
   const index=Math.floor(offset/manifest.chunkBytes),start=offset%manifest.chunkBytes;
   const count=Math.min(item.length-written,packs[index].byteLength-start);
   view.set(new Uint8Array(packs[index],start,count),written);offset+=count;written+=count;
  }
  if(type==='arrayBuffer')return bytes;
  const text=decoder.decode(bytes);return type==='json'?JSON.parse(text):text;
 };
}
