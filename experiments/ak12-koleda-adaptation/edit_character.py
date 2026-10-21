"""在克莱妲拆件副本上制作静寂苍蓝静态造型；不改写源资产。"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import sys
from collections import Counter
from pathlib import Path

import bpy
import numpy as np
from mathutils import Quaternion, Vector
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parent
BASE=ROOT.parent/'koleda-local-parts-study'/'KoledaSummer_Parts.blend'
SPEC=importlib.util.spec_from_file_location('azure_geometry',ROOT.parent/'ak12-silent-azure-static'/'build_character.py')
geo=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(geo)
SCALE=1.08
LIFT=.020
PI=math.pi
TAU=math.tau


def new_collection(name):
    c=bpy.data.collections.new(name);bpy.context.scene.collection.children.link(c);return c


def move(ob,c):
    for old in list(ob.users_collection):old.objects.unlink(ob)
    c.objects.link(ob)


def mix(a,b,t):return a+(b-a)*max(0,min(1,t))


def piecewise(x,keys):
    for (a,va),(b,vb) in zip(keys,keys[1:]):
        if a<=x<=b:return mix(va,vb,(x-a)/(b-a))
    return keys[0][1] if x<keys[0][0] else keys[-1][1]


def map_point(point,shoe=False):
    x,y,z=point
    if shoe:
        sign=1 if x>0 else -1
        x=x-sign*.024+sign*.018*max(0,min(1,-y/.10))
        return Vector((x,y+.018,z*.94+.005))
    nz=piecewise(z,[(0,.004),(.8,.82),(1.10,1.13),(1.18,1.22),(1.29,1.35),(1.375,1.43),(1.46,1.510),(1.76,1.752)])
    shift=piecewise(z,[(0,0),(.8,-.01),(1.10,-.020),(1.29,-.010),(1.45,.021),(1.76,.005)])
    return Vector((x,y+shift,nz))


def map_object(ob,shoe=False):
    if ob.type=='MESH':
        for v in ob.data.vertices:v.co=map_point(v.co,shoe)
        ob.data.update()
    elif ob.type=='CURVE':
        for spline in ob.data.splines:
            for p in spline.bezier_points:
                p.co=map_point(p.co,shoe)
                p.handle_left_type='AUTO';p.handle_right_type='AUTO'


def world_mesh(ob):
    ev=ob.evaluated_get(bpy.context.evaluated_depsgraph_get());data=ev.to_mesh()
    vertices=[ob.matrix_world@v.co for v in data.vertices]
    faces=[tuple(p.vertices) for p in data.polygons]
    ev.to_mesh_clear();return vertices,faces


def body_tree():
    vertices,faces=world_mesh(bpy.data.objects['Part_BodySkin'])
    patch=bpy.data.objects.get('Azure_SkinRepairs')
    if patch:
        pv,pf=world_mesh(patch);offset=len(vertices);vertices+=pv
        faces += [tuple(i+offset for i in f) for f in pf]
    return BVHTree.FromPolygons(vertices,faces),vertices,faces


def repair_skin_boundaries():
    """只补原皮肤开口：不使用体素重建，不改变原身体顶点、UV 或形态键。"""
    import bmesh
    source=bpy.data.objects['Part_BodySkin'];bm=bmesh.new();bm.from_mesh(source.data)
    source_id=bm.verts.layers.int.new('repair_source_index')
    original_face=bm.faces.layers.int.new('repair_original_face')
    bm.verts.ensure_lookup_table()
    for v in bm.verts:v[source_id]=v.index
    for f in bm.faces:f[original_face]=1
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
    boundaries=[e for e in bm.edges if e.is_boundary]
    result=bmesh.ops.holes_fill(bm,edges=boundaries,sides=0)
    new_faces=list(result['faces']);uv_layer=bm.loops.layers.uv.active
    for face in new_faces:face[original_face]=0
    if uv_layer:
        for face in new_faces:
            for loop in face.loops:
                neighbors=[l for l in loop.vert.link_loops if l.face[original_face]==1]
                if neighbors:
                    adjacent=[l for l in neighbors if l.edge==loop.edge or l.link_loop_prev.edge==loop.edge]
                    loop[uv_layer].uv=(adjacent or neighbors)[0][uv_layer].uv
    bmesh.ops.triangulate(bm,faces=new_faces,quad_method='BEAUTY',ngon_method='BEAUTY')
    new_faces=[f for f in bm.faces if f[original_face]==0]
    mapping={};ids=[];verts=[];faces=[];uvs=[]
    for face in new_faces:
        face_ids=[]
        for loop in face.loops:
            old=loop.vert[source_id]
            if old not in mapping:
                mapping[old]=len(verts);ids.append(old);verts.append(tuple(source.data.vertices[old].co))
            face_ids.append(mapping[old]);uvs.append(tuple(loop[uv_layer].uv) if uv_layer else (0,0))
        faces.append(face_ids)
    bm.free()
    data=bpy.data.meshes.new('Azure_SkinRepairsMesh');data.from_pydata(verts,[],faces);data.update()
    ob=bpy.data.objects.new('Azure_SkinRepairs',data);new_collection('15_SkinRepairs').objects.link(ob)
    ob.parent=source.parent;ob.matrix_parent_inverse=source.matrix_parent_inverse.copy();ob.matrix_basis=source.matrix_basis.copy()
    data.materials.append(bpy.data.materials['BodySkin'])
    uv=data.uv_layers.new(name='UVMap')
    for i,value in enumerate(uvs):uv.data[i].uv=value
    for p in data.polygons:p.use_smooth=True
    if hasattr(data,'normals_split_custom_set_from_vertices'):
        data.normals_split_custom_set_from_vertices([tuple(source.data.vertices[i].normal) for i in ids])
    for group in source.vertex_groups:ob.vertex_groups.new(name=group.name)
    for new_id,old_id in enumerate(ids):
        for group in source.data.vertices[old_id].groups:ob.vertex_groups[group.group].add([new_id],group.weight,'REPLACE')
    for key in source.data.shape_keys.key_blocks:
        target=ob.shape_key_add(name=key.name,from_mix=False)
        for i,old_id in enumerate(ids):target.data[i].co=key.data[old_id].co
        target.value=key.value
    for mod in source.modifiers:
        if mod.type=='ARMATURE':
            target=ob.modifiers.new('Inherited_Armature','ARMATURE');target.object=mod.object;target.use_deform_preserve_volume=mod.use_deform_preserve_volume;target.use_vertex_groups=mod.use_vertex_groups
    ob['修复说明']='从原皮肤位置焊接后的真实边界生成补面，继承对应原顶点的 UV、权重和形态键；原身体网格保持不变。'
    return {'补片顶点数':len(verts),'补片三角面数':len(faces),'继承形态键数':len(source.data.shape_keys.key_blocks),'原始边界边数':len(boundaries)}


def set_world_rotation(rig,name,axis,angle):
    bone=rig.pose.bones.get(name)
    if not bone:return
    rest=bone.bone.matrix_local.to_quaternion()
    bone.rotation_mode='QUATERNION'
    bone.rotation_quaternion=rest.inverted()@Quaternion(axis,angle)@rest


def pose_base():
    rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
    root=rig.parent
    root.scale=(SCALE,)*3;root.location.z=LIFT
    changes=[]
    for name in ('左腕','右腕'):
        sign=1 if rig.data.bones[name].head_local.x>0 else -1
        set_world_rotation(rig,name,(0,1,0),sign*.58)
    for name in ('左足首','右足首'):
        for c in rig.pose.bones[name].constraints:
            changes.append({'骨骼':name,'约束':c.name,'原启用':not c.mute});c.mute=True
        set_world_rotation(rig,name,(1,0,0),.45)
    for ob in bpy.context.scene.objects:
        if ob.type!='MESH' or not ob.data.shape_keys:continue
        keys=ob.data.shape_keys.key_blocks
        for name,value in [('まばたき',.36),('ウィンク右',.55),('口角上げ',.18),('瞳小',.12),('い',0)]:
            if name in keys:keys[name].value=value
    bpy.context.view_layer.update()
    return {'整体缩放':SCALE,'整体上移米':LIFT,'手臂下放弧度':.58,'足首静态旋转弧度':.45,'静态展示暂时停用的足部约束':changes}


def reshape_hair():
    for name in ('Part_HairA','Part_HairB'):
        ob=bpy.data.objects[name]
        # 按真实发束连通块分配左右方向，避免逐顶点翻转产生跨中线拉伸。
        adjacency=[[] for v in ob.data.vertices]
        for edge in ob.data.edges:
            a,b=edge.vertices;adjacency[a].append(b);adjacency[b].append(a)
        means={};seen=set()
        for first in range(len(adjacency)):
            if first in seen:continue
            todo=[first];seen.add(first);ids=[]
            while todo:
                i=todo.pop();ids.append(i)
                for j in adjacency[i]:
                    if j not in seen:seen.add(j);todo.append(j)
            mean=sum(ob.data.vertices[i].co.x for i in ids)/len(ids)
            for i in ids:means[i]=mean
        key=ob.shape_key_add(name='Azure_HairSilhouette',from_mix=False)
        for index,p in enumerate(key.data):
            x,y,z=p.co
            t=max(0,min(1,(1.43-z)/.36))
            if name=='Part_HairA':
                t=max(0,min(1,(1.49-z)/.20));t=t*t*(3-2*t)
                mean=means[index];sign=1 if mean>=0 else -1
                p.co.x=mix(x,(x-mean)*.49+sign*.102,t)
                p.co.y=mix(y,.045+(y-.035)*.30,t)
                p.co.z=z-.18*max(0,1.30-z)
            else:
                p.co.x=x*mix(1,.9,t)
                if 1.43<z<1.52 and y<-.055 and abs(x)<.07:
                    w=max(0,1-(z-1.43)/.09)
                    p.co.z-=.012*w*(.5+.5*math.sin(85*x))
        key.value=1
        ob['本次修改']='新建可关闭的银发轮廓形态键，保留原始 Basis 与表情键。'


def recolor_material(name,saturation,tint,value=1,sphere=None):
    m=bpy.data.materials[name];nt=m.node_tree
    shader=nt.nodes.get('mmd_shader');image=nt.nodes.get('mmd_base_tex')
    if not shader or not image:return
    hsv=nt.nodes.new('ShaderNodeHueSaturation');hsv.name='Azure_Desaturate';hsv.label='静寂苍蓝：降低原色饱和度'
    hsv.inputs['Saturation'].default_value=saturation;hsv.inputs['Value'].default_value=value
    nt.links.new(image.outputs['Color'],hsv.inputs['Color'])
    mul=nt.nodes.new('ShaderNodeMixRGB');mul.name='Azure_CoolTint';mul.blend_type='MULTIPLY';mul.inputs[0].default_value=1;mul.inputs[2].default_value=(*tint,1)
    nt.links.new(hsv.outputs['Color'],mul.inputs[1]);nt.links.new(mul.outputs[0],shader.inputs['Base Tex'])
    if sphere is not None:shader.inputs['Sphere Tex Fac'].default_value=sphere


def prepare_materials():
    geo.SATIN=geo.mat('Azure_Dress_MidnightSilk',(.005,.012,.027),.50,.01)
    geo.SATIN_EDGE=geo.mat('Azure_Dress_Folds',(.007,.015,.033),.51,.01)
    geo.SILVER=geo.mat('Azure_Silver',(.58,.68,.82),.20,.86)
    geo.SILVER_DARK=geo.mat('Azure_SilverShadow',(.20,.27,.36),.30,.7)
    geo.GEM=geo.mat('Azure_Crystal',(.09,.34,.64),.17,.30)
    geo.SHOE=geo.mat('Azure_PatentLeather',(.005,.009,.020),.21,.10)
    geo.SKIN=geo.mat('Azure_UnusedHelperSkin',(.7,.5,.45),.6)
    geo.HAIR=geo.mat('Azure_BraidSilver',(.46,.49,.58),.42,.06)
    geo.HAIR_LIGHT=geo.mat('Azure_BraidHighlight',(.63,.67,.74),.39,.05)
    geo.HAIR_SHADOW=geo.mat('Azure_BraidShadow',(.21,.24,.31),.47,.03)
    for m in (geo.SATIN,geo.SATIN_EDGE):
        bs=m.node_tree.nodes.get('Principled BSDF')
        bs.inputs['Anisotropic'].default_value=.4;bs.inputs['Sheen Weight'].default_value=.12;bs.inputs['Specular IOR Level'].default_value=.25
        noise=m.node_tree.nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=360
        bump=m.node_tree.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.065;bump.inputs['Distance'].default_value=.00035
        m.node_tree.links.new(noise.outputs['Fac'],bump.inputs['Height']);m.node_tree.links.new(bump.outputs['Normal'],bs.inputs['Normal'])
    recolor_material('HairA',.045,(.86,.91,1.0),1.10,0)
    recolor_material('HairB',.045,(.86,.91,1.0),1.10,0)
    recolor_material('Brows',.08,(.79,.83,.91),.9,0)
    recolor_material('Eyes',.25,(.82,.96,1.0),.94,0)
    recolor_material('Face',.70,(.96,.98,1.0),1.02,.2)
    recolor_material('BodySkin',.80,(.95,.98,1.0),1.02,.2)
    # 旧脚踝黑带烘在皮肤贴图上：仅在新材质中局部遮罩，不改写原图片。
    mat=bpy.data.materials['BodySkin'];nt=mat.node_tree
    pos=nt.nodes.new('ShaderNodeNewGeometry');sep=nt.nodes.new('ShaderNodeSeparateXYZ');nt.links.new(pos.outputs['Position'],sep.inputs[0])
    ramp=nt.nodes.new('ShaderNodeMapRange');ramp.inputs['From Min'].default_value=.16;ramp.inputs['From Max'].default_value=.205;ramp.inputs['To Min'].default_value=1;ramp.inputs['To Max'].default_value=0
    ramp.clamp=True;nt.links.new(sep.outputs['Z'],ramp.inputs['Value'])
    mixnode=nt.nodes.new('ShaderNodeMixRGB');mixnode.name='Azure_AnkleSkinMask';mixnode.inputs[2].default_value=(.72,.54,.50,1)
    nt.links.new(ramp.outputs[0],mixnode.inputs[0]);nt.links.new(nt.nodes['Azure_CoolTint'].outputs[0],mixnode.inputs[1]);nt.links.new(mixnode.outputs[0],nt.nodes['mmd_shader'].inputs['Base Tex'])


def fitting_proxy(vertices,faces):
    import bmesh
    col=new_collection('14_FittingProxy_Hidden')
    data=bpy.data.meshes.new('Azure_FitProxyMesh');data.from_pydata(vertices,[],faces);data.update()
    bm=bmesh.new();bm.from_mesh(data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
    bmesh.ops.holes_fill(bm,edges=[e for e in bm.edges if e.is_boundary],sides=64)
    bm.to_mesh(data);bm.free()
    ob=bpy.data.objects.new('Azure_FitProxy',data);col.objects.link(ob)
    bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
    remesh=ob.modifiers.new('仅贴衣代理表面','REMESH');remesh.mode='VOXEL';remesh.voxel_size=.003;remesh.use_smooth_shade=True
    bpy.ops.object.modifier_apply(modifier=remesh.name)
    smooth=ob.modifiers.new('代理平滑','SMOOTH');smooth.factor=.65;smooth.iterations=5;bpy.ops.object.modifier_apply(modifier=smooth.name)
    col.hide_render=True;col.hide_viewport=True
    ob['说明']='仅用于新衣服贴合的封闭平滑代理；不是人体修复结果，也不参加渲染。'
    return BVHTree.FromPolygons([v.co for v in ob.data.vertices],[tuple(p.vertices) for p in ob.data.polygons])


def refine_new_clothes():
    for ob in list(geo.COLLECTIONS['03_Dress'].objects):
        if ob.name.startswith('Dress_WaistWrap_'):
            for i in range(0,len(ob.data.vertices),2):
                a,b=ob.data.vertices[i:i+2];mid=(a.co+b.co)*.5
                a.co=mid+(a.co-mid)*.48;b.co=mid+(b.co-mid)*.48
        elif ob.name.startswith('Dress_WrapPiping_'):
            ob.hide_render=True;ob.hide_viewport=True
        elif ob.name.startswith('Dress_HipGather_'):
            ob.data.materials[0]=geo.SATIN
            if int(ob.name.rsplit('_',1)[1])>=3:ob.hide_render=True;ob.hide_viewport=True
    for ob in geo.COLLECTIONS['04_Accessories'].objects:
        if ob.name.startswith(('Necklace_Upper','Necklace_Pendant','Earring_','Hip_Brooch')):
            if ob.type=='MESH':
                center=sum((v.co for v in ob.data.vertices),Vector())/len(ob.data.vertices)
                for v in ob.data.vertices:v.co=center+(v.co-center)*.72
            elif ob.type=='CURVE':
                pts=[p for s in ob.data.splines for p in s.bezier_points]
                if pts:
                    center=sum((p.co for p in pts),Vector())/len(pts)
                    for p in pts:p.co=center+(p.co-center)*.72
                ob.data.bevel_depth*=.8


def fit_clothes(tree):
    stats={}
    for name in ('Dress_Bodice','Dress_OpenSlitTrain','Dress_Choker'):
        ob=bpy.data.objects[name];moved=0
        for v in ob.data.vertices:
            loc,normal,index,d=tree.find_nearest(v.co)
            if loc is None:continue
            sign=(v.co-loc).dot(normal)
            if name=='Dress_Bodice' and d<.09:
                v.co=loc+normal*.0055;moved+=1
            elif name=='Dress_Choker' and d<.035:
                v.co=loc+normal*.004;moved+=1
            elif name=='Dress_OpenSlitTrain' and d<.04 and sign<.007:
                v.co=loc+normal*.007;moved+=1
        ob.data.update();stats[name]=moved
    # 腰带和背部细带只把埋入皮肤的控制点移出，保留衣片层次。
    for ob in list(geo.COLLECTIONS['03_Dress'].objects):
        if ob.name in stats:continue
        if ob.type=='MESH':points=ob.data.vertices
        elif ob.type=='CURVE':points=[p for s in ob.data.splines for p in s.bezier_points]
        else:continue
        for v in points:
            loc,normal,index,d=tree.find_nearest(v.co)
            force=ob.name.startswith('Dress_WaistWrap_')
            if loc is not None and d<(.065 if force else .03) and (force or (v.co-loc).dot(normal)<.004):
                v.co=loc+normal*(.008 if force else .005)
    return stats


def new_braid():
    for s in (-1,1):
        for i in range(4):
            geo.strand('Azure_HairSweep_'+str(s)+'_'+str(i),[(s*.029,.01,1.724-i*.005),(s*.075,.054,1.708-i*.008),(s*.064,.106,1.671-i*.010),(s*.014,.124,1.645-i*.009)],.007,.0035,geo.HAIR,'02_Hair')
    for i in range(5):
        z=1.685-i*.014
        for s in (-1,1):
            geo.strand('Azure_Braid_'+str(i)+'_'+str(s),[(s*.049,.090,z+.019),(s*.027,.115,z+.006),(-s*.013,.126,z-.010),(-s*.036,.106,z-.022)],.009,.0045,geo.HAIR_LIGHT if i%3==0 else geo.HAIR,'02_Hair')
    geo.jewel('Azure_HairClip',(.081,.033,1.63),(.010,.004,.022))
    for i in range(2):
        geo.strand('Azure_HairRibbon_'+str(i),[(.084+i*.007,.036,1.63),(.092+i*.009,.049,1.557),(.096+i*.008,.037,1.492)],.005,.001,geo.SATIN,'04_Accessories',False)


def fitted_shoes(tree,body_vertices,body_faces):
    # 删除的仅是本次辅助函数刚生成、尚未交付的鞋样；源鞋在隐藏集合中保留。
    for ob in list(geo.COLLECTIONS['04_Accessories'].objects):
        if ob.name.startswith('Shoe_'):bpy.data.objects.remove(ob,do_unlink=True)
    body=bpy.data.objects['Part_BodySkin']
    from mathutils.geometry import barycentric_transform
    for sign in (-1,1):
        x=sign*.051
        sections=[(-.117,.001,.029,.001),(-.105,.014,.033,.009),(-.082,.027,.038,.019),(-.060,.034,.043,.025),(-.030,.043,.055,.030),(-.004,.038,.087,.031),(.032,.030,.105,.035),(.065,.029,.110,.034),(.096,.021,.117,.030),(.104,.003,.115,.022)]
        vertices=[];n=32
        for y,width,z,h in sections:
            for j in range(n):
                a=TAU*j/n;vertices.append((x+width*math.cos(a),y,z+h*math.sin(a)))
        faces=[]
        for i in range(len(sections)-1):
            for j in range(n):
                middle=TAU*(j+.5)/n
                if -.016<(sections[i][0]+sections[i+1][0])*.5<.081 and math.sin(middle)>.12:continue
                faces.append((i*n+j,(i+1)*n+j,(i+1)*n+(j+1)%n,i*n+(j+1)%n))
        faces.extend([tuple(reversed(range(n))),tuple((len(sections)-1)*n+j for j in range(n))])
        shoe=geo.mesh('Azure_ShoePump_'+str(sign),vertices,faces,geo.SHOE,'04_Accessories',1)
        solid=shoe.modifiers.new('鞋面厚度','SOLIDIFY');solid.thickness=.0013
        geo.tube('Azure_Stiletto_'+str(sign),[(x,.083,.095),(x,.082,.051),(x,.079,.007)],[.008,.004,.003],geo.SHOE,'04_Accessories',12)
        geo.curve('Azure_AnkleStrap_'+str(sign),[(x+.027*math.cos(TAU*j/24),.035+.033*math.sin(TAU*j/24),.177) for j in range(24)],.0024,geo.SATIN,'04_Accessories',True)
        for side in (-1,1):
            geo.curve('Azure_ShoeSilver_'+str(sign)+'_'+str(side),[(x+side*.025,.019,.176),(x,-.009,.131),(x-side*.028,-.039,.074)],.0013,geo.SILVER,'04_Accessories')
        geo.jewel('Azure_ShoeGem_'+str(sign),(x,.000,.178),(.0045,.002,.009))
        geo.curve('Azure_ToeTrim_'+str(sign),[(x-.022,-.077,.052),(x,-.093,.046),(x+.022,-.077,.052)],.0011,geo.SILVER,'04_Accessories')


def configure_scene():
    scene=bpy.context.scene
    scene.name='AK12_SilentAzure_Static_Edit'
    scene.render.engine='CYCLES';scene.cycles.use_denoising=True
    scene.render.resolution_x=900;scene.render.resolution_y=1200;scene.render.resolution_percentage=100
    scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
    floor=bpy.data.objects.get('Studio_Floor')
    if floor:
        # 旧预览地面过小产生地平线条；仅缩放展示地面。
        floor.scale=(10,10,1)
        for v in floor.data.vertices:v.co.z=.002
    cameras=[('Front',(0,-4,1.04),(0,.02,.91),2.05),('Hero',(-2.3,-4,1.8),(0,.02,.91),2.1),('Back',(0,4,1.04),(0,.06,.91),2.05),('Face',(0,-3,1.63),(0,0,1.623),.35),('Left',(-4,0,1.04),(0,.09,.91),2.05),('Right',(4,0,1.04),(0,.09,.91),2.05),('Shoes',(-1.5,-3,.35),(0,-.015,.12),.37)]
    studio=bpy.data.collections['07_Studio']
    for name,loc,target,scale in cameras:
        ob=bpy.data.objects.get('Camera_'+name)
        if not ob:
            data=bpy.data.cameras.new('Camera_'+name);ob=bpy.data.objects.new('Camera_'+name,data);studio.objects.link(ob)
        ob.data.type='ORTHO';ob.data.ortho_scale=scale;ob.location=loc;geo.look_at(ob,target)
    scene.camera=bpy.data.objects['Camera_Hero']
    scene['制作状态']='既有底模改造的静态首版；新增礼服、饰品未绑定，未完成 PMX 动态验收。'
    scene['来源']='用户指定的克莱妲泳装版拆件副本；保留原作者说明。'
    scene['坐标说明']='米制，Z 轴向上，正面朝 -Y。'


def inspect_body(vertices,faces):
    positions={};weld=[];unique=[]
    for v in vertices:
        key=tuple(round(float(c),6) for c in v)
        if key not in positions:positions[key]=len(unique);unique.append(key)
        weld.append(positions[key])
    edges=Counter()
    for face in faces:
        ids=[weld[i] for i in face]
        for a,b in zip(ids,ids[1:]+ids[:1]):
            if a!=b:edges[tuple(sorted((a,b)))]+=1
    boundary=[e for e,n in edges.items() if n==1]
    return {'求值顶点数':len(vertices),'按位置合并后顶点数':len(unique),'按位置合并后单侧边数':len(boundary),'说明':'用于发现潜在开口；不能单凭边数判断衣物下方皮肤完整。'}


def main():
    argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    p=argparse.ArgumentParser();p.add_argument('--views',default='Front,Hero,Face,Back');p.add_argument('--samples',type=int,default=24);p.add_argument('--draft',action='store_true');args=p.parse_args(argv)
    ROOT.mkdir(exist_ok=True);(ROOT/'renders').mkdir(exist_ok=True)
    before=hashlib.sha256(BASE.read_bytes()).hexdigest()
    bpy.ops.preferences.addon_enable(module='bl_ext.blender_org.mmd_tools')
    archive=new_collection('08_OriginalWardrobe_Hidden');archive.hide_render=True;archive.hide_viewport=True
    for ob in list(bpy.context.scene.objects):
        if ob.name.startswith('Part_') and ob.get('来源材质') in ['P1-Cth1-Bikini','P1-Cth1-Coat','Cth-Shoes','Cth-Watch','Cth-Hairband','Cth4-Knife','Cth-Sunglasses','Glock(Hide)','Gunsilencer(Hide)']:
            move(ob,archive)
    geo.COLLECTIONS={'03_Dress':new_collection('10_Azure_Dress'),'02_Hair':new_collection('11_Azure_HairAdditions'),'04_Accessories':new_collection('12_Azure_Accessories'),'01_Body':new_collection('13_HelperConstruction')}
    pose_info=pose_base();reshape_hair();prepare_materials();skin_repairs=repair_skin_boundaries()
    bpy.context.view_layer.update()
    tree,vertices,faces=body_tree()
    body_info=inspect_body(vertices,faces)
    geo.dress()
    for ob in geo.COLLECTIONS['03_Dress'].objects:map_object(ob)
    geo.accessories()
    for ob in list(geo.COLLECTIONS['01_Body'].objects):
        # 辅助函数生成的占位足部不用于成品；真正的人体来自底模。
        bpy.data.objects.remove(ob,do_unlink=True)
    for ob in geo.COLLECTIONS['04_Accessories'].objects:map_object(ob,ob.name.startswith('Shoe_'))
    refine_new_clothes()
    fit=fit_clothes(tree);new_braid();fitted_shoes(tree,vertices,faces);configure_scene()
    scene=bpy.context.scene;scene.cycles.samples=args.samples
    if args.draft:scene.render.resolution_percentage=65
    ref=bpy.data.images.load(r'C:\Users\KSG\Downloads\ChatGPT Image 2026年9月8日 11_45_32.png',check_existing=True);ref.pack();ref.use_fake_user=True
    note=bpy.data.texts.new('本次改模说明')
    note.write('克莱妲底模上的静寂苍蓝静态研究改造。原作者说明仍保留。\n\n保留原脸部、身体、手指、UV、骨架与形态键；长发轮廓使用新增形态键。原衣物与配件在隐藏集合中，可恢复。新增礼服和饰品为独立网格。\n\n当前摆姿仅用于静态展示：足首的两个 IK 相关约束暂时停用；新衣物和饰品尚未绑定，不能把本文件作为已验证的可动 PMX。\n\n原始拆件文件与源 PMX 不修改。\n')
    bpy.data.texts.load(str(Path(__file__).resolve()))
    report={'源拆件文件':str(BASE),'源拆件SHA256':before,'体态调整':pose_info,'皮肤补面':skin_repairs,'身体初检':body_info,'贴合控制点修正':fit,'保留骨骼数':len(next(o for o in scene.objects if o.type=='ARMATURE').data.bones),'输出':'AK12_SilentAzure_Koleda_Edit.blend','边界':['静态改模','新增服装未绑定','未导出PMX','尚需多视角验收']}
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'AK12_SilentAzure_Koleda_Edit.blend'))
    report['源拆件文件未改变']=before==hashlib.sha256(BASE.read_bytes()).hexdigest()
    (ROOT/'edit_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    for view in args.views.split(','):
        if not view:continue
        scene.camera=bpy.data.objects['Camera_'+view];scene.render.filepath=str(ROOT/'renders'/f'{view.lower()}.png')
        print('RENDER_START',view,flush=True);bpy.ops.render.render(write_still=True);print('RENDER_DONE',view,flush=True)
    print('EDIT_COMPLETE',json.dumps(report,ensure_ascii=False),flush=True)


if __name__=='__main__':main()
