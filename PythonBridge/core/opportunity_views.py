"""Allow-listed Opportunity views: sort headers before expanding item rows."""
import json
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from master_models import MasterSort, ColumnWidth
from packaging_api import execute

HEADER_COLUMNS = {"OpportunityNumber", "CustomerName", "OpportunityDesc", "BidOpen", "BidClose", "HeaderStage", "ItemCount", "CustomerCurrencyCode", "ExchangeRateVNDPerUSD", "ExchangeRateCustomerCurrencyPerUSD"}
from packaging_fields import OPPORTUNITYITEM_FIELDS, PACKAGINGCONFIGURATIONREQUESTITEM_FIELDS
ITEM_COLUMNS = {"ProductCode", "ItemDescription", "AnnualUnit", "EstPctAwarded", "ShelfPrice", "ItemStage", "ProductName", "WeightGrams", "Category", "Grade", "MixRatioPct", "PMCost", "PMCostCurrencyCode", "PackagingRequestNumber", "PackagingResponseStage", *OPPORTUNITYITEM_FIELDS, *PACKAGINGCONFIGURATIONREQUESTITEM_FIELDS}

class OpportunityView(BaseModel):
    column_widths: dict[str, ColumnWidth] = Field(default_factory=dict,max_length=64)
    model_config = ConfigDict(extra="forbid")
    columns: list[str] = Field(min_length=1, max_length=644)
    sort: list[MasterSort] = Field(default_factory=list, max_length=644)
    filters: list[str] | None = Field(None, max_length=5)
    values: dict[str, str] = Field(default_factory=dict, max_length=5)
    field_version: int = Field(1, ge=1, le=3)
    prefix_columns: list[str] | None = Field(None, max_length=64)

def validate_view(view, allowed):
    if allowed == HEADER_COLUMNS:
        mapping={"CurrencyCode":"CustomerCurrencyCode","ExchangeRateToVND":"ExchangeRateVNDPerUSD"}
        view.columns=list(dict.fromkeys(mapping.get(k,k) for k in view.columns))
        for rule in view.sort: rule.column=mapping.get(rule.column,rule.column)
    if any(k not in allowed and not (allowed==HEADER_COLUMNS and k=="_Actions") for k in view.column_widths):raise ValueError("Invalid column width key.")
    if view.prefix_columns is not None:
        if allowed != ITEM_COLUMNS or len(view.prefix_columns) != len(set(view.prefix_columns)) or any(c not in ITEM_COLUMNS for c in view.prefix_columns):
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
                (SELECT COUNT(*) FROM dbo.OpportunityItem i WHERE i.OpportunityID=o.ID) ItemCount
            FROM dbo.Opportunity o JOIN dbo.Customer c ON c.ID=o.CustomerID WHERE {where}
        ), Ranked AS (
            SELECT *,ROW_NUMBER() OVER(ORDER BY {order}) SortPosition FROM Headers
        ), PageHeaders AS (
            SELECT * FROM Ranked ORDER BY SortPosition OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
        )
        SELECT h.*,i.ID ItemID,i.ProductID,p.ProductCode,p.ProductName,p.WeightGrams,i.ItemDescription,i.AnnualUnit,
            i.EstPctAwarded,i.ShelfPrice,i.Stage ItemStage,i.RowVersion ItemRowVersion,
            CAST(CASE WHEN active_request.ID IS NULL THEN 0 ELSE 1 END AS BIT) HasOpenPackagingRequest,
            request_header.RequestNumber AS OpenPackagingRequestNumber,
            active_request.Stage AS OpenPackagingRequestStage,
            x.Category,x.Grade,x.MixRatioPct,x.PalletSize,x.PalletStacking,x.MaxPalletHeightM,x.ContainerRequest,x.ConfigurationRequest,x.PackagingType,x.RecyclableRequirement,x.RecycledContent,x.Transparency,x.MetalizedAluminum,x.BarrierRequirement,x.ShelfLifeDays,x.SpecialComments,
            x.PackagingRequestNumber,x.PackagingResponseStage,
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
        LEFT JOIN dbo.v_OpportunityItemPackaging x ON x.OpportunityItemID=i.ID
        LEFT JOIN dbo.PackagingConfigurationRequestItem active_request
            ON active_request.OpportunityItemID=i.ID AND active_request.IsOpen=1
        LEFT JOIN dbo.PackagingConfigurationRequest request_header ON request_header.ID=active_request.RequestID
        ORDER BY h.SortPosition,i.ID;
        SELECT COUNT(*) Total FROM dbo.Opportunity o JOIN dbo.Customer c ON c.ID=o.CustomerID WHERE {where};
    """, [username, username, *params, (page-1)*page_size, page_size, *params])
    return {"rows": result[0], "total": result[1][0]["Total"], "page": page, "page_size": page_size}
