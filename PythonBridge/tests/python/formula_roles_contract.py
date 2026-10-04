"""Four independent formula roles; live SQL fixtures always roll back."""
import json
import unittest
from decimal import Decimal as D
from fastapi import HTTPException
from pydantic import ValidationError
from dimension_formula import conversion_formula
from packaging_efficiency import geometry_metrics
from supplier_geometry import supplier_area
from pkg_pricing import component_cost
import packaging_dimension_api as dimensions
import parent_geometry_contract as parent
import supplier_geometry_contract as supplier
from db import bytes_to_b64


class FormulaRoles(unittest.TestCase):
    def test_occupied_space_is_not_material_consumption(self):
        definition=dict(Shipping=True,ParentDimensionID=None,OccupiedM2Formula='D1*D2/1000000',
            OccupiedM3Formula='D1*D2*D3/1000000000',SquareMeterFormula='(D2*2+25)*D1/1000000')
        self.assertEqual(geometry_metrics(definition,dict(D1=200,D2=100,D3=250)),
            {'AreaM2':D('.02'),'VolumeM3':D('.005')})
        for changes in (dict(Shipping=False),dict(ParentDimensionID=1),dict(OccupiedFormulaNeedsReview=True)):
            self.assertEqual(geometry_metrics({**definition,**changes},dict(D1=200,D2=100,D3=250)),
                {'AreaM2':None,'VolumeM3':None})

    def test_blank_occupied_area_never_falls_back_to_legacy_consumption(self):
        self.assertIsNone(geometry_metrics(dict(Shipping=True,OccupiedM2Formula=None,
            OccupiedM3Formula=None,SquareMeterFormula='D1*D2'),dict(D1=200,D2=100))['AreaM2'])

    def test_supplier_formula_never_inherits_occupied_or_parent_conversion(self):
        with self.assertRaises(ValueError):
            supplier_area(dict(ConvertFromSupplierFormula=None,SquareMeterFormula='D1*D2',
                ConvertFromParentFormula='D1*D2'),dict(D1=200,D2=100))

    def test_count_constants_and_safe_conversion_parser(self):
        self.assertEqual(conversion_formula('1',{}),D(1))
        self.assertEqual(conversion_formula('10',{}),D(10))
        for formula in ('0','-1','D1/0','D1**2','__import__(1)'):
            with self.subTest(formula=formula),self.assertRaises(ValueError):
                conversion_formula(formula,dict(D1=D(2)))

    def test_user_cost_formula_applies_n_once(self):
        consumption,price,moq=component_cost(D(10000),D(100),D(2),D('.5'),D('.045'))
        self.assertEqual(consumption,D('.18'))
        self.assertEqual(price,D(1800))
        self.assertEqual(moq,D(556))

    def test_role_input_validates_formula_variables(self):
        values=dict(PackagingTypeID=1,D1='Length',D1UoMID=1)
        dimensions.DimensionSave(**values,ConvertFromParentFormula='1')
        with self.assertRaises(ValidationError):
            dimensions.DimensionSave(**values,ConvertFromParentFormula='D2*D1')
        with self.assertRaises(ValidationError):
            dimensions.DimensionSave(**values,OccupiedM2Formula='1')

    def test_child_parent_formula_does_not_require_supplier_dimension_names(self):
        dimensions.DimensionSave(PackagingTypeID=2,ParentDimensionID=1,
            ParentDimensionRowVersion='AAAAAAAAAAE=',D1='Roll width',D1UoMID=1,
            ConvertFromParentFormula='D1*D3/1000000',ConvertFromSupplierFormula='D1/1000')
        with self.assertRaises(ValidationError):
            dimensions.DimensionSave(PackagingTypeID=2,ParentDimensionID=1,
                ParentDimensionRowVersion='AAAAAAAAAAE=',D1='Roll width',D1UoMID=1,
                ConvertFromSupplierFormula='D1*D3/1000000')


class FormulaRolesSQL(unittest.TestCase):
    cleanup=parent.ParentGeometrySQL.cleanup
    apply=parent.ParentGeometrySQL.apply
    batch=parent.ParentGeometrySQL.batch
    edit=parent.ParentGeometrySQL.edit
    request=parent.ParentGeometrySQL.request
    activate=parent.ParentGeometrySQL.activate
    create_mix=parent.ParentGeometrySQL.create_mix
    save_fields=parent.ParentGeometrySQL.save_fields
    migrate=parent.ParentGeometrySQL.migrate
    definition=parent.ParentGeometrySQL.definition
    dim_rv=parent.ParentGeometrySQL.dim_rv
    payload=parent.ParentGeometrySQL.payload
    preview=parent.ParentGeometrySQL.preview
    save=parent.ParentGeometrySQL.save
    price_row=supplier.SupplierSQL.price_row
    maintain=supplier.SupplierSQL.maintain

    def setUp(self):
        parent.ParentGeometrySQL.setUp(self)
        self.cur.execute("UPDATE dbo.PackagingDimension SET ConvertFromParentFormula='(D2*2+25)*D1/1000000',ConvertFromSupplierFormula='D1*D2/1000000' WHERE ID=?",self.override)
        self.cur.execute("IF NOT EXISTS(SELECT 1 FROM dbo.UoM WHERE UoMCode='m') INSERT dbo.UoM(UoMCode,CreatedBy) VALUES('m',?); UPDATE dbo.UoM SET Status='Active' WHERE UoMCode='m'",self.actor)
        self.cur.execute("UPDATE dbo.PackagingPrice SET PriceBasis='m' WHERE ID=?",self.price)

    def test_child_consumption_supplier_factor_and_shipping_space_are_independent(self):
        self.maintain()
        result=self.preview()
        self.assertEqual(D(result['components'][0]['Area']),D('.045'))
        self.assertEqual(D(result['components'][0]['Factor']),D('.5'))
        self.assertEqual(D(result['UnitPrice']),D(900))
        self.assertEqual(D(result['FinalMOQ']),D(1112))
        self.assertEqual(result['ParentGeometryMetrics'],{'AreaM2':'0.020000000','VolumeM3':'0.005000000'})
        self.assertEqual(D(result['FinalLayerHeightMM']),D(250))

    def independent_child(self):
        return self.definition(ID=self.override,RowVersion=self.dim_rv(self.override),
            PackagingTypeID=self.child,ParentDimensionID=self.dimension,
            ParentDimensionRowVersion=self.dim_rv(),D1='Roll width',D1UoMID=self.units['cm'],
            D2=None,D2UoMID=None,D3=None,D3UoMID=None,
            ConvertFromParentFormula='D1*D3/1000000',ConvertFromSupplierFormula='D1/100')

    def test_child_supplier_names_units_and_optional_dimensions_are_independent(self):
        dimensions.save(self.independent_child(),self.ctx)
        self.maintain(SupplierD1=50,SupplierD2=None,SupplierD3=None)
        result=self.preview()
        self.assertEqual(D(result['components'][0]['Area']),D('.05'))
        self.assertEqual(D(result['components'][0]['Factor']),D('.5'))
        self.assertEqual(D(result['UnitPrice']),D(1000))
        self.assertEqual(D(result['FinalLayerHeightMM']),D(250))
        child=self.cur.execute('SELECT D1Name,D1UoMID,D2Name,D3Name FROM dbo.PackagingDimension WHERE ID=?',self.override).fetchone()
        self.assertEqual(tuple(child),('Roll width',self.units['cm'],None,None))
        self.assertEqual(self.save(self.payload(),result)['results'][0]['Status'],'OK')
        snapshot=json.loads(self.cur.execute('SELECT SnapshotJSON FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval())
        line=snapshot['components'][0]
        self.assertEqual(line['Dimension']['ConsumptionDimension']['D3Name'],'Height')
        self.assertEqual(line['Conversion']['Dimension']['D1Name'],'Roll width')

    def test_independent_formula_previews_use_correct_definition_metadata(self):
        values=self.independent_child().model_dump(exclude={'ID','RowVersion','Status','FormulaReviewed'})
        consumption=dimensions.preview_formula(dimensions.FormulaRoleTest(**values,
            FormulaRole='ConvertFromParentFormula',TestD1=200,TestD3=250),self.ctx)
        supply=dimensions.preview_formula(dimensions.FormulaRoleTest(**values,
            FormulaRole='ConvertFromSupplierFormula',TestD1=50),self.ctx)
        self.assertEqual(D(consumption['Value']),D('.05'))
        self.assertEqual(D(supply['Value']),D('.5'))

    def test_parent_metadata_changes_do_not_invalidate_supplier_quote(self):
        dimensions.save(self.independent_child(),self.ctx)
        self.maintain(SupplierD1=50,SupplierD2=None,SupplierD3=None)
        child_rv=self.dim_rv(self.override)
        dimensions.save(self.definition(ID=self.dimension,RowVersion=self.dim_rv(),D1='External length'),self.ctx)
        self.assertEqual(self.dim_rv(self.override),child_rv)
        result=self.preview()
        self.assertEqual(D(result['components'][0]['Factor']),D('.5'))
        self.assertEqual(D(result['UnitPrice']),D(1000))

    def test_parent_formula_preview_rejects_stale_link(self):
        values=self.independent_child().model_dump(exclude={'ID','RowVersion','Status','FormulaReviewed'})
        dimensions.save(self.definition(ID=self.dimension,RowVersion=self.dim_rv(),D1='External length'),self.ctx)
        with self.assertRaises(HTTPException) as error:
            dimensions.preview_formula(dimensions.FormulaRoleTest(**values,
                FormulaRole='ConvertFromParentFormula',TestD1=200,TestD3=250),self.ctx)
        self.assertEqual(error.exception.status_code,409)

    def test_parent_formula_variables_must_exist_on_parent_not_child(self):
        self.cur.execute('UPDATE dbo.PackagingDimension SET OccupiedM2Formula=NULL,OccupiedM3Formula=NULL WHERE ID=?',self.dimension)
        self.cur.execute('UPDATE dbo.PackagingType SET Shipping=0 WHERE ID=?',self.root)
        dimensions.save(self.definition(ID=self.dimension,RowVersion=self.dim_rv(),
            D3=None,D3UoMID=None),self.ctx)
        child=self.definition(ID=self.override,RowVersion=self.dim_rv(self.override),
            PackagingTypeID=self.child,ParentDimensionID=self.dimension,
            ParentDimensionRowVersion=self.dim_rv(),D3='Supplier gusset',
            ConvertFromParentFormula='D1*D3/1000000')
        with self.assertRaises(HTTPException):dimensions.save(child,self.ctx)
        values=child.model_dump(exclude={'ID','RowVersion','Status','FormulaReviewed'})
        with self.assertRaises(HTTPException) as error:
            dimensions.preview_formula(dimensions.FormulaRoleTest(**values,
                FormulaRole='ConvertFromParentFormula',TestD1=200,TestD3=250),self.ctx)
        self.assertEqual(error.exception.status_code,422)

    def test_occupied_changes_do_not_change_component_cost(self):
        self.maintain()
        before=self.preview()
        dimensions.save(self.definition(ID=self.dimension,RowVersion=self.dim_rv(),
            OccupiedM2Formula='D1*D2/2000000',OccupiedM3Formula='D1*D2*D3/2000000000'),self.ctx)
        self.maintain()
        after=self.preview()
        self.assertEqual(before['UnitPrice'],after['UnitPrice'])
        self.assertEqual(after['ParentGeometryMetrics'],{'AreaM2':'0.010000000','VolumeM3':'0.002500000'})
        self.assertNotEqual(before['Fingerprint'],after['Fingerprint'])

    def test_consumption_changes_do_not_change_occupied_space(self):
        self.maintain()
        before=self.preview()
        self.cur.execute("UPDATE dbo.PackagingDimension SET ConvertFromParentFormula='D1*D2/1000000' WHERE ID=?",self.override)
        self.maintain()
        after=self.preview()
        self.assertEqual(D(after['UnitPrice']),D(400))
        self.assertEqual(before['ParentGeometryMetrics'],after['ParentGeometryMetrics'])

    def test_new_snapshots_capture_both_child_formulas_and_independent_measurements(self):
        self.maintain()
        result=self.preview()
        self.assertEqual(self.save(self.payload(),result)['results'][0]['Status'],'OK')
        snapshot=json.loads(self.cur.execute('SELECT SnapshotJSON FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval())
        line=snapshot['components'][0]
        self.assertEqual(line['Dimension']['ConvertFromParentFormula'],'(D2*2+25)*D1/1000000')
        self.assertEqual(line['Conversion']['Dimension']['ConvertFromSupplierFormula'],'D1*D2/1000000')
        self.assertEqual(D(snapshot['ParentMeasurements']['D1']),D(200))
        self.assertEqual(D(line['Conversion']['Measurements']['D1']),D(1000))
        self.cur.execute("UPDATE dbo.PackagingDimension SET ConvertFromParentFormula='D1*D2/2000000' WHERE ID=?",self.override)
        self.assertEqual(json.loads(self.cur.execute('SELECT SnapshotJSON FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval()),snapshot)

    def test_changed_child_formula_blocks_stale_apply_without_partial_writes(self):
        self.maintain()
        payload=self.payload()
        result=self.preview(payload)
        self.cur.execute("UPDATE dbo.PackagingDimension SET ConvertFromParentFormula='D1*D2/2000000' WHERE ID=?",self.override)
        with self.assertRaises(HTTPException) as error:self.save(payload,result)
        self.assertEqual(error.exception.status_code,409)
        self.assertEqual(self.cur.execute('SELECT COUNT(*) FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval(),0)
        self.assertIsNone(self.cur.execute('SELECT HeightMM FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval())

    def test_missing_supplier_formula_does_not_use_parent_or_unit_conversion(self):
        self.cur.execute('UPDATE dbo.PackagingDimension SET ConvertFromSupplierFormula=NULL WHERE ID=?',self.override)
        with self.assertRaises(HTTPException):self.maintain()

    def test_wrong_formula_roles_are_rejected(self):
        with self.assertRaises(HTTPException):
            dimensions.save(self.definition(ID=self.dimension,RowVersion=self.dim_rv(),ConvertFromParentFormula='D1'),self.ctx)
        with self.assertRaises(HTTPException):
            dimensions.save(self.definition(ID=self.override,RowVersion=self.dim_rv(self.override),
                PackagingTypeID=self.child,ParentDimensionID=self.dimension,ParentDimensionRowVersion=self.dim_rv(),
                ConvertFromParentFormula='D1',OccupiedM2Formula='D1*D2/1000000'),self.ctx)

    def test_count_conversion_uses_pieces_per_price_unit(self):
        self.cur.execute("UPDATE dbo.PackagingType SET PriceBasis='Count' WHERE ID=?",self.child)
        self.cur.execute("UPDATE dbo.PackagingDimension SET ConvertFromParentFormula='1',ConvertFromSupplierFormula='10' WHERE ID=?",self.override)
        self.cur.execute("IF NOT EXISTS(SELECT 1 FROM dbo.UoM WHERE UoMCode='BOX') INSERT dbo.UoM(UoMCode,CreatedBy) VALUES('BOX',?); UPDATE dbo.UoM SET Status='Active' WHERE UoMCode='BOX'",self.actor)
        self.cur.execute("UPDATE dbo.PackagingPrice SET PriceBasis='BOX' WHERE ID=?",self.price)
        self.maintain(SupplierD1=None,SupplierD2=None)
        payload=self.payload()
        payload.components[0].Quantity=D(2)
        self.assertEqual(D(self.preview(payload)['UnitPrice']),D(2000))

    def test_last_shipping_layer_only_requires_height(self):
        self.maintain()
        self.assertIsNone(self.preview(self.payload(LayerCount=3,D3=None))['FinalLayerHeightMM'])
        with self.assertRaises(HTTPException):self.preview(self.payload(D3=None))

    def test_migration_rerun_is_idempotent_and_preserves_requests_and_pricing(self):
        self.maintain()
        dims=list(self.cur.execute('SELECT ID,RowVersion,OccupiedM2Formula,ConvertFromParentFormula FROM dbo.PackagingDimension ORDER BY ID'))
        history=list(self.cur.execute('SELECT ID,RowVersion FROM dbo.PackagingConfigurationRequestItem ORDER BY ID'))
        prices=list(self.cur.execute('SELECT ID,RowVersion FROM dbo.PackagingPrice ORDER BY ID'))
        self.migrate('81_packaging_child_dimensions.sql')
        self.assertEqual(list(self.cur.execute('SELECT ID,RowVersion,OccupiedM2Formula,ConvertFromParentFormula FROM dbo.PackagingDimension ORDER BY ID')),dims)
        self.assertEqual(list(self.cur.execute('SELECT ID,RowVersion FROM dbo.PackagingConfigurationRequestItem ORDER BY ID')),history)
        self.assertEqual(list(self.cur.execute('SELECT ID,RowVersion FROM dbo.PackagingPrice ORDER BY ID')),prices)


if __name__=='__main__':unittest.main()
