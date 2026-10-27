"""Copy section inputs, never old price totals or container-load results."""
import json
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from auth import AccessContext, get_access_context
from packaging_api import require
from packaging_orders import ORDERS, RESPONSE_ORDER_FIELDS
from packaging_layers import request_start
from pkg_pricing_api import api_cursor, authorize, select, document, encode, catalog, calculate
from pkg_pricing import Calculation

router = APIRouter(prefix="/api/packaging/items", tags=["Packaging references"])
SECTIONS = (*ORDERS, "Palletization")
TYPE_FIELDS = ("FirstPMType", "SecondPMType", "ThirdPMType", "FourthPMType")
MOQ_FIELDS = ("FirstPMMOQ", "SecondPMMOQ", "ThirdPMMOQ", "FourthPMMOQ")
UNIT_FIELDS = ("UnitsPerCarton", "UnitsPerTertiary", "UnitsPerQuaternary")
PRICE_FIELDS = ("Primary", "Secondary", "Tertiary", "Quaternary")


class CopySections(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sections: dict[str, StrictInt] = Field(min_length=1, max_length=5)
    LayerCount: int = Field(ge=1, le=4)


def newest_price(prices, old, pallet=False):
    """Keep the captured vendor/basis/currency/tier; prefer its newest effective quote."""
    key = "ID" if pallet else "PriceID"
    basis = "PriceBasis" if pallet else "PriceUoM"
    moq = "QuantityFrom" if pallet else "VendorMOQ"
    def vendor_matches(price):
        if "VendorID" in old:
            return price.get("VendorID")==old["VendorID"]
        # Older pallet captures stored only the vendor's display name.
        return price.get("VendorName")==old.get("VendorName") if old.get("VendorName") else price.get("VendorID") is None
    candidates = [p for p in prices if p.get(key) and p.get("MaterialID")==old.get("MaterialID")
        and vendor_matches(p)
        and p.get("CurrencyCode")==old.get("CurrencyCode")
        and p.get(basis)==old.get(basis)
        and Decimal(str(p.get(moq) or 0))==Decimal(str(old.get(moq) or 0))
        and (p.get("QuantityTo") is None and old.get("QuantityTo") is None or p.get("QuantityTo") is not None and old.get("QuantityTo") is not None and Decimal(str(p["QuantityTo"]))==Decimal(str(old["QuantityTo"])))]
    if len({p.get("VendorID") for p in candidates})>1:
        return None
    return max(candidates,key=lambda p:(str(p.get("EffectiveFrom") or ""),p[key]),default=None)


@router.get("/{item_id}/copy-references")
def references(item_id:int, search:str=Query("",max_length=200), ctx:AccessContext=Depends(get_access_context)):
    require(ctx,"Packaging","PackagingManager")
    with api_cursor() as cur:
        authorize(cur,ctx.username,item_id)
        rows=select(cur,"""SELECT TOP(200) i.ID,h.RequestNumber,h.OpportunityNumber,i.ProductCode,i.ProductName,
            COALESCE(i.ResponseLayerCount,i.RequestedLayerCount,1) LayerCount,
            dbo.fn_RequestPackagingLayerStart(i.ID) LayerStart,
            i.ResponsePalletMaterialID,i.ResponsePalletSize
            FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.PackagingConfigurationRequest h ON h.ID=i.RequestID
            WHERE i.ID<>? AND i.Stage<>'Canceled' AND
             (h.RequestNumber LIKE ? OR h.OpportunityNumber LIKE ? OR i.ProductCode LIKE ? OR i.ProductName LIKE ?)
            AND (EXISTS(SELECT 1 FROM dbo.PkgPricingMaster p WHERE p.RequestItemID=i.ID AND p.IsCurrent=1)
             OR i.ReferenceSetupJSON IS NOT NULL OR i.ResponsePalletMaterialID IS NOT NULL)
            ORDER BY i.ID DESC""",item_id,*["%"+search+"%"]*4)[0]
        for row in rows:
            row["sections"]=list(ORDERS[row["LayerStart"]-1:row["LayerStart"]-1+row["LayerCount"]])
            if row["ResponsePalletMaterialID"] is not None: row["sections"].append("Palletization")
        return {"rows":rows}


def copy_layer(cur,ctx,target,source,global_section,local_index,count):
    source_start=request_start(cur,source["ID"])
    source_index=ORDERS.index(global_section)-source_start+1
    if source_index<0 or source_index>=int(source["ResponseLayerCount"] or source["RequestedLayerCount"] or 1):
        raise HTTPException(422,"Reference does not contain "+global_section+".")
    source_order=ORDERS[source_index]
    captures=select(cur,"SELECT TOP(1) * FROM dbo.PkgPricingMaster WHERE RequestItemID=? AND PackagingOrder=? AND IsCurrent=1 ORDER BY ID DESC",source["ID"],source_order)[0]
    draft=json.loads(source.get("ReferenceSetupJSON") or "{}").get(global_section,{})
    header=captures[0] if captures else None
    old_input=json.loads(header["InputJSON"]) if header else draft.get("input") or {}
    old_components=[json.loads(r["SnapshotJSON"]) for r in select(cur,"SELECT SnapshotJSON FROM dbo.PkgPricingComponent WHERE PricingMasterID=? ORDER BY LineNumber",header["ID"])[0]] if header else draft.get("materials",[])
    type_name=source[TYPE_FIELDS[source_index]]
    types=select(cur,"SELECT ID FROM dbo.PackagingType WHERE PackagingType=? AND ParentTypeID IS NULL AND Status='Active' AND dbo.fn_PackagingTypeOrderAllowed(ID,?,0)=1",type_name,global_section)[0]
    values={TYPE_FIELDS[local_index]:type_name or "",MOQ_FIELDS[local_index]:""}
    if local_index and source_index:
        values[UNIT_FIELDS[local_index-1]]=str(source[UNIT_FIELDS[source_index-1]] or "")
    input=None; result=None; materials=[]; warnings=[]
    if not types:
        values[TYPE_FIELDS[local_index]]=""
        warnings.append(global_section+": reference type is no longer selectable.")
    else:
        kind,paths,units,dimensions,prices=catalog(cur,types[0]["ID"],global_section)
        parent=next((d for d in dimensions if d["ID"]==old_input.get("DimensionID") and d["PackagingTypeID"]==kind["ID"]),None)
        input={"PackagingOrder":ORDERS[local_index],"LayerCount":count,"PackagingTypeID":kind["ID"],
            "SquareMeterUoMID":old_input.get("SquareMeterUoMID"),"ReferencePricingMasterID":header["ID"] if header else None,
            "DimensionID":parent["ID"] if parent else None,"DimensionRowVersion":encode(parent["RowVersion"]) if parent else None,
            **{k:old_input.get(k) if parent else None for k in ("D1","D2","D3")},"components":[]}
        for old in old_components:
            price=newest_price(prices,old)
            previous=next((c for c in old_input.get("components",[]) if c.get("PriceID")==old.get("PriceID")),old)
            material={**{k:old[k] for k in ("MaterialID","MaterialCode","MaterialName","VendorID","VendorName","CurrencyID","CurrencyCode","PriceUoM","VendorMOQ","QuantityTo","CalculationBasis") if k in old},
                "DimensionID":previous.get("DimensionID"),"DimensionRowVersion":previous.get("DimensionRowVersion"),
                "CopyDim":any(p.get("CopyDim") for p in prices if p["MaterialID"]==old["MaterialID"]),
                "Quantity":previous.get("Quantity","1"),"PriceID":price["PriceID"] if price else None,
                "UnitPrice":price["UnitPrice"] if price else None,"CurrencyCode":price["CurrencyCode"] if price else old.get("CurrencyCode")}
            materials.append(material)
            if not price: continue
            dimension=next((d for d in dimensions if d["ID"]==previous.get("DimensionID") and d.get("ParentDimensionID")==input["DimensionID"]),None)
            input["components"].append(dict(PriceID=price["PriceID"],PriceRowVersion=encode(price["PriceRowVersion"]),
                Quantity=previous.get("Quantity","1"),DimensionID=dimension["ID"] if dimension else None,
                DimensionRowVersion=encode(dimension["RowVersion"]) if dimension else None,D1=None,D2=None,D3=None))
        # Geometry belongs to Material, not its quote. Copy it even with no price.
        material=next((p for p in prices if len(materials)==1 and p["MaterialID"]==materials[0]["MaterialID"]),None)
        if material and (kind.get("CopyDim") or material.get("CopyDim")):
            from copy_dimensions import copied_geometry
            from pkg_pricing_api import output_conversion_lookup
            def convert(source_unit,target_unit):
                converted=output_conversion_lookup(cur,source_unit,target_unit,material)
                return converted.get("Factor") if converted else None
            try:
                definition,measurements=copied_geometry(kind,material,{d["ID"]:d for d in dimensions},
                    {u["ID"]:u for u in units if u["Status"]=="Active"},convert)
                input.update(DimensionID=definition["ID"],DimensionRowVersion=encode(definition["RowVersion"]),**measurements)
            except HTTPException as exc:
                input.update(DimensionID=None,DimensionRowVersion=None,D1=None,D2=None,D3=None)
                warnings.append(global_section+": "+str(exc.detail))
        if materials and all(m["PriceID"] for m in materials):
            try:
                result=calculate(cur,ctx,target,Calculation.model_validate(input))
                input={**result["InputJSON"],"Fingerprint":result["Fingerprint"]}
            except (HTTPException,ValueError) as exc:
                warnings.append(global_section+": "+str(exc.detail if isinstance(exc,HTTPException) else exc))
        else:
            warnings.append(global_section+": missing applicable pricing; copied materials are retained with blank price.")
    prefix=PRICE_FIELDS[local_index]
    copied_dimensions=[]
    if input:
        definition=next((d for d in dimensions if d["ID"]==input["DimensionID"]),None)
        if definition:
            copied_dimensions=[dict(Name=definition[k+"Name"],Unit=definition[k+"Unit"],Value=input[k])
                for k in ("D1","D2","D3") if definition.get(k+"Name") and definition.get(k+"Unit") and input.get(k) is not None]
    values.update({prefix+"PricePerUnit":result["UnitPrice"] if result else "",prefix+"PriceCurrencyCode":result["CurrencyCode"] if result else ""})
    if local_index==count-1:
        values["HeightMM"]=next((str(d["Value"]) for d in copied_dimensions if d["Name"].strip().casefold()=="height" and d["Unit"].casefold()=="mm"),"")
    if result:
        values[MOQ_FIELDS[local_index]]=result["FinalMOQ"]
        if result.get("FinalLayerHeightMM") is not None: values["HeightMM"]=result["FinalLayerHeightMM"]
    return dict(values=values,input=input,result=result,materials=materials,dimensions=copied_dimensions,warnings=warnings,SourceItemID=source["ID"])


def copy_pallet(cur,source):
    from pallet_pricing_api import catalog as pallet_catalog,calculate as pallet_calculate,Selection
    fields=("ResponsePalletMaterialID","ResponsePalletSize","ResponsePalletStacking","ResponseMaxPalletHeightMM","CartonsPerLayer","LayersPerPallet")
    values={k:str(source[k]) if source[k] is not None else "" for k in fields}
    saved=cur.execute("SELECT SnapshotJSON FROM dbo.PalletPricingSnapshot WHERE ID=? AND ItemID=?",source["PalletPricingID"],source["ID"]).fetchval() if source["PalletPricingID"] else None
    old=json.loads(saved) if saved else json.loads(source.get("ReferenceSetupJSON") or "{}").get("Palletization",{})
    prices=pallet_catalog(cur);components=[];materials=[];warnings=[]
    previous_materials=old.get("components",old.get("materials",[]))
    if not previous_materials and source["ResponsePalletMaterialID"]:
        available=[p for p in prices if p["MaterialID"]==source["ResponsePalletMaterialID"]]
        signatures={(p["VendorID"],p["CurrencyCode"],p["PriceBasis"],p["QuantityFrom"],p["QuantityTo"]) for p in available}
        if len(signatures)==1:
            selected=max(available,key=lambda p:(str(p["EffectiveFrom"]),p["ID"]))
            previous_materials=[{**selected,"Quantity":"1"}]
        else:
            material=select(cur,"SELECT ID MaterialID,MaterialCode,MaterialName FROM dbo.PackagingMaterial WHERE ID=?",source["ResponsePalletMaterialID"])[0]
            previous_materials=[{**material[0],"Quantity":"1"}] if material else []
    for previous in previous_materials:
        if "VendorID" not in previous:
            vendor=cur.execute("SELECT VendorID FROM dbo.PackagingPrice WHERE ID=? AND MaterialID=?",previous.get("ID"),previous["MaterialID"]).fetchone()
            if vendor is not None:previous={**previous,"VendorID":vendor[0]}
        price=newest_price(prices,previous,True)
        materials.append({**{k:previous[k] for k in ("MaterialID","MaterialCode","MaterialName","VendorID","VendorName","CurrencyCode","PriceBasis","QuantityFrom","QuantityTo","Quantity","AreaM2") if k in previous},"ID":price["ID"] if price else None,"UnitPrice":price["UnitPrice"] if price else None})
        if price: components.append(dict(PriceID=price["ID"],RowVersion=price["RowVersion"],MaterialRowVersion=price["MaterialRowVersion"],Quantity=previous.get("Quantity",1),AreaM2=previous.get("AreaM2")))
    calculation=None;result=None
    if materials and len(components)==len(materials):
        calculation=dict(PalletSize=values["ResponsePalletSize"],PalletMaterialID=source["ResponsePalletMaterialID"],components=components)
        try:result=pallet_calculate(cur,Selection.model_validate(calculation))
        except (HTTPException,ValueError) as exc:
            warnings.append("Palletization: "+str(exc.detail if isinstance(exc,HTTPException) else exc));calculation=None
    if result is None:warnings.append("Palletization: no complete applicable pricing; the pallet price is blank.")
    values["PalletPricingJSON"]=document({"ID":-1,**result}) if result else ""
    return dict(values=values,calculation=calculation,result=result,materials=materials,warnings=warnings,SourceItemID=source["ID"])


@router.post("/{item_id}/copy-references/preview")
def preview(item_id:int,body:CopySections,ctx:AccessContext=Depends(get_access_context)):
    require(ctx,"Packaging","PackagingManager")
    if any(k not in SECTIONS or isinstance(v,bool) or v<1 for k,v in body.sections.items()):
        raise HTTPException(422,"Choose valid reference sections.")
    with api_cursor() as cur:
        authorize(cur,ctx.username,item_id)
        start=request_start(cur,item_id)
        target=select(cur,"SELECT oi.ParentItemID FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID WHERE i.ID=?",item_id)[0][0]
        if start+body.LayerCount-1>4:raise HTTPException(422,"A product has at most four cumulative packaging layers.")
        allowed=set(ORDERS[start-1:start-1+body.LayerCount])
        if not target["ParentItemID"]:allowed.add("Palletization")
        if set(body.sections)-allowed:raise HTTPException(422,"Copy only sections available on this response.")
        sections={}
        for section,identity in body.sections.items():
            if identity==item_id:raise HTTPException(422,"Choose a different reference item.")
            authorize(cur,ctx.username,identity)
            source=select(cur,"SELECT * FROM dbo.PackagingConfigurationRequestItem WHERE ID=? AND Stage<>'Canceled'",identity)[0]
            if not source:raise HTTPException(404,"Reference item was removed or canceled.")
            sections[section]=copy_pallet(cur,source[0]) if section=="Palletization" else copy_layer(cur,ctx,item_id,source[0],section,ORDERS.index(section)-start+1,body.LayerCount)
        return json.loads(document({"sections":sections}))
