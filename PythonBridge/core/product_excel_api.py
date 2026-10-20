"""Layout-aware Product workbooks. VBA is built once, never through server-side Office."""
from excel_dropdowns import with_dropdowns,master_choices
from excel_template_version import TemplateBatch,TEMPLATE_VERSIONS
import io
import json
import os
import re
from xml.sax.saxutils import escape
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from auth import AccessContext, get_access_context
from master_models import MasterLayout, COLUMNS, check_layout, PRODUCT_REQUIRED_COLUMNS
from packaging_master_api import read as master_read, execute, PRODUCT_AUTH
from packaging_api import require
from db import get_raw_cursor, fetch_all_as_dicts, bytes_to_b64
from packaging_api import rv
from packaging_fields import consume, sql_error
from cache import invalidate

router=APIRouter(prefix="/api/workbench/product-excel",tags=["Product Excel"])
ROOT=Path(__file__).resolve().parents[1]
TEMPLATE=ROOT/"templates"/"Product_Local_Update.xlsm"
EDITABLE={"CustomerName","ProductName","Category","WeightGrams","ShelfLifeDays","Status"}
REQUIRED=list(PRODUCT_REQUIRED_COLUMNS)
META=["_ID","_RowVersion","_Original"]
class View(BaseModel):
 model_config=ConfigDict(extra="forbid")
 layout:MasterLayout
 page:int=Field(1,ge=1,le=1000000)
 @model_validator(mode="after")
 def valid(self):
  check_layout("products",self.layout)
  return self
class PageInput(View):
 search:str=Field("",max_length=200)
 status:Literal["","Active","Block"]=""
 creator:str=Field("",max_length=100)
def page_data(body,ctx,override=False):
 require(ctx,"Product")
 values=body.layout.values
 search=body.search if override else values.get("search","")
 status=body.status if override else values.get("status","")
 creator=None
 if override and body.creator:
  rows=execute(PRODUCT_AUTH+"SELECT ID FROM dbo.Users WHERE UserName=?",[ctx.username,body.creator])[0]
  if not rows:raise HTTPException(422,"Created by username was not found.")
  creator=rows[0]["ID"]
 elif not override and values.get("created_by"):
  try: creator=int(values["created_by"])
  except ValueError:raise HTTPException(422,"Invalid creator filter.")
 if status not in ("","Active","Block"):raise HTTPException(422,"Invalid status.")
 data=master_read(entity="products",page=body.page,page_size=body.layout.page_size,search=search,
   status=status or None,material_id=None,currency_id=None,as_of=None,created_by=creator,
   sort=json.dumps([s.model_dump() for s in body.layout.sort]),ctx=ctx)
 return {**data,"dropdowns":master_choices("products",ctx)}
@router.post("/page")
def page(body:PageInput,ctx:AccessContext=Depends(get_access_context)):
 return page_data(body,ctx,True)

# All strings are inline text cells, never formulas (including =,+,-,@ prefixes).
NS="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
ET.register_namespace("",NS)
def col(n):
 result=""
 while n:n,r=divmod(n-1,26);result=chr(65+r)+result
 return result
def header_styles(xml):
 """Append styles without rewriting Office compatibility namespaces."""
 ids={}
 def append(tag,children):
  nonlocal xml
  pattern=r"<"+tag+r"\b([^>]*)>(.*?)</"+tag+r">"
  match=re.search(pattern,xml,re.S)
  if not match:raise RuntimeError("Workbook styles are incomplete.")
  start=len(ET.fromstring("<"+tag+">"+match.group(2)+"</"+tag+">"))
  attrs=re.sub(r'count="\d+"','count="'+str(start+len(children))+'"',match.group(1))
  xml=xml[:match.start()]+"<"+tag+attrs+">"+match.group(2)+"".join(children)+"</"+tag+">"+xml[match.end():]
  return start
 font=append("fonts",['<font><b/><sz val="11"/><color rgb="FF1F2937"/><name val="Calibri"/></font>'])
 for kind,color in (("required","FFFFF2CC"),("editable","FFDDEBF7"),("display","FFE7E6E6")):
  fill=append("fills",['<fill><patternFill patternType="solid"><fgColor rgb="'+color+'"/><bgColor indexed="64"/></patternFill></fill>'])
  ids[kind]=append("cellXfs",['<xf numFmtId="0" fontId="'+str(font)+'" fillId="'+str(fill)+'" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'])
 return xml.encode("utf-8"),ids
def sheet(rows,hidden_cols=(),hide_keys=False,filter_rows=False,styles=None):
 root=ET.Element("worksheet",xmlns=NS)
 views=ET.SubElement(root,"sheetViews");view=ET.SubElement(views,"sheetView",workbookViewId="0")
 if hide_keys:ET.SubElement(view,"pane",ySplit="2",topLeftCell="A3",activePane="bottomLeft",state="frozen")
 cols=ET.SubElement(root,"cols")
 for n in range(1,max(map(len,rows))+1):
  ET.SubElement(cols,"col",min=str(n),max=str(n),width="23",customWidth="1",**({"hidden":"1"} if n in hidden_cols else {}))
 data=ET.SubElement(root,"sheetData")
 for ri,row in enumerate(rows,1):
  el=ET.SubElement(data,"row",r=str(ri),**({"hidden":"1"} if hide_keys and ri==2 else {}),**({"ht":"42","customHeight":"1"} if styles and ri==1 else {}))
  for ci,value in enumerate(row,1):
   c=ET.SubElement(el,"c",r=col(ci)+str(ri),t="inlineStr",**({"s":str(styles[ci-1])} if styles and ri==1 else {}))
   text=ET.SubElement(ET.SubElement(c,"is"),"t")
   text.set("{http://www.w3.org/XML/1998/namespace}space","preserve")
   text.text="" if value is None else str(value)
 if filter_rows:ET.SubElement(root,"autoFilter",ref="A2:"+col(len(rows[0]))+str(max(3,len(rows))))
 return ET.tostring(root,encoding="utf-8",xml_declaration=True)
def build(body,data,base_url,creator=""):
 selected=check_layout("products",body.layout).columns
 keys=["Command",*selected,*[k for k in COLUMNS["products"] if k not in selected],"_Result","_Message",*META]
 labels={"Command":"Action (C/U)","_Result":"Result","_Message":"Message",**COLUMNS["products"]}
 labels.update({k:labels[k]+(" * (new)" if k=="Category" else " *") for k in REQUIRED})
 rows=[[labels.get(k,k) for k in keys],keys]
 for r in data["rows"]:
  original={k:r.get(k) for k in COLUMNS["products"]}
  values={**r,"Command":"","_ID":r["ID"],"_RowVersion":r["RowVersion"],"_Original":json.dumps(original,default=str,ensure_ascii=False)}
  rows.append([values.get(k) for k in keys])
 hidden=[i+1 for i,k in enumerate(keys) if k in META or (k in COLUMNS["products"] and k not in selected)]
 config=[["Version",TEMPLATE_VERSIONS["products"]],["API",base_url.rstrip("/")],["Layout",body.layout.model_dump_json()],["Pending","0"],["LoadedPage",body.page]]
 # Controls sheet has static macro buttons; replace only its input cells preserving drawings.
 with zipfile.ZipFile(TEMPLATE) as z:
  style_xml,style_ids=header_styles(z.read("xl/styles.xml").decode("utf-8"))
  header_ids=[style_ids["required" if k in REQUIRED else "editable" if k in EDITABLE or k=="Command" else "display"] for k in keys]
  # Preserve Office namespace declarations, AlternateContent and button drawings byte-for-byte.
  control=z.read("xl/worksheets/sheet2.xml").decode("utf-8")
  inputs={"B3":body.layout.values.get("search",""),"B4":body.layout.values.get("status",""),"B5":creator,"B6":body.page,"B7":body.layout.page_size,"B8":data["total"]}
  for ref,value in inputs.items():
   replacement='<c r="'+ref+'" t="inlineStr"><is><t>'+escape(str(value))+'</t></is></c>'
   control,count=re.subn(r'<c\b[^>]*\br="'+ref+r'"[^>]*>.*?</c>',lambda _:replacement,control,count=1,flags=re.S)
   if count!=1:raise RuntimeError("Workbook control template is incomplete.")
  output=io.BytesIO()
  with zipfile.ZipFile(output,"w",zipfile.ZIP_DEFLATED) as target:
   replacements={"xl/styles.xml":style_xml,"xl/worksheets/sheet1.xml":sheet(rows,hidden,True,True,header_ids),
"xl/worksheets/sheet2.xml":control.encode("utf-8"),
                 "xl/worksheets/sheet3.xml":sheet(config)}
   for entry in z.infolist():target.writestr(entry,replacements.get(entry.filename,z.read(entry.filename)))
 return with_dropdowns(output.getvalue(),data.get("dropdowns",{"Command":["C","U"],"Status":["Active","Block"]}))
@router.post("/download")
def download(body:View,request:Request,ctx:AccessContext=Depends(get_access_context)):
 require(ctx,"Product")
 if not TEMPLATE.exists():raise HTTPException(503,"Product Excel template is not installed.")
 data=page_data(body,ctx)
 creator=""
 if body.layout.values.get("created_by"):
  rows=execute(PRODUCT_AUTH+"SELECT UserName FROM dbo.Users WHERE ID=?",[ctx.username,int(body.layout.values["created_by"])])[0]
  creator=rows[0]["UserName"] if rows else ""
 url=os.environ.get("EXCEL_API_BASE_URL",str(request.base_url)).rstrip("/")
 if not url.startswith(("http://","https://")):raise HTTPException(503,"Invalid Excel API URL configuration.")
 return Response(build(body,data,url,creator),media_type="application/vnd.ms-excel.sheet.macroEnabled.12",
   headers={"Content-Disposition":'attachment; filename="Product_Local_Update.xlsm"',"Cache-Control":"no-store"})
class Edit(BaseModel):
 model_config=ConfigDict(extra="forbid")
 row:int=Field(ge=3)
 command:Literal["C","U"]
 id:int|None=Field(None,ge=1)
 version:str|None=None
 changes:dict=Field(default_factory=dict)
 @model_validator(mode="after")
 def valid(self):
  if any(k not in EDITABLE for k in self.changes):raise ValueError("A read-only or unknown field was supplied.")
  if self.command!="C" and (not self.id or not self.version):raise ValueError("ID and RowVersion are required.")
  if self.command=="C" and (self.id or self.version):raise ValueError("A new row cannot have an ID.")
  return self
class Batch(TemplateBatch):
 template_kind="products"
 model_config=ConfigDict(extra="forbid")
 rows:list[Edit]=Field(min_length=1,max_length=500)
 @model_validator(mode="after")
 def unique(self):
  ids=[r.id for r in self.rows if r.id]
  if len(ids)!=len(set(ids)) or len({r.row for r in self.rows})!=len(self.rows):raise ValueError("Duplicate rows or record IDs.")
  return self
@router.post("/save")
def save(body:Batch,ctx:AccessContext=Depends(get_access_context)):
 require(ctx,"Product")
 from main import product_batch
 from schemas import ProductBatchRequest
 from pydantic import ValidationError
 results=[]
 for row in body.rows:
  changes=dict(row.changes)
  if "CustomerName" in changes:
   matches=execute(PRODUCT_AUTH+"SELECT ID FROM dbo.Customer WHERE CustomerName=?",[ctx.username,str(changes.pop("CustomerName") or "").strip()])[0]
   if len(matches)!=1:
    results.append(dict(RowNum=row.row,Status="ERROR",Message="Choose an existing Customer name."));continue
   changes["CustomerID"]=matches[0]["ID"]
  if row.command=="U":
   with get_raw_cursor() as cur:
    cur.execute("SET XACT_ABORT ON; BEGIN TRANSACTION")
    try:
     cur.execute("EXEC dbo.usp_Product_Fields_Save ?,?,?,?,0",ctx.username,row.id,rv(row.version),json.dumps(changes))
     version=consume(cur)[0][0]["RowVersion"]
     cur.execute("COMMIT TRANSACTION")
     invalidate("opportunity_master_lookups")
     results.append(dict(RowNum=row.row,Status="OK",Message="Updated",NewID=row.id,NewRowVersion=bytes_to_b64(version)))
    except Exception as exc:
     cur.execute("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION")
     message=sql_error(exc)
     if not message and any(c in str(exc) for c in ("2601","2627")):message="Product code or name already exists."
     if not message:raise
     results.append(dict(RowNum=row.row,Status="ERROR",Message=message))
   continue
  values={}
  if row.command!="C":
   # Merge omitted fields from the server; the supplied RowVersion still guards the write.
   with get_raw_cursor() as cur:
    cur.execute(PRODUCT_AUTH+"SELECT CustomerID,ProductCode,ProductName,WeightGrams,Status FROM dbo.Product WHERE ID=?",ctx.username,row.id)
    rows=fetch_all_as_dicts(cur)
   if not rows:
    results.append(dict(RowNum=row.row,Status="ERROR",Message="Row not found."));continue
   values=rows[0]
  values.update(changes)
  values["WeightValue"]=values.pop("WeightGrams",None)
  values["WeightUnit"]="g"
  values.update(RowNum=row.row,Command=row.command,ID=row.id,RowVersion=row.version)
  try:
   payload=ProductBatchRequest(rows=[values])
   result=product_batch(payload,ctx.username,ctx.is_admin,ctx.scopes)["results"]
   results.extend(result)
  except ValidationError:
   results.append(dict(RowNum=row.row,Status="ERROR",Message="Invalid values. Check required fields and numeric values."))
 return {"results":results}
