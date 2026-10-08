"""Authenticated, per-user workspace preferences and safe snapshot XLSX export."""
import io
import json
import re
from typing import Literal
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from customer_sort import SortRule, unique_sort
from shared_master_views import check_shared_layout
from master_models import Entity, MasterLayout, check_layout, ColumnWidth
from opportunity_views import OpportunityViews
from request_views import RequestViews
from pallet_fields import PALLET_CAPACITY_LABELS
from auth import AccessContext, get_access_context
from db import get_raw_cursor
from packaging_api import require

router = APIRouter(prefix="/api/workbench", tags=["Workbench"])
Column = Literal["CustomerName", "MarketCode", "CurrencyCode", "Status", "UpdatedAt", "CreatedAt", "CreatedByName", "UpdatedByName"]
Filter = Literal["customer_name", "market_id", "status", "currency_id", "created_by"]

class ListLayout(BaseModel):
    model_config = ConfigDict(extra="forbid")
    page_size: int = Field(25, ge=1, le=500, strict=True)


class Settings(BaseModel):
    list_layouts: dict[Literal["unit-conversions", "packaging-dimensions"], ListLayout] = Field(default_factory=dict)
    column_widths: dict[Column | Literal["_Actions"], ColumnWidth] = Field(default_factory=dict,max_length=9)
    requests: RequestViews = Field(default_factory=RequestViews)
    opportunity: OpportunityViews = Field(default_factory=OpportunityViews)
    shared_masters: dict[Literal["loss-processes","ports"], MasterLayout] = Field(default_factory=dict)
    @field_validator("shared_masters")
    @classmethod
    def validate_shared_layouts(cls, layouts):
        for entity, layout in layouts.items():
            check_shared_layout(entity,layout)
        return layouts
    masters: dict[Entity, MasterLayout] = Field(default_factory=dict)
    @field_validator("masters")
    @classmethod
    def validate_master_layouts(cls, layouts):
        for entity, layout in layouts.items():
            check_layout(entity, layout)
        return layouts
    sort: list[SortRule] = Field(default_factory=lambda: [SortRule(column="CustomerName")], max_length=8)
    @field_validator("sort")
    @classmethod
    def validate_sort(cls, rules):
        return unique_sort(rules)
    model_config = ConfigDict(extra="forbid")
    columns: list[Column] = Field(default_factory=lambda: ["CustomerName","MarketCode","CurrencyCode","Status","UpdatedAt"], min_length=1, max_length=8)
    filters: list[Filter] = Field(default_factory=lambda: ["customer_name","market_id","status"], max_length=5)
    customer_name: str = Field("", max_length=200)
    market_id: str = Field("", pattern=r"^(|[1-9][0-9]{0,9})$")
    currency_id: str = Field("", pattern=r"^(|[1-9][0-9]{0,9})$")
    created_by: str = Field("", pattern=r"^(|[1-9][0-9]{0,9})$")
    status: Literal["", "Active", "Block"] = ""
    page_size: int = Field(25, ge=1, le=500)
    dark: bool = False
    nav_hidden: bool = False

class PreferenceWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    settings: Settings
    version: int = Field(ge=0)

@router.get("/preferences")
def read_preferences(ctx: AccessContext = Depends(get_access_context)):
    with get_raw_cursor() as cur:
        cur.execute("SELECT Settings,Version FROM dbo.WorkbenchPreference WHERE UserID=? AND PreferenceKey='workspace'", ctx.user_id)
        row = cur.fetchone()
    return {"settings": Settings.model_validate_json(row[0]).model_dump() if row else Settings().model_dump(), "version": row[1] if row else 0}

@router.post("/preferences")
def save_preferences(body: PreferenceWrite, ctx: AccessContext = Depends(get_access_context)):
    # Serializable key-range lock makes first-write races safe; version prevents lost updates.
    with get_raw_cursor() as cur:
        # The shared engine uses AUTOCOMMIT: connection.commit() is insufficient.
        cur.execute("SET XACT_ABORT ON; BEGIN TRANSACTION;")
        try:
            cur.execute("SELECT Version FROM dbo.WorkbenchPreference WITH(UPDLOCK,HOLDLOCK) WHERE UserID=? AND PreferenceKey='workspace'", ctx.user_id)
            row = cur.fetchone()
            if (row[0] if row else 0) != body.version:
                raise HTTPException(409, "Your profile changed in another window. Reload profile before saving.")
            encoded = body.settings.model_dump_json()
            if row:
                cur.execute("UPDATE dbo.WorkbenchPreference SET Settings=?,Version=Version+1,UpdatedAt=SYSUTCDATETIME() WHERE UserID=? AND PreferenceKey='workspace'", encoded, ctx.user_id)
            else:
                cur.execute("INSERT dbo.WorkbenchPreference(UserID,PreferenceKey,Settings) VALUES(?,'workspace',?)", ctx.user_id, encoded)
            cur.execute("COMMIT TRANSACTION;")
        except Exception:
            cur.execute("IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;")
            raise
    return {"settings": body.settings.model_dump(), "version": body.version+1}

class ExportSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    columns: list[Column] = Field(min_length=1, max_length=8)
    rows: list[list[str | None]] = Field(max_length=500)

LABELS = {"CustomerName":"Customer","MarketCode":"Market","CurrencyCode":"Currency","Status":"Status","UpdatedAt":"Last updated","CreatedAt":"Created at","CreatedByName":"Created by","UpdatedByName":"Updated by"}

def snapshot_xlsx(body, labels=None, sheet_name="Customers") -> bytes:
    rows = [[(labels or LABELS)[key] for key in body.columns], *body.rows]
    xml_rows = []
    for number, values in enumerate(rows, 1):
        if len(values) != len(body.columns) or any(v is not None and len(v)>1000 for v in values):
            raise HTTPException(422, "Invalid export row size.")
        cells = []
        for i, value in enumerate(values):
            if value is None:
                continue
            numeric_columns={"TareWeight","Width","Length","PalletAreaMM2","BaseUnitPrice","BaseUnitUSDPrice","ConversionFactor","UnitPrice","UnitUSDPrice","ExchangeRateToUSD","WeightGrams","WeightOz","QuantityFrom","QuantityTo","SupplierDimensionID","SupplierD1","SupplierD2","SupplierD3","SupplierAreaPerPriceUnit",*PALLET_CAPACITY_LABELS}
            if number>1 and body.columns[i] in numeric_columns and re.fullmatch(r"-?\d+(?:\.\d+)?",value):
                cells.append(f'<c r="{chr(65+i)}{number}" t="n"><v>{value}</v></c>')
                continue
            # Inline strings, never formulas: =, +, -, @ remain literal text in Excel.
            value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", value)
            cells.append(f'<c r="{chr(65+i)}{number}" t="inlineStr"><is><t xml:space="preserve">{escape(value)}</t></is></c>')
        xml_rows.append(f'<row r="{number}">{"".join(cells)}</row>')
    output = io.BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        z.writestr("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Customers" sheetId="1" r:id="rId1"/></sheets></workbook>'.replace('name="Customers"', 'name="'+escape(sheet_name)+'"'))
        z.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="14" width="24" customWidth="1"/></cols><sheetData>'+''.join(xml_rows)+'</sheetData><autoFilter ref="A1:'+chr(64+len(body.columns))+str(len(rows))+'"/></worksheet>')
    return output.getvalue()

@router.post("/customers/export")
def export_customers(body: ExportSnapshot, ctx: AccessContext = Depends(get_access_context)):
    require(ctx, "Customer")
    return Response(snapshot_xlsx(body), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": 'attachment; filename="Customers-current-view.xlsx"', "Cache-Control":"no-store"})
