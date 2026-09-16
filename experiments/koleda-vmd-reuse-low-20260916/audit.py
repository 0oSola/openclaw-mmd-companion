import bpy, numpy as np, json, hashlib
from pathlib import Path
OUT=Path(__file__).parent
ROOT=Path('D:/workspace/MMD project/.scratch/koleda-idle-vmd/source-cloth-20260916')
BASE=ROOT.parent/'v14d-preview-20260915/Koleda_V14D_GameEntrance_Preview.blend'
bpy.ops.wm.open_mainfile(filepath=str(BASE))
body=bpy.data.objects['GirlsFrontline KoledaDefault_mesh'];arm=bpy.data.objects['GirlsFrontline KoledaDefault_arm']
fit=np.load(ROOT/'vmd-delivery/fit-samples.npz');err=np.linalg.norm(fit['fit']-fit['target'],axis=2)
hair=np.load(ROOT/'hair-playback/samples.npz');cape=np.load(ROOT/'playback/samples.npz')
regions={'hair':set(map(int,hair['target_ids'])),'cape':set(map(int,cape['target_ids']))}
rows=[]
for flat in np.argsort(err.ravel())[-20:][::-1]:
    f,i=np.unravel_index(flat,err.shape);vi=int(fit['vertex_ids'][i]);v=body.data.vertices[vi]
    rows.append(dict(frame=int(f),source_frame=int(fit['source_frames'][f]),vertex=vi,error_mm=float(err[f,i]*1000),region=next((k for k,s in regions.items() if vi in s),'other'),weights={body.vertex_groups[g.group].name:g.weight for g in v.groups if g.weight>1e-8},materials=sorted({body.material_slots[p.material_index].name for p in body.data.polygons if vi in p.vertices})))
summary={}
for label,ids in regions.items():
    mask=np.array([int(v) in ids for v in fit['vertex_ids']]);e=err[:,mask]*1000;summary[label]=dict(rms=float(np.sqrt(np.mean(e**2))),p95=float(np.quantile(e,.95)),max=float(e.max()))
report=dict(summary_mm=summary,worst=rows,red_capable_check='maximum error < 10mm',passed=bool(err.max()<.01))
(OUT/'baseline-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False),flush=True)
files=[BASE,ROOT/'vmd-delivery/fit-samples.npz',ROOT/'hair-playback/samples.npz',ROOT/'playback/samples.npz',ROOT/'bake_vmd_bones.py',ROOT.parent/'restart-20260915/entrance-decoded.json']
(OUT/'input-manifest.json').write_text(json.dumps([dict(path=str(p),bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in files],indent=2),encoding='utf-8')
