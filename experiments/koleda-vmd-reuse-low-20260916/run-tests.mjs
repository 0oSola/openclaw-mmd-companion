import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const out=path.dirname(fileURLToPath(import.meta.url));const cwd=path.resolve(out,'../..');
const cases=[['baseline-regression',['--import',pathToFileURL(path.join(out,'baseline-loader.mjs')).href,'--test',path.join(out,'seek-regression.test.mjs')]],['fixed-regression',['--test',path.join(out,'seek-regression.test.mjs')]],['baseline-suite',['--import',pathToFileURL(path.join(out,'baseline-loader.mjs')).href,'--test','web/tests/mmd-render-runtime.test.mjs']],['fixed-suite',['--test','web/tests/mmd-render-runtime.test.mjs']]];
const reports=[];
for(const [name,args] of cases){const r=spawnSync(process.execPath,args,{cwd,encoding:'utf8',timeout:60000});fs.writeFileSync(path.join(out,`${name}.txt`),r.stdout+r.stderr);const lines=(r.stdout+r.stderr).split(String.fromCharCode(10));reports.push({name,command:[process.execPath,...args],exitCode:r.status,error:r.error?.message,summary:lines.filter(x=>/tests |pass |fail |duration_ms /.test(x)),failures:lines.filter(x=>x.startsWith('✖ ')&&!x.includes('failing tests'))});}
fs.writeFileSync(path.join(out,'test-results.json'),JSON.stringify(reports,null,2));console.log(JSON.stringify(reports,null,2));
