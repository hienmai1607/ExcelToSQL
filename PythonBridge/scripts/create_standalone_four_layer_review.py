"""Desktop review fixture: fresh standalone Product, four layers, approval and TCB.

Default is rollback-only. --retain commits only after the independent checks pass.
"""
import argparse,json,sys,hashlib
from pathlib import Path
from decimal import Decimal as D
from uuid import uuid4
sys.path.insert(0,str(Path(__file__).resolve().parent))
from create_complex_mix_review_case import *


class StandaloneReview(ReviewCase):
 def __init__(self):
  super().__init__();self.tag='QA-4L-1029-'+uuid4().hex[:4].upper();self.config={}
 def masters(self):
  self.step('Create fresh Customer, nested raw grades, quotes and one standalone Product')
  self.usd=self.cur.execute("SELECT ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval()
  self.vnd=self.cur.execute("SELECT ID FROM dbo.Currency WHERE CurrencyCode='VND'").fetchval()
  aud=self.cur.execute("SELECT ID FROM dbo.Currency WHERE CurrencyCode='AUD'").fetchval()
  market=self.cur.execute("SELECT ID FROM dbo.Market WHERE MarketName='Australia'").fetchval()
  self.customer_id=self.ok(main.customer_batch(CustomerBatchRequest(rows=[dict(RowNum=1,Command='C',CustomerName=self.tag+' Review Customer',MarketID=market,CurrencyID=aud)]),self.ctx.username,True,self.ctx.scopes),'Customer')
  self.category_name=self.tag+' Four layer standalone'
  self.ok(category_api.save(category_api.CategorySave(CategoryName=self.category_name),self.ctx),'ProductCategory')
  self.usd_vendor=self.master('vendor',pkg.VendorBatch,pkg.vendor_save,dict(VendorName=self.tag+' USD Supplier',CurrencyID=self.usd,Status='Active'),'Vendor')
  self.vnd_vendor=self.master('vendor',pkg.VendorBatch,pkg.vendor_save,dict(VendorName=self.tag+' VND Supplier',CurrencyID=self.vnd,Status='Active'),'Vendor')
  self.port=self.ok(ports_api.save(ports_api.PortSave(CustomerID=self.customer_id,MarketID=market,PortName=self.tag+' Sydney'),self.ctx),'PortOfEntry')
  blend=self.grade('Cashew blend',False);a=self.grade('W210',True,blend);b=self.grade('W320',True,blend);c=self.grade('Almond')
  self.raw={name:self.raw_material(name,g,price) for name,g,price in [('W210',a,'3.60'),('W320',b,'3.20'),('Almond',c,'2.80')]}
  tree=[dict(ParentID='0',ID=1,RawGradeID=blend,Grade=self.tag+' Cashew blend',RatioPct=70,Process=True),dict(ParentID='0/1',ID=1,RawGradeID=a,RawMaterialID=self.raw['W210'][0],Grade=self.tag+' W210',RatioPct=60,Process=True),dict(ParentID='0/1',ID=2,RawGradeID=b,RawMaterialID=self.raw['W320'][0],Grade=self.tag+' W320',RatioPct=40,Process=True),dict(ParentID='0',ID=2,RawGradeID=c,RawMaterialID=self.raw['Almond'][0],Grade=self.tag+' Almond',RatioPct=30,Process=True)]
  self.product=self.create_product('Roasted nut blend 400g - standalone FOUR LAYERS',400,tree)
  self.codes={}
  for name,shared in [('Sorting',False),('Roasting',True),('Packing',True)]:
   identity=self.ok(loss_process_api.save(loss_process_api.LossMasterSave(ProcessType=self.tag+' '+name,Shared=shared),self.ctx),'LossProcessMaster');r=self.one('LossProcessMaster',identity)
   self.codes[name]=dict(MasterID=identity,MasterVersion='0x'+bytes(r['RowVersion']).hex(),ProcessName=r['ProcessType'],Shared=shared)
 def packaging_masters(self):
  self.step('Create Primary/Secondary/Tertiary/Quaternary materials and priced pallet')
  mm=self.cur.execute("SELECT ID FROM dbo.UoM WHERE UoMCode='mm' AND Status='Active'").fetchval()
  for order,measure,price,currency,tare in [('Primary',(80,60,120),'.08','USD',10),('Secondary',(180,140,140),'4000','VND',40),('Tertiary',(400,300,160),'.60','USD',150),('Quaternary',(600,400,360),'1.80','USD',500)]:
   if ('Primary','Secondary','Tertiary','Quaternary').index(order)>=getattr(self,'count',4):continue
   kind=self.master('type',types.PackagingTypeBatch,types.packaging_type_save,dict(PackagingType=self.tag+' '+order,PackagingOrders=[order],FinalComponent=True,CopyDim=True,Shipping=order==('Primary','Secondary','Tertiary','Quaternary')[getattr(self,'count',4)-1],PriceBasis='Count',Status='Active'),'PackagingType')
   fields=dict(PackagingTypeID=kind,D1='Length',D2='Width',D3='Height',D1UoMID=mm,D2UoMID=mm,D3UoMID=mm,Status='Active')
   if order==('Primary','Secondary','Tertiary','Quaternary')[getattr(self,'count',4)-1]:fields.update(OccupiedM2Formula='D1*D2/1000000',OccupiedM3Formula='D1*D2*D3/1000000000')
   dimension=self.ok(dims.save(dims.DimensionSave(**fields),self.ctx),'PackagingDimension')
   material=self.master('material',pkg.MaterialBatch,pkg.material_save,dict(MaterialName=self.tag+' '+order,UnitOfMeasure='EA',PackagingTypeID=kind,MaterialDimensionID=dimension,MaterialDimensionRowVersion=b64(self.one('PackagingDimension',dimension)['RowVersion']),MaterialD1=measure[0],MaterialD2=measure[1],MaterialD3=measure[2],TareWeight=tare,TareWeightBasis='g',Status='Active'),'PackagingMaterial')
   quote=self.master('price',pkg.PackagingPriceBatch,pkg.price_save,dict(MaterialID=material,VendorID=self.usd_vendor if currency=='USD' else self.vnd_vendor,CurrencyID=self.usd if currency=='USD' else self.vnd,PriceBasis='EA',QuantityFrom=1000,UnitPrice=price,ExchangeRateToUSD=1 if currency=='USD' else None,EffectiveFrom='2026-10-01',Status='Active'),'PackagingPrice')
   self.config[order]=dict(type=kind,price=quote,usd=D(price) if currency=='USD' else D(price)/self.fx)
  kind,dimension=self.cur.execute("SELECT TOP(1) t.ID,d.ID FROM dbo.PackagingType t JOIN dbo.PackagingDimension d ON d.PackagingTypeID=t.ID JOIN dbo.UoM u ON u.ID=d.D1UoMID WHERE t.PackagingType='Pallet' AND t.Status='Active' AND d.Status='Active' AND d.D1Name='Length' AND d.D2Name='Width' AND d.D3Name='Height' AND u.UoMCode='mm' ORDER BY d.ID").fetchone()
  self.pallet_material=self.master('material',pkg.MaterialBatch,pkg.material_save,dict(MaterialName=self.tag+' Pallet 800x1200',UnitOfMeasure='EA',PackagingTypeID=kind,MaterialDimensionID=dimension,MaterialDimensionRowVersion=b64(self.one('PackagingDimension',dimension)['RowVersion']),MaterialD1=800,MaterialD2=1200,MaterialD3=150,TareWeight=15,TareWeightBasis='kg',MaxPayloadKG=1200,Status='Active'),'PackagingMaterial')
  self.pallet_price=self.master('price',pkg.PackagingPriceBatch,pkg.price_save,dict(MaterialID=self.pallet_material,VendorID=self.vnd_vendor,CurrencyID=self.vnd,PriceBasis='EA',QuantityFrom=100,UnitPrice=300000,EffectiveFrom='2026-10-01',Status='Active'),'PackagingPrice')
 def opportunity_case(self):
  self.step('Create four-layer Opportunity, pallet comments and Packaging Request')
  result=main.opportunity_batch(OpportunityBatchRequest(header_rows=[dict(RowNum=1,Command='C',OpportunityNumber='',CustomerID=self.customer_id,OpportunityDesc=self.tag+' Standalone four-layer review',BidOpen='2026-10-29',BidClose='2026-11-20',ExchangeRateVNDPerUSD=self.fx,ExchangeRateCustomerCurrencyPerUSD=self.customer_fx)],item_rows=[]),self.ctx.username,True,self.ctx.scopes)
  self.opportunity_id=self.track('Opportunity',result['header_results'][0]['NewID']);self.number=self.one('Opportunity',self.opportunity_id)['OpportunityNumber']
  shipping=dict(Incoterm='DDP',PortOfEntryID=self.port,ContainerSizeFT='40FT',FobbingUSDPerContainer=650,FreightUSDPerContainer=1800,DutyPct=4,ImportClearanceCustomerPerContainer=320,PortToWHCustomerPerContainer=800,WHCostBreakdown=dict(Unloading=10,Palletize=5,Inbound=3,Outbound=4,StorageCostPerMonth=2,StorageMonths=3,OrderFeeAdminCost=2,OthersCost=1),FloorLoadUSDPerMT=20,PackingUSDPerLb='.25',InitialDesignUSD=1800,OtherFixedCostsUSD=600,InterestPct=8,InterestDays=60,MarginMode='Percent',MarginPct=12)
  self.comments='Keep cartons upright. Use corner protection and stretch wrap; maximum pallet gross 1200 kg. Four-layer configuration 4 x 2 x 2 x 1.'
  fields=dict(RowNum=1,Command='C',OpportunityNumber=self.number,ProductID=self.product,ItemDescription=self.tag+' Four layers / 16 smallest units per carton',AnnualUnit=32000,EstPctAwarded=60,ShelfPrice=12,WebPackagingRequirements=True,PackagingLayerCount=4,NumberOfPrimary=4,NumberOfSecondary=2,NumberOfTertiary=2,ContainerRequest='40HC',ConfigurationRequest='Both',PalletSpecialComments=self.comments,ShipmentCostInfo=shipping)
  for order in self.config:fields[order+'TypeID']=self.config[order]['type']
  result=main.opportunity_batch(OpportunityBatchRequest(header_rows=[],item_rows=[fields]),self.ctx.username,True,self.ctx.scopes)
  self.item=self.track('OpportunityItem',result['item_results'][0]['NewID']);self.request=self.workflow(self.opportunity_id,[self.item]);self.response_id=self.maps[('ResponseFor',self.item)]
  self.check(self.one('PackagingConfigurationRequestItem',self.response_id)['PalletSpecialComments']==self.comments,'Pallet comments captured in request')
  self.check(self.one('Product',self.product)['IsMix']==False,'Product is standalone')
 def responses(self):
  self.step('Calculate all four prices, save gross weights, pallet and five proposals, approve')
  values=dict(ResponseLayerCount=4,NutDensity='.55',ApplicableNetWeightGrams=400,UnitsPerCarton=4,UnitsPerTertiary=2,UnitsPerQuaternary=2,ResponsePalletMaterialID=self.pallet_material,ResponsePalletSize='800x1200mm',ResponsePalletStacking='Single',ResponseMaxPalletHeightMM=1950,SelectedContainerType='40HC')
  calculations=[]
  for index,order in enumerate(self.config):
   config=self.config[order];quote=self.one('PackagingPrice',config['price'])
   body=pricing.Calculation(PackagingTypeID=config['type'],PackagingOrder=order,LayerCount=4,components=[dict(PriceID=quote['ID'],PriceRowVersion=b64(quote['RowVersion']),Quantity=1)])
   result=pricing.preview(self.response_id,body,self.pic_ctx)['calculation'];calculations.append(body.model_copy(update={'Fingerprint':result['Fingerprint']}))
   values[('FirstPMType','SecondPMType','ThirdPMType','FourthPMType')[index]]=result['PackagingTypeName'];values[('FirstPMMOQ','SecondPMMOQ','ThirdPMMOQ','FourthPMMOQ')[index]]=result['FinalMOQ']
  floor=floor_preview(self.response_id,FloorPreview(Carton=dict(length=600,width=400,height=360),CartonGrossKG='7.52'),self.pic_ctx)['rows']
  values['CartonsPerContainer']=next(r['Result']['cartons'] for r in floor if r['Code']=='40HC')
  self.response(self.response_id,PricingCalculations=calculations,**values)
  weight=response_weights(self.cur,self.response_id);self.close(weight['CartonGrossWeightKG'],'7.52','Gross = (((.4+.01)*4+.04)*2+.15)*2+.5')
  self.close(weight['QuaternaryNetWeightGrams'],6400,'Final carton net = 400 x 4 x 2 x 2')
  quote=self.one('PackagingPrice',self.pallet_price)
  snapshot=pallet.save(self.response_id,pallet.Selection(PalletSize='800x1200mm',PalletMaterialID=self.pallet_material,ItemRowVersion=b64(self.one('PackagingConfigurationRequestItem',self.response_id)['RowVersion']),components=[dict(PriceID=quote['ID'],RowVersion=b64(quote['RowVersion']),MaterialRowVersion=b64(self.one('PackagingMaterial',self.pallet_material)['RowVersion']),Quantity=1)]),self.pic_ctx)
  self.track('PalletPricingSnapshot',snapshot['ID']);self.response(self.response_id,PalletPricingID=snapshot['ID'],CartonsPerLayer=4,LayersPerPallet=5)
  cap=capacity_preview(self.response_id,CapacityPreview(PalletMaterialID=self.pallet_material,Carton=dict(length=600,width=400,height=360),CartonGrossKG='7.52',TareKG=15,MaxPalletHeightMM=1950),self.pic_ctx)
  self.check((cap['cartons_per_layer'],cap['pallet_layers'])==(4,5),'Pallet footprint 4, height 5 layers');self.close(cap['gross_kg'],'165.4','Pallet gross 20 x 7.52 + 15')
  plans={};profiles={};self.container_report={}
  for r in self.rows("SELECT * FROM dbo.ContainerTypeMaster WHERE Status='Active' AND Code IN('20DC','20RC','40DC','40HC','40RHC') ORDER BY Code"):
   spec=parsed(r['Specifications']);version=self.one('PackagingConfigurationRequestItem',self.response_id)['RowVersion']
   plan=loading.save(self.response_id,loading.SavePlan(ContainerID=r['ID'],ContainerRowVersion=b64(r['RowVersion']),ItemRowVersion=b64(version),Inputs=dict(mode='pallet',container={k:spec[k] for k in ('length','width','height')},carton=dict(length=600,width=400,height=360),carton_kg='7.52',pallet=dict(length=800,width=1200,height=150),pallet_kg=15,max_pallet_height=1950)),self.pic_ctx)
   self.track('ContainerLoadPlan',plan['ID']);plans[r['ID']]=plan['ID'];self.container_report[r['Code']]=plan['Result']
   profiles[r['Code']]=dict(Proposal=True,PalletsPerContainer=plan['Result']['loaded_units'],CartonsPerContainer=next(f['Result']['cartons'] for f in floor if f['Code']==r['Code']))
   if r['Code']=='40HC':self.selected_plan=plan['ID']
  self.response(self.response_id,ContainerLoadPlanIDs=plans,LoadPlanID=self.selected_plan,ContainerLoadProfiles=profiles)
  self.approve(self.request);self.check(self.one('PackagingConfigurationRequestItem',self.response_id)['Stage']=='Approved','Response approved')
 def tcb_case(self):
  self.step('Save nested process loss, recipes and 1/2/3/4 percent packaging losses')
  losses=[dict(Path=path,Codes=[self.codes[code]],Ratios=[value]) for path,code,value in [('0/1/1','Sorting','.5'),('0/1/2','Sorting','.75'),('0/1','Roasting','1.2'),('0/2','Sorting','.8'),('0','Packing','.3')]]
  recipes=[dict(Path='0/1',RMRatio=95,SeasoningRatio=3,SeasoningUSDPerLb='.2',OilPct=2,OilUSDPerLb='.5',ProcessingUSDPerLb='.1'),dict(Path='0/2',RMRatio=97,SeasoningRatio=3,SeasoningUSDPerLb='.15',OilPct=0,ProcessingUSDPerLb='.08')]
  selections=[self.price_selection(path,name) for path,name in [('0/1/1','W210'),('0/1/2','W320'),('0/2','Almond')]]
  opened=tcb.read(self.item,self.ctx);values=dict(Prices=selections,MaterialCosts=recipes,ProcessLosses=losses,ProcessLossMode='GradePath',ProcessLossLayout='Aligned')
  results=grade_loss_results(Inputs(**values),opened['grades'],400)
  values['ProcessLossFormulas']={r['Path']:'1-'+'*'.join('(1-L'+str(i+1)+')' for i in range(len(r['Ratios']))) for r in results}
  steps=[dict(ProcessType=order+'Packaging',Sequence=1,LossPct=str(i+1)) for i,order in enumerate(self.config)]
  self.saved=tcb.commercial_save(tcb.CommercialSave(RowVersion=opened['item']['RowVersion'],CostInputs=values,Prices=selections,Inputs=dict(LossProcesses=steps)),self.item,self.ctx)['saved']
 def oracle(self):
  self.step('Independently reconcile raw yield, recipe, four PM losses, pallet and FOB')
  blend=D('.6')*D('3.6')/(D('.995')*D('.988')*D('.997'))+D('.4')*D('3.2')/(D('.9925')*D('.988')*D('.997'))
  almond=D('2.8')/(D('.992')*D('.997'));product=(blend*D('.95')+D('.016')+D('.1')*blend/D('3.44'))*D('.7')+(almond*D('.97')+D('.0045')+D('.08')*almond/D('2.8'))*D('.3')
  self.close(self.saved['ProductUSDPerLb'],product,'Independent product USD/lb')
  row=next(r for r in sorted_grid(self.ctx.username,1,100,'[]',opportunity_number=self.number)['rows'] if r['ItemID']==self.item)
  pm=sum((self.config[order]['usd']/(1-D(i+1)/100)/D(units) for i,(order,units) in enumerate(zip(self.config,[1,4,8,16]))),D(0))
  self.close(row['TCBSelfPackagingPerUnit'],pm,'All four packaging yields applied once');self.close(row['TCBParentPackagingPerUnit'],0,'No Mix parent cost')
  self.close(row['TCBProductPerUnit'],product*400/D('453.59237'),'Product cost per smallest 400g unit')
  self.close(row['GrossWeightPerPalletKG'],'165.4','Published pallet gross');self.close(row['UnitsPerPallet'],320,'320 smallest units per pallet')
  self.close(row['TCBPalletPerUnit'],D(20)*400/1000000,'Both uses floor fee only')
  n=D(row['ContainerLoadResults']['40HC']['CalculatedCartonsPerContainer'])*16;lbs=D(400)/D('453.59237')
  base=product*lbs+pm+(D(300000)/self.fx)/320+D('.008')+D('.25')*lbs+D(1800)/19200+D(600)/19200+D(650)/n
  fob=base*(1+D('.08')*60/360)*D('1.12');self.close(row['TCBFOBPerUnit'],fob,'Independent FOB with design, fixed costs, fobbing, interest, margin')
  freight=D(1800)/n;duty=(fob+freight)*D('.04')
  ddp=fob+freight+duty+D(320)/self.customer_fx/n+D(800)/self.customer_fx/n+D(31)/self.customer_fx/320
  self.close(row['TCBDDPPerUnit'],ddp,'Independent DDP with duty, clearance, haulage and warehouse')
  self.close(row['TCBDDPCustomerPerUnit'],ddp*self.customer_fx,'Independent customer-currency DDP')
  self.report=dict(tag=self.tag,opportunity=self.number,opportunity_id=self.opportunity_id,item=self.item,product=self.one('Product',self.product)['ProductCode'],request=self.one('PackagingConfigurationRequest',self.request['header']['ID'])['RequestNumber'],request_id=self.request['header']['ID'],net_weight_g=400,packing_way='4x2x2x1',smallest_units_per_carton=16,carton_net_g=6400,carton_gross_kg='7.52',pallet_gross_kg='165.4',pallet_comments=self.comments,containers=self.container_report,costs={k:v for k,v in row.items() if k.startswith('TCB') and k.endswith('PerUnit')})
 def run_review(self,retain=False):
  assert db.DB_NAME=='test' and db.DB_SERVER.lower() in ('desktop-5bgmjsc','localhost','.')
  with db.get_raw_cursor() as self.cur:
   self.cur.execute('SET NOCOUNT ON;SET QUOTED_IDENTIFIER ON;BEGIN TRANSACTION');committed=False
   actor,name=self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE a.Scope='Admin' AND u.IsActive=1 ORDER BY u.ID").fetchone();self.ctx=AccessContext(actor,name,frozenset({'Admin'}))
   try:
    with db.reuse_transaction(self.cur.connection):
     self.masters();self.packaging_masters();self.opportunity_case();self.responses();self.tcb_case();self.oracle()
     for (table,identity),before in self.originals.items():self.check(hashlib.sha256(document(self.rows('SELECT * FROM dbo.['+table+'] WHERE ID=?',identity)[0]).encode()).hexdigest()==before,'Original reference unchanged '+table)
     self.check(self.cur.execute('SELECT @@TRANCOUNT').fetchval()==1,'One owned transaction')
     if retain:self.cur.execute('COMMIT');committed=True
   finally:
    if not committed:self.cur.execute('IF @@TRANCOUNT>0 ROLLBACK')
  self.report.update(retained=committed,checks=len(self.checks),manifest=self.manifest)
  out=ROOT/'artifacts'/'qa-review'/self.tag;out.mkdir(parents=True,exist_ok=True);(out/'case.json').write_text(json.dumps(self.report,default=str,indent=2),encoding='utf-8')
  (out/'review.md').write_text('# Standalone four-layer review\n\n'+self.number+' / '+self.report['request']+' / '+self.report['product']+'\n\nFour layers: Primary 400g unit; 4 Primary per Secondary; 2 Secondary per Tertiary; 2 Tertiary per Quaternary. Final carton: 16 smallest units, 6400g net, 7.52kg gross. Pallet: 4 cartons/layer x 5 layers = 20 cartons, 320 smallest units, 165.4kg gross.\n\nApproved response. Packaging losses: 1%, 2%, 3%, 4%. Fresh masters, nested raw grades, recipes, VND and USD prices, pallet FX, all five container proposals, WH calculator and DDP costs. See case.json for full results.\n',encoding='utf-8')
  print('REVIEW_CASE',document(dict(opportunity=self.number,request=self.report['request'],product=self.report['product'],checks=len(self.checks),retained=committed,report=str(out/'review.md'))))


if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--retain',action='store_true');parser.add_argument('--quiet',action='store_true');args=parser.parse_args();StandaloneReview().run_review(args.retain)
