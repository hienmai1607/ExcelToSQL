"""Current-schema Mix child 3 + parent 1 loss-save verification; rollback only."""
import sys,unittest,json
from pathlib import Path
from contextlib import ExitStack
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'core'))
import db,tcb_api as api
from auth import AccessContext

class MixLossSQL(unittest.TestCase):
 def test_three_child_layers_one_parent_layer_save_and_reopen(self):
  if db.DB_NAME!='test' or db.DB_SERVER.lower() not in ('desktop-5bgmjsc','localhost','.'):
   self.skipTest('Desktop test only')
  with db.get_raw_cursor() as cur,ExitStack() as stack:
   cur.execute('SET NOCOUNT ON; SET QUOTED_IDENTIFIER ON; BEGIN TRANSACTION')
   stack.callback(lambda:cur.execute('IF @@TRANCOUNT>0 ROLLBACK'))
   stack.enter_context(db.reuse_transaction(cur.connection))
   actor,name=cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin'").fetchone()
   ctx=AccessContext(actor,name,frozenset({'Admin'}))
   found=cur.execute("""SELECT TOP(1) p.ID,r.RequestID FROM dbo.OpportunityItem p JOIN dbo.Opportunity o ON o.ID=p.OpportunityID
    JOIN dbo.PackagingConfigurationRequestItem r ON r.OpportunityItemID=p.ID
    WHERE p.ParentItemID IS NULL AND p.Stage='Draft' AND o.Stage='Draft'
    AND EXISTS(SELECT 1 FROM dbo.OpportunityItem child JOIN dbo.PackagingConfigurationRequestItem cr ON cr.OpportunityItemID=child.ID
     WHERE child.ParentItemID=p.ID AND child.ProductGradeSnapshot IS NOT NULL AND cr.RequestID=r.RequestID)
    ORDER BY r.ID DESC""").fetchone()
   if not found:self.skipTest('No captured Mix family fixture')
   parent,request=found
   def state():
    return [tuple(r) for r in cur.execute('SELECT ID,RowVersion,TCBCostInfo FROM dbo.OpportunityItem WHERE ID=? OR ParentItemID=? ORDER BY ID',parent,parent).fetchall()]+[tuple(r) for r in cur.execute('SELECT ID,RowVersion,Stage,IsOpen,ResponseLayerCount FROM dbo.PackagingConfigurationRequestItem WHERE RequestID=? ORDER BY ID',request).fetchall()]
   before=state()
   try:
    cur.execute("UPDATE r SET Stage='Approved',IsOpen=0,ResponseLayerCount=CASE WHEN i.ID=? THEN 1 ELSE 3 END FROM dbo.PackagingConfigurationRequestItem r JOIN dbo.OpportunityItem i ON i.ID=r.OpportunityItemID WHERE r.RequestID=? AND (i.ID=? OR i.ParentItemID=?)",parent,request,parent,parent)
    cur.execute('UPDATE dbo.OpportunityItem SET TCBCostInfo=NULL WHERE ID=? OR ParentItemID=?',parent,parent)
    child=cur.execute('SELECT TOP(1) ID FROM dbo.OpportunityItem WHERE ParentItemID=? AND ProductGradeSnapshot IS NOT NULL ORDER BY ID',parent).fetchval()
    source=cur.execute("""SELECT TOP(1) i.ProductGradeSnapshot FROM dbo.OpportunityItem i
     JOIN dbo.v_OpportunityItemPackaging published ON published.OpportunityItemID=i.ID
     WHERE i.ParentItemID IS NULL AND JSON_QUERY(i.ProductGradeSnapshot,'$.items') IS NOT NULL
     AND JSON_QUERY(i.ProductGradeSnapshot,'$.items')<>'[]'
     AND NOT EXISTS(SELECT 1 FROM dbo.OpportunityItem c WHERE c.ParentItemID=i.ID) ORDER BY i.ID DESC""").fetchval()
    self.assertIsNotNone(source,'Use a captured grade tree for the rollback-only child fixture')
    cur.execute('UPDATE dbo.OpportunityItem SET ProductGradeSnapshot=? WHERE ID=?',source,child)
    for identity,mix in ((parent,True),(child,False)):
     opened=api.read(identity,ctx)
     self.assertEqual(opened['item']['LossLayerCount'],1 if mix else 3)
     self.assertEqual(opened['item']['PackagingLayerStart'],4 if mix else 1)
     steps=[dict(ProcessType='MixPrimaryPackaging',Sequence=1,LossPct='4')] if mix else [dict(ProcessType=layer+'Packaging',Sequence=1,LossPct=str(index+1)) for index,layer in enumerate(('Primary','Secondary','Tertiary'))]
     prices=[] if mix else [dict(Path=opened['grades'][0]['Path'],DirectUSDPerLb='0.1')]
     for _ in range(2):
      saved=api.commercial_save(api.CommercialSave(RowVersion=opened['item']['RowVersion'],CostInputs={},Inputs={'LossProcesses':steps},Prices=prices),identity,ctx)
      self.assertEqual(cur.execute('SELECT @@TRANCOUNT').fetchval(),1)
      self.assertEqual([r['ProcessType'] for r in saved['saved']['Inputs']['LossProcesses']],[r['ProcessType'] for r in steps])
      opened=api.read(identity,ctx)
      self.assertEqual(opened['saved']['Inputs']['MixPrimaryLossPct' if mix else 'TertiaryLossPct'],'4.00' if mix else '3.00')
      if not mix:self.assertEqual(opened['saved']['Inputs']['Prices'][0]['DirectUSDPerLb'],'0.1')
   finally:
    cur.execute('IF @@TRANCOUNT>0 ROLLBACK')
    self.assertEqual(state(),before,'Original family restored including rowversions')

if __name__=='__main__':unittest.main()
