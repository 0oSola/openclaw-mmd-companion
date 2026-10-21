// Koleda 绑定网格的分区遮罩。输出 RGB 分别为外层、内侧、末端权重。
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function buildHairRegionMask(geometry,materials){
  const p=geometry.attributes.position,index=geometry.index;
  if(!p||p.itemSize!==3||!index)throw new Error("头发遮罩需要索引三角网格");
  const data=new Float32Array(p.count*3),selected=new Set(),graphs=[];
  for(const group of geometry.groups){
    if(!["HairA","HairB"].includes(materials[group.materialIndex]?.name))continue;
    if(group.count%3!==0)throw new Error("头发绘制范围不是三角形");
    const adjacency=new Map();
    for(let i=group.start;i<group.start+group.count;i+=3){
      const vs=[index.getX(i),index.getX(i+1),index.getX(i+2)];
      for(const v of vs){if(!Number.isInteger(v)||v<0||v>=p.count)throw new Error("头发顶点索引非法");if(![p.getX(v),p.getY(v),p.getZ(v)].every(Number.isFinite))throw new Error("头发位置非有限值");if(!adjacency.has(v))adjacency.set(v,new Set());selected.add(v);}
      for(const a of vs)for(const b of vs)if(a!==b)adjacency.get(a).add(b);
    }
    graphs.push(adjacency);
  }
  if(!selected.size)throw new Error("没有匹配 HairA/HairB 的顶点");
  // 各高度切片的径向外包络只用于初始内侧选区，不当作真实遮挡或光照。
  const slices=new Map();
  for(const v of selected){const k=Math.round(p.getY(v)*4);if(!slices.has(k))slices.set(k,[]);slices.get(k).push(v);}
  const depth=new Map();
  for(const vertices of slices.values()){
    const cz=vertices.reduce((s,v)=>s+p.getZ(v),0)/vertices.length;
    const bins=new Map();
    for(const v of vertices){const x=p.getX(v),z=p.getZ(v)-cz,k=Math.round(Math.atan2(z,x)*24/Math.PI),r=Math.hypot(x,z);if(!bins.has(k))bins.set(k,[]);bins.get(k).push([v,r]);}
    for(const values of bins.values()){const radii=values.map(x=>x[1]).sort((a,b)=>a-b),outer=radii[Math.floor((radii.length-1)*.9)];for(const [v,r] of values)depth.set(v,smooth(.10,.65,outer-r));}
  }
  const components=[],frontGroups=[];
  for(const graph of graphs){const seen=new Set();for(const first of graph.keys()){
    if(seen.has(first))continue;const vertices=[first];seen.add(first);
    for(let i=0;i<vertices.length;i++)for(const v of graph.get(vertices[i]))if(!seen.has(v)){seen.add(v);vertices.push(v);}
    const ys=vertices.map(v=>p.getY(v)),lo=Math.min(...ys),hi=Math.max(...ys);
    // 每个连通发片从根部沿三角网格边累计长度，避免整头水平切一条紫色色带。
    const dist=new Map(vertices.map(v=>[v,p.getY(v)>=hi-.025?0:Infinity])),pending=new Set(vertices);
    while(pending.size){let u=-1,best=Infinity;for(const v of pending)if(dist.get(v)<best){u=v;best=dist.get(v);}if(u<0)break;pending.delete(u);for(const v of graph.get(u)){const d=best+Math.hypot(p.getX(u)-p.getX(v),p.getY(u)-p.getY(v),p.getZ(u)-p.getZ(v));if(d<dist.get(v))dist.set(v,d);}}
    const length=Math.max(...dist.values());
    for(const v of vertices){
      const along=length>1e-8?dist.get(v)/length:0;
      const longStrand=hi-lo>3&&lo<16.5;
      const detachedCurl=hi<15.5&&hi-lo>1;
      const tip=longStrand?smooth(.70,.98,along):(detachedCurl?.45+.4*smooth(.3,1,along):0);
      const inner=(depth.get(v)||0)*.8*(1-tip);
      data[v*3]=1-tip-inner;data[v*3+1]=inner;data[v*3+2]=tip;
    }
    components.push({first,count:vertices.length,minY:lo,maxY:hi,length});
    if(p.count===60352&&[56854,56894,56898,56976,57176,57825,57910,57922,57984,58216].includes(first))frontGroups.push(vertices);
  }}
  // 分裂顶点可位于同一接缝位置；只同步遮罩，不焊接几何或骨权重。
  const coincident=new Map();
  for(const v of selected){const key=[p.getX(v),p.getY(v),p.getZ(v)].map(x=>x.toFixed(4)).join(",");if(!coincident.has(key))coincident.set(key,[]);coincident.get(key).push(v);}
  // 仅沿原拓扑边平滑，不跨越共用UV的其他发束。
  for(let pass=0;pass<12;pass++){
    const next=data.slice();
    for(const graph of graphs)for(const [v,neighbors] of graph){
      for(let c=0;c<3;c++){let sum=0;for(const n of neighbors)sum+=data[n*3+c];next[v*3+c]=0.4*data[v*3+c]+0.6*sum/Math.max(1,neighbors.size);}
    }
    for(const vertices of coincident.values())if(vertices.length>1)for(let c=0;c<3;c++){const mean=vertices.reduce((sum,v)=>sum+next[v*3+c],0)/vertices.length;for(const v of vertices)next[v*3+c]=mean;}
    data.set(next);
  }
  const frontData=new Float32Array(p.count);
  for(const vertices of frontGroups)for(const v of vertices){
    const t=Math.max(0,Math.min(1,(18.6-p.getY(v))/1.4)),w=t*t*(3-2*t);frontData[v]=w;
    const tip=data[v*3+2],inner=Math.max(data[v*3+1],0.46*w*(1-tip));data[v*3]=1-tip-inner;data[v*3+1]=inner;
  }
  return {data,frontData,summary:{version:3,vertices:selected.size,components:components.length,frontGroups:frontGroups.length},components};
}

export function installHairRegionVertex(shader){
  const anchor="#include <begin_vertex>";
  if(shader.vertexShader.split(anchor).length!==2||shader.vertexShader.includes("gameHairMask"))throw new Error("头发遮罩顶点接缝不唯一");
  shader.vertexShader="attribute vec3 gameHairMask; attribute float frontPurpleMask; varying float vFrontPurpleMask; varying vec3 vGameHairMask;\n"+shader.vertexShader.replace(anchor,anchor+"\nvGameHairMask=gameHairMask; vFrontPurpleMask=frontPurpleMask;");
  shader.fragmentShader="varying vec3 vGameHairMask; varying float vFrontPurpleMask; uniform float gameHairMaskView; uniform float gameHairMaskStrength;\n"+shader.fragmentShader;
}

export const HAIR_REGION_MAP_GLSL=`
float hairLuma=dot(diffuseColor.rgb,vec3(0.2126,0.7152,0.0722));
vec3 hairWeights=max(vGameHairMask,vec3(0.0));
hairWeights/=max(dot(hairWeights,vec3(1.0)),0.00001);
`;
export const HAIR_REGION_OUTPUT_GLSL=`
// 已展示的局部试验：保留原明暗，仅改变选区颜色。
vec3 localOriginal=outgoingLight;
float localY=dot(localOriginal,vec3(0.2126,0.7152,0.0722));
float innerOnly=smoothstep(0.025,0.24,hairWeights.g);
vec3 localResult=mix(localOriginal,localY*vec3(1.06,0.72,1.42),innerOnly*0.85);
float tipOnly=smoothstep(0.12,0.55,hairWeights.b);
localResult=mix(localResult,localY*vec3(1.18,0.68,1.65),tipOnly*0.80);
// 正面保持银白外沿，只对中暗色区域加灰紫；不把整束变成紫色细条。
float frontY=dot(localResult,vec3(0.2126,0.7152,0.0722));
float frontShade=1.0-smoothstep(0.28,0.65,hairLuma);
vec3 frontViolet=frontY*vec3(1.10,0.61,1.53);
localResult=mix(localResult,frontViolet,vFrontPurpleMask*(0.30+0.55*frontShade));
#ifdef USE_MAP
vec2 frontTexel=1.0/vec2(textureSize(map,0));
vec4 frontCenter=texture2D(map,vMapUv);
vec4 frontLeft=texture2D(map,vMapUv-vec2(frontTexel.x*2.0,0.0));
vec4 frontRight=texture2D(map,vMapUv+vec2(frontTexel.x*2.0,0.0));
float frontCenterY=dot(frontCenter.rgb,vec3(0.2126,0.7152,0.0722));
float frontNeighborY=min(dot(frontLeft.rgb,vec3(0.2126,0.7152,0.0722)),dot(frontRight.rgb,vec3(0.2126,0.7152,0.0722)));
float frontLine=max(0.0,frontNeighborY-frontCenterY)*step(0.98,min(frontCenter.a,min(frontLeft.a,frontRight.a)));
localResult*=1.0+vFrontPurpleMask*min(0.18,frontLine*0.45/max(frontCenterY,0.04));
#endif
outgoingLight=mix(localOriginal,localResult,gameHairMaskStrength);
if(gameHairMaskView>0.5)outgoingLight=hairWeights*0.8;
`;
