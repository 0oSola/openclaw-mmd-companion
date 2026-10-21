import assert from "node:assert/strict";
import test from "node:test";

import { createRezeVmdRequestGuard } from "../src/features/stage/rezeVmdRequestGuard.js";

test("较早完成的 reze VMD 加载不能覆盖最新预览请求", async () => {
  const guard = createRezeVmdRequestGuard();
  const completed = [];
  let finishInitial;
  let finishPreview;

  const initialLoad = new Promise((resolve) => {
    finishInitial = resolve;
  }).then(() => {
    if (guard.isCurrent(initialRequestId)) completed.push("initial-idle");
  });
  const initialRequestId = guard.begin();

  const previewLoad = new Promise((resolve) => {
    finishPreview = resolve;
  }).then(() => {
    if (guard.isCurrent(previewRequestId)) completed.push("preview");
  });
  const previewRequestId = guard.begin();

  finishPreview();
  await previewLoad;
  finishInitial();
  await initialLoad;

  assert.deepEqual(completed, ["preview"]);
});
