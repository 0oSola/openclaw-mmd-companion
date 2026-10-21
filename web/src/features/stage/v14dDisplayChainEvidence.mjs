function normalizedValue(value) {
  return value === undefined ? null : value;
}

function normalizedFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * 返回生产 draw-call 的可判别范围键。
 * materialName/groupId 由调用方在唯一匹配后再次核对，避免只靠范围顺序猜配。
 */
export function makeV14dDisplayChainDrawRangeKey(draw) {
  return JSON.stringify([
    normalizedValue(draw?.type),
    normalizedFiniteNumber(draw?.count),
    normalizedFiniteNumber(draw?.firstIndex),
  ]);
}

/**
 * 返回落盘审计用的完整 draw 身份键。
 * drawIndex 是生产源索引，drawOrder 是实际 command pass 中的出现顺序；两者
 * 都落盘并共同组成身份键，避免生产数组存在未发出的槽位时把两者误作同一字段。
 */
export function makeV14dDisplayChainDrawIdentityKey(draw) {
  return JSON.stringify([
    normalizedValue(draw?.materialName),
    normalizedValue(draw?.groupId),
    normalizedValue(draw?.type),
    normalizedFiniteNumber(draw?.count),
    normalizedFiniteNumber(draw?.firstIndex),
    normalizedFiniteNumber(draw?.drawIndex),
    normalizedFiniteNumber(draw?.drawOrder),
  ]);
}

/**
 * 用 type/count/firstIndex 在同一 instance/type 的生产 draw 列表中找候选。
 * 候选不是唯一时返回 ambiguous；没有候选时返回 unmatched，禁止顺序猜配。
 */
export function findV14dDisplayChainDrawMatch(draws, query) {
  const candidateIndices = [];
  for (let index = 0; index < (draws?.length ?? 0); index += 1) {
    const draw = draws[index];
    if (
      String(draw?.type) === String(query?.type)
      && Number(draw?.count) === Number(query?.count)
      && Number(draw?.firstIndex) === Number(query?.firstIndex)
    ) {
      candidateIndices.push(index);
    }
  }
  if (candidateIndices.length === 1) {
    return { status: "unique", candidateIndices, index: candidateIndices[0], draw: draws[candidateIndices[0]] };
  }
  return {
    status: candidateIndices.length === 0 ? "unmatched" : "ambiguous",
    candidateIndices,
    index: null,
    draw: null,
  };
}

function sameDrawIdentity(left, right) {
  return (
    normalizedValue(left?.materialName) === normalizedValue(right?.materialName)
    && normalizedValue(left?.groupId) === normalizedValue(right?.groupId)
    && String(left?.type) === String(right?.type)
    && Number(left?.count) === Number(right?.count)
    && Number(left?.firstIndex) === Number(right?.firstIndex)
  );
}

function expectedPipeline(draw) {
  return draw?.pipelineUsedByLookup ?? draw?.pipeline ?? null;
}

/**
 * 核对目标材质在生产源和实际 trace 中各自只有一个可判别身份，并且实际 draw
 * 使用了该槽的 compile/install pipeline、bind group 和生产 drawIndex/order。
 */
export function validateV14dDisplayChainDrawTrace(expectedDraws, observedDraws, targetNames = ["Brows", "Lashes"]) {
  const errors = [];
  const expected = Array.isArray(expectedDraws) ? expectedDraws : [];
  const observed = Array.isArray(observedDraws) ? observedDraws : [];

  const rangeBuckets = new Map();
  for (let index = 0; index < expected.length; index += 1) {
    const key = makeV14dDisplayChainDrawRangeKey(expected[index]);
    const bucket = rangeBuckets.get(key) ?? [];
    bucket.push(index);
    rangeBuckets.set(key, bucket);
  }
  for (const [key, indices] of rangeBuckets) {
    if (indices.length > 1) errors.push("ambiguous production draw range " + key + ": " + indices.join(","));
  }

  for (const name of targetNames) {
    const expectedMatches = expected.filter((draw) => draw?.materialName === name);
    if (expectedMatches.length !== 1) {
      errors.push(name + " expected unique match count=" + expectedMatches.length);
      continue;
    }
    const expectedDraw = expectedMatches[0];
    if (!Number.isInteger(expectedDraw.drawIndex) || expectedDraw.drawIndex < 0) {
      errors.push(name + " expected drawIndex is null or invalid");
    }
    const observedMatches = observed.filter((draw) => draw?.materialName === name);
    if (observedMatches.length !== 1) {
      errors.push(name + " observed unique match count=" + observedMatches.length);
      continue;
    }
    const observedDraw = observedMatches[0];
    if (observedDraw.matchStatus && observedDraw.matchStatus !== "unique") {
      errors.push(name + " observed match status=" + observedDraw.matchStatus);
    }
    if (!sameDrawIdentity(expectedDraw, observedDraw)) {
      errors.push(name + " observed material/group/range identity does not match production source");
    }
    if (expectedDraw.drawIndex !== observedDraw.drawIndex) {
      errors.push(name + " observed drawIndex " + observedDraw.drawIndex + " !== expected " + expectedDraw.drawIndex);
    }
    if (!Number.isInteger(observedDraw.drawOrder) || observedDraw.drawOrder < 0) {
      errors.push(name + " observed drawOrder is null or invalid");
    }
    if (expectedPipeline(expectedDraw) !== (observedDraw.pipeline ?? null)) {
      errors.push(name + " actual pipeline does not equal compile/install pipeline");
    }
    if (expectedDraw.bindGroup !== undefined && expectedDraw.bindGroup !== observedDraw.bindGroup) {
      errors.push(name + " actual bind group does not equal production bind group");
    }
    const expectedKey = makeV14dDisplayChainDrawIdentityKey({ ...expectedDraw, drawOrder: observedDraw.drawOrder });
    const observedKey = makeV14dDisplayChainDrawIdentityKey(observedDraw);
    if (expectedKey !== observedKey) errors.push(name + " draw identity key mismatch");
  }

  const expectedOrder = targetNames
    .map((name) => expected.find((draw) => draw?.materialName === name))
    .filter((draw) => draw && Number.isInteger(draw.drawIndex))
    .sort((left, right) => left.drawIndex - right.drawIndex)
    .map((draw) => draw.materialName);
  const observedOrder = targetNames
    .map((name) => observed.find((draw) => draw?.materialName === name))
    .filter((draw) => draw && Number.isInteger(draw.drawOrder))
    .sort((left, right) => left.drawOrder - right.drawOrder)
    .map((draw) => draw.materialName);
  if (JSON.stringify(expectedOrder) !== JSON.stringify(observedOrder)) {
    errors.push("target draw order changed: expected " + expectedOrder.join(",") + " observed " + observedOrder.join(","));
  }
  const observedOrderValues = observed
    .filter((draw) => targetNames.includes(draw?.materialName))
    .map((draw) => draw.drawOrder);
  if (new Set(observedOrderValues).size !== observedOrderValues.length) {
    errors.push("target draw order is not unique");
  }

  for (const draw of observed) {
    if (draw?.matchStatus && draw.matchStatus !== "unique") {
      errors.push("observed draw " + (draw.drawOrder ?? "?") + " has " + draw.matchStatus + " production match");
    }
  }

  return { ok: errors.length === 0, errors };
}
