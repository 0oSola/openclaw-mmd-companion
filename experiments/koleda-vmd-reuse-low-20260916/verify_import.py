"""在原始无物理模型中清空动作后独立导入，对比局部姿态与实际变形网格。"""
import bpy,numpy as np,json,struct,math
from pathlib import Path
from mathutils import Quaternion,Vector
OUT=Path(__file__).parent;ROOT=Path('D:/workspace/MMD project/.scratch/koleda-idle-vmd');path=OUT/'Koleda_Entrance_HairCape_Trial.vmd'
raw=path.read_bytes();count=struct.unpack_from('<I',raw,50)[0];records={};off=54
for i in range(count):
    name=raw[off:off+15].split(bytes([0]))[0].decode('shift_jis');f,*v=struct.unpack_from('<I7f',raw,off+15);assert all(math.isfinite(x) for x in v);records.setdefault(name,[]).append([f,*v]);off+=111
expected=json.loads((OUT/'expected-local.json').read_text(encoding='utf-8'));fit=np.load(OUT/'fit-result.npz');bpy.ops.wm.open_mainfile(filepath=str(ROOT/'v14d-preview-20260915/Koleda_V14D_GameEntrance_Preview.blend'));scene=bpy.context.scene;arm=bpy.data.objects['GirlsFrontline KoledaDefault_arm'];body=bpy.data.objects['GirlsFrontline KoledaDefault_mesh'];root=bpy.data.objects['GirlsFrontline KoledaDefault'];arm.animation_data_clear()
name_audit=[]
for pb in arm.pose.bones:
    pb.location=(0,0,0);pb.rotation_mode='QUATERNION';pb.rotation_quaternion=(1,0,0,0);pb.scale=(1,1,1);n=pb.mmd_bone.name_j or pb.name;encoded=n.encode('shift_jis',errors='replace');name_audit.append(dict(blender=pb.name,pmx=n,bytes=len(encoded),truncated=len(encoded)>15))
for o in bpy.context.view_layer.objects:o.select_set(False)
root.select_set(True);bpy.context.view_layer.objects.active=root;scene.frame_set(0);r=bpy.ops.mmd_tools.import_vmd(filepath=str(path),bone_mapper='PMX',scale=.08,margin=0,create_new_action=True,use_pose_mode=False,update_scene_settings=False);assert 'FINISHED' in r
pose_max=0.;rot_max=0.;meshes=[];joints=[];per_frame=[];fit_mesh=fit['actual_mesh']
for f,row in enumerate(expected):
    scene.frame_set(f);bpy.context.view_layer.update()
    for n,d in row.items():
        pb=arm.pose.bones[n];pose_max=max(pose_max,(pb.location-Vector(d['location'])).length);rot_max=max(rot_max,1-abs(pb.rotation_quaternion.normalized().dot(Quaternion(d['rotation']).normalized())))
    ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();p=np.array([v.co[:] for v in me.vertices]);ev.to_mesh_clear();meshes.append(p);e=np.linalg.norm(p-fit_mesh[f],axis=1)*1000;per_frame.append(dict(frame=f,max_mm=float(e.max()),rms_mm=float(np.sqrt(np.mean(e*e)))))
    joints.append(dict(index=f,joints={b.mmd_bone.name_j or b.name:[float(b.head.x*12.5),float(b.head.z*12.5),float(b.head.y*12.5)] for b in arm.pose.bones}))
meshes=np.array(meshes);e=np.linalg.norm(meshes[:,fit['vertex_ids']]-fit['target'],axis=2)*1000
moving={n:float(np.max(np.ptp(np.array(rows)[:,1:],axis=0))) for n,rows in records.items() if n.startswith(('Hair','Cape','Cloth_'))}
report=dict(bone_keyframes=count,bone_names=len(records),name_audit=name_audit,hair_cape_dynamic_bones=sum(v>1e-5 for v in moving.values()),motion_ranges=moving,roundtrip_location_max=pose_max,roundtrip_quaternion_dot_error=rot_max,mesh_roundtrip_max_mm=max(r['max_mm'] for r in per_frame),source_cache_error_mm=dict(rms=float(np.sqrt(np.mean(e*e))),p95=float(np.quantile(e,.95)),max=float(e.max())),per_frame=per_frame,roundtrip_passed=pose_max<1e-4 and rot_max<1e-5 and max(r['max_mm'] for r in per_frame)<.1)
(OUT/'independent-import-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');np.savez_compressed(OUT/'import-mesh.npz',mesh=meshes);(OUT/'import-joints-pmx.json').write_text(json.dumps(joints,ensure_ascii=False),encoding='utf-8')
# 用未修改 PMX 的顶点顺序映射对齐网页几何；mmd_vertex_order 保存导入器次序。
ordergroup=body.vertex_groups.get('mmd_vertex_order');order=[]
for v in body.data.vertices:
    order.append(ordergroup.weight(v.index) if ordergroup else v.index/len(body.data.vertices))
sorted_ids=np.argsort(order);sample_frames=[0,15,30,45,60,75,83,90,105,118]
(OUT/'web-reference.json').write_text(json.dumps(dict(frames=sample_frames,positions={str(f):(meshes[f,sorted_ids][:,[0,2,1]]*np.array([12.5,12.5,-12.5])).tolist() for f in sample_frames},blender_ids=sorted_ids.tolist(),regions={k:np.flatnonzero(np.isin(sorted_ids,np.load(ROOT/'source-cloth-20260916'/file)['target_ids'])).tolist() for k,file in [('hair','hair-playback/samples.npz'),('cape','playback/samples.npz')]},rest=(np.array([body.data.vertices[int(i)].co[:] for i in sorted_ids])[:,[0,2,1]]*np.array([12.5,12.5,-12.5])).tolist()),separators=(',',':')),encoding='utf-8')
scene.frame_set(0);bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'Koleda_Independent_Import.blend'));print(json.dumps({k:v for k,v in report.items() if k not in ['name_audit','motion_ranges','per_frame']},ensure_ascii=False),flush=True);assert report['roundtrip_passed']
