"""Exact examples and rollback-only pricing catalog/snapshot/API contracts."""
import re
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
import unittest
from contextlib import contextmanager
from decimal import Decimal as D
from unittest.mock import patch
from uuid import uuid4
import packaging_field_foundation_contract as foundation
import packaging_api as batches
import packaging_fields as fields
import pkg_pricing_api as api
import unit_conversion_api as conversions
from pkg_pricing import Calculation, component_cost, aggregate
from auth import AccessContext
from db import bytes_to_b64
from fastapi import HTTPException
from pydantic import ValidationError


class Math(unittest.TestCase):
    def test_count_example(self):
        self.assertEqual(component_cost(D(10000), D(5000), D(2), D(1)), (D(2), D(20000), D(2500)))

    def test_area_example_and_quantity(self):
        self.assertEqual(component_cost(D(10000), D(5000), D(1), D(250), D(50)), (D('.2'), D(2000), D(25000)))
        self.assertEqual(component_cost(D(10000), D(5000), D(2), D(250), D(50)), (D('.4'), D(4000), D(12500)))

    def test_whole_product_moq_rounds_up(self):
        self.assertEqual(component_cost(D(5), D(5000), D(3), D(1))[2], D(1667))

    def test_boundaries_do_not_overflow_or_round_consumption_to_zero(self):
        for args in ((D(1),D(1),D(1),D(0)), (D(1),D('1e14'),D(1),D(1)), (D(1),D(1),D('.000001'),D('1e15'))):
            with self.assertRaises(ValueError): component_cost(*args)

    def test_strict_inputs_reject_totals_and_duplicate_prices(self):
        line=dict(PriceID=1,PriceRowVersion='AAAAAAAAAAE=',Quantity='2')
        for values in (dict(components=[line,line]),dict(components=[line],UnitPrice=1),dict(components=[dict(line,Quantity='NaN')])):
            with self.assertRaises(ValidationError): Calculation(PackagingOrder='Primary',PackagingTypeID=1,**values)


class PricingSQL(unittest.TestCase):
    cleanup = foundation.PackagingFoundation.cleanup

    def setUp(self):
        foundation.PackagingFoundation.setUp(self)
        self.req = foundation.PackagingFoundation.request(self)
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET PICUserID=? WHERE ID=?",self.actor,self.req)
        self.ctx = AccessContext(self.actor,self.username,frozenset({'Admin'}))
        self.cur.execute('SET QUOTED_IDENTIFIER ON')
        for _ in range(2):
            for filename in ('56_web_packaging_requirement_sections.sql', '63_pkg_pricing_master.sql', '64_unit_conversion_bidirectional.sql', '65_pkg_pricing_references.sql', '66_packaging_type_orders.sql', '67_packaging_layers.sql','69_packing_way.sql','70_packaging_container_load.sql','71_packaging_request_layer_details.sql','72_packaging_response_pallet_defaults.sql','76_packaging_pallet_layers.sql','77_packaging_parent_dimensions.sql','79_packaging_supplier_geometry.sql','80_packaging_formula_roles.sql','81_packaging_child_dimensions.sql'):
                for sql in re.split(r'^GO\s*$', (foundation.ROOT/'sql'/filename).read_text(),flags=re.M|re.I):
                    if sql.strip():
                        self.cur.execute(sql)
                        while self.cur.nextset(): pass
        @contextmanager
        def cursor(): yield self.cur
        for module in (api,batches,fields):
            mock=patch.object(module,'get_raw_cursor',cursor);mock.start();self.addCleanup(mock.stop)
        self.token=uuid4().hex[:10]
        self.root=self.new_type('PET jar','Count')
        self.label_type=self.new_type('Label','Count',self.root)
        self.jar_type=self.new_type('Jar','Count',self.root)
        self.film_type=self.new_type('Film','Square meter',self.root)
        self.other_type=self.new_type('Unrelated','Count')
        self.units={}
        for code in ('EA','m','m2','mm'):
            self.cur.execute("IF NOT EXISTS(SELECT 1 FROM dbo.UoM WHERE UoMCode=?) INSERT dbo.UoM(UoMCode,CreatedBy) VALUES(?,?); UPDATE dbo.UoM SET Status='Active' WHERE UoMCode=?",code,code,self.actor,code)
            self.units[code]=self.cur.execute('SELECT ID FROM dbo.UoM WHERE UoMCode=?',code).fetchval()
        self.vnd=self.cur.execute("SELECT TOP(1) ID FROM dbo.Currency WHERE CurrencyCode='VND'").fetchval()
        self.usd=self.cur.execute("SELECT TOP(1) ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval()
        self.label,self.label_price=self.material(self.label_type,'Label',10000,5000)
        self.jar,self.jar_price=self.material(self.jar_type,'Jar',3000,1000)
        self.film,self.film_price=self.material(self.film_type,'Film',10000,5000,'m')
        self.dimension=self.cur.execute("""INSERT dbo.PackagingDimension(PackagingTypeID,D1Name,D2Name,D1UoMID,D2UoMID,SquareMeterFormula,CreatedBy)
            VALUES(?,'Height','Width',?,?,'D1*D2/1000000',?); SELECT CONVERT(INT,SCOPE_IDENTITY())""",self.root,self.units['mm'],self.units['mm'],self.actor).fetchval()
        self.supplier_dimension=self.cur.execute("""INSERT dbo.PackagingDimension(PackagingTypeID,ParentDimensionID,D1Name,D2Name,D1UoMID,D2UoMID,SquareMeterFormula,CreatedBy)
            VALUES(? ,?,'Height','Width',?,?,'D1*D2/1000000',?); SELECT CONVERT(INT,SCOPE_IDENTITY())""",self.film_type,self.dimension,self.units['mm'],self.units['mm'],self.actor).fetchval()
        self.cur.execute("UPDATE dbo.PackagingDimension SET ConvertFromParentFormula='D1*D2/1000000',ConvertFromSupplierFormula='D1*D2/1000000' WHERE ID=?",self.supplier_dimension)
        self.cur.execute("""UPDATE dbo.PackagingPrice SET SupplierDimensionID=?,SupplierDimensionRowVersion=(SELECT RowVersion FROM dbo.PackagingDimension WHERE ID=?),
            SupplierD1=1000,SupplierD2=250000,SupplierAreaPerPriceUnit=250 WHERE ID=?""",self.supplier_dimension,self.supplier_dimension,self.film_price)
        self.conversion=self.cur.execute("""INSERT dbo.UnitConversion(FromUoMID,ToUoMID,Factor,PackagingMaterialID,CreatedBy)
            VALUES(?,?,250,?,?); SELECT CONVERT(INT,SCOPE_IDENTITY())""",self.units['m'],self.units['m2'],self.film,self.actor).fetchval()

    def new_type(self,name,basis,parent=None,order='Primary'):
        return self.cur.execute("INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,ParentTypeID,CreatedBy,Shipping) VALUES(?,?,?,0,?,?,?); SELECT CONVERT(INT,SCOPE_IDENTITY())",order,name+'-'+self.token,basis,parent,self.actor,parent is None and order!='Primary').fetchval()

    def material(self,type_id,name,price,moq,price_unit='EA'):
        # Current master contract: test materials use explicit Final components.
        self.cur.execute("UPDATE dbo.PackagingType SET FinalComponent=1 WHERE ID=? AND NOT EXISTS(SELECT 1 FROM dbo.PackagingType WHERE ParentTypeID=?)",type_id,type_id)
        material=self.cur.execute("INSERT dbo.PackagingMaterial(MaterialCode,MaterialName,UnitOfMeasure,PackagingTypeID,CreatedBy) VALUES(?,?,?, ?,?); SELECT CONVERT(INT,SCOPE_IDENTITY())",'PKG-'+name+'-'+self.token,name,'EA',type_id,self.actor).fetchval()
        price_id=self.cur.execute("""INSERT dbo.PackagingPrice(MaterialID,CurrencyID,PriceBasis,QuantityFrom,UnitPrice,EffectiveFrom,CreatedBy,ExchangeRateToUSD)
            VALUES(?,?,?,?,?,'2020-01-01',?,25000); SELECT CONVERT(INT,SCOPE_IDENTITY())""",material,self.vnd,price_unit,moq,price,self.actor).fetchval()
        return material,price_id

    def line(self,price_id,quantity='1',area=False):
        values=dict(PriceID=price_id,PriceRowVersion=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingPrice WHERE ID=?',price_id).fetchval()),Quantity=quantity)
        if area: values.update(DimensionID=self.supplier_dimension,DimensionRowVersion=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingDimension WHERE ID=?',self.supplier_dimension).fetchval()),D1='10000',D2='5000')
        return values

    def payload(self,*lines,**values):
        dimension=self.dimension
        geometry=dict(DimensionID=dimension,DimensionRowVersion=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingDimension WHERE ID=?',dimension).fetchval()))
        geometry.update({k:next((c[k] for c in lines if k in c),None) for k in ('D1','D2','D3')})
        children=[{k:v for k,v in c.items() if k not in ('D1','D2','D3')} for c in lines]
        for child in children:
            if child.get('DimensionID') == self.dimension:
                child['DimensionID']=None
                child['DimensionRowVersion']=None
        return Calculation(PackagingOrder='Primary',PackagingTypeID=self.root,SquareMeterUoMID=self.units['m2'],components=children,**{**geometry,**values})

    def preview(self,payload,ctx=None):
        return api.preview(self.req,payload,ctx or self.ctx)['calculation']

    def save(self,payload,preview):
        payload=payload.model_copy(update={'Fingerprint':preview['Fingerprint']})
        version=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval())
        response=batches.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,RowVersion=version,FirstPMType=preview['PackagingTypeName'],FirstPMMOQ=preview['FinalMOQ'],PricingCalculations=[payload])])
        return batches.response_save(response,self.ctx)

    def secondary(self):
        root=self.new_type('Secondary set','Count',order='Secondary')
        child=self.new_type('Secondary carton','Count',root,order='Secondary')
        _,price=self.material(child,'Secondary',6000,300)
        dimension=self.cur.execute("""INSERT dbo.PackagingDimension(PackagingTypeID,D1Name,D2Name,D3Name,D1UoMID,D2UoMID,D3UoMID,CreatedBy)
            VALUES(?,'Length','Width','Height',?,?,?,?); SELECT CONVERT(INT,SCOPE_IDENTITY())""",root,self.units['mm'],self.units['mm'],self.units['mm'],self.actor).fetchval()
        return Calculation(PackagingOrder='Secondary',PackagingTypeID=root,DimensionID=dimension,
            DimensionRowVersion=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingDimension WHERE ID=?',dimension).fetchval()),D3='250',components=[self.line(price)])

    def save_secondary(self,payload,moq=None,send_moq=False):
        result=self.preview(payload)
        version=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval())
        row=dict(RowNum=1,ID=self.req,RowVersion=version,SecondPMType=result['PackagingTypeName'],
                 PricingCalculations=[payload.model_copy(update={'Fingerprint':result['Fingerprint']})])
        if send_moq:row['SecondPMMOQ']=moq
        return batches.response_save(batches.ResponseBatch(rows=[row]),self.ctx)

    def test_catalog_only_descendants_with_effective_prices(self):
        unrelated,_=self.material(self.other_type,'Other',1,1)
        self.cur.execute("UPDATE dbo.PackagingPrice SET EffectiveFrom='2099-01-01' WHERE ID=?",self.jar_price)
        options=api.options(self.req,self.root,'Primary',self.ctx)
        self.assertNotIn(unrelated,[r['MaterialID'] for r in options['materials']])
        self.assertIsNone(next(r for r in options['materials'] if r['MaterialID']==self.jar)['PriceID'])
        self.assertIn(self.film_price,[r['PriceID'] for r in options['materials']])

    def test_count_components_sum_prices_and_take_highest_moq(self):
        result=self.preview(self.payload(self.line(self.label_price,'2'),self.line(self.jar_price)))
        self.assertEqual(D(result['FinalMOQ']),D(2500))
        self.assertEqual(D(result['UnitPrice']),D(23000))
        self.assertEqual(result['CurrencyCode'],'VND')

    def test_count_single_dimension_can_be_selected_without_optional_measurements(self):
        dimension=self.cur.execute("""INSERT dbo.PackagingDimension(PackagingTypeID,D1Name,D1UoMID,CreatedBy)
            VALUES(?,'Diameter',?,?); SELECT CONVERT(INT,SCOPE_IDENTITY())""",self.root,self.units['mm'],self.actor).fetchval()
        payload=self.payload(self.line(self.label_price,'2')).model_copy(update={
            'DimensionID':dimension,'DimensionRowVersion':bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingDimension WHERE ID=?',dimension).fetchval())})
        result=self.preview(payload)
        self.assertEqual(D(result['UnitPrice']),D(20000))
        self.assertIsNone(result['components'][0]['Area'])
        self.assertEqual(self.save(payload,result)['results'][0]['Status'],'OK')

    def test_area_conversion_uses_formula_and_example(self):
        result=self.preview(self.payload(self.line(self.film_price,area=True)))
        self.assertEqual(D(result['FinalMOQ']),D(25000))
        self.assertEqual(D(result['UnitPrice']),D(2000))
        self.assertEqual(D(result['components'][0]['Area']),D(50))

    def test_geometry_shows_conversion_before_dimensions_without_saving(self):
        before=self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval()
        row=api.geometry_preview(self.req,self.payload(self.line(self.film_price)),self.ctx)['components'][0]
        self.assertEqual((row['SourceUoMCode'],row['TargetUoMCode']),('m','m2'))
        self.assertEqual(D(row['Factor']),D(250))
        self.assertEqual(D(row['ReverseFactor']),D('.004'))
        self.assertIsNone(row['AreaPerMaterial']);self.assertIsNone(row['AreaPerProductUnit'])
        self.assertTrue(row['AreaStatus'])
        self.assertEqual(self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval(),before)
        self.assertEqual(self.cur.execute('SELECT COUNT(*) FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval(),0)

    def test_geometry_matches_final_area_per_material_and_product_unit(self):
        payload=self.payload(self.line(self.film_price,'2',area=True))
        row=api.geometry_preview(self.req,payload,self.ctx)['components'][0]
        self.assertEqual(D(row['AreaPerMaterial']),D(50))
        self.assertEqual(D(row['AreaPerProductUnit']),D(100))
        self.assertIsNone(row['AreaStatus']);self.assertIn('Packaging Material Pricing',row['ConversionStatus'])
        final=self.preview(payload)['components'][0]
        for key in row:self.assertEqual(final[key],row[key])
        options=api.options(self.req,self.root,'Primary',self.ctx)
        self.assertEqual(next(p for p in options['materials'] if p['PriceID']==self.film_price)['EffectiveFrom'],'2020-01-01')

    def test_geometry_does_not_report_a_false_zero_for_missing_measurements(self):
        line=self.line(self.film_price,area=True);line.pop('D2')
        row=api.geometry_preview(self.req,self.payload(line),self.ctx)['components'][0]
        self.assertIsNone(row['AreaPerMaterial'])
        self.assertIn('Width',row['AreaStatus'])
        self.assertEqual(D(row['Factor']),D(250))

    def test_geometry_keeps_area_when_conversion_is_missing(self):
        self.cur.execute("UPDATE dbo.PackagingPrice SET SupplierDimensionID=NULL,SupplierDimensionRowVersion=NULL,SupplierD1=NULL,SupplierD2=NULL,SupplierAreaPerPriceUnit=NULL WHERE ID=?",self.film_price)
        row=api.geometry_preview(self.req,self.payload(self.line(self.film_price,area=True)),self.ctx)['components'][0]
        self.assertEqual(D(row['AreaPerMaterial']),D(50))
        self.assertIsNone(row['Factor']);self.assertIsNone(row['ReverseFactor'])
        self.assertIn('supplier dimensions',row['ConversionStatus'])

    def test_geometry_uses_material_vendor_scope_and_same_unit_identity(self):
        vendor=self.cur.execute('INSERT dbo.Vendor(VendorName,CreatedBy) VALUES(?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())',self.token,self.actor).fetchval()
        self.cur.execute('UPDATE dbo.PackagingPrice SET VendorID=? WHERE ID=?',vendor,self.film_price)
        self.cur.execute('INSERT dbo.UnitConversion(FromUoMID,ToUoMID,Factor,PackagingMaterialID,VendorID,CreatedBy) VALUES(?,?,100,?,?,?)',self.units['m'],self.units['m2'],self.film,vendor,self.actor)
        self.cur.execute('UPDATE dbo.PackagingPrice SET SupplierD2=100000,SupplierAreaPerPriceUnit=100 WHERE ID=?',self.film_price)
        row=api.geometry_preview(self.req,self.payload(self.line(self.film_price,area=True)),self.ctx)['components'][0]
        self.assertEqual(D(row['Factor']),D(100));self.assertEqual(D(row['ReverseFactor']),D('.01'))
        self.cur.execute("UPDATE dbo.PackagingPrice SET PriceBasis='m2' WHERE ID=?",self.film_price)
        row=api.geometry_preview(self.req,self.payload(self.line(self.film_price,area=True)),self.ctx)['components'][0]
        self.assertEqual(D(row['Factor']),D(1));self.assertEqual(D(row['ReverseFactor']),D(1))

    def test_geometry_rejects_stale_masters_and_unauthorized_readers(self):
        payload=self.payload(self.line(self.film_price,area=True))
        with self.assertRaises(HTTPException) as caught:api.geometry_preview(self.req,payload,AccessContext(self.actor,self.username,frozenset({'Opportunity'})))
        self.assertEqual(caught.exception.status_code,403)
        self.cur.execute('UPDATE dbo.PackagingPrice SET UnitPrice=99 WHERE ID=?',self.film_price)
        with self.assertRaises(HTTPException) as caught:api.geometry_preview(self.req,payload,self.ctx)
        self.assertEqual(caught.exception.status_code,409)
        payload=self.payload(self.line(self.film_price,area=True))
        self.cur.execute("UPDATE dbo.PackagingDimension SET D1Name='Length' WHERE ID=?",self.dimension)
        with self.assertRaises(HTTPException) as caught:api.geometry_preview(self.req,payload,self.ctx)
        self.assertEqual(caught.exception.status_code,409)

    def test_geometry_displays_formula_errors_without_a_misleading_area(self):
        self.cur.execute("UPDATE dbo.PackagingDimension SET ConvertFromParentFormula='D1/(D2-D2)' WHERE ID=?",self.supplier_dimension)
        row=api.geometry_preview(self.req,self.payload(self.line(self.film_price,area=True)),self.ctx)['components'][0]
        self.assertIsNone(row['AreaPerMaterial'])
        self.assertIn('divides by zero',row['AreaStatus'])

    def test_count_calculator_uses_automatically_created_reverse_conversion(self):
        self.cur.execute("UPDATE dbo.PackagingPrice SET PriceBasis='m' WHERE ID=?",self.label_price)
        saved=conversions.save(conversions.Conversion(FromUoMID=self.units['EA'],ToUoMID=self.units['m'],
            Factor=D('.01'),PackagingMaterialID=self.label),self.ctx)
        result=self.preview(self.payload(self.line(self.label_price,'2')))
        self.assertEqual(D(result['components'][0]['Factor']),D(100))
        self.assertEqual(result['components'][0]['Conversion']['ID'],saved['ReverseConversionID'])
        self.assertEqual(D(result['FinalMOQ']),D(250000))
        self.assertEqual(D(result['UnitPrice']),D(200))

    def test_snapshots_saved_atomically_with_response_and_history_retained(self):
        payload=self.payload(self.line(self.label_price,'2'))
        result=self.preview(payload)
        self.assertEqual(self.save(payload,result)['results'][0]['Status'],'OK')
        first=self.cur.execute('SELECT ID FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval()
        payload=self.payload(self.line(self.label_price,'3'))
        self.save(payload,self.preview(payload))
        self.assertEqual(self.cur.execute('SELECT COUNT(*) FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval(),2)
        self.assertFalse(self.cur.execute('SELECT IsCurrent FROM dbo.PkgPricingMaster WHERE ID=?',first).fetchval())
        self.assertEqual(self.cur.execute('SELECT ProductUnitPrice FROM dbo.PkgPricingComponent WHERE PricingMasterID=?',first).fetchval(),D(20000))
        self.cur.execute('UPDATE dbo.PackagingPrice SET UnitPrice=999 WHERE ID=?',self.label_price)
        self.assertEqual(self.cur.execute('SELECT UnitPrice FROM dbo.PkgPricingMaster WHERE ID=?',first).fetchval(),D(20000))
        options=api.options(self.req,self.root,'Primary',self.ctx)
        self.assertEqual(len(options['saved']),2)
        self.assertEqual(len(options['savedComponents']),1)
        self.assertGreater(self.cur.execute("SELECT COUNT(*) FROM dbo.PackagingRequestChangeLog WHERE ItemID=? AND FieldName='PrimaryPricing' AND ChangedBy=?",self.req,self.username).fetchval(),0)

    def test_changed_price_rejects_save_and_rolls_back_response(self):
        payload=self.payload(self.line(self.label_price,'2'));result=self.preview(payload)
        self.cur.execute('UPDATE dbo.PackagingPrice SET UnitPrice=999 WHERE ID=?',self.label_price)
        with self.assertRaises(HTTPException) as caught:self.save(payload,result)
        self.assertEqual(caught.exception.status_code,409)
        self.assertEqual(self.cur.execute('SELECT COUNT(*) FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval(),0)

    def test_changed_conversion_invalidates_fingerprint(self):
        payload=self.payload(self.line(self.film_price,area=True));result=self.preview(payload)
        self.cur.execute('UPDATE dbo.PackagingPrice SET SupplierD2=200000,SupplierAreaPerPriceUnit=200 WHERE ID=?',self.film_price)
        with self.assertRaises(HTTPException) as caught:self.save(payload,result)
        self.assertEqual(caught.exception.status_code,409)

    def test_missing_conversion_and_cross_type_dimension_rejected(self):
        self.cur.execute('UPDATE dbo.PackagingPrice SET SupplierDimensionID=NULL,SupplierDimensionRowVersion=NULL,SupplierD1=NULL,SupplierD2=NULL,SupplierAreaPerPriceUnit=NULL WHERE ID=?',self.film_price)
        with self.assertRaises(HTTPException) as caught:self.preview(self.payload(self.line(self.film_price,area=True)))
        self.assertEqual(caught.exception.status_code,422)

    def test_combined_moq_must_fit_every_quantity_tier(self):
        self.cur.execute('UPDATE dbo.PackagingPrice SET QuantityTo=1500 WHERE ID=?',self.jar_price)
        with self.assertRaises(HTTPException) as caught:self.preview(self.payload(self.line(self.label_price,'2'),self.line(self.jar_price)))
        self.assertEqual(caught.exception.status_code,422)
        self.assertIn('tier',caught.exception.detail)

    def test_mixed_currencies_normalized_not_added_as_raw_numbers(self):
        self.cur.execute('UPDATE dbo.PackagingPrice SET CurrencyID=?,UnitPrice=10,ExchangeRateToUSD=1 WHERE ID=?',self.usd,self.jar_price)
        result=self.preview(self.payload(self.line(self.label_price,'2'),self.line(self.jar_price)))
        self.assertEqual(result['CurrencyCode'],'USD')
        self.assertEqual(D(result['UnitPrice']),D('10.8'))

    def test_volume_and_unrelated_material_cannot_be_forged(self):
        self.cur.execute("UPDATE dbo.PackagingType SET PriceBasis='Volume' WHERE ID=?",self.label_type)
        with self.assertRaises(HTTPException):self.preview(self.payload(self.line(self.label_price)))
        self.cur.execute('UPDATE dbo.PackagingType SET ParentTypeID=NULL WHERE ID=?',self.jar_type)
        with self.assertRaises(HTTPException):self.preview(self.payload(self.line(self.jar_price)))

    def test_manager_can_preview_but_sales_cannot_read(self):
        name='pricing-manager-'+self.token
        actor=self.cur.execute('INSERT dbo.Users(UserName,IsActive) VALUES(?,1);SELECT CONVERT(INT,SCOPE_IDENTITY())',name).fetchval()
        self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,'PackagingManager')",actor)
        manager=AccessContext(actor,name,frozenset({'PackagingManager'}))
        self.assertEqual(self.preview(self.payload(self.line(self.label_price)),manager)['CurrencyCode'],'VND')
        with self.assertRaises(HTTPException) as caught:api.options(self.req,self.root,'Primary',AccessContext(actor,name,frozenset({'Opportunity'})))
        self.assertEqual(caught.exception.status_code,403)
        with self.assertRaises(HTTPException):batches.response_save(batches.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,RowVersion='AAAAAAAAAAE=')]),manager)

    def test_count_vendor_pack_conversion(self):
        self.cur.execute('UPDATE dbo.PackagingPrice SET PriceBasis=? WHERE ID=?','m',self.label_price)
        self.cur.execute('INSERT dbo.UnitConversion(FromUoMID,ToUoMID,Factor,PackagingMaterialID,CreatedBy) VALUES(?,?,100,?,?)',self.units['m'],self.units['EA'],self.label,self.actor)
        result=self.preview(self.payload(self.line(self.label_price,'2')))
        self.assertEqual(D(result['UnitPrice']),D(200))
        self.assertEqual(D(result['FinalMOQ']),D(250000))

    def test_unrelated_dimension_wrong_area_unit_and_unreviewed_formula(self):
        line=self.line(self.film_price,area=True)
        payload=self.payload(line).model_copy(update={'SquareMeterUoMID':self.units['EA']})
        with self.assertRaises(HTTPException):self.preview(payload)
        unrelated=self.cur.execute("INSERT dbo.PackagingDimension(PackagingTypeID,D1Name,D1UoMID,SquareMeterFormula,CreatedBy) VALUES(?,'Diameter',?,'D1*D1',?);SELECT CONVERT(INT,SCOPE_IDENTITY())",self.other_type,self.units['mm'],self.actor).fetchval()
        bad=self.payload(self.line(self.film_price,area=True)).model_copy(update={'DimensionID':unrelated,'DimensionRowVersion':bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingDimension WHERE ID=?',unrelated).fetchval())})
        with self.assertRaises(HTTPException):self.preview(bad)
        self.cur.execute('UPDATE dbo.PackagingDimension SET FormulaNeedsReview=1 WHERE ID=?',self.dimension)
        with self.assertRaises(HTTPException):self.preview(self.payload(self.line(self.film_price,area=True)))

    def test_missing_measurement_and_unsafe_formula_rejected(self):
        line=self.line(self.film_price,area=True);line.pop('D2')
        with self.assertRaises(HTTPException) as caught:self.preview(self.payload(line))
        self.assertEqual(caught.exception.status_code,422)
        self.cur.execute("UPDATE dbo.PackagingDimension SET ConvertFromParentFormula='D1**2' WHERE ID=?",self.supplier_dimension)
        with self.assertRaises(HTTPException):self.preview(self.payload(self.line(self.film_price,area=True)))

    def test_history_remains_readable_after_approval_and_master_block(self):
        payload=self.payload(self.line(self.label_price,'2'));self.save(payload,self.preview(payload))
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Approved',IsOpen=0 WHERE ID=?",self.req)
        self.cur.execute("UPDATE dbo.PackagingType SET Status='Block' WHERE ID=?",self.root)
        data=api.history(self.req,self.ctx)['snapshots']
        self.assertEqual(D(data[0]['header']['UnitPrice']),D(20000))
        self.assertEqual(data[0]['components'][0]['MaterialName'],'Label')

    def test_primary_moq_cannot_be_changed_without_a_calculation(self):
        payload=self.payload(self.line(self.label_price,'2'));self.save(payload,self.preview(payload))
        version=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval())
        with self.assertRaises(HTTPException) as caught:
            batches.response_save(batches.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,RowVersion=version,FirstPMMOQ=3000)]),self.ctx)
        self.assertEqual(caught.exception.status_code,422)
        self.assertTrue(self.cur.execute('SELECT IsCurrent FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval())
        self.assertEqual(len(api.history(self.req,self.ctx)['snapshots']),1)

    def test_full_snapshot_links_context_versions_and_readonly_response_price(self):
        version=self.cur.execute("INSERT dbo.ProductGradeVersion(ProductID,Version,Status,CreatedBy) VALUES(?,1,'Active',?);SELECT CONVERT(INT,SCOPE_IDENTITY())",self.product,self.actor).fetchval()
        payload=self.payload(self.line(self.film_price,area=True));result=self.preview(payload)
        self.assertEqual(self.save(payload,result)['results'][0]['Status'],'OK')
        header=self.cur.execute('SELECT OpportunityItemID,OpportunityID,ProductID,ProductGradeVersionID,SnapshotJSON FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchone()
        self.assertEqual(tuple(header[:4]),(self.item,self.opp,self.product,version))
        import json
        snapshot=json.loads(header[4])
        self.assertEqual(snapshot['components'][0]['Dimension']['SquareMeterFormula'],'D1*D2/1000000')
        self.assertEqual(snapshot['components'][0]['EffectiveFrom'],'2020-01-01')
        import request_views
        row=request_views.item_read(self.username,None,1,25,None,None,'[]',request_ids=[self.cur.execute('SELECT RequestID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval()])['rows'][0]
        self.assertEqual(D(row['PrimaryPricePerUnit']),D(2000))
        self.assertEqual(row['PrimaryPriceCurrencyCode'],'VND')

    def test_calculation_derives_primary_moq_when_client_does_not_send_it(self):
        payload=self.payload(self.line(self.label_price,'2'));result=self.preview(payload)
        version=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval())
        response=batches.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,RowVersion=version,FirstPMType=result['PackagingTypeName'],PricingCalculations=[payload.model_copy(update={'Fingerprint':result['Fingerprint']})])])
        batches.response_save(response,self.ctx)
        self.assertEqual(self.cur.execute('SELECT FirstPMMOQ FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval(),D(2500))

    def test_save_with_missing_measurement_returns_validation_error_atomically(self):
        line=self.line(self.film_price,area=True);line.pop('D2')
        payload=self.payload(line)
        with self.assertRaises(HTTPException) as caught:
            self.save(payload,{'Fingerprint':'a'*64,'PackagingTypeName':self.cur.execute('SELECT PackagingType FROM dbo.PackagingType WHERE ID=?',self.root).fetchval(),'FinalMOQ':'1'})
        self.assertEqual(caught.exception.status_code,422)
        self.assertIn('measurement',caught.exception.detail)
        self.assertEqual(self.cur.execute('SELECT COUNT(*) FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval(),0)

    def test_changed_product_version_invalidates_preview(self):
        payload=self.payload(self.line(self.label_price,'2'));result=self.preview(payload)
        self.cur.execute('UPDATE dbo.Product SET ShelfLifeDays=123 WHERE ID=?',self.product)
        with self.assertRaises(HTTPException) as caught:self.save(payload,result)
        self.assertEqual(caught.exception.status_code,409)

    def test_primary_type_change_clears_old_moq_and_supersedes_old_price(self):
        payload=self.payload(self.line(self.label_price,'2'));self.save(payload,self.preview(payload))
        name=self.cur.execute('SELECT PackagingType FROM dbo.PackagingType WHERE ID=?',self.other_type).fetchval()
        version=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval())
        batches.response_save(batches.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,RowVersion=version,FirstPMType=name)]),self.ctx)
        self.assertIsNone(self.cur.execute('SELECT FirstPMMOQ FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval())
        self.assertFalse(self.cur.execute('SELECT IsCurrent FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval())

    def test_primary_price_input_is_forbidden_and_cost_basis_is_preserved(self):
        with self.assertRaises(ValidationError): batches.ResponseRow(RowNum=1,ID=self.req,RowVersion='AAAAAAAAAAE=',PrimaryPricePerUnit='1')
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Cost=500,CurrencyID=?,CostBasis='legacy basis' WHERE ID=?",self.vnd,self.req)
        version=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval())
        batches.response_save(batches.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,RowVersion=version,UnitsPerCarton=12)]),self.ctx)
        self.assertEqual(self.cur.execute('SELECT CostBasis FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval(),'legacy basis')

    def test_reuse_reference_refreshes_prices_and_keeps_original_snapshot(self):
        payload=self.payload(self.line(self.label_price,'2'));self.save(payload,self.preview(payload))
        source=self.cur.execute('SELECT ID FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval()
        old_req=self.req
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Approved',IsOpen=0 WHERE ID=?",old_req)
        self.req=foundation.PackagingFoundation.request(self)
        self.cur.execute('UPDATE dbo.PackagingPrice SET UnitPrice=12000 WHERE ID=?',self.label_price)
        listing=api.references(self.req,self.root,'Primary',self.ctx)['references']
        self.assertIn(source,[r['ID'] for r in listing])
        loaded=api.reference(self.req,source,self.root,'Primary',self.ctx)
        self.assertFalse(loaded['unavailable'])
        reused=Calculation(**loaded['input']);result=self.preview(reused)
        self.assertEqual(D(result['UnitPrice']),D(24000))
        self.save(reused,result)
        self.assertEqual(self.cur.execute('SELECT SourcePricingMasterID FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval(),source)
        self.assertEqual(self.cur.execute('SELECT UnitPrice FROM dbo.PkgPricingMaster WHERE ID=?',source).fetchval(),D(20000))

    def test_reference_reports_incompatible_materials_and_changed_dimensions(self):
        payload=self.payload(self.line(self.film_price,area=True));self.save(payload,self.preview(payload))
        source=self.cur.execute('SELECT ID FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval()
        self.cur.execute("UPDATE dbo.PackagingDimension SET D1Name='New height' WHERE ID=?",self.dimension)
        loaded=api.reference(self.req,source,self.root,'Primary',self.ctx)
        self.assertTrue(loaded['warnings']);self.assertIsNone(loaded['input']['components'][0]['D1'])
        other=self.new_type('Similar type','Count')
        loaded=api.reference(self.req,source,other,'Primary',self.ctx)
        self.assertEqual(len(loaded['unavailable']),1)
        self.assertFalse(loaded['input']['components'])

    def test_reference_replaces_expired_price_only_when_current_match_is_unambiguous(self):
        payload=self.payload(self.line(self.label_price,'2'));self.save(payload,self.preview(payload))
        source=self.cur.execute('SELECT ID FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval()
        self.cur.execute("UPDATE dbo.PackagingPrice SET EffectiveTo='2020-01-01' WHERE ID=?",self.label_price)
        new_price=self.cur.execute("INSERT dbo.PackagingPrice(MaterialID,CurrencyID,PriceBasis,QuantityFrom,UnitPrice,EffectiveFrom,CreatedBy) VALUES(?,?,'EA',5000,11000,'2021-01-01',?); SELECT CONVERT(INT,SCOPE_IDENTITY())",self.label,self.vnd,self.actor).fetchval()
        loaded=api.reference(self.req,source,self.root,'Primary',self.ctx)
        self.assertFalse(loaded['unavailable'])
        self.assertEqual(loaded['input']['components'][0]['PriceID'],new_price)
        old=loaded['previousComponents'][0]
        self.assertEqual((old['PriceID'],old['CurrentPriceID']),(self.label_price,new_price))
        self.assertEqual(D(old['ProductUnitPrice']),D(20000))
        self.assertEqual(loaded['componentSnapshot']['ID'],source)
        self.assertEqual(D(self.preview(Calculation(**loaded['input']))['UnitPrice']),D(22000))
        self.cur.execute("INSERT dbo.PackagingPrice(MaterialID,CurrencyID,PriceBasis,QuantityFrom,UnitPrice,EffectiveFrom,CreatedBy) VALUES(?,?,'EA',10000,9000,'2021-01-01',?)",self.label,self.vnd,self.actor)
        loaded=api.reference(self.req,source,self.root,'Primary',self.ctx)
        self.assertEqual(len(loaded['unavailable']),1)
        self.assertFalse(loaded['input']['components'])

    def test_references_are_not_exposed_to_sales(self):
        sales=AccessContext(self.actor,self.username,frozenset({'Opportunity'}))
        with self.assertRaises(HTTPException) as caught:api.references(self.req,self.root,'Primary',sales)
        self.assertEqual(caught.exception.status_code,403)

    def test_old_snapshot_and_links_survive_rerunning_migration(self):
        payload=self.payload(self.line(self.label_price,'2'));self.save(payload,self.preview(payload))
        stored=tuple(self.cur.execute('SELECT SnapshotJSON,ContextSnapshotJSON,ProductRowVersion FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchone())
        self.cur.execute('UPDATE dbo.Product SET ShelfLifeDays=123 WHERE ID=?',self.product)
        for sql in re.split(r'^GO\s*$', (foundation.ROOT/'sql/65_pkg_pricing_references.sql').read_text(),flags=re.M|re.I):
            if sql.strip():
                self.cur.execute(sql)
                while self.cur.nextset():pass
        self.assertEqual(tuple(self.cur.execute('SELECT SnapshotJSON,ContextSnapshotJSON,ProductRowVersion FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchone()),stored)

    def test_primary_and_secondary_snapshots_save_together(self):
        second=self.secondary()
        primary=self.payload(self.line(self.label_price,'2'));result=self.preview(primary)
        second_result=self.preview(second)
        version=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval())
        response=batches.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,RowVersion=version,FirstPMType=result['PackagingTypeName'],FirstPMMOQ=result['FinalMOQ'],SecondPMType=second_result['PackagingTypeName'],SecondPMMOQ=second_result['FinalMOQ'],PricingCalculations=[primary.model_copy(update={'Fingerprint':result['Fingerprint']}),second.model_copy(update={'Fingerprint':second_result['Fingerprint']})])])
        self.assertEqual(batches.response_save(response,self.ctx)['results'][0]['Status'],'OK')
        self.assertEqual(self.cur.execute('SELECT COUNT(*) FROM dbo.PkgPricingMaster WHERE RequestItemID=? AND IsCurrent=1',self.req).fetchval(),2)

    def test_secondary_moq_is_derived_and_saved_price_is_projected(self):
        self.assertEqual(self.save_secondary(self.secondary())['results'][0]['Status'],'OK')
        self.assertEqual(self.cur.execute('SELECT SecondPMMOQ FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval(),D(300))
        import request_views
        request_id=self.cur.execute('SELECT RequestID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval()
        row=request_views.item_read(self.username,None,1,25,None,None,'[]',request_ids=[request_id])['rows'][0]
        self.assertEqual(D(row['SecondaryPricePerUnit']),D(6000))
        self.assertEqual(row['SecondaryPriceCurrencyCode'],'VND')

    def test_secondary_moq_cannot_be_manually_changed_or_forged(self):
        payload=self.secondary()
        with self.assertRaises(HTTPException) as caught:self.save_secondary(payload,301,True)
        self.assertEqual(caught.exception.status_code,422)
        self.assertEqual(self.cur.execute('SELECT COUNT(*) FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval(),0)
        self.save_secondary(payload)
        version=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval())
        for moq in (301,None):
            with self.assertRaises(HTTPException) as caught:
                batches.response_save(batches.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,RowVersion=version,SecondPMMOQ=moq)]),self.ctx)
            self.assertEqual(caught.exception.status_code,422)
        self.assertEqual(self.cur.execute('SELECT SecondPMMOQ FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval(),D(300))
        self.assertTrue(self.cur.execute('SELECT IsCurrent FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval())

    def test_secondary_price_input_is_forbidden(self):
        for key in ('SecondaryPricePerUnit','SecondaryPriceCurrencyCode'):
            with self.assertRaises(ValidationError):
                batches.ResponseRow(**dict(RowNum=1,ID=self.req,RowVersion='AAAAAAAAAAE=',**{key:'1'}))

    def test_secondary_type_change_clears_moq_and_old_price(self):
        self.save_secondary(self.secondary())
        other=self.new_type('Other secondary','Count',order='Secondary')
        name=self.cur.execute('SELECT PackagingType FROM dbo.PackagingType WHERE ID=?',other).fetchval()
        version=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval())
        batches.response_save(batches.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,RowVersion=version,SecondPMType=name)]),self.ctx)
        self.assertIsNone(self.cur.execute('SELECT SecondPMMOQ FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval())
        self.assertFalse(self.cur.execute('SELECT IsCurrent FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval())
        import request_views
        request_id=self.cur.execute('SELECT RequestID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval()
        row=request_views.item_read(self.username,None,1,25,None,None,'[]',request_ids=[request_id])['rows'][0]
        self.assertIsNone(row['SecondaryPricePerUnit'])

    def test_previous_components_use_matching_type_and_stay_frozen(self):
        original=self.payload(self.line(self.label_price,'2'))
        self.save(original,self.preview(original))
        source=self.cur.execute('SELECT ID FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval()
        new_root=self.new_type('Other primary','Count')
        child=self.new_type('Other component','Count',new_root)
        _,price=self.material(child,'Other component',500,100)
        newer=Calculation(PackagingOrder='Primary',PackagingTypeID=new_root,components=[self.line(price)])
        self.save(newer,self.preview(newer))
        self.cur.execute('UPDATE dbo.PackagingPrice SET UnitPrice=12000 WHERE ID=?',self.label_price)
        options=api.options(self.req,self.root,'Primary',self.ctx)
        self.assertEqual(options['componentSnapshot']['ID'],source)
        self.assertEqual(D(options['savedComponents'][0]['ProductUnitPrice']),D(20000))
        self.assertEqual(D(next(p for p in options['materials'] if p['PriceID']==self.label_price)['UnitPrice']),D(12000))

    def test_secondary_saved_prices_follow_existing_visibility_rules(self):
        self.save_secondary(self.secondary())
        name='price-view-sales-'+self.token
        actor=self.cur.execute('INSERT dbo.Users(UserName,IsActive) VALUES(?,1);SELECT CONVERT(INT,SCOPE_IDENTITY())',name).fetchval()
        self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,'Opportunity')",actor)
        import request_views
        request_id=self.cur.execute('SELECT RequestID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval()
        def read():return request_views.item_read(name,None,1,25,None,None,'[]',request_ids=[request_id])['rows'][0]
        self.assertIsNone(read()['SecondaryPricePerUnit'])
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Approved',IsOpen=0 WHERE ID=?",self.req)
        self.assertEqual(D(read()['SecondaryPricePerUnit']),D(6000))

    def test_database_permissions_rechecked_even_if_http_role_is_forged(self):
        name='pricing-sales-'+self.token
        actor=self.cur.execute('INSERT dbo.Users(UserName,IsActive) VALUES(?,1);SELECT CONVERT(INT,SCOPE_IDENTITY())',name).fetchval()
        self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,'Opportunity')",actor)
        with self.assertRaises(HTTPException) as caught:api.options(self.req,self.root,'Primary',AccessContext(actor,name,frozenset({'Admin'})))
        self.assertEqual(caught.exception.status_code,403)


if __name__=='__main__': unittest.main()
