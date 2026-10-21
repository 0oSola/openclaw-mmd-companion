import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import sharp from 'sharp';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const reference=path.resolve(process.argv[3]||path.join(project,'.scratch/gf2-render-research-20261020/game-match/reference-01.png'));
const started=new Date().toISOString();
const out=path.resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true});
const require=createRequire(import.meta.url),root=path.dirname(require.resolve('playwright-core/package.json'));
const executable=require(path.join(root,'lib/server/registry/index.js')).registry.findExecutable('chromium-headless-shell').executablePath();
const browser=await chromium.launch({headless:true,executablePath:executable,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const timer=setTimeout(()=>{void browser.close();},120000);
let record;
async function checkCameraRecovery(page,errors){
 const errorStart=errors.length;
 await page.route('**/comparison/camera.json',r=>r.fulfill({status:404,body:'missing'}));
 await page.goto('http://127.0.0.1:18748/?legacy=1&capture=1');
 await expect(page.locator('#status')).toContainText('兵营对照机位尚未保存',{timeout:60000});await expect(page.locator('#status')).toBeVisible();
 await page.screenshot({path:path.join(out,'camera-missing.png')});
 await page.unroute('**/comparison/camera.json');await page.getByRole('button',{name:'重新加载',exact:true}).click();
 await page.waitForFunction(()=>window.gf2Preview?.state.comparison||window.gf2Preview?.state.errors.length,{},{timeout:60000});
 expect(await page.evaluate(()=>gf2Preview.state.errors)).toEqual([]);
 expect(await page.evaluate(()=>gf2Preview.state.comparison.position)).toEqual([0,.83,3.12]);
 await page.screenshot({path:path.join(out,'camera-recovered.png')});
 return errors.slice(errorStart);
}
try{
 const page=await browser.newPage({viewport:{width:1702,height:884},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 if(process.argv.includes('--recovery-only')){
   record={started,timezone:'Asia/Shanghai',executable,version:browser.version(),checks:[]};
   record.expectedFailureMessages=await checkCameraRecovery(page,errors);record.checks.push('机位文件缺失可见报错，恢复后重试成功');
   record.ended=new Date().toISOString();fs.writeFileSync(path.join(out,'capture.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record));
 }else{
 await page.goto('http://127.0.0.1:18748/?legacy=1&capture=1');await page.waitForFunction(()=>window.gf2Preview?.state.comparison||window.gf2Preview?.state.errors.length,{},{timeout:60000});
 const data=await page.evaluate(()=>{const p=gf2Preview;return {state:p.state,camera:{position:p.camera.position.toArray(),quaternion:p.camera.quaternion.toArray(),fov:p.camera.fov,aspect:p.camera.aspect,projection:p.camera.projectionMatrix.toArray()},bones:p.model.skeleton.bones.map(b=>({name:b.name,position:b.getWorldPosition(b.position.clone()).toArray()})),morphs:p.model.morphTargetDictionary};});
 record={started,timezone:'Asia/Shanghai',reference,referenceSha256:createHash('sha256').update(fs.readFileSync(reference)).digest('hex'),data,errors:[...errors],executable,version:browser.version(),checks:[],authenticationEvents:'未核查',lockScreen:'无本轮锁屏证据'};
 expect(data.state.errors).toEqual([]);expect(errors).toEqual([]);expect(data.state.playing).toBe(false);
 expect(await page.locator('canvas').evaluate(c=>[c.width,c.height])).toEqual([1702,884]);
 record.checks.push('指定画幅、冻结姿态和已保存机位正常渲染，无脚本错误');
 await page.locator('canvas').screenshot({path:path.join(out,'render.png')});
 const roi={left:630,top:30,width:430,height:850};
 await sharp(reference).extract({left:1,top:25,width:1702,height:884}).toFile(path.join(out,'reference-viewport.png'));
 await sharp(path.join(out,'reference-viewport.png')).extract(roi).toFile(path.join(out,'reference-crop.png'));
 await sharp(path.join(out,'render.png')).extract(roi).toFile(path.join(out,'render-crop.png'));
 await sharp({create:{width:860,height:850,channels:3,background:'#252a2e'}}).composite([{input:path.join(out,'reference-crop.png'),left:0,top:0},{input:path.join(out,'render-crop.png'),left:430,top:0}]).png().toFile(path.join(out,'comparison.png'));
 if(process.argv.includes('--check-page')){
   await page.setViewportSize({width:1150,height:1000});await page.goto('http://127.0.0.1:18748/comparison.html');
   await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0));
   await page.getByRole('button',{name:'重叠查看',exact:true}).click();
   await expect(page.locator('#pair')).toHaveClass('pair overlap');
   await page.locator('#blend').evaluate(e=>{e.value='25';e.dispatchEvent(new Event('input',{bubbles:true}));});await expect(page.locator('#blend-value')).toHaveText('25%');
   expect(await page.locator('#pair figure').last().evaluate(e=>getComputedStyle(e).opacity)).toBe('0.25');
   await page.locator('#blend').evaluate(e=>{e.value='50';e.dispatchEvent(new Event('input',{bubbles:true}));});await page.screenshot({path:path.join(out,'page-overlay.png'),fullPage:true});
   await page.getByRole('button',{name:'并排查看',exact:true}).click();
   expect(await page.locator('#pair figure').last().evaluate(e=>getComputedStyle(e).opacity)).toBe('1');
   await page.screenshot({path:path.join(out,'page-side.png'),fullPage:true});
   record.checks.push('原图和渲染图加载、并排、重叠与混合比例实际生效，返回并排恢复完整图像');
   await page.setViewportSize({width:430,height:930});await page.screenshot({path:path.join(out,'page-mobile.png'),fullPage:true});
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   record.checks.push('430像素窄屏无横向溢出');
   expect(errors).toEqual([]);record.expectedFailureMessages=await checkCameraRecovery(page,errors);record.checks.push('机位文件缺失可见报错，恢复后重试成功');
 }
 record.ended=new Date().toISOString();fs.writeFileSync(path.join(out,'capture.json'),JSON.stringify(record,null,2));
 console.log(JSON.stringify({errors,camera:data.camera,files:out}));
 }
}catch(error){record??={started};record.failure=String(error.stack||error);record.ended=new Date().toISOString();fs.writeFileSync(path.join(out,'capture.json'),JSON.stringify(record,null,2));throw error;}
finally{clearTimeout(timer);await browser.close();}
