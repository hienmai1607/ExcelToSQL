"""Packaging Excel response writes against local test SQL; fixtures roll back."""
import sys
import unittest
from contextlib import contextmanager
from unittest.mock import patch
from packaging_field_foundation_contract import PackagingFoundation, ROOT
sys.path.insert(0,str(ROOT/"core"))
import packaging_excel_api as excel
import packaging_api
import packaging_fields
from auth import AccessContext
class PackagingExcelSQL(unittest.TestCase):
 setup_base=PackagingFoundation.setUp
 cleanup=PackagingFoundation.cleanup
 request=PackagingFoundation.request
 def setUp(self):
  self.setup_base()
  @contextmanager
  def cursor():yield self.cur
  for module in (packaging_api,packaging_fields):
   mock=patch.object(module,"get_raw_cursor",cursor);mock.start();self.addCleanup(mock.stop)
  self.ctx=AccessContext(self.actor,self.username,frozenset({"Admin"}))
  from uuid import uuid4
  self.primary="Excel bag-"+uuid4().hex[:12]
  self.cur.execute("SET QUOTED_IDENTIFIER ON")
  self.cur.execute("INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,CreatedBy) VALUES('Primary',?,'Count',0,?)",self.primary,self.actor)
  self.reqitem=self.request()
  self.req=self.cur.execute("SELECT RequestID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.reqitem).fetchval()
 def edit(self,changes):
  source=excel.load_sources(self.ctx,[self.req])[self.reqitem]
  return dict(row=3,request_id=self.req,item_id=self.reqitem,version=source["ItemRowVersion"],changes=changes)
 def test_response_update_and_log(self):
  result=excel.save(excel.Batch(rows=[self.edit({"FirstPMType":self.primary,"FirstPMMOQ":"0"})]),self.ctx)
  self.assertEqual(result["results"][0]["status"],"OK",result)
  self.assertEqual(self.cur.execute("SELECT FirstPMType FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.reqitem).fetchval(),self.primary)
  changes=self.cur.execute("SELECT NewValue,ChangedBy FROM dbo.PackagingRequestChangeLog WHERE ItemID=? AND FieldName='FirstPMType' ORDER BY ID",self.reqitem).fetchall()
  self.assertTrue(any(r.NewValue==self.primary and r.ChangedBy==self.username for r in changes))
 def test_assigned_pic_can_save_but_another_pic_cannot(self):
  from uuid import uuid4
  names=["xl-pic-"+uuid4().hex[:12],"xl-other-"+uuid4().hex[:12]]
  actors=[]
  for name in names:
   self.cur.execute("INSERT dbo.Users(UserName,IsActive) VALUES(?,1)",name)
   id=self.cur.execute("SELECT ID FROM dbo.Users WHERE UserName=?",name).fetchval()
   self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,'Packaging')",id)
   actors.append(AccessContext(id,name,frozenset({"Packaging"})))
  self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET PICUserID=? WHERE ID=?",actors[0].user_id,self.reqitem)
  edit=self.edit({"FirstPMType":self.primary})
  denied=excel.save(excel.Batch(rows=[edit]),actors[1])
  self.assertEqual(denied["results"][0]["status"],"ERROR")
  allowed=excel.save(excel.Batch(rows=[edit]),actors[0])
  self.assertEqual(allowed["results"][0]["status"],"OK",allowed)
 def test_stale_version(self):
  edit=self.edit({"FirstPMType":"Must not save"})
  self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET ResponseNotes='changed' WHERE ID=?",self.reqitem)
  result=excel.save(excel.Batch(rows=[edit]),self.ctx)
  self.assertEqual(result["results"][0]["status"],"ERROR")
  self.assertIsNone(self.cur.execute("SELECT FirstPMType FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.reqitem).fetchval())
 def test_locked_stage(self):
  self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Pending Review' WHERE ID=?",self.reqitem)
  result=excel.save(excel.Batch(rows=[self.edit({"FirstPMType":"Must not save"})]),self.ctx)
  self.assertEqual(result["results"][0]["status"],"ERROR")
 def test_null_preserves_snapshot(self):
  self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET FirstPMMOQ=5 WHERE ID=?",self.reqitem)
  before=self.cur.execute("SELECT ProductCode,ProductName,AnnualUnit FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.reqitem).fetchone()
  result=excel.save(excel.Batch(rows=[self.edit({"FirstPMMOQ":None})]),self.ctx)
  self.assertEqual(result["results"][0]["status"],"OK",result)
  after=self.cur.execute("SELECT ProductCode,ProductName,AnnualUnit,FirstPMMOQ FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.reqitem).fetchone()
  self.assertEqual(tuple(before),tuple(after)[:3]);self.assertIsNone(after.FirstPMMOQ)
if __name__=="__main__":unittest.main()
