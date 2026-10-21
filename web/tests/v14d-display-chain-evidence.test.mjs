import assert from "node:assert/strict";
import test from "node:test";

import {
  findV14dDisplayChainDrawMatch,
  validateV14dDisplayChainDrawTrace,
} from "../src/features/stage/v14dDisplayChainEvidence.mjs";

const expected = [
  {
    materialName: "Brows",
    groupId: "v14d-skin-variant-brows-lashes",
    type: "opaque",
    count: 312,
    firstIndex: 9330,
    drawIndex: 18,
    pipelineUsedByLookup: "gpu-1",
    bindGroup: "gpu-2",
  },
  {
    materialName: "Lashes",
    groupId: "v14d-skin-variant-brows-lashes",
    type: "opaque",
    count: 1866,
    firstIndex: 9642,
    drawIndex: 19,
    pipelineUsedByLookup: "gpu-1",
    bindGroup: "gpu-3",
  },
];

const observed = expected.map((draw) => ({
  ...draw,
  drawOrder: draw.drawIndex,
  pipeline: draw.pipelineUsedByLookup,
  matchStatus: "unique",
}));

test("valid Brows/Lashes draw identities pass", () => {
  assert.equal(validateV14dDisplayChainDrawTrace(expected, observed).ok, true);
});

test("duplicate draw range is rejected as ambiguous", () => {
  const duplicate = [...expected, { ...expected[0], drawIndex: 20 }];
  const match = findV14dDisplayChainDrawMatch(duplicate, { type: "opaque", count: 312, firstIndex: 9330 });
  assert.equal(match.status, "ambiguous");
  const result = validateV14dDisplayChainDrawTrace(duplicate, observed);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.includes("ambiguous production draw range")), true);
});

test("unmatched draw range is rejected", () => {
  const match = findV14dDisplayChainDrawMatch(expected, { type: "opaque", count: 312, firstIndex: 9331 });
  assert.equal(match.status, "unmatched");
  const wrongObserved = [{ ...observed[0], firstIndex: 9331 }, observed[1]];
  const result = validateV14dDisplayChainDrawTrace(expected, wrongObserved);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.includes("identity does not match")), true);
});
