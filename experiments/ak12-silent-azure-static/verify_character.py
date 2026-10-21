"""复开独立 .blend 后执行几何、资源和主衣片穿插检查。"""
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parent
scene=bpy.context.scene
depsgraph=bpy.context.evaluated_depsgraph_get()
body=bpy.data.objects['Body_ContinuousSculpt']
body_tree=BVHTree.FromObject(body,depsgraph)
report={'文件':bpy.data.filepath,'Blender版本':bpy.app.version_string,'几何检查':{},'主衣片边与人体相交':{},'资源检查':{},'检查边界':['只检查保存文件复开后的实际几何与资源','衣片检查是主胸衣和主裙摆的边与人体表面的线段相交，不覆盖所有部件对或共面接触','未执行动画、蒙皮、物理和 PMX 验收','程序检查通过不等于视觉还原通过']}
meshes=[ob for ob in scene.objects if ob.type=='MESH' and not ob.hide_render and not any(c.hide_render for c in ob.users_collection) and not ob.name.startswith('Studio_')]
bad=[];bounds=[];vertices=0
for ob in meshes:
    evaluated=ob.evaluated_get(depsgraph)
    data=evaluated.to_mesh()
    vertices+=len(data.vertices)
    for v in data.vertices:
        if not all(math.isfinite(c) for c in v.co):bad.append(ob.name);break
    bounds.extend(ob.matrix_world@Vector(corner) for corner in evaluated.bound_box)
    evaluated.to_mesh_clear()
report['几何检查']={'可见人物网格对象数':len(meshes),'求值后顶点数':vertices,'非有限坐标对象':bad,'人物包围盒最小值':[min(v[i] for v in bounds) for i in range(3)],'人物包围盒最大值':[max(v[i] for v in bounds) for i in range(3)],'骨架数':sum(ob.type=='ARMATURE' for ob in scene.objects)}
for name in ('Dress_Bodice','Dress_OpenSlitTrain'):
    ob=bpy.data.objects[name];evaluated=ob.evaluated_get(depsgraph);data=evaluated.to_mesh()
    hits=[]
    for e in data.edges:
        a=ob.matrix_world@data.vertices[e.vertices[0]].co
        b=ob.matrix_world@data.vertices[e.vertices[1]].co
        d=b-a;length=d.length
        if length<1e-7:continue
        direction=d/length
        location,normal,index,distance=body_tree.ray_cast(a+direction*1e-6,direction,max(0,length-2e-6))
        if location is not None:hits.append({'边':e.index,'位置':list(location)})
    report['主衣片边与人体相交'][name]={'测试边数':len(data.edges),'相交边数':len(hits),'前20个相交位置':hits[:20]}
    evaluated.to_mesh_clear()
missing=[]
for im in bpy.data.images:
    if im.source=='FILE' and not im.packed_file and im.filepath and not Path(bpy.path.abspath(im.filepath)).exists():missing.append(im.filepath)
report['资源检查']={'缺失的外部图片':missing,'已打包图片':[im.name for im in bpy.data.images if im.packed_file],'相机':[ob.name for ob in scene.objects if ob.type=='CAMERA'],'当前相机':scene.camera.name}
report['技术检查通过']=not bad and not missing and all(v['相交边数']==0 for v in report['主衣片边与人体相交'].values())
(ROOT/'reopen_verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print('REOPEN_VERIFICATION',json.dumps(report,ensure_ascii=False),flush=True)
if not report['技术检查通过']:raise RuntimeError('技术检查存在失败项，见 reopen_verification.json；不得宣称完整通过。')
