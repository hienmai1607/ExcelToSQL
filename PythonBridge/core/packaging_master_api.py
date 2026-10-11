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
from packaging_orders import decode_orders
from master_models import Entity,COLUMNS,MasterSort
from preferences_api import snapshot_xlsx
router=APIRouter(prefix="/api/workbench/masters",tags=["Master views"])
PRODUCT_AUTH="""IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=? AND u.IsActive=1 AND a.Scope IN(N'Admin',N'Product'))
 THROW 51040,'Product access is required for this action.',1;
"""
def master_auth(entity):
 return ("DECLARE @Actor INT; EXEC dbo.usp_RawMaterial_Authorize ?,@Actor OUTPUT;"
         if entity in ("raw-materials","raw-prices","raw-grades") else
         "DECLARE @Actor INT; EXEC dbo.usp_Packaging_Authorize ?,'MasterRead',@Actor OUTPUT;")

def require_entity(ctx,entity):
 if entity in ("raw-materials","raw-prices","raw-grades"): require(ctx,"RawMaterial")
 elif entity=="uoms":
  if not ctx.is_admin and (ctx.permissions is None or ctx.permissions.get("uoms") not in ("display","edit")): require(ctx,"Admin")
 elif entity=="products": require(ctx,"Product")
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
  sets=execute(PRODUCT_AUTH+"""SELECT u.ID,u.UserName FROM dbo.Users u WHERE EXISTS(SELECT 1 FROM dbo.Product p WHERE p.CreatedBy=u.ID) ORDER BY u.UserName,u.ID; SELECT ID,CustomerName,Status FROM dbo.Customer ORDER BY CustomerName,ID; SELECT ID,CategoryName,Status FROM dbo.ProductCategory ORDER BY CategoryName,ID;""",[ctx.username])
  return dict(materials=[],currencies=[],creators=sets[0],customers=sets[1],categories=sets[2])
 require_entity(ctx,entity)
 if entity=="packaging-types":
  sets=execute(master_auth(entity)+"""
   SELECT u.ID,u.UserName FROM dbo.Users u WHERE EXISTS(SELECT 1 FROM dbo.PackagingType p WHERE p.CreatedBy=u.ID) ORDER BY u.UserName,u.ID;
  """,[ctx.username])
  types=execute(master_auth(entity)+"""
   SELECT ID,ParentTypeID,PackagingOrder,PackagingOrdersJSON,PackagingType,Shipping,FinalComponent,Status,HasChildren FROM dbo.v_PackagingTypeWeb ORDER BY PackagingOrder,PackagingType,ID;
  """,[ctx.username])[0]
  return dict(materials=[],currencies=[],creators=sets[0],packagingTypes=decode_orders(types))
 if entity=="pallets":
  sets=execute(master_auth(entity)+"""
   SELECT u.ID,u.UoMCode,u.UoMName,u.Status,
    CASE WHEN u.Status<>'Active' THEN NULL WHEN u.UoMCode=N'MM' THEN CONVERT(DECIMAL(24,9),1) ELSE c.Factor END AS FactorToMM
   FROM dbo.UoM u OUTER APPLY dbo.fn_UnitConversion(u.UoMCode,N'MM',NULL,NULL,NULL) c ORDER BY u.UoMCode,u.ID;
   SELECT u.ID,u.UserName FROM dbo.Users u WHERE EXISTS(SELECT 1 FROM dbo.Pallet p WHERE p.CreatedBy=u.ID) ORDER BY u.UserName,u.ID;
  """,[ctx.username])
  return dict(materials=[],currencies=[],creators=sets[1],
   uoms=[{k:str(v) if isinstance(v,Decimal) else v for k,v in row.items()} for row in sets[0]])
 raw=entity in ("raw-materials","raw-prices","raw-grades")
 material="RawMaterial" if raw else "PackagingMaterial"
 price="RawGrade" if entity=="raw-grades" else "RawMaterialPrice" if raw else "PackagingPrice"
 sets=execute(master_auth(entity)+f"""
 SELECT ID,MaterialCode,MaterialName,Status FROM dbo.{material} ORDER BY MaterialCode,ID;
 SELECT ID,CurrencyCode,CurrencyName FROM dbo.Currency ORDER BY CurrencyCode,ID;
 SELECT u.ID,u.UserName FROM dbo.Users u WHERE EXISTS(SELECT 1 FROM dbo.{material} m WHERE m.CreatedBy=u.ID)
 OR EXISTS(SELECT 1 FROM dbo.{price} p WHERE p.CreatedBy=u.ID) OR EXISTS(SELECT 1 FROM dbo.Vendor v WHERE v.CreatedBy=u.ID) ORDER BY u.UserName,u.ID;
 SELECT ID,VendorName,Status,CurrencyID FROM dbo.Vendor ORDER BY VendorName,ID;
 SELECT ID,UoMCode,UoMName,Status FROM dbo.UoM ORDER BY UoMCode,ID;
 """,[ctx.username])
 result=dict(materials=sets[0],currencies=sets[1],creators=sets[2],vendors=sets[3],uoms=sets[4])
 if entity=="prices":
  result["materials"]=execute(master_auth(entity)+"""SELECT m.ID,m.MaterialCode,m.MaterialName,m.Status,m.PackagingTypeID,t.PriceBasis
   FROM dbo.PackagingMaterial m LEFT JOIN dbo.PackagingType t ON t.ID=m.PackagingTypeID ORDER BY m.MaterialCode,m.ID;""",[ctx.username])[0]
  result["supplierDimensions"]=execute(master_auth(entity)+"""SELECT d.ID,d.PackagingTypeID,d.D1Name,d.D2Name,d.D3Name,
   u1.UoMCode AS D1Unit,u2.UoMCode AS D2Unit,u3.UoMCode AS D3Unit,
   d.ConvertFromSupplierFormula,d.ConvertFromParentFormula,d.ConversionOutputUoMID,(SELECT UoMCode FROM dbo.UoM WHERE ID=d.ConversionOutputUoMID) AS ConversionOutputUnit,d.RowVersion,d.Status,t.PackagingType
   FROM dbo.v_PackagingDimensionWeb d JOIN dbo.PackagingType t ON t.ID=d.PackagingTypeID
   JOIN dbo.UoM u1 ON u1.ID=d.D1UoMID LEFT JOIN dbo.UoM u2 ON u2.ID=d.D2UoMID LEFT JOIN dbo.UoM u3 ON u3.ID=d.D3UoMID
   WHERE t.ParentTypeID IS NOT NULL AND t.Status='Active' AND d.Status='Active' ORDER BY d.ID;""",[ctx.username])[0]
 if entity=="materials":
  result["packagingTypes"]=execute(master_auth(entity)+"""
   SELECT ID,ParentTypeID,PackagingOrder,PackagingOrdersJSON,PackagingType,Shipping,FinalComponent,Status,HasChildren FROM dbo.v_PackagingTypeWeb ORDER BY PackagingOrder,PackagingType,ID;
  """,[ctx.username])[0]
  result["packagingTypes"]=decode_orders(result["packagingTypes"])
 if entity in ("raw-grades","raw-materials"):
  result["rawGrades"]=execute(master_auth(entity)+"""
   SELECT g.ID,g.GradeName,g.ParentGradeID,parent.GradeName AS ParentGradeName,g.Status,
    CAST(CASE WHEN EXISTS(SELECT 1 FROM dbo.RawGrade child WHERE child.ParentGradeID=g.ID) THEN 1 ELSE 0 END AS BIT) AS HasChildren
   FROM dbo.RawGrade g LEFT JOIN dbo.RawGrade parent ON parent.ID=g.ParentGradeID
   ORDER BY parent.GradeName,g.GradeName,g.ID;
  """,[ctx.username])[0]
 return result
@router.get("/{entity}")
def read(entity:Entity,page:int=Query(1,ge=1,le=1000000),page_size:int=Query(25,ge=1,le=500),
 search:str=Query("",max_length=200),status:LiteralStatus=None,
 material_id:int|None=Query(None,ge=1),currency_id:int|None=Query(None,ge=1),
 as_of:date|None=None,created_by:int|None=Query(None,ge=1),sort:str=Query("[]",max_length=2000),
 ctx:AccessContext=Depends(get_access_context)):
 require_entity(ctx,entity)
 order=order_by(entity,sort)
 if entity=="products":
  source="dbo.Product p LEFT JOIN dbo.Customer pc ON pc.ID=p.CustomerID"
  select="p.IsMix,CAST(CASE WHEN p.IsMix=0 OR EXISTS(SELECT 1 FROM dbo.ProductMixVersion mv WHERE mv.ProductID=p.ID AND mv.Status='Active') THEN 1 ELSE 0 END AS BIT) AS MixReady,p.CustomerID,pc.CustomerName,p.ID,p.ProductCode,p.ProductName,p.Category,p.WeightGrams,p.WeightOz,p.ShelfLifeDays,p.Status,p.CreatedBy,p.CreatedAt,p.UpdatedBy,p.UpdatedAt,p.RowVersion"
  where="(?='' OR p.ProductCode LIKE ? OR p.ProductName LIKE ?) AND (? IS NULL OR p.Status=?) AND (? IS NULL OR p.CreatedBy=?)"
  params=[search,search+"%",search+"%",status,status,created_by,created_by]
 elif entity=="packaging-types":
  source="dbo.PackagingType p LEFT JOIN dbo.PackagingType parent ON parent.ID=p.ParentTypeID"
  select="p.ID,p.ParentTypeID,p.PackagingOrder,(SELECT PackagingOrdersJSON FROM dbo.v_PackagingTypeWeb WHERE ID=p.ID) AS PackagingOrdersJSON,p.PackagingType,p.PriceBasis,p.Shipping,p.FinalComponent,p.Status,p.CreatedAt,p.CreatedBy,p.UpdatedAt,p.UpdatedBy,p.RowVersion,parent.PackagingType AS ParentType"
  where="(?='' OR p.PackagingType LIKE ? OR p.PackagingOrder LIKE ?) AND (? IS NULL OR p.Status=?) AND (? IS NULL OR p.CreatedBy=?)"
  params=[search,search+"%",search+"%",status,status,created_by,created_by]
 elif entity=="pallets":
  source="dbo.v_PalletMaster p"
  select="p.*"
  where="(?='' OR p.PalletSize LIKE ? OR p.UnitOfMeasure LIKE ?) AND (? IS NULL OR p.Status=?) AND (? IS NULL OR p.CreatedBy=?)"
  params=[search,search+"%",search+"%",status,status,created_by,created_by]
 elif entity=="uoms":
  source="dbo.UoM p"
  select="p.*"
  where="(?='' OR p.UoMCode LIKE ? OR p.UoMName LIKE ?) AND (? IS NULL OR p.Status=?) AND (? IS NULL OR p.CreatedBy=?)"
  params=[search,search+"%",search+"%",status,status,created_by,created_by]
 elif entity=="raw-grades":
  source="dbo.RawGrade p LEFT JOIN dbo.RawGrade parent ON parent.ID=p.ParentGradeID"
  select="p.ID,p.ParentGradeID,p.GradeName,p.Status,p.CreatedBy,p.CreatedAt,p.UpdatedBy,p.UpdatedAt,p.RowVersion,parent.GradeName AS ParentGradeName"
  where="(?='' OR p.GradeName LIKE ? OR parent.GradeName LIKE ?) AND (? IS NULL OR p.Status=?) AND (? IS NULL OR p.CreatedBy=?)"
  params=[search,search+"%",search+"%",status,status,created_by,created_by]
 elif entity=="vendors":
  source="dbo.Vendor p LEFT JOIN dbo.Currency vc ON vc.ID=p.CurrencyID"
  select="p.*,vc.CurrencyCode"
  where="(?='' OR p.VendorName LIKE ? OR p.Address LIKE ?) AND (? IS NULL OR p.Status=?) AND (? IS NULL OR p.CreatedBy=?)"
  params=[search,search+"%",search+"%",status,status,created_by,created_by]
 elif entity in ("materials","raw-materials"):
  source="dbo.RawMaterial p LEFT JOIN dbo.RawGrade g ON g.ID=p.GradeID" if entity=="raw-materials" else "dbo.PackagingMaterial p LEFT JOIN dbo.PackagingType pt ON pt.ID=p.PackagingTypeID"
  select="p.*,g.GradeName" if entity=="raw-materials" else "p.*,CASE WHEN pt.ID IS NOT NULL THEN CASE WHEN pt.ParentTypeID IS NOT NULL THEN pt.PackagingType ELSE CONCAT(pt.PackagingOrder,N' / ',pt.PackagingType) END END AS PackagingType"
  where="(?='' OR p.MaterialCode LIKE ? OR p.MaterialName LIKE ?) AND (? IS NULL OR p.Status=?) AND (? IS NULL OR p.CreatedBy=?)"
  params=[search,search+"%",search+"%",status,status,created_by,created_by]
 else:
  source="dbo.PackagingPrice p JOIN dbo.PackagingMaterial m ON m.ID=p.MaterialID JOIN dbo.Currency c ON c.ID=p.CurrencyID LEFT JOIN dbo.Vendor v ON v.ID=p.VendorID"
  if entity=="raw-prices": source=source.replace("PackagingPrice","RawMaterialPrice").replace("PackagingMaterial","RawMaterial")
  source+=" OUTER APPLY dbo.fn_UnitConversion(p.PriceBasis,m.UnitOfMeasure,"+("NULL,p.MaterialID" if entity=="raw-prices" else "p.MaterialID,NULL")+",p.VendorID) conv"
  factor="CASE WHEN p.PriceBasis=m.UnitOfMeasure THEN CONVERT(DECIMAL(18,3),1) ELSE conv.Factor END"
  if entity=="prices":
   source+=" LEFT JOIN dbo.PackagingType pt ON pt.ID=m.PackagingTypeID LEFT JOIN dbo.PackagingDimension sd ON sd.ID=p.SupplierDimensionID LEFT JOIN dbo.PackagingDimension sp ON sp.ID=sd.ParentDimensionID"
   factor="""CASE
    WHEN pt.PriceBasis='Square meter' AND LOWER(p.PriceBasis) IN(N'm2',N'm²',N'm^2',N'sqm',N'sq m') THEN CONVERT(DECIMAL(28,9),1)
    WHEN pt.PriceBasis<>'Square meter' AND p.PriceBasis=m.UnitOfMeasure THEN CONVERT(DECIMAL(28,9),1)
    WHEN pt.PriceBasis='Square meter' OR p.SupplierDimensionID IS NOT NULL THEN CASE
    WHEN sd.RowVersion=p.SupplierDimensionRowVersion AND sd.PackagingTypeID=m.PackagingTypeID
     AND sd.Status='Active' AND sp.Status='Active' AND sd.FormulaNeedsReview=0
     AND sd.ConvertFromSupplierFormula IS NOT NULL AND (sd.ConversionOutputUoMID IS NULL OR EXISTS(SELECT 1 FROM dbo.UoM WHERE ID=sd.ConversionOutputUoMID AND Status='Active'))
     AND NOT EXISTS(SELECT 1 FROM (VALUES(sd.D1UoMID),(sd.D2UoMID),(sd.D3UoMID)) s(ID) JOIN dbo.UoM u ON u.ID=s.ID WHERE u.Status<>'Active')
     THEN p.SupplierAreaPerPriceUnit END
    ELSE conv.Factor END"""
  select=("p.*,p.PriceBasis AS BaseUoM,m.MaterialCode,m.MaterialName,c.CurrencyCode,v.VendorName,"
          "m.UnitOfMeasure AS MaterialBaseUoM,"+factor+" AS ConversionFactor,"
          "CONVERT(DECIMAL(38,8),p.UnitPrice/NULLIF(("+factor+"),0)) AS BaseUnitPrice,"
          "CONVERT(DECIMAL(38,8),p.UnitUSDPrice/NULLIF(("+factor+"),0)) AS BaseUnitUSDPrice,"
          "CASE WHEN p.PriceBasis=m.UnitOfMeasure THEN 'Same unit' WHEN conv.ID IS NULL THEN 'Conversion required' ELSE 'Converted' END AS ConversionStatus")
  if entity=="prices":
   select=select.replace("m.UnitOfMeasure AS MaterialBaseUoM","CASE WHEN pt.PriceBasis='Square meter' THEN N'm²' ELSE m.UnitOfMeasure END AS MaterialBaseUoM")
   select=select.rsplit("CASE WHEN p.PriceBasis=m.UnitOfMeasure THEN 'Same unit'",1)[0]+"""
    CASE WHEN pt.PriceBasis='Square meter' OR (p.SupplierDimensionID IS NOT NULL AND p.PriceBasis<>m.UnitOfMeasure)
     THEN CASE WHEN ("""+factor+""") IS NULL THEN 'Supplier dimensions required or formula changed' ELSE 'Supplier pricing conversion' END
    WHEN p.PriceBasis=m.UnitOfMeasure THEN 'Same unit' WHEN conv.ID IS NULL THEN 'Conversion required' ELSE 'Converted' END AS ConversionStatus"""
  where="""(?='' OR m.MaterialCode LIKE ? OR m.MaterialName LIKE ? OR p.PriceBasis LIKE ?)
   AND (? IS NULL OR p.Status=?) AND (? IS NULL OR p.MaterialID=?) AND (? IS NULL OR p.CurrencyID=?)
   AND (? IS NULL OR (p.EffectiveFrom<=? AND (p.EffectiveTo IS NULL OR p.EffectiveTo>=?)))
   AND (? IS NULL OR p.CreatedBy=?)"""
  params=[search,search+"%",search+"%",search+"%",status,status,material_id,material_id,currency_id,currency_id,as_of,as_of,as_of,created_by,created_by]
 if entity=="uoms":
  execute("IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.UserName=? AND u.IsActive=1 AND (a.Scope='Admin' OR dbo.fn_WorkspaceAccess(u.ID,'uoms',0)=1)) THROW 51102,'Admin access is required for this action.',1;",[ctx.username])
 auth_sql=PRODUCT_AUTH if entity=="products" else master_auth(entity)
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
 if entity=="packaging-types":decode_orders(rows)
 return dict(rows=rows,total=sets[1][0]["Total"],page=page,page_size=page_size)
class Export(BaseModel):
 model_config=ConfigDict(extra="forbid")
 columns:list[str]=Field(min_length=1,max_length=32)
 rows:list[list[str|None]]=Field(max_length=500)
@router.post("/{entity}/export")
def export(entity:Entity,body:Export,ctx:AccessContext=Depends(get_access_context)):
 require_entity(ctx,entity)
 if len(body.columns)!=len(set(body.columns)) or any(c not in COLUMNS[entity] for c in body.columns):
  raise HTTPException(422,"Invalid export columns.")
 return Response(snapshot_xlsx(body,COLUMNS[entity],"Products" if entity=="products" else "Raw Material" if entity in ("raw-materials","raw-prices","raw-grades") else "Packaging"),media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",headers={"Content-Disposition":f'attachment; filename="{entity}.xlsx"',"Cache-Control":"no-store"})
