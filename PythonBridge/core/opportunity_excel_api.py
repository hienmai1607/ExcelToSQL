"""Combined, layout-aware Opportunity workbook using the existing atomic document writer."""
from excel_dropdowns import with_dropdowns,transaction_choices
from excel_template_version import TemplateBatch,TEMPLATE_VERSIONS
import io
import json
import os
import re
import zipfile
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from xml.sax.saxutils import escape
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Literal
from auth import AccessContext, get_access_context
from packaging_api import require, execute
from opportunity_views import OpportunityViews, OpportunityView, HEADER_COLUMNS, VIEW_ITEM_COLUMNS, sorted_grid
from packaging_fields import OPPORTUNITYITEM_FIELDS, PARENT_LOGISTICS_FIELDS
from product_excel_api import sheet, header_styles
from shipment_columns import SHIPMENT_COLUMNS, SHIPMENT_LABELS, shipment_columns
from shipment_fields import ShipmentCostInfo
from tcb_analysis_columns import TCB_LABELS
from opportunity_excel_sheet import workbook_sheet, format_styles
ITEM_COLUMNS = VIEW_ITEM_COLUMNS - {'ShipmentCostInfo'}
from schemas import OpportunityBatchRequest

router=APIRouter(prefix="/api/workbench/opportunity-excel",tags=["Opportunity Excel"])
TEMPLATE=Path(__file__).resolve().parents[1]/"templates"/"Opportunity_Local_Update.xlsm"
HEADER_REQUIRED=["OpportunityNumber","CustomerName","OpportunityDesc","BidOpen","BidClose","CustomerCurrencyCode","ExchangeRateVNDPerUSD","ExchangeRateCustomerCurrencyPerUSD"]
ITEM_REQUIRED=["ProductCode","AnnualUnit","ContainerRequest"]
HEADER_EDITABLE={"CustomerName","OpportunityDesc","BidOpen","BidClose","ExchangeRateVNDPerUSD","ExchangeRateCustomerCurrencyPerUSD"}
ITEM_EDITABLE={"ProductCode","ItemDescription","AnnualUnit","EstPctAwarded","ShelfPrice",*OPPORTUNITYITEM_FIELDS,*SHIPMENT_COLUMNS}
META=["_OpportunityID","_ItemID","_HeaderVersion","_ItemVersion","_Original"]
AUTH="""IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
WHERE u.UserName=? AND u.IsActive=1 AND a.Scope IN('Admin','Opportunity'))
THROW 52744,'Opportunity access is required for this action.',1; """
LABELS={"ApplicableNetWeightGrams":"Applicable Net weight (g)",**TCB_LABELS,**SHIPMENT_LABELS,"ContainerRequest":"Container Type","ConfigurationRequest":"Loading request","ItemNumber":"Item number","MixUnitQuantity":"Mix component quantity","OpportunityNumber":"Opportunity / new group key","CustomerName":"Customer","OpportunityDesc":"Description",
"BidOpen":"Bid open","BidClose":"Bid close","HeaderStage":"Stage","CustomerCurrencyCode":"Customer currency",
"ExchangeRateVNDPerUSD":"Exchange rate VND per USD","ExchangeRateCustomerCurrencyPerUSD":"Exchange rate Customer Currency per USD","ItemCount":"Items","ProductCode":"Product code",
"ItemDescription":"Description","AnnualUnit":"Annual units","EstPctAwarded":"Estimated award %",
"ShelfPrice":"Shelf price","ItemStage":"Stage","WeightGrams":"Net weight (g)","MaxPalletHeightM":"Max pallet height (m)",
"ShelfLifeDays":"Shelf life (days)","FirstPMType":"Primary Type","SecondPMType":"Secondary Type"}

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
  if "ItemNumber" not in self.views.items.columns:self.views.items.columns.insert(0,"ItemNumber")
  return self

def workbook_row(row):
 row={**row,**shipment_columns(row)}
 row={k:str(v) if isinstance(v,(Decimal,date,datetime)) else v for k,v in row.items()}
 values={**row,"HeaderCommand":"","ItemCommand":"","_OpportunityID":row.get("OpportunityID"),
 "_ItemID":row.get("ItemID"),"_HeaderVersion":row.get("HeaderRowVersion"),"_ItemVersion":row.get("ItemRowVersion")}
 values["_Original"]=json.dumps({k:row.get(k) for k in HEADER_COLUMNS|ITEM_COLUMNS|{"ParentItemID","HasOpenPackagingRequest"}},default=str,ensure_ascii=False)
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
  data["rows"]=[r for group in groups.values()
   for parent in sorted([r for r in group if not r.get("ParentItemID")],key=cmp_to_key(compare))
   for r in [parent,*sorted([c for c in group if c.get("ParentItemID")==parent.get("ItemID")],key=lambda c:c["MixChildNumber"])]]
 data["rows"]=[workbook_row(r) for r in data["rows"]]
 data["dropdowns"]=transaction_choices(ctx,HEADER_EDITABLE|ITEM_EDITABLE)
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
  if k in ("HeaderCommand","ItemCommand"):label=("Header" if k=="HeaderCommand" else "Item")+" Action (C/U)"
  elif k.startswith("_"):label={"_Result":"Result","_Message":"Message"}.get(k,k)
  else:
   label=("Header: " if k in HEADER_COLUMNS else "Item: ")+LABELS.get(k,re.sub(r"(?<=[a-z])(?=[A-Z])"," ",k))
   if k in HEADER_REQUIRED+ITEM_REQUIRED:label+=" *"
   if k not in HEADER_EDITABLE|ITEM_EDITABLE and k!="OpportunityNumber":label+=" [display]"
  labels.append(label)
 config=[["Version",TEMPLATE_VERSIONS["opportunities"]],["API",base.rstrip("/")],["Layout",body.model_dump_json()],["Pending","0"],["LoadedPage",body.page],
 ["HeaderEditable","|".join(sorted(HEADER_EDITABLE))],["ItemEditable","|".join(sorted(ITEM_EDITABLE))],
 ["Required","|".join(HEADER_REQUIRED+ITEM_REQUIRED)],["ShipmentEditable","|".join(sorted(SHIPMENT_COLUMNS))],keys]
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
  styles,category_ids=header_styles(styles.decode())
  category_xml=styles.decode()
  # Replace only the newly appended fills, before either replacement introduces another match.
  left,sep,right=category_xml.rpartition("FFDDEBF7")
  category_xml=left+"FFC6EFCE"+right
  left,sep,right=category_xml.rpartition("FFFFF2CC")
  styles=(left+"FFDDEBF7"+right).encode()
  category_ids={"calculated":category_ids["required"],"editable":category_ids["editable"],"display":category_ids["display"]}
  ids=[]
  for k in keys:
   palette=header_ids if k in HEADER_COLUMNS or k=="HeaderCommand" else item_ids
   kind="required" if k in HEADER_REQUIRED+ITEM_REQUIRED else "editable" if k in HEADER_EDITABLE|ITEM_EDITABLE or k in ("HeaderCommand","ItemCommand") else "display"
   ids.append(palette[kind])
  styles,ids,category_ids,body_id=format_styles(styles.decode(),ids,category_ids,keys,HEADER_COLUMNS)
  control=z.read("xl/worksheets/sheet2.xml").decode()
  values=body.views.header.values if body.views.header else {}
  inputs={"B3":values.get("opportunity_number",""),"B4":values.get("customer_name",""),"B5":values.get("stage",""),
  "B6":body.page,"B7":body.page_size,"B8":data["total"],"B9":values.get("bid_open_from",""),"B10":values.get("bid_open_to","")}
  for ref,v in inputs.items():
   control,count=re.subn(r'<c\b[^>]*\br="'+ref+r'"[^>]*>.*?</c>',lambda _: '<c r="'+ref+'" t="inlineStr"><is><t>'+escape(str(v))+'</t></is></c>',control,count=1,flags=re.S)
   if count!=1:raise RuntimeError("Opportunity control template is incomplete.")
  replacements={"xl/styles.xml":styles,"xl/worksheets/sheet1.xml":workbook_sheet(keys,labels,data["rows"],hidden,ids,category_ids,HEADER_COLUMNS,HEADER_EDITABLE|ITEM_EDITABLE,HEADER_REQUIRED+ITEM_REQUIRED,SHIPMENT_COLUMNS,PARENT_LOGISTICS_FIELDS,body_id),
   "xl/worksheets/sheet2.xml":control.encode(),"xl/worksheets/sheet3.xml":sheet(config)}
  stream=io.BytesIO()
  with zipfile.ZipFile(stream,"w",zipfile.ZIP_DEFLATED) as out:
   for entry in z.infolist():out.writestr(entry,replacements.get(entry.filename,z.read(entry.filename)))
 return with_dropdowns(stream.getvalue(),data.get("dropdowns",{"HeaderCommand":["C","U"],"ItemCommand":["C","U"]}))

@router.post("/download")
def download(body:View,request:Request,ctx:AccessContext=Depends(get_access_context)):
 if not ctx.is_admin and ctx.permissions is not None and ctx.permissions.get("opportunities")!="edit":return readonly(body,ctx)
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
 header_command:Literal["N","C","U"]="N"
 item_command:Literal["N","C","U"]="N"
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
class Batch(TemplateBatch):
 template_kind="opportunities"
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

def merge_shipment(ctx,original,changes,header):
 from shipment_ownership import own_others,validate_child_others
 if original.get("ParentItemID"):
  validate_child_others(changes)
 raw=original.get("OwnShipmentCostInfo",original.get("ShipmentCostInfo")) if original.get("ParentItemID") else original.get("ShipmentCostInfo")
 shipment=own_others(original) if original.get("ParentItemID") else json.loads(raw) if isinstance(raw,str) and raw else dict(raw or {})
 for key,value in changes.items():
  if key=="PortOfEntryName":
   if value is None or str(value).strip()=="":
    shipment["PortOfEntryID"]=None
   elif value!=original.get("PortOfEntryName"):
    customer=resolve(ctx,"Customer","CustomerName",header["CustomerName"])
    ports=execute(AUTH+"""SELECT p.ID FROM dbo.PortOfEntry p JOIN dbo.Customer c ON c.ID=p.CustomerID
     WHERE p.CustomerID=? AND p.MarketID=c.MarketID AND p.Status='Active' AND p.PortName=?""",
     [ctx.username,customer,str(value).strip()])[0]
    if len(ports)!=1:raise ValueError("Choose an active Port of Entry name for this Customer and Market.")
    shipment["PortOfEntryID"]=ports[0]["ID"]
  else:
   value=None if value is None or str(value).strip()=="" else value
   if key in ("InterestMonths","InterestDays","PaymentTermDays") and value is not None:
    try:number=Decimal(str(value))
    except InvalidOperation:raise ValueError("Interest and payment durations must be whole nonnegative values.")
    if not number.is_finite() or number!=number.to_integral_value():raise ValueError("Interest and payment durations must be whole nonnegative values.")
    value=int(number)
   shipment[key]=value
 if "InterestDays" in changes:
  shipment["InterestMonths"]=None
 if "ImportClearanceCustomerPerContainer" in changes and shipment.get("ImportClearanceCustomerPerContainer") is not None:
  shipment["ImportClearanceCustomerPerPallet"]=None
  shipment["ImportClearanceUSDPerContainer"]=None
 if "ImportClearanceCustomerPerPallet" in changes and shipment.get("ImportClearanceCustomerPerPallet") is not None:
  shipment["ImportClearanceUSDPerContainer"]=None
 mode=changes.get("MarginMode")
 for customer_key,usd_key in (("PortToWHCustomerPerContainer","PortToWHUSDPerContainer"),("WHCostCustomerPerPallet","WHCostUSDPerPallet"),("InitialDesignCustomer","InitialDesignUSD")):
  if customer_key in changes and shipment.get(customer_key) is not None:
   if usd_key in changes and shipment.get(usd_key) is not None:
    raise ValueError("Choose USD or customer currency, not both.")
   shipment[usd_key]=None
  elif usd_key in changes and shipment.get(usd_key) is not None:
   shipment[customer_key]=None
 if "MarginPct" in changes and "MarginUSDPerLb" in changes and changes["MarginPct"] is not None and changes["MarginUSDPerLb"] is not None:
  raise ValueError("Choose only one Margin basis.")
 if mode is None:
  if "MarginUSDPerLb" in changes and shipment.get("MarginUSDPerLb") is not None:mode="USDPerLb"
  elif "MarginPct" in changes and shipment.get("MarginPct") is not None:mode="Percent"
 if mode in ("Percent","USDPerLb"):
  shipment["MarginMode"]=mode
  shipment["MarginPct" if mode=="USDPerLb" else "MarginUSDPerLb"]=None
 return ShipmentCostInfo(**shipment).model_dump(mode="json",exclude_unset=True) if any(v is not None for v in shipment.values()) else None

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
 header={k:values.get(k) for k in ("OpportunityDesc","BidOpen","BidClose","ExchangeRateVNDPerUSD","ExchangeRateCustomerCurrencyPerUSD")}
 for k in ("BidOpen","BidClose"):
  if header[k]:header[k]=date.fromisoformat(str(header[k])[:10]).isoformat()
 if hc!="D":
  for k in HEADER_REQUIRED[1:]:
   if k!="CustomerCurrencyCode" and (values.get(k) is None or str(values[k]).strip()==""):raise ValueError(k+" is required.")
 header.update(RowNum=first.row,Command=hc,ID=first.opportunity_id,OpportunityNumber=first.number,RowVersion=first.header_version)
 header["CustomerID"]=resolve(ctx,"Customer","CustomerName",values["CustomerName"]) if "CustomerName" in changes or not existing else source["CustomerID"]
 # Customer currency is resolved in SQL; it is never supplied by Excel.
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
  if original and original["ItemStage"]!="Draft":raise ValueError("Only Draft items can be edited.")
  shipment_changes={k:v for k,v in row.item_changes.items() if k in SHIPMENT_COLUMNS}
  if original.get("ParentItemID") and shipment_changes:
   raise ValueError("Shipment, Logistics, Co-Man and Others belong to the Mix parent.")
  if original.get("HasOpenPackagingRequest") and (command!="U" or set(row.item_changes)-SHIPMENT_COLUMNS):
   raise ValueError("Item is processing; only Shipment and cost inputs can be edited. Configuration and Loading remain locked.")
  shipment=None
  if shipment_changes:
   shipment=merge_shipment(ctx,original,shipment_changes,values)
  if original and command=="U" and shipment_changes and not (set(row.item_changes)-SHIPMENT_COLUMNS):
   items.append(dict(RowNum=row.row,Command="U",ID=row.item_id,RowVersion=row.item_version,
    OpportunityNumber=first.number,ShipmentCostInfo=shipment))
   continue
  if original.get("ParentItemID") and (command!="U" or set(row.item_changes)-set(OPPORTUNITYITEM_FIELDS)):
   raise ValueError("Mix child Product and Annual units are read-only; only Packaging requirements can be edited.")
  if original.get("ParentItemID") and set(row.item_changes)&PARENT_LOGISTICS_FIELDS:
   raise ValueError("Pallet and Container requirements belong to the parent item only.")
  value={**original,**row.item_changes}
  if not value.get("ItemDescription"):value["ItemDescription"]=value.get("ProductName") or value.get("ProductCode")
  if command!="D":
   for k in (key for key in ITEM_REQUIRED if not original.get("ParentItemID") or key not in ("PalletSize","ContainerRequest")):
    if value.get(k) is None or str(value[k]).strip()=="":raise ValueError(k+" is required.")
  item={k:value.get(k) for k in ("ItemDescription","AnnualUnit","EstPctAwarded","ShelfPrice")}
  # Only extensions actually changed are passed, preserving hidden values.
  item.update({k:v for k,v in row.item_changes.items() if k in OPPORTUNITYITEM_FIELDS})
  if shipment_changes:item["ShipmentCostInfo"]=shipment
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

@router.post("/readonly")
def readonly(body:View,ctx:AccessContext=Depends(get_access_context)):
 from workspace_readonly import readonly_workbook
 data=read_page(body,ctx)
 columns=list(dict.fromkeys([*body.views.header.columns,*body.views.items.columns]))
 return readonly_workbook(columns,data["rows"],LABELS,"opportunity-readonly.xlsx")
