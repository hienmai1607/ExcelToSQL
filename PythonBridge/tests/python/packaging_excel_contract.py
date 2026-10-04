import io
import json
import sys
import unittest
import zipfile
from decimal import Decimal
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from xml.etree import ElementTree as E
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
import packaging_excel_api as m
from auth import AccessContext
from pydantic import ValidationError
from fastapi import HTTPException
class Contracts(unittest.TestCase):
 def setUp(self):
  self.ctx=AccessContext(1,"PIC",frozenset({"Packaging"}))
  self.row=dict(RequestID=2,ItemID=3,ItemRowVersion="AAAAAAAAAAE=",PICUserID=1,PIC="PIC",ItemStage="Working",
   ProductCode="P1",WeightGrams=Decimal("100.0000"),Cost=Decimal("12.3400"),PMCost=Decimal("12.3400"),
   CurrencyID=4,CostBasis="per pack",MaterialID=5,HeightMM=Decimal("10.000"),RequestNumber="PCR-2")
 def edit(self,**kw):
  return m.Edit(**{**dict(row=3,request_id=2,item_id=3,version="AAAAAAAAAAE=",changes={"FirstPMType":"Bag"}),**kw})
 def test_excel_numbers_in_response_text_fields(self):
  result=m.prepare(self.edit(changes={"FirstPMType":1,"SecondPMType":2,"PackagingDescription":4}),self.row,self.ctx).rows[0]
  self.assertEqual(result.FirstPMType,"1")
  self.assertEqual(result.SecondPMType,"2")
  self.assertEqual(result.PackagingDescription,"4")
 def test_excel_text_conversion_is_scoped_and_preserves_strings(self):
  for key in m.TEXT_FIELDS-{"PMCostCurrencyCode"}:
   with self.subTest(key=key):
    edit=self.edit(changes={key:12.5})
    self.assertEqual(edit.changes[key],"12.5")
  for value in (None,"","001","Film"):
   self.assertEqual(self.edit(changes={"FirstPMType":value}).changes["FirstPMType"],value)
  self.assertEqual(self.edit(changes={"FirstPMMOQ":12}).changes["FirstPMMOQ"],12)
  for key in ("PMCostCurrencyCode","PMCost","PalletType"):
   with self.assertRaises(ValidationError):self.edit(changes={key:123})
 def test_excel_text_rejects_invalid_shapes_and_nonfinite_numbers(self):
  for value in (True,False,[],{},float("nan"),float("inf")):
   with self.subTest(value=value),self.assertRaises(ValidationError):
    self.edit(changes={"FirstPMType":value})
  with self.assertRaises(ValidationError):
   m.prepare(self.edit(changes={"FirstPMType":"x"*101}),self.row,self.ctx)
 def test_response_api_remains_strict(self):
  with self.assertRaises(ValidationError):
   m.ResponseBatch(rows=[dict(RowNum=3,ID=3,RowVersion="AAAAAAAAAAE=",FirstPMType=1)])
 def test_save_accepts_excel_numeric_text(self):
  batch=m.Batch(rows=[self.edit(changes={"FirstPMType":1,"SecondPMType":2,"PackagingDescription":4})])
  with patch.object(m,"load_sources",return_value={3:self.row}),patch.object(m,"response_save",return_value={"results":[{"Status":"OK","NewRowVersion":"AAAAAAAAAAI="}]}) as writer:
   result=m.save(batch,self.ctx)
   self.assertEqual(result["results"][0]["status"],"OK")
   self.assertEqual(writer.call_args.args[0].rows[0].PackagingDescription,"4")
 def test_scope(self):
  with self.assertRaises(HTTPException):m.save(m.Batch(rows=[self.edit()]),AccessContext(2,"Sales",frozenset({"Opportunity"})))
 def test_ownership_stage_and_admin(self):
  for source,ctx in (({**self.row,"PICUserID":2},self.ctx),({**self.row,"ItemStage":"Pending Review"},self.ctx),(self.row,AccessContext(1,"Manager",frozenset({"PackagingManager"})))):
   with self.assertRaisesRegex(ValueError,"assigned Packaging"):m.prepare(self.edit(),source,ctx)
  m.prepare(self.edit(),{**self.row,"PICUserID":2},AccessContext(9,"Admin",frozenset({"Admin"})))
 def test_snapshot_pic_and_stage_rejected(self):
  for key in ("PIC","ItemStage","PackagingRequirement","ProductCode","ResponseDue"):
   with self.assertRaises(ValidationError):self.edit(changes={key:"x"})
  with self.assertRaises(ValidationError):self.edit(command="D")
 def test_stale_and_wrong_request(self):
  for edit in (self.edit(version="old"),self.edit(request_id=8)):
   with self.assertRaises(ValueError):m.prepare(edit,self.row,self.ctx)
 def test_patch_preserves_hidden_base_values_and_null(self):
  prepared=m.prepare(self.edit(changes={"FirstPMMOQ":None}),self.row,self.ctx).rows[0]
  self.assertEqual(prepared.MaterialID,5)
  self.assertEqual(prepared.Cost,Decimal("12.3400"))
  self.assertEqual(prepared.HeightMM,Decimal("10.000"))
  self.assertIsNone(prepared.FirstPMMOQ)
  self.assertNotIn("SecondPMMOQ",prepared.model_fields_set)
 def test_partial_response_and_cost_validation(self):
  m.prepare(self.edit(changes={"FirstPMType":None}),self.row,self.ctx)
  with self.assertRaisesRegex(ValueError,"currency and cost basis"):
   m.prepare(self.edit(changes={"CostBasis":None}),self.row,self.ctx)
 def test_decimal_and_timestamp_snapshot_matches(self):
  row=m.serialize({**self.row,"RequestedAt":datetime(2026,9,24,1,30)},self.ctx)
  self.assertEqual(row["RequestedAt"],"2026-09-24 08:30 AM")
  original=json.loads(row["_Original"])
  self.assertNotIn("PMCost",original)
  self.assertNotIn("PMCostCurrencyCode",original)
  self.assertNotIn("PalletType",original)
  self.assertEqual(original["WeightGrams"],row["WeightGrams"])
 def test_grouped_page_no_n_plus_one_and_limit(self):
  body=m.View(views={})
  with patch.object(m,"header_read",return_value={"rows":[{"RequestID":2},{"RequestID":4}],"total":2}),patch.object(m,"item_read",return_value={"rows":[self.row,{**self.row,"ItemID":5}],"total":2}) as items:
   result=m.read_page(body,self.ctx)
   self.assertEqual(len(result["rows"]),3) # two items plus an empty header
   self.assertEqual(items.call_count,1)
   self.assertEqual(items.call_args.kwargs["request_ids"],[2,4])
  with patch.object(m,"header_read",return_value={"rows":[{"RequestID":2}],"total":1}),patch.object(m,"item_read",return_value={"rows":[],"total":10001}),self.assertRaises(HTTPException):
   m.read_page(body,self.ctx)
 def test_workbook_commands_colors_required_and_macros(self):
  body=m.View(views={"header":{"columns":["RequestNumber"]},"items":{"columns":["ProductCode"]}})
  blob=m.build(body,dict(rows=[m.serialize(self.row,self.ctx)],total=1),"http://localhost:8000")
  with zipfile.ZipFile(io.BytesIO(blob)) as z,zipfile.ZipFile(m.TEMPLATE) as original:
   self.assertEqual(z.read("xl/vbaProject.bin"),original.read("xl/vbaProject.bin"))
   ns={"s":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
   data=E.fromstring(z.read("xl/worksheets/sheet1.xml"));rows=data.findall("s:sheetData/s:row",ns)
   keys=[c.find("s:is/s:t",ns).text for c in rows[1]]
   for key in ("PMCost","PMCostCurrencyCode","PalletType"):self.assertNotIn(key,keys)
   labels=[c.find("s:is/s:t",ns).text for c in rows[0]]
   self.assertIn("Primary Type",labels[keys.index("FirstPMType")])
   self.assertIn("Secondary Type",labels[keys.index("SecondPMType")])
   self.assertNotIn("HeaderCommand",keys)
   self.assertLess(keys.index("RequestNumber"),keys.index("ItemCommand"))
   self.assertLess(keys.index("ItemCommand"),keys.index("ProductCode"))
   cols=data.findall("s:cols/s:col",ns)
   for key in m.HEADER_REQUIRED+m.ITEM_REQUIRED:self.assertNotEqual(cols[keys.index(key)].get("hidden"),"1")
   styles=E.fromstring(z.read("xl/styles.xml"));formats=styles.find("s:cellXfs",ns);fills=styles.find("s:fills",ns)
   def color(key):
    fmt=formats[int(rows[0][keys.index(key)].get("s"))]
    return fills[int(fmt.get("fillId"))].find("s:patternFill/s:fgColor",ns).get("rgb")
   self.assertEqual(color("RequestNumber"),"FFDDEBF7")
   self.assertEqual(color("FirstPMType"),"FFF4B183")
   self.assertEqual(color("ItemStage"),"FFE7E6E6")
 def test_duplicate_items_rejected(self):
  with self.assertRaises(ValidationError):m.Batch(rows=[self.edit(),self.edit(row=4)])
if __name__=="__main__":unittest.main()
