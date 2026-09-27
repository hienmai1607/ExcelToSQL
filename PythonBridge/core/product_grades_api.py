"""Product grade versions share Product authorization and optimistic concurrency."""
from fastapi import APIRouter, Depends, Path
from auth import AccessContext, get_access_context
from packaging_api import execute, require, rv
from product_grades import GradeSave
from cache import invalidate

router = APIRouter(prefix="/api/workbench/products", tags=["Product grades"])


@router.get("/{product_id}/grades")
def read(product_id: int = Path(ge=1), ctx: AccessContext = Depends(get_access_context)):
    require(ctx, "Product")
    sets = execute("EXEC dbo.usp_ProductGrade_Read ?,?", [product_id, ctx.username])
    return {"product": sets[0][0], "versions": sets[1], "items": sets[2]}


@router.post("/{product_id}/grades")
def save(body: GradeSave, product_id: int = Path(ge=1), ctx: AccessContext = Depends(get_access_context)):
    require(ctx, "Product")
    import json
    sets = execute("EXEC dbo.usp_ProductGrade_Save ?,?,?,?,?,?,?", [
        product_id, ctx.username, body.VersionID, rv(body.RowVersion, False),
        rv(body.ProductRowVersion), body.Status,
        json.dumps([item.model_dump(mode="json") for item in body.items]),
    ])
    invalidate("opportunity_master_lookups")
    return sets[0][0]
