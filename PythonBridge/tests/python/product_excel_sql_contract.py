"""Product Excel patch adapter against real SQL; all changes roll back."""
import sys
import unittest
from contextlib import contextmanager
from unittest.mock import patch
from packaging_field_foundation_contract import PackagingFoundation, ROOT
sys.path.insert(0,str(ROOT/"core"))
import product_excel_api as excel
import packaging_fields
from auth import AccessContext
from db import bytes_to_b64

class ExcelSave(unittest.TestCase):
 setup_base=PackagingFoundation.setUp
 cleanup=PackagingFoundation.cleanup
 def setUp(self):
  self.setup_base()
  import re
  for batch in re.split(r"^GO\s*$",(ROOT/"sql/26_product_partial_updates.sql").read_text(),flags=re.M|re.I):
   if batch.strip():
    self.cur.execute(batch)
    while self.cur.nextset():pass
  @contextmanager
  def cursor():yield self.cur
  for module in (excel,packaging_fields):
   mock=patch.object(module,"get_raw_cursor",cursor);mock.start();self.addCleanup(mock.stop)
  self.ctx=AccessContext(self.actor,self.username,frozenset({"Admin"}))
 def test_update_preserves_omitted_fields(self):
  before=self.cur.execute("SELECT ProductCode,ProductName,WeightGrams,Category,Grade,RowVersion FROM dbo.Product WHERE ID=?",self.product).fetchone()
  result=excel.save(excel.Batch(rows=[dict(row=3,command="U",id=self.product,version=bytes_to_b64(before.RowVersion),changes={"Grade":"Excel test grade"})]),self.ctx)
  self.assertEqual(result["results"][0]["Status"],"OK",result)
  after=self.cur.execute("SELECT ProductCode,ProductName,WeightGrams,Category,Grade FROM dbo.Product WHERE ID=?",self.product).fetchone()
  self.assertEqual(tuple(after)[:4],tuple(before)[:4])
  self.assertEqual(after.Grade,"Excel test grade")
 def test_stale_version_returns_error(self):
  before=self.cur.execute("SELECT RowVersion FROM dbo.Product WHERE ID=?",self.product).fetchval()
  self.cur.execute("UPDATE dbo.Product SET Grade=Grade WHERE ID=?",self.product)
  result=excel.save(excel.Batch(rows=[dict(row=3,command="U",id=self.product,version=bytes_to_b64(before),changes={"Grade":"Must not save"})]),self.ctx)
  self.assertEqual(result["results"][0]["Status"],"ERROR",result)

 def test_create_then_block(self):
  from uuid import uuid4
  code="XL-"+uuid4().hex[:12]
  created=excel.save(excel.Batch(rows=[dict(row=3,command="C",changes=dict(ProductCode=code,ProductName=code,Category="Excel test",WeightGrams=125))]),self.ctx)["results"][0]
  self.assertEqual(created["Status"],"OK",created)
  blocked=excel.save(excel.Batch(rows=[dict(row=3,command="D",id=created["NewID"],version=created["NewRowVersion"])]),self.ctx)["results"][0]
  self.assertEqual(blocked["Status"],"OK",blocked)
  self.assertEqual(self.cur.execute("SELECT Status FROM dbo.Product WHERE ID=?",created["NewID"]).fetchval(),"Block")

if __name__=="__main__": unittest.main()
