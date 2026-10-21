import { AnimationMixer, REVISION } from 'three';

// Three r181每删除一条绑定都Object.keys扫描剩余字典，烘焙动作有上万条
// 轨道时成为平方级清理。仍由Three负责动作停用、引用计数和缓存回收，
// 仅在这一同步释放批次内把“根字典是否为空”的检查合并到批次结尾。
// 版本/实现不匹配时走原公开入口，不把内部布局假设用于未知版本。
export function withVmdBindingRelease(mixer, release) {
  if (REVISION !== '181' || mixer?._removeInactiveBinding !== AnimationMixer.prototype._removeInactiveBinding) return release();
  const roots = new Set();
  const hadOwn = Object.hasOwn(mixer, '_removeInactiveBinding');
  const original = mixer._removeInactiveBinding;
  mixer._removeInactiveBinding = function(binding) {
    const bindings = this._bindings;
    const rootUuid = binding.binding.rootNode.uuid;
    const last = bindings[bindings.length - 1];
    last._cacheIndex = binding._cacheIndex;
    bindings[binding._cacheIndex] = last;
    bindings.pop();
    delete this._bindingsByRootAndName[rootUuid][binding.binding.path];
    roots.add(rootUuid);
  };
  try {
    return release();
  } finally {
    for (const rootUuid of roots) {
      const entries = mixer._bindingsByRootAndName[rootUuid];
      if (entries && Object.keys(entries).length === 0) delete mixer._bindingsByRootAndName[rootUuid];
    }
    if (hadOwn) mixer._removeInactiveBinding = original;
    else delete mixer._removeInactiveBinding;
  }
}
