"""Configured recipe components and exact contributions to finished-product cost."""
from decimal import Decimal as D
from pydantic import BaseModel,ConfigDict,Field
from typing import Annotated,Literal

class ComponentCost(BaseModel):
    model_config=ConfigDict(extra='forbid')
    CostBasis:Literal['Ingredient','FinishedProduct']='Ingredient'
    SourceSheetID:int|None=Field(None,ge=1)
    ManualFields:list[Literal['USDPerLb','RatioPct']]=Field(default_factory=list,max_length=2)
    ComponentID:int=Field(ge=1)
    SystemKey:str=Field(min_length=1,max_length=50)
    ComponentName:str=Field(min_length=1,max_length=100)
    USDPerLb:Annotated[D,Field(ge=0,max_digits=19,decimal_places=6)]|None=None
    RatioPct:Annotated[D,Field(ge=0,le=100,max_digits=9,decimal_places=6)]=D(0)

def approved_component(component,saved,approved):
    """Use sheet defaults until a specific field is overridden in this TCB recipe."""
    sheet=approved.get('SheetID')
    manual=saved.get('ManualFields',[]) if sheet and saved.get('SourceSheetID')==sheet else []
    if 'USDPerLb' not in manual:
        component['USDPerLb']=str(D(str(approved['SeasoningUSDPerLb'])).quantize(D('.000001')))
    if 'RatioPct' not in manual:component['RatioPct']=approved['SeasoningRatio']
    component['CostBasis']=approved.get('SeasoningCostBasis','Ingredient')
    if sheet:component.update(SourceSheetID=sheet,ManualFields=list(manual))
    return component

def component_rows(recipe):
    rows=getattr(recipe,'Components',None)
    if rows is not None:return [(r.USDPerLb,r.RatioPct) for r in rows]
    return [(recipe.SeasoningUSDPerLb,recipe.SeasoningRatio),(recipe.OilUSDPerLb,recipe.OilPct)]

def validate_recipe(recipe):
    rows=component_rows(recipe)
    if recipe.RMRatio+sum((ratio for _,ratio in rows),D(0))!=100:
        raise ValueError('RM plus all Recipe Component ratios must total 100%.')
    if any(ratio and price is None for price,ratio in rows):raise ValueError('Enter a cost for every Recipe Component with a positive ratio.')
    if recipe.Components is not None and len({r.ComponentID for r in recipe.Components})!=len(recipe.Components):
        raise ValueError('Use one cost per Recipe Component.')
    return recipe

def catalog(cur):
    from npd_api import query
    components=query(cur,'SELECT ID,ComponentName,SystemKey,Status FROM dbo.RecipeComponent ORDER BY ID')
    mappings=query(cur,'SELECT p.ProcessID,p.ComponentID FROM dbo.ProcessRecipeComponent p ORDER BY p.ProcessID,p.ComponentID')
    return dict(components=components,mappings=mappings)

def applicable_ids(inputs,path,config):
    """Recipe Info always contains Seasoning, independently of process mappings."""
    return {row['ID'] for row in config['components'] if row['SystemKey']=='Seasoning'}


def process_component_inputs(inputs,config,approved=None,paths=None):
    """Resolve fixed Seasoning inputs; unpublished sheets never supply defaults."""
    import copy
    from recipe_scope import normalize_seasoning_scope,allows_seasoning
    result=normalize_seasoning_scope(inputs,config,approved,paths or [])
    source=approved and not approved.get('Stale') and not approved.get('Inactive')
    legacy={'Seasoning':('SeasoningUSDPerLb','SeasoningRatio'),'Oil':('OilUSDPerLb','OilPct')}
    def apply(path,row):
        allowed=applicable_ids(result,path,config)
        if path=='0' and roots:allowed.intersection_update(*(applicable_ids(result,root,config) for root in roots))
        existing=row.get('Components')
        if existing is None:
            existing=[dict(ComponentID=c['ID'],SystemKey=c['SystemKey'],ComponentName=c['ComponentName'],
                USDPerLb=row.get(legacy[c['SystemKey']][0]),RatioPct=row.get(legacy[c['SystemKey']][1]) or 0,
                CostBasis=row.get('SeasoningCostBasis','Ingredient') if c['SystemKey']=='Seasoning' else 'Ingredient')
                for c in config['components'] if c['SystemKey'] in legacy]
        components=[]
        for definition in config['components']:
            if definition['ID'] not in allowed:continue
            saved=next((r for r in existing if r['ComponentID']==definition['ID']),{})
            component=dict(ComponentID=definition['ID'],SystemKey=definition['SystemKey'],ComponentName=definition['ComponentName'],
                USDPerLb=saved.get('USDPerLb'),RatioPct=saved.get('RatioPct') or 0,CostBasis=saved.get('CostBasis','Ingredient'))
            sheet_applies=all(allows_seasoning(approved,root) for root in roots) if path=='0' else allows_seasoning(approved,path)
            if saved.get('SourceSheetID') and not sheet_applies:
                if 'USDPerLb' not in saved.get('ManualFields',[]):component['USDPerLb']=None
                if 'RatioPct' not in saved.get('ManualFields',[]):component['RatioPct']=0
            if source and definition['SystemKey']=='Seasoning' and sheet_applies:
                approved_component(component,saved,approved)
            components.append(component)
        total=sum((D(str(c['RatioPct'])) for c in components),D(0))
        if total>100:raise ValueError('Recipe Component ratios exceed 100%.')
        row.update(Components=components,RMRatio=str(100-total),SeasoningRatio='0',SeasoningUSDPerLb=None,
            SeasoningCostBasis='Ingredient',OilPct='0',OilUSDPerLb=None)
        for c in components:
            if c['SystemKey'] in legacy:
                price,ratio=legacy[c['SystemKey']];row.update({price:c['USDPerLb'],ratio:c['RatioPct']})
                if c['SystemKey']=='Seasoning':row['SeasoningCostBasis']=c['CostBasis']
    roots=set(paths or [])
    roots.update(stage['Path'].split('/')[0]+'/'+stage['Path'].split('/')[1] for stage in result.get('ProcessLosses') or [] if stage['Path']!='0')
    material=result.setdefault('MaterialCosts',[])
    from tcb_costs import Recipe
    # Use the same legacy fallback as the costing engine, then give every grade
    # its own recipe so one grade's process cannot affect unrelated grades.
    if roots:
        for path in sorted(roots):
            if any(row['Path']==path for row in material):continue
            children=[row for row in material if row['Path'].startswith(path+'/')]
            if children and any({k:row.get(k) for k in Recipe.model_fields}!={k:children[0].get(k) for k in Recipe.model_fields} for row in children):
                raise ValueError('Review the Level 1 recipe for '+path+'; saved child recipes differ.')
            fallback=children[0] if children else result
            material.append({'Path':path,**{k:copy.deepcopy(fallback[k]) for k in Recipe.model_fields if k in fallback}})
    # Resolve grade rows before mutating their root fallback.
    for row in result.get('MaterialCosts') or []:apply(row['Path'],row)
    apply('0',result)
    return result

def validate_assignments(inputs,saved,config,requires_recipe=False):
    definitions={r['ID']:r for r in config['components']}
    for path,recipe in [('0',inputs),*((r.Path,r) for r in inputs.MaterialCosts)]:
        if recipe.Components is None:continue
        allowed=applicable_ids(inputs,path,config)
        for row in recipe.Components:
            definition=definitions.get(row.ComponentID)
            if not definition:raise ValueError('A Recipe Component is no longer available. Refresh TCB.')
            if row.SystemKey!=definition['SystemKey']:raise ValueError('Recipe Component identity changed. Refresh TCB.')
            row.ComponentName=definition['ComponentName']
            if row.RatioPct and row.ComponentID not in allowed:
                raise ValueError(row.ComponentName+" is no longer used in Recipe Info. Use Seasoning instead.")


def component_contribution(recipe):
    if recipe.Components is not None:
        return sum(((r.USDPerLb or D(0))*(D(1) if r.CostBasis=="FinishedProduct" else r.RatioPct/100) for r in recipe.Components if r.RatioPct),D(0))
    seasoning=(recipe.SeasoningUSDPerLb or D(0))*(D(1) if recipe.SeasoningCostBasis=="FinishedProduct" else recipe.SeasoningRatio/100) if recipe.SeasoningRatio else D(0)
    return seasoning+(recipe.OilUSDPerLb or D(0))*recipe.OilPct/100
