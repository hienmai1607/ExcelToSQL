"""Unit conversion maintenance; general factors are Admin-only."""
from decimal import Decimal
from typing import Literal
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator
from auth import AccessContext, get_access_context
from packaging_api import execute, require, rv

router=APIRouter(prefix="/api/unit-conversions",tags=["Unit Conversion"])
AUTH="""DECLARE @Actor INT,@Admin BIT=0,@Packaging BIT=0,@Raw BIT=0;
SELECT @Actor=ID FROM dbo.Users WHERE UserName=? AND IsActive=1;
IF @Actor IS NULL THROW 51101,'Username is incorrect.',1;
SELECT @Admin=MAX(CASE WHEN Scope='Admin' THEN 1 ELSE 0 END),
@Packaging=MAX(CASE WHEN Scope IN('Packaging','PackagingManager') THEN 1 ELSE 0 END),
@Raw=MAX(CASE WHEN Scope='RawMaterial' THEN 1 ELSE 0 END) FROM dbo.UserAccess WHERE UserID=@Actor;
IF COALESCE(@Admin,0)+COALESCE(@Packaging,0)+COALESCE(@Raw,0)=0 THROW 51102,'Material access is required.',1;
"""
VISIBLE="(@Admin=1 OR (c.PackagingMaterialID IS NULL AND c.RawMaterialID IS NULL) OR (@Packaging=1 AND c.PackagingMaterialID IS NOT NULL) OR (@Raw=1 AND c.RawMaterialID IS NOT NULL))"
@router.get("")
def read(page:int=Query(1,ge=1),search:str=Query("",max_length=200),ctx:AccessContext=Depends(get_access_context)):
 require(ctx,"Packaging","PackagingManager","RawMaterial")
 sets=execute(AUTH+"""
 SELECT c.*,f.UoMCode AS FromUoM,t.UoMCode AS ToUoM,
 COALESCE(p.MaterialCode,r.MaterialCode) AS MaterialCode,v.VendorName,
 creator.UserName AS CreatedByName,updater.UserName AS UpdatedByName
 FROM dbo.UnitConversion c JOIN dbo.UoM f ON f.ID=c.FromUoMID JOIN dbo.UoM t ON t.ID=c.ToUoMID
 LEFT JOIN dbo.PackagingMaterial p ON p.ID=c.PackagingMaterialID
 LEFT JOIN dbo.RawMaterial r ON r.ID=c.RawMaterialID LEFT JOIN dbo.Vendor v ON v.ID=c.VendorID
 LEFT JOIN dbo.Users creator ON creator.ID=c.CreatedBy LEFT JOIN dbo.Users updater ON updater.ID=c.UpdatedBy
 WHERE """+VISIBLE+""" AND (?='' OR f.UoMCode LIKE ? OR t.UoMCode LIKE ? OR p.MaterialCode LIKE ? OR r.MaterialCode LIKE ?)
 ORDER BY c.ID DESC OFFSET ? ROWS FETCH NEXT 51 ROWS ONLY;
 """,[ctx.username,search,*([search+"%"]*4),(page-1)*50])
 rows=[{k:str(v) if isinstance(v,Decimal) else v for k,v in r.items()} for r in sets[0]]
 return dict(rows=rows[:50],has_more=len(rows)>50)

@router.get("/lookups")
def lookups(ctx:AccessContext=Depends(get_access_context)):
 require(ctx,"Packaging","PackagingManager","RawMaterial")
 sets=execute(AUTH+"""
 SELECT ID,UoMCode,Status FROM dbo.UoM ORDER BY UoMCode;
 SELECT ID,MaterialCode,MaterialName,Status FROM dbo.PackagingMaterial WHERE @Admin=1 OR @Packaging=1 ORDER BY MaterialCode;
 SELECT ID,MaterialCode,MaterialName,Status FROM dbo.RawMaterial WHERE @Admin=1 OR @Raw=1 ORDER BY MaterialCode;
 SELECT ID,VendorName,Status FROM dbo.Vendor ORDER BY VendorName;
 """,[ctx.username])
 return dict(uoms=sets[0],packaging=sets[1],raw=sets[2],vendors=sets[3])

class Conversion(BaseModel):
 model_config=ConfigDict(extra="forbid")
 ID:int|None=Field(None,ge=1)
 RowVersion:str|None=None
 FromUoMID:int=Field(ge=1)
 ToUoMID:int=Field(ge=1)
 Factor:Decimal=Field(gt=0,max_digits=24,decimal_places=9)
 PackagingMaterialID:int|None=Field(None,ge=1)
 RawMaterialID:int|None=Field(None,ge=1)
 VendorID:int|None=Field(None,ge=1)
 Status:Literal["Active","Block"]="Active"
 @model_validator(mode="after")
 def valid(self):
  if self.FromUoMID==self.ToUoMID:raise ValueError("Choose different units.")
  if self.PackagingMaterialID and self.RawMaterialID:raise ValueError("Choose one material type.")
  if self.VendorID and not (self.PackagingMaterialID or self.RawMaterialID):raise ValueError("Vendor requires a material.")
  if not self.ID and self.RowVersion:raise ValueError("New conversions cannot have a RowVersion.")
  return self

@router.post("")
def save(body:Conversion,ctx:AccessContext=Depends(get_access_context)):
 require(ctx,"Admin" if not (body.PackagingMaterialID or body.RawMaterialID) else "Packaging" if body.PackagingMaterialID else "RawMaterial")
 version=rv(body.RowVersion) if body.ID else None
 return execute("EXEC dbo.usp_UnitConversion_Save ?,?,?,?,?,?,?,?,?,?;",
 [ctx.username,body.ID,version,body.FromUoMID,body.ToUoMID,body.Factor,body.PackagingMaterialID,body.RawMaterialID,body.VendorID,body.Status])[0][0]
