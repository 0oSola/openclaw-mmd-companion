import test from "node:test";
import assert from "node:assert/strict";
import { captureApiRoute } from "../scripts/v14d-capture-api-origin.mjs";
for (const port of [8000, 8100]) {
  test(`只匹配配置后端 ${port}，不接管其他来源`, () => {
    const route = captureApiRoute(`http://127.0.0.1:${port}`);
    assert.equal(route.matches(new URL(`http://127.0.0.1:${port}/assets/mmd/models/a.pmx`)), true);
    for (const other of [port === 8000 ? 8100 : 8000, 3100])
      assert.equal(route.matches(new URL(`http://127.0.0.1:${other}/assets/mmd/models/a.pmx`)), false);
    assert.equal(route.matches(new URL(`http://localhost:${port}/a`)), false);
    assert.equal(route.matches(new URL(`https://127.0.0.1:${port}/a`)), false);
  });
}
test("默认兼容8000；拒绝路径、凭据和非HTTP配置", () => {
  assert.equal(captureApiRoute().origin, "http://127.0.0.1:8000");
  for (const bad of ["http://127.0.0.1:8100/api", "http://u:p@127.0.0.1:8100", "file:///tmp", "http://127.0.0.1:8100/?q=1"])
    assert.throws(() => captureApiRoute(bad));
});
