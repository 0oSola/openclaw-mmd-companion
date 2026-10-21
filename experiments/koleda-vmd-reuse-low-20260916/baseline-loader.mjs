import {registerHooks} from 'node:module';
// 仅在本次 Node 测试进程恢复冻结基线的单行逻辑；不写源文件、不影响试播服务。
registerHooks({load(url,context,nextLoad){const r=nextLoad(url,context);if(url.endsWith('/mmdCompanionRuntime.js'))return {...r,source:String(r.source).replace('this.helper?._saveBones?.(this.model);','').replace('this.helper?._restoreBones?.(this.model);','')};return r;}});
