import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAutoplayResumeInteraction,
  buildAutoFavoriteInteraction,
  createIdleVmdFallbackInteraction,
  createVmdPreviewInteraction,
  createDefaultFavoriteLoopInteraction,
  excludeCompanionUnsafeAssets,
  isEmptyVmdAsset,
  favoriteAssetFolderName,
  isFavoriteForModel,
  isModelOwnedFavoriteMotionAsset,
  mergeFavoriteMotionAssets,
  modelFavoriteFolderName,
  resolveAutoplayVmdAssetPool,
  selectModelFavoriteVmdAssets,
} from "../src/features/mapping/vmdPreview.js";

function ownerModelPath(ownerFolder) {
  if (!ownerFolder) return "";
  if (ownerFolder.includes("/")) return ownerFolder;
  if (ownerFolder === "优菈_by_原神_339146e6e418d79e85a515b26414c0b0") {
    return `${ownerFolder}/优菈.pmx`;
  }
  return `${ownerFolder}/${ownerFolder}.pmx`;
}

function makeAsset(filename, companionSafe = true, category = "", ownerFolder = "优菈_by_原神_339146e6e418d79e85a515b26414c0b0") {
  const eulaFavoritePrefix = `usage/vmd/${ownerFolder}[动作]`;
  const modelRelativePath = ownerModelPath(ownerFolder);
  return {
    asset_id: filename.replace(/\.vmd$/i, ""),
    filename,
    display_name: filename,
    slot: "neutral",
    is_favorite: true,
    url: `/assets/vmd/file/${filename}`,
    favorite_model_paths: modelRelativePath ? [modelRelativePath] : [],
    favorite_model_relative_path: modelRelativePath || null,
    favorite_relative_path: category ? `${eulaFavoritePrefix}/${category}/${filename}` : `${eulaFavoritePrefix}/${filename}`,
    motion_profile: {
      lower_body_motion_score: companionSafe ? 0 : 1.2,
      lower_body_track_count: companionSafe ? 0 : 1,
      companion_safe: companionSafe,
    },
  };
}

test("烘焙预览显式选择，普通预览不自动关闭求解", () => {
  const asset = makeAsset("Koleda_CapeRebind.vmd", false);
  assert.equal(createVmdPreviewInteraction(asset).bakedBoneAnimation, false);
  assert.equal(createVmdPreviewInteraction(asset, 1, { bakedBoneAnimation: true }).bakedBoneAnimation, true);
});

test("收藏待机不再排除大幅腿部动作，也不锁住下半身", () => {
  const safe = makeAsset("upper-body.vmd", true);
  const unsafe = makeAsset("leg-lift.vmd", false);

  assert.deepEqual(excludeCompanionUnsafeAssets([unsafe, safe]), [safe]);

  const interaction = createDefaultFavoriteLoopInteraction([unsafe, safe]);
  assert.equal(interaction.vmdUrl, unsafe.url);
  assert.deepEqual(interaction.vmdLoopUrls, [unsafe.url, safe.url]);
  assert.equal(interaction.lockLowerBody, false);
});

test("手动预览大幅腿部动作保留根位置和下半身动画", () => {
  const unsafe = makeAsset("leg-lift.vmd", false);
  const interaction = createVmdPreviewInteraction(unsafe);

  assert.equal(interaction.lockLowerBody, false);
  assert.equal(interaction.lockRootPosition, false);
  assert.equal(interaction.disableCrossfade, true);
});

test("手动预览安全动作同样不固定根位置和下半身", () => {
  const safe = makeAsset("upper-body.vmd", true);
  const interaction = createVmdPreviewInteraction(safe);

  assert.equal(interaction.lockLowerBody, false);
  assert.equal(interaction.lockRootPosition, false);
  assert.equal(interaction.disableCrossfade, true);
});

test("favorite VMD autoplay accepts legacy assets without motion profile", () => {
  const legacy = {
    filename: "legacy.vmd",
    display_name: "legacy.vmd",
    slot: "neutral",
    url: "/assets/vmd/file/legacy",
  };

  const interaction = createDefaultFavoriteLoopInteraction([legacy]);
  assert.equal(interaction.vmdUrl, legacy.url);
});

test("只有 VMD 文件头的空动作不会进入预览、点击或待机播放池", () => {
  const empty = { ...makeAsset("empty.vmd", true), size_bytes: 64 };
  const valid = { ...makeAsset("valid.vmd", true), size_bytes: 65 };

  assert.equal(isEmptyVmdAsset(empty), true);
  assert.equal(isEmptyVmdAsset(valid), false);
  assert.deepEqual(excludeCompanionUnsafeAssets([empty, valid]), [valid]);
  assert.equal(createDefaultFavoriteLoopInteraction([empty, valid]).vmdUrl, valid.url);
});

test("autoplay resume starts from a random favorite motion instead of the fixed first asset", () => {
  const first = makeAsset("idle-a.vmd", true);
  const middle = makeAsset("idle-b.vmd", true);
  const last = makeAsset("idle-c.vmd", true);

  const interaction = buildAutoplayResumeInteraction([first, middle, last], { randomValue: 0.8 });

  assert.equal(interaction.vmdUrl, last.url);
  assert.deepEqual(interaction.vmdLoopUrls, [first.url, middle.url, last.url]);
  assert.equal(interaction.loopMode, "random");
});

test("收藏的所有分类均进入随机待机，不优先过滤成待机分类", () => {
  const answer = makeAsset("answer.vmd", true, "04_answering_explain");
  const firstIdle = makeAsset("idle-a.vmd", true, "00_idle_loop");
  const secondIdle = makeAsset("idle-b.vmd", true, "00_idle_loop");
  const strong = makeAsset("strong.vmd", true, "06_strong_personality");

  const interaction = buildAutoFavoriteInteraction([answer, firstIdle, secondIdle, strong], { randomValue: 0.9 });

  assert.equal(interaction.vmdUrl, strong.url);
  assert.deepEqual(interaction.vmdLoopUrls, [answer.url, firstIdle.url, secondIdle.url, strong.url]);
});

test("临时待机从完整候选池选取，保留情绪槽", () => {
  const answer = makeAsset("answer.vmd", true, "04_answering_explain");
  const firstIdle = makeAsset("idle-a.vmd", true, "00_idle_loop");
  const secondIdle = makeAsset("idle-b.vmd", true, "00_idle_loop");

  const fallback = createIdleVmdFallbackInteraction([answer, firstIdle, secondIdle], {
    emotion: "thinking",
    randomValue: 0.75,
  });

  assert.equal(fallback.activeVmdAssetId, "idle-b");
  assert.equal(fallback.interaction.vmdUrl, secondIdle.url);
  assert.deepEqual(fallback.interaction.vmdLoopUrls, []);
  assert.deepEqual(fallback.interaction.vmdLoopEmotionByUrl, { [secondIdle.url]: "thinking" });
});

test("收藏按模型归属：目录名等于 `<模型目录名>[动作]`", () => {
  assert.equal(modelFavoriteFolderName("Eula/Eula.pmx"), "eula[动作]");
  assert.equal(modelFavoriteFolderName("Koleda/Koleda.pmx"), "koleda[动作]");
  assert.equal(modelFavoriteFolderName("优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx"),
    "优菈_by_原神_339146e6e418d79e85a515b26414c0b0[动作]");
  assert.equal(modelFavoriteFolderName("root_idle.pmx"), "root_idle[动作]");
  assert.equal(modelFavoriteFolderName(""), "");
});

test("收藏只认自己模型目录，互不继承", () => {
  const koledaFavorite = makeAsset("wave.vmd", true, "02_greeting_social", "Koleda");
  const eulaFavorite = makeAsset("看时间.vmd", true, "03_thinking_waiting");
  const ayakaFavorite = makeAsset("ayaka-wave.vmd", true, "02_greeting_social", "Ayaka");

  const assets = [koledaFavorite, eulaFavorite, ayakaFavorite];

  // 每个模型只看得到自己目录下的收藏。
  assert.deepEqual(selectModelFavoriteVmdAssets(assets, "Koleda/Koleda.pmx"), [koledaFavorite]);
  assert.deepEqual(selectModelFavoriteVmdAssets(assets, "优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx"), [eulaFavorite]);
  assert.deepEqual(selectModelFavoriteVmdAssets(assets, "Ayaka/Ayaka.pmx"), [ayakaFavorite]);

  // 优菈不再把自己的收藏发给别的模型。
  assert.deepEqual(selectModelFavoriteVmdAssets(assets, "Ayaka/Ayaka.pmx").map((a) => a.filename), ["ayaka-wave.vmd"]);
  // 没有自己收藏的模型拿到空池。
  assert.deepEqual(selectModelFavoriteVmdAssets(assets, "长离/长离.pmx"), []);
  assert.deepEqual(selectModelFavoriteVmdAssets(assets, ""), []);
});

test("收藏目录识别忽略 _builtin 共享目录", () => {
  const ownFavorite = makeAsset("wave.vmd", true, "02_greeting_social", "Koleda");
  const sharedBuiltin = { ...makeAsset("shared.vmd"), favorite_relative_path: "usage/vmd/_builtin/shared.vmd", favorite_model_paths: [], favorite_model_relative_path: null };

  assert.equal(isModelOwnedFavoriteMotionAsset(ownFavorite), true);
  assert.equal(isModelOwnedFavoriteMotionAsset(sharedBuiltin), false);
  assert.equal(favoriteAssetFolderName(ownFavorite), "koleda[动作]");
  assert.equal(favoriteAssetFolderName(sharedBuiltin), "_builtin");
});

test("模型自己的收藏进入随机池，且不受腿部安全筛选影响", () => {
  const ownGreeting = makeAsset("wave.vmd", true, "02_greeting_social", "Koleda");
  const ownUnsafe = makeAsset("leg-lift.vmd", false, "02_greeting_social", "Koleda");
  const eulaFavorite = makeAsset("eula-idle.vmd", true, "00_idle_loop");

  const scoped = selectModelFavoriteVmdAssets([ownGreeting, ownUnsafe, eulaFavorite], "Koleda/Koleda.pmx");
  assert.deepEqual(scoped, [ownGreeting, ownUnsafe]);
  assert.deepEqual(resolveAutoplayVmdAssetPool(scoped, [], []), [ownGreeting, ownUnsafe]);
});

test("收藏存在时不混入内置待机，取消全部收藏后才使用内置待机", () => {
  const favorite=makeAsset('进场待机.vmd',false);
  const builtin=makeAsset('builtin.vmd',true,'00_idle_loop');
  assert.deepEqual(resolveAutoplayVmdAssetPool([favorite],[],[builtin]),[favorite]);
  assert.deepEqual(resolveAutoplayVmdAssetPool([],[],[builtin]),[builtin]);
});

test("随机待机分别携带每个动作的烘焙模式", () => {
  const baked={...makeAsset('baked.vmd',false),bakedBoneAnimation:true};
  const ordinary=makeAsset('ordinary.vmd');
  const interaction=buildAutoFavoriteInteraction([baked,ordinary],{randomValue:0});
  assert.deepEqual(interaction.vmdBakedBoneAnimationByUrl,{[baked.url]:true,[ordinary.url]:false});
});

test("收藏即入池且取消即移除，模型目录决定归属", () => {
  const motion={...makeAsset('new.vmd',false,'','Koleda'),is_favorite:false,favorite_model_paths:[],favorite_model_relative_path:null};
  assert.deepEqual(selectModelFavoriteVmdAssets([motion],'Koleda/Koleda.pmx'),[]);

  const favorite={...motion,is_favorite:true,favorite_model_paths:['Koleda/Koleda.pmx'],favorite_model_relative_path:'Koleda/Koleda.pmx'};
  assert.deepEqual(selectModelFavoriteVmdAssets([favorite],'Koleda/Koleda.pmx'),[favorite]);
  assert.deepEqual(resolveAutoplayVmdAssetPool(selectModelFavoriteVmdAssets([favorite],'Koleda/Koleda.pmx')),[favorite]);

  const otherModelFavorite={...favorite,favorite_model_paths:['Eula/Eula.pmx'],favorite_model_relative_path:'Eula/Eula.pmx'};
  assert.deepEqual(selectModelFavoriteVmdAssets([otherModelFavorite],'Koleda/Koleda.pmx'),[]);

  const unfavorited={...favorite,is_favorite:false,favorite_model_paths:[],favorite_model_relative_path:null};
  assert.deepEqual(selectModelFavoriteVmdAssets([unfavorited],'Koleda/Koleda.pmx'),[]);
});

test("收藏列表按 favorite_model_paths 归属，不依赖 [动作] 目录", () => {
  const asset = {
    asset_id: "c469c832-f623-4039-bf49-a6b2f82510a0",
    filename: "Koleda_专属查看_30fps.vmd",
    display_name: "Koleda_专属查看_30fps.vmd",
    slot: "happy",
    is_favorite: true,
    favorite_model_paths: ["克莱妲原皮/GirlsFrontline KoledaDefault.pmx"],
    favorite_model_relative_path: "克莱妲原皮/GirlsFrontline KoledaDefault.pmx",
    favorite_relative_path: null,
    source_relative_path: "usage/vmd/_builtin/Koleda_专属查看_30fps.vmd",
    url: "/assets/vmd/file/c469c832-f623-4039-bf49-a6b2f82510a0",
    size_bytes: 13493800,
  };
  const koleda = "克莱妲原皮/GirlsFrontline KoledaDefault.pmx";
  const eula = "优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx";
  assert.equal(isFavoriteForModel(asset, koleda), true);
  assert.equal(isFavoriteForModel(asset, eula), false);
  assert.deepEqual(selectModelFavoriteVmdAssets([asset], koleda).map((item) => item.filename), ["Koleda_专属查看_30fps.vmd"]);
  assert.deepEqual(selectModelFavoriteVmdAssets([asset], eula), []);
  assert.deepEqual(resolveAutoplayVmdAssetPool(selectModelFavoriteVmdAssets([asset], koleda), [], []), [asset]);
});

test("长短路径的同名克莱妲互不继承收藏", () => {
  const shortPath = "克莱妲原皮/GirlsFrontline KoledaDefault.pmx";
  const longPath = "克莱妲原皮_by_少女前线2：追放_3801ab976ee72bef4da6543c0f956bb0/克莱妲原皮/GirlsFrontline KoledaDefault.pmx";
  const asset = {
    ...makeAsset("Koleda_专属查看_30fps.vmd"),
    is_favorite: true,
    favorite_model_paths: [shortPath],
    favorite_model_relative_path: shortPath,
    favorite_relative_path: null,
  };
  assert.equal(isFavoriteForModel(asset, shortPath), true);
  assert.equal(isFavoriteForModel(asset, longPath), false);
  assert.equal(isFavoriteForModel({ ...asset, is_favorite: true, favorite_model_paths: [], favorite_model_relative_path: null }, shortPath), false);
  assert.deepEqual(selectModelFavoriteVmdAssets([asset], shortPath).map((item) => item.filename), ["Koleda_专属查看_30fps.vmd"]);
  assert.deepEqual(selectModelFavoriteVmdAssets([asset], longPath), []);
});

