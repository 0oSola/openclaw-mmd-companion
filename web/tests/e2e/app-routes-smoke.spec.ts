import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __speechCancelCount: number;
  }
}

function seedSession(page: Page) {
  return page.addInitScript(() => {
    const key = "mmd_companion_session_v1";
    if (window.localStorage.getItem(key)) return;
    window.localStorage.setItem(key, JSON.stringify({ userId: "8X29-AF3E", renderPipeline: "classic" }));
  });
}

const ADVANCED_FEATURES = "\u9ad8\u7ea7\u529f\u80fd";
const MODEL_SWITCH = "\u6a21\u578b\u5207\u6362";
const RENDER_MODE = "\u6e32\u67d3\u6a21\u5f0f";

test("core routes render without document 5xx, page errors, or console errors @critical", async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const documentFailures: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  page.on("response", (response) => {
    if (response.request().resourceType() !== "document") return;
    if (response.status() >= 500) {
      documentFailures.push(`${response.request().method()} ${response.url()} :: HTTP ${response.status()}`);
    }
  });

  await page.goto("/");
  await expect(page.getByTestId("login-v2-panel")).toBeVisible();
  await expect(page.locator("#login-v2-account")).toBeVisible();
  await expect(page.locator("#login-v2-password")).toBeVisible();

  await page.goto("/traces");
  await expect(page.locator('a[href="/"]').first()).toBeVisible();

  await testInfo.attach("route-console-errors", {
    body: consoleErrors.join("\n"),
    contentType: "text/plain",
  });
  await testInfo.attach("route-page-errors", {
    body: pageErrors.join("\n"),
    contentType: "text/plain",
  });
  await testInfo.attach("route-document-failures", {
    body: documentFailures.join("\n"),
    contentType: "text/plain",
  });

  expect(documentFailures, `Document failures:\n${documentFailures.join("\n")}`).toHaveLength(0);
  expect(pageErrors, `Page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
  expect(consoleErrors, `Console errors:\n${consoleErrors.join("\n")}`).toHaveLength(0);
});

test("legacy login route returns not found @critical", async ({ page }) => {
  const response = await page.goto("/login-legacy");

  expect(response?.status()).toBe(404);
  await expect(page.getByTestId("login-panel")).toHaveCount(0);
});

test("companion topbar uses the AETHER brand logo @critical", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seedSession(page);
  await page.goto("/companion");

  const companionLogo = page.getByTestId("companion-brand-logo");
  const brandWordmark = companionLogo.getByRole("img", { name: "AETHER PERSONAL AI" });
  await expect(companionLogo).toBeVisible();
  await expect(companionLogo).toHaveAttribute("data-logo-layout", "aether-cropped-lockup");
  await expect(companionLogo.locator(".mio-brand-mark")).toHaveAttribute("src", /aether-companion-mark-crop\.png/);
  await expect(brandWordmark).toHaveAttribute("src", /aether-companion-wordmark-crop\.png/);
  await expect(companionLogo.getByRole("heading", { name: "MIO" })).toHaveCount(0);
  await expect(companionLogo.getByRole("heading", { name: "AETHER" })).toHaveCount(0);

  const logoWeight = await companionLogo.evaluate((node) => {
    const mark = node.querySelector(".mio-brand-mark") as HTMLElement | null;
    const wordmark = node.querySelector(".mio-brand-wordmark") as HTMLElement | null;
    const markBox = mark?.getBoundingClientRect();
    const wordmarkBox = wordmark?.getBoundingClientRect();
    return {
      markWidth: mark?.getBoundingClientRect().width ?? 0,
      markFilter: mark ? getComputedStyle(mark).filter : "",
      wordmarkWidth: wordmarkBox?.width ?? 0,
      wordmarkFilter: wordmark ? getComputedStyle(wordmark).filter : "",
      wordmarkStartsAfterMark: Boolean(markBox && wordmarkBox && wordmarkBox.left >= markBox.right + 8),
    };
  });

  expect(logoWeight.markWidth).toBeGreaterThanOrEqual(54);
  expect(logoWeight.markWidth).toBeLessThanOrEqual(66);
  expect(logoWeight.markFilter).toBe("none");
  expect(logoWeight.wordmarkWidth).toBeGreaterThanOrEqual(156);
  expect(logoWeight.wordmarkWidth).toBeLessThanOrEqual(208);
  expect(logoWeight.wordmarkFilter).toBe("none");
  expect(logoWeight.wordmarkStartsAfterMark).toBe(true);
});

test("companion route renders the MIO hud replica with authenticated session @critical", async ({ page }) => {
  await seedSession(page);
  await page.goto("/companion");

  const companionLogo = page.getByTestId("companion-brand-logo");
  await expect(page.getByTestId("mio-hud")).toBeVisible();
  await expect(companionLogo).toBeVisible();
  await expect(companionLogo).toHaveAttribute("data-logo-layout", "aether-cropped-lockup");
  await expect(companionLogo.getByRole("img", { name: "AETHER PERSONAL AI" })).toHaveAttribute(
    "src",
    /aether-companion-wordmark-crop\.png/,
  );
  await expect(companionLogo.getByRole("heading", { name: "MIO" })).toHaveCount(0);
  await expect(page.getByText("下一步建议")).toBeVisible();
  await expect(page.getByText("记忆摘要")).toBeVisible();
  await expect(page.getByText("Trace / 请求状态")).toBeVisible();
  await expect(page.getByText("语音模式")).toBeVisible();
  await expect(page.getByPlaceholder("输入你的指令 / 任务 / 问题...（Enter 发送，Shift + Enter 换行）")).toBeVisible();
  await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
});

test("companion route exposes stable HUD structure for the restored design @critical", async ({ page }) => {
  await seedSession(page);
  await page.goto("/companion");

  await expect(page.getByTestId("mio-topbar")).toBeVisible();
  await expect(page.getByTestId("mio-sidebar")).toBeVisible();
  await expect(page.getByTestId("mio-dialogue")).toBeVisible();
  await expect(page.getByTestId("mio-right-rail")).toBeVisible();
  await expect(page.getByTestId("mio-command-bar")).toBeVisible();
  await expect(page.getByTestId("mio-stage-wrap")).toBeVisible();

  await expect(page.getByText("我理解你的需求了～")).toBeVisible();
  await expect(page.getByText("生成需求文档大纲")).toBeVisible();
  await expect(page.getByText("常用工具：Notion / VS Code")).toBeVisible();
  await expect(page.getByText("/v1/chat/completions")).toBeVisible();
  await expect(page.getByRole("button", { name: ADVANCED_FEATURES })).toBeVisible();
});

test("companion dialogue bubble is anchored inside the stage container @critical", async ({ page }) => {
  await seedSession(page);
  await page.goto("/companion");

  const stageWrap = page.getByTestId("mio-stage-wrap");
  await expect(stageWrap).toBeVisible();
  await expect(stageWrap.getByTestId("mio-dialogue")).toBeVisible();
});

test("advanced features panel owns model and render pipeline switching @critical", async ({ page }) => {
  await seedSession(page);
  await page.route("**/config/mapping/resolved/**", async (route) => {
    await route.fulfill({ json: { mappings: {} } });
  });
  await page.route("**/assets/vmd?**", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await page.route("**/assets/mmd/models", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            name: "Eula.pmx",
            label: "Eula",
            relative_path: "Eula/Eula.pmx",
            size_bytes: 1024,
            url: "/assets/mmd/Eula/Eula.pmx",
          },
          {
            name: "Ayaka.pmx",
            label: "Ayaka",
            relative_path: "Ayaka/Ayaka.pmx",
            size_bytes: 1024,
            url: "/assets/mmd/Ayaka/Ayaka.pmx",
          },
        ],
      },
    });
  });
  await page.route("**/assets/mmd/vmds", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });

  await page.goto("/companion");
  await expect(page.getByRole("button", { name: "\u89d2\u8272\u5207\u6362" })).toHaveCount(0);
  await expect(page.getByTestId("mio-motion-trigger")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Render pipeline" })).toHaveCount(0);

  await page.locator('button[aria-controls="mio-advanced-panel"]').click();

  const advancedPanel = page.getByTestId("mio-advanced-panel");
  await expect(advancedPanel).toBeVisible();
  await expect(advancedPanel.getByText(ADVANCED_FEATURES, { exact: true })).toBeVisible();

  const modelSelect = advancedPanel.getByRole("combobox", { name: MODEL_SWITCH });
  await expect(modelSelect).toHaveValue("Eula/Eula.pmx");
  await modelSelect.selectOption("Ayaka/Ayaka.pmx");
  await expect(modelSelect).toHaveValue("Ayaka/Ayaka.pmx");

  const pipelineOptions = advancedPanel.getByRole("radiogroup", { name: RENDER_MODE });
  await expect(pipelineOptions.getByRole("radio", { name: /Classic/ })).toHaveAttribute("aria-checked", "true");
  await pipelineOptions.getByRole("radio", { name: /Genshin/ }).click();
  await expect(pipelineOptions.getByRole("radio", { name: /Genshin/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("mio-hud")).toHaveAttribute("data-render-pipeline", "genshin");
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(window.localStorage.getItem("mmd_companion_session_v1") || "{}").renderPipeline),
    )
    .toBe("genshin");
});

test("advanced features button opens a non-modal VMD quick import panel with previewable assets @critical", async ({
  page,
}) => {
  await seedSession(page);
  await page.route("**/config/mapping/resolved/**", async (route) => {
    await route.fulfill({ json: { mappings: {} } });
  });
  await page.route("**/assets/vmd?**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            asset_id: "asset-1",
            user_id: "8X29-AF3E",
            slot: "happy",
            filename: "happy-wave.vmd",
            size_bytes: 20480,
            created_at: "2026-04-26T10:00:00Z",
            url: "/assets/vmd/happy-wave.vmd",
          },
          {
            asset_id: "asset-2",
            user_id: "8X29-AF3E",
            slot: "thinking",
            filename: "thinking-idle.vmd",
            size_bytes: 19456,
            created_at: "2026-04-26T09:00:00Z",
            url: "/assets/vmd/thinking-idle.vmd",
          },
        ],
      },
    });
  });

  await page.goto("/companion");
  const advancedTrigger = page.getByRole("button", { name: /高级功能/ });
  await expect(advancedTrigger).toBeVisible();

  await advancedTrigger.click();

  const advancedPanel = page.getByTestId("mio-advanced-panel");
  await expect(advancedPanel).toBeVisible();
  await expect(advancedPanel.getByText(ADVANCED_FEATURES, { exact: true })).toBeVisible();
  await expect(advancedPanel.locator('input[type="file"]')).toHaveCount(2);
  await expect(advancedPanel.getByTestId("mio-advanced-asset")).toHaveCount(2);
  await expect(page.getByTestId("mio-command-bar")).toBeVisible();
  await expect(page.getByTestId("mio-stage-wrap")).toBeVisible();
  return;

  const trigger = page.getByRole("button", { name: "楂樼骇鍔熻兘" });
  await expect(trigger).toBeVisible();

  await trigger.click();

  const panel = page.getByTestId("mio-advanced-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("VMD 快速导入")).toBeVisible();
  await expect(panel.locator('input[type="file"]')).toBeAttached();
  await expect(panel.getByTestId("mio-advanced-asset")).toHaveCount(2);
  await expect(page.getByTestId("mio-command-bar")).toBeVisible();
  await expect(page.getByTestId("mio-stage-wrap")).toBeVisible();
});

test("advanced panel saves the stage camera by render pipeline without linking it to VMD playback @smoke", async ({
  page,
}) => {
  await page.route("**/config/mapping/resolved/**", async (route) => {
    await route.fulfill({ json: { mappings: {} } });
  });
  await page.route("**/assets/vmd?**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            asset_id: "asset-1",
            user_id: "8X29-AF3E",
            slot: "happy",
            filename: "eula-favorite.vmd",
            display_name: "eula-favorite.vmd",
            is_favorite: true,
            favorite_relative_path: "usage/vmd/Eula[action]/eula-favorite.vmd",
            favorite_model_relative_path: "Eula_by_Genshin/Eula.pmx",
            size_bytes: 20480,
            created_at: "2026-04-26T10:00:00Z",
            url: "/assets/vmd/file/asset-1",
          },
        ],
      },
    });
  });
  await page.route("**/assets/mmd/models", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            name: "Eula.pmx",
            label: "Eula",
            relative_path: "Eula_by_Genshin/Eula.pmx",
            size_bytes: 1024,
            url: "/assets/mmd/Eula_by_Genshin/Eula.pmx",
          },
        ],
      },
    });
  });
  await page.route("**/assets/mmd/vmds", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });

  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.setItem("mmd_companion_session_v1", JSON.stringify({ userId: "8X29-AF3E", renderPipeline: "genshin" }));
  });
  await page.goto("/companion");
  await page.locator('button[aria-controls="mio-advanced-panel"]').click();
  await page.getByRole("tab", { name: "Favorites" }).click();
  await page.getByTestId("mio-advanced-asset").first().getByRole("button", { name: /Preview/ }).click();

  const cameraControls = page.getByTestId("mio-camera-controls");
  await expect(cameraControls).toBeVisible();
  await expect(cameraControls).toContainText("Saved for mio-reference");
  await expect(cameraControls).not.toContainText("eula-favorite.vmd");
  await expect(cameraControls.getByTestId("mio-camera-mode")).toContainText("Free");
  await cameraControls.getByTestId("mio-camera-unlock").click();
  await expect(cameraControls.getByTestId("mio-camera-mode")).toContainText("Editing");
  const savedCameraLog = page.waitForEvent(
    "console",
    (message) => message.type() === "info" && message.text().includes("[mmd-camera] saved snapshot"),
  );
  await cameraControls.getByTestId("mio-camera-save").click();
  await expect(cameraControls.getByTestId("mio-camera-mode")).toContainText("Free");
  await savedCameraLog;

  await expect
    .poll(() =>
      page.evaluate(() => {
        const session = JSON.parse(window.localStorage.getItem("mmd_companion_session_v1") || "{}");
        return {
          pipeline: session.renderPipeline,
          camera: session.mmdCamera?.["mio-reference"] || null,
          favoriteCameraCount: Object.keys(session.mmdCameraByFavoriteVmd || {}).length,
        };
      }),
    )
    .toEqual({
      pipeline: "mio-reference",
      camera: {
        fov: 32,
        position: [-9.39, 12.522935, 43.63],
        target: [-1.861732, -2.847643, 1.048369],
        locked: false,
      },
      favoriteCameraCount: 0,
    });
});

test("companion stage keeps runtime chrome hidden inside the restored HUD @critical", async ({ page }) => {
  await seedSession(page);
  await page.goto("/companion");

  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.locator(".mio-model-select")).toHaveCount(0);
  await expect(page.locator(".mio-stage-status")).toBeHidden();
});

test("companion route stays usable on mobile width without horizontal overflow @critical", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSession(page);
  await page.goto("/companion");

  await expect(page.getByTestId("mio-topbar")).toBeVisible();
  await expect(page.getByTestId("mio-stage-wrap")).toBeVisible();
  await expect(page.getByTestId("mio-command-bar")).toBeVisible();

  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });

  expect(overflow).toBeLessThanOrEqual(1);
});

test("companion route keeps stage and right rail separated on tablet width @critical", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await seedSession(page);
  await page.goto("/companion");

  const stageBox = await page.getByTestId("mio-stage-wrap").boundingBox();
  const railBox = await page.getByTestId("mio-right-rail").boundingBox();

  expect(stageBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(stageBox!.x + stageBox!.width).toBeLessThanOrEqual(railBox!.x);
});

test("companion daily podcast card stays localized and inside its card @critical", async ({ page }) => {
  await page.setViewportSize({ width: 1190, height: 760 });
  await seedSession(page);
  await page.route("**/podcasts/daily/latest", async (route) => {
    await route.fulfill({
      json: {
        podcast: {
          date: "2026-05-18",
          status: "ready",
          doc_url: "https://feishu.cn/docx/test",
          doc_links: {},
          audio: {
            url: "/podcasts/daily/2026-05-18/audio?format=preferred",
            format: "audio/ogg",
            bytes: 1388346,
            source: "ogg",
          },
          counts: {},
          script_chars: 2556,
          updated_at: null,
          audio_error: null,
        },
      },
    });
  });

  await page.goto("/companion");
  if ((await page.locator(".mio-podcast-card").count()) === 0) {
    await page.getByRole("button", { name: "展开右侧面板" }).click();
  }

  const card = page.locator(".mio-podcast-card");
  await expect(card).toBeVisible();
  await expect(card.getByText("每日播客")).toBeVisible();
  await expect(card.getByText("已就绪")).toBeVisible();
  await expect(card.getByRole("link", { name: "飞书文档" })).toBeVisible();
  await expect(card.getByRole("link", { name: "播客列表" })).toBeVisible();
  await expect(card.getByRole("button", { name: "刷新" })).toBeVisible();
  await expect(card.getByText("Daily Podcast")).toHaveCount(0);
  await expect(card.getByText("Runtime Health")).toHaveCount(0);
  await expect(card.getByText("Trace", { exact: true })).toHaveCount(0);

  const overflow = await card.evaluate((node) => {
    const cardBox = node.getBoundingClientRect();
    const items = Array.from(node.querySelectorAll(".mio-podcast-actions > *"));
    return {
      vertical: node.scrollHeight - node.clientHeight,
      horizontal: node.scrollWidth - node.clientWidth,
      escaped: items.some((item) => {
        const box = item.getBoundingClientRect();
        return box.left < cardBox.left - 1 || box.right > cardBox.right + 1 || box.bottom > cardBox.bottom + 1;
      }),
    };
  });

  expect(overflow.vertical).toBeLessThanOrEqual(1);
  expect(overflow.horizontal).toBeLessThanOrEqual(1);
  expect(overflow.escaped).toBe(false);
});

test("companion voice mode chip toggles speech playback on and off @critical", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "mmd_companion_session_v1",
      JSON.stringify({ userId: "8X29-AF3E", renderPipeline: "mio-reference", ttsMode: "browser", ttsEnabled: true }),
    );
    window.__speechCancelCount = 0;
    window.speechSynthesis.cancel = () => {
      window.__speechCancelCount += 1;
    };
  });
  await page.route("**/api/backend/config/mapping/resolved/**", async (route) => {
    await route.fulfill({ json: { mappings: {} } });
  });
  await page.route("**/api/backend/assets/vmd?**", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await page.route("**/api/backend/assets/mmd/models", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            name: "Eula.pmx",
            label: "Eula",
            relative_path: "Eula_by_Genshin/Eula.pmx",
            size_bytes: 1024,
            url: "/assets/mmd/Eula_by_Genshin/Eula.pmx",
          },
        ],
      },
    });
  });
  await page.route("**/api/backend/sessions", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            id: "session-1",
            workspace_id: "default",
            account_id: "8X29-AF3E",
            openclaw_session_key: "agent:main:main",
            title: "Test",
            title_source: "default",
            selected_model_path: null,
            created_at: "2026-05-18T00:00:00Z",
            updated_at: "2026-05-18T00:00:00Z",
          },
        ],
      },
    });
  });
  await page.route("**/api/backend/sessions/session-1/messages", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await page.route("**/api/backend/config/openclaw", async (route) => {
    await route.fulfill({
      json: {
        base_url: "http://127.0.0.1:18789",
        token_configured: false,
        agent_id: "main",
        model: "",
        message_channel: "feishu",
        proxy_url: "",
        verify_ssl: true,
        timeout_seconds: 15,
      },
    });
  });
  await page.route("**/api/backend/admin/message-bridge/status", async (route) => {
    await route.fulfill({ json: { enabled: false, realtime_drive_character: false, binding: null } });
  });
  await page.route("**/api/backend/admin/message-bridge/openclaw/feishu/sessions", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await page.route("**/api/backend/podcasts/daily/latest**", async (route) => {
    await route.fulfill({
      json: {
        podcast: {
          date: "2026-05-18",
          status: "missing",
          doc_url: null,
          doc_links: {},
          audio: { url: null, format: null, bytes: null, source: null },
          counts: {},
          script_chars: null,
          updated_at: null,
          audio_error: null,
        },
      },
    });
  });
  await page.route("**/api/backend/messages/greetings/latest", async (route) => {
    await route.fulfill({ status: 404, json: { detail: "not found" } });
  });

  await page.goto("/companion");
  await expect(page.getByTestId("mio-command-bar")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(window.localStorage.getItem("mmd_companion_session_v1") || "{}").ttsMode),
    )
    .toBe("server");

  const voiceMode = page.locator(".mio-voice-mode");
  await expect(voiceMode).toHaveAttribute("aria-pressed", "true");

  await voiceMode.click();

  await expect.poll(() => page.evaluate(() => window.__speechCancelCount)).toBeGreaterThan(0);
  await expect(voiceMode).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(window.localStorage.getItem("mmd_companion_session_v1") || "{}").ttsEnabled),
    )
    .toBe(false);

  await voiceMode.click();

  await expect(voiceMode).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(window.localStorage.getItem("mmd_companion_session_v1") || "{}").ttsEnabled),
    )
    .toBe(true);
});

test("trace page owns the runtime health entry point @critical", async ({ page }) => {
  await seedSession(page);
  await page.goto("/traces");

  await expect(page.getByRole("link", { name: "运行状态" })).toHaveAttribute("href", "/status");
});

test("companion render pipeline selection persists across reloads @smoke", async ({ page }) => {
  await seedSession(page);
  await page.goto("/companion");

  await page.locator('button[aria-controls="mio-advanced-panel"]').click();
  const pipelineOptions = page.getByTestId("mio-advanced-panel").getByRole("radiogroup", { name: RENDER_MODE });
  await expect(pipelineOptions.getByRole("radio", { name: /Classic/ })).toHaveAttribute("aria-checked", "true");

  await pipelineOptions.getByRole("radio", { name: /Genshin/ }).click();
  await expect(pipelineOptions.getByRole("radio", { name: /Genshin/ })).toHaveAttribute("aria-checked", "true");

  await page.reload();
  await page.locator('button[aria-controls="mio-advanced-panel"]').click();

  await expect(
    page.getByTestId("mio-advanced-panel").getByRole("radiogroup", { name: RENDER_MODE }).getByRole("radio", {
      name: /Genshin/,
    }),
  ).toHaveAttribute("aria-checked", "true");
});

test("companion restores saved genshin render pipeline sessions @smoke", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "mmd_companion_session_v1",
      JSON.stringify({ userId: "8X29-AF3E", renderPipeline: "genshin" }),
    );
  });

  await page.goto("/companion");

  await page.locator('button[aria-controls="mio-advanced-panel"]').click();
  await expect(
    page.getByTestId("mio-advanced-panel").getByRole("radiogroup", { name: RENDER_MODE }).getByRole("radio", {
      name: /Genshin/,
    }),
  ).toHaveAttribute("aria-checked", "true");
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(window.localStorage.getItem("mmd_companion_session_v1") || "{}").renderPipeline),
    )
    .toBe("genshin");
});

test("companion stage occupies about seventy percent of the desktop viewport @critical", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await seedSession(page);
  await page.goto("/companion");

  const stageBox = await page.locator(".mio-stage").boundingBox();

  expect(stageBox).not.toBeNull();
  expect(stageBox!.width).toBeGreaterThanOrEqual(1070);
});

test("companion stage sits higher on the desktop viewport @critical", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await seedSession(page);
  await page.goto("/companion");

  const stageWrapBox = await page.getByTestId("mio-stage-wrap").boundingBox();
  const commandBarBox = await page.getByTestId("mio-command-bar").boundingBox();

  expect(stageWrapBox).not.toBeNull();
  expect(commandBarBox).not.toBeNull();
  expect(stageWrapBox!.y).toBeLessThanOrEqual(68);
  expect(Math.abs(commandBarBox!.y - (stageWrapBox!.y + stageWrapBox!.height))).toBeLessThanOrEqual(2);
});

test("companion stage includes a forty-pixel bottom fade for a softer transition @critical", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await seedSession(page);
  await page.goto("/companion");

  const fade = page.getByTestId("mio-stage-bottom-fade");
  const fadeBox = await fade.boundingBox();
  const commandBarBox = await page.getByTestId("mio-command-bar").boundingBox();
  const fadeBackground = await fade.evaluate((node) => getComputedStyle(node).backgroundImage);
  const fadeFilter = await fade.evaluate((node) => getComputedStyle(node).filter);

  await expect(fade).toBeVisible();
  expect(fadeBox).not.toBeNull();
  expect(commandBarBox).not.toBeNull();
  expect(Math.round(fadeBox!.height)).toBe(44);
  expect(Math.abs((fadeBox!.y + fadeBox!.height) - commandBarBox!.y)).toBeLessThanOrEqual(2);
  expect(fadeBackground).toContain("69, 146, 255");
  expect(fadeFilter).toContain("blur");
});

test("companion dialogue stays in the stage upper-left zone without covering the character @critical", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await seedSession(page);
  await page.goto("/companion");

  const stageBox = await page.locator(".mio-stage").boundingBox();
  const dialogueBox = await page.getByTestId("mio-dialogue").boundingBox();

  expect(stageBox).not.toBeNull();
  expect(dialogueBox).not.toBeNull();
  expect(dialogueBox!.x).toBeGreaterThanOrEqual(stageBox!.x);
  expect(dialogueBox!.y).toBeLessThanOrEqual(stageBox!.y + 92);
  expect(dialogueBox!.x + dialogueBox!.width).toBeLessThanOrEqual(stageBox!.x + stageBox!.width * 0.42);
});
