import importlib.util, json, sys
from pathlib import Path
import bpy
from mathutils import Vector
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('geo',ROOT.parent/'ak12-silent-azure-static'/'build_character.py');geo=importlib.util.module_from_spec(spec);spec.loader.exec_module(geo)

def material():
    m=bpy.data.materials.get('AK12_RefinedDress') or bpy.data.materials.new('AK12_RefinedDress');m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.006,.012,.028,1);bs.inputs['Roughness'].default_value=.47;bs.inputs['Metallic'].default_value=.02
    return m
def silver():
    m=bpy.data.materials.get('AK12_RefinedSilver') or bpy.data.materials.new('AK12_RefinedSilver');m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.42,.52,.67,1);bs.inputs['Metallic'].default_value=.82;bs.inputs['Roughness'].default_value=.22
    return m
def main():
    bpy.ops.preferences.addon_enable(module='bl_ext.blender_org.mmd_tools')
    col=bpy.data.collections.get('14_AK12_DressRefinement') or bpy.data.collections.new('14_AK12_DressRefinement');bpy.context.scene.collection.children.link(col)
    geo.COLLECTIONS={'03_Dress':col,'04_Accessories':col};geo.SATIN=material();geo.SATIN_EDGE=material();geo.SILVER=silver();geo.SILVER_DARK=silver();geo.GEM=silver()
    # 覆盖式胸衣：低于锁骨、贴合胸廓、背部留空。
    n=96;rows=22;verts=[]
    for i in range(rows+1):
        t=i/rows;z=1.205+.20*t
        for j in range(n):
            a=2*3.1415926535*j/n;front=max(0,-__import__('math').sin(a))
            rx=.115+.034*front;ry=.067+.055*front
            verts.append((rx*__import__('math').cos(a),ry*__import__('math').sin(a)-.004*front,z))
    faces=[(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for i in range(rows) for j in range(n)]
    bodice=geo.mesh('AK12_Refined_Bodice',verts,faces,geo.SATIN,'03_Dress',1);solid=bodice.modifiers.new('BodiceThickness','SOLIDIFY');solid.thickness=.0015
    # 交叉胸带、收腰带。
    geo.ribbon('AK12_CrossBand_L',[(-.118,-.071,1.385),(-.060,-.104,1.335),(.020,-.108,1.285),(.108,-.076,1.235)],.018,geo.SATIN_EDGE,'03_Dress')
    geo.ribbon('AK12_CrossBand_R',[(.118,-.071,1.385),(.060,-.104,1.335),(-.020,-.108,1.285),(-.108,-.076,1.235)],.018,geo.SATIN_EDGE,'03_Dress')
    geo.ribbon('AK12_WaistBand',[(-.145,-.065,1.205),(-.078,-.095,1.185),(.020,-.101,1.175),(.145,-.065,1.205)],.030,geo.SATIN_EDGE,'03_Dress')
    for i in range(4):
        geo.curve('AK12_WrapPiping_'+str(i),[(-.14+i*.012,-.098,1.19-i*.007),(.0,-.112,1.17-i*.006),(.14-i*.012,-.098,1.19-i*.007)],.0011,geo.SILVER_DARK,'03_Dress')
    geo.jewel('AK12_NeckPendant',(0,-.112,1.405),(.014,.005,.028),'04_Accessories')
    geo.curve('AK12_PendantChain',[(0,-.067,1.445),(0,-.092,1.425),(0,-.112,1.405)],.0011,geo.SILVER,'04_Accessories')
    # 领圈替换旧黑色宽领圈的视觉层。
    geo.ring_surface('AK12_RefinedChoker',[(1.445,.040,.035,.010),(1.460,.040,.035,.010)],geo.SATIN_EDGE,'04_Accessories',64,1)
    scene=bpy.context.scene;scene.name='AK12_Meshy_DressRefinement_v1';scene.cycles.samples=48
    scene['精修范围']='覆盖式 AK-12 胸衣、交叉带、收腰带、吊坠和领圈；原 Meshy 裙摆主体未修改。'
    scene['当前边界']='新增衣片尚未绑定身体骨架，静态展示用。'
    bpy.data.texts.new('衣装精修说明').write('本轮针对设计稿与 Meshy 主体的主要差异，新增贴合式胸衣、交叉胸带、收腰带、银色吊坠和领圈。由于 Meshy 衣装与裙摆融合在一个网格中，原衣装没有删除；新增衣片用于覆盖错误轮廓。\n')
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'AK12_Meshy_DressRefinement_v1.blend'))
    (ROOT/'dress_refinement_report.json').write_text(json.dumps({'新增网格':['AK12_Refined_Bodice','AK12_CrossBand_L','AK12_CrossBand_R','AK12_WaistBand','AK12_NeckPendant','AK12_RefinedChoker'],'原裙摆':'保留','原文件':'AK12_Meshy_Refined_v2.blend','交付边界':'静态覆盖式衣装精修，未绑定'},ensure_ascii=False,indent=2),encoding='utf8')
    (ROOT/'dress_views').mkdir(exist_ok=True)
    for name in ['Front','Hero','Back','Face']:
        cam=bpy.data.objects.get('Camera_'+name)
        if cam:scene.camera=cam;scene.render.filepath=str(ROOT/'dress_views'/(name.lower()+'.png'));bpy.ops.render.render(write_still=True)
if __name__=='__main__':main()
