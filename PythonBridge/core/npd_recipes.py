"""Recipe quantities, applicable seasoning tiers and exact loss-adjusted costs."""
import json
from datetime import date,datetime,timezone
from decimal import Decimal,localcontext
from typing import Literal
from pydantic import BaseModel,ConfigDict,Field,model_validator

D=Decimal
LB_GRAMS=D('453.59237')

class RecipeLine(BaseModel):
    model_config=ConfigDict(extra='forbid')
    Kind:Literal['Raw','Seasoning']
    GradePath:str|None=Field(None,max_length=80)
    IngredientID:int|None=Field(None,ge=1)
    RatioPct:Decimal=Field(D(0),ge=0,le=100,max_digits=9,decimal_places=6)
    LossPct:Decimal=Field(D(0),ge=0,lt=100,max_digits=9,decimal_places=6)
    PriceID:int|None=Field(None,ge=1)
    PriceMode:Literal['Auto','Direct']='Auto'
    IngredientNote:str=Field('',max_length=300)
    Note:str=Field('',max_length=2000)
    DirectPricePerKg:Decimal|None=Field(None,ge=0,max_digits=19,decimal_places=6,allow_inf_nan=False)
    DirectPriceCurrency:Literal['VND','USD']|None=None
    DirectVendorID:int|None=Field(None,ge=1)

    @model_validator(mode='after')
    def price_source(self):
        if (self.DirectPricePerKg is None)!=(self.DirectPriceCurrency is None):
            raise ValueError('Enter a direct price and its currency together.')
        if (self.DirectPricePerKg is not None or self.PriceMode=='Direct' or self.DirectVendorID is not None) and self.PriceID is not None:
            raise ValueError('Choose a master price or a direct price, not both.')
        if self.Kind=='Seasoning' and self.IngredientNote:
            raise ValueError('Ingredient descriptions come from Ingredient Master.')
        return self

def obj(value,default=None):
    if value is None:return {} if default is None else default
    return json.loads(value) if isinstance(value,str) else value

def document(value):
    return json.dumps(value,default=str,ensure_ascii=False,separators=(',',':'))

def raw_grades(snapshot):
    return [{'GradePath':'0/'+str(r['ID']),'Description':r.get('Grade',''),
             'RatioPct':str(r.get('RatioPct',0))}
            for r in obj(snapshot).get('items',[]) if str(r.get('ParentID'))=='0']

def awarded_mt(item):
    return D(str(item.get('AnnualUnit') or 0))*D(str(item.get('EstPctAwarded') or 0))/100*D(str(item.get('WeightGrams') or 0))/1000000

def usd_rate(price,opportunity):
    code=str(price['CurrencyCode']).upper()
    if code=='USD':return D(1)
    rate=opportunity.get('ExchangeRateVNDPerUSD') if code=='VND' else opportunity.get('ExchangeRateCustomerCurrencyPerUSD') if code==opportunity.get('CustomerCurrencyCode') else price.get('ExchangeRateToUSD')
    if rate is None or D(str(rate))<=0:return None
    return D(str(rate))

def selected_price_issue(price,line,mt,today,opportunity):
    if not price:return 'Selected price is inactive or unavailable.'
    if price['IngredientID']!=line.IngredientID:return 'Selected price belongs to another ingredient.'
    if any(price.get(key)!='Active' for key in ('Status','IngredientStatus','VendorStatus')):return 'Selected ingredient, vendor or price is inactive.'
    base=D(str(price['BaseFactor']))
    if base<=0:return 'Selected price has no valid base-unit conversion.'
    required=mt*1000000*line.RatioPct/(1-line.LossPct/100)/100/base
    unit=price.get('BaseUoM','base units')
    def amount(value):return format(D(str(value)),',.6f').rstrip('0').rstrip('.')
    if required<D(str(price['QuantityFrom'])):
        return 'Minimum '+amount(price['QuantityFrom'])+' '+unit+'; required '+amount(required)+' '+unit+' after buffer.'
    if price.get('QuantityTo') is not None and required>=D(str(price['QuantityTo'])):
        return 'Tier below '+amount(price['QuantityTo'])+' '+unit+'; required '+amount(required)+' '+unit+' after buffer.'
    if price['EffectiveFrom']>today or price.get('EffectiveTo') and price['EffectiveTo']<today:return 'Selected price is not effective today (UTC).'
    if not usd_rate(price,opportunity):return 'Selected price needs a valid exchange rate.'
    return 'Selected price has no valid unit conversion.'


def evaluate(lines,item,prices,opportunity,ready=False,today=None,ingredients=None,vendors=None):
    """Raw rows have identity/ratio only. Price tiers use buffered required mass; seasoning cost is a finished-product contribution."""
    today=today or datetime.now(timezone.utc).date()
    fixed=raw_grades(item['GradeSnapshot'])
    expected={r['GradePath'] for r in fixed}
    raw=[r for r in lines if r.Kind=='Raw']
    retained={r.GradePath for r in raw}
    if not fixed or not raw or len(raw)!=len(retained) or not retained.issubset(expected):
        raise ValueError('Keep at least one fixed line for a captured Level 1 grade, with no duplicate or unknown grade lines.')
    included=[g for g in fixed if g['GradePath'] in retained]
    if any(r.IngredientID or r.PriceID or r.LossPct for r in raw):
        raise ValueError('Fixed raw-grade lines contain ratios only; maintain raw pricing and loss in TCB.')
    if any(r.GradePath for r in lines if r.Kind=='Seasoning'):
        raise ValueError('Seasoning lines cannot replace fixed raw-grade identities.')
    ingredient_ids=[r.IngredientID for r in lines if r.Kind=='Seasoning' and r.IngredientID]
    if len(ingredient_ids)!=len(set(ingredient_ids)):raise ValueError('Use one seasoning line per ingredient.')
    total=sum((r.RatioPct for r in lines),D(0))
    if ready and total!=100:raise ValueError('Recipe ratios must total exactly 100%.')
    order_mt=awarded_mt(item)
    grade_share=sum((D(g['RatioPct']) for g in included),D(0))
    mt=order_mt*grade_share/100
    if ready and mt<=0:raise ValueError('Estimated awarded MT must be positive before pricing a recipe.')
    seasoning=sum((r.RatioPct for r in lines if r.Kind=='Seasoning'),D(0))
    if ready and seasoning>=100:raise ValueError('Keep a positive raw-material share in the recipe.')
    cost=D(0);fg_cost=D(0);fg_buffer_cost=D(0);buffer_total=D(0);output=[];issues=[]
    with localcontext() as context:
        context.prec=50
        for line in lines:
            result=line.model_dump(mode='json')
            vendor=next((v for v in vendors or [] if v['ID']==line.DirectVendorID and v.get('Status')=='Active'),None)
            if line.DirectVendorID and not vendor:raise ValueError('Choose an active vendor for direct price line '+str(len(output)+1)+'.')
            if vendor:result.update(VendorName=vendor['VendorName'])
            if line.Kind=='Raw':
                rate=usd_rate({'CurrencyCode':line.DirectPriceCurrency or 'USD'},opportunity)
                if line.DirectPricePerKg is not None and not rate:issues.append('Enter a positive VND / USD exchange rate for nut-grade line '+str(len(output)+1)+'.')
                usd_kg=line.DirectPricePerKg/rate if line.DirectPricePerKg is not None and rate else D(0)
                fg_cost+=usd_kg*line.RatioPct/100
                fg_buffer_cost+=usd_kg*line.RatioPct/100
                buffer_total+=line.RatioPct
                name=next(g['Description'] for g in fixed if g['GradePath']==line.GradePath)
                result.update(Description=line.IngredientNote,GradeNature=name,Origin='NA',BufferRatio=str(line.RatioPct),TotalQtyMT=str(line.RatioPct/100*mt),
                              USDPerKg=str(usd_kg),VNDPerKg=str(usd_kg*D(str(opportunity['ExchangeRateVNDPerUSD']))) if opportunity.get('ExchangeRateVNDPerUSD') else None,
                              EffectiveUSDPerLb=str(usd_kg*LB_GRAMS/1000))
                output.append(result);continue
            ingredient=next((i for i in ingredients or [] if i['ID']==line.IngredientID),None)
            result.update(Description=ingredient['Description'] if ingredient else '',GradeNature=(ingredient.get('GradeNature') or '') if ingredient else '',Origin=(ingredient.get('Origin') or '') if ingredient else '')
            buffer=line.RatioPct/(1-line.LossPct/100)
            buffer_total+=buffer
            result.update(BufferRatio=str(buffer),TotalQtyMT=str(buffer/100*mt))
            candidates=[]
            for p in prices:
                if p['IngredientID']!=line.IngredientID or p.get('Status')!='Active' or p.get('IngredientStatus')!='Active' or p.get('VendorStatus')!='Active':continue
                base=D(str(p['BaseFactor']));unit=D(str(p['PriceUnitFactor']))
                if base<=0 or unit<=0:continue
                required=mt*1000000*buffer/100/base
                if p['EffectiveFrom']>today or p.get('EffectiveTo') and p['EffectiveTo']<today:continue
                if required<D(str(p['QuantityFrom'])) or p.get('QuantityTo') is not None and required>=D(str(p['QuantityTo'])):continue
                rate=usd_rate(p,opportunity)
                if not rate:continue
                price=D(str(p['UnitPrice']))/rate*LB_GRAMS/unit
                candidates.append({**p,'RequiredQuantity':str(required),'USDPerLb':str(price),'USDPerKg':str(price*1000/LB_GRAMS),
                    'VNDPerKg':str(price*1000/LB_GRAMS*D(str(opportunity['ExchangeRateVNDPerUSD']))) if opportunity.get('ExchangeRateVNDPerUSD') else None})
            # Competing vendors remain explicit options. Overlapping same-vendor tiers are rejected on master save.
            candidates.sort(key=lambda p:(D(p['RequiredQuantity'])-D(str(p['QuantityFrom'])),D(p['USDPerLb']),-p['EffectiveFrom'].toordinal(),p['ID']))
            chosen=next((p for p in candidates if p['ID']==line.PriceID),None) if line.PriceID else next(iter(candidates),None)
            direct=None
            if line.PriceMode=='Direct' and line.DirectPricePerKg is None:
                if line.RatioPct:issues.append('Enter a direct ingredient price for line '+str(len(output)+1)+'.')
                chosen=None
            elif line.DirectPricePerKg is not None:
                ingredient=next((i for i in ingredients or [] if i['ID']==line.IngredientID and i['Status']=='Active'),None)
                rate=usd_rate({'CurrencyCode':line.DirectPriceCurrency},opportunity)
                if not ingredient:issues.append('Choose an active ingredient for direct price line '+str(len(output)+1)+'.')
                elif not rate:issues.append('Enter a positive VND / USD exchange rate for direct price line '+str(len(output)+1)+'.')
                else:
                    usd_kg=line.DirectPricePerKg/rate
                    direct={'IngredientCode':ingredient['IngredientCode'],'Description':ingredient['Description'],
                            'IngredientVersion':ingredient['IngredientVersion'],'GradeNature':ingredient.get('GradeNature',''),'Origin':ingredient.get('Origin',''),'CurrencyCode':line.DirectPriceCurrency,
                            'UnitPrice':str(line.DirectPricePerKg),'USDPerKg':str(usd_kg),'USDPerLb':str(usd_kg*LB_GRAMS/1000),
                            'VNDPerKg':str(usd_kg*D(str(opportunity['ExchangeRateVNDPerUSD']))) if opportunity.get('ExchangeRateVNDPerUSD') else None}
                if direct and vendor:direct.update(VendorID=vendor['ID'],VendorName=vendor['VendorName'])
                chosen=None
            elif not chosen:
                if line.PriceID:
                    selected_price=next((p for p in prices if p['ID']==line.PriceID),None)
                    reason=selected_price_issue(selected_price,line,mt,today,opportunity)
                    result.update(SelectedPrice=selected_price,PriceIssue=reason)
                    if line.RatioPct:issues.append('Seasoning line '+str(len(output)+1)+': '+reason)
                elif line.RatioPct:issues.append('Choose an applicable ingredient price for seasoning line '+str(len(output)+1)+'.')
            selected=direct or chosen
            effective=D(selected['USDPerLb']) if selected else D(0)
            cost+=effective*line.RatioPct/100
            usd_kg=D(selected['USDPerKg']) if selected else D(0)
            fg_cost+=usd_kg*line.RatioPct/100
            fg_buffer_cost+=usd_kg*buffer/100
            if selected:
                result.update(USDPerKg=str(usd_kg),VNDPerKg=selected.get('VNDPerKg'),Description=selected.get('Description',result['Description']),GradeNature=selected.get('GradeNature',result['GradeNature']),Origin=selected.get('Origin',result['Origin']))
            result.update(PriceID=chosen['ID'] if chosen else line.PriceID,Price=chosen,DirectPrice=direct,
                          Candidates=candidates,EffectiveUSDPerLb=str(effective) if selected else None)
            output.append(result)
        if ready and issues:raise ValueError(' '.join(issues))
        seasoning_price=cost
        seasoning_loss=(buffer_total/total-1)*100 if total else D(0)
        if seasoning_loss>=100 or seasoning_loss.quantize(D(".01"))>=100:
            issues.append("Loss by weight must be below 100% before submission.")
        if ready and (seasoning_price>=D('10000000000000') or seasoning_price.quantize(D('.000001'))>=D('10000000000000')):
            raise ValueError('Seasoning USD/lbs exceeds the supported TCB price range. Review price units and exchange rates.')
        cost_complete=not any('line ' in issue for issue in issues)
        raw_total=100-seasoning
        included_total=sum((D(g['RatioPct']) for g in included),D(0))
        differences=any(raw_total>0 and included_total>0 and abs(next(r.RatioPct for r in raw if r.GradePath==g['GradePath'])/raw_total*100-D(g['RatioPct'])/included_total*100)>D('.000001') for g in included)
        return {'ApplicableGradePaths':[g['GradePath'] for g in included],'OrderEstimatedAwardedMT':str(order_mt),'GradeSharePct':str(grade_share),'EstimatedAwardedMT':str(mt),'RatioTotal':str(total),'SeasoningRatio':str(seasoning),
                'SeasoningUSDPerLb':str(seasoning_price) if cost_complete else None,
                'SeasoningUSDPerKg':str(cost*1000/LB_GRAMS) if cost_complete else None,
                'CostFGUSDPerKg':str(fg_cost) if cost_complete else None,
                'CostFGWithBufferUSDPerKg':str(fg_buffer_cost) if cost_complete else None,
                'LossByValuePct':str((fg_buffer_cost/fg_cost-1)*100) if fg_cost and cost_complete else None,
                'SeasoningContributionUSDPerLb':str(cost),'SeasoningCostBasis':'FinishedProduct',
                'LossWeightBasis':'Recipe','SeasoningLossPct':str(seasoning_loss),'ExchangeRateVNDPerUSD':opportunity.get('ExchangeRateVNDPerUSD'),
                'Lines':output,'Issues':issues,
                'GradeRatiosDiffer':differences,
                'Warnings':['Raw grade proportions differ from Product Grades. TCB grade proportions are unchanged; review them separately.'] if differences else []}

def quote_key(calculation):
    # SQL decimal scale and JSON formatting must not turn an equal quote into a
    # stale quote. Compare numeric values exactly, keeping identity/version data.
    def amount(value):return D(str(value)) if value is not None else None
    def direct(row):
        value=row.get('DirectPrice')
        if value is None:return None
        return {key:amount(item) if key in ('UnitPrice','USDPerKg','VNDPerKg','USDPerLb') else item for key,item in value.items()}
    return [(r.get('IngredientID'),r.get('PriceID'),(r.get('Price') or {}).get('RowVersion'),
             (r.get('Price') or {}).get('IngredientVersion'),amount((r.get('Price') or {}).get('USDPerLb')),amount((r.get('Price') or {}).get('RequiredQuantity')),direct(r))
            for r in calculation['Lines'] if r['Kind']=='Seasoning']+[(calculation.get('LossWeightBasis','Seasoning'),)]


def seasoning_inputs(inputs,approved,config=None,paths=None):
    """Apply the approved seasoning to every recipe without changing grade ratios."""
    if config is not None:
        from recipe_components import process_component_inputs
        return process_component_inputs(inputs,config,approved,paths)
    import copy
    result=copy.deepcopy(inputs)
    if not approved or approved.get('Stale') or approved.get('Inactive'):return result
    def apply(row):
        row['SeasoningCostBasis']=approved.get('SeasoningCostBasis','Ingredient')
        seasoning=D(str(approved['SeasoningRatio']));oil=D(str(row.get('OilPct') or 0))
        if row.get('Components') is not None:
            components=row['Components'];target=next((c for c in components if c['SystemKey']=='Seasoning'),None)
            if target is None and approved.get('SeasoningComponentID'):
                target={'ComponentID':approved['SeasoningComponentID'],'SystemKey':'Seasoning','ComponentName':'Seasoning'};components.append(target)
            if target is not None:target.update(RatioPct=str(seasoning),USDPerLb=str(D(str(approved['SeasoningUSDPerLb'])).quantize(D('.000001'))),CostBasis=approved.get('SeasoningCostBasis','Ingredient'))
            other=sum((D(str(c.get('RatioPct') or 0)) for c in components if c['SystemKey']!='Seasoning'),D(0))
            if seasoning+other>100:raise ValueError('Approved seasoning plus other Recipe Components exceed 100%.')
            row.update(SeasoningRatio=str(seasoning),SeasoningUSDPerLb=str(D(str(approved['SeasoningUSDPerLb'])).quantize(D('.000001'))),RMRatio=str(100-seasoning-other));return
        if seasoning+oil>100:raise ValueError('Approved seasoning and Oil % exceed 100%. Review Oil % first.')
        row.update(SeasoningRatio=str(seasoning),SeasoningUSDPerLb=str(D(str(approved['SeasoningUSDPerLb'])).quantize(D('.000001'))),RMRatio=str(100-seasoning-oil))
    apply(result)
    for row in result.get('MaterialCosts') or []:apply(row)
    return result

def recipe_source_state(approved,snapshot):
    if not approved:return None
    result={**approved}
    result['Inactive']='RequiresRecipeConfirmation' in snapshot and not snapshot['RequiresRecipeConfirmation']
    if result.get('CapturedGrades') is not None:result['Stale']=result['CapturedGrades']!=snapshot.get('items',[])
    return result


def validate_submission(result):
    loss=D(result["SeasoningLossPct"])
    if loss>=100 or loss.quantize(D(".01"))>=100:
        raise ValueError("Loss by weight must be below 100% before submission.")
