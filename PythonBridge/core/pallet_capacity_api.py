"""Read-only suggestions; save validation always rechecks saved physical inputs."""
import json
from decimal import Decimal
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,ConfigDict,Field
from auth import AccessContext,get_access_context
from pkg_pricing_api import api_cursor,authorize,select
from load_planning import Dimensions
from rectangle_packing import layout
from pallet_capacity import pallet_capacity

router=APIRouter(prefix='/api/packaging/items',tags=['Pallet capacity'])

class Preview(BaseModel):
    model_config=ConfigDict(extra='forbid')
    PalletMaterialID:int=Field(ge=1)
    Carton:Dimensions
    CartonGrossKG:Decimal=Field(gt=0,allow_inf_nan=False)
    TareKG:Decimal=Field(ge=0,allow_inf_nan=False)
    MaxPalletHeightMM:Decimal=Field(gt=0,le=999999999,allow_inf_nan=False)

@router.post('/{item_id}/pallet-capacity')
def preview(item_id:int,body:Preview,ctx:AccessContext=Depends(get_access_context)):
    from load_planning_api import pallet_prices_from_cursor
    with api_cursor() as cur:
        authorize(cur,ctx.username,item_id)
        pallet=next((p for p in pallet_prices_from_cursor(cur) if p['MaterialID']==body.PalletMaterialID),None)
        if not pallet:raise HTTPException(422,'Choose a current Pallet material with complete dimensions and pricing.')
        dims=pallet['Dimensions'];fit=layout(Decimal(dims['length']),Decimal(dims['width']),body.Carton.length,body.Carton.width,True)
        layers=max(0,int((body.MaxPalletHeightMM-Decimal(dims['height']))//body.Carton.height))
        try:
            result=pallet_capacity(len(fit.positions()),layers,body.CartonGrossKG,body.TareKG,pallet.get('MaxPayloadKG'))
            if not result['cartons_per_pallet']:raise ValueError('No complete carton layer fits within the Pallet maximum gross payload and height.')
            return {**result,'MaxPayloadKG':pallet.get('MaxPayloadKG'),'FootprintOptimal':fit.optimal}
        except ValueError as exc:raise HTTPException(422,str(exc)) from exc

def validate_saved_pallets(cur,item_ids,complete=False):
    from packaging_weight import response_weights
    from load_planning_api import response_dimensions
    ids=select(cur,'''SELECT i.ID FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
        WHERE i.ID IN(SELECT value FROM OPENJSON(?)) OR EXISTS(SELECT 1 FROM dbo.PackagingConfigurationRequestItem child
        JOIN dbo.OpportunityItem co ON co.ID=child.OpportunityItemID WHERE child.ID IN(SELECT value FROM OPENJSON(?))
        AND child.RequestID=i.RequestID AND co.ParentItemID=oi.ID)''',json.dumps(list(item_ids)),json.dumps(list(item_ids)))[0]
    for item_id in [r['ID'] for r in ids]:
        rows=select(cur,'''SELECT i.CartonsPerLayer,i.LayersPerPallet,i.ResponseMaxPalletHeightMM,
          i.ResponsePalletMaterialID,s.SnapshotJSON,oi.ParentItemID,i.LoadPlanID,i.ConfigurationRequest
          FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
          LEFT JOIN dbo.PalletPricingSnapshot s ON s.ID=i.PalletPricingID WHERE i.ID=?''',item_id)[0]
        if not rows:continue
        row=rows[0]
        if row['ParentItemID'] is not None:continue
        if not row['SnapshotJSON']:
            if complete and row['ResponsePalletMaterialID'] is not None:raise HTTPException(422,'Save pallet pricing before submitting this response.')
            continue
        assembly=json.loads(row['SnapshotJSON']);material=row['ResponsePalletMaterialID'] or assembly.get('PalletMaterialID')
        maximum=cur.execute('SELECT MaxPayloadKG FROM dbo.PackagingMaterial WITH(HOLDLOCK) WHERE ID=?',material).fetchval()
        if maximum is None:raise HTTPException(422,'Maintain maximum gross payload on the selected Pallet material.')
        carton=response_weights(cur,item_id)['CartonGrossWeightKG']
        if row['LoadPlanID'] is not None:
            plan=cur.execute('SELECT Inputs,Result FROM dbo.ContainerLoadPlan WHERE ID=? AND ItemID=?',row['LoadPlanID'],item_id).fetchone()
            if plan and json.loads(plan[0]).get('mode')=='pallet':
                result=json.loads(plan[1]);count=result.get('cartons_per_pallet')
                if carton is None or assembly.get('TareKG') is None:raise HTTPException(422,'Complete carton and pallet gross weights before applying a pallet plan.')
                if count is None or Decimal(str(carton))*Decimal(str(count))+Decimal(str(assembly['TareKG']))>Decimal(str(maximum)):
                    raise HTTPException(422,'Saved pallet plan exceeds the maintained maximum gross payload. Recalculate it.')
        dimensions=response_dimensions(cur,item_id)
        if carton is None or assembly.get('TareKG') is None or not dimensions or not all(row.get(k) for k in ('CartonsPerLayer','LayersPerPallet','ResponseMaxPalletHeightMM')):
            if complete and row['ConfigurationRequest']=='Pallet load':raise HTTPException(422,'Complete carton/pallet gross weights, final dimensions, maximum height and pallet counts before submitting.')
            continue
        dims=assembly['Dimensions'];fit=layout(Decimal(dims['length']),Decimal(dims['width']),Decimal(dimensions['length']),Decimal(dimensions['width']),True)
        layers=max(0,int((Decimal(row['ResponseMaxPalletHeightMM'])-Decimal(dims['height']))//Decimal(dimensions['height'])))
        try:pallet_capacity(len(fit.positions()),layers,carton,assembly['TareKG'],maximum,row['CartonsPerLayer'],row['LayersPerPallet'])
        except ValueError as exc:raise HTTPException(422,str(exc)) from exc
