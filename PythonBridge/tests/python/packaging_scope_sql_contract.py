"""Current packaging scope and Product shelf-life contracts, rollback-only."""
import json
import re
import unittest
from contextlib import contextmanager
from unittest.mock import patch
from pydantic import ValidationError
import opportunity_mix_sql_contract as mix
import product_excel_api as product_excel
from schemas import ProductBatchRequest, OpportunityBatchRequest
from main import product_batch
from opportunity_views import OpportunityViews
from request_views import RequestViews
from packaging_master_api import read as master_read


class PackagingScopeSQL(unittest.TestCase):
    cleanup = mix.OpportunityMixSQL.cleanup
    activate = mix.OpportunityMixSQL.activate
    batch = mix.OpportunityMixSQL.batch
    create_mix = mix.OpportunityMixSQL.create_mix
    edit = mix.OpportunityMixSQL.edit
    request = mix.OpportunityMixSQL.request

    def apply_migration(self):
        sql = (mix.foundation.ROOT / "sql/48_product_shelf_life_packaging_scope.sql").read_text()
        for batch in re.split(r"^GO\s*$", sql, flags=re.M | re.I):
            if batch.strip():
                self.cur.execute(batch)
                while self.cur.nextset():
                    pass

    def setUp(self):
        mix.OpportunityMixSQL.setUp(self)
        self.apply_migration()
        @contextmanager
        def cursor():
            cur = self.conn.cursor()
            try:
                yield cur
            finally:
                cur.close()
        mocked = patch.object(product_excel, "get_raw_cursor", cursor)
        mocked.start()
        self.addCleanup(mocked.stop)

    def save_shelf(self, product, days):
        version = self.cur.execute("SELECT RowVersion FROM dbo.Product WHERE ID=?", product).fetchval()
        self.cur.execute("EXEC dbo.usp_Product_Fields_Save ?,?,?,?,0",
                         self.username, product, version, json.dumps({"ShelfLifeDays": days}))
        mix.packaging_fields.consume(self.cur)

    def test_shelf_life_is_live_per_product_and_frozen_per_request(self):
        self.create_mix()
        self.save_shelf(self.mix, 365)
        self.save_shelf(self.product, 180)
        # Retired Opportunity values must never override Product Master.
        self.cur.execute("UPDATE dbo.OpportunityItem SET ShelfLifeDays=999,BarrierRequirement='Legacy' WHERE ID=?", self.parent)
        rows = mix.excel.document_rows(self.ctx, self.opp)
        self.assertEqual(next(r for r in rows if r["ItemID"] == self.parent)["ShelfLifeDays"], 365)
        self.assertEqual(next(r for r in rows if r["ItemID"] == self.child)["ShelfLifeDays"], 180)
        self.assertNotIn("BarrierRequirement", rows[0])
        self.request([self.parent, self.child])
        self.save_shelf(self.product, 90)
        self.assertEqual(self.cur.execute("SELECT ShelfLifeDays FROM dbo.PackagingConfigurationRequestItem WHERE OpportunityItemID=?",
                                         self.child).fetchval(), 180)
        self.assertIsNone(self.cur.execute("SELECT BarrierRequirement FROM dbo.PackagingConfigurationRequestItem WHERE OpportunityItemID=?",
                                          self.parent).fetchval())
        rows = mix.excel.document_rows(self.ctx, self.opp)
        self.assertEqual(next(r for r in rows if r["ItemID"] == self.child)["ShelfLifeDays"], 90)

    def test_parent_logistics_snapshot_and_child_empty(self):
        self.create_mix()
        result = self.batch(self.edit(self.parent, ProductID=self.mix, ItemDescription="Mix parent",
            AnnualUnit=10, PalletSize="1200x1000", PalletStacking="Yes", MaxPalletHeightM="1.8", ContainerRequest="40HC"))
        self.assertEqual(result["item_results"][0]["Status"], "OK", result)
        self.request([self.parent, self.child])
        fields = "PalletSize,PalletStacking,MaxPalletHeightM,ContainerRequest"
        parent = self.cur.execute("SELECT "+fields+" FROM dbo.PackagingConfigurationRequestItem WHERE OpportunityItemID=?", self.parent).fetchone()
        child = self.cur.execute("SELECT "+fields+" FROM dbo.PackagingConfigurationRequestItem WHERE OpportunityItemID=?", self.child).fetchone()
        self.assertEqual(parent.PalletSize, "1200x1000")
        self.assertEqual(parent.ContainerRequest, "40HC")
        self.assertEqual(tuple(child), (None, None, None, None))

    def test_child_logistics_rejected_by_api_atomically(self):
        self.create_mix()
        result = self.batch(self.edit(self.child, PackagingType="Must not save", PalletSize="Forbidden"))
        self.assertEqual(result["item_results"][0]["Status"], "ERROR", result)
        self.assertIn("parent", result["item_results"][0]["Message"])
        # The API rolls back its whole document transaction; that also discards
        # this test's surrounding fixture transaction. No partial write survives.
        self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.OpportunityItem WHERE ID=? AND PackagingType='Must not save'", self.child).fetchval(), 0)

    def test_child_logistics_rejected_by_sql(self):
        self.create_mix()
        version = self.cur.execute("SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?", self.child).fetchval()
        with self.assertRaisesRegex(Exception, "parent item only"):
            self.cur.execute("EXEC dbo.usp_OpportunityItem_Fields_Save ?,?,?,?,0",
                             self.username, self.child, version, '{"ContainerRequest":null}')

    def test_nested_child_logistics_roll_back_new_parent(self):
        from uuid import uuid4
        code = "MS-" + uuid4().hex[:16]
        product = self.cur.execute("""INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CreatedBy,CustomerID,IsMix)
            VALUES(?,?,0,?,?,1);SELECT CONVERT(INT,SCOPE_IDENTITY())""",
            code, code, self.actor, self.customer).fetchval()
        version = self.activate(product, "2")
        result = self.batch(dict(RowNum=2, Command="C", OpportunityNumber=self.number, ProductID=product,
            ItemDescription="Bad child logistics", AnnualUnit=10, MixVersionID=version,
            MixChildren=[dict(ProductID=self.product, PalletStacking="Forbidden")]))
        self.assertEqual(result["item_results"][0]["Status"], "ERROR", result)
        self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.OpportunityItem WHERE ProductID=?", product).fetchval(), 0)

    def test_product_web_and_excel_maintain_shelf_life(self):
        from uuid import uuid4
        name = "Shelf-" + uuid4().hex[:12]
        result = product_batch(ProductBatchRequest(rows=[dict(RowNum=1, Command="C", CustomerID=self.customer,
            ProductName=name, Category="Test", WeightValue=100, WeightUnit="g", ShelfLifeDays=365)]),
            self.username, True, self.ctx.scopes)["results"][0]
        self.assertEqual(result["Status"], "OK", result)
        updated = product_excel.save(product_excel.Batch(rows=[dict(row=3,command="U",id=result["NewID"],
            version=result["NewRowVersion"],changes={"ShelfLifeDays":730})]),self.ctx)["results"][0]
        self.assertEqual(updated["Status"], "OK", updated)
        rows = master_read(entity="products",page=1,page_size=25,search=name,status=None,material_id=None,
            currency_id=None,as_of=None,created_by=None,sort="[]",ctx=self.ctx)["rows"]
        self.assertEqual(rows[0]["ShelfLifeDays"], 730)
        self.save_shelf(result["NewID"], None)
        self.assertIsNone(self.cur.execute("SELECT ShelfLifeDays FROM dbo.Product WHERE ID=?", result["NewID"]).fetchval())

    def test_product_shelf_invalid_values_and_omitted_preservation(self):
        self.save_shelf(self.product, 365)
        version = self.cur.execute("SELECT RowVersion FROM dbo.Product WHERE ID=?", self.product).fetchval()
        result = product_excel.save(product_excel.Batch(rows=[dict(row=3,command="U",id=self.product,
            version=mix.bytes_to_b64(version),changes={"Category":"Preserve shelf"})]), self.ctx)["results"][0]
        self.assertEqual(result["Status"], "OK", result)
        self.assertEqual(self.cur.execute("SELECT ShelfLifeDays FROM dbo.Product WHERE ID=?", self.product).fetchval(), 365)
        for value in (-1, 1.25, 2147483648):
            with self.assertRaises(ValidationError):
                ProductBatchRequest(rows=[dict(RowNum=1,Command="C",ShelfLifeDays=value)])
        with self.assertRaisesRegex(Exception, "Invalid Product field"):
            self.save_shelf(self.product, "1.25")

    def test_retired_requirements_and_excel_scope(self):
        self.create_mix()
        for key in ("BarrierRequirement", "ShelfLifeDays"):
            with self.assertRaises(ValidationError):
                OpportunityBatchRequest(header_rows=[], item_rows=[dict(RowNum=1,Command="U",**{key:None})])
            with self.assertRaises(ValidationError):
                mix.excel.Batch(rows=[dict(row=3,number=self.number,item_changes={key:1})])
        row = next(r for r in mix.excel.document_rows(self.ctx,self.opp) if r["ItemID"] == self.child)
        result = mix.excel.save(mix.excel.Batch(rows=[dict(row=4,number=self.number,opportunity_id=self.opp,
            item_id=self.child,header_version=row["HeaderRowVersion"],item_version=row["ItemRowVersion"],
            item_changes={"PalletSize":"Forbidden"})]),self.ctx)
        self.assertEqual(result["results"][0]["status"],"ERROR",result)
        self.assertIn("parent",result["results"][0]["message"])

    def test_old_layouts_drop_barrier_and_keep_shelf(self):
        for cls in (OpportunityViews, RequestViews):
            views = cls(items={"columns":["ProductCode","BarrierRequirement","ShelfLifeDays"],
                "sort":[{"column":"BarrierRequirement","direction":"asc"}],
                "column_widths":{"BarrierRequirement":100},"prefix_columns":["BarrierRequirement"]})
            self.assertEqual(views.items.columns,["ProductCode","ShelfLifeDays"])
            self.assertEqual(views.items.sort,[])
        self.apply_migration()
        self.save_shelf(self.product, 0)
        self.assertEqual(self.cur.execute("SELECT ShelfLifeDays FROM dbo.Product WHERE ID=?",self.product).fetchval(),0)


if __name__ == "__main__":
    unittest.main()
