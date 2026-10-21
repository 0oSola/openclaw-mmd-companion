"use client";
import {useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {createWebEyePublisher} from "./webEyeSettings";
import {V14D_GAME_DEFAULT_SETTINGS,readV14dGameSettings,v14dGameSettingsStorageKey} from "./v14dGameAppearanceAssets.js";

const ranges=[
  ["exposure","曝光",-2,1,0.05],
  ["fabricDetail","织纹对比",0,2,0.05],
  ["legStructure","纵向细线",0,2,0.05],
  ["iris","虹膜参考光感",0,2,0.05],
  ["hairMaskStrength","头发分区上色",0,1,0.05],
] as const;

export function V14dGameControls({runtime,userId,modelPath,floating=false}:{runtime:any;userId:string;modelPath:string;floating?:boolean}){
  const [values,setValues]=useState<any>({...V14D_GAME_DEFAULT_SETTINGS});
  const [message,setMessage]=useState("");
  const [expanded,setExpanded]=useState(false);
  const [qualityMode,setQualityMode]=useState("auto");
  const [qualityScale,setQualityScale]=useState(1);
  const qualityKey="stage-render-quality-v1:"+JSON.stringify([userId,modelPath]);
  const storageKey=v14dGameSettingsStorageKey(userId,modelPath);
  const eyePublisher=useRef<ReturnType<typeof createWebEyePublisher>|null>(null);
  const eyeLocalReadValid=useRef(false);
  useEffect(()=>{
    if(!runtime?.renderQuality||runtime.destroyed)return;
    // 桌宠复用控件但不在本次网页优化范围；保持原精度，不读取网页绘制偏好。
    if(floating){runtime.setRenderQuality("full");return;}
    let mode="auto";
    try{const saved=userId?localStorage.getItem(qualityKey):null;if(saved&&["auto","full","fluid"].includes(saved))mode=saved;}catch{}
    runtime.setRenderQuality(mode);setQualityMode(mode);setQualityScale(runtime.renderQuality.scale);
    const timer=window.setInterval(()=>{if(!runtime.destroyed)setQualityScale(runtime.renderQuality.scale);},1000);
    return ()=>window.clearInterval(timer);
  },[runtime,qualityKey,userId,floating]);
  function changeQuality(mode:string){
    if(!runtime?.renderQuality||runtime.destroyed)return;
    runtime.setRenderQuality(mode);setQualityMode(mode);setQualityScale(runtime.renderQuality.scale);
    try{if(userId)localStorage.setItem(qualityKey,mode);}catch{setMessage("绘制模式已应用，但无法保存在本机。");}
  }
  useEffect(()=>{
    if(!runtime||runtime.destroyed)return;
    let next:ReturnType<typeof readV14dGameSettings>={...V14D_GAME_DEFAULT_SETTINGS};
    try{next=readV14dGameSettings(localStorage,userId,modelPath);eyeLocalReadValid.current=true;setMessage("");}
    catch{eyeLocalReadValid.current=false;setMessage("保存的参数无效，已恢复默认外观参数。");}
    runtime.appearanceAdapter.setSettings(next);setValues(next);
  },[runtime,storageKey,userId]);
  useEffect(()=>{
    if(!runtime||runtime.destroyed||!userId||floating)return;
    const publisher=createWebEyePublisher(userId,modelPath,setMessage);eyePublisher.current=publisher;
    // 生产挂载仅读取；v1迁移和默认motion均不能冒充用户保存。
    if(eyeLocalReadValid.current)void publisher.initialize(runtime.appearanceAdapter.getSettings().closedEye,{allowCreate:false});
    return()=>{publisher.dispose();if(eyePublisher.current===publisher)eyePublisher.current=null;};
  },[runtime,userId,modelPath,floating]);
  function change(patch:Record<string,unknown>){
    if(!runtime||runtime.destroyed)return;
    try{const next=runtime.appearanceAdapter.setSettings(patch);setValues(next);if(userId)localStorage.setItem(storageKey,JSON.stringify(next));setMessage(userId?"已保存在本机，按用户和模型隔离。":"未登录，不保存参数。");if(Object.hasOwn(patch,"closedEye"))eyePublisher.current?.save(next.closedEye);}
    catch(error){setMessage(error instanceof Error?error.message:String(error));}
  }
  const panel=<details open={expanded} data-testid="v14d-game-controls" data-pet-interactive={floating || undefined} onToggle={event=>setExpanded(event.currentTarget.open)} style={{position:floating||expanded?"fixed":"absolute",left:floating?12:undefined,right:floating?undefined:12,top:expanded&&!floating?76:12,zIndex:expanded?1100:12,width:floating&&!expanded?"auto":260,maxWidth:"calc(100% - 24px)",maxHeight:"70%",overflow:"auto",background:"linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02)), rgba(16,18,21,0.6)",backdropFilter:"blur(18px) saturate(1.3)",WebkitBackdropFilter:"blur(18px) saturate(1.3)",color:"#eceff2",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,padding:12,fontSize:13,pointerEvents:"auto"}} onPointerDown={event=>event.stopPropagation()}>
    <summary style={{cursor:"pointer"}}>{floating?"外观微调":"游戏参考 · 外观微调"}</summary>
    <fieldset disabled={!runtime} style={{border:0,padding:0,marginTop:10,display:"grid",gap:10}}>
      {!floating&&runtime?.renderQuality&&<label>舞台绘制<select aria-label="舞台绘制模式" value={qualityMode} onChange={e=>changeQuality(e.target.value)} style={{width:"100%"}}><option value="auto">自动平衡（推荐）</option><option value="full">原画质</option><option value="fluid">流畅优先</option></select><small style={{display:"block",marginTop:4}}>当前3D精度 {Math.round(qualityScale*100)}%。自动模式只在持续卡顿时降低精度；文字不降精度，导出截图仍用原画质。</small></label>}
      <label>显示变换<select aria-label="V14D显示变换" value={values.display} onChange={e=>change({display:e.target.value})} style={{width:"100%"}}><option value="game/ocio">本机 Blender OCIO</option><option value="game/builtin">内置 AgX（对照）</option></select></label>
      {ranges.map(([key,label,min,max,step])=><label key={key}>{label} <output>{Number(values[key]).toFixed(2)}</output><input aria-label={"V14D"+label} type="range" min={min} max={max} step={step} value={values[key]} onChange={e=>change({[key]:Number(e.target.value)})} style={{width:"100%"}}/></label>)}
      <label>眼部<select aria-label="V14D眼部" value={values.closedEye} onChange={e=>change({closedEye:e.target.value})} style={{width:"100%"}}><option value="reference">目标闭眼</option><option value="open">睁眼</option><option value="motion">跟随动作</option></select></label>
      <label>表情<select aria-label="V14D表情" value={values.smile===null?"motion":"smile"} onChange={e=>change({smile:e.target.value==="smile"?.55:null})} style={{width:"100%"}}><option value="smile">微笑（说话时跟随口型）</option><option value="motion">跟随动作</option></select></label>
      <label><input type="checkbox" checked={values.autoFace} onChange={e=>change({autoFace:e.target.checked})}/> 自动脸部阴影</label>
      <label>手动遮罩<select aria-label="V14D手动遮罩" disabled={values.autoFace} value={values.manualMask} onChange={e=>change({manualMask:Number(e.target.value)})}>{[0,1,2,3,4].map(i=><option key={i} value={i}>状态{i}</option>)}</select></label>
      <label><input type="checkbox" checked={values.lightingEnabled} onChange={e=>change({lightingEnabled:e.target.checked})}/> 启用六灯</label>
      <label><input type="checkbox" checked={values.hairMaskView} onChange={e=>change({hairMaskView:e.target.checked})}/> 头发遮罩诊断</label>
      <button type="button" onClick={()=>change({...V14D_GAME_DEFAULT_SETTINGS})}>恢复默认外观</button>
      <small role="status">{message||"仅本机资源；不是游戏着色器等价证书。"}</small>
    </fieldset>
  </details>;
  return expanded&&!floating&&typeof document!=="undefined"?createPortal(panel,document.body):panel;
}
