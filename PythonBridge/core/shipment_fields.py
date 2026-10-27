"""Opportunity costs with explicit USD/customer-currency bases; percentages are 0..100."""
from typing import Literal
from decimal import Decimal, ROUND_HALF_UP, localcontext
from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Annotated

USD = Annotated[Decimal, Field(ge=0, max_digits=19, decimal_places=2, allow_inf_nan=False)]
Percent = Annotated[Decimal, Field(ge=0, le=100, max_digits=5, decimal_places=2, allow_inf_nan=False)]

INCOTERMS = tuple(sorted({"CFA", "FOB", "FCA", "FAS", "CFR", "CIF", "CPT", "CIP", "EXW", "DAP", "DPU", "DDP"}))

class WarehouseCostBreakdown(BaseModel):
    model_config = ConfigDict(extra="forbid")
    Unloading: USD = Decimal(0)
    Palletize: USD = Decimal(0)
    Inbound: USD = Decimal(0)
    Outbound: USD = Decimal(0)
    StorageCostPerMonth: USD = Decimal(0)
    StorageMonths: USD = Decimal(0)
    OrderFeeAdminCost: USD = Decimal(0)
    OthersCost: USD = Decimal(0)

    def total(self):
        with localcontext() as ctx:
            ctx.prec = 50
            total = (self.Unloading + self.Palletize + self.Inbound + self.Outbound
                     + self.StorageCostPerMonth * self.StorageMonths + self.OrderFeeAdminCost + self.OthersCost)
            return total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

class ShipmentCostInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")
    Incoterm: Literal["CFA", "CFR", "CIF", "CIP", "CPT", "DAP", "DDP", "DPU", "EXW", "FAS", "FCA", "FOB"] | None = None
    PortOfEntryID: int | None = Field(None, ge=1, le=2147483647)
    ContainerSizeFT: Literal["20FT", "40FT"] | None = None
    FreightUSDPerContainer: USD | None = None
    DutyPct: Percent | None = None
    ImportClearanceUSDPerContainer: USD | None = None
    PortToWHUSDPerContainer: USD | None = None
    WHCostUSDPerPallet: USD | None = None
    PortToWHCustomerPerContainer: USD | None = None
    WHCostCustomerPerPallet: USD | None = None
    WHCostBreakdown: WarehouseCostBreakdown | None = None
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
    InitialDesignCustomer: USD | None = None
    OtherFixedCostsUSD: USD | None = None
    FobbingUSDPerContainer: USD | None = None
    InterestPct: Percent | None = None
    InterestMonths: int | None = Field(None, ge=0, le=2147483647, strict=True)
    MarginPct: Percent | None = None
    FloorLoadUSDPerMT: USD | None = None
    ImportClearanceCustomerPerContainer: USD | None = None
    ImportClearanceCustomerPerPallet: USD | None = None # Historical basis only.
    InterestDays: int | None = Field(None,ge=0,le=2147483647,strict=True)
    PaymentTermDays: int | None = Field(None,ge=0,le=2147483647,strict=True)
    MarginMode: Literal["Percent","USDPerLb"] | None = None
    MarginUSDPerLb: USD | None = None

    @model_validator(mode="after")
    def margin_basis(self):
        if self.WHCostBreakdown is not None:
            total = self.WHCostBreakdown.total()
            if total > Decimal("99999999999999999.99"):
                raise ValueError("WH Cost exceeds the supported amount.")
            if self.WHCostCustomerPerPallet is not None and self.WHCostCustomerPerPallet != total:
                raise ValueError("WH Cost must match its calculation breakdown.")
            if self.WHCostUSDPerPallet is not None:
                raise ValueError("Clear the legacy USD WH cost when applying a customer-currency breakdown.")
            self.WHCostCustomerPerPallet = total
        if self.InitialDesignUSD is not None and self.InitialDesignCustomer is not None:
            raise ValueError("Choose USD or customer currency for Initial Design, not both.")
        if self.MarginPct is not None and self.MarginUSDPerLb is not None:
            raise ValueError("Choose Margin % or Margin ($/lbs), not both.")
        if self.MarginMode=="Percent" and self.MarginUSDPerLb is not None or self.MarginMode=="USDPerLb" and self.MarginPct is not None:
            raise ValueError("Margin value must match the selected basis.")
        return self


def validate_new_shipment(models):
    """New root items require an exact container; pallet is optional and children inherit."""
    from fastapi import HTTPException
    from container_loading import CONTAINER_TYPES
    for row in models:
        if row.command != "C":
            continue
        if row.ContainerRequest not in CONTAINER_TYPES:
            raise HTTPException(422, f"Item {row.row_num}: Container Type is required (20DC, 20RC, 40DC, 40HC or 40RHC).")

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
            from shipment_ownership import validate_child_others
            validate_child_others(row.ShipmentCostInfo.model_dump(mode="json") if row.ShipmentCostInfo else None)
        value = row.ShipmentCostInfo.model_dump(mode="json") if row.ShipmentCostInfo else None
        cursor.execute("EXEC dbo.usp_OpportunityItem_Fields_Save ?,?,?,?,0",
                       username, row.id, b64_to_bytes(row.row_version),
                       json.dumps({"ShipmentCostInfo": value}))
        version = consume(cursor)[0][0]["RowVersion"]
        results.append(dict(RowNum=row.row_num, Status="OK", Message="Updated shipment and costs",
                            NewID=row.id, NewRowVersion=version))
    return normal, results
