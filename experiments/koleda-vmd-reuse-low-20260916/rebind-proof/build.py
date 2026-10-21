import bpy,numpy as np,json,sys,hashlib,time
from pathlib import Path
from mathutils import Matrix,Vector
OUT=Path(__file__).parent;ROOT=Path('D:/workspace/MMD project/.scratch/koleda-idle-vmd/source-cloth-20260916');OLD=OUT.parent
sys.path.insert(0,str(ROOT.parent/'v14d-preview-20260915'))
from retarget_math import Source
source=OLD/'Koleda_HairCape_Baked.blend';pmx=Path('D:/mmd/克莱妲原皮/GirlsFrontline KoledaDefault.pmx');hashes={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [source,pmx]}
assert not (OUT/'Cape_Source_Rebind.blend').exists()
bpy.ops.wm.open_mainfile(filepath=str(source));body=bpy.data.objects['GirlsFrontline KoledaDefault_mesh'];arm=bpy.data.objects['GirlsFrontline KoledaDefault_arm'];scene=bpy.context.scene
z=dict(np.load(ROOT/'playback/samples.npz'));info=json.loads((ROOT/'c_KoledaSSR01_slg_cloth1_lod0.json').read_text(encoding='utf-8'));ids=z['target_ids'];W=z['weights'];active=z['source_bone_indices'];src=Source();sw=src.world();C=np.eye(4);C[:3,:3]=[[1,0,0],[0,0,1],[0,1,0]];boneids=[info['bone_ids'][int(i)] for i in active];names=[f'RC{i:03d}' for i in range(len(active))];original_names=set(arm.pose.bones.keys());rest=np.array([v.co[:] for v in body.data.vertices]);base=np.load(OLD/'fit-result.npz')['actual_mesh'];outside=np.ones(len(rest),bool);outside[ids]=False
for obj in bpy.context.view_layer.objects:obj.select_set(False)
arm.hide_set(False);arm.select_set(True);bpy.context.view_layer.objects.active=arm;bpy.ops.object.mode_set(mode='EDIT')
for name,k in zip(names,boneids):
    b=arm.data.edit_bones.new(name);p=(C@sw[k])[:3,3];b.head=p;b.tail=p+np.array([0,0,.025]);b.parent=arm.data.edit_bones['上半身2'];b.use_deform=True
bpy.ops.object.mode_set(mode='OBJECT')
for group in body.vertex_groups:
    if group.name in original_names:group.remove(ids.tolist())
for j,name in enumerate(names):
    group=body.vertex_groups.new(name=name)
    for i in np.flatnonzero(W[:,j]>0):group.add([int(ids[i])],float(W[i,j]),'REPLACE')
    arm.pose.bones[name].mmd_bone.name_j=name;arm.pose.bones[name].mmd_bone.name_e=name
rows=[];meshes=[];max_out=0.;chest=src.names['Chest_M'];cinv=np.linalg.inv(sw[chest]);rest_chest_inv=np.linalg.inv(np.array(arm.data.bones['上半身2'].matrix_local));inverses=[np.linalg.inv(sw[k]) for k in boneids]
for f in range(119):
    sf=min(235,f*2);scene.frame_set(f+1);bpy.context.view_layer.update();world=src.world(src.d['samples'][sf]);parent=arm.pose.bones['上半身2'];anchor=np.array(parent.matrix)@rest_chest_inv@np.linalg.inv(C@world[chest]@cinv@C)
    for j,(name,k) in enumerate(zip(names,boneids)):
        pb=arm.pose.bones[name];pose=Matrix((anchor@C@world[k]@inverses[j]@C@np.array(pb.bone.matrix_local)).tolist());pb.matrix_basis=pb.bone.convert_local_to_pose(pose,pb.bone.matrix_local,invert=True,parent_matrix=parent.matrix,parent_matrix_local=parent.bone.matrix_local);pb.rotation_mode='QUATERNION';pb.keyframe_insert('location',frame=f+1);pb.keyframe_insert('rotation_quaternion',frame=f+1);pb.keyframe_insert('scale',frame=f+1)
    bpy.context.view_layer.update();ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();p=np.array([v.co[:] for v in me.vertices]);ev.to_mesh_clear();meshes.append(p);e=np.linalg.norm(p[ids]-z['simulated'][sf],axis=1)*1000;oe=float(np.linalg.norm(p[outside]-base[f,outside],axis=1).max()*1000);max_out=max(max_out,oe);rows.append(dict(frame=f,max_mm=float(e.max()),rms_mm=float(np.sqrt(np.mean(e*e))),outside_max_mm=oe,worst_vertex=int(ids[np.argmax(e)])))
scene.frame_set(1);bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'Cape_Source_Rebind.blend'));np.savez_compressed(OUT/'mesh.npz',mesh=meshes)
report=dict(scope='仅模型副本披风6483点源权重重绑证明；不是PMX/VMD发布',new_bones=len(names),vertices=len(ids),max_influences=int((W>1e-8).sum(1).max()),vertices_over_four_influences=int(((W>1e-8).sum(1)>4).sum()),old_max_mm=71.99184495721332,new_max_mm=max(r['max_mm'] for r in rows),outside_max_mm=max_out,rows=rows,source_hashes=hashes,inputs_unchanged=all(hashlib.sha256(Path(p).read_bytes()).hexdigest()==h for p,h in hashes.items()),mapping=[dict(target=n,source=info['bone_names'][int(a)],source_id=k) for n,a,k in zip(names,active,boneids)])
(OUT/'build-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({k:v for k,v in report.items() if k not in ['rows','mapping']},ensure_ascii=False),flush=True);assert report['new_max_mm']<.1 and max_out<.01 and report['inputs_unchanged']
