"""Exact source embedding plus desktop rollback-only SQL rerun validation."""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'core'))
NAMES = ('138_shipment_customer_currency.sql', '139_shared_loss_types.sql',
         '140_mix_child_others_info.sql', '141_grade_process_loss_master.sql')
BUNDLE = ROOT / 'sql/deploy/upgrade_138_to_141_vm.sql'

def sections():
    source = BUNDLE.read_text(encoding='utf-8')
    blocks = []
    for name in NAMES:
        block = source.split('-- BEGIN MIGRATION '+name+'\n', 1)[1].split('-- END MIGRATION '+name, 1)[0]
        blocks.append(block.split('GO\n', 1)[1].removesuffix('GO\n'))
    return source, blocks

def execute(cursor, sql):
    for batch in re.split(r'^GO\s*$', sql, flags=re.M | re.I):
        if batch.strip():
            cursor.execute(batch)
            while cursor.nextset():
                pass

class BundleContract(unittest.TestCase):
    def test_sections_exactly_match_ordered_sources(self):
        source, blocks = sections()
        self.assertEqual(re.findall(r'-- BEGIN MIGRATION (\S+)', source), list(NAMES))
        for name, block in zip(NAMES, blocks):
            self.assertEqual(block.strip(), (ROOT / 'sql' / name).read_text(encoding='utf-8').strip(), name)

    def test_target_guards_and_no_destructive_data_operations(self):
        source, _ = sections()
        self.assertTrue(source.startswith(':on error exit\n'))
        self.assertFalse(re.search(r'^\s*(USE\s|:r\s)', source, re.M | re.I))
        self.assertFalse(re.search(r'\b(TRUNCATE\s+TABLE|DELETE\s+FROM|DROP\s+TABLE)\b', source, re.I))
        for text in ('DB_NAME() IN', 'compatibility_level', 'IF @@TRANCOUNT<>0',
                     'Apply migrations through 137', 'NOT atomic', 'historical records are retained'):
            self.assertIn(text, source)

    def test_final_verification_covers_all_four_migrations(self):
        source, _ = sections()
        verify = source.split('-- VERIFY UPGRADE\n', 1)[1]
        for marker in ('(138)', '@Shared', '(140)', '(141)', 'usp_GradeProcessLoss_Save',
                       'UX_GradeProcessLoss_Grade', 'UX_GradeProcessLoss_All'):
            self.assertIn(marker, verify)

class BundleSQL(unittest.TestCase):
    def test_rerun_twice_preserves_business_rows_and_versions(self):
        import db
        self.assertEqual(db.DB_NAME, 'test')
        self.assertIn(db.DB_SERVER.lower(), ('desktop-5bgmjsc', 'localhost', '.'))
        source, blocks = sections()
        preflight = source.split('-- BEGIN MIGRATION ', 1)[0].replace(':on error exit\n', '', 1)
        verify = source.split('-- VERIFY UPGRADE\n', 1)[1]
        tables = ('Opportunity', 'OpportunityItem', 'Customer', 'Product', 'RawGrade',
                  'RawMaterial', 'RawMaterialPrice', 'PackagingType', 'PackagingDimension',
                  'PackagingMaterial', 'PackagingPrice', 'LossProcessMaster',
                  'GradeProcessLossMaster', 'PackagingConfigurationRequestItem')
        with db.get_raw_cursor() as cursor:
            execute(cursor, preflight)
            before = {table: list(cursor.execute('SELECT ID,RowVersion FROM dbo.['+table+'] ORDER BY ID')) for table in tables}
            try:
                cursor.execute('BEGIN TRANSACTION')
                for _ in range(2):
                    for block in blocks:
                        execute(cursor, block)
                self.assertEqual(cursor.execute('SELECT @@TRANCOUNT').fetchval(), 1)
                for table in tables:
                    self.assertEqual(before[table], list(cursor.execute('SELECT ID,RowVersion FROM dbo.['+table+'] ORDER BY ID')), table)
            finally:
                cursor.execute('IF @@TRANCOUNT>0 ROLLBACK TRANSACTION')
            execute(cursor, verify)
            for table in tables:
                self.assertEqual(before[table], list(cursor.execute('SELECT ID,RowVersion FROM dbo.['+table+'] ORDER BY ID')), table)

if __name__ == '__main__':
    unittest.main()
