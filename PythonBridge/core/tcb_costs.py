"""Exact Opportunity TCB math. All monetary values are USD; ratios are percentages."""
from decimal import Decimal
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

Money = Annotated[Decimal, Field(ge=0, max_digits=19, decimal_places=6, allow_inf_nan=False)]
Pct = Annotated[Decimal, Field(ge=0, le=100, max_digits=5, decimal_places=2, allow_inf_nan=False)]

LOSS_FIELDS = ("LossProductPct","PrimaryLossPct","SecondaryLossPct","TertiaryLossPct",
               "MixPrimaryLossPct","MixSecondaryLossPct","MixTertiaryLossPct")
PROCESS_FIELDS = {"Sorting":"LossProductPct","Processing":"LossProductPct",
                  "PrimaryPackaging":"PrimaryLossPct","SecondaryPackaging":"SecondaryLossPct",
                  "TertiaryPackaging":"TertiaryLossPct","MixPrimaryPackaging":"MixPrimaryLossPct",
                  "MixSecondaryPackaging":"MixSecondaryLossPct","MixTertiaryPackaging":"MixTertiaryLossPct"}
DerivedPct = Annotated[Decimal, Field(ge=0, le=100, allow_inf_nan=False)]

ProcessKind = Literal["Sorting","Processing","PrimaryPackaging","SecondaryPackaging",
                      "TertiaryPackaging","MixPrimaryPackaging","MixSecondaryPackaging","MixTertiaryPackaging"]

class LossProcess(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ProcessType: ProcessKind
    ProcessName: str | None = Field(None,max_length=100)
    MasterID: int | None = Field(None, ge=1)
    MasterVersion: str | None = Field(None, pattern=r"^0x[0-9A-Fa-f]{16}$")
    Sequence: int = Field(ge=1, le=1000, strict=True)
    LossPct: Pct

def process_losses(processes):
    """Apply each step to what survived the preceding steps, without rounding."""
    surviving = {field:Decimal(1) for field in LOSS_FIELDS}
    for step in sorted(processes,key=lambda step:step.Sequence):
        surviving[PROCESS_FIELDS[step.ProcessType]] *= 1 - step.LossPct / 100
    return {field:(1 - value) * 100 for field,value in surviving.items()}

class Selection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    Path: str = Field(pattern=r"^0(?:/[1-9][0-9]{0,3}){1,12}$")
    PriceID: int | None = Field(None, ge=1)
    PriceVersion: str | None = Field(None, pattern=r"^0x[0-9A-Fa-f]{16}$")
    ExpectedUSDPerLb: Decimal | None = Field(None, ge=0, allow_inf_nan=False)
    DirectUSDPerLb: Annotated[Decimal, Field(ge=0, le=Decimal('9999999999999.999999'), max_digits=19, decimal_places=6, allow_inf_nan=False)] | None = None

    @model_validator(mode="after")
    def price_source(self):
        if self.DirectUSDPerLb is not None:
            if self.PriceID is not None or self.PriceVersion is not None or self.ExpectedUSDPerLb is not None:
                raise ValueError("Choose either a master quote or a direct USD/lb price, not both.")
        elif self.PriceID is None or self.PriceVersion is None:
            raise ValueError("Select a master quote or enter a direct USD/lb price.")
        return self

class Inputs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    Prices: list[Selection] = Field(default_factory=list, max_length=1000)
    LossProcesses: list[LossProcess] | None = Field(None, max_length=100)
    ProductLossFormula: str | None = Field(None,max_length=200)
    RMRatio: Pct = Decimal(100)
    SeasoningUSDPerLb: Money | None = None
    SeasoningRatio: Pct = Decimal(0)
    OilUSDPerLb: Money | None = None
    OilPct: Pct = Decimal(0)
    ProcessingUSDPerLb: Money = Decimal(0)
    LossProductPct: DerivedPct = Decimal(0)
    PrimaryLossPct: DerivedPct = Decimal(0)
    SecondaryLossPct: DerivedPct = Decimal(0)
    TertiaryLossPct: DerivedPct = Decimal(0)
    MixPrimaryLossPct: DerivedPct = Decimal(0)
    MixSecondaryLossPct: DerivedPct = Decimal(0)
    MixTertiaryLossPct: DerivedPct = Decimal(0)
    PalletUSDPerEA: Money | None = None

    @model_validator(mode="after")
    def balanced(self):
        if self.RMRatio + self.SeasoningRatio + self.OilPct != 100:
            raise ValueError("RM + Seasoning/salt + Oil ratios must total 100%.")
        if self.SeasoningRatio and self.SeasoningUSDPerLb is None:
            raise ValueError("Enter Seasoning/salt cost when its ratio is above zero.")
        if self.OilPct and self.OilUSDPerLb is None:
            raise ValueError("Enter Oil cost when its percentage is above zero.")
        if len({p.Path for p in self.Prices}) != len(self.Prices):
            raise ValueError("Select only one price per grade leaf.")
        if self.LossProcesses is not None:
            if len({(PROCESS_FIELDS[p.ProcessType],p.Sequence) for p in self.LossProcesses}) != len(self.LossProcesses):
                raise ValueError("Each loss group needs unique process sequence numbers.")
            for field,value in process_losses(self.LossProcesses).items():
                setattr(self,field,value)
        if self.ProductLossFormula and self.ProductLossFormula.strip():
            from dimension_formula import _calculate
            product_steps=[p for p in self.LossProcesses or [] if p.ProcessType in ("Sorting","Processing")]
            values={"L"+str(i+1):p.LossPct / Decimal(100) for i,p in enumerate(product_steps)}
            try:
                self.LossProductPct=_calculate(self.ProductLossFormula,values,"Product loss",allow_constant=True,variable_names=values,loss=True)
            except ValueError as exc:
                raise ValueError(str(exc).replace("D1, D2, D3","L1, L2, ...").replace("dimension formula","Product loss formula")) from exc
        return self

def leaves(items):
    """Validate the whole snapshot and multiply ratios down each grade path."""
    if not items:
        raise ValueError("No Opportunity grade snapshot. Maintain grades before costing.")
    nodes = {}
    totals = {}
    for i in items:
        path = i["ParentID"] + "/" + str(i["ID"])
        if path in nodes:
            raise ValueError("Duplicate grade path.")
        ratio = Decimal(str(i["RatioPct"]))
        if not ratio.is_finite() or not 0 < ratio <= 100:
            raise ValueError("Invalid grade ratio.")
        nodes[path] = i
        totals[i["ParentID"]] = totals.get(i["ParentID"], Decimal(0)) + ratio
    if any(t != 100 for t in totals.values()):
        raise ValueError("Grade ratios under each parent must total 100%.")
    result = []
    for path, item in nodes.items():
        factor, current, seen = Decimal(1), path, set()
        while current != "0":
            if current in seen or current not in nodes:
                raise ValueError("Invalid grade hierarchy.")
            seen.add(current)
            node = nodes[current]
            factor *= Decimal(str(node["RatioPct"])) / 100
            current = node["ParentID"]
        if path not in totals:
            result.append({**item, "Path": path, "Proportion": factor})
    return result

def calculate(inputs, grade_leaves, prices):
    selected = {p.Path: p for p in inputs.Prices}
    valid_paths = {leaf["Path"] for leaf in grade_leaves}
    if selected.keys() - valid_paths:
        raise ValueError("Selected price refers to a removed or non-leaf grade. Refresh grades.")
    rm = Decimal(0)
    captures = []
    for leaf in grade_leaves:
        selection = selected.get(leaf["Path"])
        if selection and selection.DirectUSDPerLb is not None:
            cost = selection.DirectUSDPerLb
            rm += leaf["Proportion"] * cost
            captures.append({"Source":"Direct","Path":leaf["Path"],"USDPerLb":str(cost),
                             "RawGradeID":leaf.get("RawGradeID"),"MaterialID":leaf.get("RawMaterialID"),
                             "Proportion":str(leaf["Proportion"])})
            continue
        price = prices.get(selection.PriceID) if selection else None
        if not price:
            if inputs.RMRatio:
                raise ValueError("Choose a current convertible price for " + leaf["Path"] + ".")
            continue
        if price["PriceVersion"].lower() != selection.PriceVersion.lower():
            raise ValueError("Selected price changed. Refresh and explicitly reselect it.")
        if price["RawGradeID"] != leaf.get("RawGradeID") or (leaf.get("RawMaterialID") and price["MaterialID"] != leaf["RawMaterialID"]):
            raise ValueError("Selected price does not belong to the grade's assigned material.")
        if price.get("USDPerLb") is None:
            raise ValueError("The selected price needs a USD exchange rate and weight conversion.")
        cost = Decimal(str(price["USDPerLb"]))
        if selection.ExpectedUSDPerLb is not None and cost != selection.ExpectedUSDPerLb:
            raise ValueError("Selected price conversion changed. Refresh and explicitly reselect it.")
        if not cost.is_finite() or cost < 0:
            raise ValueError("Invalid material price.")
        rm += leaf["Proportion"] * cost
        captures.append({**price, "Path": leaf["Path"], "Proportion": str(leaf["Proportion"])})
    product = (rm * inputs.RMRatio + (inputs.SeasoningUSDPerLb or 0) * inputs.SeasoningRatio
               + (inputs.OilUSDPerLb or 0) * inputs.OilPct) / 100 + inputs.ProcessingUSDPerLb
    return {"RMCostUSDPerLb": str(rm) if len(captures) == len(grade_leaves) else None,
            "ProductUSDPerLb": str(product), "PriceSnapshots": captures}
