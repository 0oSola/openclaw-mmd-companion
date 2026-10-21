import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateG7WeightEvidence, calibrateG7Noise, evaluateG7Movement, validateG7Source } from '../src/features/stage/v14dG7WeightEvidence.js';
const state = (label, value) => ({ label, captureId: label + '-1', frame: 120, source: 'production-gpu-buffer-readback', sourceCaptureId: label + '-1', sourceFrame: 120, bufferIdentity: true, dispatchPending: false, requested: { blink: value }, runtime: { blink: value }, effective: { blink: value }, gpu: { blink: value } });
const stats = (maxDelta) => ({ valid: true, maxDelta, rmsDelta: maxDelta, movedVertexCount: maxDelta > 0.0001 ? 506 : 0, vertexCount: 506 });
test('负测不能自扩健康噪声：大幅错误位移、缺样本和NaN均不算预期拒绝', () => {
  const noise = calibrateG7Noise({ Brows: stats(0), Lashes: stats(0) });
  const evaluate = (delta, valid=true) => evaluateG7Movement({ Brows: stats(0), Lashes: delta }, ['Lashes'], noise, valid);
  assert.equal(noise.Lashes, 0.0001);
  assert.equal(evaluate(stats(0)).expectedRejected, true);
  assert.equal(evaluate(stats(100)).expectedRejected, false);
  assert.equal(evaluate(stats(100)).ok, true);
  assert.equal(noise.Lashes, 0.0001);
  assert.equal(evaluate({ ...stats(0), vertexCount: 0 }).expectedRejected, false);
  assert.equal(evaluate(stats(NaN)).expectedRejected, false);
  assert.equal(evaluate(stats(0), false).expectedRejected, false);
});
test('每态权重证据接受真实独立来源；错绑 open/closed 与 CPU/GPU 不一致均拒绝', () => {
  const open = state('open', 0), closed = state('closed', 1);
  assert.equal(evaluateG7WeightEvidence(open, 'open', { blink: 0 }).ok, true);
  assert.equal(evaluateG7WeightEvidence(closed, 'open', { blink: 0 }).ok, false);
  assert.equal(evaluateG7WeightEvidence({ ...open, gpu: { blink: 1 } }, 'open', { blink: 0 }).ok, false);
  assert.equal(evaluateG7WeightEvidence({ ...open, sourceCaptureId: closed.captureId }, 'open', { blink: 0 }).ok, false);
  assert.equal(evaluateG7WeightEvidence({ ...open, source: 'cpu-effective' }, 'open', { blink: 0 }).ok, false);
});
test('无隔离控制只允许请求0被生产更新覆写为1，不接受缺失GPU读回', () => {
  const control = { ...state('noIsoOpen', 1), requested: { blink: 0 } };
  assert.equal(evaluateG7WeightEvidence(control, 'noIsoOpen', { blink: 0 }, { blink: 1 }).ok, true);
  assert.equal(evaluateG7WeightEvidence({ ...control, gpu: {} }, 'noIsoOpen', { blink: 0 }, { blink: 1 }).ok, false);
});
test('生产源审计拒绝来源字符串、跨帧与坏读回', () => {
  const finite = { valueCount: 3, finiteValueCount: 3, nanCount: 0, infCount: 0 };
  const source = { source:'reze-engine-production-draw-call', captureId:'a', frame:120, instances:[{
    name:'companion', transforms:{morphMode:'gpu-compute-in-place',morphDispatchPending:false,morphWeightsReadback:true},
    bufferIdentity:{vertex:true,index:true,morphWeights:true}, buffers:{vertex:finite,index:finite,morphWeights:finite},
    indexIntegrity:{allDrawRangesInBounds:true,referencedVertexIndicesInBounds:true},
    drawCalls:['Brows','Lashes'].map(materialName=>({materialName,count:3,rangeMatchesPick:true,mainBindGroupMatchesEngine:true,pickBindGroupMatchesEngine:true})),
  }] };
  assert.equal(validateG7Source(source,'a',120),true);
  assert.equal(validateG7Source(source.source,'a',120),false);
  assert.equal(validateG7Source(source,'b',120),false);
  assert.equal(validateG7Source(source,'a',119),false);
  const bad = structuredClone(source); bad.instances[0].buffers.morphWeights.nanCount=1;
  assert.equal(validateG7Source(bad,'a',120),false);
});
