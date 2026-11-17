"""Ingredients Master / Ingredient Pricing Excel Local Update contracts. No database writes."""
import io,json,sys,unittest,zipfile
from pathlib import Path
from datetime import date,datetime
from decimal import Decimal
from unittest.mock import patch
from xml.etree import ElementTree as E
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
import npd_master_excel as m
import packaging_master_excel_api as shared
from auth import AccessContext
from fastapi import HTTPException

NS={"s":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
class FakeCursor:
 """Resolves code lookups in order; each lookup returns one ID."""
 def __init__(self,*ids):self.ids=list(ids)
 def execute(self,sql,*params):self.last=(sql,params);return self
 def fetchall(self):return [(self.ids.pop(0),)] if self.ids else []

def layout(entity,columns):
 return shared.View(layout=dict(columns=columns,filters=["search","status"],values={"search":"Sa"},sort=[{"column":"Description","direction":"asc"}]))

class Contracts(unittest.TestCase):
 def setUp(self):
  self.admin=AccessContext(1,"Admin",frozenset({"Admin"}))
  self.ingredient=m.normalize_row("ingredients",dict(ID=7,RowVersion=b"\0"*7+b"\1",IngredientCode="ING-0000000007",Description="Salt",
   GradeNature="Fine",Origin="Vietnam",BaseUoM="KG",Status="Active",CreatedAt=datetime(2026,11,1,1,0),CreatedByName="admin",UpdatedAt=None,UpdatedByName=None))
  self.price=m.normalize_row("ingredient-prices",dict(ID=3,RowVersion=b"\0"*7+b"\2",IngredientCode="ING-0000000007",Description="Salt",BaseUoM="KG",
   VendorName="Vendor A",UnitPrice=Decimal("12.500000"),CurrencyCode="VND",PriceUnit="KG",QuantityFrom=Decimal("0.000000"),QuantityTo=None,
   EffectiveFrom=date(2026,11,1),EffectiveTo=None,ExchangeRateToUSD=None,Status="Active",CreatedAt=None,CreatedByName=None,UpdatedAt=None,UpdatedByName=None))
 def edit(self,source,**kw):
  return shared.Edit(**{**dict(row=3,command="U",id=source["_ID"],version=source["RowVersion"],changes={}),**kw})

 def test_workbook_layout_required_and_hidden(self):
  for entity,columns in (("ingredients",["Description","Status"]),("ingredient-prices",["Status"])):
   data=dict(rows=[self.ingredient if entity=="ingredients" else self.price],total=1,dropdowns={"Command":["C","U"],"Status":["Active","Block"],"BaseUoM":["KG"],"PriceUnit":["KG"]})
   blob=m.build(entity,layout(entity,columns),data,"http://localhost:8000")
   with zipfile.ZipFile(io.BytesIO(blob)) as z,zipfile.ZipFile(shared.TEMPLATE) as original:
    self.assertEqual(z.read("xl/vbaProject.bin"),original.read("xl/vbaProject.bin"))
    sheet=E.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows=sheet.findall("s:sheetData/s:row",NS)
    keys=[c.find("s:is/s:t",NS).text for c in rows[1]]
    headers=[c.find("s:is/s:t",NS).text for c in rows[0]]
    cols=sheet.findall("s:cols/s:col",NS)
    for key in m.REQUIRED[entity]:
     self.assertNotEqual(cols[keys.index(key)].get("hidden"),"1",key);self.assertTrue(headers[keys.index(key)].endswith(" *"))
    for key in ("_ID","_RowVersion","_Original"):self.assertEqual(cols[keys.index(key)].get("hidden"),"1")
    self.assertTrue(headers[keys.index("CreatedByName")].endswith("[display]"))
    config=z.read("xl/worksheets/sheet3.xml").decode()
    self.assertIn(">"+entity+"<",config);self.assertIn(">master-5<",config)
    controls=z.read("xl/worksheets/sheet2.xml").decode()
    self.assertIn(m.CONFIG[entity]["title"]+" Excel Local Update",controls);self.assertIn("Ingredient code (Pricing only)",controls)
   if entity=="ingredients":self.assertEqual(keys[1],"IngredientCode")
   else:self.assertTrue(headers[keys.index("Description")].endswith("[display]"))

 def test_invalid_layout_rejected(self):
  with self.assertRaises(ValueError):m.build("ingredients",layout("ingredients",["MaterialCode"]),dict(rows=[],total=0,dropdowns={}),"http://localhost")

 def test_decimal_and_date_snapshot_match_cells(self):
  original=json.loads(self.price["_Original"])
  self.assertEqual((self.price["UnitPrice"],self.price["QuantityFrom"]),("12.5","0"))
  self.assertEqual(original["UnitPrice"],self.price["UnitPrice"]);self.assertEqual(self.price["EffectiveFrom"],"2026-11-01")
  self.assertEqual(self.ingredient["CreatedAt"],"2026-11-01 08:00 AM")

 def test_ingredient_partial_update_preserves_values(self):
  body=m.prepare("ingredients",self.edit(self.ingredient,changes={"Origin":"Thailand"}),self.ingredient,FakeCursor(5))
  self.assertEqual((body.ID,body.Description,body.Origin,body.GradeNature,body.BaseUoMID,body.Status),(7,"Salt","Thailand","Fine",5,"Active"))
  self.assertEqual(body.RowVersion,self.ingredient["RowVersion"])
  cleared=m.prepare("ingredients",self.edit(self.ingredient,changes={"GradeNature":None,"Status":None}),self.ingredient,FakeCursor(5))
  self.assertEqual((cleared.GradeNature,cleared.Status),("","Active"))

 def test_create_defaults_and_required(self):
  body=m.prepare("ingredients",shared.Edit(row=4,command="C",changes={"Description":"Pepper","BaseUoM":"KG"}),{},FakeCursor(5))
  self.assertIsNone(body.ID);self.assertEqual((body.Status,body.Origin),("Active",""))
  with self.assertRaisesRegex(ValueError,"Base UoM is required"):m.prepare("ingredients",shared.Edit(row=4,command="C",changes={"Description":"Pepper"}),{},FakeCursor())
  with self.assertRaisesRegex(ValueError,"not found"):m.prepare("ingredients",shared.Edit(row=4,command="C",changes={"Description":"Pepper","BaseUoM":"XX"}),{},FakeCursor())

 def test_price_resolves_codes_exact_decimals_and_dates(self):
  body=m.prepare("ingredient-prices",self.edit(self.price,changes={"UnitPrice":"12345.123456","EffectiveTo":"2026-12-31"}),self.price,FakeCursor(7,8,9,10))
  self.assertEqual((body.IngredientID,body.VendorID,body.CurrencyID,body.PriceUoMID),(7,8,9,10))
  self.assertEqual(body.UnitPrice,Decimal("12345.123456"));self.assertEqual(body.EffectiveTo,date(2026,12,31));self.assertIsNone(body.QuantityTo)

 def test_price_rejects_serial_dates_ranges_and_text_numbers(self):
  for changes,error in (({"EffectiveFrom":"46327"},"date"),({"UnitPrice":"abc"},"numeric"),({"QuantityTo":"0"},"")):
   with self.assertRaisesRegex(ValueError,error):m.prepare("ingredient-prices",self.edit(self.price,changes=changes),self.price,FakeCursor(7,8,9,10))

 def test_readonly_unknown_and_stale_rejected(self):
  for edit,source in ((self.edit(self.price,changes={"Description":"x"}),self.price),(self.edit(self.ingredient,changes={"IngredientCode":"ING-1"}),self.ingredient),
                      (self.edit(self.ingredient,version="old",changes={"Origin":"x"}),self.ingredient),(self.edit(self.ingredient,changes={"Origin":"x"}),{})):
   with self.assertRaises(ValueError):m.prepare("ingredients" if source is not self.price else "ingredient-prices",edit,source,FakeCursor(1,2,3,4))

 def test_save_requires_edit_permission(self):
  viewer=AccessContext(2,"Viewer",frozenset(),permissions={"ingredients":"display","ingredient-prices":"display"})
  with self.assertRaises(HTTPException) as caught:m.save("ingredients",shared.Batch(template_version="master-5",rows=[self.edit(self.ingredient,changes={"Origin":"x"})]),viewer)
  self.assertEqual(caught.exception.status_code,403)
  m.require_read(viewer,"ingredients")

 def test_validation_messages_are_readable(self):
  from pydantic import ValidationError
  try:m.Price(IngredientID=1,VendorID=1,CurrencyID=1,UnitPrice="1",PriceUoMID=1,QuantityFrom="5",QuantityTo="2",EffectiveFrom=date(2026,1,1))
  except ValidationError as exc:self.assertEqual(m.message(exc),"Quantity to is exclusive and must exceed quantity from.")

 def test_shared_router_dispatches_npd_entities(self):
  with patch("npd_master_excel.save",return_value={"results":[]}) as save:
   shared.save("ingredients",shared.Batch(template_version="master-5",rows=[self.edit(self.ingredient,changes={"Origin":"x"})]),self.admin)
  save.assert_called_once()
if __name__=="__main__":unittest.main()
