"""Vendor and vendor-scoped Pricing tests. All fixtures roll back."""
import sys,unittest
from pathlib import Path
from contextlib import contextmanager
from unittest.mock import patch
from uuid import uuid4
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
import pyodbc
import packaging_api as api
import packaging_master_excel_api as excel
from auth import AccessContext
from fastapi import HTTPException
class VendorContracts(unittest.TestCase):
 def setUp(self):
  self.conn=pyodbc.connect("DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost;DATABASE=test;Trusted_Connection=yes;TrustServerCertificate=yes",autocommit=True)
  self.addCleanup(self.cleanup);self.c=self.conn.cursor();self.c.execute("SET NOCOUNT ON; BEGIN TRANSACTION")
  actor,user=self.c.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin'").fetchone()
  self.ctx=AccessContext(actor,user,frozenset({"Admin"}))
  @contextmanager
  def cursor():yield self.c
  mock=patch.object(api,"get_raw_cursor",cursor);mock.start();self.addCleanup(mock.stop)
  self.material=self.c.execute("INSERT dbo.PackagingMaterial(MaterialCode,MaterialName,UnitOfMeasure,CreatedBy) VALUES(?,?,'EA',?);SELECT CONVERT(INT,SCOPE_IDENTITY())","VT-"+uuid4().hex[:12],"Test material",actor).fetchval()
  self.c.execute("IF NOT EXISTS(SELECT 1 FROM dbo.UoM WHERE UoMCode='EA') INSERT dbo.UoM(UoMCode,UoMName,CreatedBy) VALUES('EA','Each',?)",actor)
  self.currency=self.c.execute("SELECT TOP(1) ID FROM dbo.Currency ORDER BY ID").fetchval()
 def cleanup(self):
  try:self.conn.cursor().execute("IF @@TRANCOUNT>0 ROLLBACK")
  finally:self.conn.close()
 def vendor(self,**kw):
  row=dict(RowNum=1,Command="C",VendorName="Vendor "+uuid4().hex,Address="Test address");row.update(kw)
  return api.vendor_save(api.VendorBatch(rows=[row]),self.ctx)["results"][0]
 def price(self,**kw):
  row=dict(RowNum=1,Command="C",MaterialID=self.material,CurrencyID=self.currency,PriceBasis="EA",QuantityFrom=0,UnitPrice=10,EffectiveFrom="2026-09-01");row.update(kw)
  return api.price_save(api.PriceBatch(rows=[row]),self.ctx)["results"][0]
 def test_vendor_create_update_block_and_conflict(self):
  v=self.vendor();self.assertEqual(v["Status"],"OK",v)
  u=self.vendor(Command="U",ID=v["NewID"],RowVersion=v["NewRowVersion"],Address=None)
  self.assertEqual(u["Status"],"OK",u)
  stale=self.vendor(Command="U",ID=v["NewID"],RowVersion=v["NewRowVersion"])
  self.assertEqual(stale["Status"],"ERROR")
  d=self.vendor(Command="D",ID=v["NewID"],RowVersion=u["NewRowVersion"])
  self.assertEqual(d["Status"],"OK",d)
  self.assertEqual(self.c.execute("SELECT Status FROM dbo.Vendor WHERE ID=?",v["NewID"]).fetchval(),"Block")
 def test_currency_and_usd_conversion(self):
  currency=self.c.execute("SELECT TOP(1) ID FROM dbo.Currency WHERE CurrencyCode<>'USD'").fetchval()
  self.assertIsNotNone(currency)
  v=self.vendor(CurrencyID=currency)
  self.assertEqual(v["Status"],"OK",v)
  p=self.price(VendorID=v["NewID"],CurrencyID=None,ExchangeRateToUSD="25000",UnitPrice=25000)
  self.assertEqual(p["Status"],"OK",p)
  actual=self.c.execute("SELECT CurrencyID,ExchangeRateToUSD,UnitUSDPrice FROM dbo.PackagingPrice WHERE ID=?",p["NewID"]).fetchone()
  self.assertEqual(actual[0],currency);self.assertEqual(str(actual[2]),"1.00000000")
  u=self.price(Command="U",ID=p["NewID"],RowVersion=p["NewRowVersion"],CurrencyID=currency,UnitPrice=50000)
  self.assertEqual(u["Status"],"OK",u)
  self.assertEqual(str(self.c.execute("SELECT UnitUSDPrice FROM dbo.PackagingPrice WHERE ID=?",p["NewID"]).fetchval()),"2.00000000")
 def test_null_rate_and_readonly_usd(self):
  currency=self.c.execute("SELECT TOP(1) ID FROM dbo.Currency WHERE CurrencyCode<>'USD'").fetchval()
  p=self.price(CurrencyID=currency)
  self.assertEqual(p["Status"],"OK",p)
  self.assertIsNone(self.c.execute("SELECT UnitUSDPrice FROM dbo.PackagingPrice WHERE ID=?",p["NewID"]).fetchval())
  with self.assertRaises(ValueError):api.PriceRow(RowNum=1,Command="C",UnitUSDPrice=10)
  with self.assertRaises(ValueError):api.PriceRow(RowNum=1,Command="C",ExchangeRateToUSD=0)
 def test_vendor_excel_currency(self):
  code=self.c.execute("SELECT CurrencyCode FROM dbo.Currency WHERE ID=?",self.currency).fetchval()
  result=excel.save("vendors",excel.Batch(rows=[dict(row=3,command="C",changes=dict(VendorName="Currency "+uuid4().hex,CurrencyCode=code))]),self.ctx)["results"][0]
  self.assertEqual(result["Status"],"OK",result)
  self.assertEqual(self.c.execute("SELECT CurrencyID FROM dbo.Vendor WHERE ID=?",result["NewID"]).fetchval(),self.currency)
 def test_excel_defaults_currency_from_vendor(self):
  name="Default currency "+uuid4().hex
  v=self.vendor(VendorName=name,CurrencyID=self.currency)
  self.assertEqual(v["Status"],"OK",v)
  code=self.c.execute("SELECT MaterialCode FROM dbo.PackagingMaterial WHERE ID=?",self.material).fetchval()
  result=excel.save("prices",excel.Batch(rows=[dict(row=3,command="C",changes=dict(MaterialCode=code,VendorName=name,PriceBasis="EA",QuantityFrom=0,UnitPrice=10,EffectiveFrom="2026-09-01"))]),self.ctx)["results"][0]
  self.assertEqual(result["Status"],"OK",result)
  self.assertEqual(self.c.execute("SELECT CurrencyID FROM dbo.PackagingPrice WHERE ID=?",result["NewID"]).fetchval(),self.currency)
 def test_uom_admin_concurrency_and_block(self):
  code="UM-"+uuid4().hex[:12]
  def save(**kw):
   row=dict(RowNum=1,Command="C",UoMCode=code,UoMName="Test unit");row.update(kw)
   return api.uom_save(api.UoMBatch(rows=[row]),self.ctx)["results"][0]
  made=save();self.assertEqual(made["Status"],"OK",made)
  changed=save(Command="U",ID=made["NewID"],RowVersion=made["NewRowVersion"],UoMName="Changed")
  self.assertEqual(changed["Status"],"OK",changed)
  self.assertEqual(save(Command="U",ID=made["NewID"],RowVersion=made["NewRowVersion"])["Status"],"ERROR")
  self.assertEqual(save(Command="D",ID=made["NewID"],RowVersion=changed["NewRowVersion"])["Status"],"OK")
  rejected=self.price(PriceBasis=None,BaseUoM=code)
  self.assertEqual(rejected["Status"],"ERROR",rejected)
 def test_uom_packaging_cannot_maintain(self):
  with self.assertRaises(HTTPException) as caught:
   api.uom_save(api.UoMBatch(rows=[dict(RowNum=1,Command="C",UoMCode="NO")]),AccessContext(self.ctx.user_id,self.ctx.username,frozenset({"Packaging"})))
  self.assertEqual(caught.exception.status_code,403)
 def test_base_uom_and_unknown_unit(self):
  result=self.price(PriceBasis=None,BaseUoM="EA")
  self.assertEqual(result["Status"],"OK",result)
  self.assertEqual(self.price(PriceBasis=None,BaseUoM="MISSING-"+uuid4().hex[:10])["Status"],"ERROR")
 def test_material_requires_master_uom(self):
  result=api.material_save(api.MaterialBatch(rows=[dict(RowNum=1,Command="C",MaterialName="Invalid unit",UnitOfMeasure="NO-"+uuid4().hex[:8])]),self.ctx)["results"][0]
  self.assertEqual(result["Status"],"ERROR",result)
 def test_vendor_unique_name(self):
  name="Unique "+uuid4().hex
  self.assertEqual(self.vendor(VendorName=name)["Status"],"OK")
  self.assertEqual(self.vendor(VendorName=name)["Status"],"ERROR")
 def test_prices_can_differ_by_vendor(self):
  a,b=self.vendor(),self.vendor()
  self.assertEqual(self.price(VendorID=a["NewID"])["Status"],"OK")
  self.assertEqual(self.price(VendorID=b["NewID"])["Status"],"OK")
  self.assertEqual(self.price()["Status"],"OK")
  self.assertEqual(self.price(VendorID=a["NewID"])["Status"],"ERROR")
  self.assertEqual(self.price()["Status"],"ERROR")
 def test_omitted_vendor_preserved_and_explicit_null_clears(self):
  v=self.vendor();p=self.price(VendorID=v["NewID"])
  u=self.price(Command="U",ID=p["NewID"],RowVersion=p["NewRowVersion"],UnitPrice=12)
  self.assertEqual(u["Status"],"OK",u)
  self.assertEqual(self.c.execute("SELECT VendorID FROM dbo.PackagingPrice WHERE ID=?",p["NewID"]).fetchval(),v["NewID"])
  cleared=self.price(Command="U",ID=p["NewID"],RowVersion=u["NewRowVersion"],VendorID=None)
  self.assertEqual(cleared["Status"],"OK",cleared)
  self.assertIsNone(self.c.execute("SELECT VendorID FROM dbo.PackagingPrice WHERE ID=?",p["NewID"]).fetchval())
 def test_blocked_vendor_not_new_selection(self):
  v=self.vendor();self.vendor(Command="D",ID=v["NewID"],RowVersion=v["NewRowVersion"])
  self.assertEqual(self.price(VendorID=v["NewID"])["Status"],"ERROR")
 def test_manager_cannot_write(self):
  with self.assertRaises(HTTPException):
   api.vendor_save(api.VendorBatch(rows=[dict(RowNum=1,Command="C",VendorName="No")]),AccessContext(1,"manager",frozenset({"PackagingManager"})))
 def test_vendor_excel_and_pricing_vendor_name(self):
  name="Excel vendor "+uuid4().hex
  result=excel.save("vendors",excel.Batch(rows=[dict(row=3,command="C",changes=dict(VendorName=name,Address="Excel address"))]),self.ctx)["results"][0]
  self.assertEqual(result["Status"],"OK",result)
  code=self.c.execute("SELECT MaterialCode FROM dbo.PackagingMaterial WHERE ID=?",self.material).fetchval()
  currency=self.c.execute("SELECT CurrencyCode FROM dbo.Currency WHERE ID=?",self.currency).fetchval()
  price=excel.save("prices",excel.Batch(rows=[dict(row=3,command="C",changes=dict(MaterialCode=code,VendorName=name,CurrencyCode=currency,PriceBasis="EA",QuantityFrom=0,UnitPrice=10,EffectiveFrom="2026-09-01"))]),self.ctx)["results"][0]
  self.assertEqual(price["Status"],"OK",price)
  self.assertEqual(self.c.execute("SELECT VendorID FROM dbo.PackagingPrice WHERE ID=?",price["NewID"]).fetchval(),result["NewID"])
if __name__=="__main__":unittest.main()
