"""Local test database only; every fixture is rolled back."""
import sys
import unittest
from contextlib import contextmanager
from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4
import packaging_field_foundation_contract as foundation

sys.path.insert(0, str(foundation.ROOT / "core"))
import packaging_api as packaging
import packaging_fields
import product_mix_api as mixes
import opportunity_excel_api as excel
from auth import AccessContext
from db import bytes_to_b64
from main import opportunity_batch
from schemas import OpportunityBatchRequest


class OpportunityMixSQL(unittest.TestCase):
    cleanup = foundation.PackagingFoundation.cleanup

    def setUp(self):
        foundation.PackagingFoundation.setUp(self)
        @contextmanager
        def cursor():
            fresh = self.conn.cursor()
            try:
                yield fresh
            finally:
                fresh.close()
        for module in (packaging, packaging_fields):
            mocked = patch.object(module, "get_raw_cursor", cursor)
            mocked.start()
            self.addCleanup(mocked.stop)
        self.ctx = AccessContext(self.actor, self.username, frozenset({"Admin"}))
        self.number = self.cur.execute("SELECT OpportunityNumber FROM dbo.Opportunity WHERE ID=?", self.opp).fetchval()
        self.cur.execute("""UPDATE o SET ExchangeRateVNDPerUSD=25000,ExchangeRateCustomerCurrencyPerUSD=1,
            RateCustomerCurrencyID=c.CurrencyID FROM dbo.Opportunity o JOIN dbo.Customer c ON c.ID=o.CustomerID
            WHERE o.ID=?""", self.opp)

    def activate(self, product, quantity):
        product_version = self.cur.execute("SELECT RowVersion FROM dbo.Product WHERE ID=?", product).fetchval()
        child_version = self.cur.execute("SELECT RowVersion FROM dbo.Product WHERE ID=?", self.product).fetchval()
        return mixes.save(mixes.MixSave(ProductRowVersion=bytes_to_b64(product_version), Status="Active",
            items=[dict(ProductID=self.product, UnitQuantity=quantity, RowVersion=bytes_to_b64(child_version))]),
            product, self.ctx)["ID"]

    def batch(self, *rows):
        return opportunity_batch(OpportunityBatchRequest(header_rows=[], item_rows=list(rows)),
                                 self.username, True, self.ctx.scopes)

    def create_mix(self):
        code = "MX-" + uuid4().hex[:16]
        self.mix = self.cur.execute("""INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CreatedBy,CustomerID,IsMix)
            VALUES(?,?,0,?,?,1);SELECT CONVERT(INT,SCOPE_IDENTITY())""",
            code, code, self.actor, self.customer).fetchval()
        self.mix_version = self.activate(self.mix, "0.1250")
        result = self.batch(dict(RowNum=2, Command="C", OpportunityNumber=self.number, ProductID=self.mix,
            ItemDescription="Mix parent", AnnualUnit=10, EstPctAwarded=50, ShelfPrice=4, PackagingType="Box",
            MixVersionID=self.mix_version, MixChildren=[dict(ProductID=self.product, PackagingType="Pouch")]))
        self.assertEqual(result["item_results"][0]["Status"], "OK", result)
        self.parent = result["item_results"][0]["NewID"]
        self.child = self.cur.execute("SELECT ID FROM dbo.OpportunityItem WHERE ParentItemID=?", self.parent).fetchval()
        return excel.document_rows(self.ctx, self.opp)

    def edit(self, item, **fields):
        version = self.cur.execute("SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?", item).fetchval()
        return dict(RowNum=3, Command="U", ID=item, RowVersion=bytes_to_b64(version),
                    OpportunityNumber=self.number, **fields)

    def request(self, ids):
        header_version = self.cur.execute("SELECT RowVersion FROM dbo.Opportunity WHERE ID=?", self.opp).fetchval()
        selections = [dict(OpportunityItemID=id, ExpectedRowVersion=bytes_to_b64(
            self.cur.execute("SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?", id).fetchval())) for id in ids]
        return packaging.manual_create(packaging.ManualRequest(OpportunityID=self.opp,
            ExpectedRowVersion=bytes_to_b64(header_version), CreationKey=uuid4(),
            ResponseDue=date.today() + timedelta(days=10), items=selections), self.ctx)

    def test_snapshot_fractional_units_and_parent_only_commercial_fields(self):
        rows = self.create_mix()
        child = next(r for r in rows if r["ItemID"] == self.child)
        self.assertEqual(child["ItemNumber"], "2.1")
        self.assertEqual(Decimal(child["AnnualUnit"]), Decimal("1.2500"))
        self.assertEqual(child["PackagingType"], "Pouch")
        self.assertIsNone(child["EstPctAwarded"])
        self.assertIsNone(child["ShelfPrice"])
        self.assertEqual(rows[0]["ItemCount"], 2)
        self.assertEqual(self.cur.execute("SELECT MixVersionID FROM dbo.OpportunityMixSnapshot WHERE ParentItemID=?",
                                         self.parent).fetchval(), self.mix_version)

    def test_later_master_activation_does_not_change_saved_mix(self):
        self.create_mix()
        newer = self.activate(self.mix, "2")
        self.assertNotEqual(newer, self.mix_version)
        result = self.batch(self.edit(self.parent, ProductID=self.mix, ItemDescription="Mix parent", AnnualUnit=20,
                                      EstPctAwarded=50, ShelfPrice=4))
        self.assertEqual(result["item_results"][0]["Status"], "OK", result)
        self.assertEqual(self.cur.execute("SELECT AnnualUnit FROM dbo.OpportunityItem WHERE ID=?", self.child).fetchval(),
                         Decimal("2.5000"))

    def test_web_and_excel_edit_only_child_requirements(self):
        self.create_mix()
        result = self.batch(self.edit(self.child, SpecialComments="Web child packaging"))
        self.assertEqual(result["item_results"][0]["Status"], "OK", result)
        row = next(r for r in excel.document_rows(self.ctx, self.opp) if r["ItemID"] == self.child)
        result = excel.save(excel.Batch(rows=[dict(row=4, number=self.number, opportunity_id=self.opp,
            item_id=self.child, header_version=row["HeaderRowVersion"], item_version=row["ItemRowVersion"],
            item_changes={"PackagingType":"Bag"})]), self.ctx)
        self.assertEqual(result["results"][0]["status"], "OK", result)
        self.assertEqual(self.cur.execute("SELECT PackagingType FROM dbo.OpportunityItem WHERE ID=?", self.child).fetchval(),
                         "Bag")
        self.assertEqual(self.cur.execute("SELECT AnnualUnit FROM dbo.OpportunityItem WHERE ID=?", self.child).fetchval(),
                         Decimal("1.2500"))

    def test_excel_rejects_read_only_child_edit_before_writing(self):
        rows = self.create_mix()
        row = next(r for r in rows if r["ItemID"] == self.child)
        result = excel.save(excel.Batch(rows=[dict(row=4, number=self.number, opportunity_id=self.opp,
            item_id=self.child, header_version=row["HeaderRowVersion"], item_version=row["ItemRowVersion"],
            item_changes={"AnnualUnit":999})]), self.ctx)
        self.assertEqual(result["results"][0]["status"], "ERROR", result)
        self.assertIn("read-only", result["results"][0]["message"])

    def test_api_rejects_child_unit_tampering(self):
        self.create_mix()
        result = self.batch(self.edit(self.child, AnnualUnit=999))
        self.assertEqual(result["item_results"][0]["Status"], "ERROR", result)
        self.assertIn("read-only", result["item_results"][0]["Message"])

    def test_parent_and_child_are_separate_packaging_items_with_exact_units(self):
        self.create_mix()
        request = self.request([self.parent, self.child])
        self.assertEqual({r["OpportunityItemID"] for r in request["items"]}, {self.parent, self.child})
        self.assertEqual(len({r["ID"] for r in request["items"]}), 2)
        self.assertEqual(self.cur.execute("SELECT AnnualUnit FROM dbo.PackagingConfigurationRequestItem WHERE OpportunityItemID=?",
                                         self.child).fetchval(), Decimal("1.2500"))

    def test_parent_packaging_does_not_lock_unrequested_child(self):
        self.create_mix()
        self.request([self.parent])
        result = self.batch(self.edit(self.child, SpecialComments="Child is independent"))
        self.assertEqual(result["item_results"][0]["Status"], "OK", result)

    def test_processing_child_blocks_parent_quantity_changes(self):
        self.create_mix()
        self.request([self.child])
        result = self.batch(self.edit(self.parent, ProductID=self.mix, ItemDescription="Mix parent", AnnualUnit=20))
        self.assertEqual(result["item_results"][0]["Status"], "ERROR", result)
        self.assertIn("processing", result["item_results"][0]["Message"])

    def test_deleting_parent_removes_unrequested_children_atomically(self):
        self.create_mix()
        row = self.edit(self.parent, ProductID=self.mix, ItemDescription="Mix parent", AnnualUnit=10)
        row["Command"] = "D"
        result = self.batch(row)
        self.assertEqual(result["item_results"][0]["Status"], "OK", result)
        self.assertIsNone(self.cur.execute("SELECT ID FROM dbo.OpportunityItem WHERE ID=?", self.child).fetchval())
        self.assertIsNone(self.cur.execute("SELECT ParentItemID FROM dbo.OpportunityMixSnapshot WHERE ParentItemID=?",
                                          self.parent).fetchval())


if __name__ == "__main__":
    unittest.main()
