"""原PMX副本只追加披风骨与四权重，单独输出配套VMD，不重导材质。"""
import bpy,numpy as np,json,sys,importlib,hashlib,logging
from pathlib import Path
OUT=Path(__file__).parent;OLD=OUT.parent;ROOT=Path('D:/workspace/MMD project/.scratch/koleda-idle-vmd/source-cloth-20260916');PMX=Path('D:/mmd/克莱妲原皮/GirlsFrontline KoledaDefault.pmx')
logging.getLogger().setLevel(logging.WARNING);pmx=importlib.import_module('bl_ext.blender_org.mmd_tools.core.pmx')
bpy.ops.wm.open_mainfile(filepath=str(OLD/'rebind-proof/Cape_Source_Rebind.blend'));body=bpy.data.objects['GirlsFrontline KoledaDefault_mesh'];arm=bpy.data.objects['GirlsFrontline KoledaDefault_arm'];root=bpy.data.objects['GirlsFrontline KoledaDefault'];scene=bpy.context.scene
assert not (OUT/'Koleda_CapeRebind.pmx').exists();original_hash=hashlib.sha256(PMX.read_bytes()).hexdigest();model=pmx.load(str(PMX));old_bones=len(model.bones);chest=next(i for i,b in enumerate(model.bones) if b.name=='上半身2');z=dict(np.load(ROOT/'playback/samples.npz'));W=z['weights'];ids=z['target_ids'];order=body.vertex_groups['mmd_vertex_order'];sorted_ids=np.argsort([order.weight(v.index) for v in body.data.vertices]);inverse=np.argsort(sorted_ids)
pmx_rest=np.array([v.co for v in model.vertices]);blend_rest=np.array([body.data.vertices[int(i)].co[:] for i in sorted_ids])[:,[0,2,1]]*12.5;assert np.abs(pmx_rest-blend_rest).max()<1e-4
for j in range(W.shape[1]):
    name=f'RC{j:03d}';b=pmx.Bone();b.name=b.name_e=name;b.location=(np.array(arm.data.bones[name].head_local)[[0,2,1]]*12.5).tolist();b.parent=chest;b.displayConnection=[0,.3125,0];b.transform_order=model.bones[chest].transform_order+1;model.bones.append(b)
limited=W.copy();keep=np.argsort(W,axis=1)[:,-4:];mask=np.zeros_like(W,dtype=bool);np.put_along_axis(mask,keep,True,axis=1);limited[~mask]=0;limited/=limited.sum(1)[:,None]
for i,vi in enumerate(ids):
    js=keep[i];bw=pmx.BoneWeight();bw.type=bw.BDEF4;bw.bones=[int(old_bones+j) for j in js];bw.weights=limited[i,js].tolist();model.vertices[int(inverse[vi])].weight=bw
for j in range(W.shape[1]):
    group=body.vertex_groups[f'RC{j:03d}'];group.remove(ids.tolist())
    for i in np.flatnonzero(limited[:,j]>0):group.add([int(ids[i])],float(limited[i,j]),'REPLACE')
pmx.save(str(OUT/'Koleda_CapeRebind.pmx'),model,add_uv_count=max((len(v.additional_uvs) for v in model.vertices),default=0))
frames=[];joints=[];scales=[]
for f in range(119):
    scene.frame_set(f+1);bpy.context.view_layer.update();ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();frames.append(np.array([v.co[:] for v in me.vertices]));ev.to_mesh_clear();scales.append(max(float(np.max(np.abs(np.array(b.scale)-1))) for b in arm.pose.bones if b.name.startswith('RC')));joints.append({b.mmd_bone.name_j or b.name:list(b.head) for b in arm.pose.bones})
np.savez_compressed(OUT/'reference.npz',mesh=frames,pmx_to_blender=sorted_ids,cape_ids=ids,weights=limited);scene.frame_set(1);bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'Koleda_CapeRebind_Export.blend'))
for obj in bpy.context.view_layer.objects:obj.select_set(False)
root.hide_set(False);root.select_set(True);bpy.context.view_layer.objects.active=root;r=bpy.ops.mmd_tools.export_vmd(filepath=str(OUT/'Koleda_CapeRebind.vmd'),scale=12.5,use_pose_mode=False,use_frame_range=True,preserve_curves=False,log_level='WARNING',save_log=False);assert 'FINISHED' in r
report=dict(pmx=str(OUT/'Koleda_CapeRebind.pmx'),vmd=str(OUT/'Koleda_CapeRebind.vmd'),old_bones=old_bones,new_bones=len(model.bones),changed_vertices=len(ids),max_scale_deviation=max(scales),source_hash=original_hash,source_unchanged=hashlib.sha256(PMX.read_bytes()).hexdigest()==original_hash,static_mapping_max=float(np.abs(pmx_rest-blend_rest).max()),hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [OUT/'Koleda_CapeRebind.pmx',OUT/'Koleda_CapeRebind.vmd']});(OUT/'export-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False),flush=True);assert report['source_unchanged'] and report['max_scale_deviation']<1e-5
