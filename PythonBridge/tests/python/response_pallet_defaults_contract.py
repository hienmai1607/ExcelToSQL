"""Response defaults and pallet specs; SQL migrations and fixtures roll back."""
import json
import re
import unittest
from pydantic import ValidationError
import web_requirement_sections_contract as foundation
from packing_way import packing_way, INT_MAX
from db import bytes_to_b64
import packaging_api as api
from request_views import item_read


class PalletMath(unittest.TestCase):
    def test_units_across_all_layers_without_product_weight(self):
        for layers, expected in ((1, '50'), (2, '600'), (3, '3000')):
            self.assertEqual(packing_way(dict(ResponseLayerCount=layers, UnitsPerCarton=12,
                UnitsPerTertiary=5, CartonsPerLayer=10, LayersPerPallet=5,
                ConfigurationRequest='Floor load'))['UnitsPerPallet'], expected)
        self.assertIsNone(packing_way(dict(ResponseLayerCount=3, UnitsPerCarton=12,
            CartonsPerLayer=10, LayersPerPallet=5))['UnitsPerPallet'])
        self.assertEqual(packing_way(dict(ResponseLayerCount=3, UnitsPerCarton=INT_MAX,
            UnitsPerTertiary=INT_MAX, CartonsPerLayer=INT_MAX, LayersPerPallet=INT_MAX))['UnitsPerPallet'], str(INT_MAX**4))


class ResponsePalletSQL(unittest.TestCase):
    cleanup = foundation.WebRequirementSections.cleanup
    apply = foundation.WebRequirementSections.apply
    request = foundation.WebRequirementSections.request
    save_fields = foundation.WebRequirementSections.save_fields

    def setUp(self):
        foundation.WebRequirementSections.setUp(self)
        for name in ('68_packaging_child_components.sql','69_packing_way.sql',
                     '70_packaging_container_load.sql','71_packaging_request_layer_details.sql',
                     '72_packaging_response_pallet_defaults.sql'):
            self.migrate(name)
        self.migrate('72_packaging_response_pallet_defaults.sql')
        self.save_fields(ConfigurationRequest='Floor load', PrimaryTypeID=self.types['Primary'], SecondaryTypeID=self.types['Secondary'],
            NumberOfPrimary=12, PalletSize='Legacy pallet', PalletStacking='Double', MaxPalletHeightMM=1800)
        created=self.request([self.item]);self.req=created['items'][0]['ID'];self.header=created['header']['ID']
        self.cur.execute('UPDATE dbo.PackagingConfigurationRequestItem SET PICUserID=? WHERE ID=?',self.actor,self.req)
        # Valid floor count for fixtures now that Floor/Both require a manual entry.
        self.cur.execute('UPDATE dbo.PackagingConfigurationRequestItem SET CartonsPerContainerFloor=100 WHERE ID=?',self.req)

    def migrate(self, name):
        source=(foundation.mix.foundation.ROOT/'sql'/name).read_text(encoding='utf-8')
        for batch in re.split(r'^GO\s*$', source, flags=re.M|re.I):
            if batch.strip():
                self.cur.execute(batch)
                while self.cur.nextset(): pass
        self.cur.execute('SET XACT_ABORT OFF')

    def save(self, **fields):
        version=bytes_to_b64(self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval())
        result=api.response_save(api.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,RowVersion=version,**fields)]),self.ctx)
        self.assertEqual(result['results'][0]['Status'],'OK',result)

    def test_creation_copies_requested_defaults_once(self):
        row=item_read(self.username,self.header,1,25,None,None,'[]')['rows'][0]
        self.assertEqual(row['FirstPMType'],self.cur.execute('SELECT PackagingType FROM dbo.PackagingType WHERE ID=?',self.types['Primary']).fetchval())
        self.assertEqual(row['UnitsPerCarton'],12)
        self.assertEqual((row['ResponsePalletSize'],row['ResponsePalletStacking'],row['ResponseMaxPalletHeightMM']),('Legacy pallet','Double',1800))
        self.assertTrue(row['ResponseDefaultsInitialized'])

    def test_independent_response_pallet_fields_and_audit_on_floor_load(self):
        self.save(ResponsePalletSize='Legacy pallet',ResponsePalletStacking='Single',ResponseMaxPalletHeightMM=1500)
        row=self.cur.execute('SELECT PalletStacking,MaxPalletHeightMM,ResponsePalletStacking,ResponseMaxPalletHeightMM FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchone()
        self.assertEqual(tuple(row),('Double',1800,'Single',1500))
        self.assertGreater(self.cur.execute("SELECT COUNT(*) FROM dbo.PackagingRequestChangeLog WHERE ItemID=? AND FieldName='ResponseMaxPalletHeightMM' AND ChangedBy=?",self.req,self.username).fetchval(),0)

    def test_clear_and_rerun_do_not_restore_defaults(self):
        self.save(ResponsePalletSize=None,ResponsePalletStacking=None,ResponseMaxPalletHeightMM=None)
        self.migrate('72_packaging_response_pallet_defaults.sql')
        row=self.cur.execute('SELECT ResponsePalletSize,ResponsePalletStacking,ResponseMaxPalletHeightMM,ResponseDefaultsInitialized FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchone()
        self.assertEqual(tuple(row),(None,None,None,True))

    def test_validation_and_approved_lock_remain(self):
        for height in (0,-1,'1.5',1000000000):
            with self.assertRaises(ValidationError): self.save(ResponseMaxPalletHeightMM=height)
        version=self.cur.execute('SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?',self.req).fetchval()
        with self.assertRaisesRegex(Exception,'Single or Double'):
            self.cur.execute('EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save ?,?,?,?,0',self.username,self.req,version,json.dumps({'ResponsePalletStacking':'Triple'}))
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Approved',IsOpen=0 WHERE ID=?",self.req)
        with self.assertRaises(Exception): self.save(ResponseMaxPalletHeightMM=1600)


if __name__=='__main__': unittest.main()
