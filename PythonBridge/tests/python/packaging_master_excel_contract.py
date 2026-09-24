import io,json,sys,unittest,zipfile
from pathlib import Path
from unittest.mock import patch
from datetime import date
from decimal import Decimal
from xml.etree import ElementTree as E
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
import packaging_master_excel_api as m
from auth import AccessContext
from fastapi import HTTPException
from pydantic import ValidationError
class Contracts(unittest.TestCase):
 def setUp(self):
  self.ctx=AccessContext(1,"Admin",frozenset({"Admin"}))
  self.price=dict(ID=3,RowVersion="AAAAAAAAAAE=",MaterialID=4,CurrencyID=5,PriceBasis="per pack",QuantityFrom=Decimal("0"),
   QuantityTo=None,UnitPrice=Decimal("12345678901234.1234"),EffectiveFrom=date(2026,9,19),EffectiveTo=None,Status="Active")
 def edit(self,**kw):
  return m.Edit(**{**dict(row=3,command="U",id=3,version="AAAAAAAAAAE=",changes={"UnitPrice":"12.3456"}),**kw})
 def test_required_columns_and_styles(self):
  for entity in ("materials","prices"):
   body=m.View(layout=dict(columns=["Status"],filters=[]))
   data=dict(rows=[],total=0)
   blob=m.build(entity,body,data,"http://localhost:8000")
   with zipfile.ZipFile(io.BytesIO(blob)) as z,zipfile.ZipFile(m.TEMPLATE) as original:
    self.assertEqual(z.read("xl/vbaProject.bin"),original.read("xl/vbaProject.bin"))
    ns={"s":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    sheet=E.fromstring(z.read("xl/worksheets/sheet1.xml"))
    keys=[c.find("s:is/s:t",ns).text for c in sheet.findall("s:sheetData/s:row",ns)[1]]
    cols=sheet.findall("s:cols/s:col",ns)
    for k in m.MASTER_REQUIRED_COLUMNS[entity]:
     self.assertIn(k,body.layout.columns);self.assertNotEqual(cols[keys.index(k)].get("hidden"),"1")
    self.assertEqual(cols[keys.index("_Original")].get("hidden"),"1")
 def test_partial_update_preserves_hidden_values_and_exact_decimals(self):
  payload=m.prepare("prices",self.edit(),self.price,self.ctx).rows[0]
  self.assertEqual(payload.UnitPrice,Decimal("12.3456"))
  self.assertEqual(payload.MaterialID,4);self.assertEqual(payload.CurrencyID,5)
  self.assertIsNone(payload.QuantityTo);self.assertEqual(payload.EffectiveFrom,date(2026,9,19))
 def test_date_serial_rejected_and_iso_accepted(self):
  with self.assertRaises(ValueError):m.prepare("prices",self.edit(changes={"EffectiveFrom":"46284"}),self.price,self.ctx)
  p=m.prepare("prices",self.edit(changes={"EffectiveFrom":"2026-09-19","EffectiveTo":None}),self.price,self.ctx)
  self.assertEqual(p.rows[0].EffectiveFrom,date(2026,9,19));self.assertIsNone(p.rows[0].EffectiveTo)
 def test_readonly_and_stale_rejected(self):
  for edit in (self.edit(changes={"MaterialName":"fake"}),self.edit(version="old")):
   with self.assertRaises(ValueError):m.prepare("prices",edit,self.price,self.ctx)
 def test_manager_cannot_write(self):
  with self.assertRaises(HTTPException):m.save("prices",m.Batch(rows=[self.edit()]),AccessContext(2,"Manager",frozenset({"PackagingManager"})))
 def test_duplicate_and_invalid_columns(self):
  with self.assertRaises(ValidationError):m.Batch(rows=[self.edit(),self.edit(row=4)])
  with self.assertRaises(ValueError):m.build("prices",m.View(layout=dict(columns=["Unknown"],filters=[])),dict(rows=[],total=0),"http://localhost")
 def test_create_resolves_codes_and_required(self):
  edit=self.edit(command="C",id=None,version=None,changes=dict(MaterialCode="BAG",CurrencyCode="VND",PriceBasis="each",QuantityFrom="0",UnitPrice="10",EffectiveFrom="2026-09-19"))
  with patch.object(m,"resolve",side_effect=[4,5]):
   p=m.prepare("prices",edit,{},self.ctx).rows[0]
  self.assertEqual((p.MaterialID,p.CurrencyID),(4,5));self.assertEqual(p.Status,"Active")
  with self.assertRaises(ValueError):m.prepare("materials",m.Edit(row=3,command="C",changes={"MaterialCode":"M"}),{},self.ctx)
 def test_decimal_snapshot_matches(self):
  row=m.normalize_row("prices",self.price)
  self.assertEqual(json.loads(row["_Original"])["UnitPrice"],row["UnitPrice"])
  self.assertEqual(row["EffectiveFrom"],"2026-09-19")
if __name__=="__main__":unittest.main()
