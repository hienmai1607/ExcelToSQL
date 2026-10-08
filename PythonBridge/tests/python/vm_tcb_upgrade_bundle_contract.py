"""Read-only deployment artifact checks; does not execute migrations."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUNDLE = ROOT / "sql/deploy/upgrade_089_to_096_vm.sql"
NAMES = (
    "89_opportunity_shipment_costs.sql", "90_port_name_only.sql",
    "91_opportunity_tcb.sql", "92_loss_process_master.sql",
    "93_loss_process_names.sql", "94_opportunity_owned_losses.sql",
    "95_item_loss_formula.sql", "96_tcb_direct_grade_prices.sql",
)

class BundleContract(unittest.TestCase):
    def setUp(self):
        self.source = BUNDLE.read_text(encoding="utf-8")

    def test_each_section_matches_its_source_in_order(self):
        self.assertEqual(re.findall(r"-- BEGIN MIGRATION (\S+)", self.source), list(NAMES))
        for name in NAMES:
            block = self.source.split("-- BEGIN MIGRATION "+name+"\n", 1)[1].split("-- END MIGRATION "+name, 1)[0]
            block = block.split("GO\n", 1)[1]
            self.assertEqual(block.strip(), (ROOT / "sql" / name).read_text(encoding="utf-8").strip(), name)

    def test_safe_target_and_fail_fast_guards(self):
        self.assertTrue(self.source.startswith(":on error exit\n"))
        self.assertFalse(re.search(r"^\s*(USE\s|:r\s)", self.source, re.M | re.I))
        self.assertIn("DB_NAME() IN", self.source)
        self.assertIn("compatibility_level", self.source)
        self.assertIn("Apply migrations through 88", self.source)
        self.assertIn("IF @@TRANCOUNT<>0", self.source)
        self.assertIn("NOT atomic", self.source)

    def test_latest_features_and_history_retention_are_verified(self):
        self.assertIn("-- VERIFY UPGRADE\n", self.source)
        verification = self.source.split("-- VERIFY UPGRADE\n", 1)[1]
        for marker in ("ShipmentCostInfo", "TCBCostInfo", "PortOfEntry", "LossProcessMaster", "@LossOnly", "DirectUSDPerLb"):
            self.assertIn(marker, verification)
        self.assertNotIn("BUNDLE APPEND HERE", self.source)
        self.assertFalse(re.search(r"\b(TRUNCATE TABLE|DELETE FROM)\b", self.source, re.I))
        self.assertIn("historical records", self.source)

if __name__ == "__main__":
    unittest.main()
