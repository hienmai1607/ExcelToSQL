"""Desktop end-to-end review case: Mix (with mixed nuts) Opportunity -> Packaging Request and
Recipe Request -> manager approval -> Sales acceptance -> final TCB.

Builds on create_npd_packaging_review_case.Case (same source Opportunity, users and checks) and
follows today's workflow: a manager approval moves a response to Awaiting Sales, and only the Sales
requester's acceptance publishes it to the Opportunity. The Mix item also carries a Duty % tax-line
breakdown and a text Payment term (migrations 160-161).

Default is a rollback rehearsal. --retain commits only after every check passes.
Desktop `test` database only; never run on the VM.
"""
import argparse
from create_npd_packaging_review_case import *
import sales_response_review as sales

MIX_SOURCE=3813982
DUTY_LINES=[{'TaxType':'Import duty','Pct':'4.25'},{'TaxType':'Excise','Pct':'1.1250'}]


class E2EMixCase(Case):
 def __init__(self):
  super().__init__()
  self.tag=self.tag.replace('QA-E2E-1106-','QA-E2E-MIX-')
  self.accepted={'packaging':[],'recipe':[]}

 # ---- Sales acceptance after every manager approval (real API, as the original requester) ----
 def sales_reviews(self,kind):
  return sales.review_list(self.opp,self.sales)[kind]

 def accept(self,kind,identity,comment):
  row=next(r for r in self.sales_reviews(kind) if r['ID']==identity)
  self.check(row['SalesReviewStatus']=='Pending' and row['CanReview'],kind.title()+' response awaits Sales review by the requester '+str(identity))
  sales.decide(kind,identity,sales.Decision(Action='Accept',RowVersion=row['RowVersion'],GroupVersions=row.get('GroupVersions'),Comment=comment),self.sales)
  self.accepted[kind].append(identity)

 def transition(self,identity,stage,comment=None):
  result=super().transition(identity,stage,comment)
  if stage=='Approved':
   # Manager approval no longer publishes: the whole family waits for Sales.
   self.check(self.one('PackagingConfigurationRequestItem',identity)['Stage']=='Awaiting Sales','Manager approval moves packaging to Awaiting Sales '+str(identity))
   self.check(not self.one('OpportunityItem',self.one('PackagingConfigurationRequestItem',identity)['OpportunityItemID']).get('PalletPricingID'),'Awaiting Sales response is not yet published '+str(identity))
   self.accept('packaging',identity,'QA: Sales accepts packaging, weights and loading proposal.')
   self.check(self.one('PackagingConfigurationRequestItem',identity)['Stage']=='Approved','Sales acceptance completes packaging '+str(identity))
  return result

 def review(self,identity,action,comment=None,changes=None):
  result=super().review(identity,action,comment,changes)
  if action=='Approve':
   row=self.sheet_row(identity)
   self.check(row['ApprovalStatus']=='Approved' and row['SalesReviewStatus']=='Pending','Manager-approved recipe awaits Sales '+str(identity))
   self.accept('recipe',identity,'QA: Sales accepts seasoning price and ratio for TCB.')
   self.check(self.sheet_row(identity)['SalesReviewStatus']=='Accepted','Sales acceptance publishes recipe '+str(identity))
  return result

 def tcb(self):
  # Same as the base step, except Seasoning is placed on the accepted recipe's grade paths.
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
     # Seasoning applies only to the grades of the Sales-accepted recipe (never All grades).
     paths=parsed(self.one('OpportunityItem',identity)['TCBCostInfo'] or '{}').get('NPDRecipe',{}).get('ApplicableGradePaths') or []
     self.check(bool(paths),'Accepted recipe publishes its applicable grades '+str(src['ID']))
     for path in paths:
      stage=next((r for r in losses if r['Path']==path),None)
      if stage is None:stage=dict(Path=path,Codes=[],Ratios=[]);losses.append(stage)
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

 # ---- Duty breakdown and text Payment term on the Mix parent ----
 def create_opportunity(self):
  super().create_opportunity()
  self.step('Mix parent shipment: Duty % from tax lines and a text Payment term')
  identity=self.ids[MIX_SOURCE];current=self.one('OpportunityItem',identity)
  shipment=parsed(current['ShipmentCostInfo'] or '{}')
  shipment.update(DutyBreakdown=DUTY_LINES,DutyPct='5.375',PaymentTerm='Net 45 days after B/L',PaymentTermDays=None)
  values=dict(RowNum=1,Command='U',ID=identity,RowVersion=b64(current['RowVersion']),OpportunityNumber=self.number,ShipmentCostInfo=shipment)
  result=main.opportunity_batch(OpportunityBatchRequest(header_rows=[],item_rows=[values]),self.sales.username,False,self.sales.scopes)
  self.check(result['item_results'][0]['Status']=='OK','Mix Duty breakdown and Payment term saved '+document(result))
  saved=parsed(self.one('OpportunityItem',identity)['ShipmentCostInfo'])
  self.close(saved['DutyPct'],D('5.375'),'Duty % equals the sum of its four-decimal tax lines')
  self.check(saved['PaymentTerm']=='Net 45 days after B/L' and saved.get('PaymentTermDays') is None,'Payment term stored as text; legacy days cleared')

 def verify(self):
  super().verify()
  self.step('Sales acceptance and final TCB')
  packaging=self.sales_reviews('packaging');recipe=self.sales_reviews('recipe')
  self.check(all(r['SalesReviewStatus']=='Accepted' for r in packaging),'Every packaging response accepted by Sales')
  families=self.rows('SELECT DISTINCT COALESCE(oi.ParentItemID,oi.ID) AS Root FROM dbo.PackagingConfigurationRequestItem r JOIN dbo.OpportunityItem oi ON oi.ID=r.OpportunityItemID WHERE oi.OpportunityID=?',self.opp)
  self.check(len(self.accepted['packaging'])==len(families),'Every packaging family was explicitly accepted by Sales ('+str(len(self.accepted['packaging']))+' of '+str(len(families))+')')
  self.check(len(self.accepted['recipe'])==len(self.recipe_expected),'Each approved recipe was explicitly accepted by Sales')
  for source,expected in self.recipe_expected.items():
   linked=parsed(self.one('OpportunityItem',self.ids[source])['TCBCostInfo'] or '{}').get('NPDRecipe') or {}
   self.check(linked.get('SheetID') in self.accepted['recipe'],'Opportunity TCB uses the Sales-accepted recipe '+str(source))
  mix=self.one('OpportunityItem',self.ids[MIX_SOURCE])
  self.check(parsed(mix['ShipmentCostInfo'])['DutyBreakdown']==DUTY_LINES,'Duty tax lines retained through the workflow')

 def run(self,retain):
  super().run(retain)
  out=ROOT/'artifacts'/'qa-review'/self.tag/'review.md'
  mix=self.ids[MIX_SOURCE]
  extra=['','## E2E Mix additions (current workflow)','',
   '- Every manager approval moved the response to **Awaiting Sales**; hien.sales (the requester) then accepted it. Only acceptance published to the Opportunity.',
   '- Packaging families accepted: '+str(len(self.accepted['packaging']))+'; recipe sheets accepted: '+str(len(self.accepted['recipe']))+'.',
   '- Mix parent item '+str(mix)+': Duty % 5.375 from tax lines Import duty 4.25 + Excise 1.1250; Payment term "Net 45 days after B/L".',
   '- TCB Seasoning is applied only to the grades of each accepted recipe (ApplicableGradePaths).',
   '','Review in the workbench: open '+self.number+' -> Packaging Request / Recipe Request tabs (Accepted badges), the Mix item Shipment (Duty calculator, Payment term) and TCB Review.']
  out.write_text(out.read_text(encoding='utf-8')+chr(10).join(extra)+chr(10),encoding='utf-8')

def main_cli():
 p=argparse.ArgumentParser(description=__doc__.splitlines()[0]);p.add_argument('--retain',action='store_true');p.add_argument('--quiet',action='store_true',help='print only failures and the summary');args=p.parse_args()
 E2EMixCase().run(args.retain)


if __name__=='__main__':
 main_cli()
