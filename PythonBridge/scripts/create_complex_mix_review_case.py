"""Fresh desktop review case. Default rolls back; --retain commits validated QA data."""
import argparse
import hashlib
import json
import sys
from datetime import date
from decimal import Decimal as D
from pathlib import Path
from uuid import uuid4

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests/python'))
from opportunity_replica_audit import Audit,b64,document,parsed
import db,main,packaging_api as pkg,raw_material_api as raw
import category_api,ports_api,loss_process_api
import packaging_dimension_api as dims,packaging_type_api as types
import pkg_pricing_api as pricing,pallet_pricing_api as pallet,load_planning_api as loading,tcb_api as tcb
from schemas import CustomerBatchRequest,ProductBatchRequest,OpportunityBatchRequest
from auth import AccessContext
from tcb_costs import Inputs,grade_loss_results
from opportunity_views import sorted_grid
from request_views import item_read
from packaging_weight import response_weights
from pallet_capacity_api import Preview as CapacityPreview,preview as capacity_preview
from floor_capacity_api import FloorPreview,preview as floor_preview


class ReviewCase(Audit):
 def __init__(self):
  super().__init__()
  self.tag='QA-MIX-1028-'+uuid4().hex[:4].upper()
  self.report={'tag':self.tag,'environment':'desktop test','date':'2026-10-28','findings':[]}
  self.fx=D(26500);self.customer_fx=D('1.6')
  self.quantities=[6,4,10];self.weights=[200,150,100];self.layer_counts=[3,2,1]
  self.config={};self.expected_products=[]
 def create_product(self,name,weight,tree=None,mix=None):
  values=dict(RowNum=1,Command='C',CustomerID=self.customer_id,ProductName=self.tag+' '+name,WeightValue=weight,WeightUnit='g',Category=self.category_name,ShelfLifeDays=365,IsMix=mix is not None,Status='Active')
  if tree:values['GradeVersion']=dict(Status='Active',items=tree)
  if mix:values['MixVersion']=dict(Status='Active',items=mix)
  return self.ok(main.product_batch(ProductBatchRequest(rows=[values]),self.ctx.username,True,self.ctx.scopes),'Product')
 def grade(self,name,final=True,parent=None):
  return self.master('grade',raw.RawGradeBatch,raw.grade_save,dict(GradeName=self.tag+' '+name,FinalGrade=final,ParentGradeID=parent,Status='Active'),'RawGrade')
 def raw_material(self,name,grade,price):
  material=self.master('raw',raw.RawMaterialBatch,raw.material_save,dict(MaterialName=self.tag+' '+name,UnitOfMeasure='lbs',GradeID=grade,Status='Active'),'RawMaterial')
  quote=self.master('raw-price',raw.PriceBatch,raw.price_save,dict(MaterialID=material,VendorID=self.usd_vendor,CurrencyID=self.usd,PriceBasis='lbs',QuantityFrom=0,UnitPrice=price,ExchangeRateToUSD=1,EffectiveFrom='2026-10-01',Status='Active'),'RawMaterialPrice')
  return material,quote
 def masters(self):
  self.step('Create fresh Customer, Category, Vendors, raw grades/materials/prices and Products')
  self.usd=self.cur.execute("SELECT ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval()
  self.vnd=self.cur.execute("SELECT ID FROM dbo.Currency WHERE CurrencyCode='VND'").fetchval()
  aud=self.cur.execute("SELECT ID FROM dbo.Currency WHERE CurrencyCode='AUD'").fetchval()
  market=self.cur.execute("SELECT ID FROM dbo.Market WHERE MarketName='Australia'").fetchval()
  self.customer_id=self.ok(main.customer_batch(CustomerBatchRequest(rows=[dict(RowNum=1,Command='C',CustomerName=self.tag+' Review Customer',MarketID=market,CurrencyID=aud)]),self.ctx.username,True,self.ctx.scopes),'Customer')
  self.category_name=self.tag+' Complex Mix'
  self.ok(category_api.save(category_api.CategorySave(CategoryName=self.category_name),self.ctx),'ProductCategory')
  self.usd_vendor=self.master('vendor',pkg.VendorBatch,pkg.vendor_save,dict(VendorName=self.tag+' USD Supplier',CurrencyID=self.usd,Status='Active'),'Vendor')
  self.vnd_vendor=self.master('vendor',pkg.VendorBatch,pkg.vendor_save,dict(VendorName=self.tag+' VND Supplier',CurrencyID=self.vnd,Status='Active'),'Vendor')
  self.port=self.ok(ports_api.save(ports_api.PortSave(CustomerID=self.customer_id,MarketID=market,PortName=self.tag+' Sydney Review Port'),self.ctx),'PortOfEntry')
  cashew=self.grade('Cashew family',False)
  g210=self.grade('Cashew W210',True,cashew);g320=self.grade('Cashew W320',True,cashew);almond=self.grade('Almond')
  pistachio=self.grade('Pistachio');raisin=self.grade('Raisin');mac=self.grade('Macadamia')
  self.raw={}
  for name,g,p in [('W210',g210,'3.6'),('W320',g320,'3.2'),('Almond',almond,'2.8'),('Pistachio',pistachio,'5'),('Raisin',raisin,'1.2'),('Macadamia',mac,'3.8')]:self.raw[name]=self.raw_material(name,g,p)
  a=[dict(ParentID='0',ID=1,RawGradeID=cashew,Grade=self.tag+' Cashew family',RatioPct=60,Process=True),dict(ParentID='0/1',ID=1,RawGradeID=g210,RawMaterialID=self.raw['W210'][0],Grade=self.tag+' W210',RatioPct=70,Process=True),dict(ParentID='0/1',ID=2,RawGradeID=g320,RawMaterialID=self.raw['W320'][0],Grade=self.tag+' W320',RatioPct=30,Process=True),dict(ParentID='0',ID=2,RawGradeID=almond,RawMaterialID=self.raw['Almond'][0],Grade=self.tag+' Almond',RatioPct=40,Process=True)]
  b=[dict(ParentID='0',ID=1,RawGradeID=pistachio,RawMaterialID=self.raw['Pistachio'][0],Grade=self.tag+' Pistachio',RatioPct=70,Process=True),dict(ParentID='0',ID=2,RawGradeID=raisin,RawMaterialID=self.raw['Raisin'][0],Grade=self.tag+' Raisin',RatioPct=30,Process=True)]
  c=[dict(ParentID='0',ID=1,RawGradeID=mac,RawMaterialID=self.raw['Macadamia'][0],Grade=self.tag+' Macadamia',RatioPct=100,Process=True)]
  self.products=[self.create_product('A Roasted Cashew Almond 200g',200,a),self.create_product('B Pistachio Raisin 150g',150,b),self.create_product('C Macadamia Direct Price 100g',100,c)]
  mix=[dict(ProductID=p,UnitQuantity=q,RowVersion=b64(self.one('Product',p)['RowVersion'])) for p,q in zip(self.products,self.quantities)]
  self.parent_product=self.create_product('MASTER MIX 20 units 2800g',0,mix=mix)
  self.close(self.one('Product',self.parent_product)['WeightGrams'],2800,'Mix net weight = 6x200 + 4x150 + 10x100 grams')
  self.codes={}
  for name,shared in [('Sorting',False),('Roasting',True),('Packing',True)]:
   identity=self.ok(loss_process_api.save(loss_process_api.LossMasterSave(ProcessType=self.tag+' '+name,Shared=shared),self.ctx),'LossProcessMaster')
   r=self.one('LossProcessMaster',identity)
   self.codes[name]=dict(MasterID=identity,MasterVersion='0x'+bytes(r['RowVersion']).hex(),ProcessName=r['ProcessType'],Shared=shared)
 def packaging_masters(self):
  self.step('Create fresh packaging types/dimensions/materials/prices for 3/2/1 children and Quaternary parent')
  mm=self.cur.execute("SELECT ID FROM dbo.UoM WHERE UoMCode='mm' AND Status='Active'").fetchval()
  settings=[('A','Primary',(70,60,110),'0.10','USD',12),('A','Secondary',(230,140,130),'5000','VND',40),('A','Tertiary',(300,250,150),'0.75','USD',80),('B','Primary',(60,60,100),'3000','VND',10),('B','Secondary',(140,80,120),'0.40','USD',50),('C','Primary',(60,55,100),'0.08','USD',8),('Parent','Quaternary',(600,400,300),'2.00','USD',400)]
  for owner,order,measure,price,currency,tare in settings:
   ship=owner=='Parent'
   kind=self.master('type',types.PackagingTypeBatch,types.packaging_type_save,dict(PackagingType=self.tag+' '+owner+' '+order,PackagingOrders=[order],FinalComponent=True,CopyDim=True,Shipping=ship,PriceBasis='Count',Status='Active'),'PackagingType')
   values=dict(PackagingTypeID=kind,D1='Length',D2='Width',D3='Height',D1UoMID=mm,D2UoMID=mm,D3UoMID=mm,Status='Active')
   if ship:values.update(OccupiedM2Formula='D1*D2/1000000',OccupiedM3Formula='D1*D2*D3/1000000000')
   definition=self.ok(dims.save(dims.DimensionSave(**values),self.ctx),'PackagingDimension')
   material=self.master('material',pkg.MaterialBatch,pkg.material_save,dict(MaterialName=self.tag+' '+owner+' '+order+' material',UnitOfMeasure='EA',PackagingTypeID=kind,MaterialDimensionID=definition,MaterialDimensionRowVersion=b64(self.one('PackagingDimension',definition)['RowVersion']),MaterialD1=measure[0],MaterialD2=measure[1],MaterialD3=measure[2],TareWeight=tare,TareWeightBasis='g',Status='Active'),'PackagingMaterial')
   quote=self.master('price',pkg.PackagingPriceBatch,pkg.price_save,dict(MaterialID=material,VendorID=self.usd_vendor if currency=='USD' else self.vnd_vendor,CurrencyID=self.usd if currency=='USD' else self.vnd,PriceBasis='EA',QuantityFrom=100,UnitPrice=price,ExchangeRateToUSD=1 if currency=='USD' else None,EffectiveFrom='2026-10-01',Status='Active'),'PackagingPrice')
   self.config[(owner,order)]=dict(type=kind,material=material,price=quote,dimension=definition,measure=measure,usd=D(price) if currency=='USD' else D(price)/self.fx)
  system=self.rows("SELECT TOP(1) t.ID TypeID,d.ID DimensionID FROM dbo.PackagingType t JOIN dbo.PackagingDimension d ON d.PackagingTypeID=t.ID JOIN dbo.UoM u ON u.ID=d.D1UoMID WHERE t.PackagingType='Pallet' AND t.Status='Active' AND d.Status='Active' AND d.D1Name='Length' AND d.D2Name='Width' AND d.D3Name='Height' AND u.UoMCode='mm' ORDER BY d.ID")[0]
  self.pallet_material=self.master('pallet',pkg.MaterialBatch,pkg.material_save,dict(MaterialName=self.tag+' Euro Pallet 800x1200',UnitOfMeasure='EA',PackagingTypeID=system['TypeID'],MaterialDimensionID=system['DimensionID'],MaterialDimensionRowVersion=b64(self.one('PackagingDimension',system['DimensionID'])['RowVersion']),MaterialD1=800,MaterialD2=1200,MaterialD3=150,TareWeight=15,TareWeightBasis='kg',MaxPayloadKG=1200,Status='Active'),'PackagingMaterial')
  self.pallet_price=self.master('pallet-price',pkg.PackagingPriceBatch,pkg.price_save,dict(MaterialID=self.pallet_material,VendorID=self.vnd_vendor,CurrencyID=self.vnd,PriceBasis='EA',QuantityFrom=100,UnitPrice=300000,EffectiveFrom='2026-10-01',Status='Active'),'PackagingPrice')
 def opportunity_case(self):
  self.step('Create fresh Opportunity and configure separate child requests and shipment costs')
  h=dict(RowNum=1,Command='C',OpportunityNumber='',CustomerID=self.customer_id,OpportunityDesc=self.tag+' Complex Mix review - retain for user',BidOpen='2026-10-28',BidClose='2026-11-15',ExchangeRateVNDPerUSD=self.fx,ExchangeRateCustomerCurrencyPerUSD=self.customer_fx)
  result=main.opportunity_batch(OpportunityBatchRequest(header_rows=[h],item_rows=[]),self.ctx.username,True,self.ctx.scopes)
  self.opportunity_id=self.track('Opportunity',result['header_results'][0]['NewID']);self.number=self.one('Opportunity',self.opportunity_id)['OpportunityNumber']
  self.shipping=dict(Incoterm='DDP',PortOfEntryID=self.port,ContainerSizeFT='40FT',FobbingUSDPerContainer='650',FreightUSDPerContainer='1800',DutyPct='4',ImportClearanceCustomerPerContainer='320',PortToWHCustomerPerContainer='800',WHCostBreakdown=dict(Unloading=10,Palletize=5,Inbound=3,Outbound=4,StorageCostPerMonth=2,StorageMonths=3,OrderFeeAdminCost=2,OthersCost=1),OverageShortageDamagePct='.5',WHToCoManWHUSDPerPallet='2',CoManOverheadUSDPerPallet='3',FreightToCustomerUSDPerPallet='4',SpoilageAllowancePct='.5',PaymentTermPct='1',CoManFeePct='2',BrokerFeePct='.5',FloorLoadUSDPerMT='20')
  item=dict(RowNum=1,Command='C',OpportunityNumber=self.number,ProductID=self.parent_product,ItemDescription=self.tag+' Parent / 20 smallest units',AnnualUnit=12000,EstPctAwarded=60,ShelfPrice=25,WebPackagingRequirements=True,PackagingLayerCount=1,ContainerRequest='40DC',ConfigurationRequest='Both',ShipmentCostInfo=self.shipping)
  result=main.opportunity_batch(OpportunityBatchRequest(header_rows=[],item_rows=[item]),self.ctx.username,True,self.ctx.scopes)
  self.parent_item=self.track('OpportunityItem',result['item_results'][0]['NewID'])
  children=self.rows('SELECT * FROM dbo.OpportunityItem WHERE ParentItemID=? ORDER BY MixChildNumber',self.parent_item)
  self.child_items=[]
  self.others=[dict(PackingUSDPerLb='.25',InitialDesignUSD=1500,OtherFixedCostsUSD=600,InterestPct=8,InterestDays=60,MarginMode='Percent',MarginPct=12),dict(PackingUSDPerLb='.30',InitialDesignCustomer=1600,OtherFixedCostsUSD=300,InterestPct=9,InterestDays=45,MarginMode='USDPerLb',MarginUSDPerLb='.20'),dict(PackingUSDPerLb='.20',InitialDesignUSD=500,OtherFixedCostsUSD=200,InterestPct=7,InterestDays=30,MarginMode='Percent',MarginPct=10)]
  for index,(product,count,q) in enumerate(zip(self.products,self.layer_counts,self.quantities)):
   row=next(r for r in children if r['ProductID']==product);identity=self.track('OpportunityItem',row['ID']);self.child_items.append(identity)
   self.close(row['AnnualUnit'],12000*q,'Child annual units follow captured Mix quantity '+str(index))
   fields=dict(RowNum=1,Command='U',ID=identity,RowVersion=b64(row['RowVersion']),OpportunityNumber=self.number,WebPackagingRequirements=True,PackagingLayerCount=count,ShipmentCostInfo=self.others[index])
   for n,order in enumerate(('Primary','Secondary','Tertiary')[:count]):fields[('PrimaryTypeID','SecondaryTypeID','TertiaryTypeID')[n]]=self.config[(chr(65+index),order)]['type']
   if count>1:fields['NumberOfPrimary']=3 if index==0 else 2
   if count>2:fields['NumberOfSecondary']=2
   reply=main.opportunity_batch(OpportunityBatchRequest(header_rows=[],item_rows=[fields]),self.ctx.username,True,self.ctx.scopes)
   self.check(reply['item_results'][0]['Status']=='OK','Child packaging and Others saved '+str(index))
  row=self.one('OpportunityItem',self.parent_item)
  reply=main.opportunity_batch(OpportunityBatchRequest(header_rows=[],item_rows=[dict(RowNum=1,Command='U',ID=self.parent_item,RowVersion=b64(row['RowVersion']),OpportunityNumber=self.number,ProductID=self.parent_product,AnnualUnit=12000,EstPctAwarded=60,ShelfPrice=25,WebPackagingRequirements=True,PackagingLayerCount=1,PrimaryTypeID=self.config[('Parent','Quaternary')]['type'])]),self.ctx.username,True,self.ctx.scopes)
  self.check(reply['item_results'][0]['Status']=='OK','Parent Quaternary request saved after child 3/2/1 counts')
  self.request=self.workflow(self.opportunity_id,[self.parent_item,*self.child_items])
  self.parent_response=self.maps[('ResponseFor',self.parent_item)]
 def responses(self):
  self.step('Price all child layers, check live family weights, then price parent Quaternary')
  for identity,owner,count in zip([*self.child_items,self.parent_item],['A','B','C','Parent'],[3,2,1,1]):
   response=self.maps[('ResponseFor',identity)];calculations=[];applied={}
   for n in range(count):
    local=('Primary','Secondary','Tertiary')[n];order='Quaternary' if owner=='Parent' else local
    config=self.config[(owner,order)];price=self.one('PackagingPrice',config['price'])
    body=pricing.Calculation(PackagingTypeID=config['type'],PackagingOrder=local,LayerCount=count,components=[dict(PriceID=price['ID'],PriceRowVersion=b64(price['RowVersion']),Quantity=1)])
    result=pricing.preview(response,body,self.pic_ctx)['calculation']
    self.check(result['UnitPrice'] is not None,'Material price calculates '+owner+' '+order)
    calculations.append(body.model_copy(update={'Fingerprint':result['Fingerprint']}))
    applied[('FirstPMType','SecondPMType','ThirdPMType')[n]]=result['PackagingTypeName']
    applied[('FirstPMMOQ','SecondPMMOQ','ThirdPMMOQ')[n]]=result['FinalMOQ']
   values=dict(ResponseLayerCount=count)
   if owner!='Parent':values['ApplicableNetWeightGrams']=self.weights[ord(owner)-65]
   if owner!='Parent':values['NutDensity']=('0.55','0.60','0.50')[ord(owner)-65]
   if count>1:values['UnitsPerCarton']=3 if owner=='A' else 2
   if count>2:values['UnitsPerTertiary']=2
   if owner=='Parent':
    self.floor=floor_preview(response,FloorPreview(Carton=dict(length=600,width=400,height=300),CartonGrossKG='3.652'),self.pic_ctx)['rows']
    floor_count=int(next(r for r in self.floor if r['Code']=='40DC')['Result']['cartons'])-1
    values.update(ResponsePalletMaterialID=self.pallet_material,ResponsePalletSize='800x1200mm',ResponsePalletStacking='Single',ResponseMaxPalletHeightMM=1650,SelectedContainerType='40DC',CartonsPerContainer=floor_count)
   self.response(response,PricingCalculations=calculations,**values,**applied)
  weights=response_weights(self.cur,self.parent_response)
  self.close(weights['CartonGrossWeightKG'],D('3.652'),'Independent parent gross includes every child layer and parent tare')
  self.response(self.parent_response,SameConfig=False)
  self.step('Save VND pallet quote and compute payload/height-limited pallet capacity')
  price=self.one('PackagingPrice',self.pallet_price)
  selected=pallet.Selection(PalletSize='800x1200mm',PalletMaterialID=self.pallet_material,ItemRowVersion=b64(self.one('PackagingConfigurationRequestItem',self.parent_response)['RowVersion']),components=[dict(PriceID=price['ID'],RowVersion=b64(price['RowVersion']),MaterialRowVersion=b64(self.one('PackagingMaterial',self.pallet_material)['RowVersion']),Quantity=1)])
  assembly=pallet.save(self.parent_response,selected,self.pic_ctx);self.track('PalletPricingSnapshot',assembly['ID'])
  self.response(self.parent_response,PalletPricingID=assembly['ID'])
  cap=capacity_preview(self.parent_response,CapacityPreview(PalletMaterialID=self.pallet_material,Carton=dict(length=600,width=400,height=300),CartonGrossKG='3.652',TareKG=15,MaxPalletHeightMM=1650),self.pic_ctx)
  self.check((cap['cartons_per_layer'],cap['pallet_layers'])==(4,5),'Pallet independent footprint 4 and height 5 layers')
  self.response(self.parent_response,CartonsPerLayer=4,LayersPerPallet=5)
  self.close(cap['gross_kg'],D('88.04'),'20 cartons x 3.652 + pallet 15 = 88.04 kg')
  self.floor=floor_preview(self.parent_response,FloorPreview(Carton=dict(length=600,width=400,height=300),CartonGrossKG='3.652'),self.pic_ctx)['rows']
  self.plans={};profiles={};mapping={}
  for container in self.rows("SELECT * FROM dbo.ContainerTypeMaster WHERE Status='Active' ORDER BY Code"):
   code=container['Code']
   if code not in ('20DC','20RC','40DC','40HC','40RHC'):continue
   spec=parsed(container['Specifications']);row=self.one('PackagingConfigurationRequestItem',self.parent_response)
   plan=loading.save(self.parent_response,loading.SavePlan(ContainerID=container['ID'],ContainerRowVersion=b64(container['RowVersion']),ItemRowVersion=b64(row['RowVersion']),Inputs=dict(mode='pallet',container={k:spec[k] for k in ('length','width','height')},carton=dict(length=600,width=400,height=300),carton_kg='3.652',pallet=dict(length=800,width=1200,height=150),pallet_kg=15,max_pallet_height=1650)),self.pic_ctx)
   self.track('ContainerLoadPlan',plan['ID']);self.plans[code]=plan;mapping[container['ID']]=plan['ID']
   count=D(plan['Result']['cartons']);pallets=D(plan['Result']['loaded_units'])
   self.close(count,pallets*20,'Container carton count '+code)
   self.close(plan['Result']['net_kg'],count*D('2.8'),'Container net '+code)
   self.close(plan['Result']['gross_kg'],count*D('3.652')+pallets*15,'Container gross '+code)
   floor=next(r for r in self.floor if r['Code']==code)
   self.check('error' not in floor,'Floor proposal available '+code)
   floor_count=int(floor['Result']['cartons'])-(1 if code=='40DC' else 0)
   profiles[code]=dict(Proposal=True,PalletsPerContainer=int(pallets),CartonsPerContainer=floor_count)
  self.check(len(mapping)==5,'Five container alternatives saved')
  self.response(self.parent_response,ContainerLoadPlanIDs=mapping,LoadPlanID=self.plans['40DC']['ID'],SelectedContainerType='40DC',ContainerLoadProfiles=profiles)
  self.step('Verify unapproved packaging stays out of Opportunity, then approve complete family')
  before=next(r for r in sorted_grid(self.ctx.username,1,100,'[]',opportunity_number=self.number)['rows'] if r['ItemID']==self.parent_item)
  self.check(before['FirstPMType'] is None,'Working response not published to Opportunity')
  self.approve(self.request)
  self.check(all(self.one('PackagingConfigurationRequestItem',r['ID'])['Stage']=='Approved' for r in self.request['items']),'Whole family approved')
 def price_selection(self,path,name,direct=False):
  if direct:return dict(Path=path,DirectUSDPerLb='0.1')
  price=self.one('RawMaterialPrice',self.raw[name][1]);return dict(Path=path,PriceID=price['ID'],PriceVersion='0x'+bytes(price['RowVersion']).hex())
 def tcb_case(self):
  self.step('Save nested grade formulas, recipes, all packaging losses and direct raw price 0.1')
  def loss(path,names,values):return dict(Path=path,Codes=[self.codes[n] for n in names],Ratios=values)
  losses=[
   [loss('0/1/1',['Sorting'],['.5']),loss('0/1/2',['Sorting'],['.75']),loss('0/1',['Roasting'],['1.2']),loss('0/2',['Sorting'],['.8']),loss('0',['Packing'],['.3'])],
   [loss('0/1',['Sorting','Roasting'],['1','.5']),loss('0/2',['Sorting'],['.4']),loss('0',['Packing'],['.2'])],
   [loss('0/1',['Sorting','Roasting'],['.3','.4']),loss('0',['Packing'],['.5'])]]
  recipes=[
   [dict(Path='0/1',RMRatio=95,SeasoningRatio=3,SeasoningUSDPerLb='.2',OilPct=2,OilUSDPerLb='.5',ProcessingUSDPerLb='.1'),dict(Path='0/2',RMRatio=97,SeasoningRatio=3,SeasoningUSDPerLb='.15',OilPct=0,ProcessingUSDPerLb='.08')],
   [dict(Path='0/1',RMRatio=98,SeasoningRatio=1,SeasoningUSDPerLb='.1',OilPct=1,OilUSDPerLb='.4',ProcessingUSDPerLb='.12'),dict(Path='0/2',RMRatio=100,SeasoningRatio=0,OilPct=0,ProcessingUSDPerLb='.02')],
   [dict(Path='0/1',RMRatio=100,SeasoningRatio=0,OilPct=0,ProcessingUSDPerLb='.03')]]
  selections=[[self.price_selection('0/1/1','W210'),self.price_selection('0/1/2','W320'),self.price_selection('0/2','Almond')],[self.price_selection('0/1','Pistachio'),self.price_selection('0/2','Raisin')],[self.price_selection('0/1','Macadamia',True)]]
  a_rm=D('.7')*D('3.6')/(D('.995')*D('.988')*D('.997'))+D('.3')*D('3.2')/(D('.9925')*D('.988')*D('.997'))
  almond=D('2.8')/(D('.992')*D('.997'));pistachio=D(5)/(D('.99')*D('.995')*D('.998'));raisin=D('1.2')/(D('.996')*D('.998'));mac=D('.1')/(D('.997')*D('.996')*D('.995'))
  raw_expected=[a_rm*D('.95')*D('.6')+almond*D('.97')*D('.4'),pistachio*D('.98')*D('.7')+raisin*D('.3'),mac]
  product_expected=[(a_rm*D('.95')+D('.016')+D('.1')*a_rm/D('3.48'))*D('.6')+(almond*D('.97')+D('.0045')+D('.08')*almond/D('2.8'))*D('.4'),(pistachio*D('.98')+D('.005')+D('.12')*pistachio/D('5'))*D('.7')+(raisin+D('.02')*raisin/D('1.2'))*D('.3'),mac+D('.03')*mac/D('.1')]
  package_losses=[[1,2,3],[2,1],[1]]
  for index,item in enumerate(self.child_items):
   opened=tcb.read(item,self.ctx)
   values=dict(Prices=selections[index],MaterialCosts=recipes[index],ProcessLossMode='GradePath',ProcessLossLayout='Aligned',ProcessLosses=losses[index])
   initial=Inputs(**values)
   calculated=grade_loss_results(initial,opened['grades'],self.weights[index])
   values['ProcessLossFormulas']={r['Path']:'1-'+'*'.join('(1-L'+str(n+1)+')' for n in range(len(r['Ratios']))) for r in calculated}
   steps=[dict(ProcessType=order+'Packaging',Sequence=1,LossPct=str(pct)) for order,pct in zip(('Primary','Secondary','Tertiary'),package_losses[index])]
   body=tcb.CommercialSave(RowVersion=opened['item']['RowVersion'],CostInputs=values,Prices=selections[index],Inputs=dict(LossProcesses=steps))
   saved=tcb.commercial_save(body,item,self.ctx)['saved']
   self.close(saved['RMCostUSDPerLb'],raw_expected[index],'Independent raw cost child '+str(index))
   self.close(saved['ProductUSDPerLb'],product_expected[index],'Independent product cost child '+str(index))
   self.expected_products.append(product_expected[index])
   reopened=tcb.read(item,self.ctx)
   if index==2:
    self.check(reopened['saved']['Inputs']['Prices'][0]['DirectUSDPerLb']=='0.1','Direct price 0.1 persists through reopen')
    saved=tcb.commercial_save(tcb.CommercialSave(RowVersion=reopened['item']['RowVersion'],Prices=selections[index],Inputs=dict(LossProcesses=steps)),item,self.ctx)['saved']
    self.close(saved['ProductUSDPerLb'],product_expected[index],'Direct price repeat save unchanged')
  opened=tcb.read(self.parent_item,self.ctx)
  saved=tcb.commercial_save(tcb.CommercialSave(RowVersion=opened['item']['RowVersion'],CostInputs={},Prices=[],Inputs=dict(LossProcesses=[dict(ProcessType='MixPrimaryPackaging',Sequence=1,LossPct='4')])),self.parent_item,self.ctx)['saved']
  self.close(saved['Inputs']['PalletUSDPerEA'],D('11.320755'),'Repeating pallet FX validated at six decimals')
  self.check(opened['item']['PackagingLayerStart']==4,'Parent starts globally at Quaternary')
 def oracle(self):
  self.step('Compare every TCB Analysis field against independent Decimal calculations')
  rows=sorted_grid(self.ctx.username,1,100,'[]',opportunity_number=self.number)['rows'];root=next(r for r in rows if r['ItemID']==self.parent_item)
  self.close(root['UnitsPerPallet'],20,'20 Mix cartons per pallet')
  self.close(root['GrossWeightPerPalletKG'],D('88.04'),'Published pallet gross')
  count=D(self.plans['40DC']['Result']['cartons']);self.close(root['ContainerLoadResults']['40DC']['CalculatedCartonsPerContainer'],count,'Both retains selected pallet-plan capacity')
  total=D(20);pallet_units=D(20)*total;container_units=count*total;lbs=[D(w)/D('453.59237') for w in self.weights]
  usd=lambda owner,order:self.config[(owner,order)]['usd']
  own_pm=[usd('A','Primary')/D('.99')+usd('A','Secondary')/D('.98')/3+usd('A','Tertiary')/D('.97')/6,usd('B','Primary')/D('.98')+usd('B','Secondary')/D('.99')/2,usd('C','Primary')/D('.99')]
  parent_pm=D(2)/D('.96')/total
  self.report['containers']={code:dict(pallets=p['Result']['loaded_units'],cartons=p['Result']['cartons'],net_kg=p['Result']['net_kg'],gross_kg=p['Result']['gross_kg'],floor_max=next(f['Result']['cartons'] for f in self.floor if f['Code']==code)) for code,p in self.plans.items()}
  self.report['results']=[]
  for index,item in enumerate(self.child_items):
   r=next(r for r in rows if r['ItemID']==item);weight=lbs[index];q=D(self.quantities[index]);awarded=D(12000)*D('.6')*q
   others=self.others[index]
   initial=D(str(others.get('InitialDesignUSD',0))) if 'InitialDesignUSD' in others else D(str(others['InitialDesignCustomer']))/self.customer_fx
   values=dict(TCBProductPerUnit=self.expected_products[index]*weight,TCBSelfPackagingPerUnit=own_pm[index],TCBParentPackagingPerUnit=parent_pm,TCBPalletPerUnit=D(20)*D(self.weights[index])/1000000,TCBPackingPerUnit=(D(1200)*D('.25')+D(600)*D('.30')+D(1000)*D('.20'))/D(2800)*weight,TCBInitialDesignPerUnit=initial/awarded,TCBFixedCostsPerUnit=D(others['OtherFixedCostsUSD'])/awarded,TCBFobbingPerUnit=D(650)/container_units)
   values['TCBInterestPerUnit']=sum(values.values())*D(others['InterestPct'])/100*D(others['InterestDays'])/360
   values['TCBMarginPerUnit']=D('.2')*weight if index==1 else sum(values.values())*D(others['MarginPct'])/100
   values['TCBFOBPerUnit']=sum(values.values());values['TCBFOBCustomerPerUnit']=values['TCBFOBPerUnit']*self.customer_fx
   destination=dict(TCBFreightPerUnit=D(1800)/container_units,TCBDutyPerUnit=(values['TCBFOBPerUnit']+D(1800)/container_units)*D('.04'),TCBClearancePerUnit=D(320)/self.customer_fx/container_units,TCBHaulagePerUnit=D(800)/self.customer_fx/container_units,TCBDestinationWHPerUnit=D(31)/self.customer_fx/pallet_units)
   destination['TCBDamagePerUnit']=(values['TCBFOBPerUnit']+sum(destination.values()))*D('.005')
   destination.update(TCBWHToCoManPerUnit=D(2)/pallet_units,TCBCoManOverheadPerUnit=D(3)/pallet_units,TCBFreightToCustomerPerUnit=D(4)/pallet_units)
   base=values['TCBFOBPerUnit']+sum(destination.values());gross=base/D('.96')
   destination.update(TCBSpoilagePerUnit=gross*D('.005'),TCBPaymentTermPerUnit=gross*D('.01'),TCBCoManFeePerUnit=gross*D('.02'),TCBBrokerFeePerUnit=gross*D('.005'))
   values.update(destination);values.update(TCBCFRPerUnit=values['TCBFOBPerUnit']+values['TCBFreightPerUnit'],TCBDDPPerUnit=gross,TCBDDPCustomerPerUnit=gross*self.customer_fx)
   for key,expected in values.items():self.close(r.get(key),expected,'Child '+str(index)+' '+key)
   self.report['results'].append(dict(item=item,product=r['ProductCode'],name=r['ProductName'],quantity=self.quantities[index],layers=self.layer_counts[index],product_usd_lb=str(self.expected_products[index]),actual={k:r.get(k) for k in values},expected={k:str(v) for k,v in values.items()}))
  self.report.update(opportunity=self.number,opportunity_id=self.opportunity_id,request=self.one('PackagingConfigurationRequest',self.request['header']['ID'])['RequestNumber'],parent_product=self.one('Product',self.parent_product)['ProductCode'],parent_item=self.parent_item,net_grams=2800,gross_carton_kg='3.652',cartons_per_layer=4,layers_per_pallet=5,cartons_per_pallet=20,smallest_units_per_pallet=400,pallet_gross_kg='88.04',warehouse_aud_per_pallet=31)
 def run_review(self,retain=False):
  assert db.DB_NAME=='test' and db.DB_SERVER.lower() in ('desktop-5bgmjsc','localhost','.'),'Desktop test only'
  with db.get_raw_cursor() as self.cur:
   self.cur.execute('SET NOCOUNT ON; SET QUOTED_IDENTIFIER ON; BEGIN TRANSACTION')
   actor,name=self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE a.Scope='Admin' AND u.IsActive=1 ORDER BY u.ID").fetchone()
   self.ctx=AccessContext(actor,name,frozenset({'Admin'}));committed=False
   try:
    with db.reuse_transaction(self.cur.connection):
     self.masters();self.packaging_masters();self.opportunity_case();self.responses();self.tcb_case();self.oracle()
     self.check(self.cur.execute('SELECT @@TRANCOUNT').fetchval()==1,'One owned transaction before final commit')
     if retain:self.cur.execute('COMMIT');committed=True
   finally:
    if not committed:self.cur.execute('IF @@TRANCOUNT>0 ROLLBACK')
   if not committed:
    remaining=[(t,i) for t,ids in self.manifest.items() for i in ids if self.cur.execute('SELECT 1 FROM dbo.['+t+'] WHERE ID=?',i).fetchone()]
    self.check(not remaining,'Dry-run fixture cleanup complete')
   for (table,identity),before in self.originals.items():self.check(hashlib.sha256(document(self.rows('SELECT * FROM dbo.['+table+'] WHERE ID=?',identity)[0]).encode()).hexdigest()==before,'Original reference unchanged '+table+' '+str(identity))
  self.report.update(retained=committed,checks=len(self.checks),manifest=self.manifest,steps=self.steps)
  directory=ROOT/'artifacts'/'qa-review'/self.tag;directory.mkdir(parents=True,exist_ok=True)
  (directory/'case.json').write_text(json.dumps(self.report,default=str,indent=2),encoding='utf-8')
  text=['# Complex Mix review case',self.tag,'','Opportunity: '+self.report['opportunity'],'Packaging request: '+self.report['request'],'Retained: '+str(committed),'Checks passed: '+str(len(self.checks)),'','## Packaging','Child quantities: A x6, B x4, C x10. Child layers: 3/2/1. Parent: Quaternary.','Mix net 2,800 g; final carton gross 3.652 kg; pallet 4 x 5 = 20 cartons, 400 smallest units, gross 88.04 kg.','Pallet price 300,000 VND / 26,500 = 11.320754716... USD; TCB input 11.320755.','Warehouse: 10 + 5 + 3 + 4 + 2 x 3 + 2 + 1 = 31 AUD/pallet.','','## TCB per smallest child unit','| Product | Quantity | Layers | Self PM USD | Parent PM USD | FOB USD | DDP AUD |','| --- | ---: | ---: | ---: | ---: | ---: | ---: |']
  for r in self.report['results']:
   a=r['actual'];text.append('| '+r['product']+' | '+str(r['quantity'])+' | '+str(r['layers'])+' | '+str(a['TCBSelfPackagingPerUnit'])+' | '+str(a['TCBParentPackagingPerUnit'])+' | '+str(a['TCBFOBPerUnit'])+' | '+str(a['TCBDDPCustomerPerUnit'])+' |')
  text+=['','Full expected/actual values and created IDs are in case.json.','All business master data is newly created with the QA prefix; currencies, UoMs, country, container specifications and the singleton Pallet type/dimension are shared reference data.']
  (directory/'review.md').write_text('\n'.join(text)+'\n',encoding='utf-8')
  print('REVIEW_CASE',document(dict(tag=self.tag,retained=committed,opportunity=self.number,request=self.report['request'],checks=len(self.checks),report=str(directory/'review.md'))),flush=True)


if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--retain',action='store_true');parser.add_argument('--quiet',action='store_true');args=parser.parse_args()
 ReviewCase().run_review(args.retain)
