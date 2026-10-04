"""Separate parent consumption and supplier conversion; fixtures always roll back."""
import json
import unittest
from decimal import Decimal as D
from fastapi import HTTPException
from db import bytes_to_b64
import parent_geometry_contract as parent
import pkg_pricing_api as pricing
import packaging_api as batches
import packaging_dimension_api as dimensions
from packaging_master_excel_api import prepare, sources, Edit, CONFIG
from supplier_geometry import supplier_area
from packaging_master_api import read


class SupplierMath(unittest.TestCase):
    def test_raw_units_and_required_measurements(self):
        definition=dict(D1Name='Length',D2Name='Width',D3Name='Height',SquareMeterFormula='D1*D2/1000000')
        self.assertEqual(supplier_area(definition,dict(D1=1000,D2=500,D3=None)),D('.5'))
        for values in (dict(D1=1000,D2=None),dict(D1=0,D2=500),dict(D1=1000,D2=-5)):
            with self.assertRaises(ValueError):supplier_area(definition,values)


class SupplierSQL(unittest.TestCase):
    cleanup = parent.ParentGeometrySQL.cleanup
    apply = parent.ParentGeometrySQL.apply
    batch = parent.ParentGeometrySQL.batch
    edit = parent.ParentGeometrySQL.edit
    request = parent.ParentGeometrySQL.request
    activate = parent.ParentGeometrySQL.activate
    create_mix = parent.ParentGeometrySQL.create_mix
    save_fields = parent.ParentGeometrySQL.save_fields
    migrate = parent.ParentGeometrySQL.migrate
    definition = parent.ParentGeometrySQL.definition
    dim_rv = parent.ParentGeometrySQL.dim_rv
    payload = parent.ParentGeometrySQL.payload
    preview = parent.ParentGeometrySQL.preview
    save = parent.ParentGeometrySQL.save

    def setUp(self):
        parent.ParentGeometrySQL.setUp(self)
        self.migrate('79_packaging_supplier_geometry.sql')
        self.migrate('79_packaging_supplier_geometry.sql')
        self.cur.execute("UPDATE dbo.PackagingDimension SET ConvertFromSupplierFormula='D1*D2/1000000' WHERE ID=?",self.override)
        self.cur.execute("IF NOT EXISTS(SELECT 1 FROM dbo.UoM WHERE UoMCode='m') INSERT dbo.UoM(UoMCode,CreatedBy) VALUES('m',?); UPDATE dbo.UoM SET Status='Active' WHERE UoMCode='m'",self.actor)
        self.cur.execute("UPDATE dbo.PackagingPrice SET PriceBasis='m' WHERE ID=?",self.price)

    def price_row(self,**extra):
        r=self.cur.execute('SELECT * FROM dbo.PackagingPrice WHERE ID=?',self.price)
        data=dict(zip([c[0] for c in r.description],r.fetchone()))
        return {**{k:data.get(k) for k in ('MaterialID','CurrencyID','PriceBasis','QuantityFrom','QuantityTo','UnitPrice','EffectiveFrom','EffectiveTo','Status','VendorID','ExchangeRateToUSD')},
            'RowNum':1,'Command':'U','ID':self.price,'RowVersion':bytes_to_b64(data['RowVersion']),**extra}

    def maintain(self,**extra):
        row=self.price_row(**{**dict(SupplierDimensionID=self.override,SupplierDimensionRowVersion=self.dim_rv(self.override),
            SupplierD1=1000,SupplierD2=500,SupplierD3=None),**extra})
        result=batches.price_save(batches.PackagingPriceBatch(rows=[row]),self.ctx)['results'][0]
        self.assertEqual(result['Status'],'OK',result)
        return result

    def test_supplier_conversion_is_not_parent_consumption_or_unit_conversion(self):
        self.maintain()
        result=self.preview()
        self.assertEqual(D(result['components'][0]['Area']),D('.02'))
        self.assertEqual(D(result['components'][0]['Factor']),D('.5'))
        self.assertEqual(D(result['UnitPrice']),D(400))
        self.assertEqual(D(result['FinalMOQ']),D(2500))
        self.assertEqual(D(result['FinalLayerHeightMM']),D(250))
        self.assertEqual(result['components'][0]['Conversion']['Measurements'],dict(D1='1000.000000',D2='500.000000',D3=None))
        live=pricing.geometry_preview(self.req,self.payload(),self.ctx)['components'][0]
        self.assertEqual(D(live['Factor']),D('.5'))
        rows=read('prices',1,500,'PG-',None,None,None,None,None,'[]',self.ctx)['rows']
        row=next(r for r in rows if r['ID']==self.price)
        self.assertEqual(D(row['ConversionFactor']),D('.5'))
        self.assertEqual(D(row['BaseUnitPrice']),D(20000))
        self.assertEqual(self.save(self.payload(),result)['results'][0]['Status'],'OK')
        stored=json.loads(self.cur.execute('SELECT SnapshotJSON FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval())
        self.assertEqual(D(stored['components'][0]['Conversion']['Factor']),D('.5'))

    def test_missing_supplier_geometry_does_not_fall_back_to_unit_conversion(self):
        with self.assertRaises(HTTPException) as error:self.preview()
        self.assertIn('Packaging Material Pricing',error.exception.detail)

    def test_formula_change_requires_price_review_and_invalidates_preview(self):
        self.maintain()
        payload=self.payload()
        result=self.preview(payload)
        self.cur.execute("UPDATE dbo.PackagingDimension SET ConvertFromSupplierFormula='D1*D2/2000000' WHERE ID=?",self.override)
        with self.assertRaises(HTTPException) as error:self.save(payload,result)
        self.assertEqual(error.exception.status_code,409)
        self.assertEqual(self.cur.execute('SELECT COUNT(*) FROM dbo.PkgPricingMaster WHERE RequestItemID=?',self.req).fetchval(),0)
        self.maintain()
        self.assertEqual(D(self.preview()['components'][0]['Factor']),D('.25'))

    def test_invalid_supplier_definition_and_partial_values_are_rejected(self):
        for changes in (dict(SupplierD2=None),dict(SupplierDimensionID=self.dimension),dict(SupplierDimensionRowVersion='AAAAAAAAAAE=')):
            row=self.price_row(**{**dict(SupplierDimensionID=self.override,SupplierDimensionRowVersion=self.dim_rv(self.override),
                SupplierD1=1000,SupplierD2=500),**changes})
            with self.assertRaises(HTTPException):batches.price_save(batches.PackagingPriceBatch(rows=[row]),self.ctx)

    def test_old_clients_preserve_geometry_and_explicit_blank_clears(self):
        self.maintain()
        before=tuple(self.cur.execute('SELECT SupplierDimensionID,SupplierD1,SupplierD2,SupplierAreaPerPriceUnit FROM dbo.PackagingPrice WHERE ID=?',self.price).fetchone())
        old=batches.PriceBatch(rows=[self.price_row(UnitPrice=9000)])
        self.assertEqual(batches.price_save(old,self.ctx)['results'][0]['Status'],'OK')
        self.assertEqual(tuple(self.cur.execute('SELECT SupplierDimensionID,SupplierD1,SupplierD2,SupplierAreaPerPriceUnit FROM dbo.PackagingPrice WHERE ID=?',self.price).fetchone()),before)
        clear=batches.PackagingPriceBatch(rows=[self.price_row(SupplierDimensionID=None,SupplierD1=None,SupplierD2=None,SupplierD3=None)])
        self.assertEqual(batches.price_save(clear,self.ctx)['results'][0]['Status'],'OK')
        self.assertIsNone(self.cur.execute('SELECT SupplierAreaPerPriceUnit FROM dbo.PackagingPrice WHERE ID=?',self.price).fetchval())

    def test_m2_quotes_do_not_need_supplier_dimensions(self):
        self.cur.execute("UPDATE dbo.PackagingPrice SET PriceBasis='m2' WHERE ID=?",self.price)
        self.assertEqual(D(self.preview()['components'][0]['Factor']),D(1))
        self.assertEqual(D(self.preview()['UnitPrice']),D(200))

    def test_nonshipping_parent_cannot_maintain_occupied_formulas(self):
        self.cur.execute('UPDATE dbo.PackagingDimension SET OccupiedM2Formula=NULL,OccupiedM3Formula=NULL WHERE ID=?',self.dimension)
        self.cur.execute('UPDATE dbo.PackagingType SET Shipping=0 WHERE ID=?',self.root)
        with self.assertRaises(HTTPException):
            dimensions.save(self.definition(ID=self.dimension,RowVersion=self.dim_rv(),OccupiedM2Formula='D1*D2/2000000'),self.ctx)

    def test_excel_supplier_edits_and_older_unrelated_updates(self):
        source=sources('prices',[self.price],self.ctx)[self.price]
        edit=Edit(row=3,command='U',id=self.price,version=source['RowVersion'],
            changes={'SupplierDimensionID':self.override,'SupplierD1':'1000','SupplierD2':'500'})
        payload=prepare('prices',edit,source,self.ctx)
        self.assertEqual(batches.price_save(payload,self.ctx)['results'][0]['Status'],'OK')
        source=sources('prices',[self.price],self.ctx)[self.price]
        payload=prepare('prices',Edit(row=3,command='U',id=self.price,version=source['RowVersion'],changes={'UnitPrice':'5000'}),source,self.ctx)
        self.assertNotIn('SupplierDimensionID',payload.rows[0].model_fields_set)
        self.assertEqual(batches.price_save(payload,self.ctx)['results'][0]['Status'],'OK')
        self.assertEqual(D(self.preview()['UnitPrice']),D(200))
        self.assertIn('SupplierD1',CONFIG['prices']['editable'])
        self.assertNotIn('SupplierD1',CONFIG['raw-prices']['editable'])
        self.assertNotIn('SupplierAreaPerPriceUnit',CONFIG['prices']['editable'])

    def test_create_and_stale_update_keep_price_geometry_atomic(self):
        self.cur.execute("UPDATE dbo.PackagingPrice SET EffectiveTo='2098-12-31' WHERE ID=?",self.price)
        row=self.price_row(Command='C',ID=None,RowVersion=None,EffectiveFrom='2099-01-01',EffectiveTo=None,
            SupplierDimensionID=self.override,SupplierDimensionRowVersion=self.dim_rv(self.override),SupplierD1='1000',SupplierD2='500')
        result=batches.price_save(batches.PackagingPriceBatch(rows=[row]),self.ctx)['results'][0]
        self.assertEqual(result['Status'],'OK',result)
        self.assertEqual(self.cur.execute('SELECT SupplierAreaPerPriceUnit FROM dbo.PackagingPrice WHERE ID=?',result['NewID']).fetchval(),D('.5'))
        self.maintain()
        stale=self.price_row(UnitPrice=9000)
        self.cur.execute('UPDATE dbo.PackagingPrice SET UnitPrice=10001 WHERE ID=?',self.price)
        result=batches.price_save(batches.PackagingPriceBatch(rows=[stale]),self.ctx)['results'][0]
        self.assertEqual(result['Status'],'ERROR')
        self.assertEqual(self.cur.execute('SELECT UnitPrice FROM dbo.PackagingPrice WHERE ID=?',self.price).fetchval(),D(10001))
        self.assertEqual(self.cur.execute('SELECT SupplierAreaPerPriceUnit FROM dbo.PackagingPrice WHERE ID=?',self.price).fetchval(),D('.5'))

if __name__=='__main__':unittest.main()
