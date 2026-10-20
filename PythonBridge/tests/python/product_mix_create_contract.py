"""Initial Product Mix saves atomically with the new Product; local fixtures roll back."""
import unittest
from contextlib import contextmanager
from unittest.mock import patch
from uuid import uuid4
from pydantic import ValidationError
import packaging_field_foundation_contract as foundation
import packaging_fields
from main import product_batch
from schemas import ProductBatchRequest
from db import bytes_to_b64

class ProductMixCreate(unittest.TestCase):
    cleanup=foundation.PackagingFoundation.cleanup
    def setUp(self):
        foundation.PackagingFoundation.setUp(self)
        @contextmanager
        def cursor():
            yield self.cur
        mocked=patch.object(packaging_fields,"get_raw_cursor",cursor)
        mocked.start()
        self.addCleanup(mocked.stop)
        self.name="Initial mix "+uuid4().hex
        self.token=bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.Product WHERE ID=?",self.product).fetchval())
    def row(self,**changes):
        return dict(RowNum=1,Command="C",CustomerID=self.customer,IsMix=True,ProductName=self.name,
            WeightValue=0,WeightUnit="g",Category=self.cur.execute("SELECT TOP(1) CategoryName FROM dbo.ProductCategory WHERE Status='Active' ORDER BY ID").fetchval(),
            MixVersion=dict(Status="Active",items=[dict(ProductID=self.product,UnitQuantity="2.5",RowVersion=self.token)]),**changes)
    def save(self,row):
        return product_batch(ProductBatchRequest(rows=[row]),self.username,True,frozenset({"Admin"}))["results"][0]
    def test_parent_and_active_children_are_saved_together_with_server_weight(self):
        result=self.save(self.row())
        self.assertEqual(result["Status"],"OK",result)
        self.assertEqual(self.cur.execute("SELECT WeightGrams FROM dbo.Product WHERE ID=?",result["NewID"]).fetchval(),250)
        self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.ProductMixVersion WHERE ProductID=? AND Status='Active'",result["NewID"]).fetchval(),1)
        version=self.cur.execute("SELECT ID FROM dbo.ProductMixVersion WHERE ProductID=?",result["NewID"]).fetchval()
        self.assertEqual(self.cur.execute("SELECT UnitQuantity FROM dbo.ProductMixItem WHERE VersionID=?",version).fetchval(),2.5)
        self.assertEqual(result["NewRowVersion"],bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.Product WHERE ID=?",result["NewID"]).fetchval()))
    def test_stale_child_rolls_back_the_new_parent(self):
        row=self.row()
        self.cur.execute("UPDATE dbo.Product SET ShelfLifeDays=9 WHERE ID=?",self.product)
        result=self.save(row)
        self.assertEqual(result["Status"],"ERROR",result)
        self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.Product WHERE ProductName=?",self.name).fetchval(),0)
    def test_blocked_child_is_rejected_and_parent_is_rolled_back(self):
        row=self.row()
        self.cur.execute("UPDATE dbo.Product SET Status='Block' WHERE ID=?",self.product)
        row["MixVersion"]["items"][0]["RowVersion"]=bytes_to_b64(
            self.cur.execute("SELECT RowVersion FROM dbo.Product WHERE ID=?",self.product).fetchval())
        result=self.save(row)
        self.assertEqual(result["Status"],"ERROR",result)
        self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.Product WHERE ProductName=?",self.name).fetchval(),0)

    def test_initial_draft_saves_children_without_an_active_weight(self):
        row=self.row()
        row["MixVersion"]["Status"]="Draft"
        result=self.save(row)
        self.assertEqual(result["Status"],"OK",result)
        self.assertEqual(self.cur.execute("SELECT WeightGrams FROM dbo.Product WHERE ID=?",result["NewID"]).fetchval(),0)
        self.assertEqual(self.cur.execute("SELECT Status FROM dbo.ProductMixVersion WHERE ProductID=?",result["NewID"]).fetchval(),"Draft")

    def test_schema_rejects_invalid_child_payload_and_mix_on_updates_or_normal_products(self):
        row=self.row()
        for altered in ({**row,"IsMix":False},{**row,"Command":"U"},{**row,"MixVersion":{"Status":"Active","items":[]}},
                        {**row,"MixVersion":{"Status":"Active","items":row["MixVersion"]["items"]*2}}):
            with self.assertRaises(ValidationError):
                ProductBatchRequest(rows=[altered])
