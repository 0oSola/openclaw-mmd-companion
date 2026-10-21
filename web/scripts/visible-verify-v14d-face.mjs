// 真实可见浏览器复验：非 headless Chrome，用户视角直接打开静态预览。
// 注入权威资产（同 capture），逐模式截图验证角色可见 + 徽章 + 无 4xx/5xx。
import { chromium } from "playwright";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.env.V14D_CAPTURE_BASE || "http://127.0.0.1:3100/mmd-calibration-render";
const OUT = path.resolve(".scratch/v14d-face-static/visible-verify");
const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || "D:\\mmd\\克莱妲原皮";
const PMX = path.join(KOLEDA_DIR, "GirlsFrontline KoledaDefault.pmx");
const VMD = "C:\\w\\rk3-face-v14d\\web\\public\\assets\\mmd\\calibration\\koleda-v14d\\koleda-v14d-authoritative-pose-f120.vmd";
const DERIVED_DIR = "C:\\w\\rk3-face-v14d\\.scratch\\v14d-face-static-derived";
const FACE_D = path.join(KOLEDA_DIR, "Textures", "c_Koleda_slg_face_d.png");
fs.mkdirSync(OUT, { recursive: true });
function collectModelFiles(dir){ const out=[]; const walk=(d)=>{ for(const e of fs.readdirSync(d,{withFileTypes:true})){ const fp=path.join(d,e.name); if(e.isDirectory())walk(fp); else if(/\.(pmx|png|bmp|tga|spa|sph|jpg|jpeg)$/i.test(e.name))out.push(fp);} }; walk(dir); return out; }
const modelPaths = collectModelFiles(KOLEDA_DIR).filter((p)=>path.resolve(p)!==path.resolve(FACE_D));
const DERIVED_FILE = { finalFaceComposite:"v14d-face-composite-state2.png", faceShadowOnly:"v14d-face-shadow-attenuation-state2.png", normal:null };
const MIME={".png":"image/png",".bmp":"image/bmp",".pmx":"application/octet-stream",".vmd":"application/octet-stream",".spa":"application/octet-stream",".sph":"application/octet-stream",".tga":"application/octet-stream"};
const report={modes:{},console404:[],httpBad:[],pageErrors:[]};
for(const mode of ["normal","faceShadowOnly","finalFaceComposite"]){
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),"v14d-visible-"));
  const context=await chromium.launchPersistentContext(profile,{executablePath:CHROME_EXE,headless:false,viewport:{width:760,height:760},deviceScaleFactor:1,args:["--enable-unsafe-webgpu"]});
  try{
    await context.route("**/*",(route)=>{ const url=route.request().url(); const m=url.match(/[?&]v14dasset=([^&]+)/); if(!m)return route.continue();
      const key=decodeURIComponent(m[1]);
      if(key==="__manifest__"){ const rels=modelPaths.map((p)=>path.relative(KOLEDA_DIR,p).replace(/\\/g,"/")); rels.push(path.relative(KOLEDA_DIR,PMX).replace(/\\/g,"/")); return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({files:rels})}); }
      let fp=null; if(key==="pmx")fp=PMX; else if(key==="vmd")fp=VMD; else if(key.startsWith("__derived__/"))fp=path.join(DERIVED_DIR,key.slice(12)); else fp=path.join(KOLEDA_DIR,key);
      if(fp&&fs.existsSync(fp)){ const ext=path.extname(fp).toLowerCase(); return route.fulfill({status:200,contentType:MIME[ext]||"application/octet-stream",body:fs.readFileSync(fp)}); }
      return route.fulfill({status:404,body:"missing "+key}); });
    const page=context.pages()[0]??(await context.newPage());
    page.on("pageerror",(e)=>report.pageErrors.push(String(e?.stack||e)));
    page.on("response",(r)=>{const s=r.status(); if(s>=400)report.httpBad.push({url:r.url(),status:s});});
    page.on("console",(msg)=>{ if(msg.type()==="error"&&/404|Failed to load/i.test(msg.text())) report.console404.push(msg.text()); });
    await page.addInitScript(async(payload)=>{ const fetchFile=async(key,rel,mime)=>{ const resp=await fetch(`${payload.route}?v14dasset=${encodeURIComponent(key)}`); if(!resp.ok)throw new Error(`asset ${key} -> ${resp.status}`); const buf=await resp.arrayBuffer(); const f=new File([buf],key.split("/").pop(),{type:mime||"application/octet-stream"}); if(rel)Object.defineProperty(f,"webkitRelativePath",{value:rel}); return f; };
      const manifest=await(await fetch(`${payload.route}?v14dasset=__manifest__`)).json();
      const modelFiles=[]; for(const rel of manifest.files){ if(rel.toLowerCase().endsWith("c_koleda_slg_face_d.png"))continue; modelFiles.push(await fetchFile(rel,rel)); }
      const pmxRel=manifest.files.find((r)=>r.toLowerCase().endsWith(".pmx")); const pmxFile=await fetchFile(pmxRel,pmxRel); const vmdFile=await fetchFile("vmd",null);
      let faceOverride=null; if(payload.faceRel)faceOverride=await fetchFile(payload.faceKey,payload.faceRel);
      window.__v14dFaceStaticAssets={modelFiles,pmxFile,vmdFile,faceOverride}; },
      {route:"http://v14d-asset.local/a",faceKey:mode==="normal"?"Textures/c_Koleda_slg_face_d.png":`__derived__/${DERIVED_FILE[mode]}`,faceRel:"Textures/c_Koleda_slg_face_d.png"});
    const modelUrl="http://v14d-asset.local/a?v14dasset=pmx"; const vmdUrl="http://v14d-asset.local/a?v14dasset=vmd";
    const q=new URLSearchParams({modelUrl,vmdUrl,v14dFaceStatic:"1",v14dFaceMode:mode});
    await page.goto(`${BASE}?${q.toString()}`,{waitUntil:"domcontentloaded",timeout:60000});
    await page.waitForSelector("canvas[data-webgpu-status='ready']",{timeout:120000});
    await page.waitForSelector("canvas[data-v14d-face-static='true']",{timeout:120000});
    await page.waitForTimeout(1500);
    // 画布非全白 + 徽章文本
    const vis=await page.evaluate(async()=>{ const c=document.querySelector("canvas"); const badge=document.querySelector("[data-testid='v14d-face-static-badge']"); const api=window.__v14dFaceStatic; const roi=api?await api.capture():null;
      return {badge:badge?badge.textContent:null, meanLinear:roi?.meanLinear||null, faceSamples:roi?.roi?.faceSamples||0, ds:{static:c.dataset.v14dFaceStatic,mode:c.dataset.v14dFaceStaticMode,frame:c.dataset.v14dFaceStaticFrame,state:c.dataset.v14dFaceStaticState,blend:c.dataset.v14dFaceStaticBlend,locked:c.dataset.v14dFaceStaticCameraLocked,paused:c.dataset.v14dFaceStaticPaused}}; });
    await page.screenshot({path:path.join(OUT,`visible-${mode}.png`)});
    report.modes[mode]=vis;
    console.log(`[visible] ${mode} faceSamples=${vis.faceSamples} badge=${vis.badge?vis.badge.split("\n")[0]:"(none)"}`);
  } finally { await context.close(); }
}
fs.writeFileSync(path.join(OUT,"visible-report.json"),JSON.stringify(report,null,2));
// 硬断言门禁：任一失败 exit 1。
const MIN_FACE_SAMPLES=1000; const fails=[];
for(const mode of ["normal","faceShadowOnly","finalFaceComposite"]){
  const m=report.modes[mode];
  if(!m){ fails.push(`${mode}: 无结果`); continue; }
  if(!m.badge||!/V14D Static Golden Frame/.test(m.badge)) fails.push(`${mode}: 徽章缺失`);
  if(m.ds.static!=="true"||m.ds.mode!==mode) fails.push(`${mode}: 状态不一致 ${JSON.stringify(m.ds)}`);
  if(m.ds.frame!=="120"||m.ds.state!=="2"||m.ds.blend!=="0.00") fails.push(`${mode}: 帧状态错误`);
  if(m.ds.locked!=="true"||m.ds.paused!=="true") fails.push(`${mode}: 未锁定/暂停`);
  if((m.faceSamples??0)<MIN_FACE_SAMPLES) fails.push(`${mode}: faceSamples 不足 (${m.faceSamples})`);
}
if(report.pageErrors.length) fails.push("pageErrors="+report.pageErrors.length);
if(report.httpBad.length) fails.push("httpBad="+report.httpBad.length);
if(report.console404.length) fails.push("console404="+report.console404.length);
console.log("===VISIBLE-DONE=== httpBad="+report.httpBad.length+" console404="+report.console404.length+" pageErrors="+report.pageErrors.length);
if(fails.length){ console.error("===VISIBLE-GATE-FAIL===\n"+fails.join("\n")); process.exit(1); }
console.log("===VISIBLE-GATE-OK===");
