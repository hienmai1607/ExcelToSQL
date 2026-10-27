"""Exact Opportunity TCB math. All monetary values are USD; ratios are percentages."""
from decimal import Decimal
import json
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from grade_process_loss import GradeProcessLoss,process_loss_results

Money = Annotated[Decimal, Field(ge=0, max_digits=19, decimal_places=6, allow_inf_nan=False)]
Pct = Annotated[Decimal, Field(ge=0, le=100, max_digits=5, decimal_places=2, allow_inf_nan=False)]

LOSS_FIELDS = ("LossProductPct","PrimaryLossPct","SecondaryLossPct","TertiaryLossPct","QuaternaryLossPct",
               "MixPrimaryLossPct","MixSecondaryLossPct","MixTertiaryLossPct")
PROCESS_FIELDS = {"Sorting":"LossProductPct","Processing":"LossProductPct",
                  "PrimaryPackaging":"PrimaryLossPct","SecondaryPackaging":"SecondaryLossPct",
                  "TertiaryPackaging":"TertiaryLossPct","QuaternaryPackaging":"QuaternaryLossPct","MixPrimaryPackaging":"MixPrimaryLossPct",
                  "MixSecondaryPackaging":"MixSecondaryLossPct","MixTertiaryPackaging":"MixTertiaryLossPct"}
DerivedPct = Annotated[Decimal, Field(ge=0, le=100, allow_inf_nan=False)]

ProcessKind = Literal["Sorting","Processing","PrimaryPackaging","SecondaryPackaging",
                      "TertiaryPackaging","QuaternaryPackaging","MixPrimaryPackaging","MixSecondaryPackaging","MixTertiaryPackaging"]

class LossProcess(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ProcessType: ProcessKind
    ProcessName: str | None = Field(None,max_length=100)
    MasterID: int | None = Field(None, ge=1)
    MasterVersion: str | None = Field(None, pattern=r"^0x[0-9A-Fa-f]{16}$")
    Sequence: int = Field(ge=1, le=1000, strict=True)
    LossPct: Pct
    Shared: bool = False

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

class Recipe(BaseModel):
    model_config = ConfigDict(extra="forbid")
    RMRatio: Pct = Decimal(100)
    SeasoningUSDPerLb: Money | None = None
    SeasoningRatio: Pct = Decimal(0)
    OilUSDPerLb: Money | None = None
    OilPct: Pct = Decimal(0)
    ProcessingUSDPerLb: Money = Decimal(0)

    @model_validator(mode="after")
    def recipe_valid(self):
        if self.RMRatio + self.SeasoningRatio + self.OilPct != 100:
            raise ValueError("RM + Seasoning/salt + Oil ratios must total 100%.")
        if self.SeasoningRatio and self.SeasoningUSDPerLb is None:
            raise ValueError("Enter Seasoning/salt cost when its ratio is above zero.")
        if self.OilPct and self.OilUSDPerLb is None:
            raise ValueError("Enter Oil cost when its percentage is above zero.")
        return self

class MaterialCost(Recipe):
    Path: str = Field(pattern=r"^0(?:/[1-9][0-9]{0,3}){1,12}$")

class Inputs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    Prices: list[Selection] = Field(default_factory=list, max_length=1000)
    MaterialCosts: list[MaterialCost] = Field(default_factory=list,max_length=1000)
    ProcessLosses: list[GradeProcessLoss] | None = Field(None,max_length=1000)
    ProcessLossMode: Literal["Stages","GradePath"] = "Stages"
    ProcessLossLayout: Literal["Local","Aligned"] = "Local"
    ProcessLossFormulas: dict[Annotated[str,Field(pattern=r"^0(?:/[1-9][0-9]{0,3}){1,12}$")],Annotated[str,Field(max_length=200)]] = Field(default_factory=dict,max_length=1000)
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
    QuaternaryLossPct: DerivedPct = Decimal(0)
    MixPrimaryLossPct: DerivedPct = Decimal(0)
    MixSecondaryLossPct: DerivedPct = Decimal(0)
    MixTertiaryLossPct: DerivedPct = Decimal(0)
    PalletUSDPerEA: Money | None = None

    @model_validator(mode="after")
    def balanced(self):
        if self.ProcessLosses is not None and len({p.Path for p in self.ProcessLosses})!=len(self.ProcessLosses):
            raise ValueError("Use only one Process Loss row per grade.")
        if self.RMRatio + self.SeasoningRatio + self.OilPct != 100:
            raise ValueError("RM + Seasoning/salt + Oil ratios must total 100%.")
        if self.SeasoningRatio and self.SeasoningUSDPerLb is None:
            raise ValueError("Enter Seasoning/salt cost when its ratio is above zero.")
        if self.OilPct and self.OilUSDPerLb is None:
            raise ValueError("Enter Oil cost when its percentage is above zero.")
        if len({p.Path for p in self.MaterialCosts}) != len(self.MaterialCosts):
            raise ValueError("Use only one costing recipe per Process grade.")
        if len({p.Path for p in self.Prices}) != len(self.Prices):
            raise ValueError("Select only one price per grade leaf.")
        if self.LossProcesses is not None:
            if len({(PROCESS_FIELDS[p.ProcessType],p.Sequence) for p in self.LossProcesses}) != len(self.LossProcesses):
                raise ValueError("Each loss group needs unique process sequence numbers.")
            for field,value in process_losses(self.LossProcesses).items():
                setattr(self,field,value)
        if self.ProcessLosses is not None:
            self.LossProductPct=Decimal(0)
            codes=[step for step in self.LossProcesses or [] if step.ProcessType in ("Sorting","Processing")]
            rows=sorted(self.ProcessLosses,key=lambda row:tuple(map(int,row.Path.split("/"))))
            shared={}
            for row in rows:
                for index,code in enumerate(row.Codes or []):
                    if code.Shared:
                        key=code.MasterID or code.ProcessName.casefold()
                        shared.setdefault(key,row.Ratios[index])
                        row.Ratios[index]=shared[key]
            for row in self.ProcessLosses:
                if row.Codes is None:
                    row.Ratios=[rows[0].Ratios[index] if rows and index<len(rows[0].Ratios) and index<len(codes) and codes[index].Shared else value for index,value in enumerate(row.Ratios)]
        if self.ProcessLosses is None and self.ProductLossFormula and self.ProductLossFormula.strip():
            from dimension_formula import _calculate
            product_steps=[p for p in self.LossProcesses or [] if p.ProcessType in ("Sorting","Processing")]
            values={"L"+str(i+1):p.LossPct / Decimal(100) for i,p in enumerate(product_steps)}
            try:
                from dimension_formula import _expression
                variables=_expression(self.ProductLossFormula,allow_constant=True,variable_names={*values,"NW"})[2]
                if "NW" not in variables:
                    self.LossProductPct=_calculate(self.ProductLossFormula,values,"Product loss",allow_constant=True,variable_names=values,loss=True)
            except ValueError as exc:
                raise ValueError(str(exc).replace("D1, D2, D3","L1, L2, ..., NW").replace("dimension formula","Product loss formula")) from exc
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
    explicit=any(item.get("Process") is not None for item in items)
    processes={path:node for path,node in nodes.items() if node.get("Process")}
    for leaf in result:
        chain=sorted((path for path in processes if leaf["Path"]==path or leaf["Path"].startswith(path+"/")),key=lambda p:len(p.split("/")),reverse=True) if explicit else [leaf["Path"]]
        leaf["ProcessPaths"]=json.dumps(chain)
        owner=next((path for path in processes if leaf["Path"]==path or leaf["Path"].startswith(path+"/")),None) if explicit else leaf["Path"]
        leaf["ProcessPath"]=owner
        leaf["ProcessGrade"]=nodes[owner]["Grade"] if owner else None
        leaf["ProcessProportion"]=sum((g["Proportion"] for g in result if owner and (g["Path"]==owner or g["Path"].startswith(owner+"/"))),Decimal(0)) if owner else leaf["Proportion"]
    return sorted(result,key=lambda grade:tuple(int(part) for part in grade["Path"].split("/")))

def process_paths(grade_leaves):
    return {path for leaf in grade_leaves for path in leaf_process_paths(leaf) if path}

def leaf_process_paths(leaf):
    value=leaf.get("ProcessPaths",[leaf.get("ProcessPath",leaf["Path"])])
    return json.loads(value) if isinstance(value,str) else value

def recipe_path(path):
    return "/".join(path.split("/")[:2])

def loss_target(leaf):
    chain=leaf_process_paths(leaf)
    return chain[0] if chain else leaf["Path"]

def grade_loss_results(inputs,grade_leaves,weight=None):
    targets={loss_target(leaf) for leaf in grade_leaves}
    if inputs.ProcessLossMode=="GradePath" and inputs.ProcessLossFormulas.keys()-targets:
        raise ValueError("Process Loss formula refers to a removed or inactive grade. Refresh grades.")
    return process_loss_results(inputs.ProcessLosses,len([s for s in inputs.LossProcesses or [] if s.ProcessType in ("Sorting","Processing")]),weight,
        targets=targets if inputs.ProcessLossMode=="GradePath" else None,formulas=inputs.ProcessLossFormulas,aligned=inputs.ProcessLossLayout=="Aligned")

def level_one_recipes(inputs,grade_leaves):
    roots={recipe_path(leaf["Path"]) for leaf in grade_leaves}
    result={}
    for root in sorted(roots,key=lambda path:tuple(map(int,path.split("/")))):
        exact=next((row for row in inputs.MaterialCosts if row.Path==root),None)
        children=[row for row in inputs.MaterialCosts if row.Path.startswith(root+"/")]
        if exact:result[root]=exact
        elif children:
            values={tuple(getattr(row,key) for key in Recipe.model_fields) for row in children}
            if len(values)>1:raise ValueError("Review the Level 1 recipe for "+root+"; saved child recipes differ.")
            result[root]=MaterialCost(**{**children[0].model_dump(),"Path":root})
    return result

def trim_process_recipes(inputs,items,grade_leaves):
    known={item["ParentID"]+"/"+str(item["ID"]) for item in items}
    active=process_paths(grade_leaves)
    # Hidden child recipes exist in the browser only until Save; invalid unknown paths still fail.
    unknown=[r for r in inputs.MaterialCosts if r.Path not in known]
    inputs.MaterialCosts=[*level_one_recipes(inputs,grade_leaves).values(),*unknown]
    if inputs.ProcessLosses is not None:
        inputs.ProcessLosses=[r for r in inputs.ProcessLosses if r.Path=="0" or r.Path in active or r.Path not in known]
    targets={loss_target(leaf) for leaf in grade_leaves}
    inputs.ProcessLossFormulas={path:formula for path,formula in inputs.ProcessLossFormulas.items() if path in targets or path not in known}

def calculate(inputs, grade_leaves, prices,allow_unpriced=False,weight=None):
    selected = {p.Path: p for p in inputs.Prices}
    valid_paths = {leaf["Path"] for leaf in grade_leaves}
    if selected.keys() - valid_paths:
        raise ValueError("Selected price refers to a removed or non-leaf grade. Refresh grades.")
    recipes=level_one_recipes(inputs,grade_leaves)
    loss_results=grade_loss_results(inputs,grade_leaves,weight)
    losses={r["Path"]:Decimal(r["LossPct"]) for r in loss_results}
    if {r.Path for r in inputs.ProcessLosses or []}-process_paths(grade_leaves)-{"0"}:
        raise ValueError("Process Loss refers to a removed or non-Process grade.")
    if any(not any(row.Path==recipe_path(leaf["Path"]) or row.Path==leaf["Path"] or leaf["Path"].startswith(row.Path+"/") for leaf in grade_leaves) for row in inputs.MaterialCosts):
        raise ValueError("Material costing refers to a removed, non-leaf or non-Process grade. Refresh grades.")
    rm = Decimal(0)
    product = Decimal(0)
    captures = []
    recipe_captures = []
    groups={}
    def include(leaf,cost):
        nonlocal rm
        chain=leaf_process_paths(leaf)
        for path in ([loss_target(leaf)] if inputs.ProcessLossMode=="GradePath" else [*chain,"0"]):
            cost=cost/(1-losses.get(path,Decimal(0))/100)
        key=recipe_path(leaf["Path"])
        group=groups.setdefault(key,{"Process":True,"WeightedRM":Decimal(0),"Proportion":Decimal(0)})
        weighted=leaf["Proportion"]*cost
        group["WeightedRM"]+=weighted
        group["Proportion"]+=leaf["Proportion"]
        rm+=weighted

    for leaf in grade_leaves:
        selection = selected.get(leaf["Path"])
        if selection and selection.DirectUSDPerLb is not None:
            cost = selection.DirectUSDPerLb
            include(leaf,cost)
            captures.append({"Source":"Direct","Path":leaf["Path"],"USDPerLb":str(cost),
                             "RawGradeID":leaf.get("RawGradeID"),"MaterialID":leaf.get("RawMaterialID"),
                             "Proportion":str(leaf["Proportion"])})
            continue
        price = prices.get(selection.PriceID) if selection else None
        if not price:
            owner=leaf.get("ProcessPath",leaf["Path"])
            if not allow_unpriced and (not owner or recipes.get(owner,inputs).RMRatio):
                raise ValueError("Choose a current convertible price for " + leaf["Path"] + ".")
            include(leaf,Decimal(0))
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
        include(leaf,cost)
        captures.append({**price, "Path": leaf["Path"], "Proportion": str(leaf["Proportion"])})
    for path,group in groups.items():
        share=group["Proportion"]
        blended=group["WeightedRM"]/share
        if group["Process"]:
            recipe=recipes.get(path,inputs)
            line=(blended*recipe.RMRatio+(recipe.SeasoningUSDPerLb or 0)*recipe.SeasoningRatio
                  +(recipe.OilUSDPerLb or 0)*recipe.OilPct)/100+recipe.ProcessingUSDPerLb
            recipe_captures.append({"Path":path,"RMUSDPerLb":str(blended),"Proportion":str(share),"ProductUSDPerLb":str(line),
                                   "Inputs":{k:str(getattr(recipe,k)) if getattr(recipe,k) is not None else None for k in Recipe.model_fields}})
        else:
            line=blended
        product+=share*line
    return {"RMCostUSDPerLb": str(rm) if len(captures) == len(grade_leaves) else None,
            "ProductUSDPerLb": str(product), "PriceSnapshots": captures,"MaterialCostSnapshots":recipe_captures,
            "ProcessLossSnapshots":loss_results}
