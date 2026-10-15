"""Physical material tare and nested packaging gross weights, in kilograms."""
import json
from decimal import Decimal, localcontext


def material_tare(weight, basis, quantity, area=None):
    if weight is None or basis not in ('kg/EA', 'kg/m2'):
        return None
    if basis == 'kg/m2' and area is None:
        return None
    with localcontext() as ctx:
        ctx.prec=50
        return Decimal(str(weight))*Decimal(str(quantity))*(Decimal(str(area)) if basis == 'kg/m2' else Decimal(1))


def layer_tare(components):
    missing=[str(c.get('MaterialCode') or c.get('MaterialName') or 'Material') for c in components if c.get('TareWeightKG') is None]
    return dict(KG=None if missing or not components else str(sum((Decimal(str(c['TareWeightKG'])) for c in components),Decimal(0))),Missing=missing)


def decode_layers(value):
    if isinstance(value,str):
        try:value=json.loads(value)
        except ValueError:return {}
    if isinstance(value,dict):return value
    return {v['PackagingOrder']:v.get('Tare') for v in value or []}


def mix_contents_gross(row):
    from mix_efficiency import decoded,number
    structure=decoded(row.get('ProductMixSnapshot'),dict)
    children=decoded(row.get('MixResponseChildren'),list)
    if not children:return None
    quantities={str(c.get('ProductID')):number(c.get('UnitQuantity',c.get('MixUnitQuantity'))) for c in structure.get('items',[])} if structure else None
    seen=set();total=Decimal(0)
    for child in children:
        key=str(child.get('ProductID'))
        if key in seen or quantities is not None and key not in quantities:return None
        seen.add(key)
        count=quantities.get(key) if quantities is not None else number(child.get('UnitQuantity'))
        if count is None:return None
        if 'CartonGrossWeightKG' in child:gross=number(child['CartonGrossWeightKG'],zero=True)
        else:
            grams=child.get('ApplicableNetWeightGrams') if child.get('ApplicableNetWeightGrams') is not None else child.get('WeightGrams')
            net=dict(PrimaryNetWeightGrams=grams,NoOfPrimaryUnit=child.get('UnitsPerCarton'),NoOfSecondaryUnit=child.get('UnitsPerTertiary'))
            gross=number(gross_weights(child,net)['CartonGrossWeightKG'],zero=True)
        if gross is None:return None
        total+=count*gross
    return total if quantities is None or seen==set(quantities) else None


def gross_weights(row, net):
    """An unknown layer propagates; zero tare must be explicitly maintained."""
    tares=decode_layers(row.get('LayerTareJSON'))
    layers=int(row.get('ResponseLayerCount') or row.get('RequestedLayerCount') or 2)
    out={}; previous=None
    with localcontext() as ctx:
        ctx.prec=50
        for index,order in enumerate(('Primary','Secondary','Tertiary')[:layers]):
            tare=tares.get(order)
            own=Decimal(str(tare['KG'])) if isinstance(tare,dict) and tare.get('KG') is not None else None
            if index==0:
                grams=net.get('PrimaryNetWeightGrams')
                contents=mix_contents_gross(row) if row.get('IsMixParent') else Decimal(str(grams))/1000 if grams is not None else None
            else:
                count=net.get('NoOfPrimaryUnit' if index==1 else 'NoOfSecondaryUnit')
                contents=previous*Decimal(str(count)) if previous is not None and count is not None else None
            previous=contents+own if contents is not None and own is not None else None
            out[order+'TareWeightKG']=str(own) if own is not None else None
            out[order+'GrossWeightKG']=str(previous) if previous is not None else None
        out['CartonGrossWeightKG']=str(previous) if previous is not None else None
    pallet_gross=None; container_gross=None
    assembly=row.get("PalletPricingJSON")
    if isinstance(assembly,str):assembly=json.loads(assembly)
    if assembly and assembly.get("PalletSize")!=row.get("ResponsePalletSize"):assembly=None
    from response_load_plan import read_plan
    plan=read_plan(row)
    if plan:
        inputs,result=plan['Inputs'],plan['Result']
        if inputs.get('mode')=='pallet' and inputs.get('carton_kg') is not None and inputs.get('pallet_kg') is not None:
            pallet_gross=Decimal(str(inputs['carton_kg']))*int(result['cartons_per_pallet'])+Decimal(str(inputs['pallet_kg']))
        if result.get('gross_kg') is not None:container_gross=Decimal(str(result['gross_kg']))
    elif previous is not None and str(row.get('ConfigurationRequest')) in ('Floor load','Both'):
        count=net.get('CalculatedCartonsPerContainer')
        if count is not None:container_gross=previous*Decimal(str(count))
    if assembly:
        cartons=net.get('LayersPerPallet')
        per_layer=row.get('CartonsPerLayer')
        count=plan['Result']['cartons_per_pallet'] if plan else int(cartons)*int(per_layer) if cartons is not None and per_layer is not None else None
        own=assembly.get('TareKG')
        pallet_gross=previous*Decimal(str(count))+Decimal(str(own)) if previous is not None and count is not None and own is not None else None
    out['GrossWeightPerPalletKG']=str(pallet_gross) if pallet_gross is not None else None
    out['GrossWeightPerContainerKG']=str(container_gross) if container_gross is not None else None
    return out


def layer_sql(alias):
    # Called only with static aliases from the read endpoints.
    return f"""(SELECT p.PackagingOrder,JSON_QUERY(p.SnapshotJSON,'$.Tare') Tare
      FROM dbo.PkgPricingMaster p WHERE p.RequestItemID={alias}.ID AND p.IsCurrent=1
      AND p.PackagingTypeName=CASE p.PackagingOrder WHEN 'Primary' THEN {alias}.FirstPMType WHEN 'Secondary' THEN {alias}.SecondPMType ELSE {alias}.ThirdPMType END
      FOR JSON PATH)"""


def response_weights(cur, item_id):
    from pkg_pricing_api import select
    from packing_way import packing_way
    row=select(cur,f"SELECT i.*,CAST(CASE WHEN EXISTS(SELECT 1 FROM dbo.OpportunityMixSnapshot ms WHERE ms.ParentItemID=i.OpportunityItemID) THEN 1 ELSE 0 END AS BIT) IsMixParent,{layer_sql('i')} LayerTareJSON FROM dbo.PackagingConfigurationRequestItem i WHERE i.ID=?",item_id)[0][0]
    from pallet_pricing_api import snapshot_sql
    row['PalletPricingJSON']=select(cur,'SELECT '+snapshot_sql('i')+' Snapshot FROM dbo.PackagingConfigurationRequestItem i WHERE ID=?',item_id)[0][0]['Snapshot']
    if row.get('IsMixParent'):
        row['MixResponseChildren']=select(cur,f'''SELECT (SELECT oi.ProductID,oi.MixUnitQuantity UnitQuantity,c.WeightGrams,c.ResponseLayerCount,c.RequestedLayerCount,c.UnitsPerCarton,c.UnitsPerTertiary,{layer_sql('c')} LayerTareJSON,COALESCE(c.ApplicableNetWeightGrams,c.WeightGrams) ApplicableNetWeightGrams
            FROM dbo.PackagingConfigurationRequestItem c JOIN dbo.OpportunityItem oi ON oi.ID=c.OpportunityItemID
            WHERE c.RequestID=? AND oi.ParentItemID=? FOR JSON PATH,INCLUDE_NULL_VALUES) Children''',row['RequestID'],row['OpportunityItemID'])[0][0]['Children']
    return packing_way(row)
