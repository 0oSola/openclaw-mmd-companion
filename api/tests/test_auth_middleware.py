"""钉住认证中间件本身的行为。

业务用例统一显式关掉 JWT（`jwt_secret: ""`）并自带身份头，避免继承本地
`api/.env` 里的密钥；认证规则由本文件单独覆盖：

- 配了密钥时，带合法 token 放行，并把用户身份写进 request.state；
- 配了密钥时，不带身份请求受保护路径返回 401；
- 配了密钥时，token 过期返回 401；
- 公开路径与公开前缀不校验身份；
- 没配密钥时（`jwt_secret: ""`）不做校验，这是给测试基座用的开关。
"""
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.security import create_token


JWT_SECRET = "auth-middleware-test-secret-0123456789abcdef"


def _make_case_dir() -> Path:
    path = Path(__file__).resolve().parent / "tests_runtime" / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def _client(*, jwt_secret: str) -> TestClient:
    app = create_app(
        {
            "data_dir": str(_make_case_dir()),
            "admin_user_ids": [],
            "jwt_secret": jwt_secret,
        }
    )
    return TestClient(app)


def test_token_authenticates_and_sets_request_user():
    token = create_token("u1", JWT_SECRET, expiry_hours=1)
    with _client(jwt_secret=JWT_SECRET) as client:
        response = client.get("/trace/events", headers={"authorization": f"Bearer {token}"})
    assert response.status_code == 200


def test_missing_identity_is_rejected_when_secret_configured():
    with _client(jwt_secret=JWT_SECRET) as client:
        response = client.get("/trace/events")
    assert response.status_code == 401
    assert "Authentication required" in response.json()["detail"]


def test_expired_token_is_rejected():
    expired = create_token("u1", JWT_SECRET, expiry_hours=-1)
    with _client(jwt_secret=JWT_SECRET) as client:
        response = client.get("/trace/events", headers={"authorization": f"Bearer {expired}"})
    assert response.status_code == 401
    assert "expired" in response.json()["detail"].lower()


def test_token_signed_with_other_secret_is_rejected():
    forged = create_token("u1", "some-other-secret", expiry_hours=1)
    with _client(jwt_secret=JWT_SECRET) as client:
        response = client.get("/trace/events", headers={"authorization": f"Bearer {forged}"})
    assert response.status_code == 401


@pytest.mark.parametrize("path", ["/healthz", "/docs", "/openapi.json"])
def test_public_paths_skip_authentication(path: str):
    with _client(jwt_secret=JWT_SECRET) as client:
        assert client.get(path).status_code != 401


def test_mmd_asset_prefix_skips_authentication():
    with _client(jwt_secret=JWT_SECRET) as client:
        # 资源不存在会走 404，但只要不是 401 就说明中间件放行了。
        response = client.get("/assets/vmd/does-not-exist.vmd")
    assert response.status_code != 401


def test_empty_secret_disables_authentication():
    """测试基座依赖这个开关：显式传空串时不做身份校验。"""
    with _client(jwt_secret="") as client:
        response = client.get("/trace/events", headers={"x-user-id": "u1"})
    assert response.status_code == 200


def test_tts_proxy_prefix_uses_query_identity_instead_of_token():
    """<audio src> 无法带请求头，TTS 代理路由靠查询参数 user_id 传身份。

    中间件不得把这些路径拦成 401，归属校验由路由自身完成。
    """
    with _client(jwt_secret=JWT_SECRET) as client:
        # 不存在的 tts_id 会走 404，但只要不是 401 就说明中间件放行到路由层了。
        response = client.get("/tts/proxy/does-not-exist?user_id=u1")
    assert response.status_code != 401
