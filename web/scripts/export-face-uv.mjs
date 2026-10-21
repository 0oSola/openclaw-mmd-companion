// 导出 Web 侧 Face 材质逐像素插值 UV（R=u, G=v），供 UV-direct 逐纹素对账。
// 与 export-face-mask.mjs 用同一 Face pick mask 隔离脸部像素。
import { chromium } from "playwright";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const CHROME_EXE = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.env.V14D_CAPTURE_BASE || "http://127.0.0.1:3000/mmd-calibration-render";
const OUT = path.resolve(".scratch/v14d-face-static/uv-align/web");
const KOLEDA_DIR = process.env.V14D_KOLEDA_DIR || "D:\\mmd\\克莱妲原皮";
const VMD = "C:\\w\\rk3-face-v14d\\web\\public\\assets\\mmd\\calibration\\koleda-v14d\\koleda-v14d-authoritative-pose-f120.vmd";
const FACE_D = path.join(KOLEDA_DIR, "Textures", "c_Koleda_slg_face_d.png");
fs.mkdirSync(OUT, { recursive: true });
function collectModelFiles(dir){ const out=[]; const walk=(d)=>{ for(const e of fs.readdirSync(d,{withFileTypes:true})){ const fp=path.join(d,e.name); if(e.isDirectory())walk(fp); else if(/\.(pmx|png|bmp|tga|spa|sph|jpg|jpeg)$/i.test(e.name))out.push(fp);} }; walk(dir); return out; }
const modelPaths = collectModelFiles(KOLEDA_DIR).filter((p)=>path.resolve(p)!==path.resolve(FACE_D));
const MIME={".png":"image/png",".bmp":"image/bmp",".pmx":"application/octet-stream",".vmd":"application/octet-stream",".spa":"application/octet-stream",".sph":"application/octet-stream",".tga":"application/octet-stream"};
const profile=fs.mkdtempSync(path.join(os.tmpdir(),"v14d-uv-"));
const context=await chromium.launchPersistentContext(profile,{executablePath:CHROME_EXE,headless:false,viewport:{width:640,height:640},args:["--enable-unsafe-webgpu","--window-position=-2000,-2000"]});
try{
  await context.route("**/*",(route)=>{ const url=route.request().url(); const m=url.match(/[?&]v14dasset=([^&]+)/); if(!m)return route.continue();
    const key=decodeURIComponent(m[1]);
    if(key==="__manifest__"){ const rels=modelPaths.map((p)=>path.relative(KOLEDA_DIR,p).replace(/\\/g,"/")); rels.push(path.relative(KOLEDA_DIR,"GirlsFrontline KoledaDefault.pmx").replace(/\\/g,"/")); return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({files:rels})}); }
    let fp=null; if(key==="pmx")fp=path.join(KOLEDA_DIR,"GirlsFrontline KoledaDefault.pmx"); else if(key==="vmd")fp=VMD; else fp=path.join(KOLEDA_DIR,key);
    if(fp&&fs.existsSync(fp)){ const ext=path.extname(fp).toLowerCase(); return route.fulfill({status:200,contentType:MIME[ext]||"application/octet-stream",body:fs.readFileSync(fp)}); }
    return route.fulfill({status:404,body:"missing"}); });
  const page=context.pages()[0]??(await context.newPage());
  await page.addInitScript(async()=>{ const R="http://v14d-asset.local/a"; const ff=async(key,rel)=>{ const r=await fetch(`${R}?v14dasset=${encodeURIComponent(key)}`); const b=await r.arrayBuffer(); const f=new File([b],key.split("/").pop()); if(rel)Object.defineProperty(f,"webkitRelativePath",{value:rel}); return f; };
    const man=await(await fetch(`${R}?v14dasset=__manifest__`)).json(); const modelFiles=[];
    for(const rel of man.files){ if(rel.toLowerCase().endsWith("c_koleda_slg_face_d.png"))continue; modelFiles.push(await ff(rel,rel)); }
    const pmxRel=man.files.find((r)=>r.toLowerCase().endsWith(".pmx")); const pmxFile=await ff(pmxRel,pmxRel); const vmdFile=await ff("vmd",null);
    const faceNormal=await ff("Textures/c_Koleda_slg_face_d.png","Textures/c_Koleda_slg_face_d.png");
    window.__v14dFaceStaticAssets={modelFiles,pmxFile,vmdFile,faceOverride:faceNormal,faceTextures:{normal:faceNormal}}; });
  const q=new URLSearchParams({modelUrl:"http://v14d-asset.local/a?v14dasset=pmx",vmdUrl:"http://v14d-asset.local/a?v14dasset=vmd",v14dFaceStatic:"1",v14dFaceMode:"uvDebug"});
  await page.goto(`${BASE}?${q}`,{waitUntil:"domcontentloaded",timeout:60000});
  await page.waitForSelector("canvas[data-webgpu-status='ready']",{timeout:120000});
  await page.waitForSelector("canvas[data-v14d-face-static='true']",{timeout:60000});
  await page.waitForTimeout(1200);
  const res = await page.evaluate(async()=>{ const api=window.__v14dFaceStatic; if(!api.exportFaceUvPng) return null; const r=await api.exportFaceUvPng(); if(!r) return null; return { png:r.png, width:r.width, height:r.height, faceMaterialId:r.faceMaterialId, uv:Array.from(r.uv), faceMask:Array.from(r.faceMask) }; });
  if(!res){ console.error("exportFaceUvPng 不存在或返回 null"); process.exitCode=1; }
  else {
    fs.writeFileSync(path.join(OUT,"web-face-uv.png"), Buffer.from(res.png,"base64"));
    fs.writeFileSync(path.join(OUT,"web-face-uv.float.json"), JSON.stringify({width:res.width,height:res.height,faceMaterialId:res.faceMaterialId,uv:res.uv,faceMask:res.faceMask}));
    console.log("uv exported (pre-tonemap HDR readback, float UV + mask json + preview png)");
  }
} finally { await context.close(); }
