"""Current pallet dimensions supply request choices; all fixtures roll back."""
import json
import unittest
from decimal import Decimal as D
import packaging_weight_contract as weight
import packaging_field_foundation_contract as foundation
from db import bytes_to_b64

class PalletChoices(unittest.TestCase):
    cleanup=foundation.PackagingFoundation.cleanup
    request=foundation.PackagingFoundation.request
    material=weight.WeightSQL.material
    def setUp(self):
        weight.WeightSQL.setUp(self)
        for _ in range(2):
            self.cur.execute((foundation.ROOT/'sql/114_pallet_dimension_choices.sql').read_text())
            while self.cur.nextset():pass
        self.baseline={r[0] for r in self.cur.execute("SELECT PalletSize FROM dbo.v_PalletSizeChoice WHERE ChoiceSource='Material'").fetchall()}
        self.width=D(800)
        while f'1200x{self.width}mm' in self.baseline:self.width+=1
        self.size=f'1200x{self.width}mm'
        self.decimal_width=self.width+D('.125')
        while f'1165.25x{self.decimal_width}mm' in self.baseline:self.decimal_width+=D('.001')
        self.cur.execute("UPDATE dbo.PackagingType SET PackagingOrder='Pallet',CopyDim=1,Shipping=0 WHERE ID=?",self.type)
        material=self.material()
        self.mid=material['NewID']
        mm=self.cur.execute("SELECT TOP(1) ID FROM dbo.UoM WHERE UoMCode='mm' AND Status='Active'").fetchval()
        self.dim=self.cur.execute("INSERT dbo.PackagingDimension(PackagingTypeID,D1Name,D2Name,D3Name,D1UoMID,D2UoMID,D3UoMID,CreatedBy) VALUES(?,'Width','Length','Height',?,?,?,?); SELECT CONVERT(INT,SCOPE_IDENTITY())",self.type,mm,mm,mm,self.actor).fetchval()
        currency=self.cur.execute("SELECT TOP(1) ID FROM dbo.Currency WHERE CurrencyCode='USD'").fetchval()
        self.price=self.cur.execute("INSERT dbo.PackagingPrice(MaterialID,CurrencyID,PriceBasis,QuantityFrom,UnitPrice,EffectiveFrom,CreatedBy,MaterialDimensionID,MaterialDimensionRowVersion,MaterialD1,MaterialD2,MaterialD3) VALUES(?,?,'EA',1,10,'2020-01-01',?,?,(SELECT RowVersion FROM dbo.PackagingDimension WHERE ID=?),?,1200,140); SELECT CONVERT(INT,SCOPE_IDENTITY())",self.mid,currency,self.actor,self.dim,self.dim,self.width).fetchval()
    def choices(self):
        import packaging_api as api
        return [r for r in api.lookups(self.ctx)['pallets'] if r['PalletSize'] not in self.baseline]
    def test_named_dimensions_and_deduplication(self):
        rows=self.choices()
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['PalletSize'],self.size)
        self.assertEqual(D(rows[0]['LengthMM']),1200)
        self.assertEqual(D(rows[0]['WidthMM']),self.width)
        self.assertEqual(D(rows[0]['PalletAreaMM2']),1200*self.width)
        self.cur.execute("INSERT dbo.PackagingPrice(MaterialID,CurrencyID,PriceBasis,QuantityFrom,UnitPrice,EffectiveFrom,CreatedBy,MaterialDimensionID,MaterialDimensionRowVersion,MaterialD1,MaterialD2,MaterialD3) SELECT MaterialID,CurrencyID,PriceBasis,2,UnitPrice,EffectiveFrom,CreatedBy,MaterialDimensionID,MaterialDimensionRowVersion,MaterialD1,MaterialD2,MaterialD3 FROM dbo.PackagingPrice WHERE ID=?",self.price)
        self.assertEqual(len(self.choices()),1)
        self.cur.execute('EXEC dbo.usp_OpportunityPalletLookup_Read ?',self.username)
        names=[c[0] for c in self.cur.description];values=[dict(zip(names,r)) for r in self.cur.fetchall()]
        self.assertEqual([r['PalletSize'] for r in values if r['PalletSize'] not in self.baseline],['1200x800mm'])
    def test_conversions_stale_dimension_and_unavailable_prices(self):
        self.cur.execute("UPDATE dbo.PackagingMaterial SET Status='Block' WHERE ID=?",self.mid)
        self.assertEqual(self.choices(),[])
        self.cur.execute("UPDATE dbo.PackagingMaterial SET Status='Active' WHERE ID=?",self.mid)
        self.cur.execute("UPDATE dbo.PackagingPrice SET EffectiveTo='2020-01-01' WHERE ID=?",self.price)
        self.assertEqual(self.choices(),[])
        self.cur.execute("UPDATE dbo.PackagingPrice SET EffectiveTo=NULL WHERE ID=?",self.price)
        self.cur.execute("UPDATE dbo.PackagingDimension SET D1Name='Width' WHERE ID=?",self.dim)
        self.assertEqual(self.choices(),[])
    def test_new_size_saves_and_area_is_available(self):
        import packaging_api as api
        from request_views import item_read
        row=dict(RowNum=1,ID=self.req,RowVersion=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval()),ResponsePalletSize='1200x800mm')
        self.assertEqual(api.response_save(api.ResponseBatch(rows=[row]),self.ctx)['results'][0]['Status'],'OK')
        header=self.cur.execute('SELECT RequestID FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval()
        actual=item_read(self.username,header,1,25,None,None,'[]')['rows'][0]
        self.assertEqual(actual['ResponsePalletSize'],'1200x800mm')
        self.assertEqual(D(actual['ResponsePalletAreaMM2']),1200*self.width)
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Canceled',IsOpen=0 WHERE ID=?",self.req)
        version=self.cur.execute('SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?',self.item).fetchval()
        self.cur.execute('EXEC dbo.usp_OpportunityItem_Fields_Save ?,?,?,?,0',self.username,self.item,version,json.dumps(dict(PalletSize='1200x800mm',ContainerRequest='20DC')))
        while self.cur.nextset():pass
        self.assertEqual(self.cur.execute('SELECT PalletSize FROM dbo.OpportunityItem WHERE ID=?',self.item).fetchval(),'1200x800mm')

    def test_measurement_units_convert_to_mm(self):
        unit=self.cur.execute("INSERT dbo.UoM(UoMCode,CreatedBy) VALUES('PAL-CM-TEST',?); SELECT CONVERT(INT,SCOPE_IDENTITY())",self.actor).fetchval()
        mm=self.cur.execute("SELECT TOP(1) ID FROM dbo.UoM WHERE UoMCode='mm'").fetchval()
        self.cur.execute('INSERT dbo.UnitConversion(FromUoMID,ToUoMID,Factor,CreatedBy) VALUES(?,?,10,?)',unit,mm,self.actor)
        self.cur.execute('UPDATE dbo.PackagingDimension SET D1UoMID=?,D2UoMID=? WHERE ID=?',unit,unit,self.dim)
        self.cur.execute('UPDATE dbo.PackagingPrice SET MaterialD1=?,MaterialD2=120,MaterialDimensionRowVersion=(SELECT RowVersion FROM dbo.PackagingDimension WHERE ID=?) WHERE ID=?',self.width/10,self.dim,self.price)
        self.assertEqual(self.choices()[0]['PalletSize'],'1200x800mm')
        self.cur.execute('UPDATE dbo.PackagingPrice SET MaterialD1=?,MaterialD2=116.525 WHERE ID=?',self.decimal_width/10,self.price)
        self.assertEqual(self.choices()[0]['PalletSize'],f'1165.25x{self.decimal_width}mm')
