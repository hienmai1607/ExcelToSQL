"""Height-based pallet layers: exact math, atomic SQL saves, audits and legacy data."""
import json
import unittest
from pydantic import ValidationError
import response_pallet_defaults_contract as foundation
from packing_way import packing_way, pallet_layers


class LayerMath(unittest.TestCase):
    def test_formula_and_boundaries(self):
        for maximum,height,expected in ((1900,'250',7),(1900,'250.01',6),
            (999999999,'499999924.51',1),(150,'1',0),(1900,'2000',0)):
            self.assertEqual(pallet_layers(dict(ResponseMaxPalletHeightMM=maximum,HeightMM=height)),expected)
        self.assertEqual(pallet_layers(dict(LayersPerPallet=5)),5)
        for height in ('0','-1','NaN','oops'):
            self.assertIsNone(pallet_layers(dict(ResponseMaxPalletHeightMM=1900,HeightMM=height)))
        self.assertIsNone(pallet_layers(dict(HeightMM=250)))
        self.assertIsNone(pallet_layers(dict(ResponseMaxPalletHeightMM=999999999,HeightMM='0.01')))

    def test_downstream_counts_use_calculated_layers(self):
        row=packing_way(dict(ResponseLayerCount=2,WeightGrams=10,UnitsPerCarton=12,
            CartonsPerLayer=10,LayersPerPallet=999,ResponseMaxPalletHeightMM=1900,HeightMM=250))
        self.assertEqual((row['LayersPerPallet'],row['UnitsPerPallet'],row['NetWeightPerPalletKG']),(7,'840','8.4'))


class PalletLayerSQL(foundation.ResponsePalletSQL):
    def setUp(self):
        super().setUp()
        self.migrate('76_packaging_pallet_layers.sql')
        self.migrate('76_packaging_pallet_layers.sql')

    def row(self):
        return tuple(self.cur.execute('SELECT ResponseMaxPalletHeightMM,HeightMM,LayersPerPallet FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchone())

    def test_save_recompute_reload_and_audit(self):
        self.save(ResponseMaxPalletHeightMM=1900,HeightMM='250',CartonsPerLayer=10)
        self.assertEqual(self.row(),(1900,250,7))
        self.save(ResponseMaxPalletHeightMM=2000)
        self.assertEqual(self.row(),(2000,250,7))
        self.save(HeightMM='250.01')
        self.assertEqual(self.row()[2],7)
        self.save(ResponseMaxPalletHeightMM=1900)
        self.assertEqual(self.row()[2],6)
        from request_views import item_read
        read=item_read(self.username,self.header,1,25,None,None,'[]')['rows'][0]
        self.assertEqual((read['LayersPerPallet'],read['UnitsPerPallet']),(6,'720'))
        for field in ('HeightMM','LayersPerPallet'):
            self.assertGreater(self.cur.execute('SELECT COUNT(*) FROM dbo.PackagingRequestChangeLog WHERE ItemID=? AND FieldName=? AND ChangedBy=?',self.req,field,self.username).fetchval(),0)

    def test_exact_large_boundary_and_no_fit(self):
        self.save(ResponseMaxPalletHeightMM=999999999,HeightMM='499999924.51')
        self.assertEqual(self.row()[2],1)
        self.save(ResponseMaxPalletHeightMM=150)
        self.assertEqual(self.row()[2],0)

    def test_existing_height_clients_and_manual_count_cannot_override_formula(self):
        self.save(ResponseMaxPalletHeightMM=1900,HeightMM='250.0000',LayersPerPallet=999)
        self.assertEqual(self.row(),(1900,250,7))
        self.save(LayersPerPallet=999)
        self.assertEqual(self.row(),(1900,250,7))

    def test_legacy_counts_preserved_then_geometry_clear_removes_count(self):
        self.save(LayersPerPallet=5)
        self.save(ResponseMaxPalletHeightMM=1900)
        self.assertEqual(self.row()[2],5)
        self.save(HeightMM=250)
        self.assertEqual(self.row()[2],7)
        self.save(HeightMM=None)
        self.assertIsNone(self.row()[2])
        self.save(HeightMM=250)
        self.save(ResponseMaxPalletHeightMM=None)
        self.assertIsNone(self.row()[2])

    def test_layer_change_requires_height_reconfirmation(self):
        self.save(HeightMM=250)
        self.save(ResponseLayerCount=1)
        self.assertEqual(self.row()[1:],(None,None))

    def test_validation(self):
        for height in (0,-1,'1.001','NaN'):
            with self.assertRaises(ValidationError):self.save(HeightMM=height)
        for height in ('0','-1','1.001','oops',True):
            version=self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval()
            with self.assertRaisesRegex(Exception,'Height must be positive'):
                self.cur.execute('EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save ?,?,?,?,0',self.username,self.req,version,json.dumps({'HeightMM':height}))
        with self.assertRaises(Exception):self.save(ResponseMaxPalletHeightMM=999999999,HeightMM='0.01')


if __name__=='__main__':unittest.main()
