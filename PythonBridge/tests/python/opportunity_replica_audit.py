"""User-requested, rollback-only end-to-end audits of 10075 and 10094.

Runs real API handlers and SQL procedures, not mocked business calculations.
Original records are read-only. Every created record belongs to one transaction;
finally rolls it back and verifies the explicit ID manifest and original hashes.
Run: PYTHONPATH=core python tests/python/opportunity_replica_audit.py
"""
import base64
import hashlib
import json
import sys
from copy import deepcopy
from datetime import date,timedelta
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
import db
import main
import packaging_api as pkg
import raw_material_api as raw
import packaging_dimension_api as dims
import packaging_type_api as types
import product_grades_api as grades_api
import product_mix_api as mix_api
import pkg_pricing_api as pricing
import pallet_pricing_api as pallet
import load_planning_api as loading
import tcb_api as tcb
from auth import AccessContext
from packaging_orders import decode_orders
from schemas import CustomerBatchRequest,ProductBatchRequest,OpportunityBatchRequest,OpportunityItemRow
from product_grades import GradeItem
from tcb_costs import Inputs
from opportunity_views import sorted_grid
from tcb_analysis_columns import TCB_COLUMNS

def serial(v):
 if isinstance(v,(bytes,bytearray)):return base64.b64encode(v).decode()
 return str(v)
def document(v):return json.dumps(v,default=serial,sort_keys=True)
def b64(v):return base64.b64encode(bytes(v)).decode()
def parsed(v):return json.loads(v) if isinstance(v,str) else deepcopy(v)
def equivalent(actual,expected):
 if actual==expected:return True
 if isinstance(expected,dict):return isinstance(actual,dict) and all(k in actual and equivalent(actual[k],v) for k,v in expected.items())
 if isinstance(expected,list):return isinstance(actual,list) and len(actual)==len(expected) and all(equivalent(a,b) for a,b in zip(actual,expected))
 if actual is None or expected is None:return False
 try:return Decimal(str(actual))==Decimal(str(expected))
 except Exception:return False

class Audit:
 def __init__(self):
  self.tag='QA'+uuid4().hex[:8]
  self.maps={};self.manifest={};self.originals={};self.checks=[];self.differences=[];self.steps=[]
 def rows(self,sql,*args):
  self.cur.execute(sql,*args)
  return [dict(zip([d[0] for d in self.cur.description],r)) for r in self.cur.fetchall()]
 def one(self,table,identity):
  row=self.rows('SELECT * FROM dbo.['+table+'] WHERE ID=?',identity)[0]
  if identity not in self.manifest.get(table,[]):self.originals.setdefault((table,identity),hashlib.sha256(document(row).encode()).hexdigest())
  return row
 def track(self,table,identity):
  self.manifest.setdefault(table,[]).append(int(identity));return int(identity)
 def step(self,label):
  self.steps.append(label);print('STEP',label,flush=True)
  assert self.cur.execute('SELECT @@TRANCOUNT').fetchval()==1,'Audit transaction ownership lost'
 def check(self,condition,label):
  assert condition,label
  self.checks.append(label)
  if '--quiet' not in sys.argv:print('PASS',label,flush=True)
 def close(self,actual,expected,label,tolerance='0.000001'):
  self.check(actual is not None and expected is not None and abs(Decimal(str(actual))-Decimal(str(expected)))<=Decimal(tolerance),label+': '+str(actual)+' vs '+str(expected))
 def ok(self,result,table=None):
  rows=result.get('results',result.get('rows'))
  if rows is None:rows=[result['row']]
  assert len(rows)==1,document(result)
  row=rows[0];assert row.get('Status','OK') in ('OK','Active'),document(result)
  identity=row.get('NewID',row.get('ID'))
  if table:self.track(table,identity)
  return identity
 def master(self,entity,model,save,values,table):
  return self.ok(save(model(rows=[dict(RowNum=1,Command='C',**values)]),self.ctx),table)
 def clone(self,table,identity):
  if not identity:return None
  if identity in self.manifest.get(table,[]):return identity
  key=(table,int(identity))
  if key in self.maps:return self.maps[key]
  r=self.one(table,identity)
  if table=='RawGrade':
   values=dict(GradeName=self.tag+' '+r['GradeName'],ParentGradeID=self.clone('RawGrade',r['ParentGradeID']),FinalGrade=bool(r['FinalGrade']),Status='Active')
   new=self.master(table,raw.RawGradeBatch,raw.grade_save,values,table)
  elif table=='Vendor':
   new=self.master(table,pkg.VendorBatch,pkg.vendor_save,dict(VendorName=self.tag+' '+r['VendorName'],Address=r['Address'],CurrencyID=r['CurrencyID'],Status='Active'),table)
  elif table=='RawMaterial':
   new=self.master(table,raw.RawMaterialBatch,raw.material_save,dict(MaterialName=self.tag+' '+r['MaterialName'],Description=r['Description'],Origin=r['Origin'],UnitOfMeasure=r['UnitOfMeasure'],GradeID=self.clone('RawGrade',r['GradeID']),Status='Active'),table)
  elif table=='PackagingType':
   if r['PackagingType']=='Pallet':
    # This named system type is a singleton, just like shared currencies/UoMs.
    self.maps[key]=identity;return identity
   view=decode_orders(self.rows('SELECT * FROM dbo.v_PackagingTypeWeb WHERE ID=?',identity))[0]
   parents=[self.clone(table,i) for i in view['ParentTypeIDs']]
   values={k:view[k] for k in ('Shipping','FinalComponent','CopyDim','PriceBasis')}
   values.update(PackagingType=self.tag+' '+r['PackagingType'],ParentTypeIDs=parents,PackagingOrders=view['PackagingOrders'],Status='Active')
   new=self.master(table,types.PackagingTypeBatch,types.packaging_type_save,values,table)
  elif table=='PackagingDimension':
   type_id=self.clone('PackagingType',r['PackagingTypeID'])
   if type_id==r['PackagingTypeID']:
    self.maps[key]=identity;return identity
   parent=self.clone(table,r.get('ParentDimensionID'))
   values={k:r[k] for k in ('D1UoMID','D2UoMID','D3UoMID','ConversionOutputUoMID','OccupiedM2Formula','OccupiedM3Formula','ConvertFromParentFormula','ConvertFromSupplierFormula')}
   values.update(PackagingTypeID=type_id,D1=r['D1Name'],D2=r['D2Name'],D3=r['D3Name'],ParentDimensionID=parent,ParentDimensionRowVersion=b64(self.one(table,parent)['RowVersion']) if parent else None,FormulaReviewed=True,Status='Active')
   if not values['ConversionOutputUoMID']:values.pop('ConversionOutputUoMID')
   new=self.ok(dims.save(dims.DimensionSave(**values),self.ctx),table)
  elif table=='PackagingMaterial':
   dimension=self.clone('PackagingDimension',r.get('MaterialDimensionID'))
   values={k:r.get(k) for k in ('Description','UnitOfMeasure','TareWeight','TareWeightBasis','MaterialD1','MaterialD2','MaterialD3')}
   values.update(MaterialName=self.tag+' '+r['MaterialName'],PackagingTypeID=self.clone('PackagingType',r['PackagingTypeID']),MaterialDimensionID=dimension,MaterialDimensionRowVersion=b64(self.one('PackagingDimension',dimension)['RowVersion']) if dimension else None,Status='Active')
   new=self.master(table,pkg.MaterialBatch,pkg.material_save,values,table)
  elif table in ('RawMaterialPrice','PackagingPrice'):
   material='RawMaterial' if table=='RawMaterialPrice' else 'PackagingMaterial'
   values={k:r.get(k) for k in ('CurrencyID','PriceBasis','QuantityFrom','QuantityTo','UnitPrice','ExchangeRateToUSD','EffectiveFrom','EffectiveTo')}
   values.update(MaterialID=self.clone(material,r['MaterialID']),VendorID=self.clone('Vendor',r['VendorID']),Status='Active')
   # Old VND price snapshots predate per-quote FX. Use the reference header FX.
   if not values['ExchangeRateToUSD']:
    currency=self.one('Currency',r['CurrencyID'])['CurrencyCode']
    assert currency in ('USD','VND'),currency
    values['ExchangeRateToUSD']=1 if currency=='USD' else self.source_header['ExchangeRateVNDPerUSD']
   model,save=(raw.PriceBatch,raw.price_save) if material=='RawMaterial' else (pkg.PackagingPriceBatch,pkg.price_save)
   new=self.master(table,model,save,values,table)
  else:raise AssertionError('Unsupported clone '+table)
  self.maps[key]=new;return new
 def tree(self,items):
  result=[]
  for item in items:
   row={k:v for k,v in item.items() if k in GradeItem.model_fields}
   row['RawGradeID']=self.clone('RawGrade',row.get('RawGradeID'))
   row['RawMaterialID']=self.clone('RawMaterial',row.get('RawMaterialID'))
   if row['RawGradeID']:row['Grade']=self.one('RawGrade',row['RawGradeID'])['GradeName']
   result.append(row)
  return result
 def customer(self,source):
  r=self.one('Customer',source)
  identity=self.ok(main.customer_batch(CustomerBatchRequest(rows=[dict(RowNum=1,Command='C',CustomerName=self.tag+' '+r['CustomerName'],MarketID=r['MarketID'],CurrencyID=r['CurrencyID'])]),self.ctx.username,True,self.ctx.scopes),'Customer')
  self.maps[('Customer',source)]=identity;return identity
 def product(self,source,customer,weight,tree=None,mix=None):
  r=self.one('Product',source)
  values=dict(RowNum=1,Command='C',CustomerID=customer,ProductName=self.tag+' '+r['ProductName'],WeightValue=weight,WeightUnit='g',Category=r['Category'],ShelfLifeDays=r['ShelfLifeDays'],IsMix=mix is not None)
  if tree:values['GradeVersion']=dict(Status='Active',items=tree)
  if mix:values['MixVersion']=dict(Status='Active',items=mix)
  identity=self.ok(main.product_batch(ProductBatchRequest(rows=[values]),self.ctx.username,True,self.ctx.scopes),'Product')
  self.maps[('Product',source)]=identity;return identity
 def opportunity(self,source,items,customer):
  h=source
  header=dict(RowNum=1,Command='C',OpportunityNumber='',CustomerID=customer,OpportunityDesc=self.tag+' replica '+h['OpportunityNumber'],BidOpen=h['BidOpen'].isoformat(),BidClose=h['BidClose'].isoformat(),ExchangeRateVNDPerUSD=h['ExchangeRateVNDPerUSD'],ExchangeRateCustomerCurrencyPerUSD=h['ExchangeRateCustomerCurrencyPerUSD'])
  result=main.opportunity_batch(OpportunityBatchRequest(header_rows=[header],item_rows=[]),self.ctx.username,True,self.ctx.scopes)
  row=result['header_results'][0];assert row['Status']=='OK',result
  identity=self.track('Opportunity',row['NewID']);saved_header=self.one('Opportunity',identity);number=saved_header['OpportunityNumber']
  for key in ('CustomerID','OpportunityDesc','ExchangeRateVNDPerUSD','ExchangeRateCustomerCurrencyPerUSD'):
   self.check(equivalent(saved_header[key],header[key]),'Opportunity header preserved '+key)
  output=[]
  for source_item in items:
   values={k:v for k,v in source_item.items() if k in OpportunityItemRow.model_fields and v is not None}
   for k in ('ID','RowVersion','ProductGradeSnapshot','TCBCostInfo','ShipmentCostInfo'):values.pop(k,None)
   values.update(RowNum=1,Command='C',OpportunityNumber=number,ProductID=self.maps[('Product',source_item['ProductID'])],ItemDescription=self.tag+' '+source_item['ItemDescription'],AnnualUnit=source_item['AnnualUnit'],EstPctAwarded=source_item['EstPctAwarded'],ShelfPrice=source_item['ShelfPrice'])
   for field in ('PrimaryTypeID','SecondaryTypeID','TertiaryTypeID'):
    if source_item.get(field):values[field]=self.clone('PackagingType',source_item[field])
   shipping=parsed(source_item.get('ShipmentCostInfo') or '{}')
   if shipping.get('PortOfEntryID'):
    from ports_api import PortSave,save
    p=self.one('PortOfEntry',shipping['PortOfEntryID'])
    key=('PortOfEntry',p['ID'])
    if key not in self.maps:self.maps[key]=self.ok(save(PortSave(CustomerID=customer,MarketID=p['MarketID'],PortName=self.tag+' '+p['PortName']),self.ctx),'PortOfEntry')
    shipping['PortOfEntryID']=self.maps[key]
   values['ShipmentCostInfo']=shipping
   result=main.opportunity_batch(OpportunityBatchRequest(header_rows=[],item_rows=[values]),self.ctx.username,True,self.ctx.scopes)
   row=result['item_results'][0];assert row['Status']=='OK',document(result)
   item=self.track('OpportunityItem',row['NewID']);self.maps[('OpportunityItem',source_item['ID'])]=item;output.append(item)
   saved_item=self.one('OpportunityItem',item)
   for key,value in values.items():
    if key in saved_item and key not in ('ID','RowVersion','Command','RowNum','OpportunityNumber'):
     actual=parsed(saved_item[key]) if key=='ShipmentCostInfo' else saved_item[key]
     self.check(equivalent(actual,value),'Opportunity item preserved '+str(source_item['ID'])+' '+key)
  return identity,number,output
 def response(self,identity,**fields):
  row=self.one('PackagingConfigurationRequestItem',identity)
  result=pkg.response_save(pkg.ResponseBatch(rows=[dict(RowNum=1,ID=identity,RowVersion=b64(row['RowVersion']),**fields)]),self.pic_ctx)
  self.check(result['results'][0]['Status']=='OK','response saved '+str(identity))
  return self.one('PackagingConfigurationRequestItem',identity)
 def workflow(self,opportunity,item_ids):
  header=self.one('Opportunity',opportunity)
  request=pkg.manual_create(pkg.ManualRequest(OpportunityID=opportunity,ExpectedRowVersion=b64(header['RowVersion']),CreationKey=uuid4(),ResponseDue=date(2026,10,23)+timedelta(days=30),items=[dict(OpportunityItemID=i,ExpectedRowVersion=b64(self.one('OpportunityItem',i)['RowVersion'])) for i in item_ids]),self.ctx)
  self.track('PackagingConfigurationRequest',request['header']['ID'])
  for r in request['items']:
   self.track('PackagingConfigurationRequestItem',r['ID']);self.maps[('ResponseFor',r['OpportunityItemID'])]=r['ID']
  roots=[r for r in request['items'] if not self.one('OpportunityItem',r['OpportunityItemID'])['ParentItemID']]
  for r in roots:
   row=self.one('PackagingConfigurationRequestItem',r['ID'])
   pic=self.cur.execute("SELECT TOP(1) u.ID FROM dbo.Users u WHERE dbo.fn_PackagingPICMember(u.ID)=1 ORDER BY u.ID").fetchval()
   assert pic,'An existing authorized Packaging PIC is required'
   user=self.one('Users',pic)
   scopes=frozenset(r[0] for r in self.cur.execute('SELECT Scope FROM dbo.UserAccess WHERE UserID=?',pic).fetchall())
   self.pic_ctx=AccessContext(pic,user['UserName'],scopes)
   pkg.assign(row['ID'],pkg.Assignment(PICUserID=pic,ExpectedRowVersion=b64(row['RowVersion'])),self.ctx)
   row=self.one('PackagingConfigurationRequestItem',r['ID'])
   pkg.transition(row['ID'],pkg.Transition(TargetStage='Working',ExpectedRowVersion=b64(row['RowVersion'])),self.pic_ctx)
  return request
 def replay_response(self,source):
  oi=self.maps[('OpportunityItem',source['OpportunityItemID'])];identity=self.maps[('ResponseFor',oi)]
  fields={k:source[k] for k in ('ResponseLayerCount','UnitsPerCarton','UnitsPerTertiary','NutDensity','ResponsePalletSize','ResponsePalletStacking','ResponseMaxPalletHeightMM','SelectedContainerType','ConfigurationRequest','CartonsPerLayer','LayersPerPallet') if k in pkg.ResponseRow.model_fields and source.get(k) is not None}
  calculations=[]
  masters=self.rows('SELECT * FROM dbo.PkgPricingMaster WHERE RequestItemID=? AND IsCurrent=1 ORDER BY ID',source['ID'])
  for master in masters:
   self.one('PkgPricingMaster',master['ID'])
   body=parsed(master['InputJSON']);body.pop('Fingerprint',None);body.pop('ReferencePricingMasterID',None)
   body['PackagingTypeID']=self.clone('PackagingType',body['PackagingTypeID'])
   if body.get('DimensionID'):
    body['DimensionID']=self.clone('PackagingDimension',body['DimensionID']);body['DimensionRowVersion']=b64(self.one('PackagingDimension',body['DimensionID'])['RowVersion'])
   for component in body['components']:
    component['PriceID']=self.clone('PackagingPrice',component['PriceID']);component['PriceRowVersion']=b64(self.one('PackagingPrice',component['PriceID'])['RowVersion'])
    if component.get('DimensionID'):
     component['DimensionID']=self.clone('PackagingDimension',component['DimensionID']);component['DimensionRowVersion']=b64(self.one('PackagingDimension',component['DimensionID'])['RowVersion'])
   value=pricing.preview(identity,pricing.Calculation.model_validate(body),self.pic_ctx)['calculation']
   body['Fingerprint']=value['Fingerprint'];calculations.append(body)
   field={'Primary':'FirstPMType','Secondary':'SecondPMType','Tertiary':'ThirdPMType'}[master['PackagingOrder']]
   fields[field]=value['PackagingTypeName']
   self.close(value['UnitPrice'],master['UnitPrice'],'packaging '+str(source['ID'])+' '+master['PackagingOrder'])
  # Save the confirmed layer count before calculating with that response context.
  self.response(identity,**fields,PricingCalculations=calculations)
  if source.get('PalletPricingID'):
   original=self.one('PalletPricingSnapshot',source['PalletPricingID']);snapshot=parsed(original['SnapshotJSON'])
   components=[]
   for comp in snapshot['components']:
    p=self.clone('PackagingPrice',comp['ID']);price=self.one('PackagingPrice',p);material=self.one('PackagingMaterial',price['MaterialID'])
    components.append(dict(PriceID=p,RowVersion=b64(price['RowVersion']),MaterialRowVersion=b64(material['RowVersion']),Quantity=comp['Quantity'],AreaM2=comp.get('AreaM2')))
   row=self.one('PackagingConfigurationRequestItem',identity)
   saved=pallet.save(identity,pallet.Selection(PalletSize=snapshot['PalletSize'],PalletMaterialID=self.clone('PackagingMaterial',snapshot['PalletMaterialID']),components=components,ItemRowVersion=b64(row['RowVersion'])),self.pic_ctx)
   self.track('PalletPricingSnapshot',saved['ID'])
   self.response(identity,PalletPricingID=saved['ID'],ResponsePalletMaterialID=self.clone('PackagingMaterial',snapshot['PalletMaterialID']),ResponsePalletSize=snapshot['PalletSize'])
  if source.get('LoadPlanID'):
   old=self.one('ContainerLoadPlan',source['LoadPlanID']);container=self.one('ContainerTypeMaster',old['ContainerID']);row=self.one('PackagingConfigurationRequestItem',identity)
   body=loading.SavePlan(ContainerID=container['ID'],ContainerRowVersion=b64(container['RowVersion']),Inputs=parsed(old['Inputs']),ItemRowVersion=b64(row['RowVersion']))
   plan=loading.save(identity,body,self.pic_ctx);self.track('ContainerLoadPlan',plan['ID'])
   self.close(plan['Result']['cartons'],parsed(old['Result'])['cartons'],'container cartons '+str(source['ID']))
   self.response(identity,LoadPlanID=plan['ID'])
  current=self.one('PackagingConfigurationRequestItem',identity)
  for key,value in fields.items():self.check(equivalent(current[key],value),'response captured field '+str(source['ID'])+' '+key)
  return identity
 def approve(self,request):
  for r in request['items']:
   if self.one('OpportunityItem',r['OpportunityItemID'])['ParentItemID']:continue
   for stage in ('Pending Review','Approved'):
    row=self.one('PackagingConfigurationRequestItem',r['ID'])
    pkg.transition(row['ID'],pkg.Transition(TargetStage=stage,ExpectedRowVersion=b64(row['RowVersion'])),self.ctx if stage=='Approved' else self.pic_ctx)
  self.check(all(self.one('PackagingConfigurationRequestItem',r['ID'])['Stage']=='Approved' for r in request['items']),'all replicated responses approved')
 def tcb_replay(self,source):
  identity=self.maps[('OpportunityItem',source['ID'])];snapshot=parsed(source['TCBCostInfo'])
  inputs=deepcopy(snapshot['Inputs'])
  for selection in inputs.get('Prices',[]):
   if selection.get('PriceID'):
    selection['PriceID']=self.clone('RawMaterialPrice',selection['PriceID']);price=self.one('RawMaterialPrice',selection['PriceID']);selection['PriceVersion']='0x'+bytes(price['RowVersion']).hex()
  row=tcb.item_read(identity,self.ctx)
  saved=tcb.save(tcb.Save(RowVersion=row['RowVersion'],Inputs=Inputs.model_validate(inputs)),identity,self.ctx)['saved']
  for field in ('RMCostUSDPerLb','ProductUSDPerLb'):self.close(saved[field],snapshot[field],field+' '+str(source['ID']))
  for key,value in snapshot['Inputs'].items():
   expected=inputs.get(key)
   actual=saved['Inputs'].get(key)
   # Compare every captured input; absent new defaults are not historical data.
   self.check(equivalent(actual,expected),'TCB input preserved '+str(source['ID'])+' '+key)
  self.check(len(snapshot.get('ProcessLossSnapshots',[]))==len(saved.get('ProcessLossSnapshots',[])),'all per-grade process loss results retained '+str(source['ID']))
  for old,new in zip(snapshot.get('ProcessLossSnapshots',[]),saved.get('ProcessLossSnapshots',[])):
   self.close(new['LossPct'],old['LossPct'],'per-grade process loss '+str(source['ID'])+' '+old['Path'])
 def compare_grid(self,source,replica):
  original=sorted_grid(self.ctx.username,1,100,'[]',opportunity_number=source)['rows']
  copied=sorted_grid(self.ctx.username,1,100,'[]',opportunity_number=replica)['rows']
  count=0;populated=0
  for old in original:
   new=next(r for r in copied if r['ItemID']==self.maps[('OpportunityItem',old['ItemID'])])
   for key in TCB_COLUMNS:
    a,b=old.get(key),new.get(key)
    same=a==b
    if not same and a is not None and b is not None:
     try:same=abs(Decimal(str(a))-Decimal(str(b)))<=Decimal('0.000001')
     except Exception:pass
    if not same:self.differences.append(dict(case=source,item=old['ItemID'],field=key,original=a,replica=b))
    count+=1;populated+=a is not None
  print('GRID_COMPARISON',document(dict(fields=count,populated=populated,blank=count-populated,differences=self.differences)),flush=True)
  self.check(not self.differences,'10075 all '+str(count)+' TCB Review output cells match')
 def exact_case(self):
  self.source_header=self.rows("SELECT * FROM dbo.Opportunity WHERE OpportunityNumber='OPP-2026-10075'")[0]
  self.one('Opportunity',self.source_header['ID']);source=self.rows('SELECT * FROM dbo.OpportunityItem WHERE OpportunityID=? ORDER BY ID',self.source_header['ID'])
  self.step('10075 duplicate related masters and two captured product grade trees')
  customer=self.customer(self.source_header['CustomerID'])
  for item in source:
   self.one('OpportunityItem',item['ID']);tree=self.tree(parsed(item['ProductGradeSnapshot'])['items'])
   self.product(item['ProductID'],customer,item['ProductNetWeightGrams'],tree)
  responses=self.rows("SELECT r.* FROM dbo.PackagingConfigurationRequestItem r JOIN dbo.PackagingConfigurationRequest q ON q.ID=r.RequestID WHERE q.OpportunityID=? AND r.Stage='Approved' ORDER BY r.ID",self.source_header['ID'])
  for r in responses:
   self.one('PackagingConfigurationRequestItem',r['ID'])
   for k in ('PrimaryTypeID','SecondaryTypeID','TertiaryTypeID'):
    if r.get(k):self.clone('PackagingType',r[k])
  self.step('10075 create Opportunity through normal batch')
  identity,number,items=self.opportunity(self.source_header,source,customer)
  self.step('10075 create Packaging Request, assign PIC and start Working')
  request=self.workflow(identity,items)
  for r in responses:
   self.step('10075 replay calculators, pallet and load plan for response '+str(r['ID']))
   self.replay_response(r)
  self.approve(request)
  self.step('10075 save and compare TCB costs')
  for i in source:self.tcb_replay(i)
  self.compare_grid(self.source_header['OpportunityNumber'],number)
  return number
 def controlled_case(self):
  self.source_header=self.rows("SELECT * FROM dbo.Opportunity WHERE OpportunityNumber='OPP-2026-10094'")[0]
  self.one('Opportunity',self.source_header['ID'])
  source=self.rows('SELECT * FROM dbo.OpportunityItem WHERE OpportunityID=? ORDER BY ID',self.source_header['ID'])
  for row in source:self.one('OpportunityItem',row['ID'])
  root=next(r for r in source if not r['ParentItemID']);children=[r for r in source if r['ParentItemID']]
  self.check(len(children)==3,'10094 reference has one Mix parent and three children')
  self.step('10094 create controlled raw masters, recipes and unequal 2:1:3 mix')
  customer=self.customer(self.source_header['CustomerID'])
  usd=self.cur.execute("SELECT ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval()
  quantities=[2,1,3];raw_prices=[1,2,3];sorting=[10,20,0];child_products=[]
  for index,old in enumerate(children):
   grade=self.master('grade',raw.RawGradeBatch,raw.grade_save,dict(GradeName=self.tag+' Control '+str(index),FinalGrade=True,Status='Active'),'RawGrade')
   material=self.master('raw',raw.RawMaterialBatch,raw.material_save,dict(MaterialName=self.tag+' Control raw '+str(index),UnitOfMeasure='lbs',GradeID=grade,Status='Active'),'RawMaterial')
   price=self.master('price',raw.PriceBatch,raw.price_save,dict(MaterialID=material,CurrencyID=usd,PriceBasis='lbs',QuantityFrom=0,UnitPrice=raw_prices[index],ExchangeRateToUSD=1,EffectiveFrom='2026-10-20',Status='Active'),'RawMaterialPrice')
   tree=[dict(ParentID='0',ID=1,Process=True,RawGradeID=grade,RawMaterialID=material,Grade=self.tag+' Control '+str(index),RatioPct=100)]
   child_products.append((self.product(old['ProductID'],customer,old['ProductNetWeightGrams'],tree),price))
  mix=[dict(ProductID=p,UnitQuantity=q,RowVersion=b64(self.one('Product',p)['RowVersion'])) for (p,_),q in zip(child_products,quantities)]
  parent=self.product(root['ProductID'],customer,0,mix=mix)
  self.close(self.one('Product',parent)['WeightGrams'],sum(Decimal(str(c['ProductNetWeightGrams']))*q for c,q in zip(children,quantities)),'10094 Mix weight is quantity-weighted')
  self.step('10094 create independent child and Mix packaging masters')
  dim_seed=self.one('PackagingDimension',1609047)
  dimension_map={};type_ids={}
  for order,shipping in [('Primary',False),('Secondary',True)]:
   kind=self.master('type',types.PackagingTypeBatch,types.packaging_type_save,dict(PackagingType=self.tag+' Control '+order,PackagingOrders=[order,order+' Mix'],FinalComponent=True,CopyDim=True,Shipping=shipping,PriceBasis='Count',Status='Active'),'PackagingType')
   definition=dict(PackagingTypeID=kind,D1='Length',D2='Width',D3='Height',D1UoMID=dim_seed['D1UoMID'],D2UoMID=dim_seed['D2UoMID'],D3UoMID=dim_seed['D3UoMID'],Status='Active')
   if shipping:definition.update(OccupiedM2Formula='D1*D2/1000000',OccupiedM3Formula='D1*D2*D3/1000000000')
   dimension_map[order]=self.ok(dims.save(dims.DimensionSave(**definition),self.ctx),'PackagingDimension');type_ids[order]=kind
  config={}
  for owner,order,price,measure,tare in [('child','Primary','.1',(200,150,70),'.01'),('child','Secondary','1',(600,450,220),'.2'),('parent','Primary','.6',(400,300,250),'.05'),('parent','Secondary','1.2',(850,650,550),'.4')]:
   dimension=dimension_map[order]
   material=self.master('material',pkg.MaterialBatch,pkg.material_save,dict(MaterialName=self.tag+' '+owner+' '+order,UnitOfMeasure='EA',PackagingTypeID=type_ids[order],MaterialDimensionID=dimension,MaterialDimensionRowVersion=b64(self.one('PackagingDimension',dimension)['RowVersion']),MaterialD1=measure[0],MaterialD2=measure[1],MaterialD3=measure[2],TareWeight=tare,TareWeightBasis='kg/EA',Status='Active'),'PackagingMaterial')
   price_id=self.master('price',pkg.PackagingPriceBatch,pkg.price_save,dict(MaterialID=material,CurrencyID=usd,PriceBasis='EA',QuantityFrom=0,UnitPrice=price,ExchangeRateToUSD=1,EffectiveFrom='2026-10-20',Status='Active'),'PackagingPrice')
   config[(owner,order)]=price_id
  controlled=deepcopy(root)
  controlled.update(AnnualUnit=Decimal(1000),EstPctAwarded=Decimal(50),ShelfPrice=10,ContainerRequest='20DC',ConfigurationRequest='Pallet load',PackagingLayerCount=2,PrimaryTypeID=type_ids['Primary'],SecondaryTypeID=type_ids['Secondary'],NumberOfPrimary=4)
  controlled['MixVersionID']=self.cur.execute("SELECT ID FROM dbo.ProductMixVersion WHERE ProductID=? AND Status='Active'",parent).fetchval()
  controlled['ShipmentCostInfo']=dict(Incoterm='DDP',ContainerSizeFT='20FT',FreightUSDPerContainer='1200',DutyPct='5',ImportClearanceUSDPerContainer='60',PortToWHUSDPerContainer='40',WHCostUSDPerPallet='10',OverageShortageDamagePct='1',WHToCoManWHUSDPerPallet='5',CoManOverheadUSDPerPallet='6',FreightToCustomerUSDPerPallet='7',SpoilageAllowancePct='1',PaymentTermPct='2',CoManFeePct='3',BrokerFeePct='1',FobbingUSDPerContainer='1200',PaymentTermDays=30)
  self.step('10094 create Mix Opportunity and child-specific Others Info')
  identity,number,roots=self.opportunity(self.source_header,[controlled],customer)
  parent_item=roots[0];copied_children=self.rows('SELECT * FROM dbo.OpportunityItem WHERE ParentItemID=? ORDER BY MixChildNumber',parent_item)
  for i,(old,(product,_),q) in enumerate(zip(children,child_products,quantities)):
   item=next(r for r in copied_children if r['ProductID']==product)
   self.track('OpportunityItem',item['ID']);self.maps[('OpportunityItem',old['ID'])]=item['ID']
   self.close(item['AnnualUnit'],1000*q,'10094 child annual quantity '+str(i))
   info=dict(PackingUSDPerLb=str(Decimal('.2')+Decimal('.1')*i),InitialDesignUSD=str(100*(i+1)),OtherFixedCostsUSD=str(50*(i+1)),InterestPct='12',InterestDays=30,MarginMode='Percent',MarginPct='10')
   body=OpportunityBatchRequest(header_rows=[],item_rows=[dict(RowNum=1,Command='U',ID=item['ID'],RowVersion=b64(item['RowVersion']),OpportunityNumber=number,ShipmentCostInfo=info,PackagingLayerCount=2,PrimaryTypeID=type_ids['Primary'],SecondaryTypeID=type_ids['Secondary'],NumberOfPrimary=10)])
   result=main.opportunity_batch(body,self.ctx.username,True,self.ctx.scopes)
   self.check(result['item_results'][0]['Status']=='OK','10094 child-only Others Info saved '+str(i))
  all_items=[parent_item,*[self.maps[('OpportunityItem',c['ID'])] for c in children]]
  self.step('10094 request complete family, assign PIC, price all four responses')
  request=self.workflow(identity,all_items)
  for item in all_items:
   response_id=self.maps[('ResponseFor',item)];owner='parent' if item==parent_item else 'child';calculations=[]
   for order in ('Primary','Secondary'):
    p=self.one('PackagingPrice',config[(owner,order)])
    body=dict(PackagingOrder=order,LayerCount=2,PackagingTypeID=type_ids[order],components=[dict(PriceID=p['ID'],PriceRowVersion=b64(p['RowVersion']),Quantity=1)])
    value=pricing.preview(response_id,pricing.Calculation(**body),self.pic_ctx)['calculation'];body['Fingerprint']=value['Fingerprint'];calculations.append(body)
   shipping=dict(CartonsPerLayer=1,ResponsePalletSize='1000x1200mm',ResponsePalletStacking='Single',ResponseMaxPalletHeightMM=1500,SelectedContainerType='20DC') if owner=='parent' else {}
   self.response(response_id,ResponseLayerCount=2,FirstPMType=self.one('PackagingType',type_ids['Primary'])['PackagingType'],SecondPMType=self.one('PackagingType',type_ids['Secondary'])['PackagingType'],UnitsPerCarton=4 if owner=='parent' else 10,PricingCalculations=calculations,**shipping)
  response_id=self.maps[('ResponseFor',parent_item)]
  price=self.one('PackagingPrice',self.clone('PackagingPrice',15987));material=self.one('PackagingMaterial',price['MaterialID'])
  snapshot=pallet.save(response_id,pallet.Selection(PalletSize='1000x1200mm',PalletMaterialID=material['ID'],ItemRowVersion=b64(self.one('PackagingConfigurationRequestItem',response_id)['RowVersion']),components=[dict(PriceID=price['ID'],RowVersion=b64(price['RowVersion']),MaterialRowVersion=b64(material['RowVersion']),Quantity=1,AreaM2='1.2')]),self.pic_ctx)
  self.track('PalletPricingSnapshot',snapshot['ID']);self.response(response_id,PalletPricingID=snapshot['ID'],ResponsePalletMaterialID=material['ID'])
  container=self.rows("SELECT * FROM dbo.ContainerTypeMaster WHERE Code='20DC' AND Status='Active'")[0]
  plan=loading.save(response_id,loading.SavePlan(ContainerID=container['ID'],ContainerRowVersion=b64(container['RowVersion']),ItemRowVersion=b64(self.one('PackagingConfigurationRequestItem',response_id)['RowVersion']),Inputs=dict(mode='pallet',container={k:parsed(container['Specifications'])[k] for k in ('length','width','height')},carton=dict(length=850,width=650,height=550),carton_kg=1,pallet=dict(length=1000,width=1200,height=150),pallet_kg=15,max_pallet_height=1500)),self.pic_ctx)
  self.track('ContainerLoadPlan',plan['ID']);self.response(response_id,LoadPlanID=plan['ID'])
  self.close(plan['Result']['pallet_layers'],2,'10094 independent pallet height/layer count')
  self.close(plan['Result']['cartons_per_pallet'],2,'10094 independent cartons per pallet')
  self.geometry_oracle(plan['Result'],parsed(container['Specifications']))
  loaded=Decimal(plan['Result']['loaded_units']);cartons=Decimal(plan['Result']['cartons'])
  self.close(plan['Result']['net_kg'],Decimal('2381.34')*4*cartons/1000,'10094 independent container net weight')
  # Six child units per Mix, each with .01 kg bag + .2/10 kg carton share.
  gross_per_mix=Decimal('2.38134')+6*(Decimal('.01')+Decimal('.2')/10)+Decimal('.05')
  gross_per_carton=gross_per_mix*4+Decimal('.4')
  self.close(plan['Result']['gross_kg'],(gross_per_carton*2+15)*loaded,'10094 independent container gross weight including nested child packaging')
  self.approve(request)
  self.step('10094 save independent Process Loss and Level 1 recipes')
  raw_expected=[];product_expected=[]
  loss_codes={}
  for name in ('Sorting','Packing'):
   master=self.rows('SELECT * FROM dbo.LossProcessMaster WHERE ProcessType=? AND Status=\'Active\'',name)[0]
   self.one('LossProcessMaster',master['ID'])
   loss_codes[name]=dict(MasterID=master['ID'],MasterVersion='0x'+bytes(master['RowVersion']).hex(),ProcessName=name,Shared=bool(master['Shared']))
  for index,old in enumerate(children):
   item=self.maps[('OpportunityItem',old['ID'])];price=self.one('RawMaterialPrice',child_products[index][1]);row=tcb.item_read(item,self.ctx)
   values=dict(Prices=[dict(Path='0/1',PriceID=price['ID'],PriceVersion='0x'+bytes(price['RowVersion']).hex())],ProcessLossMode='GradePath',ProcessLossLayout='Aligned',ProcessLosses=[dict(Path='0/1',Ratios=[sorting[index]],Formula=''),dict(Path='0',Ratios=[1],Formula='')],ProcessLossFormulas={'0/1':'1-(1-L1)*(1-L2)'},MaterialCosts=[dict(Path='0/1',RMRatio=90,SeasoningRatio=5,SeasoningUSDPerLb='.2',OilPct=5,OilUSDPerLb='.3',ProcessingUSDPerLb='.1')],PrimaryLossPct=1,SecondaryLossPct=2)
   values['ProcessLosses'][0]['Codes']=[loss_codes['Sorting']];values['ProcessLosses'][1]['Codes']=[loss_codes['Packing']]
   result=tcb.save(tcb.Save(RowVersion=row['RowVersion'],Inputs=Inputs.model_validate(values)),item,self.ctx)['saved']
   rm=Decimal(raw_prices[index])/((1-Decimal(sorting[index])/100)*Decimal('.99'));product=rm*Decimal('.9')+Decimal('.125');raw_expected.append(rm);product_expected.append(product)
   self.close(result['RMCostUSDPerLb'],rm,'10094 independently calculated RM child '+str(index))
   self.close(result['ProductUSDPerLb'],product,'10094 independently calculated recipe child '+str(index))
  row=tcb.item_read(parent_item,self.ctx)
  tcb.save(tcb.Save(RowVersion=row['RowVersion'],Inputs=Inputs(MixPrimaryLossPct=2,MixSecondaryLossPct=1)),parent_item,self.ctx)
  rows=sorted_grid(self.ctx.username,1,100,'[]',opportunity_number=number)['rows'];parent_row=next(r for r in rows if r['ItemID']==parent_item)
  print('CONTROLLED_COUNTS',document({k:parent_row.get(k) for k in ('UnitsPerPallet','CalculatedCartonsPerContainer','ContainerLoadResults','ConfigurationRequest')}),flush=True)
  self.controlled_oracle(rows,parent_item,children,quantities,product_expected,plan['Result'])
  return number
 def geometry_oracle(self,result,container):
  for label,boxes,width,length in [('pallet',result['pallet_layer'],Decimal(1200),Decimal(1000)),('container',result['container_layer'],Decimal(str(container['width'])),Decimal(str(container['length'])))]:
   rects=[]
   for box in boxes:
    x,y,l,w=[Decimal(str(box[k])) for k in ('x','y','length','width')]
    self.check(x>=0 and y>=0 and x+l<=length and y+w<=width,'10094 '+label+' rectangle within bounds')
    for a,b,c,d in rects:self.check(x+l<=a or a+c<=x or y+w<=b or b+d<=y,'10094 '+label+' rectangles do not overlap')
    rects.append((x,y,l,w))
  self.close(result['cartons'],Decimal(result['loaded_units'])*Decimal(result['cartons_per_pallet']),'10094 container carton multiplication')
 def controlled_oracle(self,rows,parent_item,children,quantities,products,plan):
  # Independent Decimal arithmetic: does not call tcb-analysis costing helpers.
  total=Decimal(sum(quantities));cartons=Decimal(plan['cartons']);container_units=cartons*4*total;pallet_units=Decimal(2)*4*total
  parent_pm=(Decimal('.6')/Decimal('.98')+Decimal('1.2')/4/Decimal('.99'))/total
  self.step('10094 compare all child TCB cells with independent Decimal oracle')
  for index,old in enumerate(children):
   row=next(r for r in rows if r['ItemID']==self.maps[('OpportunityItem',old['ID'])]);weight=Decimal(str(old['ProductNetWeightGrams']))/Decimal('453.59237');q=Decimal(quantities[index])
   values=dict(TCBProductPerUnit=products[index]*weight,TCBSelfPackagingPerUnit=Decimal('.1')/Decimal('.99')+Decimal(1)/10/Decimal('.98'),TCBParentPackagingPerUnit=parent_pm,TCBPalletPerUnit=Decimal(15)/pallet_units,TCBPackingPerUnit=(Decimal('.2')+Decimal('.1')*index)*weight,TCBInitialDesignPerUnit=Decimal(100*(index+1))/(500*q),TCBFixedCostsPerUnit=Decimal(50*(index+1))/(500*q),TCBFobbingPerUnit=Decimal(1200)/container_units)
   values['TCBInterestPerUnit']=sum(values.values())*Decimal('.12')*30/360
   values['TCBMarginPerUnit']=sum(values.values())*Decimal('.1')
   fob=sum(values.values());values.update(TCBFOBPerUnit=fob,TCBFOBCustomerPerUnit=fob)
   destination=dict(TCBFreightPerUnit=Decimal(1200)/container_units,TCBDutyPerUnit=(fob+Decimal(1200)/container_units)*Decimal('.05'),TCBClearancePerUnit=Decimal(60)/container_units,TCBHaulagePerUnit=Decimal(40)/container_units,TCBDestinationWHPerUnit=Decimal(10)/pallet_units)
   destination['TCBDamagePerUnit']=(fob+sum(destination.values()))*Decimal('.01')
   destination.update(TCBWHToCoManPerUnit=Decimal(5)/pallet_units,TCBCoManOverheadPerUnit=Decimal(6)/pallet_units,TCBFreightToCustomerPerUnit=Decimal(7)/pallet_units)
   base=fob+sum(destination.values());ddp=base/Decimal('.93')
   values.update(destination,TCBSpoilagePerUnit=ddp*Decimal('.01'),TCBPaymentTermPerUnit=ddp*Decimal('.02'),TCBCoManFeePerUnit=ddp*Decimal('.03'),TCBBrokerFeePerUnit=ddp*Decimal('.01'),TCBCFRPerUnit=fob+destination['TCBFreightPerUnit'],TCBDDPPerUnit=ddp,TCBDDPCustomerPerUnit=ddp)
   self.check(set(values)==TCB_COLUMNS,'10094 oracle covers every TCB column child '+str(index))
   for key,expected in values.items():self.close(row.get(key),expected,'10094 child '+str(index)+' '+key)
   print('CONTROLLED_TCB',document(dict(child=index+1,quantity=quantities[index],ProductUSDPerLb=str(products[index]),FOB=str(values['TCBFOBPerUnit']),DDP=str(values['TCBDDPPerUnit']))),flush=True)
 def run(self):
  assert db.DB_NAME=='test' and db.DB_SERVER.lower() in ('desktop-5bgmjsc','localhost','.'),'Desktop test database only'
  with db.get_raw_cursor() as self.cur:
   self.cur.execute('SET NOCOUNT ON; SET QUOTED_IDENTIFIER ON; BEGIN TRANSACTION')
   actor,name=self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE a.Scope='Admin' AND u.IsActive=1 ORDER BY u.ID").fetchone()
   self.ctx=AccessContext(actor,name,frozenset({'Admin'}))
   try:
    with db.reuse_transaction(self.cur.connection):
     self.exact_case()
     self.controlled_case()
   finally:
    self.cur.execute('IF @@TRANCOUNT>0 ROLLBACK TRANSACTION')
    remaining=[(t,i) for t,ids in self.manifest.items() for i in ids if self.cur.execute('SELECT 1 FROM dbo.['+t+'] WHERE ID=?',i).fetchone()]
    self.check(not remaining,'cleanup: no replicated master or transaction IDs remain')
    changed=[]
    for (table,identity),before in self.originals.items():
     rows=self.rows('SELECT * FROM dbo.['+table+'] WHERE ID=?',identity)
     if not rows or hashlib.sha256(document(rows[0]).encode()).hexdigest()!=before:changed.append((table,identity))
    self.check(not changed,'original referenced rows are byte-for-byte unchanged')
    print('AUDIT_SUMMARY',document(dict(tag=self.tag,steps=self.steps,checks=len(self.checks),replicas={k:len(v) for k,v in self.manifest.items()},cleanup=not remaining,originalsUnchanged=not changed)),flush=True)

if __name__=='__main__':Audit().run()
