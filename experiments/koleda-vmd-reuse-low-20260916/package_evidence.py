import json,hashlib,struct,collections
from pathlib import Path
import numpy as np
from PIL import Image
OUT=Path(__file__).parent;mode='final-anchor-noik-nogrant-snap';shots=OUT/('runtime-'+mode);assets=[]
for view in ['front','left','right','back']:
    files=[shots/f'{view}-{f:03d}.png' for f in range(0,118,6)];images=[Image.open(p).convert('RGB') for p in files];dest=OUT/f'{view}.gif';images[0].save(dest,save_all=True,append_images=images[1:],duration=200,loop=0,optimize=False);assets.append(dict(path=str(dest),frames=len(images),bytes=dest.stat().st_size,sha256=hashlib.sha256(dest.read_bytes()).hexdigest()))
fit=np.load(OUT/'fit-result.npz');ids=fit['vertex_ids'];desired=fit['target'];fitted=fit['fit'];imported=np.load(OUT/'import-mesh.npz')['mesh'];ref=json.loads((OUT/'web-reference.json').read_text());order=np.array(ref['blender_ids']);inverse=np.argsort(order);runtime=json.loads((OUT/f'runtime-{mode}-report.json').read_text());source=Path('D:/workspace/MMD project/.scratch/koleda-idle-vmd/source-cloth-20260916');regions={k:np.load(source/p)['target_ids'] for k,p in [('hair','hair-playback/samples.npz'),('cape','playback/samples.npz')]};rows=[]
def stat(e):return dict(rms_mm=float(np.sqrt(np.mean(e*e))*1000),p95_mm=float(np.quantile(e,.95)*1000),max_mm=float(e.max()*1000))
for s in runtime['samples']:
    f=s['frame'];web=np.array(json.loads((shots/f'mesh-{f}.json').read_text()))[inverse][:,[0,2,1]]*np.array([.08,-.08,.08]);row=dict(frame=f,source_frame=int(fit['source_frames'][f]),regions={})
    for region,ri in regions.items():
        mask=np.isin(ids,ri);vi=ids[mask];goal=desired[f,mask];row['regions'][region]=dict(cache_to_fit=stat(np.linalg.norm(fitted[f,mask]-goal,axis=1)),fit_to_import=stat(np.linalg.norm(imported[f,vi]-fitted[f,mask],axis=1)),import_to_web=stat(np.linalg.norm(web[vi]-imported[f,vi],axis=1)),cache_to_web=stat(np.linalg.norm(web[vi]-goal,axis=1)))
    rows.append(row)
raw=(OUT/'Koleda_Entrance_HairCape_Trial.vmd').read_bytes();count=struct.unpack_from('<I',raw,50)[0];names=collections.defaultdict(list)
for i in range(count):
    offset=54+i*111;n=raw[offset:offset+15].split(bytes([0]))[0].decode('shift_jis');names[n].append(struct.unpack_from('<I7f',raw,offset+15))
dynamic={k:float(np.ptp(np.array(v)[:,1:],axis=0).max()) for k,v in names.items() if any(p in k for p in ['Hair','Cape','Cloth_'])};truncated=json.loads((OUT/'independent-import-report.json').read_text())['name_audit'];report=dict(rows=rows,units='毫米；网页模型空间1单位对应Blender0.08米',gif=assets,actual_exported_bones=len(names),dynamic_hair_cape_bones=sum(v>1e-5 for v in dynamic.values()),vmd_name_max_bytes=max(len(n.encode('shift_jis')) for n in names),truncated_exported_names=[r for r in truncated if r['truncated'] and r['pmx'] in names],blender_only_long_names=[r for r in truncated if r['truncated'] and r['pmx'] not in names],runtime=dict(load=runtime['checks']['load'],pause=runtime['checks']['pause'],seek=runtime['checks']['seek'],live_dynamic_bones=len(runtime['checks']['liveHairCapeChanged']),seek_dynamic_bones=len(runtime['checks']['hairCapeChanged']),page_errors=runtime['pageErrors'],request_failures=runtime['failedRequests'],non_200=[r for r in runtime['requests'] if r['status']!=200],console_error_count=sum(r['type']=='error' for r in runtime['console']),console_warning_count=sum(r['type']=='warning' for r in runtime['console']),trialSettings=runtime['trialSettings']))
(OUT/'delivery-metrics.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({k:v for k,v in report.items() if k not in ['rows','gif','blender_only_long_names']},ensure_ascii=False))
