import bpy,numpy as np,json,sys
from pathlib import Path
OUT=Path(__file__).parent;ROOT=Path('D:/workspace/MMD project/.scratch/koleda-idle-vmd/source-cloth-20260916')
sys.path.insert(0,str(ROOT.parent/'v14d-preview-20260915'))
from retarget_math import Source
src=Source();sw=src.world();C=np.eye(4);C[:3,:3]=[[1,0,0],[0,0,1],[0,1,0]]
bpy.ops.wm.open_mainfile(filepath=str(ROOT.parent/'v14d-preview-20260915/Koleda_V14D_GameEntrance_Preview.blend'))
body=bpy.data.objects['GirlsFrontline KoledaDefault_mesh'];arm=bpy.data.objects['GirlsFrontline KoledaDefault_arm'];bones=list(arm.pose.bones);names=[b.name for b in bones];rest=np.array([v.co[:] for v in body.data.vertices]);R=np.array([b.bone.matrix_local for b in bones]);W=np.zeros((len(rest),len(bones)))
for v in body.data.vertices:
    for g in v.groups:
        n=body.vertex_groups[g.group].name
        if n in names:W[v.index,names.index(n)]=g.weight
W/=np.maximum(W.sum(1)[:,None],1e-12)
datasets={};mapping={};rows=[]
for region,file,infofile,activekey,anchor in [('hair','hair-playback/samples.npz','c_KoledaSSR01_slg_hair_lod0.json','active','Head_M'),('cape','playback/samples.npz','c_KoledaSSR01_slg_cloth1_lod0.json','source_bone_indices','Chest_M')]:
    z=dict(np.load(ROOT/file));info=json.loads((ROOT/infofile).read_text(encoding='utf-8'));ids=z['target_ids'];S=z['weights'];active=z[activekey];T=W[ids];datasets[region]=(z,info,active,anchor)
    for j,n in enumerate(names):
        if T[:,j].sum()<1e-6:continue
        errors=np.sum((S-T[:,j,None])**2,axis=0);k=int(np.argmin(errors));corr=float(np.dot(S[:,k],T[:,j])/max(np.linalg.norm(S[:,k])*np.linalg.norm(T[:,j]),1e-12));entry=dict(region=region,target=n,source=info['bone_names'][active[k]],source_id=info['bone_ids'][active[k]],max_weight_error=float(np.abs(S[:,k]-T[:,j]).max()),cosine=corr,mass=float(T[:,j].sum()),other_mass=float(W[:,j].sum()-T[:,j].sum()));rows.append(entry)
        if n.startswith(('Hair','Cape','Cloth_')) and (j not in mapping or entry['mass']>mapping[j]['mass']):mapping[j]=entry
changing=list(mapping);ids=np.flatnonzero(W[:,changing].sum(1)>1e-8);x=rest[ids];w=W[ids];source_frames=np.minimum(235,np.arange(119)*2);Ds=[];original=[];desired=[];errors=[];all_errors=[]
for sf in source_frames:
    bpy.context.scene.frame_set(int(sf+1));bpy.context.view_layer.update();m=np.array([b.matrix for b in bones]);original.append(m);D=m@np.linalg.inv(R);world=src.world(src.d['samples'][sf]);anchors={}
    for region,(z,info,active,an) in datasets.items():
        target='頭' if region=='hair' else '上半身2';j=names.index(target);sid=src.names[an];anchors[region]=D[j]@np.linalg.inv(C@world[sid]@np.linalg.inv(sw[sid])@C)
    for j,e in mapping.items():
        k=e['source_id'];D[j]=anchors[e['region']]@C@world[k]@np.linalg.inv(sw[k])@C
    ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();p=np.array([v.co[:] for v in me.vertices]);ev.to_mesh_clear();goal=p.copy()
    for z,_,_,_ in datasets.values():goal[z['target_ids']]=z['simulated'][sf]
    pred=np.zeros((len(ids),3))
    for j in range(len(bones)):
        if w[:,j].sum()>0:pred+=(x@D[j,:3,:3].T+D[j,:3,3])*w[:,j,None]
    desired.append(goal[ids]);Ds.append(D);errors.append(np.linalg.norm(pred-goal[ids],axis=1))
    # 单变量实验：只在数学模型中允许 Chest_L/R 使用源对应，不导出、不修改 PMX。
    trial=pred.copy()
    for e in rows:
        if e['region']=='cape' and e['target'] in ['Chest_L','Chest_R']:
            j=names.index(e['target']);k=e['source_id'];d=anchors['cape']@C@world[k]@np.linalg.inv(sw[k])@C;trial+=((x@d[:3,:3].T+d[:3,3])-(x@D[j,:3,:3].T+D[j,:3,3]))*w[:,j,None]
    all_errors.append(np.linalg.norm(trial-goal[ids],axis=1))
def stats(e):
    e=np.array(e)*1000;return dict(rms=float(np.sqrt(np.mean(e**2))),p95=float(np.quantile(e,.95)),max=float(e.max()))
report=dict(mapping=rows,direct_frozen_body_mm=stats(errors),chest_unfrozen_math_only_mm=stats(all_errors),warning='Chest 实验仅数值诊断，不授权改变身体动作或重绑')
(OUT/'direct-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
np.savez_compressed(OUT/'direct-data.npz',D=Ds,original=original,desired=desired,vertex_ids=ids,source_frames=source_frames,rest=rest,weights=W,rest_matrices=R,changing=changing,names=names)
print(json.dumps({k:v for k,v in report.items() if k!='mapping'},ensure_ascii=False),flush=True)
