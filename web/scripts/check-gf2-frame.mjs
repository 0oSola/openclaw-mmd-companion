import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {chromium} from '@playwright/test';
import {createHash} from 'node:crypto';
const out=path.resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true});
const require=createRequire(import.meta.url),root=path.dirname(require.resolve('playwright-core/package.json'));
const executable=require(path.join(root,'lib/server/registry/index.js')).registry.findExecutable('chromium-headless-shell').executablePath();
const record={started:new Date().toISOString(),command:process.argv,executable,errors:[],warnings:[]};
record.graphicsBackend=process.argv.includes('--hardware')?'d3d11':'swiftshader';
const browser=await chromium.launch({headless:true,executablePath:executable,args:record.graphicsBackend==='d3d11'?['--use-angle=d3d11']:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const timeout=setTimeout(()=>void browser.close(),180000);
try{
 const page=await browser.newPage({viewport:{width:1735,height:902},deviceScaleFactor:1});
 page.on('pageerror',e=>record.errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error')record.errors.push(m.text());else if(m.type()==='warning')record.warnings.push(m.text());});
 if(!process.argv.includes('--page-only')){
 await page.goto('http://127.0.0.1:18748/frame.html?capture=1');
 await page.waitForFunction(()=>window.gf2Frame?.state.ready||window.gf2Frame?.state.errors.length,{},{timeout:150000});
 record.state=await page.evaluate(()=>gf2Frame.state);record.version=browser.version();
 record.graphics=await page.evaluate(()=>{const gl=gf2Frame.renderer.gl,debug=gl.getExtension('WEBGL_debug_renderer_info');return {textureLimit:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};});
 await page.locator('canvas').screenshot({path:path.join(out,'linear.png')});
 if(!record.state.ready||record.errors.length)throw new Error('原始帧加载或绘制失败');
 const saveNative=async name=>{const data=await page.evaluate(()=>document.querySelector('canvas').toDataURL('image/png').split(',')[1]);fs.writeFileSync(path.join(out,name),Buffer.from(data,'base64'));};
 await saveNative('linear-native.png');
 await page.evaluate(()=>gf2Frame.renderer.present(true));
 await page.locator('canvas').screenshot({path:path.join(out,'srgb.png')});
 record.checks=['原始着色程序实际编译并重新绘制全部角色分区','线性颜色与屏幕颜色实际输出'];
 if(record.state.info.postTextureUnits){
  await page.evaluate(()=>gf2Frame.renderer.presentPost());await saveNative('post-native.png');
  await page.evaluate(()=>gf2Frame.renderer.presentPost(true));await saveNative('post-original-input.png');
 }
 if(process.argv.includes('--pipeline')){
  await page.evaluate(()=>gf2Frame.renderer.render({pipeline:true,through:3490}));await saveNative('pipeline-3490.png');
  await page.evaluate(()=>gf2Frame.renderer.render({pipeline:true,through:3504}));await saveNative('pipeline-3504.png');
  await page.evaluate(()=>gf2Frame.renderer.render({pipeline:true}));await saveNative('pipeline-final.png');
  record.pipelineEvent=await page.evaluate(()=>gf2Frame.renderer.lastPipelineEvent);
  if(process.argv.includes('--buffers'))for(const id of['8164','8172','8206']){
   await page.evaluate(id=>{const r=gf2Frame.renderer,t=r.pipelineResources.get('ResourceId::'+id);r.canvas.width=t.width;r.canvas.height=t.height;r.gl.viewport(0,0,t.width,t.height);r.blit(t.texture,r.display,false,false);r.gl.finish();},id);
   await saveNative('buffer-'+id+'.png');
  }
 }
 if(process.argv.includes('--mutate')){
  const source=path.resolve(process.env.GF2_CAPTURE_ASSETS||'output/gf2-barrack-materials/frame','2459-ps-cb0.bin'),body=Buffer.from(fs.readFileSync(source));
  body.writeFloatLE(12,8*16);body.writeFloatLE(0,8*16+4);body.writeFloatLE(0,8*16+8);
  await page.route('**/frame/2459-ps-cb0.bin',r=>r.fulfill({status:200,contentType:'application/octet-stream',body}));
  await page.reload();await page.waitForFunction(()=>window.gf2Frame?.state.ready,{},{timeout:150000});
  await page.evaluate(()=>gf2Frame.renderer.render({pipeline:true}));await saveNative('modified-light.png');
  await page.unroute('**/frame/2459-ps-cb0.bin');await page.reload();await page.waitForFunction(()=>window.gf2Frame?.state.ready,{},{timeout:150000});
  await page.evaluate(()=>gf2Frame.renderer.render({pipeline:true}));await saveNative('restored-light.png');
  const hash=file=>createHash('sha256').update(fs.readFileSync(path.join(out,file))).digest('hex');
  record.inputChange={original:hash('pipeline-final.png'),changed:hash('modified-light.png'),restored:hash('restored-light.png')};
  if(record.inputChange.original===record.inputChange.changed||record.inputChange.original!==record.inputChange.restored)throw new Error('真实着色输入变更与恢复对照失败');
  record.checks.push('改变衣料实际主光常量会改变最终重绘，恢复输入后逐字节恢复原输出');
 }
 }
 if(process.argv.includes('--check-page')){
  await page.setViewportSize({width:1440,height:1000});await page.goto('http://127.0.0.1:18748/frame.html');await page.waitForFunction(()=>window.gf2Frame?.state.ready,{},{timeout:150000});
  record.state=await page.evaluate(()=>gf2Frame.state);record.checks??=[];record.version=browser.version();
  for(const [name,redraw]of[['page-render-first',false],['page-render-second',true]]){
   const png=await page.evaluate(redraw=>{if(redraw)gf2Frame.renderer.render({pipeline:true});return (redraw?gf2Frame.renderer.canvas.toDataURL():document.querySelector('#render-image').src).split(',')[1];},redraw);fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(png,'base64'));
  }
  if(!fs.readFileSync(path.join(out,'page-render-first.png')).equals(fs.readFileSync(path.join(out,'page-render-second.png'))))throw new Error('首次与重复重绘不一致');
  record.checks.push('首次与重复重绘的原生画布PNG逐字节一致');
  await page.screenshot({path:path.join(out,'page-character.png'),fullPage:true});
  await page.locator('#overlay').click();await page.locator('#mix').evaluate(e=>{e.value='25';e.dispatchEvent(new Event('input',{bubbles:true}));});
  const opacity=await page.locator('figure').last().evaluate(e=>getComputedStyle(e).opacity);if(opacity!=='0.25')throw new Error('叠图混合比例未生效');
  await page.screenshot({path:path.join(out,'page-overlay.png'),fullPage:true});await page.locator('#side').click();await page.locator('#crop').click();await page.screenshot({path:path.join(out,'page-scene.png'),fullPage:true});
  await page.setViewportSize({width:430,height:930});if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))throw new Error('窄屏页面横向溢出');await page.screenshot({path:path.join(out,'page-mobile.png'),fullPage:true});
  record.checks.push('人物局部、完整场景、并排、25%叠图及430像素窄屏真实入口可用');
 }
 if(process.argv.includes('--recover')){
  if(record.errors.length)throw new Error('正常入口产生浏览器错误');const errorStart=record.errors.length;
  await page.route('**/frame/frame.json',r=>r.fulfill({status:404,body:'missing'}));
  await page.goto('http://127.0.0.1:18748/frame.html');await page.waitForFunction(()=>gf2Frame.state.errors.length);
  record.expectedFailure=await page.locator('#status').textContent();await page.screenshot({path:path.join(out,'missing.png')});
  if(!record.expectedFailure.includes('frame.json')||!record.expectedFailure.includes('404'))throw new Error('资源缺失没有显示具体错误');
  await page.unroute('**/frame/frame.json');await page.locator('#retry').click();await page.waitForFunction(()=>window.gf2Frame?.state.ready,{},{timeout:150000});
  record.recovered=await page.evaluate(()=>gf2Frame.state.ready);await page.screenshot({path:path.join(out,'recovered.png')});
  record.expectedFailureMessages=record.errors.splice(errorStart);
  record.checks.push('抓帧清单缺失显示具体错误，恢复后用户重新加载成功');
 }
}catch(error){record.failure=String(error.stack||error);process.exitCode=1;}
finally{record.passed=!record.failure;record.ended=new Date().toISOString();fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(record,null,2));clearTimeout(timeout);await browser.close();console.log(JSON.stringify(record));}
