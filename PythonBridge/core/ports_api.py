from workspace_access import require_page_edit
"""Customer/Market-scoped Port of Entry master. Maintenance is Admin-only."""
from typing import Literal, Annotated
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator
from auth import AccessContext, get_access_context
from packaging_api import execute, require, rv
from shared_master_views import listing, SharedExport, export_view

router = APIRouter(prefix="/api/ports", tags=["Ports of Entry"])
READ_AUTH = """IF NOT EXISTS(SELECT 1 FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
 WHERE u.UserName=? AND u.IsActive=1 AND a.Scope IN('Admin','Opportunity','Customer'))
 THROW 52998,'Port of Entry read access is required.',1; """

class PortSave(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ID: int | None = Field(None, ge=1)
    RowVersion: str | None = None
    CustomerID: int = Field(ge=1)
    MarketID: int = Field(ge=1)
    PortName: str = Field(min_length=1, max_length=200)
    Status: Literal["Active", "Block"] = "Active"

    @model_validator(mode="after")
    def complete(self):
        self.PortName = self.PortName.strip()
        if not self.PortName:
            raise ValueError("Enter a Port name.")
        if self.ID and not self.RowVersion:
            raise ValueError("Refresh to load the Port row version.")
        return self

@router.get("/lookups")
def lookups(ctx: AccessContext = Depends(get_access_context)):
    require(ctx, "Opportunity", "Customer")
    sets = execute(READ_AUTH + """SELECT ID,CustomerName,MarketID,Status FROM dbo.Customer ORDER BY CustomerName,ID;
      SELECT ID,MarketCode,MarketName FROM dbo.Market ORDER BY MarketName,ID;""", [ctx.username])
    return dict(customers=sets[0], markets=sets[1])

@router.get("")
def read(search: str = Query("", max_length=200), page: int = Query(1, ge=1),
         page_size: int = Query(25, ge=1, le=500),status: Literal["","Active","Block"]="",
         sort: Annotated[str, Query(max_length=2000)] = '[{"column":"PortName","direction":"asc"}]',
         ctx: AccessContext = Depends(get_access_context)):
    require(ctx,"Opportunity","Customer")
    return listing("ports",ctx,execute,READ_AUTH,
      "dbo.PortOfEntry p JOIN dbo.Customer c ON c.ID=p.CustomerID JOIN dbo.Market m ON m.ID=p.MarketID",
      "p.ID,p.CustomerID,p.MarketID,p.PortName,p.Status,p.RowVersion,c.CustomerName,m.MarketCode,m.MarketName",
      ["p.PortName","c.CustomerName","m.MarketCode","m.MarketName"],search,status,page,page_size,sort)

@router.post("/export")
def export(body: SharedExport,ctx: AccessContext=Depends(get_access_context)):
    require(ctx,"Opportunity","Customer")
    return export_view("ports",body)

@router.post("")
def save(payload: PortSave, ctx: AccessContext = Depends(get_access_context)):
    require_page_edit(ctx,"ports")
    try:
        return dict(rows=execute("EXEC dbo.usp_PortOfEntry_Save ?,?,?,?,?,?,?",
          [ctx.username,payload.ID,rv(payload.RowVersion, required=bool(payload.ID)),payload.CustomerID,
           payload.MarketID,payload.PortName,payload.Status])[0])
    except Exception as exc:
        message = str(exc.__cause__ or exc)
        if "changed. Refresh" in message:
            raise HTTPException(409, "Port of Entry changed. Refresh and retry.") from exc
        if "(2601)" in message or "(2627)" in message:
            raise HTTPException(422, "That Port name already exists for this Customer and Market.") from exc
        if "(52996)" in message:
            raise HTTPException(422, "Check the Port name, active Customer and Market.") from exc
        raise

def opportunity_shipment_lookups(username):
    sets = execute("EXEC dbo.usp_OpportunityShipmentLookup_Read ?", [username])
    return sets[0], sets[1]
