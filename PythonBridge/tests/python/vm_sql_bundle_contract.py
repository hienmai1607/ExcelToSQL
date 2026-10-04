"""Read-only checks for the standalone VM upgrade artifact."""
import hashlib
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
BUNDLE = ROOT / "sql/deploy/upgrade_045_to_085_vm.sql"


class VMSQLBundle(unittest.TestCase):
    def setUp(self):
        self.text = BUNDLE.read_text(encoding="utf-8")
        self.sources = sorted(
            path for path in (ROOT / "sql").glob("*.sql")
            if re.match(r"^(\d{2})_", path.name)
            and 45 <= int(path.name[:2]) <= 85
        )

    def test_all_new_migrations_are_embedded_exactly_in_order(self):
        names = re.findall(r"^-- BEGIN MIGRATION (\S+)$", self.text, re.M)
        self.assertEqual([int(path.name[:2]) for path in self.sources], list(range(45, 86)))
        self.assertEqual(names, [path.name for path in self.sources])
        for path in self.sources:
            with self.subTest(migration=path.name):
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                body = re.sub(r"(?im)^\s*USE\s+\[test\]\s*;?\s*$", "",
                              path.read_text(encoding="utf-8")).strip()
                section = (f"-- BEGIN MIGRATION {path.name}\n-- SOURCE SHA256 {digest}\n"
                           f"PRINT N'Applying {path.name}';\nGO\n{body}\nGO\n"
                           f"-- END MIGRATION {path.name}")
                self.assertIn(section, self.text)

    def test_portable_target_and_fail_fast_execution(self):
        self.assertTrue(self.text.startswith(":on error exit\n"))
        self.assertIsNone(re.search(r"(?im)^\s*USE\s+", self.text))
        self.assertIsNone(re.search(r"(?im)^\s*:r\b", self.text))
        self.assertNotIn("__BUNDLE_APPEND_POINT__", self.text)
        self.assertIn("migrations through 44", self.text)
        self.assertIn("DB_NAME() IN (N'master',N'model',N'msdb',N'tempdb')", self.text)
        self.assertIn("IF @@TRANCOUNT<>0", self.text)

    def test_latest_fix_is_included_without_local_data_scripts(self):
        self.assertIn("SET @ContainerPalletHeightScaled=@Height*100;", self.text)
        self.assertIn("SET @D=REPLACE(@D,N'@ContainerPalletHeightScaled',N'@ContainerShippingHeightScaled');", self.text)
        self.assertIn("-- Shipping height container layers.", self.text)
        self.assertNotIn("PET jar 16 into 74032", self.text)
        self.assertNotIn("TRUNCATE TABLE", self.text.upper())
        self.assertIn("The whole bundle is NOT atomic", self.text)


if __name__ == "__main__":
    unittest.main()
