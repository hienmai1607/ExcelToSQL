"""Combined, layout-aware Opportunity workbook using the existing atomic document writer."""
import io
import json
import os
import re
import zipfile
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from xml.sax.saxutils import escape
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Literal
from auth import AccessContext, get_access_context
from packaging_api import require, execute
from opportunity_views import OpportunityViews, OpportunityView, HEADER_COLUMNS, ITEM_COLUMNS, sorted_grid
from packaging_fields import OPPORTUNITYITEM_FIELDS
from product_excel_api import sheet, header_styles
from schemas import OpportunityBatchRequest

router=APIRouter(prefix="/api/workbench/opportunity-excel",tags=["Opportunity Excel"])
TEMPLATE=Path(__file__).resolve().parents[1]/"templates"/"Opportunity_Local_Update.xlsm"
HEADER_REQUIRED=["OpportunityNumber","CustomerName","OpportunityDesc","BidOpen","BidClose","CurrencyCode","ExchangeRateToVND"]
ITEM_REQUIRED=["ProductCode","ItemDescription","AnnualUnit"]
HEADER_EDITABLE={"CustomerName","OpportunityDesc","BidOpen","BidClose","CurrencyCode","ExchangeRateToVND"}
ITEM_EDITABLE={"ProductCode","ItemDescription","AnnualUnit","EstPctAwarded","ShelfPrice",*OPPORTUNITYITEM_FIELDS}
META=["_OpportunityID","_ItemID","_HeaderVersion","_ItemVersion","_Original"]
AUTH="""IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
WHERE u.UserName=? AND u.IsActive=1 AND a.Scope IN('Admin','Opportunity'))
THROW 52744,'Opportunity access is required for this action.',1; """
LABELS={"OpportunityNumber":"Opportunity / new group key","CustomerName":"Customer","OpportunityDesc":"Description",
"BidOpen":"Bid open","BidClose":"Bid close","HeaderStage":"Stage","CurrencyCode":"Currency",
"ExchangeRateToVND":"Exchange rate to VND","ItemCount":"Items","ProductCode":"Product code",
"ItemDescription":"Description","AnnualUnit":"Annual units","EstPctAwarded":"Estimated award %",
"ShelfPrice":"Shelf price","ItemStage":"Stage","WeightGrams":"Net weight (g)","MaxPalletHeightM":"Max pallet height (m)",
"ShelfLifeDays":"Shelf life (days)"}

class View(BaseModel):
 model_config=ConfigDict(extra="forbid")
 views:OpportunityViews
 page:int=Field(1,ge=1,le=1000000)
 page_size:int=Field(200,ge=1,le=500)
 @model_validator(mode="after")
 def required(self):
  if self.views.header is None:self.views.header=OpportunityView(columns=sorted(HEADER_COLUMNS))
  if self.views.items is None:self.views.items=OpportunityView(columns=sorted(ITEM_COLUMNS))
  for view,required in ((self.views.header,HEADER_REQUIRED),(self.views.items,ITEM_REQUIRED)):
   if view is not None:view.columns=[*view.columns,*[k for k in required if k not in view.columns]]
  return self

def workbook_row(row):
 row={k:str(v) if isinstance(v,(Decimal,date,datetime)) else v for k,v in row.items()}
 values={**row,"HeaderCommand":"N","ItemCommand":"N","_OpportunityID":row.get("OpportunityID"),
 "_ItemID":row.get("ItemID"),"_HeaderVersion":row.get("HeaderRowVersion"),"_ItemVersion":row.get("ItemRowVersion")}
 values["_Original"]=json.dumps({k:row.get(k) for k in HEADER_COLUMNS|ITEM_COLUMNS},default=str,ensure_ascii=False)
 return values

def read_page(body,ctx):
 require(ctx,"Opportunity")
 header=body.views.header
 values=header.values if header else {}
 for key in ("bid_open_from","bid_open_to"):
  if values.get(key):
   try:date.fromisoformat(values[key])
   except ValueError:raise HTTPException(422,"Use YYYY-MM-DD for bid date filters.")
 data=sorted_grid(ctx.username,body.page,body.page_size,json.dumps([s.model_dump() for s in header.sort]) if header else "[]",
  **{k:values.get(k) or None for k in ("opportunity_number","customer_name","stage","bid_open_from","bid_open_to")})
 # Header pagination guarantees that no document is split across pages.
 if body.views.items and body.views.items.sort:
  from functools import cmp_to_key
  from decimal import Decimal, InvalidOperation
  def compare(a,b):
   if a["OpportunityID"]!=b["OpportunityID"]:return 0
   for rule in body.views.items.sort:
    x,y=a.get(rule.column),b.get(rule.column)
    if x is None or y is None:
     if x is None and y is None:continue
     return 1 if x is None else -1
    try:x,y=Decimal(str(x)),Decimal(str(y))
    except InvalidOperation:x,y=str(x).casefold(),str(y).casefold()
    delta=(x>y)-(x<y)
    if delta:return delta if rule.direction=="asc" else -delta
   return (a.get("ItemID",0)>b.get("ItemID",0))-(a.get("ItemID",0)<b.get("ItemID",0))
  groups={}
  for r in data["rows"]:groups.setdefault(r["OpportunityID"],[]).append(r)
  data["rows"]=[r for group in groups.values() for r in sorted(group,key=cmp_to_key(compare))]
 data["rows"]=[workbook_row(r) for r in data["rows"]]
 return data

@router.post("/page")
def page(body:View,ctx:AccessContext=Depends(get_access_context)):
 return read_page(body,ctx)

def build(body,data,base):
 hc=body.views.header.columns if body.views.header else sorted(HEADER_COLUMNS)
 ic=body.views.items.columns if body.views.items else sorted(ITEM_COLUMNS)
 hc=list(dict.fromkeys([*hc,*HEADER_REQUIRED]));ic=list(dict.fromkeys([*ic,*ITEM_REQUIRED]))
 keys=["HeaderCommand",*hc,*sorted(HEADER_COLUMNS-set(hc)),"ItemCommand",*ic,*sorted(ITEM_COLUMNS-set(ic)),"_Result","_Message",*META]
 hidden=[i+1 for i,k in enumerate(keys) if k in META or k in HEADER_COLUMNS-set(hc) or k in ITEM_COLUMNS-set(ic)]
 labels=[]
 for k in keys:
  if k in ("HeaderCommand","ItemCommand"):label=("Header" if k=="HeaderCommand" else "Item")+" Command (C/U/D)"
  elif k.startswith("_"):label={"_Result":"Result","_Message":"Message"}.get(k,k)
  else:
   label=("Header: " if k in HEADER_COLUMNS else "Item: ")+LABELS.get(k,re.sub(r"(?<=[a-z])(?=[A-Z])"," ",k))
   if k in HEADER_REQUIRED+ITEM_REQUIRED:label+=" *"
   if k not in HEADER_EDITABLE|ITEM_EDITABLE and k!="OpportunityNumber":label+=" [display]"
  labels.append(label)
 rows=[labels,keys]+[[r.get(k) for k in keys] for r in data["rows"]]
 config=[["Version","1"],["API",base.rstrip("/")],["Layout",body.model_dump_json()],["Pending","0"],["LoadedPage",body.page],
 ["HeaderEditable","|".join(sorted(HEADER_EDITABLE))],["ItemEditable","|".join(sorted(ITEM_EDITABLE))],
 ["Required","|".join(HEADER_REQUIRED+ITEM_REQUIRED)]]
 with zipfile.ZipFile(TEMPLATE) as z:
  styles,header_ids=header_styles(z.read("xl/styles.xml").decode())
  # Distinct header and item groups, with darker required fields; display remains gray.
  header_xml=styles.decode().replace("FFFFF2CC","FFBDD7EE").replace("FFDDEBF7","FFDDEBF7")
  styles,item_ids=header_styles(header_xml)
  # Replace only the newly appended palette (the last occurrence of each color).
  style_text=styles.decode()
  for old,new in (("FFFFF2CC","FFF4B183"),("FFDDEBF7","FFFCE4D6")):
   left,sep,right=style_text.rpartition(old);style_text=left+new+right if sep else style_text
  styles=style_text.encode()
  ids=[]
  for k in keys:
   palette=header_ids if k in HEADER_COLUMNS or k=="HeaderCommand" else item_ids
   kind="required" if k in HEADER_REQUIRED+ITEM_REQUIRED else "editable" if k in HEADER_EDITABLE|ITEM_EDITABLE or k in ("HeaderCommand","ItemCommand") else "display"
   ids.append(palette[kind])
  control=z.read("xl/worksheets/sheet2.xml").decode()
  values=body.views.header.values if body.views.header else {}
  inputs={"B3":values.get("opportunity_number",""),"B4":values.get("customer_name",""),"B5":values.get("stage",""),
  "B6":body.page,"B7":body.page_size,"B8":data["total"],"B9":values.get("bid_open_from",""),"B10":values.get("bid_open_to","")}
  for ref,v in inputs.items():
   control,count=re.subn(r'<c\b[^>]*\br="'+ref+r'"[^>]*>.*?</c>',lambda _: '<c r="'+ref+'" t="inlineStr"><is><t>'+escape(str(v))+'</t></is></c>',control,count=1,flags=re.S)
   if count!=1:raise RuntimeError("Opportunity control template is incomplete.")
  replacements={"xl/styles.xml":styles,"xl/worksheets/sheet1.xml":sheet(rows,hidden,True,True,ids),
   "xl/worksheets/sheet2.xml":control.encode(),"xl/worksheets/sheet3.xml":sheet(config)}
  stream=io.BytesIO()
  with zipfile.ZipFile(stream,"w",zipfile.ZIP_DEFLATED) as out:
   for entry in z.infolist():out.writestr(entry,replacements.get(entry.filename,z.read(entry.filename)))
 return stream.getvalue()

@router.post("/download")
def download(body:View,request:Request,ctx:AccessContext=Depends(get_access_context)):
 require(ctx,"Opportunity")
 if not TEMPLATE.exists():raise HTTPException(503,"Opportunity Excel template is not installed.")
 base=os.environ.get("EXCEL_API_BASE_URL",str(request.base_url))
 if not base.startswith(("http://","https://")):raise HTTPException(503,"Invalid Excel API URL.")
 return Response(build(body,read_page(body,ctx),base),media_type="application/vnd.ms-excel.sheet.macroEnabled.12",
  headers={"Content-Disposition":'attachment; filename="Opportunity_Local_Update.xlsm"',"Cache-Control":"no-store"})

class Edit(BaseModel):
 model_config=ConfigDict(extra="forbid")
 row:int=Field(ge=3,le=1048576)
 number:str=Field(min_length=1,max_length=30)
 header_command:Literal["N","C","U","D"]="N"
 item_command:Literal["N","C","U","D"]="N"
 opportunity_id:int|None=Field(None,ge=1)
 item_id:int|None=Field(None,ge=1)
 header_version:str|None=None
 item_version:str|None=None
 header_changes:dict=Field(default_factory=dict)
 item_changes:dict=Field(default_factory=dict)
 @model_validator(mode="after")
 def valid(self):
  if set(self.header_changes)-HEADER_EDITABLE or set(self.item_changes)-ITEM_EDITABLE:raise ValueError("Read-only or unknown field.")
  if self.opportunity_id and not self.header_version:raise ValueError("Header RowVersion is required.")
  if self.item_id and (not self.opportunity_id or not self.item_version):raise ValueError("Item identity and RowVersion are required.")
  if self.header_command=="C" and self.opportunity_id:raise ValueError("Create cannot have a header ID.")
  if self.item_command=="C" and self.item_id:raise ValueError("Create cannot have an item ID.")
  return self
class Batch(BaseModel):
 model_config=ConfigDict(extra="forbid")
 rows:list[Edit]=Field(min_length=1,max_length=10000)
 @model_validator(mode="after")
 def valid(self):
  if len({r.row for r in self.rows})!=len(self.rows):raise ValueError("Duplicate worksheet row.")
  ids=[r.item_id for r in self.rows if r.item_id]
  if len(ids)!=len(set(ids)):raise ValueError("Duplicate item ID.")
  return self

def document_rows(ctx,id):
 found=execute(AUTH+"SELECT OpportunityNumber FROM dbo.Opportunity WHERE ID=?",[ctx.username,id])[0]
 if not found:raise ValueError("Opportunity not found. Refresh.")
 number=found[0]["OpportunityNumber"]
 rows=sorted_grid(ctx.username,1,500,"[]",opportunity_number=number)["rows"]
 return [r for r in rows if r["OpportunityID"]==id]

def resolve(ctx,table,column,value):
 # Identifiers are constants chosen only inside this module.
 found=execute(AUTH+f"SELECT ID FROM dbo.{table} WHERE {column}=?",[ctx.username,value])[0]
 if len(found)!=1:raise ValueError(column+" is not found or is ambiguous.")
 return found[0]["ID"]

def prepare(group,ctx):
 first=group[0];existing=document_rows(ctx,first.opportunity_id) if first.opportunity_id else []
 source=existing[0] if existing else {}
 if any(r.opportunity_id!=first.opportunity_id or r.number!=first.number for r in group):raise ValueError("Inconsistent header identity.")
 if existing and source["OpportunityNumber"]!=first.number:raise ValueError("Opportunity number is read-only.")
 if existing and any(r.header_version!=source["HeaderRowVersion"] for r in group):raise ValueError("Opportunity changed. Refresh before saving.")
 if existing and source["HeaderStage"]!="Draft":raise ValueError("Only Draft Opportunities can be edited.")
 commands={r.header_command for r in group}-{"N"}
 if len(commands)>1:raise ValueError("Conflicting Header Commands for the same Opportunity.")
 hc=next(iter(commands),"U" if existing else "C")
 if not existing and "C" not in commands:raise ValueError("New Opportunity requires Header Command C.")
 changes={}
 for r in group:
  for k,v in r.header_changes.items():
   if k in changes and changes[k]!=v:raise ValueError("Conflicting repeated header values for "+k+".")
   changes[k]=v
 values={**source,**changes}
 header={k:values.get(k) for k in ("OpportunityDesc","BidOpen","BidClose","ExchangeRateToVND")}
 for k in ("BidOpen","BidClose"):
  if header[k]:header[k]=date.fromisoformat(str(header[k])[:10]).isoformat()
 if hc!="D":
  for k in HEADER_REQUIRED[1:]:
   if values.get(k) is None or str(values[k]).strip()=="":raise ValueError(k+" is required.")
 header.update(RowNum=first.row,Command=hc,ID=first.opportunity_id,OpportunityNumber=first.number,RowVersion=first.header_version)
 header["CustomerID"]=resolve(ctx,"Customer","CustomerName",values["CustomerName"]) if "CustomerName" in changes or not existing else source["CustomerID"]
 header["CurrencyID"]=resolve(ctx,"Currency","CurrencyCode",values["CurrencyCode"]) if "CurrencyCode" in changes or not existing else source["CurrencyID"]
 items=[];by_id={r["ItemID"]:r for r in existing if r.get("ItemID")}
 for row in group:
  if hc=="D":
   if row.item_command!="N" or row.item_changes:raise ValueError("Delete the header without separate item edits.")
   continue
  if row.item_command=="N" and not row.item_changes:continue
  command=row.item_command if row.item_command!="N" else "U"
  original=by_id.get(row.item_id,{})
  if row.item_id and not original:raise ValueError("Item does not belong to this Opportunity.")
  if command!="C" and not row.item_id:raise ValueError("New item requires Item Command C.")
  if row.item_id and row.item_version!=original["ItemRowVersion"]:raise ValueError("Item changed. Refresh before saving.")
  if original and (original["ItemStage"]!="Draft" or original.get("HasOpenPackagingRequest")):raise ValueError("Item is processing or not Draft.")
  value={**original,**row.item_changes}
  if command!="D":
   for k in ITEM_REQUIRED:
    if value.get(k) is None or str(value[k]).strip()=="":raise ValueError(k+" is required.")
  item={k:value.get(k) for k in ("ItemDescription","AnnualUnit","EstPctAwarded","ShelfPrice")}
  # Only extensions actually changed are passed, preserving hidden values.
  item.update({k:v for k,v in row.item_changes.items() if k in OPPORTUNITYITEM_FIELDS})
  item.update(RowNum=row.row,Command=command,ID=row.item_id,RowVersion=row.item_version,OpportunityNumber=first.number,
   ProductID=resolve(ctx,"Product","ProductCode",value["ProductCode"]) if "ProductCode" in row.item_changes or not original else original["ProductID"])
  items.append(item)
 return OpportunityBatchRequest(header_rows=[header],item_rows=items)

@router.post("/save")
def save(body:Batch,ctx:AccessContext=Depends(get_access_context)):
 require(ctx,"Opportunity")
 from main import opportunity_batch
 groups={}
 for r in body.rows:groups.setdefault(("id",r.opportunity_id) if r.opportunity_id else ("new",r.number),[]).append(r)
 plans=[];results=[]
 # Validate every group before the first write. Each SQL document remains atomic.
 for group in groups.values():
  if not any(r.header_command!="N" or r.item_command!="N" or r.header_changes or r.item_changes for r in group):continue
  try:plans.append((group,prepare(group,ctx)))
  except (ValueError,KeyError) as exc:
   results.extend(dict(row=r.row,status="ERROR",message=str(exc)) for r in group)
 if sum(len(p.item_rows) for _,p in plans)>500 or len(plans)>500:raise HTTPException(422,"Save at most 500 changed headers and 500 changed items.")
 for group,payload in plans:
  result=opportunity_batch(payload,ctx.username,ctx.is_admin,ctx.scopes)
  all_results=result["header_results"]+result["item_results"]
  failures=[r for r in all_results if r["Status"]!="OK"]
  if failures:
   results.extend(dict(row=r.row,status="ERROR",message=failures[0].get("Message","Document rolled back.")) for r in group);continue
  header=result["header_results"][0]
  deleted=payload.header_rows[0].command=="D"
  fresh=[] if deleted else document_rows(ctx,header.get("NewID") or group[0].opportunity_id)
  item_results={r["RowNum"]:r for r in result["item_results"]}
  for r in group:
   id=item_results.get(r.row,{}).get("NewID") or r.item_id
   found=next((v for v in fresh if v.get("ItemID")==id),None) if id else None
   if not found and fresh:
    found={k:v for k,v in fresh[0].items() if k not in ITEM_COLUMNS and k not in ("ItemID","ItemRowVersion","ProductID")}
   results.append(dict(row=r.row,status="OK",message="Saved. Refresh to reload the complete page.",values=workbook_row(found) if found else None))
 return {"results":results}
