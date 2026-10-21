"""在复开的迁移模型上验证数据保留、贴图、表情与源文件哈希。不会保存改写模型。"""
import hashlib
import json
from pathlib import Path

import bpy
import numpy as np

ROOT=Path(__file__).resolve().parent
REPORT=json.loads((ROOT/'face_migration_report.json').read_text(encoding='utf8'))
DONOR=Path(REPORT['组件来源文件'])
GLB=Path(r'C:\Users\KSG\Downloads\meshy_1788865300370.glb')


def co(data):
    a=np.empty(len(data)*3,dtype=np.float32);data.foreach_get('co',a);return a.reshape(-1,3)


def uv(data):
    a=np.empty(len(data.loops)*2,dtype=np.float32);data.uv_layers.active.data.foreach_get('uv',a);return a.reshape(-1,3,2)


def ids(data,name,domain):
    length=len(data.vertices) if domain=='POINT' else len(data.polygons)
    a=np.empty(length,dtype=np.int32);data.attributes[name].data.foreach_get('value',a);return a


def evaluated(ob):
    ob.update_tag();bpy.context.view_layer.update()
    ev=ob.evaluated_get(bpy.context.evaluated_depsgraph_get());m=ev.to_mesh();points=co(m.vertices);ev.to_mesh_clear();return points


def main():
    bpy.ops.preferences.addon_enable(module='bl_ext.blender_org.mmd_tools')
    target_path=bpy.data.filepath
    parts=[bpy.data.objects[item['对象']] for item in REPORT['迁移组件']]
    full_names=[item['原对象'] for item in REPORT['迁移组件'] if item['原对象'] not in ('Part_NeckBridge','Part_FrontCrown')]
    with bpy.data.libraries.load(str(DONOR),link=False) as (available,loaded):loaded.objects=full_names+['Part_BodySkin','Part_HairA']
    originals=dict(zip(full_names+['Part_BodySkin','Part_HairA'],loaded.objects))
    checks=[]
    for item,target in zip(REPORT['迁移组件'],parts):
        source_name=item['原对象']
        subset=source_name in ('Part_NeckBridge','Part_FrontCrown')
        source=originals[{'Part_NeckBridge':'Part_BodySkin','Part_FrontCrown':'Part_HairA'}.get(source_name,source_name)]
        vertex_ids=ids(target.data,'source_vertex_index','POINT') if subset else np.arange(len(source.data.vertices))
        face_ids=ids(target.data,'source_face_index','FACE') if subset else np.arange(len(source.data.polygons))
        base_error=float(np.max(np.abs(co(target.data.vertices)-co(source.data.vertices)[vertex_ids])))
        shape_error=0;missing=[]
        for key in source.data.shape_keys.key_blocks:
            match=target.data.shape_keys.key_blocks.get(key.name)
            if match is None:missing.append(key.name);continue
            shape_error=max(shape_error,float(np.max(np.abs(co(match.data)-co(key.data)[vertex_ids]))))
        weight_errors=0
        for vi,old in enumerate(vertex_ids):
            a=sorted((target.vertex_groups[g.group].name,g.weight) for g in target.data.vertices[vi].groups)
            b=sorted((source.vertex_groups[g.group].name,g.weight) for g in source.data.vertices[int(old)].groups)
            if a!=b:weight_errors+=1
        same_uv=bool(np.array_equal(uv(target.data),uv(source.data)[face_ids]))
        checks.append({'对象':target.name,'源对象':source.name,'原形态键数':len(source.data.shape_keys.key_blocks),'缺失形态键':missing,'基础坐标最大误差':base_error,'原形态键坐标最大误差':shape_error,'权重不一致顶点数':weight_errors,'UV一致':same_uv,'通过':not missing and base_error==0 and shape_error==0 and weight_errors==0 and same_uv})
    body=bpy.data.objects['Subject_Meshy_Refined'];archive=bpy.data.objects['OriginalFace_Archived']
    with bpy.data.libraries.load(str(ROOT/'Subject_ExtractedReference.blend'),link=False) as (available,loaded):loaded.objects=['Subject_Meshy']
    source_body=loaded.objects[0]
    source_face_ids=ids(source_body.data,'source_face_index','FACE')
    current_face_ids=ids(body.data,'source_face_index','FACE')
    old_face_ids=ids(archive.data,'source_face_index','FACE')
    ordering=np.searchsorted(source_face_ids,current_face_ids)
    body_uv_same=bool(np.array_equal(uv(body.data),uv(source_body.data)[ordering]))
    partition=bool(np.array_equal(np.sort(np.concatenate([current_face_ids,old_face_ids])),np.sort(source_face_ids)))
    missing_images=[]
    for image in bpy.data.images:
        if image.source=='FILE' and not image.packed_file and image.users>0 and not Path(bpy.path.abspath(image.filepath)).is_file():missing_images.append(image.name)
    rig=bpy.data.objects['TransferredFace_Rig'];unbound={}
    donor_rig=originals['Part_Face'].find_armature()
    for target in parts:
        used={target.vertex_groups[g.group].name for vertex in target.data.vertices for g in vertex.groups if g.weight>0}
        unbound[target.name]=sorted(name for name in used if name in donor_rig.data.bones and name not in rig.data.bones)
    non_finite=[ob.name for ob in [body]+parts if not np.isfinite(evaluated(ob)).all()]
    initial={ob.name:{k.name:k.value for k in ob.data.shape_keys.key_blocks} for ob in parts}
    def expression(name=None,value=0):
        for ob in parts:
            for key in ob.data.shape_keys.key_blocks:
                if not key.name.startswith('Fit_'):key.value=0
            if name and name in ob.data.shape_keys.key_blocks:ob.data.shape_keys.key_blocks[name].value=value
            ob.update_tag()
        bpy.context.view_layer.update()
    face=bpy.data.objects['Transferred_Face'];expression();neutral=evaluated(face)
    expression_checks={};scene=bpy.context.scene;scene.camera=bpy.data.objects['Camera_Face'];scene.cycles.samples=32
    (ROOT/'validation_views').mkdir(exist_ok=True)
    for label,name,value in [('blink','まばたき',1.0),('mouth','あ',.5)]:
        expression(name,value);points=evaluated(face);delta=np.linalg.norm(points-neutral,axis=1)
        expression_checks[label]={'最大位移':float(delta.max()),'变化顶点数':int((delta>1e-7).sum()),'坐标有限':bool(np.isfinite(points).all())}
        scene.render.filepath=str(ROOT/'validation_views'/f'{label}.png');bpy.ops.render.render(write_still=True)
    for ob in parts:
        for key in ob.data.shape_keys.key_blocks:key.value=initial[ob.name][key.name]
        ob.update_tag()
    report={'文件':target_path,'组件数据验证':checks,'主体UV一致':body_uv_same,'原主体面完整分配至保留与归档':partition,'骨骼数':len(rig.data.bones),'使用权重但缺少骨骼':unbound,'非有限坐标对象':non_finite,'缺失外部图片':missing_images,'原GLB未修改':hashlib.sha256(GLB.read_bytes()).hexdigest()==REPORT['GLB_SHA256'],'原组件文件未修改':hashlib.sha256(DONOR.read_bytes()).hexdigest()==REPORT['组件来源文件SHA256'],'表情测试':expression_checks,'限制':['只验证静态迁移及两种面部形态键','未验证转头、头发物理、全身动作或 PMX','保留原形态键不等于每一种表情都已逐个视觉验收','颈部过渡面独立，尚未焊接与绑定','Meshy 手部、后发与礼服仍保留原生成细节']}
    report['技术验证通过']=all(c['通过'] for c in checks) and body_uv_same and partition and not any(unbound.values()) and not non_finite and not missing_images and report['原GLB未修改'] and report['原组件文件未修改'] and all(v['最大位移']>1e-6 and v['坐标有限'] for v in expression_checks.values())
    (ROOT/'refinement_verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print('REFINEMENT_VERIFICATION',json.dumps(report,ensure_ascii=False),flush=True)
    assert report['技术验证通过'],'迁移技术验证失败，不能宣称完成'


if __name__=='__main__':main()
