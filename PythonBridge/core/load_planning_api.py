"""Container maintenance and authenticated, versioned item loading plans."""
import json
from decimal import Decimal
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from auth import AccessContext, get_access_context
from db import get_raw_cursor
from packaging_api import execute, require, rv
from pkg_pricing_api import authorize, api_cursor, select, document, encode
from load_planning import Dimensions, PlanInput, plan
from workspace_access import can_edit

router=APIRouter(prefix="/api/load-planning",tags=["Container loading"])

class Specification(Dimensions):
    payload_kg: Decimal | None = Field(None,gt=0,le=1000000,allow_inf_nan=False)
    door_width: Decimal | None = Field(None,gt=0,le=20000,decimal_places=3)
    door_height: Decimal | None = Field(None,gt=0,le=20000,decimal_places=3)
    clearance_length: Decimal = Field(Decimal(0),ge=0,le=20000,decimal_places=3)
    clearance_width: Decimal = Field(Decimal(0),ge=0,le=20000,decimal_places=3)
    clearance_height: Decimal = Field(Decimal(0),ge=0,le=20000,decimal_places=3)
    @model_validator(mode="after")
    def space(self):
        if any(getattr(self,a)<=getattr(self,"clearance_"+a) for a in ("length","width","height")):
            raise ValueError("Clearance must leave usable space.")
        if self.door_width is not None and self.door_width>self.width or self.door_height is not None and self.door_height>self.height:
            raise ValueError("Door opening cannot exceed internal dimensions.")
        return self

class ContainerRecord(BaseModel):
    model_config=ConfigDict(extra="forbid")
    ID:int|None=Field(None,ge=1)
    RowVersion:str|None=None
    Code:str=Field(min_length=1,max_length=30,pattern=r"^[A-Za-z0-9_-]+$")
    Family:Literal["Dry","Reefer"]
    SizeFT:int=Field(ge=1,le=100)
    Specifications:Specification
    Status:Literal["Active","Block"]="Active"

def read_access(ctx):
    require(ctx,"Packaging","PackagingManager","Opportunity")
    return ctx

@router.get("/containers")
def containers(ctx:AccessContext=Depends(get_access_context)):
    require(ctx,"Packaging","PackagingManager","Opportunity")
    rows=execute("SELECT * FROM dbo.ContainerTypeMaster ORDER BY SizeFT,Code",[])[0]
    for row in rows:row["Specifications"]=json.loads(row["Specifications"])
    return {"rows":rows}

@router.post("/containers")
def save_container(body:ContainerRecord,ctx:AccessContext=Depends(get_access_context)):
    if not ctx.is_admin:raise HTTPException(403,"Only Admin can maintain Container Type Master.")
    require(ctx,"Packaging")
    if not can_edit(ctx,"containers"):raise HTTPException(403,"Container Type Master edit access is required.")
    with get_raw_cursor() as cur:
        try:
            cur.execute("SET QUOTED_IDENTIFIER ON; SET XACT_ABORT ON; BEGIN TRANSACTION")
            values=(body.Code.upper(),body.Family,body.SizeFT,body.Specifications.model_dump_json(),body.Status,ctx.user_id)
            if body.ID:
                cur.execute("""UPDATE dbo.ContainerTypeMaster SET Code=?,Family=?,SizeFT=?,Specifications=?,Status=?,
                    UpdatedBy=?,UpdatedAt=SYSUTCDATETIME() OUTPUT INSERTED.ID WHERE ID=? AND RowVersion=?""",*values,body.ID,rv(body.RowVersion,True))
                row=cur.fetchone()
                if not row:raise HTTPException(409,"Container changed. Refresh before saving.")
            else:
                cur.execute("""INSERT dbo.ContainerTypeMaster(Code,Family,SizeFT,Specifications,Status,CreatedBy)
                    OUTPUT INSERTED.ID VALUES(?,?,?,?,?,?)""",*values)
                row=cur.fetchone()
            cur.execute("COMMIT")
            return {"ID":row[0]}
        except Exception as exc:
            cur.execute("IF @@TRANCOUNT>0 ROLLBACK")
            if any(code in str(exc) for code in ("2601","2627")):raise HTTPException(422,"Container code already exists.") from exc
            raise

@router.get("/pallet-prices")
def pallet_prices(ctx:AccessContext=Depends(get_access_context)):
    require(ctx,"Packaging","PackagingManager","Opportunity")
    with api_cursor() as cur:
        return {"rows":pallet_prices_from_cursor(cur)}

def pallet_prices_from_cursor(cur,include_unpriced=False):
    rows=select(cur,"""SELECT p.ID,m.ID MaterialID,p.RowVersion,m.MaterialCode,m.MaterialName,
        p.QuantityFrom,p.QuantityTo,p.UnitUSDPrice,p.PriceBasis,m.UnitOfMeasure,m.TareWeight,m.TareWeightBasis,m.MaxPayloadKG,m.RowVersion MaterialRowVersion,
        m.MaterialDimensionRowVersion,d.RowVersion DimensionRowVersion,
        m.MaterialD1,m.MaterialD2,m.MaterialD3,d.D1Name,d.D2Name,d.D3Name,
        u1.UoMCode D1Unit,u2.UoMCode D2Unit,u3.UoMCode D3Unit,
        CASE WHEN u1.UoMCode='MM' THEN 1 ELSE c1.Factor END D1Factor,
        CASE WHEN u2.UoMCode='MM' THEN 1 ELSE c2.Factor END D2Factor,
        CASE WHEN u3.UoMCode='MM' THEN 1 ELSE c3.Factor END D3Factor,
        v.VendorName
        FROM dbo.PackagingMaterial m
        LEFT JOIN dbo.PackagingPrice p ON p.MaterialID=m.ID AND p.Status='Active'
          AND p.EffectiveFrom<=CONVERT(DATE,SYSUTCDATETIME())
          AND (p.EffectiveTo IS NULL OR p.EffectiveTo>=CONVERT(DATE,SYSUTCDATETIME()))
          AND NOT EXISTS(SELECT 1 FROM dbo.Vendor blocked WHERE blocked.ID=p.VendorID AND blocked.Status<>'Active')
        JOIN dbo.PackagingType t ON t.ID=m.PackagingTypeID AND t.PackagingOrder='Pallet' AND t.PackagingType='Pallet' AND t.Status='Active'
        JOIN dbo.PackagingDimension d ON d.ID=m.MaterialDimensionID AND d.PackagingTypeID=t.ID AND d.Status='Active'
        JOIN dbo.UoM u1 ON u1.ID=d.D1UoMID AND u1.Status='Active'
        JOIN dbo.UoM u2 ON u2.ID=d.D2UoMID AND u2.Status='Active'
        JOIN dbo.UoM u3 ON u3.ID=d.D3UoMID AND u3.Status='Active'
        OUTER APPLY dbo.fn_UnitConversion(u1.UoMCode,N'MM',NULL,NULL,NULL) c1
        OUTER APPLY dbo.fn_UnitConversion(u2.UoMCode,N'MM',NULL,NULL,NULL) c2
        OUTER APPLY dbo.fn_UnitConversion(u3.UoMCode,N'MM',NULL,NULL,NULL) c3
        LEFT JOIN dbo.Vendor v ON v.ID=p.VendorID
        WHERE m.Status='Active' AND (?=1 OR p.ID IS NOT NULL)
        ORDER BY m.MaterialCode,p.ID""",int(include_unpriced))[0]
    result=[]
    for row in rows:
        values={}
        for key in ("D1","D2","D3"):
            name=str(row[key+"Name"] or "").strip().lower()
            if name in ("length","width","height") and row["Material"+key] and row[key+"Factor"]:
                values[name]=str(Decimal(str(row["Material"+key]))*Decimal(str(row[key+"Factor"])))
        if len(values)==3 and row["MaterialDimensionRowVersion"]==row["DimensionRowVersion"]:
            result.append({**{k:row[k] for k in ("ID","RowVersion","MaterialID","MaterialCode","MaterialName","VendorName","QuantityFrom","QuantityTo","UnitUSDPrice","PriceBasis","UnitOfMeasure","TareWeight","TareWeightBasis","MaterialRowVersion","MaxPayloadKG")},"Dimensions":values})
    for row in result:
        row["RowVersion"]=encode(row["RowVersion"]) if row["RowVersion"] is not None else None
        row["MaterialRowVersion"]=encode(row["MaterialRowVersion"])
    return result

class Preview(BaseModel):
    model_config=ConfigDict(extra="forbid")
    ContainerID:int=Field(ge=1)
    ContainerRowVersion:str
    Inputs:PlanInput
    PalletPriceID:int|None=Field(None,ge=1)
    PalletPriceRowVersion:str|None=None
    PalletMaterialRowVersion:str|None=None

class SavePlan(Preview):
    ItemRowVersion:str

def response_dimensions(cur,item_id):
    """Only saved pricing dimensions (or legacy saved item dimensions), never request input."""
    from packaging_efficiency import captured_layer_dimensions
    row=select(cur,"SELECT * FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",item_id)[0][0]
    snapshots={p['PackagingOrder']:p['SnapshotJSON'] for p in select(cur,"SELECT PackagingOrder,SnapshotJSON FROM dbo.PkgPricingMaster WHERE RequestItemID=? AND IsCurrent=1",item_id)[0]}
    order=('Primary','Secondary','Tertiary','Quaternary')[int(row.get('ResponseLayerCount') or row.get('RequestedLayerCount') or 2)-1]
    captures=captured_layer_dimensions(row,snapshots).get(order,{}).get('Dimensions',[])
    measured={}
    for d in captures:
        name=d['Name'].strip().lower()
        if name not in ('length','width','height','dia','diameter'):continue
        factor=Decimal(1) if d['Unit'].lower()=='mm' else cur.execute("SELECT Factor FROM dbo.fn_UnitConversion(?,N'MM',NULL,NULL,NULL)",d['Unit']).fetchval()
        if factor is not None:measured.setdefault(name,Decimal(d['Value'])*Decimal(str(factor)))
    if not captures:
        measured={key:row.get(field) for key,field in [('length','LengthMM'),('width','WidthMM'),('height','HeightMM')]}
    from shipping_geometry import shipping_envelope
    try:return Dimensions.model_validate(shipping_envelope(measured)).model_dump(mode='json')
    except ValueError:return None


def net_load_kg(snapshot,cartons):
    """Goods only, using the confirmed final packaging layer, never gross/tare."""
    if snapshot is None:return None
    order="Quaternary" if snapshot.get("NoOfQuaternaryUnit") is not None else "Tertiary" if snapshot.get("NoOfTertiaryUnit") is not None else "Secondary" if snapshot.get("NoOfSecondaryUnit") is not None else "Primary"
    grams=snapshot.get(order+"NetWeightGrams")
    if grams is None:return None
    weight=Decimal(str(grams))
    return float(weight*int(cartons)/1000) if weight.is_finite() and weight>=0 else None


def calculate(cur,body,item_id=None):
    rows=select(cur,"SELECT * FROM dbo.ContainerTypeMaster WITH(HOLDLOCK) WHERE ID=? AND Status='Active'",body.ContainerID)[0]
    if not rows:raise HTTPException(422,"Choose an active container.")
    row=rows[0]
    if bytes(row["RowVersion"])!=rv(body.ContainerRowVersion,True):raise HTTPException(409,"Container dimensions changed. Refresh the planner.")
    spec=Specification.model_validate_json(row["Specifications"])
    data=body.Inputs.model_dump()
    if item_id is not None:
        saved_response=select(cur,"SELECT ConfigurationRequest,CartonsPerLayer,LayersPerPallet,ResponseMaxPalletHeightMM,ResponsePalletStacking FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",item_id)[0][0]
        requirement=saved_response["ConfigurationRequest"]
        modes={"Pallet load":{"pallet"},"Floor load":{"floor"},"Both":{"pallet","floor"}}.get(requirement,{"pallet"})
        if body.Inputs.mode not in modes:raise HTTPException(422,"Loading mode must follow the request requirement: "+str(requirement)+".")
        dims=response_dimensions(cur,item_id)
        if dims is None:raise HTTPException(422,"Save complete Length, Width and Height in the final layer Pricing Calculator before planning.")
        data["carton"]=dims
        # Item plans are proposals from saved response data, never manual weight/settings overrides.
        data.update(weight_source="response",rotate=True,pallet_payload_kg=None,
            double_stack=False,stackable=False,pallet=None,pallet_kg=None,
            cartons_per_layer=None,layers_per_pallet=None,pallet_max_gross_kg=None,max_pallet_height=None)
        if data["mode"]=="pallet":
            if not saved_response["ResponseMaxPalletHeightMM"]:
                raise HTTPException(422,"Save response cartons per layer and maximum pallet height before planning.")
            double=saved_response["ResponsePalletStacking"]=="Double"
            data.update(cartons_per_layer=saved_response["CartonsPerLayer"],
                max_pallet_height=saved_response["ResponseMaxPalletHeightMM"],double_stack=double,stackable=double)
    data.update({k:v for k,v in spec.model_dump().items() if k not in ("length","width","height")})
    data["container"]=spec.model_dump(include={"length","width","height"})
    weight_snapshot=None
    if data['weight_source']=='response':
        from packaging_weight import response_weights
        weight_snapshot=response_weights(cur,item_id) if item_id is not None else None
        if weight_snapshot is None:raise HTTPException(422,'Response item is required for calculated weight.')
        if weight_snapshot['CartonGrossWeightKG'] is None:
            raise HTTPException(422,'Gross weight is incomplete. Maintain material tare and save pricing for every packaging layer, then save the response quantities.')
        data['carton_kg']=weight_snapshot['CartonGrossWeightKG']
    price=None
    if item_id is None and body.Inputs.mode=="pallet" and body.PalletPriceID is not None:
        prices=pallet_prices_from_cursor(cur)
        price=next((p for p in prices if p["ID"]==body.PalletPriceID),None)
        if not price or rv(price["RowVersion"],True)!=rv(body.PalletPriceRowVersion,True):
            raise HTTPException(409,"Pallet price or dimensions changed. Refresh the planner.")
        if body.PalletMaterialRowVersion is not None and price["MaterialRowVersion"]!=body.PalletMaterialRowVersion:
            raise HTTPException(409,"Pallet material tare changed. Refresh the planner.")
        data["pallet"]=price["Dimensions"]
        area=Decimal(str(data['pallet']['length']))*Decimal(str(data['pallet']['width']))/Decimal(1000000)
        from packaging_weight import pallet_material_tare
        data['pallet_kg']=pallet_material_tare(cur,price,1,area)
        data['pallet_max_gross_kg']=price.get('MaxPayloadKG')
    assembly=None
    if body.Inputs.mode=='pallet' and item_id is not None:
        from pallet_pricing_api import snapshot_sql
        saved=select(cur,'SELECT '+snapshot_sql('i')+' Snapshot,i.ResponsePalletSize FROM dbo.PackagingConfigurationRequestItem i WHERE i.ID=?',item_id)[0][0]
        assembly=json.loads(saved['Snapshot']) if saved['Snapshot'] else None
        if assembly and assembly['PalletSize']==saved['ResponsePalletSize']:
            data['pallet']=assembly['Dimensions']
            data['pallet_kg']=assembly['TareKG']
            data['pallet_max_gross_kg']=cur.execute('SELECT MaxPayloadKG FROM dbo.PackagingMaterial WHERE ID=?',assembly.get('PalletMaterialID')).fetchval()
            if data['pallet_max_gross_kg'] is None:raise HTTPException(422,'Maintain maximum gross payload on the selected Pallet material before planning.')
            data['layers_per_pallet']=saved_response.get('LayersPerPallet') if item_id is not None else None
        else:assembly=None
        if assembly is None:
            raise HTTPException(422,"Save matching pallet pricing in the response before planning.")
        if assembly.get("TareKG") is None:
            raise HTTPException(422,"Complete pallet and accessory tare weights before planning.")
    try:
        inputs=PlanInput.model_validate(data)
        result=plan(inputs)
        result["ContainerCode"]=row["Code"]
        result["net_kg"]=net_load_kg(weight_snapshot,result["cartons"])
        if weight_snapshot is not None:result['WeightSnapshot']=weight_snapshot
        if price:result.update(PalletPriceID=price["ID"],PalletPriceRowVersion=price["RowVersion"],PalletMaterialCode=price["MaterialCode"],PalletMaterialRowVersion=price["MaterialRowVersion"],PalletUnitUSDPrice=str(price["UnitUSDPrice"]) if price["UnitUSDPrice"] is not None and str(price["PriceBasis"]).upper()=="EA" else None)
        if assembly:
            result.update(PalletPricingID=assembly['ID'],PalletPricingSnapshot=assembly,PalletUnitUSDPrice=assembly['UnitUSDPrice'])
        return inputs,result
    except ValueError as exc:raise HTTPException(422,str(exc)) from exc

@router.post("/items/{item_id}/preview")
def preview(item_id:int,body:Preview,ctx:AccessContext=Depends(get_access_context)):
    with api_cursor() as cur:
        authorize(cur,ctx.username,item_id)
        inputs,result=calculate(cur,body,item_id)
        return {"Inputs":inputs.model_dump(mode="json"),"Result":result}

@router.get('/items/{item_id}/weights')
def weights(item_id:int,ctx:AccessContext=Depends(get_access_context)):
    from packaging_weight import response_weights
    with api_cursor() as cur:
        authorize(cur,ctx.username,item_id)
        return {**response_weights(cur,item_id),"FinalCartonDimensions":response_dimensions(cur,item_id)}

@router.get("/items/{item_id}")
def history(item_id:int,ctx:AccessContext=Depends(get_access_context)):
    with api_cursor() as cur:
        authorize(cur,ctx.username,item_id)
        rows=select(cur,"SELECT p.*,COALESCE(JSON_VALUE(p.Result,'$.ContainerCode'),c.Code) Code FROM dbo.ContainerLoadPlan p JOIN dbo.ContainerTypeMaster c ON c.ID=p.ContainerID WHERE p.ItemID=? AND (p.ID IN(SELECT TOP(10) q.ID FROM dbo.ContainerLoadPlan q WHERE q.ItemID=p.ItemID ORDER BY q.ID DESC) OR EXISTS(SELECT 1 FROM dbo.ResponseContainerLoadPlan m WHERE m.ItemID=p.ItemID AND m.PlanID=p.ID)) ORDER BY p.ID DESC",item_id)[0]
        for row in rows:
            row["Inputs"]=json.loads(row["Inputs"]);row["Result"]=json.loads(row["Result"])
        return {"rows":rows}

@router.post("/items/{item_id}/save")
def save(item_id:int,body:SavePlan,ctx:AccessContext=Depends(get_access_context)):
    if not can_edit(ctx,"requests"):raise HTTPException(403,"Response edit access is required.")
    with api_cursor() as cur:
        try:
            cur.execute("SET QUOTED_IDENTIFIER ON; SET XACT_ABORT ON; BEGIN TRANSACTION")
            authorize(cur,ctx.username,item_id,True,rv(body.ItemRowVersion,True))
            inputs,result=calculate(cur,body,item_id)
            cur.execute("""INSERT dbo.ContainerLoadPlan(ItemID,ContainerID,Inputs,Result,CreatedBy)
                OUTPUT INSERTED.ID VALUES(?,?,?,?,?)""",item_id,body.ContainerID,inputs.model_dump_json(),document(result),ctx.user_id)
            identity=cur.fetchone()[0]
            cur.execute("COMMIT")
            return {"ID":identity,"ContainerID":body.ContainerID,"Code":result["ContainerCode"],"Inputs":inputs.model_dump(mode="json"),"Result":result}
        except Exception:
            cur.execute("IF @@TRANCOUNT>0 ROLLBACK")
            raise
