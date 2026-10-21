import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {chromium,expect} from '@playwright/test';
import sharp from 'sharp';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=path.resolve(process.argv[2]);fs.mkdirSync(output,{recursive:true});
const base=process.argv[3]||'http://127.0.0.1:18748/';
const require=createRequire(import.meta.url),pwRoot=path.dirname(require.resolve('playwright-core/package.json'));
const registry=require(path.join(pwRoot,'lib/server/registry/index.js')).registry;
const report={started:new Date().toISOString(),timezone:'Asia/Shanghai',command:process.argv,base,checks:[],errors:[],consoleErrors:[],authenticationEvents:'未核查',lockScreen:'无本轮锁屏证据',sources:{},screenshots:[]};
for(const file of ['web/src/features/stage/gf2CharacterMaterials.js','web/src/features/stage/gf2CapturedMaterials.js','web/src/features/stage/gf2CapturedResourcePlan.js','web/src/features/stage/gf2CapturedResources.js','scripts/gf2/serve-preview.py','scripts/gf2/pack-captured-resources.mjs','web/previews/gf2/preview.js','web/previews/gf2/index.html','web/previews/gf2/preview.css'])report.sources[file]=createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
let browser,page,closing;
async function close(){if(closing)return closing;closing=(async()=>{await browser?.close();report.ended=new Date().toISOString();fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2));})();return closing;}
const timeout=setTimeout(()=>{report.errors.push('浏览器检查超过180秒');void close().finally(()=>process.exit(1));},180000);
const check=(name,data={})=>{report.checks.push({name,...data});console.log('CHECK',name);};
async function snap(name){
  expect(await page.evaluate(()=>window.gf2Preview.renderer.getContext().isContextLost())).toBe(false);
  const file=path.join(output,name+'.png');await page.locator('#viewer').screenshot({path:file});report.screenshots.push(file);return file;
}
async function pixels(file){return sharp(file).removeAlpha().raw().toBuffer({resolveWithObject:true});}
async function difference(a,b){const x=await pixels(a),y=await pixels(b);expect(x.info).toEqual(y.info);let count=0;for(let i=0;i<x.data.length;i+=3)if(Math.abs(x.data[i]-y.data[i])+Math.abs(x.data[i+1]-y.data[i+1])+Math.abs(x.data[i+2]-y.data[i+2])>20)count++;return count;}
async function checkComparison(){
 const comparison=await browser.newPage({viewport:{width:1440,height:1000}});await comparison.goto(new URL('pmx-comparison.html',base).href);
 await expect(comparison.locator('#metrics')).toContainText('6.853');await comparison.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));
 await comparison.getByRole('button',{name:'完整角色',exact:true}).click();await comparison.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalHeight>1000));
 await comparison.setViewportSize({width:430,height:930});expect(await comparison.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await comparison.close();check('首页接通PMX同姿态对照，近景/全身和窄屏可用');
}
async function shadows(label){
 const images=await page.evaluate(async()=>{
  const T=await import('/vendor/three/build/three.module.js'),r=gf2Preview.renderer,previous=r.getRenderTarget(),out=[];
  const target=new T.WebGLRenderTarget(512,512,{depthBuffer:false});const geometry=new T.PlaneGeometry(2,2),scene=new T.Scene(),camera=new T.Camera();
  const material=new T.ShaderMaterial({glslVersion:T.GLSL3,uniforms:{depthMap:{value:null}},vertexShader:'out vec2 p;void main(){p=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'uniform highp sampler2DShadow depthMap;in vec2 p;out vec4 c;void main(){float v=0.,s=.5;for(int i=0;i<16;i++){if(texture(depthMap,vec3(p,v+s))>.5)v+=s;s*=.5;}float code=floor((1.-v)*65535.);c=vec4(floor(code/256.)/255.,mod(code,256.)/255.,0.,1.);}',depthTest:false,depthWrite:false,toneMapped:false});scene.add(new T.Mesh(geometry,material));
  for(const depth of gf2Preview.materials.shadowMaps){material.uniforms.depthMap.value=depth;r.setRenderTarget(target);r.render(scene,camera);const pixels=new Uint8Array(512*512*4);r.readRenderTargetPixels(target,0,0,512,512,pixels);const canvas=document.createElement('canvas');canvas.width=canvas.height=512;canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels),512,512),0,0);out.push(canvas.toDataURL().split(',')[1]);}
  r.setRenderTarget(previous);geometry.dispose();material.dispose();target.dispose();return out;
 });
 return images.map((image,i)=>{const file=path.join(output,`shadow-${label}-${i}.png`);fs.writeFileSync(file,Buffer.from(image,'base64'));return file;});
}
async function checkLoadingProfile(){
 report.cacheCondition='未安装路由拦截；首次使用全新浏览器上下文，再次加载复用同一上下文的真实HTTP缓存';
 report.loads=[];
 const run=async(label,url,reload=false)=>{
  const start=Date.now();
  if(reload)await page.reload({waitUntil:'domcontentloaded'});else await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.gf2Preview?.state.ready||window.gf2Preview?.state.errors.length,null,{timeout:90000});
  expect(await page.evaluate(()=>gf2Preview.state.errors)).toEqual([]);
  const data=await page.evaluate(()=>{
   const p=gf2Preview;p.setReferencePose(true);p.render();
   const resources=performance.getEntriesByType('resource').filter(x=>x.name.includes('/frame/'));
   return {timings:p.materials.stats.timings,resources:resources.map(x=>({name:x.name,transferSize:x.transferSize,encodedBodySize:x.encodedBodySize,duration:x.duration})),png:p.renderer.domElement.toDataURL()};
  });
  fs.writeFileSync(path.join(output,label+'.png'),Buffer.from(data.png.split(',')[1],'base64'));delete data.png;
  report.loads.push({label,totalMs:Date.now()-start,...data});
 };
 let context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});
 await context.addInitScript(()=>performance.setResourceTimingBufferSize(2000));
 page=await context.newPage();await run('files',new URL('?resources=files',base).href);await context.close();
 context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});
 await context.addInitScript(()=>performance.setResourceTimingBufferSize(2000));
 page=await context.newPage();await run('bundle-cold',base);await run('bundle-warm',base,true);
 const [files,cold,warm]=report.loads;
 expect(cold.timings.requestCount).toBeLessThan(35);expect(cold.resources.length).toBe(cold.timings.requestCount);
 expect(warm.resources.filter(x=>x.name.includes('/pack-')).every(x=>x.transferSize===0)).toBe(true);
 const before=await pixels(path.join(output,'files.png')),after=await pixels(path.join(output,'bundle-cold.png')),hot=await pixels(path.join(output,'bundle-warm.png'));
 expect(before.info).toEqual(after.info);
 report.pixelComparison=[];
 for(const [label,target] of [['cold',after],['warm',hot]]){
  let max=0,changed=0,sum=0;for(let i=0;i<before.data.length;i++){const d=Math.abs(before.data[i]-target.data[i]);max=Math.max(max,d);sum+=d;if(d)changed++;}
  report.pixelComparison.push({label,maxChannelDifference:max,changedChannels:changed,meanChannelDifference:sum/before.data.length});expect(max).toBeLessThanOrEqual(1);
 }
 check('原文件与资源包同姿态RGB保持1/255浮点量化精度，冷/热加载均可见');
 check('727项文件合并为小资源包，第二次资源包全部命中真实HTTP缓存',{files:files.timings,cold:cold.timings,warm:warm.timings});
 report.passed=true;await context.close();page=null;
}
try{
  const executable=registry.findExecutable('chromium-headless-shell').executablePath();
  report.browserExecutable=executable;report.playwright=JSON.parse(fs.readFileSync(path.join(pwRoot,'package.json'))).version;
  const hardware=process.argv.includes('--hardware');browser=await chromium.launch({headless:true,executablePath:executable,args:hardware?['--use-angle=d3d11']:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});report.browserVersion=browser.version();report.graphics=hardware?'Direct3D11硬件渲染':'SwiftShader软件渲染';
  if(process.argv.includes('--loading-profile')){await checkLoadingProfile();}else if(process.argv.includes('--comparison-only')){await checkComparison();report.passed=true;}else{
  page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  page.on('pageerror',error=>report.consoleErrors.push(String(error)));page.on('console',message=>{if(message.type()==='error')report.consoleErrors.push(message.text());});
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.gf2Preview?.state.ready||window.gf2Preview?.state.errors.length,{},{timeout:90000});
  expect(await page.evaluate(()=>window.gf2Preview.state.errors)).toEqual([]);
  await expect(page.locator('#status')).toContainText('已就绪');
  const loaded=await page.evaluate(()=>({vertices:gf2Preview.model.geometry.attributes.position.count,uv:gf2Preview.model.geometry.attributes.gf2Uv.count,bound:gf2Preview.materials.stats.bound,retained:gf2Preview.materials.stats.retained,textures:gf2Preview.materials.stats.textureCount,vertexColors:gf2Preview.materials.stats.vertexColors,duration:gf2Preview.state.duration,context:gf2Preview.renderer.getContext().getParameter(gf2Preview.renderer.getContext().VERSION)}));
  expect(loaded.vertices).toBe(60352);expect(loaded.uv).toBe(60352);expect(loaded.bound.length).toBe(base.includes('legacy=1')?25:26);expect(loaded.duration).toBeGreaterThan(8);
  check('真实PMX、附加UV、原始材质与VMD就绪',loaded);
  if(process.argv.includes('--capture-recovery')||process.argv.includes('--reference-recovery')){
    const resource=new URL(base).searchParams.get('resources')==='files'?(process.argv.includes('--reference-recovery')?'pmx-reference.json':'head-calibration.json'):'resource-packs.json';
    expect(report.consoleErrors).toEqual([]);const errorStart=report.consoleErrors.length;
    await page.route('**/frame/'+resource,r=>r.fulfill({status:404,body:'missing'}));await page.reload();
    await expect(page.locator('#status')).toContainText(resource,{timeout:60000});await expect(page.locator('#retry')).toBeVisible();await page.screenshot({path:path.join(output,'missing.png')});
    await page.unroute('**/frame/'+resource);await page.locator('#retry').click();await expect(page.locator('#status')).toContainText('已就绪',{timeout:90000});expect(await page.evaluate(()=>gf2Preview.state.errors)).toEqual([]);await snap('recovered');
    report.expectedFailureMessages=report.consoleErrors.splice(errorStart);check('当前资源入口缺失可见报错，恢复后真实入口重试成功');report.passed=true;
  }else if(process.argv.includes('--captured')){
    const verifyShadows=!process.argv.includes('--appearance-only');
    expect(await page.evaluate(()=>gf2Preview.state.capturedCamera.fov)).toBe(40);
    await snap('barrack-camera');
    const initialShadows=verifyShadows?await shadows('initial'):null;
    for(const [label,name]of [['脸部近景','face'],['左侧','left'],['右侧','right'],['背面','back']]){await page.getByRole('button',{name:label,exact:true}).click();await snap(name);}
    await page.getByRole('button',{name:'兵营原机位',exact:true}).click();
    await page.locator('#timeline').evaluate(el=>{el.value='150.5';el.dispatchEvent(new Event('input',{bubbles:true}));});
    expect(await page.evaluate(()=>gf2Preview.state.frame)).toBe(150.5);await snap('motion-150');
    if(verifyShadows){const movedShadows=await shadows('motion-150'),shadowDifference=[];for(let i=0;i<2;i++)shadowDifference.push(await difference(initialShadows[i],movedShadows[i]));
    expect(shadowDifference.every(n=>n>50)).toBe(true);check('原光源阴影贴图随真实VMD姿态重新生成',{differentPixels:shadowDifference});}
    await page.getByRole('button',{name:'回到开头',exact:true}).click();expect(await page.evaluate(()=>gf2Preview.state.frame)).toBe(0);
    check('原捕获材质与机位接入真实PMX，四视角和原VMD子帧输出');
    if(verifyShadows){const recoveredShadows=await shadows('restored');for(let i=0;i<2;i++)expect(await difference(initialShadows[i],recoveredShadows[i])).toBe(0);check('回到同一动作帧后投影恢复一致');}
    const front=await snap('restored'),before=await page.evaluate(()=>({frame:gf2Preview.state.frame,camera:gf2Preview.camera.position.toArray()}));
    await page.getByRole('button',{name:'PMX基础材质',exact:true}).click();const classic=await snap('classic');expect(await page.evaluate(()=>({frame:gf2Preview.state.frame,camera:gf2Preview.camera.position.toArray()}))).toEqual(before);expect(await difference(front,classic)).toBeGreaterThan(500);await page.getByRole('button',{name:'原游戏材质',exact:true}).click();check('原捕获材质与PMX基础材质切换保持机位和动作');
    if(process.argv.includes('--face-reference')){
      const actualOrder=await page.evaluate(()=>{const order=[];for(const p of gf2Preview.materials.passMeshes)p.onBeforeRender=()=>order.push(p.renderOrder);gf2Preview.render();for(const p of gf2Preview.materials.passMeshes)p.onBeforeRender=()=>{};return order;});
      expect(actualOrder).toEqual([...actualOrder].sort((a,b)=>a-b));for(const eid of[2600,2685,2710])expect(actualOrder).toContain(eid);
      check('动态PMX实际按原事件顺序执行脸部、刘海、眼部与透明衣料绘制',{actualOrder});
      await page.getByRole('button',{name:'脸部近景',exact:true}).click();const face=await snap('face-complete');
      await page.evaluate(()=>{for(const p of gf2Preview.materials.passMeshes)if(p.userData.gf2PassKind==='face')p.visible=false;gf2Preview.render();});const missing=await snap('face-passes-disabled');
      const changed=await difference(face,missing);expect(changed).toBeGreaterThan(20);
      await page.evaluate(()=>{for(const p of gf2Preview.materials.passMeshes)if(p.userData.gf2PassKind==='face')p.visible=true;gf2Preview.render();});const restored=await snap('face-passes-restored');expect(await difference(face,restored)).toBe(0);
      check('专用面部绘制确实改变像素，恢复后画面一致',{differentPixels:changed});
      await page.getByRole('button',{name:'原帧姿态',exact:true}).click();expect(await page.evaluate(()=>gf2Preview.state.poseMode)).toBe('reference');await snap('reference-face');
      for(const [label,name]of[['兵营原机位','barrack'],['左侧','left'],['右侧','right'],['背面','back']]){await page.getByRole('button',{name:label,exact:true}).click();await snap('reference-'+name);}
      await page.getByRole('button',{name:'返回现有动作',exact:true}).click();await page.getByRole('button',{name:'脸部近景',exact:true}).click();const motionRestored=await snap('motion-restored');expect(await difference(face,motionRestored)).toBe(0);
      await page.getByRole('button',{name:'原帧姿态',exact:true}).click();await page.getByRole('button',{name:'播放',exact:true}).click();await page.waitForFunction(()=>gf2Preview.state.frame>1);await page.getByRole('button',{name:'暂停',exact:true}).click();expect(await page.evaluate(()=>gf2Preview.state.poseMode)).toBe('motion');
      await page.getByRole('button',{name:'回到开头',exact:true}).click();check('原帧姿态可旋转，退出和播放恢复现有VMD且原画面一致');
      report.reference=await page.evaluate(()=>gf2Preview.materials.stats.reference);
      expect(await page.getByRole('link',{name:'PMX同姿态对照',exact:true}).getAttribute('href')).toBe('pmx-comparison.html');
      await checkComparison();
    }
    expect(report.consoleErrors).toEqual([]);report.passed=true;
  }else if(process.argv.includes('--lighting-only')){
    await page.getByRole('button',{name:'脸部近景',exact:true}).click();
    const head=await snap('face-default');
    await page.locator('#light').evaluate(el=>{el.value='100';el.dispatchEvent(new Event('input',{bubbles:true}));});const sideA=await snap('face-light-right');
    await page.locator('#light').evaluate(el=>{el.value='-100';el.dispatchEvent(new Event('input',{bubbles:true}));});const sideB=await snap('face-light-left');
    const lightDifference=await difference(sideA,sideB);expect(lightDifference).toBeGreaterThan(500);check('主光方位实际改变角色明暗',{differentPixels:lightDifference});
    await page.locator('#light').evaluate(el=>{el.value='-30';el.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.getByLabel('实时高光',{exact:true}).uncheck();const specOff=await snap('face-specular-off');const specDifference=await difference(head,specOff);expect(specDifference).toBeGreaterThan(100);await page.getByLabel('实时高光',{exact:true}).check();check('头发高光图实际影响画面',{differentPixels:specDifference});
    await page.evaluate(()=>{const uv=gf2Preview.model.geometry.attributes.gf2Uv;window.savedGf2Uv=uv.array.slice();uv.array.fill(0);uv.needsUpdate=true;gf2Preview.seek(gf2Preview.state.frame);});
    const wrongUv=await snap('face-wrong-secondary-uv');const uvDifference=await difference(head,wrongUv);expect(uvDifference).toBeGreaterThan(500);
    await page.evaluate(()=>{const uv=gf2Preview.model.geometry.attributes.gf2Uv;uv.array.set(window.savedGf2Uv);uv.needsUpdate=true;delete window.savedGf2Uv;gf2Preview.seek(gf2Preview.state.frame);});
    const restored=await snap('face-secondary-uv-restored');expect(await difference(head,restored)).toBe(0);check('附加UV参与绘制，错误输入改变画面且恢复原图',{differentPixels:uvDifference});
    for(const [label,name]of [['正面','front'],['左侧','left'],['右侧','right'],['背面','back']]){await page.getByRole('button',{name:label,exact:true}).click();await snap(name);}
    expect(report.consoleErrors).toEqual([]);check('光照与坐标对照无着色器错误');report.passed=true;
  }else{
  const front=await snap('front');
  const stats=await sharp(front).stats();expect(stats.channels.some(x=>x.stdev>10)).toBe(true);check('实际画布存在角色绘制');
  const before=await page.evaluate(()=>({frame:gf2Preview.state.frame,camera:gf2Preview.camera.position.toArray(),target:gf2Preview.controls.target.toArray(),bones:gf2Preview.model.skeleton.bones.slice(0,15).map(b=>b.quaternion.toArray())}));
  await page.getByRole('button',{name:'PMX基础材质',exact:true}).click();const classic=await snap('classic');
  const after=await page.evaluate(()=>({frame:gf2Preview.state.frame,camera:gf2Preview.camera.position.toArray(),target:gf2Preview.controls.target.toArray(),bones:gf2Preview.model.skeleton.bones.slice(0,15).map(b=>b.quaternion.toArray())}));expect(after).toEqual(before);
  const materialDifference=await difference(front,classic);expect(materialDifference).toBeGreaterThan(500);check('切换材质改变画面且保持动作与相机',{differentPixels:materialDifference});
  await page.getByRole('button',{name:'原游戏材质',exact:true}).click();
  for(const [label,name]of [['脸部近景','face'],['左侧','left'],['右侧','right'],['背面','back']]){await page.getByRole('button',{name:label,exact:true}).click();await snap(name);}
  await page.getByRole('button',{name:'正面',exact:true}).click();
  const bounds=await page.locator('#viewer').boundingBox();const cameraBefore=await page.evaluate(()=>gf2Preview.camera.position.toArray());
  await page.mouse.move(bounds.x+bounds.width*.6,bounds.y+bounds.height*.5);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.75,bounds.y+bounds.height*.55,{steps:5});await page.mouse.up();
  expect(await page.evaluate(()=>gf2Preview.camera.position.toArray())).not.toEqual(cameraBefore);check('拖动镜头可旋转');
  await page.getByRole('button',{name:'正面',exact:true}).click();
  const normalBefore=await snap('normal-on');await page.getByLabel('法线细节',{exact:true}).uncheck();const normalOff=await snap('normal-off');const normalDifference=await difference(normalBefore,normalOff);expect(normalDifference).toBeGreaterThan(100);await page.getByLabel('法线细节',{exact:true}).check();
  await page.getByLabel('原始明暗渐变',{exact:true}).uncheck();const rampOff=await snap('ramp-off');const rampDifference=await difference(front,rampOff);expect(rampDifference).toBeGreaterThan(100);await page.getByLabel('原始明暗渐变',{exact:true}).check();check('原法线与渐变实际参与绘制',{normalDifference,rampDifference});
  await page.getByRole('button',{name:'播放',exact:true}).click();await page.waitForFunction(()=>gf2Preview.state.frame>8);
  await page.getByRole('button',{name:'暂停',exact:true}).click();const paused=await page.evaluate(()=>gf2Preview.state.frame);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));expect(await page.evaluate(()=>gf2Preview.state.frame)).toBe(paused);
  await page.locator('#timeline').evaluate(el=>{el.value='150.5';el.dispatchEvent(new Event('input',{bubbles:true}));});expect(await page.evaluate(()=>gf2Preview.state.frame)).toBe(150.5);await snap('motion-150');
  await page.getByRole('button',{name:'回到开头',exact:true}).click();expect(await page.evaluate(()=>gf2Preview.state.frame)).toBe(0);check('播放、暂停、子帧跳转与回到开头');
  await page.setViewportSize({width:430,height:930});await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);check('窄屏布局无横向溢出');
  expect(report.consoleErrors).toEqual([]);check('正常路径无脚本及着色器错误');
  // 新页面走真实加载错误与用户重试入口。
  const failed=await browser.newPage({viewport:{width:1000,height:800}});
  await failed.route('**/game-assets/textures/**',route=>route.fulfill({status:404,body:'missing'}));await failed.goto(base,{waitUntil:'domcontentloaded'});
  await expect(failed.locator('#status')).toContainText('加载失败',{timeout:60000});await expect(failed.getByRole('button',{name:'重新加载',exact:true})).toBeVisible();
  await failed.unroute('**/game-assets/textures/**');await failed.getByRole('button',{name:'重新加载',exact:true}).click();await expect(failed.locator('#status')).toContainText('已就绪',{timeout:60000});check('贴图缺失可见报错，恢复后重试成功');await failed.close();
  report.passed=true;
  }
  }
}catch(error){report.errors.push(error.stack||String(error));if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});report.passed=false;console.error(error);process.exitCode=1;}
finally{clearTimeout(timeout);await close();}
if(!report.passed)process.exit(1);
