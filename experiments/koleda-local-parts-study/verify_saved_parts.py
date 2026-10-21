"""独立进程复开检查：不改写 .blend 或源资产。"""
import hashlib
import json
from pathlib import Path

import bpy

ROOT=Path(__file__).resolve().parent
bpy.ops.preferences.addon_enable(module='bl_ext.blender_org.mmd_tools')
inventory=json.loads((ROOT/'import_inventory.json').read_text(encoding='utf8'))
source=Path(inventory['源文件']).parent
manifest=json.loads((ROOT/'source_manifest.json').read_text(encoding='utf8'))
current={str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob('*') if p.is_file()}
parts=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.data.attributes.get('study_source_vertex')]
rigs=[o for o in bpy.context.scene.objects if o.type=='ARMATURE']
empty_nodes=[]
for m in bpy.data.materials:
    if not m.node_tree:continue
    for n in m.node_tree.nodes:
        if n.type=='TEX_IMAGE' and n.image is None and any(s.is_linked for s in n.outputs):empty_nodes.append(m.name+':'+n.name)
missing=[im.filepath for im in bpy.data.images if im.source=='FILE' and not im.packed_file and not Path(bpy.path.abspath(im.filepath)).is_file()]
checks={'文件':bpy.data.filepath,'部件数':len(parts),'总面数':sum(len(o.data.polygons) for o in parts),'骨架数':len(rigs),'骨骼数':len(rigs[0].data.bones),'每部件形态键数':sorted(set(len(o.data.shape_keys.key_blocks) for o in parts)),'源目录未改变':current==manifest,'连接中的空图片节点':empty_nodes,'缺失图片':missing,'打包图片数':sum(bool(im.packed_file) for im in bpy.data.images)}
checks['通过']=len(parts)==24 and checks['总面数']==64908 and checks['骨骼数']==377 and checks['每部件形态键数']==[63] and checks['源目录未改变'] and not empty_nodes and not missing
(ROOT/'reopen_verification.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf8')
print('REOPEN_VERIFICATION',json.dumps(checks,ensure_ascii=False),flush=True)
assert checks['通过'],'复开检查失败'
