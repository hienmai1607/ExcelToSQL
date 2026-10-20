"""Immutable, per-response pallet pricing including accessories."""
import json
from decimal import Decimal
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,Field,ConfigDict
from auth import AccessContext,get_access_context
from pkg_pricing_api import api_cursor,authorize,select,document,encode
from packaging_api import rv
from load_planning_api import pallet_prices_from_cursor
from packaging_weight import material_tare
from workspace_access import can_edit

router=APIRouter(prefix='/api/pallet-pricing',tags=['Pallet pricing'])

class Component(BaseModel):
    model_config=ConfigDict(extra='forbid')
    PriceID:int=Field(ge=1)
    RowVersion:str
    MaterialRowVersion:str
    Quantity:Decimal=Field(gt=0,le=100000,decimal_places=6,allow_inf_nan=False)
    AreaM2:Decimal|None=Field(None,gt=0,le=100000,decimal_places=9,allow_inf_nan=False)

class Selection(BaseModel):
    model_config=ConfigDict(extra='forbid')
    PalletSize:str=Field(max_length=100)
    components:list[Component]=Field(min_length=1,max_length=30)
    ItemRowVersion:str|None=None
    PalletMaterialID:int|None=Field(None,ge=1)


@router.get('/pallets')
def pallet_choices(ctx:AccessContext=Depends(get_access_context)):
    from packaging_api import require
    require(ctx,'Packaging','PackagingManager','Opportunity')
    with api_cursor() as cur:
        choices={}
        for row in pallet_prices_from_cursor(cur):
            dimensions=row['Dimensions']
            choices[row['MaterialID']]=dict(ID=row['MaterialID'],MaterialCode=row['MaterialCode'],MaterialName=row['MaterialName'],
                PalletSize=format(Decimal(dimensions['length']).normalize(),'f')+'x'+format(Decimal(dimensions['width']).normalize(),'f')+'mm',Dimensions=dimensions)
        return {'rows':list(choices.values())}

def catalog(cur):
    bases=pallet_prices_from_cursor(cur)
    base_ids={p['ID'] for p in bases}
    rows=select(cur,"""SELECT p.ID,p.RowVersion,m.RowVersion MaterialRowVersion,m.ID MaterialID,m.MaterialCode,m.MaterialName,t.PackagingType,
        m.TareWeight,m.TareWeightBasis,p.UnitPrice,p.UnitUSDPrice,p.PriceBasis,c.CurrencyCode,
        p.QuantityFrom,p.QuantityTo,p.EffectiveFrom,p.EffectiveTo,v.VendorName,t.PackagingOrder
        FROM dbo.PackagingPrice p WITH(HOLDLOCK) JOIN dbo.PackagingMaterial m WITH(HOLDLOCK) ON m.ID=p.MaterialID AND m.Status='Active'
        JOIN dbo.PackagingType t ON t.ID=m.PackagingTypeID AND t.Status='Active'
        JOIN dbo.Currency c ON c.ID=p.CurrencyID
        LEFT JOIN dbo.Vendor v ON v.ID=p.VendorID
        WHERE t.PackagingOrder='Pallet' AND p.Status='Active' AND UPPER(p.PriceBasis)='EA'
        AND (v.ID IS NULL OR v.Status='Active')
        AND p.EffectiveFrom<=CONVERT(DATE,SYSUTCDATETIME())
        AND (p.EffectiveTo IS NULL OR p.EffectiveTo>=CONVERT(DATE,SYSUTCDATETIME()))
        ORDER BY m.MaterialCode,p.ID""")[0]
    result=[]
    for row in rows:
        row['IsPallet']=row['PackagingType'].strip().casefold()=='pallet'
        if row['IsPallet'] and row['ID'] not in base_ids:continue
        row['RowVersion']=encode(row['RowVersion'])
        row['MaterialRowVersion']=encode(row['MaterialRowVersion'])
        base=next((b for b in bases if b['ID']==row['ID']),None)
        row['Dimensions']=base['Dimensions'] if base else None
        result.append(row)
    return result

def calculate(cur,body):
    prices={p['ID']:p for p in catalog(cur)}
    if len({c.PriceID for c in body.components})!=len(body.components):raise HTTPException(422,'Select each price only once.')
    components=[];base=None;total=Decimal(0);usd=Decimal(0);usd_known=True;currency=None;tare=Decimal(0);missing=[]
    for component in body.components:
        p=prices.get(component.PriceID)
        if not p or p['RowVersion']!=component.RowVersion or p['MaterialRowVersion']!=component.MaterialRowVersion:
            raise HTTPException(409,'Material or pricing changed. Refresh the pallet calculator.')
        area=component.AreaM2
        if p.get('IsPallet'):
            if body.PalletMaterialID is not None and p['MaterialID']!=body.PalletMaterialID:
                raise HTTPException(422,'Choose pricing for the selected pallet material.')
            if base or component.Quantity!=1:raise HTTPException(422,'Choose exactly one pallet with quantity 1.')
            base=p
            dims=p['Dimensions']
            try:
                l,w=body.PalletSize.lower().removesuffix('mm').split('x')
                if Decimal(l)!=Decimal(dims['length']) or Decimal(w)!=Decimal(dims['width']):raise ValueError()
            except (ValueError,ArithmeticError):raise HTTPException(422,'Pallet dimensions must match the selected pallet size.')
            area=Decimal(dims['length'])*Decimal(dims['width'])/1000000
        if currency is not None and currency!=p['CurrencyCode']:raise HTTPException(422,'Choose prices in the same currency.')
        currency=p['CurrencyCode']
        if p['TareWeightBasis']=='kg/m2' and area is None:raise HTTPException(422,'Enter consumed area (m²) for '+p['MaterialCode']+'.')
        kg=material_tare(p['TareWeight'],p['TareWeightBasis'],component.Quantity,area)
        if kg is None:missing.append(p['MaterialCode'])
        else:tare+=kg
        cost=Decimal(str(p['UnitPrice']))*component.Quantity;total+=cost
        if p['UnitUSDPrice'] is None:usd_known=False
        else:usd+=Decimal(str(p['UnitUSDPrice']))*component.Quantity
        components.append({**p,'Quantity':str(component.Quantity),'AreaM2':str(area) if area is not None else None,'TareKG':str(kg) if kg is not None else None,'Cost':str(cost)})
    if base is None:raise HTTPException(422,'Choose one matching pallet material.')
    return dict(PalletSize=body.PalletSize,PalletMaterialID=base['MaterialID'],Dimensions=base['Dimensions'],components=components,TareKG=None if missing else str(tare),
        MissingTare=missing,UnitPrice=str(total),CurrencyCode=currency,UnitUSDPrice=str(usd) if usd_known else None)

@router.get('/items/{item_id}')
def options(item_id:int,ctx:AccessContext=Depends(get_access_context)):
    with api_cursor() as cur:
        authorize(cur,ctx.username,item_id)
        return {'rows':catalog(cur)}

@router.post('/items/{item_id}/preview')
def preview(item_id:int,body:Selection,ctx:AccessContext=Depends(get_access_context)):
    with api_cursor() as cur:
        authorize(cur,ctx.username,item_id)
        return calculate(cur,body)

@router.post('/items/{item_id}/save')
def save(item_id:int,body:Selection,ctx:AccessContext=Depends(get_access_context)):
    if not can_edit(ctx,'requests'):raise HTTPException(403,'Response edit access is required.')
    with api_cursor() as cur:
        try:
            cur.execute('SET QUOTED_IDENTIFIER ON; SET XACT_ABORT ON; BEGIN TRANSACTION')
            authorize(cur,ctx.username,item_id,True,rv(body.ItemRowVersion,True))
            snapshot=calculate(cur,body)
            cur.execute('INSERT dbo.PalletPricingSnapshot(ItemID,SnapshotJSON,CreatedBy) OUTPUT INSERTED.ID VALUES(?,?,?)',item_id,document(snapshot),ctx.user_id)
            identity=cur.fetchone()[0]
            cur.execute('COMMIT')
            return {'ID':identity,**snapshot}
        except Exception:
            cur.execute('IF @@TRANCOUNT>0 ROLLBACK')
            raise

def apply_selection(cur,row):
    if 'ResponsePalletMaterialID' in row.model_fields_set:
        identity=row.ResponsePalletMaterialID
        previous=cur.execute('SELECT ResponsePalletMaterialID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',row.ID).fetchval()
        if identity!=previous and identity is not None and not cur.execute("""SELECT m.ID FROM dbo.PackagingMaterial m JOIN dbo.PackagingType t ON t.ID=m.PackagingTypeID
            WHERE m.ID=? AND m.Status='Active' AND t.Status='Active' AND t.PackagingType='Pallet' AND t.PackagingOrder='Pallet'""",identity).fetchone():
            raise HTTPException(422,'Choose an active material with Packaging Type Pallet.')
        cur.execute('UPDATE dbo.PackagingConfigurationRequestItem SET ResponsePalletMaterialID=? WHERE ID=? AND (ResponsePalletMaterialID<>? OR (ResponsePalletMaterialID IS NULL AND ? IS NOT NULL) OR (ResponsePalletMaterialID IS NOT NULL AND ? IS NULL))',identity,row.ID,identity,identity,identity)
    if 'PalletPricingID' not in row.model_fields_set:
        if {'ResponsePalletSize','ResponsePalletMaterialID'} & row.model_fields_set:
            cur.execute("UPDATE i SET PalletPricingID=NULL FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.PalletPricingSnapshot s ON s.ID=i.PalletPricingID WHERE i.ID=? AND (i.ResponsePalletSize IS NULL OR JSON_VALUE(s.SnapshotJSON,'$.PalletSize')<>i.ResponsePalletSize OR (i.ResponsePalletMaterialID IS NOT NULL AND ISNULL(TRY_CONVERT(INT,JSON_VALUE(s.SnapshotJSON,'$.PalletMaterialID')),0)<>i.ResponsePalletMaterialID))",row.ID)
            return bytes(cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',row.ID).fetchval())
        return
    if row.PalletPricingID is not None:
        record=cur.execute("""SELECT s.SnapshotJSON,i.ResponsePalletSize,oi.ParentItemID,i.ResponsePalletMaterialID
            FROM dbo.PalletPricingSnapshot s JOIN dbo.PackagingConfigurationRequestItem i ON i.ID=s.ItemID
            JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID WHERE s.ID=? AND s.ItemID=?""",row.PalletPricingID,row.ID).fetchone()
        if not record or record[2] is not None or json.loads(record[0])['PalletSize']!=record[1] or record[3] is not None and json.loads(record[0]).get('PalletMaterialID')!=record[3]:
            raise HTTPException(422,'Choose pallet pricing for this parent response and matching pallet size.')
    cur.execute('UPDATE dbo.PackagingConfigurationRequestItem SET PalletPricingID=? WHERE ID=? AND (PalletPricingID<>? OR (PalletPricingID IS NULL AND ? IS NOT NULL) OR (PalletPricingID IS NOT NULL AND ? IS NULL))',row.PalletPricingID,row.ID,row.PalletPricingID,row.PalletPricingID,row.PalletPricingID)
    return bytes(cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',row.ID).fetchval())

def snapshot_sql(alias):
    return f"(SELECT JSON_MODIFY(s.SnapshotJSON,'$.ID',s.ID) FROM dbo.PalletPricingSnapshot s WHERE s.ID={alias}.PalletPricingID AND s.ItemID={alias}.ID AND JSON_VALUE(s.SnapshotJSON,'$.PalletSize')={alias}.ResponsePalletSize AND ({alias}.ResponsePalletMaterialID IS NULL OR TRY_CONVERT(INT,JSON_VALUE(s.SnapshotJSON,'$.PalletMaterialID'))={alias}.ResponsePalletMaterialID))"
