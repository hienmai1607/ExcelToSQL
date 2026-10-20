"""Item-owned TCB approaches. Inactive saves never publish into the live item."""
import json
from datetime import date, datetime
from contextlib import contextmanager
from fastapi import APIRouter, Depends, HTTPException, Query, Path
from typing import Annotated
from pydantic import BaseModel, ConfigDict, Field
from auth import AccessContext, get_access_context
from packaging_api import require, rv
from db import get_raw_cursor, bytes_to_b64
from packaging_fields import consume, sql_error
from workspace_access import can_edit
from tcb_api import item_read, read as tcb_read, CommercialSave, commercial_value, serial, current_prices
from opportunity_views import sorted_grid
from tcb_costs import leaves

router=APIRouter(prefix="/api/opportunity",tags=["TCB versions"])
ID=Annotated[int,Path(ge=1,le=2147483647)]

def encode(value):
    if isinstance(value,(bytes,bytearray)): return bytes_to_b64(value)
    if isinstance(value,(date,datetime)): return value.isoformat()
    return serial(value)

def document(value): return json.dumps(value,default=encode,allow_nan=False)
def records(cur):
    keys=[c[0] for c in cur.description]
    return [dict(zip(keys,row)) for row in cur.fetchall()]
def metadata(row):
    return {k:(bytes_to_b64(v) if isinstance(v,(bytes,bytearray)) else v) for k,v in row.items()
            if k not in ("SavedJSON","GradeJSON","ContextJSON")}

def context_rows(item_id,ctx):
    item_read(item_id,ctx)
    from packaging_api import execute
    number=execute("SELECT o.OpportunityNumber FROM dbo.OpportunityItem i JOIN dbo.Opportunity o ON o.ID=i.OpportunityID WHERE i.ID=?",[item_id])[0][0]["OpportunityNumber"]
    result=sorted_grid(ctx.username,1,500,"[]",opportunity_number=number)
    rows=[r for r in result["rows"] if r.get("OpportunityNumber")==number]
    for row in rows:
        if row.get("ItemID"): row["TCBContext"]=tcb_read(row["ItemID"],ctx)
    return rows

def version_row(cur,item_id,version_id,lock=False):
    hint=" WITH(UPDLOCK,HOLDLOCK)" if lock else ""
    cur.execute("SELECT * FROM dbo.OpportunityTCBVersion"+hint+" WHERE ItemID=? AND ID=?",item_id,version_id)
    found=records(cur)
    if not found: raise HTTPException(404,"TCB version not found for this item.")
    return found[0]

def check_edit(item,ctx):
    require(ctx,"Opportunity")
    if not can_edit(ctx,"opportunities"): raise HTTPException(403,"Opportunity edit access is required.")
    if item["ItemStage"]!="Draft" or item["HeaderStage"]!="Draft":
        raise HTTPException(409,"Only Draft Opportunity items can change TCB versions.")

@contextmanager
def transaction(item_id,expected,ctx):
    item=item_read(item_id,ctx);check_edit(item,ctx)
    with get_raw_cursor() as cur:
        cur.execute("SET XACT_ABORT ON; BEGIN TRANSACTION")
        try:
            token=cur.execute("""SELECT i.RowVersion FROM dbo.OpportunityItem i WITH(UPDLOCK,HOLDLOCK)
              JOIN dbo.Opportunity o WITH(UPDLOCK,HOLDLOCK) ON o.ID=i.OpportunityID
              WHERE i.ID=? AND i.Stage='Draft' AND o.Stage='Draft'""",item_id).fetchval()
            if token is None or bytes_to_b64(token)!=expected or item["RowVersion"]!=expected:
                raise HTTPException(409,"Opportunity item changed. Refresh before changing TCB versions.")
            yield cur,item
            cur.execute("COMMIT TRANSACTION")
        except Exception as exc:
            cur.execute("IF @@TRANCOUNT>0 ROLLBACK")
            if isinstance(exc,HTTPException): raise
            if isinstance(exc,ValueError): raise HTTPException(422,str(exc)) from exc
            detail=sql_error(exc)
            if detail: raise HTTPException(409 if "52997" in str(exc) else 422,detail) from exc
            raise

def audit(cur,item_id,ctx,action,value):
    cur.execute("""INSERT dbo.OpportunityChangeLog(EventID,OpportunityID,EntityLevel,ItemID,ItemLabel,Action,
      FieldName,NewValue,ChangedBy,Source,Reason)
      SELECT NEWID(),i.OpportunityID,'Item',i.ID,p.ProductCode,'Update','TCBVersion',?,?,'User',?
      FROM dbo.OpportunityItem i JOIN dbo.Product p ON p.ID=i.ProductID WHERE i.ID=?""",
      document(value),ctx.username,action,item_id)

def frozen_item(item,version):
    result={**item,"TCBCostInfo":version["SavedJSON"],"ProductGradeSnapshot":version["GradeJSON"]}
    if version.get("ContextJSON"):
        captured=next((r for r in json.loads(version["ContextJSON"]) if r.get("ItemID")==item["ID"]),{})
        if "WeightGrams" in captured: result["WeightGrams"]=captured["WeightGrams"]
    return result

def publish(cur,item,value,snapshot,ctx):
    item_id=item["ID"]
    if json.loads(item.get("ProductGradeSnapshot") or "{}")!=snapshot:
        cur.execute("EXEC dbo.usp_OpportunityItem_Fields_Save ?,?,?,?,?",
                    ctx.username,item_id,rv(item["RowVersion"]),document({"ProductGradeSnapshot":snapshot}),0)
        consume(cur)
    token=cur.execute("SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?",item_id).fetchval()
    cur.execute("EXEC dbo.usp_OpportunityTCB_Save ?,?,?,?,?",ctx.username,item_id,token,document(value),0)
    consume(cur)

@router.get("/items/{item_id}/tcb-versions")
def versions(item_id:ID,ctx:AccessContext=Depends(get_access_context)):
    require(ctx,"Opportunity");item_read(item_id,ctx)
    with get_raw_cursor() as cur:
        cur.execute("SELECT * FROM dbo.OpportunityTCBVersion WHERE ItemID=? ORDER BY Version",item_id)
        return {"versions":[metadata(r) for r in records(cur)]}

@router.get("/items/{item_id}/tcb-versions/{version_id}")
def version_read(item_id:ID,version_id:ID,ctx:AccessContext=Depends(get_access_context)):
    require(ctx,"Opportunity")
    data=tcb_read(item_id,ctx)
    with get_raw_cursor() as cur: version=version_row(cur,item_id,version_id)
    rows=context_rows(item_id,ctx) if version["IsActive"] or not version["ContextJSON"] else json.loads(version["ContextJSON"])
    if not version["IsActive"]:
        data["item"]={**frozen_item(data["item"],version),"InactiveTCBVersion":True}
        captured=next((r for r in rows if r.get("ItemID")==item_id),{})
        if "WeightGrams" in captured: data["item"]["WeightGrams"]=captured["WeightGrams"]
        data["saved"]=json.loads(version["SavedJSON"])
        snapshot=json.loads(version["GradeJSON"]);data["grades"]=leaves(snapshot.get("items",[])) if snapshot.get("items") and not data["item"]["IsMixParent"] else []
        # Keep saved quotes available for historical comparisons; saves revalidate current master prices.
        quotes=current_prices(data["grades"],ctx) if data["grades"] else []
        seen={(q["PriceID"],q["PriceVersion"],str(q.get("USDPerLb"))) for q in quotes}
        data["prices"]=quotes+[q for q in data["saved"].get("PriceSnapshots",[]) if q.get("PriceID") and
            (q.get("PriceID"),q.get("PriceVersion"),str(q.get("USDPerLb"))) not in seen]
    saved_quotes=data["saved"].get("PriceSnapshots",[])
    keys={(p.get("PriceID"),p.get("PriceVersion"),str(p.get("USDPerLb"))) for p in data["prices"]}
    data["prices"] += [p for p in saved_quotes if p.get("PriceID") and (p.get("PriceID"),p.get("PriceVersion"),str(p.get("USDPerLb"))) not in keys]
    return {"version":metadata(version),"tcb":data,"rows":rows}

class CreateVersion(BaseModel):
    model_config=ConfigDict(extra="forbid")
    ItemRowVersion:str
    Name:str=Field(min_length=1,max_length=100)
    SourceVersionID:int|None=Field(None,ge=1,le=2147483647)
    SourceRowVersion:str|None=None

@router.post("/items/{item_id}/tcb-versions")
def create_version(body:CreateVersion,item_id:ID,ctx:AccessContext=Depends(get_access_context)):
    name=body.Name.strip()
    if not name: raise HTTPException(422,"Enter a version name.")
    captured=context_rows(item_id,ctx)
    with transaction(item_id,body.ItemRowVersion,ctx) as (cur,item):
        if cur.execute("SELECT COUNT(*) FROM dbo.OpportunityTCBVersion WHERE ItemID=?",item_id).fetchval()>=100:
            raise HTTPException(422,"An item can have at most 100 TCB versions.")
        if body.SourceVersionID:
            source=version_row(cur,item_id,body.SourceVersionID,True)
            if not body.SourceRowVersion or bytes_to_b64(source["RowVersion"])!=body.SourceRowVersion:
                raise HTTPException(409,"Source version changed. Refresh before copying.")
            saved,grades=source["SavedJSON"],source["GradeJSON"]
            if not source["IsActive"] and source["ContextJSON"]: captured=json.loads(source["ContextJSON"])
        else:
            saved,grades=document({"Inputs":{}}),item.get("ProductGradeSnapshot") or '{"items":[]}'
        number=cur.execute("SELECT COALESCE(MAX(Version),0)+1 FROM dbo.OpportunityTCBVersion WHERE ItemID=?",item_id).fetchval()
        cur.execute("""INSERT dbo.OpportunityTCBVersion(ItemID,Version,Name,SavedJSON,GradeJSON,ContextJSON,CreatedBy,UpdatedBy)
          VALUES(?,?,?,?,?,?,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY()) AS TCBVersionID""",item_id,number,name,saved,grades,document(captured),ctx.username,ctx.username)
        # INSERT row-count results precede SELECT when the connection uses NOCOUNT OFF.
        version_id=consume(cur)[-1][0]["TCBVersionID"]
        audit(cur,item_id,ctx,"Create TCB version",{"ID":version_id,"Name":name,"CopiedFrom":body.SourceVersionID})
        result=metadata(version_row(cur,item_id,version_id))
    return {"version":result}

class VersionSave(CommercialSave):
    VersionRowVersion:str

def review_version(cur,item,version,body,ctx):
    if bytes_to_b64(version["RowVersion"])!=body.VersionRowVersion:
        raise HTTPException(409,"TCB version changed. Refresh before saving.")
    source=item if version["IsActive"] else {**frozen_item(item,version),"HasOpenPackagingRequest":False}
    return commercial_value(CommercialSave.model_validate(body.model_dump(exclude={"VersionRowVersion"})),source,ctx,cur)

@router.post("/items/{item_id}/tcb-versions/{version_id}/preview")
def version_preview(body:VersionSave,item_id:ID,version_id:ID,ctx:AccessContext=Depends(get_access_context)):
    require(ctx,"Opportunity");item=item_read(item_id,ctx)
    with get_raw_cursor() as cur:
        version=version_row(cur,item_id,version_id)
        try: value,snapshot,grades,prices=review_version(cur,item,version,body,ctx)
        except ValueError as exc: raise HTTPException(422,str(exc)) from exc
    return {"saved":value,"snapshot":snapshot,"grades":grades,"prices":prices,"LossProductPct":str(value["Inputs"].get("LossProductPct",0))}

@router.post("/items/{item_id}/tcb-versions/{version_id}")
def version_save(body:VersionSave,item_id:ID,version_id:ID,ctx:AccessContext=Depends(get_access_context)):
    captured=context_rows(item_id,ctx)
    with transaction(item_id,body.RowVersion,ctx) as (cur,item):
        version=version_row(cur,item_id,version_id,True)
        value,snapshot,grades,prices=review_version(cur,item,version,body,ctx)
        if version["IsActive"]: publish(cur,item,value,snapshot,ctx)
        cur.execute("""UPDATE dbo.OpportunityTCBVersion SET SavedJSON=?,GradeJSON=?,ContextJSON=?,UpdatedBy=?,UpdatedAt=SYSUTCDATETIME()
          WHERE ID=?""",document(value),document(snapshot),None if version["IsActive"] else version["ContextJSON"] or document(captured),ctx.username,version_id)
        audit(cur,item_id,ctx,"Save TCB version",{"ID":version_id,"Active":bool(version["IsActive"])})
        token=cur.execute("SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?",item_id).fetchval()
        result=metadata(version_row(cur,item_id,version_id))
    return {"version":result,"RowVersion":bytes_to_b64(token),"saved":value,"snapshot":snapshot,"grades":grades,"prices":prices}

class ActivateVersion(BaseModel):
    model_config=ConfigDict(extra="forbid")
    ItemRowVersion:str
    VersionRowVersion:str

@router.post("/items/{item_id}/tcb-versions/{version_id}/activate")
def activate_version(body:ActivateVersion,item_id:ID,version_id:ID,ctx:AccessContext=Depends(get_access_context)):
    captured=context_rows(item_id,ctx)
    with transaction(item_id,body.ItemRowVersion,ctx) as (cur,item):
        version=version_row(cur,item_id,version_id,True)
        if bytes_to_b64(version["RowVersion"])!=body.VersionRowVersion:
            raise HTTPException(409,"TCB version changed. Refresh before activating.")
        saved=json.loads(version["SavedJSON"]);snapshot=json.loads(version["GradeJSON"])
        same=json.loads(item.get("ProductGradeSnapshot") or "{}").get("items",[])==snapshot.get("items",[])
        request=CommercialSave(RowVersion=body.ItemRowVersion,Inputs=saved.get("Inputs",{}),
             CostInputs=saved.get("Inputs",{}),Prices=saved.get("Inputs",{}).get("Prices",[]),
             Grades=None if same else {"items":snapshot.get("items",[])})
        value,snapshot,grades,prices=commercial_value(request,item,ctx,cur)
        cur.execute("UPDATE dbo.OpportunityTCBVersion SET IsActive=0,ContextJSON=?,UpdatedBy=?,UpdatedAt=SYSUTCDATETIME() WHERE ItemID=? AND IsActive=1",document(captured),ctx.username,item_id)
        publish(cur,item,value,snapshot,ctx)
        cur.execute("""UPDATE dbo.OpportunityTCBVersion SET IsActive=1,SavedJSON=?,GradeJSON=?,ContextJSON=NULL,
          UpdatedBy=?,UpdatedAt=SYSUTCDATETIME() WHERE ID=?""",document(value),document(snapshot),ctx.username,version_id)
        audit(cur,item_id,ctx,"Activate TCB version",{"ID":version_id})
        token=cur.execute("SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?",item_id).fetchval()
    return {"RowVersion":bytes_to_b64(token)}


@router.get("/items/{item_id}/tcb-version-comparison")
def compare_versions(item_id:ID,ctx:AccessContext=Depends(get_access_context)):
    require(ctx,"Opportunity")
    current=tcb_read(item_id,ctx);live=context_rows(item_id,ctx)
    with get_raw_cursor() as cur:
        cur.execute("SELECT * FROM dbo.OpportunityTCBVersion WHERE ItemID=? ORDER BY Version",item_id)
        versions=records(cur)
    result=[]
    for version in versions:
        data={**current,"item":frozen_item(current["item"],version),"saved":json.loads(version["SavedJSON"])}
        snapshot=json.loads(version["GradeJSON"])
        data["grades"]=leaves(snapshot.get("items",[])) if snapshot.get("items") and not data["item"]["IsMixParent"] else []
        data["prices"]=[p for p in data["saved"].get("PriceSnapshots",[]) if p.get("PriceID")]
        if version["IsActive"]:
            data["saved"]=current["saved"]
        rows=live if version["IsActive"] or not version["ContextJSON"] else json.loads(version["ContextJSON"])
        result.append({"version":metadata(version),"tcb":data,"rows":rows})
    return {"versions":result}

@router.get("/tcb-comparison/items")
def comparison_choices(search:str=Query("",max_length=120),ctx:AccessContext=Depends(get_access_context)):
    require(ctx,"Opportunity")
    from packaging_api import execute
    from opportunity_excel_api import AUTH
    return {"rows":execute(AUTH+"""SELECT TOP(40) i.ID ItemID,o.OpportunityNumber,p.ProductCode,p.ProductName,c.CustomerName
      FROM dbo.OpportunityItem i JOIN dbo.Opportunity o ON o.ID=i.OpportunityID
      JOIN dbo.Product p ON p.ID=i.ProductID JOIN dbo.Customer c ON c.ID=o.CustomerID
      WHERE p.IsMix=0 AND (o.OpportunityNumber LIKE ? OR p.ProductCode LIKE ? OR p.ProductName LIKE ? OR c.CustomerName LIKE ?)
      ORDER BY o.ID DESC,i.ID""",[ctx.username,*["%"+search+"%"]*4])[0]}

@router.get("/items/{item_id}/tcb-comparison")
def comparison_context(item_id:ID,ctx:AccessContext=Depends(get_access_context)):
    require(ctx,"Opportunity");rows=context_rows(item_id,ctx)
    entries=[]
    for row in rows:
        if not row.get("ItemID"): continue
        data=row["TCBContext"]
        keys={(p.get("PriceID"),p.get("PriceVersion"),str(p.get("USDPerLb"))) for p in data["prices"]}
        data["prices"] += [p for p in data["saved"].get("PriceSnapshots",[]) if p.get("PriceID") and (p.get("PriceID"),p.get("PriceVersion"),str(p.get("USDPerLb"))) not in keys]
        entries.append({"ItemID":row["ItemID"],"tcb":data})
    return {"rows":rows,"entries":entries}
