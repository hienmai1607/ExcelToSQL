"""Current packaging flags and local-workbook contracts. SQL fixtures always roll back."""
import io
import json
import sys
import unittest
import uuid
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
from unittest.mock import patch
from pydantic import ValidationError

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"core"))
from db import get_raw_cursor
from packaging_orders import TYPE_FLAGS
from master_models import MasterLayout
import packaging_master_excel_api as excel
from excel_dropdowns import NS,with_dropdowns,master_choices,transaction_choices,normalize_booleans

class PackagingFlagsSQL(unittest.TestCase):
 def setUp(self):
  self.handle=get_raw_cursor();self.cur=self.handle.__enter__()
  self.cur.execute("SET NOCOUNT ON;SET QUOTED_IDENTIFIER ON;BEGIN TRANSACTION")
  self.actor=self.cur.execute("SELECT TOP(1) u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin'").fetchval()
  self.name="flag-test-"+uuid.uuid4().hex[:14]
 def tearDown(self):
  self.cur.execute("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION");self.handle.__exit__(None,None,None)
 def save(self,**values):
  row={"RowNum":1,"Command":"C","PackagingType":self.name,"PackagingOrders":["Primary Mix"],"ParentTypeID":None,"FinalComponent":True,"CopyDim":False,**values}
  self.cur.execute("EXEC dbo.usp_PackagingType_Batch ?,?",json.dumps([row]),self.actor)
  return dict(zip([c[0] for c in self.cur.description],self.cur.fetchone()))
 def test_mix_is_independent_and_single_copy_is_derived(self):
  result=self.save();self.assertEqual(result["Status"],"OK",result)
  data=self.cur.execute("SELECT [Primary],PrimaryMix,SecondaryMix,TertiaryMix,CopyDim FROM dbo.v_PackagingTypeWeb WHERE ID=?",result["NewID"]).fetchone()
  self.assertEqual(tuple(data),(False,True,False,False,True))
  self.assertEqual(self.cur.execute("SELECT dbo.fn_PackagingTypeOrderAllowed(?,'Primary',0),dbo.fn_PackagingTypeOrderAllowed(?,'Primary',1)",result["NewID"],result["NewID"]).fetchone()[0],False)
  self.assertTrue(self.cur.execute("SELECT dbo.fn_PackagingTypeOrderAllowed(?,'Primary',1)",result["NewID"]).fetchval())
 def test_child_single_does_not_copy(self):
  parent=self.save(PackagingType=self.name+"-parent",PackagingOrders=["Primary"],FinalComponent=False)
  self.assertEqual(parent["Status"],"OK",parent)
  child=self.save(ParentTypeID=parent["NewID"],PackagingOrders=None,CopyDim=True)
  self.assertEqual(child["Status"],"OK",child)
  self.assertFalse(self.cur.execute("SELECT CopyDim FROM dbo.PackagingType WHERE ID=?",child["NewID"]).fetchval())
 def test_update_rejects_stale_row_version(self):
  created=self.save();self.assertEqual(created["Status"],"OK",created)
  values={"Command":"U","ID":created["NewID"],"RowVersionHex":"0x"+bytes(created["NewRowVersion"]).hex(),"Status":"Block"}
  changed=self.save(**values);self.assertEqual(changed["Status"],"OK",changed)
  stale=self.save(**values);self.assertEqual(stale["Status"],"ERROR")
 def test_migration_is_idempotent(self):
  before=self.cur.execute("SELECT COUNT(*) FROM dbo.PackagingTypeOrder").fetchval()
  self.cur.execute((ROOT/"sql/124_packaging_type_mix_flags.sql").read_text(encoding="utf-8"))
  self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.PackagingTypeOrder").fetchval(),before)

class WorkbookFlags(unittest.TestCase):
 def body(self):
  return excel.View(layout=MasterLayout(columns=["PackagingType","ParentType",*TYPE_FLAGS,"Shipping","FinalComponent","Status"],filters=[],page_size=25))
 def workbook(self):
  record={"ID":1,"RowVersion":"AAAAAAAAAAE=","ParentTypeID":None,"PackagingType":"Example","PackagingOrders":["Primary","Secondary Mix"],"Primary":True,"SecondaryMix":True,"FinalComponent":True,"Shipping":False,"Status":"Active"}
  data={"rows":[excel.normalize_row("packaging-types",record)],"total":1,"dropdowns":{"Command":["C","U"],"Status":["Active","Block"],**{k:["True","False"] for k in [*TYPE_FLAGS,"Shipping","FinalComponent"]},"ParentType":["Secondary / Root"]}}
  return excel.build("packaging-types",self.body(),data,"http://127.0.0.1:8000/")
 def test_separate_flags_commands_and_hidden_lookup_lists(self):
  blob=self.workbook()
  with zipfile.ZipFile(io.BytesIO(blob)) as z:
   root=ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
   rows=root.findall("{"+NS+"}sheetData/{"+NS+"}row")
   values=lambda row:[c.findtext("{"+NS+"}is/{"+NS+"}t") for c in row]
   self.assertEqual(values(rows[0])[0],"Action (C/U)")
   keys=values(rows[1]);self.assertTrue(set(TYPE_FLAGS)<=set(keys));self.assertNotIn("CopyDim",keys);self.assertNotIn("PackagingOrder",keys)
   self.assertIn("Status",keys)
   self.assertEqual(values(rows[2])[0],"")
   self.assertGreaterEqual(len(root.find("{"+NS+"}dataValidations")),10)
   workbook=ET.fromstring(z.read("xl/workbook.xml"))
   sheet=next(s for s in workbook.find("{"+NS+"}sheets") if s.get("name")=="_Lists")
   self.assertEqual(sheet.get("state"),"veryHidden")
   with zipfile.ZipFile(excel.TEMPLATE) as original:self.assertEqual(z.read("xl/vbaProject.bin"),original.read("xl/vbaProject.bin"))
 def test_status_and_flags_use_server_validation(self):
  edit=excel.Edit(row=3,command="C",changes={"PackagingType":"New","Primary":"True","PrimaryMix":"False","FinalComponent":"True","Shipping":"False","Status":"Active"})
  payload=excel.prepare("packaging-types",edit,{},None)
  self.assertEqual(payload.rows[0].PackagingOrders,["Primary"])
  self.assertTrue(payload.rows[0].CopyDim)
  with self.assertRaises(ValidationError):excel.Edit(row=3,command="D",id=1,version="AAAAAAAAAAE=")
  with self.assertRaises(ValueError):excel.prepare("packaging-types",edit.model_copy(update={"changes":{**edit.changes,"Primary":"invented"}}),{},None)
 def test_lookup_values_are_fresh_and_inactive_options_are_excluded(self):
  with patch("packaging_master_api.lookups",return_value={"materials":[],"currencies":[],"packagingTypes":[{"ID":1,"PackagingType":"Root","PackagingOrder":"Secondary","Status":"Active","FinalComponent":False},{"ID":2,"PackagingType":"Old","PackagingOrder":"Primary","Status":"Block","FinalComponent":False}]}):
   self.assertEqual(master_choices("packaging-types",None)["ParentType"],["Secondary / Root"])
 def test_excel_ignorable_namespace_prefixes_remain_declared(self):
  with zipfile.ZipFile(io.BytesIO(self.workbook())) as z:
   xml=z.read("xl/workbook.xml")
   root=ET.fromstring(xml)
   declarations=dict(value for _,value in ET.iterparse(io.BytesIO(xml),events=["start-ns"]))
   for prefix in root.get("{http://schemas.openxmlformats.org/markup-compatibility/2006}Ignorable","").split():
    self.assertIn(prefix,declarations)
 def test_dropdown_helper_is_idempotent(self):
  blob=self.workbook()
  twice=with_dropdowns(blob,{"Command":["C","U"],"Status":["Active","Block"]})
  with zipfile.ZipFile(io.BytesIO(twice)) as z:
   root=ET.fromstring(z.read("xl/workbook.xml"))
   self.assertEqual(len([s for s in root.find("{"+NS+"}sheets") if s.get("name")=="_Lists"]),1)
class TransactionDropdowns(unittest.TestCase):
 def test_response_boolean_text_preserves_strict_validation(self):
  from packaging_api import ResponseRow
  self.assertIs(normalize_booleans({"SameConfig":"False"},ResponseRow)["SameConfig"],False)
  self.assertEqual(normalize_booleans({"SameConfig":"invented"},ResponseRow)["SameConfig"],"invented")
 def test_opportunity_only_uses_opportunity_authorized_lookups(self):
  from auth import AccessContext
  ctx=AccessContext(user_id=1,username="test",scopes=frozenset({"Opportunity"}))
  with patch("packaging_api.lookups",side_effect=AssertionError("Packaging scope is not authorized")),patch("packaging_api.execute",return_value=([{"ID":1,"PackagingType":"Box","ProductCode":"PRD-1","PackagingOrdersJSON":'["Primary Mix"]'}],)) as execute:
   choices=transaction_choices(ctx,{"PrimaryTypeID","ProductCode"})
   self.assertEqual(choices["PrimaryTypeID"],["1"])
   self.assertTrue(all("usp_Opportunity" in call.args[0] for call in execute.call_args_list))
 def test_all_workbook_adapters_keep_vba_and_named_dropdowns(self):
  for name,blob,first,key in transaction_workbooks():
   with self.subTest(name=name),zipfile.ZipFile(io.BytesIO(blob)) as z:
    root=ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    validation=next(v for v in root.find("{"+NS+"}dataValidations") if v.findtext("{"+NS+"}formula1")=="PB_DD_"+key)
    self.assertTrue(validation.get("sqref").split(":")[0].endswith(str(first)))
    self.assertIn("xl/vbaProject.bin",z.namelist())

def transaction_workbooks():
 import product_excel_api as products
 import opportunity_excel_api as opportunities
 import packaging_excel_api as requests
 from opportunity_views import OpportunityViews
 from request_views import RequestViews
 data={"rows":[],"total":0,"dropdowns":{"Command":["C","U"],"HeaderCommand":["C","U"],"ItemCommand":["U"],"Status":["Active","Block"]}}
 yield "Product",products.build(products.View(layout=MasterLayout(columns=["ProductName"],filters=[])),data,"http://127.0.0.1:8000/"),3,"Command"
 yield "Opportunity",opportunities.build(opportunities.View(views=OpportunityViews()),data,"http://127.0.0.1:8000/"),5,"HeaderCommand"
 yield "Request",requests.build(requests.View(views=RequestViews()),data,"http://127.0.0.1:8000/"),3,"ItemCommand"

if __name__=="__main__":unittest.main()
