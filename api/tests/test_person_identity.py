from app.services.person_identity import (
    default_person_session_key,
    resolve_person_session_key,
    session_key_agent_id,
)


class StubStore:
    def __init__(self, external_session_key=None):
        self.external_session_key = external_session_key
        self.calls = []

    def get_default_message_bridge_binding(self, workspace_id, account_id, *, provider, channel):
        self.calls.append((workspace_id, account_id, provider, channel))
        if self.external_session_key is None:
            return None
        return {"external_session_key": self.external_session_key}


def test_default_person_session_key_uses_person_namespace():
    assert default_person_session_key("main", "sola") == "agent:main:person:sola"
    assert default_person_session_key(None, "sola") == "agent:main:person:sola"


def test_resolve_adopts_bound_channel_key_for_same_agent():
    """已有飞书绑定时沿用同一条会话，才能接着上一个入口继续聊。"""
    store = StubStore("agent:main:feishu:direct:ou_test_person")

    key = resolve_person_session_key(
        store,
        agent_id="main",
        person_id="sola",
        workspace_id="w1",
        account_id="a1",
    )

    assert key == "agent:main:feishu:direct:ou_test_person"
    assert store.calls == [("w1", "a1", "openclaw", "feishu")]


def test_resolve_falls_back_to_derived_key_without_binding():
    store = StubStore(None)

    key = resolve_person_session_key(
        store,
        agent_id="main",
        person_id="sola",
        workspace_id="w1",
        account_id="a1",
    )

    assert key == "agent:main:person:sola"


def test_resolve_ignores_binding_owned_by_other_agent():
    store = StubStore("agent:gpt-5-4:feishu:direct:ou_test_person")

    key = resolve_person_session_key(
        store,
        agent_id="main",
        person_id="sola",
        workspace_id="w1",
        account_id="a1",
    )

    assert key == "agent:main:person:sola"


def test_resolve_ignores_binding_with_invalid_session_key():
    store = StubStore("openclaw:placeholder-session")

    key = resolve_person_session_key(
        store,
        agent_id="main",
        person_id="sola",
        workspace_id="w1",
        account_id="a1",
    )

    assert key == "agent:main:person:sola"


def test_resolve_rejects_blank_person_id():
    store = StubStore(None)

    try:
        resolve_person_session_key(
            store,
            agent_id="main",
            person_id="   ",
            workspace_id="w1",
            account_id="a1",
        )
    except ValueError as error:
        assert "person_id" in str(error)
    else:
        raise AssertionError("blank person_id must be rejected")


def test_session_key_agent_id_parsing():
    assert session_key_agent_id("agent:main:feishu:direct:ou_x") == "main"
    assert session_key_agent_id("openclaw:x") == ""
    assert session_key_agent_id("") == ""
