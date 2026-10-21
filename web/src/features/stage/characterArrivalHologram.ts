import { arrivalGeometryMatches, type ArrivalProjection } from "./characterArrivalProjection";
import { createArrivalGeometryRenderer } from "./characterArrivalGeometryRenderer";

type Frame = { width: number; height: number; time: number; progress: number; breath: number; pointerX: number; pointerY: number; pointerStrength: number; reduced: boolean; projection: ArrivalProjection | null; anchor: [number, number, number] };

// 实验只消费与既有L06点集完全同源的预计算数据，未知模型继续用原路径。
export const hologramPoseMatches = arrivalGeometryMatches;

export function createArrivalHologram() {
  if (!hologramPoseMatches) return null;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, antialias: false, depth: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const vertex = `attribute vec2 position; void main(){ gl_Position=vec4(position,0.,1.); }`;
  const fragment = `precision highp float;
    uniform sampler2D surfaceMap, glowMap;
    uniform vec2 resolution;
    uniform vec3 pointer, anchor;
    uniform float time, progress, breath, motion;
    vec2 uv(vec2 p){return vec2((p.x-.5)*resolution.y/resolution.x+.5,1.-p.y);}
    float mask(vec2 p){vec2 t=uv(p);return texture2D(surfaceMap,t).a * step(0.,t.x)*step(t.x,1.)*step(0.,t.y)*step(t.y,1.);}
    float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float noise(vec2 p){
      vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
      return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);
    }
    float cloud(vec2 p){ return noise(p)*.58+noise(p*2.03+17.)*.28+noise(p*4.07-7.)*.14; }
    void main(){
      vec2 pixel=vec2(gl_FragCoord.x,resolution.y-gl_FragCoord.y);
      vec2 q=(pixel-resolution*.5)/resolution.y+.5;
      float breathing=breath-.5;
      float chest=exp(-pow((q.y-(anchor.y-anchor.z*.25))/max(.02,anchor.z*.85),2.));
      q.x=anchor.x+(q.x-anchor.x)/(1.+breathing*.025*chest);
      q.y+=breathing*.0018*chest;
      vec2 pd=(pixel-pointer.xy)/resolution.y;
      float influence=exp(-dot(pd,pd)/.009)*pointer.z;
      q+=vec2(sin(pd.y*50.+time*2.4),cos(pd.x*42.-time*1.8))*.004*influence;
      vec4 tex=texture2D(surfaceMap,uv(q));
      float a=mask(q);
      vec3 normal=normalize(tex.rgb*2.-1.);
      float rim=pow(1.-abs(normal.z),2.8);
      vec3 glow=texture2D(glowMap,uv(q)).rgb;
      float edge=glow.r;
      float mist=cloud(q*vec2(18.,11.)+vec2(time*.045,-time*.075));
      float detail=cloud(q*vec2(94.,68.)+vec2(-time*.06,time*.03));
      float halo=glow.g*.8+glow.b*2.9;
      float flow=.72+.28*mist;
      float filaments=pow(1.-abs(detail*2.-1.),16.);
      float scan=pow(max(0.,sin(q.y*460.-time*.8)),32.);
      float assembled=smoothstep(.08,.85,progress);
      float front=1.12-progress*1.25;
      float reveal=mix(smoothstep(front-.10,front+.10,q.y),1.,smoothstep(.85,1.,progress));
      float scanHead=exp(-pow((q.y-front)/.022,2.))*(1.-smoothstep(.70,1.,progress))*motion;
      float facing=max(0.,dot(normal,normalize(vec3(-.4,.45,1.))));
      // 以形体内部的柔软明暗为主体，边缘仅作断续高光，避免只剩霓虹描线。
      float volume=.065+facing*.075+rim*.31+pow(mist,1.6)*.23;
      float alpha=(a*(volume+filaments*.065+scan*.008)+edge*(.08+detail*.15)+halo*(.52+mist*.65))*flow;
      alpha*=reveal*assembled*(.78+breath*.36);
      alpha+=a*scanHead*.18;
      alpha+=a*influence*(.07+.05*sin(time*3.+length(pd)*85.));
      vec3 tint=mix(vec3(.20,.49,.94),vec3(.65,.87,1.),clamp(rim*.7+facing*.25+filaments*.25+glow.g*.7+scanHead,0.,1.));
      gl_FragColor=vec4(tint,clamp(alpha,0.,.82));
    }`;
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("全息着色器创建失败");
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(message || "全息着色器编译失败");
    }
    return shader;
  };
  let program: WebGLProgram | null = null, buffer: WebGLBuffer | null = null;
  let geometry: ReturnType<typeof createArrivalGeometryRenderer> | null = null;
  const shaders: WebGLShader[] = [];
  let disposed = false;
  const dispose = () => {
    disposed = true; geometry?.dispose(); gl.deleteBuffer(buffer); gl.deleteProgram(program);
    shaders.forEach(shader => gl.deleteShader(shader));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
  try {
    shaders.push(compile(gl.VERTEX_SHADER, vertex), compile(gl.FRAGMENT_SHADER, fragment));
    program = gl.createProgram();
    if (!program) throw new Error("全息程序创建失败");
    shaders.forEach(shader => gl.attachShader(program!, shader)); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "全息程序链接失败");
    gl.useProgram(program);
    buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniforms = Object.fromEntries(["surfaceMap", "glowMap", "resolution", "pointer", "anchor", "time", "progress", "breath", "motion"].map(name => [name, gl.getUniformLocation(program!, name)]));
    gl.uniform1i(uniforms.surfaceMap, 0); gl.uniform1i(uniforms.glowMap, 1);
    geometry = createArrivalGeometryRenderer(gl);
    return {
      draw(frame: Frame) {
        if (disposed || !frame.projection || gl.isContextLost()) return null;
        // 柔光辅助层不随高分屏平方增加像素；最终画布仍保持设备分辨率。
        const scale = Math.min(1, 720 / frame.height, Math.sqrt(800000 / (frame.width * frame.height)));
        const width = Math.max(1, Math.round(frame.width * scale)), height = Math.max(1, Math.round(frame.height * scale));
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        const maps = geometry?.prepare(frame.projection, width, height);
        if (!maps) return null;
        gl.viewport(0, 0, width, height);
        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0); gl.disableVertexAttribArray(1);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, maps.surface);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, maps.glow);
        gl.uniform2f(uniforms.resolution, width, height);
        gl.uniform3f(uniforms.pointer, frame.pointerX * width / frame.width, frame.pointerY * height / frame.height, frame.pointerStrength);
        gl.uniform3fv(uniforms.anchor, frame.anchor);
        gl.uniform1f(uniforms.time, frame.time); gl.uniform1f(uniforms.progress, frame.progress);
        gl.uniform1f(uniforms.breath, frame.breath); gl.uniform1f(uniforms.motion, frame.reduced ? 0 : 1);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        return canvas;
      }, dispose,
    };
  } catch (error) {
    console.warn("全息实验不可用，保持原粒子加载", error); dispose(); return null;
  }
}
