from workspace_access import require_page_edit
"""Product Category Master. Admin maintenance, Product read access."""
from typing import Literal, Annotated
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator
from auth import AccessContext, get_access_context
from packaging_api import execute, require, rv
from shared_master_views import listing, SharedExport, export_view

router = APIRouter(prefix="/api/categories", tags=["Category Master"])
READ_AUTH = """IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=? AND u.IsActive=1 AND a.Scope IN('Admin','Product'))
 THROW 52998,'Product access is required to read categories.',1; """

class CategorySave(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ID: int | None = Field(None, ge=1)
    RowVersion: str | None = None
    CategoryName: str = Field(min_length=1, max_length=100)
    Status: Literal["Active", "Block"] = "Active"

    @model_validator(mode="after")
    def complete(self):
        self.CategoryName = self.CategoryName.strip()
        if not self.CategoryName:
            raise ValueError("Enter a Category name.")
        if self.ID and not self.RowVersion:
            raise ValueError("Refresh to load the Category row version.")
        return self

@router.get("")
def read(search: str = Query("", max_length=200), page: int = Query(1, ge=1),
         page_size: int = Query(25, ge=1, le=500), status: Literal["","Active","Block"]="",
         sort: Annotated[str, Query(max_length=2000)] = '[{"column":"CategoryName","direction":"asc"}]',
         ctx: AccessContext = Depends(get_access_context)):
    require(ctx, "Product")
    return listing("categories", ctx, execute, READ_AUTH, "dbo.ProductCategory p",
                   "p.ID,p.CategoryName,p.Status,p.RowVersion", ["p.CategoryName"],
                   search, status, page, page_size, sort)

@router.post("/export")
def export(body: SharedExport, ctx: AccessContext=Depends(get_access_context)):
    require(ctx, "Product")
    return export_view("categories", body)

@router.post("")
def save(payload: CategorySave, ctx: AccessContext=Depends(get_access_context)):
    require_page_edit(ctx,"categories")
    try:
        return dict(rows=execute("EXEC dbo.usp_ProductCategory_Save ?,?,?,?,?",
          [ctx.username, payload.ID, rv(payload.RowVersion, required=bool(payload.ID)),
           payload.CategoryName, payload.Status])[0])
    except Exception as exc:
        message = str(exc.__cause__ or exc)
        if "changed. Refresh" in message:
            raise HTTPException(409, "Category changed. Refresh and retry.") from exc
        if "(2601)" in message or "(2627)" in message:
            raise HTTPException(422, "That Category name already exists.") from exc
        if "(52964)" in message:
            if "used by Products" in message:
                detail = "This Category is used by Products. Keep its name, or create a new Category."
            else:
                detail = "Enter a unique Category name and valid status."
            raise HTTPException(422, detail) from exc
        raise
