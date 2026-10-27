"""Rollback-only server checks against current desktop schema and captured geometry."""
from opportunity_replica_audit import *
from fastapi import HTTPException
from floor_capacity_api import FloorPreview,preview,validate_saved_floor


class MixFloorAudit(Audit):
 def exact_case(self):pass

 def draft_preview(self,request,opportunity,item_id):
  from request_views import item_read
  from container_loading import published_options,container_results
  from packing_way import packing_way
  draft=next(r for r in item_read(self.ctx.username,request['header']['ID'],1,100,None,None,'[]')['rows'] if r['ItemID']==item_id)
  candidate=published_options(draft)
  candidate.update(packing_way(candidate));candidate['ContainerLoadResults']=container_results(candidate)
  output=next(r for r in sorted_grid(self.ctx.username,1,100,'[]',opportunity_number=self.one('Opportunity',opportunity)['OpportunityNumber'])['rows'] if r['PackagingRequestItemID'] is None)
  self.check(output['FirstPMType'] is None and output['ContainerLoadResults'] is None,'draft proposal remains in request editor and is not published to Opportunity')
  return candidate

 def approve(self,request):
  self.step('Mix exact-divisor rejection is atomic in response batch')
  children=self.rows('''SELECT i.* FROM dbo.PackagingConfigurationRequestItem i
    JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
    WHERE i.RequestID=? AND oi.ParentItemID IS NOT NULL ORDER BY i.ID''',request['header']['ID'])
  child=children[0]
  try:
   pkg.response_save(pkg.ResponseBatch(rows=[dict(RowNum=1,ID=child['ID'],RowVersion=b64(child['RowVersion']),UnitsPerCarton=7)]),self.pic_ctx)
   raise AssertionError('Non-divisor child packaging accepted')
  except HTTPException as exc:self.check('exact divisor' in str(exc.detail),'API rejects fractional final child packages')
  after=self.one('PackagingConfigurationRequestItem',child['ID'])
  self.check(after['UnitsPerCarton']==child['UnitsPerCarton'] and after['RowVersion']==child['RowVersion'],'failed child save rolls back quantities and rowversion')
  self.step('Floor proposals and manual limits use maintained container and captured response geometry')
  parent=self.rows('''SELECT i.* FROM dbo.PackagingConfigurationRequestItem i
    JOIN dbo.OpportunityItem oi ON oi.ID=i.OpportunityItemID
    WHERE i.RequestID=? AND oi.ParentItemID IS NULL''',request['header']['ID'])[0]
  source=self.one('OpportunityItem',child['OpportunityItemID'])
  header=self.one('Opportunity',source['OpportunityID'])
  self.maps[('Product',source['ProductID'])]=source['ProductID']
  source={**source,'ParentItemID':None,'MixChildNumber':None,'MixUnitQuantity':None,'ConfigurationRequest':'Floor load','ContainerRequest':'20DC'}
  opportunity,_,items=self.opportunity(header,[source],header['CustomerID'])
  floor_request=self.workflow(opportunity,items)
  floor_id=floor_request['items'][0]['ID']
  masters=self.rows('SELECT InputJSON FROM dbo.PkgPricingMaster WHERE RequestItemID=? AND IsCurrent=1 ORDER BY ID',child['ID'])
  calculations=[]
  for master in masters:
   inputs=parsed(master['InputJSON']);inputs.pop('Fingerprint',None)
   inputs['Fingerprint']=pricing.preview(floor_id,pricing.Calculation.model_validate(inputs),self.pic_ctx)['calculation']['Fingerprint']
   calculations.append(inputs)
  self.response(floor_id,ResponseLayerCount=2,FirstPMType=child['FirstPMType'],SecondPMType=child['SecondPMType'],UnitsPerCarton=1,SelectedContainerType='20DC',CartonsPerContainer=1,PricingCalculations=calculations)
  dims=loading.response_dimensions(self.cur,floor_id)
  from packaging_weight import response_weights
  gross=response_weights(self.cur,floor_id)['CartonGrossWeightKG']
  reply=preview(floor_id,FloorPreview(Carton=dims,CartonGrossKG=gross),self.pic_ctx)
  self.check(set(r['Code'] for r in reply['rows'])=={'20DC','40DC','40HC','20RC','40RHC'},'all five alternatives are available even for a 20DC request')
  maximum=reply['rows'][0]['Result']['cartons']
  self.check(maximum>0 and reply['rows'][0]['Result']['container_layer'],'live proposal includes feasible 3D placements')
  self.response(floor_id,SelectedContainerType='20DC',CartonsPerContainer=max(1,maximum-1))
  floor_before=self.one('PackagingConfigurationRequestItem',floor_id)
  try:
   self.response(floor_id,CartonsPerContainer=maximum+1)
   raise AssertionError('Over-capacity floor count accepted')
  except HTTPException as exc:self.check('exceeds' in str(exc.detail),'response API blocks above-proposal manual floor counts')
  floor_after=self.one('PackagingConfigurationRequestItem',floor_id)
  self.check(floor_before['CartonsPerContainer']==floor_after['CartonsPerContainer'] and floor_before['RowVersion']==floor_after['RowVersion'],'invalid floor save rolls back count and rowversion')
  validate_saved_floor(self.cur,[floor_id],complete=True)
  self.check(True,'lower manual floor count allowed')
  self.step('Proposal flags persist as booleans and only checked capacities reach Opportunity')
  self.response(floor_id,ContainerLoadProfiles={'20DC':{'Proposal':True}})
  stored=parsed(self.one('PackagingConfigurationRequestItem',floor_id)['ContainerLoadProfiles'])
  self.check(stored['20DC']['Proposal'] is True,'SQL preserves Proposal as a JSON boolean')
  grid=self.draft_preview(floor_request,opportunity,floor_id)
  self.check(grid['ProposedContainerTypes']==['20DC'] and '20DC' in grid['ContainerLoadResults'],'checked floor option is eligible for publication after approval')
  self.response(floor_id,ContainerLoadProfiles={'20DC':{'Proposal':True},'40DC':{'Proposal':True,'CartonsPerContainer':3}})
  grid=self.draft_preview(floor_request,opportunity,floor_id)
  self.check(set(grid['ProposedContainerTypes'])=={'20DC','40DC'},'requested and additional alternatives are proposed together before approval')
  self.response(floor_id,SelectedContainerType='40DC',CartonsPerContainer=3,ContainerLoadProfiles={'40DC':{'Proposal':False}})
  grid=self.draft_preview(floor_request,opportunity,floor_id)
  self.check(grid['ProposedContainerTypes']==['20DC'] and set(grid['ContainerLoadResults'])=={'20DC'} and grid['CalculatedCartonsPerContainer'] is None,'unchecked extra floor option and selected capacity are excluded from publication candidate')
  self.response(floor_id,NutDensity='.51')
  stored=parsed(self.one('PackagingConfigurationRequestItem',floor_id)['ContainerLoadProfiles'])
  self.check(stored['40DC']['Proposal'] is False,'unrelated partial save preserves unchecked Proposal')
  before=self.one('PackagingConfigurationRequestItem',floor_id)
  try:
   self.response(floor_id,ContainerLoadProfiles={'20DC':{'Proposal':False}})
   raise AssertionError('Requested type was removed')
  except HTTPException as exc:self.check('requested container' in str(exc.detail),'API rejects removing the requested type')
  self.check(self.one('PackagingConfigurationRequestItem',floor_id)['RowVersion']==before['RowVersion'],'mandatory-proposal rejection is atomic')
  self.response(parent['ID'],ContainerLoadProfiles={'20DC':{'Proposal':True},'40HC':{'Proposal':False}})
  parent_opportunity=self.one('Opportunity',self.one('OpportunityItem',parent['OpportunityItemID'])['OpportunityID'])['OpportunityNumber']
  grid=sorted_grid(self.ctx.username,1,100,'[]',opportunity_number=parent_opportunity)['rows']
  output=next(r for r in grid if r['ItemID']==parent['OpportunityItemID'])
  self.check(output['ContainerLoadResults'] is None and output['PackagingRequestItemID'] is None,'pending Mix pallet proposals do not leak to Opportunity')
  # QA-only simulation of an old invalid saved selection: submission must also guard it.
  assert parent['ID'] in self.manifest['PackagingConfigurationRequestItem']
  previous=self.one('PackagingConfigurationRequestItem',parent['ID'])['ContainerLoadProfiles']
  try:
   self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET ContainerLoadProfiles=JSON_MODIFY(ContainerLoadProfiles,'$.\"20DC\".Proposal',CONVERT(BIT,0)) WHERE ID=?",parent['ID'])
   invalid=self.one('PackagingConfigurationRequestItem',parent['ID'])
   try:
    pkg.transition(parent['ID'],pkg.Transition(TargetStage='Pending Review',ExpectedRowVersion=b64(invalid['RowVersion'])),self.pic_ctx)
    raise AssertionError('Invalid requested proposal submitted')
   except HTTPException as exc:self.check('requested container' in str(exc.detail),'submission rejects a stale missing requested proposal')
   self.check(self.one('PackagingConfigurationRequestItem',parent['ID'])['Stage']=='Working','failed submission leaves family stage unchanged')
  finally:self.cur.execute('UPDATE dbo.PackagingConfigurationRequestItem SET ContainerLoadProfiles=? WHERE ID=?',previous,parent['ID'])
  Audit.approve(self,floor_request)
  grid=sorted_grid(self.ctx.username,1,100,'[]',opportunity_number=self.one('Opportunity',opportunity)['OpportunityNumber'])['rows'][0]
  self.check(grid['ProposedContainerTypes']==['20DC'] and set(grid['ContainerLoadResults'])=={'20DC'},'approval publishes only checked floor proposals')
  result=super().approve(request)
  output=next(r for r in sorted_grid(self.ctx.username,1,100,'[]',opportunity_number=parent_opportunity)['rows'] if r['ItemID']==parent['OpportunityItemID'])
  self.check(set(output['ContainerLoadResults'])=={'20DC'},'approval publishes only checked Mix pallet proposals')
  return result


if __name__=='__main__':MixFloorAudit().run()
