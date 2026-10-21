import { expect, test } from "@playwright/test";

test("companion stage loads model assets without MMD request failures @critical", async ({
  page,
}, testInfo) => {
  const consoleMessages: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on("console", (msg) => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    if (url.includes("/assets/mmd/")) {
      const failure = request.failure();
      failedRequests.push(`${request.method()} ${url} :: ${failure?.errorText || "request failed"}`);
    }
  });

  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("/assets/mmd/") && response.status() >= 400) {
      failedRequests.push(`${response.request().method()} ${url} :: HTTP ${response.status()}`);
    }
  });

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "mmd_companion_session_v1",
      JSON.stringify({ userId: "playwright-user", renderPipeline: "classic" }),
    );
  });

  await page.goto("/companion");

  // The stage wrapper div exists with testid
  const stageWrap = page.getByTestId("mio-stage-wrap");
  await expect(stageWrap).toBeVisible();

  // The model switch is a <select> with aria-label "模型切换"
  const modelSelect = page.getByLabel("模型切换");
  await expect(modelSelect).toBeVisible();

  // Wait for the MMD stage status to show model loading result
  // The status is in a <p> with class mio-stage-status
  const status = page.locator(".mio-stage-status").first();

  // Wait for model to be ready or fail (timeout 60s for large PMX models)
  await expect(status).toContainText(/Model ready|Model load failed|Initializing/, { timeout: 60_000 });

  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();

  // The render pipeline options are in a radiogroup with aria-label "渲染模式"
  const pipelineGroup = page.getByRole("radiogroup", { name: "渲染模式" });
  await expect(pipelineGroup).toBeVisible();

  // Switch to genshin pipeline
  const genshinRadio = pipelineGroup.getByRole("radio").filter({ hasText: /Genshin/i }).first();
  if (await genshinRadio.isVisible().catch(() => false)) {
    await genshinRadio.click();
    await expect.poll(
      () =>
        page.evaluate(() =>
          JSON.parse(window.localStorage.getItem("mmd_companion_session_v1") || "{}").renderPipeline,
        ),
    ).toBe("genshin");
    await expect(status).toContainText(/Loading MMD model|Model ready|Initializing/, { timeout: 60_000 });
    await expect(canvas).toBeVisible();
  }

  await page.waitForTimeout(1500);

  await testInfo.attach("stage-status", {
    body: (await status.textContent()) ?? "",
    contentType: "text/plain",
  });
  await testInfo.attach("console-log", {
    body: consoleMessages.join("\n"),
    contentType: "text/plain",
  });
  await testInfo.attach("console-errors", {
    body: consoleErrors.join("\n"),
    contentType: "text/plain",
  });
  await testInfo.attach("page-errors", {
    body: pageErrors.join("\n"),
    contentType: "text/plain",
  });
  await testInfo.attach("mmd-failed-requests", {
    body: failedRequests.join("\n"),
    contentType: "text/plain",
  });
  await testInfo.attach("stage-screenshot", {
    body: await canvas.screenshot(),
    contentType: "image/png",
  });

  expect(consoleErrors, `Console errors:\n${consoleErrors.join("\n")}`).toHaveLength(0);
  expect(pageErrors, `Page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
  expect(failedRequests, `MMD request failures:\n${failedRequests.join("\n")}`).toHaveLength(0);
  await expect(status).toContainText("Model ready");
});
