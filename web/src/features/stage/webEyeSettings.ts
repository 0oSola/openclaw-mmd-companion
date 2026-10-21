import {loadSession} from '@/lib/session';

export type EyeMode='reference'|'open'|'motion'|'closed';
type Saved={user_id:string;model_path:string;closed_eye:EyeMode;revision:number;updated_at:string};
export function createWebEyePublisher(userId:string,modelPath:string,onStatus:(message:string)=>void){
 let disposed=false,busy=false,pending:EyeMode|null=null,intent=0;
 const controller=new AbortController();
 const valid=(mode:unknown):mode is EyeMode=>['reference','open','motion','closed'].includes(mode as string);
 const current=()=>{if(disposed)return false;const session=loadSession();if(session?.userId!==userId||!session.token){disposed=true;pending=null;controller.abort();return false;}return true;};
 async function request(method:'GET'|'PUT',mode?:EyeMode,initialize=false):Promise<Saved|null>{
  const session=loadSession();if(!current()||!session?.token)throw Error('未登录，不同步眼部设置');
  const response=await fetch('/api/backend/desktop-pet/eye-settings'+(method==='GET'?'?model_path='+encodeURIComponent(modelPath):''),{method,signal:controller.signal,cache:'no-store',headers:{Authorization:'Bearer '+session.token,'Content-Type':'application/json',...(initialize?{'If-None-Match':'*'}:{})},...(method==='PUT'?{body:JSON.stringify({model_path:modelPath,closed_eye:mode})}:{})});
  if(initialize&&response.status===412)return null;
  const value=await response.json();if(!response.ok)throw Error('眼部来源保存失败：HTTP '+response.status);
  if(value===null&&method==='GET')return null;
  if(!value||value.user_id!==userId||value.model_path!==modelPath||!valid(value.closed_eye)||!Number.isSafeInteger(value.revision)||value.revision<1)throw Error('眼部保存响应绑定非法');
  if(method==='PUT'&&value.closed_eye!==mode)throw Error('眼部保存响应不是本次提交值');
  return value;
 }
 const notify=(message:string)=>{if(current())onStatus(message);};
 async function drain(){
  if(busy||disposed)return;busy=true;
  try{while(pending!==null&&current()){const mode=pending,version=intent;pending=null;try{await request('PUT',mode);if(version===intent)notify('本机已保存，眼部配置已保存到同步来源。');}catch{if(version===intent)notify('本机已保存，眼部同步失败；服务器结果未确认。');}}}
  finally{busy=false;}
 }
 return {
  async initialize(mode:unknown,{allowCreate=true}:{allowCreate?:boolean}={}){
   if(!valid(mode)||!current())return;
   busy=true;notify(allowCreate?'本机已保存，正在确认眼部同步来源。':'正在读取服务器保存的眼部配置。');
   try{const saved=await request('GET');if(!saved){if(!allowCreate){if(!pending)notify('眼部尚未同步；没有服务器保存值，请在主舞台选择眼部模式后保存。');}else{const initialMode=pending??mode,version=intent;const result=await request('PUT',initialMode,true);if(result&&intent===version&&pending===initialMode)pending=null;if(!pending)notify(result?'本机已保存，眼部初始配置已保存到同步来源。':'服务器已有眼部配置；本机保持当前值。');}}else if(!pending)notify(saved.closed_eye===mode?'使用已保存的眼部配置；不代表Web在线。':'服务器已有眼部配置；本机保持当前值。');}
   catch{if(!pending)notify('本机设置保留，眼部同步来源不可用。');}
   finally{busy=false;if(!disposed)void drain();}
  },
  save(mode:unknown){if(!valid(mode)||!current())return;pending=mode;intent++;notify('本机已保存，正在同步最新眼部设置。');void drain();},
  dispose(){disposed=true;pending=null;controller.abort();},
 };
}
