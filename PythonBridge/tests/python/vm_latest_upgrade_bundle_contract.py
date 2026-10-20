"""Read-only artifact checks for migrations 117-137; never executes SQL."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUNDLE = ROOT / "sql/deploy/upgrade_117_to_137_vm.sql"
NAMES = sorted(
    (p.name for p in (ROOT / "sql").glob("*.sql")
     if p.name.split("_")[0].isdigit() and 117 <= int(p.name.split("_")[0]) <= 137),
    key=lambda name: int(name.split("_")[0]),
)

class BundleContract(unittest.TestCase):
    def setUp(self):
        self.source = BUNDLE.read_text(encoding="utf-8")

    def test_exact_sources_in_numeric_order_with_batch_boundaries(self):
        self.assertEqual(len(NAMES), 21)
        self.assertEqual(re.findall(r"-- BEGIN MIGRATION (\S+)", self.source), NAMES)
        for name in NAMES:
            section = self.source.split("-- BEGIN MIGRATION " + name + "\n", 1)[1]
            section = section.split("-- END MIGRATION " + name, 1)[0]
            body = section.split("GO\n", 1)[1].rsplit("\nGO\n", 1)[0]
            self.assertEqual(body.strip(), (ROOT / "sql" / name).read_text(encoding="utf-8").strip(), name)

    def test_fail_fast_and_target_guards(self):
        self.assertTrue(self.source.startswith(":on error exit\n"))
        self.assertFalse(re.search(r"^\s*(USE\s|:r\s)", self.source, re.M | re.I))
        header = self.source.split("-- BEGIN MIGRATION", 1)[0]
        for marker in ("DB_NAME() IN", "IF @@TRANCOUNT<>0", "compatibility_level",
                       "Apply migrations through 116", "NOT atomic", "ResponseContainerLoadPlan"):
            self.assertIn(marker, header)

    def test_current_contracts_verified(self):
        verification = self.source.split("-- VERIFY UPGRADE\n", 1)[1]
        for marker in ("MaterialDimensionsNeedsReview", "BusinessDeletionAudit", "LocalAIChatTurn",
                       "Feedback", "PackagingTypeParent", "Category", "BaseFactor", "Origin",
                       "FinalGrade", "usp_OpportunityItem_SetNetWeight", "OpportunityTCBVersion",
                       "tr_OpportunityItem_TCBVersion", "UX_OpportunityTCBVersion_Active",
                       "UX_PackagingType_GlobalName", "@ResolveOverlap", "GradeProcess137", "'Process'"):
            self.assertIn(marker, verification)

    def test_no_credentials_or_business_history_deletion(self):
        self.assertFalse(re.search(r"\bTRUNCATE TABLE\b", self.source, re.I))
        self.assertFalse(re.search(r"\b(?:INSERT(?:\s+INTO)?|DELETE(?:\s+FROM)?)\s+dbo\.(?:Users|UserAccess)\b", self.source, re.I))
        self.assertFalse(re.search(r"\bDELETE(?:\s+FROM)?\s+dbo\.\w*History\b", self.source, re.I))
        for marker in ("AUTH_PROXY_SECRET=", "DB_PASSWORD=", "BUNDLE INSERT POINT"):
            self.assertNotIn(marker, self.source)

    def test_vm_handoff_and_disabled_ai_are_explicit(self):
        notes = (ROOT / "docs/vm-upgrade-117-to-137.md").read_text(encoding="utf-8")
        for marker in ("migration 116", "SQLCMD Mode", "-E -b", "not atomic",
                       "trusted_proxy", "LOCAL_AI_ENABLED=0", "webapp/dist/",
                       "Back up", "125", "134", "restored copy"):
            self.assertIn(marker, notes)

if __name__ == "__main__":
    unittest.main()
