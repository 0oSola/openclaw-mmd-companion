"""本地学习研究用：将指定 PMX 导入独立 .blend，保留来源信息。"""
import hashlib
import json
from pathlib import Path

import bpy

ROOT=Path(__file__).resolve().parent
SOURCE=Path(r'D:\workspace\MMD project\release\mmd-portable-0.1.0-20260902-193631-682\MMD\克莱妲衣装濯浪焦点_by_少女前线2：追放_1ca8e339ec3fc3c259d8a3d5f5327eb2\克莱妲泳装皮\GirlsFrontline KoledaSummer SSR0101.pmx')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ROOT.mkdir(parents=True,exist_ok=True)
    before={str(p.relative_to(SOURCE.parent)):digest(p) for p in SOURCE.parent.rglob('*') if p.is_file()}
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    bpy.ops.preferences.addon_enable(module='bl_ext.blender_org.mmd_tools')
    bpy.ops.mmd_tools.import_model(filepath=str(SOURCE),scale=.08,types={'MESH','ARMATURE','PHYSICS','DISPLAY','MORPHS'},clean_model=False,remove_doubles=False,rename_bones=False,log_level='ERROR',save_log=False)
    meshes=[ob for ob in bpy.context.scene.objects if ob.type=='MESH' and len(ob.data.polygons)>100 and len(ob.vertex_groups)>0]
    info={'源文件':str(SOURCE),'源文件哈希':before[SOURCE.name],'单位转换比例':.08,'导入网格':[],'骨架':[]}
    for ob in meshes:
        mats=[]
        for i,slot in enumerate(ob.material_slots):
            faces=[p for p in ob.data.polygons if p.material_index==i]
            ids={v for p in faces for v in p.vertices}
            coordinates=[ob.matrix_world@ob.data.vertices[v].co for v in ids]
            mats.append({'序号':i,'名称':slot.name,'面数':len(faces),'顶点数':len(ids),'最小值':[min(v[k] for v in coordinates) for k in range(3)] if coordinates else None,'最大值':[max(v[k] for v in coordinates) for k in range(3)] if coordinates else None,'纹理':[n.image.name for n in slot.material.node_tree.nodes if n.type=='TEX_IMAGE' and n.image] if slot.material and slot.material.node_tree else []})
        info['导入网格'].append({'名称':ob.name,'顶点数':len(ob.data.vertices),'面数':len(ob.data.polygons),'顶点组数':len(ob.vertex_groups),'形态键':[k.name for k in ob.data.shape_keys.key_blocks] if ob.data.shape_keys else [],'材质':mats})
    for ob in bpy.context.scene.objects:
        if ob.type=='ARMATURE':info['骨架'].append({'名称':ob.name,'骨骼数':len(ob.data.bones)})
    bpy.data.texts.load(str(SOURCE.parent/'Readme.txt'))
    note=bpy.data.texts.new('本地研究说明')
    note.write('本文件是用户指定资产的本地研究导入副本。保留原始作者说明，不将非商用学习目的描述为作者新增授权；不发布或分发。\n来源：'+str(SOURCE)+'\n\n本导入参考副本用于后续拆分前后的数据一致性对照。原始 PMX 和贴图保持不变。\n')
    info['未能打包的原始图片引用']=[]
    for image in bpy.data.images:
        if image.source!='FILE' or image.packed_file:continue
        path=Path(bpy.path.abspath(image.filepath))
        if path.is_file():image.pack()
        else:info['未能打包的原始图片引用'].append({'名称':image.name,'路径':str(path),'用户数':image.users})
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'KoledaSummer_ImportedReference.blend'))
    after={str(p.relative_to(SOURCE.parent)):digest(p) for p in SOURCE.parent.rglob('*') if p.is_file()}
    info['源目录文件数']=len(before);info['源目录未修改']=before==after
    (ROOT/'source_manifest.json').write_text(json.dumps(before,ensure_ascii=False,indent=2),encoding='utf8')
    (ROOT/'import_inventory.json').write_text(json.dumps(info,ensure_ascii=False,indent=2),encoding='utf8')
    print('IMPORT_INVENTORY',json.dumps(info,ensure_ascii=False),flush=True)
    assert before==after,'源目录发生了未预期变化'


if __name__=='__main__':main()
