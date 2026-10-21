import { describe, expect, it, vi } from "vitest";

import { createApiClient } from "./apiClient";
import type { CompanionSharedConfig } from "@/lib/types";

const gameConfig: CompanionSharedConfig = { user_id:"admin-1", render_pipeline:"v14d-game", selected_model_path:"koleda.pmx", reze_stage_document:null, updated_at:null };
function validManifest() {
  const entry={url:"/assets/data",sha256:"hash"};
  return {model:{url:"/assets/koleda.pmx?v=hash",relativePath:"koleda.pmx",sha256:"hash"},sourceManifestSha256:"hash",
    textures:[{...entry,key:"normal",kind:"normal"}],ocio:Object.fromEntries(["processor","shader","lut0","lut1"].map(k=>[k,entry])),
    lights:Array.from({length:6},()=>({type:"AREA",shape:"DISK",color:[1,1,1],matrix:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],size:1,sizeY:1,power:1}))};
}

describe("desktop pet api client", () => {
  it("V14D 只读取白名单清单，不扫描普通模型目录", async () => {
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify(validManifest())));
    const client=createApiClient({baseUrl:"http://127.0.0.1:8117",userId:"admin-1",fetchImpl});
    const models=await client.listModelsForConfig(gameConfig);
    expect(models[0].relative_path).toBe("koleda.pmx");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:8117/assets/v14d-game/manifest",expect.anything());
  });
  it("缺资源和模型不符明确拒绝，不静默换角色", async () => {
    const client=createApiClient({baseUrl:"http://127.0.0.1:8117",userId:"admin-1",fetchImpl:async()=>new Response(JSON.stringify(validManifest()))});
    await expect(client.listModelsForConfig({...gameConfig,selected_model_path:"other.pmx"})).rejects.toThrow("不支持当前所选模型");
    const unavailable=createApiClient({baseUrl:"http://127.0.0.1:8117",userId:"admin-1",fetchImpl:async()=>new Response(JSON.stringify({available:false,reason:"缺少资源"}))});
    await expect(unavailable.listModelsForConfig(gameConfig)).rejects.toThrow("缺少资源");
  });
  it("经典模式仍使用普通模型目录", async () => {
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({items:[]})));
    await createApiClient({baseUrl:"http://127.0.0.1:8117",userId:"admin-1",fetchImpl}).listModelsForConfig({...gameConfig,render_pipeline:"classic"});
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:8117/assets/mmd/models",expect.anything());
  });
  it("sends x-user-id for shared config", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ render_pipeline: "classic" }), { status: 200 }),
    );
    const client = createApiClient({ baseUrl: "http://127.0.0.1:8000", userId: "admin-1", fetchImpl });

    await client.getSharedConfig();

    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ "x-user-id": "admin-1" });
  });

  it("normalizes model file urls", () => {
    const client = createApiClient({ baseUrl: "http://127.0.0.1:8000", userId: "admin-1" });

    expect(client.toAbsoluteUrl("/assets/vmd/file/a")).toBe("http://127.0.0.1:8000/assets/vmd/file/a");
  });
});
