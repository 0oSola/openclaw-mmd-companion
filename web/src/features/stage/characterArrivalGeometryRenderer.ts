import { getArrivalGeometry, type ArrivalProjection } from "./characterArrivalProjection";

/** 仅在镜头或尺寸变化时重画L06形体及柔光；动画每帧复用结果。 */
export function createArrivalGeometryRenderer(gl: WebGLRenderingContext) {
  const programs: WebGLProgram[] = [], shaders: WebGLShader[] = [], buffers: WebGLBuffer[] = [];
  const targets: Array<{ texture: WebGLTexture; framebuffer: WebGLFramebuffer }> = [];
  const depth = gl.createRenderbuffer();
  const dispose = () => {
    programs.forEach(p => gl.deleteProgram(p)); shaders.forEach(s => gl.deleteShader(s)); buffers.forEach(b => gl.deleteBuffer(b));
    targets.forEach(t => { gl.deleteTexture(t.texture); gl.deleteFramebuffer(t.framebuffer); }); gl.deleteRenderbuffer(depth);
  };
  const program = (vertex: string, fragment: string) => {
    const p = gl.createProgram(); if (!p) throw Error("加载形体程序创建失败"); programs.push(p);
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
      const s = gl.createShader(type); if (!s) throw Error("加载形体着色器创建失败"); shaders.push(s);
      gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s) || "加载形体着色器错误");
      gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, "position"); gl.bindAttribLocation(p, 1, "normal"); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p) || "加载形体程序链接失败");
    return p;
  };
  const buffer = (values: Float32Array | Uint16Array, target: number = gl.ARRAY_BUFFER) => {
    const b = gl.createBuffer(); if (!b) throw Error("加载形体缓冲创建失败"); buffers.push(b);
    gl.bindBuffer(target, b); gl.bufferData(target, values, gl.STATIC_DRAW); return b;
  };
  const quadVertex = `attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}`;
  const sampleHead = `precision highp float; uniform sampler2D source; uniform vec2 resolution;`;
  try {
    const geometry = getArrivalGeometry();
    const mesh = program(`attribute vec3 position, normal; uniform mat4 mvp; uniform mat3 normalMatrix; uniform vec4 viewport; varying vec3 n;
      void main(){vec4 p=mvp*vec4(position,1.);p.xy=p.xy*viewport.xy+p.w*viewport.zw;gl_Position=p;n=normalMatrix*normal;}`,
      `precision highp float; varying vec3 n; void main(){gl_FragColor=vec4(normalize(n)*.5+.5,1.);}`);
    const edge = program(quadVertex, sampleHead + `void main(){vec2 uv=gl_FragCoord.xy/resolution,d=1.15/resolution;
      float a=texture2D(source,uv).a;
      float e=max(max(abs(a-texture2D(source,uv+vec2(d.x,0.)).a),abs(a-texture2D(source,uv-vec2(d.x,0.)).a)),
        max(abs(a-texture2D(source,uv+vec2(0.,d.y)).a),abs(a-texture2D(source,uv-vec2(0.,d.y)).a)));
      gl_FragColor=vec4(vec3(e),1.);}`);
    const horizontal = program(quadVertex, sampleHead + `float blur(vec2 uv,float radius){
      vec2 d=vec2(radius/resolution.x,0.);
      return texture2D(source,uv).r*.227027+(texture2D(source,uv+d*1.384615).r+texture2D(source,uv-d*1.384615).r)*.316216
        +(texture2D(source,uv+d*3.230769).r+texture2D(source,uv-d*3.230769).r)*.070270;}
      void main(){vec2 uv=gl_FragCoord.xy/resolution;gl_FragColor=vec4(texture2D(source,uv).r,blur(uv,1.4),blur(uv,4.5),1.);}`);
    const vertical = program(quadVertex, sampleHead + `void main(){vec2 uv=gl_FragCoord.xy/resolution;vec4 center=texture2D(source,uv);
      vec2 d=vec2(0.,1.4/resolution.y),b=vec2(0.,4.5/resolution.y);
      float s=center.g*.227027+(texture2D(source,uv+d*1.384615).g+texture2D(source,uv-d*1.384615).g)*.316216
        +(texture2D(source,uv+d*3.230769).g+texture2D(source,uv-d*3.230769).g)*.070270;
      float l=center.b*.227027+(texture2D(source,uv+b*1.384615).b+texture2D(source,uv-b*1.384615).b)*.316216
        +(texture2D(source,uv+b*3.230769).b+texture2D(source,uv-b*3.230769).b)*.070270;
      gl_FragColor=vec4(center.r,s,l,1.);}`);
    const positions = buffer(geometry.positions), normals = buffer(geometry.normals), indices = buffer(geometry.indices, gl.ELEMENT_ARRAY_BUFFER);
    const quad = buffer(new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]));
    for (let i = 0; i < 4; i++) {
      const texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
      if (!texture || !framebuffer) throw Error("加载形体画布创建失败");
      targets.push({ texture, framebuffer }); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    }
    let width = 0, height = 0, lastKey = "", failed = false;
    const pass = (p: WebGLProgram, input: WebGLTexture, output: WebGLFramebuffer) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, output); gl.useProgram(p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, input);
      gl.uniform1i(gl.getUniformLocation(p, "source"), 0); gl.uniform2f(gl.getUniformLocation(p, "resolution"), width, height);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0); gl.disableVertexAttribArray(1);
      gl.drawArrays(gl.TRIANGLES,0,6);
    };
    return {
      prepare(projection: ArrivalProjection, w: number, h: number) {
        if (failed) return null;
        const changed = width !== w || height !== h;
        if (changed) {
          width = w; height = h;
          targets.forEach(t => { gl.bindTexture(gl.TEXTURE_2D,t.texture); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null); });
          gl.bindRenderbuffer(gl.RENDERBUFFER,depth); gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,w,h);
          gl.bindFramebuffer(gl.FRAMEBUFFER,targets[0].framebuffer); gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
          if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){failed=true;gl.bindFramebuffer(gl.FRAMEBUFFER,null);return null;}
        }
        if (changed || lastKey !== projection.key) {
          gl.viewport(0,0,w,h); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
          gl.bindFramebuffer(gl.FRAMEBUFFER,targets[0].framebuffer); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT); gl.useProgram(mesh);
          gl.bindBuffer(gl.ARRAY_BUFFER,positions);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);
          gl.bindBuffer(gl.ARRAY_BUFFER,normals);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,0,0);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indices);
          gl.uniformMatrix4fv(gl.getUniformLocation(mesh,"mvp"),false,projection.mvp);gl.uniformMatrix3fv(gl.getUniformLocation(mesh,"normalMatrix"),false,projection.normal);
          gl.uniform4fv(gl.getUniformLocation(mesh,"viewport"),projection.viewport);
          gl.drawElements(gl.TRIANGLES,geometry.indices.length,gl.UNSIGNED_SHORT,0);gl.disable(gl.DEPTH_TEST);
          pass(edge,targets[0].texture,targets[1].framebuffer);pass(horizontal,targets[1].texture,targets[2].framebuffer);pass(vertical,targets[2].texture,targets[3].framebuffer);
          lastKey=projection.key;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);
        return { surface: targets[0].texture, glow: targets[3].texture };
      }, dispose,
    };
  } catch(error) { dispose(); throw error; }
}
