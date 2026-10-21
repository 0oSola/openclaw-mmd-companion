// 每项重准备使用短生命周期工作线程；成功、失败、取消都会终止，避免大模型
// 解析对象驻留在后台。只转移调用方已校验/识别过的字节，不由线程另行请求资源。
export class MmdPreparation {
  constructor() { this.jobs = new Set(); }
  get available() { return typeof Worker !== 'undefined'; }
  run(type, payload) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./mmdPreparation.worker.js', import.meta.url), { type: 'module' });
      const finish = (error, result) => {
        clearTimeout(timer); worker.terminate(); this.jobs.delete(cancel);
        if (error) reject(error); else resolve(result);
      };
      const cancel = () => finish(new DOMException('模型准备已取消。', 'AbortError'));
      const timer = setTimeout(() => finish(new Error('模型或动作准备超时。')), 60000);
      this.jobs.add(cancel);
      worker.onmessage = event => finish(event.data.error ? new Error(event.data.error) : null, event.data.result);
      worker.onerror = event => { event.preventDefault(); finish(new Error(event.message || '模型准备线程启动失败。')); };
      worker.onmessageerror = () => finish(new Error('模型准备结果无法读取。'));
      try { worker.postMessage({ type, payload }, [payload.buffer]); } catch (error) { finish(error); }
    });
  }
  dispose() { for (const cancel of this.jobs) cancel(); this.jobs.clear(); }
}
