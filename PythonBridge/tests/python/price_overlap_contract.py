"""Overlap regression using rollback-only current-schema fixtures."""
import base64
from unittest.mock import patch
from shipping_copy_price_contract import ShippingCopyPrice
from packaging_fields import consume
import packaging_api as api

class PriceOverlap(ShippingCopyPrice):
 def setUp(self):
  super().setUp()
  self.material_id,self.unit=self.material(False)
 def save_price(self,quantity=1000,start='2026-10-19',resolve=False,**extra):
  def execute(sql,args):
   self.cur.execute(sql,*args);sets=consume(self.cur)
   for rows in sets:
    for row in rows:
     for key,value in list(row.items()):
      if isinstance(value,(bytes,bytearray)):row[key]=base64.b64encode(value).decode()
   return sets
  row=dict(RowNum=1,Command='C',MaterialID=self.material_id,CurrencyID=self.currency,PriceBasis=self.unit,QuantityFrom=quantity,UnitPrice=15,EffectiveFrom=start,ResolveOverlap=resolve,**extra)
  with patch.object(api,'execute',execute):
   return api.price_save(api.PackagingPriceBatch(rows=[row]),self.ctx)['results'][0]
 def records(self):
  return self.cur.execute('SELECT QuantityFrom,QuantityTo,EffectiveFrom,EffectiveTo FROM dbo.PackagingPrice WHERE MaterialID=? ORDER BY ID',self.material_id).fetchall()
 def test_default_overlap_is_row_error(self):
  self.assertEqual(self.save_price()['Status'],'OK')
  result=self.save_price(1,'2026-10-21')
  self.assertEqual(result['Status'],'ERROR')
  self.assertEqual(result['Message'],'Price ranges overlap')
  self.assertEqual(len(self.records()),1)
 def test_new_lower_tier_is_capped(self):
  self.assertEqual(self.save_price()['Status'],'OK')
  self.assertEqual(self.save_price(1,'2026-10-21',True)['Status'],'OK')
  old,new=self.records()
  self.assertEqual((old[0],old[1],old[3]),(1000,None,None))
  self.assertEqual((new[0],new[1],str(new[2]),new[3]),(1,1000,'2026-10-21',None))
 def test_same_tier_replacement_ends_old_date(self):
  self.assertEqual(self.save_price()['Status'],'OK')
  self.assertEqual(self.save_price(1000,'2026-10-21',True)['Status'],'OK')
  old,new=self.records()
  self.assertEqual(str(old[3]),'2026-10-20')
  self.assertEqual((str(new[2]),new[3],new[1]),('2026-10-21',None,None))
 def test_ambiguous_partial_tier_is_rejected(self):
  self.assertEqual(self.save_price()['Status'],'OK')
  self.assertEqual(self.save_price(1200,'2026-10-21',True)['Status'],'ERROR')
  self.assertEqual(len(self.records()),1)
  self.assertIsNone(self.records()[0][3])

 def test_next_of_multiple_tiers_caps_new_quantity(self):
  self.assertEqual(self.save_price(1000,QuantityTo=2000)['Status'],'OK')
  self.assertEqual(self.save_price(2000)['Status'],'OK')
  self.assertEqual(self.save_price(1,'2026-10-21',True)['Status'],'OK')
  self.assertEqual(self.records()[-1][1],1000)
 def test_same_day_replacement_is_rejected(self):
  self.assertEqual(self.save_price()['Status'],'OK')
  self.assertEqual(self.save_price(1000,'2026-10-19',True)['Status'],'ERROR')
  self.assertEqual(len(self.records()),1)
  self.assertIsNone(self.records()[0][3])
 def test_finite_replacement_does_not_discard_old_future_prices(self):
  self.assertEqual(self.save_price()['Status'],'OK')
  self.assertEqual(self.save_price(1000,'2026-10-21',True,EffectiveTo='2026-10-31')['Status'],'ERROR')
  self.assertIsNone(self.records()[0][3])
 def test_different_vendor_is_not_changed(self):
  vendor=self.cur.execute("SELECT TOP(1) ID FROM dbo.Vendor WHERE Status='Active' ORDER BY ID").fetchval()
  if vendor is None:self.skipTest('Active vendor required')
  self.assertEqual(self.save_price(VendorID=vendor)['Status'],'OK')
  self.assertEqual(self.save_price(1000,'2026-10-21',True)['Status'],'OK')
  self.assertIsNone(self.records()[0][3])
 def test_replacement_sets_audit_and_preserves_old_identity(self):
  self.assertEqual(self.save_price()['Status'],'OK')
  old=self.cur.execute('SELECT ID,RowVersion FROM dbo.PackagingPrice WHERE MaterialID=?',self.material_id).fetchone()
  self.assertEqual(self.save_price(1000,'2026-10-21',True)['Status'],'OK')
  updated=self.cur.execute('SELECT ID,RowVersion,UpdatedBy,UpdatedAt FROM dbo.PackagingPrice WHERE ID=?',old[0]).fetchone()
  self.assertEqual(updated[0],old[0])
  self.assertNotEqual(updated[1],old[1])
  self.assertEqual(updated[2],self.actor)
  self.assertIsNotNone(updated[3])

 def test_invalid_price_rolls_back_resolution(self):
  self.assertEqual(self.save_price()['Status'],'OK')
  result=self.save_price(1000,'2026-10-21',True,QuantityTo=999)
  self.assertEqual(result['Status'],'ERROR')
  self.assertIsNone(self.records()[0][3])
