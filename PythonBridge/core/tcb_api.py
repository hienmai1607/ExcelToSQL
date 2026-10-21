"""Opportunity-owned TCB selection and costs; never mutates grade or pricing masters."""
import json
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, ConfigDict
from auth import AccessContext, get_access_context
from packaging_api import execute, require, rv
from opportunity_excel_api import AUTH
from tcb_costs import Inputs, leaves, calculate, LossProcess, LOSS_FIELDS
from loss_process_api import active_loss_masters

router = APIRouter(prefix="/api/opportunity/items", tags=["TCB Calculator"])

def serial(value):
    if isinstance(value, Decimal):
        return str(value)
    raise TypeError(type(value).__name__)

def item_read(item_id, ctx):
    rows = execute(AUTH + """SELECT i.ID,i.RowVersion,i.ProductGradeSnapshot,i.TCBCostInfo,i.ProductLossSnapshot,i.ParentItemID,
      i.Stage ItemStage,o.Stage HeaderStage,p.ProductCode,p.ProductName,i.ProductNetWeightGrams WeightGrams,CASE WHEN response.PalletPricingID IS NOT NULL THEN (SELECT TRY_CONVERT(DECIMAL(19,6),JSON_VALUE(ps.SnapshotJSON,'$.UnitUSDPrice')) FROM dbo.PalletPricingSnapshot ps WHERE ps.ID=response.PalletPricingID AND ps.ItemID=response.ID AND JSON_VALUE(ps.SnapshotJSON,'$.PalletSize')=response.ResponsePalletSize) WHEN response.LoadPlanID IS NOT NULL THEN (SELECT TRY_CONVERT(DECIMAL(19,6),JSON_VALUE(lp.Result,'$.PalletUnitUSDPrice')) FROM dbo.ContainerLoadPlan lp WHERE lp.ID=response.LoadPlanID AND lp.ItemID=response.ID) ELSE NULL END DefaultPalletUSDPerEA,
      COALESCE(response.ResponseLayerCount,response.RequestedLayerCount,i.PackagingLayerCount,1) LossLayerCount,
      CAST(CASE WHEN EXISTS(SELECT 1 FROM dbo.OpportunityItem c WHERE c.ParentItemID=i.ID) THEN 1 ELSE 0 END AS BIT) IsMixParent,
      CAST(CASE WHEN EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem active WHERE active.OpportunityItemID=i.ID AND active.IsOpen=1 AND active.Stage<>\'Canceled\') THEN 1 ELSE 0 END AS BIT) HasOpenPackagingRequest
      FROM dbo.OpportunityItem i JOIN dbo.Opportunity o ON o.ID=i.OpportunityID
      JOIN dbo.Product p ON p.ID=i.ProductID
      OUTER APPLY(SELECT TOP(1) r.ID,r.LoadPlanID,r.PalletPricingID,r.ResponseLayerCount,r.RequestedLayerCount,r.ResponsePalletSize
        FROM dbo.PackagingConfigurationRequestItem r WHERE r.OpportunityItemID=i.ID AND r.Stage<>'Canceled'
        ORDER BY r.IsOpen DESC,r.ID DESC) response
      WHERE i.ID=?;""", [ctx.username,item_id])[0]
    if not rows:
        raise HTTPException(404, "Opportunity item not found.")
    return rows[0]

def current_prices(grade_leaves, ctx):
    grade_ids = list({i.get("RawGradeID") for i in grade_leaves if i.get("RawGradeID")})
    rows = execute(AUTH + """
      SELECT p.ID PriceID,m.GradeID RawGradeID,m.ID MaterialID,m.MaterialCode,m.MaterialName,
       v.VendorName,p.QuantityFrom,p.QuantityTo,p.PriceBasis,p.UnitPrice,c.CurrencyCode,p.UnitUSDPrice,
       p.EffectiveFrom,p.EffectiveTo,p.ExchangeRateToUSD,
       CONVERT(VARCHAR(18),CONVERT(VARBINARY(8),p.RowVersion),1) PriceVersion,
       direct.Factor PriceToLbFactor,converted.Factor PriceToBaseFactor,m.UnitOfMeasure MaterialBaseUoM
      FROM dbo.RawMaterialPrice p JOIN dbo.RawMaterial m ON m.ID=p.MaterialID AND m.Status='Active'
      JOIN dbo.RawGrade g ON g.ID=m.GradeID AND g.Status='Active'
      JOIN dbo.Currency c ON c.ID=p.CurrencyID
      LEFT JOIN dbo.Vendor v ON v.ID=p.VendorID
      OUTER APPLY (SELECT TOP(1) conversion.Factor FROM dbo.UoM target
        CROSS APPLY dbo.fn_UnitConversion(p.PriceBasis,target.UoMCode,NULL,m.ID,p.VendorID) conversion
        WHERE UPPER(target.UoMCode) IN('LB','LBS') AND target.Status='Active' ORDER BY target.ID) direct
      OUTER APPLY dbo.fn_UnitConversion(p.PriceBasis,m.UnitOfMeasure,NULL,m.ID,p.VendorID) converted
      WHERE m.GradeID IN(SELECT CONVERT(INT,value) FROM OPENJSON(?))
       AND p.Status='Active' AND p.ExchangeRateToUSD>0
       AND (p.VendorID IS NULL OR v.Status='Active')
       AND p.EffectiveFrom<=CONVERT(DATE,SYSUTCDATETIME())
       AND (p.EffectiveTo IS NULL OR p.EffectiveTo>=CONVERT(DATE,SYSUTCDATETIME()))
      ORDER BY m.MaterialCode,v.VendorName,p.QuantityFrom,p.ID;""", [ctx.username,json.dumps(grade_ids)])[0]
    # Do arithmetic in Decimal rather than SQL DECIMAL(38) division, which can
    # reduce scale to six places and distort the kilogram-to-pound conversion.
    mass = {"LB":Decimal(1),"LBS":Decimal(1),"KG":Decimal(1)/Decimal("0.45359237"),
            "G":Decimal(1)/Decimal("453.59237"),"OZ":Decimal("0.0625")}
    for row in rows:
        factor = row["PriceToLbFactor"]
        if factor is None:
            factor = mass.get(str(row["PriceBasis"]).upper())
        if factor is None and row["PriceToBaseFactor"] is not None:
            base_factor = mass.get(str(row["MaterialBaseUoM"]).upper())
            if base_factor is not None:
                factor = row["PriceToBaseFactor"] * base_factor
        row["USDPerLb"] = row["UnitUSDPrice"] / factor if factor and row["UnitUSDPrice"] is not None else None
    return json.loads(json.dumps(rows,default=lambda v: str(v)))

def grade_leaves(item):
    try:
        snapshot = json.loads(item["ProductGradeSnapshot"] or "{}")
        return leaves(snapshot.get("items", []))
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(422,str(exc)) from exc

@router.get("/{item_id}/tcb")
def read(item_id: int = Path(ge=1),ctx: AccessContext=Depends(get_access_context)):
    require(ctx,"Opportunity")
    item = item_read(item_id,ctx)
    error, grades = "", []
    if not item["IsMixParent"]:
        try:
            grades = grade_leaves(item)
        except HTTPException as exc:
            error = exc.detail
    saved=json.loads(item["TCBCostInfo"] or "{}")
    saved.setdefault("Inputs",{})["PalletUSDPerEA"]=str(palletization_usd(item)) if palletization_usd(item) is not None else None
    return {"lossMasters":active_loss_masters(ctx),"item":item,"saved":saved,
            "grades":json.loads(json.dumps(grades,default=serial)),
            "prices":current_prices(grades,ctx) if grades else [],"gradeError":error}

class Save(BaseModel):
    model_config = ConfigDict(extra="forbid")
    RowVersion: str
    Inputs: Inputs

def apply_formula_variables(item,inputs):
    """Resolve master-backed names server-side; clients cannot supply their values."""
    if inputs.ProcessLosses is not None:
        inputs.LossProductPct=Decimal(0)
        return inputs
    if inputs.ProductLossFormula and inputs.ProductLossFormula.strip():
        from dimension_formula import _expression,_calculate
        steps=[s for s in inputs.LossProcesses or [] if s.ProcessType in ("Sorting","Processing")]
        values={"L"+str(i+1):s.LossPct/100 for i,s in enumerate(steps)}
        try:
            variables=_expression(inputs.ProductLossFormula,True,{*values,"NW"})[2]
            if "NW" in variables:
                weight=item.get("WeightGrams")
                if weight is None or Decimal(str(weight))<=0:
                    raise ValueError("NW requires a positive Opportunity Product net weight (g).")
                values["NW"]=Decimal(str(weight))
            inputs.LossProductPct=_calculate(inputs.ProductLossFormula,values,"Product loss",True,values,True)
        except ValueError as exc:
            raise HTTPException(422,str(exc).replace("D1, D2, D3","L1, L2, ..., NW")) from exc
    return inputs

def resolve_loss_assignments(item, inputs, ctx):
    """Preserve existing immutable steps; new/replaced steps must come from Master."""
    if inputs.LossProcesses is None: return apply_formula_variables(item,inputs)
    saved = json.loads(item.get("TCBCostInfo") or "{}").get("Inputs",{})
    previous = saved.get("LossProcesses")
    if previous is None:
        previous = []
        for field in LOSS_FIELDS:
            value = Decimal(str(saved.get(field) or 0))
            if value:
                previous.append(dict(ProcessType="Processing" if field=="LossProductPct"
                    else field.replace("LossPct","Packaging"),
                    Sequence=len(previous)+1,LossPct=str(value)))
    previous = [LossProcess(**row) for row in previous]
    def identity(step):
        return (step.ProcessType,step.MasterID,step.MasterVersion,step.ProcessName)
    masters=None
    resolved=[]
    for step in inputs.LossProcesses:
        basis=previous
        old=next((old for old in basis if identity(old)==identity(step)),None)
        if old:
            resolved.append({**old.model_dump(mode="json"),"Sequence":step.Sequence,"LossPct":str(step.LossPct)})
            continue
        if step.ProcessType not in ("Sorting","Processing") and step.MasterID is None:
            resolved.append(step.model_dump(mode="json"))
            continue
        if step.MasterID is None or step.MasterVersion is None:
            raise HTTPException(422,"Select a Loss Process Master entry for this loss group.")
        if masters is None:
            masters={row["MasterID"]:row for row in active_loss_masters(ctx)}
        master=masters.get(step.MasterID)
        if not master or master["MasterVersion"].lower()!=step.MasterVersion.lower():
            raise HTTPException(409,"Loss Process Master changed or is blocked. Refresh and select a current entry.")
        resolved.append({**master,"ProcessType":step.ProcessType,"Sequence":step.Sequence,"LossPct":str(step.LossPct)})
    try:
        return apply_formula_variables(item,Inputs(**{**inputs.model_dump(mode="json"),"LossProcesses":resolved}))
    except ValueError as exc:
        raise HTTPException(422,str(exc)) from exc

def palletization_usd(item):
    value=item.get("DefaultPalletUSDPerEA")
    return Decimal(str(value)) if not item.get("ParentItemID") and value is not None else None


def compute(item, inputs, ctx):
    apply_formula_variables(item,inputs)
    inputs.PalletUSDPerEA=palletization_usd(item)
    if inputs.LossProcesses is not None:
        packaging = ["PrimaryPackaging","SecondaryPackaging","TertiaryPackaging"]
        layer_count = int(item.get("LossLayerCount") or 1)
        allowed = {("Mix"+p if item["IsMixParent"] else p) for p in packaging[:layer_count]}
        if not item["IsMixParent"]:
            allowed.update(("Sorting","Processing"))
        if any(step.ProcessType not in allowed for step in inputs.LossProcesses):
            raise HTTPException(422,"Loss process is not applicable to this product or packaging layer count.")
    if item["IsMixParent"]:
        default = Inputs()
        product_keys = ("RMRatio","SeasoningUSDPerLb","SeasoningRatio","OilUSDPerLb",
                        "OilPct","ProcessingUSDPerLb","LossProductPct","ProductLossFormula")
        if inputs.Prices or inputs.MaterialCosts or inputs.ProcessLosses or any(getattr(inputs,k)!=getattr(default,k) for k in product_keys):
            raise HTTPException(422,"Product costing applies to regular products and Mix children, not Mix parents.")
        return {"RMCostUSDPerLb":None,"ProductUSDPerLb":None,"PriceSnapshots":[]}
    try:
        grades = grade_leaves(item)
        from tcb_costs import trim_process_recipes
        trim_process_recipes(inputs,json.loads(item.get("ProductGradeSnapshot") or "{}").get("items",[]),grades)
        prices = {p["PriceID"]:p for p in current_prices(grades,ctx)}
        return calculate(inputs,grades,prices,weight=item.get("WeightGrams"))
    except ValueError as exc:
        raise HTTPException(422,str(exc)) from exc

@router.post("/{item_id}/tcb/preview")
def preview(body: Save,item_id: int = Path(ge=1),ctx: AccessContext=Depends(get_access_context)):
    require(ctx,"Opportunity")
    item=item_read(item_id,ctx)
    inputs=resolve_loss_assignments(item,body.Inputs,ctx)
    return compute(item,inputs,ctx)

@router.post("/{item_id}/tcb")
def save(body: Save,item_id: int = Path(ge=1),ctx: AccessContext=Depends(get_access_context)):
    require(ctx,"Opportunity")
    version = rv(body.RowVersion)
    item = item_read(item_id,ctx)
    if item["RowVersion"] != body.RowVersion:
        raise HTTPException(409,"Opportunity item changed. Refresh before saving TCB.")
    if item["ItemStage"] != "Draft" or item["HeaderStage"] != "Draft":
        raise HTTPException(409,"Only Draft Opportunity items can edit TCB.")
    body.Inputs = resolve_loss_assignments(item,body.Inputs,ctx)
    results = compute(item,body.Inputs,ctx)
    value = {"Inputs":body.Inputs.model_dump(mode="json"),**results,
             "GradeSnapshot":json.loads(item["ProductGradeSnapshot"] or "{}")}
    row = execute("EXEC dbo.usp_OpportunityTCB_Save ?,?,?,?",
                  [ctx.username,item_id,version,json.dumps(value,default=serial)])[0][0]
    return {"saved":value,"RowVersion":row["RowVersion"]}

class LossSave(BaseModel):
    model_config = ConfigDict(extra="forbid")
    RowVersion: str
    Inputs: Inputs

@router.post("/{item_id}/loss-processes")
def save_losses(body: LossSave,item_id: int = Path(ge=1),ctx: AccessContext=Depends(get_access_context)):
    """Update only item loss inputs; no material price selection is required."""
    require(ctx,"Opportunity")
    item=item_read(item_id,ctx)
    if item["RowVersion"]!=body.RowVersion or item["ItemStage"]!="Draft" or item["HeaderStage"]!="Draft":
        raise HTTPException(409,"Item changed or is no longer Draft. Refresh before saving losses.")
    if item["IsMixParent"] and body.Inputs.ProductLossFormula:
        raise HTTPException(422,"Product loss formula applies to child products, not Mix parents.")
    if body.Inputs.LossProcesses is None:
        raise HTTPException(422,"Submit item loss processes, including an empty list to remove all.")
    inputs=resolve_loss_assignments(item,Inputs(LossProcesses=body.Inputs.LossProcesses,ProductLossFormula=body.Inputs.ProductLossFormula),ctx)
    allowed={"Mix"+p if item["IsMixParent"] else p for p in
             ["PrimaryPackaging","SecondaryPackaging","TertiaryPackaging"][:int(item.get("LossLayerCount") or 1)]}
    if not item["IsMixParent"]: allowed.update(("Sorting","Processing"))
    if any(step.ProcessType not in allowed for step in inputs.LossProcesses or []):
        raise HTTPException(422,"Loss process is not applicable to this item or packaging layer.")
    value=json.loads(item.get("TCBCostInfo") or "{}")
    previous=value.get("Inputs",{})
    value["Inputs"]={**previous,"ProductLossFormula":inputs.ProductLossFormula,**{field:str(getattr(inputs,field)) for field in LOSS_FIELDS},
                    "LossProcesses":[step.model_dump(mode="json") for step in inputs.LossProcesses or []]}
    value["Inputs"]["PalletUSDPerEA"]=palletization_usd(item)
    row=execute("EXEC dbo.usp_OpportunityTCB_Save ?,?,?,?,?",
                [ctx.username,item_id,rv(body.RowVersion),json.dumps(value,default=serial),1])[0][0]
    return {"saved":value,"RowVersion":row["RowVersion"]}

@router.post("/{item_id}/loss-formula")
def preview_loss_formula(body: LossSave,item_id: int = Path(ge=1),ctx: AccessContext=Depends(get_access_context)):
    require(ctx,"Opportunity")
    item=item_read(item_id,ctx)
    if item.get("RowVersion") and item["RowVersion"]!=body.RowVersion:
        raise HTTPException(409,"Opportunity item changed. Refresh before testing the formula.")
    inputs=apply_formula_variables(item,body.Inputs)
    try:
        from grade_process_loss import process_loss_results
        results=process_loss_results(inputs.ProcessLosses,len([s for s in inputs.LossProcesses or [] if s.ProcessType in ("Processing","Sorting")]),item.get("WeightGrams"))
    except ValueError as exc:raise HTTPException(422,str(exc)) from exc
    return {"LossProductPct":str(inputs.LossProductPct),"ProcessLossSnapshots":results}

# Opportunity workspace: grade copies and existing material quote selections.
from product_grades import OpportunityGradeTree
from tcb_costs import Selection,Inputs as CommercialInputs
from pydantic import Field
from db import get_raw_cursor,bytes_to_b64
from packaging_fields import consume,sql_error
from opportunity_grade_snapshot import validate_snapshot

class CommercialSave(BaseModel):
    model_config = ConfigDict(extra="forbid")
    RowVersion: str
    CostInputs: CommercialInputs | None = None
    Grades: OpportunityGradeTree | None = None
    Prices: list[Selection] | None = Field(None,max_length=1000)
    Inputs: CommercialInputs | None = None

def commercial_value(body,item,ctx,cursor):
    if item["RowVersion"]!=body.RowVersion:
        raise HTTPException(409,"Opportunity item changed. Refresh before reviewing.")
    value=json.loads(item.get("TCBCostInfo") or "{}")
    snapshot=json.loads(item.get("ProductGradeSnapshot") or "{}")
    if body.Grades is not None:
        if item["IsMixParent"]: raise HTTPException(422,"Mix parent grades belong to its children.")
        if item.get("HasOpenPackagingRequest"): raise HTTPException(409,"Grades are captured by an active Packaging Request.")
        snapshot=body.Grades.model_dump(mode="json")
        validate_snapshot(cursor,snapshot)
    old=value.get("Inputs",{})
    new={**old}
    if body.CostInputs is not None:
        fields=["PalletUSDPerEA"] if item["IsMixParent"] else ["ProcessLosses","MaterialCosts","RMRatio","SeasoningUSDPerLb","SeasoningRatio","OilUSDPerLb","OilPct","ProcessingUSDPerLb","PalletUSDPerEA"]
        new.update({field:body.CostInputs.model_dump(mode="json")[field] for field in fields})
    if body.Inputs is not None:
        new.update(ProductLossFormula=body.Inputs.ProductLossFormula,
                   LossProcesses=[s.model_dump(mode="json") for s in body.Inputs.LossProcesses or []])
    if body.Prices is not None:
        new["Prices"]=[p.model_dump(mode="json") for p in body.Prices]
    elif body.Grades is not None:
        new["Prices"]=[]
    new["PalletUSDPerEA"]=palletization_usd(item)
    inputs=resolve_loss_assignments(item,Inputs(**new),ctx)
    allowed={"Mix"+p if item["IsMixParent"] else p for p in ["PrimaryPackaging","SecondaryPackaging","TertiaryPackaging"][:int(item.get("LossLayerCount") or 1)]}
    if not item["IsMixParent"]: allowed.update(("Sorting","Processing"))
    if any(s.ProcessType not in allowed for s in inputs.LossProcesses or []):
        raise HTTPException(422,"Loss process does not apply to this item or packaging layer.")
    if item["IsMixParent"]:
        results=compute(item,inputs,ctx);grade_list=[];prices=[]
    else:
        grade_list=leaves(snapshot.get("items",[])) if snapshot.get("items") else []
        prices=current_prices(grade_list,ctx) if grade_list else []
        if inputs.Prices and not grade_list: raise HTTPException(422,"Maintain grades before selecting raw prices.")
        from tcb_costs import trim_process_recipes,process_paths
        trim_process_recipes(inputs,snapshot.get("items",[]),grade_list)
        if {r.Path for r in inputs.MaterialCosts} - process_paths(grade_list):
            raise ValueError("Material costing refers to a removed or non-leaf grade. Refresh grades.")
        # Validate every selected quote, even when some leaves remain unpriced.
        partial=Inputs(**{**inputs.model_dump(mode="json"),"RMRatio":0,"SeasoningRatio":100,
                         "SeasoningUSDPerLb":0,"OilPct":0,"MaterialCosts":[]})
        results=calculate(partial,grade_list,{p["PriceID"]:p for p in prices},allow_unpriced=True,weight=item.get("WeightGrams"))
        if grade_list and len(inputs.Prices)==len(grade_list):
            results=calculate(inputs,grade_list,{p["PriceID"]:p for p in prices},weight=item.get("WeightGrams"))
        else:
            results.update(RMCostUSDPerLb=None,ProductUSDPerLb=None,MaterialCostSnapshots=[])
    value={**value,**results,"Inputs":inputs.model_dump(mode="json"),"GradeSnapshot":snapshot}
    return value,snapshot,grade_list,prices

@router.post("/{item_id}/commercial/preview")
def commercial_preview(body:CommercialSave,item_id:int=Path(ge=1),ctx:AccessContext=Depends(get_access_context)):
    require(ctx,"Opportunity");item=item_read(item_id,ctx)
    try:
        with get_raw_cursor() as cursor:
            cursor.execute("BEGIN TRANSACTION")
            try:
                value,snapshot,grades,prices=commercial_value(body,item,ctx,cursor)
            finally:
                cursor.execute("IF @@TRANCOUNT>0 ROLLBACK")
        return {"saved":value,"snapshot":snapshot,"grades":json.loads(json.dumps(grades,default=serial)),
                "prices":prices,"LossProductPct":str(value["Inputs"].get("LossProductPct",0))}
    except ValueError as exc: raise HTTPException(422,str(exc)) from exc

@router.post("/{item_id}/commercial")
def commercial_save(body:CommercialSave,item_id:int=Path(ge=1),ctx:AccessContext=Depends(get_access_context)):
    require(ctx,"Opportunity");item=item_read(item_id,ctx)
    if item["ItemStage"]!="Draft" or item["HeaderStage"]!="Draft":
        raise HTTPException(409,"Only Draft Opportunity items can edit commercial inputs.")
    try:
        with get_raw_cursor() as cursor:
            cursor.execute("BEGIN TRANSACTION")
            try:
                locked=cursor.execute("SELECT RowVersion FROM dbo.OpportunityItem WITH(UPDLOCK,HOLDLOCK) WHERE ID=?",item_id).fetchone()
                if not locked or bytes_to_b64(locked[0])!=body.RowVersion:
                    raise HTTPException(409,"Opportunity item changed. Refresh before saving.")
                value,snapshot,grades,prices=commercial_value(body,item,ctx,cursor)
                if body.Grades is not None:
                    cursor.execute("EXEC dbo.usp_OpportunityItem_Fields_Save ?,?,?,?,?",
                                   ctx.username,item_id,rv(body.RowVersion),json.dumps({"ProductGradeSnapshot":snapshot}),0)
                    consume(cursor)
                current=cursor.execute("SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?",item_id).fetchval()
                cursor.execute("EXEC dbo.usp_OpportunityTCB_Save ?,?,?,?,?",
                               ctx.username,item_id,current,json.dumps(value,default=serial),0)
                result=consume(cursor)[0][0]
                cursor.execute("COMMIT TRANSACTION")
            except Exception:
                cursor.execute("IF @@TRANCOUNT>0 ROLLBACK")
                raise
        return {"saved":value,"snapshot":snapshot,"grades":json.loads(json.dumps(grades,default=serial)),
                "prices":prices,"RowVersion":bytes_to_b64(result["RowVersion"])}
    except HTTPException: raise
    except Exception as exc:
        detail=str(exc) if isinstance(exc,ValueError) else sql_error(exc)
        if detail: raise HTTPException(409 if "52997" in str(exc) else 422,detail) from exc
        raise HTTPException(500,"Opportunity commercial save failed; contact support.") from exc
