import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {chromium} from '@playwright/test';
import sharp from 'sharp';
const output=path.resolve(process.argv[2]);fs.mkdirSync(output,{recursive:true});
const require=createRequire(import.meta.url),root=path.dirname(require.resolve('playwright-core/package.json'));
const executable=require(path.join(root,'lib/server/registry/index.js')).registry.findExecutable('chromium-headless-shell').executablePath();
const record={started:new Date().toISOString(),errors:[],command:process.argv,scope:'原帧姿态下实际PMX与原游戏角色绘制，统一黑色背景与同一颜色映射；不含完整场景后期'};
const browser=await chromium.launch({headless:true,executablePath:executable,args:['--use-angle=d3d11']});const timeout=setTimeout(()=>void browser.close(),180000);
try{
 let page=await browser.newPage({viewport:{width:1735,height:902},deviceScaleFactor:1});page.on('pageerror',e=>record.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')record.errors.push(m.text());});
 await page.goto('http://127.0.0.1:18748/?capture=1');await page.waitForFunction(()=>gf2Preview.state.ready||gf2Preview.state.errors.length,{},{timeout:90000});
 const pmx=await page.evaluate(async sourceShadows=>{
  const p=gf2Preview;p.setReferencePose(true);p.applyCapturedCamera();p.scene.background=null;p.renderer.setClearColor(0,0);p.renderer.setPixelRatio(1);p.renderer.setSize(3470,1803,false);p.camera.aspect=3470/1803;p.camera.updateProjectionMatrix();p.render();
  if(sourceShadows){
   const T=await import('/vendor/three/build/three.module.js'),m=await(await fetch('/game-assets/frame/frame.json')).json();
   for(const [i,id]of ['ResourceId::8076','ResourceId::8733'].entries()){
    const info=m.textures[id],words=new Uint16Array(await(await fetch('/game-assets/frame/'+info.subresources[0].file)).arrayBuffer());for(let j=0;j<words.length;j++)words[j]=65535-words[j];
    const texture=new T.DataTexture(words,info.width,info.height,T.DepthFormat,T.UnsignedShortType);texture.internalFormat='DEPTH_COMPONENT16';texture.compareFunction=T.LessCompare;texture.minFilter=texture.magFilter=T.LinearFilter;texture.needsUpdate=true;
    for(const object of p.materials.passMeshes)for(const u of Object.values((object.userData.gf2Material||object.material).uniforms||{}))if(u.value===p.materials.shadowMaps[i])u.value=texture;
   }
   p.render();
  }
  const gl=p.renderer.getContext();return {png:p.renderer.domElement.toDataURL().split(',')[1],events:[...new Set(p.materials.stats.passes.map(x=>x.eventId))],state:p.state,glError:gl.getError()};
 },process.argv.includes('--source-shadows'));
 record.sourceShadows=process.argv.includes('--source-shadows');
 fs.writeFileSync(path.join(output,'pmx.png'),Buffer.from(pmx.png,'base64'));delete pmx.png;record.pmx=pmx;await page.close();
 page=await browser.newPage({viewport:{width:1735,height:902},deviceScaleFactor:1});page.on('pageerror',e=>record.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')record.errors.push(m.text());});
 await page.goto('http://127.0.0.1:18748/frame.html?capture=1');await page.waitForFunction(()=>gf2Frame.state.ready||gf2Frame.state.errors.length,{},{timeout:90000});
 const reference=await page.evaluate(events=>{
  const r=gf2Frame.renderer,gl=r.gl;r.background=null;r.draws=r.draws.filter(d=>events.includes(d.eventId));r.render();
  const program=r.program(`#version 300 es
   precision highp float;out vec2 uv;void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`,
   `#version 300 es
   precision highp float;uniform sampler2D sceneColor;uniform sampler2D colorLut;in vec2 uv;out vec4 color;
   void main(){vec3 src=texture(sceneColor,uv).rgb;vec3 v=clamp(log2(max(src*5.55555582+.047996,vec3(.000001)))*.0734997839+.386036009,0.,1.);vec3 p=v*31.;float slice=floor(p.b);vec2 q=vec2((p.r+.5)/1024.+slice/32.,(p.g+.5)/32.);vec3 c=mix(texture(colorLut,q).rgb,texture(colorLut,q+vec2(1./32.,0.)).rgb,p.b-slice);c=mix(c*12.92,1.055*pow(max(c,0.),vec3(1./2.4))-.055,step(vec3(.0031308),c));color=vec4(c,1.);}`);
  r.canvas.width=r.width;r.canvas.height=r.height;gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,r.width,r.height);gl.disable(gl.DEPTH_TEST);gl.disable(gl.STENCIL_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.colorMask(true,true,true,true);gl.useProgram(program);gl.bindVertexArray(r.quad);
  for(const [unit,texture,name]of[[0,r.colors[0],'sceneColor'],[1,r.textures.get('ResourceId::8087').texture,'colorLut']]){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);gl.bindSampler(unit,null);gl.uniform1i(gl.getUniformLocation(program,name),unit);}
  gl.drawArrays(gl.TRIANGLES,0,3);gl.finish();const result={png:r.canvas.toDataURL().split(',')[1],events:r.draws.map(d=>d.eventId),glError:gl.getError()};gl.deleteProgram(program);return result;
 },pmx.events);
 fs.writeFileSync(path.join(output,'source.png'),Buffer.from(reference.png,'base64'));delete reference.png;record.source=reference;
 if(record.errors.length||pmx.glError||reference.glError)throw new Error('真实绘制存在错误');
 const a=await sharp(path.join(output,'source.png')).removeAlpha().raw().toBuffer({resolveWithObject:true}),b=await sharp(path.join(output,'pmx.png')).removeAlpha().raw().toBuffer({resolveWithObject:true});
 let sum=0,count=0,over10=0,minX=a.info.width,minY=a.info.height,maxX=0,maxY=0;
 for(let i=0;i<a.data.length;i+=3){if(Math.max(...a.data.subarray(i,i+3),...b.data.subarray(i,i+3))<5)continue;const delta=[0,1,2].map(j=>Math.abs(a.data[i+j]-b.data[i+j]));sum+=delta.reduce((s,v)=>s+v,0);count++;if(Math.max(...delta)>10)over10++;const x=i/3%a.info.width,y=Math.floor(i/3/a.info.width);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
 record.measurement={width:a.info.width,height:a.info.height,foregroundPixels:count,meanAbsoluteByteError:sum/(count*3),pixelsOver10:over10,bounds:[minX,minY,maxX-minX+1,maxY-minY+1]};
 const crop={left:minX,top:minY,width:maxX-minX+1,height:maxY-minY+1};const left=await sharp(path.join(output,'source.png')).extract(crop).png().toBuffer(),right=await sharp(path.join(output,'pmx.png')).extract(crop).png().toBuffer();
 await sharp({create:{width:crop.width*2,height:crop.height,channels:3,background:'#000000'}}).composite([{input:left,left:0,top:0},{input:right,left:crop.width,top:0}]).png().toFile(path.join(output,'comparison.png'));record.executionPassed=true;
}catch(e){record.failure=String(e.stack||e);record.executionPassed=false;process.exitCode=1;}
finally{clearTimeout(timeout);await browser.close();record.ended=new Date().toISOString();fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record));}
