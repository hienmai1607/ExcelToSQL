"""
schemas.py — request/response shapes for the two batch endpoints.

Field order in each *Row model matches the TVP column order in SQL
exactly, since db.py builds tuples positionally from these models.
If you add/reorder a column in the SQL type, update BOTH the SQL and
the corresponding tuple-building code in main.py together.
"""

from typing import Literal, Optional
from uuid import UUID
from pydantic import BaseModel, Field


class ProductRow(BaseModel):
    row_num: int = Field(..., alias="RowNum")
    command: Literal["C", "U", "D"] = Field(..., alias="Command")
    id: Optional[int] = Field(None, alias="ID")
    product_code: Optional[str] = Field(None, alias="ProductCode")
    product_name: Optional[str] = Field(None, alias="ProductName")
    weight_value: Optional[float] = Field(None, alias="WeightValue")
    weight_unit: Optional[Literal["g", "oz"]] = Field(None, alias="WeightUnit")
    status: Optional[Literal["Active", "Block"]] = Field(None, alias="Status")
    row_version: Optional[str] = Field(None, alias="RowVersion")  # base64

    class Config:
        populate_by_name = True


class ProductBatchRequest(BaseModel):
    rows: list[ProductRow] = Field(..., max_length=500)
    # username / is_admin intentionally NOT accepted from the client body —
    # see auth.py: they're derived server-side from the authenticated
    # request, never trusted from what Excel sends.


class OpportunityHeaderRow(BaseModel):
    row_num: int = Field(..., alias="RowNum")
    command: Literal["C", "U", "D"] = Field(..., alias="Command")
    id: Optional[int] = Field(None, alias="ID")
    opportunity_number: Optional[str] = Field(None, alias="OpportunityNumber")  # blank on Create
    customer_id: Optional[int] = Field(None, alias="CustomerID")
    opportunity_desc: Optional[str] = Field(None, alias="OpportunityDesc")
    bid_open: Optional[str] = Field(None, alias="BidOpen")     # 'YYYY-MM-DD'
    bid_close: Optional[str] = Field(None, alias="BidClose")   # 'YYYY-MM-DD'
    stage: Optional[str] = Field(None, alias="Stage")
    row_version: Optional[str] = Field(None, alias="RowVersion")

    class Config:
        populate_by_name = True


class OpportunityItemRow(BaseModel):
    row_num: int = Field(..., alias="RowNum")
    command: Literal["C", "U", "D"] = Field(..., alias="Command")
    id: Optional[int] = Field(None, alias="ID")
    opportunity_number: str = Field(..., alias="OpportunityNumber")  # links to header in this batch
    product_id: Optional[int] = Field(None, alias="ProductID")
    item_description: Optional[str] = Field(None, alias="ItemDescription")
    annual_unit: Optional[int] = Field(None, alias="AnnualUnit")
    est_pct_awarded: Optional[float] = Field(None, alias="EstPctAwarded")
    shelf_price: Optional[float] = Field(None, alias="ShelfPrice")
    stage: Optional[str] = Field(None, alias="Stage")
    row_version: Optional[str] = Field(None, alias="RowVersion")

    class Config:
        populate_by_name = True


class OpportunityBatchRequest(BaseModel):
    header_rows: list[OpportunityHeaderRow] = Field(..., max_length=500)
    item_rows: list[OpportunityItemRow] = Field(..., max_length=500)
    # username / is_admin: see note on ProductBatchRequest above.


class OpportunityStageTransitionRequest(BaseModel):
    """Workflow command issued by PowerApps, never by the Excel editor."""

    target_stage: str = Field(..., alias="TargetStage", min_length=1, max_length=20)
    expected_row_version: str = Field(..., alias="ExpectedRowVersion")
    reason: Optional[str] = Field(None, alias="Reason", max_length=500)
    request_id: UUID = Field(..., alias="RequestID")

    class Config:
        populate_by_name = True


class MarketRow(BaseModel):
    row_num: int = Field(..., alias="RowNum")
    command: Literal["C", "U", "D"] = Field(..., alias="Command")
    id: Optional[int] = Field(None, alias="ID")
    market_code: Optional[str] = Field(None, alias="MarketCode")
    market_name: Optional[str] = Field(None, alias="MarketName")
    row_version: Optional[str] = Field(None, alias="RowVersion")

    class Config:
        populate_by_name = True


class MarketBatchRequest(BaseModel):
    rows: list[MarketRow] = Field(..., max_length=500)


class CurrencyRow(BaseModel):
    row_num: int = Field(..., alias="RowNum")
    command: Literal["C", "U", "D"] = Field(..., alias="Command")
    id: Optional[int] = Field(None, alias="ID")
    currency_code: Optional[str] = Field(None, alias="CurrencyCode")
    currency_name: Optional[str] = Field(None, alias="CurrencyName")
    row_version: Optional[str] = Field(None, alias="RowVersion")

    class Config:
        populate_by_name = True


class CurrencyBatchRequest(BaseModel):
    rows: list[CurrencyRow] = Field(..., max_length=500)


class CustomerRow(BaseModel):
    row_num: int = Field(..., alias="RowNum")
    command: Literal["C", "U", "D"] = Field(..., alias="Command")
    id: Optional[int] = Field(None, alias="ID")
    customer_name: Optional[str] = Field(None, alias="CustomerName")
    market_id: Optional[int] = Field(None, alias="MarketID")
    currency_id: Optional[int] = Field(None, alias="CurrencyID")
    status: Optional[Literal["Active", "Block"]] = Field(None, alias="Status")
    row_version: Optional[str] = Field(None, alias="RowVersion")

    class Config:
        populate_by_name = True


class CustomerBatchRequest(BaseModel):
    rows: list[CustomerRow] = Field(..., max_length=500)


class UserRow(BaseModel):
    row_num: int = Field(..., alias="RowNum")
    command: Literal["C", "U", "D"] = Field(..., alias="Command")
    id: Optional[int] = Field(None, alias="ID")
    username: Optional[str] = Field(None, alias="UserName")
    is_active: Optional[bool] = Field(None, alias="IsActive")
    row_version: Optional[str] = Field(None, alias="RowVersion")

    class Config:
        populate_by_name = True


class UserBatchRequest(BaseModel):
    rows: list[UserRow] = Field(..., max_length=500)


class UserAccessRow(BaseModel):
    row_num: int = Field(..., alias="RowNum")
    command: Literal["C", "U", "D"] = Field(..., alias="Command")
    access_id: Optional[int] = Field(None, alias="AccessID")
    user_id: Optional[int] = Field(None, alias="UserID")
    scope: Optional[Literal["Admin", "Customer", "Product", "Opportunity"]] = Field(None, alias="Scope")
    row_version: Optional[str] = Field(None, alias="RowVersion")

    class Config:
        populate_by_name = True


class UserAccessBatchRequest(BaseModel):
    rows: list[UserAccessRow] = Field(..., max_length=500)
