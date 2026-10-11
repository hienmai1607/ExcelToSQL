from workspace_access import require_page_edit
"""Shared Material/Pricing workbook adapter. Existing SQL owns master validation."""
import io
import json
import os
import re
import zipfile
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Literal
from xml.sax.saxutils import escape
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from auth import AccessContext, get_access_context
from master_models import MasterLayout, COLUMNS, MASTER_REQUIRED_COLUMNS, check_layout
from packaging_master_api import read as master_read, require_entity, master_auth
from packaging_api import execute, require, MaterialBatch, PriceBatch, material_save, price_save, VendorBatch, vendor_save, UoMBatch, uom_save
from packaging_api import PackagingPriceBatch
from supplier_geometry import SUPPLIER_FIELDS
from product_excel_api import sheet, header_styles

from raw_material_api import RawMaterialBatch, material_save as raw_material_save, price_save as raw_price_save
from pallet_api import PalletBatch, pallet_save
from pallet_fields import PALLET_CAPACITY_LABELS
from packaging_type_api import PackagingTypeBatch, packaging_type_save
Entity=Literal["materials","prices","raw-materials","raw-prices","vendors","uoms","pallets","packaging-types"]
router=APIRouter(prefix="/api/workbench/master-excel",tags=["Packaging Master Excel"])
TEMPLATE=Path(__file__).resolve().parents[1]/"templates"/"Packaging_Master_Local_Update.xlsm"
CONFIG={
 "packaging-types":dict(table="PackagingType",filename="Packaging_Type_Local_Update.xlsm",title="Packaging Type Master",editable={"ParentType","PackagingOrder","PackagingType","Shipping","FinalComponent","Status"}),
 "pallets":dict(table="v_PalletMaster",filename="Pallet_Master_Local_Update.xlsm",title="Pallet Master",editable={"UnitOfMeasure","Width","Length","PalletPriceUSDPerEA","Status",*PALLET_CAPACITY_LABELS}),
 "uoms":dict(table="UoM",filename="UoM_Local_Update.xlsm",title="UoM",editable={"UoMCode","UoMName","Status"}),
 "vendors":dict(table="Vendor",filename="Vendor_Local_Update.xlsm",title="Vendor",editable={"VendorName","Address","Status","CurrencyCode"}),
 "materials":dict(table="PackagingMaterial",filename="Packaging_Material_Local_Update.xlsm",title="Packaging Material",
  editable={"MaterialName","UnitOfMeasure","Status","PackagingType"}),
 "prices":dict(table="PackagingPrice",filename="Packaging_Pricing_Local_Update.xlsm",title="Packaging Pricing",
  editable={"ExchangeRateToUSD","VendorName","MaterialCode","CurrencyCode","BaseUoM","QuantityFrom","QuantityTo","UnitPrice","EffectiveFrom","EffectiveTo","Status"})
}
CONFIG["raw-materials"]={**CONFIG["materials"],"table":"RawMaterial","filename":"Raw_Material_Local_Update.xlsm","title":"Raw Material",
 "editable":{*(CONFIG["materials"]["editable"]-{"PackagingType"}),"Description","GradeName"}}
CONFIG["raw-prices"]={**CONFIG["prices"],"table":"RawMaterialPrice","filename":"Raw_Material_Pricing_Local_Update.xlsm","title":"Raw Material Pricing"}
CONFIG["prices"]["editable"] = CONFIG["prices"]["editable"] | set(SUPPLIER_FIELDS)
AUTH="DECLARE @Actor INT; EXEC dbo.usp_Packaging_Authorize ?,'MasterRead',@Actor OUTPUT; "
META=["_ID","_RowVersion","_Original"]
class View(BaseModel):
 model_config=ConfigDict(extra="forbid")
 layout:MasterLayout
 page:int=Field(1,ge=1,le=1000000)
class PageInput(View):
 search:str=Field("",max_length=200)
 status:Literal["","Active","Block"]=""
 creator:str=Field("",max_length=100)
 material:str=Field("",max_length=40)
 currency:str=Field("",max_length=10)
 as_of:date|None=None

def resolve(ctx,table,column,value,entity="materials"):
 rows=execute(master_auth(entity)+f"SELECT ID FROM dbo.{table} WHERE {column}=?",[ctx.username,value])[0]
 if len(rows)!=1:raise ValueError(column+" was not found or is ambiguous.")
 return rows[0]["ID"]

def normalize_row(entity,row):
 result={}
 for key,value in row.items():
  if isinstance(value,datetime):
   if value.tzinfo is None:value=value.replace(tzinfo=timezone.utc)
   value=value.astimezone(timezone(timedelta(hours=7))).strftime("%Y-%m-%d %I:%M %p")
  elif isinstance(value,(date,Decimal)):value=str(value)
  result[key]=value
 if entity=='packaging-types':result['FinalComponent']='True' if row.get('FinalComponent') else 'False';result['Shipping']=None if row.get('ParentTypeID') is not None else 'True' if row.get('Shipping') else 'False'
 result.update(Command="N",_ID=row["ID"],_RowVersion=row["RowVersion"])
 result["_Original"]=json.dumps({k:result.get(k) for k in COLUMNS[entity]},ensure_ascii=False)
 return result

def page_data(entity,body,ctx,override=False):
 require_entity(ctx,entity)
 try:
  check_layout(entity,body.layout)
  values=body.layout.values
  search=body.search if override else values.get("search","")
  status=body.status if override else values.get("status","")
  if status not in ("","Active","Block"):raise ValueError("Invalid status.")
  creator=resolve(ctx,"Users","UserName",body.creator,entity) if override and body.creator else None if override else int(values["created_by"]) if values.get("created_by") else None
  material=currency=effective=None
  if entity in ("prices","raw-prices"):
   material=resolve(ctx,"RawMaterial" if entity=="raw-prices" else "PackagingMaterial","MaterialCode",body.material,entity) if override and body.material else None if override else int(values["material_id"]) if values.get("material_id") else None
   currency=resolve(ctx,"Currency","CurrencyCode",body.currency,entity) if override and body.currency else None if override else int(values["currency_id"]) if values.get("currency_id") else None
   effective=body.as_of if override else date.fromisoformat(values["as_of"]) if values.get("as_of") else None
  for id in (creator,material,currency):
   if id is not None and id<1:raise ValueError("Invalid filter ID.")
  data=master_read(entity=entity,page=body.page,page_size=body.layout.page_size,search=search,status=status or None,
   material_id=material,currency_id=currency,as_of=effective,created_by=creator,
   sort=json.dumps([r.model_dump() for r in body.layout.sort]),ctx=ctx)
 except ValueError as exc:raise HTTPException(422,str(exc)) from exc
 return {**data,"rows":[normalize_row(entity,r) for r in data["rows"]]}

@router.post("/{entity}/page")
def page(entity:Entity,body:PageInput,ctx:AccessContext=Depends(get_access_context)):
 return page_data(entity,body,ctx,True)

def filter_labels(entity,body,ctx):
 result={}
 for key,table,column in (("created_by","Users","UserName"),("material_id","PackagingMaterial","MaterialCode"),("currency_id","Currency","CurrencyCode")):
  if table=="PackagingMaterial" and entity=="raw-prices":table="RawMaterial"
  if body.layout.values.get(key):
   rows=execute(master_auth(entity)+f"SELECT {column} AS Label FROM dbo.{table} WHERE ID=?",[ctx.username,int(body.layout.values[key])])[0]
   result[key]=rows[0]["Label"] if rows else ""
 return result

def build(entity,body,data,base,labels=None):
 selected=check_layout(entity,body.layout).columns
 spec=CONFIG[entity];required=MASTER_REQUIRED_COLUMNS[entity];labels=labels or {}
 keys=["Command",*selected,*[k for k in COLUMNS[entity] if k not in selected],"_Result","_Message",*META]
 friendly={"Command":"Command (C/U/D)","_Result":"Result","_Message":"Message",**COLUMNS[entity]}
 headers=[friendly.get(k,k)+(" *" if k in required else " [display]" if k in COLUMNS[entity] and k not in spec["editable"] else "") for k in keys]
 rows=[headers,keys]+[[r.get(k) for k in keys] for r in data["rows"]]
 hidden=[n+1 for n,k in enumerate(keys) if k in META or k in COLUMNS[entity] and k not in selected]
 config=[["Version","1"],["API",base.rstrip("/")],["Layout",body.layout.model_dump_json()],["Pending","0"],
 ["LoadedPage",body.page],["Entity",entity],["Editable","|".join(sorted(spec["editable"]))],["Required","|".join(required)],["Title",spec["title"]]]
 with zipfile.ZipFile(TEMPLATE) as z:
  styles,colors=header_styles(z.read("xl/styles.xml").decode())
  ids=[colors["required" if k in required else "editable" if k in spec["editable"] or k=="Command" else "display"] for k in keys]
  control=z.read("xl/worksheets/sheet2.xml").decode()
  values=body.layout.values
  inputs={"A1":spec["title"]+" Excel Local Update","B3":values.get("search",""),"B4":values.get("status",""),"B5":labels.get("created_by",""),
  "B6":body.page,"B7":body.layout.page_size,"B8":data["total"],"B9":labels.get("material_id",""),"B10":labels.get("currency_id",""),"B11":values.get("as_of","")}
  for ref,value in inputs.items():
   control,count=re.subn(r'<c\b[^>]*\br="'+ref+r'"[^>]*>.*?</c>',lambda _:'<c r="'+ref+'" t="inlineStr"><is><t>'+escape(str(value))+'</t></is></c>',control,count=1,flags=re.S)
   if count!=1:raise RuntimeError("Master control template is incomplete.")
  replacements={"xl/styles.xml":styles,"xl/worksheets/sheet1.xml":sheet(rows,hidden,True,True,ids),
   "xl/worksheets/sheet2.xml":control.encode(),"xl/worksheets/sheet3.xml":sheet(config)}
  out=io.BytesIO()
  with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as target:
   for entry in z.infolist():target.writestr(entry,replacements.get(entry.filename,z.read(entry.filename)))
 return out.getvalue()

@router.post("/{entity}/download")
def download(entity:Entity,body:View,request:Request,ctx:AccessContext=Depends(get_access_context)):
 require_entity(ctx,entity)
 if not TEMPLATE.exists():raise HTTPException(503,"Packaging master Excel template is not installed.")
 data=page_data(entity,body,ctx)
 base=os.environ.get("EXCEL_API_BASE_URL",str(request.base_url))
 if not base.startswith(("http://","https://")):raise HTTPException(503,"Invalid Excel API URL.")
 return Response(build(entity,body,data,base,filter_labels(entity,body,ctx)),media_type="application/vnd.ms-excel.sheet.macroEnabled.12",
  headers={"Content-Disposition":'attachment; filename="'+CONFIG[entity]["filename"]+'"',"Cache-Control":"no-store"})

class Edit(BaseModel):
 model_config=ConfigDict(extra="forbid")
 row:int=Field(ge=3,le=1048576)
 command:Literal["C","U","D"]
 id:int|None=Field(None,ge=1)
 version:str|None=None
 changes:dict=Field(default_factory=dict)
 @model_validator(mode="after")
 def identity(self):
  if self.command=="C" and (self.id or self.version):raise ValueError("Create cannot have an ID or RowVersion.")
  if self.command!="C" and (not self.id or not self.version):raise ValueError("ID and RowVersion are required.")
  return self
class Batch(BaseModel):
 model_config=ConfigDict(extra="forbid")
 rows:list[Edit]=Field(min_length=1,max_length=500)
 @model_validator(mode="after")
 def unique(self):
  ids=[r.id for r in self.rows if r.id]
  if len(ids)!=len(set(ids)) or len({r.row for r in self.rows})!=len(self.rows):raise ValueError("Duplicate row or ID.")
  return self

def sources(entity,ids,ctx):
 if not ids:return {}
 table=CONFIG[entity]["table"]
 rows=execute(master_auth(entity)+f"SELECT * FROM dbo.{table} WHERE ID IN (SELECT ID FROM OPENJSON(CAST(? AS NVARCHAR(MAX))) WITH(ID INT '$'))",[ctx.username,json.dumps(ids)])[0]
 return {r["ID"]:r for r in rows}

def prepare(entity,edit,source,ctx):
 if entity in ("prices","raw-prices") and "PriceBasis" in edit.changes:
  edit.changes["BaseUoM"]=edit.changes.pop("PriceBasis")
 if set(edit.changes)-CONFIG[entity]["editable"]:raise ValueError("Read-only or unknown field.")
 if edit.command!="C":
  if not source:raise ValueError("Row not found. Refresh.")
  if source["RowVersion"]!=edit.version:raise ValueError("RowVersion conflict. Refresh before saving.")
 values={**source,**edit.changes}
 fields=CONFIG[entity]["editable"] if entity not in ("prices","raw-prices") else {"ExchangeRateToUSD","VendorID","MaterialID","CurrencyID","PriceBasis","QuantityFrom","QuantityTo","UnitPrice","EffectiveFrom","EffectiveTo","Status"}
 data={k:values.get(k) for k in fields}
 if entity=="prices":
  data.update({k:values.get(k) for k in SUPPLIER_FIELDS})
  definition_id=data.get("SupplierDimensionID")
  if definition_id:
   definition=execute(master_auth(entity)+"SELECT RowVersion FROM dbo.PackagingDimension WHERE ID=?",[ctx.username,int(definition_id)])[0]
   data["SupplierDimensionRowVersion"]=definition[0]["RowVersion"] if definition else None
  # Old workbooks editing unrelated fields must not reinterpret supplier formulas.
  if not set(SUPPLIER_FIELDS).intersection(edit.changes) and edit.command!="C":
   for k in (*SUPPLIER_FIELDS,"SupplierDimensionRowVersion"): data.pop(k,None)
 if entity=="packaging-types":
  data.pop("ParentType",None)
  shipping=values.get('Shipping',False)
  if isinstance(shipping,str) and shipping.strip().lower() in ('true','false'):shipping=shipping.strip().lower()=='true'
  if not isinstance(shipping,bool):raise ValueError('Shipping must be True or False.')
  data['Shipping']=shipping
  final=values.get("FinalComponent",source.get("FinalComponent",False))
  if isinstance(final,str) and final.strip().lower() in ("true","false"):final=final.strip().lower()=="true"
  if not isinstance(final,bool):raise ValueError("Final component must be True or False.")
  data["FinalComponent"]=final
  if edit.command!="D" and ("ParentType" in edit.changes or edit.command=="C"):
   name=str(values.get("ParentType") or "").strip()
   if name:
    matches=execute(master_auth(entity)+"""SELECT ID FROM dbo.PackagingType
     WHERE (CONCAT(PackagingOrder,N' / ',PackagingType)=? OR PackagingType=?) AND Status='Active'""",[ctx.username,name,name])[0]
    if len(matches)!=1:raise ValueError("Choose an active Parent Type using Order / Packaging Type; the value is missing or ambiguous.")
    data["ParentTypeID"]=matches[0]["ID"]
   else:data["ParentTypeID"]=None
  if data.get('ParentTypeID',source.get('ParentTypeID')) is not None:
   if 'Shipping' in edit.changes and shipping:raise ValueError('Shipping applies only to root Packaging Types.')
   data['Shipping']=False
 if entity=="materials":
  data.pop("PackagingType",None)
  if "PackagingType" in edit.changes or edit.command=="C":
   name=str(values.get("PackagingType") or "").strip()
   if name:
    matches=execute(master_auth(entity)+"""SELECT ID FROM dbo.PackagingType
     WHERE (CONCAT(PackagingOrder,N' / ',PackagingType)=? OR PackagingType=?) AND Status='Active' AND FinalComponent=1
      AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType child WHERE child.ParentTypeID=PackagingType.ID)""",[ctx.username,name,name])[0]
    if len(matches)!=1:raise ValueError("Choose an active Final component Packaging Type using Order / Packaging Type; the value is missing or ambiguous.")
    data["PackagingTypeID"]=matches[0]["ID"]
   else:data["PackagingTypeID"]=None
 if entity in ("prices","raw-prices") and "BaseUoM" in edit.changes:data["PriceBasis"]=edit.changes["BaseUoM"]
 if entity=="vendors":
  data.pop("CurrencyCode",None)
  data["CurrencyID"]=source.get("CurrencyID")
  if "CurrencyCode" in edit.changes:
   code=edit.changes["CurrencyCode"]
   data["CurrencyID"]=resolve(ctx,"Currency","CurrencyCode",code,entity) if code else None
 if entity=="raw-materials":
  data.pop("GradeName",None)
  data["GradeID"]=source.get("GradeID")
  if "GradeName" in edit.changes or edit.command=="C":
   name=str(values.get("GradeName") or "").strip()
   if name:
    matches=execute(master_auth(entity)+"""SELECT g.ID FROM dbo.RawGrade g WHERE g.GradeName=?
     AND g.Status='Active' AND NOT EXISTS(SELECT 1 FROM dbo.RawGrade child WHERE child.ParentGradeID=g.ID)""",[ctx.username,name])[0]
    if len(matches)!=1:raise ValueError("Grade name was not found, is a parent grade, or is ambiguous.")
    data["GradeID"]=matches[0]["ID"]
   else:data["GradeID"]=None
 if edit.command!="D":
  if entity in ("prices","raw-prices"):
   if "VendorName" in edit.changes or edit.command=="C":
    vendor=values.get("VendorName")
    data["VendorID"]=resolve(ctx,"Vendor","VendorName",str(vendor).strip(),entity) if vendor is not None and str(vendor).strip() else None
   for name,table in (("Material","RawMaterial" if entity=="raw-prices" else "PackagingMaterial"),("Currency","Currency")):
    key=name+"Code"
    if key in edit.changes or edit.command=="C":
     value=values.get(key)
     data[name+"ID"]=resolve(ctx,table,key,value,entity) if value is not None and str(value).strip() else None
   if data["VendorID"] and (edit.command=="C" or "VendorName" in edit.changes) and not str(edit.changes.get("CurrencyCode") or "").strip():
    vendor_rows=execute(master_auth(entity)+"SELECT CurrencyID FROM dbo.Vendor WHERE ID=?",[ctx.username,data["VendorID"]])[0]
    data["CurrencyID"]=vendor_rows[0]["CurrencyID"] if vendor_rows else None
    if data["CurrencyID"]!=source.get("CurrencyID") and "ExchangeRateToUSD" not in edit.changes:
     data["ExchangeRateToUSD"]=None
   for key in ("EffectiveFrom","EffectiveTo"):
    if data[key] is not None:
     # Reject bare Excel serials at the API; VBA converts real date cells to ISO.
     if not isinstance(data[key],date):data[key]=date.fromisoformat(str(data[key]))
   required=("MaterialID","CurrencyID","PriceBasis","QuantityFrom","UnitPrice","EffectiveFrom")
  else:required=tuple(k for k in MASTER_REQUIRED_COLUMNS[entity] if k!="Shipping")
  for key in required:
   if data.get(key) is None or str(data[key]).strip()=="":raise ValueError(key+" is required.")
 if edit.command=="C" and not data.get("Status"):data["Status"]="Active"
 data.update(RowNum=edit.row,Command=edit.command,ID=edit.id,RowVersion=edit.version)
 return (PackagingTypeBatch if entity=="packaging-types" else PalletBatch if entity=="pallets" else UoMBatch if entity=="uoms" else VendorBatch if entity=="vendors" else RawMaterialBatch if entity=="raw-materials" else MaterialBatch if entity=="materials" else PackagingPriceBatch if entity=="prices" else PriceBatch)(rows=[data])

@router.post("/{entity}/save")
def save(entity:Entity,body:Batch,ctx:AccessContext=Depends(get_access_context)):
 if entity=="uoms":require_page_edit(ctx,"uoms")
 else:require(ctx,"RawMaterial" if entity in ("raw-materials","raw-prices") else "Packaging")
 source=sources(entity,[r.id for r in body.rows if r.id],ctx)
 results=[]
 for edit in body.rows:
  try:
   payload=prepare(entity,edit,source.get(edit.id,{}),ctx)
   result=(packaging_type_save if entity=="packaging-types" else pallet_save if entity=="pallets" else raw_material_save if entity=="raw-materials" else raw_price_save if entity=="raw-prices" else uom_save if entity=="uoms" else vendor_save if entity=="vendors" else material_save if entity in ("materials","raw-materials") else price_save)(payload,ctx)["results"]
   results.extend(result)
  except (ValueError,HTTPException) as exc:
   if isinstance(exc,HTTPException) and exc.status_code>=500:raise
   results.append(dict(RowNum=edit.row,Status="ERROR",Message=exc.detail if isinstance(exc,HTTPException) else str(exc)))
 return {"results":results}
