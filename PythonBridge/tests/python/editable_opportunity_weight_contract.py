"""Rollback-only current-schema tests for item-owned net weight."""
import sys,unittest
from pathlib import Path
from uuid import uuid4
from decimal import Decimal
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
from db import get_raw_cursor,bytes_to_b64
from schemas import OpportunityItemRow
from opportunity_item_weight import save_item_weight

class EditableWeight(unittest.TestCase):
 def setUp(self):
  self.context=get_raw_cursor();self.cur=self.context.__enter__();self.addCleanup(self.cleanup)
  self.cur.execute('SET NOCOUNT ON;SET XACT_ABORT OFF;BEGIN TRANSACTION')
  self.actor,self.user=self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE a.Scope='Admin' AND u.IsActive=1").fetchone()
  customer=self.cur.execute("SELECT TOP(1) ID FROM dbo.Customer WHERE Status='Active'").fetchval()
  self.product=self.cur.execute("INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CustomerID,CreatedBy) VALUES(?, 'Editable weight',395,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())",'EW-'+uuid4().hex[:12],customer,self.actor).fetchval()
  self.opp=self.cur.execute("INSERT dbo.Opportunity(OpportunityNumber,CustomerID,OpportunityDesc,BidOpen,BidClose,Stage,CreatedBy) VALUES(?,?,'Editable weight','2026-10-01','2026-11-01','Draft',?);SELECT CONVERT(INT,SCOPE_IDENTITY())",'EW-'+uuid4().hex[:12],customer,self.actor).fetchval()
  self.previous_context=self.cur.execute("SELECT SESSION_CONTEXT(N'OpportunityWeightRefreshID')").fetchval()
  self.item=self.cur.execute("INSERT dbo.OpportunityItem(OpportunityID,ProductID,ItemDescription,AnnualUnit,Stage,CreatedBy) VALUES(?,?,'Editable weight',100,'Draft',?);SELECT CONVERT(INT,SCOPE_IDENTITY())",self.opp,self.product,self.actor).fetchval()
 def cleanup(self):
  try:self.cur.execute('IF @@TRANCOUNT>0 ROLLBACK')
  finally:self.context.__exit__(None,None,None)
 def snapshot(self):
  return self.cur.execute('SELECT ProductNetWeightGrams,RowVersion FROM dbo.OpportunityItem WHERE ID=?',self.item).fetchone()
 def save(self,version=None,**fields):
  model=OpportunityItemRow(RowNum=1,Command='U',ID=self.item,OpportunityNumber='EW',ProductID=self.product,**fields)
  result={'NewID':self.item,'NewRowVersion':version or self.snapshot()[1]}
  save_item_weight(self.cur,model,result,self.user)
  return result
 def test_edit_is_local_to_item_and_audited(self):
  self.save(NetWeightGrams='400.25')
  self.assertEqual(self.snapshot()[0],Decimal('400.25'))
  self.assertEqual(self.cur.execute('SELECT WeightGrams FROM dbo.Product WHERE ID=?',self.product).fetchval(),395)
  self.assertEqual(self.cur.execute("SELECT SESSION_CONTEXT(N'OpportunityWeightRefreshID')").fetchval(),self.previous_context)
  self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.OpportunityChangeLog WHERE ItemID=? AND FieldName='WeightGrams' AND Source='User'",self.item).fetchval(),1)
 def test_refresh_replaces_override_with_current_master(self):
  self.save(NetWeightGrams=410)
  self.cur.execute('UPDATE dbo.Product SET WeightGrams=420 WHERE ID=?',self.product)
  self.save(RefreshProductWeight=True)
  self.assertEqual(self.snapshot()[0],420)
 def test_omitted_weight_preserves_capture(self):
  self.cur.execute('UPDATE dbo.Product SET WeightGrams=999 WHERE ID=?',self.product)
  self.save()
  self.assertEqual(self.snapshot()[0],395)
 def test_stale_weight_update_rejected(self):
  old=self.snapshot()[1];self.save(NetWeightGrams=400)
  with self.assertRaisesRegex(Exception,'unchanged Draft'):self.save(old,NetWeightGrams=450)
 def test_non_draft_item_cannot_change_weight(self):
  self.cur.execute("UPDATE dbo.OpportunityItem SET Stage='In progress' WHERE ID=?",self.item)
  with self.assertRaisesRegex(Exception,'unchanged Draft'):self.save(NetWeightGrams=400)
 def request(self,stage):
  req=self.cur.execute("""INSERT dbo.PackagingConfigurationRequest(CreationKey,OpportunityID,OpportunityNumber,CustomerID,CustomerName,OpportunityDescription,BidOpen,BidClose,SourceRowVersion,RequestedBy,ResponseDue)
   SELECT NEWID(),o.ID,o.OpportunityNumber,o.CustomerID,c.CustomerName,o.OpportunityDesc,o.BidOpen,o.BidClose,o.RowVersion,?,DATEADD(DAY,10,CONVERT(DATE,SYSUTCDATETIME()))
   FROM dbo.Opportunity o JOIN dbo.Customer c ON c.ID=o.CustomerID WHERE o.ID=?;SELECT CONVERT(INT,SCOPE_IDENTITY())""",self.actor,self.opp).fetchval()
  return self.cur.execute("""INSERT dbo.PackagingConfigurationRequestItem(RequestID,OpportunityItemID,ProductID,ProductCode,ProductName,ItemDescription,AnnualUnit,SourceRowVersion,Stage,IsOpen,CreatedBy,WeightGrams)
   SELECT ?,i.ID,p.ID,p.ProductCode,p.ProductName,i.ItemDescription,i.AnnualUnit,i.RowVersion,?,?,?,395 FROM dbo.OpportunityItem i JOIN dbo.Product p ON p.ID=i.ProductID WHERE i.ID=?;SELECT CONVERT(INT,SCOPE_IDENTITY())""",req,stage,int(stage!='Approved'),self.actor,self.item).fetchval()
 def test_open_request_blocks_manual_weight(self):
  self.request('Assigned')
  with self.assertRaisesRegex(Exception,'no open Packaging Request'):self.save(NetWeightGrams=430)
 def test_closed_packaging_snapshot_is_unchanged(self):
  request=self.request('Approved')
  self.save(NetWeightGrams=430)
  self.assertEqual(self.snapshot()[0],430)
  self.assertEqual(self.cur.execute('SELECT WeightGrams FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',request).fetchval(),395)
 def test_ambiguous_refresh_and_manual_value_rejected(self):
  with self.assertRaisesRegex(ValueError,'either'):self.save(NetWeightGrams=400,RefreshProductWeight=True)
 def mix_fixture(self):
  import json
  from packaging_fields import consume
  customer=self.cur.execute('SELECT CustomerID FROM dbo.Opportunity WHERE ID=?',self.opp).fetchval()
  parent=self.cur.execute("INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CustomerID,CreatedBy,IsMix) VALUES(?,'Weight mix',0,?,?,1);SELECT CONVERT(INT,SCOPE_IDENTITY())",'WM-'+uuid4().hex[:12],customer,self.actor).fetchval()
  token=self.cur.execute('SELECT RowVersion FROM dbo.Product WHERE ID=?',parent).fetchval()
  child_token=self.cur.execute('SELECT RowVersion FROM dbo.Product WHERE ID=?',self.product).fetchval()
  self.cur.execute("EXEC dbo.usp_ProductMix_Save ?,?,NULL,NULL,?,'Active',?",parent,self.user,token,json.dumps([dict(ProductID=self.product,UnitQuantity='2',RowVersion='0x'+child_token.hex())]))
  consume(self.cur)
  version=self.cur.execute("SELECT ID FROM dbo.ProductMixVersion WHERE ProductID=? AND Status='Active'",parent).fetchval()
  root=self.cur.execute("INSERT dbo.OpportunityItem(OpportunityID,ProductID,ItemDescription,AnnualUnit,Stage,CreatedBy) VALUES(?,?,'Mix weight',100,'Draft',?);SELECT CONVERT(INT,SCOPE_IDENTITY())",self.opp,parent,self.actor).fetchval()
  child=self.cur.execute('SELECT ID FROM dbo.OpportunityItem WHERE ParentItemID=?',root).fetchval()
  return parent,version,root,child
 def test_saved_mix_child_weight_uses_document_save(self):
  from contextlib import contextmanager
  from unittest.mock import patch
  from schemas import OpportunityBatchRequest
  from main import opportunity_batch
  parent,version,root,child=self.mix_fixture()
  number=self.cur.execute('SELECT OpportunityNumber FROM dbo.Opportunity WHERE ID=?',self.opp).fetchval()
  token=self.cur.execute('SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?',child).fetchval()
  payload=OpportunityBatchRequest.model_validate(dict(header_rows=[],item_rows=[dict(RowNum=2,Command='U',ID=child,OpportunityNumber=number,RowVersion=bytes_to_b64(token),NetWeightGrams='421.25')]))
  @contextmanager
  def cursor():yield self.cur
  with patch('packaging_fields.get_raw_cursor',cursor):
   result=opportunity_batch(payload,username=self.user,is_admin=True,scopes=frozenset({'Admin'}))
  self.assertEqual(result['item_results'][0]['Status'],'OK',result)
  self.assertEqual(self.cur.execute('SELECT ProductNetWeightGrams FROM dbo.OpportunityItem WHERE ID=?',child).fetchval(),Decimal('421.25'))
  self.assertEqual(self.cur.execute('SELECT WeightGrams FROM dbo.Product WHERE ID=?',self.product).fetchval(),395)
 def test_new_mix_child_weight_is_applied_with_child_requirements(self):
  from schemas import OpportunityItemRow
  from opportunity_mix import save_new_child_requirements
  parent,version,root,child=self.mix_fixture()
  model=OpportunityItemRow(RowNum=1,Command='C',OpportunityNumber='mix',ProductID=parent,MixVersionID=version,MixChildren=[dict(ProductID=self.product,NetWeightGrams='425.75')])
  result=dict(NewID=root,NewRowVersion=self.cur.execute('SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?',root).fetchval())
  save_new_child_requirements(self.cur,model,result,self.user)
  self.assertEqual(self.cur.execute('SELECT ProductNetWeightGrams FROM dbo.OpportunityItem WHERE ID=?',child).fetchval(),Decimal('425.75'))
 def test_new_item_uses_override_after_initial_master_capture(self):
  from contextlib import contextmanager
  from unittest.mock import patch
  from schemas import OpportunityBatchRequest
  from main import opportunity_batch
  customer=self.cur.execute('SELECT CustomerID FROM dbo.Opportunity WHERE ID=?',self.opp).fetchval()
  number='NEW-'+uuid4().hex[:12]
  payload=OpportunityBatchRequest.model_validate({
   'header_rows':[dict(RowNum=1,Command='C',OpportunityNumber=number,CustomerID=customer,OpportunityDesc='New editable weight',BidOpen='2026-10-01',BidClose='2026-11-01',ExchangeRateVNDPerUSD=25000,ExchangeRateCustomerCurrencyPerUSD=1)],
   'item_rows':[dict(RowNum=2,Command='C',OpportunityNumber=number,ProductID=self.product,AnnualUnit=100,ContainerRequest='20DC',NetWeightGrams='450.75')]})
  @contextmanager
  def cursor():yield self.cur
  with patch('packaging_fields.get_raw_cursor',cursor):
   result=opportunity_batch(payload,username=self.user,is_admin=True,scopes=frozenset({'Admin'}))
  item=result['item_results'][0]
  self.assertEqual(item['Status'],'OK',result)
  self.assertEqual(self.cur.execute('SELECT ProductNetWeightGrams FROM dbo.OpportunityItem WHERE ID=?',item['NewID']).fetchval(),Decimal('450.75'))
  self.assertEqual(self.cur.execute('SELECT WeightGrams FROM dbo.Product WHERE ID=?',self.product).fetchval(),395)
 def test_normal_document_save_uses_manual_weight_and_returns_latest_token(self):
  from contextlib import contextmanager
  from unittest.mock import patch
  from schemas import OpportunityBatchRequest
  from main import opportunity_batch
  number,version=self.cur.execute('SELECT OpportunityNumber,RowVersion FROM dbo.Opportunity WHERE ID=?',self.opp).fetchone()
  payload=OpportunityBatchRequest.model_validate({
   'header_rows':[dict(RowNum=1,Command='U',ID=self.opp,OpportunityNumber=number,CustomerID=self.cur.execute('SELECT CustomerID FROM dbo.Opportunity WHERE ID=?',self.opp).fetchval(),OpportunityDesc='Editable weight',BidOpen='2026-10-01',BidClose='2026-11-01',RowVersion=bytes_to_b64(version),ExchangeRateVNDPerUSD=25000,ExchangeRateCustomerCurrencyPerUSD=1)],
   'item_rows':[dict(RowNum=2,Command='U',ID=self.item,OpportunityNumber=number,ProductID=self.product,AnnualUnit=100,RowVersion=bytes_to_b64(self.snapshot()[1]),NetWeightGrams='430.25')]})
  @contextmanager
  def cursor():yield self.cur
  with patch('packaging_fields.get_raw_cursor',cursor):
   result=opportunity_batch(payload,username=self.user,is_admin=True,scopes=frozenset({'Admin'}))
  self.assertEqual(result['item_results'][0]['Status'],'OK',result)
  self.assertEqual(self.snapshot()[0],Decimal('430.25'))
  self.assertEqual(result['item_results'][0]['NewRowVersion'],bytes_to_b64(self.snapshot()[1]))
 def test_invalid_weight_is_not_rounded_or_cleared(self):
  for value in [None,0,-1,'1.001','NaN',True]:
   with self.subTest(value=value),self.assertRaises(ValueError):self.save(NetWeightGrams=value)
