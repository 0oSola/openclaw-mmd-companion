import bpy, math, json, importlib.util
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('geo',ROOT.parent/'ak12-silent-azure-static'/'build_character.py');geo=importlib.util.module_from_spec(spec);spec.loader.exec_module(geo)
def mat(name,color,rough=.45,metal=0):
 m=bpy.data.materials.get(name) or bpy.data.materials.new(name);m.use_nodes=True;bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=rough;bs.inputs['Metallic'].default_value=metal;return m
def main():
 scene=bpy.context.scene;col=bpy.data.collections.get('14_AK12_DressRefinement_V2') or bpy.data.collections.new('14_AK12_DressRefinement_V2');scene.collection.children.link(col);geo.COLLECTIONS={'03_Dress':col,'04_Accessories':col}
 dark=mat('AK12_DressV2',(.006,.012,.028),.48,.01);silver=mat('AK12_SilverV2',(.42,.52,.67),.22,.82)
 # 只建正面衣片，Y=-，不闭合到背面。
 def panel(name,pts,w):
  geo.ribbon(name,pts,w,dark,'03_Dress')
  ob=bpy.data.objects[name];
  for c in list(ob.users_collection):c.objects.unlink(ob)
  col.objects.link(ob);return ob
 panel('AK12_BodiceFront',[(-.105,-.075,1.205),(-.112,-.088,1.255),(-.095,-.094,1.315),(-.060,-.095,1.375),(-.020,-.090,1.405)],.105)
 panel('AK12_BodiceFront_R',[(.105,-.075,1.205),(.112,-.088,1.255),(.095,-.094,1.315),(.060,-.095,1.375),(.020,-.090,1.405)],.105)
 panel('AK12_CrossBand_L',[(-.115,-.103,1.375),(-.065,-.112,1.335),(.015,-.112,1.275),(.105,-.092,1.225)],.017)
 panel('AK12_CrossBand_R',[(.115,-.103,1.375),(.065,-.112,1.335),(-.015,-.112,1.275),(-.105,-.092,1.225)],.017)
 panel('AK12_WaistBand',[(-.145,-.092,1.205),(-.075,-.108,1.185),(0,-.112,1.18),(.075,-.108,1.185),(.145,-.092,1.205)],.028)
 geo.SILVER=silver;geo.GEM=silver;geo.jewel('AK12_PendantV2',(0,-.119,1.405),(.014,.005,.028),'04_Accessories')
 # 使用局部曲线而不是完整环，避免背部产生闭合圆柱。
 geo.curve('AK12_ChokerFrontV2',[(-.036,-.090,1.445),(0,-.106,1.450),(.036,-.090,1.445)],.004,silver,'04_Accessories')
 scene.name='AK12_Meshy_DressRefinement_v2';scene['衣装精修']='只覆盖正面胸衣、交叉带、收腰带和吊坠；没有生成背部闭合衣片。'
 bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'AK12_Meshy_DressRefinement_v2.blend'))
 (ROOT/'dress_refinement_v2_report.json').write_text(json.dumps({'基线':'AK12_Meshy_Refined_v2.blend','修正':'移除闭合胸衣环，改为正面局部衣片','边界':'静态覆盖，未绑定'},ensure_ascii=False,indent=2),encoding='utf8')
 (ROOT/'dress_v2_views').mkdir(exist_ok=True)
 for name in ['Front','Hero','Back','Face']:
  cam=bpy.data.objects.get('Camera_'+name)
  if cam:scene.camera=cam;scene.render.filepath=str(ROOT/'dress_v2_views'/(name.lower()+'.png'));bpy.ops.render.render(write_still=True)
if __name__=='__main__':main()
