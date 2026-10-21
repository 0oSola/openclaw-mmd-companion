"""静寂苍蓝静态角色：独立程序化建模，不读取或拆取第三方人物网格。

在独立 Blender 后台进程运行；不会访问正在交互编辑的 Blender 场景。
本文件保留可重建的造型参数，源模型不包含动画适配或 PMX 验收承诺。
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
TAU = math.tau
PI = math.pi
COLLECTIONS = {}


def collection(name):
    item = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(item)
    COLLECTIONS[name] = item
    return item


def relocate(obj, group):
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    COLLECTIONS[group].objects.link(obj)
    return obj


def mat(name, color, roughness=.45, metal=0, subsurface=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bs = m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Roughness'].default_value = roughness
    bs.inputs['Metallic'].default_value = metal
    bs.inputs['Subsurface Weight'].default_value = subsurface
    return m


def mesh(name, verts, faces, material, group, subdivision=0):
    data = bpy.data.meshes.new(name + '_Mesh')
    data.from_pydata(verts, [], faces)
    data.update()
    ob = bpy.data.objects.new(name, data)
    COLLECTIONS[group].objects.link(ob)
    if material:
        data.materials.append(material)
    for p in data.polygons:
        p.use_smooth = True
    if subdivision:
        mod = ob.modifiers.new('可编辑细分', 'SUBSURF')
        mod.levels = subdivision
        mod.render_levels = subdivision
    return ob


def uv_sphere(name, center, scale, material, group, segments=40, rings=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=center)
    ob = bpy.context.object
    ob.name = name
    ob.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    relocate(ob, group)
    ob.data.materials.append(material)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def curve(name, points, radius, material, group, cyclic=False):
    data = bpy.data.curves.new(name + '_Curve', 'CURVE')
    data.dimensions = '3D'
    data.resolution_u = 16
    data.bevel_depth = radius
    data.bevel_resolution = 3
    spline = data.splines.new('BEZIER')
    spline.bezier_points.add(len(points) - 1)
    for p, coord in zip(spline.bezier_points, points):
        p.co = coord[:3]
        p.handle_left_type = 'AUTO'
        p.handle_right_type = 'AUTO'
        if len(coord) > 3:
            p.radius = coord[3]
    spline.use_cyclic_u = cyclic
    ob = bpy.data.objects.new(name, data)
    COLLECTIONS[group].objects.link(ob)
    data.materials.append(material)
    return ob


def catmull(points, steps=7):
    p = [Vector(v) for v in points]
    result = []
    for i in range(len(p)-1):
        a,b,c,d = p[max(0,i-1)],p[i],p[i+1],p[min(len(p)-1,i+2)]
        for j in range(steps):
            t = j/steps
            result.append(.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t))
    result.append(p[-1])
    return result


def strand(name, points, width, depth, material, group='02_Hair', grooves=True):
    centers = catmull(points, 8)
    n, sides = len(centers), 10
    verts=[]
    frames=[]
    for i,p in enumerate(centers):
        t=i/(n-1)
        tangent=(centers[min(i+1,n-1)]-centers[max(0,i-1)]).normalized()
        axis=Vector((1,0,0))
        axis=(axis-tangent*axis.dot(tangent)).normalized()
        other=tangent.cross(axis).normalized()
        taper=(.50+.50*math.sin(PI*min(t/.7,1)/2)) * max(.012, (1-t**3.5))
        frames.append((axis,other,taper))
        for j in range(sides):
            a=TAU*j/sides
            verts.append(p+axis*(width*taper*math.cos(a))+other*(depth*taper*math.sin(a)))
    faces=[(i*sides+j,i*sides+(j+1)%sides,(i+1)*sides+(j+1)%sides,(i+1)*sides+j) for i in range(n-1) for j in range(sides)]
    faces += [tuple(reversed(range(sides))), tuple((n-1)*sides+j for j in range(sides))]
    ob=mesh(name,verts,faces,material,group,1)
    if grooves:
        for k,offset in enumerate((-.53,.28)):
            line=[]
            for i in range(0,n,3):
                axis,other,taper=frames[i]
                # 毛束的两面各自存在真实细线，避免使用屏幕贴片。
                front=other if other.y<0 else -other
                line.append(tuple(centers[i]+axis*width*taper*offset+front*depth*taper*math.sqrt(1-offset*offset))+(max(.03,taper),))
            curve(name+'_Filament_'+str(k),line,.00022,HAIR_LIGHT if k else HAIR_SHADOW,group)
    return ob


def ring_surface(name, rows, material, group, count=48, subdivision=2):
    verts=[]
    for z,rx,ry,cy in rows:
        for j in range(count):
            a=TAU*j/count
            verts.append((rx*math.cos(a),cy+ry*math.sin(a),z))
    faces=[(i*count+j,i*count+(j+1)%count,(i+1)*count+(j+1)%count,(i+1)*count+j) for i in range(len(rows)-1) for j in range(count)]
    faces.extend([tuple(reversed(range(count))),tuple((len(rows)-1)*count+j for j in range(count))])
    return mesh(name,verts,faces,material,group,subdivision)


def tube(name, points, radii, material, group='01_Body', count=16):
    centers=catmull(points,5)
    verts=[]
    for i,p in enumerate(centers):
        u=i/(len(centers)-1)*(len(radii)-1)
        k=min(int(u),len(radii)-2)
        r=radii[k]*(1-(u-k))+radii[k+1]*(u-k)
        tangent=(centers[min(i+1,len(centers)-1)]-centers[max(0,i-1)]).normalized()
        a=tangent.cross(Vector((0,1,0))).normalized()
        b=tangent.cross(a).normalized()
        for j in range(count):
            v=TAU*j/count
            verts.append(p+r*(a*math.cos(v)+b*math.sin(v)))
    faces=[(i*count+j,i*count+(j+1)%count,(i+1)*count+(j+1)%count,(i+1)*count+j) for i in range(len(centers)-1) for j in range(count)]
    faces.extend([tuple(reversed(range(count))),tuple((len(centers)-1)*count+j for j in range(count))])
    return mesh(name,verts,faces,material,group,1)


def ribbon(name, points, width, material, group='03_Dress', thickness=.0012):
    centers=catmull(points,8)
    verts=[]
    for i,p in enumerate(centers):
        direction=(centers[min(i+1,len(centers)-1)]-centers[max(0,i-1)]).normalized()
        across=direction.cross(Vector((0,-1,0))).normalized()
        if across.length<.2:
            across=Vector((1,0,0))
        verts += [p-across*width/2,p+across*width/2]
    faces=[(2*i,2*i+1,2*i+3,2*i+2) for i in range(len(centers)-1)]
    ob=mesh(name,verts,faces,material,group,1)
    mod=ob.modifiers.new('衣料厚度','SOLIDIFY'); mod.thickness=thickness
    return ob


def jewel(name, center, scale, group='04_Accessories'):
    cx,cy,cz=center
    sx,sy,sz=scale
    v=[(cx,cy,cz+sz),(cx+sx,cy,cz),(cx,cy-sy,cz),(cx-sx,cy,cz),(cx,cy,cz-sz),(cx,cy+sy*.45,cz)]
    f=[(0,1,2),(0,2,3),(4,2,1),(4,3,2),(0,5,1),(0,3,5),(4,1,5),(4,5,3)]
    ob=mesh(name,v,f,GEM,group)
    for p in ob.data.polygons:p.use_smooth=False
    curve(name+'_SilverSetting',[(cx,cy-.0008,cz+sz*1.14),(cx+sx*1.2,cy-.0008,cz),(cx,cy-.0008,cz-sz*1.14),(cx-sx*1.2,cy-.0008,cz)],.0015,SILVER,group,True)
    return ob


def body():
    torso=ring_surface('Body_Torso',[(.81,.059,.045,0),(.86,.10,.066,0),(.92,.143,.079,.004),(.98,.141,.078,.003),(1.055,.109,.058,0),(1.105,.098,.055,0),(1.17,.115,.065,0),(1.235,.139,.073,0),(1.295,.145,.068,0),(1.345,.149,.052,.002),(1.385,.169,.046,.004),(1.407,.153,.037,.007),(1.417,.099,.034,.005),(1.432,.040,.031,.004),(1.475,.033,.031,.005),(1.515,.032,.030,.012),(1.533,.028,.026,.013)],SKIN,'01_Body')
    torso['说明']='独立生成的人体基础网格；后续需统一肩部、手部连接和动画拓扑验收。'
    # 前胸体积与衣片分离，保留可编辑结构。
    for s in (-1,1):
        uv_sphere('Body_Chest_'+str(s),(s*.064,-.050,1.291),(.072,.056,.063),SKIN,'01_Body')
        tube('Body_Leg_'+str(s),[(s*.081,.007,.94),(s*.094,.002,.82),(s*.097,-.018,.65),(s*.092,-.033,.53),(s*.085,.005,.39),(s*.080,.015,.26),(s*.078,.005,.15)],[.078,.073,.054,.036,.047,.031,.022],SKIN,count=28)
        arm=[(s*.157,.002,1.391),(s*.186,.001,1.351),(s*.210,-.004,1.272),(s*.241,-.016,1.18),(s*.268,-.024,1.09),(s*.290,-.030,1.007)]
        tube('Body_Arm_'+str(s),arm,[.038,.035,.030,.023,.024,.0155],SKIN,count=24)
        palm=uv_sphere('Body_Palm_'+str(s),(s*.301,-.032,.973),(.021,.012,.043),SKIN,'01_Body')
        palm.rotation_euler[1]=s*.19
        for i,(dx,length) in enumerate(((-.014,.047),(-.0045,.060),(.0055,.057),(.015,.043))):
            x=s*(.305+dx)
            z=.952-(.003 if i==0 else 0)
            tube('Body_Finger_'+str(s)+'_'+str(i),[(x,-.031,z),(x+s*.007,-.034,z-length*.48),(x+s*.009,-.039,z-length)],[.0053,.0045,.0028],SKIN,count=10)
        tube('Body_Thumb_'+str(s),[(s*.287,-.033,.983),(s*.274,-.043,.96),(s*.267,-.048,.938)],[.007,.0055,.003],SKIN,count=10)
        # 耳朵。
        uv_sphere('Body_Ear_'+str(s),(s*.089,.0,1.596),(.014,.019,.028),SKIN,'01_Body')
        uv_sphere('Ear_Inner_'+str(s),(s*.098,-.004,1.596),(.006,.012,.018),EAR,'01_Body')
    # 头部环线构造，前面为 -Y。鼻梁与面颊是网格位移，不是图片贴片。
    rows=[(1.487,.008,.016,.003),(1.496,.028,.029,.005),(1.51,.049,.042,.007),(1.533,.067,.054,.009),(1.558,.079,.062,.010),(1.584,.087,.066,.011),(1.609,.090,.067,.011),(1.636,.088,.069,.012),(1.666,.086,.071,.014),(1.697,.078,.065,.015),(1.723,.059,.052,.016),(1.742,.028,.026,.015),(1.747,.003,.004,.015)]
    n=64; verts=[]
    for z,rx,ry,cy in rows:
        for j in range(n):
            a=TAU*j/n;x=rx*math.cos(a);y=cy+ry*math.sin(a)
            front=max(0,-math.sin(a))**10
            nose=.021*math.exp(-(x/.013)**2-((z-1.564)/.019)**2)
            bridge=.0045*math.exp(-(x/.012)**2-((z-1.588)/.031)**2)
            cheek=.0035*math.exp(-((abs(x)-.048)/.022)**2-((z-1.563)/.023)**2)
            y-=front*(nose+bridge+cheek)
            verts.append((x,y,z))
    faces=[(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for i in range(len(rows)-1) for j in range(n)]
    faces += [tuple(reversed(range(n))),tuple((len(rows)-1)*n+j for j in range(n))]
    mesh('Face_EditableHead',verts,faces,SKIN,'01_Body',2)
    for s in (-1,1):
        # 半闭眼的白色杏仁面与淡蓝虹膜。
        verts=[]
        for j in range(32):
            a=TAU*j/32
            x=s*.039+.027*math.cos(a)
            z=1.592+.0057*math.sin(a)+s*(x-s*.039)*.09
            y=.011-.067*math.sqrt(max(.1,1-(x/.090)**2))-.0016
            verts.append((x,y,z))
        verts.append((s*.039,-.0515,1.592))
        mesh('Eye_White_'+str(s),verts,[(32,j,(j+1)%32) for j in range(32)],WHITE,'01_Body')
        iris=uv_sphere('Eye_Iris_'+str(s),(s*.037,-.0538,1.591),(.008,.0014,.0044),IRIS,'01_Body',24,12)
        uv_sphere('Eye_Pupil_'+str(s),(s*.037,-.0552,1.591),(.0028,.0007,.0039),LASH,'01_Body',20,12)
        uv_sphere('Eye_Catchlight_'+str(s),(s*.034,-.056,1.593),(.0017,.0006,.0013),WHITE,'01_Body',16,8)
        lash=[]
        for j in range(9):
            t=j/8;x=s*(.012+.057*t);z=1.593+.0045*math.sin(PI*t)+.006*t
            y=.011-.067*math.sqrt(max(.1,1-(x/.09)**2))-.003
            lash.append((x,y,z,.5+.7*math.sin(PI*t)))
        curve('Eye_UpperLash_'+str(s),lash,.0015,LASH,'01_Body')
        curve('Eye_LowerLash_'+str(s),[(s*.023,-.054,1.588,.15),(s*.043,-.050,1.587,.5),(s*.063,-.041,1.593,.3)],.00065,LASH,'01_Body')
        curve('Brow_'+str(s),[(s*.019,-.059,1.618,.3),(s*.041,-.053,1.621,.8),(s*.066,-.037,1.616,.1)],.0014,HAIR_SHADOW,'01_Body')
    # 参考图左眼闭合，右眼微开；两只眼仍是独立可编辑几何。
    for prefix in ('Eye_White_','Eye_Iris_','Eye_Pupil_','Eye_Catchlight_','Eye_LowerLash_'):
        ob=bpy.data.objects[prefix+'-1'];ob.hide_render=True;ob.hide_viewport=True
    left=bpy.data.objects['Eye_UpperLash_-1'].data.splines[0]
    for i,p in enumerate(left.bezier_points):
        t=i/(len(left.bezier_points)-1)
        p.co.z=1.592-.003*math.sin(PI*t)+.003*t
    curve('Mouth_SoftLine',[(-.012,-.0457,1.532,.2),(0,-.0478,1.5305,.65),(.012,-.0457,1.532,.2)],.0009,LIP,'01_Body')
    curve('Mouth_LowerLight',[(-.005,-.048,1.527,.1),(0,-.049,1.5265,.4),(.005,-.048,1.527,.1)],.00065,LIP_LIGHT,'01_Body')


def hair():
    # 基础发帽，刘海区域提高发际线；后脑由盘发与独立长发覆盖。
    verts=[]; nx=64; ny=18
    for i in range(ny+1):
        t=i/ny
        for j in range(nx):
            a=TAU*j/nx
            front=max(0,-math.sin(a))
            stop=1.75-.51*front**3
            p=.018+t*stop
            verts.append((.099*math.sin(p)*math.cos(a),.014+.082*math.sin(p)*math.sin(a),1.633+.126*math.cos(p)))
    faces=[(i*nx+j,i*nx+(j+1)%nx,(i+1)*nx+(j+1)%nx,(i+1)*nx+j) for i in range(ny) for j in range(nx)]
    mesh('Hair_Scalp',verts,faces,HAIR,'02_Hair',1)
    for i in range(16):
        s=-1 if i<8 else 1;k=i%8
        x=s*(.060+k*.005);y=.040+.007*k
        endz=.64+.16*(.5+.5*math.sin(i*2.1))
        pts=[(x*.77,y+.020,1.68),(x*1.1,y+.009,1.53),(x*1.18+s*.012*math.sin(k),y+.025,1.37),(x*1.22+s*.022*math.sin(k*.6),y+.040,1.16),(x*1.10+s*.018*math.cos(k),y+.018,.99),(x*1.03-s*.012,y+.026,endz+.1),(x*1.12+s*.022*math.sin(i),y+.023,endz)]
        strand('Hair_LongBack_%02d'%i,pts,.008+.0017*(i%3),.0037,HAIR if i%3 else HAIR_LIGHT)
    bangs=[
        [(-.018,-.011,1.754),(-.056,-.061,1.72),(-.073,-.077,1.653),(-.069,-.071,1.577)],
        [(-.011,-.022,1.754),(-.038,-.066,1.713),(-.046,-.075,1.651),(-.054,-.067,1.587)],
        [(-.005,-.025,1.755),(-.016,-.072,1.714),(-.022,-.080,1.65),(-.031,-.074,1.598)],
        [(.006,-.022,1.754),(.006,-.072,1.72),(.000,-.081,1.662),(-.007,-.079,1.611)],
        [(.015,-.021,1.75),(.034,-.068,1.71),(.037,-.076,1.659),(.025,-.072,1.614)],
        [(.025,-.012,1.751),(.058,-.059,1.709),(.070,-.065,1.653),(.072,-.053,1.591)],
        [(.038,.006,1.748),(.076,-.033,1.704),(.090,-.025,1.653),(.084,-.011,1.60)],
    ]
    for i,pts in enumerate(bangs):strand('Hair_Bang_%02d'%i,pts,.015 if i not in (0,6) else .018,.0038,HAIR_LIGHT if i%3==0 else HAIR)
    for s in (-1,1):
        for i in range(3):
            x=s*(.083+i*.006)
            strand('Hair_FrontLock_'+str(s)+'_'+str(i),[(x,-.033,1.677),(x+s*.012,-.042,1.552),(x+s*.018,-.057,1.416),(x+s*.034,-.087,1.30),(x+s*.017,-.130,1.22),(x-s*.014,-.111,1.15-i*.023),(x-s*.008,-.089,1.09-i*.018)],.0095-i*.0013,.0036,HAIR)
        # 从额侧汇向后脑的梳理发束。
        for i in range(5):
            strand('Hair_Swept_'+str(s)+'_'+str(i),[(s*(.017+i*.013),.013,1.752-i*.003),(s*.094,.038,1.719-i*.012),(s*.079,.090,1.674-i*.013),(s*.027,.116,1.655-i*.011)],.010,.004,HAIR)
    uv_sphere('Hair_BunCore',(0,.090,1.666),(.067,.033,.060),HAIR,'02_Hair')
    for i in range(6):
        z=1.710-i*.014
        for s in (-1,1):
            strand('Hair_Braid_'+str(i)+'_'+str(s),[(s*.056,.101,z+.018),(s*.029,.127,z+.003),(-s*.018,.136,z-.016),(-s*.039,.114,z-.026)],.009,.006,HAIR_LIGHT if (i+int(s))%3==0 else HAIR,grooves=True)
    for s in (-1,1):
        for k in range(3):
            curve('Hair_LooseCurl_'+str(s)+'_'+str(k),[(s*.08,.004,1.682,.7),(s*(.109+k*.005),-.01,1.602,1),(s*(.121+k*.008),.021,1.546,.8),(s*.103,.035,1.515,.4),(s*.111,.006,1.533,.05)],.0014,HAIR,'02_Hair')
        for k in range(2):
            strand('Hair_LongWisp_'+str(s)+'_'+str(k),[(s*.073,.105,1.63),(s*.106,.119,1.41),(s*.126,.133,1.19),(s*.12,.117,.95),(s*.14,.12,.72),(s*(.14+k*.011),.10,.51+k*.045)],.0045,.0018,HAIR_LIGHT)
    # 发饰与两条缎带。
    jewel('Hair_Jewel',(.080,.062,1.632),(.011,.005,.025))
    for i in range(2):
        strand('Hair_AccessoryRibbon_'+str(i),[(.084+i*.008,.069,1.628),(.094+i*.009,.074,1.563),(.102+i*.009,.070,1.486)],.006,.001,SATIN,'04_Accessories',False)


def interp(z, keys):
    for i in range(len(keys)-1):
        if keys[i][0]<=z<=keys[i+1][0]:
            t=(z-keys[i][0])/(keys[i+1][0]-keys[i][0]);t=t*t*(3-2*t)
            return keys[i][1]*(1-t)+keys[i+1][1]*t
    return keys[0][1] if z<keys[0][0] else keys[-1][1]


def skirt_point(t,u):
    z=1.112*(1-t)+.004*t
    gap=.002+.29*(max(0,min(1,(t-.12)/.25))**.75)
    a=-2.06+gap+u*(TAU-2*gap)
    rx=interp(z,[(.00,.415),(.22,.30),(.55,.205),(.80,.181),(.94,.179),(1.03,.144),(1.112,.114)])
    ry=interp(z,[(.00,.36),(.22,.24),(.55,.151),(.80,.125),(.94,.112),(1.03,.084),(1.112,.069)])
    rear=max(0,math.sin(a))
    fold=(.0008+.014*t**1.5)*(math.sin(15*a+2.3*t+.65*math.sin(5*t))+ .36*math.sin(27*a-4*t))
    drape=.004*math.sin(8*a+z*21)*(1-t)
    x=(rx+fold+drape)*math.cos(a)
    y=(ry+fold*.8+drape)*math.sin(a)+.008+.24*t**5*rear
    z+=.008*t**9*(.5+.5*math.sin(23*a))
    return (x,y,z)


def dress():
    nx=112;ny=72
    verts=[skirt_point(i/ny,j/nx) for i in range(ny+1) for j in range(nx+1)]
    faces=[((i+1)*(nx+1)+j,(i+1)*(nx+1)+j+1,i*(nx+1)+j+1,i*(nx+1)+j) for i in range(ny) for j in range(nx)]
    ob=mesh('Dress_OpenSlitTrain',verts,faces,SATIN,'03_Dress',1)
    mod=ob.modifiers.new('礼服厚度','SOLIDIFY');mod.thickness=.002;mod.offset=0
    ob['说明']='高开衩与后拖尾为实际三维网格；动态版需要另行设计裙骨与碰撞。'
    for edge in (0,1):
        curve('Dress_SlitHem_'+str(edge),[skirt_point(i/40,edge) for i in range(41)],.0012,SATIN_EDGE,'03_Dress')
    # 胸衣包覆面：中间低、两侧高，背部低开口。
    n=72;rows=18;v=[]
    for i in range(rows+1):
        t=i/rows
        for j in range(n):
            a=TAU*j/n;front=max(0,-math.sin(a))
            top=1.185+.20*front-.06*front**16
            z=1.105+(top-1.105)*t
            rx=interp(z,[(1.105,.113),(1.17,.127),(1.235,.152),(1.30,.157),(1.375,.135)])
            ry=interp(z,[(1.105,.071),(1.17,.084),(1.235,.118),(1.29,.131),(1.34,.104),(1.375,.063)])
            x=rx*math.cos(a);y=ry*math.sin(a)
            v.append((x,y-.002*front,z))
    f=[(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for i in range(rows) for j in range(n)]
    bodice=mesh('Dress_Bodice',v,f,SATIN,'03_Dress',1)
    solid=bodice.modifiers.new('胸衣厚度','SOLIDIFY');solid.thickness=.0018
    # 对角缠绕腰带与细金属边，保留参考中的交叉节奏。
    wraps=[([(-.137,-.055,1.28),(-.075,-.112,1.25),(.030,-.109,1.21),(.111,-.063,1.17)],.026),
           ([(.139,-.049,1.266),(.060,-.108,1.216),(-.041,-.087,1.157),(-.106,-.037,1.127)],.028),
           ([(-.121,-.037,1.185),(-.052,-.081,1.139),(.038,-.071,1.102),(.109,-.029,1.095)],.035)]
    for i,(pts,w) in enumerate(wraps):
        ribbon('Dress_WaistWrap_'+str(i),pts,w,SATIN_EDGE)
        curve('Dress_WrapPiping_'+str(i),[(x,y-.0018,z+w*.33) for x,y,z in pts],.0009,SILVER_DARK,'03_Dress')
    # 黑色颈环与胸前细带。
    ring_surface('Dress_Choker',[(1.443,.041,.037,.006),(1.444,.041,.037,.006),(1.458,.039,.036,.006),(1.459,.039,.036,.006)],SATIN,'03_Dress',64,0)
    for s in (-1,1):
        ribbon('Dress_Halter_'+str(s),[(s*.020,-.029,1.447),(s*.040,-.047,1.42),(s*.084,-.072,1.372),(s*.126,-.055,1.33)],.009,SATIN_EDGE)
        curve('Dress_HalterSilver_'+str(s),[(s*.020,-.031,1.445),(s*.040,-.050,1.42),(s*.084,-.075,1.372),(s*.126,-.058,1.33)],.0008,SILVER,'03_Dress')
    ribbon('Dress_BackSpineRibbon',[(0,.044,1.45),(0,.060,1.39),(0,.080,1.30),(0,.079,1.248),(0,.077,1.186)],.010,SATIN)
    # 侧腰与后腰聚拢褶皱，沿身体表面形成实际体积。
    for i in range(5):
        z=1.10-i*.011
        ribbon('Dress_HipGather_'+str(i),[(-.12,-.066,1.089),(-.048,-.096,z),(.075,-.100,z-.027),(.156,-.03,z-.048)],.013,SATIN_EDGE)
    for i in range(5):
        strand('Dress_BackCascade_'+str(i),[(.055,.065,1.12),(.099+i*.008,.10,1.014-i*.018),(.081+i*.013,.152,.90-i*.025),(.105+i*.012,.16,.80-i*.023)],.023,.005,SATIN_EDGE,'03_Dress',False)
    # 开衩侧的垂坠外层：非对称薄衣片，沿裙面形成滚边而不是加粗线条。
    nr=48;nc=12;verts=[]
    for i in range(nr+1):
        t=.045+.57*i/nr
        center=3.82+.14*math.sin(i/nr*PI*2)
        span=.10+.16*math.sin(PI*i/nr)**.6
        gap=.002+.29*(max(0,min(1,(t-.12)/.25))**.75)
        for j in range(nc+1):
            a=center+span*(2*j/nc-1)
            u=(a-(-2.06+gap))/(TAU-2*gap)
            point=Vector(skirt_point(t,u))
            out=Vector((math.cos(a),math.sin(a),0))
            point+=out*(.007+.012*math.sin(j/nc*PI)*(.5+.5*math.sin(i/nr*PI*6)))
            verts.append(point)
    faces=[(i*(nc+1)+j,(i+1)*(nc+1)+j,(i+1)*(nc+1)+j+1,i*(nc+1)+j+1) for i in range(nr) for j in range(nc)]
    flounce=mesh('Dress_SlitSideDrape',verts,faces,SATIN_EDGE,'03_Dress',1)
    thick=flounce.modifiers.new('垂坠衣片厚度','SOLIDIFY');thick.thickness=.0015


def accessories():
    jewel('Necklace_Upper',(0,-.039,1.441),(.009,.004,.013))
    curve('Necklace_Chain',[(0,-.042,1.434),(0,-.068,1.413),(0,-.077,1.398)],.001,SILVER,'04_Accessories')
    jewel('Necklace_Pendant',(0,-.079,1.390),(.011,.005,.022))
    for s in (-1,1):
        curve('Earring_Chain_'+str(s),[(s*.096,-.009,1.579),(s*.098,-.009,1.558)],.0008,SILVER,'04_Accessories')
        jewel('Earring_'+str(s),(s*.098,-.010,1.548),(.004,.002,.010))
    jewel('Hip_Brooch',(-.120,-.064,1.084),(.012,.005,.021))
    for i in range(3):
        curve('Hip_Chain_'+str(i),[(-.13,-.05,1.083),(-.145,-.065,1.055-i*.014),(-.108,-.085,1.035-i*.006)],.00085,SILVER,'04_Accessories')
    # 独立鞋楦、鞋跟、鞋面和脚踝带。
    for s in (-1,1):
        x=s*.078
        tube('Body_Foot_'+str(s),[(x,.005,.15),(x,.008,.115),(x,-.025,.087),(x,-.070,.058)],[.021,.021,.022,.020],SKIN,count=20)
        # 鞋前掌：尖头曲面。
        sections=[(-.127,.001,.031,.003),(-.117,.014,.033,.007),(-.090,.027,.044,.015),(-.065,.029,.052,.024),(-.034,.027,.054,.018),(.012,.023,.105,.021),(.035,.022,.111,.019)]
        verts=[];n=20
        for y,w,z,h in sections:
            for j in range(n):
                a=TAU*j/n
                verts.append((x+w*math.cos(a),y,z+h*math.sin(a)))
        faces=[(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for i in range(len(sections)-1) for j in range(n)]
        mesh('Shoe_Pump_'+str(s),verts,faces,SHOE,'04_Accessories',2)
        tube('Shoe_Stiletto_'+str(s),[(x,.027,.108),(x,.027,.06),(x,.023,.004)],[.010,.0045,.0035],SHOE,'04_Accessories',12)
        curve('Shoe_AnkleStrap_'+str(s),[(x+.024*math.cos(TAU*j/20),.005+.023*math.sin(TAU*j/20),.148) for j in range(20)],.0032,SATIN_EDGE,'04_Accessories',True)
        for side in (-1,1):
            curve('Shoe_CrossStrap_'+str(s)+'_'+str(side),[(x+side*.019,.002,.146),(x,-.034,.118),(x-side*.025,-.071,.059)],.0023,SILVER,'04_Accessories')
        jewel('Shoe_AnkleGem_'+str(s),(x,-.020,.147),(.006,.003,.011))
        curve('Shoe_ToeDecoration_'+str(s),[(x-.02,-.088,.054),(x,-.105,.054),(x+.02,-.088,.054)],.0018,SILVER,'04_Accessories')


def look_at(ob, target):
    ob.rotation_euler=(Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler()


def unify_body():
    """保留低面数构造源，另建连续表面消除拼接缝；不宣称动画拓扑已完成。"""
    sources=collection('00_ConstructionSources')
    names=('Body_Torso','Body_Chest_','Body_Leg_','Body_Arm_','Body_Palm_','Body_Finger_','Body_Thumb_','Body_Foot_')
    candidates=[o for o in list(COLLECTIONS['01_Body'].objects) if o.type=='MESH' and o.name.startswith(names)]
    copies=[]
    for original in candidates:
        duplicate=original.copy();duplicate.data=original.data.copy();COLLECTIONS['01_Body'].objects.link(duplicate);copies.append(duplicate)
        relocate(original,'00_ConstructionSources')
    for s in (-1,1):
        shoulder=uv_sphere('ShoulderBlend_'+str(s),(s*.157,.002,1.379),(.040,.041,.037),SKIN,'01_Body')
        copies.append(shoulder)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in copies:ob.select_set(True)
    bpy.context.view_layer.objects.active=copies[0]
    bpy.ops.object.convert(target='MESH')
    bpy.ops.object.join()
    ob=bpy.context.object;ob.name='Body_ContinuousSculpt'
    remesh=ob.modifiers.new('连续表面重建','REMESH');remesh.mode='VOXEL';remesh.voxel_size=.0025;remesh.use_smooth_shade=True
    bpy.ops.object.modifier_apply(modifier=remesh.name)
    smooth=ob.modifiers.new('接缝平滑','SMOOTH');smooth.factor=.7;smooth.iterations=7
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    for p in ob.data.polygons:p.use_smooth=True
    ob['说明']='静态连续雕塑表面；低面数构造源保留在隐藏集合。动画阶段需要重拓扑，不是可直接绑定的最终网格。'
    sources.hide_render=True;sources.hide_viewport=True


def conform_clothing():
    """在连续人体表面上检查并修正主衣片控制点的埋入；不替代最终三角面碰撞检测。"""
    from mathutils.bvhtree import BVHTree
    body=bpy.data.objects['Body_ContinuousSculpt']
    tree=BVHTree.FromPolygons([v.co for v in body.data.vertices],[p.vertices[:] for p in body.data.polygons])
    counts={}
    for name in ('Dress_Bodice','Dress_OpenSlitTrain'):
        ob=bpy.data.objects[name];moved=0
        for vertex in ob.data.vertices:
            location,normal,index,distance=tree.find_nearest(vertex.co)
            if location is None:continue
            signed=(vertex.co-location).dot(normal)
            if distance<.045 and (name=='Dress_Bodice' or signed<.004):
                vertex.co=location+normal*.0045;moved+=1
        ob.data.update();counts[name]=moved
    bpy.context.scene['主衣片控制点贴合修正']=json.dumps(counts)


def studio():
    scene=bpy.context.scene
    scene.render.engine='CYCLES'
    scene.cycles.samples=32
    scene.cycles.use_denoising=True
    scene.render.resolution_x=900
    scene.render.resolution_y=1200
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    scene.world.color=(.35,.35,.35)
    scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.64,.70,.82,1)
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.25
    scene.view_settings.view_transform='AgX'
    scene.view_settings.look='AgX - Medium High Contrast'
    scene.render.film_transparent=False
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.001))
    floor=bpy.context.object;floor.name='Studio_Floor';relocate(floor,'05_Studio');floor.data.materials.append(FLOOR)
    for name,loc,energy,color,size in [('Key',(-2,-3,4),260,(.89,.94,1),3),('Fill',(2,-1.5,2.4),160,(1,.89,.84),2.5),('Rim',(0,2.0,3),350,(.71,.82,1),2),('Top',(-.6,.6,4),140,(1,1,1),1.5)]:
        data=bpy.data.lights.new('Studio_'+name,'AREA');data.energy=energy;data.color=color;data.shape='DISK';data.size=size
        ob=bpy.data.objects.new('Studio_'+name,data);COLLECTIONS['05_Studio'].objects.link(ob);ob.location=loc;look_at(ob,(0,0,1))
    for name,location,target,scale in [('Front',(0,-4,1.04),(0,.025,.89),2.05),('Left',(-4,0,1.06),(0,.10,.89),2.05),('Right',(4,0,1.06),(0,.10,.89),2.05),('Back',(0,4,1.06),(0,.05,.89),2.05),('Hero',(-2.6,-4,1.8),(0,.02,.91),2.10),('Face',(0,-3,1.635),(0,0,1.622),.37)]:
        d=bpy.data.cameras.new('Camera_'+name);d.type='ORTHO';d.ortho_scale=scale
        ob=bpy.data.objects.new('Camera_'+name,d);COLLECTIONS['05_Studio'].objects.link(ob);ob.location=location;look_at(ob,target)
    scene.camera=bpy.data.objects['Camera_Hero']
    scene.unit_settings.system='METRIC'
    scene.unit_settings.scale_length=1
    scene['制作阶段']='第一阶段：静态造型；不含骨架绑定、PMX 导出和动作验收。'
    scene['参考图']='ChatGPT Image 2026年9月8日 11_45_32.png'
    scene['资产来源']='本脚本独立生成网格；未拆取项目内第三方人物模型。'
    scene['造型坐标']='单位为米；Z 向上；角色正面朝 -Y。'
    # 在打开文件时默认相机视角，而非任意编辑角度。
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=='VIEW_3D':
                area.spaces.active.region_3d.view_perspective='CAMERA'
                area.spaces.active.shading.type='MATERIAL'


def audit():
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and not o.name.startswith('Studio_')]
    bad=[]
    for ob in objects:
        for v in ob.data.vertices:
            if not all(math.isfinite(c) for c in v.co):bad.append(ob.name);break
    return {'阶段':'静态造型首版','网格对象数':len(objects),'曲线对象数':sum(o.type=='CURVE' for o in bpy.context.scene.objects),'源网格顶点数':sum(len(o.data.vertices) for o in objects),'非有限坐标对象':bad,'骨架对象数':sum(o.type=='ARMATURE' for o in bpy.context.scene.objects),'第三方模型复用':False,'待验证':['外观与参考一致性','部件交界','后续动画拓扑','PMX 材质转换']}


def reference_sheet():
    ref=Path(r'C:\Users\KSG\Downloads\ChatGPT Image 2026年9月8日 11_45_32.png')
    group=collection('06_Reference')
    image=bpy.data.images.load(str(ref),check_existing=True)
    image.name='Reference_AK12_SilentAzure';image.pack()
    ob=bpy.data.objects.new('Reference_DesignSheet',None)
    group.objects.link(ob);ob.empty_display_type='IMAGE';ob.data=image
    ob.empty_display_size=2.4;ob.location=(1.6,.5,.9);ob.rotation_euler=(PI/2,0,0)
    ob['说明']='用户提供的完整参考图，已打包；仅供造型对照，不参加成品渲染。'
    group.hide_render=True;group.hide_viewport=True
    bpy.data.texts.load(str(Path(__file__).resolve()))


def main():
    global SKIN,EAR,WHITE,IRIS,LASH,LIP,LIP_LIGHT,HAIR,HAIR_LIGHT,HAIR_SHADOW,SATIN,SATIN_EDGE,SILVER,SILVER_DARK,GEM,SHOE,FLOOR
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    parser=argparse.ArgumentParser();parser.add_argument('--views',default='Front,Hero,Face');parser.add_argument('--samples',type=int,default=24);parser.add_argument('--draft',action='store_true');opts=parser.parse_args(args)
    ROOT.mkdir(parents=True,exist_ok=True);(ROOT/'renders').mkdir(exist_ok=True)
    # 本进程由 --factory-startup --background 启动，仅删除独立进程的默认物体。
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    for name in ('01_Body','02_Hair','03_Dress','04_Accessories','05_Studio'):collection(name)
    SKIN=mat('Skin_Porcelain',(.72,.53,.49),.56,subsurface=.025)
    EAR=mat('Skin_EarBlush',(.62,.34,.32),.6)
    WHITE=mat('Eyes_White',(.82,.86,.91),.30)
    IRIS=mat('Eyes_IceBlue',(.22,.40,.50),.25,.1)
    LASH=mat('Eyes_SoftCharcoal',(.035,.033,.047),.65)
    LIP=mat('Lips_MutedRose',(.32,.13,.15),.5)
    LIP_LIGHT=mat('Lips_Highlight',(.70,.38,.37),.42)
    HAIR=mat('Hair_Silver',(.39,.45,.56),.40,.10)
    HAIR_LIGHT=mat('Hair_PearlHighlight',(.58,.63,.72),.38,.10)
    HAIR_SHADOW=mat('Hair_SlateStrand',(.23,.28,.38),.40,.1)
    SATIN=mat('Dress_MidnightSatin',(.006,.012,.026),.48,.025)
    SATIN_EDGE=mat('Dress_FoldSatin',(.010,.020,.040),.49,.025)
    SILVER=mat('Metal_PolishedSilver',(.61,.70,.84),.20,.85)
    SILVER_DARK=mat('Metal_BrushedSilver',(.20,.27,.38),.29,.7)
    GEM=mat('Gem_AzureCrystal',(.13,.43,.70),.16,.35)
    SHOE=mat('Shoes_BlackPatent',(.008,.015,.028),.18,.3)
    FLOOR=mat('Studio_CoolIvory',(.61,.65,.72),.85)
    for material in (SATIN,SATIN_EDGE):
        bs=material.node_tree.nodes.get('Principled BSDF');bs.inputs['Anisotropic'].default_value=.32;bs.inputs['Sheen Weight'].default_value=.15
        noise=material.node_tree.nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=280
        bump=material.node_tree.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.08;bump.inputs['Distance'].default_value=.0005
        material.node_tree.links.new(noise.outputs['Fac'],bump.inputs['Height']);material.node_tree.links.new(bump.outputs['Normal'],bs.inputs['Normal'])
    body();hair();dress();accessories();unify_body();conform_clothing();studio();reference_sheet()
    scene=bpy.context.scene;scene.cycles.samples=opts.samples
    if opts.draft:scene.render.resolution_percentage=65
    info=audit()
    (ROOT/'geometry_audit.json').write_text(json.dumps(info,ensure_ascii=False,indent=2),encoding='utf8')
    source=bpy.data.texts.new('制作说明_请先阅读')
    source.write('静寂苍蓝 / 第一阶段静态初模\n\n全部人物网格由 build_character.py 独立生成。未使用项目内禁止拆件的第三方模型。\n\n本文件是可继续精修的初模，不是原图级高还原成品，也不是已经通过验收的可动模型。人体与服装、头发、配件分组保留，程序化参数可重建；参考图与生成脚本也保存在文件内部。\n\n人体使用连续雕塑表面，隐藏集合中保留构造源。后续动画阶段需要重拓扑、蒙皮、表情和物理制作，不能把该静态文件直接视为可动 PMX。\n\n已进行多视角视觉检查及有限范围几何检查，完整检查结果请见同目录 reopen_verification.json。脸部神态、发束层次、盘发和礼服细褶仍有明显精修空间。\n\n参考原图仅作设计参考，角色设计权利属于相应权利人；本文件不授予商业使用权。\n')
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'AK12_SilentAzure_Static.blend'))
    for view in opts.views.split(','):
        if not view:continue
        scene.camera=bpy.data.objects['Camera_'+view]
        scene.render.filepath=str(ROOT/'renders'/f'{view.lower()}.png')
        print('RENDER_START',view,flush=True);bpy.ops.render.render(write_still=True);print('RENDER_DONE',view,flush=True)
    print('BUILD_COMPLETE',json.dumps(info,ensure_ascii=False),flush=True)


if __name__=='__main__':main()
