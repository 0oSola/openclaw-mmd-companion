import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=process.argv[2];
if(!source)throw Error('请传入现有预览的 .scratch/v14d-head-preview 目录');
const destination=path.join(web,'.scratch/v14d-head-preview');
const manifest=JSON.parse(await fs.readFile(path.join(source,'assets/manifest.json'),'utf8'));
const processor=JSON.parse(await fs.readFile(path.join(source,'ocio/processor.json'),'utf8'));
if(manifest.masks?.length!==5||processor.textures?.length!==2||processor.ocio!=='2.5.0')throw Error('源资源身份或数量不符');
const basename=name=>{if(typeof name!=='string'||path.basename(name)!==name||name.includes('..')||name.includes('/')||name.includes(String.fromCharCode(92)))throw Error('资源文件名无效');return name;};
const files=[['assets/manifest.json',null],['ocio/processor.json',null],['ocio/processor.glsl',processor.shaderSha256],...manifest.masks.map(m=>['assets/'+basename(m.file),null]),...processor.textures.map(t=>['ocio/'+basename(t.file),t.sha256])];
const hash=b=>createHash('sha256').update(b).digest('hex');
const prepared=[];
for(const [relative,expected] of files){const bytes=await fs.readFile(path.join(source,relative)),sha256=hash(bytes);if(expected&&sha256!==expected)throw Error('源资源哈希不符：'+relative);const target=path.join(destination,relative);try{const existing=await fs.readFile(target);if(hash(existing)!==sha256)throw Error('目标已有不同资源，拒绝覆盖：'+relative);}catch(error){if(error.code!=='ENOENT')throw error;}prepared.push({relative,sha256,bytes});}
for(const file of prepared){const target=path.join(destination,file.relative);await fs.mkdir(path.dirname(target),{recursive:true});try{await fs.copyFile(path.join(source,file.relative),target,fs.constants.COPYFILE_EXCL);}catch(error){if(error.code!=='EEXIST')throw error;}}
console.log(JSON.stringify({scope:'仅本机；不授予第三方LUT再分发许可',destination,files:prepared.map(({bytes,...entry})=>entry)},null,2));
