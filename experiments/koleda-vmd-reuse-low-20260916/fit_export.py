"""固定身体与原 PMX，使用源骨映射初值后做有界拟合；不改权重。"""
import bpy,numpy as np,json,time,hashlib
from pathlib import Path
from mathutils import Matrix
OUT=Path(__file__).parent;ROOT=Path('D:/workspace/MMD project/.scratch/koleda-idle-vmd');start=time.monotonic()
z=np.load(OUT/'direct-data.npz');D=z['D'].copy();original=z['original'];desired=z['desired'];ids=z['vertex_ids'];rest=z['rest'];W=z['weights'][ids];x=rest[ids];R=z['rest_matrices'];changing=z['changing'];names=list(z['names']);frames=len(D)
pred=np.zeros_like(desired)
for j in range(len(names)):
    if W[:,j].sum()>0:pred+=(np.einsum('fij,vj->fvi',D[:,j,:3,:3],x)+D[:,j,None,:3,3])*W[None,:,j,None]
data={}
for j in changing:
    vi=np.flatnonzero(W[:,j]>1e-8);w=W[vi,j];w2=w*w;mass=w2.sum();xx=x[vi];cx=(xx*w2[:,None]).sum(0)/mass;data[j]=(vi,w,w2,mass,xx,cx,xx-cx)
history=[]
for iteration in range(80):
    for j in changing:
        vi,w,w2,mass,xx,cx,xc=data[j];old=np.einsum('fij,vj->fvi',D[:,j,:3,:3],xx)+D[:,j,None,:3,3];target=(desired[:,vi]-pred[:,vi]+old*w[None,:,None])/w[None,:,None];cy=(target*w2[None,:,None]).sum(1)/mass;yc=target-cy[:,None,:];cov=np.einsum('vi,fvj,v->fij',xc,yc,w2);u,_,vt=np.linalg.svd(cov);rot=vt.transpose(0,2,1)@u.transpose(0,2,1);flip=np.linalg.det(rot)<0;vt[flip,-1,:]*=-1;rot=vt.transpose(0,2,1)@u.transpose(0,2,1);translation=cy-np.einsum('fij,j->fi',rot,cx);new=np.einsum('fij,vj->fvi',rot,xx)+translation[:,None,:];pred[:,vi]+=(new-old)*w[None,:,None];D[:,j,:3,:3]=rot;D[:,j,:3,3]=translation
    e=np.linalg.norm(pred-desired,axis=2)*1000;history.append(dict(iteration=iteration+1,rms_mm=float(np.sqrt(np.mean(e*e))),p95_mm=float(np.quantile(e,.95)),maximum_mm=float(e.max())))
    if iteration%10==9:print(json.dumps(history[-1]),flush=True)
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'v14d-preview-20260915/Koleda_V14D_GameEntrance_Preview.blend'));scene=bpy.context.scene;body=bpy.data.objects['GirlsFrontline KoledaDefault_mesh'];arm=bpy.data.objects['GirlsFrontline KoledaDefault_arm'];bones=[arm.pose.bones[n] for n in names];target_matrices=D@R;ordered=sorted(range(len(bones)),key=lambda j:len(bones[j].parent_recursive));arm.animation_data_clear();scene.frame_start=1;scene.frame_end=frames;scene.render.fps=30;previous={};expected=[];mesh_samples=[];actual_error=0.;body_error=0.;joints=[]
for f in range(frames):
    scene.frame_set(f+1);poses={}
    for j in ordered:
        pb=bones[j];kwargs=dict(parent_matrix=poses[pb.parent.name],parent_matrix_local=pb.parent.bone.matrix_local) if pb.parent else {};pose=Matrix(target_matrices[f,j].tolist()) if j in changing else Matrix(original[f,j].tolist());pb.matrix_basis=pb.bone.convert_local_to_pose(pose,pb.bone.matrix_local,invert=True,**kwargs);pb.rotation_mode='QUATERNION';q=pb.rotation_quaternion.copy()
        if pb.name in previous and q.dot(previous[pb.name])<0:q.negate();pb.rotation_quaternion=q
        previous[pb.name]=q.copy();poses[pb.name]=pose;pb.keyframe_insert('location',frame=f+1,group=pb.name);pb.keyframe_insert('rotation_quaternion',frame=f+1,group=pb.name)
        if 'ＩＫ' in pb.name or 'IK' in pb.name:pb.mmd_ik_toggle=False;pb.keyframe_insert('mmd_ik_toggle',frame=f+1)
    bpy.context.view_layer.update();ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());me=ev.to_mesh();p=np.array([v.co[:] for v in me.vertices]);ev.to_mesh_clear();mesh_samples.append(p);actual_error=max(actual_error,float(np.linalg.norm(p[ids]-pred[f],axis=1).max()));body_error=max(body_error,max(float(np.abs(np.array(pb.matrix)-original[f,j]).max()) for j,pb in enumerate(bones) if j not in changing));expected.append({b.name:dict(location=list(b.location),rotation=list(b.rotation_quaternion)) for b in bones});joints.append(dict(index=f,joints={b.mmd_bone.name_j or b.name:[float(b.head.x*12.5),float(b.head.z*12.5),float(b.head.y*12.5)] for b in bones}))
np.savez_compressed(OUT/'fit-result.npz',target=desired,fit=pred,actual_mesh=mesh_samples,vertex_ids=ids,source_frames=z['source_frames'])
(OUT/'expected-local.json').write_text(json.dumps(expected,ensure_ascii=False),encoding='utf-8');(OUT/'joints-pmx.json').write_text(json.dumps(joints,ensure_ascii=False),encoding='utf-8')
report=dict(history=history,blender_fit_max_mm=actual_error*1000,unchanged_body_matrix_error=body_error,frames=frames,fps=30,source_duration=235/60,vmd_duration=118/30,end_padding_seconds=1/60,model_changed=False,weights_changed=False,elapsed_seconds=time.monotonic()-start)
(OUT/'fit-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8');assert actual_error<1e-5 and body_error<1e-4
scene.frame_set(1);bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'Koleda_HairCape_Baked.blend'));root=bpy.data.objects['GirlsFrontline KoledaDefault']
for o in bpy.context.view_layer.objects:o.select_set(False)
root.hide_set(False);root.select_set(True);bpy.context.view_layer.objects.active=root
p=OUT/'Koleda_Entrance_HairCape_Trial.vmd';result=bpy.ops.mmd_tools.export_vmd(filepath=str(p),scale=12.5,use_pose_mode=False,use_frame_range=True,preserve_curves=False,log_level='WARNING',save_log=False);assert 'FINISHED' in result
print('EXPORTED',p,p.stat().st_size,hashlib.sha256(p.read_bytes()).hexdigest(),flush=True)
