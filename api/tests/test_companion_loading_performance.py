import asyncio
import sqlite3
import threading
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4
from app.db.store import TraceStore
from app.routes import message_service

def make_store():
    root=Path(__file__).resolve().parents[2]/'web'/'.scratch'/'performance-tests'/uuid4().hex
    return TraceStore(root/'trace.db',root/'logs')

def test_history_related_fields_are_batched_without_changing_results():
    store=make_store()
    try:
        for i in range(32):
            key=str(i)
            store._conn.execute('INSERT INTO messages(id,workspace_id,session_id,account_id,role,content,created_at) VALUES(?,?,?,?,?,?,?)',(key,'w','s','a','user','fixture-'+key,f'2024-01-01T00:00:{i:02d}Z'))
            for version in (1,2):
                store._conn.execute('INSERT INTO message_tts(id,workspace_id,message_id,provider,version,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',(f't-{i}-{version}','w',key,'fixture',version,'ready','2024','2024'))
                store._conn.execute('INSERT INTO message_motion_resolution(id,workspace_id,message_id,status,created_at) VALUES(?,?,?,?,?)',(f'm-{i}-{version}','w',key,'resolved',str(version)))
        store._conn.commit()
        rows=store._conn.execute('SELECT * FROM messages ORDER BY created_at').fetchall()
        expected=[store._hydrate_message(row) for row in rows]
        statements=[]
        store._conn.set_trace_callback(statements.append)
        actual=store.list_messages('w','a','s')
        store._conn.set_trace_callback(None)
        assert actual==expected
        selects=[s for s in statements if s.lstrip().upper().startswith('SELECT')]
        assert len(selects)<=3, f'历史消息触发{len(selects)}条查询，应批量补全'
    finally:store.close()

def test_related_lookup_uses_composite_indexes():
    store=make_store()
    try:
        for table,ordering in [('message_motion_resolution','created_at'),('message_tts','version')]:
            plan=store._conn.execute(f'EXPLAIN QUERY PLAN SELECT * FROM {table} WHERE workspace_id=? AND message_id=? ORDER BY {ordering} DESC LIMIT 1',('w','m')).fetchall()
            detail=' '.join(row[3] for row in plan)
            assert 'SCAN ' not in detail and 'TEMP B-TREE' not in detail, detail
    finally:store.close()

def test_history_route_does_not_run_database_work_on_event_loop(monkeypatch):
    main_thread=threading.get_ident()
    called=[]
    class Store:
        def get_session(self,*args):return {'id':'s'}
        def list_messages_for_chat(self,*args):called.append(threading.get_ident());return []
        list_messages_for_chat_readonly=list_messages_for_chat
    monkeypatch.setattr(message_service,'_context',lambda *args:{'workspace':{'id':'w'},'account':{'id':'a'}})
    monkeypatch.setattr(message_service,'_store',lambda *args:Store())
    assert asyncio.run(message_service.list_messages('s',SimpleNamespace(),None))=={'items':[]}
    assert called and all(t!=main_thread for t in called)
