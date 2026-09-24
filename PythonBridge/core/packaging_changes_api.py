"""Authorized, paged Packaging Request header/item change history."""
from fastapi import APIRouter, Depends, HTTPException, Query
from auth import AccessContext, get_access_context
from db import get_raw_cursor, fetch_all_as_dicts
from packaging_api import require

router = APIRouter(prefix="/api/packaging/requests", tags=["Packaging Request changes"])


@router.get("/{request_id}/changes")
def changes(
    request_id: int,
    page: int = Query(1, ge=1, le=1000000),
    page_size: int = Query(50, ge=1, le=500),
    level: str | None = Query(None, pattern="^(Header|Item)$"),
    source: str | None = Query(None, pattern="^(User|System|Database)$"),
    field: str | None = Query(None, max_length=50),
    ctx: AccessContext = Depends(get_access_context),
):
    require(ctx, "Packaging", "PackagingManager", "Opportunity")
    try:
        with get_raw_cursor() as cur:
            cur.execute("EXEC dbo.usp_PackagingRequestChangeLog_Read ?,?,?,?,?,?,?",
                        ctx.username, request_id, page, page_size, level, source, field)
            rows = fetch_all_as_dicts(cur)
            cur.nextset()
            total = int(cur.fetchone()[0])
    except Exception as exc:
        if "51101" in str(exc):
            raise HTTPException(401, "Username is incorrect.") from exc
        if "51102" in str(exc):
            raise HTTPException(403, "Packaging Request access is required for this action.") from exc
        if "2812" in str(exc) or "208" in str(exc):
            raise HTTPException(503, "Change log is not installed. Apply SQL migration 24.") from exc
        raise
    return {"rows": rows, "total": total, "page": page, "page_size": page_size}
