"""Real direct-price saves with four loss layers; all fixture edits roll back."""
import sys,json,unittest
from pathlib import Path
from contextlib import ExitStack
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'core'))
import db,tcb_api as api
from auth import AccessContext

class QuaternaryLossSQL(unittest.TestCase):
 def setUp(self):
  if db.DB_NAME!='test' or db.DB_SERVER.lower() not in ('desktop-5bgmjsc','localhost','.'):
   self.skipTest('Desktop test only')
  self.stack=ExitStack();self.addCleanup(self.stack.close)
  self.cur=self.stack.enter_context(db.get_raw_cursor())
  self.cur.execute('SET NOCOUNT ON; SET QUOTED_IDENTIFIER ON; BEGIN TRANSACTION')
  self.stack.callback(lambda:self.cur.execute('IF @@TRANCOUNT>0 ROLLBACK'))
  self.stack.enter_context(db.reuse_transaction(self.cur.connection))
  actor,name=self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin'").fetchone()
  self.ctx=AccessContext(actor,name,frozenset({'Admin'}))
  found=self.cur.execute("""SELECT TOP(1) i.ID,r.ID FROM dbo.OpportunityItem i JOIN dbo.Opportunity o ON o.ID=i.OpportunityID
   JOIN dbo.v_OpportunityItemPackaging published ON published.OpportunityItemID=i.ID
   JOIN dbo.PackagingConfigurationRequestItem r ON r.ID=published.PackagingRequestItemID
   WHERE i.ParentItemID IS NULL AND i.Stage='Draft' AND o.Stage='Draft' AND i.ProductGradeSnapshot IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM dbo.OpportunityItem child WHERE child.ParentItemID=i.ID) ORDER BY i.ID DESC""").fetchone()
  if not found:self.skipTest('No standalone approved response fixture')
  self.item,self.response=found
  self.before=self.capture()
  migration=ROOT/'sql/152_tcb_quaternary_loss_assignment.sql'
  if migration.exists():
   for _ in range(2):
    self.cur.execute(migration.read_text(encoding='utf-8'))
    while self.cur.nextset():pass
  self.cur.execute('UPDATE dbo.PackagingConfigurationRequestItem SET ResponseLayerCount=4 WHERE ID=?',self.response)
  self.cur.execute('UPDATE dbo.OpportunityItem SET TCBCostInfo=NULL WHERE ID=?',self.item)
 def capture(self):
  return [tuple(r) for r in self.cur.execute('SELECT RowVersion,TCBCostInfo FROM dbo.OpportunityItem WHERE ID=?',self.item).fetchall()]+[tuple(r) for r in self.cur.execute('SELECT RowVersion,ResponseLayerCount FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.response).fetchall()]
 def tearDown(self):
  if not hasattr(self,'before'):return
  self.cur.execute('IF @@TRANCOUNT>0 ROLLBACK')
  self.assertEqual(self.capture(),self.before,'Fixture data and rowversions restored')
 def test_direct_point_one_saves_twice_with_four_packaging_loss_rows(self):
  opened=api.read(self.item,self.ctx)
  self.assertEqual(opened['item']['LossLayerCount'],4)
  leaf=opened['grades'][0]['Path']
  steps=[dict(ProcessType=layer+'Packaging',Sequence=1,LossPct='0') for layer in ('Primary','Secondary','Tertiary','Quaternary')]
  for value in ('0.1','0.2'):
   body=api.CommercialSave(RowVersion=opened['item']['RowVersion'],CostInputs={},Inputs={'LossProcesses':steps},Prices=[dict(Path=leaf,DirectUSDPerLb=value)])
   saved=api.commercial_save(body,self.item,self.ctx)
   self.assertEqual(self.cur.execute('SELECT @@TRANCOUNT').fetchval(),1)
   self.assertEqual(saved['saved']['Inputs']['Prices'][0]['DirectUSDPerLb'],value)
   self.assertEqual(saved['saved']['Inputs']['LossProcesses'][-1]['ProcessType'],'QuaternaryPackaging')
   opened=api.read(self.item,self.ctx)
   self.assertEqual(opened['saved']['Inputs']['Prices'][0]['DirectUSDPerLb'],value)

 def reject_sql_assignment(self,step):
  version=self.cur.execute('SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?',self.item).fetchval()
  with self.assertRaisesRegex(Exception,'Loss assignment changed or is invalid'):
   self.cur.execute('EXEC dbo.usp_OpportunityTCB_Save ?,?,?,?,?',self.ctx.username,self.item,version,json.dumps({'Inputs':{'LossProcesses':[step]}}),1)
 def test_new_quaternary_sequence_two_still_rejected(self):
  self.reject_sql_assignment(dict(ProcessType='QuaternaryPackaging',Sequence=2,LossPct=0))
 def test_invalid_loss_percentage_still_rejected(self):
  self.reject_sql_assignment(dict(ProcessType='QuaternaryPackaging',Sequence=1,LossPct=101))
 def test_unknown_master_assignment_still_rejected(self):
  self.reject_sql_assignment(dict(ProcessType='QuaternaryPackaging',Sequence=1,LossPct=0,MasterID=2147483647,MasterVersion='0x0000000000000000'))
 def test_new_unnamed_processing_assignment_still_rejected(self):
  self.reject_sql_assignment(dict(ProcessType='Processing',Sequence=1,LossPct=0))
 def test_legacy_aggregate_quaternary_loss_is_preserved(self):
  old={'Inputs':{'PrimaryLossPct':'1','SecondaryLossPct':'2','TertiaryLossPct':'3','QuaternaryLossPct':'4'}}
  self.cur.execute('UPDATE dbo.OpportunityItem SET TCBCostInfo=? WHERE ID=?',json.dumps(old),self.item)
  opened=api.read(self.item,self.ctx)
  steps=[dict(ProcessType=layer+'Packaging',Sequence=index+1,LossPct=str(index+1)) for index,layer in enumerate(('Primary','Secondary','Tertiary','Quaternary'))]
  saved=api.commercial_save(api.CommercialSave(RowVersion=opened['item']['RowVersion'],CostInputs={},Inputs={'LossProcesses':steps},Prices=[]),self.item,self.ctx)
  self.assertEqual(saved['saved']['Inputs']['QuaternaryLossPct'],'4.00')
  self.assertEqual(self.cur.execute('SELECT @@TRANCOUNT').fetchval(),1)

if __name__=='__main__':unittest.main()
