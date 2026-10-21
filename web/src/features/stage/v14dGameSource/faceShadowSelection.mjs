// 从权威控制器导出的阈值决定图层；相机不参与此函数。
export function selectFaceShadow(angle,previous,config){
  const t=config?.thresholds,h=config?.hysteresis,w=config?.blendWindow;
  if(!Number.isFinite(angle)||!Array.isArray(t)||t.length!==4||!Array.from({length:4},(_,i)=>i).every(i=>Object.hasOwn(t,i)&&Number.isFinite(t[i])&&(i===0||t[i]>t[i-1]))||!Number.isFinite(h)||h<0||!Number.isFinite(w)||w<=0)throw new Error('脸部选择器输入无效');
  if(previous!==null&&previous!==undefined&&(!Number.isInteger(previous)||previous<0||previous>4))throw new Error('上一脸部状态无效');
  const hard=angle<t[0]?0:angle<t[1]?1:angle<=t[2]?2:angle<=t[3]?3:4;
  let state=previous??hard;
  while(state<4&&angle>=t[state]+h)state++;
  while(state>0&&angle<=t[state-1]-h)state--;
  let a=hard,b=hard,weight=0;
  for(let i=0;i<4;i++)if(angle>=t[i]-w&&angle<=t[i]+w){
    const u=Math.max(0,Math.min(1,(angle-t[i]+w)/(2*w)));
    a=i;b=i+1;weight=u*u*(3-2*u);break;
  }
  return {angle,hardState:hard,state,layerA:a,layerB:b,weight};
}
