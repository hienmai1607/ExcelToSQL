"""Shared Material/Pricing adapter integration. Local SQL fixtures roll back."""
import sys,unittest
from contextlib import contextmanager
from unittest.mock import patch
from uuid import uuid4
from packaging_field_foundation_contract import PackagingFoundation,ROOT
sys.path.insert(0,str(ROOT/"core"))
import packaging_master_excel_api as excel
import packaging_api
from auth import AccessContext
class MasterExcelSQL(unittest.TestCase):
 setup_base=PackagingFoundation.setUp
 cleanup=PackagingFoundation.cleanup
 def setUp(self):
  self.setup_base()
  @contextmanager
  def cursor():yield self.cur
  mock=patch.object(packaging_api,"get_raw_cursor",cursor);mock.start();self.addCleanup(mock.stop)
  self.ctx=AccessContext(self.actor,self.username,frozenset({"Admin"}))
  self.code="XL-"+uuid4().hex[:12]
  r=self.save("materials",command="C",changes=dict(MaterialCode=self.code,MaterialName=self.code,Description="Keep hidden",UnitOfMeasure="EA"))
  self.assertEqual(r["Status"],"OK",r);self.material=r
 def save(self,entity,**row):
  return excel.save(entity,excel.Batch(rows=[dict(row=3,**row)]),self.ctx)["results"][0]
 def create_price(self):
  return self.save("prices",command="C",changes=dict(MaterialCode=self.code,CurrencyCode="VND",PriceBasis="EA",QuantityFrom="0",QuantityTo=None,UnitPrice="12.3456",EffectiveFrom="2026-09-19",EffectiveTo=None))
 def test_material_update_then_block(self):
  r=self.save("materials",command="U",id=self.material["NewID"],version=self.material["NewRowVersion"],changes={"MaterialName":self.code+" changed"})
  self.assertEqual(r["Status"],"OK",r)
  self.assertEqual(self.cur.execute("SELECT Description FROM dbo.PackagingMaterial WHERE ID=?",r["NewID"]).fetchval(),"Keep hidden")
  blocked=self.save("materials",command="D",id=r["NewID"],version=r["NewRowVersion"])
  self.assertEqual(blocked["Status"],"OK",blocked)
  self.assertEqual(self.cur.execute("SELECT Status FROM dbo.PackagingMaterial WHERE ID=?",r["NewID"]).fetchval(),"Block")
 def test_price_create_update_null_then_block(self):
  r=self.create_price();self.assertEqual(r["Status"],"OK",r)
  changed=self.save("prices",command="U",id=r["NewID"],version=r["NewRowVersion"],changes={"UnitPrice":"15.6789","EffectiveTo":None})
  self.assertEqual(changed["Status"],"OK",changed)
  row=self.cur.execute("SELECT UnitPrice,QuantityTo,EffectiveFrom,EffectiveTo FROM dbo.PackagingPrice WHERE ID=?",r["NewID"]).fetchone()
  self.assertEqual(str(row.UnitPrice),"15.6789");self.assertIsNone(row.QuantityTo);self.assertIsNone(row.EffectiveTo);self.assertEqual(str(row.EffectiveFrom),"2026-09-19")
  blocked=self.save("prices",command="D",id=r["NewID"],version=changed["NewRowVersion"])
  self.assertEqual(blocked["Status"],"OK",blocked)
 def test_stale_price_rejected(self):
  r=self.create_price();self.assertEqual(r["Status"],"OK",r)
  self.cur.execute("UPDATE dbo.PackagingPrice SET UnitPrice=20 WHERE ID=?",r["NewID"])
  stale=self.save("prices",command="U",id=r["NewID"],version=r["NewRowVersion"],changes={"UnitPrice":"25"})
  self.assertEqual(stale["Status"],"ERROR",stale)
 def test_overlap_rejected(self):
  r=self.create_price();self.assertEqual(r["Status"],"OK",r)
  duplicate=self.create_price()
  self.assertEqual(duplicate["Status"],"ERROR",duplicate)
if __name__=="__main__":unittest.main()
