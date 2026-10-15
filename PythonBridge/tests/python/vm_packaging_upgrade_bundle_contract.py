"""Deployment artifact checks; SQL rerun uses only the local rollback fixture."""
import re
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BUNDLE=ROOT/'sql/deploy/upgrade_105_to_116_vm.sql'
NAMES=sorted(p.name for p in (ROOT/'sql').glob('*.sql') if p.name.split('_')[0].isdigit() and 105<=int(p.name.split('_')[0])<=116)

class BundleContract(unittest.TestCase):
    def test_embedded_sources_match_in_numeric_order(self):
        source=BUNDLE.read_text(encoding='utf-8')
        self.assertEqual(len(NAMES),12)
        self.assertEqual(re.findall(r'-- BEGIN MIGRATION (\S+)',source),NAMES)
        for name in NAMES:
            block=source.split('-- BEGIN MIGRATION '+name+'\n',1)[1].split('-- END MIGRATION '+name,1)[0]
            body=block.split('GO\n',1)[1].rsplit('\nGO\n',1)[0]
            self.assertEqual(body.strip(),(ROOT/'sql'/name).read_text(encoding='utf-8').strip(),name)
    def test_fail_fast_and_no_local_configuration(self):
        source=BUNDLE.read_text(encoding='utf-8')
        self.assertTrue(source.startswith(':on error exit\n'))
        self.assertFalse(re.search(r'^\s*(USE\s|:r\s)',source,re.M|re.I))
        for marker in ('IF @@TRANCOUNT<>0','compatibility_level','Apply migrations through 104','NOT atomic','-- VERIFY UPGRADE','ResponseContainerLoadPlan','PalletPricingSnapshot'):
            self.assertIn(marker,source)
        self.assertNotIn('BUNDLE INSERT POINT',source)
        self.assertFalse(re.search(r'\b(?:TRUNCATE TABLE|DELETE FROM)\b',source,re.I))
        self.assertFalse(re.search(r'\bINSERT\s+(?:INTO\s+)?dbo\.(?:Users|UserAccess)\b',source,re.I))
    def test_handover_explains_data_maintenance_and_safety(self):
        notes=(ROOT/'docs/vm-upgrade-105-to-116.md').read_text(encoding='utf-8')
        for marker in ('migration 104','SQLCMD Mode','not atomic','trusted_proxy','Container Type Master','tare','Back up','webapp/dist/','Excel'):
            self.assertIn(marker,notes)

class BundleRollbackSQL(unittest.TestCase):
    def test_rerunnable_in_existing_local_database_without_duplicate_migration_rows(self):
        import packaging_field_foundation_contract as foundation
        fixture=foundation.PackagingFoundation()
        fixture.setUp()
        try:
            source=BUNDLE.read_text(encoding='utf-8').replace(':on error exit','')
            # One extra fixture transaction protects all schema/data effects during this local test.
            source=source.replace('IF @@TRANCOUNT<>0','IF @@TRANCOUNT<>1')
            totals=[]
            for _ in range(2):
                for batch in re.split(r'^GO\s*$',source,flags=re.M|re.I):
                    if batch.strip():
                        fixture.cur.execute(batch)
                        while fixture.cur.nextset():pass
                self.assertEqual(fixture.cur.execute('SELECT @@TRANCOUNT').fetchval(),1)
                totals.append(fixture.cur.execute('SELECT COUNT(*) FROM dbo.PalletMaterialMigration').fetchval())
            self.assertEqual(totals[0],totals[1])
        finally:
            fixture.doCleanups()
