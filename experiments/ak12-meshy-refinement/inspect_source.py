"""将用户 GLB 导入独立 Blender 工程，保存原始几何与多视角检查结果。"""
import hashlib
import json
from pathlib import Path

import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parent
SOURCE=Path(r'C:\Users\KSG\Downloads\meshy_1788865300370.glb')


def look(ob,target):ob.rotation_euler=(Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler()


def main():
    ROOT.mkdir(exist_ok=True);(ROOT/'source_views').mkdir(exist_ok=True)
    digest=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    scene=bpy.context.scene;scene.name='Meshy_Source_Inspection'
    imported=list(scene.objects);meshes=[ob for ob in imported if ob.type=='MESH']
    bpy.context.view_layer.update()
    bounds=[ob.matrix_world@Vector(corner) for ob in meshes for corner in ob.bound_box]
    mins=Vector([min(p[i] for p in bounds) for i in range(3)]);maxs=Vector([max(p[i] for p in bounds) for i in range(3)])
    height=maxs.z-mins.z
    assert height>1e-6,'模型高度异常'
    scale=1.75/height
    anchor=bpy.data.objects.new('Source_DisplayTransform',None);scene.collection.objects.link(anchor)
    for ob in imported:
        if ob.parent is None:
            matrix=ob.matrix_world.copy();ob.parent=anchor;ob.matrix_world=matrix
    anchor.scale=(scale,)*3;anchor.location=(-.5*(mins.x+maxs.x)*scale,-.5*(mins.y+maxs.y)*scale,-mins.z*scale+.006)
    bpy.context.view_layer.update()
    inventory={'源GLB':str(SOURCE),'源SHA256':digest,'原始包围盒':[list(mins),list(maxs)],'展示统一缩放':scale,'网格':[],'骨架数':sum(ob.type=='ARMATURE' for ob in imported),'动作数据块数':len(bpy.data.actions),'图片':[]}
    for ob in meshes:
        inventory['网格'].append({'名称':ob.name,'顶点数':len(ob.data.vertices),'面数':len(ob.data.polygons),'边数':len(ob.data.edges),'材质':[s.name for s in ob.material_slots],'UV层':[uv.name for uv in ob.data.uv_layers],'形态键数':len(ob.data.shape_keys.key_blocks) if ob.data.shape_keys else 0,'修改器':[(m.name,m.type) for m in ob.modifiers]})
    for im in bpy.data.images:
        if im.source=='FILE' and not im.packed_file and im.filepath and Path(bpy.path.abspath(im.filepath)).is_file():im.pack()
        inventory['图片'].append({'名称':im.name,'尺寸':list(im.size),'已打包':bool(im.packed_file),'颜色空间':im.colorspace_settings.name})
    studio=bpy.data.collections.new('Inspection_Studio');scene.collection.children.link(studio)
    def link(ob):studio.objects.link(ob)
    world=bpy.data.worlds.new('Inspection_World');scene.world=world;world.use_nodes=True
    world.node_tree.nodes['Background'].inputs['Color'].default_value=(.66,.72,.83,1);world.node_tree.nodes['Background'].inputs['Strength'].default_value=.32
    for name,loc,power,size in [('Key',(-2,-3,4),240,3),('Fill',(2,-1.5,2.4),140,2.5),('Rim',(0,2,3),260,2)]:
        d=bpy.data.lights.new('Inspect_'+name,'AREA');d.energy=power;d.shape='DISK';d.size=size
        ob=bpy.data.objects.new('Inspect_'+name,d);link(ob);ob.location=loc;look(ob,(0,0,.9))
    m=bpy.data.materials.new('Inspect_FloorMaterial');m.use_nodes=True;m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.57,.62,.70,1);m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.8
    d=bpy.data.meshes.new('Inspect_FloorMesh');d.from_pydata([(-200,-200,0),(200,-200,0),(200,200,0),(-200,200,0)],[],[(0,1,2,3)])
    ob=bpy.data.objects.new('Inspect_Floor',d);link(ob);d.materials.append(m)
    for name,loc,target,ortho in [('Front',(0,-4,1.05),(0,0,.88),2.02),('Back',(0,4,1.05),(0,0,.88),2.02),('Left',(-4,0,1.05),(0,0,.88),2.02),('Right',(4,0,1.05),(0,0,.88),2.02),('Hero',(-2.2,-4,1.75),(0,0,.88),2.08),('Face',(0,-3,1.61),(0,0,1.60),.38)]:
        d=bpy.data.cameras.new('Camera_'+name);d.type='ORTHO';d.ortho_scale=ortho
        ob=bpy.data.objects.new('Camera_'+name,d);link(ob);ob.location=loc;look(ob,target)
    scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
    scene.render.resolution_x=800;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
    scene.camera=bpy.data.objects['Camera_Hero']
    scene.unit_settings.system='METRIC'
    note=bpy.data.texts.new('原始导入检查说明');note.write('用户 GLB 的独立导入检查副本。仅通过父级整体居中和统一显示高度，没有编辑源网格或覆盖 GLB。\n源文件：'+str(SOURCE)+'\nSHA256：'+digest+'\n')
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'Meshy_ImportedReference.blend'))
    (ROOT/'source_inventory.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2),encoding='utf8')
    print('SOURCE_INVENTORY',json.dumps(inventory,ensure_ascii=False),flush=True)
    for view in ('Front','Hero','Back','Left','Face'):
        scene.camera=bpy.data.objects['Camera_'+view];scene.render.filepath=str(ROOT/'source_views'/f'{view.lower()}.png')
        print('RENDER_START',view,flush=True);bpy.ops.render.render(write_still=True)
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()==digest,'源 GLB 发生变化'
    print('SOURCE_INSPECTION_COMPLETE',flush=True)


if __name__=='__main__':main()
