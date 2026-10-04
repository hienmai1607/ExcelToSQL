"""Rollback-only density writes, server calculation, visibility and audit."""
import re
import unittest
from decimal import Decimal
from pydantic import ValidationError
from fastapi import HTTPException
import packaging_response_sections_contract as sections
import packaging_response_type_contract as response_types
from packaging_fields import PACKAGINGCONFIGURATIONREQUESTITEM_FIELDS
from request_views import item_read
from uuid import uuid4


class NutDensity(unittest.TestCase):
    cleanup = sections.ResponseSections.cleanup
    save = sections.ResponseSections.save

    def setUp(self):
        sections.ResponseSections.setUp(self)
        for _ in range(2):
            for batch in re.split(r"^GO\s*$", (sections.ROOT / "sql/58_packaging_response_nut_density.sql").read_text(), flags=re.M | re.I):
                if batch.strip():
                    self.cur.execute(batch)
                    while self.cur.nextset():
                        pass
        # Close the older fixture before another active request for the same source.
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Canceled',IsOpen=0 WHERE ID=?", self.req)
        # Insert a frozen-weight fixture, never bypass the snapshot update guard.
        self.request_id = self.cur.execute("""INSERT dbo.PackagingConfigurationRequest
            (CreationKey,OpportunityID,OpportunityNumber,CustomerID,CustomerName,OpportunityDescription,
             BidOpen,BidClose,SourceRowVersion,RequestedBy,ResponseDue)
            SELECT NEWID(),o.ID,o.OpportunityNumber,o.CustomerID,c.CustomerName,o.OpportunityDesc,
             o.BidOpen,o.BidClose,o.RowVersion,?,DATEADD(DAY,10,CONVERT(DATE,SYSUTCDATETIME()))
            FROM dbo.Opportunity o JOIN dbo.Customer c ON c.ID=o.CustomerID WHERE o.ID=?;
            SELECT CONVERT(INT,SCOPE_IDENTITY())""", self.actor, self.opp).fetchval()
        self.req = self.cur.execute("""INSERT dbo.PackagingConfigurationRequestItem
            (RequestID,OpportunityItemID,ProductID,ProductCode,ProductName,ItemDescription,
             AnnualUnit,SourceRowVersion,Stage,IsOpen,CreatedBy,WeightGrams)
            SELECT ?,oi.ID,p.ID,p.ProductCode,p.ProductName,oi.ItemDescription,oi.AnnualUnit,
             oi.RowVersion,'Assigned',1,?,150
            FROM dbo.OpportunityItem oi JOIN dbo.Product p ON p.ID=oi.ProductID WHERE oi.ID=?;
            SELECT CONVERT(INT,SCOPE_IDENTITY())""", self.request_id, self.actor, self.item).fetchval()

    def read(self, username=None):
        return item_read(username or self.username, self.request_id, 1, 25, None, None, "[]")["rows"][0]

    def test_density_roundtrip_computed_volume_and_audit(self):
        result = self.save(NutDensity="0.6")
        self.assertEqual(result["results"][0]["Status"], "OK")
        row = self.read()
        self.assertEqual(row["NutDensity"], Decimal("0.6"))
        self.assertEqual(row["UsedVolumeML"], Decimal("250"))
        self.cur.execute("UPDATE dbo.Product SET WeightGrams=300 WHERE ID=?", self.product)
        self.assertEqual(self.read()["UsedVolumeML"], Decimal("250"))
        fields = self.cur.execute("""SELECT FieldName FROM dbo.PackagingRequestChangeLog
            WHERE ItemID=? AND ChangedBy=? AND Source='User' AND IsResponse=1""", self.req, self.username).fetchall()
        self.assertIn("NutDensity", [r[0] for r in fields])
        self.assertIn("UsedVolumeML", [r[0] for r in fields])

    def test_six_decimal_density_and_null_clearing(self):
        self.save(NutDensity="0.000001")
        self.assertEqual(self.read()["UsedVolumeML"], Decimal("150000000"))
        self.save(NutDensity=None)
        row = self.read()
        self.assertIsNone(row["NutDensity"])
        self.assertIsNone(row["UsedVolumeML"])

    def test_legacy_unrelated_save_preserves_density(self):
        self.save(NutDensity="0.75")
        self.save(UnitsPerCarton=5)
        row = self.read()
        self.assertEqual(row["NutDensity"], Decimal("0.75"))
        self.assertEqual(row["UsedVolumeML"], Decimal("200"))
        self.assertNotIn("NutDensity", PACKAGINGCONFIGURATIONREQUESTITEM_FIELDS)

    def test_invalid_density_and_client_volume_are_rejected(self):
        for density in ("0", "-1", "0.1234567", "NaN", "Infinity", "1000000000000"):
            with self.assertRaises(ValidationError):
                response_types.api.ResponseBatch(rows=[dict(RowNum=1, ID=self.req, RowVersion="AAAAAAAAAAE=", NutDensity=density)])
        with self.assertRaises(ValidationError):
            response_types.api.ResponseBatch(rows=[dict(RowNum=1, ID=self.req, RowVersion="AAAAAAAAAAE=", UsedVolumeML=999)])
        with self.assertRaisesRegex(Exception, "547"):
            self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET NutDensity=0 WHERE ID=?", self.req)

    def test_locked_response_still_rejects_density_changes(self):
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Approved',IsOpen=0 WHERE ID=?", self.req)
        with self.assertRaises(HTTPException) as caught:
            self.save(NutDensity="0.6")
        self.assertEqual(caught.exception.status_code, 409)

    def test_draft_density_and_volume_hidden_from_sales_until_approval(self):
        self.save(NutDensity="0.6")
        sales = "density-sales-" + uuid4().hex[:12]
        actor = self.cur.execute("INSERT dbo.Users(UserName,IsActive) VALUES(?,1);SELECT CONVERT(INT,SCOPE_IDENTITY())", sales).fetchval()
        self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,'Opportunity')", actor)
        row = self.read(sales)
        self.assertIsNone(row["NutDensity"])
        self.assertIsNone(row["UsedVolumeML"])
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Approved',IsOpen=0 WHERE ID=?", self.req)
        self.assertEqual(self.read(sales)["UsedVolumeML"], Decimal("250"))


if __name__ == "__main__":
    unittest.main()
