"""Layout-aware combined Packaging Request export; Excel updates responses only."""
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
from request_views import RequestViews, RequestView, HEADERS, ITEMS, header_read, item_read
from packaging_api import require, execute, ResponseBatch, response_save
from packaging_fields import PACKAGINGCONFIGURATIONREQUESTITEM_FIELDS
from product_excel_api import sheet, header_styles

router=APIRouter(prefix="/api/workbench/packaging-excel",tags=["Packaging Request Excel"])
TEMPLATE=Path(__file__).resolve().parents[1]/"templates"/"Packaging_Request_Local_Update.xlsm"
REVIEW_REQUIRED=["FirstPMType","SecondPMType","UnitsPerCarton","PackagingDescription","FirstPMMOQ","SecondPMMOQ"]
HEADER_REQUIRED=["RequestNumber","OpportunityNumber","CustomerName"]
ITEM_REQUIRED=["ProductCode","ItemDescription","PIC",*REVIEW_REQUIRED]
# Same response fields exposed by the current web response editor; no snapshot or assignment edits.
EDITABLE={*PACKAGINGCONFIGURATIONREQUESTITEM_FIELDS,"PMCost","PMCostCurrencyCode","CostBasis","ResponseNotes","HeightMM","WidthMM","LengthMM"}
EXTRA={"CostBasis","ResponseNotes","HeightMM","WidthMM","LengthMM"}
META=["_RequestID","_ItemID","_ItemVersion","_Original"]
ALL_ITEMS=ITEMS|EXTRA
LABELS={"RequestNumber":"Request","OpportunityNumber":"Opportunity","CustomerName":"Customer","ResponseDue":"Response due",
"RequestStatus":"Status","RequestedAt":"Requested at (UTC+7)","RequestedByName":"Requested by","ItemCount":"Items",
"ProductCode":"Product code","ItemDescription":"Description","AnnualUnit":"Annual units","PIC":"PIC username",
"ItemStage":"Stage","PMCost":"PM cost","PMCostCurrencyCode":"Cost currency","FirstPMType":"1st PM type",
"SecondPMType":"2nd PM type","FirstPMMOQ":"1st PM MOQ","SecondPMMOQ":"2nd PM MOQ","UnitsPerCarton":"Unit / CTN",
"HeightMM":"Height (mm)","WidthMM":"Width (mm)","LengthMM":"Length (mm)"}

class View(BaseModel):
 model_config=ConfigDict(extra="forbid")
 views:RequestViews
 page:int=Field(1,ge=1,le=1000000)
 page_size:int=Field(200,ge=1,le=500)
 @model_validator(mode="after")
 def normalize(self):
  if self.views.header is None:self.views.header=RequestView(columns=sorted(HEADERS))
  if self.views.items is None:self.views.items=RequestView(columns=sorted(ITEMS))
  for view,required in ((self.views.header,HEADER_REQUIRED),(self.views.items,ITEM_REQUIRED)):
   view.columns=[*view.columns,*[k for k in required if k not in view.columns]]
  return self

def can_edit(ctx,row):
 return row.get("ItemStage") in ("Assigned","Working","Returned") and (ctx.is_admin or ("Packaging" in ctx.scopes and row.get("PICUserID")==ctx.user_id))

def serialize(row,ctx):
 row={k:str(v) if isinstance(v,(Decimal,date,datetime)) else v for k,v in row.items()}
 # Timestamp is display only, with the same UTC+7 convention as the app.
 if row.get("RequestedAt"):
  stamp=datetime.fromisoformat(row["RequestedAt"].replace("Z","+00:00"))
  if stamp.tzinfo is None:stamp=stamp.replace(tzinfo=timezone.utc)
  row["RequestedAt"]=stamp.astimezone(timezone(timedelta(hours=7))).strftime("%Y-%m-%d %I:%M %p")
 values={**row,"ItemCommand":"N","EditAccess":"Editable response" if can_edit(ctx,row) else "Display only",
 "_RequestID":row.get("RequestID"),"_ItemID":row.get("ItemID"),"_ItemVersion":row.get("ItemRowVersion")}
 values["_Original"]=json.dumps({k:row.get(k) for k in HEADERS|ALL_ITEMS},ensure_ascii=False,default=str)
 return values

def read_page(body,ctx):
 require(ctx,"Packaging","PackagingManager","Opportunity")
 view=body.views.header
 summary=header_read(ctx.username,body.page,body.page_size,view.values.get("search",""),view.values.get("status") or None,json.dumps([r.model_dump() for r in view.sort]))
 if not summary["rows"]:return {**summary,"rows":[]}
 ids=[r["RequestID"] for r in summary["rows"]]
 # One item read for all selected headers, no N+1 queries and no split documents.
 details=item_read(ctx.username,None,1,10001,None,None,json.dumps([r.model_dump() for r in body.views.items.sort]),request_ids=ids)
 if details["total"]>10000:raise HTTPException(422,"This page exceeds 10,000 items. Reduce requests per page.")
 groups={id:[] for id in ids}
 for row in details["rows"]:groups[row["RequestID"]].append(row)
 rows=[]
 for header in summary["rows"]:
  for item in groups[header["RequestID"]] or [{}]:rows.append(serialize({**header,**item},ctx))
 return {**summary,"rows":rows}

@router.post("/page")
def page(body:View,ctx:AccessContext=Depends(get_access_context)):
 return read_page(body,ctx)

def build(body,data,base):
 hc=body.views.header.columns;ic=body.views.items.columns
 keys=[*hc,*sorted(HEADERS-set(hc)),"ItemCommand",*ic,*sorted(ALL_ITEMS-set(ic)),"EditAccess","_Result","_Message",*META]
 visible=set(hc)|set(ic)
 hidden=[n+1 for n,k in enumerate(keys) if k in META or (k in HEADERS|ALL_ITEMS and k not in visible)]
 labels=[]
 for k in keys:
  if k=="ItemCommand":label="Item Command (N/U)"
  elif k=="EditAccess":label="Response access"
  elif k.startswith("_"):label={"_Result":"Result","_Message":"Message"}.get(k,k)
  else:
   label=("Header: " if k in HEADERS else "Item: ")+LABELS.get(k,re.sub(r"(?<=[a-z])(?=[A-Z])"," ",k))
   if k in REVIEW_REQUIRED:label+=" * review"
   if k not in EDITABLE:label+=" [display]"
  labels.append(label)
 rows=[labels,keys]+[[r.get(k) for k in keys] for r in data["rows"]]
 config=[["Version","1"],["API",base.rstrip("/")],["Layout",body.model_dump_json()],["Pending","0"],["LoadedPage",body.page],
 ["Editable","|".join(sorted(EDITABLE))],["Required","|".join(HEADER_REQUIRED+ITEM_REQUIRED)]]
 with zipfile.ZipFile(TEMPLATE) as z:
  styles,blue=header_styles(z.read("xl/styles.xml").decode())
  styles,orange=header_styles(styles.decode())
  text=styles.decode()
  for old,new in (("FFFFF2CC","FFF4B183"),("FFDDEBF7","FFFCE4D6")):
   left,sep,right=text.rpartition(old);text=left+new+right if sep else text
  styles=text.encode()
  colors=[]
  for key in keys:
   if key in HEADERS:colors.append(blue["editable"]) # blue headers labeled display
   else:colors.append(orange["required" if key in REVIEW_REQUIRED else "editable" if key in EDITABLE or key=="ItemCommand" else "display"])
  controls=z.read("xl/worksheets/sheet2.xml").decode()
  inputs={"B3":body.views.header.values.get("search",""),"B4":body.views.header.values.get("status",""),"B5":"Response updates only","B6":body.page,"B7":body.page_size,"B8":data["total"]}
  for ref,value in inputs.items():
   controls,count=re.subn(r'<c\b[^>]*\br="'+ref+r'"[^>]*>.*?</c>',lambda _:'<c r="'+ref+'" t="inlineStr"><is><t>'+escape(str(value))+'</t></is></c>',controls,count=1,flags=re.S)
   if count!=1:raise RuntimeError("Packaging control template is incomplete.")
  replacements={"xl/styles.xml":styles,"xl/worksheets/sheet1.xml":sheet(rows,hidden,True,True,colors),
  "xl/worksheets/sheet2.xml":controls.encode(),"xl/worksheets/sheet3.xml":sheet(config)}
  out=io.BytesIO()
  with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as target:
   for entry in z.infolist():target.writestr(entry,replacements.get(entry.filename,z.read(entry.filename)))
 return out.getvalue()

@router.post("/download")
def download(body:View,request:Request,ctx:AccessContext=Depends(get_access_context)):
 require(ctx,"Packaging","PackagingManager","Opportunity")
 if not TEMPLATE.exists():raise HTTPException(503,"Packaging Request Excel template is not installed.")
 base=os.environ.get("EXCEL_API_BASE_URL",str(request.base_url))
 if not base.startswith(("http://","https://")):raise HTTPException(503,"Invalid Excel API URL.")
 return Response(build(body,read_page(body,ctx),base),media_type="application/vnd.ms-excel.sheet.macroEnabled.12",
 headers={"Content-Disposition":'attachment; filename="Packaging_Request_Local_Update.xlsm"',"Cache-Control":"no-store"})

class Edit(BaseModel):
 model_config=ConfigDict(extra="forbid")
 row:int=Field(ge=3,le=1048576)
 request_id:int=Field(ge=1)
 item_id:int=Field(ge=1)
 version:str
 command:Literal["U"]="U"
 changes:dict=Field(min_length=1)
 @model_validator(mode="after")
 def fields(self):
  if set(self.changes)-EDITABLE:raise ValueError("Header, snapshot, PIC and workflow fields are display only.")
  return self
class Batch(BaseModel):
 model_config=ConfigDict(extra="forbid")
 rows:list[Edit]=Field(min_length=1,max_length=500)
 @model_validator(mode="after")
 def unique(self):
  if len({r.row for r in self.rows})!=len(self.rows) or len({r.item_id for r in self.rows})!=len(self.rows):raise ValueError("Duplicate item IDs or worksheet rows.")
  return self

def load_sources(ctx,request_ids):
 # Existing read policy hides unapproved responses from Sales, even for a crafted request.
 rows=item_read(ctx.username,None,1,10001,None,None,"[]",request_ids=list(request_ids))
 if rows["total"]>10000:raise HTTPException(422,"Too many source items. Use a smaller page.")
 return {r["ItemID"]:r for r in rows["rows"]}

def prepare(edit,source,ctx):
 if source.get("RequestID")!=edit.request_id:raise ValueError("Item does not belong to this request.")
 if source.get("ItemRowVersion")!=edit.version:raise ValueError("Item changed. Refresh before saving.")
 if not can_edit(ctx,source):raise ValueError("Only the assigned Packaging PIC or Admin can update an Assigned, Working or Returned response.")
 values={**source,**edit.changes}
 base={k:source.get(k) for k in ("MaterialID","HeightMM","WidthMM","LengthMM","Cost","CurrencyID","CostBasis","ResponseNotes")}
 for key in ("HeightMM","WidthMM","LengthMM","CostBasis","ResponseNotes"):
  if key in edit.changes:base[key]=edit.changes[key]
 if "PMCost" in edit.changes:base["Cost"]=edit.changes["PMCost"]
 if "PMCostCurrencyCode" in edit.changes:
  code=edit.changes["PMCostCurrencyCode"]
  if code is None or code=="":base["CurrencyID"]=None
  else:
   found=execute("DECLARE @Actor INT; EXEC dbo.usp_Packaging_Authorize ?,'Read',@Actor OUTPUT; SELECT ID FROM dbo.Currency WHERE CurrencyCode=?",[ctx.username,code])[0]
   if len(found)!=1:raise ValueError("Cost currency is not found or ambiguous.")
   base["CurrencyID"]=found[0]["ID"]
 if base["Cost"] is not None and (not base["CurrencyID"] or not str(base["CostBasis"] or "").strip()):raise ValueError("Cost currency and cost basis are required when entering PM cost.")
 base.update({k:v for k,v in edit.changes.items() if k in PACKAGINGCONFIGURATIONREQUESTITEM_FIELDS})
 base.update(RowNum=edit.row,ID=edit.item_id,RowVersion=edit.version)
 return ResponseBatch(rows=[base])

@router.post("/save")
def save(body:Batch,ctx:AccessContext=Depends(get_access_context)):
 require(ctx,"Packaging")
 sources=load_sources(ctx,{r.request_id for r in body.rows})
 plans=[];results=[]
 for edit in body.rows:
  try:
   if edit.item_id not in sources:raise ValueError("Request item was not found. Refresh.")
   plans.append((edit,prepare(edit,sources[edit.item_id],ctx)))
  except (ValueError,HTTPException) as exc:
   results.append(dict(row=edit.row,status="ERROR",message=exc.detail if isinstance(exc,HTTPException) else str(exc)))
 # Each response uses the existing atomic response writer and change-log path.
 for edit,payload in plans:
  try:
   response=response_save(payload,ctx)
   result=response["results"][0]
   if result["Status"]!="OK":
    results.append(dict(row=edit.row,status="ERROR",message=result.get("Message","Response was not saved.")));continue
   results.append(dict(row=edit.row,status="OK",message="Saved. Refresh for the latest request status.",version=result["NewRowVersion"]))
  except HTTPException as exc:
   if exc.status_code>=500:raise
   results.append(dict(row=edit.row,status="ERROR",message=exc.detail))
 return {"results":results}
