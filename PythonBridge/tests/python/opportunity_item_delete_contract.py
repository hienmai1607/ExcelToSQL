"""Rollback-only desktop contract for migration 163: deleting a Draft item removes its automatic
initial TCB version (standalone and Mix families); real TCB history still blocks the delete."""
import re
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
from db import get_raw_cursor,bytes_to_b64
ROOT=Path(__file__).resolve().parents[2]

class ItemDelete(unittest.TestCase):
 def setUp(self):
  self.context=get_raw_cursor();self.cur=self.context.__enter__()
  self.addCleanup(self.cleanup)
  self.cur.execute("SET NOCOUNT ON; SET XACT_ABORT ON; BEGIN TRANSACTION")
  for batch in re.split(r'^\s*GO\s*$',(ROOT/'sql/163_opportunity_item_delete_initial_tcb.sql').read_text(encoding='utf-8'),flags=re.M|re.I):
   if batch.strip():
    self.cur.execute(batch)
    while self.cur.nextset():pass
  self.actor,self.user=self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE a.Scope='Admin' AND u.IsActive=1 ORDER BY u.ID").fetchone()
  self.customer=self.cur.execute("SELECT TOP(1) ID FROM dbo.Customer WHERE Status='Active' ORDER BY ID").fetchval()
  tag=self.cur.execute("SELECT LEFT(CONVERT(VARCHAR(36),NEWID()),8)").fetchval()
  def product(code,mix=0,weight=100):
   return self.cur.execute("""INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CreatedBy,CustomerID,IsMix)
    VALUES(?,?,?,?,?,?); SELECT CONVERT(INT,SCOPE_IDENTITY())""",'DEL-'+tag+'-'+code,'Item delete '+tag+' '+code,weight,self.actor,self.customer,mix).fetchval()
  self.a,self.b=product('A'),product('B');self.mix=product('M',1,0)
  version=self.cur.execute("INSERT dbo.ProductMixVersion(ProductID,Version,Status,CreatedBy) VALUES(?,1,'Active',?);SELECT CONVERT(INT,SCOPE_IDENTITY())",self.mix,self.actor).fetchval()
  for p,q in ((self.a,2),(self.b,1)):self.cur.execute("INSERT dbo.ProductMixItem(VersionID,ProductID,UnitQuantity) VALUES(?,?,?)",version,p,q)
  self.cur.execute("UPDATE dbo.Product SET WeightGrams=300 WHERE ID=?",self.mix)
  self.opp=self.cur.execute("""INSERT dbo.Opportunity(OpportunityNumber,CustomerID,OpportunityDesc,BidOpen,BidClose,Stage,CreatedBy)
   VALUES(?,?,'Item delete regression','2026-01-01','2026-02-01','Draft',?);SELECT CONVERT(INT,SCOPE_IDENTITY())""",'DEL-'+tag,self.customer,self.actor).fetchval()
  self.item=self.insert_item(self.mix);self.single=self.insert_item(self.a)
  self.kids=[r[0] for r in self.cur.execute("SELECT ID FROM dbo.OpportunityItem WHERE ParentItemID=?",self.item).fetchall()]
 def insert_item(self,product):
  return self.cur.execute("""INSERT dbo.OpportunityItem(OpportunityID,ProductID,ItemDescription,AnnualUnit,Stage,CreatedBy)
   VALUES(?,?,'Item delete regression',100,'Draft',?);SELECT CONVERT(INT,SCOPE_IDENTITY())""",self.opp,product,self.actor).fetchval()
 def cleanup(self):
  try:self.cur.execute("IF @@TRANCOUNT>0 ROLLBACK")
  finally:self.context.__exit__(None,None,None)
 def exists(self,ids):
  marks=','.join('?'*len(ids))
  return self.cur.execute('SELECT COUNT(*) FROM dbo.OpportunityItem WHERE ID IN('+marks+')',*ids).fetchval()
 def versions(self,ids):
  marks=','.join('?'*len(ids))
  return self.cur.execute('SELECT COUNT(*) FROM dbo.OpportunityTCBVersion WHERE ItemID IN('+marks+')',*ids).fetchval()

 def test_fixture_items_have_initial_tcb_versions(self):
  self.assertEqual(len(self.kids),2)
  self.assertEqual(self.versions([self.item,self.single]+self.kids),4)

 def test_mix_family_delete_removes_initial_tcb_versions(self):
  family=[self.item]+self.kids
  self.cur.execute("DELETE dbo.OpportunityItem WHERE ID=?",self.item)
  self.assertEqual(self.exists(family),0);self.assertEqual(self.versions(family),0)
  self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.OpportunityMixSnapshot WHERE ParentItemID=?",self.item).fetchval(),0)
  self.assertEqual(self.exists([self.single]),1,'other items are untouched')

 def test_standalone_delete_removes_initial_tcb_version(self):
  self.cur.execute("DELETE dbo.OpportunityItem WHERE ID=?",self.single)
  self.assertEqual(self.exists([self.single]),0);self.assertEqual(self.versions([self.single]),0)

 def test_saved_tcb_on_a_child_still_blocks(self):
  self.cur.execute("UPDATE dbo.OpportunityTCBVersion SET SavedJSON=N'{\"Inputs\":{}}' WHERE ItemID=?",self.kids[0])
  with self.assertRaisesRegex(Exception,'REFERENCE constraint'):self.cur.execute("DELETE dbo.OpportunityItem WHERE ID=?",self.item)

 def test_second_tcb_version_still_blocks(self):
  self.cur.execute("UPDATE dbo.OpportunityTCBVersion SET IsActive=0 WHERE ItemID=?",self.single)
  self.cur.execute("""INSERT dbo.OpportunityTCBVersion(ItemID,Version,Name,IsActive,SavedJSON,GradeJSON,CreatedBy,UpdatedBy)
   VALUES(?,2,N'Version 2',1,N'{}',N'[]',?,?)""",self.single,self.user,self.user)
  with self.assertRaisesRegex(Exception,'REFERENCE constraint'):self.cur.execute("DELETE dbo.OpportunityItem WHERE ID=?",self.single)

 def test_child_alone_still_blocked(self):
  with self.assertRaisesRegex(Exception,'Mix children cannot be removed individually'):
   self.cur.execute("DELETE dbo.OpportunityItem WHERE ID=?",self.kids[0])

 # ---- Workbench delete icon (business deletion), owner = creator ----
 def ctx(self):
  from auth import AccessContext
  return AccessContext(user_id=self.actor,username=self.user,scopes=frozenset({'Admin'}))
 def business_delete(self,identity):
  from business_deletion_api import delete_record,DeleteRecord
  version=self.cur.execute("SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?",identity).fetchval()
  return delete_record(self.cur,'opportunity-items',DeleteRecord(ID=identity,RowVersion=bytes_to_b64(version)),self.ctx())

 def test_delete_icon_removes_draft_mix_family(self):
  family=[self.item]+self.kids
  self.assertEqual(self.business_delete(self.item),{'deleted':True,'ID':self.item})
  self.assertEqual(self.exists(family),0);self.assertEqual(self.versions(family),0)

 def test_delete_icon_removes_standalone_item(self):
  self.business_delete(self.single)
  self.assertEqual(self.exists([self.single]),0)

 def test_delete_icon_refuses_mix_child(self):
  from fastapi import HTTPException
  with self.assertRaises(HTTPException) as caught:self.business_delete(self.kids[0])
  self.assertEqual(caught.exception.status_code,409);self.assertIn('Mix children are removed with their parent',caught.exception.detail)

 def test_delete_icon_refuses_family_with_child_request(self):
  from fastapi import HTTPException
  self.cur.execute("UPDATE dbo.OpportunityTCBVersion SET SavedJSON=N'{\"Inputs\":{}}' WHERE ItemID=?",self.kids[1])
  with self.assertRaises(HTTPException) as caught:self.business_delete(self.item)
  self.assertIn('OpportunityTCBVersion',caught.exception.detail)

if __name__=='__main__':
 unittest.main()
