"""在独立导入副本中按材质拆件，并检查几何、UV、权重、形态键与姿态一致性。"""
from collections import Counter
import hashlib
import json
import math
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ROOT=Path(__file__).resolve().parent
SOURCE=Path(r'D:\workspace\MMD project\release\mmd-portable-0.1.0-20260902-193631-682\MMD\克莱妲衣装濯浪焦点_by_少女前线2：追放_1ca8e339ec3fc3c259d8a3d5f5327eb2\克莱妲泳装皮')
SOURCE_ID='study_source_vertex'
LABELS={
    'Face':('01_Face','脸部'), 'UpperTeeth':('01_Face','上牙'), 'LowerTeeth':('01_Face','下牙'),
    'Tongue':('01_Face','舌头'), 'EyeWhite':('01_Face','眼白'), 'Brows':('01_Face','眉毛'),
    'Lashes':('01_Face','睫毛'), 'Eyes':('01_Face','眼睛'), 'Eyes+':('01_Face','眼睛叠层'),
    'BodySkin':('02_Body','身体皮肤'), 'FingerNails':('02_Body','指甲'),
    'HairA':('03_Hair','后发与长发'), 'HairB':('03_Hair','前发与刘海'),
    'P1-Cth1-Bikini':('04_Outfit','泳装'), 'P1-Cth1-Coat':('04_Outfit','外套'),
    'Cth-Shoes':('04_Outfit','鞋'), 'Cth-Watch':('05_Accessories','手表'),
    'Cth-Hairband':('05_Accessories','发带'), 'Cth4-Knife':('05_Accessories','刀具外观配件'),
    'Cth-Sunglasses':('05_Accessories','墨镜'), 'Glock(Hide)':('05_Accessories','隐藏手枪外观配件'),
    'Gunsilencer(Hide)':('05_Accessories','隐藏消音器外观配件'),
    'EyeShadow':('06_Overlays','眼影叠层'), 'Emotions':('06_Overlays','表情叠层'),
}


def collection(name,scene=None):
    col=bpy.data.collections.new(name);(scene or bpy.context.scene).collection.children.link(col);return col


def move(ob,col):
    for previous in list(ob.users_collection):previous.objects.unlink(ob)
    col.objects.link(ob)


def coordinates(data):
    a=np.empty(len(data)*3,dtype=np.float32);data.foreach_get('co',a);return a.reshape((-1,3))


def source_ids(ob):
    a=np.empty(len(ob.data.vertices),dtype=np.int32)
    ob.data.attributes[SOURCE_ID].data.foreach_get('value',a)
    return a


def face_uv_records(ob,ids):
    uv=ob.data.uv_layers.active
    result=Counter()
    for face in ob.data.polygons:
        corners=[]
        for index in face.loop_indices:
            loop=ob.data.loops[index]
            values=tuple(float(x) for x in uv.data[index].uv) if uv else ()
            corners.append((int(ids[loop.vertex_index]),values))
        start=min(range(len(corners)),key=lambda j:corners[j])
        corners=corners[start:]+corners[:start]
        result[(ob.material_slots[face.material_index].name,tuple(corners))]+=1
    return result


def weight_rows(ob):
    return [tuple(sorted((ob.vertex_groups[g.group].name,float(g.weight)) for g in v.groups)) for v in ob.data.vertices]


def apply_test_state(rig,objects,state):
    for bone in rig.pose.bones:
        if bone.name in ('左腕','右腕','左ひじ'):
            bone.rotation_mode='QUATERNION';bone.rotation_quaternion=(1,0,0,0)
    for ob in objects:
        if ob.data.shape_keys:
            for key in ob.data.shape_keys.key_blocks:key.value=0
    if state=='blink':
        for ob in objects:
            key=ob.data.shape_keys.key_blocks.get('まばたき') if ob.data.shape_keys else None
            if key:key.value=.8
    if state=='arm':
        for name,angle in [('左腕',.25),('右腕',-.20),('左ひじ',.15)]:
            bone=rig.pose.bones.get(name)
            if bone:bone.rotation_quaternion=(math.cos(angle/2),math.sin(angle/2),0,0)
    bpy.context.view_layer.update()


def evaluated_points(ob):
    evaluated=ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    data=evaluated.to_mesh();points=coordinates(data.vertices);evaluated.to_mesh_clear();return points


def look(ob,target):ob.rotation_euler=(Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler()


def material(name,color):
    m=bpy.data.materials.new(name);m.use_nodes=True
    node=m.node_tree.nodes.get('Principled BSDF');node.inputs['Base Color'].default_value=(*color,1);node.inputs['Roughness'].default_value=.75
    return m


def studio(scene,col):
    scene.render.engine='CYCLES';scene.cycles.samples=48;scene.cycles.use_denoising=True
    scene.render.resolution_x=1000;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    scene.world=bpy.data.worlds.new('Research_StudioWorld');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.55,.62,.75,1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.35
    scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
    for name,loc,power,size in [('Key',(-2,-3,4),220,3),('Fill',(2,-2,2),110,2),('Rim',(0,2,3),220,2)]:
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size
        ob=bpy.data.objects.new(name,data);col.objects.link(ob);ob.location=loc;look(ob,(0,0,.9))
    floor_mesh=bpy.data.meshes.new('StudioFloorMesh');floor_mesh.from_pydata([(-200,-200,.01),(200,-200,.01),(200,200,.01),(-200,200,.01)],[],[(0,1,2,3)])
    floor=bpy.data.objects.new('Studio_Floor',floor_mesh);col.objects.link(floor);floor.data.materials.append(material('Studio_FloorMaterial',(.52,.58,.66)))
    for name,loc,target,scale in [('Front',(0,-4,.88),(0,0,.85),1.85),('Back',(0,4,.88),(0,0,.85),1.85),('Hero',(-2.3,-4,1.5),(0,0,.85),1.92),('Face',(0,-3,1.48),(0,0,1.47),.34)]:
        data=bpy.data.cameras.new('Camera_'+name);data.type='ORTHO';data.ortho_scale=scale
        ob=bpy.data.objects.new('Camera_'+name,data);col.objects.link(ob);ob.location=loc;look(ob,target)
    scene.camera=bpy.data.objects['Camera_Hero']


def mesh_boundary(ob):
    uses=Counter(tuple(sorted((a,b))) for face in ob.data.polygons for a,b in zip(face.vertices,tuple(face.vertices[1:])+tuple(face.vertices[:1])))
    edges=[edge for edge,count in uses.items() if count==1]
    graph={}
    for a,b in edges:graph.setdefault(a,set()).add(b);graph.setdefault(b,set()).add(a)
    components=[];seen=set()
    for first in graph:
        if first in seen:continue
        stack=[first];ids=[];seen.add(first)
        while stack:
            v=stack.pop();ids.append(v)
            for other in graph[v]:
                if other not in seen:seen.add(other);stack.append(other)
        c=[ob.data.vertices[i].co for i in ids]
        components.append({'边界顶点数':len(ids),'最小值':[min(p[k] for p in c) for k in range(3)],'最大值':[max(p[k] for p in c) for k in range(3)]})
    return {'边界边数':len(edges),'边界连通块':components}


def main():
    bpy.ops.preferences.addon_enable(module='bl_ext.blender_org.mmd_tools')
    scene=bpy.context.scene;scene.name='Koleda_Parts_Assembled'
    original=next(o for o in scene.objects if o.type=='MESH' and len(o.vertex_groups)>0)
    rig=next(o for o in scene.objects if o.type=='ARMATURE')
    count=len(original.data.vertices)
    attr=original.data.attributes.new(SOURCE_ID,'INT','POINT');attr.data.foreach_set('value',np.arange(count,dtype=np.int32))
    basis=coordinates(original.data.vertices);weights=weight_rows(original)
    shapes={k.name:coordinates(k.data) for k in original.data.shape_keys.key_blocks}
    faces=face_uv_records(original,np.arange(count))
    bone_names=[b.name for b in rig.data.bones]
    old_bone_states={b.name:(b.rotation_mode,tuple(b.rotation_quaternion)) for b in rig.pose.bones if b.name in ('左腕','右腕','左ひじ')}
    pose_samples={}
    for state in ('rest','blink','arm'):
        apply_test_state(rig,[original],state);pose_samples[state]=evaluated_points(original)
    apply_test_state(rig,[original],'rest')
    bpy.ops.object.select_all(action='DESELECT');original.hide_set(False);original.select_set(True);bpy.context.view_layer.objects.active=original
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.separate(type='MATERIAL');bpy.ops.object.mode_set(mode='OBJECT')
    parts=[o for o in scene.objects if o.type=='MESH' and o.data.attributes.get(SOURCE_ID)]
    parts.sort(key=lambda o:o.material_slots[0].name)
    groups={name:collection(name) for name in ('00_RigAndPhysics','01_Face','02_Body','03_Hair','04_Outfit','05_Accessories','06_Overlays','07_Studio')}
    for ob in list(scene.objects):
        if ob not in parts:move(ob,groups['00_RigAndPhysics'])
    groups['00_RigAndPhysics'].hide_render=True
    report={'拆分方式':'按原材质区域分离，保留原位置和绑定','部件数':len(parts),'源顶点数':count,'源面数':len(original.data.polygons),'部件':[],'一致性检查':{},'原资源异常处理':[]}
    after_faces=Counter();after_ids=set();basis_error=0;shape_error=0;weight_errors=0
    for index,ob in enumerate(parts):
        mat=ob.material_slots[0].material;name=mat.name;group,label=LABELS[name]
        ob.name='Part_'+name.replace('+','_Overlay').replace('(Hide)','_Hidden')
        ob['中文部件名']=label;ob['来源材质']=name;ob['研究用途']='本地拆解研究，保留来源与原始说明'
        move(ob,groups[group])
        ids=source_ids(ob);after_ids.update(int(i) for i in ids)
        basis_error=max(basis_error,float(np.max(np.abs(coordinates(ob.data.vertices)-basis[ids]))))
        row_weights=weight_rows(ob)
        weight_errors+=sum(value!=weights[int(old)] for value,old in zip(row_weights,ids))
        current_shapes={k.name:k for k in ob.data.shape_keys.key_blocks}
        assert set(current_shapes)==set(shapes),'形态键名称发生变化'
        for key_name,key in current_shapes.items():shape_error=max(shape_error,float(np.max(np.abs(coordinates(key.data)-shapes[key_name][ids]))))
        after_faces.update(face_uv_records(ob,ids))
        report['部件'].append({'对象':ob.name,'中文名称':label,'原材质':name,'顶点数':len(ids),'面数':len(ob.data.polygons),'形态键数':len(current_shapes),'顶点组数':len(ob.vertex_groups),'骨架修改器':[m.object.name for m in ob.modifiers if m.type=='ARMATURE' and m.object]})
    report['源面数']=sum(faces.values())
    pose_errors={}
    for state in ('rest','blink','arm'):
        apply_test_state(rig,parts,state)
        pose_errors[state]=max(float(np.max(np.abs(evaluated_points(ob)-pose_samples[state][source_ids(ob)]))) for ob in parts)
    apply_test_state(rig,parts,'rest')
    for name,(mode,quaternion) in old_bone_states.items():rig.pose.bones[name].rotation_quaternion=quaternion;rig.pose.bones[name].rotation_mode=mode
    # 不替换源材质。仅断开原资产本来就无效且球面混合因子为零的目录型图片引用。
    invalid=bpy.data.images.get('spa')
    if invalid and not Path(bpy.path.abspath(invalid.filepath)).is_file():
        for mat in bpy.data.materials:
            if not mat.node_tree:continue
            for node in list(mat.node_tree.nodes):
                if node.type=='TEX_IMAGE' and node.image==invalid:
                    shader=mat.node_tree.nodes.get('mmd_shader')
                    assert shader is None or shader.inputs['Sphere Tex Fac'].default_value==0,'无效贴图参与了混合，需要单独处理'
                    mat['原始无效图片引用']=invalid.filepath
                    report['原资源异常处理'].append({'材质':mat.name,'节点':node.name,'原路径':invalid.filepath,'处理':'拆解副本移除无效图片节点；球面混合原为零；保留原路径元数据；原始对照文件未变'})
                    mat.node_tree.nodes.remove(node)
        if invalid.users==0:bpy.data.images.remove(invalid)
    body=next(o for o in parts if o['来源材质']=='BodySkin')
    report['身体网格边界检查']=mesh_boundary(body)
    missing=[im.filepath for im in bpy.data.images if im.source=='FILE' and not im.packed_file and im.filepath and not Path(bpy.path.abspath(im.filepath)).is_file()]
    manifest=json.loads((ROOT/'source_manifest.json').read_text(encoding='utf8'))
    after_manifest={str(p.relative_to(SOURCE)):hashlib.sha256(p.read_bytes()).hexdigest() for p in SOURCE.rglob('*') if p.is_file()}
    checks={'源顶点覆盖完整':after_ids==set(range(count)),'静态坐标最大误差':basis_error,'形态键坐标最大误差':shape_error,'权重不一致顶点数':weight_errors,'面与UV完全一致':after_faces==faces,'骨骼名称顺序一致':bone_names==[b.name for b in rig.data.bones],'骨骼数':len(bone_names),'姿态回归最大误差':pose_errors,'原始文件目录未修改':manifest==after_manifest,'缺失的外部图片':missing}
    report['一致性检查']=checks
    report['拆分一致性通过']=checks['源顶点覆盖完整'] and basis_error==0 and shape_error==0 and weight_errors==0 and after_faces==faces and checks['骨骼名称顺序一致'] and max(pose_errors.values())<1e-6 and manifest==after_manifest and not missing
    assert report['拆分一致性通过'],'拆分存在不一致，停止交付'
    studio(scene,groups['07_Studio'])
    bpy.data.texts.load(str(Path(__file__).resolve()))
    notes=bpy.data.texts.new('拆解说明_请先阅读')
    notes.write('本地研究拆解副本。保留原作者 Readme.txt 与导入对照文件。\n\n角色在原位置组装显示，可通过 01_Face、02_Body、03_Hair、04_Outfit、05_Accessories、06_Overlays 集合分别选择或隐藏。每个部件的中文名称记录在对象自定义属性。\n\n骨架、权重、63 个形态键、UV 均按拆分前后数值检查；源顶点索引保存在 study_source_vertex 属性中。\n\n当前没有更改脸型、身体比例、服装，也没有与 AK-12 初模合并。材质拆解不保证身体为完整无洞素体；详见 split_verification.json 中的边界检查。原始顶点边界可能包含 UV 缝，不能直接等同于皮肤缺洞。\n\n源资产有指向 spa 目录的无效图片引用；在拆解副本中移除该无效图片节点，保留原路径元数据；未修改原 PMX 或导入参考文件。\n')
    (ROOT/'split_verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    bpy.ops.object.select_all(action='DESELECT');body.select_set(True);bpy.context.view_layer.objects.active=body
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':area.spaces.active.region_3d.view_perspective='CAMERA';area.spaces.active.shading.type='MATERIAL'
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'KoledaSummer_Parts.blend'))
    (ROOT/'renders').mkdir(exist_ok=True)
    for view in ('Front','Hero','Face','Back'):
        scene.camera=bpy.data.objects['Camera_'+view];scene.render.filepath=str(ROOT/'renders'/f'{view.lower()}.png')
        print('RENDER_START',view,flush=True);bpy.ops.render.render(write_still=True)
    print('SPLIT_COMPLETE',json.dumps({'部件数':len(parts),'一致性检查':checks,'身体边界边数':report['身体网格边界检查']['边界边数']},ensure_ascii=False),flush=True)


if __name__=='__main__':main()
