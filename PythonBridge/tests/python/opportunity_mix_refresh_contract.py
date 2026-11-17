"""Rollback-only desktop contract for migration 162 (Update to current mix version)."""
import re
import sys
import unittest
from decimal import Decimal
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
from db import get_raw_cursor
ROOT=Path(__file__).resolve().parents[2]

class MixVersionRefresh(unittest.TestCase):
 def setUp(self):
  self.context=get_raw_cursor();self.cur=self.context.__enter__()
  self.addCleanup(self.cleanup)
  self.cur.execute("SET NOCOUNT ON; SET XACT_ABORT ON; BEGIN TRANSACTION")
  for batch in re.split(r'^\s*GO\s*$',(ROOT/'sql/162_opportunity_mix_version_refresh.sql').read_text(encoding='utf-8'),flags=re.M|re.I):
   if batch.strip():
    self.cur.execute(batch)
    while self.cur.nextset():pass
  self.actor,self.user=self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE a.Scope='Admin' AND u.IsActive=1 ORDER BY u.ID").fetchone()
  self.customer=self.cur.execute("SELECT TOP(1) ID FROM dbo.Customer WHERE Status='Active' ORDER BY ID").fetchval()
  tag=self.cur.execute("SELECT LEFT(CONVERT(VARCHAR(36),NEWID()),8)").fetchval()
  def product(code,mix=0,weight=100):
   return self.cur.execute("""INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CreatedBy,CustomerID,IsMix)
    VALUES(?,?,?,?,?,?); SELECT CONVERT(INT,SCOPE_IDENTITY())""",'MXR-'+tag+'-'+code,'Mix refresh '+code,weight,self.actor,self.customer,mix).fetchval()
  self.a,self.b,self.c=product('A'),product('B'),product('C');self.mix=product('M',1,0)
  # A Mix weight always equals its Active mix total: none yet, then 2 x 100 g + 1 x 100 g.
  self.v1=self.version(1,'Active',((self.a,2),(self.b,1)))
  self.cur.execute("UPDATE dbo.Product SET WeightGrams=300 WHERE ID=?",self.mix)
  self.opp=self.cur.execute("""INSERT dbo.Opportunity(OpportunityNumber,CustomerID,OpportunityDesc,BidOpen,BidClose,Stage,CreatedBy)
   VALUES(?,?,'Mix refresh regression','2026-01-01','2026-02-01','Draft',?);SELECT CONVERT(INT,SCOPE_IDENTITY())""",'MXR-'+tag,self.customer,self.actor).fetchval()
  self.item=self.cur.execute("""INSERT dbo.OpportunityItem(OpportunityID,ProductID,ItemDescription,AnnualUnit,Stage,CreatedBy)
   VALUES(?,?,'Mix refresh regression',100,'Draft',?);SELECT CONVERT(INT,SCOPE_IDENTITY())""",self.opp,self.mix,self.actor).fetchval()
  self.before=self.children()
  # New Active version: A changes quantity, B leaves, C joins.
  self.cur.execute("UPDATE dbo.ProductMixVersion SET Status='Inactive' WHERE ID=?",self.v1)
  self.v2=self.version(2,'Active',((self.a,3),(self.c,1)))
  self.cur.execute("UPDATE dbo.Product SET WeightGrams=400 WHERE ID=?",self.mix)
 def version(self,number,status,items):
  identity=self.cur.execute("""INSERT dbo.ProductMixVersion(ProductID,Version,Status,CreatedBy) VALUES(?,?,?,?);
   SELECT CONVERT(INT,SCOPE_IDENTITY())""",self.mix,number,status,self.actor).fetchval()
  for product,quantity in items:self.cur.execute("INSERT dbo.ProductMixItem(VersionID,ProductID,UnitQuantity) VALUES(?,?,?)",identity,product,quantity)
  return identity
 def cleanup(self):
  try:self.cur.execute("IF @@TRANCOUNT>0 ROLLBACK")
  finally:self.context.__exit__(None,None,None)
 def children(self):
  return {r.ProductID:r for r in self.cur.execute("SELECT ID,ProductID,MixUnitQuantity,AnnualUnit,MixChildNumber FROM dbo.OpportunityItem WHERE ParentItemID=? ORDER BY MixChildNumber",self.item).fetchall()}
 def snapshot(self):return self.cur.execute("SELECT MixVersionID FROM dbo.OpportunityMixSnapshot WHERE ParentItemID=?",self.item).fetchval()
 def rowversion(self):return self.cur.execute("SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchval()
 def refresh(self,version=None,username=None):
  self.cur.execute("EXEC dbo.usp_OpportunityItem_MixRefresh ?,?,?",username or self.user,self.item,version or self.rowversion())
  return self.cur.fetchval()

 def test_fixture_starts_on_version_1(self):
  self.assertEqual(self.snapshot(),self.v1);self.assertEqual(set(self.before),{self.a,self.b})

 def test_refresh_keeps_matching_children_removes_and_adds(self):
  version=self.refresh();after=self.children()
  self.assertEqual(self.snapshot(),self.v2);self.assertEqual(version,self.rowversion())
  self.assertEqual(set(after),{self.a,self.c})
  self.assertEqual(after[self.a].ID,self.before[self.a].ID,'kept child keeps its row and data')
  self.assertEqual((after[self.a].MixUnitQuantity,after[self.a].AnnualUnit),(Decimal(3),Decimal(300)))
  self.assertEqual((after[self.c].MixUnitQuantity,after[self.c].AnnualUnit),(Decimal(1),Decimal(100)))
  self.assertEqual(sorted(r.MixChildNumber for r in after.values()),[1,2])
  self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.OpportunityItem WHERE ID=?",self.before[self.b].ID).fetchval(),0)
  log=self.cur.execute("SELECT OldValue,NewValue FROM dbo.OpportunityChangeLog WHERE ItemID=? AND FieldName='MixVersion'",self.item).fetchone()
  self.assertEqual((log.OldValue,log.NewValue),('1','2'))
  self.assertEqual(self.cur.execute("SELECT CASE WHEN SESSION_CONTEXT(N'OpportunityMixRefreshID') IS NULL THEN 1 ELSE 0 END").fetchval(),1)

# Any SQL error rolls back the whole (test) transaction, exactly like a refused Opportunity save,
 # so each refusal test ends with its single expected error.
 def test_already_current_is_rejected(self):
  self.refresh()
  with self.assertRaisesRegex(Exception,'already uses the current'):self.refresh()

 def history_request(self,item,open_):
  request=self.cur.execute("""INSERT dbo.PackagingConfigurationRequest(CreationKey,OpportunityID,OpportunityNumber,CustomerID,CustomerName,OpportunityDescription,BidOpen,BidClose,SourceRowVersion,RequestedBy,ResponseDue)
   SELECT NEWID(),o.ID,o.OpportunityNumber,o.CustomerID,c.CustomerName,o.OpportunityDesc,o.BidOpen,o.BidClose,o.RowVersion,?,DATEADD(DAY,10,CONVERT(DATE,SYSUTCDATETIME()))
   FROM dbo.Opportunity o JOIN dbo.Customer c ON c.ID=o.CustomerID WHERE o.ID=?;SELECT CONVERT(INT,SCOPE_IDENTITY())""",self.actor,self.opp).fetchval()
  self.cur.execute("""INSERT dbo.PackagingConfigurationRequestItem(RequestID,OpportunityItemID,ProductID,ProductCode,ProductName,ItemDescription,AnnualUnit,SourceRowVersion,Stage,IsOpen,CreatedBy,WeightGrams)
   SELECT ?,i.ID,p.ID,p.ProductCode,p.ProductName,i.ItemDescription,i.AnnualUnit,i.RowVersion,?,?,?,100 FROM dbo.OpportunityItem i JOIN dbo.Product p ON p.ID=i.ProductID WHERE i.ID=?""",
   request,'Assigned' if open_ else 'Approved',int(open_),self.actor,item)

 def test_removed_child_with_closed_request_blocks(self):
  self.history_request(self.before[self.b].ID,False)
  with self.assertRaisesRegex(Exception,'has Packaging, Recipe, TCB or stage history'):self.refresh()

 def test_removed_child_with_saved_tcb_blocks(self):
  self.cur.execute("UPDATE dbo.OpportunityTCBVersion SET SavedJSON=N'{\"Saved\":1}' WHERE ItemID=?",self.before[self.b].ID)
  with self.assertRaisesRegex(Exception,'has Packaging, Recipe, TCB or stage history'):self.refresh()

 def test_kept_child_history_does_not_block(self):
  self.history_request(self.before[self.a].ID,False)
  self.refresh();self.assertEqual(self.snapshot(),self.v2)

 def test_open_request_in_family_blocks(self):
  self.history_request(self.before[self.a].ID,True)
  with self.assertRaisesRegex(Exception,'open Packaging/Recipe Request'):self.refresh()

 def test_stale_version_rejected(self):
  stale=self.rowversion();self.cur.execute("UPDATE dbo.OpportunityItem SET AnnualUnit=101 WHERE ID=?",self.item)
  with self.assertRaisesRegex(Exception,'unchanged saved Draft Mix'):self.refresh(version=stale)

 def test_non_draft_rejected(self):
  self.cur.execute("UPDATE dbo.OpportunityItem SET Stage='In progress' WHERE ID=?",self.item)
  with self.assertRaisesRegex(Exception,'unchanged saved Draft Mix'):self.refresh()

 def test_unknown_user_rejected(self):
  with self.assertRaisesRegex(Exception,'edit access'):self.refresh(username='no-such-user-mix-refresh')

 def test_direct_child_delete_remains_blocked(self):
  with self.assertRaisesRegex(Exception,'cannot be removed individually'):
   self.cur.execute("DELETE dbo.OpportunityItem WHERE ID=?",self.before[self.b].ID)

 def test_direct_child_quantity_change_remains_blocked(self):
  with self.assertRaisesRegex(Exception,'read-only'):
   self.cur.execute("UPDATE dbo.OpportunityItem SET MixUnitQuantity=5 WHERE ID=?",self.before[self.a].ID)

 def test_child_row_cannot_carry_refresh_flag(self):
  from types import SimpleNamespace
  from opportunity_mix import split_child_edits
  row=SimpleNamespace(row_num=1,id=self.before[self.a].ID,command='U',MixChildren=[],MixVersionID=None,RefreshMixVersion=True,annual_unit=None)
  with self.assertRaisesRegex(ValueError,'on the Mix parent'):split_child_edits(self.cur,[row],self.user)

 def test_batch_save_runs_refresh_and_recalculates_parent_weight(self):
  from contextlib import contextmanager
  from unittest.mock import patch
  from schemas import OpportunityBatchRequest
  from main import opportunity_batch
  from db import bytes_to_b64
  @contextmanager
  def cursor():yield self.cur
  number,version=self.cur.execute("SELECT OpportunityNumber,RowVersion FROM dbo.Opportunity WHERE ID=?",self.opp).fetchone()
  payload=OpportunityBatchRequest.model_validate({
   'header_rows':[dict(RowNum=1,Command='U',ID=self.opp,OpportunityNumber=number,CustomerID=self.customer,OpportunityDesc='Mix refresh regression',BidOpen='2026-01-01',BidClose='2026-02-01',RowVersion=bytes_to_b64(version),ExchangeRateVNDPerUSD=25000,ExchangeRateCustomerCurrencyPerUSD=1)],
   'item_rows':[dict(RowNum=2,Command='U',ID=self.item,OpportunityNumber=number,ProductID=self.mix,AnnualUnit=100,RowVersion=bytes_to_b64(self.rowversion()),RefreshMixVersion=True)]})
  with patch('packaging_fields.get_raw_cursor',cursor):
   result=opportunity_batch(payload,username=self.user,is_admin=True,scopes=frozenset({'Admin'}))
  self.assertEqual(result['item_results'][0]['Status'],'OK',result)
  self.assertEqual(self.snapshot(),self.v2);self.assertEqual(set(self.children()),{self.a,self.c})
  # Parent net weight follows the new children: 3 x 100 g + 1 x 100 g.
  self.assertEqual(self.cur.execute("SELECT ProductNetWeightGrams FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchval(),Decimal(400))
  self.assertEqual(result['item_results'][0]['NewRowVersion'],bytes_to_b64(self.rowversion()))

 def test_product_update_saves_new_mix_version_with_fields(self):
  """Edit Product popup: Product fields and a new mix version in one Product save (no Opportunity change)."""
  from contextlib import contextmanager
  from unittest.mock import patch
  from schemas import ProductBatchRequest
  from main import product_batch
  from db import bytes_to_b64
  @contextmanager
  def cursor():yield self.cur
  code,name,version,category=self.cur.execute("SELECT ProductCode,ProductName,RowVersion,Category FROM dbo.Product WHERE ID=?",self.mix).fetchone()
  child=lambda i:bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.Product WHERE ID=?",i).fetchval())
  row=dict(RowNum=1,Command='U',ID=self.mix,RowVersion=bytes_to_b64(version),ProductCode=code,ProductName=name+' edited',CustomerID=self.customer,
   IsMix=True,WeightValue=0,WeightUnit='g',Status='Active',MixVersion=dict(Status='Active',items=[dict(ProductID=self.a,UnitQuantity='4',RowVersion=child(self.a)),dict(ProductID=self.b,UnitQuantity='1',RowVersion=child(self.b))]))
  if category is not None:row['Category']=category
  with patch('packaging_fields.get_raw_cursor',cursor):
   result=product_batch(ProductBatchRequest.model_validate({'rows':[row]}),self.user,True,frozenset({'Admin'}))
  self.assertEqual(result['results'][0]['Status'],'OK',result)
  active=self.cur.execute("SELECT ID,Version FROM dbo.ProductMixVersion WHERE ProductID=? AND Status='Active'",self.mix).fetchone()
  self.assertEqual(active.Version,3)
  self.assertEqual({r.ProductID:r.UnitQuantity for r in self.cur.execute("SELECT ProductID,UnitQuantity FROM dbo.ProductMixItem WHERE VersionID=?",active.ID).fetchall()},{self.a:Decimal(4),self.b:Decimal(1)})
  self.assertEqual(self.cur.execute("SELECT ProductName FROM dbo.Product WHERE ID=?",self.mix).fetchval(),name+' edited')
  # The saved Opportunity item keeps its captured version until explicitly updated.
  self.assertEqual(self.snapshot(),self.v1)

 def test_mix_version_rejected_for_normal_product_update(self):
  from schemas import ProductBatchRequest
  from pydantic import ValidationError
  with self.assertRaises(ValidationError):
   ProductBatchRequest.model_validate({'rows':[dict(RowNum=1,Command='U',ID=1,IsMix=False,MixVersion=dict(Status='Active',items=[dict(ProductID=2,UnitQuantity='1',RowVersion='AAAAAAAAAAE=')]))]})

if __name__=='__main__':unittest.main()
