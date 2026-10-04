"""Rollback-only optional-description submission and audit/compatibility checks."""
import re
import unittest
import packaging_response_type_contract as response_types
from packaging_fields import consume
ROOT = response_types.ROOT


class ResponseSections(unittest.TestCase):
    cleanup = response_types.ResponseTypes.cleanup
    save = response_types.ResponseTypes.save

    def setUp(self):
        response_types.ResponseTypes.setUp(self)
        for _ in range(2):
            for batch in re.split(r"^GO\s*$", (ROOT / "sql/57_packaging_response_sections.sql").read_text(), flags=re.M | re.I):
                if batch.strip():
                    self.cur.execute(batch)
                    while self.cur.nextset():
                        pass

    def complete(self):
        result = self.save(FirstPMType=self.primary, SecondPMType=self.secondary,
                           UnitsPerCarton=12)
        self.assertEqual(result["results"][0]["Status"], "OK", result)
        # Represent a previously saved response; new MOQ inputs are calculator-only.
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET FirstPMMOQ=0,SecondPMMOQ=50 WHERE ID=?", self.req)

    def transition(self, stage, comment=None, version=None):
        if version is None:
            version = self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?", self.req).fetchval()
        self.cur.execute("EXEC dbo.usp_PackagingRequestItem_Transition ?,?,?,?,?",
                         self.username, self.req, version, stage, comment)
        return consume(self.cur)[0][0]

    def test_submit_and_approve_without_description_still_audit(self):
        self.complete()
        self.assertIsNone(self.cur.execute("SELECT PackagingDescription FROM dbo.PackagingConfigurationRequestItem WHERE ID=?", self.req).fetchval())
        self.assertEqual(self.transition("Pending Review")["Stage"], "Pending Review")
        self.assertEqual(self.transition("Approved")["Stage"], "Approved")
        self.assertGreaterEqual(self.cur.execute("""SELECT COUNT(*) FROM dbo.PackagingRequestChangeLog
            WHERE ItemID=? AND FieldName='Stage' AND ChangedBy=?""", self.req, self.username).fetchval(), 2)

    def test_omitted_description_preserves_historical_value(self):
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET PackagingDescription='Historical description' WHERE ID=?", self.req)
        self.complete()
        self.assertEqual(self.cur.execute("SELECT PackagingDescription FROM dbo.PackagingConfigurationRequestItem WHERE ID=?", self.req).fetchval(), "Historical description")

    def test_missing_units_still_blocks_submission(self):
        self.complete()
        self.save(UnitsPerCarton=None)
        with self.assertRaisesRegex(Exception, "52963"):
            self.transition("Pending Review")

    def test_missing_moq_still_blocks_submission(self):
        self.complete()
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET SecondPMMOQ=NULL WHERE ID=?", self.req)
        with self.assertRaisesRegex(Exception, "52963"):
            self.transition("Pending Review")

    def test_stale_version_still_blocks_submission(self):
        stale = self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?", self.req).fetchval()
        self.complete()
        with self.assertRaisesRegex(Exception, "51108"):
            self.transition("Pending Review", version=stale)

    def test_return_still_requires_reason(self):
        self.complete()
        self.transition("Pending Review")
        with self.assertRaisesRegex(Exception, "51132"):
            self.transition("Returned")

    def test_audit_wrapper_and_legacy_response_field_are_preserved(self):
        definition = self.cur.execute("SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.usp_PackagingRequestItem_Transition'))").fetchval()
        self.assertIn("PackagingChangeUser", definition)
        self.assertIn("Transition_AuditImplementation", definition)
        from packaging_fields import PACKAGINGCONFIGURATIONREQUESTITEM_FIELDS
        self.assertIn("PackagingDescription", PACKAGINGCONFIGURATIONREQUESTITEM_FIELDS)
        self.assertEqual(self.cur.execute("""SELECT COUNT(*) FROM sys.table_types t
            JOIN sys.columns c ON c.object_id=t.type_table_object_id
            WHERE t.name='PackagingResponseBatchType'""").fetchval(), 11)


if __name__ == "__main__":
    unittest.main()
