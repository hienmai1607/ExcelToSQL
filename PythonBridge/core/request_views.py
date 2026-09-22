"""Packaging request view preferences and paged, allow-listed sort reads."""
import json
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from master_models import MasterSort

HEADERS={"RequestNumber","OpportunityNumber","CustomerName","ResponseDue","RequestStatus","ItemCount","Unassigned","RequestedByName","RequestedAt"}
ITEMS={"ProductCode","ItemDescription","AnnualUnit","PackagingRequirement","ItemStage","PIC"}

class RequestView(BaseModel):
    model_config=ConfigDict(extra="forbid")
    columns:list[str]=Field(min_length=1,max_length=9)
    sort:list[MasterSort]=Field(default_factory=list,max_length=9)
    filters:list[str]|None=Field(None,max_length=2)
    values:dict[str,str]=Field(default_factory=dict,max_length=2)

class RequestViews(BaseModel):
    model_config=ConfigDict(extra="forbid")
    header:RequestView|None=None
    items:RequestView|None=None
    @field_validator("header","items")
    @classmethod
    def valid(cls,v,info):
        if v is None:return v
        allowed=HEADERS if info.field_name=="header" else ITEMS
        for keys in (v.columns,[r.column for r in v.sort]):
            if len(keys)!=len(set(keys)) or any(k not in allowed for k in keys):
                raise ValueError("Invalid or duplicate Packaging Request column.")
        filters={"search","status"} if info.field_name=="header" else set()
        if len(v.filters or [])!=len(set(v.filters or [])) or any(k not in filters for k in [*(v.filters or []),*v.values]):
            raise ValueError("Invalid Packaging Request filter.")
        if any(len(s)>200 for s in v.values.values()):raise ValueError("Filter too long.")
        if v.values.get("status","") not in ("","Open","Completed","Canceled"):raise ValueError("Invalid status.")
        return v

def order(raw,allowed,tie):
    try:
        data=json.loads(raw)
        if not isinstance(data,list) or len(data)>len(allowed):raise ValueError()
        rules=[MasterSort.model_validate(r) for r in data]
        if len({r.column for r in rules})!=len(rules) or any(r.column not in allowed for r in rules):raise ValueError()
    except (ValueError,TypeError):
        raise HTTPException(422,"Invalid Packaging Request sort.")
    return ", ".join(f"[{r.column}] {r.direction.upper()}" for r in rules)+(", " if rules else "")+tie

def header_read(username,page,size,search,status,sort):
    from packaging_api import execute
    sort_sql=order(sort,HEADERS,"RequestID DESC")
    cte="""WITH Summary AS (
        SELECT h.ID RequestID,h.RequestNumber,h.OpportunityNumber,h.CustomerName,
          h.ResponseDue,h.RequestedAt,u.UserName RequestedByName,t.ItemCount,t.Unassigned,
          CASE WHEN t.OpenCount>0 THEN 'Open' WHEN t.ApprovedCount>0 THEN 'Completed' ELSE 'Canceled' END RequestStatus
        FROM dbo.PackagingConfigurationRequest h JOIN dbo.Users u ON u.ID=h.RequestedBy
        CROSS APPLY(SELECT COUNT(*) ItemCount,
          COALESCE(SUM(CASE WHEN i.PICUserID IS NULL AND i.IsOpen=1 THEN 1 ELSE 0 END),0) Unassigned,
          SUM(CONVERT(INT,i.IsOpen)) OpenCount,
          SUM(CASE WHEN i.Stage='Approved' THEN 1 ELSE 0 END) ApprovedCount
          FROM dbo.PackagingConfigurationRequestItem i WHERE i.RequestID=h.ID) t
        WHERE h.RequestNumber LIKE ? OR h.OpportunityNumber LIKE ? OR h.CustomerName LIKE ?
    )"""
    params=[search+"%"]*3+[status,status]
    sets=execute(f"""
      DECLARE @Actor INT; EXEC dbo.usp_Packaging_Authorize ?,'Read',@Actor OUTPUT;
      ;{cte} SELECT * FROM Summary WHERE (? IS NULL OR RequestStatus=?) ORDER BY {sort_sql}
      OFFSET ? ROWS FETCH NEXT ? ROWS ONLY;
      ;{cte} SELECT COUNT(*) Total FROM Summary WHERE (? IS NULL OR RequestStatus=?);
    """,[username,*params,(page-1)*size,size,*params])
    return dict(rows=sets[0],total=sets[1][0]["Total"],page=page,page_size=size)

def item_read(username,request_id,page,size,stage,opportunity_number,sort):
    from packaging_api import execute
    sort_sql=order(sort,ITEMS,"ItemID ASC")
    # Only shared source/assignment fields, never unapproved response costs or dimensions.
    source="""FROM dbo.PackagingConfigurationRequestItem i
        JOIN dbo.PackagingConfigurationRequest h ON h.ID=i.RequestID
        LEFT JOIN dbo.Users pic ON pic.ID=i.PICUserID
        JOIN dbo.Users requester ON requester.ID=h.RequestedBy
        WHERE (? IS NULL OR h.ID=?) AND (? IS NULL OR i.Stage=?)
          AND (? IS NULL OR h.OpportunityNumber LIKE ?)"""
    params=[request_id,request_id,stage,stage,opportunity_number,opportunity_number+"%" if opportunity_number else None]
    sets=execute(f"""
        DECLARE @Actor INT; EXEC dbo.usp_Packaging_Authorize ?,'Read',@Actor OUTPUT;
        ;WITH Items AS (SELECT i.ID ItemID,i.RequestID,i.ProductCode,i.ItemDescription,i.AnnualUnit,
          i.PackagingRequirement,i.Stage ItemStage,i.PICUserID,pic.UserName PIC,
          requester.UserName RequestedByName,h.RequestNotes,i.RowVersion ItemRowVersion {source})
        SELECT * FROM Items ORDER BY {sort_sql} OFFSET ? ROWS FETCH NEXT ? ROWS ONLY;
        SELECT COUNT(*) Total {source};
    """,[username,*params,(page-1)*size,size,*params])
    return dict(rows=sets[0],total=sets[1][0]["Total"],page=page,page_size=size)
