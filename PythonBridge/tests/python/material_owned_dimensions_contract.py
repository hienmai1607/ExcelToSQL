"""Material-owned dimensions and Palletization eligibility; local fixtures roll back."""
import json
import unittest
from contextlib import contextmanager
from unittest.mock import patch
from decimal import Decimal
from fastapi import HTTPException
import packaging_field_foundation_contract as foundation
from auth import AccessContext
from db import bytes_to_b64
import packaging_api as api
import pkg_pricing_api as pricing
import pallet_pricing_api as pallets
from packaging_type_api import PackagingTypeBatch,PackagingTypeRow,packaging_type_save

class MaterialDimensionsSQL(unittest.TestCase):
    cleanup=foundation.PackagingFoundation.cleanup
    request=foundation.PackagingFoundation.request
    def setUp(self):
        foundation.PackagingFoundation.setUp(self)
        for name in ('117_clearance_per_container.sql','118_material_owned_dimensions.sql','119_palletization_material_selection.sql'):
            self.cur.execute((foundation.ROOT/'sql'/name).read_text(encoding='utf-8'))
            while self.cur.nextset():pass
        self.ctx=AccessContext(self.actor,self.username,frozenset({'Admin'}))
        @contextmanager
        def cursor():yield self.cur
        mock=patch.object(api,'get_raw_cursor',cursor);mock.start();self.addCleanup(mock.stop)
        self.mm=self.cur.execute("SELECT ID FROM dbo.UoM WHERE UoMCode='MM'").fetchval()
        self.currency=self.cur.execute("SELECT ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval()
    def type(self,name,order='Primary',copy=True):
        if name=='Pallet':
            existing=self.cur.execute("SELECT ID FROM dbo.PackagingType WHERE PackagingType='Pallet' AND PackagingOrder='Pallet'").fetchval()
            if existing:return existing
        result=packaging_type_save(PackagingTypeBatch(rows=[PackagingTypeRow(RowNum=1,Command='C',PackagingType=name,PackagingOrders=[order],FinalComponent=True,CopyDim=copy,Status='Active')]),self.ctx)['results'][0]
        self.assertEqual(result['Status'],'OK',result)
        return result['NewID']
    def dimension(self,kind):
        identity=self.cur.execute("""INSERT dbo.PackagingDimension(PackagingTypeID,D1Name,D2Name,D3Name,D1UoMID,D2UoMID,D3UoMID,CreatedBy,FormulaNeedsReview,OccupiedFormulaNeedsReview)
            VALUES(?,'Length','Width','Height',?,?,?, ?,0,0); SELECT CONVERT(INT,SCOPE_IDENTITY())""",kind,self.mm,self.mm,self.mm,self.actor).fetchval()
        return identity,bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingDimension WHERE ID=?',identity).fetchval())
    def material(self,kind,dimension=None,tare='20'):
        fields=dict(RowNum=1,Command='C',PackagingTypeID=kind,MaterialName='Material-owned geometry',UnitOfMeasure='EA',TareWeight=tare,TareWeightBasis='kg/EA')
        if dimension:fields.update(MaterialDimensionID=dimension[0],MaterialDimensionRowVersion=dimension[1],MaterialD1='1200',MaterialD2='800',MaterialD3='140')
        result=api.material_save(api.MaterialBatch(rows=[fields]),self.ctx)['results'][0]
        self.assertEqual(result['Status'],'OK',result)
        return result
    def price(self,material,**more):
        fields=dict(RowNum=1,Command='C',MaterialID=material,CurrencyID=self.currency,PriceBasis='EA',QuantityFrom=1,UnitPrice='10',EffectiveFrom='2020-01-01',Status='Active')
        fields.update(more)
        result=api.price_save(api.PackagingPriceBatch(rows=[fields]),self.ctx)['results'][0]
        self.assertEqual(result['Status'],'OK',result)
        return result
    def test_material_dimensions_feed_all_prices_and_cannot_be_edited_in_pricing(self):
        kind=self.type('Material geometry test')
        dimension=self.dimension(kind)
        material=self.material(kind,dimension)
        quote=self.price(material['NewID'])
        self.assertEqual(self.cur.execute('SELECT MaterialD1 FROM dbo.PackagingPrice WHERE ID=?',quote['NewID']).fetchval(),1200)
        self.cur.execute('UPDATE dbo.PackagingMaterial SET MaterialD1=1100 WHERE ID=?',material['NewID'])
        _,_,_,_,rows=pricing.catalog(self.cur,kind,'Primary')
        row=next(r for r in rows if r['PriceID']==quote['NewID'])
        self.assertEqual(row['MaterialD1'],1100)
        self.assertEqual(row['SupplierD1'],1100)
        self.assertEqual(row['DimensionsSource'],'Material')
        with self.assertRaises(HTTPException):self.price(material['NewID'],MaterialD1=100)
        with self.assertRaises(HTTPException):self.price(material['NewID'],SupplierD1=100)
    def test_wrong_type_and_stale_dimension_are_rejected(self):
        first=self.type('First dimension owner');other=self.type('Other dimension owner')
        dimension=self.dimension(first)
        with self.assertRaises(HTTPException):self.material(other,dimension)
        stale=(dimension[0],bytes_to_b64(bytes(8)))
        with self.assertRaises(HTTPException) as error:self.material(first,stale)
        self.assertEqual(error.exception.status_code,409)

    def test_migrations_are_repeatable(self):
        for name in ('117_clearance_per_container.sql','118_material_owned_dimensions.sql','119_palletization_material_selection.sql'):
            self.cur.execute((foundation.ROOT/'sql'/name).read_text(encoding='utf-8'))
            while self.cur.nextset():pass
        self.assertIsNotNone(self.cur.execute("SELECT COL_LENGTH('dbo.PackagingMaterial','MaterialD1')").fetchval())

    def test_only_palletization_materials_are_eligible_and_only_type_pallet_is_base(self):
        base=self.type('Pallet','Pallet')
        material=self.material(base,self.dimension(base))
        quote=self.price(material['NewID'])
        accessory=self.material(self.type('Rigid corner','Pallet',False),tare='1')
        accessory_price=self.price(accessory['NewID'])
        other=self.material(self.type('Other non-palletization','Primary',False),tare='1')
        self.price(other['NewID'])
        rows=pallets.catalog(self.cur)
        chosen=next(r for r in rows if r['ID']==quote['NewID'])
        added=next(r for r in rows if r['ID']==accessory_price['NewID'])
        self.assertTrue(chosen['IsPallet']);self.assertFalse(added['IsPallet'])
        self.assertNotIn(other['NewID'],{r['MaterialID'] for r in rows})
        selection=pallets.Selection(PalletSize='1200x800mm',PalletMaterialID=material['NewID'],components=[
            dict(PriceID=r['ID'],RowVersion=r['RowVersion'],MaterialRowVersion=r['MaterialRowVersion'],Quantity=1) for r in (chosen,added)])
        result=pallets.calculate(self.cur,selection)
        self.assertEqual(Decimal(result['TareKG']),21)
        self.assertEqual(result['PalletMaterialID'],material['NewID'])
