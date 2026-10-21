// Three r181的compileAsync只等待每个材质的currentProgram；透明双面等材质
// 可能生成多个变体。等待本渲染器的全部程序后再读取uniform，避免首绘同步等待。
export async function prepareStagePrograms(renderer, compile, signal) {
  signal?.throwIfAborted();
  compile();
  const programs = [...renderer.info.programs];
  while (programs.some(program => !program.isReady())) {
    await new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, 10);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { signal.removeEventListener('abort', abort); abort(); }
    });
    signal?.throwIfAborted();
  }
  signal?.throwIfAborted();
  for (const program of programs) {
    program.getUniforms();
    if (program.diagnostics?.runnable === false) throw new Error('角色着色器编译失败，无法完成显示准备。');
  }
}

export async function prepareStageTextures(renderer, scene, extraTextures = [], signal) {
  const textures = new Set();
  const add = value => {
    if (value?.isTexture && !value.isRenderTargetTexture) textures.add(value);
    else if (Array.isArray(value)) value.forEach(add);
  };
  scene.traverse(object => {
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      Object.values(material).forEach(add);
      for (const uniform of Object.values(renderer.properties.get(material).uniforms || {})) add(uniform.value);
    }
  });
  extraTextures.forEach(add);
  for (const texture of textures) {
    signal?.throwIfAborted();
    // 保留原图与采样质量，只把首次绘制的一批上传分散到不同事件循环。
    await new Promise((resolve, reject) => {
      let frame = 0, afterPaint = 0, done = false;
      const finish = error => {
        if (done) return;
        done = true; clearTimeout(fallback); clearTimeout(afterPaint);
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
        signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve();
      };
      const abort = () => finish(signal.reason);
      // 排队后页面可能隐藏，不能无限等待停止投递的rAF。
      const fallback = setTimeout(() => finish(), 100);
      signal?.addEventListener('abort', abort, { once: true });
      if (typeof requestAnimationFrame === 'function' && !globalThis.document?.hidden) {
        frame = requestAnimationFrame(() => { afterPaint = setTimeout(() => finish(), 0); });
      } else afterPaint = setTimeout(() => finish(), 0);
      if (signal?.aborted) abort();
    });
    signal?.throwIfAborted();
    renderer.initTexture(texture);
  }
}
