"""Exact tare examples and rollback-only material/pricing persistence."""
import unittest
from decimal import Decimal as D
from fastapi import HTTPException
from packaging_weight import material_tare,layer_tare,response_weights
from packing_way import packing_way
from db import bytes_to_b64
import load_planning_sql_contract as loading
import packaging_field_foundation_contract as foundation

class WeightMath(unittest.TestCase):
    def test_film_carton_pallet_container(self):
        area=(D(50)*2+15)*100/D(1000000)
        pillow=material_tare(1,'kg/m2',1,area)
        self.assertEqual(pillow,D('.0115'))
        tares={'Primary':layer_tare([dict(TareWeightKG=pillow)]),'Secondary':layer_tare([dict(TareWeightKG=3)]),'Tertiary':layer_tare([dict(TareWeightKG='.2')])}
        row=dict(WeightGrams=100,ResponseLayerCount=3,UnitsPerCarton=10,UnitsPerTertiary=2,LayerTareJSON=tares,ConfigurationRequest='Floor load',CartonsPerContainer=100)
        result=packing_way(row)
        self.assertEqual(D(result['SecondaryGrossWeightKG']),D('4.115'))
        self.assertEqual(D(result['TertiaryGrossWeightKG']),D('8.430'))
        self.assertEqual(D(result['GrossWeightPerContainerKG']),D('843.0'))
        row['LoadPlanJSON']=dict(Inputs=dict(mode='pallet',carton_kg='8.430',pallet_kg='25'),Result=dict(cartons_per_pallet=40,pallet_layers=5,cartons=440,gross_kg='3984.2'))
        result=packing_way(row)
        self.assertEqual(D(result['GrossWeightPerPalletKG']),D('362.2'))
        self.assertEqual(D(result['GrossWeightPerContainerKG']),D('3984.2'))

    def test_historical_parent_without_mix_snapshot(self):
        row=dict(IsMixParent=True,WeightGrams='1190.67',ResponseLayerCount=2,UnitsPerCarton=10,LayerTareJSON={'Primary':{'KG':'5'},'Secondary':{'KG':'5.1'}})
        result=packing_way(row)
        self.assertEqual(D(result['PrimaryNetWeightGrams']),D('1190.67'))
        self.assertIsNone(result['SecondaryGrossWeightKG'])
        row['MixResponseChildren']=[dict(ProductID=1,UnitQuantity=1,CartonGrossWeightKG='1.19067')]
        self.assertEqual(D(packing_way(row)['SecondaryGrossWeightKG']),D('67.0067'))

    def test_parent_gross_contains_all_child_gross_and_own_tare(self):
        row=dict(IsMixParent=True,WeightGrams=750,ResponseLayerCount=1,LayerTareJSON={'Primary':{'KG':'5'}},
            ProductMixSnapshot={'items':[{'ProductID':1,'UnitQuantity':1,'WeightGrams':150},{'ProductID':2,'UnitQuantity':1,'WeightGrams':600}]},
            MixResponseChildren=[{'ProductID':1,'CartonGrossWeightKG':'16.518'},{'ProductID':2,'CartonGrossWeightKG':'14.259'}])
        result=packing_way(row)
        self.assertEqual(D(result['PrimaryGrossWeightKG']),D('35.777'))

    def test_mix_raw_child_response_counts_and_missing_tare(self):
        row=dict(IsMixParent=True,ResponseLayerCount=1,WeightGrams=200,LayerTareJSON={'Primary':{'KG':'3'}},
            ProductMixSnapshot={'items':[{'ProductID':1,'UnitQuantity':2,'WeightGrams':100}]},
            MixResponseChildren=[dict(ProductID=1,ApplicableNetWeightGrams=100,ResponseLayerCount=1,LayerTareJSON={'Primary':{'KG':'6'}})])
        self.assertEqual(D(packing_way(row)['PrimaryGrossWeightKG']),D('15.2'))
        row['MixResponseChildren'][0]['LayerTareJSON']={}
        self.assertIsNone(packing_way(row)['PrimaryGrossWeightKG'])

    def test_missing_and_zero(self):
        self.assertIsNone(material_tare(None,'kg/EA',1))
        self.assertIsNone(material_tare(1,'kg/m2',1))
        self.assertEqual(material_tare(0,'kg/EA',2),0)
        row=dict(WeightGrams=100,ResponseLayerCount=2,UnitsPerCarton=10,LayerTareJSON={'Secondary':{'KG':'3'}})
        self.assertIsNone(packing_way(row)['SecondaryGrossWeightKG'])
        row['LayerTareJSON']['Primary']={'KG':'0'}
        self.assertEqual(D(packing_way(row)['SecondaryGrossWeightKG']),4)

class WeightSQL(unittest.TestCase):
    cleanup=foundation.PackagingFoundation.cleanup
    request=foundation.PackagingFoundation.request
    def setUp(self):
        loading.LoadPlanningSQL.setUp(self)
        self.cur.execute((foundation.ROOT/'sql/112_material_tare_weight.sql').read_text())
        while self.cur.nextset():pass
        self.type=self.cur.execute("INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,FinalComponent,CreatedBy) VALUES('Primary','Tare test','Count',0,1,?); SELECT CONVERT(INT,SCOPE_IDENTITY())",self.actor).fetchval()

    def material(self,**changes):
        import packaging_api as api
        row=dict(RowNum=1,Command='C',MaterialName='Tare test',UnitOfMeasure='EA',PackagingTypeID=self.type,TareWeight='3',TareWeightBasis='kg/EA')
        row.update(changes)
        return api.material_save(api.MaterialBatch(rows=[row]),self.ctx)['results'][0]

    def test_master_persistence_clear_conflict_and_pair(self):
        import packaging_api as api
        saved=self.material()
        self.assertEqual(saved['Status'],'OK')
        current=self.cur.execute('SELECT TareWeight,TareWeightBasis,RowVersion FROM dbo.PackagingMaterial WHERE ID=?',saved['NewID']).fetchone()
        self.assertEqual(current[0],3)
        self.assertEqual(bytes_to_b64(current[2]),saved['NewRowVersion'])
        update=dict(RowNum=1,Command='U',ID=saved['NewID'],RowVersion=saved['NewRowVersion'],MaterialName='Tare test',UnitOfMeasure='EA',TareWeight=None,TareWeightBasis=None)
        cleared=api.material_save(api.MaterialBatch(rows=[update]),self.ctx)['results'][0]
        self.assertEqual(cleared['Status'],'OK')
        self.assertIsNone(self.cur.execute('SELECT TareWeight FROM dbo.PackagingMaterial WHERE ID=?',saved['NewID']).fetchval())
        self.assertEqual(api.material_save(api.MaterialBatch(rows=[update]),self.ctx)['results'][0]['Status'],'ERROR')
        with self.assertRaises(HTTPException):self.material(TareWeightBasis=None)

    def test_saved_pricing_rollup_and_master_changes(self):
        import pkg_pricing_api as pricing
        import packaging_api as api
        from pkg_pricing import Calculation
        saved=self.material()
        currency=self.cur.execute("SELECT TOP(1) ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval()
        price=self.cur.execute("INSERT dbo.PackagingPrice(MaterialID,CurrencyID,PriceBasis,QuantityFrom,UnitPrice,EffectiveFrom,CreatedBy) VALUES(?,?,'EA',1,10,'2020-01-01',?); SELECT CONVERT(INT,SCOPE_IDENTITY())",saved['NewID'],currency,self.actor).fetchval()
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET WeightGrams=100,ResponseLayerCount=1,FirstPMType=?,ConfigurationRequest='Floor load' WHERE ID=?",'Tare test',self.req)
        version=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval())
        payload=Calculation(PackagingOrder='Primary',LayerCount=1,PackagingTypeID=self.type,components=[dict(PriceID=price,PriceRowVersion=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingPrice WHERE ID=?',price).fetchval()),Quantity=2)])
        result=pricing.calculate(self.cur,self.ctx,self.req,payload)
        self.assertEqual(D(result['Tare']['KG']),6)
        payload.Fingerprint=result['Fingerprint']
        api.response_save(api.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,RowVersion=version,FirstPMType='Tare test',FirstPMMOQ=result['FinalMOQ'],CartonsPerContainer=100,PricingCalculations=[payload])]),self.ctx)
        self.assertEqual(D(response_weights(self.cur,self.req)['CartonGrossWeightKG']),D('6.1'))
        self.cur.execute('UPDATE dbo.PackagingConfigurationRequestItem SET ResponseLayerCount=2,UnitsPerCarton=10 WHERE ID=?',self.req)
        self.assertEqual(D(response_weights(self.cur,self.req)['PrimaryGrossWeightKG']),D('6.1'))
        self.cur.execute('UPDATE dbo.PackagingConfigurationRequestItem SET ResponseLayerCount=1 WHERE ID=?',self.req)
        self.cur.execute('UPDATE dbo.PackagingMaterial SET TareWeight=99 WHERE ID=?',saved['NewID'])
        self.assertEqual(D(response_weights(self.cur,self.req)['CartonGrossWeightKG']),D('6.1'))
        self.assertNotEqual(pricing.calculate(self.cur,self.ctx,self.req,payload)['Fingerprint'],payload.Fingerprint)
        from request_views import item_read
        header=self.cur.execute('SELECT RequestID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval()
        row=item_read(self.username,header,1,25,None,None,'[]')['rows'][0]
        self.assertEqual(D(row['CartonGrossWeightKG']),D('6.1'))
        import load_planning_api as loads
        inputs=loading.calculation_tests.LoadingTests().inputs().model_copy(update={'mode':'floor','weight_source':'response','carton_kg':D(999)})
        body=loads.Preview(ContainerID=self.cid,ContainerRowVersion=self.crv,Inputs=inputs)
        self.cur.execute('UPDATE dbo.PackagingConfigurationRequestItem SET LengthMM=400,WidthMM=300,HeightMM=200 WHERE ID=?',self.req)
        preview=loads.preview(self.req,body,self.ctx)
        self.assertEqual(D(preview['Inputs']['carton_kg']),D('6.1'))
        self.cur.execute('UPDATE dbo.PkgPricingMaster SET IsCurrent=0 WHERE RequestItemID=?',self.req)
        with self.assertRaises(HTTPException):loads.preview(self.req,body,self.ctx)

    def test_film_area_and_quantity_are_physical_not_vendor_units(self):
        import pkg_pricing_api as pricing
        from pkg_pricing import Calculation
        mm=self.cur.execute("SELECT TOP(1) ID FROM dbo.UoM WHERE UoMCode='mm'").fetchval()
        m2=self.cur.execute("SELECT TOP(1) ID FROM dbo.UoM WHERE UoMCode='m2'").fetchval()
        self.cur.execute("UPDATE dbo.PackagingType SET FinalComponent=0 WHERE ID=?",self.type)
        child=self.cur.execute("INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,FinalComponent,ParentTypeID,CreatedBy) VALUES('Primary','Tare film','Square meter',0,1,?,?); SELECT CONVERT(INT,SCOPE_IDENTITY())",self.type,self.actor).fetchval()
        parent=self.cur.execute("INSERT dbo.PackagingDimension(PackagingTypeID,D1Name,D2Name,D1UoMID,D2UoMID,CreatedBy) VALUES(?,'Length','Width',?,?,?); SELECT CONVERT(INT,SCOPE_IDENTITY())",self.type,mm,mm,self.actor).fetchval()
        dim=self.cur.execute("INSERT dbo.PackagingDimension(PackagingTypeID,ParentDimensionID,D1Name,D2Name,D1UoMID,D2UoMID,ConvertFromParentFormula,ConversionOutputUoMID,CreatedBy) VALUES(?,?,'Length','Width',?,?,'(D2*2+15)*D1/1000000',?,?); SELECT CONVERT(INT,SCOPE_IDENTITY())",child,parent,mm,mm,m2,self.actor).fetchval()
        material=self.material(PackagingTypeID=child,TareWeight='1',TareWeightBasis='kg/m2')
        currency=self.cur.execute("SELECT TOP(1) ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval()
        price=self.cur.execute("INSERT dbo.PackagingPrice(MaterialID,CurrencyID,PriceBasis,QuantityFrom,UnitPrice,EffectiveFrom,CreatedBy) VALUES(?,?,'m2',1,10,'2020-01-01',?); SELECT CONVERT(INT,SCOPE_IDENTITY())",material['NewID'],currency,self.actor).fetchval()
        payload=Calculation(PackagingOrder='Primary',LayerCount=1,PackagingTypeID=self.type,SquareMeterUoMID=m2,DimensionID=parent,DimensionRowVersion=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingDimension WHERE ID=?',parent).fetchval()),D1=100,D2=50,components=[dict(PriceID=price,PriceRowVersion=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingPrice WHERE ID=?',price).fetchval()),Quantity=2)])
        result=pricing.calculate(self.cur,self.ctx,self.req,payload)
        self.assertEqual(D(result['components'][0]['Area']),D('.0115'))
        self.assertEqual(D(result['Tare']['KG']),D('.023'))

    def test_response_pallet_snapshot_ignores_manual_price_and_later_master_changes(self):
        import load_planning_api as loads
        self.cur.execute("UPDATE dbo.PackagingType SET PackagingOrder='Pallet',CopyDim=1,Shipping=0 WHERE ID=?",self.type)
        material=self.material(TareWeight='20')
        mm=self.cur.execute("SELECT TOP(1) ID FROM dbo.UoM WHERE UoMCode='mm'").fetchval()
        dim=self.cur.execute("INSERT dbo.PackagingDimension(PackagingTypeID,D1Name,D2Name,D3Name,D1UoMID,D2UoMID,D3UoMID,CreatedBy) VALUES(?,'Length','Width','Height',?,?,?,?); SELECT CONVERT(INT,SCOPE_IDENTITY())",self.type,mm,mm,mm,self.actor).fetchval()
        currency=self.cur.execute("SELECT TOP(1) ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval()
        price=self.cur.execute("INSERT dbo.PackagingPrice(MaterialID,CurrencyID,PriceBasis,QuantityFrom,UnitPrice,EffectiveFrom,CreatedBy,MaterialDimensionID,MaterialDimensionRowVersion,MaterialD1,MaterialD2,MaterialD3) VALUES(?,?,'EA',1,10,'2020-01-01',?,?,(SELECT RowVersion FROM dbo.PackagingDimension WHERE ID=?),1200,800,140); SELECT CONVERT(INT,SCOPE_IDENTITY())",material['NewID'],currency,self.actor,dim,dim).fetchval()
        pallet=next(p for p in loads.pallet_prices_from_cursor(self.cur) if p['ID']==price)
        self.assertEqual(pallet['TareWeight'],20)
        inputs=loading.calculation_tests.LoadingTests().inputs().model_copy(update={'pallet_kg':D(999)})
        body=loads.Preview(ContainerID=self.cid,ContainerRowVersion=self.crv,PalletPriceID=price,PalletPriceRowVersion=pallet['RowVersion'],PalletMaterialRowVersion=pallet['MaterialRowVersion'],Inputs=inputs)
        result=loads.preview(self.req,body,self.ctx)
        self.assertEqual(D(result['Inputs']['pallet_kg']),20)
        self.cur.execute('UPDATE dbo.PackagingMaterial SET TareWeight=21 WHERE ID=?',material['NewID'])
        # The item API uses its saved pallet/accessory snapshot, not a client-selected price.
        result=loads.preview(self.req,body,self.ctx)
        self.assertEqual(D(result['Inputs']['pallet_kg']),20)

    def test_pallet_accessories_snapshot_and_response(self):
        from unittest.mock import patch
        import pallet_pricing_api as pallets
        import packaging_api as api
        import load_planning_api as loads
        self.cur.execute("UPDATE dbo.PackagingType SET PackagingOrder='Pallet',CopyDim=1,Shipping=0 WHERE ID=?",self.type)
        material=self.material(TareWeight='20')
        mm=self.cur.execute("SELECT TOP(1) ID FROM dbo.UoM WHERE UoMCode='mm'").fetchval()
        dim=self.cur.execute("INSERT dbo.PackagingDimension(PackagingTypeID,D1Name,D2Name,D3Name,D1UoMID,D2UoMID,D3UoMID,CreatedBy) VALUES(?,'Length','Width','Height',?,?,?,?); SELECT CONVERT(INT,SCOPE_IDENTITY())",self.type,mm,mm,mm,self.actor).fetchval()
        currency=self.cur.execute("SELECT TOP(1) ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval()
        price=self.cur.execute("INSERT dbo.PackagingPrice(MaterialID,CurrencyID,PriceBasis,QuantityFrom,UnitPrice,EffectiveFrom,CreatedBy,MaterialDimensionID,MaterialDimensionRowVersion,MaterialD1,MaterialD2,MaterialD3) VALUES(?,?,'EA',1,10,'2020-01-01',?,?,(SELECT RowVersion FROM dbo.PackagingDimension WHERE ID=?),1200,800,140); SELECT CONVERT(INT,SCOPE_IDENTITY())",material['NewID'],currency,self.actor,dim,dim).fetchval()
        accessory_type=self.cur.execute("INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,FinalComponent,CreatedBy) VALUES('Primary','Corner test','Count',0,1,?); SELECT CONVERT(INT,SCOPE_IDENTITY())",self.actor).fetchval()
        accessory=self.material(PackagingTypeID=accessory_type,MaterialName='Corner',TareWeight='0.5')
        accessory_price=self.cur.execute("INSERT dbo.PackagingPrice(MaterialID,CurrencyID,PriceBasis,QuantityFrom,UnitPrice,EffectiveFrom,CreatedBy) VALUES(?,?,'EA',1,2,'2020-01-01',?); SELECT CONVERT(INT,SCOPE_IDENTITY())",accessory['NewID'],currency,self.actor).fetchval()
        choices=pallets.catalog(self.cur)
        def component(pid,qty):
            p=next(p for p in choices if p['ID']==pid)
            return dict(PriceID=pid,RowVersion=p['RowVersion'],MaterialRowVersion=p['MaterialRowVersion'],Quantity=qty)
        body=pallets.Selection(PalletSize='1200x800mm',ItemRowVersion=self.version,components=[component(price,1),component(accessory_price,4)])
        with patch.object(pallets,'api_cursor',loads.api_cursor):
            from auth import AccessContext
            viewer=AccessContext(self.actor,self.username,frozenset({'Packaging'}),{'requests':'display'})
            with self.assertRaises(HTTPException) as denied:pallets.save(self.req,body,viewer)
            self.assertEqual(denied.exception.status_code,403)
            result=pallets.preview(self.req,body,self.ctx)
            self.assertEqual(D(result['TareKG']),22)
            self.assertEqual(D(result['UnitPrice']),18)
            with self.assertRaises(HTTPException):pallets.preview(self.req,body.model_copy(update={'PalletSize':'1100x1100mm'}),self.ctx)
            saved=pallets.save(self.req,body,self.ctx)
            self.assertGreater(saved['ID'],0)
            # Apply in the response transaction and read back through the standard endpoint.
            saved_response=api.response_save(api.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,RowVersion=self.version,ResponsePalletSize='1200x800mm',PalletPricingID=saved['ID'])]),self.ctx)
            self.assertEqual(saved_response['results'][0]['Status'],'OK')
            from request_views import item_read
            import json
            request_id=self.cur.execute('SELECT RequestID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval()
            visible=item_read(self.username,request_id,1,25,None,None,"[]")['rows'][0]
            self.assertEqual(json.loads(visible['PalletPricingJSON'])['ID'],saved['ID'])
            self.cur.execute('UPDATE dbo.PackagingMaterial SET TareWeight=50 WHERE ID=?',accessory['NewID'])
            import json
            frozen=json.loads(self.cur.execute('SELECT SnapshotJSON FROM dbo.PalletPricingSnapshot WHERE ID=?',saved['ID']).fetchval())
            self.assertEqual(D(frozen['TareKG']),22)
            with self.assertRaises(HTTPException) as stale:pallets.preview(self.req,body,self.ctx)
            self.assertEqual(stale.exception.status_code,409)
            # Saved assembly becomes authoritative for load-plan dimensions and tare.
            payload=loading.LoadPlanningSQL.payload(self)
            self.cur.execute('UPDATE dbo.PackagingConfigurationRequestItem SET LengthMM=400,WidthMM=300,HeightMM=200 WHERE ID=?',self.req)
            planned=loads.preview(self.req,payload,self.ctx)
            self.assertEqual(D(planned['Inputs']['pallet_kg']),22)
            self.assertEqual(planned['Result']['PalletPricingID'],saved['ID'])
