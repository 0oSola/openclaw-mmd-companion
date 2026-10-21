export const DRAW_BY_MATERIAL={Face:2500,UpperTeeth:2500,LowerTeeth:2500,Tongue:2500,EyeWhite:2500,Brows:2510,Lashes:2510,
 Eyes:2539,'Eyes+':2625,EyeShadow:2648,BodySkin:2483,FingerNails:2319,'Cth1-Top':2469,'Cth1-Glove':2469,
 'Cth1-Cape':3356,'Cth1-Cape2':3368,'Cth2-Shoes':2459,'Cth2-Pants':2459,'Cth2-Pouch':2459,'Cth3-Mask':2447,
 'Cth4-Glove':2435,'Cth5-ShoesZip':2402,Glock:2389,GunSilencer:2419,HairA:2578,HairB:2589};
export const SHADOW_BY_DRAW={2319:1042,2389:1079,2402:1073,2419:1084,2435:1067,2447:1062,2459:1057,2469:1054,2483:1141,2500:1135,2510:1147,2578:1125,2589:1128,3356:1116,3368:1116};
export const OUTLINE_BY_DRAW={2389:2773,2402:2780,2419:2790,2435:2799,2447:2805,2459:2811,2469:2815,2483:2822,2500:2831,2510:2835,2578:2845,2589:2849};

// 打包与浏览器使用同一依赖集合，保持所有原始文件字节。
export function getGf2ResourceInputs(manifest, reference) {
 const draws=new Map([...manifest.draws,...manifest.shadows].map(d=>[d.eventId,d]));
 const inputs=new Map(),enqueue=(name,type='arrayBuffer')=>{if(name)inputs.set(name,[name,type]);};
 enqueue('frame.json','json');
 const events=new Set([...Object.values(DRAW_BY_MATERIAL),...Object.values(OUTLINE_BY_DRAW),2600,2685,2710,1283,1288,1293]);
 for(const id of Object.values(SHADOW_BY_DRAW)){events.add(id);events.add(id+120);}
 for(const id of events){const d=draws.get(id);if(!d)continue;
  for(const b of [...(d.blocks||[]),...(d.vertexBlocks||[])])enqueue(b.file);
  enqueue(d.vertexShader,'text');enqueue(d.fragment,'text');
  if([1283,1288,1293].includes(id)){enqueue(d.vertexFile);enqueue(d.indexFile);}
  for(const resource of Object.values(d.textures||{}))for(const level of manifest.textures[resource]?.subresources||[])enqueue(level.file);
 }
 for(const id of Object.values(DRAW_BY_MATERIAL))enqueue(manifest.vertexColors[id===3368?3356:id]);
 enqueue('pmx-reference.json','json');enqueue(reference.file);enqueue('pmx-reference-parts.json','json');enqueue('head-calibration.json','json');enqueue('post-t4.bin');
 return [...inputs.values()];
}
