import { resolveStageAssetUrl } from "./stageAssetUrl.js";
import * as THREE from "three";
import { MMDLoader } from "three-stdlib";
import { enableVmdSubframeCurves } from "./vmdSubframeCurves.js";
import { resolveStageWeaponPair } from "./stageWeaponPair.js";
import { applyKoledaWeaponMaterials } from "./koledaWeaponMaterials.js";

function releaseMesh(mesh) {
  const environment = mesh?.__weaponEnvironmentTarget;
  environment?.dispose();
  const textures = new Set();
  const geometries = new Set(), skeletons = new Set(), materials = new Set();
  mesh?.traverse((child) => {
    if (child.geometry) geometries.add(child.geometry);
    for (const material of (Array.isArray(child.material) ? child.material : [child.material])) {
      if (!material) continue;
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      materials.add(material);
    }
    if (child.skeleton) skeletons.add(child.skeleton);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) if (texture !== environment?.texture) texture.dispose();
}

/** 独立加载几何，播放时间始终取自人物。 */
export class StageWeaponAttachment {
  constructor(runtime) {
    this.runtime = runtime;
    this.enabled = false;
    this.revision = 0;
    this.mesh = null;
    this.mixer = null;
    this.action = null;
    this.pair = null;
    this.loading = false;
    this.onStateChange = null;
    this.state = { phase: "hidden", detail: "武器已隐藏" };
  }

  publish(phase, detail) {
    if (this.state.phase === phase && this.state.detail === detail) return;
    this.state = { phase, detail };
    this.onStateChange?.(this.state);
  }

  clear() {
    ++this.revision;
    this.loading = false;
    this.pair = null;
    this.mixer?.stopAllAction();
    if (this.mesh) {
      this.mixer?.uncacheRoot(this.mesh);
      this.runtime.scene?.remove(this.mesh);
      releaseMesh(this.mesh);
    }
    this.mesh = this.mixer = this.action = null;
    this.publish(this.enabled ? "unavailable" : "hidden", this.enabled ? "当前动作没有配套武器" : "武器已隐藏");
  }

  setMotion(url, identifiedPair = null) {
    this.clear();
    const pair = resolveStageWeaponPair(url, identifiedPair);
    const r = this.runtime;
    // 防止把克莱妲的动作坐标应用到其它模型或皮肤。
    const manifest = r.v14dGameManifest?.model;
    const compatible = r.isKoledaModel && r.model?.geometry?.attributes?.position?.count === 60352
      && r.model?.skeleton?.bones?.length === 4868
      && (!manifest || manifest.sha256 === pair?.modelSha256);
    this.pair = pair && compatible ? pair : null;
    if (this.enabled) void this.load();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      if (this.mesh) this.mesh.visible = false;
      this.publish("hidden", "武器已隐藏");
    } else if (this.mesh) {
      this.sync();
      this.publish("ready", "配套武器已显示 · 握持待修");
    } else if (this.loading) this.publish("loading", "正在加载配套武器…");
    else void this.load();
  }

  async load() {
    if (!this.enabled || this.loading || this.mesh) return;
    const pair = this.pair;
    if (!pair) { this.publish("unavailable", "当前动作没有配套武器，请使用下方试播入口"); return; }
    const revision = this.revision;
    this.loading = true;
    this.publish("loading", "正在加载配套武器…");
    let mesh;
    try {
      // 人物加载器校验人物哈希并安装专用材质，武器必须使用独立加载器。
      const manager = new THREE.LoadingManager();
      manager.setURLModifier((url) => url.replaceAll("\\", "/"));
      const failures = [];
      manager.onError = (url) => failures.push(url);
      let texturesReady;
      const textures = new Promise((resolve) => { texturesReady = resolve; });
      manager.onLoad = () => texturesReady();
      const loader = new MMDLoader(manager);
      const absolute = (path) => resolveStageAssetUrl(path);
      mesh = await new Promise((resolve, reject) => loader.load(absolute(pair.weaponModel), resolve, undefined, reject));
      await textures;
      if (failures.length) throw new Error("武器贴图读取失败");
      if (revision !== this.revision || this.runtime.destroyed) { releaseMesh(mesh); return; }
      await applyKoledaWeaponMaterials(mesh, absolute(pair.weaponMaterialRoot || "/stage-assets/koleda-weapon-material/"), { partSpecific: Boolean(pair.weaponPartMaterials), renderer: this.runtime.renderer });
      if (revision !== this.revision || this.runtime.destroyed) { releaseMesh(mesh); return; }
      // PMX无形态键时，旧加载器仍留下position:[]。Three会据此启用形变着色，
      // 却因数量为0不生成所需常量，导致主体不可见；只移除确实为空的属性。
      for (const [name, targets] of Object.entries(mesh.geometry.morphAttributes)) {
        if (targets.length === 0) delete mesh.geometry.morphAttributes[name];
      }
      const clip = await new Promise((resolve, reject) => loader.loadAnimation(absolute(pair.weaponMotion), mesh, resolve, undefined, reject));
      enableVmdSubframeCurves(clip, { allBoneTracks: true });
      if (revision !== this.revision || this.runtime.destroyed) { releaseMesh(mesh); return; }
      mesh.name = "舞台配套武器";
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.mesh = mesh;
      this.mixer = new THREE.AnimationMixer(mesh);
      this.action = this.mixer.clipAction(clip);
      this.action.setLoop(THREE.LoopOnce, 1);
      this.action.clampWhenFinished = true;
      this.action.play();
      this.runtime.scene.add(mesh);
      this.sync();
      this.publish(this.enabled ? "ready" : "hidden", this.enabled ? "配套武器已显示 · 握持待修" : "武器已隐藏");
    } catch (error) {
      if (mesh && mesh !== this.mesh) releaseMesh(mesh);
      if (revision === this.revision && !this.runtime.destroyed) {
        this.publish(this.enabled ? "error" : "hidden", this.enabled ? "武器加载失败，可重试；人物继续播放" : "武器已隐藏");
        console.warn("[stage-weapon]", error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (revision === this.revision) this.loading = false;
    }
  }

  sync() {
    if (!this.mesh) return;
    const r = this.runtime;
    const active = this.enabled && this.pair && r.currentVmdAction && !r.isLoadingVmd;
    this.mesh.visible = Boolean(active);
    if (!active) return;
    // 两份PMX共用人物坐标，不能对枪另做包围盒缩放。
    this.mesh.position.copy(r.model.position);
    this.mesh.quaternion.copy(r.model.quaternion);
    this.mesh.scale.copy(r.model.scale);
    this.action.enabled = true;
    this.action.paused = false;
    this.action.time = Math.max(0, Math.min(r.currentVmdAction.time, this.action.getClip().duration));
    this.mixer.update(0);
    this.mesh.updateMatrixWorld(true);
    this.mesh.skeleton.update();
  }
}
