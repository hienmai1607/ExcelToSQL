"""Template compatibility is enforced before any Excel write; type names are global."""
import io
import sys
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
from unittest.mock import patch
from pydantic import ValidationError
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"core"))
import packaging_master_excel_api as masters
import product_excel_api as products
import opportunity_excel_api as opportunities
import packaging_excel_api as requests
from excel_template_version import TEMPLATE_VERSIONS
from excel_dropdowns import NS
from packaging_flags_excel_contract import WorkbookFlags,transaction_workbooks
import packaging_flags_excel_contract as flags

class TemplateVersions(unittest.TestCase):
 def test_missing_old_and_wrong_family_versions_are_rejected(self):
  for module,kind in ((masters,"masters"),(products,"products"),(opportunities,"opportunities"),(requests,"requests")):
   for value in (None,"1","2","obsolete",TEMPLATE_VERSIONS["products"] if kind!="products" else TEMPLATE_VERSIONS["masters"]):
    with self.subTest(kind=kind,version=value),self.assertRaisesRegex(ValidationError,"Download a fresh"):
     module.Batch.model_validate({"rows":[],"template_version":value})
 def test_latest_versions_are_accepted(self):
  records=[
   (masters,"masters",dict(row=3,command="C",changes={})),
   (products,"products",dict(row=3,command="C",changes={})),
   (opportunities,"opportunities",dict(row=5,number="new",header_command="C",item_command="C")),
   (requests,"requests",dict(row=3,request_id=1,item_id=1,version="AAAAAAAAAAE=",changes={"FirstPMMOQ":1}))]
  for module,kind,row in records:
   with self.subTest(kind=kind):
    self.assertEqual(module.Batch.model_validate(dict(rows=[row],template_version=TEMPLATE_VERSIONS[kind])).template_version,TEMPLATE_VERSIONS[kind])
 def test_old_http_requests_do_not_enter_business_writers(self):
  from fastapi import FastAPI
  import asyncio
  import json
  from auth import get_access_context,AccessContext
  app=FastAPI()
  app.dependency_overrides[get_access_context]=lambda:AccessContext(1,"test",frozenset({"Admin"}))
  for module in (masters,products,opportunities,requests):app.include_router(module.router)
  paths=["/api/workbench/master-excel/materials/save","/api/workbench/product-excel/save","/api/workbench/opportunity-excel/save","/api/workbench/packaging-excel/save"]
  async def check():
   with patch("packaging_api.execute",side_effect=AssertionError("No writes allowed")):
    for path in paths:
     messages=[]
     async def receive():return {"type":"http.request","body":b'{"rows":[]}',"more_body":False}
     async def send(message):messages.append(message)
     scope={"type":"http","asgi":{"version":"3.0"},"http_version":"1.1","method":"POST","scheme":"http","path":path,"raw_path":path.encode(),"query_string":b"","headers":[(b"content-type",b"application/json")],"client":("127.0.0.1",1),"server":("test",80)}
     await app(scope,receive,send)
     self.assertEqual(next(m["status"] for m in messages if m["type"]=="http.response.start"),422)
     body=b"".join(m.get("body",b"") for m in messages if m["type"]=="http.response.body").decode()
     self.assertIn("Download a fresh",body)
  asyncio.run(check())
 def test_generated_workbook_versions_match_macro_and_server(self):
  fixtures=[("Master",WorkbookFlags().workbook(),3,"Command"),*transaction_workbooks()]
  families={"Master":("masters","modPackagingMasterLocal.bas"),"Product":("products","modProductLocal.bas"),"Opportunity":("opportunities","modOpportunityLocal.bas"),"Request":("requests","modPackagingRequestLocal.bas")}
  for name,blob,_,_ in fixtures:
   kind,macro=families[name]
   with self.subTest(name=name),zipfile.ZipFile(io.BytesIO(blob)) as z:
    config=ET.fromstring(z.read("xl/worksheets/sheet3.xml"))
    version=config.findtext(".//{"+NS+"}c[@r='B1']/{"+NS+"}is/{"+NS+"}t")
    self.assertEqual(version,TEMPLATE_VERSIONS[kind])
    data=ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    header="3" if name=="Opportunity" else "1"
    titles=[node.text or "" for node in data.findall(".//{"+NS+"}row[@r='"+header+"']//{"+NS+"}t")]
    self.assertTrue(any("Action" in title for title in titles),titles)
    self.assertFalse(any("Command" in title for title in titles),titles)
    text=(ROOT/macro).read_text()
    self.assertIn('If endpoint = "save" Then body("template_version") = S(Config.Range("B1").Value2)',text)
    self.assertIn('<> "'+version+'"',text)

class GlobalTypeNames(flags.PackagingFlagsSQL):
 def setUp(self):
  super().setUp()
  self.before={r[0]:r[1] for r in self.cur.execute("SELECT ID,ParentTypeID FROM dbo.PackagingType")}
  self.cur.execute((ROOT/"sql/125_packaging_type_unique_name.sql").read_text())
  while self.cur.nextset():pass
 def test_migration_preserves_ids_and_references(self):
  self.assertEqual({r[0]:r[1] for r in self.cur.execute("SELECT ID,ParentTypeID FROM dbo.PackagingType")},self.before)
  self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM (SELECT NormalizedTypeName FROM dbo.PackagingType GROUP BY NormalizedTypeName HAVING COUNT(*)>1)d").fetchval(),0)
  self.assertEqual(self.cur.execute("SELECT TYPE_NAME(system_type_id) FROM sys.columns WHERE object_id=OBJECT_ID('dbo.v_PackagingTypeDimensionContext') AND name='RootTypeID'").fetchval(),"int")
  self.cur.execute((ROOT/"sql/125_packaging_type_unique_name.sql").read_text())
  while self.cur.nextset():pass
 def test_direct_sql_cannot_bypass_global_uniqueness(self):
  import pyodbc
  first=self.save(PackagingOrders=["Primary"])
  second=self.save(PackagingType=self.name+"-other",PackagingOrders=["Tertiary Mix"])
  self.assertEqual(first["Status"],"OK",first)
  self.assertEqual(second["Status"],"OK",second)
  with self.assertRaises(pyodbc.IntegrityError):
   self.cur.execute("UPDATE dbo.PackagingType SET PackagingType=? WHERE ID=?",self.name.upper(),second["NewID"])
 def test_duplicate_name_across_different_layers_is_rejected(self):
  first=self.save(PackagingOrders=["Primary"])
  self.assertEqual(first["Status"],"OK",first)
  second=self.save(PackagingType="  "+self.name.upper()+"  ",PackagingOrders=["Tertiary Mix"])
  self.assertEqual(second["Status"],"ERROR",second)

if __name__=="__main__":unittest.main()
