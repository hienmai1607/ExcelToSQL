"""Shortcut edits reuse normal master validation; saved snapshots are not rewritten."""
import base64
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from auth import AccessContext, get_access_context
from db import get_raw_cursor, reuse_transaction
from packaging_api import rv
from business_deletion_api import quote, row_dict, Target, editable

router=APIRouter(prefix="/api/inline-masters",tags=["Inline master editing"])
# No request text reaches an identifier or procedure name.
TABLES={"customers":"Customer","products":"Product","categories":"ProductCategory",
 "materials":"PackagingMaterial","raw-materials":"RawMaterial","raw-prices":"RawMaterialPrice",
 "vendors":"Vendor","raw-grades":"RawGrade","packaging-types":"PackagingType",
 "packaging-dimensions":"PackagingDimension","pallets":"Pallet","ports":"PortOfEntry"}
LOCKS={"raw-materials":("GradeID",),"raw-prices":("MaterialID",),"materials":("PackagingTypeID",),
 "products":("CustomerID",),"raw-grades":("ParentGradeID",),"packaging-dimensions":("PackagingTypeID",),
 "packaging-types":("ParentTypeIDs",),
 "ports":("CustomerID","MarketID")}
SCOPES={"customers":"Customer","products":"Product","categories":"Product",
 "raw-materials":"RawMaterial","raw-prices":"RawMaterial","raw-grades":"RawMaterial"}
def authorize(ctx,entity):
 if entity not in TABLES:raise HTTPException(404,"Inline editing is not supported for this master.")
 if not editable(ctx,Target(TABLES[entity],entity,"",())):
  raise HTTPException(403,"Edit access is required for this master.")
 if entity=="ports":return  # Port maintenance uses page permission, like ports_api.save.
 scope=SCOPES.get(entity,"Packaging")
 if not ctx.is_admin and scope not in ctx.scopes:raise HTTPException(403,"The master maintenance role is required.")
def record(cur,entity,key,locked=False):
 column="CategoryName" if entity=="categories" else "ID"
 if column=="ID":
  if not key.isdecimal() or not 0<int(key)<=2147483647:raise HTTPException(422,"Choose a valid master record.")
  key=int(key)
 cur.execute("SELECT * FROM dbo."+quote(TABLES[entity])+(" WITH(UPDLOCK,HOLDLOCK)" if locked else "")+" WHERE "+quote(column)+"=?",key)
 row=row_dict(cur)
 if not row:raise HTTPException(404,"The selected master is no longer available.")
 if entity=="packaging-types":
  # The editor needs complete multi-order and multi-parent membership, not the
  # legacy scalar columns. Keep the base-row lock while loading the normal view.
  from packaging_orders import decode_orders
  cur.execute("SELECT * FROM dbo.v_PackagingTypeWeb WHERE ID=?",row["ID"])
  row=decode_orders([row_dict(cur)])[0]
 return row
def public(row):
 result={k:base64.b64encode(bytes(v)).decode() if isinstance(v,(bytes,bytearray)) else str(v) if isinstance(v,Decimal) else v for k,v in row.items()}
 if "PriceBasis" in result:result["BaseUoM"]=result["PriceBasis"]
 for n in ("D1","D2","D3"):
  if n+"Name" in result:result[n]=result[n+"Name"]
 return result
@router.get("/{entity}/{key}")
def read(entity:str,key:str,ctx:AccessContext=Depends(get_access_context)):
 authorize(ctx,entity)
 with get_raw_cursor() as cur:
  row=record(cur,entity,key)
  # Opening an editor follows master permissions, not blanket FK eligibility.
  # The normal save handler owns business/reference validation for both views.
 return {"row":public(row),"editable":True,"reason":"","lockedFields":LOCKS.get(entity,())}

class InlineSave(BaseModel):
 model_config=ConfigDict(extra="forbid")
 payload:dict=Field()
def write(entity,payload,ctx):
 # Reuse the normal validators, permissions, stored procedures and audit paths.
 if entity in ("customers","products"):
  import main
  from schemas import CustomerBatchRequest,ProductBatchRequest
  model=(CustomerBatchRequest if entity=="customers" else ProductBatchRequest).model_validate({"rows":[{"RowNum":1,"Command":"U",**payload}]} if entity=="customers" and "rows" not in payload else payload)
  return (main.customer_batch if entity=="customers" else main.product_batch)(model,ctx.username,ctx.is_admin,ctx.scopes)
 if entity=="categories":
  from category_api import CategorySave,save
  return save(CategorySave.model_validate(payload),ctx)
 if entity=="ports":
  from ports_api import PortSave,save
  return save(PortSave.model_validate(payload),ctx)
 if entity=="packaging-dimensions":
  from packaging_dimension_api import DimensionSave,save
  return save(DimensionSave.model_validate(payload),ctx)
 if entity=="packaging-types":
  from packaging_type_api import PackagingTypeBatch,packaging_type_save
  return packaging_type_save(PackagingTypeBatch.model_validate(payload),ctx)
 if entity=="pallets":
  from pallet_api import PalletBatch,pallet_save
  return pallet_save(PalletBatch.model_validate(payload),ctx)
 if entity=="raw-grades":
  from raw_material_api import RawGradeBatch,grade_save
  return grade_save(RawGradeBatch.model_validate(payload),ctx)
 if entity=="raw-materials":
  from raw_material_api import RawMaterialBatch,material_save
  return material_save(RawMaterialBatch.model_validate(payload),ctx)
 if entity=="raw-prices":
  from raw_material_api import PriceBatch,price_save
  return price_save(PriceBatch.model_validate(payload),ctx)
 if entity=="materials":
  from packaging_api import MaterialBatch,material_save
  return material_save(MaterialBatch.model_validate(payload),ctx)
 if entity=="vendors":
  from packaging_api import VendorBatch,vendor_save
  return vendor_save(VendorBatch.model_validate(payload),ctx)
 raise HTTPException(404,"Unsupported master.")
@router.post("/{entity}/{key}")
def save(entity:str,key:str,body:InlineSave,ctx:AccessContext=Depends(get_access_context)):
 authorize(ctx,entity)
 submitted=body.payload
 if "rows" in submitted:
  if not isinstance(submitted["rows"],list) or len(submitted["rows"])!=1:raise HTTPException(422,"Inline editing updates one existing master at a time.")
  values=submitted["rows"][0]
  if not isinstance(values,dict) or values.get("Command")!="U":raise HTTPException(422,"Inline editing only updates the selected master.")
 else:
  if entity not in ("customers","categories","ports","packaging-dimensions") or "Command" in submitted:
   raise HTTPException(422,"Inline editing only updates the selected master.")
  values=submitted
 with get_raw_cursor() as cur:
  depth=cur.execute("SELECT @@TRANCOUNT").fetchval()
  cur.execute("SET XACT_ABORT ON; SET QUOTED_IDENTIFIER ON; BEGIN TRANSACTION")
  try:
   row=record(cur,entity,key,True)
   if type(values.get("ID")) is not int or values["ID"]!=row["ID"] or rv(values.get("RowVersion"))!=bytes(row["RowVersion"]):
    raise HTTPException(409,"The selected master changed. Close, refresh and reopen it.")
   for field in LOCKS.get(entity,()):
    if field in values and str(values[field] or "")!=str(row.get(field) or ""):
     raise HTTPException(422,"The linked "+field+" is locked for inline editing.")
    values[field]=row.get(field)
   with reuse_transaction(cur.connection):
    result=write(entity,submitted,ctx)
   outcomes=result.get("results",[])
   if "results" in result and (len(outcomes)!=1 or outcomes[0].get("RowNum")!=values.get("RowNum",1)):
    raise HTTPException(409,"The master save outcome could not be verified. Refresh the selected record.")
   if any(r.get("Status")!="OK" for r in outcomes):
    raise HTTPException(422,next((str(r.get("Message") or "Master update failed.") for r in result["results"] if r.get("Status")!="OK"),"Master update failed."))
   if cur.execute("SELECT @@TRANCOUNT").fetchval()!=depth+1:raise HTTPException(409,"The master transaction could not be verified.")
   # Re-read by ID because an allowed Category rename changes its lookup key.
   cur.execute("SELECT * FROM dbo."+quote(TABLES[entity])+" WHERE ID=?",row["ID"])
   updated=public(row_dict(cur))
   cur.execute("COMMIT TRANSACTION")
   return {"row":updated,"rows":[updated],"results":[{"RowNum":1,"Status":"OK","NewID":updated["ID"],"NewRowVersion":updated["RowVersion"]}]}
  except ValidationError as exc:
   cur.execute("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION")
   raise HTTPException(422,"Invalid master values: "+str(exc)) from exc
  except HTTPException:
   cur.execute("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION")
   raise
  except Exception as exc:
   cur.execute("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION")
   raise HTTPException(409,"Master update could not be completed. Refresh; the record may be referenced or changed.") from exc
