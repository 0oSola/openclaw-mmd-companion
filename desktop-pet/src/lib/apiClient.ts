import type { CompanionSharedConfig, MmdModelAsset, VmdAsset } from "@/lib/types";
import { createV14dGameModelAsset, validateV14dGameManifest, V14D_GAME_MANIFEST_URL } from "@/features/stage/v14dGameAppearanceAssets.js";

export type ApiClientOptions = {
  baseUrl: string;
  userId: string;
  fetchImpl?: typeof fetch;
};

export function createApiClient(options: ApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const headers = { "x-user-id": options.userId };

  async function requestJSON<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...headers,
        ...(init.headers || {}),
      },
    });
    if (!response.ok) {
      throw new Error(`API ${path} failed: ${response.status}`);
    }
    return response.json() as Promise<T>;
  }

  return {
    toAbsoluteUrl(path: string) {
      if (/^https?:\/\//i.test(path)) return path;
      return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    },
    getSharedConfig() {
      return requestJSON<CompanionSharedConfig>("/desktop-pet/shared-config");
    },
    async listModels() {
      const payload = await requestJSON<{ items: MmdModelAsset[] }>("/assets/mmd/models");
      return payload.items || [];
    },
    async listModelsForConfig(config: CompanionSharedConfig): Promise<MmdModelAsset[]> {
      if (config.render_pipeline !== "v14d-game") {
        const payload = await requestJSON<{ items: MmdModelAsset[] }>("/assets/mmd/models");
        return payload.items || [];
      }
      const manifest = await requestJSON<any>(V14D_GAME_MANIFEST_URL, { cache: "no-store" });
      const validation = validateV14dGameManifest(manifest);
      if (!validation.ok) throw new Error(validation.reason);
      const model = createV14dGameModelAsset(manifest);
      if (!model) throw new Error("V14D 游戏外观清单未登记模型。");
      if (config.selected_model_path && config.selected_model_path !== model.relative_path) {
        throw new Error("V14D 游戏外观不支持当前所选模型，请在主站选择清单中的克莱妲后同步。");
      }
      return [model];
    },
    async listVmdAssets() {
      const payload = await requestJSON<{ items: VmdAsset[] }>(`/assets/vmd?user_id=${encodeURIComponent(options.userId)}`);
      return payload.items || [];
    },
    listPetSessions(limit = 10) {
      return requestJSON<any>(`/desktop-pet/sessions?limit=${limit}`);
    },
    upsertPetSession(payload: unknown) {
      return requestJSON<any>("/desktop-pet/sessions", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(payload),
      });
    },
  };
}
