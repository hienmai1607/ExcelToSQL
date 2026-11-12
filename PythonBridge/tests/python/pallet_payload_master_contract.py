"""Desktop rollback checks: pallet master edits must not validate historical loads."""
import sys
import unittest
from pathlib import Path
from decimal import Decimal

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'core'))
from auth import AccessContext
from db import get_raw_cursor, reuse_transaction, bytes_to_b64, DB_NAME, DB_SERVER
from packaging_api import MaterialBatch, material_save
from fastapi import HTTPException


class PalletPayloadMaster(unittest.TestCase):
    def setUp(self):
        self.assertEqual(DB_NAME, 'test', 'Rollback fixtures are desktop-only.')
        self.assertIn(DB_SERVER.lower(), ('desktop-5bgmjsc', 'localhost', '.'))
        self.connection = get_raw_cursor()
        self.cur = self.connection.__enter__()
        self.addCleanup(lambda: self.connection.__exit__(None, None, None))
        self.cur.execute('SET NOCOUNT ON; BEGIN TRANSACTION')
        self.shared = reuse_transaction(self.cur.connection)
        self.shared.__enter__()
        self.addCleanup(lambda: self.shared.__exit__(None, None, None))
        self.addCleanup(lambda: self.cur.execute('IF @@TRANCOUNT>0 ROLLBACK TRANSACTION'))
        actor, username = self.cur.execute("""SELECT TOP(1) u.ID,u.UserName
          FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID
          WHERE a.Scope='Admin' AND u.IsActive=1 ORDER BY u.ID""").fetchone()
        self.ctx = AccessContext(actor, username, frozenset({'Admin'}))
        row = self.cur.execute("""SELECT TOP(1) i.ID,m.ID FROM dbo.PackagingConfigurationRequestItem i
          JOIN dbo.PalletPricingSnapshot s ON s.ID=i.PalletPricingID
          JOIN dbo.PackagingMaterial m ON m.ID=TRY_CONVERT(INT,JSON_VALUE(s.SnapshotJSON,'$.PalletMaterialID'))
          WHERE i.Stage='Approved' AND i.CartonsPerLayer>0 AND i.LayersPerPallet>0
          AND i.ResponseMaxPalletHeightMM>0 ORDER BY i.ID DESC""").fetchone()
        self.assertIsNotNone(row, 'A retained approved pallet response is required.')
        self.item_id, self.material_id = row
        # A legacy response may have counts outside today's height/payload rule.
        self.cur.execute('UPDATE dbo.PackagingConfigurationRequestItem SET LoadPlanID=NULL,LayersPerPallet=2147483647 WHERE ID=?', self.item_id)

    def save(self, payload):
        return material_save(MaterialBatch(rows=[self.payload(payload)]), self.ctx)

    def payload(self, payload):
        row = self.cur.execute('SELECT MaterialName,UnitOfMeasure,Status,RowVersion FROM dbo.PackagingMaterial WHERE ID=?', self.material_id).fetchone()
        return dict(RowNum=1, Command='U', ID=self.material_id,
            MaterialName=row[0], UnitOfMeasure=row[1], Status=row[2], RowVersion=bytes_to_b64(row[3]),
            MaxPayloadKG=payload)

    def captures(self):
        responses = [tuple(r) for r in self.cur.execute("""SELECT i.ID,i.RowVersion,i.LoadPlanID,i.LayersPerPallet,s.ID,s.SnapshotJSON
          FROM dbo.PackagingConfigurationRequestItem i JOIN dbo.PalletPricingSnapshot s ON s.ID=i.PalletPricingID
          WHERE i.ResponsePalletMaterialID=? OR TRY_CONVERT(INT,JSON_VALUE(s.SnapshotJSON,'$.PalletMaterialID'))=?
          ORDER BY i.ID""", self.material_id, self.material_id).fetchall()]
        plans = [tuple(r) for r in self.cur.execute('SELECT ID,Inputs,Result FROM dbo.ContainerLoadPlan WHERE ItemID=? ORDER BY ID', self.item_id).fetchall()]
        return responses, plans

    def test_save_1200_payload_despite_legacy_response_layer_counts(self):
        before = self.captures()
        result = self.save(Decimal('1200'))
        self.assertEqual(result['results'][0]['Status'], 'OK', result)
        self.assertEqual(self.cur.execute('SELECT MaxPayloadKG FROM dbo.PackagingMaterial WHERE ID=?', self.material_id).fetchval(), Decimal('1200'))
        self.assertEqual(before, self.captures())
        self.assertEqual(self.cur.execute('SELECT @@TRANCOUNT').fetchval(), 1)

    def test_lower_rating_saves_without_rewriting_approved_snapshots(self):
        before = self.captures()
        result = self.save(Decimal('1000'))
        self.assertEqual(result['results'][0]['Status'], 'OK', result)
        self.assertEqual(self.cur.execute('SELECT MaxPayloadKG FROM dbo.PackagingMaterial WHERE ID=?', self.material_id).fetchval(), Decimal('1000'))
        self.assertEqual(before, self.captures())

    def test_inline_master_uses_the_same_save_rule(self):
        from inline_master_api import InlineSave, save
        before = self.captures()
        result = save('materials', str(self.material_id), InlineSave(payload={'rows':[self.payload('1200')]}), self.ctx)
        self.assertEqual(Decimal(str(result['row']['MaxPayloadKG'])), Decimal('1200'))
        self.assertEqual(before, self.captures())

    def test_response_submission_still_rejects_invalid_layer_counts(self):
        from pallet_capacity_api import validate_saved_pallets
        with self.assertRaises(HTTPException) as error:
            validate_saved_pallets(self.cur, [self.item_id], complete=True)
        self.assertEqual(error.exception.status_code, 422)
        self.assertEqual(error.exception.detail, 'Layers / pallet exceed maximum height or maximum gross payload.')

    def test_pallet_master_still_requires_a_payload(self):
        with self.assertRaises(HTTPException) as error:
            self.save(None)
        self.assertEqual(error.exception.status_code, 422)
        self.assertIn('Maintain maximum gross payload', error.exception.detail)


if __name__ == '__main__':
    unittest.main()
