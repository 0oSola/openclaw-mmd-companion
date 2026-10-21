import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const scriptRoot=path.dirname(fileURLToPath(import.meta.url));
const out=process.env.KOLEDA_OUTPUT_DIR?path.resolve(process.env.KOLEDA_OUTPUT_DIR):scriptRoot;
const require=createRequire(path.resolve(scriptRoot,'../../web/package.json'));
const {chromium}=require('playwright');
const ref=JSON.parse(fs.readFileSync(path.join(out,'web-reference.json'),'utf8'));
const assetRoot='D:/mmd/克莱妲原皮';
const pmx=process.env.KOLEDA_PMX||path.join(assetRoot,'GirlsFrontline KoledaDefault.pmx');
const vmd=process.env.KOLEDA_VMD||path.join(out,'Koleda_Entrance_HairCape_Trial.vmd');
const report={console:[],pageErrors:[],requests:[],failedRequests:[],samples:[],checks:{},mode:process.env.KOLEDA_PROBE_MODE||'normal'};
const shotDir=path.join(out,`runtime-${report.mode}`);fs.mkdirSync(shotDir,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-unsafe-webgpu']});
const page=await browser.newPage({viewport:{width:800,height:800}});
const deadline=setTimeout(()=>{report.timeout=true;browser.close();},290000);
try {
  page.on('console',m=>{if(['error','warning'].includes(m.type()))report.console.push({type:m.type(),text:m.text()});});
  page.on('pageerror',e=>report.pageErrors.push(String(e.stack||e)));
  page.on('requestfailed',r=>report.failedRequests.push({url:r.url(),error:r.failure()?.errorText}));
  await page.route('http://koleda-local.test/**',async route=>{
    const u=new URL(route.request().url());let rel=decodeURIComponent(u.pathname);let file;
    if(rel.endsWith('.pmx'))file=pmx;else if(rel.endsWith('.vmd'))file=vmd;else {rel=rel.startsWith('/model/')?rel.slice(7):rel.slice(1);file=path.resolve(assetRoot,rel);}
    if(!file.startsWith(path.resolve(assetRoot))&&!file.startsWith(out))throw new Error('资产越界');
    const ok=fs.existsSync(file)&&fs.statSync(file).isFile();report.requests.push({url:u.href,file,status:ok?200:404});
    await route.fulfill({status:ok?200:404,body:ok?fs.readFileSync(file):'missing',headers:{'access-control-allow-origin':'*'}});
  });
  const modelUrl='http://koleda-local.test/model/Koleda.pmx',vmdUrl='http://koleda-local.test/motion/Koleda.vmd';
  const camera={fov:33,position:[0,10,42],target:[0,10,0],locked:true};
  const url='http://127.0.0.1:3217/mmd-calibration-render?'+new URLSearchParams({modelUrl,vmdUrl,renderPipeline:'classic',camera:JSON.stringify(camera)});
  report.url=url;await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.__mmdCompanionRuntime?.model&&window.__mmdCompanionRuntime?.currentClip,{},{timeout:90000});
  report.initial=await page.evaluate(()=>{const r=window.__mmdCompanionRuntime;return {physics:r.hasPhysicsSupport,helperEnabled:r.helper.enabled,calibration:r.calibrationCaptureMode,boneCount:r.model.skeleton.bones.length,vertexCount:r.model.geometry.attributes.position.count,scale:r.model.scale.toArray(),position:r.model.position.toArray(),materials:r.model.material.map(m=>({name:m.name,visible:m.visible,map:!!m.map})),grant:!!r.helper.objects.get(r.model)?.grantSolver,ik:!!r.helper.objects.get(r.model)?.ikSolver};});
  if(report.mode==='no-physics')await page.evaluate(()=>{const r=window.__mmdCompanionRuntime;r.hasPhysicsSupport=false;r.helper.enable('physics',false);});
  report.checks.load=await page.evaluate(async u=>await window.__mmdCompanionRuntime.playVmd(u,1,[],{disableCrossfade:true}),vmdUrl);
  if(report.mode.startsWith('seek-cache'))await page.evaluate(()=>{const r=window.__mmdCompanionRuntime,m=r.getCurrentVmdMixer(),original=m.setTime.bind(m);m.setTime=t=>{original(t);r.helper._saveBones(r.model);return m;};});
  if(report.mode.includes('anchor'))await page.evaluate(()=>{window.__mmdCompanionRuntime.vmdAnchorBones=[];});
  if(report.mode.includes('noik'))await page.evaluate(()=>{window.__mmdCompanionRuntime.helper.enable('ik',false);});
  if(report.mode.includes('nogrant'))await page.evaluate(()=>{window.__mmdCompanionRuntime.helper.enable('grant',false);});
  report.trialSettings=await page.evaluate(()=>{const r=window.__mmdCompanionRuntime;return {anchors:r.vmdAnchorBones.map(b=>b.name),enabled:r.helper.enabled,physics:r.hasPhysicsSupport,clipDuration:r.currentClip.duration};});
  const playingStart=await page.evaluate(()=>window.__mmdCompanionRuntime.model.skeleton.bones.filter(b=>/(Hair|Cape|RC)/.test(b.name)).map(b=>[b.name,...b.quaternion.toArray()]));
  const t0=await page.evaluate(()=>window.__mmdCompanionRuntime.currentVmdAction.time);
  await page.waitForFunction(t=>window.__mmdCompanionRuntime.currentVmdAction.time>t+.3,t0,{timeout:10000});
  report.checks.play={before:t0,after:await page.evaluate(()=>window.__mmdCompanionRuntime.currentVmdAction.time)};
  const playingEnd=await page.evaluate(()=>window.__mmdCompanionRuntime.model.skeleton.bones.filter(b=>/(Hair|Cape|RC)/.test(b.name)).map(b=>[b.name,...b.quaternion.toArray()]));
  report.checks.liveHairCapeChanged=playingStart.filter((r,i)=>JSON.stringify(r)!==JSON.stringify(playingEnd[i])).map(r=>r[0]);
  report.checks.pause=await page.evaluate(async()=>{const r=window.__mmdCompanionRuntime,a=r.currentVmdAction;a.paused=true;const before=a.time;await new Promise(ok=>{let n=0;function tick(){if(++n>=12)ok();else requestAnimationFrame(tick);}requestAnimationFrame(tick);});return {before,after:a.time,stable:Math.abs(a.time-before)<1e-6};});
  report.restMapping=await page.evaluate(refRest=>{const p=window.__mmdCompanionRuntime.model.geometry.attributes.position;let max=0,maxVertex=-1;for(let i=0;i<p.count;i++){const q=refRest[i];const e=Math.hypot(p.getX(i)-q[0],p.getY(i)-q[1],p.getZ(i)-q[2]);if(e>max){max=e;maxVertex=i;}}return {max,maxVertex};},ref.rest);
  for(const frame of ref.frames){
    const sample=await page.evaluate(({frame,expected,regions,snap})=>{
      const r=window.__mmdCompanionRuntime;const seekOk=r.seekVmdFrame(snap?Math.fround(frame/30)*30:frame,30);const m=r.model;m.updateMatrixWorld(true);m.skeleton.update();const p=m.geometry.attributes.position,v=m.position.clone();let errors=[],max=0,maxVertex=-1;const actual=[];
      for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i);m.applyBoneTransform(i,v);actual.push(v.toArray());const e=v.distanceTo({x:expected[i][0],y:expected[i][1],z:expected[i][2]});errors.push(e);if(e>max){max=e;maxVertex=i;}}
      const stat=ids=>{const a=ids.map(i=>errors[i]).sort((a,b)=>a-b);return {rms:Math.sqrt(a.reduce((s,v)=>s+v*v,0)/a.length),p95:a[Math.floor(.95*(a.length-1))],max:a.at(-1)};};
      const bones=Object.fromEntries(m.skeleton.bones.map(b=>[b.name,{position:b.position.toArray(),quaternion:b.quaternion.toArray(),world:b.getWorldPosition(v).toArray()}]));
      return {frame,seekOk,time:r.currentVmdAction.time,max,maxVertex,regions:Object.fromEntries(Object.entries(regions).map(([k,ids])=>[k,stat(ids)])),bones,actual};
    },{frame,expected:ref.positions[frame],regions:ref.regions,snap:report.mode.includes('snap')});
    fs.writeFileSync(path.join(shotDir,`mesh-${frame}.json`),JSON.stringify(sample.actual));delete sample.actual;report.samples.push(sample);
  }
  const views={front:[0,0,52],left:[52,0,0],right:[-52,0,0],back:[0,0,-52]};
  if(process.env.KOLEDA_RENDER_GATE==='1'){
    const frames=await page.evaluate(()=>{const r=window.__mmdCompanionRuntime,m=r.model,v=m.position.clone(),rows=[];for(let f=0;f<119;f++){r.seekVmdFrame(Math.fround(f/30)*30,30);m.updateMatrixWorld(true);const joints={};for(const b of m.skeleton.bones){b.getWorldPosition(v);m.worldToLocal(v);const pmx=[v.x,v.y,-v.z];joints[b.name]=[pmx[0]*.9,pmx[1]*.9-9.738,-pmx[2]*.9+.697];}rows.push({index:f,joints});}return rows;});
    fs.writeFileSync(path.join(out,'runtime-joints-canonical-render.json'),JSON.stringify(frames));report.renderGateFrames=frames.length;report.renderGateCoordinates='真实舞台骨骼先逆模型matrixWorld回到模型坐标，再转为Gate既定0.9/-9.738/0.697渲染坐标约定；没有使用当前舞台世界坐标冒充固定约定';
  }
  for(const [name,pos] of Object.entries(process.env.KOLEDA_QUICK==='1'?{}:views)){
    await page.evaluate(({pos})=>{const r=window.__mmdCompanionRuntime;r.applyCameraSnapshot({fov:33,position:pos,target:[0,0,0],locked:true});r.seekVmdFrame(Math.fround(83/30)*30,30);r.renderScene();},{pos});
    await page.screenshot({path:path.join(shotDir,`${name}-083.png`)});
    for(let frame=0;frame<=117;frame+=6){await page.evaluate(frame=>{const r=window.__mmdCompanionRuntime;r.seekVmdFrame(Math.fround(frame/30)*30,30);r.renderScene();},frame);await page.screenshot({path:path.join(shotDir,`${name}-${String(frame).padStart(3,'0')}.png`)});}
  }
  report.checks.seek=report.samples.every(s=>s.seekOk&&Math.abs(s.time-s.frame/30)<.01);
  const a=report.samples[0].bones,b=report.samples.find(s=>s.frame===83).bones;report.checks.hairCapeChanged=Object.keys(a).filter(n=>/(Hair|Cape|Cloth_|RC)/.test(n)&&b[n]&&JSON.stringify(a[n].quaternion)!==JSON.stringify(b[n].quaternion));
}catch(e){report.error=String(e.stack||e);}finally{clearTimeout(deadline);await browser.close();fs.writeFileSync(path.join(out,`runtime-${report.mode}-report.json`),JSON.stringify(report,null,2));}
console.log(JSON.stringify({checks:report.checks,error:report.error,initial:report.initial,restMapping:report.restMapping,samples:report.samples.map(({frame,max,maxVertex,regions})=>({frame,max,maxVertex,regions})),pageErrors:report.pageErrors},null,2));
if(report.error||!report.checks.load||!report.checks.pause?.stable||!report.checks.seek||!report.checks.hairCapeChanged?.length||!report.checks.liveHairCapeChanged?.length)process.exitCode=1;
