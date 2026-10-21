export const EYE_MODES=Object.freeze(['reference','motion','open','closed','blink']);

export function eyePreviewWeight(mode,seconds){
  if(!EYE_MODES.includes(mode))throw new Error('未知眼部预览模式');
  if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<0)throw new Error('眼部预览时间必须为有限非负数');
  if(mode==='motion')return null;
  if(mode==='reference'||mode==='closed')return 1;
  if(mode==='open')return 0;
  const phase=seconds%3.2;
  const smooth=t=>t*t*(3-2*t);
  if(phase<0.8||phase>=1.16)return 0;
  if(phase<0.92)return smooth((phase-0.8)/0.12);
  if(phase<0.98)return 1;
  return 1-smooth((phase-0.98)/0.18);
}

export function withMorphOverride(influences,indices,weight,draw){
  if(!Array.isArray(indices)||typeof draw!=='function')throw new Error('无效眼部绘制参数');
  if(weight!==null&&(typeof weight!=='number'||!Number.isFinite(weight)||weight<0||weight>1))throw new Error('眼部权重必须位于0到1');
  const seen=new Set();
  for(let i=0;i<indices.length;i++){
    const index=indices[i];
    if(!Object.hasOwn(indices,i)||!Number.isInteger(index)||index<0||index>=influences.length||seen.has(index)||!Number.isFinite(influences[index]))throw new Error('无效闭眼形变索引或源权重');
    seen.add(index);
  }
  const source=indices.map(index=>influences[index]);
  try{
    if(weight!==null)for(const index of indices)influences[index]=weight;
    const rendered=indices.map(index=>influences[index]);
    const result=draw();
    return {source,rendered,result};
  }finally{
    for(let i=0;i<indices.length;i++)influences[indices[i]]=source[i];
  }
}
// 保留旧眼部调用方；同一绘制期恢复规则亦用于嘴角形变。
export const withEyeMorphOverride=withMorphOverride;
