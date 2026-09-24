import sys
import unittest
import asyncio
import json
from types import SimpleNamespace
from pathlib import Path
from contextlib import contextmanager
from unittest.mock import patch, MagicMock
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "core"))
from fastapi import FastAPI
from auth import AccessContext, get_access_context
import opportunity_changes_api as module

class Contracts(unittest.TestCase):
    def setUp(self):
        self.app=FastAPI()
        self.app.include_router(module.router)
        self.app.dependency_overrides[get_access_context]=lambda: AccessContext(1,"Alice",frozenset({"Opportunity"}))
        self.client=SimpleNamespace(get=self.get)

    def get(self, url):
        async def request():
            messages=[]
            path, _, query=url.partition("?")
            async def receive():
                return {"type":"http.request","body":b"","more_body":False}
            async def send(message):
                messages.append(message)
            await self.app({"type":"http","asgi":{"version":"3.0"},"http_version":"1.1",
                "method":"GET","scheme":"http","path":path,"raw_path":path.encode(),
                "query_string":query.encode(),"root_path":"","headers":[],
                "client":("127.0.0.1",12345),"server":("test",80)},receive,send)
            status=next(m["status"] for m in messages if m["type"]=="http.response.start")
            body=json.loads(b"".join(m.get("body",b"") for m in messages if m["type"]=="http.response.body"))
            return SimpleNamespace(status_code=status,json=lambda:body)
        return asyncio.run(request())

    def test_filters_and_actor_are_bound(self):
        cursor=MagicMock()
        cursor.fetchone.return_value=(12,)
        @contextmanager
        def db():
            yield cursor
        with patch.object(module,"get_raw_cursor",db), patch.object(module,"fetch_all_as_dicts",return_value=[]):
            r=self.client.get("/api/opportunity/5/changes?page=2&page_size=10&level=Item&source=System&field=Stage")
        self.assertEqual(r.status_code,200)
        self.assertEqual(r.json()["total"],12)
        self.assertEqual(cursor.execute.call_args.args[1:],("Alice",5,2,10,"Item","System","Stage"))

    def test_denied_and_invalid_inputs_do_not_read(self):
        with patch.object(module,"get_raw_cursor") as db:
            self.assertEqual(self.client.get("/api/opportunity/5/changes?page_size=501").status_code,422)
            self.app.dependency_overrides[get_access_context]=lambda: AccessContext(2,"Other",frozenset({"Customer"}))
            self.assertEqual(self.client.get("/api/opportunity/5/changes").status_code,403)
            db.assert_not_called()

    def test_missing_migration_is_actionable(self):
        with patch.object(module,"get_raw_cursor",side_effect=RuntimeError("2812 procedure missing")):
            r=self.client.get("/api/opportunity/5/changes")
        self.assertEqual(r.status_code,503)
        self.assertIn("migration 21",r.json()["detail"])

if __name__=="__main__":
    unittest.main()
