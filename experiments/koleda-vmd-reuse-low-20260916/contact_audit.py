"""全119帧真实网格三角交叉，源缓存与独立VMD导入对照。包含发根，不做物理或接触修正。"""
import bpy,numpy as np,json,sys,time,collections,hashlib
from pathlib import Path
OUT=Path(__file__).parent;ROOT=Path('D:/workspace/MMD project/.scratch/koleda-idle-vmd');sys.path.insert(0,str(ROOT/'contact-sequence-20260916'))
from integrated_contact import audit,tree_of,MATS
start=time.monotonic();bpy.ops.wm.open_mainfile(filepath=str(OUT/'Koleda_Independent_Import.blend'));body=bpy.data.objects['GirlsFrontline KoledaDefault_mesh'];body.data.calc_loop_triangles();tris=np.array([t.vertices[:] for t in body.data.loop_triangles]);labels=np.array([body.material_slots[t.material_index].name for t in body.data.loop_triangles]);hair=np.load(ROOT/'source-cloth-20260916/hair-playback/samples.npz');cape=np.load(ROOT/'source-cloth-20260916/playback/samples.npz');mesh=np.load(OUT/'import-mesh.npz')['mesh'];sf=np.load(OUT/'fit-result.npz')['source_frames'];rest=np.array([v.co[:] for v in body.data.vertices]);rows=[];seams={};hair_sim=hair['simulated'];cape_sim=cape['simulated']
for name,z in [('hair',hair),('cape',cape)]:
    groups=collections.defaultdict(list)
    for vi in z['target_ids']:groups[tuple(np.round(rest[vi],6))].append(int(vi))
    pairs=[(vs[0],v) for vs in groups.values() for v in vs[1:]];seams[name]=np.array(pairs,dtype=int)
for f in range(len(mesh)):
    source=mesh[f].copy();source[hair['target_ids']]=hair_sim[sf[f]];source[cape['target_ids']]=cape_sim[sf[f]];row=dict(frame=f,source_frame=int(sf[f]))
    for stage,p in [('source_cache',source),('vmd_import',mesh[f])]:
        rr={}
        for region,mask,obstacles in [('hair',np.char.find(labels,'Hair')>=0,MATS|{'PROTO_GF2_Cth1-Cape','PROTO_GF2_Cth1-Cape2'}),('cape',np.isin(labels,['PROTO_GF2_Cth1-Cape','PROTO_GF2_Cth1-Cape2']),MATS)]:
            om=np.isin(labels,list(obstacles));ot=tris[om];ol=labels[om];hits=audit(p,tris[mask],p,ot);pairs=seams[region];rr[region]=dict(crossing_pairs=len(hits),regions=dict(collections.Counter(str(ol[j]) for _,j,_ in hits)),seam_max_mm=float(np.linalg.norm(p[pairs[:,0]]-p[pairs[:,1]],axis=1).max()*1000) if len(pairs) else 0)
        row[stage]=rr
    rows.append(row)
    if f%15==0:print(json.dumps(dict(frame=f,elapsed=time.monotonic()-start,row=row),ensure_ascii=False),flush=True)
    if time.monotonic()-start>560:break
report=dict(frames_checked=len(rows),frames_required=len(mesh),complete=len(rows)==len(mesh),scope='同一拓扑实际变形网格内部三角交叉；包含发根；不含自交、切触或完整穿透深度',rows=rows,summary={stage:{region:dict(frames_with_crossings=sum(r[stage][region]['crossing_pairs']>0 for r in rows),total_pairs=sum(r[stage][region]['crossing_pairs'] for r in rows),peak_pairs=max(r[stage][region]['crossing_pairs'] for r in rows),max_seam_mm=max(r[stage][region]['seam_max_mm'] for r in rows)) for region in ['hair','cape']} for stage in ['source_cache','vmd_import']},elapsed=time.monotonic()-start)
report['collision_passed']=report['complete'] and all(x['total_pairs']==0 for x in report['summary']['vmd_import'].values());(OUT/'contact-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({k:v for k,v in report.items() if k!='rows'},ensure_ascii=False),flush=True)
