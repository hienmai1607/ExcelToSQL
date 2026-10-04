"""Rollback-only dry run of the specifically authorized local PET jar consolidation."""
import json
import re
import sys
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'core'))
from db import get_raw_cursor


class PETJarMerge(unittest.TestCase):
    def test_merge_is_rerunnable_and_preserves_references_and_snapshots(self):
        with get_raw_cursor() as cur:
            cur.execute('SET QUOTED_IDENTIFIER ON; BEGIN TRANSACTION')
            try:
                material_before=list(cur.execute('SELECT ID,PackagingTypeID FROM dbo.PackagingMaterial WHERE PackagingTypeID IN(74033,74034,74035,74036)'))
                pricing_before=list(cur.execute('SELECT ID,PackagingTypeID,SnapshotJSON FROM dbo.PkgPricingMaster WHERE PackagingTypeID=74032'))
                source=(ROOT/'sql/data/merge_pet_jar_16_into_74032.sql').read_text(encoding='utf-8')
                for _ in range(2):
                    for batch in re.split(r'^GO\s*$',source,flags=re.M|re.I):
                        if batch.strip():
                            cur.execute(batch)
                            while cur.nextset():pass
                canonical=cur.execute("SELECT PackagingType,Shipping,Status FROM dbo.PackagingType WHERE ID=74032").fetchone()
                self.assertEqual(tuple(canonical),('PET jar',True,'Active'))
                self.assertEqual({r[0] for r in cur.execute('SELECT PackagingOrder FROM dbo.PackagingTypeOrder WHERE PackagingTypeID=74032')},{'Primary','Secondary'})
                self.assertEqual(cur.execute('SELECT PackagingTypeID FROM dbo.PackagingDimension WHERE ID=37112').fetchval(),74032)
                self.assertEqual(cur.execute("SELECT COUNT(*) FROM dbo.PackagingType WHERE ID IN(16,210,211) AND Status='Block'").fetchval(),3)
                self.assertEqual(list(cur.execute('SELECT ID,PackagingTypeID FROM dbo.PackagingMaterial WHERE PackagingTypeID IN(74033,74034,74035,74036)')),material_before)
                self.assertEqual(list(cur.execute('SELECT ID,PackagingTypeID,SnapshotJSON FROM dbo.PkgPricingMaster WHERE PackagingTypeID=74032')),pricing_before)
                before=json.loads(cur.execute("SELECT BeforeJSON FROM dbo.PackagingTypeMergeLog WHERE MergeKey=N'PET jar 16 into 74032'").fetchval())
                self.assertEqual(len(before['Types']),4)
                self.assertEqual(before['Dimensions'][0]['PackagingTypeID'],16)
            finally:
                cur.execute('IF @@TRANCOUNT>0 ROLLBACK TRANSACTION')


if __name__=='__main__':unittest.main()
