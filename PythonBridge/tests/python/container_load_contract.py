"""Container loading exact formulas, immutable snapshots, persistence and access rules."""
import json
import re
import unittest
from decimal import Decimal, localcontext
from pydantic import ValidationError
from fastapi import HTTPException
import web_requirement_sections_contract as requirements
import packing_way_contract as packing
from packing_way import packing_way, INT_MAX
from db import bytes_to_b64
import packaging_api as api


class Math(unittest.TestCase):
    def row(self, configuration="Both", **changes):
        return dict(WeightGrams="10", ResponseLayerCount=3, UnitsPerCarton=10,
                    UnitsPerTertiary=5, CartonsPerLayer=10, LayersPerPallet=5,
                    LayersPerContainer=100, PalletsPerContainer=20,
                    CartonsPerContainerFloor=1200, ConfigurationRequest=configuration, **changes)

    def test_three_layer_container_formulas(self):
        row = packing_way(self.row())
        self.assertEqual(row["CalculatedCartonsPerContainer"], "20000")
        self.assertEqual(row["NetWeightPerContainerKG"], "10000")
        self.assertEqual(row["NetWeightPerContainerFloorKG"], "600")

    def test_configuration_and_each_final_layer(self):
        for layers, expected in ((1, "12"), (2, "120"), (3, "600")):
            source = self.row("Floor load")
            source["ResponseLayerCount"] = layers
            row = packing_way(source)
            self.assertEqual(row["NetWeightPerContainerFloorKG"], expected)
            self.assertIsNone(row["CalculatedCartonsPerContainer"])
            self.assertIsNone(row["NetWeightPerContainerKG"])
        for configuration in ("Pallet load", "", "Legacy instructions"):
            row = packing_way(self.row(configuration))
            self.assertEqual(row["NetWeightPerContainerKG"], "10000")
            self.assertIsNone(row["NetWeightPerContainerFloorKG"])

    def test_missing_and_invalid_counts_are_not_guessed(self):
        for key in ("LayersPerContainer", "PalletsPerContainer", "CartonsPerContainerFloor"):
            for value in (None, "", 0, -1, "1.5", INT_MAX+1):
                row = self.row()
                row[key] = value
                output = dict(LayersPerContainer="CalculatedCartonsPerContainer",
                              PalletsPerContainer="NetWeightPerContainerKG",
                              CartonsPerContainerFloor="NetWeightPerContainerFloorKG")[key]
                self.assertIsNone(packing_way(row)[output])
        row = self.row()
        row["UnitsPerTertiary"] = None
        self.assertIsNone(packing_way(row)["NetWeightPerContainerFloorKG"])
        # Carton counts can still calculate without a weight or packing relationship.
        self.assertEqual(packing_way(row)["CalculatedCartonsPerContainer"], "20000")

    def test_precision_and_large_results_are_exact(self):
        row = self.row()
        row.update(WeightGrams="99999999999999.9999", UnitsPerCarton=INT_MAX,
                   UnitsPerTertiary=INT_MAX, CartonsPerLayer=INT_MAX, LayersPerPallet=INT_MAX,
                   LayersPerContainer=INT_MAX, PalletsPerContainer=INT_MAX)
        result = packing_way(row)
        self.assertEqual(result["CalculatedCartonsPerContainer"], str(INT_MAX**3))
        with localcontext() as ctx:
            ctx.prec = 100
            self.assertEqual(Decimal(result["NetWeightPerContainerKG"]), Decimal(row["WeightGrams"])*INT_MAX**5/1000)


class ContainerSQL(unittest.TestCase):
    cleanup = packing.PackingSQL.cleanup
    apply = packing.PackingSQL.apply
    request = packing.PackingSQL.request
    save_fields = packing.PackingSQL.save_fields
    save = packing.PackingSQL.save
    read = packing.PackingSQL.read

    def migrate(self):
        for filename in ("68_packaging_child_components.sql", "69_packing_way.sql", "70_packaging_container_load.sql"):
            for sql in re.split(r"^GO\s*$", (requirements.mix.foundation.ROOT / "sql" / filename).read_text(), flags=re.M | re.I):
                if sql.strip():
                    self.cur.execute(sql)
                    while self.cur.nextset():
                        pass

    def setUp(self):
        requirements.WebRequirementSections.setUp(self)
        self.migrate()
        self.cur.execute("UPDATE dbo.Product SET WeightGrams=10 WHERE ID=?", self.product)
        self.save_fields(PrimaryTypeID=self.types["Primary"], ConfigurationRequest="Both")
        self.create_request()

    def create_request(self):
        # A weight change after Opportunity creation must not recapture its snapshot.
        # Select a fresh fixture product to establish the intended 10 g starting weight.
        self.product = self.cur.execute("""INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CreatedBy,CustomerID,ShelfLifeDays)
            SELECT 'CT-'+LEFT(CONVERT(VARCHAR(36),NEWID()),16),ProductName+' CT '+LEFT(CONVERT(VARCHAR(36),NEWID()),16),WeightGrams,CreatedBy,CustomerID,ShelfLifeDays
            FROM dbo.Product WHERE ID=?;SELECT CONVERT(INT,SCOPE_IDENTITY())""", self.product).fetchval()
        self.cur.execute("UPDATE dbo.OpportunityItem SET ProductID=? WHERE ID=?", self.product, self.item)
        created = self.request([self.item])
        self.req, self.header = created["items"][0]["ID"], created["header"]["ID"]

    def counts(self):
        return dict(ResponseLayerCount=3, UnitsPerCarton=10, UnitsPerTertiary=5,
                    CartonsPerLayer=10, LayersPerPallet=5, LayersPerContainer=100,
                    PalletsPerContainer=20, CartonsPerContainerFloor=1200)

    def test_saved_counts_reload_totals_and_are_audited(self):
        saved = self.save(**self.counts())
        self.assertEqual(saved["results"][0]["Status"], "OK", saved)
        row = self.read()
        self.assertEqual(tuple(row[k] for k in ("LayersPerContainer", "PalletsPerContainer", "CartonsPerContainerFloor")), (100,20,1200))
        self.assertEqual(tuple(row[k] for k in ("CalculatedCartonsPerContainer", "NetWeightPerContainerKG", "NetWeightPerContainerFloorKG")), ("20000","10000.00","600.00"))
        self.assertEqual(self.cur.execute("""SELECT COUNT(DISTINCT FieldName) FROM dbo.PackagingRequestChangeLog
            WHERE ItemID=? AND FieldName IN('LayersPerContainer','PalletsPerContainer','CartonsPerContainerFloor')
            AND ChangedBy=? AND IsResponse=1""", self.req, self.username).fetchval(), 3)

    def test_partial_edits_preserve_counts_clear_to_blank_and_recalculate(self):
        self.save(**self.counts())
        self.save(PalletsPerContainer=10)
        self.assertEqual(self.read()["NetWeightPerContainerKG"], "5000.00")
        self.assertEqual(self.read()["LayersPerContainer"], 100)
        self.save(LayersPerContainer=None)
        self.assertIsNone(self.read()["CalculatedCartonsPerContainer"])
        self.assertIsNone(self.read()["NetWeightPerContainerKG"])
        self.save(ResponseLayerCount=2)
        self.assertEqual(self.read()["NetWeightPerContainerFloorKG"], "120.00")

    def test_legacy_container_entry_not_overwritten_and_migration_is_idempotent(self):
        self.save(CartonsPerContainer=777, **self.counts())
        before = self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?", self.req).fetchval()
        # Only rerun the current migration, never replay old procedure definitions.
        for _ in range(2):
            for sql in re.split(r"^GO\s*$", (requirements.mix.foundation.ROOT / "sql/70_packaging_container_load.sql").read_text(), flags=re.M | re.I):
                if sql.strip():
                    self.cur.execute(sql)
                    while self.cur.nextset():
                        pass
        row = self.read()
        self.assertEqual(row["CartonsPerContainer"], 777)
        self.assertEqual(row["CalculatedCartonsPerContainer"], "20000")
        self.assertEqual(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?", self.req).fetchval(), before)

    def test_snapshot_weight_not_live_product(self):
        self.save(**self.counts())
        self.cur.execute("UPDATE dbo.Product SET WeightGrams=100 WHERE ID=?", self.product)
        self.assertEqual(self.read()["NetWeightPerContainerFloorKG"], "600.00")

    def test_stale_version_and_unassigned_pic_cannot_change_container_counts(self):
        self.save(**self.counts())
        before = self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?", self.req).fetchval()
        self.cur.execute("SET XACT_ABORT OFF")
        with self.assertRaisesRegex(Exception, "Concurrency conflict"):
            self.cur.execute("EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save ?,?,?,?,0", self.username, self.req, bytes(8), '{"PalletsPerContainer":1}')
        user = "container-pic-" + str(self.req)
        actor = self.cur.execute("INSERT dbo.Users(UserName,IsActive) VALUES(?,1);SELECT CONVERT(INT,SCOPE_IDENTITY())", user).fetchval()
        self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,'Packaging')", actor)
        with self.assertRaisesRegex(Exception, "assigned PIC or Admin"):
            self.cur.execute("EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save ?,?,?,?,0", user, self.req, before, '{"PalletsPerContainer":1}')
        self.assertEqual(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?", self.req).fetchval(), before)
        self.assertEqual(self.read()["PalletsPerContainer"], 20)

    def test_inputs_validate_and_derived_outputs_cannot_be_posted(self):
        for key in ("LayersPerContainer", "PalletsPerContainer", "CartonsPerContainerFloor"):
            for value in (0, -1, "1.5", INT_MAX+1):
                with self.subTest(key=key, value=value), self.assertRaises(ValidationError):
                    self.save(**{key: value})
        for key in ("CalculatedCartonsPerContainer", "NetWeightPerContainerKG", "NetWeightPerContainerFloorKG"):
            with self.subTest(key=key), self.assertRaises(ValidationError):
                self.save(**{key: 1})

    def test_direct_sql_count_validation_and_readonly_outputs(self):
        self.cur.execute("SET XACT_ABORT OFF")
        version = self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?", self.req).fetchval()
        for key in ("LayersPerContainer", "PalletsPerContainer", "CartonsPerContainerFloor"):
            for value in (0, -1, "1.5", INT_MAX+1, True):
                with self.subTest(key=key, value=value), self.assertRaisesRegex(Exception, "positive whole"):
                    self.cur.execute("EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save ?,?,?,?,0", self.username, self.req, version, json.dumps({key: value}))
        with self.assertRaisesRegex(Exception, "Unknown additional field"):
            self.cur.execute("EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save ?,?,?,?,0", self.username, self.req, version, '{"NetWeightPerContainerKG":1}')

    def test_draft_visibility_mask_and_approval(self):
        self.save(**self.counts())
        user = "container-reader-" + str(self.req)
        actor = self.cur.execute("INSERT dbo.Users(UserName,IsActive) VALUES(?,1);SELECT CONVERT(INT,SCOPE_IDENTITY())", user).fetchval()
        self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,'Opportunity')", actor)
        keys = ("LayersPerContainer", "PalletsPerContainer", "CartonsPerContainerFloor",
                "CalculatedCartonsPerContainer", "NetWeightPerContainerKG", "NetWeightPerContainerFloorKG")
        row = self.read(user)
        for key in keys:
            self.assertIsNone(row[key], key)
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Approved',IsOpen=0 WHERE ID=?", self.req)
        self.assertEqual(self.read(user)["NetWeightPerContainerFloorKG"], "600.00")
        with self.assertRaises(HTTPException):
            self.save(PalletsPerContainer=1)


class FloorSQL(unittest.TestCase):
    cleanup = ContainerSQL.cleanup
    apply = ContainerSQL.apply
    request = ContainerSQL.request
    save_fields = ContainerSQL.save_fields
    save = ContainerSQL.save
    read = ContainerSQL.read
    migrate = ContainerSQL.migrate
    create_request = ContainerSQL.create_request
    def setUp(self):
        requirements.WebRequirementSections.setUp(self)
        self.migrate()
        self.cur.execute("UPDATE dbo.Product SET WeightGrams=10 WHERE ID=?", self.product)
        self.save_fields(PrimaryTypeID=self.types["Primary"], ConfigurationRequest=getattr(self, "configuration", "Floor load"))
        self.create_request()

    def counts(self):
        return dict(ResponseLayerCount=3, UnitsPerCarton=10, UnitsPerTertiary=5,
                    CartonsPerLayer=10, LayersPerPallet=5, CartonsPerContainerFloor=1200)

    def test_floor_configuration_rejects_pallet_counts(self):
        saved = self.save(**self.counts())
        self.assertEqual(saved["results"][0]["Status"], "OK", saved)
        row = self.read()
        self.assertEqual(row["NetWeightPerContainerFloorKG"], "600.00")
        self.assertIsNone(row["NetWeightPerContainerKG"])
        self.cur.execute("SET XACT_ABORT OFF")
        version = self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?", self.req).fetchval()
        with self.assertRaisesRegex(Exception, "configuration snapshot"):
            self.cur.execute("EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save ?,?,?,?,0", self.username, self.req, version, '{"PalletsPerContainer":1}')


class PalletSQL(unittest.TestCase):
    configuration = "Pallet load"
    cleanup = FloorSQL.cleanup
    apply = FloorSQL.apply
    request = FloorSQL.request
    save_fields = FloorSQL.save_fields
    save = FloorSQL.save
    read = FloorSQL.read
    migrate = FloorSQL.migrate
    create_request = FloorSQL.create_request
    setUp = FloorSQL.setUp

    def test_pallet_configuration_rejects_floor_counts(self):
        result = self.save(ResponseLayerCount=1, CartonsPerLayer=10, LayersPerPallet=5,
                           LayersPerContainer=100, PalletsPerContainer=20)
        self.assertEqual(result["results"][0]["Status"], "OK", result)
        self.assertEqual(self.read()["NetWeightPerContainerKG"], "200.00")
        self.assertIsNone(self.read()["NetWeightPerContainerFloorKG"])
        self.cur.execute("SET XACT_ABORT OFF")
        version = self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?", self.req).fetchval()
        with self.assertRaisesRegex(Exception, "configuration snapshot"):
            self.cur.execute("EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save ?,?,?,?,0", self.username, self.req, version, '{"CartonsPerContainerFloor":1}')


if __name__ == "__main__":
    unittest.main()
