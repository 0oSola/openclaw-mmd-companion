"""有界接触候选：源披风骨平移，逐次真实三角复核，保护上缘；不自动接受。"""
import bpy,numpy as np,json,sys,time
from pathlib import Path
from mathutils import Vector
OUT=Path(__file__).parent;ROOT=Path('D:/workspace/MMD project/.scratch/koleda-idle-vmd');sys.path.insert(0,str(ROOT/'contact-sequence-20260916'))
from integrated_contact import audit,tree_of
ref=dict(np.load(OUT/'reference.npz'));allmesh=np.load(OUT/'independent-mesh.npz')['mesh'];order=ref['pmx_to_blender'];inv=np.argsort(order);ids=inv[ref['cape_ids']];W=ref['weights'];bpy.ops.wm.open_mainfile(filepath=str(OUT/'Koleda_Pair_Independent.blend'));body=max((o for o in bpy.data.objects if o.type=='MESH'),key=lambda o:len(o.data.vertices));body.data.calc_loop_triangles();vg=body.vertex_groups['mmd_vertex_order'];bsort=np.argsort([vg.weight(v.index) for v in body.data.vertices]);bi=np.argsort(bsort);tri=np.array([bi[list(t.vertices)] for t in body.data.loop_triangles]);labels=np.array([body.material_slots[t.material_index].name for t in body.data.loop_triangles]);ct=tri[np.isin(labels,['Cth1-Cape','Cth1-Cape2'])];bt=tri[np.isin(labels,['Face','BodySkin','Cth1-Top','Cth2-Pants','Cth1-Glove','Cth4-Glove'])];rest=np.array([body.data.vertices[int(i)].co[:] for i in bsort]);pin=rest[ids,2]>np.quantile(rest[ids,2],.95);WtW=W.T@W;Wp=W[pin];rows=[];start=time.monotonic();frames=[0,15,30,45,60,75,83,105,118]
for limit in [.008,.016,.024]:
    for f in frames:
        base=allmesh[f];tree=tree_of(base,bt);d=np.zeros((W.shape[1],3));baseline=len(audit(base,ct,base,bt,bodytree=tree));best=(baseline,d.copy());history=[]
        for it in range(8):
            p=base.copy();p[ids]+=W@d;hits=audit(p,ct,base,bt,bodytree=tree);history.append(len(hits))
            if len(hits)<best[0]:best=(len(hits),d.copy())
            if not hits:break
            contact=np.unique(ct[[h[0] for h in hits]]);local=np.flatnonzero(np.isin(ids,contact));A=[];B=[]
            for i in local:
                point=p[ids[i]];q,n,_,distance=tree.find_nearest(Vector(point));signed=float((Vector(point)-q).dot(n));depth=.0015-signed
                if depth>0 and depth<.05:A.append(W[i]);B.append(np.array(n)*depth)
            if not A:break
            A=np.array(A);B=np.array(B);delta=np.linalg.solve(A.T@A+WtW*.025+Wp.T@Wp*30+np.eye(W.shape[1])*.01,A.T@B-WtW@d*.025-Wp.T@Wp@d*30);d+=delta;norm=np.linalg.norm(d,axis=1);d*=np.minimum(1,limit/np.maximum(norm,1e-12))[:,None]
        p=base.copy();p[ids]+=W@d;last=len(audit(p,ct,base,bt,bodytree=tree))
        if last<best[0]:best=(last,d.copy())
        d=best[1];disp=W@d;row=dict(frame=f,limit_mm=limit*1000,before=baseline,after=best[0],max_displacement_mm=float(np.linalg.norm(disp,axis=1).max()*1000),anchor_max_mm=float(np.linalg.norm(disp[pin],axis=1).max()*1000),history=history);rows.append(row);print(json.dumps(row),flush=True)
report=dict(scope='9个真实帧有界骨平移候选，尚未全帧/平滑/自交/视觉验收，不输出修正资产',limits_mm=[8,16,24],rows=rows,elapsed=time.monotonic()-start);(OUT/'contact-probe-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
