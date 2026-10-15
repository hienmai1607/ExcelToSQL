"""Authorization regressions with no external database dependency."""
import sys
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from fastapi import HTTPException
from auth import AccessContext
import packaging_api as api
import packaging_fields as fields
import packaging_excel_api as excel
import workbench_api as workbench

class PackagingPICAccess(unittest.TestCase):
 def context(self,scopes=("Packaging",),permissions=None,direct=None):
  return AccessContext(1,"PIC",frozenset(scopes),permissions,None if direct is None else frozenset(direct))
 def test_derived_manager_is_not_management_access(self):
  ctx=self.context(("Packaging","PackagingManager"),{"requests":"edit"},())
  self.assertFalse(ctx.can_manage_packaging)
  self.assertFalse(workbench.session(ctx)["can_assign_packaging"])
  with patch.object(workbench,"execute") as sql:
   with self.assertRaises(HTTPException):workbench.pics(ctx)
   sql.assert_not_called()
  with patch.object(api,"execute") as sql:
   for action in ("Approved","Returned","Canceled"):
    with self.assertRaises(HTTPException):
     api.transition(2,api.Transition(ExpectedRowVersion="AAAAAAAAAAE=",TargetStage=action,Comment="Reason"),ctx)
   with self.assertRaises(HTTPException):
    api.assign(2,api.Assignment(PICUserID=3,ExpectedRowVersion="AAAAAAAAAAE="),ctx)
   sql.assert_not_called()
 def test_direct_manager_and_admin_retain_management(self):
  for ctx in (self.context(("PackagingManager",)),self.context(("PackagingManager",),{"requests":"edit"},("PackagingManager",)),self.context(("Admin",),{},("Admin",))):
   self.assertTrue(ctx.can_manage_packaging)
 def test_display_role_does_not_grant_response_writes(self):
  ctx=self.context(permissions={"requests":"display"})
  row={"PICUserID":1,"ItemStage":"Working"}
  self.assertFalse(excel.can_edit(ctx,row))
  with patch.object(api,"enriched_response") as writer:
   with self.assertRaises(HTTPException) as error:
    api.response_save(api.ResponseBatch(rows=[dict(RowNum=1,ID=2,RowVersion="AAAAAAAAAAE=")]),ctx)
   self.assertEqual(error.exception.status_code,403)
   writer.assert_not_called()
 def test_excel_ownership_and_stage_matrix(self):
  for scopes in (("Packaging",),("Packaging","PackagingManager"),("Admin",)):
   ctx=self.context(scopes)
   for stage in ("Assigned","Working","Returned","Pending Review","Approved","Canceled"):
    for pic in (None,1,2):
     with self.subTest(scopes=scopes,stage=stage,pic=pic):
      self.assertEqual(excel.can_edit(ctx,{"PICUserID":pic,"ItemStage":stage}),(pic==1 or ctx.is_admin) and stage in ("Assigned","Working","Returned"))
 def test_api_locks_and_checks_owner_before_response_or_pricing_writes(self):
  class Cursor:
   def __init__(self,pic,stage):self.pic=pic;self.stage=stage;self.calls=[]
   def execute(self,sql,*args):self.calls.append(sql);return self
   def fetchval(self):return 0
   def fetchall(self):return [] # No linked root/dependency rows in this ownership-only double.
   def fetchone(self):return (None,)*12+(self.pic,self.stage)
  payload=api.ResponseBatch(rows=[dict(RowNum=1,ID=2,RowVersion="AAAAAAAAAAE=")])
  for scopes in (("Packaging",),("Admin",)):
   for pic,stage,status in (((1,"Approved",409),) if scopes==("Admin",) else ((2,"Working",403),(None,"Working",403),(1,"Approved",409))):
    cur=Cursor(pic,stage)
    @contextmanager
    def cursor():yield cur
    with self.subTest(scopes=scopes,pic=pic,stage=stage),patch.object(fields,"get_raw_cursor",cursor),patch.object(fields,"consume",return_value=[]),patch("mix_same_config.validate_group_batch"):
     with self.assertRaises(HTTPException) as error:api.response_save(payload,self.context(scopes))
     self.assertEqual(error.exception.status_code,status)
     self.assertTrue(any("UPDLOCK,HOLDLOCK" in sql for sql in cur.calls))
     self.assertTrue(any("ROLLBACK TRANSACTION" in sql for sql in cur.calls))
     self.assertFalse(any("usp_PackagingResponse_Batch" in sql or "usp_PkgPricing_Save" in sql for sql in cur.calls))
if __name__=="__main__":unittest.main()
