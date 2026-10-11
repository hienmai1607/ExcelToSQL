"""Required Container Type/Pallet and exact PCR filters; SQL fixtures roll back."""
import sys,json,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
import shipment_costs_contract as shipping
from container_profiles_contract import ProfileFixture
from container_loading import container_types
from shipment_fields import validate_new_shipment
from schemas import OpportunityItemRow
from fastapi import HTTPException

class ContainerTypeModels(unittest.TestCase):
 def test_exact_container_mapping_keeps_legacy_families(self):
  for kind in ("20DC","20RC","40DC","40HC","40RHC"):self.assertEqual(container_types(kind),(kind,))
  self.assertEqual(container_types("Dry","40FT"),("40DC","40HC"))
 def test_new_parent_requires_both_fields(self):
  base=dict(RowNum=1,Command="C",OpportunityNumber="NEW")
  for values,message in (({},"Pallet size"),({"PalletSize":"X"},"Container Type"),({"PalletSize":"X","ContainerRequest":"Dry"},"Container Type")):
   with self.assertRaises(HTTPException) as error:validate_new_shipment([OpportunityItemRow(**base,**values)])
   self.assertIn(message,error.exception.detail)
  validate_new_shipment([OpportunityItemRow(**base,PalletSize="X",ContainerRequest="20RC")])
 def test_workflow_updates_do_not_require_missing_legacy_fields(self):
  validate_new_shipment([OpportunityItemRow(RowNum=1,Command="U",ID=1,OpportunityNumber="OLD",Stage="Approved")])

class ContainerTypeSQL(ProfileFixture,unittest.TestCase):
 batch=shipping.ShipmentSQL.batch
 activate=shipping.ShipmentSQL.activate
 create_mix=shipping.ShipmentSQL.create_mix
 edit=shipping.ShipmentSQL.edit
 request=shipping.ShipmentSQL.request
 fields=shipping.ShipmentSQL.fields
 port=shipping.ShipmentSQL.port
 def setUp(self):
  shipping.ShipmentSQL.setUp(self)
  self.migrate("98_required_container_type_pallet.sql")
 def test_floor_load_retains_required_pallet_and_derives_size(self):
  self.fields(self.parent,WebPackagingRequirements=True,ContainerRequest="20RC",ConfigurationRequest="Floor load",PalletSize=self.size)
  row=self.cur.execute("SELECT PalletSize,ContainerRequest,ShipmentCostInfo FROM dbo.OpportunityItem WHERE ID=?",self.parent).fetchone()
  self.assertEqual(row.PalletSize,self.size);self.assertEqual(row.ContainerRequest,"20RC")
  self.assertEqual(json.loads(row.ShipmentCostInfo)["ContainerSizeFT"],"20FT")
 def test_missing_pallet_rejected(self):
  with self.assertRaisesRegex(Exception,"Pallet size is required"):
   self.fields(self.parent,WebPackagingRequirements=True,ContainerRequest="20RC",PalletSize=None)
 def test_legacy_family_cannot_be_new_type_selection(self):
  with self.assertRaisesRegex(Exception,"required Container Type"):
   self.fields(self.parent,WebPackagingRequirements=True,ContainerRequest="Dry",PalletSize=self.size)
 def test_type_change_updates_derived_size(self):
  self.fields(self.parent,WebPackagingRequirements=True,ContainerRequest="40HC",PalletSize=self.size)
  self.fields(self.parent,WebPackagingRequirements=True,ContainerRequest="20RC",PalletSize=self.size)
  info=self.cur.execute("SELECT ShipmentCostInfo FROM dbo.OpportunityItem WHERE ID=?",self.parent).fetchval()
  self.assertEqual(json.loads(info)["ContainerSizeFT"],"20FT")
 def test_pcr_captures_type_and_rejects_different_exact_type(self):
  self.fields(self.parent,WebPackagingRequirements=True,ContainerRequest="20RC",PalletSize=self.size)
  request=self.request([self.parent,self.child])
  req=request["items"][0]["ID"]
  snapshot=self.cur.execute("SELECT ContainerRequest,ShipmentContainerSizeFT FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",req).fetchone()
  self.assertEqual(tuple(snapshot),("20RC","20FT"))
  version=self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",req).fetchval()
  with self.assertRaisesRegex(Exception,"exact requested"):
   self.cur.execute("EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save ?,?,?,?,0",self.username,req,version,json.dumps({"SelectedContainerType":"20DC"}))
 def test_incoming_profiles_must_match_exact_type(self):
  self.fields(self.parent,WebPackagingRequirements=True,ContainerRequest="20RC",PalletSize=self.size)
  request=self.request([self.parent]);req=request["items"][0]["ID"]
  version=self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",req).fetchval()
  with self.assertRaisesRegex(Exception,"exact requested"):
   self.cur.execute("EXEC dbo.usp_PackagingConfigurationRequestItem_Fields_Save ?,?,?,?,0",self.username,req,version,json.dumps({"ContainerLoadProfiles":{"20DC":{"PalletsPerContainer":1}}}))
 def test_migration_rerun_preserves_snapshots(self):
  before=[tuple(r) for r in self.cur.execute("SELECT ID,ContainerRequest,ShipmentContainerSizeFT,RowVersion FROM dbo.PackagingConfigurationRequestItem ORDER BY ID")]
  self.migrate("98_required_container_type_pallet.sql")
  self.assertEqual(before,[tuple(r) for r in self.cur.execute("SELECT ID,ContainerRequest,ShipmentContainerSizeFT,RowVersion FROM dbo.PackagingConfigurationRequestItem ORDER BY ID")])
if __name__=="__main__":unittest.main()
