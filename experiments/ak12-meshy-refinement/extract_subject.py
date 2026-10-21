"""从整张设计稿生成物中分离最左侧正面角色，保留原贴图与源面索引。"""
import hashlib
import json
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ROOT=Path(__file__).resolve().parent
GLB=Path(r'C:\Users\KSG\Downloads\meshy_1788865300370.glb')


def subset_mesh(source,selected,name,positions=None):
    data=source.data
    co=np.empty(len(data.vertices)*3,dtype=np.float32);data.vertices.foreach_get('co',co);co=co.reshape(-1,3)
    loop_vid=np.empty(len(data.loops),dtype=np.int32);data.loops.foreach_get('vertex_index',loop_vid)
    sizes=np.empty(len(data.polygons),dtype=np.int32);data.polygons.foreach_get('loop_total',sizes)
    assert np.all(sizes==3),'此工具只处理三角面'
    triangles=loop_vid.reshape(-1,3)[selected]
    used,inverse=np.unique(triangles.ravel(),return_inverse=True)
    points=co[used] if positions is None else positions[used]
    out=bpy.data.meshes.new(name+'_Mesh');out.vertices.add(len(used));out.vertices.foreach_set('co',points.astype(np.float32).ravel())
    out.loops.add(len(inverse));out.loops.foreach_set('vertex_index',inverse.astype(np.int32))
    out.polygons.add(len(triangles));out.polygons.foreach_set('loop_start',np.arange(len(triangles),dtype=np.int32)*3);out.polygons.foreach_set('loop_total',np.full(len(triangles),3,dtype=np.int32))
    for material in data.materials:out.materials.append(material)
    mats=np.empty(len(data.polygons),dtype=np.int32);data.polygons.foreach_get('material_index',mats);out.polygons.foreach_set('material_index',mats[selected])
    for layer in data.uv_layers:
        values=np.empty(len(data.loops)*2,dtype=np.float32);layer.data.foreach_get('uv',values)
        target=out.uv_layers.new(name=layer.name);target.data.foreach_set('uv',values.reshape(-1,3,2)[selected].ravel())
    out.update(calc_edges=True);out.polygons.foreach_set('use_smooth',np.ones(len(triangles),dtype=np.bool_))
    source_vertices=np.arange(len(data.vertices),dtype=np.int32)
    source_faces=np.arange(len(data.polygons),dtype=np.int32)
    if data.attributes.get('source_vertex_index'):data.attributes['source_vertex_index'].data.foreach_get('value',source_vertices)
    if data.attributes.get('source_face_index'):data.attributes['source_face_index'].data.foreach_get('value',source_faces)
    vi=out.attributes.new('source_vertex_index','INT','POINT');vi.data.foreach_set('value',source_vertices[used])
    fi=out.attributes.new('source_face_index','INT','FACE');fi.data.foreach_set('value',source_faces[selected])
    ob=bpy.data.objects.new(name,out);bpy.context.scene.collection.objects.link(ob)
    return ob,used


def main():
    original=bpy.data.objects['Mesh_0'];data=original.data
    coordinates=np.empty(len(data.vertices)*3,dtype=np.float32);data.vertices.foreach_get('co',coordinates);coordinates=coordinates.reshape(-1,3)
    matrix=np.array(original.matrix_world,dtype=np.float64)
    world=coordinates@matrix[:3,:3].T+matrix[:3,3]
    indices=np.empty(len(data.loops),dtype=np.int32);data.loops.foreach_get('vertex_index',indices);indices=indices.reshape(-1,3)
    centers=world[indices].mean(axis=1)
    # 此边界已通过全景图定位在正面主体与第二个侧身生成物之间。
    selected=centers[:,0]<-.65
    chosen=world[np.unique(indices[selected].ravel())]
    lo=chosen.min(axis=0);hi=chosen.max(axis=0)
    scale=1.75/(hi[2]-lo[2])
    head=chosen[chosen[:,2]>lo[2]+.88*(hi[2]-lo[2])]
    cx=float(np.median(head[:,0]));cy=float((lo[1]+hi[1])*.5)
    normalized=(world-np.array([cx,cy,lo[2]]))*scale+np.array([0,0,.006])
    subject,used=subset_mesh(original,selected,'Subject_Meshy',normalized)
    subject['说明']='从用户整张设计稿生成物中分离的正面主体；原始 GLB 保留。裙摆相邻处的分离边界待检查。'
    subject['源文件']=str(GLB)
    source_uv=np.empty(len(data.loops)*2,dtype=np.float32);data.uv_layers.active.data.foreach_get('uv',source_uv)
    actual_uv=np.empty(len(subject.data.loops)*2,dtype=np.float32);subject.data.uv_layers.active.data.foreach_get('uv',actual_uv)
    report={'源GLB_SHA256':hashlib.sha256(GLB.read_bytes()).hexdigest(),'分离平面X':-.65,'源顶点数':len(data.vertices),'源面数':len(data.polygons),'主体顶点数':len(subject.data.vertices),'主体面数':len(subject.data.polygons),'源主体包围盒':[lo.tolist(),hi.tolist()],'主体重新缩放':scale,'主体平移中心':[cx,cy,float(lo[2])],'UV完整保留':bool(np.array_equal(actual_uv,source_uv.reshape(-1,3,2)[selected].ravel()))}
    # 仅从当前独立工作副本移除全图对象；原 GLB 和导入参考文件不受影响。
    bpy.data.objects.remove(original,do_unlink=True)
    scene=bpy.context.scene;scene.name='Subject_Extracted_Reference'
    for name,loc,target,ortho in [('Front',(0,-4,1.05),(0,0,.90),2.05),('Hero',(-2.2,-4,1.75),(0,0,.90),2.10),('Back',(0,4,1.05),(0,0,.90),2.05),('Left',(-4,0,1.05),(0,0,.90),2.05),('Right',(4,0,1.05),(0,0,.90),2.05),('Face',(0,-3,1.62),(0,0,1.62),.36)]:
        camera=bpy.data.objects['Camera_'+name];camera.location=loc;camera.data.ortho_scale=ortho;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.camera=bpy.data.objects['Camera_Hero'];scene.cycles.samples=24
    bpy.ops.object.select_all(action='DESELECT');subject.select_set(True);bpy.context.view_layer.objects.active=subject
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'Subject_ExtractedReference.blend'))
    (ROOT/'subject_inventory.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    (ROOT/'subject_views').mkdir(exist_ok=True)
    print('SUBJECT_INVENTORY',json.dumps(report,ensure_ascii=False),flush=True)
    for view in ('Front','Hero','Back','Left','Right','Face'):
        scene.camera=bpy.data.objects['Camera_'+view];scene.render.filepath=str(ROOT/'subject_views'/f'{view.lower()}.png')
        print('RENDER_START',view,flush=True);bpy.ops.render.render(write_still=True)
    print('SUBJECT_EXTRACTION_COMPLETE',flush=True)


if __name__=='__main__':main()
