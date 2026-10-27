"""Current-schema, rollback-only four-layer workflow (never replays old migrations)."""
from opportunity_replica_audit import *
from packaging_weight import response_weights
from pallet_capacity_api import Preview as CapacityPreview,preview as capacity_preview
from tcb_analysis_columns import packaging as packaging_cost

class FourLayerAudit(Audit):
 def exact_case(self):
  self.source_header=self.rows("SELECT * FROM dbo.Opportunity WHERE OpportunityNumber='OPP-2026-10075'")[0]
  self.one('Opportunity',self.source_header['ID'])
  source=self.rows('SELECT TOP(1) * FROM dbo.OpportunityItem WHERE OpportunityID=? ORDER BY ID',self.source_header['ID'])[0]
  self.one('OpportunityItem',source['ID'])
  customer=self.customer(self.source_header['CustomerID'])
  self.product(source['ProductID'],customer,source['ProductNetWeightGrams'],self.tree(parsed(source['ProductGradeSnapshot'])['items']))
  usd=self.cur.execute("SELECT ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval()
  seed=self.one('PackagingDimension',1609047);config={}
  for index,order in enumerate(('Primary','Secondary','Tertiary','Quaternary'),1):
   kind=self.master('type',types.PackagingTypeBatch,types.packaging_type_save,dict(PackagingType=self.tag+' '+order,PackagingOrders=[order],FinalComponent=True,Shipping=index==4,CopyDim=True,PriceBasis='Count',Status='Active'),'PackagingType')
   dimension=self.ok(dims.save(dims.DimensionSave(PackagingTypeID=kind,D1='Length',D2='Width',D3='Height',D1UoMID=seed['D1UoMID'],D2UoMID=seed['D2UoMID'],D3UoMID=seed['D3UoMID'],OccupiedM2Formula='D1*D2/1000000' if index==4 else None,OccupiedM3Formula='D1*D2*D3/1000000000' if index==4 else None,Status='Active'),self.ctx),'PackagingDimension')
   material=self.master('material',pkg.MaterialBatch,pkg.material_save,dict(MaterialName=self.tag+' '+order,PackagingTypeID=kind,UnitOfMeasure='EA',MaterialDimensionID=dimension,MaterialDimensionRowVersion=b64(self.one('PackagingDimension',dimension)['RowVersion']),MaterialD1=200*index,MaterialD2=125*index,MaterialD3=250,TareWeight=Decimal(index)/10,TareWeightBasis='kg/EA',Status='Active'),'PackagingMaterial')
   price=self.master('price',pkg.PackagingPriceBatch,pkg.price_save,dict(MaterialID=material,CurrencyID=usd,PriceBasis='EA',QuantityFrom=0,UnitPrice=index,ExchangeRateToUSD=1,EffectiveFrom='2026-10-20',Status='Active'),'PackagingPrice')
   config[order]=(kind,price)
  controlled=deepcopy(source)
  controlled.update(PackagingLayerCount=4,PrimaryTypeID=config['Primary'][0],SecondaryTypeID=config['Secondary'][0],TertiaryTypeID=config['Tertiary'][0],QuaternaryTypeID=config['Quaternary'][0],NumberOfPrimary=2,NumberOfSecondary=3,NumberOfTertiary=4)
  self.step('four layers: create Opportunity and frozen Packaging Request')
  opportunity,number,items=self.opportunity(self.source_header,[controlled],customer)
  request=self.workflow(opportunity,items);item=items[0];response_id=self.maps[('ResponseFor',item)]
  row=self.one('PackagingConfigurationRequestItem',response_id)
  self.check(row['RequestedLayerCount']==4 and row['ResponseLayerCount']==4,'four-layer requested/response counts copied')
  self.check(row['FourthPMType']==self.one('PackagingType',config['Quaternary'][0])['PackagingType'] and row['UnitsPerQuaternary']==4,'fourth type and quantity default captured')
  self.check(row['QuaternaryTypeID']==config['Quaternary'][0],'fourth requirement type captured')
  calculations=[]
  for order,(_,price_id) in config.items():
   p=self.one('PackagingPrice',price_id)
   body=dict(PackagingOrder=order,LayerCount=4,PackagingTypeID=config[order][0],components=[dict(PriceID=p['ID'],PriceRowVersion=b64(p['RowVersion']),Quantity=1)])
   result=pricing.preview(response_id,pricing.Calculation(**body),self.pic_ctx)['calculation']
   body['Fingerprint']=result['Fingerprint'];calculations.append(body)
   self.close(result['UnitPrice'],list(config).index(order)+1,'four-layer price '+order)
  self.step('four layers: save calculators, verify compounded units, net and gross')
  self.response(response_id,ResponseLayerCount=4,FirstPMType=self.one('PackagingType',config['Primary'][0])['PackagingType'],SecondPMType=self.one('PackagingType',config['Secondary'][0])['PackagingType'],ThirdPMType=self.one('PackagingType',config['Tertiary'][0])['PackagingType'],FourthPMType=self.one('PackagingType',config['Quaternary'][0])['PackagingType'],UnitsPerCarton=2,UnitsPerTertiary=3,UnitsPerQuaternary=4,PricingCalculations=calculations)
  weights=response_weights(self.cur,response_id);grams=Decimal(source['ProductNetWeightGrams'])
  self.close(weights['QuaternaryNetWeightGrams'],grams*24,'four-layer final net weight')
  gross=(((grams/1000+Decimal('.1'))*2+Decimal('.2'))*3+Decimal('.3'))*4+Decimal('.4')
  self.close(weights['CartonGrossWeightKG'],gross,'four-layer final gross includes all four tares')
  self.check(self.cur.execute("SELECT COUNT(*) FROM dbo.PkgPricingMaster WHERE RequestItemID=? AND IsCurrent=1",response_id).fetchval()==4,'all four current pricing captures saved')
  import inline_master_api as inline
  price_id=config['Quaternary'][1];context=inline.read('prices',str(price_id),self.ctx)
  self.check(context['editable'] and 'MaterialID' in context['lockedFields'],'Packaging Pricing shortcut uses normal edit and locks linked material')
  current=context['row']
  edited=inline.save('prices',str(price_id),inline.InlineSave(payload={'rows':[dict(RowNum=1,Command='U',ID=price_id,RowVersion=current['RowVersion'],MaterialID=current['MaterialID'],CurrencyID=usd,PriceBasis='EA',QuantityFrom=0,UnitPrice=5,ExchangeRateToUSD=1,EffectiveFrom='2026-10-20',Status='Active')]}),self.ctx)
  self.close(edited['row']['UnitPrice'],5,'Packaging Pricing edited through the shortcut')
  pallet_price=self.one('PackagingPrice',self.clone('PackagingPrice',15987));pallet_material=self.one('PackagingMaterial',pallet_price['MaterialID'])
  snapshot=pallet.save(response_id,pallet.Selection(PalletSize='1000x1200mm',PalletMaterialID=pallet_material['ID'],ItemRowVersion=b64(self.one('PackagingConfigurationRequestItem',response_id)['RowVersion']),components=[dict(PriceID=pallet_price['ID'],RowVersion=b64(pallet_price['RowVersion']),MaterialRowVersion=b64(pallet_material['RowVersion']),Quantity=1,AreaM2='1.2')]),self.pic_ctx)
  self.track('PalletPricingSnapshot',snapshot['ID'])
  self.response(response_id,PalletPricingID=snapshot['ID'],ResponsePalletMaterialID=pallet_material['ID'],ResponsePalletSize='1000x1200mm',ResponseMaxPalletHeightMM=1500,CartonsPerLayer=2,LayersPerPallet=1)
  partial=self.response(response_id,NutDensity='.5')
  self.close(partial['LayersPerPallet'],1,'manual Layers/pallet survives unrelated partial response save')
  self.approve(request)
  row=sorted_grid(self.ctx.username,1,100,'[]',opportunity_number=number)['rows'][0]
  self.close(row['QuaternaryPricePerUnit'],4,'fourth price visible in Opportunity/TCB read model')
  cost=packaging_cost(row,row)
  self.close(Decimal(cost.numerator)/cost.denominator,Decimal(1)+Decimal(2)/2+Decimal(3)/6+Decimal(4)/24,'TCB packaging normalizes all four layers')
  # Read-only rejection keeps the outer audit transaction intact.
  try:pricing.options(response_id,config['Quaternary'][0],'Primary',self.ctx)
  except Exception as exc:self.check(getattr(exc,'status_code',None)==422,'wrong global membership rejected')
  else:raise AssertionError('Wrong layer membership accepted')
 def controlled_case(self):
  self.step('pallet rating: payload-limited preview prioritizes horizontal utilization')
  material=self.rows("SELECT m.ID,m.MaxPayloadKG FROM dbo.PackagingMaterial m WHERE m.MaterialCode='PKG-0000000424'")[0]
  identity=next(iter(self.manifest['PackagingConfigurationRequestItem']))
  result=capacity_preview(identity,CapacityPreview(PalletMaterialID=material['ID'],Carton=dict(length=600,width=500,height=250),CartonGrossKG=100,TareKG=15,MaxPalletHeightMM=6000),self.ctx)
  self.check(Decimal(str(result['gross_kg']))<=1200,'pallet gross respects maintained 1200 kg')
  self.check(result['cartons_per_layer']==4 and result['pallet_layers']==2,'payload limit retains four cartons per layer before reducing layers')

if __name__=='__main__':FourLayerAudit().run()
