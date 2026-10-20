"""Derive final measurements from one current material-price record."""
from decimal import Decimal
from fastapi import HTTPException
from packaging_api import rv
SLOTS=("D1","D2","D3")

def copied_geometry(root,price,dimensions,units,conversion):
 source=dimensions.get(price.get("MaterialDimensionID"))
 if not source or source["PackagingTypeID"]!=price["PackagingTypeID"]:
  raise HTTPException(422,"Maintain material dimensions in Packaging Material before using Copy Dim.")
 raw=price.get("MaterialDimensionRowVersion")
 raw=rv(raw) if isinstance(raw,str) else raw
 if raw is None or bytes(raw)!=bytes(source["RowVersion"]):
  raise HTTPException(409,"Material dimension definition changed. Refresh and update Packaging Material.")
 target=dimensions.get(source.get("ParentDimensionID") or source["ID"])
 if not target or target["PackagingTypeID"]!=root["ID"] or target.get("ParentDimensionID") is not None:
  raise HTTPException(422,"Material dimensions must link to the selected final type's dimension definition.")
 if source.get("FormulaNeedsReview") or target.get("FormulaNeedsReview"):
  raise HTTPException(422,"Review the material and final dimension definitions first.")
 values={}
 for key in SLOTS:
  name=str(target.get(key+"Name") or "").strip().casefold()
  if not name:values[key]=None;continue
  matches=[slot for slot in SLOTS if str(source.get(slot+"Name") or "").strip().casefold()==name]
  if len(matches)!=1 or price.get("Material"+matches[0]) is None:
   raise HTTPException(422,"Copy Dim. needs one maintained material measurement matching "+str(target[key+"Name"])+".")
  slot=matches[0];value=Decimal(str(price["Material"+slot]))
  source_unit=units.get(source.get(slot+"UoMID"));target_unit=units.get(target.get(key+"UoMID"))
  if value<=0 or not source_unit or not target_unit:
   raise HTTPException(422,"Copy Dim. requires positive measurements and active units.")
  if source_unit["ID"]!=target_unit["ID"]:
   factor=conversion(source_unit["UoMCode"],target_unit["UoMCode"])
   if factor is None or Decimal(str(factor))<=0:raise HTTPException(422,"Maintain a conversion for the copied dimension units.")
   value*=Decimal(str(factor))
  if value>=Decimal("1e12") or value!=value.quantize(Decimal(".000001")):
   raise HTTPException(422,"Copied measurements exceed supported range or six-decimal precision.")
  values[key]=value
 return target,values

def uses_copy(root,prices):
 return bool(root.get("CopyDim") or any(p.get("CopyDim") for p in prices))
