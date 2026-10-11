"""Admin-only workspace maintenance with atomic role/access updates."""
import base64
from contextlib import contextmanager
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from auth import AccessContext, get_access_context
from db import get_raw_cursor, run_generic_batch, run_read_query
from cache import invalidate
from packaging_api import execute
from workspace_access import PAGES, ADMIN_EDIT_ONLY, permission_scopes

router=APIRouter(prefix="/api/administrator",tags=["Administrator"])
def administrator(ctx:AccessContext=Depends(get_access_context)):
 if not ctx.is_admin:raise HTTPException(403,"Administrator access is required.")
 return ctx

class Record(BaseModel):
 model_config=ConfigDict(extra="forbid")
 ID:int|None=Field(None,ge=1)
 RowVersion:str|None=None

class RoleRecord(Record):
 RoleName:str=Field(min_length=1,max_length=100)
 IsActive:bool=True
 Permissions:dict[str,Literal["none","display","edit"]]
 @model_validator(mode="after")
 def validate_permissions(self):
  self.RoleName=self.RoleName.strip()
  if not self.RoleName or set(self.Permissions)!=set(PAGES):raise ValueError("Enter a role name and one permission per workspace page.")
  if any(self.Permissions[key]=="edit" for key in ADMIN_EDIT_ONLY):raise ValueError("Shared master editing remains Administrator-only.")
  return self

class UserRecord(Record):
 UserName:str=Field(min_length=1,max_length=100)
 IsActive:bool=True
 DirectScopes:list[Literal["Admin","Customer","Product","Opportunity","Packaging","PackagingManager","RawMaterial"]]=Field(default_factory=list,max_length=7)
 RoleIDs:list[int]=Field(default_factory=list,max_length=100)
 @model_validator(mode="after")
 def unique_access(self):
  self.UserName=self.UserName.strip()
  if not self.UserName or len(self.DirectScopes)!=len(set(self.DirectScopes)) or len(self.RoleIDs)!=len(set(self.RoleIDs)) or any(id<1 for id in self.RoleIDs):
   raise ValueError("Enter a login name and distinct valid roles/access.")
  return self

class ReferenceRecord(Record):
 Code:str=Field(min_length=1,max_length=10)
 Name:str=Field(min_length=1,max_length=100)

def encoded(rows):
 return [{key:base64.b64encode(value).decode("ascii") if isinstance(value,(bytes,bytearray)) else value for key,value in row.items()} for row in rows]

def ready(cur):
 cur.execute("SELECT OBJECT_ID('dbo.WorkspaceRole','U')")
 if cur.fetchone()[0] is None:raise HTTPException(503,"Administrator role schema is not installed. Apply SQL migration 104.")

@contextmanager
def transaction(ctx):
 with get_raw_cursor() as cur:
  try:
   cur.execute("""SET XACT_ABORT ON; BEGIN TRANSACTION;
    DECLARE @LockResult INT; EXEC @LockResult=sys.sp_getapplock
      @Resource=N'AdministratorWorkspace',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
    IF @LockResult<0 THROW 52997,'Access maintenance is busy; retry.',1;""")
   cur.execute("""SELECT u.ID FROM dbo.Users u WITH(UPDLOCK,HOLDLOCK)
    JOIN dbo.UserAccess a WITH(UPDLOCK,HOLDLOCK) ON a.UserID=u.ID AND a.Scope=N'Admin'
    WHERE u.ID=? AND u.UserName=? AND u.IsActive=1""",ctx.user_id,ctx.username)
   if not cur.fetchone():raise HTTPException(403,"Active Administrator access is required.")
   ready(cur)
   yield cur
   cur.execute("COMMIT TRANSACTION")
  except HTTPException:
   cur.execute("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION");raise
  except Exception as exc:
   cur.execute("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION")
   message=str(exc)
   if any(code in message for code in ("2627","2601","547")):raise HTTPException(422,"Duplicate name/code or an invalid referenced record.") from exc
   if "52997" in message or "1205" in message:raise HTTPException(409,"Access maintenance is busy; refresh and retry.") from exc
   raise

def expected_version(value):
 try:decoded=base64.b64decode(value or "",validate=True)
 except (ValueError,TypeError):raise HTTPException(422,"Refresh the record and supply its RowVersion.")
 if len(decoded)!=8:raise HTTPException(422,"Refresh the record and supply its RowVersion.")
 return decoded

def sync_user(cur,uid):
 # Remove only grants previously introduced by workspace roles; direct grants survive.
 cur.execute("""DELETE a FROM dbo.UserAccess a JOIN dbo.WorkspaceRoleScope d
  ON d.UserID=a.UserID AND d.Scope=a.Scope WHERE a.UserID=?;
  DELETE dbo.WorkspaceRoleScope WHERE UserID=?;""",uid,uid)
 cur.execute("SELECT Scope FROM dbo.UserAccess WHERE UserID=?",uid)
 direct={str(row[0]) for row in cur.fetchall()}
 cur.execute("""SELECT p.RoleID,p.PageKey,p.AccessLevel FROM dbo.WorkspaceRolePermission p
  JOIN dbo.WorkspaceUserRole ur ON ur.RoleID=p.RoleID JOIN dbo.WorkspaceRole r ON r.ID=p.RoleID AND r.IsActive=1
  WHERE ur.UserID=?""",uid)
 roles={}
 for role,page,level in cur.fetchall():roles.setdefault(role,{})[page]=level
 derived=set().union(*(permission_scopes(p) for p in roles.values()))-direct if roles else set()
 for scope in sorted(derived):
  cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,?); INSERT dbo.WorkspaceRoleScope(UserID,Scope) VALUES(?,?)",uid,scope,uid,scope)
 # Access changes invalidate a concurrently open User Master form too.
 cur.execute("UPDATE dbo.Users SET IsActive=IsActive WHERE ID=?",uid)

@router.get("/roles")
def roles(ctx:AccessContext=Depends(administrator)):
 with get_raw_cursor() as cur:ready(cur)
 records=execute("SELECT ID,RoleName,IsActive,RowVersion FROM dbo.WorkspaceRole ORDER BY RoleName,ID",[])[0]
 permissions=execute("SELECT RoleID,PageKey,AccessLevel FROM dbo.WorkspaceRolePermission",[])[0]
 for row in records:row["Permissions"]={key:next((p["AccessLevel"] for p in permissions if p["RoleID"]==row["ID"] and p["PageKey"]==key),"none") for key in PAGES}
 return {"rows":records,"pages":PAGES,"admin_edit_only":sorted(ADMIN_EDIT_ONLY)}

@router.post("/roles")
def save_role(body:RoleRecord,ctx:AccessContext=Depends(administrator)):
 with transaction(ctx) as cur:
  if body.ID:
   cur.execute("UPDATE dbo.WorkspaceRole SET RoleName=?,IsActive=?,UpdatedBy=?,UpdatedAt=SYSUTCDATETIME() WHERE ID=? AND RowVersion=?",
     body.RoleName,body.IsActive,ctx.user_id,body.ID,expected_version(body.RowVersion))
   if cur.rowcount!=1:raise HTTPException(409,"Role changed or no longer exists. Refresh before saving.")
   rid=body.ID
  else:
   cur.execute("INSERT dbo.WorkspaceRole(RoleName,IsActive,CreatedBy) OUTPUT INSERTED.ID VALUES(?,?,?)",body.RoleName,body.IsActive,ctx.user_id)
   rid=int(cur.fetchone()[0])
  cur.execute("DELETE dbo.WorkspaceRolePermission WHERE RoleID=?",rid)
  for page,level in body.Permissions.items():cur.execute("INSERT dbo.WorkspaceRolePermission(RoleID,PageKey,AccessLevel) VALUES(?,?,?)",rid,page,level)
  cur.execute("SELECT UserID FROM dbo.WorkspaceUserRole WHERE RoleID=?",rid)
  for uid in [row[0] for row in cur.fetchall()]:sync_user(cur,uid)
 return {"ID":rid}

@router.get("/users")
def users(ctx:AccessContext=Depends(administrator)):
 with get_raw_cursor() as cur:ready(cur)
 rows=execute("SELECT ID,UserName,IsActive,RowVersion FROM dbo.Users ORDER BY UserName,ID",[])[0]
 direct=execute("""SELECT a.UserID,a.Scope FROM dbo.UserAccess a WHERE NOT EXISTS(
  SELECT 1 FROM dbo.WorkspaceRoleScope d WHERE d.UserID=a.UserID AND d.Scope=a.Scope)""",[])[0]
 assignments=execute("SELECT UserID,RoleID FROM dbo.WorkspaceUserRole",[])[0]
 for row in rows:
  row["DirectScopes"]=sorted(a["Scope"] for a in direct if a["UserID"]==row["ID"])
  row["RoleIDs"]=[a["RoleID"] for a in assignments if a["UserID"]==row["ID"]]
 return {"rows":rows}

@router.post("/users")
def save_user(body:UserRecord,ctx:AccessContext=Depends(administrator)):
 with transaction(ctx) as cur:
  if body.ID:
   cur.execute("SELECT UserName,IsActive,RowVersion FROM dbo.Users WITH(UPDLOCK,HOLDLOCK) WHERE ID=?",body.ID)
   old=cur.fetchone()
   if not old or bytes(old[2])!=expected_version(body.RowVersion):raise HTTPException(409,"User/access changed. Refresh before saving.")
   if body.ID==ctx.user_id and (not body.IsActive or "Admin" not in body.DirectScopes or body.UserName!=old[0]):
    raise HTTPException(422,"You cannot deactivate, rename, or remove your own Administrator access.")
   cur.execute("""SELECT COUNT(*) FROM dbo.Users u WITH(UPDLOCK,HOLDLOCK) JOIN dbo.UserAccess a WITH(UPDLOCK,HOLDLOCK)
    ON a.UserID=u.ID AND a.Scope=N'Admin' WHERE u.IsActive=1 AND u.ID<>?""",body.ID)
   if cur.fetchone()[0]==0 and (not body.IsActive or "Admin" not in body.DirectScopes):
    cur.execute("SELECT 1 FROM dbo.UserAccess WHERE UserID=? AND Scope=N'Admin'",body.ID)
    if cur.fetchone():raise HTTPException(422,"The last active Administrator cannot lose access.")
   uid=body.ID
  else:
   cur.execute("INSERT dbo.Users(UserName,IsActive) OUTPUT INSERTED.ID VALUES(?,?)",body.UserName,body.IsActive)
   uid=int(cur.fetchone()[0])
  for rid in body.RoleIDs:
   cur.execute("SELECT IsActive FROM dbo.WorkspaceRole WITH(UPDLOCK,HOLDLOCK) WHERE ID=?",rid)
   role=cur.fetchone()
   # Existing inactive assignments may be retained, but never newly assigned.
   if not role:raise HTTPException(422,"A selected role no longer exists.")
   if not role[0]:
    cur.execute("SELECT 1 FROM dbo.WorkspaceUserRole WHERE UserID=? AND RoleID=?",uid,rid)
    if not cur.fetchone():raise HTTPException(422,"Only active roles can be newly assigned.")
  cur.execute("UPDATE dbo.Users SET UserName=?,IsActive=? WHERE ID=?",body.UserName,body.IsActive,uid)
  cur.execute("DELETE dbo.WorkspaceRoleScope WHERE UserID=?; DELETE dbo.UserAccess WHERE UserID=?; DELETE dbo.WorkspaceUserRole WHERE UserID=?",uid,uid,uid)
  for scope in body.DirectScopes:cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,?)",uid,scope)
  for rid in body.RoleIDs:cur.execute("INSERT dbo.WorkspaceUserRole(UserID,RoleID) VALUES(?,?)",uid,rid)
  sync_user(cur,uid)
 return {"ID":uid}

@router.get("/{entity}")
def references(entity:Literal["markets","currencies"],ctx:AccessContext=Depends(administrator)):
 proc="dbo.usp_Market_Read" if entity=="markets" else "dbo.usp_Currency_Read"
 return {"rows":encoded(run_read_query(proc,[ctx.username]))}

@router.post("/{entity}")
def save_reference(entity:Literal["markets","currencies"],body:ReferenceRecord,ctx:AccessContext=Depends(administrator)):
 if not body.Code.strip() or not body.Name.strip():raise HTTPException(422,"Code and name are required.")
 if entity=="currencies" and (len(body.Code.strip())!=3 or not body.Code.strip().isalpha() or len(body.Name.strip())>50):
  raise HTTPException(422,"Currency code must contain three letters and its name at most 50 characters.")
 row=(1,"U" if body.ID else "C",body.ID or 0,body.Code.strip().upper(),body.Name.strip(),expected_version(body.RowVersion) if body.ID else b"")
 result=run_generic_batch("dbo.usp_Market_Batch" if entity=="markets" else "dbo.usp_Currency_Batch",[row],[ctx.username,1])[0]
 if result.get("Status")!="OK":raise HTTPException(409 if "conflict" in str(result.get("Message","")).lower() else 422,str(result.get("Message","Save failed.")))
 invalidate("market_list" if entity=="markets" else "currency_list");invalidate("customer_master_lookups")
 return encoded([result])[0]
