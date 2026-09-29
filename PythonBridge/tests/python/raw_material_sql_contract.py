"""Rollback-only tests against existing local test DB, including migration rerun."""
import re,sys,unittest,base64
from pathlib import Path
from contextlib import contextmanager
from unittest.mock import patch
import pyodbc
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"core"))
import packaging_api as batches
import raw_material_api as raw
import packaging_master_excel_api as excel
from auth import AccessContext

class SQLContracts(unittest.TestCase):
 def setUp(self):
  self.conn=pyodbc.connect("DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost;DATABASE=test;Trusted_Connection=yes;TrustServerCertificate=yes",autocommit=True)
  self.addCleanup(self.cleanup)
  self.cur=self.conn.cursor()
  self.cur.execute("SET NOCOUNT ON;BEGIN TRANSACTION")
  for _ in range(2):
   for sql in re.split(r"^GO\s*$",(ROOT/"sql/38_raw_material_masters.sql").read_text(),flags=re.M|re.I):
    if sql.strip():
     self.cur.execute(sql)
     while self.cur.nextset():pass
  actor,name=self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin'").fetchone()
  self.ctx=AccessContext(actor,name,frozenset({"Admin"}))
  self.cur.execute("IF NOT EXISTS(SELECT 1 FROM dbo.UoM WHERE UoMCode='EA') INSERT dbo.UoM(UoMCode,CreatedBy) VALUES('EA',?)",actor)
  @contextmanager
  def cursor():yield self.cur
  mock=patch.object(batches,"get_raw_cursor",cursor);mock.start();self.addCleanup(mock.stop)
 def cleanup(self):
  try:self.conn.cursor().execute("IF @@TRANCOUNT>0 ROLLBACK")
  finally:self.conn.close()
 def save(self,entity,**row):
  return excel.save(entity,excel.Batch(rows=[dict(row=3,**row)]),self.ctx)["results"][0]
 def test_material_price_lifecycle(self):
  material=self.save("raw-materials",command="C",changes=dict(MaterialName="Raw test",UnitOfMeasure="EA"))
  self.assertEqual(material["Status"],"OK",material);self.assertTrue(material["NewMaterialCode"].startswith("RAW-"))
  fields=dict(MaterialCode=material["NewMaterialCode"],CurrencyCode="VND",BaseUoM="EA",QuantityFrom=0,UnitPrice=25000,ExchangeRateToUSD=25000,EffectiveFrom="2026-09-28")
  price=self.save("raw-prices",command="C",changes=fields)
  self.assertEqual(price["Status"],"OK",price)
  self.assertEqual(self.cur.execute("SELECT UnitUSDPrice FROM dbo.RawMaterialPrice WHERE ID=?",price["NewID"]).fetchval(),1)
  duplicate=self.save("raw-prices",command="C",changes=fields)
  self.assertEqual(duplicate["Status"],"ERROR",duplicate);self.assertIn("overlap",duplicate["Message"])
  changed=self.save("raw-prices",command="U",id=price["NewID"],version=price["NewRowVersion"],changes={"UnitPrice":50000})
  self.assertEqual(changed["Status"],"OK",changed)
  self.assertEqual(self.cur.execute("SELECT UnitUSDPrice FROM dbo.RawMaterialPrice WHERE ID=?",price["NewID"]).fetchval(),2)
  stale=self.save("raw-prices",command="U",id=price["NewID"],version=price["NewRowVersion"],changes={"UnitPrice":75000})
  self.assertEqual(stale["Status"],"ERROR",stale)
  blocked=self.save("raw-prices",command="D",id=price["NewID"],version=changed["NewRowVersion"])
  self.assertEqual(blocked["Status"],"OK",blocked)
  again=self.save("raw-prices",command="C",changes=fields)
  self.assertEqual(again["Status"],"OK",again)
  invalid=self.save("raw-materials",command="C",changes=dict(MaterialName="Bad UoM",UnitOfMeasure="not-a-unit"))
  self.assertEqual(invalid["Status"],"ERROR",invalid)

 def test_sql_live_role_and_vendor_currency(self):
  import uuid
  name="raw-"+uuid.uuid4().hex[:16]
  uid=self.cur.execute("INSERT dbo.Users(UserName,IsActive) VALUES(?,1);SELECT CONVERT(INT,SCOPE_IDENTITY())",name).fetchval()
  self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,'RawMaterial')",uid)
  self.ctx=AccessContext(uid,name,frozenset({"RawMaterial"}))
  material=self.save("raw-materials",command="C",changes=dict(MaterialName="Role test",UnitOfMeasure="EA"))
  self.assertEqual(material["Status"],"OK",material)
  currency=self.cur.execute("SELECT ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval()
  vendor=self.cur.execute("INSERT dbo.Vendor(VendorName,CurrencyID,CreatedBy) VALUES(?,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())",name,currency,uid).fetchval()
  price=raw.price_save(batches.PriceBatch(rows=[dict(RowNum=1,Command="C",MaterialID=material["NewID"],VendorID=vendor,BaseUoM="EA",QuantityFrom=0,UnitPrice=2,EffectiveFrom="2026-09-28")]),self.ctx)["results"][0]
  self.assertEqual(price["Status"],"OK",price)
  stored=self.cur.execute("SELECT CurrencyID,ExchangeRateToUSD,UnitUSDPrice FROM dbo.RawMaterialPrice WHERE ID=?",price["NewID"]).fetchone()
  self.assertEqual(tuple(stored),(currency,1,2))
  self.cur.execute("DELETE dbo.UserAccess WHERE UserID=? AND Scope='RawMaterial'",uid)
  from fastapi import HTTPException
  with self.assertRaises(HTTPException) as error:
   raw.material_save(batches.MaterialBatch(rows=[dict(RowNum=1,Command="C",MaterialName="Revoked",UnitOfMeasure="EA")]),self.ctx)
  self.assertEqual(error.exception.status_code,403)

if __name__=="__main__":unittest.main()
