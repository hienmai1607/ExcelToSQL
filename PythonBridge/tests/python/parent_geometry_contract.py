"""Parent-only geometry and atomic pricing-to-pallet integration; fixtures roll back."""
import json
import unittest
from contextlib import contextmanager
from decimal import Decimal as D
from unittest.mock import patch
from uuid import uuid4
import response_pallet_defaults_contract as foundation
import web_requirement_sections_contract as requirements
from db import bytes_to_b64
from auth import AccessContext
from fastapi import HTTPException
from pkg_pricing import Calculation
import pkg_pricing_api as pricing
import packaging_api as batches
import packaging_fields as fields
import packaging_dimension_api as dimensions


class ParentGeometrySQL(unittest.TestCase):
    cleanup = foundation.ResponsePalletSQL.cleanup
    apply = foundation.ResponsePalletSQL.apply
    batch = requirements.WebRequirementSections.batch
    edit = requirements.WebRequirementSections.edit
    request = foundation.ResponsePalletSQL.request
    activate = requirements.WebRequirementSections.activate
    create_mix = requirements.WebRequirementSections.create_mix
    save_fields = foundation.ResponsePalletSQL.save_fields
    migrate = foundation.ResponsePalletSQL.migrate

    def setUp(self):
        foundation.ResponsePalletSQL.setUp(self)
        for name in ('73_packaging_type_shipping.sql','74_packaging_dimension_volume_formula.sql',
                     '76_packaging_pallet_layers.sql','77_packaging_parent_dimensions.sql','79_packaging_supplier_geometry.sql',
                     '80_packaging_formula_roles.sql','81_packaging_child_dimensions.sql'):
            self.migrate(name)
        @contextmanager
        def cursor():
            yield self.cur
        for module in (pricing,batches,fields):
            mock=patch.object(module,'get_raw_cursor',cursor)
            mock.start()
            self.addCleanup(mock.stop)
        self.root=self.types['Secondary']
        self.cur.execute('UPDATE dbo.PackagingType SET Shipping=1 WHERE ID=?',self.root)
        self.units={}
        for code in ('mm','cm','EA','m2'):
            self.cur.execute("IF NOT EXISTS(SELECT 1 FROM dbo.UoM WHERE UoMCode=?) INSERT dbo.UoM(UoMCode,CreatedBy) VALUES(?,?); UPDATE dbo.UoM SET Status='Active' WHERE UoMCode=?",code,code,self.actor,code)
            self.units[code]=self.cur.execute('SELECT ID FROM dbo.UoM WHERE UoMCode=?',code).fetchval()
        saved=dimensions.save(self.definition(OccupiedM2Formula='D1*D2/1000000',OccupiedM3Formula='D1*D2*D3/1000000000'),self.ctx)['row']
        self.dimension=saved['ID']
        self.child=self.cur.execute("INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,ParentTypeID,TareWeight,CreatedBy) VALUES('Secondary',?,'Square meter',?,0,?); SELECT CONVERT(INT,SCOPE_IDENTITY())",'PG-film-'+uuid4().hex[:12],self.root,self.actor).fetchval()
        self.override=dimensions.save(self.definition(PackagingTypeID=self.child,ParentDimensionID=self.dimension,
            ParentDimensionRowVersion=self.dim_rv(),ConvertFromParentFormula='D1*D2/1000000',
            ConvertFromSupplierFormula='(D2*2+25)*D1/1000000'),self.ctx)['row']['ID']
        self.material=self.cur.execute("INSERT dbo.PackagingMaterial(MaterialCode,MaterialName,UnitOfMeasure,PackagingTypeID,CreatedBy) VALUES(?,'Parent geometry film','EA',?,?); SELECT CONVERT(INT,SCOPE_IDENTITY())",'PG-'+uuid4().hex[:14],self.child,self.actor).fetchval()
        currency=self.cur.execute("SELECT TOP(1) ID FROM dbo.Currency WHERE CurrencyCode='VND'").fetchval()
        self.price=self.cur.execute("INSERT dbo.PackagingPrice(MaterialID,CurrencyID,PriceBasis,QuantityFrom,UnitPrice,EffectiveFrom,CreatedBy,ExchangeRateToUSD) VALUES(?,?,'m2',100,10000,'2020-01-01',?,25000); SELECT CONVERT(INT,SCOPE_IDENTITY())",self.material,currency,self.actor).fetchval()

    def dim_rv(self,id=None):
        return bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingDimension WHERE ID=?',id or self.dimension).fetchval())

    def definition(self,**values):
        return dimensions.DimensionSave(**{**dict(PackagingTypeID=self.root,D1='Length',D2='Width',D3='Height',
            D1UoMID=self.units['mm'],D2UoMID=self.units['mm'],D3UoMID=self.units['mm']),**values})

    def payload(self,**values):
        component=dict(PriceID=self.price,PriceRowVersion=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingPrice WHERE ID=?',self.price).fetchval()),Quantity='1')
        return Calculation(**{**dict(PackagingOrder='Secondary',LayerCount=2,PackagingTypeID=self.root,
            DimensionID=self.dimension,DimensionRowVersion=self.dim_rv(),D1='200',D2='100',D3='250',
            SquareMeterUoMID=self.units['m2'],components=[component]),**values})

    def preview(self,payload=None):
        return pricing.preview(self.req,payload or self.payload(),self.ctx)['calculation']

    def save(self,payload,result=None,**extra):
        result=result or self.preview(payload)
        version=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval())
        row=dict(RowNum=1,ID=self.req,RowVersion=version,SecondPMType=result['PackagingTypeName'],
            PricingCalculations=[payload.model_copy(update={'Fingerprint':result['Fingerprint']})],**extra)
        return batches.response_save(batches.ResponseBatch(rows=[row]),self.ctx)

    def test_parent_measurements_feed_parent_consumption_formula(self):
        result=self.preview()
        self.assertEqual(D(result['components'][0]['Area']),D('.02'))
        self.assertEqual(D(result['UnitPrice']),D(200))
        self.assertEqual(D(result['FinalLayerHeightMM']),D(250))
        self.assertEqual(result['components'][0]['DimensionID'],self.override)
        self.assertEqual(result['components'][0]['Measurements'],{'D1':'200','D2':'100','D3':'250'})
        live=pricing.geometry_preview(self.req,self.payload(),self.ctx)['components'][0]
        self.assertEqual(D(live['AreaPerMaterial']),D('.02'))
        self.assertEqual(result['ParentGeometryMetrics'],{'AreaM2':'0.020000000','VolumeM3':'0.005000000'})

    def test_saved_geometry_efficiency_reads_survive_parent_master_changes(self):
        from request_views import item_read
        from opportunity_views import sorted_grid
        self.cur.execute("""IF NOT EXISTS(SELECT 1 FROM dbo.Pallet WHERE UoMID=? AND Width=1000 AND Length=1000)
            INSERT dbo.Pallet(UoMID,Width,Length,CreatedBy) VALUES(?,1000,1000,?);
            UPDATE dbo.Pallet SET Status='Active' WHERE UoMID=? AND Width=1000 AND Length=1000""",
            self.units['mm'],self.units['mm'],self.actor,self.units['mm'])
        pallet=self.cur.execute('SELECT PalletSize FROM dbo.v_PalletMaster WHERE UoMID=? AND Width=1000 AND Length=1000',self.units['mm']).fetchval()
        self.save(self.payload(),ResponseMaxPalletHeightMM=1900,CartonsPerLayer=10,ResponsePalletSize=pallet,NutDensity='.5')
        row=item_read(self.username,self.header,1,25,None,None,'[]')['rows'][0]
        self.assertEqual(D(row['FinalLayerAreaM2']),D('.02'))
        self.assertEqual(D(row['FinalLayerVolumeM3']),D('.005'))
        self.assertEqual(D(row['PalletHeightMM']),D(1900))
        expected=D(row['SecondaryNetWeightGrams'])/1000/D('.005')
        self.assertEqual(D(row['CartonEfficiencyKGM3']),expected)
        self.assertEqual(D(row['PalletUtilizationPct']),D(20))
        self.assertEqual(D(row['RelativeCartonEfficiencyPct']),expected/D('.5')/1000*100)
        capture=row['LayerDimensionCaptures']['Secondary']
        self.assertEqual(capture['Dimensions'],[
            dict(Name='Length',Unit='mm',Value='200'),dict(Name='Width',Unit='mm',Value='100'),
            dict(Name='Height',Unit='mm',Value='250')])
        self.assertNotIn('SecondaryLayerPricingSnapshot',row)
        opportunities=sorted_grid(self.username,1,25,'[]',self.number)['rows']
        opportunity=next(r for r in opportunities if r['ItemID']==self.item)
        for key in ('PalletHeightMM','CartonEfficiencyKGM3','RelativeCartonEfficiencyPct','PalletUtilizationPct','PalletHeightEfficiencyPct'):
            self.assertEqual(D(opportunity[key]),D(row[key]))
        self.assertNotIn('FinalLayerPricingSnapshot',opportunity)
        self.assertNotIn('SecondaryLayerPricingSnapshot',opportunity)
        self.assertEqual(opportunity['LayerDimensionCaptures'],row['LayerDimensionCaptures'])
        dimensions.save(self.definition(ID=self.dimension,RowVersion=self.dim_rv(),
            D1='New length label',OccupiedM2Formula='D1*D2/100',OccupiedM3Formula='D1*D2*D3/100'),self.ctx)
        after=item_read(self.username,self.header,1,25,None,None,'[]')['rows'][0]
        self.assertEqual(after['FinalLayerAreaM2'],row['FinalLayerAreaM2'])
        self.assertEqual(after['FinalLayerVolumeM3'],row['FinalLayerVolumeM3'])
        self.assertEqual(after['CartonEfficiencyKGM3'],row['CartonEfficiencyKGM3'])
        self.assertEqual(after['LayerDimensionCaptures'],row['LayerDimensionCaptures'])

    def test_atomic_save_populates_height_recalculates_layers_and_preserves_snapshot(self):
        result=self.preview()
        self.assertEqual(self.save(self.payload(),result,ResponseMaxPalletHeightMM=1900,CartonsPerLayer=10)['results'][0]['Status'],'OK')
        self.assertEqual(tuple(self.cur.execute('SELECT HeightMM,LayersPerPallet FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchone()),(250,7))
        stored=json.loads(self.cur.execute('SELECT SnapshotJSON FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval())
        self.assertEqual(stored['ParentMeasurements']['D3'],'250')
        self.assertEqual(stored['ParentDimension']['ID'],self.dimension)
        for key in ('HeightMM','LayersPerPallet'):
            self.assertGreater(self.cur.execute('SELECT COUNT(*) FROM dbo.PackagingRequestChangeLog WHERE ItemID=? AND FieldName=?',self.req,key).fetchval(),0)

    def test_only_final_layer_height_applies(self):
        result=self.preview(self.payload(LayerCount=3))
        self.assertIsNone(result['FinalLayerHeightMM'])

    def test_intermediate_shipping_area_pricing_does_not_require_unused_height(self):
        result=self.preview(self.payload(LayerCount=3,D3=None))
        self.assertEqual(D(result['components'][0]['Area']),D('.02'))
        self.assertIsNone(result['FinalLayerHeightMM'])
        self.assertIsNone(result['HeightConversion'])

    def test_intermediate_formula_still_requires_referenced_height(self):
        self.cur.execute("UPDATE dbo.PackagingDimension SET ConvertFromParentFormula='D1*D3/1000000' WHERE ID=?",self.override)
        with self.assertRaises(HTTPException) as error:
            self.preview(self.payload(LayerCount=3,D3=None))
        self.assertIn('Height',error.exception.detail)
        self.assertEqual(D(self.preview(self.payload(LayerCount=3))['components'][0]['Area']),D('.05'))

    def test_intermediate_count_pricing_does_not_require_geometry(self):
        self.cur.execute("UPDATE dbo.PackagingType SET PriceBasis='Count' WHERE ID=?",self.child)
        self.cur.execute("UPDATE dbo.PackagingPrice SET PriceBasis='EA' WHERE ID=?",self.price)
        result=self.preview(self.payload(LayerCount=3,DimensionID=None,DimensionRowVersion=None,D1=None,D2=None,D3=None))
        self.assertEqual(D(result['UnitPrice']),D(10000))
        self.assertIsNone(result['FinalLayerHeightMM'])

    def test_shipping_count_pricing_requires_height_only_on_last_layer(self):
        self.cur.execute("UPDATE dbo.PackagingType SET PriceBasis='Count' WHERE ID=?",self.child)
        self.cur.execute("UPDATE dbo.PackagingDimension SET ConvertFromParentFormula='1' WHERE ID=?",self.override)
        self.cur.execute("UPDATE dbo.PackagingPrice SET PriceBasis='EA' WHERE ID=?",self.price)
        with self.assertRaises(HTTPException) as error:
            self.preview(self.payload(D3=None))
        self.assertIn('Height',error.exception.detail)
        self.assertEqual(D(self.preview()['UnitPrice']),D(10000))
        result=self.preview(self.payload(LayerCount=3,D3=None))
        self.assertEqual(D(result['UnitPrice']),D(10000))
        self.assertIsNone(result['FinalLayerHeightMM'])

    def test_last_layer_height_requirement_covers_primary_and_tertiary(self):
        for order,layers in (('Primary',1),('Tertiary',3)):
            with self.subTest(order=order):
                self.cur.execute('INSERT dbo.PackagingTypeOrder(PackagingTypeID,PackagingOrder) VALUES(?,?)',self.root,order)
                with self.assertRaises(HTTPException) as error:
                    self.preview(self.payload(PackagingOrder=order,LayerCount=layers,D3=None))
                self.assertIn('last confirmed packaging layer',error.exception.detail)
                self.assertEqual(D(self.preview(self.payload(PackagingOrder=order,LayerCount=layers))['FinalLayerHeightMM']),D(250))

    def test_omitted_layer_count_uses_confirmed_response_layers(self):
        self.cur.execute('UPDATE dbo.PackagingConfigurationRequestItem SET ResponseLayerCount=3 WHERE ID=?',self.req)
        self.assertIsNone(self.preview(self.payload(LayerCount=None,D3=None))['FinalLayerHeightMM'])
        self.cur.execute('UPDATE dbo.PackagingConfigurationRequestItem SET ResponseLayerCount=2 WHERE ID=?',self.req)
        with self.assertRaises(HTTPException):
            self.preview(self.payload(LayerCount=None,D3=None))

    def test_component_measurements_are_rejected(self):
        payload=self.payload()
        component=payload.components[0].model_copy(update={'D3':D(999)})
        with self.assertRaises(HTTPException) as error:
            self.preview(payload.model_copy(update={'components':[component]}))
        self.assertIn('once on the parent',error.exception.detail)

    def test_height_is_converted_to_mm_and_not_taken_from_volume_output(self):
        dimensions.save(self.definition(ID=self.dimension,RowVersion=self.dim_rv(),D3UoMID=self.units['cm'],
            OccupiedM2Formula='D1*D2/1000000',OccupiedM3Formula='D1*D2*D3/1000000000'),self.ctx)
        result=self.preview(self.payload(D3='25'))
        self.assertEqual(D(result['FinalLayerHeightMM']),D(250))

    def test_parent_changes_do_not_overwrite_child_names_units_or_formulas(self):
        before=self.cur.execute('SELECT ConvertFromParentFormula,ConvertFromSupplierFormula,RowVersion FROM dbo.PackagingDimension WHERE ID=?',self.override).fetchone()
        dimensions.save(self.definition(ID=self.dimension,RowVersion=self.dim_rv(),D1='Outside length',D1UoMID=self.units['cm']),self.ctx)
        after=self.cur.execute('SELECT D1Name,D1UoMID,ConvertFromParentFormula,ConvertFromSupplierFormula,RowVersion FROM dbo.PackagingDimension WHERE ID=?',self.override).fetchone()
        self.assertEqual(after[:4],('Length',self.units['mm'],before[0],before[1]))
        self.assertEqual(after[4],before[2])

    def test_child_save_maintains_independent_geometry(self):
        dimensions.save(self.definition(ID=self.override,RowVersion=self.dim_rv(self.override),
            PackagingTypeID=self.child,ParentDimensionID=self.dimension,ParentDimensionRowVersion=self.dim_rv(),
            D1='Do not maintain here',D3='Gusset',ConvertFromParentFormula='D1*D2/1000000'),self.ctx)
        self.assertEqual(tuple(self.cur.execute('SELECT D1Name,D3Name FROM dbo.PackagingDimension WHERE ID=?',self.override).fetchone()),('Do not maintain here','Gusset'))

    def test_child_conversion_tests_using_inherited_dimensions(self):
        payload=self.definition(PackagingTypeID=self.child,ParentDimensionID=self.dimension,ParentDimensionRowVersion=self.dim_rv(),
            ConvertFromParentFormula='D1*D2/1000000').model_dump(exclude={'ID','RowVersion','Status','FormulaReviewed'})
        result=dimensions.preview_formula(dimensions.FormulaRoleTest(**payload,FormulaRole='ConvertFromParentFormula',TestD1=200,TestD2=100),self.ctx)
        self.assertEqual(D(result['Value']),D('.02'))

    def test_formula_change_invalidates_applied_preview_without_partial_height_save(self):
        payload=self.payload()
        result=self.preview(payload)
        self.cur.execute("UPDATE dbo.PackagingDimension SET OccupiedM2Formula='D1*D2/1000000' WHERE ID=?",self.dimension)
        with self.assertRaises(HTTPException) as error:
            self.save(payload,result)
        self.assertEqual(error.exception.status_code,409)
        self.assertIsNone(self.cur.execute('SELECT HeightMM FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval())
        self.assertEqual(self.cur.execute('SELECT COUNT(*) FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval(),0)

    def test_child_blank_consumption_does_not_inherit_occupied_space(self):
        with self.assertRaises(HTTPException):
            dimensions.save(self.definition(ID=self.override,RowVersion=self.dim_rv(self.override),
                PackagingTypeID=self.child,ParentDimensionID=self.dimension,ParentDimensionRowVersion=self.dim_rv(),
                ConvertFromParentFormula=None),self.ctx)

    def test_shipping_d3_name_cannot_change(self):
        with self.assertRaises(HTTPException):
            dimensions.save(self.definition(ID=self.dimension,RowVersion=self.dim_rv(),D3='Gusset'),self.ctx)

    def test_new_reference_restores_parent_measurements_not_child_measurements(self):
        result=self.preview()
        self.save(self.payload(),result)
        master=self.cur.execute('SELECT ID FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval()
        loaded=pricing.reference(self.req,master,self.root,'Secondary',self.ctx)['input']
        self.assertEqual(loaded['D3'],'250')
        self.assertEqual(loaded['DimensionID'],self.dimension)
        self.assertIsNone(loaded['components'][0]['D3'])
        Calculation(**loaded)

    def test_height_storage_precision_and_range_are_enforced(self):
        for height in ('250.001','10000000000'):
            with self.subTest(height=height),self.assertRaises(HTTPException):
                self.preview(self.payload(D3=height))

    def test_multiple_child_consumption_definitions_require_explicit_selection(self):
        saved=dimensions.save(self.definition(PackagingTypeID=self.child,ParentDimensionID=self.dimension,
            ParentDimensionRowVersion=self.dim_rv(),ConvertFromParentFormula='D1*D2/1000000'),self.ctx)['row']
        with self.assertRaises(HTTPException):self.preview()
        payload=self.payload()
        selected=payload.components[0].model_copy(update={'DimensionID':saved['ID'],'DimensionRowVersion':saved['RowVersion']})
        self.assertEqual(D(self.preview(payload.model_copy(update={'components':[selected]}))['components'][0]['Area']),D('.02'))

if __name__=='__main__':
    unittest.main()
