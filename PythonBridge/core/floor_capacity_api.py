"""Read-only draft floor-load proposals; manual response counts are checked on save."""
import json
from decimal import Decimal
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,ConfigDict,Field
from auth import AccessContext,get_access_context
from container_loading import container_types,loading_profiles
from load_planning import Dimensions,PlanInput,plan
from load_planning_api import Specification
from pkg_pricing_api import api_cursor,authorize,select,document

router=APIRouter(prefix='/api/packaging/items',tags=['Floor capacity'])

class FloorPreview(BaseModel):
    model_config=ConfigDict(extra='forbid')
    Carton:Dimensions
    CartonGrossKG:Decimal=Field(gt=0,le=100000,allow_inf_nan=False)

def propose_floor(records,carton,gross):
    result=[]
    for record in records:
        row=dict(ContainerID=record['ID'],Code=record['Code'])
        try:
            spec=Specification.model_validate_json(record['Specifications']) if isinstance(record['Specifications'],str) else Specification.model_validate(record['Specifications'])
            if spec.payload_kg is None:raise ValueError('Maintain maximum container payload before proposing a load.')
            inputs=PlanInput(mode='floor',weight_source='manual',carton=carton,carton_kg=gross,
                container=spec.model_dump(include={'length','width','height'}),
                **{k:v for k,v in spec.model_dump().items() if k not in ('length','width','height')})
            row.update(Inputs=inputs.model_dump(mode='json'),Result=plan(inputs))
        except ValueError as exc:row['error']=str(exc)
        result.append(row)
    return json.loads(document(result))

@router.post('/{item_id}/floor-capacity')
def preview(item_id:int,body:FloorPreview,ctx:AccessContext=Depends(get_access_context)):
    with api_cursor() as cur:
        authorize(cur,ctx.username,item_id)
        owner=select(cur,'SELECT i.ConfigurationRequest,i.ContainerRequest,i.ShipmentContainerSizeFT,oi.ParentItemID FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID WHERE i.ID=?',item_id)[0][0]
        if owner['ParentItemID'] is not None or owner['ConfigurationRequest'] not in ('Floor load','Both'):
            raise HTTPException(422,'Floor proposals apply to standalone or Mix parent Floor load/Both responses.')
        records=select(cur,"SELECT ID,Code,Specifications FROM dbo.ContainerTypeMaster WHERE Status='Active' ORDER BY SizeFT,Code")[0]
        return {'rows':propose_floor(records,body.Carton,body.CartonGrossKG)}

def validate_manual_count(count,proposal):
    if count is None:return
    value=Decimal(str(count))
    if not value.is_finite() or value<1 or value!=value.to_integral_value():raise ValueError('Use a positive whole Carton / Container count.')
    if proposal.get('error'):raise ValueError(proposal['error'])
    maximum=proposal['Result']['cartons']
    if value>maximum:
        raise ValueError('Manual Carton / Container exceeds the feasible proposal of '+str(maximum)+'. Check dimensions, payload and the 3D arrangement.')

def validate_saved_floor(cur,item_ids,complete=False):
    from load_planning_api import response_dimensions
    from packaging_weight import response_weights
    rows=select(cur,"""SELECT i.* FROM dbo.PackagingConfigurationRequestItem i
       JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
       WHERE i.ID IN(SELECT value FROM OPENJSON(?)) AND oi.ParentItemID IS NULL
        AND i.ConfigurationRequest IN('Floor load','Both')""",json.dumps(list(item_ids)))[0]
    for row in rows:
        profiles=loading_profiles(row.get('ContainerLoadProfiles'))
        counts={code:p.get('CartonsPerContainer',p.get('CartonsPerContainerFloor')) for code,p in profiles.items() if isinstance(p,dict)}
        if row.get('SelectedContainerType') and row.get('CartonsPerContainer') is not None:counts[row['SelectedContainerType']]=row['CartonsPerContainer']
        counts={code:value for code,value in counts.items() if value is not None}
        from container_loading import proposed_types
        proposed=proposed_types(row)
        if proposed is not None:counts={code:value for code,value in counts.items() if code in proposed}
        if complete and proposed is not None and any(code not in counts for code in proposed):
            raise HTTPException(422,'Maintain a valid carton count for every proposed container before confirming.')
        if not counts:continue
        dimensions=response_dimensions(cur,row['ID']);gross=response_weights(cur,row['ID'])['CartonGrossWeightKG']
        if not dimensions or gross is None:
            if complete:raise HTTPException(422,'Save final carton dimensions and gross weight before confirming Floor load.')
            continue
        records=[r for r in select(cur,"SELECT ID,Code,Specifications FROM dbo.ContainerTypeMaster WHERE Status='Active'")[0] if r['Code'] in counts]
        proposals={p['Code']:p for p in propose_floor(records,Dimensions.model_validate(dimensions),gross)}
        for code,count in counts.items():
            if code not in proposals:raise HTTPException(422,'Choose an active container: '+code)
            try:validate_manual_count(count,proposals[code])
            except ValueError as exc:raise HTTPException(422,code+': '+str(exc)) from exc
