"""Automatic Layer / Container: exact clearance, persistence and read-only totals."""
import unittest
from decimal import Decimal
from packing_way import container_layers, packing_way
from container_profiles_contract import ProfileFixture


class ContainerLayersMath(unittest.TestCase):
    def test_clearance_exception_and_exact_boundaries(self):
        for kind in ("20DC","40DC","40HC","40RHC"):
            self.assertEqual(container_layers(dict(SelectedContainerType=kind,HeightMM=1040)),2)
        self.assertEqual(container_layers(dict(SelectedContainerType="20RC",HeightMM=1040)),1)
        for height,expected in (("1045",2),("1045.01",1)):
            self.assertEqual(container_layers(dict(SelectedContainerType="20DC",HeightMM=height,ResponseMaxPalletHeightMM=1046)),expected)
        self.assertEqual(container_layers(dict(SelectedContainerType="20RC",HeightMM=1035)),2)
        self.assertEqual(container_layers(dict(SelectedContainerType="20RC",HeightMM="1035.01")),1)

    def test_pallet_geometry_does_not_affect_shipping_layers(self):
        for maximum in (None,0,350,1800,2500):
            self.assertEqual(container_layers(dict(SelectedContainerType="20DC",HeightMM=100,
                ResponseMaxPalletHeightMM=maximum,LayersPerPallet=99)),20)

    def test_missing_invalid_and_too_tall(self):
        for height in (None,0,-1,"NaN","bad"):
            self.assertIsNone(container_layers(dict(SelectedContainerType="20DC",HeightMM=height,ResponseMaxPalletHeightMM=2500,LayersPerContainer=7)))
        self.assertEqual(container_layers(dict(SelectedContainerType="20DC",HeightMM=100)),20)
        for kind in ("20DC","20RC"):
            result=packing_way(dict(SelectedContainerType=kind,HeightMM=2300,ResponseMaxPalletHeightMM=2500,
                ResponseLayerCount=1,WeightGrams=100,CartonsPerLayer=10,PalletsPerContainer=20))
            self.assertEqual(result["LayersPerContainer"],0)
            self.assertEqual(result["CalculatedCartonsPerContainer"],"0")
            self.assertEqual(Decimal(result["NetWeightPerContainerKG"]),0)

    def test_unassigned_history_is_preserved_until_type_selected(self):
        row=dict(LayersPerContainer=7)
        self.assertEqual(container_layers(row),7)
        row["SelectedContainerType"]="20DC"
        self.assertIsNone(container_layers(row))


class ContainerLayersSQL(ProfileFixture,unittest.TestCase):
    def test_type_switching_recalculates_and_saves_all_profiles(self):
        self.save(HeightMM=1040,ResponseMaxPalletHeightMM=1190,CartonsPerLayer=10,SelectedContainerType="20DC",LayersPerContainer=99)
        self.assertEqual(self.read()["LayersPerContainer"],2)
        self.assertEqual(self.read()["CalculatedCartonsPerContainer"],"200")
        self.save(SelectedContainerType="20RC",LayersPerContainer=99)
        self.assertEqual(self.read()["LayersPerContainer"],1)
        self.assertEqual(self.read()["CalculatedCartonsPerContainer"],"80")
        self.assertEqual(self.profiles()["20DC"]["LayersPerContainer"],2)
        self.assertEqual(self.profiles()["20RC"]["LayersPerContainer"],1)
        self.save(HeightMM=1045,ResponseMaxPalletHeightMM=2500)
        self.assertEqual(self.profiles()["20DC"]["LayersPerContainer"],2)
        self.assertEqual(self.profiles()["20RC"]["LayersPerContainer"],1)

    def test_saved_layers_ignore_missing_or_changed_maximum_pallet_height(self):
        self.save(SelectedContainerType="20DC",HeightMM=100,CartonsPerLayer=10,
            ResponseMaxPalletHeightMM=None)
        self.assertEqual(self.profiles()["20DC"]["LayersPerContainer"],20)
        self.assertEqual(self.read()["CalculatedCartonsPerContainer"],"2000")
        self.save(ResponseMaxPalletHeightMM=2500)
        self.assertEqual(self.profiles()["20DC"]["LayersPerContainer"],20)

    def test_zero_missing_geometry_and_manual_profile_override(self):
        self.save(SelectedContainerType="20DC",HeightMM=2300,ResponseMaxPalletHeightMM=2500,
            CartonsPerLayer=10,ContainerLoadProfiles={"20DC":{"LayersPerContainer":99}})
        self.assertEqual(self.profiles()["20DC"]["LayersPerContainer"],0)
        self.assertEqual(self.read()["CalculatedCartonsPerContainer"],"0")
        self.save(HeightMM=None)
        self.assertIsNone(self.read()["LayersPerContainer"])
        self.assertIsNone(self.read()["CalculatedCartonsPerContainer"])
        self.assertNotIn("LayersPerContainer",self.profiles()["20DC"])

    def test_migration_is_idempotent_and_existing_history_unchanged(self):
        self.save(SelectedContainerType="20DC")
        before=list(self.cur.execute("SELECT ID,ContainerLoadProfiles,RowVersion FROM dbo.PackagingConfigurationRequestItem ORDER BY ID"))
        for _ in range(2):
            self.migrate("84_packaging_container_layers.sql")
            self.migrate("85_packaging_container_shipping_height.sql")
        self.assertEqual(list(self.cur.execute("SELECT ID,ContainerLoadProfiles,RowVersion FROM dbo.PackagingConfigurationRequestItem ORDER BY ID")),before)


if __name__=="__main__":unittest.main()
