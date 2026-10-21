const short=value=>value.split('.').at(-1);
const QUAD=`#version 300 es
precision highp float;
out vec2 uv;
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`;
const DISPLAY=`#version 300 es
precision highp float;
uniform sampler2D source;uniform bool srgb;uniform bool flipY;in vec2 uv;out vec4 color;
void main(){vec2 p=vec2(uv.x,flipY?1.-uv.y:uv.y);vec3 c=texture(source,p).rgb;if(srgb)c=mix(c*12.92,1.055*pow(max(c,0.),vec3(1./2.4))-.055,step(vec3(.0031308),c));color=vec4(c,1.);}`;

// WebGL 在链接时计数采样器声明；链接后的 uniform1i 共用单元不能解除声明数量限制。
// 仅合并本帧同一资源、同一采样方式的后期声明，保留不同过滤/寻址方式。
function coalescePostSamplers(source,resolve){
 const shared=new Map();
 for(const match of [...source.matchAll(/uniform highp (sampler\w+) (SPIRV_Cross_Combinedt(\d+)s(\d+));/g)]){
  const key=JSON.stringify([match[1],...resolve(+match[3],+match[4])]),alias=shared.get(key);
  if(alias)source=source.replace(match[0],'').replace(new RegExp(`\\b${match[2]}\\b`,'g'),alias);
  else shared.set(key,match[2]);
 }
 return source;
}

/** 使用捕获的顶点阶段输出和原始片元程序，隔离验证着色器移植。 */
export class CapturedFrameRenderer{
 constructor(canvas,base){
  this.canvas=canvas;this.base=base;this.gl=canvas.getContext('webgl2',{alpha:false,antialias:false,preserveDrawingBuffer:true});
  if(!this.gl)throw new Error('浏览器无法建立 WebGL2');
  this.textures=new Map();this.programs=new Map();this.draws=[];
 }
 async fetch(name,type='arrayBuffer'){
  const response=await fetch(this.base+name);if(!response.ok)throw new Error(`资源 ${name} 返回 ${response.status}`);return response[type]();
 }
 program(vs,fs){
  const gl=this.gl,p=gl.createProgram();
  for(const [type,code]of[[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){
   const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);
   if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));gl.attachShader(p,s);gl.deleteShader(s);
  }
  gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));return p;
 }
 buffer(target,data){const gl=this.gl,b=gl.createBuffer();gl.bindBuffer(target,b);gl.bufferData(target,data,gl.STATIC_DRAW);return b;}
 async load(progress){
  const gl=this.gl;this.manifest=await this.fetch('frame.json','json');
  const m=this.manifest;this.width=m.width;this.height=m.height;this.canvas.width=m.width;this.canvas.height=m.height;
  this.info={extensions:gl.getSupportedExtensions(),renderer:gl.getParameter(gl.RENDERER),uniformBlockLimit:gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE),textureUnitLimit:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)};
  for(const extension of['EXT_color_buffer_float','EXT_float_blend','EXT_texture_compression_bptc','WEBGL_compressed_texture_s3tc','WEBGL_compressed_texture_s3tc_srgb']){
   if(!gl.getExtension(extension))throw new Error(`当前浏览器缺少 ${extension}`);
  }
  this.aniso=gl.getExtension('EXT_texture_filter_anisotropic');
  this.indexedBlend=gl.getExtension('OES_draw_buffers_indexed');
  gl.getExtension('OES_texture_float_linear');
  for(const [id,t]of Object.entries(m.textures)){progress(`正在读取原纹理：${t.name}`);this.textures.set(id,await this.texture(t));}
  this.target=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,this.target);
  this.colors=[];
  for(let i=0;i<3;i++){
   const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,i===1?gl.RGBA8:gl.RGBA16F,m.width,m.height,0,gl.RGBA,i===1?gl.UNSIGNED_BYTE:gl.HALF_FLOAT,null);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
   gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+i,gl.TEXTURE_2D,t,0);this.colors.push(t);
  }
  const depth=gl.createRenderbuffer();this.depth=depth;gl.bindRenderbuffer(gl.RENDERBUFFER,depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH24_STENCIL8,m.width,m.height);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_STENCIL_ATTACHMENT,gl.RENDERBUFFER,depth);gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1,gl.COLOR_ATTACHMENT2]);
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('浮点帧缓冲不完整');
  for(const d of m.draws){progress(`正在接入原始绘制：${d.eventId}`);this.draws.push(await this.prepareDraw(d));}
  this.display=this.program(QUAD,DISPLAY);this.copy=this.program(QUAD,DISPLAY.replace('color=vec4(c,1.);','color=vec4(c,texture(source,uv).a);'));this.quad=gl.createVertexArray();
  if(m.extra){
   progress('正在接入原场景背景与后处理');
   this.background=await this.texture(m.extra.textures.before);
   this.referenceAfter=await this.texture(m.extra.textures.after);
   this.beforeNormal=await this.texture(m.extra.textures['before-normal']);
   this.beforeMotion=await this.texture(m.extra.textures['before-motion']);
   this.beforeDepth=await this.texture(m.extra.textures['before-depth']);
   await this.preparePost();
  }
  this.pipeline=[];
  for(const d of m.pipeline){progress(`正在接入环境及后期绘制：${d.eventId}`);this.pipeline.push(await this.prepareDraw(d));}
  this.copyTarget=gl.createFramebuffer();
  this.depthCopy=this.program(QUAD,`#version 300 es\nprecision highp float;uniform sampler2D source;in vec2 uv;void main(){gl_FragDepth=texture(source,uv).r;}`);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  const error=gl.getError();if(error)throw new Error(`准备资源时 WebGL 错误 ${error}`);
 }
 async texture(t){
  const gl=this.gl,texture=gl.createTexture(),target=t.cubemap?gl.TEXTURE_CUBE_MAP:gl.TEXTURE_2D;gl.bindTexture(target,texture);
  const formats={BC1_SRGB:[0x8c4c],BC3_SRGB:[0x8c4f],BC6_UFLOAT:[0x8e8f],BC7_SRGB:[0x8e8d],BC7_UNORM:[0x8e8c],R16_TYPELESS:[gl.DEPTH_COMPONENT16,gl.DEPTH_COMPONENT,gl.UNSIGNED_SHORT],R16_FLOAT:[gl.R16F,gl.RED,gl.HALF_FLOAT],R8_TYPELESS:[gl.R8,gl.RED,gl.UNSIGNED_BYTE],R16G16B16A16_FLOAT:[gl.RGBA16F,gl.RGBA,gl.HALF_FLOAT],R8G8B8A8_UNORM:[gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE],R8G8B8A8_SRGB:[gl.SRGB8_ALPHA8,gl.RGBA,gl.UNSIGNED_BYTE]};
  formats.R8G8B8A8_TYPELESS=formats.R8G8B8A8_UNORM;
  formats.R16G16B16A16_TYPELESS=formats.R16G16B16A16_FLOAT;
  formats.R11G11B10_FLOAT=[gl.R11F_G11F_B10F,gl.RGB,gl.UNSIGNED_INT_10F_11F_11F_REV];
  formats.D32S8_TYPELESS=[gl.R32F,gl.RED,gl.FLOAT];
  const f=formats[t.format];if(!f)throw new Error(`未接入的原纹理格式 ${t.format}`);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
  for(const sub of t.subresources){
   const raw=await this.fetch(sub.file),face=t.cubemap?gl.TEXTURE_CUBE_MAP_POSITIVE_X+sub.slice:target,w=Math.max(1,t.width>>sub.mip),h=Math.max(1,t.height>>sub.mip);
   if(f.length===1)gl.compressedTexImage2D(face,sub.mip,f[0],w,h,0,new Uint8Array(raw));
   else{
    let data=f[2]===gl.UNSIGNED_BYTE?new Uint8Array(raw):f[2]===gl.UNSIGNED_INT_10F_11F_11F_REV?new Uint32Array(raw):new Uint16Array(raw);
    if(t.format==='D32S8_TYPELESS'){const packed=new Float32Array(raw);data=new Float32Array(w*h);for(let i=0;i<data.length;i++)data[i]=packed[i*2];}
    gl.texImage2D(face,sub.mip,f[0],w,h,0,f[1],f[2],data);
   }
  }
  gl.texParameteri(target,gl.TEXTURE_MAX_LEVEL,t.mips-1);gl.texParameteri(target,gl.TEXTURE_MIN_FILTER,t.mips>1?gl.LINEAR_MIPMAP_LINEAR:gl.LINEAR);gl.texParameteri(target,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(target,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(target,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  const error=gl.getError();if(error)throw new Error(`${t.name} 上传失败 ${error}`);return {texture,target,mips:t.mips};
 }
 sampler(s,texture){
  const gl=this.gl,p=gl.createSampler(),wrap=[gl.REPEAT,gl.MIRRORED_REPEAT,gl.CLAMP_TO_EDGE,gl.CLAMP_TO_EDGE,gl.MIRRORED_REPEAT];
  gl.samplerParameteri(p,gl.TEXTURE_WRAP_S,wrap[s.addressU]);gl.samplerParameteri(p,gl.TEXTURE_WRAP_T,wrap[s.addressV]);gl.samplerParameteri(p,gl.TEXTURE_WRAP_R,wrap[s.addressW]);
  gl.samplerParameteri(p,gl.TEXTURE_MAG_FILTER,s.filter.magnify===1?gl.NEAREST:gl.LINEAR);
  gl.samplerParameteri(p,gl.TEXTURE_MIN_FILTER,texture.mips===1?(s.filter.minify===1?gl.NEAREST:gl.LINEAR):(s.filter.mip===1?gl.LINEAR_MIPMAP_NEAREST:gl.LINEAR_MIPMAP_LINEAR));
  if(s.filter.filter===1){gl.samplerParameteri(p,gl.TEXTURE_COMPARE_MODE,gl.COMPARE_REF_TO_TEXTURE);gl.samplerParameteri(p,gl.TEXTURE_COMPARE_FUNC,[gl.NEVER,gl.ALWAYS,gl.LESS,gl.LEQUAL,gl.GREATER,gl.GEQUAL,gl.EQUAL,gl.NOTEQUAL][s.compareFunction]);}
  if(this.aniso&&s.maxAnisotropy>0)gl.samplerParameterf(p,this.aniso.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(s.maxAnisotropy,gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  return p;
 }
 async prepareDraw(d){
  const gl=this.gl;let fs=(await this.fetch(d.fragment,'text')).replace('precision mediump float;','precision highp float;');
  const programKey=d.fragment+(d.eventId===3717?':fixed':'');
  if(d.eventId===3717){
   const data=new Uint32Array(await this.fetch(d.blocks.find(b=>b.slot===0).file));
   fs=fs.replace(/layout\(std140\) uniform \w+\s*\{[^}]+\} cb0_0;/,'');
   fs=fs.replace(/cb0_0\._m0\[(\d+)u\]/g,(_,i)=>`uintBitsToFloat(uvec4(${[...data.slice(+i*4,+i*4+4)].map(v=>v+'u').join(',')}))`);
   fs=coalescePostSamplers(fs,(texture,sampler)=>[d.textures[texture],d.samplers[sampler]]);
  }
  let program=this.programs.get(programKey),attributes=[];
  const inputs=[...fs.matchAll(/^in highp (vec[234]|float) v(\d+);/gm)];
  let vs='#version 300 es\nprecision highp float;\nlayout(location=0)in vec4 clipPosition;\n',body='gl_Position=vec4(clipPosition.x,-clipPosition.y,clipPosition.z*2.-clipPosition.w,clipPosition.w);';
  for(const [i,match]of inputs.entries()){
   const reg=+match[2],input=d.inputs.find(a=>a.register===reg),a=d.attributes.find(a=>a.semantic===input?.semantic);
   if(!a)throw new Error(`绘制 ${d.eventId} 缺少插值输入 ${reg}`);
   const size=match[1]==='float'?1:+match[1].slice(-1);attributes.push({location:i+1,size,offset:a.offset});
   vs+=`layout(location=${i+1})in ${match[1]} a${reg};out highp ${match[1]} v${reg};\n`;body+=`v${reg}=a${reg};`;
  }
  vs+=`void main(){${body}}`;
  if(!program){program=this.program(vs,fs);this.programs.set(programKey,program);}
  gl.useProgram(program);
  const vao=gl.createVertexArray();gl.bindVertexArray(vao);
  const vertices=await this.fetch(d.vertexFile);this.buffer(gl.ARRAY_BUFFER,new Uint8Array(vertices));
  gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,4,gl.FLOAT,false,d.stride,0);
  for(const a of attributes){gl.enableVertexAttribArray(a.location);gl.vertexAttribPointer(a.location,a.size,gl.FLOAT,false,d.stride,a.offset);}
  this.buffer(gl.ELEMENT_ARRAY_BUFFER,new Uint8Array(await this.fetch(d.indexFile)));
  const blocks=[];
  for(const match of fs.matchAll(/layout\(std140\) uniform (\w+)\s*\{[^}]+\} cb(\d+)_0(?:_\d+)?;/g)){
   const slot=+match[2],source=d.blocks.find(b=>b.slot===slot),index=gl.getUniformBlockIndex(program,match[1]);
   if(index===gl.INVALID_INDEX)continue;
   gl.uniformBlockBinding(program,index,slot);
   blocks.push({slot,buffer:this.buffer(gl.UNIFORM_BUFFER,new Uint8Array(await this.fetch(source.file)))});
  }
  const textures=[],shared=new Map();
  for(const match of fs.matchAll(/uniform highp sampler\w+ (SPIRV_Cross_Combinedt(\d+)s(\d+));/g)){
   const loc=gl.getUniformLocation(program,match[1]);if(loc===null)continue;
   const id=d.textures[match[2]],key=id+':'+JSON.stringify(d.samplers[match[3]]);let binding=shared.get(key);
   if(!binding){const texture=this.textures.get(id),sampler=this.sampler(d.samplers[match[3]],texture);binding={...texture,sampler,unit:textures.length,id};textures.push(binding);shared.set(key,binding);}
   gl.uniform1i(loc,binding.unit);
  }
  const outputs=[...fs.matchAll(/layout\(location = (\d+)\) out /g)].map(m=>+m[1]);
  return {...d,vao,program,blocks,boundTextures:textures,drawBuffers:[0,1,2].map(i=>outputs.includes(i)?gl.COLOR_ATTACHMENT0+i:gl.NONE)};
 }
 applyState(s){
  const gl=this.gl,r=s.rasterizer,d=s.depthStencil,b=s.blend[0];
  const compare={Never:gl.NEVER,AlwaysTrue:gl.ALWAYS,Less:gl.LESS,LessEqual:gl.LEQUAL,Greater:gl.GREATER,GreaterEqual:gl.GEQUAL,Equal:gl.EQUAL,NotEqual:gl.NOTEQUAL};
  const stencil={Keep:gl.KEEP,Zero:gl.ZERO,Replace:gl.REPLACE,IncSat:gl.INCR,DecSat:gl.DECR,Invert:gl.INVERT,IncWrap:gl.INCR_WRAP,DecWrap:gl.DECR_WRAP};
  const blend={Zero:gl.ZERO,One:gl.ONE,SrcCol:gl.SRC_COLOR,InvSrcCol:gl.ONE_MINUS_SRC_COLOR,DstCol:gl.DST_COLOR,InvDstCol:gl.ONE_MINUS_DST_COLOR,SrcAlpha:gl.SRC_ALPHA,InvSrcAlpha:gl.ONE_MINUS_SRC_ALPHA,DstAlpha:gl.DST_ALPHA,InvDstAlpha:gl.ONE_MINUS_DST_ALPHA};
  const enable=(cap,value)=>value?gl.enable(cap):gl.disable(cap);
  // 顶点 Y 翻转使 WebGL 的绕序与 D3D 捕获状态相反。
  enable(gl.CULL_FACE,short(r.cullMode)!=='NoCull');gl.cullFace(short(r.cullMode)==='Front'?gl.FRONT:gl.BACK);gl.frontFace(r.frontCCW?gl.CW:gl.CCW);
  enable(gl.DEPTH_TEST,d.depthEnable);gl.depthFunc(compare[short(d.depthFunction)]);gl.depthMask(d.depthWrites);
  enable(gl.STENCIL_TEST,d.stencilEnable);
  for(const [face,x]of[[gl.FRONT,d.frontFace],[gl.BACK,d.backFace]]){gl.stencilFuncSeparate(face,compare[short(x.function)],x.reference,x.compareMask);gl.stencilOpSeparate(face,stencil[short(x.failOperation)],stencil[short(x.depthFailOperation)],stencil[short(x.passOperation)]);gl.stencilMaskSeparate(face,x.writeMask);}
  enable(gl.BLEND,b.enabled);gl.blendFuncSeparate(blend[short(b.colorBlend.source)],blend[short(b.colorBlend.destination)],blend[short(b.alphaBlend.source)],blend[short(b.alphaBlend.destination)]);
  gl.colorMask(...[1,2,4,8].map(n=>!!(b.writeMask&n)));
  if(s.independentBlend){
   if(!this.indexedBlend)throw new Error('当前浏览器缺少多目标独立混合支持');
   for(let i=0;i<3;i++){
    const target=s.blend[i],ext=this.indexedBlend;
    if(target.enabled)ext.enableiOES(gl.BLEND,i);else ext.disableiOES(gl.BLEND,i);
    ext.blendFuncSeparateiOES(i,blend[short(target.colorBlend.source)],blend[short(target.colorBlend.destination)],blend[short(target.alphaBlend.source)],blend[short(target.alphaBlend.destination)]);
    ext.colorMaskiOES(i,...[1,2,4,8].map(n=>!!(target.writeMask&n)));
   }
  }
 }
 render({pipeline=false,through=3717}={}){
  const gl=this.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,this.target);gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1,gl.COLOR_ATTACHMENT2]);gl.viewport(0,0,this.width,this.height);gl.depthMask(true);gl.stencilMask(255);gl.colorMask(true,true,true,true);gl.clearColor(0,0,0,0);gl.clearDepth(0);gl.clearStencil(0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT|gl.STENCIL_BUFFER_BIT);
  if(this.background){
   gl.bindFramebuffer(gl.FRAMEBUFFER,this.copyTarget);
   for(const [i,source]of[this.background,this.beforeNormal,this.beforeMotion].entries()){
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.colors[i],0);gl.drawBuffers([gl.COLOR_ATTACHMENT0]);this.blit(source.texture,this.copy,false);
   }
   gl.bindFramebuffer(gl.FRAMEBUFFER,this.target);gl.drawBuffers([gl.NONE,gl.NONE,gl.NONE]);gl.useProgram(this.depthCopy);gl.bindVertexArray(this.quad);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.ALWAYS);gl.depthMask(true);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.beforeDepth.texture);gl.bindSampler(0,null);gl.uniform1i(gl.getUniformLocation(this.depthCopy,'source'),0);gl.drawArrays(gl.TRIANGLES,0,3);
  }
  for(const d of this.draws){
   if(pipeline&&d.eventId>2849)continue;
   if(!pipeline&&d.eventId>through)continue;
   this.draw(d);
  }
  if(pipeline)this.renderPipeline(through);else this.present(false);
 }
 draw(d,resources){
  const gl=this.gl;gl.useProgram(d.program);gl.bindVertexArray(d.vao);gl.drawBuffers(d.drawBuffers);this.applyState(d.state);
  for(const b of d.blocks)gl.bindBufferBase(gl.UNIFORM_BUFFER,b.slot,b.buffer);
  for(const t of d.boundTextures){const dynamic=resources?.get(t.id);gl.activeTexture(gl.TEXTURE0+t.unit);gl.bindTexture(t.target,dynamic?.texture||t.texture);gl.bindSampler(t.unit,t.sampler);}
  gl.drawElements(gl.TRIANGLES,d.count,d.indexStride===2?gl.UNSIGNED_SHORT:gl.UNSIGNED_INT,0);
  const error=gl.getError();if(error)throw new Error(`绘制 ${d.eventId} 失败 ${error}`);
 }
 renderPipeline(through){
  const gl=this.gl;
  if(!this.pipelineResources){
   const resources=new Map();
   for(const [i,ids]of[['ResourceId::8708','ResourceId::8711'],['ResourceId::8715','ResourceId::8718'],['ResourceId::8722','ResourceId::8725']].entries())for(const id of ids)resources.set(id,{texture:this.colors[i],width:this.width,height:this.height});
   const formats={R16G16B16A16_FLOAT:[gl.RGBA16F,gl.RGBA,gl.HALF_FLOAT],R8G8B8A8_UNORM:[gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE],R8G8B8A8_SRGB:[gl.SRGB8_ALPHA8,gl.RGBA,gl.UNSIGNED_BYTE],R16_FLOAT:[gl.R16F,gl.RED,gl.HALF_FLOAT],R11G11B10_FLOAT:[gl.R11F_G11F_B10F,gl.RGB,gl.UNSIGNED_INT_10F_11F_11F_REV]};
   for(const d of this.pipeline){
    for(const output of d.outputs){
     if(resources.has(output.id))continue;const f=formats[output.format];if(!f)throw new Error(`未接入输出格式 ${output.format}`);
     const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,f[0],output.width,output.height,0,f[1],f[2],null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);resources.set(output.id,{texture,...output});
    }
    d.framebuffer=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,d.framebuffer);
    for(const [i,output]of d.outputs.entries())gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+i,gl.TEXTURE_2D,resources.get(output.id).texture,0);
    if(d.depthTarget==='ResourceId::8729')gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_STENCIL_ATTACHMENT,gl.RENDERBUFFER,this.depth);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error(`后期目标不完整 ${d.eventId}`);
   }
   this.pipelineResources=resources;
  }
  const active=new Map();for(const id of['ResourceId::8708','ResourceId::8711','ResourceId::8715','ResourceId::8718','ResourceId::8722','ResourceId::8725'])active.set(id,this.pipelineResources.get(id));
  for(const d of this.pipeline){
   if(d.eventId>through)break;
   gl.bindFramebuffer(gl.FRAMEBUFFER,d.framebuffer);const v=d.state.viewports[0];gl.viewport(v.x,v.y,v.width,v.height);
   const count=d.outputs.length;d.drawBuffers=d.drawBuffers.slice(0,count);this.draw(d,active);this.lastPipelineEvent=d.eventId;for(const output of d.outputs)active.set(output.id,this.pipelineResources.get(output.id));
  }
  const final=through>=3717?this.pipelineResources.get('ResourceId::7437'):this.pipelineResources.get(through>=3504?'ResourceId::8068':'ResourceId::8708');
  this.canvas.width=final.width;this.canvas.height=final.height;gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,final.width,final.height);this.blit(final.texture,this.display,through>=3717,through>=3717);gl.finish();
 }
 present(srgb=false){
  const gl=this.gl;this.canvas.width=this.width;this.canvas.height=this.height;gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,this.width,this.height);this.blit(this.colors[0],this.display,srgb);gl.finish();
 }
 blit(texture,program,srgb,flipY=false){
  const gl=this.gl;gl.disable(gl.DEPTH_TEST);gl.disable(gl.STENCIL_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.colorMask(true,true,true,true);gl.useProgram(program);gl.bindVertexArray(this.quad);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.bindSampler(0,null);gl.uniform1i(gl.getUniformLocation(program,'source'),0);gl.uniform1i(gl.getUniformLocation(program,'srgb'),srgb);gl.uniform1i(gl.getUniformLocation(program,'flipY'),flipY);gl.drawArrays(gl.TRIANGLES,0,3);
 }
 async preparePost(){
  const gl=this.gl,extra=this.manifest.extra;
  const data=new Uint32Array(await this.fetch('post-3717-cb0.bin'));
  // 固定抓帧常量让编译器删除这一帧没有启用的后期分支，保留原指令数值。
  let fs=(await this.fetch('post-8211.glsl','text')).replace('precision mediump float;','precision highp float;');
  fs=fs.replace(/layout\(std140\) uniform cb1497_struct\s*\{[^}]+\} cb0_0;/,'');
  fs=fs.replace(/cb0_0\._m0\[(\d+)u\]/g,(_,i)=>`uintBitsToFloat(uvec4(${[...data.slice(+i*4,+i*4+4)].map(v=>v+'u').join(',')}))`);
  fs=coalescePostSamplers(fs,(texture,sampler)=>{
   const {slot,...sampling}=extra.samplers.find(s=>s.slot===sampler);
   return [extra.textures['post-t'+texture].id,sampling];
  });
  const end=fs.lastIndexOf('}');fs=fs.slice(0,end)+'o0.rgb=mix(o0.rgb*12.92,1.055*pow(max(o0.rgb,0.),vec3(1./2.4))-.055,step(vec3(.0031308),o0.rgb));\n'+fs.slice(end);
  this.post=this.program(QUAD.replace('out vec2 uv;','out vec2 v1;').replace('uv=p;','v1=p;'),fs);
  gl.useProgram(this.post);this.postTextures=[];const shared=new Map();
  for(const match of fs.matchAll(/uniform highp sampler\w+ (SPIRV_Cross_Combinedt(\d+)s(\d+));/g)){
   const loc=gl.getUniformLocation(this.post,match[1]);if(loc===null)continue;
   const metadata=extra.textures['post-t'+match[2]],ss=extra.samplers.find(s=>s.slot===+match[3]),key=metadata.id+'-'+JSON.stringify(ss);
   let binding=shared.get(key);
   if(!binding){
    const texture=await this.texture(metadata),sampler=this.sampler({addressU:ss.u,addressV:ss.v,addressW:ss.u,filter:{minify:ss.min,magnify:ss.mag,mip:ss.mip,filter:0},maxAnisotropy:0},texture);
    binding={...texture,sampler,unit:shared.size,source:+match[2]};shared.set(key,binding);this.postTextures.push(binding);
   }
   gl.uniform1i(loc,binding.unit);
  }
  this.info.postTextureUnits=shared.size;
 }
 presentPost(originalInput=false){
  const gl=this.gl;this.canvas.width=this.width;this.canvas.height=this.height;gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,this.width,this.height);gl.disable(gl.DEPTH_TEST);gl.disable(gl.STENCIL_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.colorMask(true,true,true,true);gl.useProgram(this.post);gl.bindVertexArray(this.quad);
  for(const t of this.postTextures){gl.activeTexture(gl.TEXTURE0+t.unit);gl.bindTexture(t.target,t.source===0&&!originalInput?this.colors[0]:t.texture);gl.bindSampler(t.unit,t.sampler);}
  gl.drawArrays(gl.TRIANGLES,0,3);gl.finish();const error=gl.getError();if(error)throw new Error(`后处理失败 ${error}`);
 }
}
