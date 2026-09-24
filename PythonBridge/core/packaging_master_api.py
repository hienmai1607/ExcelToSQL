"""Browser reads/exports for packaging masters. Writes use existing batch procedures."""
import json
from datetime import date
from typing import Literal
LiteralStatus=Literal["Active","Block"]|None
from decimal import Decimal
from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError
from auth import AccessContext,get_access_context
from packaging_api import execute,require
from master_models import Entity,COLUMNS,MasterSort
from preferences_api import snapshot_xlsx
router=APIRouter(prefix="/api/workbench/masters",tags=["Master views"])
PRODUCT_AUTH="""IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=? AND u.IsActive=1 AND a.Scope IN(N'Admin',N'Product'))
 THROW 51040,'Product access is required for this action.',1;
"""
def require_entity(ctx,entity):
 if entity=="products": require(ctx,"Product")
 else: require(ctx,"Packaging","PackagingManager")

def order_by(entity,raw):
 try:
  rules=TypeAdapter(list[MasterSort]).validate_json(raw or "[]")
  if len(rules)>8 or len({r.column for r in rules})!=len(rules) or any(r.column not in COLUMNS[entity] for r in rules):
   raise ValueError("Invalid sort")
 except (ValidationError,ValueError) as exc:
  raise HTTPException(422,"Invalid packaging master sort.") from exc
 # Only schema-approved output aliases and enum directions reach SQL text.
 return ", ".join("["+r.column+"] "+r.direction.upper() for r in rules)+(", " if rules else "")+"ID ASC"
@router.get("/lookups")
def lookups(ctx:AccessContext=Depends(get_access_context),entity:Entity="materials"):
 if entity=="products":
  require(ctx,"Product")
  sets=execute(PRODUCT_AUTH+"""SELECT u.ID,u.UserName FROM dbo.Users u WHERE EXISTS(SELECT 1 FROM dbo.Product p WHERE p.CreatedBy=u.ID) ORDER BY u.UserName,u.ID;""",[ctx.username])
  return dict(materials=[],currencies=[],creators=sets[0])
 require(ctx,"Packaging","PackagingManager")
 sets=execute("""
 DECLARE @Actor INT; EXEC dbo.usp_Packaging_Authorize ?,'MasterRead',@Actor OUTPUT;
 SELECT ID,MaterialCode,MaterialName,Status FROM dbo.PackagingMaterial ORDER BY MaterialCode,ID;
 SELECT ID,CurrencyCode,CurrencyName FROM dbo.Currency ORDER BY CurrencyCode,ID;
 SELECT u.ID,u.UserName FROM dbo.Users u WHERE EXISTS(SELECT 1 FROM dbo.PackagingMaterial m WHERE m.CreatedBy=u.ID)
 OR EXISTS(SELECT 1 FROM dbo.PackagingPrice p WHERE p.CreatedBy=u.ID) ORDER BY u.UserName,u.ID;
 """,[ctx.username])
 return dict(materials=sets[0],currencies=sets[1],creators=sets[2])
@router.get("/{entity}")
def read(entity:Entity,page:int=Query(1,ge=1,le=1000000),page_size:int=Query(25,ge=1,le=500),
 search:str=Query("",max_length=200),status:LiteralStatus=None,
 material_id:int|None=Query(None,ge=1),currency_id:int|None=Query(None,ge=1),
 as_of:date|None=None,created_by:int|None=Query(None,ge=1),sort:str=Query("[]",max_length=2000),
 ctx:AccessContext=Depends(get_access_context)):
 require_entity(ctx,entity)
 order=order_by(entity,sort)
 if entity=="products":
  source="dbo.Product p"
  select="p.*"
  where="(?='' OR p.ProductCode LIKE ? OR p.ProductName LIKE ?) AND (? IS NULL OR p.Status=?) AND (? IS NULL OR p.CreatedBy=?)"
  params=[search,search+"%",search+"%",status,status,created_by,created_by]
 elif entity=="materials":
  source="dbo.PackagingMaterial p"
  select="p.*"
  where="(?='' OR p.MaterialCode LIKE ? OR p.MaterialName LIKE ?) AND (? IS NULL OR p.Status=?) AND (? IS NULL OR p.CreatedBy=?)"
  params=[search,search+"%",search+"%",status,status,created_by,created_by]
 else:
  source="dbo.PackagingPrice p JOIN dbo.PackagingMaterial m ON m.ID=p.MaterialID JOIN dbo.Currency c ON c.ID=p.CurrencyID"
  select="p.*,m.MaterialCode,m.MaterialName,c.CurrencyCode"
  where="""(?='' OR m.MaterialCode LIKE ? OR m.MaterialName LIKE ? OR p.PriceBasis LIKE ?)
   AND (? IS NULL OR p.Status=?) AND (? IS NULL OR p.MaterialID=?) AND (? IS NULL OR p.CurrencyID=?)
   AND (? IS NULL OR (p.EffectiveFrom<=? AND (p.EffectiveTo IS NULL OR p.EffectiveTo>=?)))
   AND (? IS NULL OR p.CreatedBy=?)"""
  params=[search,search+"%",search+"%",search+"%",status,status,material_id,material_id,currency_id,currency_id,as_of,as_of,as_of,created_by,created_by]
 auth_sql=PRODUCT_AUTH if entity=="products" else "DECLARE @Actor INT; EXEC dbo.usp_Packaging_Authorize ?,'MasterRead',@Actor OUTPUT;"
 sets=execute(f"""
 {auth_sql}
 ;WITH MasterRows AS (SELECT {select},creator.UserName AS CreatedByName,updater.UserName AS UpdatedByName
 FROM {source}
 LEFT JOIN dbo.Users creator ON creator.ID=p.CreatedBy
 LEFT JOIN dbo.Users updater ON updater.ID=p.UpdatedBy WHERE {where})
 SELECT * FROM MasterRows ORDER BY {order} OFFSET ? ROWS FETCH NEXT ? ROWS ONLY;
 SELECT COUNT(*) AS Total FROM {source} WHERE {where};
 """,[ctx.username,*params,(page-1)*page_size,page_size,*params])
 rows=[{k:str(v) if isinstance(v,Decimal) else v for k,v in r.items()} for r in sets[0]]
 return dict(rows=rows,total=sets[1][0]["Total"],page=page,page_size=page_size)
class Export(BaseModel):
 model_config=ConfigDict(extra="forbid")
 columns:list[str]=Field(min_length=1,max_length=20)
 rows:list[list[str|None]]=Field(max_length=500)
@router.post("/{entity}/export")
def export(entity:Entity,body:Export,ctx:AccessContext=Depends(get_access_context)):
 require_entity(ctx,entity)
 if len(body.columns)!=len(set(body.columns)) or any(c not in COLUMNS[entity] for c in body.columns):
  raise HTTPException(422,"Invalid export columns.")
 return Response(snapshot_xlsx(body,COLUMNS[entity],"Products" if entity=="products" else "Packaging"),media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",headers={"Content-Disposition":f'attachment; filename="{entity}.xlsx"',"Cache-Control":"no-store"})
