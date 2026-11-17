"""Sequential recipes for individual nut grades, flattened before pricing."""
from decimal import Decimal as D, localcontext, ROUND_HALF_UP
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field
from npd_recipes import RecipeLine, raw_grades

class DetailModel(BaseModel):
    model_config=ConfigDict(extra='forbid')
class LevelIngredient(DetailModel):
    IngredientID:int|None=Field(None,ge=1)
    RatioPct:D=Field(D(0),ge=0,le=100,max_digits=9,decimal_places=6)
class RecipeLevel(DetailModel):
    ProcessName:str=Field('',max_length=150)
    # Process Type Master identity; LossPct defaults from Loss Process Master and stays user-editable.
    ProcessTypeID:int|None=Field(None,ge=1)
    LossPct:D=Field(D(0),ge=0,lt=100,max_digits=9,decimal_places=6)
    OutputName:str=Field('',max_length=300)
    BaseRatioPct:D=Field(D(100),ge=0,le=100,max_digits=9,decimal_places=6)
    Ingredients:list[LevelIngredient]=Field(default_factory=list,max_length=100)
class NutRecipe(DetailModel):
    GradePath:str=Field(max_length=80)
    BlendRatioPct:D=Field(ge=0,le=100,max_digits=9,decimal_places=6)
    Levels:list[RecipeLevel]=Field(min_length=1,max_length=12)
class RecipeDetails(DetailModel):
    Version:Literal[1]=1
    Nuts:list[NutRecipe]=Field(min_length=1,max_length=100)

def flatten(details, snapshot, pricing, ready=False):
    """Pricing comes from Full view; identities, ratios and level losses come from Details.

    A level's loss applies to everything entering it, including earlier-level output,
    so buffers compound: Level 1 material in a two-level recipe is divided by both yields.
    """
    fixed={r['GradePath']:r for r in raw_grades(snapshot)}
    paths=[n.GradePath for n in details.Nuts]
    if len(paths)!=len(set(paths)) or not set(paths)<=set(fixed):
        raise ValueError('Use each captured Level 1 nut grade at most once in Details.')
    issues=[]
    if sum((n.BlendRatioPct for n in details.Nuts),D(0))!=100:
        issues.append('Nut blend ratios must total exactly 100%.')
    full={}; exact={}; buffered={}
    prior={(line.Kind,line.GradePath if line.Kind=='Raw' else line.IngredientID):line for line in pricing}
    def add(key,ratio,factor,kind,path=None,ingredient=None):
        exact[key]=exact.get(key,D(0))+ratio
        buffered[key]=buffered.get(key,D(0))+ratio*factor
        full.setdefault(key,dict(Kind=kind,GradePath=path,IngredientID=ingredient))
    with localcontext() as ctx:
        ctx.prec=60
        for nut in details.Nuts:
            carry=nut.BlendRatioPct/100;factor=D(1)
            for index in range(len(nut.Levels)-1,-1,-1):
                level=nut.Levels[index]
                factor/=1-level.LossPct/100
                label=f"{fixed[nut.GradePath]['Description']} Level {index+1}"
                if level.BaseRatioPct+sum((i.RatioPct for i in level.Ingredients),D(0))!=100:
                    issues.append(label+': ratios must total exactly 100%.')
                for number,ingredient in enumerate(level.Ingredients):
                    if not ingredient.IngredientID:issues.append(label+': choose an ingredient.')
                    key=('Seasoning',ingredient.IngredientID) if ingredient.IngredientID else ('Missing',nut.GradePath,index,number)
                    add(key,carry*ingredient.RatioPct,factor,'Seasoning',ingredient=ingredient.IngredientID)
                carry*=level.BaseRatioPct/100
            add(('Raw',nut.GradePath),carry*100,factor,'Raw',path=nut.GradePath)
        if ready and issues:raise ValueError(' '.join(issues))
        keys=sorted(full,key=lambda k:(0 if full[k]['Kind']=='Raw' else 1,paths.index(full[k]['GradePath']) if full[k]['Kind']=='Raw' else str(full[k]['IngredientID'] or k)))
        ratios={key:exact[key].quantize(D('.000001'),rounding=ROUND_HALF_UP) for key in keys}
        # Reconcile only decimal serialization, never an incomplete recipe.
        if sum(exact.values())==100:
            biggest=max(keys,key=lambda key:exact[key])
            ratios[biggest]+=100-sum(ratios.values())
        lines=[]
        for key in keys:
            identity=full[key]; old=prior.get((identity['Kind'],identity['GradePath'] if identity['Kind']=='Raw' else identity['IngredientID']))
            values=old.model_dump() if old else {}
            # Combined loss is derived (display only); a manual BufferRatioPct stays user-owned.
            loss=((1-exact[key]/buffered[key])*100).quantize(D('.000001'),rounding=ROUND_HALF_UP) if buffered[key] else D(0)
            loss=min(loss,D('99.999999'))
            lines.append(RecipeLine(**{**values,**identity,'RatioPct':ratios[key],'LossPct':loss}))
        if len(lines)>300:raise ValueError('Full view supports up to 300 distinct nut and ingredient lines.')
    return lines,issues
