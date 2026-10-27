"""Material availability is independent of pricing; all fixture changes roll back."""
import sys,unittest
from pathlib import Path
from contextlib import ExitStack
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'core'))
import db
from auth import AccessContext
import pallet_pricing_api as api

class UnpricedPallet(unittest.TestCase):
 def setUp(self):
  if db.DB_NAME!='test':self.skipTest('Desktop test only')
  self.stack=ExitStack();self.addCleanup(self.stack.close)
  self.cur=self.stack.enter_context(db.get_raw_cursor())
  self.cur.execute('SET QUOTED_IDENTIFIER ON; BEGIN TRANSACTION')
  self.stack.callback(lambda:self.cur.execute('IF @@TRANCOUNT>0 ROLLBACK'))
  self.stack.enter_context(db.reuse_transaction(self.cur.connection))
  migration=ROOT/'sql/151_unpriced_pallet_material_choices.sql'
  if migration.exists():
   for _ in range(2):
    self.cur.execute(migration.read_text(encoding='utf-8'))
    while self.cur.nextset():pass
  actor,name=self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin'").fetchone()
  self.ctx=AccessContext(actor,name,frozenset({'Admin'}))
  self.mid=self.cur.execute("SELECT TOP(1) m.ID FROM dbo.PackagingMaterial m JOIN dbo.PackagingType t ON t.ID=m.PackagingTypeID WHERE t.PackagingType='Pallet' AND m.Status='Active' ORDER BY m.ID DESC").fetchval()
  self.cur.execute("UPDATE dbo.PackagingPrice SET Status='Block' WHERE MaterialID=?",self.mid)
 def test_unpriced_material_in_dropdown_catalog_and_footprint(self):
  row=next((r for r in api.pallet_choices(self.ctx)['rows'] if r['ID']==self.mid),None)
  self.assertIsNotNone(row,'Unpriced active material must be selectable')
  catalog=next((r for r in api.catalog(self.cur,include_unpriced=True) if r['MaterialID']==self.mid),None)
  self.assertIsNotNone(catalog,'Calculator must offer Add Pricing for unpriced pallet')
  self.assertIsNone(catalog['ID'])
  self.assertTrue(catalog['IsPallet'])
  self.assertIsNotNone(self.cur.execute("SELECT ID FROM dbo.v_PalletSizeChoice WHERE PalletSize=? AND ChoiceSource='Material'",row['PalletSize']).fetchval())
 def test_new_price_becomes_calculable_without_recreating_material(self):
  from packaging_api import price_save,PackagingPriceBatch
  currency=self.cur.execute("SELECT ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval()
  result=price_save(PackagingPriceBatch(rows=[dict(RowNum=1,Command='C',MaterialID=self.mid,CurrencyID=currency,BaseUoM='EA',QuantityFrom=0,UnitPrice=15,EffectiveFrom='2000-01-01')]),self.ctx)['results'][0]
  self.assertEqual(result['Status'],'OK',result)
  row=next(r for r in api.catalog(self.cur) if r['ID']==result['NewID'])
  size=next(r['PalletSize'] for r in api.pallet_choices(self.ctx)['rows'] if r['ID']==self.mid)
  calculated=api.calculate(self.cur,api.Selection(PalletSize=size,PalletMaterialID=self.mid,components=[dict(PriceID=row['ID'],RowVersion=row['RowVersion'],MaterialRowVersion=row['MaterialRowVersion'],Quantity=1)]))
  self.assertEqual(calculated['UnitPrice'],'15.0000')
 def test_capacity_proposal_does_not_require_price(self):
  from pallet_capacity_api import preview,Preview
  item=self.cur.execute("SELECT TOP(1) ID FROM dbo.PackagingConfigurationRequestItem WHERE Stage='Assigned' ORDER BY ID DESC").fetchval()
  result=preview(item,Preview(PalletMaterialID=self.mid,Carton=dict(length=200,width=200,height=200),CartonGrossKG=1,TareKG=20,MaxPalletHeightMM=1800),self.ctx)
  self.assertGreater(result['cartons_per_layer'],0)
 def test_blocked_material_stays_unavailable(self):
  self.cur.execute("UPDATE dbo.PackagingMaterial SET Status='Block' WHERE ID=?",self.mid)
  self.assertFalse(any(r['ID']==self.mid for r in api.pallet_choices(self.ctx)['rows']))
 def test_unpriced_material_cannot_be_used_as_a_free_price(self):
  from fastapi import HTTPException
  with self.assertRaises(HTTPException):api.calculate(self.cur,api.Selection(PalletSize='800x1200mm',PalletMaterialID=self.mid,components=[dict(PriceID=2147483647,RowVersion="missing",MaterialRowVersion="missing",Quantity=1)]))

if __name__=='__main__':unittest.main()
