"""Pallet dropdown lookup contracts; SQL fixtures and migration reruns roll back."""
import re
import unittest
from unittest.mock import patch
import pyodbc
import pallet_master_sql_contract as pallet
import main
from fastapi import HTTPException
from packaging_api import execute


class PalletLookup(unittest.TestCase):
    cleanup = pallet.PalletSQL.cleanup
    role = pallet.PalletSQL.role
    save = pallet.PalletSQL.save

    def setUp(self):
        pallet.PalletSQL.setUp(self)
        for _ in range(2):
            for sql in re.split(r"^GO\s*$", (pallet.ROOT / "sql/50_opportunity_pallet_lookup.sql").read_text(), flags=re.M | re.I):
                if sql.strip():
                    self.cur.execute(sql)
                    while self.cur.nextset():
                        pass

    def lookup(self, username):
        return execute("EXEC dbo.usp_OpportunityPalletLookup_Read ?;", [username])[0]

    def test_opportunity_role_sees_only_active_pallets_and_units(self):
        saved = self.save()
        other = self.save(Width="1.2")
        user = self.role("Opportunity")
        unit_code = self.cur.execute("SELECT UoMCode FROM dbo.UoM WHERE ID=?", self.units["M"]).fetchval()
        self.assertIn({"ID": saved["NewID"], "PalletSize": "1.1x1.1" + unit_code}, self.lookup(user.username))
        self.cur.execute("UPDATE dbo.Pallet SET Status='Block' WHERE ID=?", other["NewID"])
        self.assertNotIn(other["NewID"], [r["ID"] for r in self.lookup(user.username)])
        self.cur.execute("UPDATE dbo.UoM SET Status='Block' WHERE ID=?", self.units["M"])
        self.assertNotIn(saved["NewID"], [r["ID"] for r in self.lookup(user.username)])

    def test_lookup_checks_current_live_role(self):
        user = self.role("Opportunity")
        self.lookup(user.username)
        self.cur.execute("DELETE dbo.UserAccess WHERE UserID=?", user.user_id)
        with self.assertRaisesRegex(pyodbc.Error, "51042"):
            self.cur.execute("EXEC dbo.usp_OpportunityPalletLookup_Read ?", user.username)
        user = self.role("Product")
        with self.assertRaisesRegex(pyodbc.Error, "51042"):
            self.cur.execute("EXEC dbo.usp_OpportunityPalletLookup_Read ?", user.username)

    def test_http_lookup_adds_fresh_pallets_without_mutating_cached_choices(self):
        cached = {"customers": [], "products": [], "mix_children": [], "currencies": []}
        with patch.object(main, "cached", return_value=cached), patch.object(main, "run_read_query", side_effect=lambda proc, params: self.lookup(params[0]) if proc == 'dbo.usp_OpportunityPalletLookup_Read' else execute('EXEC '+proc+' ?', params)[0]) as read:
            result = main.opportunity_lookups_read(self.ctx.username, True, frozenset())
            self.assertEqual(result["pallets"], self.lookup(self.ctx.username))
            saved = self.save()
            fresh = main.opportunity_lookups_read(self.ctx.username, True, frozenset())
            self.assertIn(saved["NewID"], [r["ID"] for r in fresh["pallets"]])
            self.assertNotIn("pallets", cached)
            self.assertIn("dbo.usp_OpportunityPalletLookup_Read", [call.args[0] for call in read.call_args_list])
        with self.assertRaises(HTTPException) as error:
            main.opportunity_lookups_read("Product", False, frozenset({"Product"}))
        self.assertEqual(error.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
