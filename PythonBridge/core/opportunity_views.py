"""Allow-listed Opportunity views: sort headers before expanding item rows."""
import json
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from master_models import MasterSort, ColumnWidth
from packaging_api import execute
from packing_way import packing_way
from packaging_weight import layer_sql
from packaging_efficiency import response_derived
from web_item_fields import WEB_ITEM_FIELDS
from shipment_columns import SHIPMENT_COLUMNS, shipment_columns
from item_stage_summary import stage_summary, complete_stage_summaries
from tcb_analysis_columns import TCB_COLUMNS, add_tcb_columns

HEADER_COLUMNS = {"OpportunityNumber", "CustomerName", "OpportunityDesc", "BidOpen", "BidClose", "HeaderStage", "ItemCount", "CustomerCurrencyCode", "ExchangeRateVNDPerUSD", "ExchangeRateCustomerCurrencyPerUSD"}
from packaging_fields import OPPORTUNITYITEM_FIELDS, PACKAGINGCONFIGURATIONREQUESTITEM_FIELDS, RETIRED_RESPONSE_COLUMNS
MIX_COLUMNS = {"ItemNumber","MixUnitQuantity","ShelfLifeDays"}
ITEM_COLUMNS = {"ProductCode", "ItemDescription", "AnnualUnit", "EstPctAwarded", "ShelfPrice", "ItemStage", "ProductName", "WeightGrams", "Category", "Grade", "MixRatioPct", "PackagingRequestNumber", "PackagingResponseStage", *OPPORTUNITYITEM_FIELDS, *PACKAGINGCONFIGURATIONREQUESTITEM_FIELDS}

ITEM_COLUMNS |= MIX_COLUMNS
VIEW_ITEM_COLUMNS = ITEM_COLUMNS | WEB_ITEM_FIELDS | SHIPMENT_COLUMNS | TCB_COLUMNS

class OpportunityView(BaseModel):
    page_size: int = Field(25, ge=1, le=500, strict=True)
    column_widths: dict[str, ColumnWidth] = Field(default_factory=dict,max_length=128)
    model_config = ConfigDict(extra="forbid")
    columns: list[str] = Field(min_length=1, max_length=644)
    sort: list[MasterSort] = Field(default_factory=list, max_length=644)
    filters: list[str] | None = Field(None, max_length=5)
    values: dict[str, str] = Field(default_factory=dict, max_length=5)
    field_version: int = Field(1, ge=1, le=12)
    prefix_columns: list[str] | None = Field(None, max_length=64)

def validate_view(view, allowed):
    # Keep ITEM_COLUMNS unchanged for workbook exports; web preferences have a wider catalog.
    allowed = VIEW_ITEM_COLUMNS if allowed == ITEM_COLUMNS else allowed
    if allowed == VIEW_ITEM_COLUMNS:
        view.columns = [k for k in view.columns if k not in RETIRED_RESPONSE_COLUMNS]
        view.sort = [r for r in view.sort if r.column not in RETIRED_RESPONSE_COLUMNS]
        for key in RETIRED_RESPONSE_COLUMNS: view.column_widths.pop(key, None)
        if view.prefix_columns is not None:
            view.prefix_columns = [k for k in view.prefix_columns if k not in RETIRED_RESPONSE_COLUMNS]
    if allowed == HEADER_COLUMNS:
        mapping={"CurrencyCode":"CustomerCurrencyCode","ExchangeRateToVND":"ExchangeRateVNDPerUSD"}
        view.columns=list(dict.fromkeys(mapping.get(k,k) for k in view.columns))
        for rule in view.sort: rule.column=mapping.get(rule.column,rule.column)
    if any(k not in allowed and not (allowed==HEADER_COLUMNS and k=="_Actions") for k in view.column_widths):raise ValueError("Invalid column width key.")
    if view.prefix_columns is not None:
        if allowed != VIEW_ITEM_COLUMNS or len(view.prefix_columns) != len(set(view.prefix_columns)) or any(c not in VIEW_ITEM_COLUMNS for c in view.prefix_columns):
            raise ValueError("Invalid Opportunity item prefix columns.")
    for values in (view.columns, [r.column for r in view.sort]):
        if len(values) != len(set(values)) or any(v not in allowed for v in values):
            raise ValueError("Invalid or duplicate Opportunity view column.")
    filters = {"opportunity_number", "customer_name", "stage", "bid_open_from", "bid_open_to"} if allowed == HEADER_COLUMNS else set()
    keys = view.filters or []
    if len(keys) != len(set(keys)) or any(k not in filters for k in [*keys, *view.values]):
        raise ValueError("Invalid Opportunity filter.")
    if any(len(v) > 200 for v in view.values.values()):
        raise ValueError("Filter value is too long.")
    return view

class OpportunityViews(BaseModel):
    model_config = ConfigDict(extra="forbid")
    editor_page_size: int = Field(25, ge=1, le=500, strict=True)
    header: OpportunityView | None = None
    items: OpportunityView | None = None

    @field_validator("header", "items")
    @classmethod
    def check_view(cls, value, info):
        return validate_view(value, HEADER_COLUMNS if info.field_name == "header" else ITEM_COLUMNS) if value else value

def parse_header_sort(value):
    try:
        data = json.loads(value)
        if not isinstance(data, list) or len(data) > 64:
            raise ValueError()
        rules = [MasterSort.model_validate(r) for r in data]
        validate_view(OpportunityView(columns=["OpportunityNumber"], sort=rules), HEADER_COLUMNS)
        return rules
    except (ValueError, TypeError):
        raise HTTPException(422, "Invalid Opportunity sort columns or directions.")

def sorted_grid(username, page, page_size, sort, opportunity_number=None, customer_name=None,
                stage=None, bid_open_from=None, bid_open_to=None):
    rules = parse_header_sort(sort)
    order = ", ".join(f"[{r.column}] {r.direction.upper()}" for r in rules)
    order = (order + ", " if order else "") + "OpportunityID DESC"
    where = """(? IS NULL OR o.OpportunityNumber LIKE ?)
        AND (? IS NULL OR c.CustomerName LIKE ?)
        AND (? IS NULL OR o.Stage = ?)
        AND (? IS NULL OR o.BidOpen >= ?)
        AND (? IS NULL OR o.BidOpen <= ?)"""
    params = [opportunity_number, opportunity_number+"%" if opportunity_number else None,
              customer_name, customer_name+"%" if customer_name else None,
              stage, stage, bid_open_from, bid_open_from, bid_open_to, bid_open_to]
    result = execute(f"""
        IF NOT EXISTS (SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
            WHERE u.UserName=? AND u.IsActive=1 AND a.Scope IN(N'Admin',N'Opportunity'))
            THROW 52744, 'Opportunity access is required for this action.', 1;
        DECLARE @CanReadDraft BIT=0;
        IF EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.UserName=? AND u.IsActive=1 AND a.Scope IN('Admin','Packaging','PackagingManager')) SET @CanReadDraft=1;
        ;WITH Headers AS (
            SELECT o.ID OpportunityID,o.OpportunityNumber,o.CustomerID,c.CustomerName,
                o.OpportunityDesc,o.BidOpen,o.BidClose,o.Stage HeaderStage,o.RowVersion HeaderRowVersion,
                o.CurrencyID,o.ExchangeRateToVND,(SELECT CurrencyCode FROM dbo.Currency WHERE ID=o.CurrencyID) CurrencyCode,
                o.ExchangeRateVNDPerUSD,c.CurrencyID AS CustomerCurrencyID,
                (SELECT CurrencyCode FROM dbo.Currency WHERE ID=c.CurrencyID) CustomerCurrencyCode,
                CASE WHEN o.RateCustomerCurrencyID=c.CurrencyID THEN o.ExchangeRateCustomerCurrencyPerUSD END AS ExchangeRateCustomerCurrencyPerUSD,
                (SELECT COUNT(*) FROM dbo.OpportunityItem i WHERE i.OpportunityID=o.ID AND i.ParentItemID IS NULL) ItemCount
            FROM dbo.Opportunity o JOIN dbo.Customer c ON c.ID=o.CustomerID WHERE {where}
        ), Ranked AS (
            SELECT *,ROW_NUMBER() OVER(ORDER BY {order}) SortPosition FROM Headers
        ), PageHeaders AS (
            SELECT * FROM Ranked ORDER BY SortPosition OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
        )
        SELECT h.*,i.TCBCostInfo AS _TCBCostInfo,i.ID ItemID,i.ProductID,p.ProductCode,p.ProductName,i.ProductNetWeightGrams AS WeightGrams,i.ItemDescription,
            CONVERT(VARCHAR(40),i.AnnualUnit) AnnualUnit,
            i.ParentItemID,i.MixUnitQuantity,i.MixChildNumber,mix.MixVersionID,(SELECT StructureJSON FROM dbo.v_OpportunityMixStructure WHERE ParentItemID=i.ID) MixStructure,
            CONVERT(VARCHAR(20),(SELECT COUNT(*) FROM dbo.OpportunityItem root
              WHERE root.OpportunityID=i.OpportunityID AND root.ParentItemID IS NULL
              AND root.ID<=COALESCE(i.ParentItemID,i.ID)))+
              CASE WHEN i.ParentItemID IS NULL THEN '' ELSE '.'+CONVERT(VARCHAR(20),i.MixChildNumber) END AS ItemNumber,
            i.EstPctAwarded,i.ShelfPrice,i.Stage ItemStage,i.RowVersion ItemRowVersion,
            CAST(CASE WHEN active_request.ID IS NULL THEN 0 ELSE 1 END AS BIT) HasOpenPackagingRequest,
            request_header.RequestNumber AS OpenPackagingRequestNumber,
            active_request.Stage AS OpenPackagingRequestStage,
            stage_request.Stage AS _StagePackagingStage,stage_request.RequestNumber AS _StageRequestNumber,
            stage_request.PIC AS _StagePIC,stage_request.CreatedAt AS _StageRequestedAt,
            stage_request.SubmittedAt AS _StageSubmittedAt,stage_request.ReviewedAt AS _StageReviewedAt,
            CASE WHEN @CanReadDraft=1 OR stage_request.Stage IN('Approved','Canceled') THEN stage_request.ManagerComment END AS _StageReason,
            x.Category,x.Grade,x.MixRatioPct,logistics.PalletSize,logistics.PalletStacking,logistics.MaxPalletHeightM,logistics.ContainerRequest,logistics.ConfigurationRequest,x.PackagingType,x.RecyclableRequirement,x.RecycledContent,x.Transparency,x.MetalizedAluminum,p.ShelfLifeDays,x.SpecialComments,
            i.PrimaryTypeID,i.SecondaryTypeID,i.SecondaryTransparency,i.NumberOfPrimary,i.PackagingLayerCount,i.PackagingLayerCount RequestedLayerCount,i.TertiaryTypeID,i.TertiaryTransparency,i.NumberOfSecondary,
            port_entry.PortName AS PortOfEntryName,logistics.ShipmentCostInfo,logistics.MaxPalletHeightMM,i.ProductGradeSnapshot,i.SecondaryRecyclableRequirement,i.SecondaryRecycledContent,i.SecondaryMetalizedAluminum,i.SecondarySpecialComments,i.TertiaryRecyclableRequirement,i.TertiaryRecycledContent,i.TertiaryMetalizedAluminum,i.TertiarySpecialComments,
            (SELECT PackagingType FROM dbo.PackagingType WHERE ID=i.TertiaryTypeID) AS TertiaryTypeName,
            (SELECT PackagingType FROM dbo.PackagingType WHERE ID=i.PrimaryTypeID) AS PrimaryTypeName,
            (SELECT PackagingType FROM dbo.PackagingType WHERE ID=i.SecondaryTypeID) AS SecondaryTypeName,
            x.PackagingRequestID,x.PackagingRequestItemID,x.PackagingRequestNumber,x.PackagingResponseStage,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN response.ResponseLayerCount END ResponseLayerCount,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN response.SelectedContainerType END SelectedContainerType,
            COALESCE(NULLIF(response.ContainerRequest,N''),parent_container.ContainerRequest) ResponseContainerFamily,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN response.ContainerLoadProfiles END ContainerLoadProfiles,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN
             (SELECT p.ID,JSON_QUERY(p.Inputs) Inputs,JSON_QUERY(JSON_MODIFY(JSON_MODIFY(p.Result,'$.pallet_layer',NULL),'$.container_layer',NULL)) Result,COALESCE(JSON_VALUE(p.Result,'$.ContainerCode'),c.Code) Code FROM dbo.ContainerLoadPlan p JOIN dbo.ContainerTypeMaster c ON c.ID=p.ContainerID WHERE p.ID=response.LoadPlanID AND p.ItemID=response.ID FOR JSON PATH,WITHOUT_ARRAY_WRAPPER) END LoadPlanJSON,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN response.ResponsePalletSize END ResponsePalletSize,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN (SELECT p.ID,p.ContainerID,JSON_QUERY(p.Inputs) Inputs,JSON_QUERY(JSON_MODIFY(JSON_MODIFY(p.Result,'$.pallet_layer',NULL),'$.container_layer',NULL)) Result,COALESCE(JSON_VALUE(p.Result,'$.ContainerCode'),c.Code) Code FROM dbo.ResponseContainerLoadPlan m JOIN dbo.ContainerLoadPlan p ON p.ID=m.PlanID AND p.ItemID=m.ItemID AND p.ContainerID=m.ContainerID JOIN dbo.ContainerTypeMaster c ON c.ID=m.ContainerID WHERE m.ItemID=response.ID FOR JSON PATH) END ContainerPlansJSON,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN {layer_sql('response')} END LayerTareJSON,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN (SELECT JSON_MODIFY(s.SnapshotJSON,'$.ID',s.ID) FROM dbo.PalletPricingSnapshot s WHERE s.ID=response.PalletPricingID AND s.ItemID=response.ID) END PalletPricingJSON,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN response.ResponsePalletStacking END ResponsePalletStacking,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN response.ResponseMaxPalletHeightMM END ResponseMaxPalletHeightMM,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN response.HeightMM END HeightMM,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN response.ThirdPMType END ThirdPMType,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN response.ThirdPMMOQ END ThirdPMMOQ,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN response.UnitsPerTertiary END UnitsPerTertiary,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN response.NutDensity END NutDensity,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN response.UsedVolumeML END UsedVolumeML,
            response.ProductMixSnapshot,response.ShipmentContainerSizeFT,
            CAST(CASE WHEN i.ParentItemID IS NULL AND mix.ParentItemID IS NOT NULL THEN 1 ELSE 0 END AS BIT) IsMixParent,
            CASE WHEN i.ParentItemID IS NULL AND (@CanReadDraft=1 OR x.PackagingResponseStage='Approved') THEN
              (SELECT child.ID ItemID,child_oi.ProductID,child_oi.MixUnitQuantity UnitQuantity,child.WeightGrams,
                CASE WHEN @CanReadDraft=1 OR child.Stage='Approved' THEN child.ResponseLayerCount END ResponseLayerCount,
                child.RequestedLayerCount,
                CASE WHEN @CanReadDraft=1 OR child.Stage='Approved' THEN child.UnitsPerCarton END UnitsPerCarton,
                CASE WHEN @CanReadDraft=1 OR child.Stage='Approved' THEN child.UnitsPerTertiary END UnitsPerTertiary,
                CASE WHEN @CanReadDraft=1 OR child.Stage='Approved' THEN {layer_sql('child')} END LayerTareJSON,
                CASE WHEN @CanReadDraft=1 OR child.Stage='Approved' THEN COALESCE(child.ApplicableNetWeightGrams,child.WeightGrams) END ApplicableNetWeightGrams,
                CASE WHEN @CanReadDraft=1 OR child.Stage='Approved' THEN CONVERT(VARCHAR(40),child.NutDensity) END NutDensity
               FROM dbo.PackagingConfigurationRequestItem child JOIN dbo.OpportunityItem child_oi ON child_oi.ID=child.OpportunityItemID
               WHERE child.RequestID=response.RequestID AND child_oi.ParentItemID=i.ID FOR JSON PATH,INCLUDE_NULL_VALUES)
            END MixResponseChildren,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN response.LayersPerContainer END LayersPerContainer,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN response.PalletsPerContainer END PalletsPerContainer,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN response.CartonsPerContainerFloor END CartonsPerContainerFloor,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN primary_pricing.UnitPrice END PrimaryPricePerUnit,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN primary_pricing.CurrencyCode END PrimaryPriceCurrencyCode,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN secondary_pricing.UnitPrice END SecondaryPricePerUnit,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN secondary_pricing.CurrencyCode END SecondaryPriceCurrencyCode,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN tertiary_pricing.UnitPrice END TertiaryPricePerUnit,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN tertiary_pricing.CurrencyCode END TertiaryPriceCurrencyCode,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN primary_pricing.SnapshotJSON END PrimaryLayerPricingSnapshot,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN secondary_pricing.SnapshotJSON END SecondaryLayerPricingSnapshot,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN tertiary_pricing.SnapshotJSON END TertiaryLayerPricingSnapshot,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN
              CASE COALESCE(response.ResponseLayerCount,response.RequestedLayerCount) WHEN 1 THEN primary_pricing.SnapshotJSON
                WHEN 2 THEN secondary_pricing.SnapshotJSON ELSE tertiary_pricing.SnapshotJSON END END FinalLayerPricingSnapshot,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN efficiency_pallet.PalletAreaMM2 END EfficiencyPalletAreaMM2,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN 1 ELSE 0 END PackingWayVisible,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN response.WeightGrams END PackingProductWeight,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN COALESCE(response.ApplicableNetWeightGrams,response.WeightGrams) END ApplicableNetWeightGrams,
            response.RequestedLayerCount PackingRequestedLayers,response.ConfigurationRequest PackingConfiguration,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN x.FirstPMType END FirstPMType,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN x.SecondPMType END SecondPMType,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN x.UnitsPerCarton END UnitsPerCarton,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN x.PackagingDescription END PackagingDescription,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN x.FirstPMMOQ END FirstPMMOQ,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN x.SecondPMMOQ END SecondPMMOQ,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN x.PalletType END PalletType,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN x.CartonsPerLayer END CartonsPerLayer,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN x.LayersPerPallet END LayersPerPallet,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN x.PacksPerPallet END PacksPerPallet,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN x.CartonsPerContainer END CartonsPerContainer,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN x.PMCost END PMCost,
            CASE WHEN @CanReadDraft=1 OR x.PackagingResponseStage='Approved' THEN (SELECT CurrencyCode FROM dbo.Currency WHERE ID=x.PMCostCurrencyID) END PMCostCurrencyCode
        FROM PageHeaders h LEFT JOIN dbo.OpportunityItem i ON i.OpportunityID=h.OpportunityID
        LEFT JOIN dbo.Product p ON p.ID=i.ProductID
        LEFT JOIN dbo.OpportunityMixSnapshot mix ON mix.ParentItemID=COALESCE(i.ParentItemID,i.ID)
        LEFT JOIN dbo.v_OpportunityItemPackaging x ON x.OpportunityItemID=i.ID LEFT JOIN dbo.OpportunityItem logistics ON logistics.ID=COALESCE(i.ParentItemID,i.ID)
        LEFT JOIN dbo.PortOfEntry port_entry ON port_entry.ID=TRY_CONVERT(INT,JSON_VALUE(logistics.ShipmentCostInfo,'$.PortOfEntryID'))
        LEFT JOIN dbo.PackagingConfigurationRequestItem response ON response.ID=x.PackagingRequestItemID
        LEFT JOIN dbo.PackagingConfigurationRequestItem parent_container ON parent_container.RequestID=response.RequestID AND parent_container.OpportunityItemID=i.ParentItemID
        LEFT JOIN dbo.PkgPricingMaster primary_pricing ON primary_pricing.RequestItemID=response.ID AND primary_pricing.PackagingOrder='Primary' AND primary_pricing.IsCurrent=1
        LEFT JOIN dbo.PkgPricingMaster secondary_pricing ON secondary_pricing.RequestItemID=response.ID AND secondary_pricing.PackagingOrder='Secondary' AND secondary_pricing.IsCurrent=1
        LEFT JOIN dbo.PkgPricingMaster tertiary_pricing ON tertiary_pricing.RequestItemID=response.ID AND tertiary_pricing.PackagingOrder='Tertiary' AND tertiary_pricing.IsCurrent=1
        OUTER APPLY(SELECT TOP(1) p.PalletAreaMM2 FROM dbo.v_PalletSizeChoice p JOIN dbo.UoM u ON u.ID=p.UoMID
          WHERE p.PalletSize=response.ResponsePalletSize AND p.Status='Active' AND u.Status='Active' ORDER BY p.ID) efficiency_pallet
        LEFT JOIN dbo.PackagingConfigurationRequestItem active_request
            ON active_request.OpportunityItemID=i.ID AND active_request.IsOpen=1
        OUTER APPLY(SELECT TOP(1) r.Stage,h.RequestNumber,u.UserName PIC,r.CreatedAt,
            r.SubmittedAt,r.ReviewedAt,
            COALESCE((SELECT TOP(1) NULLIF(a.Reason,N'') FROM dbo.PackagingRequestChangeLog a
                WHERE a.RequestID=r.RequestID AND a.ItemID=r.ID AND a.FieldName='Stage'
                AND a.NewValue=r.Stage ORDER BY a.ID DESC),r.ManagerComment) ManagerComment
            FROM dbo.PackagingConfigurationRequestItem r
            JOIN dbo.PackagingConfigurationRequest h ON h.ID=r.RequestID
            LEFT JOIN dbo.Users u ON u.ID=r.PICUserID
            WHERE r.OpportunityItemID=i.ID ORDER BY r.IsOpen DESC,r.ID DESC) stage_request
        LEFT JOIN dbo.PackagingConfigurationRequest request_header ON request_header.ID=active_request.RequestID
        ORDER BY h.SortPosition,COALESCE(i.ParentItemID,i.ID),COALESCE(i.MixChildNumber,0);
        SELECT COUNT(*) Total FROM dbo.Opportunity o JOIN dbo.Customer c ON c.ID=o.CustomerID WHERE {where};
    """, [username, username, *params, (page-1)*page_size, page_size, *params])
    for row in result[0]:
        row["StageSummaryJSON"] = stage_summary(row)
        row.update(shipment_columns(row))
        # Responses use the immutable request product/configuration snapshot, not current product weight.
        visible=row.pop("PackingWayVisible",False)
        weight=row.pop("PackingProductWeight",None)
        layers=row.pop("PackingRequestedLayers",None)
        configuration=row.pop("PackingConfiguration",None)
        values=packing_way({**row,"WeightGrams":weight,"RequestedLayerCount":layers,"ConfigurationRequest":configuration})
        from container_loading import container_results
        values["ContainerLoadResults"]=container_results({**row,"WeightGrams":weight,"RequestedLayerCount":layers,"ConfigurationRequest":configuration})
        values.update(response_derived({**row,"RequestedLayerCount":layers}, values))
        row.pop("FinalLayerPricingSnapshot",None)
        for order in ("Primary","Secondary","Tertiary"):
            row.pop(order+"LayerPricingSnapshot",None)
        row.pop("EfficiencyPalletAreaMM2",None)
        row.update(values if visible else {key:None for key in values})
    return {"rows": complete_stage_summaries(add_tcb_columns(result[0])), "total": result[1][0]["Total"], "page": page, "page_size": page_size}
