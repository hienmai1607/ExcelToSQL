import base64,io,os,sys,unittest,uuid
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"core"))
from fastapi import HTTPException
from pydantic import ValidationError
from db import get_raw_cursor
from auth import AccessContext,get_access_context
import administrator_api as api
from workspace_access import PAGES,merge_permissions,permission_scopes,enforce_route
from workspace_readonly import readonly_workbook

def empty_permissions():return {key:"none" for key in PAGES}
class ConnectionNoCommit:
 def commit(self):pass
 def rollback(self):pass
class CursorProxy:
 def __init__(self,cur):self.cur=cur;self.connection=ConnectionNoCommit()
 def __getattr__(self,name):return getattr(self.cur,name)
 def execute(self,sql,*args):
  if sql=="IF @@TRANCOUNT>0 ROLLBACK TRANSACTION":
   self.cur.execute("ROLLBACK TRANSACTION FixtureApi; COMMIT TRANSACTION")
   return self
  self.cur.execute(sql,*args)
  if "sp_getapplock" in sql:self.cur.execute("SAVE TRANSACTION FixtureApi")
  return self

class AdministratorSQL(unittest.TestCase):
 def setUp(self):
  self.manager=get_raw_cursor();self.cur=self.manager.__enter__();self.cur.execute("BEGIN TRANSACTION")
  self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin' ORDER BY u.ID")
  actor=self.cur.fetchone();self.actor=AccessContext(int(actor[0]),actor[1],frozenset({"Admin"}))
  self.marker="UI_ADMIN_"+uuid.uuid4().hex[:14]
  @contextmanager
  def cursor():yield CursorProxy(self.cur)
  self.patches=[patch.object(api,"get_raw_cursor",cursor),patch("auth.get_raw_cursor",cursor),patch.dict(os.environ,{"AUTH_MODE":"development_header"})]
  for item in self.patches:item.start()
 def tearDown(self):
  for item in reversed(self.patches):item.stop()
  self.cur.execute("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION");self.manager.__exit__(None,None,None)
 def role(self,permissions):
  return api.save_role(api.RoleRecord(RoleName=self.marker+str(uuid.uuid4().hex[:4]),Permissions={**empty_permissions(),**permissions}),self.actor)["ID"]
 def user(self,roles,direct=()):
  return api.save_user(api.UserRecord(UserName=self.marker,DirectScopes=list(direct),RoleIDs=roles),self.actor)["ID"]
 def context(self):
  return get_access_context(x_user_name=self.marker,x_authenticated_user=None,x_proxy_secret=None)
 def role_version(self,rid):
  self.cur.execute("SELECT RowVersion FROM dbo.WorkspaceRole WHERE ID=?",rid)
  return base64.b64encode(self.cur.fetchone()[0]).decode()
 def test_multiple_roles_highest_permission_and_live_revocation(self):
  first=self.role({"materials":"display","customers":"display"})
  second=self.role({"materials":"edit","prices":"display"})
  uid=self.user([first,second],["Product"])
  ctx=self.context()
  self.assertEqual(ctx.permissions["materials"],"edit")
  self.assertEqual(ctx.permissions["customers"],"display")
  self.assertEqual(ctx.permissions["products"],"edit") # original direct access preserved
  self.assertIn("Packaging",ctx.scopes)
  self.assertNotIn("Admin",ctx.scopes)
  api.save_role(api.RoleRecord(ID=second,RowVersion=self.role_version(second),RoleName=self.marker+"disabled",IsActive=False,Permissions={**empty_permissions(),"materials":"edit"}),self.actor)
  ctx=self.context()
  self.assertEqual(ctx.permissions["materials"],"display")
  self.assertNotIn("Packaging",ctx.scopes)
  self.assertIn("PackagingManager",ctx.scopes)
  self.cur.execute("SELECT Scope FROM dbo.UserAccess WHERE UserID=?",uid)
  self.assertIn("Product",{row[0] for row in self.cur.fetchall()})
 def test_user_access_and_assignment_save_is_atomic_on_invalid_role(self):
  with self.assertRaises(HTTPException):
   api.save_user(api.UserRecord(UserName=self.marker,RoleIDs=[2147483647]),self.actor)
  # API rollback returns to a savepoint inside the enclosing rollback fixture.
  self.cur.execute("SELECT COUNT(*) FROM dbo.WorkspaceUserRole ur JOIN dbo.Users u ON u.ID=ur.UserID WHERE u.UserName=?",self.marker)
  self.assertEqual(self.cur.fetchone()[0],0)
  self.cur.execute("SELECT COUNT(*) FROM dbo.Users WHERE UserName=?",self.marker)
  self.assertEqual(self.cur.fetchone()[0],0)
 def test_stale_role_and_user_versions_are_rejected(self):
  rid=self.role({"materials":"display"});version=self.role_version(rid)
  body=api.RoleRecord(ID=rid,RoleName=self.marker+"new",RowVersion=version,Permissions=empty_permissions())
  api.save_role(body,self.actor)
  with self.assertRaises(HTTPException) as error:api.save_role(body,self.actor)
  self.assertEqual(error.exception.status_code,409)
  uid=self.user([rid]);self.cur.execute("SELECT RowVersion FROM dbo.Users WHERE ID=?",uid)
  user_version=base64.b64encode(self.cur.fetchone()[0]).decode()
  changed=api.UserRecord(ID=uid,RowVersion=user_version,UserName=self.marker,RoleIDs=[rid],DirectScopes=["Customer"])
  api.save_user(changed,self.actor)
  with self.assertRaises(HTTPException) as error:api.save_user(changed,self.actor)
  self.assertEqual(error.exception.status_code,409)
 def test_own_admin_cannot_be_renamed_disabled_or_removed(self):
  self.cur.execute("SELECT RowVersion FROM dbo.Users WHERE ID=?",self.actor.user_id)
  version=base64.b64encode(self.cur.fetchone()[0]).decode()
  for changes in ({"IsActive":False},{"DirectScopes":[]},{"UserName":self.marker}):
   values={"ID":self.actor.user_id,"RowVersion":version,"UserName":self.actor.username,"DirectScopes":["Admin"],**changes}
   with self.assertRaises(HTTPException) as error:api.save_user(api.UserRecord(**values),self.actor)
   self.assertEqual(error.exception.status_code,422)
 def test_shared_master_edit_grant_does_not_make_user_admin(self):
  rid=self.role({"loss-processes":"edit","uoms":"display"})
  uid=self.user([rid]);ctx=self.context()
  self.assertFalse(ctx.is_admin)
  self.cur.execute("SELECT dbo.fn_WorkspaceAccess(?,'loss-processes',1),dbo.fn_WorkspaceAccess(?,'uoms',1),dbo.fn_WorkspaceAccess(?,'uoms',0)",uid,uid,uid)
  self.assertEqual(tuple(self.cur.fetchone()),(True,False,True))
  self.cur.execute("EXEC dbo.usp_LossProcessMaster_Save ?,NULL,NULL,?,1,0,'Active'",self.marker,self.marker)
  self.assertIsNotNone(self.cur.fetchone())
 def test_uom_role_edit_is_authorized_without_admin(self):
  rid=self.role({"uoms":"edit"});uid=self.user([rid]);ctx=self.context()
  self.assertFalse(ctx.is_admin)
  self.cur.execute("""SET NOCOUNT ON; DECLARE @Rows dbo.UoMBatchType;
   INSERT @Rows(RowNum,Command,UoMCode,UoMName,Status) VALUES(1,'C',?,?,'Active');
   EXEC dbo.usp_UoM_Batch @Rows,?;""",self.marker,"Role-granted unit",self.marker)
  result=self.cur.fetchone()
  self.assertEqual(result[1],"OK",str(result))
  self.cur.execute("SELECT CreatedBy FROM dbo.UoM WHERE UoMCode=?",self.marker)
  self.assertEqual(self.cur.fetchone()[0],uid)
 def test_direct_grants_are_not_removed_when_roles_are_removed(self):
  rid=self.role({"materials":"edit"});uid=self.user([rid],["Customer"])
  self.cur.execute("SELECT RowVersion FROM dbo.Users WHERE ID=?",uid)
  version=base64.b64encode(self.cur.fetchone()[0]).decode()
  api.save_user(api.UserRecord(ID=uid,RowVersion=version,UserName=self.marker,DirectScopes=["Customer"]),self.actor)
  ctx=self.context()
  self.assertEqual(ctx.scopes,frozenset({"Customer"}));self.assertEqual(ctx.permissions["materials"],"none")
 def test_inactive_user_cannot_authenticate(self):
  uid=self.user([])
  self.cur.execute("UPDATE dbo.Users SET IsActive=0 WHERE ID=?",uid)
  with self.assertRaises(HTTPException) as error:self.context()
  self.assertEqual(error.exception.status_code,401)

class HttpPermissionPolicy(unittest.TestCase):
 def test_middleware_blocks_display_writes_and_admin_routes(self):
  import asyncio
  import json
  import auth
  from main import app
  ctx=AccessContext(8,"Reader",frozenset({"PackagingManager"}),{**empty_permissions(),"materials":"display"})
  async def request(path,method):
   sent=[]
   async def receive():return {"type":"http.request","body":b"{}","more_body":False}
   async def send(message):sent.append(message)
   scope={"type":"http","asgi":{"version":"3.0","spec_version":"2.4"},"http_version":"1.1",
    "method":method,"scheme":"http","path":path,"raw_path":path.encode(),"query_string":b"",
    "root_path":"","headers":[(b"content-type",b"application/json")],
    "server":("test",80),"client":("127.0.0.1",12345)}
   await app(scope,receive,send)
   status=next(item["status"] for item in sent if item["type"]=="http.response.start")
   content=b"".join(item.get("body",b"") for item in sent if item["type"]=="http.response.body")
   return status,json.loads(content)
  with patch.object(auth,"get_access_context",return_value=ctx):
   for method,path in (("POST","/api/packaging/material/batch"),
    ("POST","/api/workbench/master-excel/materials/save"),
    ("GET","/api/administrator/users"),("POST","/api/administrator/roles")):
    status,body=asyncio.run(request(path,method))
    self.assertEqual(status,403,(path,body))
    self.assertIn("detail",body)

class PermissionPolicy(unittest.TestCase):
 def test_display_cannot_save_via_browser_or_excel(self):
  ctx=AccessContext(8,"Reader",frozenset({"PackagingManager"}),{**empty_permissions(),"materials":"display","opportunities":"display","requests":"display"})
  for path in ("/api/packaging/material/batch","/api/workbench/master-excel/materials/save","/api/opportunity/batch","/api/workbench/opportunity-excel/save","/api/packaging/response/batch"):
   with self.assertRaises(HTTPException) as error:enforce_route(ctx,path,"POST")
   self.assertEqual(error.exception.status_code,403)
  for path in ("/api/workbench/masters/materials","/api/workbench/master-excel/materials/download","/api/workbench/opportunity-excel/readonly"):
   enforce_route(ctx,path,"GET" if path.endswith("materials") else "POST")
 def test_non_admin_cannot_access_administration(self):
  ctx=AccessContext(8,"Editor",frozenset({"Packaging"}),{**empty_permissions(),"materials":"edit"})
  for path in ("/api/administrator/roles","/api/administrator/users","/api/market","/api/currency","/api/user-access/batch"):
   with self.assertRaises(HTTPException):enforce_route(ctx,path,"POST")
  with self.assertRaises(HTTPException):api.administrator(ctx)
 def test_unknown_role_permissions_fail_closed(self):
  with self.assertRaises(ValidationError):api.RoleRecord(RoleName="Invalid",Permissions={"administrator":"edit"})
  ctx=AccessContext(8,"Editor",frozenset({"Packaging"}),{"materials":"edit"})
  with self.assertRaises(HTTPException):enforce_route(ctx,"/api/new-unguarded-write","POST")
  self.assertNotIn("Admin",permission_scopes({key:"edit" for key in PAGES}))
 def test_readonly_workbook_has_no_macros_or_formulas_and_supports_many_columns(self):
  columns=["C"+str(n) for n in range(40)]
  response=readonly_workbook(columns,[{columns[0]:"=HYPERLINK(evil)",columns[-1]:"last"}])
  with ZipFile(io.BytesIO(response.body)) as workbook:
   xml=workbook.read("xl/worksheets/sheet1.xml").decode()
   self.assertIn('r="AN2"',xml);self.assertIn("sheetProtection",xml);self.assertNotIn("<f>",xml)
   self.assertFalse(any("vba" in name.lower() for name in workbook.namelist()))

if __name__=="__main__":unittest.main()
