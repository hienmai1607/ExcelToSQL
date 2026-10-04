"""Page-size preference and bounded utility list contracts; no database writes."""
import asyncio
import unittest
from unittest.mock import patch
from fastapi import FastAPI
from pydantic import ValidationError
from auth import AccessContext, get_access_context
from preferences_api import Settings
import unit_conversion_api as api

async def http_get_status(app, query):
    messages=[]
    async def receive():
        return {"type":"http.request","body":b"","more_body":False}
    async def send(message):
        messages.append(message)
    scope={"type":"http","asgi":{"version":"3.0"},"http_version":"1.1",
           "method":"GET","scheme":"http","path":"/api/unit-conversions",
           "query_string":query.encode(),"root_path":"","headers":[],
           "client":("127.0.0.1",12345),"server":("test",80)}
    await app(scope,receive,send)
    return next(m["status"] for m in messages if m["type"]=="http.response.start")

class WorkspaceLayout(unittest.TestCase):
    def test_legacy_profiles_default_page_sizes(self):
        settings=Settings.model_validate({"requests":{"header":{"columns":["RequestNumber"]},"items":{"columns":["ProductCode"]}},"opportunity":{"header":{"columns":["OpportunityNumber"]}}})
        self.assertEqual(settings.requests.header.page_size,25)
        self.assertEqual(settings.requests.items.page_size,25)
        self.assertEqual(settings.opportunity.header.page_size,25)
        self.assertEqual(settings.list_layouts,{})

    def test_each_view_keeps_independent_page_size(self):
        data={"page_size":35,"requests":{"header":{"columns":["RequestNumber"],"page_size":40},"items":{"columns":["ProductCode"],"page_size":15}},
              "opportunity":{"header":{"columns":["OpportunityNumber"],"page_size":60},"items":{"columns":["ProductCode"],"page_size":30}},
              "list_layouts":{"unit-conversions":{"page_size":70},"packaging-dimensions":{"page_size":20}}}
        settings=Settings.model_validate_json(Settings.model_validate(data).model_dump_json())
        self.assertEqual(settings.page_size,35)
        self.assertEqual(settings.requests.header.page_size,40)
        self.assertEqual(settings.requests.items.page_size,15)
        self.assertEqual(settings.opportunity.header.page_size,60)
        self.assertEqual(settings.opportunity.items.page_size,30)
        self.assertEqual(settings.list_layouts["unit-conversions"].page_size,70)
        self.assertEqual(settings.list_layouts["packaging-dimensions"].page_size,20)

    def test_invalid_nested_page_sizes_and_keys_are_rejected(self):
        for value in (0,501,1.5,True,"25"):
            for domain,kind,column in (("requests","header","RequestNumber"),("requests","items","ProductCode"),("opportunity","header","OpportunityNumber"),("opportunity","items","ProductCode")):
                with self.subTest(value=value,domain=domain,kind=kind),self.assertRaises(ValidationError):
                    Settings.model_validate({domain:{kind:{"columns":[column],"page_size":value}}})
            with self.assertRaises(ValidationError):
                Settings(list_layouts={"unit-conversions":{"page_size":value}})
        for layouts in ({"bad-key":{"page_size":25}},{"unit-conversions":{"page_size":25,"secret":1}}):
            with self.assertRaises(ValidationError):
                Settings(list_layouts=layouts)

    def test_conversion_page_size_default_works_for_direct_call_and_sql_is_bounded(self):
        ctx=AccessContext(1,"Admin",frozenset({"Admin"}))
        with patch.object(api,"execute",return_value=[[{"ID":i} for i in range(70)],[{"Total":150}]]) as execute:
            result=api.read(page=2,search="",ctx=ctx,page_size=70)
            self.assertEqual(len(result["rows"]),70)
            self.assertTrue(result["has_more"])
            self.assertEqual(execute.call_args.args[1][6:8],[70,70])
            self.assertIn("FETCH NEXT ? ROWS ONLY",execute.call_args.args[0])
            result=api.read(page=1,search="",ctx=ctx)
            self.assertEqual(result["page_size"],50)
            self.assertEqual(execute.call_args.args[1][6:8],[0,50])
            self.assertEqual(result["total"],150)
            query,params=execute.call_args.args
            self.assertEqual(query.count(api.VISIBLE),2)
            self.assertEqual(params[1:6],params[8:13])

    def test_conversion_http_page_size_limits(self):
        app=FastAPI()
        app.include_router(api.router)
        app.dependency_overrides[get_access_context]=lambda: AccessContext(1,"Admin",frozenset({"Admin"}))
        with patch.object(api,"execute",return_value=[[],[{"Total":0}]]) as execute:
            for size in ("0","501","1.5"):
                self.assertEqual(asyncio.run(http_get_status(app,"page_size="+size)),422)
            execute.assert_not_called()
            self.assertEqual(asyncio.run(http_get_status(app,"page_size=500")),200)
            self.assertEqual(execute.call_args.args[1][6:8],[0,500])

if __name__=="__main__":
    unittest.main()
