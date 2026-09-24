"""Shared additional-field contracts and atomic saves over existing business procedures."""
import json
import re
from decimal import Decimal
from pydantic import BaseModel, Field
from fastapi import HTTPException
from db import get_raw_cursor

PRODUCT_FIELDS = ["Category","Grade","MixRatioPct"]
class ProductFields(BaseModel):
    Category: str | None = Field(None, max_length=100)
    Grade: str | None = Field(None, max_length=100)
    MixRatioPct: Decimal | None = Field(None, max_digits=5, decimal_places=2, ge=0, allow_inf_nan=False, le=100)

OPPORTUNITY_FIELDS = ["CurrencyID","ExchangeRateToVND"]
class HeaderFields(BaseModel):
    CurrencyID: int | None = Field(None, ge=1)
    ExchangeRateToVND: Decimal | None = Field(None, max_digits=19, decimal_places=6, gt=0, allow_inf_nan=False)

OPPORTUNITYITEM_FIELDS = ["PalletSize","PalletStacking","MaxPalletHeightM","ContainerRequest","ConfigurationRequest","PackagingType","RecyclableRequirement","RecycledContent","Transparency","MetalizedAluminum","BarrierRequirement","ShelfLifeDays","SpecialComments"]
class ItemFields(BaseModel):
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
    BarrierRequirement: str | None = Field(None, max_length=500)
    ShelfLifeDays: int | None = Field(None, ge=0)
    SpecialComments: str | None = Field(None, max_length=1000)

PACKAGINGCONFIGURATIONREQUESTITEM_FIELDS = ["FirstPMType","SecondPMType","UnitsPerCarton","PackagingDescription","FirstPMMOQ","SecondPMMOQ","PalletType","CartonsPerLayer","LayersPerPallet","PacksPerPallet","CartonsPerContainer"]
class ResponseFields(BaseModel):
    FirstPMType: str | None = Field(None, max_length=100)
    SecondPMType: str | None = Field(None, max_length=100)
    UnitsPerCarton: int | None = Field(None, ge=1)
    PackagingDescription: str | None = Field(None, max_length=500)
    FirstPMMOQ: Decimal | None = Field(None, max_digits=18, decimal_places=4, ge=0, allow_inf_nan=False)
    SecondPMMOQ: Decimal | None = Field(None, max_digits=18, decimal_places=4, ge=0, allow_inf_nan=False)
    PalletType: str | None = Field(None, max_length=100)
    CartonsPerLayer: int | None = Field(None, ge=1)
    LayersPerPallet: int | None = Field(None, ge=1)
    PacksPerPallet: int | None = Field(None, ge=1)
    CartonsPerContainer: int | None = Field(None, ge=1)


FIELDS = {"Product": PRODUCT_FIELDS, "Opportunity": OPPORTUNITY_FIELDS,
          "OpportunityItem": OPPORTUNITYITEM_FIELDS,
          "PackagingConfigurationRequestItem": PACKAGINGCONFIGURATIONREQUESTITEM_FIELDS}

def additional(row, kind):
    values = row.model_dump(mode="json", by_alias=True, exclude_unset=True)
    return {k: values[k] for k in FIELDS[kind] if k in values}

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
    if any(str(code) in message for code in range(52951,52964)):
        match=re.search(r"\[SQL Server\](.*?)(?:\s*\(529\d+\))",message)
        return match.group(1).strip() if match else "Check required fields, exchange rate, ownership and processing locks."
    if "(547)" in message:
        return "Invalid value or reference. Check currency, exchange rate and numeric ranges."
    return None

def enriched_batch(proc, groups, scalar_params, models, kinds):
    """One transaction for original fields + extensions; never commit a partial save."""
    with get_raw_cursor() as cursor:
        cursor.execute("SET XACT_ABORT ON; BEGIN TRANSACTION")
        try:
            placeholders=",".join("?" for _ in range(len(groups)+len(scalar_params)))
            cursor.execute("{CALL "+proc+" ("+placeholders+")}", *groups, *scalar_params)
            sets=consume(cursor)
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
                return sets
            for rows,source,kind in zip(sets,models,kinds):
                by_num={r.row_num:r for r in source}
                for result in rows:
                    model=by_num[result["RowNum"]]
                    if model.command=="D":
                        continue
                    extra=additional(model,kind)
                    if not extra and not (kind=="Product" and model.command=="C"):
                        continue
                    cursor.execute("EXEC dbo.usp_"+kind+"_Fields_Save ?,?,?,?,?",
                        scalar_params[0],result["NewID"],result["NewRowVersion"],json.dumps(extra),int(model.command=="C"))
                    updated=consume(cursor)
                    result["NewRowVersion"]=updated[0][0]["RowVersion"]
            cursor.execute("COMMIT TRANSACTION")
            return sets
        except Exception as exc:
            cursor.execute("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION")
            message=sql_error(exc)
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
    with get_raw_cursor() as cursor:
        cursor.execute("SET XACT_ABORT ON; BEGIN TRANSACTION")
        try:
            cursor.execute(tvp_sql("PackagingResponseBatchType",RESPONSE)+"EXEC dbo.usp_PackagingResponse_Batch @Rows,?;",json.dumps(docs),ctx.username)
            result=consume(cursor)[0]
            by_num={r.RowNum:r for r in payload.rows}
            for saved in result:
                row=by_num[saved["RowNum"]]
                extra=additional(row,"PackagingConfigurationRequestItem")
                if extra:
                    cursor.execute("EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save ?,?,?,?,0",
                        ctx.username,saved["NewID"],saved["NewRowVersion"],json.dumps(extra))
                    saved["NewRowVersion"]=consume(cursor)[0][0]["RowVersion"]
                from db import bytes_to_b64
                saved["NewRowVersion"]=bytes_to_b64(saved["NewRowVersion"])
            cursor.execute("COMMIT TRANSACTION")
            return {"results":result}
        except Exception as exc:
            cursor.execute("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION")
            message=sql_error(exc)
            if message:
                raise HTTPException(422,message) from exc
            if any(code in str(exc) for code in ("51128","51108")):
                raise HTTPException(409,"Refresh this response: its version, PIC or stage has changed.") from exc
            if "(547)" in str(exc):
                raise HTTPException(422,"Check numeric values, currency and cost basis.") from exc
            raise
