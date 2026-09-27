"""Packaging request view preferences and paged, allow-listed sort reads."""
import json
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from master_models import MasterSort, ColumnWidth
from packaging_fields import OPPORTUNITYITEM_FIELDS, PACKAGINGCONFIGURATIONREQUESTITEM_FIELDS

HEADERS={"RequestNumber","OpportunityNumber","CustomerName","ResponseDue","RequestStatus","ItemCount","Unassigned","RequestedByName","RequestedAt"}
ITEMS={"CostBasis","ResponseNotes","HeightMM","WidthMM","LengthMM","ProductCode","ItemDescription","AnnualUnit","PackagingRequirement","ItemStage","PIC","ProductName","WeightGrams","Category","Grade","MixRatioPct","PMCost","PMCostCurrencyCode",*OPPORTUNITYITEM_FIELDS,*PACKAGINGCONFIGURATIONREQUESTITEM_FIELDS}

class RequestView(BaseModel):
    column_widths:dict[str,ColumnWidth]=Field(default_factory=dict,max_length=64)
    model_config=ConfigDict(extra="forbid")
    columns:list[str]=Field(min_length=1,max_length=64)
    sort:list[MasterSort]=Field(default_factory=list,max_length=64)
    filters:list[str]|None=Field(None,max_length=2)
    values:dict[str,str]=Field(default_factory=dict,max_length=2)
    field_version: int = Field(1, ge=1, le=3)
    prefix_columns:list[str]|None=Field(None,max_length=64)

class RequestViews(BaseModel):
    model_config=ConfigDict(extra="forbid")
    header:RequestView|None=None
    items:RequestView|None=None
    @field_validator("header","items")
    @classmethod
    def valid(cls,v,info):
        if v is None:return v
        allowed=HEADERS if info.field_name=="header" else ITEMS
        width_keys=allowed | ({"_Actions"} if info.field_name=="header" else {"_PIC","_Assign","_Documents","_Response"})
        if any(k not in width_keys for k in v.column_widths):raise ValueError("Invalid column width key.")
        for keys in (v.columns,[r.column for r in v.sort]):
            if len(keys)!=len(set(keys)) or any(k not in allowed for k in keys):
                raise ValueError("Invalid or duplicate Packaging Request column.")
        if v.prefix_columns is not None and (info.field_name!="items" or len(v.prefix_columns)!=len(set(v.prefix_columns)) or any(c not in ITEMS for c in v.prefix_columns)):
            raise ValueError("Invalid request item prefix columns.")
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

def item_read(username,request_id,page,size,stage,opportunity_number,sort,request_ids=None):
    from packaging_api import execute
    sort_sql=order(sort,ITEMS,"ItemID ASC")
    # Only shared source/assignment fields, never unapproved response costs or dimensions.
    source="""FROM dbo.PackagingConfigurationRequestItem i
        JOIN dbo.PackagingConfigurationRequest h ON h.ID=i.RequestID
        LEFT JOIN dbo.Users pic ON pic.ID=i.PICUserID
        JOIN dbo.Users requester ON requester.ID=h.RequestedBy
        LEFT JOIN dbo.Currency currency ON currency.ID=i.CurrencyID
        WHERE (? IS NULL OR h.ID=?) AND (? IS NULL OR i.Stage=?)
          AND (? IS NULL OR h.OpportunityNumber LIKE ?)"""
    params=[request_id,request_id,stage,stage,opportunity_number,opportunity_number+"%" if opportunity_number else None]
    if request_ids is not None:
        source+=" AND h.ID IN (SELECT RequestID FROM OPENJSON(CAST(? AS NVARCHAR(MAX))) WITH (RequestID INT '$'))"
        params.append(json.dumps(request_ids))
    sets=execute(f"""
        DECLARE @Actor INT; EXEC dbo.usp_Packaging_Authorize ?,'Read',@Actor OUTPUT;
        DECLARE @CanReadDraft BIT=0;
        IF EXISTS(SELECT 1 FROM dbo.UserAccess WHERE UserID=@Actor AND Scope IN('Admin','Packaging','PackagingManager')) SET @CanReadDraft=1;
        ;WITH Items AS (SELECT i.ID ItemID,i.RequestID,i.ProductCode,i.ItemDescription,i.AnnualUnit,
          i.PackagingRequirement,i.Stage ItemStage,i.PICUserID,pic.UserName PIC,
          i.ProductName,i.WeightGrams,i.Category,i.Grade,i.MixRatioPct,i.PalletSize,i.PalletStacking,i.MaxPalletHeightM,i.ContainerRequest,i.ConfigurationRequest,i.PackagingType,i.RecyclableRequirement,i.RecycledContent,i.Transparency,i.MetalizedAluminum,i.BarrierRequirement,i.ShelfLifeDays,i.SpecialComments,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.FirstPMType END FirstPMType,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.SecondPMType END SecondPMType,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.UnitsPerCarton END UnitsPerCarton,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.PackagingDescription END PackagingDescription,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.FirstPMMOQ END FirstPMMOQ,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.SecondPMMOQ END SecondPMMOQ,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.PalletType END PalletType,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.CartonsPerLayer END CartonsPerLayer,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.LayersPerPallet END LayersPerPallet,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.PacksPerPallet END PacksPerPallet,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.CartonsPerContainer END CartonsPerContainer,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.MaterialID END MaterialID,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.HeightMM END HeightMM,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.WidthMM END WidthMM,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.LengthMM END LengthMM,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.Cost END Cost,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.CurrencyID END CurrencyID,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.CostBasis END CostBasis,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.ResponseNotes END ResponseNotes,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.Cost END PMCost,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN currency.CurrencyCode END PMCostCurrencyCode,
          i.SnapshotOrigin,i.SnapshotCapturedAt,h.SourceCurrencyCode,h.SourceExchangeRateToVND,
          requester.UserName RequestedByName,h.RequestNotes,i.RowVersion ItemRowVersion {source})
        SELECT * FROM Items ORDER BY {sort_sql} OFFSET ? ROWS FETCH NEXT ? ROWS ONLY;
        SELECT COUNT(*) Total {source};
    """,[username,*params,(page-1)*size,size,*params])
    return dict(rows=sets[0],total=sets[1][0]["Total"],page=page,page_size=size)
