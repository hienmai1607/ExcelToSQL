"""Packing Way exact arithmetic, persistence, snapshots, roles and SQL validation."""
import json
import re
import unittest
from pydantic import ValidationError
from fastapi import HTTPException
import web_requirement_sections_contract as requirements
from packing_way import packing_way, INT_MAX
from request_views import item_read
from db import bytes_to_b64
import packaging_api as api


class Math(unittest.TestCase):
    def test_examples_and_one_layer(self):
        for layers, expected in ((1, ("10", None, None, "0.5")), (2, ("10", "100", None, "5")), (3, ("10", "100", "500", "25"))):
            row = packing_way(dict(WeightGrams="10", ResponseLayerCount=layers, UnitsPerCarton=10,
                                   UnitsPerTertiary=5, CartonsPerLayer=10, LayersPerPallet=5))
            self.assertEqual(tuple(row[k] for k in ("PrimaryNetWeightGrams", "SecondaryNetWeightGrams", "TertiaryNetWeightGrams", "NetWeightPerPalletKG")), expected)
            final = ("NoOfPrimaryUnit", "NoOfSecondaryUnit", "NoOfTertiaryUnit")[layers-1]
            self.assertEqual(row[final], 1)

    def test_incomplete_values_are_blank_not_guessed(self):
        row = packing_way(dict(WeightGrams="10", ResponseLayerCount=3, UnitsPerCarton=10, CartonsPerLayer=1, LayersPerPallet=1))
        self.assertEqual(row["SecondaryNetWeightGrams"], "100")
        self.assertIsNone(row["TertiaryNetWeightGrams"])
        self.assertIsNone(row["NetWeightPerPalletKG"])
        for value in (None, "", "NaN", "-1"):
            self.assertIsNone(packing_way(dict(WeightGrams=value))["PrimaryNetWeightGrams"])

    def test_precision_and_large_integer_factors_are_exact(self):
        row = packing_way(dict(WeightGrams="0.1234", RequestedLayerCount=3, UnitsPerCarton=10,
                               UnitsPerTertiary=5, CartonsPerLayer=10, LayersPerPallet=5))
        self.assertEqual(row["SecondaryNetWeightGrams"], "1.2340")
        self.assertEqual(row["TertiaryNetWeightGrams"], "6.1700")
        self.assertEqual(row["NetWeightPerPalletKG"], "0.3085")
        row = packing_way(dict(WeightGrams="99999999999999.9999", ResponseLayerCount=3,
                               UnitsPerCarton=INT_MAX, UnitsPerTertiary=INT_MAX, CartonsPerLayer=INT_MAX, LayersPerPallet=INT_MAX))
        from decimal import Decimal, localcontext
        with localcontext() as ctx:
            ctx.prec = 100
            self.assertEqual(Decimal(row["NetWeightPerPalletGrams"]), Decimal("99999999999999.9999") * INT_MAX**4)


class PackingSQL(unittest.TestCase):
    cleanup = requirements.WebRequirementSections.cleanup
    apply = requirements.WebRequirementSections.apply
    request = requirements.WebRequirementSections.request
    save_fields = requirements.WebRequirementSections.save_fields

    def setUp(self):
        requirements.WebRequirementSections.setUp(self)
        for _ in range(2):
            for filename in ("68_packaging_child_components.sql", "69_packing_way.sql"):
                for sql in re.split(r"^GO\s*$", (requirements.mix.foundation.ROOT / "sql" / filename).read_text(), flags=re.M | re.I):
                    if sql.strip():
                        self.cur.execute(sql)
                        while self.cur.nextset():
                            pass
        self.cur.execute("UPDATE dbo.Product SET WeightGrams=10 WHERE ID=?", self.product)
        self.save_fields(PrimaryTypeID=self.types["Primary"])
        created = self.request([self.item])
        self.req = created["items"][0]["ID"]
        self.header = created["header"]["ID"]

    def save(self, **fields):
        version = bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?", self.req).fetchval())
        return api.response_save(api.ResponseBatch(rows=[dict(RowNum=1, ID=self.req, RowVersion=version, **fields)]), self.ctx)

    def read(self, username=None):
        return item_read(username or self.username, self.header, 1, 25, None, None, "[]")["rows"][0]

    def test_save_reload_three_layer_example_and_audit(self):
        saved = self.save(ResponseLayerCount=3, UnitsPerCarton=10, UnitsPerTertiary=5, CartonsPerLayer=10, LayersPerPallet=5)
        self.assertEqual(saved["results"][0]["Status"], "OK", saved)
        row = self.read()
        self.assertEqual((row["NoOfPrimaryUnit"], row["NoOfSecondaryUnit"], row["NoOfTertiaryUnit"]), (10, 5, 1))
        self.assertEqual(tuple(row[k] for k in ("PrimaryNetWeightGrams", "SecondaryNetWeightGrams", "TertiaryNetWeightGrams", "NetWeightPerPalletKG")), ("10.00", "100.00", "500.00", "25.00"))
        self.assertEqual(tuple(self.cur.execute("SELECT UnitsPerCarton,UnitsPerTertiary,CartonsPerLayer,LayersPerPallet FROM dbo.PackagingConfigurationRequestItem WHERE ID=?", self.req).fetchone()), (10,5,10,5))
        self.assertEqual(self.cur.execute("SELECT COUNT(DISTINCT FieldName) FROM dbo.PackagingRequestChangeLog WHERE ItemID=? AND FieldName IN('UnitsPerCarton','UnitsPerTertiary') AND ChangedBy=?", self.req, self.username).fetchval(), 2)

    def test_two_and_one_layers_clear_inactive_counts_and_do_not_change_request(self):
        self.save(ResponseLayerCount=3, UnitsPerCarton=10, UnitsPerTertiary=5, CartonsPerLayer=10, LayersPerPallet=5)
        self.save(ResponseLayerCount=2)
        row = self.read()
        self.assertEqual((row["NoOfPrimaryUnit"], row["NoOfSecondaryUnit"], row["NoOfTertiaryUnit"]), (10,1,None))
        self.assertEqual(row["NetWeightPerPalletKG"], "5.00")
        self.assertIsNone(row["UnitsPerTertiary"])
        self.save(ResponseLayerCount=1)
        row = self.read()
        self.assertEqual((row["NoOfPrimaryUnit"], row["NoOfSecondaryUnit"], row["NoOfTertiaryUnit"]), (1,None,None))
        self.assertEqual(row["NetWeightPerPalletKG"], "0.50")
        self.assertIsNone(row["UnitsPerCarton"])
        self.assertEqual(row["RequestedLayerCount"], 2)

    def test_weights_use_request_snapshot_not_later_product_weight(self):
        self.save(ResponseLayerCount=3, UnitsPerCarton=10, UnitsPerTertiary=5, CartonsPerLayer=10, LayersPerPallet=5)
        self.cur.execute("UPDATE dbo.Product SET WeightGrams=20 WHERE ID=?", self.product)
        row = self.read()
        self.assertEqual(row["PrimaryNetWeightGrams"], "10.00")
        self.assertEqual(row["TertiaryNetWeightGrams"], "500.00")

    def test_incomplete_draft_and_missing_weight_are_not_zero(self):
        self.save(ResponseLayerCount=3, UnitsPerCarton=10, CartonsPerLayer=10, LayersPerPallet=5)
        row = self.read()
        self.assertEqual(row["SecondaryNetWeightGrams"], "100.00")
        self.assertIsNone(row["TertiaryNetWeightGrams"])
        self.assertIsNone(row["NetWeightPerPalletKG"])

    def test_readonly_calculations_and_out_of_range_counts_rejected(self):
        for key in ("NoOfPrimaryUnit", "NoOfSecondaryUnit", "NoOfTertiaryUnit", "PrimaryNetWeightGrams", "NetWeightPerPalletKG"):
            with self.subTest(key=key), self.assertRaises(ValidationError):
                self.save(**{key: 1})
        for key in ("UnitsPerCarton", "UnitsPerTertiary", "CartonsPerLayer", "LayersPerPallet"):
            for value in (0, -1, "1.5", INT_MAX + 1):
                with self.subTest(key=key, value=value), self.assertRaises(ValidationError):
                    self.save(**{key: value})

    def test_direct_sql_cannot_truncate_fractional_or_accept_invalid_counts(self):
        self.cur.execute("SET XACT_ABORT OFF")
        before = self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?", self.req).fetchval()
        for key in ("UnitsPerCarton", "CartonsPerLayer", "LayersPerPallet"):
            for value in (0, "1.5", INT_MAX + 1, True):
                with self.subTest(key=key, value=value), self.assertRaisesRegex(Exception, "positive whole"):
                    self.cur.execute("EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save ?,?,?,?,0", self.username, self.req, before, json.dumps({key: value}))
        self.assertEqual(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?", self.req).fetchval(), before)

    def test_draft_weights_are_masked_for_opportunity_but_visible_after_approval(self):
        user = "packing-reader-" + str(self.req)
        id = self.cur.execute("INSERT dbo.Users(UserName,IsActive) VALUES(?,1);SELECT CONVERT(INT,SCOPE_IDENTITY())", user).fetchval()
        self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,'Opportunity')", id)
        self.save(ResponseLayerCount=3, UnitsPerCarton=10, UnitsPerTertiary=5, CartonsPerLayer=10, LayersPerPallet=5)
        row = self.read(user)
        for key in ("NoOfPrimaryUnit", "NoOfSecondaryUnit", "NoOfTertiaryUnit", "PrimaryNetWeightGrams", "TertiaryNetWeightGrams", "NetWeightPerPalletKG"):
            self.assertIsNone(row[key], key)
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Approved',IsOpen=0 WHERE ID=?", self.req)
        self.assertEqual(self.read(user)["NetWeightPerPalletKG"], "25.00")

    def test_approved_and_stale_responses_cannot_be_changed(self):
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Approved',IsOpen=0 WHERE ID=?", self.req)
        with self.assertRaises(HTTPException):
            self.save(UnitsPerCarton=10)


if __name__ == "__main__":
    unittest.main()
