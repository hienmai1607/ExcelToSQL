import io
import json
import sys
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from xml.etree import ElementTree as E
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
import opportunity_excel_api as m
from auth import AccessContext
from pydantic import ValidationError

class Contracts(unittest.TestCase):
 def setUp(self):
  self.ctx=AccessContext(1,"Admin",frozenset({"Admin"}))
  self.source=dict(OpportunityID=1,OpportunityNumber="OPP-1",CustomerID=2,CustomerName="Customer",OpportunityDesc="Test",
   BidOpen="2026-09-01",BidClose="2026-10-01",CurrencyID=3,CurrencyCode="VND",ExchangeRateToVND="1",
   CustomerCurrencyCode="VND",ExchangeRateVNDPerUSD="25000",ExchangeRateCustomerCurrencyPerUSD="25000",HeaderStage="Draft",HeaderRowVersion="AAAAAAAAAAE=",ItemID=4,ProductID=5,ProductCode="P1",
   ItemDescription="Item",AnnualUnit=10,EstPctAwarded=None,ShelfPrice=None,ItemStage="Draft",ItemRowVersion="AAAAAAAAAAI=",
   HasOpenPackagingRequest=False,PalletSize="Keep me")
 def edit(self,**kw):
  values=dict(row=3,number="OPP-1",opportunity_id=1,item_id=4,header_version="AAAAAAAAAAE=",item_version="AAAAAAAAAAI=")
  return m.Edit(**{**values,**kw})
 def test_required_columns_and_grouped_colors(self):
  view=m.View(views=dict(header=dict(columns=["HeaderStage"]),items=dict(columns=["ItemStage"])))
  for key in m.HEADER_REQUIRED:self.assertIn(key,view.views.header.columns)
  blob=m.build(view,dict(rows=[m.workbook_row(self.source)],total=1),"http://localhost:8000")
  with zipfile.ZipFile(io.BytesIO(blob)) as z,zipfile.ZipFile(m.TEMPLATE) as original:
   self.assertEqual(z.read("xl/vbaProject.bin"),original.read("xl/vbaProject.bin"))
   ns={"s":m.sheet.__globals__["NS"]}
   data=E.fromstring(z.read("xl/worksheets/sheet1.xml"))
   rows=data.findall("s:sheetData/s:row",ns)
   keys=[c.find("s:is/s:t",ns).text for c in rows[1]]
   self.assertEqual(keys[0],"HeaderCommand")
   self.assertTrue(all(keys.index(k)<keys.index("ItemCommand") for k in m.HEADER_COLUMNS))
   self.assertTrue(all(keys.index(k)>keys.index("ItemCommand") for k in m.ITEM_COLUMNS))
   cols=data.findall("s:cols/s:col",ns)
   for k in m.HEADER_REQUIRED+m.ITEM_REQUIRED:self.assertNotEqual(cols[keys.index(k)].get("hidden"),"1")
   styles=E.fromstring(z.read("xl/styles.xml"))
   formats=styles.find("s:cellXfs",ns);fills=styles.find("s:fills",ns)
   def color(k):
    fmt=formats[int(rows[0][keys.index(k)].get("s"))]
    return fills[int(fmt.get("fillId"))].find("s:patternFill/s:fgColor",ns).get("rgb")
   self.assertEqual(color("CustomerName"),"FFBDD7EE")
   self.assertEqual(color("ProductCode"),"FFF4B183")
   self.assertEqual(color("HeaderStage"),"FFE7E6E6")
 def test_repeated_header_changes_merge_once_and_preserve_hidden_fields(self):
  a=self.edit(header_changes={"OpportunityDesc":"Changed"})
  b=self.edit(row=4,item_id=None,item_version=None)
  with patch.object(m,"document_rows",return_value=[self.source]):
   payload=m.prepare([a,b],self.ctx)
  self.assertEqual(len(payload.header_rows),1)
  self.assertEqual(payload.header_rows[0].opportunity_desc,"Changed")
  self.assertEqual(payload.header_rows[0].customer_id,2)
  self.assertEqual(payload.item_rows,[])
 def test_conflicting_repeated_header_values_rejected(self):
  with patch.object(m,"document_rows",return_value=[self.source]),self.assertRaisesRegex(ValueError,"Conflicting repeated"):
   m.prepare([self.edit(header_changes={"OpportunityDesc":"A"}),self.edit(row=4,item_id=None,header_changes={"OpportunityDesc":"B"})],self.ctx)
 def test_null_and_omitted_item_extensions_preserved(self):
  with patch.object(m,"document_rows",return_value=[self.source]):
   p=m.prepare([self.edit(item_changes={"ShelfPrice":None,"AnnualUnit":20})],self.ctx)
  item=p.item_rows[0].model_dump(by_alias=True,exclude_unset=True)
  self.assertIsNone(item["ShelfPrice"]);self.assertEqual(item["AnnualUnit"],20)
  self.assertNotIn("PalletSize",item)
 def test_stale_header_and_item_and_locks(self):
  cases=[self.edit(header_version="old",item_changes={"AnnualUnit":20}),self.edit(item_version="old",item_changes={"AnnualUnit":20})]
  for row in cases:
   with patch.object(m,"document_rows",return_value=[self.source]),self.assertRaises(ValueError):m.prepare([row],self.ctx)
  for source in ({**self.source,"HeaderStage":"In Progress"},{**self.source,"HasOpenPackagingRequest":True}):
   with patch.object(m,"document_rows",return_value=[source]),self.assertRaises(ValueError):m.prepare([self.edit(item_changes={"AnnualUnit":20})],self.ctx)
 def test_readonly_and_duplicate_rejected(self):
  with self.assertRaises(ValidationError):self.edit(item_changes={"ItemStage":"Approved"})
  with self.assertRaises(ValidationError):m.Batch(rows=[self.edit(),self.edit(row=4)])
 def test_create_header_multiple_items(self):
  group=[m.Edit(row=n,number="XL-NEW",header_command="C",item_command="C",
   header_changes={k:self.source[k] for k in m.HEADER_REQUIRED if k in m.HEADER_EDITABLE},
   item_changes={"ProductCode":"P"+str(n),"ItemDescription":"Item","AnnualUnit":5}) for n in (3,4)]
  with patch.object(m,"resolve",return_value=9):
   p=m.prepare(group,self.ctx)
  self.assertEqual(len(p.header_rows),1);self.assertEqual(len(p.item_rows),2)
  self.assertEqual(p.header_rows[0].command,"C")
 def test_header_delete_rejects_item_edits(self):
  with patch.object(m,"document_rows",return_value=[self.source]),self.assertRaisesRegex(ValueError,"without separate"):
   m.prepare([self.edit(header_command="D",item_changes={"AnnualUnit":20})],self.ctx)
 def test_decimal_snapshot_matches_refresh_values(self):
  from decimal import Decimal
  row=m.workbook_row({**self.source,"WeightGrams":Decimal("100.0000"),"MixRatioPct":Decimal("12.50")})
  snapshot=json.loads(row["_Original"])
  self.assertEqual(row["WeightGrams"],snapshot["WeightGrams"])
  self.assertEqual(row["MixRatioPct"],snapshot["MixRatioPct"])
 def test_scope_required(self):
  from fastapi import HTTPException
  with self.assertRaises(HTTPException):m.save(m.Batch(rows=[self.edit()]),AccessContext(2,"Product",frozenset({"Product"})))

if __name__=="__main__":unittest.main()
