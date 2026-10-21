// HTTP端到端：启动真实Next路由和可控上游，不写用户配置或数据库。
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(process.argv[2] || path.join(web,'../output/backend-proxy-'+Date.now()));
fs.mkdirSync(output,{recursive:true});
const source=path.join(web,'src/app/api/backend/[...path]/route.ts');
const digest=()=>createHash('sha256').update(fs.readFileSync(source)).digest('hex');
const report={started:new Date().toISOString(),timezone:'Asia/Shanghai',command:process.argv,cwd:process.cwd(),sourceBefore:digest(),checks:[],errors:[]};
const generated=['next-env.d.ts','tsconfig.json'].map(name=>({file:path.join(web,name),before:fs.readFileSync(path.join(web,name))}));
const payload=Buffer.from('资源正文验证✓'.repeat(500));
const controls=new Map(); let child, closing;
const upstream=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/stream'){
  const key=url.searchParams.get('key');
  const state={closed:false,ended:false}; controls.set(key,state);
  res.writeHead(200,{'content-type':'application/octet-stream','cache-control':'no-store'});
  res.write(payload);
  const timer=setTimeout(()=>{state.ended=true;res.end(payload);},1500);
  res.on('close',()=>{state.closed=true;clearTimeout(timer);});return;
 }
 if(url.pathname==='/broken'){res.writeHead(200);res.write(payload);setTimeout(()=>res.destroy(),50);return;}
 if(url.pathname==='/conditional' && req.headers['if-none-match']==='"version-1"'){res.writeHead(304,{etag:'"version-1"'});res.end();return;}
 if(url.pathname==='/empty'){res.writeHead(204);res.end();return;}
 if(url.pathname==='/gzip'){const zipped=gzipSync(payload);res.writeHead(200,{'content-encoding':'gzip','content-length':zipped.length});res.end(zipped);return;}
 if(url.pathname==='/echo'){
  const parts=[];for await(const part of req)parts.push(part);
  res.setHeader('content-type','application/json');res.end(JSON.stringify({method:req.method,body:Buffer.concat(parts).toString(),headers:req.headers,search:url.search}));return;
 }
 if(url.pathname==='/missing'){res.writeHead(404,{'content-type':'application/json'});res.end('{"detail":"不存在"}');return;}
 if(req.headers.range==='bytes=2-8' && req.headers['if-range']==='"version-1"'){
  res.writeHead(206,{'content-range':`bytes 2-8/${payload.length}`,'accept-ranges':'bytes','content-length':7});res.end(payload.subarray(2,9));return;
 }
 res.writeHead(200,{'content-type':'application/octet-stream','content-length':payload.length,etag:'"version-1"','cache-control':'private, no-cache'});res.end(req.method==='HEAD'?undefined:payload);
});
const base='http://127.0.0.1:13118/api/backend';
const request=(pathname,init={})=>fetch(base+pathname,{...init,signal:init.signal||AbortSignal.timeout(15000)});
async function check(name,fn){try{const details=await fn();report.checks.push({name,...details});console.log('PASS',name);}catch(error){report.errors.push({name,error:String(error)});console.log('FAIL',name,String(error));}}
async function cleanup(){if(closing)return closing;closing=(async()=>{
 if(child?.exitCode===null){report.stop=spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:15000}).status;}
 upstream.closeAllConnections();await new Promise(r=>upstream.close(r));
 for(const item of generated)if(item.after && fs.readFileSync(item.file).equals(item.after))fs.writeFileSync(item.file,item.before);
 report.sourceAfter=digest();assert.equal(report.sourceBefore,report.sourceAfter);
 report.ended=new Date().toISOString();report.status=report.errors.length?'failed':'passed';fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2));
 })();return closing;}
const watchdog=setTimeout(()=>{report.errors.push({error:'180秒超时'});void cleanup().then(()=>process.exit(1));},180000);
try{
 await new Promise((resolve,reject)=>upstream.once('error',reject).listen(18118,'127.0.0.1',resolve));
 child=spawn(process.execPath,[path.join(web,'node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port','13118'],{cwd:web,env:{...process.env,NEXT_PUBLIC_API_BASE_URL:'http://127.0.0.1:18118',NEXT_DIST_DIR:'.scratch/backend-proxy-next'},windowsHide:true,stdio:['ignore','pipe','pipe']});
 const log=fs.createWriteStream(path.join(output,'next.log'));child.stdout.pipe(log);child.stderr.pipe(log);report.process={pid:child.pid,args:child.spawnargs};
 let ready=false;for(let i=0;i<80;i++){try{const r=await request('/warm');await r.arrayBuffer();if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready);
 for(const item of generated)item.after=fs.readFileSync(item.file);
 await check('首块在上游结束前可读',async()=>{const start=performance.now();const r=await request('/stream?key=delivery');const reader=r.body.getReader();const first=await reader.read();const firstMs=performance.now()-start;const endedAtFirst=controls.get('delivery').ended;const chunks=[first.value];for(;;){const x=await reader.read();if(x.done)break;chunks.push(x.value);}assert.deepEqual(Buffer.concat(chunks),Buffer.concat([payload,payload]));assert.equal(endedAtFirst,false);return{firstMs,totalMs:performance.now()-start};});
 await check('完整字节及响应头',async()=>{const r=await request('/file');assert.deepEqual(Buffer.from(await r.arrayBuffer()),payload);assert.equal(r.headers.get('content-length'),String(payload.length));assert.equal(r.headers.get('etag'),'"version-1"');assert.equal(r.headers.get('cache-control'),'private, no-cache');});
 await check('Range及If-Range',async()=>{const r=await request('/file',{headers:{range:'bytes=2-8','if-range':'"version-1"'}});assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),`bytes 2-8/${payload.length}`);assert.deepEqual(Buffer.from(await r.arrayBuffer()),payload.subarray(2,9));});
 await check('条件请求304无正文',async()=>{const r=await request('/conditional',{headers:{'if-none-match':'"version-1"'}});assert.equal(r.status,304);assert.equal((await r.arrayBuffer()).byteLength,0);});
 await check('HEAD及204无正文',async()=>{const h=await request('/file',{method:'HEAD'});assert.equal(h.status,200);assert.equal((await h.arrayBuffer()).byteLength,0);const r=await request('/empty');assert.equal(r.status,204);assert.equal((await r.arrayBuffer()).byteLength,0);});
 await check('JSON写入及鉴权查询透传',async()=>{for(const method of ['POST','PUT','PATCH','DELETE']){const body=JSON.stringify({value:'配置✓'});const r=await request('/echo?name=%E6%B5%8B%E8%AF%95',{method,body,headers:{'content-type':'application/json',authorization:'Bearer synthetic-test','x-user-id':'test-user','x-trace-id':'test-trace'}});const data=await r.json();assert.equal(data.method,method);assert.equal(data.body,body);assert.equal(data.headers.authorization,'Bearer synthetic-test');assert.equal(data.headers['x-user-id'],'test-user');assert.equal(data.headers['x-trace-id'],'test-trace');assert.equal(data.search,'?name=%E6%B5%8B%E8%AF%95');}});
 await check('非JSON上传保持原字节',async()=>{const r=await request('/echo',{method:'POST',body:payload,headers:{'content-type':'application/octet-stream'}});assert.equal((await r.json()).body,payload.toString());});
 await check('压缩上游不重复解压',async()=>{const r=await request('/gzip');assert.equal(r.headers.get('content-encoding'),null);assert.deepEqual(Buffer.from(await r.arrayBuffer()),payload);});
 await check('404错误正文保持',async()=>{const r=await request('/missing');assert.equal(r.status,404);assert.deepEqual(await r.json(),{detail:'不存在'});});
 await check('消费方取消及后续恢复',async()=>{const controller=new AbortController();const r=await request('/stream?key=cancel',{signal:controller.signal});const reader=r.body.getReader();await reader.read();controller.abort();await reader.cancel().catch(()=>{});await new Promise(r=>setTimeout(r,200));assert.equal(controls.get('cancel').closed,true);assert.equal(controls.get('cancel').ended,false);const good=await request('/file');assert.deepEqual(Buffer.from(await good.arrayBuffer()),payload);});
 await check('上游中断不能变为完整成功',async()=>{let failed=false;try{const r=await request('/broken');await r.arrayBuffer();failed=!r.ok;}catch{failed=true;}assert.equal(failed,true);const r=await request('/file');assert.deepEqual(Buffer.from(await r.arrayBuffer()),payload);});
}catch(error){report.errors.push({error:String(error)});}finally{clearTimeout(watchdog);await cleanup();if(report.errors.length)process.exitCode=1;console.log(output);}
