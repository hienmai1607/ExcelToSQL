"""Authorized, paged Opportunity header/item change history."""
from fastapi import APIRouter, Depends, HTTPException, Query
from auth import AccessContext, get_access_context
from db import get_raw_cursor, fetch_all_as_dicts
from packaging_api import require

router = APIRouter(prefix="/api/opportunity", tags=["Opportunity changes"])


@router.get("/{opportunity_id}/changes")
def changes(
    opportunity_id: int,
    page: int = Query(1, ge=1, le=1000000),
    page_size: int = Query(50, ge=1, le=500),
    level: str | None = Query(None, pattern="^(Header|Item)$"),
    source: str | None = Query(None, pattern="^(User|System|Database)$"),
    field: str | None = Query(None, max_length=50),
    ctx: AccessContext = Depends(get_access_context),
):
    require(ctx, "Opportunity")
    try:
        with get_raw_cursor() as cur:
            cur.execute("EXEC dbo.usp_OpportunityChangeLog_Read ?,?,?,?,?,?,?",
                        ctx.username, opportunity_id, page, page_size, level, source, field)
            rows = fetch_all_as_dicts(cur)
            cur.nextset()
            total = int(cur.fetchone()[0])
    except Exception as exc:
        if "52841" in str(exc):
            raise HTTPException(403, "Opportunity access is required for this action.") from exc
        if "2812" in str(exc) or "208" in str(exc):
            raise HTTPException(503, "Change log is not installed. Apply SQL migration 21.") from exc
        raise
    return {"rows": rows, "total": total, "page": page, "page_size": page_size}
