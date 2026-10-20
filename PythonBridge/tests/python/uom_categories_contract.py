"""UoM metadata, mass conversion and profile preferences. SQL fixtures always roll back."""
import sys,uuid,unittest
from decimal import Decimal
from pathlib import Path
from contextlib import contextmanager
from unittest.mock import patch
from pydantic import ValidationError
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"core"))
from db import get_raw_cursor
from auth import AccessContext
from preferences_api import Settings
from schemas import ProductRow
from packaging_api import UoMBatch,UoMRow,uom_save
import uom_categories as units

class UnitCategories(unittest.TestCase):
 def setUp(self):
  self.handle=get_raw_cursor();self.cur=self.handle.__enter__()
  self.cur.execute("SET NOCOUNT ON;SET QUOTED_IDENTIFIER ON;BEGIN TRANSACTION")
  self.cur.execute((ROOT/"sql/126_uom_categories.sql").read_text())
  while self.cur.nextset():pass
  actor=self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin'").fetchone()
  self.ctx=AccessContext(actor[0],actor[1],frozenset({"Admin"}))
  self.code="mass-"+uuid.uuid4().hex[:10]
  @contextmanager
  def shared():yield self.cur
  self.shared=patch("uom_categories.get_raw_cursor",shared);self.shared.start()
 def tearDown(self):
  self.shared.stop()
  self.cur.execute("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION")
  self.handle.__exit__(None,None,None)
 def test_seeded_mass_conversion_uses_server_factor(self):
  self.assertEqual(units.product_weight("0.395","KG"),(Decimal("395.0000"),"g"))
  self.assertEqual(units.product_weight("1","lbs"),(Decimal("453.5924"),"g"))
  with self.assertRaisesRegex(ValueError,"Weight/Mass"):units.product_weight("5","mm")
 def test_admin_can_create_and_update_categorized_units_with_current_version(self):
  saved=uom_save(UoMBatch(rows=[UoMRow(RowNum=1,Command="C",UoMCode=self.code,UoMName="Test mass",Category="Weight/Mass",BaseFactor="2")]),self.ctx)["results"][0]
  self.assertEqual(saved["Status"],"OK",saved)
  self.assertEqual(units.product_weight("3",self.code),(Decimal("6.0000"),"g"))
  changed=uom_save(UoMBatch(rows=[UoMRow(RowNum=1,Command="U",ID=saved["NewID"],RowVersion=saved["NewRowVersion"],UoMCode=self.code,UoMName="Test mass",Category="Weight/Mass",BaseFactor="4")]),self.ctx)["results"][0]
  self.assertEqual(changed["Status"],"OK",changed)
  self.assertEqual(units.product_weight("3",self.code),(Decimal("12.0000"),"g"))
  stale=uom_save(UoMBatch(rows=[UoMRow(RowNum=1,Command="U",ID=saved["NewID"],RowVersion=saved["NewRowVersion"],UoMCode=self.code,UoMName="Stale")]),self.ctx)["results"][0]
  self.assertEqual(stale["Status"],"ERROR",stale)
 def test_non_admin_cannot_write_unit_metadata(self):
  from fastapi import HTTPException
  with self.assertRaises(HTTPException) as error:uom_save(UoMBatch(rows=[UoMRow(RowNum=1,Command="C",UoMCode=self.code)]),AccessContext(1,"test",frozenset({"Product"})))
  self.assertEqual(error.exception.status_code,403)
 def test_blocked_mass_unit_is_not_accepted(self):
  self.cur.execute("UPDATE dbo.UoM SET Status='Block' WHERE UoMCode='KG'")
  with self.assertRaisesRegex(ValueError,"active"):units.product_weight("1","KG")
 def test_migration_does_not_overwrite_admin_factor_on_rerun(self):
  self.cur.execute("UPDATE dbo.UoM SET BaseFactor=999 WHERE UoMCode='KG'")
  self.cur.execute((ROOT/"sql/126_uom_categories.sql").read_text())
  while self.cur.nextset():pass
  self.assertEqual(self.cur.execute("SELECT BaseFactor FROM dbo.UoM WHERE UoMCode='KG'").fetchval(),Decimal(999))
 def test_product_route_converts_before_legacy_tvp_and_ignores_client_factors(self):
  from main import product_batch
  from schemas import ProductBatchRequest
  row=ProductRow(RowNum=1,Command="C",ProductName="Test",WeightValue=.395,WeightUnit="KG",BaseFactor=999)
  response=[{"RowNum":1,"Status":"OK","NewID":1,"NewRowVersion":None}]
  with patch("main.enriched_batch",return_value=[response]) as batch:
   product_batch(ProductBatchRequest(rows=[row]),self.ctx.username,True,frozenset({"Admin"}))
   values=batch.call_args.args[1][0][0]
   self.assertEqual(values[5:7],(Decimal("395.0000"),"g"))

 def test_real_product_save_stores_canonical_grams_atomically(self):
  from main import product_batch
  from schemas import ProductBatchRequest
  customer=self.cur.execute("SELECT TOP(1) ID FROM dbo.Customer WHERE Status='Active'").fetchval()
  if customer is None:self.skipTest("No active customer fixture is available.")
  category=self.cur.execute("SELECT TOP(1) CategoryName FROM dbo.ProductCategory WHERE Status='Active'").fetchval()
  if category is None:self.skipTest("No active category fixture is available.")
  @contextmanager
  def shared():yield self.cur
  row=ProductRow(RowNum=1,Command="C",CustomerID=customer,ProductName=self.code,Category=category,WeightValue=.395,WeightUnit="KG")
  with patch("packaging_fields.get_raw_cursor",shared):
   saved=product_batch(ProductBatchRequest(rows=[row]),self.ctx.username,True,frozenset({"Admin"}))["results"][0]
  self.assertEqual(saved["Status"],"OK",saved)
  self.assertEqual(self.cur.execute("SELECT WeightGrams FROM dbo.Product WHERE ID=?",saved["NewID"]).fetchval(),Decimal("395.00"))
  self.assertEqual(self.cur.execute("SELECT @@TRANCOUNT").fetchval(),1)

class DatePreferences(unittest.TestCase):
 def test_legacy_profiles_receive_valid_defaults(self):
  self.assertEqual(Settings().date_format,"mm/dd/yyyy")
  self.assertEqual(Settings().time_format,"12h")
 def test_unsupported_formats_are_rejected(self):
  with self.assertRaises(ValidationError):Settings(date_format="browser magic")
  with self.assertRaises(ValidationError):Settings(time_format="unsafe")
 def test_product_schema_accepts_uom_codes_and_rejects_nonfinite_weights(self):
  self.assertEqual(ProductRow(RowNum=1,Command="C",WeightUnit="KG",WeightValue=1).weight_unit,"KG")
  with self.assertRaises(ValidationError):ProductRow(RowNum=1,Command="C",WeightValue=float("inf"))

if __name__=="__main__":unittest.main()
