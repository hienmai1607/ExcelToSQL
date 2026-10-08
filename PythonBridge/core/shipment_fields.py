"""Opportunity shipment/cost inputs. Amounts are USD; percentages are 0..100."""
from typing import Literal
from decimal import Decimal
from pydantic import BaseModel, ConfigDict, Field
from typing import Annotated

USD = Annotated[Decimal, Field(ge=0, max_digits=19, decimal_places=2, allow_inf_nan=False)]
Percent = Annotated[Decimal, Field(ge=0, le=100, max_digits=5, decimal_places=2, allow_inf_nan=False)]

class ShipmentCostInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")
    Incoterm: Literal["CFA", "DDP", "EXW", "FOB"] | None = None
    PortOfEntryID: int | None = Field(None, ge=1, le=2147483647)
    ContainerSizeFT: Literal["20FT", "40FT"] | None = None
    FreightUSDPerContainer: USD | None = None
    DutyPct: Percent | None = None
    ImportClearanceUSDPerContainer: USD | None = None
    PortToWHUSDPerContainer: USD | None = None
    WHCostUSDPerPallet: USD | None = None
    OverageShortageDamagePct: Percent | None = None
    WHToCoManWHUSDPerPallet: USD | None = None
    CoManOverheadUSDPerPallet: USD | None = None
    FreightToCustomerUSDPerPallet: USD | None = None
    SpoilageAllowancePct: Percent | None = None
    PaymentTermPct: Percent | None = None
    CoManFeePct: Percent | None = None
    BrokerFeePct: Percent | None = None
    PackingUSDPerLb: USD | None = None
    InitialDesignUSD: USD | None = None
    OtherFixedCostsUSD: USD | None = None
    FobbingUSDPerContainer: USD | None = None
    InterestPct: Percent | None = None
    InterestMonths: int | None = Field(None, ge=0, le=2147483647, strict=True)
    MarginPct: Percent | None = None


def split_shipment_edits(cursor, models, username):
    """Route exact shipment-only updates through the existing audited SQL guard.
    Identity, requirements and stage edits remain on their protected batch path.
    """
    import json
    from db import b64_to_bytes
    from packaging_fields import consume
    metadata = {"row_num", "command", "id", "row_version", "opportunity_number"}
    if len({row.row_num for row in models}) != len(models):
        raise ValueError("Duplicate item row numbers.")
    ids = [row.id for row in models if row.id]
    if len(set(ids)) != len(ids):
        raise ValueError("Duplicate Opportunity item IDs.")
    normal, results = [], []
    for row in models:
        if not (row.command == "U" and row.id and "ShipmentCostInfo" in row.model_fields_set
                and not (row.model_fields_set - metadata - {"ShipmentCostInfo"})):
            normal.append(row)
            continue
        current = cursor.execute("""SELECT o.OpportunityNumber,i.ParentItemID
            FROM dbo.OpportunityItem i WITH(UPDLOCK,HOLDLOCK)
            JOIN dbo.Opportunity o ON o.ID=i.OpportunityID WHERE i.ID=?""", row.id).fetchone()
        if current is None or current.OpportunityNumber != row.opportunity_number:
            raise ValueError("Shipment item belongs to another Opportunity or no longer exists. Refresh before saving.")
        if current.ParentItemID is not None:
            raise ValueError("Shipment, Logistics, Co-Man and Others belong to the Mix parent.")
        value = row.ShipmentCostInfo.model_dump(mode="json") if row.ShipmentCostInfo else None
        cursor.execute("EXEC dbo.usp_OpportunityItem_Fields_Save ?,?,?,?,0",
                       username, row.id, b64_to_bytes(row.row_version),
                       json.dumps({"ShipmentCostInfo": value}))
        version = consume(cursor)[0][0]["RowVersion"]
        results.append(dict(RowNum=row.row_num, Status="OK", Message="Updated shipment and costs",
                            NewID=row.id, NewRowVersion=version))
    return normal, results
