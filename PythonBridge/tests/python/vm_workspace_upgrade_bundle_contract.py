"""Read-only checks for the 97-104 VM deployment artifact; no database writes."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUNDLE = ROOT / "sql/deploy/upgrade_097_to_104_vm.sql"
NAMES = (
    "97_product_category_master.sql",
    "98_required_container_type_pallet.sql",
    "99_packaging_final_component.sql",
    "100_packaging_conversion_output_uom.sql",
    "101_response_weight_loading_density.sql",
    "102_shipment_cost_units.sql",
    "103_pallet_price.sql",
    "104_administrator_workspace.sql",
)


class BundleContract(unittest.TestCase):
    def setUp(self):
        self.source = BUNDLE.read_text(encoding="utf-8")

    def test_each_section_matches_source_in_numeric_order(self):
        self.assertEqual(re.findall(r"-- BEGIN MIGRATION (\S+)", self.source), list(NAMES))
        for name in NAMES:
            block = self.source.split("-- BEGIN MIGRATION " + name + "\n", 1)[1]
            block = block.split("-- END MIGRATION " + name, 1)[0].split("GO\n", 1)[1]
            self.assertEqual(block.strip(), (ROOT / "sql" / name).read_text(encoding="utf-8").strip(), name)

    def test_fail_fast_existing_database_guards(self):
        self.assertTrue(self.source.startswith(":on error exit\n"))
        self.assertFalse(re.search(r"^\s*(USE\s|:r\s)", self.source, re.M | re.I))
        preflight = self.source.split("-- BEGIN MIGRATION", 1)[0]
        for marker in ("DB_NAME() IN", "compatibility_level", "IF @@TRANCOUNT<>0",
                       "Apply migrations through 96", "DirectUSDPerLb", "NOT atomic"):
            self.assertIn(marker, preflight)

    def test_latest_features_are_verified(self):
        verification = self.source.split("-- VERIFY UPGRADE\n", 1)[1]
        for marker in ("ProductCategory", "FinalComponent", "ConversionOutputUoMID",
                       "ApplicableNetWeightGrams", "NutGradeDensity", "NutGradeDensityHistory",
                       "PalletPriceUSDPerEA", "WorkspaceRole", "WorkspaceRolePermission",
                       "WorkspaceUserRole", "WorkspaceRoleScope", "fn_WorkspaceAccess",
                       "-- Shipment revised units.", "-- Exact requested container type.",
                       "IF @@TRANCOUNT<>0", "sys.parameters", "master_auth_verify"):
            self.assertIn(marker, verification)

    def test_no_sample_users_credentials_or_history_deletion(self):
        self.assertFalse(re.search(r"\b(?:TRUNCATE TABLE|DELETE FROM)\b", self.source, re.I))
        self.assertFalse(re.search(r"\bINSERT\s+(?:INTO\s+)?dbo\.(?:Users|UserAccess)\b", self.source, re.I))
        for marker in ("AUTH_PROXY_SECRET=", "DB_PASSWORD=", "BUNDLE APPEND HERE"):
            self.assertNotIn(marker, self.source)

    def test_handover_documents_upgrade_order_and_vm_configuration(self):
        notes = (ROOT / "docs/vm-upgrade-097-to-104.md").read_text(encoding="utf-8")
        for marker in ("through migration 96", "SQLCMD Mode", "-E -b",
                       "not atomic", "trusted_proxy", "webapp/dist/",
                       "back up", "45-85", "86-88", "89-96"):
            self.assertIn(marker, notes)


if __name__ == "__main__":
    unittest.main()
