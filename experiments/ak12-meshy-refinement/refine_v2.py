"""保留已验证迁移版，精修肩颈残片与局部接缝。"""
import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT=Path(__file__).resolve().parent
BASE=ROOT/'AK12_Meshy_Refined.blend'


def temple_strands():
    spec=importlib.util.spec_from_file_location('hair_volume',ROOT.parent/'ak12-silent-azure-static'/'build_character.py');geo=importlib.util.module_from_spec(spec);spec.loader.exec_module(geo)
    col=bpy.data.collections.new('03_TempleHairTransition');bpy.context.scene.collection.children.link(col)
    geo.COLLECTIONS={'02_Hair':col}
    geo.HAIR=geo.mat('V2_TempleSilver',(.48,.51,.59),.43,.06)
    geo.HAIR_LIGHT=geo.mat('V2_TempleHighlight',(.62,.66,.73),.42,.05)
    geo.HAIR_SHADOW=geo.mat('V2_TempleShadow',(.30,.33,.39),.47,.03)
    for sign in (-1,1):
        for i in range(4):
            points=[(sign*(.055+i*.004),.000+i*.006,1.566-i*.004),(sign*(.080+i*.003),.033+i*.005,1.550-i*.004),(sign*(.089+i*.002),.067+i*.004,1.520-i*.004),(sign*(.077+i*.003),.092+i*.003,1.492-i*.004),(sign*(.070+i*.003),.105+i*.003,1.472-i*.003)]
            geo.strand('Detail_TempleHair_'+str(sign)+'_'+str(i),points,.006-i*.0005,.0032,geo.HAIR,'02_Hair',True)
    rig=bpy.data.objects['TransferredFace_Rig']
    for ob in list(col.objects):
        if ob.type=='CURVE':
            bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob;bpy.ops.object.convert(target='MESH');ob=bpy.context.object
        ob.parent=rig;ob.matrix_parent_inverse=Matrix.Identity(4);ob.matrix_basis=Matrix.Identity(4)
        group=ob.vertex_groups.new(name='頭');group.add(list(range(len(ob.data.vertices))),1.0,'REPLACE')
        mod=ob.modifiers.new('Head_Attachment','ARMATURE');mod.object=rig
        ob['说明']='本轮新增有体积的耳后过渡发束，固定绑定頭骨；不含发丝物理。'
    return {'有体积发束数':8,'含细线的网格对象数':len(col.objects),'新增骨骼数':0,'平面补片方案':'近景出现平面叠影，未采用'}


def temple_bridge(helper):
    donor=ROOT.parent/'koleda-local-parts-study'/'KoledaSummer_Parts.blend'
    target_material=bpy.data.objects['Transferred_FrontCrown'].data.materials[0]
    with bpy.data.libraries.load(str(donor),link=False) as (available,loaded):loaded.objects=['Part_HairA']
    source=loaded.objects[0]
    coords=np.empty(len(source.data.vertices)*3,dtype=np.float32);source.data.vertices.foreach_get('co',coords);coords=coords.reshape(-1,3)
    indices=np.empty(len(source.data.loops),dtype=np.int32);source.data.loops.foreach_get('vertex_index',indices);indices=indices.reshape(-1,3)
    centers=coords[indices].mean(axis=1)
    chosen=(centers[:,2]>1.430)&(centers[:,2]<1.555)&(centers[:,1]>.020)&(centers[:,1]<.100)&(np.abs(centers[:,0])>.043)
    patch,used=helper.subset_mesh(source,chosen,'Transferred_TempleBridge')
    for c in list(patch.users_collection):c.objects.unlink(patch)
    bpy.data.collections['02_TransferredFace'].objects.link(patch)
    blend_material=target_material.copy();blend_material.name='Temple_HairTransition'
    patch.data.materials.clear();patch.data.materials.append(blend_material)
    fades=[]
    for old in used:
        x,y,z=coords[int(old)]
        t=max(0,min(1,(float(z)-1.430)/.035,(1.555-float(z))/.020,(float(y)-.020)/.015,(.100-float(y))/.025,(abs(float(x))-.043)/.015))
        fades.append(.72*t*t*(3-2*t))
    attribute=patch.data.attributes.new('Temple_EdgeFade','FLOAT','POINT');attribute.data.foreach_set('value',np.array(fades,dtype=np.float32))
    nt=blend_material.node_tree;node=nt.nodes.new('ShaderNodeAttribute');node.attribute_name='Temple_EdgeFade'
    nt.links.new(node.outputs['Fac'],nt.nodes['mmd_shader'].inputs['Alpha'])
    for group in source.vertex_groups:patch.vertex_groups.new(name=group.name)
    for i,old in enumerate(used):
        for weight in source.data.vertices[int(old)].groups:patch.vertex_groups[weight.group].add([i],weight.weight,'REPLACE')
    face_keys=bpy.data.objects['Transferred_Face'].data.shape_keys.key_blocks
    for key in source.data.shape_keys.key_blocks:
        new=patch.shape_key_add(name=key.name,from_mix=False)
        for i,old in enumerate(used):new.data[i].co=key.data[int(old)].co
        if key.name in face_keys:new.value=face_keys[key.name].value
    rig=bpy.data.objects['TransferredFace_Rig'];source_rig=source.find_armature()
    required={source.vertex_groups[w.group].name for old in used for w in source.data.vertices[int(old)].groups if w.weight>0 and source.vertex_groups[w.group].name in source_rig.data.bones}
    missing=required-set(rig.data.bones.keys())
    additional=set(missing)
    for name in list(missing):
        bone=source_rig.data.bones[name]
        while bone.parent and bone.parent.name not in rig.data.bones:
            bone=bone.parent;additional.add(bone.name)
    if additional:
        hidden=rig.hide_get();rig.hide_set(False)
        bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);bpy.context.view_layer.objects.active=rig
        bpy.ops.object.mode_set(mode='EDIT')
        for name in additional:
            original=source_rig.data.bones[name];bone=rig.data.edit_bones.new(name);bone.matrix=original.matrix_local.copy();bone.length=original.length
        for name in additional:
            parent=source_rig.data.bones[name].parent
            if parent and parent.name in rig.data.edit_bones:rig.data.edit_bones[name].parent=rig.data.edit_bones[parent.name]
        bpy.ops.object.mode_set(mode='OBJECT');rig.hide_set(hidden)
    assert required.issubset(set(rig.data.bones.keys()))
    patch.parent=rig;patch.matrix_parent_inverse=Matrix.Identity(4);patch.matrix_basis=Matrix.Identity(4)
    mod=patch.modifiers.new('Temple_Armature','ARMATURE');mod.object=rig
    patch['说明']='从克莱妲头发中选择的侧面过渡区域，原网格、UV、权重和 63 个形态键保留；未增加物理。'
    patch['原对象名']='Part_HairA_TempleSubset'
    return {'顶点数':len(used),'面数':len(patch.data.polygons),'形态键数':len(patch.data.shape_keys.key_blocks),'新增骨骼数':len(additional),'新增骨骼':sorted(additional)}


def main():
    argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    parser=argparse.ArgumentParser();parser.add_argument('--samples',type=int,default=24);parser.add_argument('--views',default='NeckFront,NeckLeft,NeckRight,Hero');args=parser.parse_args(argv)
    bpy.ops.preferences.addon_enable(module='bl_ext.blender_org.mmd_tools')
    baseline_hash=hashlib.sha256(BASE.read_bytes()).hexdigest()
    source=bpy.data.objects['Subject_Meshy_Refined']
    records=json.loads((ROOT/'neck_connectivity.json').read_text(encoding='utf8'))
    candidates=records['肩颈附近的小分量']
    assert len(candidates)==3 and sum(c['面数'] for c in candidates)==645
    for c in candidates:
        assert c['最小值'][2]>1.45 and c['最大值'][2]<1.53,'候选超出已检查肩颈范围'
    labels=np.load(ROOT/'neck_component_labels.npz')['face_labels']
    assert len(labels)==len(source.data.polygons)
    remove=np.isin(labels,[c['编号'] for c in candidates])
    assert int(remove.sum())==645
    spec=importlib.util.spec_from_file_location('subset_mesh',ROOT/'extract_subject.py');helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    body,_=helper.subset_mesh(source,~remove,'Cleaned_MeshyBody')
    # 撤回第一版将旧发切口向后推得过远的局部变形；用原主体坐标作证据。
    with bpy.data.libraries.load(str(ROOT/'Subject_ExtractedReference.blend'),link=False) as (available,loaded):loaded.objects=['Subject_Meshy']
    original=loaded.objects[0]
    original_ids=np.empty(len(original.data.vertices),dtype=np.int32);original.data.attributes['source_vertex_index'].data.foreach_get('value',original_ids)
    body_ids=np.empty(len(body.data.vertices),dtype=np.int32);body.data.attributes['source_vertex_index'].data.foreach_get('value',body_ids)
    old_positions=np.empty(len(original.data.vertices)*3,dtype=np.float32);original.data.vertices.foreach_get('co',old_positions);old_positions=old_positions.reshape(-1,3)
    lookup=np.searchsorted(original_ids,body_ids);assert np.array_equal(original_ids[lookup],body_ids)
    restored=0;max_shift=0
    for i,vertex in enumerate(body.data.vertices):
        x,y,z=old_positions[lookup[i]]
        shift=vertex.co.y-float(y)
        if .045<abs(x)<.150 and 1.488<z<1.533 and y<-.270 and shift>.020:
            max_shift=max(max_shift,shift);vertex.co=old_positions[lookup[i]]
            t=max(0,min(1,(float(z)-1.475)/.045));t=t*t*(3-2*t)
            sign=1 if x>0 else -1
            vertex.co.x=sign*(.084+(abs(float(x))-.084)*(1-.65*t))
            vertex.co.y=-.315+(float(y)+.315)*(1-.65*t)
            vertex.co.z=float(z)-.037*t
            restored+=1
    body.data.update()
    fragments,_=helper.subset_mesh(source,remove,'Archived_NeckRemnants')
    collection=bpy.data.collections.new('00_NeckRemnants_Hidden');bpy.context.scene.collection.children.link(collection);collection.hide_render=True;collection.hide_viewport=True
    for old in list(fragments.users_collection):old.objects.unlink(fragments)
    collection.objects.link(fragments);fragments['archive_role']='removed_generated_geometry';fragments['说明']='三个已独立的肩颈旧发残片；645 个三角面，保留以便恢复。'
    for old in list(body.users_collection):old.objects.unlink(body)
    bpy.data.collections['01_MeshyBodyAndBackHair'].objects.link(body)
    bpy.data.objects.remove(source,do_unlink=True);body.name='Subject_Meshy_Refined'
    temple=temple_strands()
    report={'基线文件':str(BASE),'基线SHA256':baseline_hash,'归档残片数':len(candidates),'归档残片三角面数':645,'撤回拉伸并收细发梢顶点数':restored,'撤回前最大Y位移米':max_shift,'耳后过渡发束':temple,'保留主体面数':len(body.data.polygons),'候选原始信息':candidates,'脸部和表情数据':'原已迁移组件不修改','新颈部及前发':'原组件保持，新增耳后过渡发束','基线文件未修改':hashlib.sha256(BASE.read_bytes()).hexdigest()==baseline_hash}
    scene=bpy.context.scene;scene.name='AK12_Meshy_Refined_v2';scene.cycles.samples=args.samples
    studio=bpy.data.collections['Inspection_Studio']
    for name,location in [('NeckFront',(0,-3,1.43)),('NeckLeft',(-3,-.40,1.43)),('NeckRight',(3,-.40,1.43))]:
        cam=bpy.data.cameras.new('Camera_'+name);cam.type='ORTHO';cam.ortho_scale=.62
        camera=bpy.data.objects.new('Camera_'+name,cam);studio.objects.link(camera);camera.location=location;camera.rotation_euler=(Vector((0,-.20,1.42))-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.camera=bpy.data.objects['Camera_Hero']
    note=bpy.data.texts.new('第二版肩颈清理说明');note.write('在已验证的脸部和前发迁移版上继续精修。通过位置焊接后的连通性检查识别并归档三个独立肩颈残片；不修改脸部、形态键、权重和骨骼。\n第一版保留，源 GLB 与组件模型保留。\n此版本仍不是可动 PMX，身体、后发和礼服未绑定。\n')
    bpy.data.texts.load(str(Path(__file__).resolve()))
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'AK12_Meshy_Refined_v2.blend'))
    (ROOT/'v2_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    (ROOT/'v2_views').mkdir(exist_ok=True)
    print('V2_REPORT',json.dumps(report,ensure_ascii=False),flush=True)
    for view in args.views.split(','):
        scene.camera=bpy.data.objects['Camera_'+view];scene.render.filepath=str(ROOT/'v2_views'/f'{view.lower()}.png');print('RENDER',view,flush=True);bpy.ops.render.render(write_still=True)


if __name__=='__main__':main()
