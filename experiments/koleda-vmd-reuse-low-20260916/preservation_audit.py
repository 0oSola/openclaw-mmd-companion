import bpy,numpy as np,json,hashlib,collections
from pathlib import Path
OUT=Path(__file__).parent;ROOT=Path('D:/workspace/MMD project/.scratch/koleda-idle-vmd')
def signature(body):
    def digest(a):return hashlib.sha256(np.asarray(a).tobytes()).hexdigest()
    return dict(vertices=len(body.data.vertices),faces=len(body.data.polygons),loops=len(body.data.loops),rest=digest([v.co[:] for v in body.data.vertices]),topology=digest([l.vertex_index for l in body.data.loops]),material_indices=digest([p.material_index for p in body.data.polygons]),uv={u.name:digest([x.uv[:] for x in u.data]) for u in body.data.uv_layers},materials=[m.name for m in body.data.materials])
bpy.ops.wm.open_mainfile(filepath=str(OUT/'Koleda_Independent_Import.blend'));a=signature(bpy.data.objects['GirlsFrontline KoledaDefault_mesh'])
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'v14d-preview-20260915/Koleda_V14D_GameEntrance_Preview.blend'));body=bpy.data.objects['GirlsFrontline KoledaDefault_mesh'];b=signature(body);fit=np.load(OUT/'fit-result.npz');imported=np.load(OUT/'import-mesh.npz')['mesh'];sf=fit['source_frames'];hair=np.load(ROOT/'source-cloth-20260916/hair-playback/samples.npz')['target_ids'];cape=np.load(ROOT/'source-cloth-20260916/playback/samples.npz')['target_ids'];outside=np.ones(len(body.data.vertices),bool);outside[hair]=False;outside[cape]=False;rows=[];max_error=0;worst=None
for f,s in enumerate(sf):
    bpy.context.scene.frame_set(int(s+1));bpy.context.view_layer.update();ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();p=np.array([v.co[:] for v in me.vertices]);ev.to_mesh_clear();e=np.linalg.norm(imported[f]-p,axis=1)*1000;vi=int(np.flatnonzero(outside)[np.argmax(e[outside])]);row=dict(frame=f,max_outside_mm=float(e[vi]),vertex=vi);rows.append(row)
    if e[vi]>max_error:max_error=float(e[vi]);worst=row
report=dict(signatures_equal=a==b,before=b,after=a,outside_hair_cape_max_mm=max_error,worst=worst,per_frame=rows,unchanged_within_0_1mm=max_error<.1)
(OUT/'preservation-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({k:v for k,v in report.items() if k not in ['before','after','per_frame']},ensure_ascii=False),flush=True)
