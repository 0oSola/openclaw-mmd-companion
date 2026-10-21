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
const gf2Mode = process.argv.includes("--gf2");
const gf2Click = process.argv.includes("--gf2-click");
const gf2Arrival = process.argv.includes("--gf2-arrival");
const gf2LiveAssets = process.argv.includes("--gf2-live-assets");
const gf2ProductionAssets = gf2LiveAssets || process.argv.includes("--gf2-production-assets");
const gf2Chrome = process.argv.includes("--gf2-chrome");
const inspectFullMode = true;
const materialMode = process.argv.includes("--materials");
const api = `http://127.0.0.1:${apiPort}`, base = process.env.STAGE_WEAPON_EXISTING_WEB || `http://127.0.0.1:${webPort}`;
const files = ["web/src/app/companion/page.tsx", "web/src/features/stage/MMDStage.tsx", "web/src/features/stage/mmdCompanionRuntime.js", "web/src/features/stage/stageWeaponAttachment.js", "web/src/features/stage/koledaWeaponMaterials.js", "web/src/features/stage/stageWeaponPair.js", "web/src/features/stage/vmdSubframeCurves.js", "web/src/features/stage/v14dGameLocalOcioDisplay.js", "web/src/features/stage/stageRenderQuality.js", "web/src/features/stage/V14dGameControls.tsx"];
if (gf2Mode) files.push('web/src/features/stage/gf2CapturedMaterials.js', 'web/src/features/stage/gf2CapturedResourcePlan.js', 'web/src/features/stage/gf2CapturedResources.js', 'web/src/app/globals.css', 'web/src/features/stage/gf2StageAssets.js', 'web/src/features/stage/mmdPreparationData.js', 'web/src/features/stage/companionStagePreferences.js', 'api/app/routes/assets.py');
if (gf2Arrival) files.push('web/src/features/stage/CharacterArrivalParticles.tsx','web/src/features/stage/characterArrivalProjection.ts','web/src/features/stage/characterArrivalHologram.ts','web/src/features/stage/characterArrivalGeometryRenderer.ts','web/src/features/stage/characterArrivalGeometry.json','web/src/features/stage/characterArrivalOutline.json');
const snapshot = () => Object.fromEntries(files.map(file => [file, createHash("sha256").update(fs.readFileSync(path.join(repo, file))).digest("hex")]));
const report = { started: new Date().toISOString(), timezone: "Asia/Shanghai", command: process.argv, cwd: process.cwd(), checks: [], errors: [], processes: [], sources: snapshot(), authenticationEvents: "未核查", lockScreen: "无本轮锁屏证据", scope: "舞台双模型控制，不认证候选动作握持" };
report.scope = "正式舞台加载诊断；账户接口隔离，资源与运行时代码真实；软件绘制不外推用户GPU";
if (gf2Mode) report.scope = "GF2 mode 正式舞台选择、动作、相机、切换/刷新和资源恢复；账户数据隔离，PMX/VMD及资源路由真实";
report.cacheCondition = "Playwright路由启用，HTTP缓存禁用；刷新不是热缓存对照";
report.measurementEnd = "人物存在、当前无VMD加载、入场状态idle的首次观测；不等同于首次可见像素";
report.scriptSha256 = createHash("sha256").update(fs.readFileSync(fileURLToPath(import.meta.url))).digest("hex");
fs.copyFileSync(fileURLToPath(import.meta.url),path.join(output,"executed-script.mjs"));
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
try {
  const { registry } = require("playwright-core/lib/server/registry/index");
  const binary = gf2Chrome ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : registry.findExecutable("chromium-headless-shell").executablePath(); fs.accessSync(binary);
  report.browser = { playwright: require("playwright-core/package.json").version, expectedExecutable: binary };
  server = await chromium.launchServer({ headless: !gf2Chrome, executablePath: binary, args: gf2Mode ? ["--use-angle=d3d11"] : ["--enable-unsafe-swiftshader"], timeout: 30000 });
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
    if(gf2Click){
      const first=a07Assets.find(x=>x.asset_id==='inspect-full');
      Object.assign(first,{is_favorite:true,favorite_model_paths:[model.relative_path],url:first.url+'?favorite=inspect'});
      const entrance=catalog.find(x=>x.filename.startsWith('A03'));
      a07Assets.push({asset_id:'click-entrance',filename:'A03_favorite.vmd',display_name:'点击动作对照',user_id:'weapon-e2e',size_bytes:entrance.size_bytes,
        is_favorite:true,favorite_model_paths:[model.relative_path],url:api+'/assets/mmd/default-motions/'+encodeURIComponent(entrance.filename)+'?favorite=entrance'});
    }
    const context = await browser.newContext({ viewport: gf2Chrome ? { width: 1312, height: 746 } : { width: 1440, height: 1000 }, locale: "zh-CN", deviceScaleFactor: 1 });
    await context.addInitScript(({ modelPath, gf2 }) => {
      if (!localStorage.getItem("mmd_companion_session_v1")) localStorage.setItem("mmd_companion_session_v1", JSON.stringify({ userId: "weapon-e2e", selectedModelPath: modelPath, ttsEnabled: false }));
      if (!localStorage.getItem("mmd_companion_render_pipeline_v1:weapon-e2e")) localStorage.setItem("mmd_companion_render_pipeline_v1:weapon-e2e", gf2 ? "classic" : "v14d-game");
    }, { modelPath: model.relative_path, gf2: gf2Mode });
    await context.route("**/*", async route => {
      const u = new URL(route.request().url());
      if (![String(apiPort), "8100"].includes(u.port) && !u.pathname.startsWith("/api/backend/")) return route.continue();
      const endpoint = u.pathname.replace(/^\/api\/backend/, "");
      if (gf2Mode && endpoint.startsWith("/assets/gf2/")) {
        if (gf2ProductionAssets) return route.continue();
        const response = await route.fetch({ url: api + endpoint + u.search });
        return route.fulfill({ response });
      }
      if (endpoint === "/assets/mmd/models") return route.fulfill({ json: { items: [model] } });
      if(a07Files.has(endpoint))return route.fulfill({body:a07Files.get(endpoint),contentType:"application/octet-stream"});
      if (endpoint.startsWith("/assets/mmd/") || endpoint.startsWith("/assets/v14d-game/")) return route.continue();
      if (endpoint.includes("shared-config")) return route.fulfill({ json: { user_id: "weapon-e2e", selected_model_path: model.relative_path, render_pipeline: gf2Mode ? "classic" : "v14d-game", reze_stage_document: null } });
      if (endpoint.startsWith("/assets/vmd")) return route.fulfill({ json: { items: [idleAsset,...a07Assets] } });
      if (endpoint.startsWith("/config/mapping/resolved")) return route.fulfill({ json: { mappings: {} } });
      if (endpoint === "/sessions") return route.fulfill({ json: { items: [{ id: "weapon-session", title: "武器舞台检查" }] } });
      return route.fulfill({ json: { items: [], message: null, status: "ok", pending_count: 0, by_status: {} } });
    });
    page = await context.newPage(); page.on("pageerror", error => report.errors.push(error.stack || String(error)));
    report.console = [];
    page.on("console", message => { if (["error", "warning"].includes(message.type())) report.console.push({ type: message.type(), text: message.text() }); });
    if (gf2Mode) {
      const readyStage = async pipeline => {
        await page.waitForFunction(p => {
          const r = window.__mmdCompanionRuntime;
          return r?.renderPipeline === p && r.model && r.modelDisplayReady && !r.isLoadingVmd
            && (p !== 'gf2' || r.gf2Adapter) && document.querySelector('[data-character-arrival]')?.getAttribute('data-character-arrival') === 'idle';
        }, pipeline, { timeout: 120000 });
      };
      const selectMode = async name => {
        await page.getByRole('button', { name: '高级功能', exact: true })[gf2Click ? 'press' : 'click'](...(gf2Click ? ['Enter'] : []));
        await expect(page.getByRole('button',{name:'高级功能',exact:true})).toHaveAttribute('aria-expanded','true');
        await page.getByRole('radio', { name }).click();
      };
      const capture = async name => {
        const data = await page.evaluate(() => window.__mmdCompanionRuntime.capturePngDataUrl());
        fs.writeFileSync(path.join(output, name + '-canvas.png'), Buffer.from(data.split(',')[1], 'base64'));
        await page.screenshot({ path: path.join(output, name + '.png') });
      };
      await page.goto(base + '/companion', { waitUntil: 'domcontentloaded' });
      await readyStage('classic');
      let releaseMaterial;
      const materialHold=new Promise(resolve=>{releaseMaterial=resolve;});
      const heldRequests=[];
      const holdRoute=route=>{const task=(async()=>{await materialHold;await route.continue();})();heldRequests.push(task);return task;};
      if(gf2Arrival){
        report.measurementEnd='入场检查包含人为暂缓材质清单以观察全息，不作加载性能基线';
        await page.route('**/assets/gf2/frame/resource-packs.json',holdRoute);
        await page.evaluate(()=>{
          window.__gf2ArrivalEvidence=[];
          new MutationObserver(()=>{
            const e=document.querySelector('[data-character-arrival]'),p=document.querySelector('[data-character-particles]');
            const row={phase:e?.getAttribute('data-character-arrival'),style:p?.dataset.arrivalStyle,source:p?.dataset.outlineSource};
            const last=window.__gf2ArrivalEvidence.at(-1);
            if(row.phase&&(!last||row.phase!==last.phase||row.style!==last.style||row.source!==last.source))window.__gf2ArrivalEvidence.push({...row,at:performance.now()});
          }).observe(document,{subtree:true,attributes:true,attributeFilter:['data-character-arrival','data-arrival-style','data-outline-source']});
        });
      }
      const gf2Start=Date.now();await selectMode(/^GF2 mode/); await expect(page.locator('.mio-stage-status')).toBeVisible();
      if(gf2Arrival){
        try{
          await page.waitForFunction(()=>{const c=document.querySelector('[data-character-particles]');return c?.dataset.arrivalStyle==='hologram'&&Number(c.dataset.gatherStep)>=2;},null,{timeout:60000});
          const hologram=await page.evaluate(()=>{
            const c=document.querySelector('[data-character-particles]'),r=window.__mmdCompanionRuntime;
            const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let visible=0;
            for(let i=3;i<pixels.length;i+=4)if(pixels[i]>16)visible++;
            return {style:c.dataset.arrivalStyle,source:c.dataset.outlineSource,pose:c.dataset.outlinePose,step:c.dataset.gatherStep,visiblePixels:visible,
              png:c.toDataURL(),phase:document.querySelector('[data-character-arrival]').getAttribute('data-character-arrival'),
              modelScale:r.model.scale.toArray(),modelPosition:r.model.position.toArray(),modelDisplayReady:r.modelDisplayReady};
          });
          expect(hologram.style).toBe('hologram');expect(hologram.source).toBe('verified-model-preview');expect(hologram.pose).toMatch(/^L06_02_/);
          expect(hologram.modelScale).toEqual([.08,.08,.08]);expect(hologram.modelPosition).toEqual([0,0,0]);
          expect(hologram.modelDisplayReady).toBe(false);expect(hologram.visiblePixels).toBeGreaterThan(10000);
          fs.writeFileSync(path.join(output,'gf2-hologram-layer.png'),Buffer.from(hologram.png.split(',')[1],'base64'));delete hologram.png;
          await page.screenshot({path:path.join(output,'gf2-hologram.png')});
          check('GF2材质仍加载时绘制同身份L06人形全息，使用实际0.08模型矩阵',hologram);
          await page.waitForFunction(()=>Number(document.querySelector('[data-character-particles]')?.dataset.gatherStep)>=3);
          const later=await page.evaluate(()=>document.querySelector('[data-character-particles]').toDataURL());
          fs.writeFileSync(path.join(output,'gf2-hologram-later-layer.png'),Buffer.from(later.split(',')[1],'base64'));
          const before=await sharp(path.join(output,'gf2-hologram-layer.png')).ensureAlpha().raw().toBuffer();
          const after=await sharp(path.join(output,'gf2-hologram-later-layer.png')).ensureAlpha().raw().toBuffer();
          expect(after.length).toBe(before.length);let changed=0;
          for(let i=0;i<before.length;i+=4)if(Math.abs(before[i+3]-after[i+3])>3)changed++;
          expect(changed).toBeGreaterThan(1000);
          await page.screenshot({path:path.join(output,'gf2-hologram-later.png')});
          check('全息聚合在不同进度有实际像素变化',{changedPixels:changed});
        }finally{releaseMaterial();await Promise.all(heldRequests);await page.unroute('**/assets/gf2/frame/resource-packs.json',holdRoute);}
        await page.waitForFunction(()=>document.querySelector('[data-character-arrival]')?.getAttribute('data-character-arrival')==='entrance',null,{timeout:90000});
        await expect(page.locator('.mio-stage-canvas')).toHaveCSS('opacity','1');
        await page.screenshot({path:path.join(output,'gf2-entrance.png')});
        expect(await page.evaluate(()=>window.__mmdCompanionRuntime.currentVmdUrl)).toContain('/A03_');
      }
      await readyStage('gf2');
      if(gf2Arrival){
        const phases=await page.evaluate(()=>window.__gf2ArrivalEvidence);
        const sequence=phases.map(x=>x.phase);let cursor=-1;
        for(const phase of ['loading','entrance-loading','entrance','idle']){cursor=sequence.indexOf(phase,cursor+1);expect(cursor).toBeGreaterThanOrEqual(0);}
        expect(await page.locator('[data-character-particles]').count()).toBe(0);
        check('全息聚合、实体显现、A03与待机顺序完整，结束后释放投影画布',{phases});
      }
      report.gf2ReadyMs=Date.now()-gf2Start;
      const installed = await page.evaluate(() => {
        const r = window.__mmdCompanionRuntime, gl = r.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
        return { pipeline: r.renderPipeline, scale: r.model.scale.toArray(), position: r.model.position.toArray(),
          bound: r.gf2Adapter.stats.bound.length, passes: r.gf2Adapter.stats.passes, uv: r.model.geometry.getAttribute('gf2Uv').count,
          vertices: r.model.geometry.attributes.position.count, camera: r.getCameraSnapshot(), memory: r.renderer.info.memory,
          timings:r.gf2Adapter.stats.timings, referencePose: r.gf2Adapter.stats.referencePose, gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
          glError: gl.getError(), assetUrls: performance.getEntriesByType('resource').filter(x => x.name.includes('/assets/gf2/')).map(x => x.name) };
      });
      expect(installed.bound).toBe(26); expect(installed.uv).toBe(60352); expect(installed.vertices).toBe(60352);
      expect(installed.scale).toEqual([.08,.08,.08]); expect(installed.position).toEqual([0,0,0]); expect(installed.referencePose).toBe(false);
      expect(installed.camera.fov).toBe(40); expect(installed.glError).toBe(0);
      expect(installed.passes.some(x => x.eventId === 2685)).toBe(true);
      expect(installed.assetUrls.length).toBe(installed.timings.requestCount); expect(installed.timings.requestCount).toBe(28); expect(installed.assetUrls.every(x => !x.includes(':18748'))).toBe(true);
      check('正式舞台GF2 mode使用原坐标、26分区、面部多遍及正式资源入口', installed);
      await capture('gf2-initial');
      const rgba=await sharp(path.join(output,'gf2-initial-canvas.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      expect(rgba.data[3]).toBe(0);
      let covered=0;for(let i=3;i<rgba.data.length;i+=4)if(rgba.data[i]===255)covered++;
      expect(covered).toBeGreaterThan(1000);
      expect(await page.locator('.mio-hud').evaluate(e=>getComputedStyle(e).backgroundImage)).toContain('frontline-room.jpg');
      check('frontline同类透明画布保留页面背景，人物主体覆盖率不透明',{opaquePixels:covered,readyMs:report.gf2ReadyMs});
      if(gf2Click){
        const selectIdle=async()=>{
          await page.getByRole('button',{name:'高级功能',exact:true})[gf2Click ? 'press' : 'click'](...(gf2Click ? ['Enter'] : []));
          await page.getByRole('button',{name:/普通待机对照/}).click();
          await page.waitForFunction(()=>!window.__mmdCompanionRuntime.isLoadingVmd&&window.__mmdCompanionRuntime.currentVmdUrl.includes('L02_02'));
          await page.getByRole('button',{name:'高级功能',exact:true})[gf2Click ? 'press' : 'click'](...(gf2Click ? ['Enter'] : []));
        };
        const chest=()=>page.evaluate(()=>{
          const r=window.__mmdCompanionRuntime,b=r.model.skeleton.bones.find(x=>x.name==='上半身'),v=r.model.position.clone(),rect=r.renderer.domElement.getBoundingClientRect();
          b.getWorldPosition(v);v.project(r.camera);return {x:rect.left+(v.x+1)*rect.width/2,y:rect.top+(1-v.y)*rect.height/2};
        });
        await selectIdle();
        const hit=await page.evaluate(()=>{
          const r=window.__mmdCompanionRuntime,b=r.model.skeleton.bones.find(x=>x.name==='上半身'),v=r.model.position.clone(),rect=r.renderer.domElement.getBoundingClientRect();
          b.getWorldPosition(v);v.project(r.camera);const x=rect.left+(v.x+1)*rect.width/2,y=rect.top+(1-v.y)*rect.height/2,t=performance.now();
          return {hit:r.hitTestModelAtClientPoint(x,y),ms:performance.now()-t,passes:r.gf2Adapter.passMeshes.length};
        });
        expect(hit.hit).toBe(true);expect(hit.ms).toBeLessThan(500);
        const background=await page.evaluate(()=>{
          const r=window.__mmdCompanionRuntime,rect=r.renderer.domElement.getBoundingClientRect();
          for(const u of [.15,.85,.7]){const x=rect.left+u*rect.width,y=rect.top+rect.height*.65;
            if(document.elementFromPoint(x,y)?.closest('.mio-stage')&&!r.hitTestModelAtClientPoint(x,y))return {x,y};}
          return null;
        });
        expect(background).not.toBeNull();
        let start=await page.evaluate(()=>window.__mmdCompanionRuntime.currentVmdStartedAt);
        await page.mouse.click(background.x,background.y);
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        expect(await page.evaluate(()=>window.__mmdCompanionRuntime.currentVmdStartedAt)).toBe(start);
        const p=await chest(),camera=await page.evaluate(()=>window.__mmdCompanionRuntime.getCameraSnapshot());
        await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+65,p.y+6,{steps:8});await page.mouse.up();
        expect(await page.evaluate(()=>window.__mmdCompanionRuntime.currentVmdStartedAt)).toBe(start);
        await page.evaluate(camera=>window.__mmdCompanionRuntime.applyCameraSnapshot(camera),camera);
        const urls=[];
        for(let i=0;i<2;i++){
          const p=await chest();await page.mouse.click(p.x,p.y);
          await page.waitForFunction(()=>!window.__mmdCompanionRuntime.isLoadingVmd&&window.__mmdCompanionRuntime.currentVmdUrl.includes('?favorite='),null,{timeout:15000});
          const playing=await page.evaluate(()=>({url:window.__mmdCompanionRuntime.currentVmdUrl,start:window.__mmdCompanionRuntime.currentVmdStartedAt,time:window.__mmdCompanionRuntime.currentVmdAction.time}));
          urls.push(playing.url);await page.waitForFunction(t=>window.__mmdCompanionRuntime.currentVmdAction.time>t+.15,playing.time);
          const again=await chest();await page.mouse.click(again.x,again.y);
          expect(await page.evaluate(()=>window.__mmdCompanionRuntime.currentVmdStartedAt)).toBe(playing.start);
          await capture('gf2-click-'+i);
          await page.waitForFunction(()=>!window.__mmdCompanionRuntime.isLoadingVmd&&!window.__mmdCompanionRuntime.currentVmdUrl.includes('?favorite='),null,{timeout:25000});
        }
        expect(urls[0]).not.toBe(urls[1]);
        check('人物点击快速命中并播放收藏动作，重复点击不重启，结束后恢复且下次换动作',{hit,urls});
        check('点击背景和拖动人物不触发动作');
      }
      await page.getByRole('button', { name: '高级功能', exact: true })[gf2Click ? 'press' : 'click'](...(gf2Click ? ['Enter'] : []));
      await page.getByRole('button', { name: /专属查看完整单VMD/ }).click();
      await page.waitForFunction(() => { const r=window.__mmdCompanionRuntime; return !r.isLoadingVmd && r.currentVmdUrl.includes('inspect-full') && r.currentVmdAction?.time > .1; }, null, { timeout: 90000 });
      const first = await page.evaluate(() => window.__mmdCompanionRuntime.currentVmdAction.time);
      await page.waitForFunction(t => window.__mmdCompanionRuntime.currentVmdAction.time > t + .2, first);
      check('正式动作按钮播放真实VMD且时间推进', { first });
      await expect(page.getByTestId('stage-weapon-status')).toContainText('已显示', { timeout: 90000 });
      const weapon = await page.evaluate(() => {
        const r=window.__mmdCompanionRuntime, w=r.weapon;
        return { visible:w.mesh.visible, names:w.mesh.material.map(m=>m.name), surfaces:w.mesh.material.map(m=>m.userData.weaponSurface),
          normals:w.mesh.material.every(m=>m.normalMap), orm:w.mesh.material.every(m=>m.roughnessMap&&m.metalnessMap&&m.aoMap),
          ramp:w.mesh.material.every(m=>m.weaponRampMap), reflection:!!w.mesh.__weaponEnvironmentTarget, outline:!!w.mesh.__weaponOutline,
          lightCount:r.v14dGameLights.length, lightScale:r.v14dGameLightMapping.scaleRatio,
          characterTime:r.currentVmdAction.time, weaponTime:w.action.time, scale:w.mesh.scale.toArray() };
      });
      expect(weapon.names).toEqual(['body','muzzle','scope','grip','light']);
      for (const key of ['visible','normals','orm','ramp','reflection','outline']) expect(weapon[key]).toBe(true);
      expect(weapon.lightCount).toBe(6); expect(weapon.lightScale).toBe(1); expect(weapon.scale).toEqual([.08,.08,.08]);
      expect(Math.abs(weapon.characterTime-weapon.weaponTime)).toBeLessThan(.04);
      await page.getByRole('button', { name:'显示武器', exact:true }).click();
      await page.waitForFunction(()=>!window.__mmdCompanionRuntime.weapon.mesh.visible);
      await page.getByRole('button', { name:'显示武器', exact:true }).click();
      await page.waitForFunction(()=>window.__mmdCompanionRuntime.weapon.mesh.visible);
      check('保留v14d武器五分区、贴图/渐变/反射/描边、六灯、同步动作与显示开关', weapon);
      await page.getByRole('button', { name: '高级功能', exact: true })[gf2Click ? 'press' : 'click'](...(gf2Click ? ['Enter'] : []));
      await capture('gf2-motion');
      if (gf2LiveAssets) {
        const setup = await page.evaluate(() => {
          const r=window.__mmdCompanionRuntime;
          r.weapon.setEnabled(false); r.resetCameraToDefault(); r.scene.background=r.v14dGameLights[0].color.clone().set('#252a2e');r.gf2Adapter.setReferencePose(true); r.renderScene();
          return { width:r.renderer.domElement.width,height:r.renderer.domElement.height, fov:r.camera.fov,
            near:r.camera.near,far:r.camera.far,position:r.camera.position.toArray(),target:r.controls.target.toArray(),
            png:r.capturePngDataUrl() };
        });
        fs.writeFileSync(path.join(output,'stage-reference.png'),Buffer.from(setup.png.split(',')[1],'base64'));
        const reference=await context.newPage();
        await reference.goto('http://127.0.0.1:18748/',{waitUntil:'domcontentloaded'});
        await reference.waitForFunction(()=>window.gf2Preview?.state.ready,null,{timeout:90000});
        const referencePng=await reference.evaluate(s=>{
          const p=window.gf2Preview;p.setReferencePose(true);p.camera.fov=s.fov;p.camera.near=s.near;p.camera.far=s.far;
          p.camera.position.fromArray(s.position);p.controls.target.fromArray(s.target);p.controls.update();
          p.renderer.setPixelRatio(1);p.renderer.setSize(s.width,s.height,false);p.camera.aspect=s.width/s.height;p.camera.updateProjectionMatrix();p.render();return p.renderer.domElement.toDataURL();
        },setup);
        fs.writeFileSync(path.join(output,'preview-reference.png'),Buffer.from(referencePng.split(',')[1],'base64'));
        await reference.close();
        const a=await sharp(path.join(output,'stage-reference.png')).removeAlpha().raw().toBuffer();
        const b=await sharp(path.join(output,'preview-reference.png')).removeAlpha().raw().toBuffer();
        expect(a.length).toBe(b.length);let sum=0,changed=0,max=0;
        for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);sum+=d;max=Math.max(max,d);if(d)changed++;}
        check('正式GF2与原预览同机位/同姿态/同尺寸对照', { meanChannelError:sum/a.length,changedChannels:changed,maxChannelError:max,width:setup.width,height:setup.height });
        await page.evaluate(()=>{const r=window.__mmdCompanionRuntime;r.scene.background=null;r.gf2Adapter.setReferencePose(false);r.weapon.setEnabled(true);r.renderScene()});
      } else {
      const cameraBefore = await page.evaluate(() => window.__mmdCompanionRuntime.getCameraSnapshot());
      await page.evaluate(() => { const c = window.__mmdCompanionRuntime.renderer.domElement; c.dataset.gf2TestCanvas = 'true'; });
      const box = await page.locator('[data-gf2-test-canvas]').boundingBox();
      await page.mouse.move(box.x + box.width * .48, box.y + box.height * .4); await page.mouse.down();
      await page.mouse.move(box.x + box.width * .65, box.y + box.height * .43, { steps: 12 }); await page.mouse.up();
      await page.waitForFunction(before => JSON.stringify(window.__mmdCompanionRuntime.getCameraSnapshot().position) !== JSON.stringify(before), cameraBefore.position);
      check('舞台鼠标拖动旋转相机'); await capture('gf2-rotated');
      await selectMode(/^Classic/); await readyStage('classic');
      expect(await page.evaluate(() => !!window.__mmdCompanionRuntime.gf2Adapter)).toBe(false);
      await selectMode(/^GF2 mode/); await readyStage('gf2');
      await page.reload({ waitUntil: 'domcontentloaded' }); await readyStage('gf2');
      check('切回Classic再进入GF2，刷新保持GF2选择');
      const beforeFailure = report.console.length;
      await page.route('**/assets/gf2/frame/resource-packs.json', route => route.fulfill({ status: 404, body: 'missing' }));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('alert').filter({ hasText: '抓帧资源 resource-packs.json 返回 404' }).first()).toBeVisible({ timeout: 90000 });
      await page.screenshot({ path: path.join(output,'gf2-missing.png') });
      await page.unroute('**/assets/gf2/frame/resource-packs.json');
      await page.getByRole('button', { name: '重新加载角色', exact:true }).first().click(); await readyStage('gf2');
      report.expectedFailureConsole = report.console.splice(beforeFailure);
      check('GF2资源缺失可见报错，恢复后正式重试按钮成功'); await capture('gf2-final');
      }
      expect(report.errors).toEqual([]);
      expect(report.console.filter(x=>x.type === 'error' && /THREE.WebGLProgram|Shader Error|INVALID_OPERATION/.test(x.text))).toEqual([]);
    } else {
    await context.addInitScript(() => {
      const d=window.__loadDiagnostic={spans:[],marks:[],longTasks:[],uploads:[],skippedDraws:0,deferDraw:sessionStorage.getItem('diagnosticDeferDraw')==='true'};
      const upload=WebGL2RenderingContext.prototype.texSubImage2D;
      WebGL2RenderingContext.prototype.texSubImage2D=function(...a){const start=performance.now();try{return upload.apply(this,a)}finally{const duration=performance.now()-start;if(duration>2)d.uploads.push({start,duration,width:a.length>=9?a[4]:a.at(-1)?.width||null,height:a.length>=9?a[5]:a.at(-1)?.height||null,appearance:window.__mmdCompanionRuntime?.appearanceAdapter?.getStatus()?.phase});}};
      performance.setResourceTimingBufferSize(3000);
      new PerformanceObserver(list=>{for(const x of list.getEntries())d.longTasks.push({start:x.startTime,duration:x.duration});}).observe({type:'longtask',buffered:true});
      const mark=(name,extra={})=>d.marks.push({name,t:performance.now(),...extra});
      const wrap=(obj,key,label,max=500)=>{if(!obj||typeof obj[key]!=='function'||obj[key].__loadWrapped)return;const f=obj[key];let n=0;const g=function(...args){if(++n>max)return f.apply(this,args);const row={name:label,start:performance.now()};d.spans.push(row);const end=()=>{row.end=performance.now();row.duration=row.end-row.start;};try{const v=f.apply(this,args);if(v&&typeof v.then==='function')return v.then(x=>{end();return x},e=>{row.error=String(e);end();throw e});end();return v;}catch(e){row.error=String(e);end();throw e;}};g.__loadWrapped=true;obj[key]=g;};
      let value;
      Object.defineProperty(window,'__mmdCompanionRuntime',{configurable:true,get(){return value},set(r){value=r;if(!r)return;mark('runtime-created');
        for(const key of ['init','ensureV14dGameManifest','setupScene','loadModel','captureBones','configureV14dGameLights','playVmd','startRenderLoop'])wrap(r,key,'runtime.'+key);
        wrap(r.appearanceAdapter,'install','appearance.install');
        const instrumentLoader=(l,prefix)=>{if(!l)return;wrap(l._getParser(),'parsePmx',prefix+'.parsePmx');wrap(l._getParser(),'parseVmd',prefix+'.parseVmd');wrap(l.meshBuilder,'build',prefix+'.meshBuild');wrap(l.meshBuilder?.geometryBuilder,'build',prefix+'.geometryBuild');wrap(l.meshBuilder?.materialBuilder,'build',prefix+'.materialBuild');wrap(l.animationBuilder,'build',prefix+'.animationBuild');};
        instrumentLoader(r.loader,'character');instrumentLoader(r.weapon?.loader,'weapon');wrap(r.helper,'add','helper.add');
        const draw=r.renderScene;r.renderScene=function(...args){if(d.deferDraw&&this.model&&this.appearanceAdapter?.getStatus()?.phase!=='ready'){d.skippedDraws++;return;}return draw.apply(this,args)};
        const setup=r.setupScene;r.setupScene=function(...args){const v=setup.apply(this,args);wrap(this.renderer,'compile','renderer.compile',10);return v;};
        const status=r.setStatus;r.setStatus=function(...args){mark('status',{text:String(args[0])});return status.apply(this,args)};
      }});
      let last='';const tick=()=>{const r=window.__mmdCompanionRuntime;const state=JSON.stringify({model:!!r?.model,loading:!!r?.isLoadingVmd,arrival:document.querySelector('[data-character-arrival]')?.getAttribute('data-character-arrival')});if(state!==last){mark('state',{state});last=state;}requestAnimationFrame(tick)};requestAnimationFrame(tick);
    });
    report.runs=[];
    const cdp=await context.newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});
    for(const name of (process.argv.includes('--defer-experiment')?['first','refresh','deferred','control-after']:['first','refresh'])){
      if(name!=='first')await page.evaluate(defer=>sessionStorage.setItem('diagnosticDeferDraw',String(defer)),name==='deferred');
      await cdp.send('Profiler.start');
      if(name==='first')await page.goto(base+'/companion',{waitUntil:'domcontentloaded'});else await page.reload({waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.__mmdCompanionRuntime?.model&&!window.__mmdCompanionRuntime.isLoadingVmd&&document.querySelector('[data-character-arrival]')?.getAttribute('data-character-arrival')==='idle',null,{timeout:180000});
      const profile=await cdp.send('Profiler.stop');fs.writeFileSync(path.join(output,name+'.cpuprofile'),JSON.stringify(profile.profile));
      const data=await page.evaluate(()=>{const r=window.__mmdCompanionRuntime,gl=r.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {...window.__loadDiagnostic,now:performance.now(),navigation:performance.getEntriesByType('navigation').map(x=>x.toJSON()),resources:performance.getEntriesByType('resource').map(x=>x.toJSON()),gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,model:{vertices:r.model.geometry.attributes.position.count,bones:r.model.skeleton.bones.length},arrival:document.querySelector('[data-character-arrival]')?.getAttribute('data-character-arrival')};});
      fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify(data,null,2));report.runs.push({name,readyMs:data.now,longTasks:data.longTasks.length});
      await page.screenshot({path:path.join(output,name+'.png')});console.log('LOAD',name,data.now);
    }
    await page.getByRole('button',{name:'高级功能',exact:true})[gf2Click ? 'press' : 'click'](...(gf2Click ? ['Enter'] : []));
    await page.evaluate(()=>{window.__loadDiagnostic.spans=[];window.__loadDiagnostic.marks=[];window.__loadDiagnostic.longTasks=[];performance.clearResourceTimings();window.__loadDiagnostic.actionStart=performance.now()});
    await cdp.send('Profiler.start');await page.getByRole('button',{name:/专属查看完整单VMD/}).click();
    await expect(page.getByTestId('stage-weapon-status')).toContainText('已显示',{timeout:90000});
    await page.waitForFunction(()=>!window.__mmdCompanionRuntime.isLoadingVmd);
    const actionProfile=await cdp.send('Profiler.stop');fs.writeFileSync(path.join(output,'action.cpuprofile'),JSON.stringify(actionProfile.profile));
    const action=await page.evaluate(()=>({...window.__loadDiagnostic,now:performance.now(),resources:performance.getEntriesByType('resource').map(x=>x.toJSON())}));fs.writeFileSync(path.join(output,'action.json'),JSON.stringify(action,null,2));
    await page.screenshot({path:path.join(output,'action.png')});check('首访、刷新和实际动作切换分段数据已保存');
    }
  }
  report.status='passed';
}catch(error){report.status='failed';report.errors.push(error.stack||String(error));process.exitCode=1;if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});}
finally{clearTimeout(watchdog);await cleanup();console.log(JSON.stringify({output,status:report.status,runs:report.runs,errors:report.errors},null,2));}
