import os,sys,subprocess,json
from pathlib import Path
OUT=Path(__file__).parent;repo=OUT.parent.parent
command=[sys.executable,str(repo/'imgToAction/tools/motion_acceptance_gate.py'),str(OUT/'runtime-joints-canonical-render.json'),'--source','render','--left-arm-policy','skip','--output',str(OUT/'runtime-motion-gate.json')]
r=subprocess.run(command,capture_output=True,encoding='utf-8',env={**os.environ,'PYTHONUTF8':'1'},timeout=60)
(OUT/'runtime-motion-gate-output.txt').write_text(r.stdout+r.stderr,encoding='utf-8');report=json.loads((OUT/'runtime-motion-gate.json').read_text(encoding='utf-8'));summary=dict(command=command,exit_code=r.returncode,overall=report['overall'],passed=report['passed'],warned=report['warned'],failed=report['failed'],gates={k:dict(status=v['status'],reason=v.get('details',{}).get('reason')) for k,v in report['gates'].items()},semantic_scope='进场动作不是托下巴；不修改门禁，G4/G8/G11-G18不作为本动作语义合格证，G7 skip/G10缺FK参照不是已验证通过；总体FAIL仍阻断发布')
(OUT/'gate-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(summary,ensure_ascii=False))
