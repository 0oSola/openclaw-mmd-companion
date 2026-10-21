import { expect, test, type Page } from "@playwright/test";

function seedSession(page: Page) {
  return page.addInitScript(() => {
    window.localStorage.setItem(
      "mmd_companion_session_v1",
      JSON.stringify({ userId: "8X29-AF3E", renderPipeline: "classic" }),
    );
  });
}

test("a model without its own idle uses Eula idle while retaining the full Eula favorites library", async ({ page }) => {
  await seedSession(page);
  await page.route("**/config/mapping/resolved/**", async (route) => route.fulfill({ json: { mappings: {} } }));
  await page.route("**/assets/mmd/models", async (route) => {
    await route.fulfill({
      json: {
        items: [
          { name: "Eula.pmx", label: "Eula", relative_path: "Eula/Eula.pmx", size_bytes: 1024, url: "/assets/mmd/Eula/Eula.pmx" },
          { name: "Ayaka.pmx", label: "Ayaka", relative_path: "Ayaka/Ayaka.pmx", size_bytes: 1024, url: "/assets/mmd/Ayaka/Ayaka.pmx" },
        ],
      },
    });
  });
  await page.route("**/assets/mmd/vmds", async (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/assets/vmd?**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            asset_id: "eula-idle",
            user_id: "8X29-AF3E",
            slot: "neutral",
            filename: "eula-idle.vmd",
            display_name: "eula-idle.vmd",
            is_favorite: true,
            favorite_relative_path: "usage/vmd/Eula/00_idle_loop/eula-idle.vmd",
            favorite_model_relative_path: "Eula/Eula.pmx",
            size_bytes: 20480,
            created_at: "2026-08-02T10:00:00Z",
            url: "/assets/vmd/file/eula-idle",
            motion_profile: { companion_safe: true },
          },
          {
            asset_id: "eula-thinking",
            user_id: "8X29-AF3E",
            slot: "thinking",
            filename: "eula-thinking.vmd",
            display_name: "eula-thinking.vmd",
            is_favorite: true,
            favorite_relative_path: "usage/vmd/Eula/03_thinking_waiting/eula-thinking.vmd",
            favorite_model_relative_path: "Eula/Eula.pmx",
            size_bytes: 20480,
            created_at: "2026-08-02T10:00:00Z",
            url: "/assets/vmd/file/eula-thinking",
            motion_profile: { companion_safe: true },
          },
        ],
      },
    });
  });

  await page.goto("/companion");
  await page.locator('button[aria-controls="mio-advanced-panel"]').click();
  await page.getByRole("combobox", { name: "模型切换" }).selectOption("Ayaka/Ayaka.pmx");

  const panel = page.getByTestId("mio-advanced-panel");
  await expect(panel.getByText("eula-idle.vmd", { exact: true })).toHaveCount(1);
  await panel.getByRole("tab", { name: "Favorites", exact: true }).click();
  await expect(panel.getByText("eula-idle.vmd", { exact: true })).toHaveCount(1);
  await expect(panel.getByText("eula-thinking.vmd", { exact: true })).toHaveCount(1);
  await expect(panel.getByRole("button", { name: "优菈共享", exact: true })).toHaveCount(2);
});
