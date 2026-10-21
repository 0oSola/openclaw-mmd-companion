import { expect, test, type Page } from "@playwright/test";

function seedSession(page: Page) {
  return page.addInitScript(() => {
    window.localStorage.setItem(
      "mmd_companion_session_v1",
      JSON.stringify({ userId: "8X29-AF3E", renderPipeline: "reze-design" }),
    );
  });
}

test("Reze material editor exposes style groups and the material library", async ({ page }) => {
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
        ],
      },
    });
  });
  await page.route("**/assets/mmd/vmds", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });

  await page.goto("/companion");

  const advancedTrigger = page.getByRole("button", { name: "高级功能" });
  await expect(advancedTrigger).toHaveCount(1);
  await advancedTrigger.click();

  const advancedPanel = page.getByTestId("mio-advanced-panel");
  const renderModes = advancedPanel.getByRole("radiogroup", { name: "渲染模式" });
  await expect(renderModes).toHaveCount(1);
  const rezeDesign = renderModes.getByRole("radio", { name: "Reze Design" });
  await expect(rezeDesign).toHaveCount(1);
  await rezeDesign.click();

  const rezeEditorTrigger = page.getByRole("button", { name: "打开 Reze 材质与场景编辑器" });
  await expect(rezeEditorTrigger).toHaveCount(1);
  await rezeEditorTrigger.click();

  const editor = page.getByTestId("mio-stage-debugger");
  await expect(editor).toBeVisible();

  const sceneTab = editor.getByRole("tab", { name: "场景" });
  await expect(sceneTab).toHaveCount(1);
  await sceneTab.click();
  await expect(editor.getByLabel("背景颜色")).toHaveValue("#4b004f");
  await expect(editor.getByRole("slider", { name: "主光方位" })).toHaveValue("205");
  await expect(editor.getByRole("slider", { name: "主光仰角" })).toHaveValue("21");
  await expect(editor.getByRole("slider", { name: "世界光强度" })).toHaveValue("0.66");
  await expect(editor.getByRole("slider", { name: "泛光阈值" })).toHaveValue("0.5");
  await expect(editor.getByRole("slider", { name: "泛光膝点" })).toHaveValue("0.5");
  await expect(editor.getByRole("slider", { name: "泛光半径" })).toHaveValue("4");
  await expect(editor.getByLabel("地面颜色")).toHaveValue("#c800de");
  await expect(editor.getByLabel("地面网格线")).toBeChecked();
  await expect(editor.getByLabel("背景特效")).toHaveValue("Shining Stars");

  const gradePicker = editor.getByLabel("调色预设");
  await expect(gradePicker).toHaveValue("中性");
  const gradeStrength = editor.getByRole("slider", { name: "调色强度" });
  await expect(gradeStrength).toBeEnabled();
  await gradePicker.selectOption("赛博朋克");
  await expect(page.getByTestId("mio-hud")).toHaveAttribute("data-reze-grade", "赛博朋克");
  await gradeStrength.fill("0.4");
  await expect(gradeStrength).toHaveValue("0.4");

  const materialsTab = editor.getByRole("tab", { name: "材质" });
  await expect(materialsTab).toHaveCount(1);
  await materialsTab.click();

  await expect(editor.getByRole("button", { name: "素材库" })).toHaveCount(1);
  await editor.getByRole("button", { name: "素材库" }).click();

  const materialLibrary = editor.getByRole("region", { name: "材质库预设" });
  await expect(materialLibrary).toBeVisible();
  await expect(materialLibrary.getByText("角色皮肤", { exact: true })).toHaveCount(1);
  await expect(materialLibrary.getByText("眼睛", { exact: true })).toHaveCount(1);
  await expect(materialLibrary.getByText("柔滑布料", { exact: true })).toHaveCount(1);
});
