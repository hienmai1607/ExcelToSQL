"""Apply 106 and exercise API pricing saves inside rollback-only fixtures."""
import re,json,unittest
from decimal import Decimal
from fastapi import HTTPException
from pathlib import Path
from unittest.mock import patch
import pkg_pricing_contract as pricing
from packaging_api import price_save,PackagingPriceBatch
from db import bytes_to_b64,get_raw_cursor
import pkg_pricing_api as calculator
from pkg_pricing import Calculation

class CopyDimensionsSQL(unittest.TestCase):
 cleanup=pricing.PricingSQL.cleanup
 new_type=pricing.PricingSQL.new_type
 material=pricing.PricingSQL.material
 line=pricing.PricingSQL.line
 def setUp(self):
  with get_raw_cursor() as cursor:
   definition=cursor.execute("SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingType_Batch'))").fetchval()
  pricing.PricingSQL.setUp(self)
  self.cur.execute("DECLARE @D NVARCHAR(MAX)=?; SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE'); EXEC sys.sp_executesql @D;",definition)
  self.migration=(pricing.foundation.ROOT/"sql/106_packaging_copy_dimensions.sql").read_text()
  self.apply()
  self.root_migration=(pricing.foundation.ROOT/"sql/107_packaging_copy_dim_root_only.sql").read_text()
  self.cur.execute(self.root_migration)
  while self.cur.nextset():pass
  self.single=self.new_type("Copy box","Count")
  self.cur.execute("UPDATE dbo.PackagingType SET FinalComponent=1,CopyDim=1 WHERE ID=?",self.single)
  self.mat,self.price=self.material(self.single,"Copy",10,100)
  self.dim=self.cur.execute("""INSERT dbo.PackagingDimension(PackagingTypeID,D1Name,D2Name,D1UoMID,D2UoMID,CreatedBy)
   VALUES(?,'Length','Width',?,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())""",self.single,self.units["mm"],self.units["mm"],self.actor).fetchval()
 def apply(self):
  for batch in re.split(r"^GO\s*$",self.migration,flags=re.M|re.I):
   if batch.strip():
    self.cur.execute(batch)
    while self.cur.nextset():pass
 def save(self,**values):
  row=dict(RowNum=1,Command="U",ID=self.price,RowVersion=bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.PackagingPrice WHERE ID=?",self.price).fetchval()),
   MaterialID=self.mat,CurrencyID=self.vnd,PriceBasis="EA",QuantityFrom=100,UnitPrice=10,EffectiveFrom="2020-01-01",ExchangeRateToUSD=25000)
  row.update(values)
  return price_save(PackagingPriceBatch(rows=[row]),self.ctx)["results"][0]
 def dimensions(self):
  return dict(MaterialDimensionID=self.dim,MaterialDimensionRowVersion=bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.PackagingDimension WHERE ID=?",self.dim).fetchval()),MaterialD1=250,MaterialD2=150)
 def test_type_master_persists_copy_flag(self):
  from packaging_type_api import packaging_type_save,PackagingTypeBatch
  result=packaging_type_save(PackagingTypeBatch(rows=[dict(RowNum=1,Command="C",PackagingType="CopyFlag-"+self.token,PackagingOrders=["Primary"],FinalComponent=True,CopyDim=True)]),self.ctx)["results"][0]
  self.assertEqual(result["Status"],"OK",result)
  self.assertEqual(tuple(self.cur.execute("SELECT FinalComponent,CopyDim FROM dbo.PackagingType WHERE ID=?",result["NewID"]).fetchone()),(True,True))
 def test_copy_type_cannot_acquire_parent(self):
  with self.assertRaises(Exception):
   self.cur.execute("UPDATE dbo.PackagingType SET ParentTypeID=? WHERE ID=?",self.root,self.single)
 def test_root_migration_repeatable(self):
  self.cur.execute(self.root_migration)
  while self.cur.nextset():pass
 def test_missing_dimensions_reject_save(self):
  with self.assertRaises(HTTPException) as error:self.save()
  self.assertEqual(error.exception.status_code,422)
 def test_saved_dimensions_copy_in_preview_and_price_version_is_final(self):
  result=self.save(**self.dimensions());self.assertEqual(result["Status"],"OK",result)
  self.assertEqual(result["NewRowVersion"],bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.PackagingPrice WHERE ID=?",self.price).fetchval()))
  payload=Calculation(PackagingOrder="Primary",LayerCount=2,PackagingTypeID=self.single,D1=999,components=[self.line(self.price)])
  preview=calculator.calculate(self.cur,self.ctx,self.req,payload)
  self.assertEqual(Decimal(preview["ParentMeasurements"]["D1"]),Decimal(250))
  self.assertEqual(Decimal(preview["ParentMeasurements"]["D2"]),Decimal(150))
 def test_migration_repeatable_and_flags_require_single(self):
  self.apply()
  with self.assertRaises(Exception):
   self.cur.execute("UPDATE dbo.PackagingType SET FinalComponent=0 WHERE ID=?",self.single)
if __name__=="__main__":unittest.main()
