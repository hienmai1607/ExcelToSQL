"""Rollback-only checks of incomplete mix discovery and SQL eligibility."""
import unittest
from contextlib import contextmanager
from unittest.mock import patch
from uuid import uuid4
import packaging_field_foundation_contract as foundation
import packaging_api
import product_mix_api as mixes
from auth import AccessContext
from db import bytes_to_b64

class OpportunityMixSetupSQL(unittest.TestCase):
    cleanup=foundation.PackagingFoundation.cleanup

    def setUp(self):
        foundation.PackagingFoundation.setUp(self)
        @contextmanager
        def cursor():
            fresh=self.conn.cursor()
            try:
                yield fresh
            finally:
                fresh.close()
        mocked=patch.object(packaging_api,"get_raw_cursor",cursor)
        mocked.start()
        self.addCleanup(mocked.stop)
        self.mix=self.cur.execute("""INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CreatedBy,CustomerID,IsMix)
            VALUES(?,?,0,?,?,1); SELECT CONVERT(INT,SCOPE_IDENTITY())""",
            "MX-"+uuid4().hex[:16],"Setup "+uuid4().hex,self.actor,self.customer).fetchval()
        self.ctx=AccessContext(self.actor,self.username,frozenset({"Admin"}))

    def selectable(self):
        self.cur.execute("EXEC dbo.usp_OpportunityProductLookup_Read ?",self.username)
        return {r.ID for r in self.cur.fetchall()}

    def pending(self):
        return {r["ID"] for r in mixes.opportunity_mix_setup_choices()}

    def test_draft_stays_unselectable_then_activation_moves_to_ready_choices(self):
        self.assertIn(self.mix,self.pending())
        self.assertNotIn(self.mix,self.selectable())
        def body(status,**version):
            return mixes.MixSave(ProductRowVersion=bytes_to_b64(
                self.cur.execute("SELECT RowVersion FROM dbo.Product WHERE ID=?",self.mix).fetchval()),
                Status=status,items=[dict(ProductID=self.product,UnitQuantity="2",
                    RowVersion=bytes_to_b64(self.cur.execute(
                        "SELECT RowVersion FROM dbo.Product WHERE ID=?",self.product).fetchval()))],**version)
        draft=mixes.save(body("Draft"),self.mix,self.ctx)["ID"]
        self.assertIn(self.mix,self.pending())
        self.assertNotIn(self.mix,self.selectable())
        version=bytes_to_b64(self.cur.execute(
            "SELECT RowVersion FROM dbo.ProductMixVersion WHERE ID=?",draft).fetchval())
        mixes.save(body("Active",VersionID=draft,RowVersion=version),self.mix,self.ctx)
        self.assertNotIn(self.mix,self.pending())
        self.assertIn(self.mix,self.selectable())

    def test_blocked_and_normal_products_do_not_appear_as_incomplete_mixes(self):
        self.assertNotIn(self.product,self.pending())
        self.cur.execute("UPDATE dbo.Product SET Status='Block' WHERE ID=?",self.mix)
        self.assertNotIn(self.mix,self.pending())
        self.assertNotIn(self.mix,self.selectable())
