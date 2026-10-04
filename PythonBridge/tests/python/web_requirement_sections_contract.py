"""Web-only requirements, live lookups and frozen request snapshots; fixtures roll back."""
import json
import re
import unittest
from uuid import uuid4
from pydantic import ValidationError
import opportunity_mix_sql_contract as mix
from packaging_fields import OPPORTUNITYITEM_FIELDS, consume
from opportunity_excel_api import ITEM_EDITABLE
from opportunity_views import sorted_grid
from request_views import item_read
from schemas import OpportunityBatchRequest


class WebRequirementSections(unittest.TestCase):
    cleanup = mix.OpportunityMixSQL.cleanup
    batch = mix.OpportunityMixSQL.batch
    edit = mix.OpportunityMixSQL.edit
    request = mix.OpportunityMixSQL.request
    activate = mix.OpportunityMixSQL.activate
    create_mix = mix.OpportunityMixSQL.create_mix

    def apply(self):
        for name in ("48_product_shelf_life_packaging_scope.sql", "56_web_packaging_requirement_sections.sql",
                     "58_packaging_response_nut_density.sql", "66_packaging_type_orders.sql", "67_packaging_layers.sql",
                     "71_packaging_request_layer_details.sql", "82_opportunity_product_weight_snapshot.sql"):
            for sql in re.split(r"^GO\s*$", (mix.foundation.ROOT / "sql" / name).read_text(), flags=re.M | re.I):
                if sql.strip():
                    self.cur.execute(sql)
                    while self.cur.nextset():
                        pass
        self.cur.execute("SET XACT_ABORT OFF")

    def setUp(self):
        mix.OpportunityMixSQL.setUp(self)
        self.apply()
        self.apply()
        self.types = {}
        for order in ("Primary", "Secondary"):
            name = "REQ-" + uuid4().hex[:16]
            self.types[order] = self.cur.execute("""INSERT dbo.PackagingType(PackagingOrder,PackagingType,PriceBasis,TareWeight,CreatedBy)
                VALUES(?,?,'Count',0,?);SELECT CONVERT(INT,SCOPE_IDENTITY())""", order, name, self.actor).fetchval()
        self.cur.execute("UPDATE dbo.Product SET ShelfLifeDays=365 WHERE ID=?", self.product)

    def save_fields(self, **fields):
        version = self.cur.execute("SELECT RowVersion FROM dbo.OpportunityItem WHERE ID=?", self.item).fetchval()
        self.cur.execute("EXEC dbo.usp_OpportunityItem_Fields_Save ?,?,?,?,0",
                         self.username, self.item, version, json.dumps(fields))
        return consume(self.cur)[0][0]

    def test_web_save_read_and_audit_without_legacy_packaging_type(self):
        result = self.batch(self.edit(self.item, ProductID=self.product, ItemDescription="Web requirements", AnnualUnit=100,
            WebPackagingRequirements=True, ContainerRequest="Reefer",
            ConfigurationRequest="Both", PalletStacking="Double", MaxPalletHeightM="1.8",
            PrimaryTypeID=self.types["Primary"], SecondaryTypeID=self.types["Secondary"],
            Transparency="Transparent", SecondaryTransparency="Opaque", NumberOfPrimary=12))
        self.assertEqual(result["item_results"][0]["Status"], "OK", result)
        rows = sorted_grid(self.username, 1, 25, "[]", self.number, None, None, None, None)["rows"]
        row = next(r for r in rows if r["ItemID"] == self.item)
        self.assertEqual(row["PrimaryTypeID"], self.types["Primary"])
        self.assertEqual(row["NumberOfPrimary"], 12)
        self.assertEqual(row["ShelfLifeDays"], 365)
        self.assertIsNone(row["PackagingType"])
        self.assertEqual(self.cur.execute("""SELECT COUNT(*) FROM dbo.OpportunityChangeLog
            WHERE ItemID=? AND FieldName='PrimaryTypeID' AND ChangedBy=? AND Source='User'""", self.item, self.username).fetchval(), 1)

    def test_wrong_order_child_and_blocked_types_rejected(self):
        self.cur.execute("UPDATE dbo.PackagingType SET ParentTypeID=? WHERE ID=?", self.types["Primary"], self.types["Secondary"])
        for fields in (dict(PrimaryTypeID=self.types["Secondary"]), dict(SecondaryTypeID=self.types["Primary"]), dict(SecondaryTypeID=self.types["Secondary"])):
            with self.assertRaisesRegex(Exception, "matching Order"):
                self.save_fields(**fields)
        self.cur.execute("UPDATE dbo.PackagingType SET Status='Block' WHERE ID=?", self.types["Primary"])
        with self.assertRaisesRegex(Exception, "top-level"):
            self.save_fields(PrimaryTypeID=self.types["Primary"])

    def test_enum_validation_is_web_only_and_keeps_unchanged_legacy(self):
        for fields in (dict(ContainerRequest="Cold"), dict(ConfigurationRequest="Other"), dict(PalletStacking="Triple"), dict(Transparency="Clear")):
            with self.assertRaisesRegex(Exception, "valid Container"):
                self.save_fields(WebPackagingRequirements=True, **fields)
        self.save_fields(ContainerRequest="40HC", ConfigurationRequest="Old instruction", PalletStacking="Yes", Transparency="Legacy")
        self.save_fields(WebPackagingRequirements=True, ContainerRequest="40HC", ConfigurationRequest="Old instruction", PalletStacking="Yes", Transparency="Legacy", SpecialComments="Unrelated edit")
        self.assertEqual(self.cur.execute("SELECT ContainerRequest FROM dbo.OpportunityItem WHERE ID=?", self.item).fetchval(), "40HC")
        with self.assertRaisesRegex(Exception, "Secondary transparency"):
            self.save_fields(SecondaryTransparency="Clear")

    def test_floor_load_clears_hidden_pallet_values_and_partial_edits_preserve_types(self):
        self.save_fields(ConfigurationRequest="Pallet load", PalletStacking="Single", MaxPalletHeightM="1.5", PrimaryTypeID=self.types["Primary"])
        self.save_fields(WebPackagingRequirements=True, ConfigurationRequest="Floor load")
        row = self.cur.execute("SELECT PalletSize,PalletStacking,MaxPalletHeightM,PrimaryTypeID FROM dbo.OpportunityItem WHERE ID=?", self.item).fetchone()
        self.assertEqual(tuple(row[:3]), (None, None, None))
        self.assertEqual(row.PrimaryTypeID, self.types["Primary"])
        self.save_fields(PrimaryTypeID=None)
        self.assertIsNone(self.cur.execute("SELECT PrimaryTypeID FROM dbo.OpportunityItem WHERE ID=?", self.item).fetchval())

    def test_number_of_primary_validation(self):
        for value in (0, -1, 1.5, 2147483648):
            with self.assertRaises(ValidationError):
                OpportunityBatchRequest(header_rows=[], item_rows=[self.edit(self.item, NumberOfPrimary=value)])
        for value in (0, "1.5", "2147483648"):
            with self.assertRaisesRegex(Exception, "positive whole"):
                self.save_fields(NumberOfPrimary=value)

    def test_current_lookup_roles_root_only_and_live_revocation(self):
        self.cur.execute("UPDATE dbo.PackagingType SET ParentTypeID=? WHERE ID=?", self.types["Primary"], self.types["Secondary"])
        rows = mix.packaging.execute("EXEC dbo.usp_OpportunityPackagingTypeLookup_Read ?", [self.username])[0]
        self.assertIn(self.types["Primary"], [r["ID"] for r in rows])
        self.assertNotIn(self.types["Secondary"], [r["ID"] for r in rows])
        name = "REQ-user-" + uuid4().hex[:12]
        actor = self.cur.execute("INSERT dbo.Users(UserName,IsActive) VALUES(?,1);SELECT CONVERT(INT,SCOPE_IDENTITY())", name).fetchval()
        self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,'Opportunity')", actor)
        self.cur.execute("EXEC dbo.usp_OpportunityPackagingTypeLookup_Read ?", name)
        consume(self.cur)
        self.cur.execute("DELETE dbo.UserAccess WHERE UserID=?", actor)
        with self.assertRaisesRegex(Exception, "Opportunity access"):
            self.cur.execute("EXEC dbo.usp_OpportunityPackagingTypeLookup_Read ?", name)

    def test_request_snapshots_types_numbers_and_shelf_independent_of_response_and_product_edits(self):
        self.save_fields(PrimaryTypeID=self.types["Primary"], SecondaryTypeID=self.types["Secondary"],
                         NumberOfPrimary=12, Transparency="NA", SecondaryTransparency="Opaque")
        request = self.request([self.item])
        saved = request["items"][0]["ID"]
        row = self.cur.execute("SELECT PrimaryTypeName,SecondaryTypeName,FirstPMType,SecondPMType FROM dbo.PackagingConfigurationRequestItem WHERE ID=?", saved).fetchone()
        self.assertTrue(row.PrimaryTypeName.startswith("REQ-"))
        self.assertTrue(row.SecondaryTypeName.startswith("REQ-"))
        self.assertEqual(row.FirstPMType,row.PrimaryTypeName)
        self.assertEqual(row.SecondPMType,row.SecondaryTypeName)
        self.cur.execute("UPDATE dbo.PackagingType SET PackagingType='Changed master' WHERE ID=?", self.types["Primary"])
        self.cur.execute("UPDATE dbo.Product SET ShelfLifeDays=180 WHERE ID=?", self.product)
        read = item_read(self.username, request["header"]["ID"], 1, 25, None, None, "[]")["rows"][0]
        self.assertEqual(read["PrimaryTypeName"], row.PrimaryTypeName)
        self.assertEqual(read["SecondaryTypeName"], row.SecondaryTypeName)
        self.assertEqual(read["PrimaryTypeID"], self.types["Primary"])
        self.assertEqual(read["SecondaryTypeID"], self.types["Secondary"])
        self.assertEqual(read["Transparency"], "NA")
        self.assertEqual(read["SecondaryTransparency"], "Opaque")
        self.assertEqual(read["NumberOfPrimary"], 12)
        self.assertEqual(read["ShelfLifeDays"], 365)
        self.assertNotIn("ProductShelfLifeDays", read)
        self.assertEqual(self.cur.execute("SELECT ShelfLifeDays FROM dbo.Product WHERE ID=?", self.product).fetchval(), 180)
        self.assertGreater(self.cur.execute("""SELECT COUNT(*) FROM dbo.PackagingRequestChangeLog
            WHERE ItemID=? AND FieldName='PrimaryTypeName' AND Source='User' AND ChangedBy=?""", saved, self.username).fetchval(), 0)

    def test_processing_lock_covers_new_fields(self):
        self.save_fields(PrimaryTypeID=self.types["Primary"])
        self.request([self.item])
        with self.assertRaisesRegex(Exception, "52952"):
            self.cur.execute("UPDATE dbo.OpportunityItem SET NumberOfPrimary=2 WHERE ID=?", self.item)

    def test_mix_child_accepts_new_packaging_fields_without_logistics(self):
        self.create_mix()
        result = self.batch(self.edit(self.child, WebPackagingRequirements=True, ConfigurationRequest="Floor load",
            PrimaryTypeID=self.types["Primary"], NumberOfPrimary=4, SecondaryTransparency="NA"))
        self.assertEqual(result["item_results"][0]["Status"], "OK", result)
        self.assertEqual(self.cur.execute("SELECT NumberOfPrimary FROM dbo.OpportunityItem WHERE ID=?", self.child).fetchval(), 4)

    def test_excel_editable_and_layout_fields_unchanged(self):
        for field in ("PrimaryTypeID", "SecondaryTypeID", "SecondaryTransparency", "NumberOfPrimary", "WebPackagingRequirements"):
            self.assertNotIn(field, OPPORTUNITYITEM_FIELDS)
            self.assertNotIn(field, ITEM_EDITABLE)


if __name__ == "__main__":
    unittest.main()
