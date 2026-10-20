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
):
    require(ctx, "Packaging", "PackagingManager", "Opportunity")
    if isinstance(sort,str):
        from request_views import header_read
        return header_read(ctx.username,page,page_size,search,status,sort)
    # Parameterized read model; snapshots and status definitions match the grid.
    results = execute("""
        DECLARE @Actor INT;
        EXEC dbo.usp_Packaging_Authorize ?, 'Read', @Actor OUTPUT;
        SELECT h.ID AS RequestID,h.RowVersion HeaderRowVersion,h.RequestNumber,h.OpportunityNumber,
          h.CustomerName,h.ResponseDue,h.RequestedAt,u.UserName AS RequestedByName,
          totals.ItemCount,totals.Unassigned,
          CASE WHEN totals.OpenCount>0 THEN 'Open'
               WHEN totals.ApprovedCount>0 THEN 'Completed' ELSE 'Canceled' END AS RequestStatus
        INTO #summary
        FROM dbo.PackagingConfigurationRequest h
        JOIN dbo.Users u ON u.ID=h.RequestedBy
        CROSS APPLY (
          SELECT COUNT(CASE WHEN oi.ParentItemID IS NULL OR parent_item.ID IS NULL THEN 1 END) ItemCount,
            SUM(CASE WHEN (oi.ParentItemID IS NULL OR parent_item.ID IS NULL) AND i.PICUserID IS NULL AND i.IsOpen=1 THEN 1 ELSE 0 END) Unassigned,
            SUM(CONVERT(INT,i.IsOpen)) OpenCount,
            SUM(CASE WHEN i.Stage='Approved' THEN 1 ELSE 0 END) ApprovedCount
          FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
          LEFT JOIN dbo.PackagingConfigurationRequestItem parent_item ON parent_item.RequestID=i.RequestID AND parent_item.OpportunityItemID=oi.ParentItemID
          WHERE i.RequestID=h.ID
        ) totals
        WHERE h.RequestNumber LIKE ? OR h.OpportunityNumber LIKE ? OR h.CustomerName LIKE ?;
        SELECT * FROM #summary WHERE (? IS NULL OR RequestStatus=?)
        ORDER BY RequestID DESC OFFSET ? ROWS FETCH NEXT ? ROWS ONLY;
        SELECT COUNT(*) AS Total FROM #summary WHERE (? IS NULL OR RequestStatus=?);
    """, [ctx.username, search+"%", search+"%", search+"%", status,status,
          (page-1)*page_size,page_size,status,status])
    return {"rows": results[0], "total": results[1][0]["Total"], "page":page,"page_size":page_size}
