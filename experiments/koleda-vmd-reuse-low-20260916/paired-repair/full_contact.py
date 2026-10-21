import bpy,numpy as np,json,sys,collections,time
from pathlib import Path
OUT=Path(__file__).parent;ROOT=Path('D:/workspace/MMD project/.scratch/koleda-idle-vmd');sys.path.insert(0,str(ROOT/'contact-sequence-20260916'))
from integrated_contact import audit
bpy.ops.wm.open_mainfile(filepath=str(OUT/'Koleda_Pair_Independent.blend'));body=max((o for o in bpy.data.objects if o.type=='MESH'),key=lambda o:len(o.data.vertices));body.data.calc_loop_triangles();vg=body.vertex_groups['mmd_vertex_order'];sort=np.argsort([vg.weight(v.index) for v in body.data.vertices]);inv=np.argsort(sort);tri=np.array([inv[list(t.vertices)] for t in body.data.loop_triangles]);labels=np.array([body.material_slots[t.material_index].name for t in body.data.loop_triangles]);base_mats=['Face','BodySkin','Cth1-Top','Cth2-Pants','Cth1-Glove','Cth4-Glove'];mesh=np.load(OUT/'independent-mesh.npz')['mesh'];rows=[];start=time.monotonic()
for f,p in enumerate(mesh):
    row=dict(frame=f)
    for region,mats,obstacles in [('cape',['Cth1-Cape','Cth1-Cape2'],base_mats),('hair',['HairA','HairB'],base_mats+['Cth1-Cape','Cth1-Cape2'])]:
        cm=np.isin(labels,mats);bm=np.isin(labels,obstacles);hits=audit(p,tri[cm],p,tri[bm]);bl=labels[bm];row[region]=dict(pairs=len(hits),regions=dict(collections.Counter(str(bl[j]) for _,j,_ in hits)))
    rows.append(row)
    if f%30==0:print(json.dumps(dict(frame=f,row=row,elapsed=time.monotonic()-start)),flush=True)
summary={k:dict(frames=sum(r[k]['pairs']>0 for r in rows),pairs=sum(r[k]['pairs'] for r in rows),peak=max(r[k]['pairs'] for r in rows)) for k in ['cape','hair']};report=dict(frames=119,summary=summary,collision_passed=all(x['pairs']==0 for x in summary.values()),rows=rows,scope='独立导入新PMX+VMD的实际网格内部三角交叉，发根不豁免；不含自交和连续帧间检测');(OUT/'full-contact-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(summary),flush=True)
