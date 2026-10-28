"""Converted pallet costs must round-trip through the TCB input boundary."""
import sys,unittest
from pathlib import Path
from decimal import Decimal
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'core'))
import tcb_api as api
from tcb_costs import Inputs
from pallet_currency import pallet_usd

class PalletPrecision(unittest.TestCase):
 def test_repeating_fx_does_not_block_commercial_entry(self):
  converted=pallet_usd({'UnitPrice':'300000','CurrencyCode':'VND'}, {'ExchangeRateVNDPerUSD':'26500'})
  item=dict(RowVersion='rv',IsMixParent=True,ParentItemID=None,WeightGrams=100,LossLayerCount=2,TCBCostInfo=None,ProductGradeSnapshot=None,DefaultPalletUSDPerEA=converted)
  saved,*_=api.commercial_value(api.CommercialSave(RowVersion='rv',CostInputs={}),item,None,None)
  restored=Inputs(**saved['Inputs'])
  self.assertEqual(restored.PalletUSDPerEA,Decimal('11.320755'))

 def test_regular_product_commercial_entry_also_accepts_repeating_fx(self):
  item=dict(RowVersion='rv',IsMixParent=False,ParentItemID=None,WeightGrams=100,LossLayerCount=2,TCBCostInfo=None,ProductGradeSnapshot=None,DefaultPalletUSDPerEA=Decimal(300000)/Decimal(26500))
  saved,*_=api.commercial_value(api.CommercialSave(RowVersion='rv',CostInputs={},Prices=[]),item,None,None)
  self.assertEqual(Inputs(**saved['Inputs']).PalletUSDPerEA,Decimal('11.320755'))
 def test_rounding_zero_blank_child_and_existing_money(self):
  for value,expected in [('11.1234565','11.123457'),('11.1234564','11.123456'),('15.25','15.25'),('0','0')]:
   with self.subTest(value=value):self.assertEqual(api.palletization_usd({'DefaultPalletUSDPerEA':value}),Decimal(expected))
  self.assertIsNone(api.palletization_usd({'DefaultPalletUSDPerEA':None}))
  self.assertIsNone(api.palletization_usd({'ParentItemID':1,'DefaultPalletUSDPerEA':'15'}))
 def test_entered_money_limits_remain_strict(self):
  from pydantic import ValidationError
  with self.assertRaises(ValidationError):Inputs(ProcessingUSDPerLb='1.1234567')

class PalletPrecisionSQL(unittest.TestCase):
 def test_read_commercial_validation_save_and_reopen_with_repeating_fx(self):
  import json,db
  from contextlib import ExitStack
  from auth import AccessContext
  if db.DB_NAME!='test' or db.DB_SERVER.lower() not in ('desktop-5bgmjsc','localhost','.'):
   self.skipTest('Desktop test only')
  with db.get_raw_cursor() as cur,ExitStack() as stack:
   cur.execute('SET NOCOUNT ON; SET QUOTED_IDENTIFIER ON; BEGIN TRANSACTION')
   stack.callback(lambda:cur.execute('IF @@TRANCOUNT>0 ROLLBACK'))
   stack.enter_context(db.reuse_transaction(cur.connection))
   actor,name=cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin'").fetchone()
   ctx=AccessContext(actor,name,frozenset({'Admin'}))
   found=cur.execute("""SELECT TOP(1) i.ID,o.ID,s.ID FROM dbo.OpportunityItem i JOIN dbo.Opportunity o ON o.ID=i.OpportunityID
    JOIN dbo.v_OpportunityItemPackaging p ON p.OpportunityItemID=i.ID
    JOIN dbo.PackagingConfigurationRequestItem r ON r.ID=p.PackagingRequestItemID
    JOIN dbo.PalletPricingSnapshot s ON s.ID=r.PalletPricingID
    WHERE i.ParentItemID IS NULL AND i.Stage='Draft' AND o.Stage='Draft'
    AND NOT EXISTS(SELECT 1 FROM dbo.OpportunityItem child WHERE child.ParentItemID=i.ID) ORDER BY i.ID DESC""").fetchone()
   if not found:self.skipTest('No approved standalone pallet fixture')
   item,header,snapshot=found
   targets=[('OpportunityItem',item),('Opportunity',header),('PalletPricingSnapshot',snapshot)]
   def captured(table,identity):return ''.join(r[0] for r in cur.execute('SELECT * FROM dbo.['+table+'] WHERE ID=? FOR JSON PATH,INCLUDE_NULL_VALUES',identity).fetchall())
   before={(table,identity):captured(table,identity) for table,identity in targets}
   try:
    cur.execute('UPDATE dbo.Opportunity SET ExchangeRateVNDPerUSD=26500 WHERE ID=?',header)
    cur.execute("UPDATE dbo.PalletPricingSnapshot SET SnapshotJSON=JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(SnapshotJSON,'$.UnitPrice','300000'),'$.CurrencyCode','VND'),'$.UnitUSDPrice',NULL) WHERE ID=?",snapshot)
    cur.execute('UPDATE dbo.OpportunityItem SET TCBCostInfo=NULL WHERE ID=?',item)
    opened=api.read(item,ctx)
    self.assertEqual(opened['item']['DefaultPalletUSDPerEA'],Decimal('11.320755'))
    self.assertEqual(Inputs(**opened['saved']['Inputs']).PalletUSDPerEA,Decimal('11.320755'))
    body=api.CommercialSave(RowVersion=opened['item']['RowVersion'],CostInputs={},Prices=[])
    proposed,*_=api.commercial_value(body,opened['item'],ctx,cur)
    self.assertEqual(Inputs(**proposed['Inputs']).PalletUSDPerEA,Decimal('11.320755'))
    saved=api.commercial_save(body,item,ctx)
    self.assertEqual(cur.execute('SELECT @@TRANCOUNT').fetchval(),1,'Keep save inside rollback-only fixture')
    self.assertEqual(Inputs(**saved['saved']['Inputs']).PalletUSDPerEA,Decimal('11.320755'))
    reopened=api.read(item,ctx)
    self.assertEqual(Inputs(**reopened['saved']['Inputs']).PalletUSDPerEA,Decimal('11.320755'))
   finally:
    cur.execute('IF @@TRANCOUNT>0 ROLLBACK')
    for table,identity in targets:self.assertEqual(captured(table,identity),before[(table,identity)],table+' restored including rowversions')

if __name__=='__main__':unittest.main()
