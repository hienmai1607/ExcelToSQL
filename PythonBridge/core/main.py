from administrator_api import router as administrator_router
"""
main.py — Product and Opportunity batch endpoints.

Run with: uvicorn main:app --host 0.0.0.0 --port 8000
"""

import logging
import time
import uuid
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from opportunity_changes_api import router as opportunity_changes_router
from packaging_changes_api import router as packaging_changes_router
from product_excel_api import router as product_excel_router
from product_grades_api import router as product_grades_router
from product_mix_api import router as product_mix_router
from opportunity_excel_api import router as opportunity_excel_router
from packaging_excel_api import router as packaging_excel_router
from packaging_master_excel_api import router as packaging_master_excel_router
from workbench_api import router as workbench_router
from packaging_master_api import router as packaging_master_router
from raw_material_api import router as raw_material_router
from unit_conversion_api import router as unit_conversion_router
from pallet_api import router as pallet_router
from packaging_dimension_api import router as packaging_dimension_router
from pkg_pricing_api import router as pkg_pricing_router
from packaging_type_api import router as packaging_type_router
from tcb_api import router as tcb_router
from loss_process_api import router as loss_process_router
from customer_sort import parse_sort
from ports_api import router as ports_router, opportunity_shipment_lookups; from category_api import router as category_router
from opportunity_views import sorted_grid
from packaging_fields import enriched_batch
from preferences_api import router as preferences_router
from attachments_api import router as attachments_router

from fastapi import FastAPI, Depends, Query, HTTPException, Request

from auth import get_current_username, get_is_admin, get_user_scopes
from db import (
    run_generic_batch, run_header_detail_batch, run_read_query,
    b64_to_bytes, bytes_to_b64, safe_id, safe_text, safe_pct_awarded, safe_shelf_price,
    safe_weight_value, check_database,
)
from cache import cached, invalidate
from packaging_api import router as packaging_router
from schemas import (
    ProductBatchRequest,
    OpportunityBatchRequest,
    OpportunityStageTransitionRequest,
    MarketBatchRequest,
    CurrencyBatchRequest,
    CustomerBatchRequest,
    UserBatchRequest,
    UserAccessBatchRequest,
)

app = FastAPI(title="Opportunity/Product Bridge API")
app.include_router(administrator_router)
app.include_router(opportunity_changes_router)
app.include_router(packaging_changes_router)
app.include_router(product_excel_router)
app.include_router(product_grades_router)
from opportunity_grade_snapshot import router as opportunity_grade_snapshot_router
app.include_router(opportunity_grade_snapshot_router)
app.include_router(product_mix_router)
app.include_router(opportunity_excel_router)
app.include_router(packaging_excel_router)
app.include_router(packaging_master_excel_router)
app.include_router(packaging_router)
app.include_router(workbench_router)
app.include_router(unit_conversion_router)
app.include_router(pallet_router)
app.include_router(packaging_dimension_router)
app.include_router(pkg_pricing_router)
app.include_router(packaging_type_router)
app.include_router(raw_material_router)
app.include_router(packaging_master_router)
app.include_router(preferences_router)
app.include_router(attachments_router)
app.include_router(ports_router); app.include_router(category_router)
app.include_router(tcb_router)
app.include_router(loss_process_router)
_web_dist = Path(__file__).resolve().parents[1] / "webapp" / "dist"
if _web_dist.is_dir():
    app.mount("/workbench", StaticFiles(directory=str(_web_dist), html=True), name="workbench")
logger = logging.getLogger("python_bridge")
BRIDGE_CONTRACT_VERSION = "2"


@app.get("/health/live", include_in_schema=False)
def health_live() -> dict[str, str]:
    return {"status": "live", "contract": BRIDGE_CONTRACT_VERSION}


@app.get("/health/ready", include_in_schema=False)
def health_ready() -> dict[str, str]:
    try:
        check_database()
    except Exception as exc:
        logger.exception("database_readiness_failed")
        raise HTTPException(status_code=503, detail="Database is not ready.") from exc
    return {"status": "ready", "database": "ready", "contract": BRIDGE_CONTRACT_VERSION}



@app.middleware("http")
async def workspace_permissions(request: Request, call_next):
 if request.url.path.startswith("/api/"):
  from starlette.concurrency import run_in_threadpool
  from fastapi.responses import JSONResponse
  from auth import get_access_context
  from workspace_access import enforce_route
  try:
   ctx=await run_in_threadpool(get_access_context,request,
    request.headers.get("X-User-Name"),request.headers.get("X-Authenticated-User"),request.headers.get("X-Proxy-Secret"))
   request.state.bridge_access=ctx
   enforce_route(ctx,request.url.path,request.method)
  except HTTPException as exc:
   return JSONResponse({"detail":exc.detail},status_code=exc.status_code)
 return await call_next(request)

@app.middleware("http")
async def request_metrics(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("request_failed id=%s method=%s path=%s", request_id, request.method, request.url.path)
        raise
    duration_ms = (time.perf_counter() - started) * 1000
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Bridge-Contract"] = BRIDGE_CONTRACT_VERSION
    logger.info(
        "request_complete id=%s method=%s path=%s status=%s duration_ms=%.1f",
        request_id, request.method, request.url.path, response.status_code, duration_ms,
    )
    return response


def _require_admin(is_admin: bool) -> None:
    if not is_admin:
        raise HTTPException(status_code=403, detail="Admin access is required for this action.")


def _require_scope(is_admin: bool, scopes: frozenset[str], scope: str, *read_scopes: str) -> None:
    if is_admin:
        return
    if not scopes.intersection((scope, *read_scopes)):
        raise HTTPException(status_code=403, detail=f"{scope} access is required for this action.")


def _run_admin_master_batch(
    proc_name: str,
    rows: list[tuple],
    username: str,
    is_admin: bool,
    invalidate_keys: tuple[str, ...] = (),
) -> dict:
    """Shared Admin Master write interface and result normalization."""
    _require_admin(is_admin)
    results = _encode_row_versions(
        run_generic_batch(proc_name, rows, [username, int(is_admin)])
    )
    if any(row.get("Status") == "OK" for row in results):
        for key in invalidate_keys:
            invalidate(key)
    return {"results": results}


def _run_user_master_batch(
    scope: str,
    proc_name: str,
    rows: list[tuple],
    username: str,
    is_admin: bool,
    scopes: frozenset[str],
    invalidate_keys: tuple[str, ...] = (),
) -> dict:
    """Shared Customer/Product write interface; SQL rechecks live scope."""
    _require_scope(is_admin, scopes, scope)
    results = _encode_row_versions(
        run_generic_batch(proc_name, rows, [username, int(is_admin)])
    )
    if any(row.get("Status") == "OK" for row in results):
        for key in invalidate_keys:
            invalidate(key)
    return {"results": results}


@app.post("/api/user/batch")
def user_batch(payload: UserBatchRequest, username: str = Depends(get_current_username), is_admin: bool = Depends(get_is_admin)):
    rows = [
        (
            r.row_num, r.command, safe_id(r.id), safe_text(r.username),
            True if r.is_active is None else r.is_active,
            b64_to_bytes(r.row_version),
        )
        for r in payload.rows
    ]
    return _run_admin_master_batch("dbo.usp_User_Batch", rows, username, is_admin)


@app.post("/api/user-access/batch")
def user_access_batch(payload: UserAccessBatchRequest, username: str = Depends(get_current_username), is_admin: bool = Depends(get_is_admin)):
    rows = [(r.row_num, r.command, safe_id(r.access_id), safe_id(r.user_id), safe_text(r.scope), b64_to_bytes(r.row_version)) for r in payload.rows]
    return _run_admin_master_batch("dbo.usp_UserAccess_Batch", rows, username, is_admin)


@app.get("/api/user")
def user_read(
    username: str = Depends(get_current_username),
    is_admin: bool = Depends(get_is_admin),
):
    _require_admin(is_admin)
    return {"rows": _encode_row_versions(run_read_query("dbo.usp_User_Read", [username]))}


@app.get("/api/user-access")
def user_access_read(
    username: str = Depends(get_current_username),
    is_admin: bool = Depends(get_is_admin),
):
    _require_admin(is_admin)
    return {"rows": _encode_row_versions(run_read_query("dbo.usp_UserAccess_Read", [username]))}


# --- Product -------------------------------------------------------------

@app.post("/api/product/batch")
def product_batch(
    payload: ProductBatchRequest,
    username: str = Depends(get_current_username),
    is_admin: bool = Depends(get_is_admin),
    scopes: frozenset[str] = Depends(get_user_scopes),
):
    tvp_rows = [
        (
            r.row_num,
            r.command,
            safe_id(r.id),
            safe_text(r.product_code),
            safe_text(r.product_name),
            safe_weight_value(r.weight_value),
            safe_text(r.weight_unit),
            safe_text(r.status),
            b64_to_bytes(r.row_version),
        )
        for r in payload.rows
    ]

    _require_scope(is_admin, scopes, "Product")
    results = []
    # Product master retains independent row outcomes.
    for model, values in zip(payload.rows, tvp_rows):
        result = enriched_batch("dbo.usp_Product_Batch", [[values]], [username,int(is_admin),model.customer_id,model.is_mix], [[model]], ["Product"])[0]
        results.extend(result)
    if any(r.get("Status") == "OK" for r in results):
        invalidate("opportunity_master_lookups")
    return {"results": _encode_row_versions(results)}

# --- Opportunity (+ Items) ------------------------------------------------

@app.post("/api/opportunity/batch")
def opportunity_batch(
    payload: OpportunityBatchRequest,
    username: str = Depends(get_current_username),
    is_admin: bool = Depends(get_is_admin),
    scopes: frozenset[str] = Depends(get_user_scopes),
):
    _require_scope(is_admin, scopes, "Opportunity")
    header_tvp_rows = [
        (
            r.row_num,
            r.command,
            safe_id(r.id),
            safe_text(r.opportunity_number),
            r.customer_id,
            safe_text(r.opportunity_desc),
            r.bid_open,   # 'YYYY-MM-DD' string — pyodbc/ODBC driver parses this to DATE
            r.bid_close,
            "Draft",     # workflow stage is application-controlled; Excel is draft-only
            b64_to_bytes(r.row_version),
        )
        for r in payload.header_rows
    ]

    item_tvp_rows = [
        (
            r.row_num,
            r.command,
            safe_id(r.id),
            safe_text(r.opportunity_number),
            r.product_id,
            safe_text(r.item_description),
            r.annual_unit,
            safe_pct_awarded(r.est_pct_awarded),
            safe_shelf_price(r.shelf_price),
            "Draft",     # workflow stage is application-controlled; Excel is draft-only
            b64_to_bytes(r.row_version),
        )
        for r in payload.item_rows
    ]

    # One SQL transaction per business document. A bad line in Opportunity B
    # must not roll back an unrelated Opportunity A saved in the same click.
    documents: dict[str, dict[str, list[tuple]]] = {}
    for row in header_tvp_rows:
        number = str(row[3] or "").strip().upper()
        key = f"NUMBER:{number}" if number else f"HEADER-ROW:{row[0]}"
        documents.setdefault(key, {"headers": [], "items": []})["headers"].append(row)
    for row in item_tvp_rows:
        number = str(row[3] or "").strip().upper()
        key = f"NUMBER:{number}" if number else f"ITEM-ROW:{row[0]}"
        documents.setdefault(key, {"headers": [], "items": []})["items"].append(row)

    header_results: list[dict] = []
    item_results: list[dict] = []
    for document in documents.values():
        header_nums={r[0] for r in document["headers"]}
        item_nums={r[0] for r in document["items"]}
        document_headers, document_items = enriched_batch(
            "dbo.usp_Opportunity_HeaderDetail_Batch",
            [document["headers"],document["items"]], [username,int(is_admin)],
            [[r for r in payload.header_rows if r.row_num in header_nums],
             [r for r in payload.item_rows if r.row_num in item_nums]],
            ["Opportunity","OpportunityItem"],
        )
        header_results.extend(document_headers)
        item_results.extend(document_items)

    header_results.sort(key=lambda row: row.get("RowNum", 0))
    item_results.sort(key=lambda row: row.get("RowNum", 0))

    for row in header_results:
        if row.get("NewRowVersion") is not None:
            row["NewRowVersion"] = bytes_to_b64(row["NewRowVersion"])
    for row in item_results:
        if row.get("NewRowVersion") is not None:
            row["NewRowVersion"] = bytes_to_b64(row["NewRowVersion"])

    return {"header_results": header_results, "item_results": item_results}


def _run_opportunity_transition(
    proc_name: str,
    entity_id: int,
    payload: OpportunityStageTransitionRequest,
    username: str,
    is_admin: bool,
    scopes: frozenset[str],
) -> dict:
    """Shared workflow interface for application-controlled stage changes."""
    _require_scope(is_admin, scopes, "Opportunity")
    try:
        rows = run_read_query(
            proc_name,
            [
                entity_id,
                payload.target_stage,
                b64_to_bytes(payload.expected_row_version),
                payload.reason,
                str(payload.request_id),
                username,
            ],
        )
    except Exception as exc:
        message = str(exc)
        if "52720" in message or "52730" in message:
            raise HTTPException(status_code=403, detail="Opportunity access is required for this action.") from exc
        if "52721" in message or "52731" in message:
            raise HTTPException(status_code=409, detail="Concurrency conflict or row not found; refresh and retry.") from exc
        if any(code in message for code in ("52722", "52723", "52732", "52733")):
            detail = message.split("[Microsoft][ODBC Driver", 1)[0].strip() or "Invalid workflow transition."
            raise HTTPException(status_code=422, detail=detail) from exc
        raise
    if not rows:
        raise HTTPException(status_code=500, detail="Workflow transition returned no result.")
    return {"result": _encode_row_versions(rows)[0]}


@app.post("/api/opportunity/{opportunity_id}/stage-transition")
def opportunity_header_stage_transition(
    opportunity_id: int,
    payload: OpportunityStageTransitionRequest,
    username: str = Depends(get_current_username),
    is_admin: bool = Depends(get_is_admin),
    scopes: frozenset[str] = Depends(get_user_scopes),
):
    return _run_opportunity_transition(
        "dbo.usp_Opportunity_HeaderStage_Transition",
        opportunity_id, payload, username, is_admin, scopes,
    )


@app.post("/api/opportunity/item/{item_id}/stage-transition")
def opportunity_item_stage_transition(
    item_id: int,
    payload: OpportunityStageTransitionRequest,
    username: str = Depends(get_current_username),
    is_admin: bool = Depends(get_is_admin),
    scopes: frozenset[str] = Depends(get_user_scopes),
):
    return _run_opportunity_transition(
        "dbo.usp_Opportunity_ItemStage_Transition",
        item_id, payload, username, is_admin, scopes,
    )


# --- Market (Admin-only) --------------------------------------------------

@app.post("/api/market/batch")
def market_batch(
    payload: MarketBatchRequest,
    username: str = Depends(get_current_username),
    is_admin: bool = Depends(get_is_admin),
):
    tvp_rows = [
        (r.row_num, r.command, safe_id(r.id), r.market_code, r.market_name, b64_to_bytes(r.row_version))
        for r in payload.rows
    ]
    return _run_admin_master_batch(
        "dbo.usp_Market_Batch", tvp_rows, username, is_admin,
        ("market_list", "customer_master_lookups")
    )


# --- Currency (Admin-only) ------------------------------------------------

@app.post("/api/currency/batch")
def currency_batch(
    payload: CurrencyBatchRequest,
    username: str = Depends(get_current_username),
    is_admin: bool = Depends(get_is_admin),
):
    tvp_rows = [
        (r.row_num, r.command, safe_id(r.id), r.currency_code, r.currency_name, b64_to_bytes(r.row_version))
        for r in payload.rows
    ]
    return _run_admin_master_batch(
        "dbo.usp_Currency_Batch", tvp_rows, username, is_admin,
        ("currency_list", "customer_master_lookups")
    )


# --- Customer --------------------------------------------------------------

@app.post("/api/customer/batch")
def customer_batch(
    payload: CustomerBatchRequest,
    username: str = Depends(get_current_username),
    is_admin: bool = Depends(get_is_admin),
    scopes: frozenset[str] = Depends(get_user_scopes),
):
    tvp_rows = [
        (
            r.row_num, r.command, safe_id(r.id), safe_text(r.customer_name),
            safe_id(r.market_id), safe_id(r.currency_id), safe_text(r.status),
            b64_to_bytes(r.row_version),
        )
        for r in payload.rows
    ]
    return _run_user_master_batch(
        "Customer", "dbo.usp_Customer_Batch", tvp_rows, username, is_admin,
        scopes, ("opportunity_master_lookups",)
    )


# --- Read / Refresh endpoints ---------------------------------------------
# All paginated reads cap page_size server-side too (belt-and-suspenders
# with the stored proc's own cap) and default to a sane page size so a
# client can't accidentally request an unbounded result set.

def _encode_row_versions(rows: list[dict]) -> list[dict]:
    for row in rows:
        for key, value in row.items():
            if key.endswith("RowVersion") and isinstance(value, (bytes, bytearray)):
                row[key] = bytes_to_b64(bytes(value))
    return rows


def _paged_response(rows: list[dict], page: int, page_size: int) -> dict:
    encoded = _encode_row_versions(rows)
    total = int(encoded[0].get("TotalMatchingRows", 0)) if encoded else 0
    return {"rows": encoded, "page": page, "page_size": page_size, "total": total}


@app.get("/api/product")
def product_read(
    product_code: str | None = Query(None),
    product_name: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(200, ge=1, le=500),
    username: str = Depends(get_current_username),
    is_admin: bool = Depends(get_is_admin),
    scopes: frozenset[str] = Depends(get_user_scopes),
):
    # Opportunity users need Product as a read-only transaction lookup.
    _require_scope(is_admin, scopes, "Product", "Opportunity")
    rows = run_read_query(
        "dbo.usp_Product_Read",
        [username, int(is_admin), product_code, product_name, page, page_size],
    )
    return _paged_response(rows, page, page_size)


@app.get("/api/customer")
def customer_read(
    sort: str | None = Query(None, max_length=2000),
    currency_id: int | None = Query(None, ge=1),
    created_by: int | None = Query(None, ge=1),
    customer_name: str | None = Query(None),
    market_id: int | None = Query(None),
    status: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(200, ge=1, le=500),
    username: str = Depends(get_current_username),
    is_admin: bool = Depends(get_is_admin),
    scopes: frozenset[str] = Depends(get_user_scopes),
):
    # Opportunity users need Customer as a read-only transaction lookup.
    _require_scope(is_admin, scopes, "Customer", "Opportunity")
    rows = run_read_query(
        "dbo.usp_Customer_Read",
        [username, int(is_admin), customer_name, market_id, status, page, page_size, currency_id, created_by, parse_sort(sort)],
    )
    return _paged_response(rows, page, page_size)


@app.get("/api/opportunity")
def opportunity_read(
    opportunity_number: str | None = Query(None),
    customer_id: int | None = Query(None),
    stage: str | None = Query(None),
    bid_open_from: str | None = Query(None),
    bid_open_to: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(200, ge=1, le=500),
    username: str = Depends(get_current_username),
    is_admin: bool = Depends(get_is_admin),
    scopes: frozenset[str] = Depends(get_user_scopes),
):
    _require_scope(is_admin, scopes, "Opportunity")
    rows = run_read_query(
        "dbo.usp_Opportunity_Read",
        [username, int(is_admin), opportunity_number, customer_id, stage,
         bid_open_from, bid_open_to, page, page_size],
    )
    return _paged_response(rows, page, page_size)


@app.get("/api/customer/lookups")
def customer_lookups_read(
    username: str = Depends(get_current_username),
    is_admin: bool = Depends(get_is_admin),
    scopes: frozenset[str] = Depends(get_user_scopes),
):
    """Read-only Market/Currency choices for Customer maintenance."""
    _require_scope(is_admin, scopes, "Customer")
    def load_lookups() -> dict:
        markets = run_read_query("dbo.usp_CustomerMarketLookup_Read", [username])
        currencies = run_read_query("dbo.usp_CustomerCurrencyLookup_Read", [username])
        return {
            "markets": [{"ID": row["ID"], "MarketCode": row["MarketCode"], "MarketName": row.get("MarketName")} for row in markets],
            "currencies": [{"ID": row["ID"], "CurrencyCode": row["CurrencyCode"], "CurrencyName": row.get("CurrencyName")} for row in currencies],
            "creators": run_read_query("dbo.usp_CustomerCreatorLookup_Read", [username]),
        }
    return cached("customer_master_lookups", ttl_seconds=60, loader=load_lookups)


@app.get("/api/opportunity/lookups")
def opportunity_lookups_read(
    username: str = Depends(get_current_username),
    is_admin: bool = Depends(get_is_admin),
    scopes: frozenset[str] = Depends(get_user_scopes),
):
    """Complete active Customer/Product choices; never paginated or truncated."""
    _require_scope(is_admin, scopes, "Opportunity")

    def load_lookups() -> dict:
        customers = run_read_query("dbo.usp_OpportunityCustomerLookup_Read", [username])
        products = run_read_query("dbo.usp_OpportunityProductLookup_Read", [username])
        children = run_read_query("dbo.usp_OpportunityMixLookup_Read", [username])
        return {
            "customers": [{"ID": row["ID"], "CustomerName": row["CustomerName"], "CurrencyID": row.get("CurrencyID"), "CustomerCurrencyCode": row.get("CustomerCurrencyCode")} for row in customers],
            "products": [{"ID": row["ID"], "ProductCode": row["ProductCode"], "ProductName": row["ProductName"], "CustomerID": row["CustomerID"], "WeightGrams": row.get("WeightGrams"), "ShelfLifeDays": row.get("ShelfLifeDays")} for row in products],
            "mix_children": children,
            "currencies": run_read_query("dbo.usp_OpportunityCurrencyLookup_Read", [username]),
        }
    from packaging_orders import decode_orders
    shipment_customers, ports = opportunity_shipment_lookups(username)
    markets_by_customer = {row['ID']: row for row in shipment_customers}
    choices = cached("opportunity_master_lookups", ttl_seconds=60, loader=load_lookups)
    choices = {**choices, "customers": [{**row, **markets_by_customer.get(row['ID'], {})} for row in choices['customers']], "ports": ports}
    # Pallet, type and port choices stay fresh when masters change.
    return {**choices,
            "pallets": run_read_query("dbo.usp_OpportunityPalletLookup_Read", [username]),
            "packagingTypes": decode_orders(run_read_query("dbo.usp_OpportunityPackagingTypeLookup_Read", [username]))}


@app.get("/api/opportunity/grid")
def opportunity_grid_read(
    sort: str | None = Query(None, max_length=2000),
    page: int = Query(1, ge=1),
    page_size: int = Query(200, ge=1, le=500),
    opportunity_number: str | None = Query(None),
    customer_name: str | None = Query(None),
    stage: str | None = Query(None),
    bid_open_from: str | None = Query(None),
    bid_open_to: str | None = Query(None),
    username: str = Depends(get_current_username),
    is_admin: bool = Depends(get_is_admin),
    scopes: frozenset[str] = Depends(get_user_scopes),
):
    _require_scope(is_admin, scopes, "Opportunity")
    return sorted_grid(username, page, page_size, sort or "[]", opportunity_number,
                       customer_name, stage, bid_open_from, bid_open_to)


@app.get("/api/opportunity/{opportunity_number}/items")
def opportunity_items_read(
    opportunity_number: str,
    username: str = Depends(get_current_username),
    is_admin: bool = Depends(get_is_admin),
    scopes: frozenset[str] = Depends(get_user_scopes),
):
    _require_scope(is_admin, scopes, "Opportunity")
    rows = run_read_query(
        "dbo.usp_OpportunityItem_ReadByOpportunity",
        [username, int(is_admin), opportunity_number],
    )
    return {"rows": _encode_row_versions(rows)}


@app.get("/api/market")
def market_read(
    username: str = Depends(get_current_username),
    is_admin: bool = Depends(get_is_admin),
):
    _require_admin(is_admin)
    # Cached 60s because this Admin-only reference data changes rarely.
    # This short TTL cuts DB load during bursts of simultaneous Refresh clicks.
    rows = cached("market_list", ttl_seconds=60, loader=lambda: run_read_query("dbo.usp_Market_Read", [username]))
    return {"rows": _encode_row_versions(rows)}


@app.get("/api/currency")
def currency_read(
    username: str = Depends(get_current_username),
    is_admin: bool = Depends(get_is_admin),
):
    _require_admin(is_admin)
    rows = cached("currency_list", ttl_seconds=60, loader=lambda: run_read_query("dbo.usp_Currency_Read", [username]))
    return {"rows": _encode_row_versions(rows)}
