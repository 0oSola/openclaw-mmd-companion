from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from app.security import resolve_requester
from app.services.codex_knowledge_whitelist import CodexKnowledgeWhitelistStore


router = APIRouter(prefix="/admin/codex-knowledge/whitelist", tags=["codex-knowledge-whitelist-admin"])


def _require_admin(request: Request, x_user_id: str | None) -> None:
    settings = request.app.state.settings
    requester = resolve_requester(x_user_id, settings.admin_user_ids)
    if not requester.is_admin:
        raise HTTPException(status_code=403, detail="Admin permission required.")


def _store(request: Request) -> CodexKnowledgeWhitelistStore:
    store = getattr(request.app.state, "codex_knowledge_whitelist_store", None)
    if store is None:
        raise HTTPException(status_code=404, detail="Knowledge whitelist is disabled.")
    return store


class WhitelistAddPayload(BaseModel):
    cidr: str = Field(min_length=1, max_length=64)
    label: str = Field(default="", max_length=200)


@router.get("/")
def whitelist_index(request: Request):
    """可视化后台页面：查看与添加 OpenClaw 来源白名单。"""
    store = _store(request)
    entries = store.list_entries()
    rows = "".join(
        f"""<tr>
          <td>{entry["cidr"]}</td>
          <td>{entry["label"]}</td>
          <td>{entry["created_at"]}</td>
          <td><button class="remove" data-cidr="{entry["cidr"]}">删除</button></td>
        </tr>"""
        for entry in entries
    )
    return HTMLResponse(
        f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenClaw 来源白名单</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 900px; padding: 0 1rem; color: #1f2328; }}
    h1 {{ font-size: 1.35rem; }}
    .card {{ border: 1px solid #d0d7de; border-radius: 8px; padding: 1rem; margin-top: 1rem; }}
    table {{ width: 100%; border-collapse: collapse; margin-top: 0.75rem; }}
    th, td {{ text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid #d8dee4; font-size: 0.9rem; }}
    input {{ padding: 0.4rem 0.6rem; border: 1px solid #d0d7de; border-radius: 6px; margin-right: 0.4rem; }}
    button {{ padding: 0.4rem 0.8rem; border: 1px solid #d0d7de; border-radius: 6px; background: #f6f8fa; cursor: pointer; }}
    button.remove {{ color: #b35900; border-color: #eac54f; }}
    .notice {{ color: #57606a; font-size: 0.85rem; }}
    .error {{ color: #cf222e; margin-top: 0.5rem; }}
  </style>
</head>
<body>
  <h1>OpenClaw 来源白名单</h1>
  <p class="notice">配置 FastAPI 审核接口允许访问的来源 IP 或 CIDR。新增后即时生效，无需重启服务。</p>
  <div class="card">
    <h2>添加来源</h2>
    <form id="add-form">
      <input name="cidr" placeholder="例如 10.11.252.0/24" required>
      <input name="label" placeholder="备注（可选）">
      <button type="submit">添加</button>
    </form>
    <div id="message" class="error"></div>
  </div>
  <div class="card">
    <h2>当前白名单</h2>
    <table>
      <thead><tr><th>来源 CIDR</th><th>备注</th><th>创建时间</th><th>操作</th></tr></thead>
      <tbody id="rows">{rows or '<tr><td colspan="4">暂无条目</td></tr>'}</tbody>
    </table>
  </div>
  <script>
    const headers = {{ "Content-Type": "application/json" }};
    const userId = localStorage.getItem("codex-admin-user-id");
    if (userId) headers["X-User-Id"] = userId;
    else headers["X-User-Id"] = prompt("请输入管理员 X-User-Id") || "";
    localStorage.setItem("codex-admin-user-id", headers["X-User-Id"]);

    async function refresh() {{
      const res = await fetch("/admin/codex-knowledge/whitelist/api", {{ headers }});
      if (!res.ok) throw new Error((await res.json()).detail || "加载失败");
      const data = await res.json();
      document.getElementById("rows").innerHTML = data.entries.map((entry) => `
        <tr><td>${{entry.cidr}}</td><td>${{entry.label}}</td><td>${{entry.created_at}}</td>
        <td><button class="remove" data-cidr="${{entry.cidr}}">删除</button></td></tr>`).join("");
      document.querySelectorAll(".remove").forEach((button) =>
        button.addEventListener("click", () => removeEntry(button.dataset.cidr)));
    }}

    async function addEntry(event) {{
      event.preventDefault();
      const form = new FormData(event.target);
      const res = await fetch("/admin/codex-knowledge/whitelist/api", {{
        method: "POST",
        headers,
        body: JSON.stringify({{ cidr: form.get("cidr"), label: form.get("label") }})
      }});
      const data = await res.json();
      if (!res.ok) {{ document.getElementById("message").textContent = data.detail || "添加失败"; return; }}
      document.getElementById("message").textContent = "";
      event.target.reset();
      await refresh();
    }}

    async function removeEntry(cidr) {{
        if (!confirm(`删除 ${{cidr}}？`)) return;
      const res = await fetch("/admin/codex-knowledge/whitelist/api/" + encodeURIComponent(cidr), {{
        method: "DELETE",
        headers
      }});
      if (!res.ok) {{ document.getElementById("message").textContent = (await res.json()).detail || "删除失败"; return; }}
      await refresh();
    }}

    document.getElementById("add-form").addEventListener("submit", addEntry);
    refresh().catch((error) => document.getElementById("message").textContent = error.message);
  </script>
</body>
</html>""",
        status_code=200,
        media_type="text/html; charset=utf-8",
    )


@router.get("/api")
def list_whitelist_entries(request: Request, x_user_id: str | None = Header(default=None)):
    _require_admin(request, x_user_id)
    store = _store(request)
    return {"entries": store.list_entries()}


@router.post("/api")
def add_whitelist_entry(payload: WhitelistAddPayload, request: Request, x_user_id: str | None = Header(default=None)):
    _require_admin(request, x_user_id)
    store = _store(request)
    try:
        entry = store.add_entry(cidr=payload.cidr, label=payload.label)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"entry": entry}


@router.delete("/api/{cidr}")
def remove_whitelist_entry(cidr: str, request: Request, x_user_id: str | None = Header(default=None)):
    _require_admin(request, x_user_id)
    store = _store(request)
    removed = store.remove_entry(cidr=cidr)
    if not removed:
        raise HTTPException(status_code=404, detail=f"CIDR not found: {cidr}")
    return {"removed": True, "cidr": cidr}
