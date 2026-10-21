import { expect, test, type Page } from "@playwright/test";

function seedSession(page: Page) {
  return page.addInitScript(() => {
    window.localStorage.setItem(
      "mmd_companion_session_v1",
      JSON.stringify({ userId: "8X29-AF3E", renderPipeline: "classic" }),
    );
  });
}

test("advanced VMD assets can be favorited and renamed", async ({ page }) => {
  await seedSession(page);

  await page.route("**/config/mapping/resolved/**", async (route) => {
    await route.fulfill({ json: { mappings: {} } });
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
  await page.route("**/assets/vmd?**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            asset_id: "asset-1",
            user_id: "8X29-AF3E",
            slot: "happy",
            filename: "happy-wave.vmd",
            display_name: "happy-wave.vmd",
            is_favorite: false,
            favorite_relative_path: null,
            size_bytes: 20480,
            created_at: "2026-04-26T10:00:00Z",
            url: "/assets/vmd/file/asset-1",
          },
        ],
      },
    });
  });

  const patchRequests: Array<Record<string, unknown>> = [];
  await page.route("**/assets/vmd/asset-1", async (route, request) => {
    const payload = request.postDataJSON() as Record<string, unknown>;
    patchRequests.push(payload);
    await route.fulfill({
      json: {
        asset_id: "asset-1",
        user_id: "8X29-AF3E",
        slot: "happy",
        filename: "happy-wave.vmd",
        display_name: payload.display_name ? `${payload.display_name}.vmd` : "happy-wave.vmd",
        is_favorite: Boolean(payload.favorite),
        favorite_relative_path: payload.favorite ? "usage/vmd/Eula[action]/happy-wave.vmd" : null,
        favorite_model_relative_path: payload.favorite ? "Eula/Eula.pmx" : null,
        size_bytes: 20480,
        created_at: "2026-04-26T10:00:00Z",
        url: "/assets/vmd/file/asset-1",
      },
    });
  });

  await page.goto("/companion");
  await page.locator('button[aria-controls="mio-advanced-panel"]').click();

  const asset = page.getByTestId("mio-advanced-asset").first();
  await expect(asset).toBeVisible();

  await asset.getByRole("button", { name: "Favorite" }).click();
  await expect
    .poll(() => patchRequests)
    .toContainEqual({ favorite: true, model_relative_path: "Eula/Eula.pmx" });

  await asset.getByRole("button", { name: "Rename" }).click();
  const renameDialog = page.getByTestId("mio-rename-dialog");
  await expect(renameDialog).toBeVisible();
  await page.getByTestId("mio-rename-input").fill("Greeting Loop");
  await renameDialog.getByRole("button", { name: "Confirm" }).click();

  await expect
    .poll(() => patchRequests)
    .toContainEqual({ display_name: "Greeting Loop", model_relative_path: "Eula/Eula.pmx" });
});

test("favorites tab shows current model favorites and allows rename plus unfavorite", async ({ page }) => {
  await seedSession(page);

  await page.route("**/config/mapping/resolved/**", async (route) => {
    await route.fulfill({ json: { mappings: {} } });
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
            favorite_model_relative_path: "Eula/Eula.pmx",
            size_bytes: 20480,
            created_at: "2026-04-26T10:00:00Z",
            url: "/assets/vmd/file/asset-1",
          },
          {
            asset_id: "asset-3",
            user_id: "8X29-AF3E",
            slot: "sad",
            filename: "eula-sad.vmd",
            display_name: "eula-sad.vmd",
            is_favorite: true,
            favorite_relative_path: "usage/vmd/Eula[action]/eula-sad.vmd",
            favorite_model_relative_path: "Eula/Eula.pmx",
            size_bytes: 18480,
            created_at: "2026-04-26T11:00:00Z",
            url: "/assets/vmd/file/asset-3",
          },
          {
            asset_id: "asset-2",
            user_id: "8X29-AF3E",
            slot: "thinking",
            filename: "ayaka-favorite.vmd",
            display_name: "ayaka-favorite.vmd",
            is_favorite: true,
            favorite_relative_path: "usage/vmd/Ayaka[action]/ayaka-favorite.vmd",
            favorite_model_relative_path: "Ayaka/Ayaka.pmx",
            size_bytes: 10480,
            created_at: "2026-04-26T09:00:00Z",
            url: "/assets/vmd/file/asset-2",
          },
        ],
      },
    });
  });

  const patchRequests: Array<Record<string, unknown>> = [];
  await page.route("**/assets/vmd/asset-1", async (route, request) => {
    const payload = request.postDataJSON() as Record<string, unknown>;
    patchRequests.push(payload);
    await route.fulfill({
      json: {
        asset_id: "asset-1",
        user_id: "8X29-AF3E",
        slot: "happy",
        filename: "eula-favorite.vmd",
        display_name: payload.display_name ? `${payload.display_name}.vmd` : "eula-favorite.vmd",
        is_favorite: payload.favorite === false ? false : true,
        favorite_relative_path: payload.favorite === false ? null : "usage/vmd/Eula[action]/eula-favorite.vmd",
        favorite_model_relative_path: payload.favorite === false ? null : "Eula/Eula.pmx",
        size_bytes: 20480,
        created_at: "2026-04-26T10:00:00Z",
        url: "/assets/vmd/file/asset-1",
      },
    });
  });

  await page.goto("/companion");
  await page.locator('button[aria-controls="mio-advanced-panel"]').click();
  await page.getByRole("tab", { name: "Favorites" }).click();

  await expect(page.getByTestId("mio-advanced-asset")).toHaveCount(2);
  await expect(page.getByTestId("mio-advanced-asset").nth(0)).toContainText("eula-sad.vmd");
  await expect(page.getByTestId("mio-advanced-asset").nth(1)).toContainText("eula-favorite.vmd");
  await expect(page.getByTestId("mio-advanced-asset").filter({ hasText: "eula-favorite.vmd" })).toHaveCount(1);
  await expect(page.getByTestId("mio-advanced-asset").filter({ hasText: "eula-sad.vmd" })).toHaveCount(1);
  await expect(page.getByTestId("mio-advanced-asset").filter({ hasText: "ayaka-favorite.vmd" })).toHaveCount(0);

  await page.getByLabel("Favorite slot filter").selectOption("happy");
  await expect(page.getByTestId("mio-advanced-asset")).toHaveCount(1);
  await expect(page.getByTestId("mio-advanced-asset").filter({ hasText: "eula-favorite.vmd" })).toHaveCount(1);
  await expect(page.getByTestId("mio-advanced-asset").filter({ hasText: "eula-sad.vmd" })).toHaveCount(0);

  await page.getByLabel("Favorite slot filter").selectOption("all");
  await expect(page.getByTestId("mio-advanced-asset")).toHaveCount(2);

  const asset = page.getByTestId("mio-advanced-asset").nth(1);
  await asset.getByRole("button", { name: "Rename" }).click();
  const renameDialog = page.getByTestId("mio-rename-dialog");
  await expect(renameDialog).toBeVisible();
  await page.getByTestId("mio-rename-input").fill("Eula Loop");
  await renameDialog.getByRole("button", { name: "Confirm" }).click();
  await expect
    .poll(() => patchRequests)
    .toContainEqual({ display_name: "Eula Loop", model_relative_path: "Eula/Eula.pmx" });

  await asset.getByRole("button", { name: "Unfavorite" }).click();
  await expect
    .poll(() => patchRequests)
    .toContainEqual({ favorite: false, model_relative_path: "Eula/Eula.pmx" });
});

test("library keeps favorited VMDs isolated to their owning model", async ({ page }) => {
  await seedSession(page);

  await page.route("**/config/mapping/resolved/**", async (route) => {
    await route.fulfill({ json: { mappings: {} } });
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
  await page.route("**/assets/vmd?**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            asset_id: "eula-favorite",
            user_id: "8X29-AF3E",
            slot: "happy",
            filename: "eula-wave.vmd",
            display_name: "eula-wave.vmd",
            is_favorite: true,
            favorite_relative_path: "usage/vmd/Eula[action]/eula-wave.vmd",
            favorite_model_relative_path: "Eula/Eula.pmx",
            size_bytes: 20480,
            created_at: "2026-04-26T10:00:00Z",
            url: "/assets/vmd/file/eula-favorite",
          },
          {
            asset_id: "ayaka-favorite",
            user_id: "8X29-AF3E",
            slot: "thinking",
            filename: "ayaka-idle.vmd",
            display_name: "ayaka-idle.vmd",
            is_favorite: true,
            favorite_relative_path: "usage/vmd/Ayaka[action]/ayaka-idle.vmd",
            favorite_model_relative_path: "Ayaka/Ayaka.pmx",
            size_bytes: 18480,
            created_at: "2026-04-26T11:00:00Z",
            url: "/assets/vmd/file/ayaka-favorite",
          },
          {
            asset_id: "shared-asset",
            user_id: "8X29-AF3E",
            slot: "happy",
            filename: "shared-motion.vmd",
            display_name: "shared-motion.vmd",
            is_favorite: false,
            favorite_relative_path: null,
            favorite_model_relative_path: null,
            size_bytes: 10240,
            created_at: "2026-04-26T12:00:00Z",
            url: "/assets/vmd/file/shared-asset",
          },
        ],
      },
    });
  });

  await page.goto("/companion");
  await page.locator('button[aria-controls="mio-advanced-panel"]').click();

  const panel = page.getByTestId("mio-advanced-panel");
  await expect(panel.getByTestId("mio-advanced-asset")).toHaveCount(2);
  await expect(panel.getByText("eula-wave.vmd", { exact: true })).toBeVisible();
  await expect(panel.getByText("shared-motion.vmd", { exact: true })).toBeVisible();
  await expect(panel.getByText("ayaka-idle.vmd", { exact: true })).toHaveCount(0);

  await panel.getByRole("combobox", { name: "模型切换" }).selectOption("Ayaka/Ayaka.pmx");

  await expect(panel.getByTestId("mio-advanced-asset")).toHaveCount(2);
  await expect(panel.getByText("ayaka-idle.vmd", { exact: true })).toBeVisible();
  await expect(panel.getByText("shared-motion.vmd", { exact: true })).toBeVisible();
  await expect(panel.getByText("eula-wave.vmd", { exact: true })).toHaveCount(0);
});
