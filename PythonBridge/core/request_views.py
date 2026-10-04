"""Packaging request view preferences and paged, allow-listed sort reads."""
import json
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from master_models import MasterSort, ColumnWidth
from packaging_fields import OPPORTUNITYITEM_FIELDS, PACKAGINGCONFIGURATIONREQUESTITEM_FIELDS, RETIRED_RESPONSE_COLUMNS
from packing_way import packing_way
from packaging_efficiency import response_derived
from web_item_fields import WEB_ITEM_FIELDS, CALCULATED_FIELDS

HEADERS={"RequestNumber","OpportunityNumber","CustomerName","ResponseDue","RequestStatus","ItemCount","Unassigned","RequestedByName","RequestedAt"}
ITEMS={"CostBasis","ResponseNotes","HeightMM","WidthMM","LengthMM","ProductCode","ItemDescription","AnnualUnit","PackagingRequirement","ItemStage","PIC","ProductName","WeightGrams","Category","Grade","MixRatioPct","ShelfLifeDays",*OPPORTUNITYITEM_FIELDS,*PACKAGINGCONFIGURATIONREQUESTITEM_FIELDS}
VIEW_ITEMS=ITEMS | WEB_ITEM_FIELDS

class RequestView(BaseModel):
    page_size:int=Field(25,ge=1,le=500,strict=True)
    column_widths:dict[str,ColumnWidth]=Field(default_factory=dict,max_length=128)
    model_config=ConfigDict(extra="forbid")
    columns:list[str]=Field(min_length=1,max_length=128)
    sort:list[MasterSort]=Field(default_factory=list,max_length=64)
    filters:list[str]|None=Field(None,max_length=2)
    values:dict[str,str]=Field(default_factory=dict,max_length=2)
    field_version: int = Field(1, ge=1, le=7)
    prefix_columns:list[str]|None=Field(None,max_length=64)

class RequestViews(BaseModel):
    model_config=ConfigDict(extra="forbid")
    editor_page_size:int=Field(25,ge=1,le=500,strict=True)
    header:RequestView|None=None
    items:RequestView|None=None
    @field_validator("header","items")
    @classmethod
    def valid(cls,v,info):
        if v is None:return v
        allowed=HEADERS if info.field_name=="header" else VIEW_ITEMS
        if info.field_name=="items":
            v.columns=[k for k in v.columns if k not in RETIRED_RESPONSE_COLUMNS]
            v.sort=[r for r in v.sort if r.column not in RETIRED_RESPONSE_COLUMNS]
            for key in RETIRED_RESPONSE_COLUMNS: v.column_widths.pop(key,None)
            if v.prefix_columns is not None:v.prefix_columns=[k for k in v.prefix_columns if k not in RETIRED_RESPONSE_COLUMNS]
        width_keys=allowed | ({"_Actions"} if info.field_name=="header" else {"_PIC","_Assign","_Documents","_Response"})
        if any(k not in width_keys for k in v.column_widths):raise ValueError("Invalid column width key.")
        for keys in (v.columns,[r.column for r in v.sort]):
            if len(keys)!=len(set(keys)) or any(k not in allowed for k in keys):
                raise ValueError("Invalid or duplicate Packaging Request column.")
        if v.prefix_columns is not None and (info.field_name!="items" or len(v.prefix_columns)!=len(set(v.prefix_columns)) or any(c not in VIEW_ITEMS for c in v.prefix_columns)):
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
          h.ResponseDue,h.RequestedAt,h.RequestNotes,u.UserName RequestedByName,t.ItemCount,t.Unassigned,
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
    sort_sql=order(sort,VIEW_ITEMS-CALCULATED_FIELDS,"ItemID ASC")
    # Only shared source/assignment fields, never unapproved response costs or dimensions.
    source="""FROM dbo.PackagingConfigurationRequestItem i
        JOIN dbo.PackagingConfigurationRequest h ON h.ID=i.RequestID
        JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
        LEFT JOIN dbo.PackagingConfigurationRequestItem parent_container ON parent_container.RequestID=i.RequestID AND parent_container.OpportunityItemID=oi.ParentItemID
        LEFT JOIN dbo.Users pic ON pic.ID=i.PICUserID
        JOIN dbo.Users requester ON requester.ID=h.RequestedBy
        LEFT JOIN dbo.Currency currency ON currency.ID=i.CurrencyID
        LEFT JOIN dbo.PkgPricingMaster primary_pricing ON primary_pricing.RequestItemID=i.ID AND primary_pricing.PackagingOrder='Primary' AND primary_pricing.IsCurrent=1
        LEFT JOIN dbo.PkgPricingMaster secondary_pricing ON secondary_pricing.RequestItemID=i.ID AND secondary_pricing.PackagingOrder='Secondary' AND secondary_pricing.IsCurrent=1
        LEFT JOIN dbo.PkgPricingMaster tertiary_pricing ON tertiary_pricing.RequestItemID=i.ID AND tertiary_pricing.PackagingOrder='Tertiary' AND tertiary_pricing.IsCurrent=1
        OUTER APPLY(SELECT TOP(1) p.PalletAreaMM2 FROM dbo.v_PalletMaster p JOIN dbo.UoM u ON u.ID=p.UoMID
          WHERE p.PalletSize=i.ResponsePalletSize AND p.Status='Active' AND u.Status='Active' ORDER BY p.ID) efficiency_pallet
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
          i.ProductName,i.WeightGrams,i.Category,i.Grade,i.MixRatioPct,oi.ParentItemID,
          i.PrimaryTypeID,i.PrimaryTypeName,i.SecondaryTypeID,i.SecondaryTypeName,i.SecondaryTransparency,i.NumberOfPrimary,
          i.RequestedLayerCount,i.TertiaryTypeID,i.TertiaryTypeName,i.TertiaryTransparency,i.NumberOfSecondary,
          CASE WHEN oi.ParentItemID IS NULL THEN i.MaxPalletHeightMM END MaxPalletHeightMM,i.ProductGradeSnapshot,i.SecondaryRecyclableRequirement,i.SecondaryRecycledContent,i.SecondaryMetalizedAluminum,i.SecondarySpecialComments,i.TertiaryRecyclableRequirement,i.TertiaryRecycledContent,i.TertiaryMetalizedAluminum,i.TertiarySpecialComments,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.ResponseLayerCount END ResponseLayerCount,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.SelectedContainerType END SelectedContainerType,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.ContainerLoadProfiles END ContainerLoadProfiles,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.ResponsePalletSize END ResponsePalletSize,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.ResponsePalletStacking END ResponsePalletStacking,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.ResponseMaxPalletHeightMM END ResponseMaxPalletHeightMM,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.ResponseDefaultsInitialized END ResponseDefaultsInitialized,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.ThirdPMType END ThirdPMType,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.ThirdPMMOQ END ThirdPMMOQ,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.UnitsPerTertiary END UnitsPerTertiary,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.NutDensity END NutDensity,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.UsedVolumeML END UsedVolumeML,
          CASE WHEN oi.ParentItemID IS NULL THEN i.PalletSize END PalletSize,
          CASE WHEN oi.ParentItemID IS NULL THEN i.PalletStacking END PalletStacking,
          CASE WHEN oi.ParentItemID IS NULL THEN i.MaxPalletHeightM END MaxPalletHeightM,
          CASE WHEN oi.ParentItemID IS NULL THEN i.ContainerRequest END ContainerRequest,
          COALESCE(NULLIF(i.ContainerRequest,N''),parent_container.ContainerRequest) ResponseContainerFamily,
          i.ConfigurationRequest,i.PackagingType,i.RecyclableRequirement,i.RecycledContent,i.Transparency,i.MetalizedAluminum,i.ShelfLifeDays,i.SpecialComments,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.FirstPMType END FirstPMType,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.SecondPMType END SecondPMType,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.UnitsPerCarton END UnitsPerCarton,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.PackagingDescription END PackagingDescription,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.FirstPMMOQ END FirstPMMOQ,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.SecondPMMOQ END SecondPMMOQ,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.PalletType END PalletType,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.CartonsPerLayer END CartonsPerLayer,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.LayersPerPallet END LayersPerPallet,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.PacksPerPallet END PacksPerPallet,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.CartonsPerContainer END CartonsPerContainer,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.LayersPerContainer END LayersPerContainer,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.PalletsPerContainer END PalletsPerContainer,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.CartonsPerContainerFloor END CartonsPerContainerFloor,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.MaterialID END MaterialID,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.HeightMM END HeightMM,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.WidthMM END WidthMM,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.LengthMM END LengthMM,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.Cost END Cost,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.CurrencyID END CurrencyID,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.CostBasis END CostBasis,CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.ResponseNotes END ResponseNotes,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN primary_pricing.UnitPrice END PrimaryPricePerUnit,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN primary_pricing.CurrencyCode END PrimaryPriceCurrencyCode,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN secondary_pricing.UnitPrice END SecondaryPricePerUnit,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN secondary_pricing.CurrencyCode END SecondaryPriceCurrencyCode,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN tertiary_pricing.UnitPrice END TertiaryPricePerUnit,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN tertiary_pricing.CurrencyCode END TertiaryPriceCurrencyCode,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN primary_pricing.SnapshotJSON END PrimaryLayerPricingSnapshot,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN secondary_pricing.SnapshotJSON END SecondaryLayerPricingSnapshot,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN tertiary_pricing.SnapshotJSON END TertiaryLayerPricingSnapshot,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN
            CASE COALESCE(i.ResponseLayerCount,i.RequestedLayerCount) WHEN 1 THEN primary_pricing.SnapshotJSON
              WHEN 2 THEN secondary_pricing.SnapshotJSON ELSE tertiary_pricing.SnapshotJSON END END FinalLayerPricingSnapshot,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN efficiency_pallet.PalletAreaMM2 END EfficiencyPalletAreaMM2,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN i.Cost END PMCost,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN currency.CurrencyCode END PMCostCurrencyCode,
          CASE WHEN @CanReadDraft=1 OR i.Stage='Approved' THEN 1 ELSE 0 END PackingWayVisible,
          i.SnapshotOrigin,i.SnapshotCapturedAt,h.SourceCurrencyCode,h.SourceExchangeRateToVND,
          requester.UserName RequestedByName,h.RequestNotes,i.RowVersion ItemRowVersion {source})
        SELECT * FROM Items ORDER BY {sort_sql} OFFSET ? ROWS FETCH NEXT ? ROWS ONLY;
        SELECT COUNT(*) Total {source};
    """,[username,*params,(page-1)*size,size,*params])
    for row in sets[0]:
        values = packing_way(row)
        from container_loading import container_results
        values["ContainerLoadResults"] = container_results(row)
        values.update(response_derived(row, values))
        row.update(values if row.pop("PackingWayVisible") else {key: None for key in values})
    return dict(rows=sets[0],total=sets[1][0]["Total"],page=page,page_size=size)
