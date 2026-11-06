"""Retained desktop review: existing products/packaging, new transaction history.

Default is a rollback rehearsal. --retain commits only after reconciliation.
Never updates existing masters or source transactions.
"""
import argparse
from copy import deepcopy
from datetime import date
from decimal import ROUND_CEILING
from create_complex_mix_review_case import *
from schemas import OpportunityItemRow
import npd_api as npd
from npd_recipes import raw_grades, RecipeLine


class Case(Audit):
 def __init__(self):
  super().__init__()
  self.tag='QA-E2E-1106-'+uuid4().hex[:4].upper()
  self.sheet_report=[]; self.recipe_expected={}; self.pkg_calcs={}
  self.fx=D(26500)

 def actor(self,name):
  r=self.rows('SELECT ID,UserName FROM dbo.Users WHERE UserName=? AND IsActive=1',name)[0]
  scopes=frozenset(x['Scope'] for x in self.rows('SELECT Scope FROM dbo.UserAccess WHERE UserID=?',r['ID']))
  return AccessContext(r['ID'],r['UserName'],scopes)

 def create_opportunity(self):
  self.step('Reuse existing customer and seven Products; create four root items')
  self.ctx=self.actor('Admin'); self.manager=self.actor('hien.mai')
  self.pic_ctx=self.actor('hien.1'); self.npd_pic=self.actor('hien.npd')
  self.sales=self.actor('hien.sales')
  source=self.rows("SELECT * FROM dbo.Opportunity WHERE OpportunityNumber='OPP-2026-10336'")[0]
  self.one('Opportunity',source['ID']); self.one('Customer',source['CustomerID'])
  self.sources=self.rows('SELECT * FROM dbo.OpportunityItem WHERE OpportunityID=? ORDER BY ID',source['ID'])
  for r in self.sources:self.one('OpportunityItem',r['ID']);self.one('Product',r['ProductID'])
  h=dict(RowNum=1,Command='C',OpportunityNumber='',CustomerID=source['CustomerID'],
   OpportunityDesc=self.tag+' Review: Mix + mixed nuts + 1/2/4 layers + NPD return/approval',
   BidOpen='2026-11-06',BidClose='2026-12-15',ExchangeRateVNDPerUSD=self.fx,
   ExchangeRateCustomerCurrencyPerUSD='1.6')
  result=main.opportunity_batch(OpportunityBatchRequest(header_rows=[h],item_rows=[]),self.sales.username,False,self.sales.scopes)
  self.check(result['header_results'][0]['Status']=='OK','Sales creates Opportunity')
  self.opp=self.track('Opportunity',result['header_results'][0]['NewID'])
  self.number=self.one('Opportunity',self.opp)['OpportunityNumber']
  self.ids={}
  for src in [r for r in self.sources if not r['ParentItemID']]:
   values=dict(RowNum=1,Command='C',OpportunityNumber=self.number,ProductID=src['ProductID'],
    ItemDescription=self.tag+' '+src['ItemDescription'],AnnualUnit=src['AnnualUnit'],
    EstPctAwarded=60,ShelfPrice=src['ShelfPrice'],ContainerRequest=src['ContainerRequest'] or '40DC',ShipmentCostInfo=parsed(src['ShipmentCostInfo'] or '{}'))
   if src['ID']!=3813982:values.update(self.item_config(src))
   else:values['PackagingLayerCount']=1
   result=main.opportunity_batch(OpportunityBatchRequest(header_rows=[],item_rows=[values]),self.sales.username,False,self.sales.scopes)
   self.check(result['item_results'][0]['Status']=='OK','Root created '+str(src['ProductID']))
  for r in self.rows('SELECT * FROM dbo.OpportunityItem WHERE OpportunityID=?',self.opp):
   self.track('OpportunityItem',r['ID'])
   src=next(x for x in self.sources if x['ProductID']==r['ProductID'])
   self.ids[src['ID']]=r['ID']
  # Configure children before their parent's cumulative Quaternary packaging.
  for src in sorted(self.sources,key=lambda r:r['ParentItemID'] is None):
   identity=self.ids[src['ID']];current=self.one('OpportunityItem',identity)
   values=dict(RowNum=1,Command='U',ID=identity,RowVersion=b64(current['RowVersion']),
    OpportunityNumber=self.number,ProductID=src['ProductID'],ItemDescription=current['ItemDescription'],
    AnnualUnit=current['AnnualUnit'],EstPctAwarded=60,ShelfPrice=current['ShelfPrice'],**self.item_config(src))
   if src['ParentItemID']:
    for key in ('ProductID','ItemDescription','AnnualUnit','EstPctAwarded','ShelfPrice'):values.pop(key,None)
   result=main.opportunity_batch(OpportunityBatchRequest(header_rows=[],item_rows=[values]),self.sales.username,False,self.sales.scopes)
   self.check(result['item_results'][0]['Status']=='OK','Packaging and recipe requirements captured '+str(src['ID'])+' '+document(result))
  self.check(len(self.ids)==7,'Four roots plus three Mix children')
  self.close(self.one('OpportunityItem',self.ids[3813982])['ProductNetWeightGrams'],2800,'Parent weight derived from children')

 def item_config(self,src):
  keys=['WebPackagingRequirements','PackagingLayerCount','NumberOfPrimary','NumberOfSecondary','NumberOfTertiary',
   'PrimaryTypeID','SecondaryTypeID','TertiaryTypeID','QuaternaryTypeID','ContainerRequest',
   'ConfigurationRequest','PalletSize','PalletStacking','MaxPalletHeightMM']
  result={k:src[k] for k in keys if k in src and k in OpportunityItemRow.model_fields and src[k] is not None}
  result['ShipmentCostInfo']=parsed(src['ShipmentCostInfo'] or '{}')
  result['PalletSpecialComments']='QA review: verify four-layer yield, payload 1200 kg and all five container proposals.'
  if src['ParentItemID']:
   for key in ('ContainerRequest','ConfigurationRequest','PalletSize','PalletStacking','MaxPalletHeightMM','PalletSpecialComments'):result.pop(key,None)
  if src['ID']==3813988:result['ConfigurationRequest']='Pallet load'
  if src['ID']==3813986:
   result['ConfigurationRequest']='Floor load'
   # Pure floor load has no pallet quantity for a warehouse per-pallet fee.
   result['ShipmentCostInfo']['WHCostBreakdown']={key:0 for key in result['ShipmentCostInfo'].get('WHCostBreakdown',{})}
   result['ShipmentCostInfo']['WHCostCustomerPerPallet']=0
  if src['ID']!=3813982:
   tree=parsed(src['ProductGradeSnapshot']);tree['RequiresRecipeConfirmation']=src['ID']!=3813985
   tree['RecipeRequirements']=dict(LaunchingDate='2027-02-01',SpecialComments='QA: approve seasoning; retain grade proportions; compare recipe revisions.') if tree['RequiresRecipeConfirmation'] else {}
   for g in tree['items']:g['ParentID']=g['ParentID'].replace('\\/','/')
   result['ProductGradeSnapshot']=tree
  return result

 def masters(self):
  self.step('Add only two seasoning ingredients and one isolated Oil/Salt process')
  kg=self.cur.execute("SELECT ID FROM dbo.UoM WHERE UoMCode='KG' AND Status='Active'").fetchval()
  self.ingredients=[175,176]
  for name,nature,origin in [('Paprika powder','Sweet smoked paprika','Spain'),('Garlic powder','Dehydrated fine powder','Vietnam')]:
   row=npd.ingredient_save(npd.Ingredient(Description=self.tag+' '+name,GradeNature=nature,Origin=origin,BaseUoMID=kg),self.manager)['row']
   self.ingredients.append(self.track('NPDIngredient',row['ID']))
  row=loss_process_api.save(loss_process_api.LossMasterSave(ProcessType=self.tag+' Oil Salt Roasting',Shared=True,ComponentIDs=[1,2]),self.ctx)['rows'][0]
  self.roasting=self.track('LossProcessMaster',row['ID'])
  self.check(len(self.manifest['NPDIngredient'])==2,'Only two new ingredients; all other ingredient prices reused/direct')

 def transition(self,identity,stage,comment=None):
  row=self.one('PackagingConfigurationRequestItem',identity)
  return pkg.transition(identity,pkg.Transition(ExpectedRowVersion=b64(row['RowVersion']),TargetStage=stage,Comment=comment),self.pic_ctx if stage in ('Working','Pending Review') else self.manager)

 def packaging(self):
  self.step('Create one Packaging Request; assign distinct PIC and manager')
  request=pkg.manual_create(pkg.ManualRequest(OpportunityID=self.opp,
   ExpectedRowVersion=b64(self.one('Opportunity',self.opp)['RowVersion']),CreationKey=uuid4(),
   ResponseDue=date(2026,11,25),items=[dict(OpportunityItemID=i,ExpectedRowVersion=b64(self.one('OpportunityItem',i)['RowVersion'])) for i in self.ids.values()]),self.sales)
  self.request=request;self.track('PackagingConfigurationRequest',request['header']['ID'])
  self.response_ids={}
  for r in request['items']:
   self.track('PackagingConfigurationRequestItem',r['ID']);self.response_ids[r['OpportunityItemID']]=r['ID']
  for src in self.sources:
   if src['ParentItemID']:continue
   identity=self.response_ids[self.ids[src['ID']]];row=self.one('PackagingConfigurationRequestItem',identity)
   pkg.assign(identity,pkg.Assignment(ExpectedRowVersion=b64(row['RowVersion']),PICUserID=self.pic_ctx.user_id),self.manager)
   self.transition(identity,'Working')
  # Children first, then shipping parents, to exercise live recursive weight.
  for src in sorted(self.sources,key=lambda r:r['ParentItemID'] is None):self.package_response(src)
  mix=self.response_ids[self.ids[3813982]]
  before=self.one('OpportunityItem',self.ids[3813982])
  self.check(not before.get('PalletPricingID'),'Unapproved response has not published pallet snapshot')
  for src in self.sources:
   if src['ParentItemID']:continue
   identity=self.response_ids[self.ids[src['ID']]]
   self.transition(identity,'Pending Review')
   if src['ID'] in (3813982,3813988):
    self.transition(identity,'Returned','QA: confirm child packing quantities and payload, then resubmit.')
    self.check(self.one('PackagingConfigurationRequestItem',identity)['Stage']=='Returned','Packaging return persists')
    self.transition(identity,'Working')
    self.transition(identity,'Pending Review','QA: verified recursive weights and carton quantities.')
   self.transition(identity,'Approved','QA: approved quantities, prices, weights and loading proposals.')
  self.check(all(self.one('PackagingConfigurationRequestItem',r['ID'])['Stage']=='Approved' for r in request['items']),'All seven packaging responses approved; Mix grouped workflow completed')
  self.close(response_weights(self.cur,mix)['CartonGrossWeightKG'],'3.652','Mix gross includes all child and parent packaging tare')

 def package_response(self,src):
  old=self.one('PackagingConfigurationRequestItem',2021905+(src['ID']-3813982))
  identity=self.response_ids[self.ids[src['ID']]]
  print('PACKAGING',src['ID'],self.one('PackagingConfigurationRequestItem',identity)['ConfigurationRequest'],flush=True)
  fields={k:old[k] for k in ('ResponseLayerCount','UnitsPerCarton','UnitsPerTertiary','UnitsPerQuaternary',
   'NutDensity','ApplicableNetWeightGrams','ResponsePalletSize','ResponsePalletStacking','ResponseMaxPalletHeightMM',
   'ResponsePalletMaterialID','SelectedContainerType','CartonsPerLayer','LayersPerPallet','CartonsPerContainer') if old.get(k) is not None}
  if src['ID']==3813982:fields['SameConfig']=False
  if src['ID']==3813988:fields.pop('CartonsPerContainer',None)
  if src['ID']==3813986:
   for key in ('ResponsePalletSize','ResponsePalletStacking','ResponseMaxPalletHeightMM','ResponsePalletMaterialID','CartonsPerLayer','LayersPerPallet'):fields.pop(key,None)
  calculations=[];self.pkg_calcs[src['ID']]=[]
  for master in self.rows('SELECT * FROM dbo.PkgPricingMaster WHERE RequestItemID=? AND IsCurrent=1 ORDER BY ID',old['ID']):
   self.one('PkgPricingMaster',master['ID']);body=parsed(master['InputJSON'])
   body.pop('Fingerprint',None);body.pop('ReferencePricingMasterID',None)
   if body.get('DimensionID'):body['DimensionRowVersion']=b64(self.one('PackagingDimension',body['DimensionID'])['RowVersion'])
   for c in body['components']:
    quote=self.one('PackagingPrice',c['PriceID']);self.one('PackagingMaterial',quote['MaterialID'])
    c['PriceRowVersion']=b64(quote['RowVersion'])
    if c.get('DimensionID'):c['DimensionRowVersion']=b64(self.one('PackagingDimension',c['DimensionID'])['RowVersion'])
   calc=pricing.preview(identity,pricing.Calculation(**body),self.pic_ctx)['calculation']
   self.pkg_calcs[src['ID']].append(calc)
   calculations.append({**body,'Fingerprint':calc['Fingerprint']})
   n=('Primary','Secondary','Tertiary','Quaternary').index(master['PackagingOrder'])
   fields[('FirstPMType','SecondPMType','ThirdPMType','FourthPMType')[n]]=calc['PackagingTypeName']
   fields[('FirstPMMOQ','SecondPMMOQ','ThirdPMMOQ','FourthPMMOQ')[n]]=calc['FinalMOQ']
  self.response(identity,**fields,PricingCalculations=calculations)
  if old.get('PalletPricingID') and src['ID']!=3813986:
   snapshot=parsed(self.one('PalletPricingSnapshot',old['PalletPricingID'])['SnapshotJSON']);components=[]
   for c in snapshot['components']:
    q=self.one('PackagingPrice',c['ID']);m=self.one('PackagingMaterial',q['MaterialID'])
    components.append(dict(PriceID=q['ID'],RowVersion=b64(q['RowVersion']),MaterialRowVersion=b64(m['RowVersion']),Quantity=c['Quantity'],AreaM2=c.get('AreaM2')))
   saved=pallet.save(identity,pallet.Selection(PalletSize=snapshot['PalletSize'],PalletMaterialID=snapshot['PalletMaterialID'],components=components,ItemRowVersion=b64(self.one('PackagingConfigurationRequestItem',identity)['RowVersion'])),self.pic_ctx)
   self.track('PalletPricingSnapshot',saved['ID']);self.response(identity,PalletPricingID=saved['ID'])
  if old.get('LoadPlanID'):
   inp=parsed(self.one('ContainerLoadPlan',old['LoadPlanID'])['Inputs'])
   gross=response_weights(self.cur,identity)['CartonGrossWeightKG'];inp['carton_kg']=str(gross)
   floor=floor_preview(identity,FloorPreview(Carton=inp['carton'],CartonGrossKG=str(gross)),self.pic_ctx)['rows'] if src['ID']!=3813988 else []
   plans={};profiles={};selected=None
   for c in self.rows("SELECT * FROM dbo.ContainerTypeMaster WHERE Status='Active' AND Code IN('20DC','20RC','40DC','40HC','40RHC') ORDER BY ID"):
    self.one('ContainerTypeMaster',c['ID']);spec=parsed(c['Specifications'])
    body=deepcopy(inp);body['container']={k:spec[k] for k in ('length','width','height')}
    if src['ID']==3813986:body['mode']='floor'
    plan=loading.save(identity,loading.SavePlan(ContainerID=c['ID'],ContainerRowVersion=b64(c['RowVersion']),Inputs=body,ItemRowVersion=b64(self.one('PackagingConfigurationRequestItem',identity)['RowVersion'])),self.pic_ctx)
    self.track('ContainerLoadPlan',plan['ID']);plans[c['ID']]=plan['ID']
    profiles[c['Code']]=dict(Proposal=True,PalletsPerContainer=plan['Result']['loaded_units'])
    if floor:profiles[c['Code']]['CartonsPerContainer']=next(f['Result']['cartons'] for f in floor if f['Code']==c['Code'])
    if c['Code']==old['SelectedContainerType']:selected=plan['ID']
   extra={} if src['ID']==3813988 else {'CartonsPerContainer':profiles[old['SelectedContainerType']]['CartonsPerContainer']}
   self.response(identity,ContainerLoadPlanIDs=plans,LoadPlanID=selected,ContainerLoadProfiles=profiles,**extra)

 def sheet_row(self,identity):return npd.sheet_read(identity,self.manager)['row']
 def review(self,identity,action,comment=None,changes=None):
  return npd.sheet_review(identity,npd.Review(RowVersion=self.sheet_row(identity)['RowVersion'],Action=action,Comment=comment,Changes=changes),self.npd_pic if action=='Submit' else self.manager)['row']
 def new_sheet(self,item):
  row=self.one('NPDRecipeRequestItem',item)
  sheet=npd.sheet_create(item,npd.NewSheet(CreationKey=uuid4(),RowVersion=b64(row['RowVersion'])),self.npd_pic)['row']
  return self.track('NPDRecipeSheet',sheet['ID'])

 def recipe_lines(self,src,variant=0):
  fixed=raw_grades(parsed(src['ProductGradeSnapshot']))
  season=[D(3),D(1),D('1.5'),D('.5')]
  if variant:season=[D('2.5'),D('1.2'),D('1.8'),D('.5')]
  raw_total=100-sum(season);rows=[]
  for i,g in enumerate(fixed):
   ratio=D(g['RatioPct'])*raw_total/100
   if src['ID']==3813988:ratio+=D(1) if i==0 else -D(1)
   rows.append(dict(Kind='Raw',GradePath=g['GradePath'],RatioPct=str(ratio),LossPct=0,
    IngredientNote='QA nut base '+str(i+1),Note='Manual costing for recipe comparison; TCB master price stays independent.',
    DirectPricePerKg=str([D('7.5'),D('6.2')][i]),DirectPriceCurrency='USD',PriceMode='Direct'))
  for i,(ingredient,ratio,loss) in enumerate(zip(self.ingredients,season,[2,4,6,8])):
   row=dict(Kind='Seasoning',IngredientID=ingredient,RatioPct=str(ratio),LossPct=loss,Note='QA buffered ingredient quantity and '+('automatic master price' if i==0 else 'direct '+('VND' if i==1 else 'USD')+' price'))
   if i==0:row['PriceMode']='Auto'
   else:row.update(PriceMode='Direct',DirectPricePerKg=str([0,26500,4.2,3.1][i]),DirectPriceCurrency='VND' if i==1 else 'USD',DirectVendorID=24)
   rows.append(row)
  return rows

 def save_sheet(self,identity,lines,status='Price Ready',actor=None):
  result=npd.sheet_save(identity,npd.SheetSave(RowVersion=self.sheet_row(identity)['RowVersion'],Status=status,Lines=lines,ExchangeRateVNDPerUSD=self.fx),actor or self.npd_pic)
  self.check(not result['calculation'].get('Errors'),'Recipe calculation has no pricing/ratio errors')
  return result

 def recipes(self):
  self.step('Create five recipe items; complex six-line sheets with automatic and direct prices')
  eligible=[r for r in self.sources if r['ID'] not in (3813982,3813985)]
  result=npd.request_create(npd.RecipeRequest(CreationKey=uuid4(),RequestDue=date(2026,11,26),RequestNote=self.tag+' Review approved, returned, pending and draft revisions; only approved publishes.',Items=[dict(OpportunityItemID=self.ids[r['ID']],RowVersion=b64(self.one('OpportunityItem',self.ids[r['ID']])['RowVersion'])) for r in eligible]),self.sales)['row']
  self.rrq=self.track('NPDRecipeRequest',result['ID'])
  reqitems=npd.request_items(self.rrq,self.manager)['rows']
  self.recipe_items={r['OpportunityItemID']:r['ID'] for r in reqitems}
  for item in reqitems:
   self.track('NPDRecipeRequestItem',item['ID'])
   npd.assign(item['ID'],npd.Assignment(RowVersion=item['RowVersion'],PICUserID=self.npd_pic.user_id),self.manager)
  for src in eligible:
   item=self.recipe_items[self.ids[src['ID']]];identity=self.new_sheet(item);lines=self.recipe_lines(src)
   self.save_sheet(identity,lines,'Final' if src['ID']==3813988 else 'Price Ready')
   self.review(identity,'Submit')
   published=parsed(self.one('OpportunityItem',self.ids[src['ID']])['TCBCostInfo'] or '{}')
   self.check(not published.get('NPDRecipe'),'Pending initial sheet does not publish to Opportunity')
   if src['ID']==3813983:
    self.review(identity,'Return','QA: reduce sugar and balance paprika; keep recipe at 100%.')
    self.check(self.sheet_row(identity)['ApprovalStatus']=='Returned','Recipe return retained')
    lines=self.recipe_lines(src,1);self.save_sheet(identity,lines);self.review(identity,'Submit')
   changes=None
   if src['ID']==3813986:
    lines=self.recipe_lines(src,1)
    changes=npd.SheetSave(RowVersion=self.sheet_row(identity)['RowVersion'],Status='Final',Lines=lines,ExchangeRateVNDPerUSD=self.fx)
   self.review(identity,'Approve','QA: checked formula, buffered MOQ, price and grade review.',changes)
   self.recipe_expected[src['ID']]=lines
   self.check(self.one('NPDRecipeRequestItem',item)['ActiveSheetID']==identity,'Approval sets active sheet')
   if src['ID'] in (3813983,3813984,3813987):
    revision=self.new_sheet(item);new_lines=self.recipe_lines(src,1);self.save_sheet(revision,new_lines,'Draft' if src['ID']==3813983 else 'Price Ready')
    if src['ID']!=3813983:self.review(revision,'Submit')
    if src['ID']==3813984:self.review(revision,'Return','QA: trial revision not accepted; retain approved revision 1 for TCB.')
    linked=parsed(self.one('OpportunityItem',self.ids[src['ID']])['TCBCostInfo'])['NPDRecipe']
    self.check(linked['SheetID']==identity,'New unapproved revision keeps previous approved Opportunity link')
    if src['ID']==3813987:
     view=next(x for x in npd.request_items(self.rrq,self.manager)['rows'] if x['ID']==item)
     self.check(not view['CanAssignPIC'],'Pending review locks PIC assignment')
   self.recipe_oracle(src,identity,lines)
  for r in self.rows('SELECT ID FROM dbo.NPDRecipeSheet WHERE RequestItemID IN (SELECT ID FROM dbo.NPDRecipeRequestItem WHERE RequestID=?) ORDER BY RequestItemID,Revision',self.rrq):
   row=self.sheet_row(r['ID']);self.sheet_report.append({k:row.get(k) for k in ('ID','SheetNumber','ProductCode','Revision','Status','ApprovalStatus','PIC','ApprovedByName')})

 def recipe_oracle(self,src,identity,lines):
  calc=npd.sheet_read(identity,self.manager)['calculation'];base=D(0);buffered=D(0);season=D(0);total=D(0)
  for row in lines:
   ratio=D(row['RatioPct'])/100;buf=ratio/(1-D(row['LossPct'])/100);total+=buf
   if row['Kind']=='Raw':price=D(row['DirectPricePerKg'])
   elif row['IngredientID']==175:price=D(10000)/self.fx
   else:price=D(row['DirectPricePerKg'])/(self.fx if row['DirectPriceCurrency']=='VND' else 1)
   base+=price*ratio;buffered+=price*buf
   if row['Kind']=='Seasoning':season+=price*ratio
  for key,expected in [('CostFGUSDPerKg',base),('CostFGWithBufferUSDPerKg',buffered),('SeasoningUSDPerLb',season*D('.45359237')),('SeasoningLossPct',(total-1)*100)]:
   self.close(calc[key],expected,'Independent recipe '+key)
  self.close(calc['LossByValuePct'],(buffered/base-1)*100,'Independent recipe value loss')
  self.close(calc['SeasoningUSDPerKg'],season,'Independent weighted seasoning USD/kg')
  mt=D(self.one('NPDRecipeRequestItem',self.recipe_items[self.ids[src['ID']]])['AnnualUnit'])*D('.6')*D(src['ProductNetWeightGrams'])/1000000
  for calculated,line in zip(calc['Lines'],lines):
   qty=D(line['RatioPct'])/(1-D(line['LossPct'])/100)/100*mt*1000
   self.close(D(calculated['TotalQtyMT'])*1000,qty,'Buffered ingredient quantity KG')
  self.recipe_expected[src['ID']]=dict(lines=lines,seasoning_lb=season*D('.45359237'),seasoning_ratio=6,weight_loss=(total-1)*100,fg_kg=base,buffered_kg=buffered)

 def tcb(self):
  self.step('Save TCB: own/shared process loss, dynamic components, processing, packing and four PM yields')
  self.saved={}
  for src in self.sources:
   identity=self.ids[src['ID']];opened=tcb.read(identity,self.ctx)
   original=parsed(src['TCBCostInfo'] or '{}');old=deepcopy(original.get('Inputs') or {})
   selections=old.get('Prices') or []
   for p in selections:
    if p.get('PriceID'):p['PriceVersion']='0x'+bytes(self.one('RawMaterialPrice',p['PriceID'])['RowVersion']).hex()
   if src['ID']==3813982:
    values=dict(PackingUSDPerLb='.27')
   else:
    losses=old.get('ProcessLosses') or []
    for stage in losses:
     for code in stage['Codes']:
      if code and code['MasterID']==50181:code['MasterID']=self.roasting
      if code:
       m=self.one('LossProcessMaster',code['MasterID']);code.update(ProcessName=m['ProcessType'],Shared=bool(m['Shared']),MasterVersion='0x'+bytes(m['RowVersion']).hex())
    if src['ID'] in self.recipe_expected:
     m=self.one('LossProcessMaster',51195)
     stage=next((r for r in losses if r['Path']=='0'),None)
     if stage is None:stage=dict(Path='0',Codes=[],Ratios=[]);losses.append(stage)
     stage['Codes'].append(dict(MasterID=m['ID'],MasterVersion='0x'+bytes(m['RowVersion']).hex(),ProcessName=m['ProcessType'],Shared=bool(m['Shared'])))
     stage['Ratios'].append(str(self.recipe_expected[src['ID']]['weight_loss'].quantize(D('.01'))))
    recipes=[]
    for r in old.get('MaterialCosts') or []:
     comps=[]
     # Roasting belongs to Cashew family only; Almond has no oil or salt component.
     if r['Path']=='0/1' and src['ID']!=3813985:
      comps=[dict(ComponentID=2,SystemKey='Oil',ComponentName='Oil',USDPerLb='.5',RatioPct='2'),dict(ComponentID=1,SystemKey='Salt',ComponentName='Salt',USDPerLb='.2',RatioPct='1')]
     recipes.append(dict(Path=r['Path'],RMRatio=100-sum(D(x['RatioPct']) for x in comps),Components=comps,ProcessingUSDPerLb=r.get('ProcessingUSDPerLb','.1')))
    values=dict(Prices=selections,MaterialCosts=recipes,ProcessLosses=losses,ProcessLossMode='GradePath',ProcessLossLayout='Aligned')
    if not src['ParentItemID']:values['PackingUSDPerLb']='.25'
    calculated=grade_loss_results(Inputs(**{k:v for k,v in values.items() if k!='PackingUSDPerLb'}),opened['grades'],src['ProductNetWeightGrams'])
    values['ProcessLossFormulas']={r['Path']:'1-'+'*'.join('(1-L'+str(i+1)+')' for i in range(len(r['Ratios']))) for r in calculated}
   result=tcb.commercial_save(tcb.CommercialSave(RowVersion=opened['item']['RowVersion'],CostInputs=values,Prices=selections,Inputs={'LossProcesses':old.get('LossProcesses') or []}),identity,self.ctx)['saved']
   self.saved[src['ID']]=result
   if src['ID']!=3813982:self.check(result['ProductUSDPerLb'] is not None,'TCB Product cost complete '+str(src['ID']))

 def verify(self):
  self.step('Verify complete analysis, approved links, recipe arithmetic, weights and original preservation')
  grid=sorted_grid(self.ctx.username,1,100,'[]',opportunity_number=self.number)['rows']
  self.grid=grid
  for src in self.sources:
   row=next(r for r in grid if r['ItemID']==self.ids[src['ID']])
   if src['ID']!=3813982:
    for key in ('TCBProductPerUnit','TCBSelfPackagingPerUnit','TCBFOBPerUnit','TCBDDPPerUnit'):
     if row.get(key) is None:print('INCOMPLETE',document(row),flush=True)
     self.check(row.get(key) is not None,'Analysis complete '+str(src['ID'])+' '+key)
    self.cost_oracle(src,row)
   if src['ID'] in self.recipe_expected:
    expected=self.recipe_expected[src['ID']];saved=self.saved[src['ID']]
    self.close(saved['NPDRecipe']['SeasoningUSDPerLb'],expected['seasoning_lb'],'Approved weighted seasoning cost')
    for recipe in saved['Inputs']['MaterialCosts']:
     components=recipe['Components'];season=next(c for c in components if c['SystemKey']=='Seasoning')
     self.close(season['USDPerLb'],expected['seasoning_lb'].quantize(D('.000001')),'TCB seasoning uses finished-product contribution')
     self.close(recipe['RMRatio'],100-sum(D(c['RatioPct']) for c in components),'RM ratio balances all selected components')
     self.check(not any(c['SystemKey'] in ('Oil','Salt') for c in components) if recipe['Path']=='0/2' else True,'Oil/Salt do not leak to unrelated Almond grade')
   self.report_row(src,row)
  self.close(response_weights(self.cur,self.response_ids[self.ids[3813988]])['CartonGrossWeightKG'],'7.52','Four-layer final carton gross 7.520 kg')
  mix=next(r for r in grid if r['ItemID']==self.ids[3813982])
  for kind in ('FOB','CFR','DDP'):
   children=[next(r for r in grid if r['ItemID']==self.ids[s]) for s in (3813983,3813984,3813985)]
   for suffix,currency in (('USD','PerUnit'),('Customer','CustomerPerUnit')):
    amount=sum(D(r['TCB'+kind+currency])*n for r,n in zip(children,[6,4,10])).quantize(D('.01'),rounding=ROUND_CEILING)
    self.close(mix['TCB'+kind+'FinalBox'+suffix],amount,'Mix '+kind+' final box '+suffix+' sums all child quantities and rounds up')
  for (table,identity),before in self.originals.items():
   if identity not in self.manifest.get(table,[]):
    self.check(hashlib.sha256(document(self.rows('SELECT * FROM dbo.['+table+'] WHERE ID=?',identity)[0]).encode()).hexdigest()==before,'Existing record unchanged '+table+' '+str(identity))

 def cost_oracle(self,src,row):
  saved=self.saved[src['ID']];prices=saved['PriceSnapshots'];losses={r['Path']:D(r['LossPct']) for r in saved['ProcessLossSnapshots']}
  total=D(0);rm=D(0)
  for recipe in saved['Inputs']['MaterialCosts']:
   subset=[p for p in prices if p['Path']==recipe['Path'] or p['Path'].startswith(recipe['Path']+'/')]
   share=sum(D(p['Proportion']) for p in subset)
   raw=sum(D(p['USDPerLb'])*D(p['Proportion']) for p in subset)/share
   adjusted=sum(D(p['USDPerLb'])*D(p['Proportion'])/(1-losses[p['Path']]/100) for p in subset)/share
   processing=D(recipe['ProcessingUSDPerLb'])*adjusted/raw
   additions=sum((D(c['USDPerLb'] or 0)*(1 if c['CostBasis']=='FinishedProduct' else D(c['RatioPct'])/100) for c in recipe['Components'] if D(c['RatioPct'])),D(0))
   rm+=adjusted*D(recipe['RMRatio'])/100*share
   total+=(adjusted*D(recipe['RMRatio'])/100+processing+additions)*share
  self.close(saved['RMCostUSDPerLb'],rm,'Independent RM ratio and process yield')
  self.close(saved['ProductUSDPerLb'],total,'Independent raw + components + processing with loss')
  self.close(row['TCBProductPerUnit'],total*D(src['ProductNetWeightGrams'])/D('453.59237'),'Independent product cost per smallest unit')
  count=D(1);pm=D(0)
  steps=saved['Inputs']['LossProcesses']
  for index,calc in enumerate(self.pkg_calcs[src['ID']]):
   if index:count*=D(src[('NumberOfPrimary','NumberOfSecondary','NumberOfTertiary')[index-1]])
   loss=next(D(s['LossPct']) for s in steps if s['ProcessType']==('Primary','Secondary','Tertiary','Quaternary')[index]+'Packaging')
   unit=D(calc['UnitUSDPrice']) if calc.get('UnitUSDPrice') is not None else D(calc['UnitPrice'])/self.fx
   pm+=unit/(1-loss/100)/count
  self.close(row['TCBSelfPackagingPerUnit'],pm,'Every packaging layer yield applied once')
  if src['ParentItemID']:
   self.close(row['TCBParentPackagingPerUnit'],D(2)/D('.96')/20,'Shared parent Quaternary packaging allocated across 20 child units')
   self.close(row['TCBPackingPerUnit'],D('.27')*D(src['ProductNetWeightGrams'])/D('453.59237'),'Parent packing rate applies to each child weight')
  if src['ID']!=3813988:
   self.close(row['TCBPalletPerUnit'],D(20)*D(src['ProductNetWeightGrams'])/1000000,'Floor load and Both allocate floor fee only, excluding pallet material')
  else:
   self.close(row['TCBPalletPerUnit'],(D(300000)/self.fx)/D(row['UnitsPerPallet']),'Pallet load allocates pallet USD price only')

 def report_row(self,src,row):
  if not hasattr(self,'item_report'):self.item_report=[]
  self.item_report.append(dict(source_item=src['ID'],item=self.ids[src['ID']],product=self.one('Product',src['ProductID'])['ProductCode'],layers=src['PackagingLayerCount'],parent=bool(src['ID']==3813982),
   costs={k:v for k,v in row.items() if k.startswith('TCB') and ('PerUnit' in k or 'Final' in k)},weight={k:v for k,v in row.items() if k in ('GrossWeightPerPalletKG','UnitsPerPallet','ProductNetWeightGrams')},recipe=self.recipe_expected.get(src['ID'])))

 def run(self,retain):
  assert db.DB_NAME=='test' and db.DB_SERVER.lower() in ('desktop-5bgmjsc','localhost','.')
  committed=False
  with db.get_raw_cursor() as self.cur:
   self.cur.execute('SET NOCOUNT ON;SET QUOTED_IDENTIFIER ON;BEGIN TRANSACTION')
   try:
    with db.reuse_transaction(self.cur.connection):
     self.create_opportunity();self.masters();self.packaging();self.recipes();self.tcb();self.verify()
     self.check(self.cur.execute('SELECT @@TRANCOUNT').fetchval()==1,'One owned transaction')
     self.request_number=self.one('PackagingConfigurationRequest',self.request['header']['ID'])['RequestNumber']
     self.rrq_number=self.one('NPDRecipeRequest',self.rrq)['RequestNumber']
     if retain:self.cur.execute('COMMIT');committed=True
   finally:
    if not committed:self.cur.execute('IF @@TRANCOUNT>0 ROLLBACK')
  out=ROOT/'artifacts'/'qa-review'/self.tag;out.mkdir(parents=True,exist_ok=True)
  report=dict(tag=self.tag,retained=committed,opportunity=self.number,opportunity_id=self.opp,packaging_request=self.request_number,recipe_request=self.rrq_number,
   checks=len(self.checks),items=self.item_report,sheets=self.sheet_report,manifest=self.manifest)
  (out/'case.json').write_text(json.dumps(report,default=str,indent=2),encoding='utf-8')
  lines=['# Desktop end-to-end review case','',self.number+' — '+self.tag,'',
   'Retained: '+str(committed)+'; checks passed: '+str(len(self.checks))+'.',
   '', 'Packaging: '+self.request_number+'. Recipe: '+self.rrq_number+'.',
   '', '4 main items / 7 product rows. Existing Products, Customer and packaging masters reused. Only 2 seasoning ingredients and 1 Oil/Salt Process Type added.',
   '', 'Mix: (3×2×1)×1 + (2×1)×2 + (1)×10; net 2800 g, gross 3652 g. Standalone items: 1, 2 and 4 layers. Four-layer carton: 16 units, net 6400 g, gross 7520 g.',
   '', 'Packaging PIC: hien.1; Recipe PIC: hien.npd; Approver: hien.mai. Created by hien.sales.',
   '', 'All packaging approved after Mix / four-layer return and resubmission. All five recipe items have an approved costing baseline. New revisions intentionally retain Draft, Returned and Pending review states without replacing the approved Opportunity link.',
   '', 'Review Recipe Sheets versions; the pending standalone 2-layer revision is available for manager review. Standalone 1-layer demonstrates manager changes during approval. Standalone 4-layer flags changed nut proportions while TCB grades remain unchanged.',
   '', '| Product | Revision | Status | Approval |','| --- | --- | --- | --- |']
  for r in self.sheet_report:lines.append('| '+str(r['ProductCode'])+' | '+str(r['Revision'])+' | '+str(r['Status'])+' | '+str(r['ApprovalStatus'])+' |')
  lines+=['','Full inputs, expected recipe arithmetic, saved costs and record IDs are in case.json. Original source transactions and masters were verified unchanged.']
  (out/'review.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
  print('REVIEW_CASE',document(dict(opportunity=self.number,retained=committed,checks=len(self.checks),report=str(out/'review.md'))),flush=True)


if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--retain',action='store_true');p.add_argument('--quiet',action='store_true');args=p.parse_args()
 Case().run(args.retain)
