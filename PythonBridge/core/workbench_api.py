"""Read models for the browser UI. Mutations reuse Packaging procedures."""
from fastapi import APIRouter, Depends, Query, HTTPException
from auth import AccessContext, get_access_context
from packaging_api import execute, require

router = APIRouter(prefix="/api/workbench", tags=["Workbench"])

@router.get("/session")
def session(ctx: AccessContext = Depends(get_access_context)):
    return {"user_id": ctx.user_id, "username": ctx.username, "scopes": sorted(ctx.scopes), "is_admin": ctx.is_admin, "can_assign_packaging": ctx.can_manage_packaging, **({"permissions":ctx.permissions} if ctx.permissions is not None else {})}

@router.get("/pics")
def pics(ctx: AccessContext = Depends(get_access_context)):
    if not ctx.can_manage_packaging:
        raise HTTPException(403, "Packaging manager access is required.")
    rows = execute("""
        DECLARE @Actor INT;
        EXEC dbo.usp_Packaging_Authorize ?, 'Review', @Actor OUTPUT;
        SELECT u.ID, u.UserName FROM dbo.Users u
        WHERE dbo.fn_PackagingPICMember(u.ID)=1
        ORDER BY u.UserName, u.ID;
    """, [ctx.username])[0]
    return {"rows": rows}

@router.get("/requests")
def requests(
    page: int = Query(1, ge=1, le=1000000),
    page_size: int = Query(25, ge=1, le=500),
    search: str = Query("", max_length=200),
    status: str | None = Query(None, pattern="^(Open|Completed|Canceled)$"),
    ctx: AccessContext = Depends(get_access_context),
    sort: str | None = Query(None, max_length=2000),
    created_by: str | None = Query(None, max_length=200),
    assigned_to: str | None = Query(None, max_length=200),
):
    require(ctx, "Packaging", "PackagingManager", "Opportunity")
    from request_views import header_read
    return header_read(ctx.username,page,page_size,search,status,sort if isinstance(sort,str) else "[]",
                       created_by if isinstance(created_by,str) else None,assigned_to if isinstance(assigned_to,str) else None)
