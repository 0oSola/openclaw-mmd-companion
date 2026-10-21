/** G7 每态证据判定：请求、CPU 观测与 GPU 缓冲读回分开，禁止互相冒充。 */
export function evaluateG7WeightEvidence(e, label, requested, observed = requested) {
  const reasons = [];
  const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-6;
  if (!e || e.label !== label) reasons.push('state-label-mismatch');
  if (!e?.captureId || e.frame !== 120 || e.sourceCaptureId !== e.captureId || e.sourceFrame !== e.frame) reasons.push('capture-source-mismatch');
  if (e?.source !== 'production-gpu-buffer-readback' || e.bufferIdentity !== true || e.dispatchPending !== false) reasons.push('gpu-source-invalid');
  for (const name of Object.keys(requested)) {
    if (!near(e?.requested?.[name], requested[name])) reasons.push(name + ':request-mismatch');
    for (const field of ['runtime', 'effective', 'gpu']) {
      if (!near(e?.[field]?.[name], observed[name])) reasons.push(name + ':' + field + '-mismatch');
    }
  }
  return { ok: reasons.length === 0, reasons };
}

const validStats = s => s?.valid === true && s.vertexCount > 0 && Number.isFinite(s.maxDelta) && Number.isFinite(s.rmsDelta) && Number.isInteger(s.movedVertexCount);
export function calibrateG7Noise(healthyRepeat) {
  if (!['Brows','Lashes'].every(n => validStats(healthyRepeat[n]))) throw new Error('healthy-repeat-invalid');
  return Object.freeze(Object.fromEntries(Object.entries(healthyRepeat).map(([n,s])=>[n,s.maxDelta + 1e-4])));
}
export function evaluateG7Movement(delta, affected, noise, evidenceValid) {
  const names = ['Brows','Lashes'];
  const valid = evidenceValid === true && affected.length > 0 && names.every(n => validStats(delta[n]) && Number.isFinite(noise[n]));
  const ok = valid && names.every(n => affected.includes(n) ? delta[n].movedVertexCount > 0 && delta[n].maxDelta > noise[n] : delta[n].maxDelta <= noise[n]);
  return { valid, ok, expectedRejected: valid && !ok && names.every(n => delta[n].maxDelta <= noise[n]) };
}

/** 校验现有生产快照，不以非空对象或来源字符串代替成功读回。 */
export function validateG7Source(audit, captureId, frame) {
  const i = audit?.instances?.find(x => x.name === 'companion');
  const finite = b => b?.valueCount > 0 && b.finiteValueCount === b.valueCount && b.nanCount === 0 && b.infCount === 0;
  return !!(audit?.source === 'reze-engine-production-draw-call' && audit.captureId === captureId && audit.frame === frame && frame === 120
    && i?.transforms?.morphMode === 'gpu-compute-in-place' && i.transforms.morphDispatchPending === false && i.transforms.morphWeightsReadback === true
    && ['vertex','index','morphWeights'].every(n => i.bufferIdentity?.[n] === true && finite(i.buffers?.[n]))
    && i.indexIntegrity?.allDrawRangesInBounds === true && i.indexIntegrity.referencedVertexIndicesInBounds === true
    && ['Brows','Lashes'].every(n => i.drawCalls?.some(d => d.materialName === n && d.count > 0 && d.rangeMatchesPick === true && d.mainBindGroupMatchesEngine === true && d.pickBindGroupMatchesEngine === true)));
}
