"""Current-schema approval publication checks; every fixture and edit rolls back."""
import sys
import unittest
from contextlib import ExitStack
from pathlib import Path
from uuid import uuid4
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
import db
from auth import AccessContext
from opportunity_views import sorted_grid
from request_views import item_read
import tcb_api

class ApprovalFeedback(unittest.TestCase):
 def setUp(self):
  if db.DB_NAME!='test' or db.DB_SERVER.lower() not in ('desktop-5bgmjsc','localhost','.'):
   self.skipTest('Desktop test only')
  self.stack=ExitStack();self.addCleanup(self.stack.close)
  self.cur=self.stack.enter_context(db.get_raw_cursor())
  self.cur.execute('SET NOCOUNT ON; SET QUOTED_IDENTIFIER ON; BEGIN TRANSACTION')
  self.stack.callback(lambda:self.cur.execute('IF @@TRANCOUNT>0 ROLLBACK'))
  self.stack.enter_context(db.reuse_transaction(self.cur.connection))
  base=self.cur.execute("""SELECT TOP(1) r.ID,r.RequestID,r.OpportunityItemID,o.OpportunityNumber,i.PackagingLayerCount
   FROM dbo.PackagingConfigurationRequestItem r JOIN dbo.OpportunityItem i ON i.ID=r.OpportunityItemID
   JOIN dbo.Opportunity o ON o.ID=i.OpportunityID WHERE i.ParentItemID IS NULL
   AND NOT EXISTS(SELECT 1 FROM dbo.OpportunityItem c WHERE c.ParentItemID=i.ID) ORDER BY r.ID DESC""").fetchone()
  if not base:self.skipTest('No standalone response fixture')
  self.item=base.OpportunityItemID;self.number=base.OpportunityNumber;self.requested=base.PackagingLayerCount
  self.before=tuple(self.cur.execute('SELECT RowVersion,TCBCostInfo FROM dbo.OpportunityItem WHERE ID=?',self.item).fetchone())
  self.original_responses=[tuple(row) for row in self.cur.execute('SELECT ID,Stage,IsOpen,RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE OpportunityItemID=? ORDER BY ID',self.item).fetchall()]
  self.created=[]
  self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Canceled',IsOpen=0 WHERE OpportunityItemID=?",self.item)
  self.approved=self.clone('PackagingConfigurationRequestItem',base.ID,dict(RequestID=self.clone('PackagingConfigurationRequest',base.RequestID,{'CreationKey':str(uuid4())}),Stage='Canceled',IsOpen=0,ResponseLayerCount=2,FirstPMType='QA approved packaging',CartonsPerLayer=7))
  self.draft_header=self.clone('PackagingConfigurationRequest',base.RequestID,{'CreationKey':str(uuid4())})
  self.draft=self.clone('PackagingConfigurationRequestItem',base.ID,dict(RequestID=self.draft_header,Stage='Working',IsOpen=1,ResponseLayerCount=3,FirstPMType='QA draft packaging',CartonsPerLayer=99))
  actor,name=self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE a.Scope='Admin' AND u.IsActive=1 ORDER BY u.ID").fetchone()
  self.admin=AccessContext(actor,name,frozenset({'Admin'}))
  name='approval-read-'+uuid4().hex[:10]
  identity=self.cur.execute('INSERT dbo.Users(UserName,IsActive) VALUES(?,1);SELECT CONVERT(INT,SCOPE_IDENTITY())',name).fetchval()
  self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,'Opportunity')",identity)
  self.created.append(('Users',identity))
  self.sales=AccessContext(identity,name,frozenset({'Opportunity'}))
 def clone(self,table,identity,changes):
  columns=[r[0] for r in self.cur.execute("SELECT name FROM sys.columns WHERE object_id=OBJECT_ID(?) AND is_identity=0 AND is_computed=0 AND system_type_id<>189 ORDER BY column_id",'dbo.'+table).fetchall()]
  values=['?' if name in changes else '['+name+']' for name in columns]
  created=self.cur.execute('DECLARE @Created TABLE(ID INT); INSERT dbo.['+table+'] ('+','.join('['+name+']' for name in columns)+') OUTPUT INSERTED.ID INTO @Created SELECT '+','.join(values)+' FROM dbo.['+table+'] WHERE ID=?; SELECT ID FROM @Created',*[changes[name] for name in columns if name in changes],identity).fetchval()
  self.created.append((table,created));return created
 def tearDown(self):
  if not hasattr(self,'created'):return
  self.cur.execute('IF @@TRANCOUNT>0 ROLLBACK')
  self.assertEqual([tuple(row) for row in self.cur.execute('SELECT ID,Stage,IsOpen,RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE OpportunityItemID=? ORDER BY ID',self.item).fetchall()],self.original_responses)
  self.unchanged_item()
  for table,identity in self.created:self.assertEqual(self.cur.execute('SELECT COUNT(*) FROM dbo.['+table+'] WHERE ID=?',identity).fetchval(),0)
 def grid(self,ctx):
  return next(row for row in sorted_grid(ctx.username,1,500,'[]',opportunity_number=self.number)['rows'] if row['ItemID']==self.item)
 def unchanged_item(self):
  self.assertEqual(tuple(self.cur.execute('SELECT RowVersion,TCBCostInfo FROM dbo.OpportunityItem WHERE ID=?',self.item).fetchone()),self.before)
 def test_unapproved_responses_leave_opportunity_packaging_blank_for_every_role(self):
  for stage in ('Assigned','Working','Returned','Pending Review','Canceled'):
   self.cur.execute('UPDATE dbo.PackagingConfigurationRequestItem SET Stage=?,IsOpen=? WHERE ID=?',stage,stage!='Canceled',self.draft)
   for ctx in (self.admin,self.sales):
    with self.subTest(stage=stage,user=ctx.username):
     row=self.grid(ctx)
     for key in ('PackagingRequestItemID','ResponseLayerCount','FirstPMType','CartonsPerLayer','PalletPricingJSON','ContainerPlansJSON','LayerTareJSON','PrimaryPricePerUnit','SecondaryPricePerUnit','PrimaryLayerPricingSnapshot','ContainerLoadResults'):
      self.assertIsNone(row.get(key),key+' must be blank before approval')
   item=tcb_api.item_read(self.item,self.admin);self.assertEqual(item['LossLayerCount'],self.requested)
   self.assertIsNone(item['PalletPricingJSON']);self.assertIsNone(item['DefaultPalletUSDPerEA'])
   self.unchanged_item()
 def test_last_approved_survives_new_draft_submission_return_and_cancel(self):
  self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Approved' WHERE ID=?",self.approved)
  for stage in ('Assigned','Working','Pending Review','Returned','Canceled'):
   self.cur.execute('UPDATE dbo.PackagingConfigurationRequestItem SET Stage=?,IsOpen=? WHERE ID=?',stage,stage!='Canceled',self.draft)
   for ctx in (self.admin,self.sales):
    with self.subTest(stage=stage,user=ctx.username):
     row=self.grid(ctx);self.assertEqual(row['PackagingRequestItemID'],self.approved)
     self.assertEqual(row['FirstPMType'],'QA approved packaging');self.assertEqual(row['CartonsPerLayer'],7)
     self.assertEqual(tcb_api.item_read(self.item,ctx)['LossLayerCount'],2)
   self.unchanged_item()
 def test_approval_publishes_new_results_and_request_editor_retains_draft_preview(self):
  self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Approved' WHERE ID=?",self.approved)
  draft=next(r for r in item_read(self.admin.username,self.draft_header,1,25,None,None,'[]')['rows'] if r['ItemID']==self.draft)
  self.assertEqual(draft['FirstPMType'],'QA draft packaging')
  self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Approved',IsOpen=0 WHERE ID=?",self.draft)
  for ctx in (self.admin,self.sales):
   row=self.grid(ctx);self.assertEqual(row['PackagingRequestItemID'],self.draft)
   self.assertEqual(row['FirstPMType'],'QA draft packaging');self.assertEqual(row['CartonsPerLayer'],99)
   self.assertEqual(tcb_api.item_read(self.item,ctx)['LossLayerCount'],3)
  self.unchanged_item()

if __name__=='__main__':unittest.main()
