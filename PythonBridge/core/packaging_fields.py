"""Shared additional-field contracts and atomic saves over existing business procedures."""
import json
import re
from decimal import Decimal
from pydantic import BaseModel, Field, model_validator, field_validator
from product_grades import InitialGrade, OpportunityGradeTree
from shipment_fields import ShipmentCostInfo as ShipmentCostModel
from fastapi import HTTPException
from db import get_raw_cursor
from typing import Literal

ContainerType = Literal["20DC", "40DC", "40HC", "20RC", "40RHC"]

class ContainerLoadProfile(BaseModel):
    model_config = {"extra": "forbid"}
    CartonsPerContainer: int | None = Field(None, ge=1, le=2147483647)
    LayersPerContainer: int | None = Field(None, ge=0, le=2147483647)
    PalletsPerContainer: int | None = Field(None, ge=0, le=2147483647)
    CartonsPerContainerFloor: int | None = Field(None, ge=1, le=2147483647)

    @field_validator("LayersPerContainer", "PalletsPerContainer", "CartonsPerContainerFloor", "CartonsPerContainer", mode="before")
    @classmethod
    def whole_count(cls, value):
        if isinstance(value, bool):
            raise ValueError("Container counts must be whole numbers, not True/False.")
        return value

PRODUCT_FIELDS = ["Category", "ShelfLifeDays"]
class ProductFields(BaseModel):
    Category: str | None = Field(None, max_length=100)
    ShelfLifeDays: int | None = Field(None, ge=0, le=2147483647)
    GradeVersion: InitialGrade | None = None

    @model_validator(mode="before")
    @classmethod
    def retired_fields(cls, values):
        if isinstance(values, dict) and any(values.get(k) not in (None, "") for k in ("Grade", "MixRatioPct")):
            raise ValueError("Maintain Grade and Ratio in Product Grade versions. Download a fresh workbook.")
        return values

OPPORTUNITY_FIELDS = ["CurrencyID","ExchangeRateToVND","ExchangeRateVNDPerUSD","ExchangeRateCustomerCurrencyPerUSD"]
class HeaderFields(BaseModel):
    ExchangeRateVNDPerUSD: Decimal | None = Field(None, max_digits=19, decimal_places=6, gt=0, allow_inf_nan=False)
    ExchangeRateCustomerCurrencyPerUSD: Decimal | None = Field(None, max_digits=19, decimal_places=6, gt=0, allow_inf_nan=False)
    CurrencyID: int | None = Field(None, ge=1)
    ExchangeRateToVND: Decimal | None = Field(None, max_digits=19, decimal_places=6, gt=0, allow_inf_nan=False)

PARENT_LOGISTICS_FIELDS = {"PalletSize","PalletStacking","MaxPalletHeightM","ContainerRequest","ConfigurationRequest"}
OPPORTUNITYITEM_FIELDS = ["PalletSize","PalletStacking","MaxPalletHeightM","ContainerRequest","ConfigurationRequest","PackagingType","RecyclableRequirement","RecycledContent","Transparency","MetalizedAluminum","SpecialComments"]
# Web-only extensions: keep existing Layout and Excel field lists unchanged.
WEB_ITEM_FIELDS = ["PrimaryTypeID", "SecondaryTypeID", "SecondaryTransparency", "NumberOfPrimary", "WebPackagingRequirements",
                  "PackagingLayerCount", "TertiaryTypeID", "TertiaryTransparency", "NumberOfSecondary"]
WEB_ITEM_FIELDS += ["MaxPalletHeightMM","ProductGradeSnapshot","SecondaryRecyclableRequirement","SecondaryRecycledContent","SecondaryMetalizedAluminum","SecondarySpecialComments","TertiaryRecyclableRequirement","TertiaryRecycledContent","TertiaryMetalizedAluminum","TertiarySpecialComments"]
PARENT_LOGISTICS_FIELDS.add("MaxPalletHeightMM")
WEB_ITEM_FIELDS.append("ShipmentCostInfo")
class ItemFields(BaseModel):
    NetWeightGrams: Decimal | None = Field(None, gt=0, max_digits=10, decimal_places=2, allow_inf_nan=False)
    RefreshProductWeight: bool = Field(False, strict=True)

    @field_validator("NetWeightGrams", mode="before")
    @classmethod
    def numeric_weight(cls, value):
        if isinstance(value, bool):
            raise ValueError("Net weight must be a number, not True/False.")
        return value

    ShipmentCostInfo: ShipmentCostModel | None = None
    MaxPalletHeightMM: int | None = Field(None, ge=1, le=999999999)
    ProductGradeSnapshot: OpportunityGradeTree | None = None
    SecondaryRecyclableRequirement: str | None = Field(None, max_length=200)
    SecondaryRecycledContent: str | None = Field(None, max_length=200)
    SecondaryMetalizedAluminum: str | None = Field(None, max_length=100)
    SecondarySpecialComments: str | None = Field(None, max_length=1000)
    TertiaryRecyclableRequirement: str | None = Field(None, max_length=200)
    TertiaryRecycledContent: str | None = Field(None, max_length=200)
    TertiaryMetalizedAluminum: str | None = Field(None, max_length=100)
    TertiarySpecialComments: str | None = Field(None, max_length=1000)
    PackagingLayerCount: int | None = Field(None,ge=1,le=3)
    TertiaryTypeID: int | None = Field(None,ge=1,le=2147483647)
    TertiaryTransparency: str | None = Field(None,max_length=100)
    NumberOfSecondary: int | None = Field(None,ge=1,le=2147483647)
    PrimaryTypeID: int | None = Field(None, ge=1, le=2147483647)
    SecondaryTypeID: int | None = Field(None, ge=1, le=2147483647)
    SecondaryTransparency: str | None = Field(None, max_length=100)
    NumberOfPrimary: int | None = Field(None, ge=1, le=2147483647)
    WebPackagingRequirements: bool = False
    PalletSize: str | None = Field(None, max_length=100)
    PalletStacking: str | None = Field(None, max_length=100)
    MaxPalletHeightM: Decimal | None = Field(None, max_digits=9, decimal_places=3, gt=0, allow_inf_nan=False)
    ContainerRequest: str | None = Field(None, max_length=200)
    ConfigurationRequest: str | None = Field(None, max_length=500)
    PackagingType: str | None = Field(None, max_length=100)
    RecyclableRequirement: str | None = Field(None, max_length=200)
    RecycledContent: str | None = Field(None, max_length=200)
    Transparency: str | None = Field(None, max_length=100)
    MetalizedAluminum: str | None = Field(None, max_length=100)
    SpecialComments: str | None = Field(None, max_length=1000)

    @model_validator(mode="before")
    @classmethod
    def retired_requirements(cls, values):
        if isinstance(values, dict) and any(k in values for k in ("BarrierRequirement", "ShelfLifeDays")):
            raise ValueError("Barrier requirement is retired. Shelf life is read-only from Product Master. Download a fresh workbook.")
        return values

RETIRED_RESPONSE_COLUMNS = {"BarrierRequirement", "PalletType", "PMCost", "PMCostCurrencyCode", "LayersPerContainer", "CartonsPerContainerFloor", "NetWeightPerContainerFloorKG"}
PACKAGINGCONFIGURATIONREQUESTITEM_FIELDS = ["FirstPMType","SecondPMType","UnitsPerCarton","PackagingDescription","FirstPMMOQ","SecondPMMOQ","CartonsPerLayer","LayersPerPallet","PacksPerPallet","CartonsPerContainer"]
WEB_RESPONSE_FIELDS = ["NutDensity","ResponseLayerCount","ThirdPMType","ThirdPMMOQ","UnitsPerTertiary",
                       "LayersPerContainer","PalletsPerContainer","CartonsPerContainerFloor",
                       "ResponsePalletSize","ResponsePalletStacking","ResponseMaxPalletHeightMM","HeightMM"]
WEB_RESPONSE_FIELDS += ["ResponsePalletMaterialID","SelectedContainerType", "ContainerLoadProfiles", "SameConfig", "ApplicableNetWeightGrams"]
class ResponseFields(BaseModel):
    LoadPlanID: int | None = Field(None, ge=1)
    ContainerLoadPlanIDs: dict[int,int] | None = Field(None,max_length=100)
    PalletPricingID: int | None = Field(None, ge=1)
    ResponsePalletMaterialID:int|None=Field(None,ge=1)
    ApplicableNetWeightGrams: Decimal | None = Field(None, max_digits=18, decimal_places=6, ge=0, allow_inf_nan=False)
    NutDensityDefaultUpdate: bool = Field(False, strict=True)
    NutDensityDefaultRowVersion: str | None = None
    SameConfig: bool | None = Field(None, strict=True)
    SelectedContainerType: ContainerType | None = None
    ContainerLoadProfiles: dict[ContainerType, ContainerLoadProfile] | None = None
    ResponsePalletSize: str | None = Field(None, max_length=100)
    ResponsePalletStacking: str | None = Field(None, max_length=100)
    ResponseMaxPalletHeightMM: int | None = Field(None, ge=1, le=999999999)
    LayersPerContainer: int | None = Field(None, ge=0, le=2147483647)
    PalletsPerContainer: int | None = Field(None, ge=0, le=2147483647)
    CartonsPerContainerFloor: int | None = Field(None, ge=1, le=2147483647)
    ResponseLayerCount: int | None = Field(None,ge=1,le=3)
    ThirdPMType: str | None = Field(None,max_length=100)
    ThirdPMMOQ: Decimal | None = Field(None,max_digits=18,decimal_places=4,ge=0,allow_inf_nan=False)
    UnitsPerTertiary: int | None = Field(None,ge=1,le=2147483647)
    NutDensity: Decimal | None = Field(None, max_digits=18, decimal_places=6, gt=0, allow_inf_nan=False)
    FirstPMType: str | None = Field(None, max_length=100)
    SecondPMType: str | None = Field(None, max_length=100)
    UnitsPerCarton: int | None = Field(None, ge=1, le=2147483647)
    PackagingDescription: str | None = Field(None, max_length=500)
    FirstPMMOQ: Decimal | None = Field(None, max_digits=18, decimal_places=4, ge=0, allow_inf_nan=False)
    SecondPMMOQ: Decimal | None = Field(None, max_digits=18, decimal_places=4, ge=0, allow_inf_nan=False)
    CartonsPerLayer: int | None = Field(None, ge=1, le=2147483647)
    LayersPerPallet: int | None = Field(None, ge=1, le=2147483647)
    PacksPerPallet: int | None = Field(None, ge=1)
    CartonsPerContainer: int | None = Field(None, ge=1, le=2147483647)

    @model_validator(mode="after")
    def legacy_pallet_count(self):
        if self.PalletsPerContainer == 0 and not self.SelectedContainerType:
            raise ValueError("Select a container type for a zero Pallet Master capacity.")
        if self.LayersPerContainer == 0 and not self.SelectedContainerType:
            raise ValueError("Select a container type for a calculated zero layer count.")
        return self


FIELDS = {"Product": PRODUCT_FIELDS, "Opportunity": OPPORTUNITY_FIELDS,
          "OpportunityItem": [*OPPORTUNITYITEM_FIELDS, *WEB_ITEM_FIELDS],
          "PackagingConfigurationRequestItem": [*PACKAGINGCONFIGURATIONREQUESTITEM_FIELDS, *WEB_RESPONSE_FIELDS]}

def additional(row, kind):
    values = row.model_dump(mode="json", by_alias=True, exclude_unset=True)
    return {k: values[k] for k in FIELDS[kind] if k in values and not (kind=="PackagingConfigurationRequestItem" and k=="ResponsePalletMaterialID")}

def consume(cursor):
    results=[]
    while True:
        if cursor.description:
            keys=[c[0] for c in cursor.description]
            results.append([dict(zip(keys,r)) for r in cursor.fetchall()])
        try:
            more=cursor.nextset()
        except Exception as exc:
            # Legacy procedures roll back the caller transaction on a rejected
            # document. SQL then emits 266 after the actual row-error result sets.
            # Preserve those errors, never treat an unclassified 266 as success.
            if "(266)" in str(exc) and any(r.get("Status")=="ERROR" for rows in results for r in rows):
                return results
            raise
        if not more:
            return results

def sql_error(exc):
    message=str(exc)
    if any(str(code) in message for code in (*range(52951,52964),52964,52982,52996,52997,52998)):
        match=re.search(r"\[SQL Server\](.*?)(?:\s*\(529\d+\))",message)
        return match.group(1).strip() if match else "Check required fields, exchange rate, ownership and processing locks."
    if "(547)" in message:
        return "Invalid value or reference. Check currency, exchange rate and numeric ranges."
    return None

def enriched_batch(proc, groups, scalar_params, models, kinds):
    """One transaction for original fields + extensions; never commit a partial save."""
    if kinds == ["Opportunity","OpportunityItem"]:
        from shipment_fields import validate_new_shipment
        validate_new_shipment(models[1])
    with get_raw_cursor() as cursor:
        cursor.execute("SET XACT_ABORT ON; BEGIN TRANSACTION")
        try:
            child_results = []
            if kinds == ["Opportunity","OpportunityItem"]:
                for model in models[1]:
                    if model.command=="U" and model.product_id and "ProductGradeSnapshot" not in model.model_fields_set:
                        old=cursor.execute("SELECT ProductID FROM dbo.OpportunityItem WITH(UPDLOCK,HOLDLOCK) WHERE ID=?",model.id).fetchval()
                        if old is not None and old!=model.product_id:
                            model.ProductGradeSnapshot=None
                from opportunity_mix import split_child_edits
                from shipment_fields import split_shipment_edits
                remaining, shipment_results = split_shipment_edits(cursor, models[1], scalar_params[0])
                normal, child_results = split_child_edits(cursor, remaining, scalar_params[0])
                child_results.extend(shipment_results)
                nums = {r.row_num for r in normal}
                groups = [groups[0], [r for r in groups[1] if r[0] in nums]]
                models_for_save = [models[0], normal]
            else:
                models_for_save = models
            placeholders=",".join("?" for _ in range(len(groups)+len(scalar_params)))
            if any(groups):
                cursor.execute("{CALL "+proc+" ("+placeholders+")}", *groups, *scalar_params)
                sets=consume(cursor)
            else:
                sets=[[] for _ in groups]
            if len(sets)!=len(groups):
                failures=[r for rows in sets for r in rows if r.get("Status")=="ERROR"]
                if failures:
                    cursor.execute("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION")
                    return [[dict(RowNum=r.row_num,Status="ERROR",Message=failures[0].get("Message","Document rolled back."),NewID=None,NewRowVersion=None) for r in source] for source in models]
                raise RuntimeError("Unexpected batch result sets")
            if any(r.get("Status")!="OK" for s in sets for r in s):
                cursor.execute("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION")
                for s in sets:
                    for r in s:
                        if r.get("Status")=="OK":
                            r.update(Status="ERROR",Message="Document rolled back because another row failed.",NewID=None,NewRowVersion=None)
                if child_results:
                    sets[1].extend(dict(r,Status="ERROR",Message="Document rolled back because another row failed.",
                                        NewID=None,NewRowVersion=None) for r in child_results)
                return sets
            for rows,source,kind in zip(sets,models_for_save,kinds):
                by_num={r.row_num:r for r in source}
                for result in rows:
                    model=by_num[result["RowNum"]]
                    if model.command=="D":
                        continue
                    extra=additional(model,kind)
                    if kind=="OpportunityItem":
                        if model.command=="C" and "ProductGradeSnapshot" not in extra:
                            extra["ProductGradeSnapshot"]=None
                        if extra.get("ProductGradeSnapshot") is not None:
                            from opportunity_grade_snapshot import validate_snapshot
                            validate_snapshot(cursor,extra["ProductGradeSnapshot"])
                    if kind=="OpportunityItem" and (model.command=="C" or model.MixChildren or model.MixVersionID):
                        from opportunity_mix import save_new_child_requirements
                        save_new_child_requirements(cursor, model, result, scalar_params[0])
                    if kind=="OpportunityItem":
                        from opportunity_item_weight import save_item_weight
                        save_item_weight(cursor,model,result,scalar_params[0])
                    if not extra and not (kind=="Product" and model.command=="C"):
                        continue
                    cursor.execute("EXEC dbo.usp_"+kind+"_Fields_Save ?,?,?,?,?",
                        scalar_params[0],result["NewID"],result["NewRowVersion"],json.dumps(extra),int(model.command=="C"))
                    updated=consume(cursor)
                    result["NewRowVersion"]=updated[0][0]["RowVersion"]
                    if kind=="Product" and model.command=="C" and model.GradeVersion is not None:
                        grade=model.GradeVersion
                        cursor.execute("EXEC dbo.usp_ProductGrade_Save ?,?,NULL,NULL,?,?,?",
                            result["NewID"],scalar_params[0],result["NewRowVersion"],grade.Status,
                            json.dumps([i.model_dump(mode="json") for i in grade.items]))
                        result["NewRowVersion"]=consume(cursor)[0][0]["ProductRowVersion"]
                    if kind=="Product" and model.command=="C" and getattr(model,"MixVersion",None) is not None:
                        from packaging_api import rv
                        mix=model.MixVersion
                        items=[dict(ProductID=i.ProductID,UnitQuantity=str(i.UnitQuantity),
                                    RowVersion="0x"+rv(i.RowVersion).hex()) for i in mix.items]
                        cursor.execute("EXEC dbo.usp_ProductMix_Save ?,?,NULL,NULL,?,?,?",
                            result["NewID"],scalar_params[0],result["NewRowVersion"],mix.Status,json.dumps(items))
                        result["NewRowVersion"]=consume(cursor)[0][0]["ProductRowVersion"]
            if kinds == ["Opportunity","OpportunityItem"]:
                sets[1].extend(child_results)
                for result in sets[1]:
                    if result.get("NewID") and result.get("NewRowVersion"):
                        cursor.execute("SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?", result["NewID"])
                        result["NewRowVersion"] = cursor.fetchval()
                sets[1].sort(key=lambda r:r["RowNum"])
            cursor.execute("COMMIT TRANSACTION")
            return sets
        except Exception as exc:
            cursor.execute("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION")
            message=str(exc) if isinstance(exc, ValueError) else sql_error(exc)
            if message:
                return [[dict(RowNum=r.row_num,Status="ERROR",Message=message,NewID=None,NewRowVersion=None)
                         for r in source] for source in models]
            raise
def enriched_response(payload, ctx):
    # Import lazily: packaging_api imports the field models.
    from packaging_api import tvp_sql, RESPONSE, rv
    docs=[]
    for row in payload.rows:
        doc=row.model_dump(mode="json")
        doc["RowVersionB64"]="0x"+rv(doc.pop("RowVersion")).hex()
        docs.append(doc)
    if len({r.ID for r in payload.rows})!=len(payload.rows) or len({r.RowNum for r in payload.rows})!=len(payload.rows):
        raise HTTPException(422,"Duplicate response IDs or row numbers.")
    documents_by_id = {d["ID"]: d for d in docs}
    prepared = {row.ID:row for row in payload.rows}
    with get_raw_cursor() as cursor:
        owns_transaction=cursor.execute('SELECT @@TRANCOUNT').fetchval()==0
        cursor.execute('SET XACT_ABORT ON; '+('BEGIN TRANSACTION' if owns_transaction else 'SAVE TRANSACTION ResponseCalculation'))
        try:
            # Retired cost columns must survive unrelated response edits. Lock the
            # original rows in ID order; SQL still enforces version, stage and PIC.
            cursor.execute("DECLARE @Actor INT; EXEC dbo.usp_Packaging_Authorize ?,'Read',@Actor OUTPUT;", ctx.username)
            consume(cursor)
            from response_load_plan import lock_response_roots,response_dependencies,invalidate_changed_plans
            lock_response_roots(cursor,[row.ID for row in payload.rows])
            from mix_same_config import validate_group_batch
            validate_group_batch(cursor, payload.rows)
            dependencies=response_dependencies(cursor,[row.ID for row in payload.rows])
            for row in sorted(payload.rows, key=lambda r: r.ID):
                cursor.execute("SELECT Cost,CurrencyID,CostBasis,FirstPMMOQ,FirstPMType,SecondPMMOQ,SecondPMType,ThirdPMMOQ,ThirdPMType,ResponseLayerCount,RequestedLayerCount,HeightMM,PICUserID,Stage,WidthMM,LengthMM FROM dbo.PackagingConfigurationRequestItem WITH(UPDLOCK,HOLDLOCK) WHERE ID=?", row.ID)
                original = cursor.fetchone()
                if original is None:
                    raise HTTPException(409, "Response item no longer exists. Refresh before saving.")
                if not ctx.is_admin and original[12] != ctx.user_id:
                    raise HTTPException(403, "Only the assigned PIC or Admin can edit this response.")
                if original[13] not in ("Assigned", "Working", "Returned"):
                    raise HTTPException(409, "This response stage is locked. Refresh before saving.")
                if original is not None:
                    for field,value in zip(('WidthMM','LengthMM'),original[14:16]):
                        if field not in row.model_fields_set:documents_by_id[row.ID][field]=str(value) if value is not None else None
                    if 'HeightMM' not in row.model_fields_set:
                        documents_by_id[row.ID]['HeightMM']=str(original[11]) if original[11] is not None else None
                    for key, value in zip(("Cost", "CurrencyID", "CostBasis"), original[:3]):
                        if key in row.model_fields_set and getattr(row, key) != value:
                            raise HTTPException(422, "PM cost and Cost basis are retired. Download a fresh workbook.")
                        documents_by_id[row.ID][key] = str(value) if isinstance(value, Decimal) else value
                    layers=(row.ResponseLayerCount if 'ResponseLayerCount' in row.model_fields_set else original[9]) or original[10]
                    # A null-height legacy row has no geometry to clear; preserve its old count.
                    updates={}
                    if row.HeightMM is None and original[11] is None:
                        row=row.model_copy()
                        row.model_fields_set.discard('HeightMM')
                    for level,(order,moq_field,type_field,index) in enumerate((('Primary','FirstPMMOQ','FirstPMType',3),('Secondary','SecondPMMOQ','SecondPMType',5),('Tertiary','ThirdPMMOQ','ThirdPMType',7)),1):
                        calculation=next((p for p in row.PricingCalculations or [] if p.PackagingOrder==order),None)
                        if calculation and (level>layers or (calculation.LayerCount is not None and calculation.LayerCount!=layers)):
                            raise HTTPException(422,'Calculator order/layers must match the confirmed response layers.')
                        if level>layers:
                            if original[index] is not None or moq_field in row.model_fields_set:
                                updates[moq_field]=None
                            if original[index+1] is not None or type_field in row.model_fields_set:
                                updates[type_field]=None
                            continue
                        if calculation:
                            from pkg_pricing_api import calculate
                            try:
                                result=calculate(cursor,ctx,row.ID,calculation,True,rv(row.RowVersion))
                            except ValueError as exc:
                                raise HTTPException(422,str(exc)) from exc
                            if calculation.Fingerprint!=result['Fingerprint']:
                                raise HTTPException(409,'Pricing inputs or master data changed. Recalculate before saving.')
                            if moq_field in row.model_fields_set and getattr(row,moq_field)!=Decimal(result['FinalMOQ']):
                                raise HTTPException(422,order+' MOQ unit is calculator-controlled.')
                            updates[moq_field]=Decimal(result['FinalMOQ'])
                            if result.get('FinalLayerHeightMM') is not None:
                                height=Decimal(result['FinalLayerHeightMM'])
                                if 'HeightMM' in row.model_fields_set and row.HeightMM is not None and row.HeightMM!=height:
                                    raise HTTPException(422,'Height (mm) must match the last Shipping layer pricing D3.')
                                updates['HeightMM']=height
                                documents_by_id[row.ID]['HeightMM']=str(height)
                        else:
                            if moq_field in row.model_fields_set and getattr(row,moq_field)!=original[index]:
                                raise HTTPException(422,order+' MOQ unit is calculator-controlled. Apply a pricing calculation.')
                            if type_field in row.model_fields_set and getattr(row,type_field)!=original[index+1]:
                                updates[moq_field]=None
                    prepared[row.ID]=row.model_copy(update=updates)
            cursor.execute(tvp_sql("PackagingResponseBatchType",RESPONSE)+"EXEC dbo.usp_PackagingResponse_Batch @Rows,?;",json.dumps(docs),ctx.username)
            result=consume(cursor)[0]
            by_num={r.RowNum:prepared[r.ID] for r in payload.rows}
            for saved in result:
                row=by_num[saved["RowNum"]]
                extra=additional(row,"PackagingConfigurationRequestItem")
                from response_loading import prepare_loading_fields
                extra=prepare_loading_fields(cursor,row,extra)
                if extra.get('HeightMM') is not None:
                    # Decimal validation permits trailing zeros beyond the stored scale.
                    extra['HeightMM']=format(Decimal(extra['HeightMM']).quantize(Decimal('0.01')),'f')
                if extra:
                    cursor.execute("EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save ?,?,?,?,0",
                        ctx.username,saved["NewID"],saved["NewRowVersion"],json.dumps(extra))
                    saved["NewRowVersion"]=consume(cursor)[0][0]["RowVersion"]
                from db import bytes_to_b64
                from pkg_pricing_api import save_calculations
                save_calculations(cursor, ctx, row, saved["NewRowVersion"])
                from pallet_pricing_api import apply_selection
                pallet_version=apply_selection(cursor,row)
                if pallet_version is not None:saved["NewRowVersion"]=pallet_version
                saved["NewRowVersion"]=bytes_to_b64(saved["NewRowVersion"])
            # Child pricing/quantities must be saved before validating a parent's gross load.
            from response_load_plan import apply_plan
            invalidated=invalidate_changed_plans(cursor,dependencies,ctx.user_id)
            for saved in result:
                if saved.get('Status')!='OK':continue
                row=by_num[saved['RowNum']]
                if row.ID in invalidated:
                    # Never reattach stale IDs resubmitted by a full-form client.
                    saved['NewRowVersion']=bytes_to_b64(cursor.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',row.ID).fetchval())
                    continue
                plan_version=apply_plan(cursor,row,ctx.user_id)
                if plan_version is not None:saved['NewRowVersion']=bytes_to_b64(plan_version)
            from grade_density import save_density_defaults
            save_density_defaults(cursor,ctx,payload.rows)
            if owns_transaction: cursor.execute("COMMIT TRANSACTION")
            return {"results":result}
        except Exception as exc:
            cursor.execute('IF @@TRANCOUNT>0 '+('ROLLBACK TRANSACTION' if owns_transaction else 'BEGIN IF XACT_STATE()=1 ROLLBACK TRANSACTION ResponseCalculation; ELSE ROLLBACK TRANSACTION; END'))
            message=sql_error(exc)
            if message:
                raise HTTPException(422,message) from exc
            if any(code in str(exc) for code in ("51128","51108")):
                raise HTTPException(409,"Refresh this response: its version, PIC or stage has changed.") from exc
            if "(547)" in str(exc):
                raise HTTPException(422,"Check numeric values, currency and cost basis.") from exc
            raise
