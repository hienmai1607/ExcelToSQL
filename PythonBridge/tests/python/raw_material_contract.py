"""Raw material isolation, layout and Excel contracts; no database writes."""
import sys, unittest, io, zipfile, json
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from auth import AccessContext
from fastapi import HTTPException
from master_models import MasterLayout, check_layout
from packaging_api import MaterialBatch, PriceBatch
import packaging_api as batches
import packaging_master_api as api
import packaging_master_excel_api as excel
import raw_material_api as raw

class Contracts(unittest.TestCase):
 def setUp(self):
  self.ctx=AccessContext(1,"Raw user",frozenset({"RawMaterial"}))
 def test_permission_isolation(self):
  for scope in ("Packaging","PackagingManager","Product","Opportunity"):
   ctx=AccessContext(2,scope,frozenset({scope}))
   with self.assertRaises(HTTPException):api.require_entity(ctx,"raw-materials")
   with self.assertRaises(HTTPException):raw.material_save(MaterialBatch(rows=[dict(RowNum=1,Command="C")]),ctx)
  with self.assertRaises(HTTPException):api.require_entity(self.ctx,"materials")
  api.require_entity(self.ctx,"raw-prices")
  api.require_entity(AccessContext(3,"Admin",frozenset({"Admin"})),"raw-prices")
 def test_read_and_lookups_isolated(self):
  with patch.object(api,"execute",return_value=[[],[{"Total":0}]]) as sql:
   api.read("raw-prices",1,25,"",None,None,None,None,None,"[]",self.ctx)
   query=sql.call_args.args[0]
   self.assertIn("dbo.RawMaterialPrice",query);self.assertIn("dbo.RawMaterial m",query)
   self.assertNotIn("dbo.Packaging",query)
  with patch.object(api,"execute",return_value=[[],[],[],[],[]]) as sql:
   api.lookups(self.ctx,"raw-prices")
   self.assertIn("dbo.RawMaterial ORDER",sql.call_args.args[0])
   self.assertNotIn("dbo.Packaging",sql.call_args.args[0])
 def test_write_route_and_rate(self):
  with patch.object(batches,"execute",return_value=[[dict(RowNum=1,Status="OK")]]) as sql:
   raw.price_save(PriceBatch(rows=[dict(RowNum=1,Command="C",BaseUoM="KG",UnitPrice="25000",ExchangeRateToUSD="25000")]),self.ctx)
   self.assertIn("usp_RawMaterialPrice_BatchV3",sql.call_args.args[0])
   self.assertEqual(json.loads(sql.call_args.args[1][0])[0]["PriceBasis"],"KG")
 def test_workbook_and_required_layout(self):
  for entity in ("raw-materials","raw-prices"):
   body=excel.View(layout=MasterLayout(columns=["Status"],filters=[]))
   blob=excel.build(entity,body,dict(rows=[],total=0),"http://localhost:8000")
   with zipfile.ZipFile(io.BytesIO(blob)) as z:
    self.assertIn(entity,z.read("xl/worksheets/sheet3.xml").decode())
    self.assertIn("Raw Material",z.read("xl/worksheets/sheet2.xml").decode())
   self.assertIn("MaterialName" if entity=="raw-materials" else "UnitPrice",body.layout.columns)
 def test_excel_raw_lookup_and_save(self):
  edit=excel.Edit(row=3,command="C",changes=dict(MaterialCode="RAW-1",CurrencyCode="USD",BaseUoM="KG",QuantityFrom=0,UnitPrice=1,EffectiveFrom="2026-09-28"))
  with patch.object(excel,"resolve",side_effect=[10,20]) as resolve:
   payload=excel.prepare("raw-prices",edit,{},self.ctx)
   self.assertEqual(resolve.call_args_list[0].args[1],"RawMaterial")
   self.assertEqual(resolve.call_args_list[0].args[-1],"raw-prices")
  with patch.object(excel,"raw_price_save",return_value={"results":[]}) as save:
   with patch.object(excel,"prepare",return_value=payload):
    excel.save("raw-prices",excel.Batch(rows=[edit]),self.ctx)
   save.assert_called_once()

if __name__=="__main__":unittest.main()
