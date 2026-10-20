"""Current-schema, rollback-only regression for explicit same-Product refresh."""
import re
import sys
import unittest
from pathlib import Path
from decimal import Decimal
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
from db import get_raw_cursor
ROOT=Path(__file__).resolve().parents[2]

class ExplicitWeightRefresh(unittest.TestCase):
 def setUp(self):
  self.context=get_raw_cursor();self.cur=self.context.__enter__()
  self.addCleanup(self.cleanup)
  self.cur.execute("SET NOCOUNT ON; SET XACT_ABORT ON; BEGIN TRANSACTION")
  for batch in re.split(r'^GOs*$',(ROOT/'sql/130_explicit_opportunity_weight_refresh.sql').read_text(),flags=re.M|re.I):
   if batch.strip():
    self.cur.execute(batch)
    while self.cur.nextset():pass
  self.actor,self.user=self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE a.Scope='Admin' AND u.IsActive=1 ORDER BY u.ID").fetchone()
  self.customer=self.cur.execute("SELECT TOP(1) ID FROM dbo.Customer WHERE Status='Active' ORDER BY ID").fetchval()
  self.product=self.cur.execute("""INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CreatedBy,CustomerID)
   VALUES('REF-'+LEFT(CONVERT(VARCHAR(36),NEWID()),16),'Refresh regression',395,?,?); SELECT CONVERT(INT,SCOPE_IDENTITY())""",self.actor,self.customer).fetchval()
  self.opp=self.cur.execute("""INSERT dbo.Opportunity(OpportunityNumber,CustomerID,OpportunityDesc,BidOpen,BidClose,Stage,CreatedBy)
   VALUES('REF-'+LEFT(CONVERT(VARCHAR(36),NEWID()),16),?,'Refresh regression','2026-01-01','2026-02-01','Draft',?);SELECT CONVERT(INT,SCOPE_IDENTITY())""",self.customer,self.actor).fetchval()
  self.item=self.cur.execute("""INSERT dbo.OpportunityItem(OpportunityID,ProductID,ItemDescription,AnnualUnit,Stage,CreatedBy)
   VALUES(?,?,'Refresh regression',100,'Draft',?);SELECT CONVERT(INT,SCOPE_IDENTITY())""",self.opp,self.product,self.actor).fetchval()
 def cleanup(self):
  try:self.cur.execute("IF @@TRANCOUNT>0 ROLLBACK")
  finally:self.context.__exit__(None,None,None)
 def snapshot(self):
  return self.cur.execute("SELECT ProductNetWeightGrams,RowVersion FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchone()
 def refresh(self,version=None,username=None):
  self.cur.execute("EXEC dbo.usp_OpportunityItem_RefreshProductWeight ?,?,?,?",username or self.user,self.item,version or self.snapshot()[1],self.product)
  return self.cur.fetchval()
 def change_master(self):
  self.cur.execute("UPDATE dbo.Product SET WeightGrams=400 WHERE ID=?",self.product)
 def test_explicit_refresh_captures_current_master_and_clears_context(self):
  self.change_master();self.assertEqual(self.snapshot()[0],Decimal(395))
  version=self.refresh()
  self.assertEqual(self.snapshot()[0],Decimal(400));self.assertEqual(self.snapshot()[1],version)
  self.assertEqual(self.cur.execute("SELECT CASE WHEN SESSION_CONTEXT(N'OpportunityWeightRefreshID') IS NULL THEN 1 ELSE 0 END").fetchval(),1)
 def test_unrelated_edits_keep_snapshot(self):
  self.change_master();self.cur.execute("UPDATE dbo.OpportunityItem SET AnnualUnit=101 WHERE ID=?",self.item)
  self.assertEqual(self.snapshot()[0],Decimal(395))
 def test_direct_tampering_is_still_blocked(self):
  with self.assertRaisesRegex(Exception,'read-only snapshot'):
   self.cur.execute("UPDATE dbo.OpportunityItem SET ProductNetWeightGrams=1 WHERE ID=?",self.item)
 def test_stale_version_rejected(self):
  old=self.snapshot()[1];self.cur.execute("UPDATE dbo.OpportunityItem SET AnnualUnit=101 WHERE ID=?",self.item)
  with self.assertRaisesRegex(Exception,'unchanged standalone Draft'):self.refresh(version=old)
 def test_non_draft_rejected(self):
  self.cur.execute("UPDATE dbo.OpportunityItem SET Stage='In progress' WHERE ID=?",self.item)
  with self.assertRaisesRegex(Exception,'unchanged standalone Draft'):self.refresh()
 def test_unknown_user_rejected(self):
  with self.assertRaisesRegex(Exception,'edit access'):self.refresh(username='does-not-exist-refresh-regression')

 def request(self,stage):
  req=self.cur.execute("""INSERT dbo.PackagingConfigurationRequest(CreationKey,OpportunityID,OpportunityNumber,CustomerID,CustomerName,OpportunityDescription,BidOpen,BidClose,SourceRowVersion,RequestedBy,ResponseDue)
   SELECT NEWID(),o.ID,o.OpportunityNumber,o.CustomerID,c.CustomerName,o.OpportunityDesc,o.BidOpen,o.BidClose,o.RowVersion,?,DATEADD(DAY,10,CONVERT(DATE,SYSUTCDATETIME()))
   FROM dbo.Opportunity o JOIN dbo.Customer c ON c.ID=o.CustomerID WHERE o.ID=?;
   SELECT CONVERT(INT,SCOPE_IDENTITY())""",self.actor,self.opp).fetchval()
  return self.cur.execute("""INSERT dbo.PackagingConfigurationRequestItem(RequestID,OpportunityItemID,ProductID,ProductCode,ProductName,ItemDescription,AnnualUnit,SourceRowVersion,Stage,IsOpen,CreatedBy,WeightGrams)
   SELECT ?,i.ID,p.ID,p.ProductCode,p.ProductName,i.ItemDescription,i.AnnualUnit,i.RowVersion,?,?,?,395 FROM dbo.OpportunityItem i JOIN dbo.Product p ON p.ID=i.ProductID WHERE i.ID=?;
   SELECT CONVERT(INT,SCOPE_IDENTITY())""",req,stage,int(stage!='Approved'),self.actor,self.item).fetchval()
 def test_open_packaging_request_blocks_refresh(self):
  self.request('Assigned');self.change_master()
  with self.assertRaisesRegex(Exception,'no open Packaging Request'):self.refresh()
 def test_closed_request_snapshot_is_not_rewritten(self):
  req=self.request('Approved');self.change_master();self.refresh()
  self.assertEqual(self.snapshot()[0],Decimal(400))
  self.assertEqual(self.cur.execute("SELECT WeightGrams FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",req).fetchval(),Decimal(395))
 def test_batch_save_uses_refresh_command_and_returns_latest_version(self):
  from contextlib import contextmanager
  from unittest.mock import patch
  from schemas import OpportunityBatchRequest
  from main import opportunity_batch
  from db import bytes_to_b64
  @contextmanager
  def cursor():yield self.cur
  self.change_master()
  number,version=self.cur.execute("SELECT OpportunityNumber,RowVersion FROM dbo.Opportunity WHERE ID=?",self.opp).fetchone()
  payload=OpportunityBatchRequest.model_validate({
   'header_rows':[dict(RowNum=1,Command='U',ID=self.opp,OpportunityNumber=number,CustomerID=self.customer,OpportunityDesc='Refresh regression',BidOpen='2026-01-01',BidClose='2026-02-01',RowVersion=bytes_to_b64(version),ExchangeRateVNDPerUSD=25000,ExchangeRateCustomerCurrencyPerUSD=1)],
   'item_rows':[dict(RowNum=2,Command='U',ID=self.item,OpportunityNumber=number,ProductID=self.product,AnnualUnit=100,RowVersion=bytes_to_b64(self.snapshot()[1]),RefreshProductWeight=True)]})
  with patch('packaging_fields.get_raw_cursor',cursor):
   result=opportunity_batch(payload,username=self.user,is_admin=True,scopes=frozenset({'Admin'}))
  self.assertEqual(result['item_results'][0]['Status'],'OK',result)
  self.assertEqual(self.snapshot()[0],Decimal(400))
  self.assertEqual(result['item_results'][0]['NewRowVersion'],bytes_to_b64(self.snapshot()[1]))
if __name__=='__main__':unittest.main()
