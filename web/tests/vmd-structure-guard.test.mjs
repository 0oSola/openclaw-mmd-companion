import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { inspectVmdStructure } from '../src/features/stage/vmdStructureGuard.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test('真实截断文件被判定为无效，并说明是哪一段越界', () => {
  // MMD/usage/vmd/_builtin/koleda_test.vmd 只有 169 字节，在 morph 段结束。
  // three-stdlib 的 parseVmd 解析它会抛 RangeError。
  const file = join(repoRoot, 'MMD', 'usage', 'vmd', '_builtin', 'koleda_test.vmd');
  if (!existsSync(file)) return; // 素材缺失时跳过，不谎称通过
  const result = inspectVmdStructure(toArrayBuffer(readFileSync(file)));
  assert.equal(result.ok, false);
  assert.match(result.reason, /overruns|no count/);
});

test('真实完整文件通过结构校验', () => {
  const file = join(repoRoot, 'MMD', 'usage', 'vmd', '_builtin', 'Koleda_专属查看_30fps.vmd');
  if (!existsSync(file)) return;
  const result = inspectVmdStructure(toArrayBuffer(readFileSync(file)));
  assert.equal(result.ok, true);
});

test('空文件与过小文件直接判无效', () => {
  assert.equal(inspectVmdStructure(new ArrayBuffer(0)).ok, false);
  assert.equal(inspectVmdStructure(new ArrayBuffer(40)).ok, false);
});

test('魔数不对的文件被判无效', () => {
  const buffer = new ArrayBuffer(64);
  const bytes = new Uint8Array(buffer);
  bytes.set(new TextEncoder().encode('Not a VMD file at all'), 0);
  const result = inspectVmdStructure(buffer);
  assert.equal(result.ok, false);
  assert.match(result.reason, /bad magic/);
});

test('UTF-16LE 编码的 VMD 被判无效而不是崩溃', () => {
  // api/data/storage/vmd/sola/thinking 下有两个 UTF-16LE 写法的 VMD，
  // 每个字符后跟 00，魔数不匹配。
  const buffer = new ArrayBuffer(64);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < 20; i++) bytes[i * 2] = 'Vocaloid Motion Data'.charCodeAt(i) || 0;
  const result = inspectVmdStructure(buffer);
  assert.equal(result.ok, false);
});

test('只有头部、声明数量巨大的文件被判越界', () => {
  const buffer = new ArrayBuffer(54);
  const bytes = new Uint8Array(buffer);
  bytes.set(new TextEncoder().encode('Vocaloid Motion Data 0002'), 0);
  new DataView(buffer).setUint32(50, 0xffffffff, true);
  const result = inspectVmdStructure(buffer);
  assert.equal(result.ok, false);
  assert.match(result.reason, /overruns/);
});
