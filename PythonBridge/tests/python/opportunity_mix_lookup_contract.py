"""Opportunity lookup keeps unfinished mixes explicit and fresh across worker caches."""
import unittest
from unittest.mock import patch
import main
from cache import cached, invalidate

class OpportunityMixLookup(unittest.TestCase):
    def tearDown(self):
        invalidate("opportunity_master_lookups")

    def read(self):
        return main.opportunity_lookups_read(username="Tester",is_admin=True,scopes=frozenset({"Admin"}))

    def test_opportunity_permission_is_checked_before_pending_product_read(self):
        with patch.object(main,"opportunity_mix_setup_choices") as pending:
            with self.assertRaises(main.HTTPException) as error:
                main.opportunity_lookups_read(username="Tester",is_admin=False,scopes=frozenset())
        self.assertEqual(error.exception.status_code,403)
        pending.assert_not_called()

    def test_pending_mix_is_explained_without_becoming_selectable(self):
        pending=[dict(ID=3,CustomerID=56,ProductCode="PRD-3",ProductName="Test 123")]
        with patch.object(main,"run_read_query",return_value=[]), patch.object(main,"opportunity_shipment_lookups",return_value=([],[])), patch.object(main,"opportunity_mix_setup_choices",return_value=pending,create=True):
            result=self.read()
        self.assertEqual(result.get("unready_products"),pending)
        self.assertEqual(result["products"],[])

    def test_newly_activated_product_bypasses_another_workers_old_lookup_cache(self):
        cached("opportunity_master_lookups",ttl_seconds=60,loader=lambda:dict(customers=[],products=[],mix_children=[],currencies=[]))
        product=dict(ID=3,CustomerID=56,ProductCode="PRD-3",ProductName="Test 123",WeightGrams=200)
        def rows(proc,params):
            return [product] if proc=="dbo.usp_OpportunityProductLookup_Read" else []
        with patch.object(main,"run_read_query",side_effect=rows), patch.object(main,"opportunity_shipment_lookups",return_value=([],[])), patch.object(main,"opportunity_mix_setup_choices",return_value=[],create=True):
            result=self.read()
        self.assertEqual([p["ID"] for p in result["products"]],[3])
