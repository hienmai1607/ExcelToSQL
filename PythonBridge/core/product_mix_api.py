"""One-level Product Mix versions; SQL owns validation and weight calculation."""
import json
from decimal import Decimal
from typing import Literal
from fastapi import APIRouter, Depends, Path
from pydantic import BaseModel, ConfigDict, Field, model_validator
from auth import AccessContext, get_access_context
from packaging_api import execute, require, rv
from cache import invalidate

class MixItem(BaseModel):
 model_config=ConfigDict(extra="forbid")
 ProductID:int=Field(ge=1)
 UnitQuantity:Decimal=Field(gt=0,max_digits=12,decimal_places=4,allow_inf_nan=False)
 RowVersion:str
class MixSave(BaseModel):
 model_config=ConfigDict(extra="forbid")
 VersionID:int|None=Field(None,ge=1)
 RowVersion:str|None=None
 ProductRowVersion:str
 Status:Literal["Draft","Active"]="Draft"
 items:list[MixItem]=Field(min_length=1,max_length=500)
 @model_validator(mode="after")
 def validate_items(self):
  if bool(self.VersionID)!=bool(self.RowVersion):raise ValueError("Version ID and RowVersion must be supplied together.")
  if len({i.ProductID for i in self.items})!=len(self.items):raise ValueError("Duplicate child Product.")
  return self
router=APIRouter(prefix="/api/workbench/products",tags=["Product Mix"])
@router.get("/{product_id}/mix")
def read(product_id:int=Path(ge=1),ctx:AccessContext=Depends(get_access_context)):
 require(ctx,"Product")
 sets=execute("EXEC dbo.usp_ProductMix_Read ?,?",[product_id,ctx.username])
 return dict(product=sets[0][0],versions=sets[1],items=sets[2],choices=sets[3])
@router.post("/{product_id}/mix")
def save(body:MixSave,product_id:int=Path(ge=1),ctx:AccessContext=Depends(get_access_context)):
 require(ctx,"Product")
 items=[dict(ProductID=i.ProductID,UnitQuantity=str(i.UnitQuantity),RowVersion="0x"+rv(i.RowVersion).hex()) for i in body.items]
 result=execute("EXEC dbo.usp_ProductMix_Save ?,?,?,?,?,?,?",[product_id,ctx.username,body.VersionID,rv(body.RowVersion,False),rv(body.ProductRowVersion),body.Status,json.dumps(items)])
 invalidate("opportunity_master_lookups")
 return result[0][0]

@router.get("/{product_id}/mix/grades")
def child_grades(product_id:int=Path(ge=1),ctx:AccessContext=Depends(get_access_context)):
 require(ctx,"Product")
 sets=execute("EXEC dbo.usp_ProductMix_Grades_Read ?,?",[product_id,ctx.username])
 return dict(product=sets[0][0],versions=sets[1],items=sets[2])
