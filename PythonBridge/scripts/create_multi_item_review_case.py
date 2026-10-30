"""Retain one desktop Opportunity: Mix family plus 1/2/4-layer standalone items.

Uses production API handlers and approval transitions in one owned transaction.
Default rolls back; --retain commits only after independent reconciliations pass.
"""
import argparse
from create_standalone_four_layer_review import *


class StandaloneVariant(StandaloneReview):
 def __init__(self, family, count):
  super().__init__()
  self.count=count;self.tag=family.tag+' S'+str(count)
  self.cur=family.cur;self.ctx=family.ctx
  self.customer_id=family.customer_id;self.port=family.port
  self.usd=family.usd;self.vnd=family.vnd
  self.usd_vendor=family.usd_vendor;self.vnd_vendor=family.vnd_vendor
  self.category_name=family.category_name;self.codes=family.codes;self.raw=family.raw
  self.opportunity_id=family.opportunity_id;self.number=family.number
  self.manifest=family.manifest;self.originals=family.originals

 def opportunity_case(self):
  self.step('Add standalone '+str(self.count)+'-layer item to shared Opportunity')
  shipping=dict(Incoterm='DDP',PortOfEntryID=self.port,ContainerSizeFT='40FT',FobbingUSDPerContainer=650,FreightUSDPerContainer=1800,DutyPct=4,ImportClearanceCustomerPerContainer=320,PortToWHCustomerPerContainer=800,WHCostBreakdown=dict(Unloading=10,Palletize=5,Inbound=3,Outbound=4,StorageCostPerMonth=2,StorageMonths=3,OrderFeeAdminCost=2,OthersCost=1),FloorLoadUSDPerMT=20,PackingUSDPerLb='.25',InitialDesignUSD=1800,OtherFixedCostsUSD=600,InterestPct=8,InterestDays=60,MarginMode='Percent',MarginPct=12)
  self.comments='Review sample: '+str(self.count)+' layers; upright cartons; maximum pallet gross 1200 kg.'
  values=dict(RowNum=1,Command='C',OpportunityNumber=self.number,ProductID=self.product,ItemDescription=self.tag+' Standalone '+str(self.count)+' layers',AnnualUnit=32000,EstPctAwarded=60,ShelfPrice=12,WebPackagingRequirements=True,PackagingLayerCount=self.count,ContainerRequest='40HC',ConfigurationRequest='Both',PalletSpecialComments=self.comments,ShipmentCostInfo=shipping)
  if self.count>1:values['NumberOfPrimary']=4
  if self.count>2:values.update(NumberOfSecondary=2,NumberOfTertiary=2)
  for order in self.config:values[order+'TypeID']=self.config[order]['type']
  result=main.opportunity_batch(OpportunityBatchRequest(header_rows=[],item_rows=[values]),self.ctx.username,True,self.ctx.scopes)
  row=result['item_results'][0];self.check(row['Status']=='OK','Standalone Opportunity item created '+document(row))
  self.item=self.track('OpportunityItem',row['NewID']);self.request=self.workflow(self.opportunity_id,[self.item]);self.response_id=self.maps[('ResponseFor',self.item)]

 def responses(self):
  self.step('Calculate standalone prices, weights, pallet, five proposals and approve')
  self.contained=[1,4,8,16][self.count-1]
  dimensions=[(80,60,120),(180,140,140),(400,300,160),(600,400,360)]
  self.measure=dimensions[self.count-1]
  gross=D('.4')
  for i,tare in enumerate([D('.01'),D('.04'),D('.15'),D('.5')][:self.count]):gross=gross*(1 if i==0 else (4 if i==1 else 2))+tare
  self.gross=gross;carton=dict(zip(('length','width','height'),self.measure))
  values=dict(ResponseLayerCount=self.count,NutDensity='.55',ApplicableNetWeightGrams=400,ResponsePalletMaterialID=self.pallet_material,ResponsePalletSize='800x1200mm',ResponsePalletStacking='Single',ResponseMaxPalletHeightMM=1950,SelectedContainerType='40HC')
  if self.count>1:values['UnitsPerCarton']=4
  if self.count>2:values.update(UnitsPerTertiary=2,UnitsPerQuaternary=2)
  calculations=[]
  for i,(order,config) in enumerate(self.config.items()):
   quote=self.one('PackagingPrice',config['price']);body=pricing.Calculation(PackagingTypeID=config['type'],PackagingOrder=order,LayerCount=self.count,components=[dict(PriceID=quote['ID'],PriceRowVersion=b64(quote['RowVersion']),Quantity=1)])
   result=pricing.preview(self.response_id,body,self.pic_ctx)['calculation'];calculations.append(body.model_copy(update={'Fingerprint':result['Fingerprint']}))
   values[('FirstPMType','SecondPMType','ThirdPMType','FourthPMType')[i]]=result['PackagingTypeName'];values[('FirstPMMOQ','SecondPMMOQ','ThirdPMMOQ','FourthPMMOQ')[i]]=result['FinalMOQ']
  floor=floor_preview(self.response_id,FloorPreview(Carton=carton,CartonGrossKG=str(gross)),self.pic_ctx)['rows']
  values['CartonsPerContainer']=next(r['Result']['cartons'] for r in floor if r['Code']=='40HC')
  self.response(self.response_id,PricingCalculations=calculations,**values)
  self.close(response_weights(self.cur,self.response_id)['CartonGrossWeightKG'],gross,'Independent recursive carton gross')
  quote=self.one('PackagingPrice',self.pallet_price)
  snapshot=pallet.save(self.response_id,pallet.Selection(PalletSize='800x1200mm',PalletMaterialID=self.pallet_material,ItemRowVersion=b64(self.one('PackagingConfigurationRequestItem',self.response_id)['RowVersion']),components=[dict(PriceID=quote['ID'],RowVersion=b64(quote['RowVersion']),MaterialRowVersion=b64(self.one('PackagingMaterial',self.pallet_material)['RowVersion']),Quantity=1)]),self.pic_ctx)
  self.track('PalletPricingSnapshot',snapshot['ID'])
  cap=capacity_preview(self.response_id,CapacityPreview(PalletMaterialID=self.pallet_material,Carton=carton,CartonGrossKG=str(gross),TareKG=15,MaxPalletHeightMM=1950),self.pic_ctx)
  self.cartons_per_pallet=int(cap['cartons_per_layer'])*int(cap['pallet_layers'])
  self.check(self.cartons_per_pallet>0,'Positive proposed pallet capacity')
  self.close(cap['gross_kg'],self.cartons_per_pallet*gross+15,'Independent pallet gross')
  self.check(D(str(cap['gross_kg']))<=1200,'Pallet below payload limit')
  self.response(self.response_id,PalletPricingID=snapshot['ID'],CartonsPerLayer=cap['cartons_per_layer'],LayersPerPallet=cap['pallet_layers'])
  plans={};profiles={};self.container_report={}
  for r in self.rows("SELECT * FROM dbo.ContainerTypeMaster WHERE Status='Active' AND Code IN('20DC','20RC','40DC','40HC','40RHC') ORDER BY Code"):
   spec=parsed(r['Specifications'])
   plan=loading.save(self.response_id,loading.SavePlan(ContainerID=r['ID'],ContainerRowVersion=b64(r['RowVersion']),ItemRowVersion=b64(self.one('PackagingConfigurationRequestItem',self.response_id)['RowVersion']),Inputs=dict(mode='pallet',container={k:spec[k] for k in ('length','width','height')},carton=carton,carton_kg=str(gross),pallet=dict(length=800,width=1200,height=150),pallet_kg=15,max_pallet_height=1950)),self.pic_ctx)
   self.track('ContainerLoadPlan',plan['ID']);plans[r['ID']]=plan['ID'];self.container_report[r['Code']]=plan['Result']
   profiles[r['Code']]=dict(Proposal=True,PalletsPerContainer=plan['Result']['loaded_units'],CartonsPerContainer=next(f['Result']['cartons'] for f in floor if f['Code']==r['Code']))
   if r['Code']=='40HC':self.selected_plan=plan['ID']
  self.response(self.response_id,ContainerLoadPlanIDs=plans,LoadPlanID=self.selected_plan,ContainerLoadProfiles=profiles)
  self.approve(self.request);self.check(self.one('PackagingConfigurationRequestItem',self.response_id)['Stage']=='Approved','Standalone response approved')

 def oracle(self):
  self.step('Reconcile standalone TCB independently')
  # This Product uses the same nested raw blend as Mix child A (60/40,
  # with 70/30 W210/W320 under Cashew), at 400g instead of 200g.
  blend=D('.7')*D('3.6')/(D('.995')*D('.988')*D('.997'))+D('.3')*D('3.2')/(D('.9925')*D('.988')*D('.997'))
  almond=D('2.8')/(D('.992')*D('.997'));product=(blend*D('.95')+D('.016')+D('.1')*blend/D('3.48'))*D('.6')+(almond*D('.97')+D('.0045')+D('.08')*almond/D('2.8'))*D('.4')
  self.close(self.saved['ProductUSDPerLb'],product,'Independent Product cost USD/lb')
  row=next(r for r in sorted_grid(self.ctx.username,1,100,'[]',opportunity_number=self.number)['rows'] if r['ItemID']==self.item)
  pm=sum((c['usd']/(1-D(i+1)/100)/D(units) for i,((order,c),units) in enumerate(zip(self.config.items(),[1,4,8,16]))),D(0))
  pallet_units=D(self.cartons_per_pallet*self.contained);lbs=D(400)/D('453.59237')
  pallet_unit=D('.008')
  n=D(row['ContainerLoadResults']['40HC']['CalculatedCartonsPerContainer'])*self.contained
  base=product*lbs+pm+pallet_unit+D('.25')*lbs+D(1800)/19200+D(600)/19200+D(650)/n
  fob=base*(1+D('.08')*60/360)*D('1.12');freight=D(1800)/n
  ddp=fob+freight+(fob+freight)*D('.04')+D(320)/self.customer_fx/n+D(800)/self.customer_fx/n+D(31)/self.customer_fx/pallet_units
  expected=dict(TCBProductPerUnit=product*lbs,TCBSelfPackagingPerUnit=pm,TCBParentPackagingPerUnit=D(0),TCBPalletPerUnit=pallet_unit,TCBFOBPerUnit=fob,TCBDDPPerUnit=ddp,TCBDDPCustomerPerUnit=ddp*self.customer_fx)
  for key,value in expected.items():self.close(row[key],value,'Independent '+key)
  self.close(row['GrossWeightPerPalletKG'],self.cartons_per_pallet*self.gross+15,'Published pallet gross')
  self.close(row['UnitsPerPallet'],pallet_units,'Published smallest units per pallet')
  self.report=dict(item=self.item,product=self.one('Product',self.product)['ProductCode'],layers=self.count,net_g=400,carton_gross_kg=str(self.gross),cartons_per_pallet=self.cartons_per_pallet,pallet_gross_kg=str(self.cartons_per_pallet*self.gross+15),request=self.one('PackagingConfigurationRequest',self.request['header']['ID'])['RequestNumber'],costs={k:row[k] for k in expected})


def run(retain=False):
 family=ReviewCase();family.tag='QA-LAYOUT-1029-'+uuid4().hex[:4].upper()
 assert db.DB_NAME=='test' and db.DB_SERVER.lower() in ('desktop-5bgmjsc','localhost','.'),'Desktop test only'
 variants=[];committed=False
 with db.get_raw_cursor() as family.cur:
  family.cur.execute('SET NOCOUNT ON;SET QUOTED_IDENTIFIER ON;BEGIN TRANSACTION')
  actor,name=family.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE a.Scope='Admin' AND u.IsActive=1 ORDER BY u.ID").fetchone()
  family.ctx=AccessContext(actor,name,frozenset({'Admin'}))
  try:
   with db.reuse_transaction(family.cur.connection):
    family.masters();family.packaging_masters();family.opportunity_case();family.responses();family.tcb_case();family.oracle()
    for count in (1,2,4):
     case=StandaloneVariant(family,count)
     tree=family.rows("SELECT ParentID,ID,RawGradeID,RawMaterialID,Grade,RatioPct,Process FROM dbo.ProductGradeItem WHERE VersionID=(SELECT ID FROM dbo.ProductGradeVersion WHERE ProductID=? AND Status='Active') ORDER BY ParentID,ID",family.products[0])
     case.product=case.create_product('Standalone '+str(count)+' layers - roasted blend 400g',400,tree)
     case.packaging_masters();case.config=dict(list(case.config.items())[:count])
     case.opportunity_case();case.responses();case.tcb_case();case.oracle();variants.append(case)
    roots=family.rows('SELECT * FROM dbo.OpportunityItem WHERE OpportunityID=? AND ParentItemID IS NULL ORDER BY ID',family.opportunity_id)
    family.check(len(roots)==4,'Exactly four main items plus three Mix children')
    all_items=family.rows('SELECT * FROM dbo.OpportunityItem WHERE OpportunityID=?',family.opportunity_id)
    family.check(len(all_items)==7,'Seven total rows in Opportunity editor')
    header=family.one('Opportunity',family.opportunity_id)
    updated=main.opportunity_batch(OpportunityBatchRequest(header_rows=[dict(RowNum=1,Command='U',ID=family.opportunity_id,RowVersion=b64(header['RowVersion']),OpportunityNumber=family.number,CustomerID=family.customer_id,OpportunityDesc=family.tag+' Layout review: 4 items - Mix and 1/2/4 layers',BidOpen='2026-10-29',BidClose='2026-11-20',ExchangeRateVNDPerUSD=family.fx,ExchangeRateCustomerCurrencyPerUSD=family.customer_fx)],item_rows=[]),family.ctx.username,True,family.ctx.scopes)
    family.check(updated['header_results'][0]['Status']=='OK','Review case header labelled for four items')
    # Existing reference masters must remain unchanged. Newly created shared
    # records belong to this fixture and can change their rowversions normally.
    for (table,identity),before in family.originals.items():
     if identity not in family.manifest.get(table,[]):family.check(hashlib.sha256(document(family.rows('SELECT * FROM dbo.['+table+'] WHERE ID=?',identity)[0]).encode()).hexdigest()==before,'Original unchanged '+table+' '+str(identity))
    family.check(family.cur.execute('SELECT @@TRANCOUNT').fetchval()==1,'One owned transaction before commit')
    if retain:family.cur.execute('COMMIT');committed=True
  finally:
   if not committed:family.cur.execute('IF @@TRANCOUNT>0 ROLLBACK')
  if not committed:
   remaining=[(table,i) for table,ids in family.manifest.items() for i in ids if family.cur.execute('SELECT 1 FROM dbo.['+table+'] WHERE ID=?',i).fetchone()]
   family.check(not remaining,'Dry-run created records completely rolled back')
 report=dict(tag=family.tag,opportunity=family.number,retained=committed,main_items=4,total_rows=7,mix=family.report,standalone=[v.report for v in variants],checks=len(family.checks)+sum(len(v.checks) for v in variants),manifest=family.manifest)
 out=ROOT/'artifacts'/'qa-review'/family.tag;out.mkdir(parents=True,exist_ok=True)
 (out/'case.json').write_text(json.dumps(report,default=str,indent=2),encoding='utf-8')
 lines=['# Four-item desktop layout review','',family.number,'','Retained: '+str(committed),'','Four main items plus three child rows. All Packaging responses approved and TCB costs saved.','', '| Item | Product | Packaging | Request | Carton gross kg |','| --- | --- | --- | --- | --- |', '| 1 | '+family.report['parent_product']+' Mix family | Children 3/2/1 layers; parent Quaternary | '+family.report['request']+' | 3.652 |']
 for i,v in enumerate(variants,2):lines.append('| '+str(i)+' | '+v.report['product']+' | '+str(v.count)+' layers | '+v.report['request']+' | '+str(v.gross)+' |')
 lines+=['','Mix: (3x2x1)x1, (2x1)x2, (1)x10. Net 2800g, gross 3652g.','Standalone: 400g each; packing ways 1, 4x1, 4x2x2x1.','Fresh Customer, Products, raw and packaging masters; shared currency/UoM/container reference data.','Checks passed: '+str(report['checks'])+'. Independent Decimal reconciliation includes process yield, recipes, packaging loss, pallet FX, FOB and DDP.','Retained for user review; no existing Opportunity changed.','See case.json for full expected/actual calculations and IDs.']
 (out/'review.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
 print('REVIEW_CASE',document(dict(opportunity=family.number,retained=committed,checks=report['checks'],report=str(out/'review.md'))),flush=True)


if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--retain',action='store_true');parser.add_argument('--quiet',action='store_true');args=parser.parse_args();run(args.retain)
