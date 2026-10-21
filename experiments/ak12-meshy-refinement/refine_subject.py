"""保留 Meshy 主体与发型，迁移克莱妲脸部组件及原形态键。"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parent
DONOR=ROOT.parent/'koleda-local-parts-study'/'KoledaSummer_Parts.blend'
GLB=Path(r'C:\Users\KSG\Downloads\meshy_1788865300370.glb')
COMPONENTS=['Part_Face','Part_UpperTeeth','Part_LowerTeeth','Part_Tongue','Part_EyeWhite','Part_Brows','Part_Lashes','Part_Eyes','Part_Eyes_Overlay','Part_EyeShadow','Part_Emotions','Part_HairB']


def new_collection(name):
    col=bpy.data.collections.new(name);bpy.context.scene.collection.children.link(col);return col


def prepare_head():
    bpy.ops.preferences.addon_enable(module='bl_ext.blender_org.mmd_tools')
    before=set(bpy.data.objects)
    with bpy.data.libraries.load(str(DONOR),link=False) as (available,loaded):
        assert all(name in available.objects for name in COMPONENTS)
        loaded.objects=COMPONENTS+['Part_BodySkin','Part_HairA']
    parts=list(loaded.objects[:-2]);donor_body=loaded.objects[-2];donor_backhair=loaded.objects[-1]
    spec=importlib.util.spec_from_file_location('neck_subset',ROOT/'extract_subject.py')
    helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    coordinates=np.empty(len(donor_body.data.vertices)*3,dtype=np.float32);donor_body.data.vertices.foreach_get('co',coordinates);coordinates=coordinates.reshape(-1,3)
    indices=np.empty(len(donor_body.data.loops),dtype=np.int32);donor_body.data.loops.foreach_get('vertex_index',indices);indices=indices.reshape(-1,3)
    centers=coordinates[indices].mean(axis=1)
    neck_mask=(centers[:,2]>1.352)&(np.abs(centers[:,0])<.060)
    neck,used=helper.subset_mesh(donor_body,neck_mask,'Part_NeckBridge')
    for group in donor_body.vertex_groups:neck.vertex_groups.new(name=group.name)
    for i,old in enumerate(used):
        for group in donor_body.data.vertices[int(old)].groups:neck.vertex_groups[group.group].add([i],group.weight,'REPLACE')
    for key in donor_body.data.shape_keys.key_blocks:
        target=neck.shape_key_add(name=key.name,from_mix=False)
        for i,old in enumerate(used):target.data[i].co=key.data[int(old)].co
    mod=neck.modifiers.new('Inherited_NeckArmature','ARMATURE');mod.object=donor_body.find_armature()
    parts.append(neck)
    cap_co=np.empty(len(donor_backhair.data.vertices)*3,dtype=np.float32);donor_backhair.data.vertices.foreach_get('co',cap_co);cap_co=cap_co.reshape(-1,3)
    cap_ids=np.empty(len(donor_backhair.data.loops),dtype=np.int32);donor_backhair.data.loops.foreach_get('vertex_index',cap_ids);cap_ids=cap_ids.reshape(-1,3)
    cap_centers=cap_co[cap_ids].mean(axis=1)
    cap_mask=(cap_centers[:,2]>1.483)&(cap_centers[:,1]<.063)
    cap,cap_used=helper.subset_mesh(donor_backhair,cap_mask,'Part_FrontCrown')
    for group in donor_backhair.vertex_groups:cap.vertex_groups.new(name=group.name)
    for i,old in enumerate(cap_used):
        for group in donor_backhair.data.vertices[int(old)].groups:cap.vertex_groups[group.group].add([i],group.weight,'REPLACE')
    for key in donor_backhair.data.shape_keys.key_blocks:
        target=cap.shape_key_add(name=key.name,from_mix=False)
        for i,old in enumerate(cap_used):target.data[i].co=key.data[int(old)].co
    cap_mod=cap.modifiers.new('Inherited_CrownArmature','ARMATURE');cap_mod.object=donor_backhair.find_armature();parts.append(cap)
    source_rig=parts[0].find_armature()
    required={'首','頭','左目','右目'}
    for ob in parts:
        for vertex in ob.data.vertices:
            for weight in vertex.groups:
                name=ob.vertex_groups[weight.group].name
                if weight.weight>0 and name in source_rig.data.bones:required.add(name)
    for name in list(required):
        bone=source_rig.data.bones[name]
        while bone.parent and bone.name!='首':
            bone=bone.parent;required.add(bone.name)
            if bone.name=='首':break
    bone_info={bone.name:{'matrix':bone.matrix_local.copy(),'length':bone.length,'parent':bone.parent.name if bone.parent and bone.parent.name in required else None} for bone in source_rig.data.bones if bone.name in required}
    collection=new_collection('02_TransferredFace')
    rig_data=bpy.data.armatures.new('TransferredFace_RigData');rig=bpy.data.objects.new('TransferredFace_Rig',rig_data);collection.objects.link(rig)
    bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
    bpy.ops.object.mode_set(mode='EDIT')
    for name,info in bone_info.items():
        bone=rig_data.edit_bones.new(name);bone.matrix=info['matrix'];bone.length=info['length']
    for name,info in bone_info.items():
        if info['parent']:rig_data.edit_bones[name].parent=rig_data.edit_bones[info['parent']]
    bpy.ops.object.mode_set(mode='OBJECT')
    transform=Matrix.Translation((-.024,-.260,1.623))@Matrix.Rotation(-.20,4,'Y')@Matrix.Diagonal((1.20,1.15,1.20,1))@Matrix.Translation((0,0,-1.465))
    rig.matrix_world=transform;rig.hide_render=True;rig.show_in_front=True
    report=[]
    for ob in parts:
        for col in list(ob.users_collection):col.objects.unlink(ob)
        collection.objects.link(ob)
        original=ob.name
        ob.name='Transferred_'+original.removeprefix('Part_')
        ob.parent=rig;ob.parent_type='OBJECT';ob.matrix_parent_inverse=Matrix.Identity(4);ob.matrix_basis=Matrix.Identity(4)
        for mod in ob.modifiers:
            if mod.type=='ARMATURE':mod.object=rig
        if ob.data.shape_keys:
            for key in ob.data.shape_keys.key_blocks:key.value=0
            for name,value in [('まばたき',.35),('ウィンク右',.58),('口角上げ',.16),('瞳小',.14)]:
                key=ob.data.shape_keys.key_blocks.get(name)
                if key:key.value=value
            fit=ob.shape_key_add(name='Fit_Meshy_Forehead',from_mix=False)
            for point in fit.data:
                t=max(0,min(1,(point.co.z-1.478)/.060));t=t*t*(3-2*t)
                point.co.y+=.073*t
            # 前发与脸同源后，停用只为旧 Meshy 刘海试配的额头压缩，保留此键便于对照。
            fit.value=0
            if original=='Part_HairB':
                fit=ob.shape_key_add(name='Fit_FrontHair',from_mix=False)
                for point in fit.data:
                    t=max(0,min(1,(1.44-point.co.z)/.25))
                    point.co.y+=.045*t;point.co.x*=1-.12*t
                fit.value=1
            elif original=='Part_FrontCrown':
                fit=ob.shape_key_add(name='Fit_CrownHeight',from_mix=False)
                for point in fit.data:
                    if point.co.z>1.56:point.co.z=1.56+(point.co.z-1.56)*.50
                fit.value=1
        ob['迁移来源']=str(DONOR);ob['原对象名']=original
        all_keys=[k.name for k in ob.data.shape_keys.key_blocks] if ob.data.shape_keys else []
        report.append({'对象':ob.name,'原对象':original,'顶点数':len(ob.data.vertices),'面数':len(ob.data.polygons),'原有形态键数':len([k for k in all_keys if not k.startswith('Fit_')]),'新增适配键':[k for k in all_keys if k.startswith('Fit_')],'总形态键数':len(all_keys),'保留顶点组数':len(ob.vertex_groups)})
    for obj in set(bpy.data.objects)-before:
        if obj not in parts and obj!=rig:
            # 未链接的原骨架等依赖不参加当前场景。
            for col in list(obj.users_collection):col.objects.unlink(obj)
    rig['说明']='继承头、颈、眼睛和迁移前发实际使用的骨骼及其父级。身体、Meshy 后发未绑定；未迁移原物理系统。'
    bpy.context.view_layer.update()
    return parts,rig,report


def face_materials(parts):
    materials={slot.material for ob in parts for slot in ob.material_slots if slot.material}
    for material in materials:
        nt=material.node_tree
        if not nt:continue
        shader=nt.nodes.get('mmd_shader');tex=nt.nodes.get('mmd_base_tex')
        if not shader or not tex:continue
        shader.inputs['Sphere Tex Fac'].default_value=0
        if 'Face' in material.name or 'BodySkin' in material.name:
            saturation=.35;value=1.12
            shader.inputs['Toon Tex Fac'].default_value=.30
        elif 'HairB' in material.name or 'HairA' in material.name:
            saturation=.045;value=1.10
            shader.inputs['Toon Tex Fac'].default_value=.60
        elif 'Eyes' in material.name and 'EyeShadow' not in material.name:
            saturation=.30;value=1.05
        elif 'Brows' in material.name:
            saturation=.1;value=.85
        else:continue
        node=nt.nodes.new('ShaderNodeHueSaturation');node.name='Migration_ColorMatch';node.inputs['Saturation'].default_value=saturation;node.inputs['Value'].default_value=value
        nt.links.new(tex.outputs['Color'],node.inputs['Color']);nt.links.new(node.outputs['Color'],shader.inputs['Base Tex'])


def body_material(subject):
    original=subject.data.materials[0];material=original.copy();material.name='Refined_Meshy_Surface';subject.data.materials[0]=material
    nt=material.node_tree;bs=next(n for n in nt.nodes if n.type=='BSDF_PRINCIPLED')
    if bs.inputs['Roughness'].is_linked:
        link=bs.inputs['Roughness'].links[0]
        limit=nt.nodes.new('ShaderNodeMath');limit.operation='MAXIMUM';limit.inputs[1].default_value=.33
        nt.links.new(link.from_socket,limit.inputs[0]);nt.links.new(limit.outputs[0],bs.inputs['Roughness'])
    else:bs.inputs['Roughness'].default_value=max(.33,bs.inputs['Roughness'].default_value)
    if bs.inputs['Metallic'].is_linked:
        link=bs.inputs['Metallic'].links[0];mul=nt.nodes.new('ShaderNodeMath');mul.operation='MULTIPLY';mul.inputs[1].default_value=.30
        nt.links.new(link.from_socket,mul.inputs[0]);nt.links.new(mul.outputs[0],bs.inputs['Metallic'])
    bs.inputs['Specular IOR Level'].default_value=.32
    for node in nt.nodes:
        if node.type=='NORMAL_MAP':node.inputs['Strength'].default_value=.55


def remove_original_face(subject):
    spec=importlib.util.spec_from_file_location('mesh_subset',ROOT/'extract_subject.py')
    helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    data=subject.data
    coords=np.empty(len(data.vertices)*3,dtype=np.float32);data.vertices.foreach_get('co',coords);coords=coords.reshape(-1,3)
    indices=np.empty(len(data.loops),dtype=np.int32);data.loops.foreach_get('vertex_index',indices);indices=indices.reshape(-1,3)
    centers=coords[indices].mean(axis=1)
    uv=np.empty(len(data.loops)*2,dtype=np.float32);data.uv_layers.active.data.foreach_get('uv',uv);uv=uv.reshape(-1,3,2).mean(axis=1)
    image=bpy.data.images['base_color'];pixels=np.empty(len(image.pixels),dtype=np.float32);image.pixels.foreach_get(pixels);pixels=pixels.reshape(image.size[1],image.size[0],4)
    xx=(np.mod(uv[:,0],1)*(image.size[0]-1)).astype(np.int32);yy=(np.mod(uv[:,1],1)*(image.size[1]-1)).astype(np.int32)
    rgb=pixels[yy,xx,:3]
    skin=(rgb[:,0]-rgb[:,1]>.003)&(rgb[:,0]-rgb[:,2]>-.026)
    box=(centers[:,0]>-.115)&(centers[:,0]<.095)&(centers[:,2]>1.502)&(centers[:,2]<1.650)&(centers[:,1]<-.205)
    lower_core=((centers[:,0]+.028)/.069)**2+((centers[:,2]-1.566)/.067)**2<1
    lower_core &= (centers[:,2]<1.615)&(centers[:,1]>-.338)&(centers[:,1]<-.220)
    nose_fragment=(centers[:,0]>-.028)&(centers[:,0]<.004)&(centers[:,2]>1.555)&(centers[:,2]<1.593)&(centers[:,1]<-.22)
    front_hair=(centers[:,2]>1.520)&(centers[:,2]<1.780)&(centers[:,1]<-.245)&(centers[:,0]>-.160)&(centers[:,0]<.150)
    hair_color=(rgb[:,2]-rgb[:,0]>.035)&(rgb[:,1]-rgb[:,0]>.007)&(rgb.mean(axis=1)>.38)
    # 衣服与旧下垂发束在生成网格中融合；不依据颜色删除胸部以下区域。
    front_locks=np.zeros(len(centers),dtype=np.bool_)
    neck_replace=(np.abs(centers[:,0])<.067)&(centers[:,2]>1.477)&(centers[:,2]<1.530)&(centers[:,1]<-.220)&(centers[:,1]>-.335)
    remove=(skin&box)|lower_core|nose_fragment|front_hair|front_locks|neck_replace
    remaining,_=helper.subset_mesh(subject,~remove,'Subject_Meshy_Refined')
    # 只将颈侧旧发束的切口收向新前发后方，避免在颈边留下平切的短桩。
    softened=0
    for vertex in remaining.data.vertices:
        x,y,z=vertex.co
        if .045<abs(x)<.150 and 1.477<z<1.533 and y<-.270:
            t=max(0,min(1,(z-1.477)/.043));t=t*t*(3-2*t)
            vertex.co.y+=.100*t;vertex.co.z-=.012*t;softened+=1
    remaining.data.update()
    old_face,_=helper.subset_mesh(subject,remove,'OriginalFace_Archived')
    archive=new_collection('00_OriginalFace_Hidden');archive.hide_render=True;archive.hide_viewport=True
    for col in list(old_face.users_collection):col.objects.unlink(old_face)
    archive.objects.link(old_face)
    old_face['说明']='包含被替换的原脸、刘海和前发；依照空间范围及贴图颜色分离，保留以便恢复。需结合多视角检查，不是通用语义分割。'
    bpy.data.objects.remove(subject,do_unlink=True)
    return remaining,{'旧脸及前发归档面数':int(remove.sum()),'前发候选面数':int((front_hair|front_locks).sum()),'颈侧旧发束切口调整顶点数':softened,'保留主体面数':int((~remove).sum()),'原网格保留在隐藏集合':True}


def collar_bridge(rig,original_tree,subject):
    vertices=[];faces=[];n=64
    for z in (1.348,1.349,1.364,1.365):
        for j in range(n):
            a=2*math.pi*j/n;vertices.append((.035*math.cos(a),.020+.030*math.sin(a),z))
    for i in range(3):
        for j in range(n):faces.append((i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j))
    data=bpy.data.meshes.new('Refined_CollarMesh');data.from_pydata(vertices,[],faces);data.update()
    ob=bpy.data.objects.new('Refined_Collar',data);bpy.data.collections['02_TransferredFace'].objects.link(ob)
    ob.parent=rig;ob.matrix_parent_inverse=Matrix.Identity(4);ob.matrix_basis=Matrix.Identity(4)
    m=bpy.data.materials.new('Refined_CollarSatin');m.use_nodes=True;bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.008,.011,.018,1);bs.inputs['Roughness'].default_value=.36
    data.materials.append(m)
    for p in data.polygons:p.use_smooth=True
    thick=ob.modifiers.new('Collar_Thickness','SOLIDIFY');thick.thickness=.001
    # 在旧身体表面与新领圈之间建立短过渡面，遮住分离边界而不是扩大删除范围。
    lower=[];upper=[];center=Vector((0,-.238,1.465))
    for j in range(n):
        a=2*math.pi*j/n;direction=Vector((math.cos(a),math.sin(a),0))
        hit,normal,index,distance=original_tree.ray_cast(center,direction,.10)
        if hit is None:hit=center+direction*.045
        lower.append(hit-direction*.001)
        upper.append(rig.matrix_world@Vector((.032*math.cos(a),.020+.027*math.sin(a),1.352)))
    vertices=[]
    for i in range(6):
        t=i/5
        for a,b in zip(lower,upper):vertices.append(a.lerp(b,t))
    faces=[(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for i in range(5) for j in range(n)]
    data=bpy.data.meshes.new('Static_NeckTransitionMesh');data.from_pydata(vertices,[],faces);data.update()
    transition=bpy.data.objects.new('Static_NeckTransition',data);bpy.data.collections['02_TransferredFace'].objects.link(transition)
    m=bpy.data.materials.new('Skin_NeckTransition');m.use_nodes=True;bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.80,.75,.74,1);bs.inputs['Roughness'].default_value=.62
    data.materials.append(m)
    for p in data.polygons:p.use_smooth=True
    transition['说明']='静态头颈接缝过渡面，未与身体焊接或绑定；转头、全身动画需下一阶段处理。'
    bridge_tree=BVHTree.FromPolygons([v.co for v in data.vertices],[tuple(p.vertices) for p in data.polygons])
    joined=0
    for vertex in subject.data.vertices:
        x,y,z=vertex.co
        if abs(x)<.074 and 1.451<z<1.482 and y<-.220:
            point,normal,index,distance=bridge_tree.find_nearest(vertex.co)
            if point is None or distance>.070:continue
            t=max(0,min(1,(z-1.451)/.025));t=t*t*(3-2*t)
            vertex.co=vertex.co.lerp(point-normal*.001,t);joined+=1
    subject.data.update()
    return joined


def main():
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    p=argparse.ArgumentParser();p.add_argument('--views',default='Face,Hero,Left');p.add_argument('--samples',type=int,default=24);p.add_argument('--output',default='AK12_Meshy_KoledaFace_Working.blend');opts=p.parse_args(args)
    donor_hash=hashlib.sha256(DONOR.read_bytes()).hexdigest();glb_hash=hashlib.sha256(GLB.read_bytes()).hexdigest()
    subject=bpy.data.objects['Subject_Meshy']
    parts,rig,migration=prepare_head();face_materials(parts)
    original_tree=BVHTree.FromObject(subject,bpy.context.evaluated_depsgraph_get())
    subject,face_removal=remove_original_face(subject);body_material(subject)
    face_removal['旧身体颈缘贴合顶点数']=collar_bridge(rig,original_tree,subject)
    scene=bpy.context.scene;scene.name='AK12_Meshy_FaceRefinement';scene.cycles.samples=opts.samples
    scene.camera=bpy.data.objects['Camera_Hero']
    scene['状态']='静态脸部与前发迁移版；身体、后发与裙摆未绑定，头颈接缝为独立过渡面。'
    scene['图像参考']='用户提供的 AK-12 静寂苍蓝三视图'
    report={'GLB_SHA256':glb_hash,'组件来源文件':str(DONOR),'组件来源文件SHA256':donor_hash,'迁移组件':migration,'头部变换矩阵':[list(row) for row in rig.matrix_world],'头颈及前发骨骼数':len(rig.data.bones),'头颈及前发骨骼':[b.name for b in rig.data.bones],'原脸分离':face_removal,'交付文件':opts.output,'当前边界':['保留 Meshy 礼服与后发几何','迁移脸部、刘海、前侧发束及前顶发','身体与 Meshy 后发未绑定','颈部未焊接，静态过渡面','不等于完整精修、重拓扑或 PMX 动态验收']}
    note=bpy.data.texts.new('脸部迁移说明')
    note.write('使用用户提供 Meshy GLB 的正面主体，迁移用户指定克莱妲模型的脸、眼睛、口腔、刘海与前侧发束。原 GLB 和原克莱妲拆解文件均不覆盖。\n\n各迁移组件保留原有 63 个形态键（含 Basis），适配键另计。骨架只包含迁移部件实际需要的骨骼和父级；原物理未迁移。身体与 Meshy 后发未绑定。\n\n旧脸和旧刘海保存在隐藏集合；胸前与衣服融合的旧长发没有强行剥离。头颈使用独立静态过渡面，未进行整体焊接或重拓扑。\n\n这是可继续精修的静态迁移版，不是已经完成的可动 PMX；原生成模型的手部、后发、礼服和贴图细节仍需后续精修。\n\n来源：Meshy GLB 由用户提供；克莱妲原说明署名 Sunborn Network Technology，绑定修正 DesmondChan。原 Readme.txt 保留，不发布或分发。\n')
    source_readme=Path(r'D:\workspace\MMD project\release\mmd-portable-0.1.0-20260902-193631-682\MMD\克莱妲衣装濯浪焦点_by_少女前线2：追放_1ca8e339ec3fc3c259d8a3d5f5327eb2\克莱妲泳装皮\Readme.txt')
    bpy.data.texts.load(str(source_readme))
    reference=bpy.data.images.load(r'C:\Users\KSG\Downloads\ChatGPT Image 2026年9月8日 11_45_32.png',check_existing=True);reference.name='Reference_AK12_DesignSheet';reference.pack();reference.use_fake_user=True
    bpy.data.texts.load(str(Path(__file__).resolve()))
    body_collection=new_collection('01_MeshyBodyAndBackHair')
    for col in list(subject.users_collection):col.objects.unlink(subject)
    body_collection.objects.link(subject)
    rig.hide_set(True)
    bpy.ops.object.select_all(action='DESELECT');parts[0].select_set(True);bpy.context.view_layer.objects.active=parts[0]
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':area.spaces.active.region_3d.view_perspective='CAMERA';area.spaces.active.shading.type='MATERIAL'
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/opts.output))
    report['原文件未修改']=donor_hash==hashlib.sha256(DONOR.read_bytes()).hexdigest() and glb_hash==hashlib.sha256(GLB.read_bytes()).hexdigest()
    (ROOT/'face_migration_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    (ROOT/'refined_views').mkdir(exist_ok=True)
    for view in opts.views.split(','):
        scene.camera=bpy.data.objects['Camera_'+view];scene.render.filepath=str(ROOT/'refined_views'/f'{view.lower()}.png')
        print('RENDER_START',view,flush=True);bpy.ops.render.render(write_still=True)
    print('FACE_TRIAL_COMPLETE',json.dumps(report,ensure_ascii=False),flush=True)


if __name__=='__main__':main()
