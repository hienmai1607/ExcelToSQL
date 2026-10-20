"""Current-schema rollback-only tests for TCB approach isolation and publication."""
import sys,json,unittest
from pathlib import Path
from contextlib import contextmanager
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from editable_opportunity_weight_contract import EditableWeight
from db import bytes_to_b64
from packaging_fields import consume
from auth import AccessContext
from fastapi import HTTPException
import tcb_api as tcb
import tcb_versions_api as api

class TCBVersions(unittest.TestCase):
 setUp_fixture=EditableWeight.setUp
 cleanup=EditableWeight.cleanup
 def setUp(self):
  self.setUp_fixture()
  self.ctx=AccessContext(self.actor,self.user,frozenset({"Admin"}))
  def execute(sql,args):
   self.cur.execute(sql,*args);sets=consume(self.cur)
   for rows in sets:
    for row in rows:
     for key,value in list(row.items()):
      if isinstance(value,(bytes,bytearray)): row[key]=bytes_to_b64(value)
   return sets
  @contextmanager
  def cursor(): yield self.cur
  self.addCleanup(patch.stopall)
  patch.object(tcb,"execute",execute).start()
  patch.object(api,"get_raw_cursor",cursor).start()
  patch.object(api,"context_rows",lambda item_id,ctx:[{"ItemID":self.item,"WeightGrams":"395","OpportunityNumber":"Fixture"}]).start()
 def token(self):return bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchval())
 def all(self):return api.versions(self.item,self.ctx)["versions"]
 def create(self,source=None,name="Alternative"):
  return api.create_version(api.CreateVersion(ItemRowVersion=self.token(),Name=name,
    SourceVersionID=source["ID"] if source else None,SourceRowVersion=source["RowVersion"] if source else None),self.item,self.ctx)["version"]
 def save(self,v,amount="0.25"):
  return api.version_save(api.VersionSave(RowVersion=self.token(),VersionRowVersion=v["RowVersion"],
    CostInputs={"ProcessingUSDPerLb":amount},Inputs={"LossProcesses":[]},Prices=[]),self.item,v["ID"],self.ctx)
 def activate(self,v):
  return api.activate_version(api.ActivateVersion(ItemRowVersion=self.token(),VersionRowVersion=v["RowVersion"]),self.item,v["ID"],self.ctx)
 def test_new_item_has_one_active_baseline(self):
  rows=self.all();self.assertEqual(len(rows),1);self.assertTrue(rows[0]["IsActive"]);self.assertEqual(rows[0]["Version"],1)
 def test_inactive_save_never_changes_live_item(self):
  old=self.cur.execute("SELECT TCBCostInfo,RowVersion FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchone()
  v=self.create();result=self.save(v)
  now=self.cur.execute("SELECT TCBCostInfo,RowVersion FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchone()
  self.assertEqual(tuple(old),tuple(now));self.assertFalse(result["version"]["IsActive"])
  self.assertEqual(result["saved"]["Inputs"]["ProcessingUSDPerLb"],"0.25")
 def test_copy_keeps_source_and_raw_precision(self):
  v=self.save(self.create(),"0.123456")["version"]
  copy=self.create(v,"Copied approach")
  rows=self.cur.execute("SELECT SavedJSON FROM dbo.OpportunityTCBVersion WHERE ID IN (?,?) ORDER BY ID",v["ID"],copy["ID"]).fetchall()
  self.assertEqual(rows[0][0],rows[1][0]);self.assertFalse(copy["IsActive"])
 def test_activate_publishes_and_keeps_exactly_one_active(self):
  old=self.all()[0];v=self.save(self.create())["version"];self.activate(v)
  active=[r for r in self.all() if r["IsActive"]]
  self.assertEqual([r["ID"] for r in active],[v["ID"]])
  saved=json.loads(self.cur.execute("SELECT TCBCostInfo FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchval())
  self.assertEqual(saved["Inputs"]["ProcessingUSDPerLb"],"0.25")
  self.assertIsNotNone(self.cur.execute("SELECT ContextJSON FROM dbo.OpportunityTCBVersion WHERE ID=?",old["ID"]).fetchval())
 def test_active_save_syncs_live_and_version(self):
  result=self.save(self.all()[0])
  live=self.cur.execute("SELECT TCBCostInfo FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchval()
  stored=self.cur.execute("SELECT SavedJSON FROM dbo.OpportunityTCBVersion WHERE ID=?",result["version"]["ID"]).fetchval()
  self.assertEqual(json.loads(live),json.loads(stored))
 def test_legacy_writer_syncs_active_version(self):
  saved='{"Inputs":{"ProcessingUSDPerLb":"0.123456789"}}'
  self.cur.execute("UPDATE dbo.OpportunityItem SET TCBCostInfo=? WHERE ID=?",saved,self.item)
  self.assertEqual(self.cur.execute("SELECT SavedJSON FROM dbo.OpportunityTCBVersion WHERE ItemID=? AND IsActive=1",self.item).fetchval(),saved)
 def test_stale_version_rejected(self):
  v=self.create();self.save(v)
  with self.assertRaises(HTTPException) as error:self.save(v)
  self.assertEqual(error.exception.status_code,409)
 def test_stale_item_rejected(self):
  token=self.token();self.cur.execute("UPDATE dbo.OpportunityItem SET AnnualUnit=101 WHERE ID=?",self.item)
  with self.assertRaises(HTTPException) as error:
   api.create_version(api.CreateVersion(ItemRowVersion=token,Name="Stale"),self.item,self.ctx)
  self.assertEqual(error.exception.status_code,409)
 def test_closed_item_cannot_create(self):
  self.cur.execute("UPDATE dbo.OpportunityItem SET Stage='In progress' WHERE ID=?",self.item)
  with self.assertRaises(HTTPException) as error:self.create()
  self.assertEqual(error.exception.status_code,409)
 def test_source_version_cannot_belong_to_another_item(self):
  with self.assertRaises(HTTPException) as error:
   api.create_version(api.CreateVersion(ItemRowVersion=self.token(),Name="Bad copy",SourceVersionID=2147483647,SourceRowVersion="AAAAAAAAAAE="),self.item,self.ctx)
  self.assertEqual(error.exception.status_code,404)
 def test_whitespace_name_rejected(self):
  with self.assertRaises(HTTPException):self.create(name=" ")
 def test_creating_and_saving_are_audited(self):
  self.save(self.create())
  self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.OpportunityChangeLog WHERE ItemID=? AND FieldName='TCBVersion'",self.item).fetchval(),2)

 def test_inactive_read_returns_saved_approach(self):
  v=self.save(self.create(),"0.375")["version"]
  result=api.version_read(self.item,v["ID"],self.ctx)
  self.assertFalse(result["version"]["IsActive"])
  self.assertEqual(result["tcb"]["saved"]["Inputs"]["ProcessingUSDPerLb"],"0.375")
  self.assertTrue(result["tcb"]["item"]["InactiveTCBVersion"])
 def test_comparison_keeps_all_versions_and_one_active(self):
  self.save(self.create())
  result=api.compare_versions(self.item,self.ctx)["versions"]
  self.assertEqual(len(result),2);self.assertEqual(sum(v["version"]["IsActive"] for v in result),1)
 def test_display_permission_cannot_create(self):
  ctx=AccessContext(self.actor,self.user,frozenset({"Opportunity"}),{"opportunities":"display"})
  with self.assertRaises(HTTPException) as error:
   api.create_version(api.CreateVersion(ItemRowVersion=self.token(),Name="Read only"),self.item,ctx)
  self.assertEqual(error.exception.status_code,403)
 def test_missing_opportunity_scope_cannot_read_versions(self):
  ctx=AccessContext(self.actor,self.user,frozenset({"Packaging"}))
  with self.assertRaises(HTTPException) as error:api.versions(self.item,ctx)
  self.assertEqual(error.exception.status_code,403)
 def test_database_prevents_two_active_versions(self):
  with self.assertRaises(Exception):
   self.cur.execute("""INSERT dbo.OpportunityTCBVersion(ItemID,Version,Name,IsActive,SavedJSON,GradeJSON,CreatedBy,UpdatedBy)
    VALUES(?,2,'Invalid second active',1,'{}','{}',?,?)""",self.item,self.user,self.user)
 def test_frozen_formula_uses_captured_weight(self):
  value=api.frozen_item({"ID":self.item,"WeightGrams":"500"},{"SavedJSON":"{}","GradeJSON":"{}","ContextJSON":api.document([{"ItemID":self.item,"WeightGrams":"395"}])})
  self.assertEqual(value["WeightGrams"],"395")
 def test_unused_item_initial_version_does_not_block_deletion(self):
  import business_deletion_api as deletion
  deletion.delete_record(self.cur,"opportunity-items",deletion.DeleteRecord(ID=self.item,RowVersion=self.token()),self.ctx)
  self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.OpportunityTCBVersion WHERE ItemID=?",self.item).fetchval(),0)
 def test_named_approaches_are_not_silently_deleted(self):
  import business_deletion_api as deletion
  self.create()
  with self.assertRaises(HTTPException):
   deletion.delete_record(self.cur,"opportunity-items",deletion.DeleteRecord(ID=self.item,RowVersion=self.token()),self.ctx)


 def test_inactive_grade_change_does_not_bypass_live_packaging_lock(self):
  grade=self.cur.execute("SELECT TOP(1) ID FROM dbo.RawGrade WHERE Status='Active' AND FinalGrade=1 ORDER BY ID").fetchval()
  if grade is None:self.skipTest("No active final grade")
  EditableWeight.request(self,"Assigned")
  v=self.create()
  body=api.VersionSave(RowVersion=self.token(),VersionRowVersion=v["RowVersion"],
    Grades={"items":[{"ParentID":"0","ID":1,"RawGradeID":grade,"Grade":"Alternative","RatioPct":"100"}]},
    Prices=[{"Path":"0/1","DirectUSDPerLb":"2"}],Inputs={"LossProcesses":[]})
  result=api.version_save(body,self.item,v["ID"],self.ctx)
  self.assertIsNone(self.cur.execute("SELECT ProductGradeSnapshot FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchval())
  with self.assertRaises(HTTPException) as error:self.activate(result["version"])
  self.assertEqual(error.exception.status_code,409)


 def test_creation_reads_identity_when_row_counts_are_enabled(self):
  self.cur.execute("SET NOCOUNT OFF")
  source=self.all()[0]
  created=self.create(source,name="Driver default settings")
  self.assertGreater(created["ID"],source["ID"])
  self.assertFalse(created["IsActive"])

if __name__=="__main__":unittest.main()
