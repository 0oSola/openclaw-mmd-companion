import bpy,numpy as np,json
from pathlib import Path
OUT=Path(__file__).parent;ROOT=Path('D:/workspace/MMD project/.scratch/koleda-idle-vmd/source-cloth-20260916');z=dict(np.load(ROOT/'playback/samples.npz'));W=z['weights'];ids=z['target_ids'];limited=W.copy();keep=np.argsort(W,axis=1)[:,-4:];mask=np.zeros_like(W,dtype=bool);np.put_along_axis(mask,keep,True,axis=1);limited[~mask]=0;limited/=limited.sum(1)[:,None]
bpy.ops.wm.open_mainfile(filepath=str(OUT/'Cape_Source_Rebind.blend'));body=bpy.data.objects['GirlsFrontline KoledaDefault_mesh'];arm=bpy.data.objects['GirlsFrontline KoledaDefault_arm'];rest=np.array([body.data.vertices[int(i)].co[:] for i in ids]);bones=[arm.pose.bones[f'RC{j:03d}'] for j in range(W.shape[1])];inv=np.linalg.inv(np.array([b.bone.matrix_local for b in bones]));rows=[]
for f in range(119):
    bpy.context.scene.frame_set(f+1);bpy.context.view_layer.update();D=np.array([b.matrix for b in bones])@inv;pred=np.zeros_like(rest)
    for j in range(W.shape[1]):pred+=(rest@D[j,:3,:3].T+D[j,:3,3])*limited[:,j,None]
    e=np.linalg.norm(pred-z['simulated'][min(235,2*f)],axis=1)*1000;rows.append(dict(frame=f,max_mm=float(e.max()),rms_mm=float(np.sqrt(np.mean(e*e))),worst_vertex=int(ids[np.argmax(e)])))
report=dict(scope='只做数值裁剪对照，不修改已通过的Blender副本',vertices_over_four=int(((W>1e-8).sum(1)>4).sum()),max_mm=max(r['max_mm'] for r in rows),rows=rows);(OUT/'four-weight-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({k:v for k,v in report.items() if k!='rows'},ensure_ascii=False))
