"""Conversion SQL contracts; migrations and fixtures remain in a rolled-back transaction."""
import re,unittest,base64,uuid
from decimal import Decimal
from raw_material_sql_contract import SQLContracts,ROOT
import unit_conversion_api as api
import packaging_master_api as masters
from auth import AccessContext
from fastapi import HTTPException

class ConversionSQL(SQLContracts):
 def setUp(self):
  super().setUp()
  for _ in range(2):
   for sql in re.split(r"^GO\s*$",(ROOT/"sql/39_unit_conversion.sql").read_text(),flags=re.M|re.I):
    if sql.strip():
     self.cur.execute(sql)
     while self.cur.nextset():pass
  for _ in range(2):
   for sql in re.split(r"^GO\s*$",(ROOT/"sql/40_unit_conversion_precision.sql").read_text(),flags=re.M|re.I):
    if sql.strip():
     self.cur.execute(sql)
     while self.cur.nextset():pass
  self.codes=["UC-"+uuid.uuid4().hex[:8] for _ in range(2)]
  self.units=[self.cur.execute("INSERT dbo.UoM(UoMCode,CreatedBy) VALUES(?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())",code,self.ctx.user_id).fetchval() for code in self.codes]
  self.material=self.save("raw-materials",command="C",changes=dict(MaterialName="Conversion test",UnitOfMeasure=self.codes[1]))["NewID"]
 def conversion(self,**kwargs):
  return api.save(api.Conversion(FromUoMID=self.units[0],ToUoMID=self.units[1],Factor=1000,**kwargs),self.ctx)
 def factor(self,vendor=None):
  row=self.cur.execute("SELECT Factor FROM dbo.fn_UnitConversion(?,?,NULL,?,?)",*self.codes,self.material,vendor).fetchone()
  return row[0] if row else None
 def test_priority_block_and_no_reverse(self):
  self.assertIsNone(self.factor())
  general=self.conversion();self.assertEqual(self.factor(),1000)
  material=self.conversion(RawMaterialID=self.material)
  self.cur.execute("UPDATE dbo.UnitConversion SET Factor=24 WHERE ID=?",material["ID"])
  self.assertEqual(self.factor(),24)
  vendor=self.cur.execute("INSERT dbo.Vendor(VendorName,CreatedBy) VALUES(?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())","UC-"+uuid.uuid4().hex,self.ctx.user_id).fetchval()
  specific=self.conversion(RawMaterialID=self.material,VendorID=vendor)
  self.cur.execute("UPDATE dbo.UnitConversion SET Factor=12 WHERE ID=?",specific["ID"])
  self.assertEqual(self.factor(vendor),12);self.assertEqual(self.factor(),24)
  self.cur.execute("UPDATE dbo.UnitConversion SET Status='Block' WHERE ID=?",specific["ID"])
  self.assertEqual(self.factor(vendor),24)
  self.assertIsNone(self.cur.execute("SELECT Factor FROM dbo.fn_UnitConversion(?,?,NULL,?,?)",self.codes[1],self.codes[0],self.material,vendor).fetchone())
 def test_both_pricing_reads_and_missing(self):
  import raw_material_api
  import packaging_api
  def price(kind,mid):
   payload=packaging_api.PriceBatch(rows=[dict(RowNum=1,Command="C",MaterialID=mid,CurrencyID=self.cur.execute("SELECT ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval(),BaseUoM=self.codes[0],QuantityFrom=0,UnitPrice=12,EffectiveFrom="2026-09-28")])
   return (raw_material_api.price_save if kind=="raw-prices" else packaging_api.price_save)(payload,self.ctx)
  pm=self.save("materials",command="C",changes=dict(MaterialName="Conversion pkg",UnitOfMeasure=self.codes[1]))["NewID"]
  for kind,mid in (("prices",pm),("raw-prices",self.material)):
   result=price(kind,mid);self.assertEqual(result["results"][0]["Status"],"OK",result)
   row=masters.read(kind,1,25,"",None,mid,None,None,None,"[]",self.ctx)["rows"][0]
   self.assertIsNone(row["BaseUnitPrice"]);self.assertEqual(row["ConversionStatus"],"Conversion required")
  c=self.conversion()
  self.cur.execute("UPDATE dbo.UnitConversion SET Factor=24 WHERE ID=?",c["ID"])
  for kind,mid in (("prices",pm),("raw-prices",self.material)):
   row=masters.read(kind,1,25,"",None,mid,None,None,None,"[]",self.ctx)["rows"][0]
   self.assertEqual(Decimal(row["BaseUnitPrice"]),Decimal("0.5"))
   self.assertEqual(Decimal(row["BaseUnitUSDPrice"]),Decimal("0.5"))
   self.assertEqual(Decimal(row["UnitPrice"]),12)
 def test_nine_decimal_round_trip(self):
  value=Decimal("0.000000123")
  saved=api.save(api.Conversion(FromUoMID=self.units[0],ToUoMID=self.units[1],Factor=value),self.ctx)
  self.assertEqual(self.factor(),value)
  row=api.read(page=1,search=self.codes[0],ctx=self.ctx)["rows"][0]
  self.assertEqual(Decimal(row["Factor"]),value)
  api.save(api.Conversion(ID=saved["ID"],RowVersion=saved["RowVersion"],FromUoMID=self.units[0],ToUoMID=self.units[1],Factor=Decimal("123456789012345.123456789")),self.ctx)
  self.assertEqual(self.factor(),Decimal("123456789012345.123456789"))
 def test_numeric_export(self):
  import io,zipfile
  body=masters.Export(columns=["BaseUnitPrice","BaseUnitUSDPrice","ConversionFactor"],rows=[["0.50","0.50","24"]])
  response=masters.export("raw-prices",body,self.ctx)
  with zipfile.ZipFile(io.BytesIO(response.body)) as z:
   sheet=z.read("xl/worksheets/sheet1.xml").decode()
   self.assertIn("<v>0.50</v>",sheet)
   self.assertIn("<v>24</v>",sheet)
 def test_read_and_validation(self):
  from pydantic import ValidationError
  self.conversion()
  rows=api.read(page=1,search=self.codes[0],ctx=self.ctx)["rows"]
  self.assertEqual(len(rows),1)
  self.assertEqual(rows[0]["FromUoM"],self.codes[0])
  for factor in ("0","-1","0.0000000001","NaN"):
   with self.assertRaises(ValidationError):
    api.Conversion(FromUoMID=self.units[0],ToUoMID=self.units[1],Factor=factor)
  user=AccessContext(1,"Raw",frozenset({"RawMaterial"}))
  with self.assertRaises(HTTPException):
   api.save(api.Conversion(FromUoMID=self.units[0],ToUoMID=self.units[1],Factor=1),user)
 def test_duplicate_rejected(self):
  self.conversion()
  with self.assertRaises(HTTPException):self.conversion()
 def test_stale_edit_rejected(self):
  first=self.conversion()
  self.cur.execute("UPDATE dbo.UnitConversion SET Factor=2 WHERE ID=?",first["ID"])
  with self.assertRaises(HTTPException):
   self.conversion(ID=first["ID"],RowVersion=first["RowVersion"])
 def test_live_role_cannot_edit_general_by_changing_scope(self):
  general=self.conversion()
  name="UC-"+uuid.uuid4().hex[:15]
  uid=self.cur.execute("INSERT dbo.Users(UserName,IsActive) VALUES(?,1);SELECT CONVERT(INT,SCOPE_IDENTITY())",name).fetchval()
  self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,'RawMaterial')",uid)
  self.ctx=AccessContext(uid,name,frozenset({"RawMaterial"}))
  with self.assertRaises(HTTPException) as error:
   self.conversion(ID=general["ID"],RowVersion=general["RowVersion"],RawMaterialID=self.material)
  self.assertEqual(error.exception.status_code,403)

if __name__=="__main__":unittest.main()
