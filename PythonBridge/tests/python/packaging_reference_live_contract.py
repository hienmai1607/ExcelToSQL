"""Rollback-only current-schema reference copy, missing-price and manager workflow."""
from four_packaging_layers_live_contract import *
import packaging_reference_api as references
import re


class ReferenceAudit(FourLayerAudit):
 def controlled_case(self):
  super().controlled_case()
  self.step('copy reference: all four sections and pallet use applicable prices')
  source_id=self.manifest['PackagingConfigurationRequestItem'][0]
  source=self.one('PackagingConfigurationRequestItem',source_id)
  old=self.one('OpportunityItem',source['OpportunityItemID'])
  header=self.one('Opportunity',old['OpportunityID'])
  self.maps[('Product',old['ProductID'])]=old['ProductID']
  opportunity,number,items=self.opportunity(header,[old],header['CustomerID'])
  request=self.workflow(opportunity,items);target_id=self.maps[('ResponseFor',items[0])]
  choices=references.references(target_id,search=self.tag,ctx=self.pic_ctx)['rows']
  self.check(any(r['ID']==source_id for r in choices),'source selectable in copy-reference popup')
  body=references.CopySections(LayerCount=4,sections={k:source_id for k in (*references.ORDERS,'Palletization')})
  material=self.one('PackagingPrice',self.manifest['PackagingPrice'][0])['MaterialID']
  assert material in self.manifest['PackagingMaterial']
  self.cur.execute('UPDATE dbo.PackagingMaterial SET MaterialD1=220 WHERE ID=?',material)
  copied=references.preview(target_id,body,self.pic_ctx)['sections']
  self.check(len(copied)==5,'all five sections copied')
  self.close(copied['Primary']['input']['D1'],220,'copied inputs use current material dimensions, not old captured dimensions')
  self.close(copied['Quaternary']['result']['UnitPrice'],5,'copy uses current price 5, not old captured price 4')
  self.close(self.cur.execute("SELECT UnitPrice FROM dbo.PkgPricingMaster WHERE RequestItemID=? AND PackagingOrder='Quaternary' AND IsCurrent=1",source_id).fetchval(),4,'reference historical price unchanged')
  self.check(copied['Palletization']['calculation'] is not None,'pallet current-priced components are copied')
  values={}
  for section in copied.values():values.update({k:v or None for k,v in section['values'].items() if k in pkg.ResponseRow.model_fields})
  values['ReferenceSetupJSON']=pricing.document(copied)
  values['PricingCalculations']=[s['input'] for k,s in copied.items() if k!='Palletization' and s['result']]
  values['PalletCalculation']=copied['Palletization']['calculation']
  result=self.response(target_id,**values)
  self.track('PalletPricingSnapshot',result['PalletPricingID'])
  self.check(result['PalletPricingID'] is not None,'copied pallet snapshot saved in response transaction')
  self.check(result['ReferenceSetupJSON'] is not None,'copied config and material draft persist')
  pallet_price=copied['Palletization']['materials'][0]['ID']
  assert pallet_price in self.manifest['PackagingPrice']
  self.cur.execute("UPDATE dbo.PackagingPrice SET Status='Block' WHERE ID=?",pallet_price)
  missing_pallet=references.preview(target_id,references.CopySections(LayerCount=4,sections={'Palletization':source_id}),self.pic_ctx)['sections']['Palletization']
  self.check(missing_pallet['calculation'] is None and missing_pallet['result'] is None,'missing pallet quote never retains a captured total')
  self.check(len(missing_pallet['materials'])==1 and missing_pallet['materials'][0]['ID'] is None,'unpriced pallet material remains in copied draft')
  self.cur.execute("UPDATE dbo.PackagingPrice SET Status='Active' WHERE ID=?",pallet_price)
  first=copied['Primary']['materials'][0]
  assert first['PriceID'] in self.manifest['PackagingPrice']
  self.cur.execute("UPDATE dbo.PackagingPrice SET Status='Block' WHERE ID=?",first['PriceID'])
  missing=references.preview(target_id,references.CopySections(LayerCount=4,sections={'Primary':source_id}),self.pic_ctx)['sections']['Primary']
  self.check(len(missing['materials'])==1 and missing['materials'][0]['UnitPrice'] is None,'unpriced material retained with blank price')
  self.check(missing['result'] is None,'no stale total copied when current price unavailable')
  self.close(missing['input']['D1'],220,'dimensions remain copied even when material has no applicable quote')
  self.response(target_id,FirstPMMOQ=None,ReferenceSetupJSON=pricing.document({'Primary':missing}))
  self.check(self.cur.execute("SELECT COUNT(*) FROM dbo.PkgPricingMaster WHERE RequestItemID=? AND PackagingOrder='Primary' AND IsCurrent=1",target_id).fetchval()==0,'missing pricing clears only current price, retaining historical snapshots')
  self.cur.execute("UPDATE dbo.PackagingPrice SET Status='Active' WHERE ID=?",first['PriceID'])
  ready=references.preview(target_id,references.CopySections(LayerCount=4,sections={'Primary':source_id}),self.pic_ctx)['sections']['Primary']
  self.response(target_id,FirstPMType=ready['values']['FirstPMType'],FirstPMMOQ=ready['values']['FirstPMMOQ'],PricingCalculations=[ready['input']])
  row=self.one('PackagingConfigurationRequestItem',target_id)
  pkg.transition(target_id,pkg.Transition(TargetStage='Pending Review',ExpectedRowVersion=b64(row['RowVersion'])),self.pic_ctx)
  self.step('manager edit: confirmation atomically saves and completes submission')
  row=self.one('PackagingConfigurationRequestItem',target_id)
  reply=pkg.response_save(pkg.ResponseBatch(rows=[dict(RowNum=1,ID=target_id,RowVersion=b64(row['RowVersion']),NutDensity='.52',ReviewNote='Verified copied packaging and pallet pricing')]),self.ctx)
  row=self.one('PackagingConfigurationRequestItem',target_id)
  self.check(row['Stage']=='Approved' and not row['IsOpen'],'manager save automatically completes request')
  self.close(row['NutDensity'],'.52','manager response edit saved')
  self.check(reply['results'][0]['NewRowVersion']==b64(row['RowVersion']),'final approved row version returned')
  self.check(self.cur.execute("SELECT ManagerComment FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",target_id).fetchval()=='Verified copied packaging and pallet pricing','optional manager note captured')
  # The real issue is checked read-only; the approved reference is never modified.
  real=self.cur.execute("SELECT TOP(1) i.ID FROM dbo.OpportunityItem i JOIN dbo.Opportunity o ON o.ID=i.OpportunityID WHERE o.OpportunityNumber='OPP-2026-10053' AND i.ParentItemID IS NULL ORDER BY i.ID").fetchval()
  self.close(tcb.item_read(real,self.ctx)['DefaultPalletUSDPerEA'],16,'10053 captured VND pallet price converted with opportunity FX')
  legacy=self.rows("""SELECT TOP(1) i.* FROM dbo.PackagingConfigurationRequestItem i
   WHERE i.OpportunityItemID=? AND i.Stage<>'Canceled' ORDER BY i.IsOpen DESC,i.ID DESC""",real)[0]
  self.one('PackagingConfigurationRequestItem',legacy['ID'])
  legacy_copy=references.copy_pallet(self.cur,legacy)
  self.check(legacy_copy['result'] is not None,'10053 legacy pallet capture resolves current applicable quote for reference copying')
  self.approve=self.manager_family
  Audit.controlled_case(self)

 def manager_family(self,request):
  self.step('manager review: whole Mix family, non-Admin permissions and partial-save rejection')
  manager_id,manager_name=self.cur.execute("""SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u
   WHERE dbo.fn_PackagingManagerAccess(u.ID)=1 AND NOT EXISTS(SELECT 1 FROM dbo.UserAccess a WHERE a.UserID=u.ID AND a.Scope='Admin')
   ORDER BY u.ID""").fetchone()
  pic_id,pic_name=self.cur.execute("SELECT TOP(1) ID,UserName FROM dbo.Users WHERE dbo.fn_PackagingPICMember(ID)=1 AND ID<>? ORDER BY ID",manager_id).fetchone()
  def context(identity,name):
   scopes=frozenset(r[0] for r in self.cur.execute('SELECT Scope FROM dbo.UserAccess WHERE UserID=?',identity).fetchall())
   return AccessContext(identity,name,scopes)
  manager=context(manager_id,manager_name);pic=context(pic_id,pic_name)
  root=next(r for r in request['items'] if not self.one('OpportunityItem',r['OpportunityItemID'])['ParentItemID'])
  global_copy=references.preview(root['ID'],references.CopySections(LayerCount=2,sections={'Quaternary':self.manifest['PackagingConfigurationRequestItem'][0]}),self.ctx)['sections']['Quaternary']
  self.check(global_copy['result'] is not None,'global Quaternary reference resolves across different local slot names')
  self.check(global_copy['input']['PackagingOrder']=='Secondary','Mix parent cumulative Quaternary maps to local Secondary')
  self.cur.execute('SAVE TRANSACTION CrossLayerCopy')
  try:
   self.response(root['ID'],SecondPMType=global_copy['values']['SecondPMType'],SecondPMMOQ=global_copy['values']['SecondPMMOQ'],PricingCalculations=[global_copy['input']])
   captured=self.cur.execute("SELECT SourcePricingMasterID FROM dbo.PkgPricingMaster WHERE RequestItemID=? AND PackagingOrder='Secondary' AND IsCurrent=1",root['ID']).fetchval()
   self.check(captured==global_copy['input']['ReferencePricingMasterID'],'cross-slot cumulative reference saves with its source provenance')
  finally:self.cur.execute('ROLLBACK TRANSACTION CrossLayerCopy')
  row=self.one('PackagingConfigurationRequestItem',root['ID'])
  pkg.assign(row['ID'],pkg.Assignment(PICUserID=pic_id,ExpectedRowVersion=b64(row['RowVersion'])),self.ctx)
  row=self.one('PackagingConfigurationRequestItem',row['ID'])
  pkg.transition(row['ID'],pkg.Transition(TargetStage='Pending Review',ExpectedRowVersion=b64(row['RowVersion'])),pic)
  before={r['ID']:self.one('PackagingConfigurationRequestItem',r['ID']) for r in request['items']}
  partial=pkg.ResponseBatch(rows=[dict(RowNum=1,ID=root['ID'],RowVersion=b64(before[root['ID']]['RowVersion']),ResponseNotes='must roll back')])
  try:pkg.response_save(partial,manager)
  except Exception as exc:self.check(getattr(exc,'status_code',None)==409,'partial submitted family save rejected')
  else:raise AssertionError('Partial family edit accepted')
  self.check(all(self.one('PackagingConfigurationRequestItem',identity)['RowVersion']==old['RowVersion'] for identity,old in before.items()),'partial manager edit leaves every family member unchanged')
  try:pkg.response_save(partial,pic)
  except Exception as exc:self.check(getattr(exc,'status_code',None) in (403,409),'PIC cannot edit/approve own submitted family')
  else:raise AssertionError('PIC approved own family')
  rows=[dict(RowNum=i+1,ID=identity,RowVersion=b64(old['RowVersion']),ResponseNotes='Manager confirmed family',ReviewNote='Checked complete Mix family' if identity==root['ID'] else None) for i,(identity,old) in enumerate(before.items())]
  reply=pkg.response_save(pkg.ResponseBatch(rows=rows),manager)
  self.check(all(self.one('PackagingConfigurationRequestItem',r['ID'])['Stage']=='Approved' for r in request['items']),'non-Admin manager confirmation completes all Mix family members')
  self.check(all(r.get('Stage')=='Approved' for r in reply['results']),'all family save results report final approved stage')


if __name__=='__main__':
 ReferenceAudit().run()
