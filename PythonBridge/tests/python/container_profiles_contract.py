"""Container-type loading: exact totals, snapshots, partial saves and SQL access rules."""
import json
import unittest
from pydantic import ValidationError
from fastapi import HTTPException
import response_pallet_defaults_contract as foundation
from packing_way import packing_way, INT_MAX
from container_loading import container_types, container_results
from request_views import item_read
from db import bytes_to_b64
import packaging_api as api


class Math(unittest.TestCase):
    def test_families_and_formula(self):
        self.assertEqual(container_types("Dry"), ("20DC", "40DC", "40HC"))
        self.assertEqual(container_types("Reefer"), ("20RC", "40RHC"))
        self.assertEqual(len(container_types("Both")), 5)
        row=dict(WeightGrams=100,ResponseLayerCount=3,UnitsPerCarton=12,UnitsPerTertiary=5,
                 CartonsPerLayer=10,LayersPerPallet=99,ConfigurationRequest="Both",
                 HeightMM=600,ResponseMaxPalletHeightMM=1850,
                 SelectedContainerType="40HC",ContainerLoadProfiles={
                     "20DC":dict(PalletsPerContainer=10,LayersPerContainer=4,CartonsPerContainerFloor=100),
                     "40HC":dict(PalletsPerContainer=20,LayersPerContainer=5,CartonsPerContainerFloor=200)})
        active=packing_way(row)
        self.assertEqual(active["CalculatedCartonsPerContainer"],"600")
        self.assertEqual(active["NetWeightPerContainerKG"],"3600")
        self.assertEqual(active["NetWeightPerContainerFloorKG"],"1200")
        results=container_results(row)
        self.assertEqual(results["20DC"]["CalculatedCartonsPerContainer"],"300")
        self.assertEqual(results["20DC"]["NetWeightPerContainerKG"],"1800")

    def test_zero_missing_and_large_capacities(self):
        row=dict(WeightGrams=1,ResponseLayerCount=1,SelectedContainerType="20DC",
                 HeightMM=400,ResponseMaxPalletHeightMM=950,
                 PalletsPerContainer=0,CartonsPerLayer=10,LayersPerContainer=5)
        self.assertEqual(packing_way(row)["CalculatedCartonsPerContainer"],"0")
        row["PalletsPerContainer"]=None
        self.assertIsNone(packing_way(row)["CalculatedCartonsPerContainer"])
        row.update(PalletsPerContainer=INT_MAX,CartonsPerLayer=INT_MAX,LayersPerContainer=INT_MAX)
        self.assertEqual(packing_way(row)["CalculatedCartonsPerContainer"],str(INT_MAX**2*5))

    def test_model_rejects_unknown_types_derived_fields_and_invalid_counts(self):
        for profile in ({"99XX":{}},{"20DC":{"NetWeightPerContainerKG":123}},
                        {"20DC":{"LayersPerContainer":-1}},{"20DC":{"CartonsPerContainerFloor":"1.5"}},
                        {"20DC":{"LayersPerContainer":True}},
                        {"20DC":{"PalletsPerContainer":INT_MAX+1}}):
            with self.assertRaises(ValidationError):
                api.ResponseRow(RowNum=1,ID=1,RowVersion="AAAAAAAAAAE=",ContainerLoadProfiles=profile)


class ProfileFixture:
    cleanup=foundation.ResponsePalletSQL.cleanup
    apply=foundation.ResponsePalletSQL.apply
    request=foundation.ResponsePalletSQL.request
    save_fields=foundation.ResponsePalletSQL.save_fields
    migrate=foundation.ResponsePalletSQL.migrate
    save=foundation.ResponsePalletSQL.save
    family="Both"
    configuration="Both"

    def setUp(self):
        foundation.foundation.WebRequirementSections.setUp(self)
        for name in ("68_packaging_child_components.sql","69_packing_way.sql",
                     "70_packaging_container_load.sql","71_packaging_request_layer_details.sql",
                     "72_packaging_response_pallet_defaults.sql","76_packaging_pallet_layers.sql",
                     "83_packaging_container_profiles.sql","84_packaging_container_layers.sql",
                     "85_packaging_container_shipping_height.sql"):
            self.migrate(name)
        unit=self.cur.execute("SELECT TOP(1) ID FROM dbo.UoM WHERE UoMCode='mm' AND Status='Active'").fetchval()
        self.pallet=self.cur.execute("""INSERT dbo.Pallet(UoMID,Width,Length,CreatedBy,Status,
            PalletsPer20DC,PalletsPer40DC,PalletsPer40HC,PalletsPer20RC,PalletsPer40RHC)
            VALUES(?,1131,1193,?,'Active',10,20,22,8,18);SELECT CONVERT(INT,SCOPE_IDENTITY())""",unit,self.actor).fetchval()
        self.size=self.cur.execute("SELECT PalletSize FROM dbo.v_PalletMaster WHERE ID=?",self.pallet).fetchval()
        self.save_fields(WebPackagingRequirements=True,ContainerRequest=self.family,
            ConfigurationRequest=self.configuration,PrimaryTypeID=self.types["Primary"],
            SecondaryTypeID=self.types["Secondary"],NumberOfPrimary=12,PalletSize=self.size,
            PalletStacking="Single",MaxPalletHeightMM=1800)
        created=self.request([self.item]);self.req=created["items"][0]["ID"];self.header=created["header"]["ID"]
        self.save(HeightMM=600,ResponseMaxPalletHeightMM=1850)

    def read(self,username=None):
        return item_read(username or self.username,self.header,1,25,None,None,"[]")["rows"][0]

    def profiles(self):
        return json.loads(self.cur.execute("SELECT ContainerLoadProfiles FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval())

    def direct(self,fields,version=None,username=None):
        self.cur.execute("SET XACT_ABORT OFF")
        version=version or self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval()
        self.cur.execute("EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save ?,?,?,?,0",username or self.username,self.req,version,json.dumps(fields))
        from packaging_fields import consume
        return consume(self.cur)

class ProfilesSQL(ProfileFixture, unittest.TestCase):
    def test_save_switch_reload_preserves_each_profile_and_maps_master(self):
        self.save(SelectedContainerType="20DC",LayersPerContainer=4,CartonsPerLayer=10,CartonsPerContainerFloor=100)
        self.assertEqual(self.read()["PalletsPerContainer"],10)
        self.assertEqual(self.read()["CalculatedCartonsPerContainer"],"300")
        self.assertEqual(self.read()["NetWeightPerContainerKG"],"360.00")
        self.save(SelectedContainerType="40HC",LayersPerContainer=5,CartonsPerContainerFloor=200)
        self.assertEqual(self.read()["PalletsPerContainer"],22)
        self.assertEqual(self.read()["CalculatedCartonsPerContainer"],"660")
        self.assertEqual(self.read()["NetWeightPerContainerFloorKG"],"240.00")
        self.save(SelectedContainerType="20DC")
        self.assertEqual(self.read()["LayersPerContainer"],3)
        self.assertEqual(self.read()["CartonsPerContainerFloor"],100)
        self.assertEqual(self.read()["ContainerLoadResults"]["40HC"]["CalculatedCartonsPerContainer"],"660")

    def test_partial_profiles_preserve_fields_and_capacity_is_not_client_controlled(self):
        self.save(SelectedContainerType="20DC",LayersPerContainer=4,CartonsPerContainerFloor=100)
        self.save(ContainerLoadProfiles={"20DC":{"LayersPerContainer":6,"PalletsPerContainer":999}})
        self.assertEqual(self.profiles()["20DC"],dict(LayersPerContainer=3,PalletsPerContainer=10,CartonsPerContainerFloor=100))
        self.save(CartonsPerContainerFloor=None)
        self.assertNotIn("CartonsPerContainerFloor",self.profiles()["20DC"])

    def test_capacity_snapshot_changes_only_on_new_profile_or_pallet(self):
        self.save(SelectedContainerType="20DC",LayersPerContainer=4)
        self.cur.execute("UPDATE dbo.Pallet SET PalletsPer20DC=99,PalletsPer40HC=88 WHERE ID=?",self.pallet)
        self.save(LayersPerContainer=5)
        self.assertEqual(self.profiles()["20DC"]["PalletsPerContainer"],10)
        self.save(SelectedContainerType="40HC")
        self.assertEqual(self.profiles()["40HC"]["PalletsPerContainer"],88)
        self.save(ResponsePalletSize=None)
        self.assertNotIn("PalletsPerContainer",self.profiles()["20DC"])
        self.save(ResponsePalletSize=self.size)
        self.assertEqual(self.profiles()["20DC"]["PalletsPerContainer"],99)

    def test_legacy_counts_only_assigned_to_first_selected_type(self):
        self.save(LayersPerContainer=4,PalletsPerContainer=9,CartonsPerContainerFloor=100)
        self.assertIsNone(self.read()["SelectedContainerType"])
        self.save(SelectedContainerType="20DC")
        self.assertEqual(self.profiles()["20DC"]["LayersPerContainer"],3)
        self.assertEqual(self.profiles()["20DC"]["PalletsPerContainer"],10)
        self.save(SelectedContainerType="40DC")
        self.assertEqual(self.profiles()["40DC"].get("LayersPerContainer"),3)
        self.assertIsNone(self.profiles()["40DC"].get("CartonsPerContainerFloor"))

    def test_validation_stale_pic_approval_and_audit(self):
        self.save(SelectedContainerType="20DC",LayersPerContainer=4)
        before=self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval()
        for fields in ({"SelectedContainerType":"BAD"},{"ContainerLoadProfiles":[]},
                       {"ContainerLoadProfiles":{"20DC":{"LayersPerContainer":True}}},
                       {"ContainerLoadProfiles":{"20DC":{"LayersPerContainer":"1.5"}}},
                       {"ContainerLoadProfiles":{"20DC":{"NetWeightPerContainerKG":1}}}):
            with self.assertRaises(Exception):self.direct(fields)
        with self.assertRaisesRegex(Exception,"Concurrency conflict"):self.direct({"SelectedContainerType":"40HC"},bytes(8))
        reader="container-reader-"+str(self.req)
        actor=self.cur.execute("INSERT dbo.Users(UserName,IsActive) VALUES(?,1);SELECT CONVERT(INT,SCOPE_IDENTITY())",reader).fetchval()
        self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,'Packaging')",actor)
        with self.assertRaisesRegex(Exception,"assigned PIC or Admin"):self.direct({"SelectedContainerType":"40HC"},username=reader)
        self.assertEqual(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval(),before)
        self.assertGreater(self.cur.execute("SELECT COUNT(*) FROM dbo.PackagingRequestChangeLog WHERE ItemID=? AND FieldName='ContainerLoadProfiles' AND ChangedBy=?",self.req,self.username).fetchval(),0)
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Approved',IsOpen=0 WHERE ID=?",self.req)
        with self.assertRaises(HTTPException):self.save(SelectedContainerType="40HC")

    def test_migration_rerun_and_reader_mask_preserve_history(self):
        self.save(SelectedContainerType="20DC",LayersPerContainer=4)
        before=tuple(self.cur.execute("SELECT ContainerLoadProfiles,RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchone())
        self.migrate("83_packaging_container_profiles.sql")
        self.assertEqual(tuple(self.cur.execute("SELECT ContainerLoadProfiles,RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchone()),before)
        reader="container-opportunity-"+str(self.req)
        actor=self.cur.execute("INSERT dbo.Users(UserName,IsActive) VALUES(?,1);SELECT CONVERT(INT,SCOPE_IDENTITY())",reader).fetchval()
        self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,'Opportunity')",actor)
        row=self.read(reader)
        self.assertIsNone(row["ContainerLoadProfiles"]);self.assertIsNone(row["ContainerLoadResults"])
        self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Approved',IsOpen=0 WHERE ID=?",self.req)
        self.assertEqual(self.read(reader)["SelectedContainerType"],"20DC")

    def test_zero_master_capacity_and_opportunity_read_use_same_saved_profile(self):
        self.cur.execute("UPDATE dbo.Pallet SET PalletsPer20DC=0 WHERE ID=?",self.pallet)
        self.save(SelectedContainerType="20DC",CartonsPerLayer=10,LayersPerContainer=4)
        row=self.read()
        self.assertEqual(row["PalletsPerContainer"],0)
        self.assertEqual(row["CalculatedCartonsPerContainer"],"0")
        self.assertEqual(row["NetWeightPerContainerKG"],"0.00")
        from opportunity_views import sorted_grid
        opportunity=next(r for r in sorted_grid(self.username,1,25,"[]",self.number)["rows"] if r["ItemID"]==self.item)
        self.assertEqual(opportunity["SelectedContainerType"],"20DC")
        self.assertEqual(opportunity["ContainerLoadResults"]["20DC"]["CalculatedCartonsPerContainer"],"0")


class DrySQL(ProfileFixture, unittest.TestCase):
    family="Dry"
    # Only run the family-specific test, not all base profile scenarios.
    def test_wrong_family_rejected(self):
        with self.assertRaisesRegex(Exception,"family"):self.direct({"ContainerLoadProfiles":{"40RHC":{}}})
        with self.assertRaisesRegex(HTTPException,"family"):self.save(SelectedContainerType="20RC")


class ReeferFloorSQL(ProfileFixture, unittest.TestCase):
    family="Reefer"
    configuration="Floor load"
    def test_floor_counts_are_container_specific(self):
        self.save(SelectedContainerType="20RC",CartonsPerContainerFloor=100)
        self.save(SelectedContainerType="40RHC",CartonsPerContainerFloor=200)
        self.save(SelectedContainerType="20RC")
        row=self.read()
        self.assertEqual(row["CartonsPerContainerFloor"],100)
        self.assertEqual(row["NetWeightPerContainerFloorKG"],"120.00")
        self.assertIsNone(row["NetWeightPerContainerKG"])


if __name__=="__main__":unittest.main()
