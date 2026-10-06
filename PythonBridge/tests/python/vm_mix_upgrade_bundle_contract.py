"""VM SQL bundle identity and SQL Server rollback-only validation."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NAMES = ("86_mix_parent_logistics.sql", "87_mix_packaging_type_orders.sql", "88_mix_same_config.sql")
BUNDLE = ROOT / "sql/deploy/upgrade_086_to_088_vm.sql"

def sections():
    source = BUNDLE.read_text(encoding="utf-8")
    result = []
    for name in NAMES:
        block = source.split("-- BEGIN MIGRATION " + name + "\n", 1)[1].split("-- END MIGRATION " + name, 1)[0]
        block = block.split("GO\n", 1)[1]
        result.append(block)
    return source, result

def execute(cursor, source):
    for batch in re.split(r"^GO\s*$", source, flags=re.M | re.I):
        if batch.strip():
            cursor.execute(batch)
            while cursor.nextset():
                pass

class BundleContract(unittest.TestCase):
    def test_combined_sections_match_sources_except_local_database_directives(self):
        source, blocks = sections()
        self.assertEqual(source.count("-- BEGIN MIGRATION "), 3)
        self.assertEqual(re.findall(r"-- BEGIN MIGRATION (\S+)", source), list(NAMES))
        for name, block in zip(NAMES, blocks):
            original = (ROOT / "sql" / name).read_text(encoding="utf-8")
            expected = re.sub(r"^USE \[test\];\nGO\n", "", original)
            self.assertEqual(block.strip(), expected.strip(), name)
        self.assertFalse(re.search(r"^\s*USE\s", source, re.M | re.I))
        self.assertFalse(re.search(r"^\s*:r\s", source, re.M | re.I))
        self.assertTrue(source.startswith(":on error exit\n"))
        self.assertIn("Apply migrations through 85", source)
        self.assertIn("-- VERIFY UPGRADE", source)

class BundleSQL(unittest.TestCase):
    def test_existing_database_rerun_preserves_request_and_history_versions(self):
        from db import get_raw_cursor
        source, blocks = sections()
        preflight = source.split("-- BEGIN MIGRATION ", 1)[0].replace(":on error exit\n", "", 1)
        verification = source.split("-- VERIFY UPGRADE\n", 1)[1]
        with get_raw_cursor() as cursor:
            execute(cursor, preflight)
            before = list(cursor.execute("SELECT ID,RowVersion FROM dbo.PackagingConfigurationRequestItem ORDER BY ID"))
            history = cursor.execute("SELECT COUNT_BIG(*) FROM dbo.PackagingRequestChangeLog").fetchval()
            try:
                cursor.execute("BEGIN TRANSACTION")
                for _ in range(2):
                    for block in blocks:
                        execute(cursor, block)
                self.assertEqual(cursor.execute("SELECT @@TRANCOUNT").fetchval(), 1)
                self.assertEqual(before, list(cursor.execute("SELECT ID,RowVersion FROM dbo.PackagingConfigurationRequestItem ORDER BY ID")))
                self.assertEqual(history, cursor.execute("SELECT COUNT_BIG(*) FROM dbo.PackagingRequestChangeLog").fetchval())
            finally:
                cursor.execute("IF @@TRANCOUNT>0 ROLLBACK")
            # Production verification runs on a clean connection, after our test rollback.
            execute(cursor, verification)
            self.assertEqual(before, list(cursor.execute("SELECT ID,RowVersion FROM dbo.PackagingConfigurationRequestItem ORDER BY ID")))

if __name__ == "__main__":
    unittest.main()
