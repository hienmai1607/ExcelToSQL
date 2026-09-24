"""Rollback-only integration tests for the staged Packaging field foundation.

Run from the project root with a local test SQL Server. Each test applies the
migration inside an outer transaction and rolls back both schema and fixtures.
No database is created, and no existing business rows are updated.
"""
import os
import re
import unittest
from pathlib import Path

import pyodbc

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (ROOT / "sql/22_packaging_field_foundation.sql").read_text(encoding="utf-8")
BATCHES = [s.strip() for s in re.split(r"^GO\s*$", MIGRATION, flags=re.M | re.I) if s.strip()]


class PackagingFoundation(unittest.TestCase):
    def setUp(self):
        server = os.environ.get("FOUNDATION_TEST_SERVER", "localhost")
        if server.lower() not in {"localhost", ".", "desktop-5bgmjsc"}:
            raise RuntimeError("These rollback tests are restricted to the local test database.")
        self.conn = pyodbc.connect(
            f"DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={server};DATABASE=test;"
            "Trusted_Connection=yes;TrustServerCertificate=yes", autocommit=True)
        self.addCleanup(self.cleanup)
        self.cur = self.conn.cursor()
        self.cur.execute("SET NOCOUNT ON; BEGIN TRANSACTION")
        for batch in BATCHES:
            self.cur.execute(batch)
            while self.cur.nextset():
                pass
        self.cur.execute("""
            SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u
            JOIN dbo.UserAccess a ON a.UserID=u.ID
            WHERE u.IsActive=1 AND a.Scope='Admin' ORDER BY u.ID
        """)
        self.actor, self.username = self.cur.fetchone()
        self.customer = self.cur.execute("SELECT TOP(1) ID FROM dbo.Customer WHERE Status='Active' ORDER BY ID").fetchval()
        self.product = self.cur.execute("SELECT TOP(1) ID FROM dbo.Product WHERE Status='Active' ORDER BY ID").fetchval()
        self.opp = self.cur.execute("""
            INSERT dbo.Opportunity(OpportunityNumber,CustomerID,OpportunityDesc,BidOpen,BidClose,Stage,CreatedBy)
            VALUES('FND-'+LEFT(CONVERT(VARCHAR(36),NEWID()),16),?,'Foundation test','2026-09-01','2026-10-01','Draft',?);
            SELECT CONVERT(INT,SCOPE_IDENTITY())
        """, self.customer, self.actor).fetchval()
        self.item = self.cur.execute("""
            INSERT dbo.OpportunityItem(OpportunityID,ProductID,ItemDescription,AnnualUnit,Stage,CreatedBy)
            VALUES(?,?,'Foundation line',100,'Draft',?); SELECT CONVERT(INT,SCOPE_IDENTITY())
        """, self.opp, self.product, self.actor).fetchval()

    def cleanup(self):
        try:
            self.cur.close()
            self.conn.cursor().execute("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION")
        finally:
            self.conn.close()

    def request(self, stage="Assigned"):
        req = self.cur.execute("""
            INSERT dbo.PackagingConfigurationRequest(CreationKey,OpportunityID,OpportunityNumber,CustomerID,
                CustomerName,OpportunityDescription,BidOpen,BidClose,SourceRowVersion,RequestedBy,ResponseDue)
            SELECT NEWID(),o.ID,o.OpportunityNumber,o.CustomerID,c.CustomerName,o.OpportunityDesc,
                o.BidOpen,o.BidClose,o.RowVersion,?,DATEADD(DAY,10,CONVERT(DATE,SYSUTCDATETIME()))
            FROM dbo.Opportunity o JOIN dbo.Customer c ON c.ID=o.CustomerID WHERE o.ID=?;
            SELECT CONVERT(INT,SCOPE_IDENTITY())
        """, self.actor, self.opp).fetchval()
        return self.cur.execute("""
            INSERT dbo.PackagingConfigurationRequestItem(RequestID,OpportunityItemID,ProductID,ProductCode,
                ProductName,ItemDescription,AnnualUnit,SourceRowVersion,Stage,IsOpen,CreatedBy)
            SELECT ?,oi.ID,p.ID,p.ProductCode,p.ProductName,oi.ItemDescription,oi.AnnualUnit,oi.RowVersion,?,?,?
            FROM dbo.OpportunityItem oi JOIN dbo.Product p ON p.ID=oi.ProductID WHERE oi.ID=?;
            SELECT CONVERT(INT,SCOPE_IDENTITY())
        """, req, stage, int(stage not in ("Approved", "Canceled")), self.actor, self.item).fetchval()

    def test_repeatable_and_old_contract_unchanged(self):
        for batch in BATCHES:
            self.cur.execute(batch)
            while self.cur.nextset():
                pass
        for base, expected in (("ProductBatchType",9),("OpportunityHeaderBatchType",10),
                               ("OpportunityItemBatchType",11),("PackagingResponseBatchType",11)):
            count = self.cur.execute("""
                SELECT COUNT(*) FROM sys.table_types t JOIN sys.columns c ON c.object_id=t.type_table_object_id
                WHERE t.name=?
            """, base).fetchval()
            self.assertEqual(count, expected, base)
            self.assertIsNotNone(self.cur.execute("SELECT TYPE_ID(?)", "dbo."+base+"V2").fetchval())
        self.assertIsNone(self.cur.execute("SELECT ExchangeRateToVND FROM dbo.Opportunity WHERE ID=?",self.opp).fetchval())
        self.assertIsNone(self.cur.execute("SELECT ShelfLifeDays FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchval())

    def test_processing_lock_rejects_old_basic_field_update(self):
        self.request()
        with self.assertRaisesRegex(pyodbc.Error, "52952"):
            self.cur.execute("UPDATE dbo.OpportunityItem SET AnnualUnit=101 WHERE ID=?", self.item)

    def test_processing_lock_rejects_new_requirement_update(self):
        self.request("Returned")
        with self.assertRaisesRegex(pyodbc.Error, "52952"):
            self.cur.execute("UPDATE dbo.OpportunityItem SET PackagingType='Pouch' WHERE ID=?", self.item)

    def test_noop_and_workflow_update_allowed_unlock_after_approval(self):
        req = self.request()
        self.cur.execute("UPDATE dbo.OpportunityItem SET AnnualUnit=AnnualUnit WHERE ID=?", self.item)
        self.cur.execute("UPDATE dbo.OpportunityItem SET Stage='In progress' WHERE ID=?", self.item)
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Approved',IsOpen=0 WHERE ID=?",req)
        self.cur.execute("UPDATE dbo.OpportunityItem SET PackagingType='Pouch',MaxPalletHeightM=1.250,ShelfLifeDays=365 WHERE ID=?", self.item)
        self.assertEqual(self.cur.execute("SELECT PackagingType FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchval(),"Pouch")

    def test_response_resolution_is_one_row_and_excludes_canceled(self):
        approved = self.request("Approved")
        self.request("Canceled")
        self.assertEqual(self.cur.execute("SELECT PackagingRequestItemID FROM dbo.v_OpportunityItemPackaging WHERE OpportunityItemID=?",self.item).fetchval(),approved)
        active = self.request()
        self.assertEqual(self.cur.execute("SELECT PackagingRequestItemID FROM dbo.v_OpportunityItemPackaging WHERE OpportunityItemID=?",self.item).fetchval(),active)
        self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.v_OpportunityItemPackaging WHERE OpportunityItemID=?",self.item).fetchval(),1)

    def test_exchange_rate_pair_and_vnd(self):
        currency = self.cur.execute("SELECT TOP(1) ID FROM dbo.Currency WHERE CurrencyCode='VND'").fetchval()
        if currency is None:
            self.skipTest("VND currency has not been maintained locally.")
        self.cur.execute("UPDATE dbo.Opportunity SET CurrencyID=?,ExchangeRateToVND=1 WHERE ID=?",currency,self.opp)
        with self.assertRaisesRegex(pyodbc.Error,"52951"):
            self.cur.execute("UPDATE dbo.Opportunity SET ExchangeRateToVND=2 WHERE ID=?",self.opp)

    def test_negative_height_rejected(self):
        with self.assertRaisesRegex(pyodbc.Error,"CK_OpportunityItem_PackagingNumbers"):
            self.cur.execute("UPDATE dbo.OpportunityItem SET MaxPalletHeightM=-1 WHERE ID=?",self.item)

    def test_read_requires_real_active_user(self):
        with self.assertRaisesRegex(pyodbc.Error,"52953"):
            self.cur.execute("EXEC dbo.usp_OpportunityItemPackaging_Read ?,?", "no-such-foundation-user",self.opp)

    def test_authorized_read_has_pagination_and_fields(self):
        self.cur.execute("EXEC dbo.usp_OpportunityItemPackaging_Read ?,?,1,200",self.username,self.opp)
        names = [c[0] for c in self.cur.description]
        self.assertIn("MaxPalletHeightM",names)
        self.assertIn("FirstPMType",names)
        self.assertEqual(len(self.cur.fetchall()),1)
        self.assertTrue(self.cur.nextset())
        self.assertEqual(self.cur.fetchval(),1)

    def test_new_requirement_is_audited(self):
        self.cur.execute("UPDATE dbo.OpportunityItem SET PackagingType='Pouch' WHERE ID=?",self.item)
        self.assertEqual(self.cur.execute("""
            SELECT COUNT(*) FROM dbo.OpportunityChangeLog
            WHERE ItemID=? AND FieldName='PackagingType' AND OldValue IS NULL AND NewValue='Pouch'
        """,self.item).fetchval(),1)

    def test_missing_exchange_rate_rejected(self):
        currency = self.cur.execute("SELECT TOP(1) ID FROM dbo.Currency ORDER BY ID").fetchval()
        with self.assertRaisesRegex(pyodbc.Error,"CK_Opportunity_ExchangeRate"):
            self.cur.execute("UPDATE dbo.Opportunity SET CurrencyID=? WHERE ID=?",currency,self.opp)

    def test_lock_preserves_null_versus_zero(self):
        self.request("Pending Review")
        with self.assertRaisesRegex(pyodbc.Error,"52952"):
            self.cur.execute("UPDATE dbo.OpportunityItem SET ShelfPrice=0 WHERE ID=?",self.item)

    def test_sales_reader_does_not_see_unapproved_responses(self):
        actor = self.cur.execute("""
            INSERT dbo.Users(UserName,IsActive)
            VALUES('FND-'+CONVERT(VARCHAR(36),NEWID()),1);
            SELECT CONVERT(INT,SCOPE_IDENTITY())
        """).fetchval()
        self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,'Opportunity')",actor)
        username = self.cur.execute("SELECT UserName FROM dbo.Users WHERE ID=?",actor).fetchval()
        req = self.request()
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET FirstPMType='Unapproved response' WHERE ID=?",req)
        self.cur.execute("EXEC dbo.usp_OpportunityItemPackaging_Read ?,?",username,self.opp)
        names = [c[0] for c in self.cur.description]
        row = dict(zip(names,self.cur.fetchone()))
        self.assertEqual(row["PackagingRequestItemID"],req)
        self.assertIsNone(row["FirstPMType"])
        while self.cur.nextset():
            pass
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Approved',IsOpen=0 WHERE ID=?",req)
        self.cur.execute("EXEC dbo.usp_OpportunityItemPackaging_Read ?,?",username,self.opp)
        names = [c[0] for c in self.cur.description]
        self.assertEqual(dict(zip(names,self.cur.fetchone()))["FirstPMType"],"Unapproved response")


if __name__ == "__main__":
    unittest.main()
