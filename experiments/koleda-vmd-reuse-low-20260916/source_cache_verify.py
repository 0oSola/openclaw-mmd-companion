"""重新打开指定交付 Blender，实际求值 PC2，验证拟合输入并非未经证实的旧 NPZ。"""
import bpy,numpy as np,json,hashlib
from pathlib import Path
OUT=Path(__file__).parent;ROOT=Path('D:/workspace/MMD project/.scratch/koleda-idle-vmd/source-cloth-20260916');src=ROOT/'delivery-hair-cape/V14D_原动画复用_头发与披风.blend';before=hashlib.sha256(src.read_bytes()).hexdigest();bpy.ops.wm.open_mainfile(filepath=str(src));body=bpy.data.objects['GirlsFrontline KoledaDefault_mesh'];hair=dict(np.load(ROOT/'hair-playback/samples.npz'));cape=dict(np.load(ROOT/'playback/samples.npz'));rows=[];cache_paths=[]
for obj in bpy.data.objects:
    for m in obj.modifiers:
        if m.type=='MESH_CACHE':cache_paths.append(dict(object=obj.name,path=m.filepath,resolved=bpy.path.abspath(m.filepath),exists=Path(bpy.path.abspath(m.filepath)).exists()))
for sf in range(236):
    bpy.context.scene.frame_set(sf+1);bpy.context.view_layer.update();ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();p=np.array([v.co[:] for v in me.vertices]);ev.to_mesh_clear();rows.append(dict(source_frame=sf,hair_max_mm=float(np.linalg.norm(p[hair['target_ids']]-hair['simulated'][sf],axis=1).max()*1000),cape_max_mm=float(np.linalg.norm(p[cape['target_ids']]-cape['simulated'][sf],axis=1).max()*1000)))
report=dict(source=str(src),sha256=before,source_unchanged=hashlib.sha256(src.read_bytes()).hexdigest()==before,frames=236,cache_paths=cache_paths,hair_max_mm=max(r['hair_max_mm'] for r in rows),cape_max_mm=max(r['cape_max_mm'] for r in rows),rows=rows);report['passed']=report['source_unchanged'] and max(report['hair_max_mm'],report['cape_max_mm'])<.001
(OUT/'source-cache-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({k:v for k,v in report.items() if k!='rows'},ensure_ascii=False));assert report['passed']
