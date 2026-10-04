"""Shipping type contracts; all SQL fixtures and schema changes roll back."""
import json
import unittest
from pydantic import ValidationError
from fastapi import HTTPException
from response_pallet_defaults_contract import ResponsePalletSQL
from db import bytes_to_b64
import packaging_type_api as types
import packaging_dimension_api as dimensions
import packaging_master_excel_api as excel
from uuid import uuid4
from auth import AccessContext


class ShippingSQL(ResponsePalletSQL):
    def setUp(self):
        super().setUp()
        self.migrate('73_packaging_type_shipping.sql')
        self.migrate('73_packaging_type_shipping.sql')
        self.migrate('74_packaging_dimension_volume_formula.sql')
        self.migrate('74_packaging_dimension_volume_formula.sql')
        self.unit=self.cur.execute("SELECT TOP(1) ID FROM dbo.UoM WHERE Status='Active' ORDER BY ID").fetchval()

    def maintain(self, id=None, **fields):
        id=id or self.types['Secondary']
        row=self.cur.execute('SELECT PackagingType,PriceBasis,RowVersion FROM dbo.PackagingType WHERE ID=?',id).fetchone()
        return types.packaging_type_save(types.PackagingTypeBatch(rows=[dict(RowNum=1,Command='U',ID=id,
            RowVersion=bytes_to_b64(row[2]),PackagingType=row[0],PriceBasis=row[1],ParentTypeID=None,
            PackagingOrders=['Secondary'],**fields)]),self.ctx)['results'][0]

    def definition(self, **fields):
        payload=dict(PackagingTypeID=self.types['Secondary'],D1='Length',D2='Width',D3='Height',
            D1UoMID=self.unit,D2UoMID=self.unit,D3UoMID=self.unit,SquareMeterFormula='D1*D2/1000000')
        return dimensions.DimensionSave(**{**payload,**fields})

    def test_shipping_flag_defaults_false_and_only_roots_can_enable(self):
        self.assertFalse(self.cur.execute('SELECT Shipping FROM dbo.PackagingType WHERE ID=?',self.types['Secondary']).fetchval())
        self.assertEqual(self.maintain(Shipping=True)['Status'],'OK')
        self.assertTrue(self.cur.execute('SELECT Shipping FROM dbo.PackagingType WHERE ID=?',self.types['Secondary']).fetchval())
        with self.assertRaises(ValidationError):
            types.PackagingTypeRow(RowNum=1,Command='C',ParentTypeID=self.types['Primary'],Shipping=True,PackagingType='Child',PriceBasis='Count')
        for value in ('true',1,None):
            with self.assertRaises(ValidationError): types.PackagingTypeRow(RowNum=1,Command='C',Shipping=value,PackagingOrders=['Secondary'],PackagingType='Root',PriceBasis='Count')

    def test_shipping_count_dimensions_require_all_three_and_offer_area(self):
        self.assertEqual(self.maintain(Shipping=True)['Status'],'OK')
        saved=dimensions.save(self.definition(),self.ctx)['row']
        self.assertGreater(saved['ID'],0)
        self.assertEqual(self.cur.execute('SELECT SquareMeterFormula FROM dbo.PackagingDimension WHERE ID=?',saved['ID']).fetchval(),'D1*D2/1000000')
        preview=dimensions.preview(dimensions.DimensionTest(**self.definition().model_dump(exclude={'ID','RowVersion','Status','FormulaReviewed'}),TestD1=200,TestD2=100),self.ctx)
        self.assertEqual(preview['CalculationStatus'],'Ready');self.assertEqual(float(preview['SquareMeters']),0.02)

    def test_shipping_dimension_rejects_missing_third_dimension(self):
        self.assertEqual(self.maintain(Shipping=True)['Status'],'OK')
        with self.assertRaises(HTTPException) as error:
            dimensions.save(self.definition(D3=None,D3UoMID=None),self.ctx)
        self.assertEqual(error.exception.status_code,422)

    def test_volume_formula_shipping_save_preview_legacy_update_and_clear(self):
        self.assertEqual(self.maintain(Shipping=True)['Status'],'OK')
        definition=self.definition(VolumeFormula='D1*D2*D3/1000000000',SquareMeterFormula=None)
        saved=dimensions.save(definition,self.ctx)['row']
        preview=dimensions.preview_volume(dimensions.VolumeTest(**definition.model_dump(exclude={'ID','RowVersion','Status','FormulaReviewed'}),TestD1='200',TestD2='100',TestD3='50'),self.ctx)
        self.assertEqual(preview['CalculationStatus'],'Ready');self.assertEqual(preview['CubicMeters'],'0.001000000')
        version=saved['RowVersion']
        old_client=self.definition(ID=saved['ID'],RowVersion=version,D1='Overall length',SquareMeterFormula=None)
        updated=dimensions.save(old_client,self.ctx)['row']
        self.assertEqual(self.cur.execute('SELECT VolumeFormula FROM dbo.PackagingDimension WHERE ID=?',saved['ID']).fetchval(),'D1*D2*D3/1000000000')
        dimensions.save(self.definition(ID=saved['ID'],RowVersion=updated['RowVersion'],VolumeFormula=None),self.ctx)
        self.assertIsNone(self.cur.execute('SELECT VolumeFormula FROM dbo.PackagingDimension WHERE ID=?',saved['ID']).fetchval())

    def test_volume_formula_non_shipping_preview_and_save_rejected(self):
        definition=self.definition(VolumeFormula='D1*D2*D3/1000000000')
        preview=dimensions.preview_volume(dimensions.VolumeTest(**definition.model_dump(exclude={'ID','RowVersion','Status','FormulaReviewed'}),TestD1=200,TestD2=100,TestD3=50),self.ctx)
        self.assertIsNone(preview['CubicMeters']);self.assertIn('Shipping',preview['CalculationStatus'])
        with self.assertRaises(HTTPException) as error:dimensions.save(definition,self.ctx)
        self.assertEqual(error.exception.status_code,422)

    def test_volume_formula_validation_and_shipping_disabled_preserves_history(self):
        for formula in ('D1**3','D4*D1','__import__(1)','123','D1; DROP TABLE dbo.PackagingType'):
            with self.assertRaises(ValidationError):self.definition(VolumeFormula=formula)
        with self.assertRaises(ValidationError):dimensions.VolumeTest(**self.definition(VolumeFormula='D1*D2*D3').model_dump(exclude={'ID','RowVersion','Status','FormulaReviewed'}),TestD1=1,TestD2=1)
        self.assertEqual(self.maintain(Shipping=True)['Status'],'OK')
        saved=dimensions.save(self.definition(VolumeFormula='D1*D2*D3'),self.ctx)['row']
        self.assertEqual(self.maintain(Shipping=False)['Status'],'OK')
        dimensions.save(self.definition(ID=saved['ID'],RowVersion=saved['RowVersion'],VolumeFormula=None),self.ctx)
        self.assertEqual(self.cur.execute('SELECT VolumeFormula FROM dbo.PackagingDimension WHERE ID=?',saved['ID']).fetchval(),'D1*D2*D3')

    def test_final_request_type_requires_shipping_but_intermediate_type_does_not(self):
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Canceled',IsOpen=0 WHERE ID=?",self.req)
        self.save_fields(WebPackagingRequirements=True,SecondaryTypeID=None)
        self.cur.execute("UPDATE dbo.PackagingType SET Shipping=1 WHERE ID=?",self.types['Primary'])
        self.cur.execute("INSERT dbo.PackagingTypeOrder VALUES(?,'Tertiary')",self.types['Primary'])
        with self.assertRaisesRegex(Exception,'Shipping type'):
            self.save_fields(WebPackagingRequirements=True,SecondaryTypeID=self.types['Secondary'],PackagingLayerCount=2)
        self.save_fields(WebPackagingRequirements=True,PackagingLayerCount=3,SecondaryTypeID=self.types['Secondary'],TertiaryTypeID=self.types['Primary'])
        self.assertEqual(self.cur.execute('SELECT TertiaryTypeID FROM dbo.OpportunityItem WHERE ID=?',self.item).fetchval(),self.types['Primary'])

    def test_non_shipping_response_rejected_for_new_final_selection(self):
        name=self.cur.execute('SELECT PackagingType FROM dbo.PackagingType WHERE ID=?',self.types['Secondary']).fetchval()
        self.cur.execute('UPDATE dbo.PackagingConfigurationRequestItem SET SecondPMType=NULL WHERE ID=?',self.req)
        version=self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval()
        with self.assertRaisesRegex(Exception,'Shipping type'):
            self.cur.execute('EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save ?,?,?,?,0',self.username,self.req,version,json.dumps({'SecondPMType':name}))
        self.assertEqual(self.maintain(Shipping=True)['Status'],'OK')
        self.save(SecondPMType=name)

    def test_shipping_lookup_and_omitted_flag_preserves_current_setting(self):
        self.assertEqual(self.maintain(Shipping=True)['Status'],'OK')
        self.assertEqual(self.maintain()['Status'],'OK')
        rows=self.cur.execute('EXEC dbo.usp_OpportunityPackagingTypeLookup_Read ?',self.username).fetchall()
        keys=[column[0] for column in self.cur.description]
        row=next(dict(zip(keys,row)) for row in rows if row[0]==self.types['Secondary'])
        self.assertTrue(row['Shipping'])

    def test_create_shipping_root_and_excel_boolean_updates(self):
        created=types.packaging_type_save(types.PackagingTypeBatch(rows=[dict(RowNum=1,Command='C',
            PackagingType='SHIPPING-'+uuid4().hex[:16],PackagingOrders=['Secondary'],PriceBasis='Count',Shipping=True)]),self.ctx)['results'][0]
        self.assertEqual(created['Status'],'OK',created)
        type_id=created['NewID']
        def update(changes):
            version=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingType WHERE ID=?',type_id).fetchval())
            return excel.save('packaging-types',excel.Batch(rows=[dict(row=3,command='U',id=type_id,version=version,changes=changes)]),self.ctx)['results'][0]
        self.assertEqual(update({'PriceBasis':'Volume'})['Status'],'OK')
        self.assertTrue(self.cur.execute('SELECT Shipping FROM dbo.PackagingType WHERE ID=?',type_id).fetchval())
        self.assertEqual(update({'Shipping':'False'})['Status'],'OK')
        self.assertFalse(self.cur.execute('SELECT Shipping FROM dbo.PackagingType WHERE ID=?',type_id).fetchval())
        self.assertEqual(update({'Shipping':'True'})['Status'],'OK')
        self.assertEqual(update({'Shipping':'Yes'})['Status'],'ERROR')
        parent=self.cur.execute('SELECT PackagingType FROM dbo.PackagingType WHERE ID=?',self.types['Primary']).fetchval()
        self.assertEqual(update({'ParentType':parent})['Status'],'OK')
        self.assertFalse(self.cur.execute('SELECT Shipping FROM dbo.PackagingType WHERE ID=?',type_id).fetchval())
        self.assertEqual(update({'Shipping':'True'})['Status'],'ERROR')

    def test_existing_incomplete_dimensions_block_enabling_shipping(self):
        dimensions.save(self.definition(D3=None,D3UoMID=None),self.ctx)
        self.assertEqual(self.maintain(Shipping=True)['Status'],'ERROR')

    def test_child_shipping_is_rejected_by_database(self):
        with self.assertRaises(Exception):
            self.cur.execute('UPDATE dbo.PackagingType SET ParentTypeID=?,Shipping=1 WHERE ID=?',self.types['Primary'],self.types['Secondary'])


if __name__=='__main__': unittest.main()
