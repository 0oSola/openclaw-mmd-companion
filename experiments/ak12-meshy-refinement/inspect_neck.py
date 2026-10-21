"""只读检查迁移版肩颈的连通分量，并生成局部预览。"""
import json
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ROOT=Path(__file__).resolve().parent


def main():
    ob=bpy.data.objects['Subject_Meshy_Refined'];data=ob.data
    coords=np.empty(len(data.vertices)*3,dtype=np.float32);data.vertices.foreach_get('co',coords);coords=coords.reshape(-1,3)
    unique,inverse=np.unique(coords,axis=0,return_inverse=True)
    edges=np.empty(len(data.edges)*2,dtype=np.int32);data.edges.foreach_get('vertices',edges);edges=inverse[edges].reshape(-1,2)
    parent=list(range(len(unique)));size=[1]*len(unique)
    def root(a):
        while parent[a]!=a:
            parent[a]=parent[parent[a]];a=parent[a]
        return a
    for a,b in edges.tolist():
        a=root(a);b=root(b)
        if a==b:continue
        if size[a]<size[b]:a,b=b,a
        parent[b]=a;size[a]+=size[b]
    roots=np.array([root(i) for i in range(len(unique))],dtype=np.int32)
    labels=roots[inverse]
    loops=np.empty(len(data.loops),dtype=np.int32);data.loops.foreach_get('vertex_index',loops);face_labels=labels[loops.reshape(-1,3)[:,0]]
    component_ids,counts=np.unique(labels,return_counts=True)
    face_ids,face_counts=np.unique(face_labels,return_counts=True);face_count=dict(zip(face_ids.tolist(),face_counts.tolist()))
    records=[]
    for cid,count in zip(component_ids,counts):
        points=coords[labels==cid];lo=points.min(axis=0);hi=points.max(axis=0)
        records.append({'编号':int(cid),'顶点数':int(count),'面数':int(face_count.get(int(cid),0)),'最小值':lo.tolist(),'最大值':hi.tolist(),'中心':points.mean(axis=0).tolist()})
    records.sort(key=lambda x:-x['面数'])
    report={'分量数':len(records),'前40大分量':records[:40],'肩颈附近的小分量':[x for x in records if x['最大值'][2]>1.28 and x['最小值'][2]<1.56 and x['面数']<3000]}
    (ROOT/'neck_connectivity.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    np.savez_compressed(ROOT/'neck_component_labels.npz',vertex_labels=labels,face_labels=face_labels)
    print('CONNECTIVITY',json.dumps(report,ensure_ascii=False),flush=True)
    scene=bpy.context.scene;scene.cycles.samples=24
    (ROOT/'neck_before').mkdir(exist_ok=True)
    for name,location in [('Front',(0,-3,1.43)),('Left',(-3,-.40,1.43)),('Right',(3,-.40,1.43))]:
        cam=bpy.data.cameras.new('Neck_'+name);cam.type='ORTHO';cam.ortho_scale=.62
        camera=bpy.data.objects.new('Neck_'+name,cam);scene.collection.objects.link(camera);camera.location=location;camera.rotation_euler=(Vector((0,-.20,1.42))-camera.location).to_track_quat('-Z','Y').to_euler();scene.camera=camera
        scene.render.filepath=str(ROOT/'neck_before'/f'{name.lower()}.png');bpy.ops.render.render(write_still=True)


if __name__=='__main__':main()
