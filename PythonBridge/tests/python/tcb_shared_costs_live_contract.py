"""Opt-in desktop save/reopen verification; the owning transaction always rolls back."""
import os
import sys
import unittest
from decimal import Decimal as D
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
import db
import tcb_api as tcb
from auth import AccessContext
from opportunity_views import sorted_grid


@unittest.skipUnless(os.environ.get('DESKTOP_TCB_SHARED_CHECK')=='1','Opt-in desktop rollback check')
class DesktopSharedCosts(unittest.TestCase):
 def test_parent_packing_and_processing_save_reopen_and_publish_consistently(self):
  self.assertEqual(db.DB_NAME,'test')
  self.assertIn(db.DB_SERVER.lower(),('desktop-5bgmjsc','localhost','.'))
  with db.get_raw_cursor() as cur:
   root=cur.execute("SELECT TOP(1) i.ID FROM dbo.OpportunityItem i JOIN dbo.Opportunity o ON o.ID=i.OpportunityID WHERE o.OpportunityNumber='OPP-2026-10336' AND i.ParentItemID IS NULL ORDER BY i.ID").fetchval()
   child=cur.execute('SELECT TOP(1) ID FROM dbo.OpportunityItem WHERE ParentItemID=? ORDER BY MixChildNumber',root).fetchval()
   actor,name=cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE a.Scope='Admin' AND u.IsActive=1 ORDER BY u.ID").fetchone()
   ctx=AccessContext(actor,name,frozenset({'Admin'}))
   before={i:cur.execute('SELECT TCBCostInfo FROM dbo.OpportunityItem WHERE ID=?',i).fetchval() for i in (root,child)}
   cur.execute('SET QUOTED_IDENTIFIER ON;BEGIN TRANSACTION')
   try:
    with db.reuse_transaction(cur.connection):
     opened=tcb.read(root,ctx)
     tcb.commercial_save(tcb.CommercialSave(RowVersion=opened['item']['RowVersion'],CostInputs={'PackingUSDPerLb':'.35'}),root,ctx)
     self.assertEqual(D(tcb.read(root,ctx)['saved']['Inputs']['PackingUSDPerLb']),D('.35'))
     opened=tcb.read(child,ctx);costs=opened['saved']['Inputs']
     costs['MaterialCosts'][0]['ProcessingUSDPerLb']='.5'
     result=tcb.commercial_save(tcb.CommercialSave(RowVersion=opened['item']['RowVersion'],CostInputs=costs,Prices=costs['Prices']),child,ctx)['saved']
     recipe=result['MaterialCostSnapshots'][0]
     expected=D('.5')*D(recipe['RMUSDPerLb'])/D(recipe['RMWithoutLossUSDPerLb'])
     self.assertAlmostEqual(D(recipe['ProcessingWithLossUSDPerLb']),expected,places=24)
     self.assertEqual(D(tcb.read(child,ctx)['saved']['ProductUSDPerLb']),D(result['ProductUSDPerLb']))
     rows=sorted_grid(name,1,100,'[]',opportunity_number='OPP-2026-10336')['rows']
     row=next(r for r in rows if r['ItemID']==child)
     self.assertAlmostEqual(D(row['TCBPackingPerUnit']),D('.35')*D(row['WeightGrams'])/D('453.59237'),places=11)
     self.assertIsNotNone(row['TCBFOBFinalBoxUSD'])
   finally:cur.execute('IF @@TRANCOUNT>0 ROLLBACK')
   for i,value in before.items():self.assertEqual(cur.execute('SELECT TCBCostInfo FROM dbo.OpportunityItem WHERE ID=?',i).fetchval(),value)


if __name__=='__main__':unittest.main()
