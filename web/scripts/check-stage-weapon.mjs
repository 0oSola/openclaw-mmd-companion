// Real companion UI, PMX/VMD and renderer. Account/chat APIs alone are isolated.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.dirname(web);
const output = path.resolve(process.argv[2] || path.join(repo, "output", `stage-weapon-${Date.now()}`));
fs.mkdirSync(output, { recursive: true });
const apiPort = 18116, webPort = 13116;
const a07Mode = process.argv.includes("--a07");
const profileMode = process.argv.includes("--profile");
const qualityMode = process.argv.includes("--quality");
const inspectFullMode = process.argv.includes("--inspect-full") || profileMode || qualityMode;
const materialMode = process.argv.includes("--materials");
const skinMode = process.argv.includes("--skin");
const gameRampMode = process.argv.includes("--game-ramp");
const skinRoot = "/stage-assets/koleda-huiling-skin/";
const api = `http://127.0.0.1:${apiPort}`, base = process.env.STAGE_WEAPON_EXISTING_WEB || `http://127.0.0.1:${webPort}`;
const files = ["web/src/app/companion/page.tsx", "web/src/features/stage/MMDStage.tsx", "web/src/features/stage/mmdCompanionRuntime.js", "web/src/features/stage/stageWeaponAttachment.js", "web/src/features/stage/koledaWeaponMaterials.js", "web/src/features/stage/stageWeaponPair.js", "web/src/features/stage/vmdSubframeCurves.js", "web/src/features/stage/v14dGameLocalOcioDisplay.js", "web/src/features/stage/stageRenderQuality.js", "web/src/features/stage/V14dGameControls.tsx"];
const snapshot = () => Object.fromEntries(files.map(file => [file, createHash("sha256").update(fs.readFileSync(path.join(repo, file))).digest("hex")]));
const report = { started: new Date().toISOString(), timezone: "Asia/Shanghai", command: process.argv, cwd: process.cwd(), checks: [], errors: [], processes: [], sources: snapshot(), authenticationEvents: "未核查", lockScreen: "无本轮锁屏证据", scope: "舞台双模型控制，不认证候选动作握持" };
const children = []; let browser, server, page;
const generated = ["next-env.d.ts", "tsconfig.json"].map(name => ({ file: path.join(web, name), before: fs.readFileSync(path.join(web, name)), afterStart: null }));
function start(executable, args, cwd, env = {}) {
  const child = spawn(executable, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const log = fs.createWriteStream(path.join(output, `process-${child.pid}.log`)); child.stdout.pipe(log); child.stderr.pipe(log);
  children.push(child); report.processes.push({ pid: child.pid, executable, args, cwd }); return child;
}
async function ready(url) {
  const limit = Date.now() + 120000;
  while (Date.now() < limit) {
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1500) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error("服务未就绪 " + url);
}
const check = (name, details = {}) => { report.checks.push({ name, ...details }); console.log("CHECK", name); };
let closing;
async function cleanup() {
  if (closing) return closing;
  closing = (async () => {
    await browser?.close().catch(() => {}); await server?.close().catch(() => {});
    for (const child of children) if (child.exitCode === null) {
      const kill = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 15000 });
      report.processes.find(x => x.pid === child.pid).stopExit = kill.status;
    }
    for (const item of generated) if (item.afterStart && fs.readFileSync(item.file).equals(item.afterStart)) fs.writeFileSync(item.file, item.before);
    report.sourceUnchanged = JSON.stringify(snapshot()) === JSON.stringify(report.sources);
    report.ended = new Date().toISOString();
    fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(report, null, 2));
  })(); return closing;
}
const watchdogMs = Math.min(600000, Math.max(30000, Number(process.env.STAGE_WEAPON_TIMEOUT_MS) || 600000));
report.watchdogMs = watchdogMs;
const watchdog = setTimeout(() => { report.errors.push(`超过${watchdogMs / 1000}秒上限，终止本次自有进程`); void cleanup().then(() => process.exit(1)); }, watchdogMs);
async function state() {
  return page.evaluate(() => {
    const r = window.__mmdCompanionRuntime, w = r.weapon;
    return { phase: w.state.phase, visible: !!w.mesh?.visible, mesh: w.mesh?.uuid || null, time: w.action?.time,
      characterTime: r.currentVmdAction?.time, character: r.model.uuid, clip: r.currentClip?.uuid, url: r.currentVmdUrl,
      bone: w.mesh?.skeleton.bones[0]?.matrixWorld.elements.slice(), scale: w.mesh?.scale.toArray(), characterScale: r.model.scale.toArray() };
  });
}
async function canvasShot(name) {
  expect(await page.evaluate(() => window.__mmdCompanionRuntime.renderer.getContext().isContextLost()), '截图时WebGL上下文必须有效').toBe(false);
  const data = await page.evaluate(() => window.__mmdCompanionRuntime.capturePngDataUrl());
  if (!data) throw new Error("舞台截图为空"); fs.writeFileSync(path.join(output, name + ".png"), Buffer.from(data.split(",")[1], "base64"));
}
async function checkSkin() {
  await page.evaluate(()=>{const mesh=window.__mmdCompanionRuntime.weapon.mesh;window.__skinEnvironmentDisposed=false;mesh.__weaponEnvironmentTarget?.addEventListener('dispose',()=>window.__skinEnvironmentDisposed=true);});
  const observed=await page.evaluate(()=>{const r=window.__mmdCompanionRuntime,w=r.weapon.mesh;return {vertices:w.geometry.attributes.position.count,bones:w.skeleton.bones.map(b=>b.name),materials:w.material.map(m=>({name:m.name,base:m.map?.image?.src,normal:m.normalMap?.image?.src,orm:m.roughnessMap?.image?.src,normalSize:[m.normalMap?.image?.width,m.normalMap?.image?.height]}))};});
  expect(observed.vertices).toBe(17145);
  expect(observed.bones).toEqual(['W00','W01','W02','W03','W04','W05','W06','W07']);
  expect(observed.materials.map(x=>x.name)).toEqual(['body','muzzle','scope','grip','light']);
  for(const m of observed.materials){expect(m.base).toContain(skinRoot+'textures/'+m.name+'-base.png');expect(m.normal).toContain(skinRoot+'textures/'+m.name+'-normal.png');expect(m.orm).toContain(skinRoot+'textures/'+m.name+'-orm.png');expect(m.normalSize).toEqual(m.name==='body'?[1024,1024]:[512,512]);}
  check('指定枪体与四项配件原贴图实际加载，八根动作骨骼保留',observed);
  if(gameRampMode){
    const lighting=await page.evaluate(()=>{const w=window.__mmdCompanionRuntime.weapon.mesh,o=w.__weaponOutline;window.__weaponReleaseCounts={ramp:0,outline:0,geometry:0};w.material[0].weaponRampMap?.addEventListener('dispose',()=>window.__weaponReleaseCounts.ramp++);o?.material.addEventListener('dispose',()=>window.__weaponReleaseCounts.outline++);w.geometry.addEventListener('dispose',()=>window.__weaponReleaseCounts.geometry++);return {materials:w.material.map(m=>({normal:m.normalScale.toArray(),ramp:[m.weaponRampMap?.image?.width,m.weaponRampMap?.image?.height],half:m.weaponRampMap?.image?.data instanceof Uint16Array,displayIsolated:m.toneMapped===false})),outline:!!o,sameSkeleton:o?.skeleton===w.skeleton,sameGeometry:o?.geometry===w.geometry};});
    for(const m of lighting.materials){expect(m.normal).toEqual([1,1]);expect(m.ramp).toEqual([256,16]);expect(m.half).toBe(true);expect(m.displayIsolated).toBe(true);}
    expect(lighting.outline&&lighting.sameSkeleton&&lighting.sameGeometry).toBe(true);
    check('原始半精度渐变图、已校准法线、独立显示变换与随骨骼描边',lighting);
  }
  const saved=await page.evaluate(()=>{const r=window.__mmdCompanionRuntime,w=r.weapon.mesh,s={position:r.camera.position.toArray(),target:r.controls.target.toArray()};w.computeBoundingBox();const b=w.boundingBox.clone().applyMatrix4(w.matrixWorld),c=b.getCenter(w.position.clone());r.controls.target.copy(c);r.camera.position.copy(c).add(w.position.clone().set(0,0,Math.max(1,b.max.y-b.min.y)*2.1));r.controls.update();return s;});
  await canvasShot('skin-weapon-close');
  if(process.argv.includes('--area-probe')){
    report.areaProbe=await page.evaluate(()=>{const r=window.__mmdCompanionRuntime;window.__areaProbeLights=[];r.scene.traverse(o=>{if(o.isRectAreaLight)window.__areaProbeLights.push([o,o.intensity]);});return window.__areaProbeLights.map(([o,i])=>({color:o.color.toArray(),intensity:i,position:o.position.toArray()}));});
    for(const scale of [1,0.25,0]){await page.evaluate(s=>window.__areaProbeLights.forEach(([o,i])=>o.intensity=i*s),scale);await canvasShot('area-probe-'+scale);}
    await page.evaluate(()=>window.__areaProbeLights.forEach(([o,i])=>o.intensity=i));
  }
  if(process.argv.includes('--environment-probe')){
    for(const side of [1,-1]){
      await page.evaluate(side=>{for(const m of window.__mmdCompanionRuntime.weapon.mesh.material){m.userData.originalCompile??=m.onBeforeCompile;const original=m.userData.originalCompile;m.onBeforeCompile=shader=>{original(shader);shader.fragmentShader=shader.fragmentShader.replace(/float nl=1\.0;[\s\S]*?#endif/,'float nl=max(n.x*'+side.toFixed(1)+',0.0);');};m.customProgramCacheKey=()=> 'environment-side-probe-'+side;m.needsUpdate=true;}},side);
      await canvasShot('environment-side-'+side);
    }
  }
  await page.evaluate(s=>{const r=window.__mmdCompanionRuntime;r.camera.position.fromArray(s.position);r.controls.target.fromArray(s.target);r.controls.update();},saved);
}
async function checkMaterials() {
  report.materialLighting = await page.evaluate(()=>{const r=window.__mmdCompanionRuntime;const lights=[];r.scene.traverse(o=>{if(o.isLight)lights.push({name:o.name,type:o.type,color:o.color.toArray(),intensity:o.intensity})});return {lights,environment:!!r.scene.environment,colors:r.weapon.mesh.material.map(m=>m.color.toArray())};});
  report.materials = await page.evaluate(() => window.__mmdCompanionRuntime.weapon.mesh.material.map(m=>({name:m.name,type:m.type,map:m.map?.image?.src,normal:m.normalMap?.image?.src,roughness:m.roughnessMap?.image?.src,metalness:m.metalnessMap?.image?.src,ao:m.aoMap?.image?.src,normalSize:[m.normalMap?.image?.width,m.normalMap?.image?.height]})));
  await canvasShot('material-full');
  await page.evaluate(()=>window.__mmdCompanionRuntime.weapon.mesh.material.forEach(m=>{if(m.userData.weaponNeutralAreaLight)m.userData.weaponNeutralAreaLight.value=0;}));
  await canvasShot('material-original-area-light');
  await page.evaluate(()=>window.__mmdCompanionRuntime.weapon.mesh.material.forEach(m=>{if(m.userData.weaponNeutralAreaLight)m.userData.weaponNeutralAreaLight.value=1;}));
  for(const m of report.materials){expect(m.normalSize,'真实法线贴图必须加载').toEqual([1024,1024]);expect(m.roughness).toBeTruthy();expect(m.metalness).toBeTruthy();expect(m.ao).toBeTruthy();}
  for(const channel of ['normalMap','roughnessMap','metalnessMap','aoMap']){
    await page.evaluate(channel=>{const r=window.__mmdCompanionRuntime;r.weapon.mesh.material.forEach(m=>{m.userData.savedMap=m[channel];m[channel]=null;m.needsUpdate=true});},channel);
    await canvasShot('material-without-'+channel);
    await page.evaluate(channel=>{const r=window.__mmdCompanionRuntime;r.weapon.mesh.material.forEach(m=>{m[channel]=m.userData.savedMap;delete m.userData.savedMap;m.needsUpdate=true});},channel);
    const [a,b]=await Promise.all(['material-full','material-without-'+channel].map(n=>sharp(path.join(output,n+'.png')).raw().toBuffer()));
    let pixels=0;for(let i=0;i<a.length;i+=4)if([0,1,2].some(c=>Math.abs(a[i+c]-b[i+c])>2))pixels++;
    expect(pixels,channel+'必须实际影响画面').toBeGreaterThan(5);check('武器材质单通道实际生效 '+channel,{pixels});
  }
  const cameraState=await page.evaluate(()=>{const r=window.__mmdCompanionRuntime,w=r.weapon.mesh;const saved={position:r.camera.position.toArray(),target:r.controls.target.toArray()};w.computeBoundingBox();const box=w.boundingBox.clone().applyMatrix4(w.matrixWorld);const center=box.getCenter(w.position.clone());r.controls.target.copy(center);r.camera.position.copy(center).add(w.position.clone().set(0,0,Math.max(1,box.max.y-box.min.y)*2.1));r.controls.update();return saved;});
  await canvasShot('weapon-close');
  await page.evaluate(saved=>{const r=window.__mmdCompanionRuntime;r.camera.position.fromArray(saved.position);r.controls.target.fromArray(saved.target);r.controls.update();},cameraState);
}
async function checkA07(toggle) {
  await page.getByRole("button", { name: /A07 碰枪互动原版/ }).click();
  await expect.poll(async () => (await state()).url, { timeout: 30000 }).toContain("a07-original");
  await expect.poll(() => page.evaluate(() => window.__mmdCompanionRuntime.isLoadingVmd), { timeout: 60000 }).toBe(false);
  report.a07InitialState = await state();
  await canvasShot("a07-initial");
  await expect(page.getByTestId("stage-weapon-status")).toContainText("已显示", { timeout: 20000 });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  check("动作库A07原版无需额外点开关自动显示武器");
  await page.evaluate(() => { const r=window.__mmdCompanionRuntime; r.setCalibrationCaptureMode(true); r.seekVmdFrame(48); });
  if(skinMode)await checkSkin();
  if(materialMode) await checkMaterials();
  const on=await state(); await canvasShot("a07-on"); await toggle.click(); const off=await state(); await canvasShot("a07-off");
  expect(off.visible).toBe(false); expect(off.character).toBe(on.character); expect(off.characterTime).toBe(on.characterTime);
  await toggle.click(); expect((await state()).visible).toBe(true);
  const ims=await Promise.all(["a07-on","a07-off"].map(n=>sharp(path.join(output,n+".png")).ensureAlpha().raw().toBuffer()));
  let changed=0;for(let i=0;i<ims[0].length;i+=4)if([0,1,2].some(c=>Math.abs(ims[0][i+c]-ims[1][i+c])>8))changed++;
  expect(changed).toBeGreaterThan(500);check("A07武器实际绘出且开关不改人物",{changedPixels:changed});
  for(const f of [0,191,96.5,48,0]){await page.evaluate(f=>window.__mmdCompanionRuntime.seekVmdFrame(f),f);const x=await state();expect(x.time).toBeCloseTo(f/30,5);expect(x.time).toBeCloseTo(x.characterTime,6)}
  await page.getByRole("button", { name: /改名后的单文件动作/ }).click();
  await expect.poll(async ()=>(await state()).url).toContain("renamed-motion");
  await expect.poll(()=>page.evaluate(()=>window.__mmdCompanionRuntime.isLoadingVmd),{timeout:60000}).toBe(false);
  await expect(page.getByTestId("stage-weapon-status")).toContainText("已显示",{timeout:60000});
  check("合并VMD更名并通过上传型URL播放仍识别配套");
  await toggle.click();await page.getByRole("button",{name:/A07 碰枪互动原版/}).click();
  await expect.poll(async ()=>(await state()).url).toContain("a07-original");
  await expect.poll(()=>page.evaluate(()=>window.__mmdCompanionRuntime.isLoadingVmd)).toBe(false);
  expect((await state()).visible).toBe(false);await toggle.click();await expect(page.getByTestId("stage-weapon-status")).toContainText("已显示",{timeout:60000});
  check("用户手动隐藏在动作切换后继续生效");
  await page.getByRole("button",{name:/同名非配套对照/}).click();await expect.poll(async ()=>(await state()).mesh).toBeNull();
  check("同名但内容不同的动作不误挂枪");
  const missing=skinMode?'**'+skinRoot+'weapon.pmx':"**/stage-assets/koleda-a07-weapon/weapon.pmx";await page.route(missing,r=>r.fulfill({status:404,body:"本次资源缺失对照"}));
  await page.getByRole("button",{name:/A07 碰枪互动原版/}).click();await expect(page.getByTestId("stage-weapon-status")).toContainText("加载失败",{timeout:60000});
  await page.unroute(missing);await page.getByRole("button",{name:"重试武器加载",exact:true}).click();await expect(page.getByTestId("stage-weapon-status")).toContainText("已显示",{timeout:60000});
  check("A07资源404及实际重试恢复");
  if(materialMode){
    const texture="**/stage-assets/koleda-weapon-material/normal.png";
    await page.getByRole('button',{name:/普通待机对照/}).click();await expect.poll(async()=>(await state()).mesh).toBeNull();
    await page.route(texture,r=>r.fulfill({status:404,body:'法线缺失对照'}));
    await page.getByRole('button',{name:/A07 碰枪互动原版/}).click();await expect(page.getByTestId('stage-weapon-status')).toContainText('加载失败',{timeout:60000});
    expect((await state()).mesh).toBeNull();await page.unroute(texture);await page.getByRole('button',{name:'重试武器加载',exact:true}).click();await expect(page.getByTestId('stage-weapon-status')).toContainText('已显示',{timeout:60000});
    check('细节贴图缺失明确报错且重试恢复');
  }
  await page.evaluate(()=>window.__mmdCompanionRuntime.seekVmdFrame(48));await page.screenshot({path:path.join(output,"a07-controls.png"),fullPage:true});
  await page.setViewportSize({width:390,height:844});await toggle.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,"a07-mobile.png"),fullPage:true});
  await page.getByRole("button",{name:/普通待机对照/}).click();await expect.poll(async ()=>(await state()).mesh).toBeNull();check("切回普通待机卸载武器");
  if(skinMode){expect(await page.evaluate(()=>window.__skinEnvironmentDisposed)).toBe(true);check('卸载皮肤释放独立反射环境');}
  expect(report.errors).toEqual([]);expect(report.console.filter(x=>/Shader Error|shader is not compiled/.test(x.text))).toEqual([]);
}
async function checkInspectFull(toggle) {
  const select = async name => {await page.getByRole('button',{name:new RegExp(name)}).click();await expect.poll(()=>page.evaluate(()=>window.__mmdCompanionRuntime.isLoadingVmd),{timeout:60000}).toBe(false);};
  await select('专属查看完整单VMD');
  await expect.poll(async()=>(await state()).url).toContain('inspect-full');
  await expect(page.getByTestId('stage-weapon-status')).toContainText('已显示',{timeout:20000});
  await expect(toggle).toHaveAttribute('aria-pressed','true');
  const metadata=await page.evaluate(()=>{const r=window.__mmdCompanionRuntime,c=r.currentVmdAction.getClip();return {rate:r.currentVmdPlaybackRate,duration:c.duration,trackEnd:Math.max(...c.tracks.map(t=>t.times[t.times.length-1])),endingHold:r.helper.configuration.afterglow,weaponDuration:r.weapon.action.getClip().duration,url:r.currentVmdUrl,weaponUrl:r.weapon.pair.weaponMotion};});
  expect(metadata.rate).toBe(1);expect(metadata.trackEnd).toBeCloseTo(260/30,5);expect(metadata.duration).toBeCloseTo(metadata.trackEnd+metadata.endingHold,5);expect(metadata.weaponDuration).toBeCloseTo(260/30,5);expect(metadata.weaponUrl).toBe(metadata.url);
  check('完整专属查看自动配枪，人物武器同一VMD且1倍速',{metadata});
  await page.evaluate(()=>window.__mmdCompanionRuntime.setCalibrationCaptureMode(true));
  for(const frame of [0,260,86.125,34,0]){await page.evaluate(f=>window.__mmdCompanionRuntime.seekVmdFrame(f),frame);const s=await state();expect(s.time).toBeCloseTo(frame/30,5);expect(s.time).toBeCloseTo(s.characterTime,6);}
  check('260帧完整时长、子帧与倒序同步');
  await page.evaluate(()=>window.__mmdCompanionRuntime.seekVmdFrame(86));
  if(skinMode)await checkSkin();
  if(materialMode)await checkMaterials();
  await canvasShot('inspect-full-on');const on=await state();await toggle.click();const off=await state();expect(off.visible).toBe(false);expect(off.characterTime).toBe(on.characterTime);await toggle.click();expect((await state()).visible).toBe(true);check('完整动作显隐保留当前帧');
  await select('改名后的专属查看');await expect(page.getByTestId('stage-weapon-status')).toContainText('已显示',{timeout:20000});expect((await state()).url).toContain('inspect-renamed');check('完整VMD更名后内容识别仍有效');
  await select('同名不同内容专属查看');await expect.poll(async()=>(await state()).mesh).toBeNull();check('同名同大小但内容不同不误配');
  const missing=skinMode?'**'+skinRoot+'textures/scope-normal.png':'**/stage-assets/koleda-weapon-material/normal.png';await page.route(missing,r=>r.fulfill({status:404,body:'本次缺图对照'}));await select('专属查看完整单VMD');await expect(page.getByTestId('stage-weapon-status')).toContainText('加载失败',{timeout:20000});await page.unroute(missing);await page.getByRole('button',{name:'重试武器加载',exact:true}).click();await expect(page.getByTestId('stage-weapon-status')).toContainText('已显示',{timeout:20000});check('完整动作细节贴图失败及重试恢复');
  await select('普通待机对照');await expect.poll(async()=>(await state()).mesh).toBeNull();check('切回待机自动卸载');
  if(gameRampMode){
    expect(await page.evaluate(()=>window.__weaponReleaseCounts)).toEqual({ramp:1,outline:1,geometry:1});check('共享几何仅释放一次，渐变图与描边正确释放');
    for(const [label,status,body]of [['缺失',404,'missing'],['截断',200,'bad']]){
      const route='**'+skinRoot+'textures/game-ramp.rgba16f';await page.route(route,r=>r.fulfill({status,body}));await select('专属查看完整单VMD');await expect(page.getByTestId('stage-weapon-status')).toContainText('加载失败',{timeout:20000});expect((await state()).mesh).toBeNull();await page.unroute(route);await page.getByRole('button',{name:'重试武器加载',exact:true}).click();await expect(page.getByTestId('stage-weapon-status')).toContainText('已显示',{timeout:20000});await select('普通待机对照');await expect.poll(async()=>(await state()).mesh).toBeNull();check('渐变资源'+label+'时失败并可恢复');
    }
  }
  if(skinMode){expect(await page.evaluate(()=>window.__skinEnvironmentDisposed)).toBe(true);check('卸载皮肤释放独立反射环境');}
  expect(report.errors).toEqual([]);expect(report.console.filter(x=>/Shader Error|shader is not compiled/.test(x.text))).toEqual([]);
}
async function profileStage() {
  await page.getByRole('button',{name:/专属查看完整单VMD/}).click();
  await expect.poll(async()=>(await state()).url).toContain('inspect-full');
  await expect.poll(()=>page.evaluate(()=>window.__mmdCompanionRuntime.isLoadingVmd),{timeout:60000}).toBe(false);
  await expect(page.getByTestId('stage-weapon-status')).toContainText('已显示',{timeout:30000});
  const session=await page.context().newCDPSession(page);await session.send('Profiler.enable');await session.send('Profiler.setSamplingInterval',{interval:1000});
  // 固定采样动作而不改播放倍率；准备阶段不计入测量，避免首编译混入。
  await page.evaluate(async()=>{const r=window.__mmdCompanionRuntime;r.setCalibrationCaptureMode(true);for(let i=0;i<12;i++){r.seekVmdFrame(30+i);await new Promise(requestAnimationFrame)}});
  await session.send('Profiler.start');
  report.performance=await page.evaluate(async()=>{
    const r=window.__mmdCompanionRuntime,parts={},restore=[];
    for(const [object,key,label]of [[r.helper,'update','动作与求解'],[r,'renderScene','渲染总计'],[r.weapon,'sync','武器同步'],[r,'updateBakedGarmentMorphs','衣发补偿'],[r,'refreshSkinnedModelBounds','包围体检查'],[r.renderer,'render','Three渲染'],[r.getCurrentVmdMixer(),'update','人物轨道求值']]){
      if(!object||typeof object[key]!=='function')continue;const original=object[key];parts[label]=[];object[key]=function(...args){const t=performance.now();try{return original.apply(this,args)}finally{parts[label].push(performance.now()-t)}};restore.push(()=>object[key]=original);
    }
    const frames=[],seek=[];
    const live=window.__stageProfileLive===true;
    if(live){r.seekVmdFrame(0);r.setCalibrationCaptureMode(false);r.currentVmdStartedAt=performance.now();r.clock.getDelta();}
    try{let last=performance.now(),start=last;for(let i=0;i<90;i++){await new Promise(requestAnimationFrame);const now=performance.now();frames.push(now-last);last=now;if(live){if(now-start>5000)break;}else{const t=performance.now();r.seekVmdFrame(30+i*.25);seek.push(performance.now()-t)}}}finally{restore.forEach(f=>f());r.setCalibrationCaptureMode(true);}
    const stats=a=>{const s=a.slice().sort((a,b)=>a-b);return {count:a.length,mean:a.reduce((x,y)=>x+y,0)/a.length,p50:s[Math.floor(s.length*.5)],p95:s[Math.floor(s.length*.95)],max:s.at(-1)}};
    const gl=r.renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');return {live,frameMs:stats(frames),seekMs:seek.length?stats(seek):null,parts:Object.fromEntries(Object.entries(parts).filter(([,a])=>a.length).map(([n,a])=>[n,stats(a)])),renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),timerQuery:!!gl.getExtension('EXT_disjoint_timer_query_webgl2'),pixelRatio:r.renderer.getPixelRatio(),bones:r.model.skeleton.bones.length,tracks:r.currentClip.tracks.length};
  });
  const cpu=await session.send('Profiler.stop');fs.writeFileSync(path.join(output,'cpu-profile.json'),JSON.stringify(cpu.profile));await session.detach();
  const nodes=new Map(cpu.profile.nodes.map(n=>[n.id,n]));const totals=new Map();for(let i=0;i<cpu.profile.samples.length;i++){const n=nodes.get(cpu.profile.samples[i]);const f=n.callFrame;const key=f.functionName+' @ '+f.url+':'+f.lineNumber;totals.set(key,(totals.get(key)||0)+(cpu.profile.timeDeltas[i]||0));}report.cpuTop=[...totals].sort((a,b)=>b[1]-a[1]).slice(0,20);
  await canvasShot('profile-pose');check('同动作90个子帧的真实舞台性能采样',report.performance);
  if(process.argv.includes('--profile-probe')){
    report.staticProbe=await page.evaluate(async()=>{
      const r=window.__mmdCompanionRuntime,m=r.model,g=m.geometry,original=g.attributes.position.array.slice(),morphs=g.morphAttributes,ratio=r.renderer.getPixelRatio();let weights;
      const hook=m.onBeforeRender;m.onBeforeRender=function(...args){hook.apply(this,args);weights=this.morphTargetInfluences.slice();};r.renderScene();m.onBeforeRender=hook;
      const sample=async()=>{for(let i=0;i<8;i++)await new Promise(requestAnimationFrame);const xs=[];let last=performance.now();for(let i=0;i<40;i++){await new Promise(requestAnimationFrame);const now=performance.now();xs.push(now-last);last=now;}xs.sort((a,b)=>a-b);return {mean:xs.reduce((a,b)=>a+b,0)/xs.length,p50:xs[20],p95:xs[38]}};
      const result={targets:morphs.position.length,activeTargets:weights.filter(v=>v!==0).length,triangles:r.renderer.info.render.triangles,calls:r.renderer.info.render.calls};
      try{
        result.before=await sample();result.beforeImage=r.capturePngDataUrl();
        const sum=new Float64Array(original);for(let j=0;j<weights.length;j++){const w=weights[j];if(!w)continue;const a=morphs.position[j].array;for(let k=0;k<sum.length;k++)sum[k]+=a[k]*w;}
        g.attributes.position.array.set(sum);g.attributes.position.needsUpdate=true;g.morphAttributes={};m.material.forEach(x=>x.needsUpdate=true);
        result.cpuMorph=await sample();result.cpuMorphImage=r.capturePngDataUrl();
        g.attributes.position.array.set(original);g.attributes.position.needsUpdate=true;g.morphAttributes=morphs;m.material.forEach(x=>x.needsUpdate=true);
        r.renderer.setPixelRatio(ratio*.5);result.halfResolution=await sample();
      }finally{g.attributes.position.array.set(original);g.attributes.position.needsUpdate=true;g.morphAttributes=morphs;m.material.forEach(x=>x.needsUpdate=true);r.renderer.setPixelRatio(ratio);r.renderScene();}
      return result;
    });
    for(const [key,name]of [['beforeImage','probe-before'],['cpuMorphImage','probe-cpu-morph']]){fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(report.staticProbe[key].split(',')[1],'base64'));delete report.staticProbe[key];}
    check('静止同姿势形变与像素开销单变量对照',report.staticProbe);
  }
}
async function checkQuality() {
  const select=page.getByRole('combobox',{name:'舞台绘制模式'});
  await page.getByRole('button',{name:/专属查看完整单VMD/}).click();
  await expect(page.getByTestId('stage-weapon-status')).toContainText('已显示',{timeout:60000});
  await page.getByText('游戏参考 · 外观微调',{exact:true}).click();
  await expect(select).toHaveValue('auto',{timeout:10000});
  await page.evaluate(()=>{const r=window.__mmdCompanionRuntime;r.setCalibrationCaptureMode(true);r.seekVmdFrame(48)});
  const measure=async()=>page.evaluate(async()=>{const r=window.__mmdCompanionRuntime;for(let i=0;i<5;i++)await new Promise(requestAnimationFrame);let last=performance.now();const samples=[];for(let i=0;i<16;i++){await new Promise(requestAnimationFrame);const now=performance.now();samples.push(now-last);last=now;}samples.sort((a,b)=>a-b);return {ratio:r.renderer.getPixelRatio(),scale:r.renderQuality.scale,width:r.renderer.domElement.width,height:r.renderer.domElement.height,median:samples[8],time:r.currentVmdAction.time,weaponTime:r.weapon.action.time};});
  await select.selectOption('full');const full=await measure();await canvasShot('quality-full');
  await select.selectOption('fluid');const fluid=await measure();await page.locator('canvas').first().screenshot({path:path.join(output,'quality-fluid-screen.png')});await page.screenshot({path:path.join(output,'quality-controls.png')});await canvasShot('quality-fluid-export');
  expect(fluid.scale).toBe(.7);expect(fluid.ratio).toBeCloseTo(full.ratio*.7,6);expect(fluid.time).toBe(full.time);expect(fluid.weaponTime).toBe(full.weaponTime);
  expect(fluid.width*fluid.height).toBeLessThan(full.width*full.height*.51);expect(fluid.median).toBeLessThan(full.median*.85);
  const [a,b]=await Promise.all(['quality-full','quality-fluid-export'].map(n=>sharp(path.join(output,n+'.png')).raw().toBuffer()));expect(a.equals(b),'流畅模式导出保持原画质').toBe(true);
  expect(await page.evaluate(()=>window.__mmdCompanionRuntime.renderQuality.scale)).toBe(.7);check('真实流畅模式减少像素和耗时，动作与全精度导出保持',{full,fluid});
  await select.selectOption('full');expect((await measure()).ratio).toBe(full.ratio);check('原画质恢复原始精度');
  await select.selectOption('auto');await page.evaluate(()=>{const r=window.__mmdCompanionRuntime;r.setCalibrationCaptureMode(false);r.currentVmdStartedAt=performance.now();r.clock.getDelta();});
  await expect.poll(()=>page.evaluate(()=>window.__mmdCompanionRuntime.renderQuality.scale),{timeout:20000}).toBeLessThan(1);check('真实低帧率下自动降低3D精度');
  await select.selectOption('fluid');report.qualitySaved=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('stage-render-quality-v1:'))));await page.reload();await page.waitForFunction(()=>window.__mmdCompanionRuntime?.model&&!window.__mmdCompanionRuntime.isLoadingVmd&&document.querySelector('[data-character-arrival]')?.getAttribute('data-character-arrival')==='idle',null,{timeout:180000});await page.getByText('游戏参考 · 外观微调',{exact:true}).click();report.qualityRestored=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('stage-render-quality-v1:'))));await expect(select).toHaveValue('fluid');expect(await page.evaluate(()=>window.__mmdCompanionRuntime.renderQuality.scale)).toBe(.7);check('绘制模式刷新后恢复');
  await select.selectOption('full');await page.setViewportSize({width:390,height:844});await select.click();await select.press('Escape');await page.screenshot({path:path.join(output,'quality-mobile.png'),fullPage:true});check('窄屏绘制控件可实际点击并截图');expect(report.errors).toEqual([]);
}
try {
  const { registry } = require("playwright-core/lib/server/registry/index");
  const binary = registry.findExecutable("chromium-headless-shell").executablePath(); fs.accessSync(binary);
  report.browser = { playwright: require("playwright-core/package.json").version, expectedExecutable: binary };
  server = await chromium.launchServer({ headless: true, args: ["--enable-unsafe-swiftshader", ...(process.argv.includes('--software') ? ['--use-angle=swiftshader'] : [])], timeout: 30000 });
  report.browser.actualExecutable = server.process().spawnfile; report.browser.pid = server.process().pid; report.browser.args = server.process().spawnargs;
  expect(path.resolve(report.browser.actualExecutable)).toBe(path.resolve(binary));
  browser = await chromium.connect(server.wsEndpoint()); report.browser.version = browser.version();
  if (process.argv.includes("--stop-check")) {
    await server.kill(); check("实际执行自有浏览器终止路径", { pid: report.browser.pid });
  } else {
    start(path.join(repo, ".venv/Scripts/python.exe"), ["api/scripts/character_arrival_e2e_server.py", "--port", String(apiPort)], repo);
    if (!process.env.STAGE_WEAPON_EXISTING_WEB) start(process.execPath, [path.join(web, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(webPort)], web,
      { NEXT_PUBLIC_API_BASE_URL: api, NEXT_DIST_DIR: ".scratch/stage-weapon-next" });
    await Promise.all([ready(api + "/assets/mmd/models"), ready(base + "/companion")]);
    if (!process.env.STAGE_WEAPON_EXISTING_WEB) for (const item of generated) item.afterStart = fs.readFileSync(item.file);
    const model = (await (await fetch(api + "/assets/mmd/models")).json()).items.find(x => x.relative_path === "克莱妲原皮/Koleda_v1.1_动作兼容.pmx");
    if (!model) throw new Error("现用人物PMX缺失");
    const catalog = JSON.parse(fs.readFileSync(path.join(web, "src/features/stage/characterIdleCatalog.json")));
    const idle = catalog.find(x => x.filename.startsWith("L02_02"));
    const idleUrl = api + "/assets/mmd/default-motions/" + encodeURIComponent(idle.filename);
    const idleAsset = { asset_id: "weapon-idle-control", filename: idle.filename, display_name: "普通待机对照", user_id: "weapon-e2e", size_bytes: idle.size_bytes, url: idleUrl };
    const a07Root=path.join(repo,".scratch/koleda-a07-weapon-20261018/preview/assets");
    const sameSizeDifferentMotion=a07Mode ? fs.readFileSync(path.join(a07Root,"character.vmd")) : null;
    if(sameSizeDifferentMotion) sameSizeDifferentMotion.writeFloatLE(sameSizeDifferentMotion.readFloatLE(73)+.01,73);
    const a07Files=a07Mode ? new Map([
      ["/assets/vmd/a07-original/download",fs.readFileSync(path.join(a07Root,"character.vmd"))],
      ["/assets/vmd/renamed-motion/download",fs.readFileSync(path.join(a07Root,"Koleda_A07_碰枪互动_人物与武器_1倍速.vmd"))],
      ["/assets/vmd/same-name-control/download",sameSizeDifferentMotion],
    ]) : new Map();
    const a07Assets=Array.from(a07Files,([endpoint,bytes],i)=>({asset_id:`a07-${i}`,filename:i===1?"renamed.vmd":"A07_Koleda_碰枪互动_v1.1_1倍速_眼睑完整修复.vmd",display_name:["A07 碰枪互动原版","改名后的单文件动作","同名非配套对照"][i],user_id:"weapon-e2e",size_bytes:bytes.length,url:api+endpoint}));
    if(inspectFullMode){const bytes=fs.readFileSync(path.join(repo,'.scratch/koleda-current-preview-20261018/assets/Koleda_专属查看_人物与武器_1倍速.vmd'));const wrong=Buffer.from(bytes);wrong.writeFloatLE(wrong.readFloatLE(73)+.01,73);for(const [i,endpoint]of ['inspect-full','inspect-renamed','inspect-wrong'].entries()){const url='/assets/vmd/'+endpoint+'/download';a07Files.set(url,i===2?wrong:bytes);a07Assets.push({asset_id:endpoint,filename:i===1?'renamed.vmd':'Koleda_专属查看_人物与武器_1倍速.vmd',display_name:['专属查看完整单VMD','改名后的专属查看','同名不同内容专属查看'][i],user_id:'weapon-e2e',size_bytes:bytes.length,url:api+url});}}
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN", deviceScaleFactor: 1 });
    await context.addInitScript(({ modelPath }) => {
      localStorage.setItem("mmd_companion_session_v1", JSON.stringify({ userId: "weapon-e2e", selectedModelPath: modelPath, ttsEnabled: false }));
      localStorage.setItem("mmd_companion_render_pipeline_v1:weapon-e2e", "v14d-game");
    }, { modelPath: model.relative_path });
    await context.route("**/*", async route => {
      const u = new URL(route.request().url());
      if (![String(apiPort), "8100"].includes(u.port) && !u.pathname.startsWith("/api/backend/")) return route.continue();
      const endpoint = u.pathname.replace(/^\/api\/backend/, "");
      if (endpoint === "/assets/mmd/models") return route.fulfill({ json: { items: [model] } });
      if(a07Files.has(endpoint))return route.fulfill({body:a07Files.get(endpoint),contentType:"application/octet-stream"});
      if (endpoint.startsWith("/assets/mmd/") || endpoint.startsWith("/assets/v14d-game/")) return route.continue();
      if (endpoint.includes("shared-config")) return route.fulfill({ json: { user_id: "weapon-e2e", selected_model_path: model.relative_path, render_pipeline: "v14d-game", reze_stage_document: null } });
      if (endpoint.startsWith("/assets/vmd")) return route.fulfill({ json: { items: [idleAsset,...a07Assets] } });
      if (endpoint.startsWith("/config/mapping/resolved")) return route.fulfill({ json: { mappings: {} } });
      if (endpoint === "/sessions") return route.fulfill({ json: { items: [{ id: "weapon-session", title: "武器舞台检查" }] } });
      return route.fulfill({ json: { items: [], message: null, status: "ok", pending_count: 0, by_status: {} } });
    });
    page = await context.newPage(); page.on("pageerror", error => report.errors.push(error.stack || String(error)));
    report.console = [];
    page.on("console", message => { if (["error", "warning"].includes(message.type())) report.console.push({ type: message.type(), text: message.text() }); });
    await page.goto(base + "/companion", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__mmdCompanionRuntime?.model && !window.__mmdCompanionRuntime.isLoadingVmd
      && document.querySelector("[data-character-arrival]")?.getAttribute("data-character-arrival") === "idle", null, { timeout: 180000 });
    await page.getByRole("button", { name: "高级功能", exact: true }).click();
    const toggle = page.getByRole("button", { name: "显示武器", exact: true });
    const preview = page.getByRole("button", { name: "试播配套动作", exact: true });
    if(qualityMode){await checkQuality();}else if(profileMode){await page.evaluate(live=>window.__stageProfileLive=live,process.argv.includes('--profile-live'));await profileStage();}else if(inspectFullMode){await checkInspectFull(toggle);}else if(a07Mode){await checkA07(toggle);}else{
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("stage-weapon-status")).toContainText("没有配套武器");
    expect((await state()).mesh).toBeNull(); check("无配套动作时不挂错武器");
    await page.evaluate(() => window.__mmdCompanionRuntime.setCalibrationCaptureMode(true));
    const playerMode = await page.getByRole("combobox", { name: "播放器骨骼模式", exact: true }).inputValue();
    await preview.click();
    await expect(page.getByTestId("stage-weapon-status")).toContainText("已显示", { timeout: 90000 });
    await page.evaluate(() => window.__mmdCompanionRuntime.seekVmdFrame(688));
    if(skinMode)await checkSkin();
    if(materialMode) await checkMaterials();
    const on = await state(); expect(on.visible).toBe(true); expect(on.time).toBeCloseTo(on.characterTime, 6); expect(on.scale).toEqual(on.characterScale);
    await expect(page.getByRole("combobox", { name: "播放器骨骼模式", exact: true })).toHaveValue(playerMode);
    check("武器试播保留用户当前播放器模式", { playerMode });
    await canvasShot("stage-weapon-on"); await page.screenshot({ path: path.join(output, "controls-on.png"), fullPage: true });
    await toggle.click(); const off = await state(); expect(off.visible).toBe(false); expect(off.character).toBe(on.character); expect(off.clip).toBe(on.clip); expect(off.characterTime).toBe(on.characterTime);
    await canvasShot("stage-weapon-off"); await toggle.click(); const back = await state(); expect(back.mesh).toBe(on.mesh); expect(back.time).toBeCloseTo(on.time, 6);
    const images = await Promise.all(["stage-weapon-on", "stage-weapon-off"].map(name => sharp(path.join(output, name + ".png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
    expect(images[0].info).toEqual(images[1].info);
    let changedPixels = 0;
    for (let i = 0; i < images[0].data.length; i += 4) {
      if ([0, 1, 2, 3].some(channel => Math.abs(images[0].data[i + channel] - images[1].data[i + channel]) > 8)) changedPixels++;
    }
    expect(changedPixels, "可见武器必须实际改变同帧画面，不能只检查visible字段").toBeGreaterThan(500);
    expect(report.console.filter(row => /Shader Error|shader is not compiled|VALIDATE_STATUS false/.test(row.text))).toEqual([]);
    check("武器实际绘制且无着色器编译错误", { changedPixels, note: "像素必要条件不替代主会话实际看图" });
    check("真实按钮显示/隐藏/重显，保留人物模型、动作和当前帧", { on, off, back });
    for (const frame of [0, 2080, 1154.5, 688, 0]) {
      await page.evaluate(f => window.__mmdCompanionRuntime.seekVmdFrame(f), frame);
      const x = await state(); expect(x.time).toBeCloseTo(frame / 30, 5); expect(x.time).toBeCloseTo(x.characterTime, 6);
    }
    check("首帧、子帧、倒序跳帧共用时间轴");
    await page.evaluate(() => { const r = window.__mmdCompanionRuntime; r.setCalibrationCaptureMode(false); r.currentVmdAction.paused = true; });
    const paused = await state();
    await page.evaluate(() => new Promise(resolve => { let n = 0; const tick = () => ++n === 10 ? resolve() : requestAnimationFrame(tick); requestAnimationFrame(tick); }));
    expect((await state()).time).toBe(paused.time);
    await page.evaluate(() => { const r = window.__mmdCompanionRuntime; r.currentVmdPlaybackRate = 2; r.currentVmdAction.paused = false; });
    await expect.poll(async () => (await state()).characterTime, { timeout: 20000 }).toBeGreaterThan(paused.characterTime + .1);
    const playing = await state(); expect(playing.time).toBeCloseTo(playing.characterTime, 6);
    await page.evaluate(() => window.__mmdCompanionRuntime.setCalibrationCaptureMode(true)); check("暂停、恢复及倍率变化保持同步", { paused, playing });
    await page.getByRole("button", { name: /普通待机对照/ }).click();
    await expect.poll(async () => (await state()).mesh).toBeNull(); check("切换普通动作自动卸下配套武器");
    const weaponRoute = skinMode ? '**'+skinRoot+'weapon.pmx' : "**/stage-assets/koleda-inspect-weapon/weapon.pmx";
    await page.route(weaponRoute, route => route.fulfill({ status: 404, body: "本次缺失资源对照" }));
    await preview.click(); await expect(page.getByTestId("stage-weapon-status")).toContainText("加载失败", { timeout: 60000 });
    expect((await state()).url).toContain("/character.vmd"); expect((await state()).character).toBe(on.character);
    await page.unroute(weaponRoute); await page.getByRole("button", { name: "重试武器加载", exact: true }).click();
    await expect(page.getByTestId("stage-weapon-status")).toContainText("已显示", { timeout: 60000 }); check("武器404不破坏人物，实际重试按钮恢复");
    await page.setViewportSize({ width: 390, height: 844 }); await toggle.scrollIntoViewIfNeeded();
    const box = await toggle.boundingBox(); expect(box.width).toBeGreaterThan(80); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: path.join(output, "controls-narrow.png"), fullPage: true }); check("390像素窄屏按钮可见且可操作", { box });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: /普通待机对照/ }).click();
    let release; let pending = false;
    const hold = new Promise(resolve => { release = resolve; });
    await page.route(weaponRoute, async route => { pending = true; await hold; await route.continue(); });
    await preview.click(); await expect.poll(() => pending).toBe(true);
    await toggle.click(); await expect(page.getByTestId("stage-weapon-status")).toContainText("已隐藏");
    await toggle.click(); await expect(page.getByTestId("stage-weapon-status")).toContainText("正在加载");
    await page.getByRole("button", { name: /普通待机对照/ }).click();
    const pendingResponse = page.waitForResponse(response => response.url().endsWith("/weapon.pmx"));
    release(); await (await pendingResponse).finished(); await page.unroute(weaponRoute);
    await page.evaluate(() => new Promise(resolve => { let n = 0; const tick = () => ++n === 30 ? resolve() : requestAnimationFrame(tick); requestAnimationFrame(tick); }));
    expect((await state()).mesh).toBeNull(); check("延迟加载期间切换动作，过期武器不回挂");
    await preview.click(); await expect(page.getByTestId("stage-weapon-status")).toContainText("已显示", { timeout: 60000 });
    const disposal = await page.evaluate(() => {
      const r = window.__mmdCompanionRuntime, mesh = r.weapon.mesh; let disposed = false;
      mesh.geometry.addEventListener("dispose", () => { disposed = true; }); r.dispose();
      return { disposed, inScene: r.scene.children.includes(mesh), meshCleared: r.weapon.mesh === null };
    }); expect(disposal).toEqual({ disposed: true, inScene: false, meshCleared: true }); check("销毁舞台释放武器几何及场景引用", disposal);
    expect(report.errors).toEqual([]);
    expect(report.console.filter(row => /Shader Error|shader is not compiled|VALIDATE_STATUS false/.test(row.text))).toEqual([]);
    }
  }
  report.status = "passed";
} catch (error) {
  report.status = "failed"; report.errors.push(error.stack || String(error)); process.exitCode = 1;
  if (page) await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
} finally {
  clearTimeout(watchdog); await cleanup(); console.log(JSON.stringify({ output, status: report.status, checks: report.checks.map(x => x.name), errors: report.errors }, null, 2));
}
