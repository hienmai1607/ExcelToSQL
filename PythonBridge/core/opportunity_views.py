"""Allow-listed Opportunity views: sort headers before expanding item rows."""
import json
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from master_models import MasterSort
from packaging_api import execute

HEADER_COLUMNS = {"OpportunityNumber", "CustomerName", "OpportunityDesc", "BidOpen", "BidClose", "HeaderStage", "ItemCount"}
ITEM_COLUMNS = {"ProductCode", "ItemDescription", "AnnualUnit", "EstPctAwarded", "ShelfPrice", "ItemStage"}

class OpportunityView(BaseModel):
    model_config = ConfigDict(extra="forbid")
    columns: list[str] = Field(min_length=1, max_length=7)
    sort: list[MasterSort] = Field(default_factory=list, max_length=7)
    filters: list[str] | None = Field(None, max_length=5)
    values: dict[str, str] = Field(default_factory=dict, max_length=5)

def validate_view(view, allowed):
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
        if not isinstance(data, list) or len(data) > 7:
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
        ;WITH Headers AS (
            SELECT o.ID OpportunityID,o.OpportunityNumber,o.CustomerID,c.CustomerName,
                o.OpportunityDesc,o.BidOpen,o.BidClose,o.Stage HeaderStage,o.RowVersion HeaderRowVersion,
                (SELECT COUNT(*) FROM dbo.OpportunityItem i WHERE i.OpportunityID=o.ID) ItemCount
            FROM dbo.Opportunity o JOIN dbo.Customer c ON c.ID=o.CustomerID WHERE {where}
        ), Ranked AS (
            SELECT *,ROW_NUMBER() OVER(ORDER BY {order}) SortPosition FROM Headers
        ), PageHeaders AS (
            SELECT * FROM Ranked ORDER BY SortPosition OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
        )
        SELECT h.*,i.ID ItemID,i.ProductID,p.ProductCode,i.ItemDescription,i.AnnualUnit,
            i.EstPctAwarded,i.ShelfPrice,i.Stage ItemStage,i.RowVersion ItemRowVersion,
            CAST(CASE WHEN active_request.ID IS NULL THEN 0 ELSE 1 END AS BIT) HasOpenPackagingRequest,
            request_header.RequestNumber AS OpenPackagingRequestNumber,
            active_request.Stage AS OpenPackagingRequestStage
        FROM PageHeaders h LEFT JOIN dbo.OpportunityItem i ON i.OpportunityID=h.OpportunityID
        LEFT JOIN dbo.Product p ON p.ID=i.ProductID
        LEFT JOIN dbo.PackagingConfigurationRequestItem active_request
            ON active_request.OpportunityItemID=i.ID AND active_request.IsOpen=1
        LEFT JOIN dbo.PackagingConfigurationRequest request_header ON request_header.ID=active_request.RequestID
        ORDER BY h.SortPosition,i.ID;
        SELECT COUNT(*) Total FROM dbo.Opportunity o JOIN dbo.Customer c ON c.ID=o.CustomerID WHERE {where};
    """, [username, *params, (page-1)*page_size, page_size, *params])
    return {"rows": result[0], "total": result[1][0]["Total"], "page": page, "page_size": page_size}
