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
from product_excel_api import col
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
   keys=[c.find("s:is/s:t",ns).text for c in E.fromstring(z.read("xl/worksheets/sheet3.xml")).findall("s:sheetData/s:row",ns)[9]]
   self.assertEqual(keys[0],"HeaderCommand")
   self.assertTrue(all(keys.index(k)<keys.index("ItemCommand") for k in m.HEADER_COLUMNS))
   self.assertTrue(all(keys.index(k)>keys.index("ItemCommand") for k in m.ITEM_COLUMNS))
   cols=data.findall("s:cols/s:col",ns)
   for k in m.HEADER_REQUIRED+m.ITEM_REQUIRED:self.assertNotEqual(cols[keys.index(k)].get("hidden"),"1")
   styles=E.fromstring(z.read("xl/styles.xml"))
   formats=styles.find("s:cellXfs",ns);fills=styles.find("s:fills",ns)
   def color(k):
    fmt=formats[int(rows[2][keys.index(k)].get("s"))]
    fill=fills[int(fmt.get("fillId"))].find("s:patternFill/s:fgColor",ns)
    return fill.get("rgb") if fill is not None else None
   self.assertIsNotNone(color("CustomerName"))
   self.assertIsNotNone(color("ProductCode"))
   self.assertIsNotNone(color("HeaderStage"))
 def test_shipment_edits_processing_and_hidden_values(self):
  source={**self.source,"HasOpenPackagingRequest":True,"ShipmentCostInfo":'{"FreightUSDPerContainer":"100.00","DutyPct":"7.00","InterestMonths":2}'}
  with patch.object(m,"document_rows",return_value=[source]):
   p=m.prepare([self.edit(item_changes={"FreightUSDPerContainer":"250.50"})],self.ctx)
  fields=p.item_rows[0].model_dump(mode="json",by_alias=True,exclude_unset=True)
  self.assertEqual(fields["ShipmentCostInfo"]["DutyPct"],"7.00")
  self.assertEqual(fields["ShipmentCostInfo"]["FreightUSDPerContainer"],"250.50")
  self.assertNotIn("AnnualUnit",fields)
  self.assertNotIn("ProductID",fields)
  for key,value in (("ContainerRequest","Reefer"),("ConfigurationRequest","Floor load"),("AnnualUnit",12)):
   with patch.object(m,"document_rows",return_value=[source]),self.assertRaisesRegex(ValueError,"processing"):
    m.prepare([self.edit(item_changes={key:value})],self.ctx)
  with patch.object(m,"document_rows",return_value=[{**source,"ParentItemID":8}]),self.assertRaisesRegex(ValueError,"Mix parent"):
   m.prepare([self.edit(item_changes={"DutyPct":"2.00"})],self.ctx)
 def test_layout_sections_and_category_row(self):
  view=m.View(views=dict(header=dict(columns=["CustomerName"]),items=dict(columns=["Incoterm","PortOfEntryName","ContainerRequest","ConfigurationRequest","ContainerSizeFT","FreightUSDPerContainer","DutyPct","UsedVolumeML"])))
  source={**self.source,"HasOpenPackagingRequest":True,"ShipmentCostInfo":'{"FreightUSDPerContainer":"100.00","DutyPct":"7.00"}'}
  with zipfile.ZipFile(io.BytesIO(m.build(view,{"rows":[m.workbook_row(source)],"total":1},"http://localhost"))) as z:
   ns={"s":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
   root=E.fromstring(z.read("xl/worksheets/sheet1.xml"));rows=root.findall("s:sheetData/s:row",ns)
   keys=[c.find("s:is/s:t",ns).text for c in E.fromstring(z.read("xl/worksheets/sheet3.xml")).findall("s:sheetData/s:row",ns)[9]]
   self.assertEqual(keys.index("PortOfEntryName"),keys.index("Incoterm")+1)
   self.assertEqual(root.find(".//s:pane",ns).get("topLeftCell"),"A5")
   self.assertTrue(root.find("s:autoFilter",ns).get("ref").startswith("A4:"))
   self.assertGreater(len(root.findall("s:mergeCells/s:mergeCell",ns)),0)
   category=lambda k: rows[3][keys.index(k)].find("s:is/s:t",ns).text
   self.assertEqual(category("FreightUSDPerContainer"),"Editable")
   self.assertEqual(category("UsedVolumeML"),"Auto calculate")
   self.assertEqual(category("WeightGrams"),"Display only")
   self.assertNotEqual(rows[4][keys.index("FreightUSDPerContainer")].get("s"),rows[4][keys.index("ContainerRequest")].get("s"))
   self.assertEqual(rows[4][keys.index("FreightUSDPerContainer")].get("s"),rows[4][keys.index("WeightGrams")].get("s"))
   self.assertNotEqual(rows[4][keys.index("UsedVolumeML")].get("s"),rows[3][keys.index("UsedVolumeML")].get("s"))
   styles=E.fromstring(z.read("xl/styles.xml"));formats=styles.find("s:cellXfs",ns);fills=styles.find("s:fills",ns)
   def category_color(k):
    fmt=formats[int(rows[3][keys.index(k)].get("s"))]
    return fills[int(fmt.get("fillId"))].find("s:patternFill/s:fgColor",ns).get("rgb")
   self.assertEqual(category_color("FreightUSDPerContainer"),"FFC6EFCE")
   self.assertEqual(category_color("UsedVolumeML"),"FFDDEBF7")
   self.assertEqual(category_color("WeightGrams"),"FFE7E6E6")
   self.assertGreaterEqual(int(root.find("s:dataValidations",ns).get("count")),6)
   self.assertEqual(rows[4].get("ht"),"18")
   self.assertEqual(rows[4].get("customHeight"),"1")
   borders=styles.find("s:borders",ns)
   for ri in (4,):
    for cell in rows[ri]:
     fmt=formats[int(cell.get("s"))]
     self.assertEqual(fmt.get("fillId"),"0")
     border=borders[int(fmt.get("borderId"))]
     for side in ("left","right","top","bottom"):
      self.assertEqual(border.find("s:"+side,ns).get("style"),"thin")
     if ri==4:self.assertEqual(fmt.find("s:alignment",ns).get("wrapText"),"0")
 def test_child_lock_guidance_identifies_parent_row_without_changing_values(self):
  parent={**self.source,"ItemNumber":"1","ShipmentCostInfo":'{"DutyPct":"1.00"}'}
  child={**parent,"ItemID":8,"ParentItemID":4,"ItemNumber":"1.1"}
  view=m.View(views=dict(header=dict(columns=["HeaderStage"]),items=dict(columns=["DutyPct"])))
  with zipfile.ZipFile(io.BytesIO(m.build(view,{"rows":[m.workbook_row(parent),m.workbook_row(child)],"total":1},"http://localhost"))) as z:
   ns={"s":m.sheet.__globals__["NS"]}
   root=E.fromstring(z.read("xl/worksheets/sheet1.xml"));rows=root.findall("s:sheetData/s:row",ns)
   keys=[c.find("s:is/s:t",ns).text for c in E.fromstring(z.read("xl/worksheets/sheet3.xml")).findall("s:sheetData/s:row",ns)[9]]
   index=keys.index("DutyPct")
   self.assertNotEqual(rows[4][index].get("s"),rows[5][index].get("s"))
   self.assertEqual(rows[5][index].find("s:is/s:t",ns).text,"1.00")
   prompt=next(v for v in root.findall("s:dataValidations/s:dataValidation",ns) if v.get("sqref")==col(index+1)+"6")
   self.assertIn("row 5 (item 1)",prompt.get("prompt"))
   self.assertEqual(prompt.get("showInputMessage"),"1")
   styles=E.fromstring(z.read("xl/styles.xml"));fmt=styles.find("s:cellXfs",ns)[int(rows[5][index].get("s"))]
   font=styles.find("s:fonts",ns)[int(fmt.get("fontId"))]
   self.assertIsNotNone(font.find("s:i",ns))
   self.assertEqual(fmt.get("fillId"),"0")
 def test_subgroup_colors_and_merges_follow_selected_layout(self):
  from opportunity_excel_sheet import subgroup
  self.assertEqual(subgroup("PalletSize","Packaging requirements"),"Palletization")
  self.assertEqual(subgroup("Transparency","Packaging requirements"),"Primary packaging")
  self.assertEqual(subgroup("SecondaryTypeName","Packaging requirements"),"Secondary packaging")
  view=m.View(views=dict(header=dict(columns=["CustomerName"]),items=dict(columns=["PalletSize","PalletStacking","PrimaryTypeName","Transparency","SecondaryTypeName"])))
  with zipfile.ZipFile(io.BytesIO(m.build(view,{"rows":[m.workbook_row(self.source)],"total":1},"http://localhost"))) as z:
   ns={"s":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
   root=E.fromstring(z.read("xl/worksheets/sheet1.xml"));rows=root.findall("s:sheetData/s:row",ns)
   keys=[c.find("s:is/s:t",ns).text for c in E.fromstring(z.read("xl/worksheets/sheet3.xml")).findall("s:sheetData/s:row",ns)[9]]
   styles=E.fromstring(z.read("xl/styles.xml"));formats=styles.find("s:cellXfs",ns)
   fill=lambda ri,k:formats[int(rows[ri][keys.index(k)].get("s"))].get("fillId")
   self.assertNotEqual(fill(2,"PalletSize"),fill(2,"PrimaryTypeName"))
   self.assertEqual(fill(1,"PalletSize"),fill(2,"PalletSize"))
   self.assertEqual(fill(2,"PalletSize"),fill(2,"PalletStacking"))
   self.assertEqual(fill(2,"PrimaryTypeName"),fill(2,"Transparency"))
   self.assertNotEqual(fill(2,"PrimaryTypeName"),fill(2,"SecondaryTypeName"))
   self.assertIsNone(rows[1].get("hidden"))
   self.assertTrue(any(cell.get("ref").endswith("2") for cell in root.findall("s:mergeCells/s:mergeCell",ns)))
   self.assertTrue(all(formats[int(c.get("s"))].get("fillId")=="0" for c in rows[4]))
 def test_shipment_validation_and_port_scope(self):
  original={**self.source,"PortOfEntryName":"Seattle","ShipmentCostInfo":'{"PortOfEntryID":11,"FreightUSDPerContainer":"100.00"}'}
  self.assertEqual(m.merge_shipment(self.ctx,original,{"DutyPct":"7.50"},self.source)["PortOfEntryID"],11)
  self.assertIsNone(m.merge_shipment(self.ctx,original,{"PortOfEntryName":None},self.source)["PortOfEntryID"])
  for value in ("abc","NaN","Infinity","1.5",-1):
   with self.subTest(value=value),self.assertRaises(ValueError):
    m.merge_shipment(self.ctx,original,{"InterestMonths":value},self.source)
  with patch.object(m,"resolve",return_value=2),patch.object(m,"execute",return_value=[[]]),self.assertRaisesRegex(ValueError,"Customer and Market"):
   m.merge_shipment(self.ctx,original,{"PortOfEntryName":"Wrong market"},self.source)
  with patch.object(m,"resolve",return_value=2),patch.object(m,"execute",return_value=[[{"ID":12}]]) as query:
   result=m.merge_shipment(self.ctx,original,{"PortOfEntryName":"Los Angeles"},self.source)
   self.assertEqual(result["PortOfEntryID"],12)
   self.assertIn("p.MarketID=c.MarketID",query.call_args.args[0])
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
