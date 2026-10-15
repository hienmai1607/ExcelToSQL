"""Local test DB only: migration and fixtures always roll back."""
import os
import sys
import unittest
from pathlib import Path
from uuid import uuid4
import pyodbc
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
import packaging_field_foundation_contract as foundation
MIGRATION=(foundation.ROOT/"sql/105_packaging_pic_ownership.sql").read_text(encoding="utf-8")+"\n"+(foundation.ROOT/"sql/113_admin_response_override.sql").read_text(encoding="utf-8")

class PackagingPICSQL(unittest.TestCase):
 cleanup=foundation.PackagingFoundation.cleanup
 request=foundation.PackagingFoundation.request
 def setUp(self):
  foundation.PackagingFoundation.setUp(self)
  self.cur.execute(MIGRATION)
  while self.cur.nextset():pass
  self.pic,self.picname=self.user("Packaging")
  self.manager,self.managername=self.user("PackagingManager")
  self.admin,self.adminname=self.user("Admin")
  self.req=self.request()
  self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET PICUserID=? WHERE ID=?",self.pic,self.req)
 def user(self,*scopes):
  name="PIC_TEST_"+uuid4().hex[:16]
  uid=self.cur.execute("INSERT dbo.Users(UserName,IsActive) OUTPUT inserted.ID VALUES(?,1)",name).fetchval()
  for scope in scopes:self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,?)",uid,scope)
  return uid,name
 def version(self):
  return self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval()
 def drain(self):
  while self.cur.nextset():pass
 def test_options_off_deployment_repairs_settings_and_assignment(self):
  names=("usp_Packaging_Authorize","usp_PackagingRequestItem_Assign_AuditImplementation",
   "usp_PackagingResponse_Batch_AuditImplementation","usp_PackagingRequestItem_Transition_AuditImplementation",
   "usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation","usp_PkgPricing_ItemAuthorize")
  # Simulate SQLCMD defaults and an already-applied migration with bad metadata.
  self.cur.execute("SET QUOTED_IDENTIFIER OFF; SET ANSI_NULLS OFF")
  for name in names:
   self.cur.execute("""DECLARE @D NVARCHAR(MAX)=OBJECT_DEFINITION(OBJECT_ID(?));
    SET @D=STUFF(@D,1,CHARINDEX(N'PROCEDURE',UPPER(@D))+LEN(N'PROCEDURE')-1,N'ALTER PROCEDURE');
    EXEC sys.sp_executesql @D;""","dbo."+name)
  self.assertFalse(self.cur.execute("SELECT uses_quoted_identifier FROM sys.sql_modules WHERE object_id=OBJECT_ID('dbo.usp_PackagingRequestItem_Assign_AuditImplementation')").fetchval())
  for _ in range(2):
   self.cur.execute(MIGRATION);self.drain()
  for name in (*names,"fn_PackagingPICMember","fn_PackagingManagerAccess"):
   flags=self.cur.execute("SELECT uses_quoted_identifier,uses_ansi_nulls FROM sys.sql_modules WHERE object_id=OBJECT_ID(?)","dbo."+name).fetchone()
   self.assertEqual(tuple(flags),(True,True),name)
  self.test_manager_assigns_and_owner_saves_and_submits()
 def test_repeatable_and_all_ownership_guards_patched(self):
  self.cur.execute(MIGRATION);self.drain()
  for proc,guard in (
   ("usp_PackagingResponse_Batch_AuditImplementation","@IsAdmin=1 OR (i.PICUserID=@ActorID AND"),
   ("usp_PackagingRequestItem_Transition_AuditImplementation","IF @IsAdmin=0 AND @Action='Maintain'"),
   ("usp_PackagingConfigurationRequestItem_Fields_Save_AuditImplementation","@Admin=1 OR (PICUserID=@Actor AND"),
   ("usp_PkgPricing_ItemAuthorize","PICUserID=@Actor AND")):
   self.assertIn(guard,self.cur.execute("SELECT OBJECT_DEFINITION(OBJECT_ID(?))","dbo."+proc).fetchval())
 def test_member_list_excludes_admin_only_manager_only_inactive_and_display_roles(self):
  for uid,expected in ((self.pic,1),(self.manager,0),(self.admin,0)):
   self.assertEqual(self.cur.execute("SELECT dbo.fn_PackagingPICMember(?)",uid).fetchval(),expected)
  self.cur.execute("UPDATE dbo.Users SET IsActive=0 WHERE ID=?",self.pic)
  self.assertEqual(self.cur.execute("SELECT dbo.fn_PackagingPICMember(?)",self.pic).fetchval(),0)
  derived,name=self.user("Packaging","PackagingManager")
  for scope in ("Packaging","PackagingManager"):
   self.cur.execute("INSERT dbo.WorkspaceRoleScope(UserID,Scope) VALUES(?,?)",derived,scope)
  role=self.cur.execute("INSERT dbo.WorkspaceRole(RoleName,CreatedBy) OUTPUT inserted.ID VALUES(?,?)",name,self.actor).fetchval()
  self.cur.execute("INSERT dbo.WorkspaceUserRole(UserID,RoleID) VALUES(?,?)",derived,role)
  self.cur.execute("INSERT dbo.WorkspaceRolePermission(RoleID,PageKey,AccessLevel) VALUES(?,'requests','display')",role)
  self.assertEqual(self.cur.execute("SELECT dbo.fn_PackagingPICMember(?)",derived).fetchval(),0)
  self.cur.execute("UPDATE dbo.WorkspaceRolePermission SET AccessLevel='edit' WHERE RoleID=?",role)
  self.assertEqual(self.cur.execute("SELECT dbo.fn_PackagingPICMember(?)",derived).fetchval(),1)
  self.assertEqual(self.cur.execute("SELECT dbo.fn_PackagingManagerAccess(?)",derived).fetchval(),0)
 def test_manager_assigns_and_owner_saves_and_submits(self):
  self.cur.execute("EXEC dbo.usp_PackagingRequestItem_Assign ?,?,?,?",self.managername,self.req,self.pic,self.version());self.drain()
  self.cur.execute("EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save ?,?,?,?,0",self.picname,self.req,self.version(),'{}');self.drain()
  self.cur.execute("""UPDATE dbo.PackagingConfigurationRequestItem SET
   FirstPMType='Film',SecondPMType='Carton',UnitsPerCarton=1,PackagingDescription='Fixture',
   FirstPMMOQ=100,SecondPMMOQ=100 WHERE ID=?""",self.req)
  self.cur.execute("EXEC dbo.usp_PackagingRequestItem_Transition ?,?,?,'Pending Review',NULL",self.picname,self.req,self.version());self.drain()
  self.assertEqual(self.cur.execute("SELECT Stage FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval(),"Pending Review")
  self.cur.execute("EXEC dbo.usp_PackagingRequestItem_Transition ?,?,?,'Returned','Revise'",self.managername,self.req,self.version());self.drain()
 def test_admin_can_save_another_pic_base_response(self):
  from contextlib import contextmanager
  from unittest.mock import patch
  from auth import AccessContext
  from db import bytes_to_b64
  import packaging_api as api
  import packaging_fields as fields
  @contextmanager
  def cursor():yield self.cur
  with patch.object(fields,'get_raw_cursor',cursor):
   result=api.response_save(api.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,RowVersion=bytes_to_b64(self.version()),ResponseNotes='Admin edited')]),AccessContext(self.admin,self.adminname,frozenset({'Admin'})))
  self.assertEqual(result['results'][0]['Status'],'OK')
  self.assertEqual(self.cur.execute('SELECT ResponseNotes FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval(),'Admin edited')
  self.assertEqual(self.cur.execute('SELECT PICUserID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval(),self.pic)
 def test_admin_can_save_another_pic_additional_fields(self):
  self.cur.execute("EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save ?,?,?,?,0",self.adminname,self.req,self.version(),'{}');self.drain()
 def test_admin_can_save_another_pic_pricing(self):
  self.cur.execute("EXEC dbo.usp_PkgPricing_ItemAuthorize ?,?,1,?",self.adminname,self.req,self.version());self.drain()
 def test_admin_can_submit_another_pic_response(self):
  self.cur.execute("""UPDATE dbo.PackagingConfigurationRequestItem SET
   FirstPMType='Film',SecondPMType='Carton',UnitsPerCarton=1,PackagingDescription='Fixture',
   FirstPMMOQ=100,SecondPMMOQ=100 WHERE ID=?""",self.req)
  self.cur.execute("EXEC dbo.usp_PackagingRequestItem_Transition ?,?,?,'Pending Review',NULL",self.adminname,self.req,self.version());self.drain()
  self.assertEqual(self.cur.execute('SELECT Stage FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval(),'Pending Review')
  self.assertEqual(self.cur.execute('SELECT PICUserID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval(),self.pic)
 def test_other_member_cannot_save_or_price_response(self):
  other,name=self.user('Packaging')
  with self.assertRaisesRegex(pyodbc.Error,'51102'):
   self.cur.execute("EXEC dbo.usp_PkgPricing_ItemAuthorize ?,?,1,?",name,self.req,self.version())
 def test_admin_cannot_edit_locked_stage(self):
  self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Approved',IsOpen=0 WHERE ID=?",self.req)
  with self.assertRaisesRegex(pyodbc.Error,'51102'):
   self.cur.execute("EXEC dbo.usp_PkgPricing_ItemAuthorize ?,?,1,?",self.adminname,self.req,self.version())
 def test_admin_only_user_cannot_be_assigned(self):
  with self.assertRaisesRegex(pyodbc.Error,"51126"):
   self.cur.execute("EXEC dbo.usp_PackagingRequestItem_Assign ?,?,?,?",self.managername,self.req,self.admin,self.version())
 def test_derived_compatibility_manager_cannot_assign(self):
  derived,name=self.user("Packaging","PackagingManager")
  self.cur.execute("INSERT dbo.WorkspaceRoleScope(UserID,Scope) VALUES(?,'PackagingManager')",derived)
  with self.assertRaisesRegex(pyodbc.Error,"51102"):
   self.cur.execute("EXEC dbo.usp_PackagingRequestItem_Assign ?,?,?,?",name,self.req,self.pic,self.version())
if __name__=="__main__":unittest.main()
