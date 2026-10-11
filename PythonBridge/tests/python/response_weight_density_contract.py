"""Response weight, unified loading and exact grade density; SQL writes roll back."""
import sys,json,unittest
from pathlib import Path
from decimal import Decimal as D
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from fastapi import HTTPException
from grade_density import grade_combination
from packing_way import packing_way
import conversion_output_uom_contract as foundation
import packaging_api as api
from request_views import item_read
from db import bytes_to_b64

class ResponseMath(unittest.TestCase):
 def test_pallet_container_uses_pallet_layers_not_container_layers(self):
  row=dict(WeightGrams=150,ApplicableNetWeightGrams=120,ResponseLayerCount=2,UnitsPerCarton=10,
   CartonsPerLayer=10,LayersPerPallet=4,LayersPerContainer=99,PalletsPerContainer=20,ConfigurationRequest="Pallet load")
  values=packing_way(row)
  self.assertEqual(values["CalculatedCartonsPerContainer"],"800")
  self.assertEqual(D(values["NetWeightPerContainerKG"]),D(960))
 def test_floor_and_both_use_only_one_manual_count(self):
  for mode in ("Floor load","Both"):
   values=packing_way(dict(WeightGrams=150,ApplicableNetWeightGrams=120,ResponseLayerCount=1,ConfigurationRequest=mode,
    PalletsPerContainer=20,LayersPerPallet=5,CartonsPerLayer=9,CartonsPerContainer=700))
   self.assertEqual(values["CalculatedCartonsPerContainer"],"700")
   self.assertEqual(D(values["NetWeightPerContainerKG"]),D(84))
 def test_each_profile_keeps_its_own_manual_count(self):
  row=dict(WeightGrams=100,ResponseLayerCount=1,ConfigurationRequest="Both",CartonsPerContainer=700,SelectedContainerType="20DC",
   ContainerLoadProfiles={"20DC":{"CartonsPerContainerFloor":700},"40HC":{"CartonsPerContainerFloor":900}})
  from container_loading import container_results
  self.assertEqual(container_results(row)["40HC"]["CalculatedCartonsPerContainer"],"900")
 def test_mix_parent_uses_child_applicable_weights(self):
  mix=dict(items=[dict(ProductID=1,UnitQuantity=2,WeightGrams=150),dict(ProductID=2,UnitQuantity=1,WeightGrams=450)])
  row=dict(WeightGrams=750,IsMixParent=True,ProductMixSnapshot=mix,ResponseLayerCount=1,MixResponseChildren=[
   dict(ProductID=1,ApplicableNetWeightGrams=140,NutDensity=".5"),dict(ProductID=2,ApplicableNetWeightGrams=400,NutDensity=".5")])
  self.assertEqual(D(packing_way(row)["PrimaryNetWeightGrams"]),D(680))
 def tree(self,ratio=60,name="Almond"):
  return dict(items=[dict(ParentID="0",ID=1,Grade=name,RatioPct=100),
   dict(ParentID="0/1",ID=1,Grade="NPX 25/27",RatioPct=ratio),
   dict(ParentID="0/1",ID=2,Grade="NPX 23/25",RatioPct=100-ratio)])
 def test_density_key_ignores_product_and_tree_display_order(self):
  a=self.tree();b={**a,"ProductID":999,"WeightGrams":999,"items":list(reversed(a["items"]))}
  self.assertEqual(grade_combination(a),grade_combination(b))
 def test_density_key_is_sensitive_to_grade_nut_and_final_ratio(self):
  a=self.tree()
  self.assertNotEqual(grade_combination(a),grade_combination(self.tree(70)))
  self.assertNotEqual(grade_combination(a),grade_combination(self.tree(name="Cashew")))
  b=self.tree();b["items"][1]["Grade"]="NPX 21/23"
  self.assertNotEqual(grade_combination(a),grade_combination(b))
 def test_incomplete_grade_tree_has_no_reusable_default(self):
  self.assertIsNone(grade_combination({"items":[dict(ParentID="0",ID=1,Grade="Incomplete",RatioPct=80)]}))

class ResponseRevisionSQL(unittest.TestCase):
 def setUp(self):
  foundation.OutputUnitSQL.setUp(self)
  for name in ("83_packaging_container_profiles.sql","84_packaging_container_layers.sql","85_packaging_container_shipping_height.sql",
   "86_mix_parent_logistics.sql","87_mix_packaging_type_orders.sql","88_mix_same_config.sql","89_opportunity_shipment_costs.sql","98_required_container_type_pallet.sql","101_response_weight_loading_density.sql"):
   self.migrate(name)
  self.grade=json.dumps(dict(items=[dict(ParentID="0",ID=1,Grade=self.code,RatioPct=100)]))
  self.fresh()
 def fresh(self,mode="Pallet load"):
  self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Canceled',IsOpen=0 WHERE ID=?",self.req)
  header=self.cur.execute("""INSERT dbo.PackagingConfigurationRequest
  (CreationKey,OpportunityID,OpportunityNumber,CustomerID,CustomerName,OpportunityDescription,BidOpen,BidClose,SourceRowVersion,RequestedBy,ResponseDue)
  SELECT NEWID(),OpportunityID,OpportunityNumber,CustomerID,CustomerName,OpportunityDescription,BidOpen,BidClose,SourceRowVersion,RequestedBy,ResponseDue
  FROM dbo.PackagingConfigurationRequest WHERE ID=?;SELECT CONVERT(INT,SCOPE_IDENTITY())""",self.header).fetchval()
  self.req=self.cur.execute("""INSERT dbo.PackagingConfigurationRequestItem
  (RequestID,OpportunityItemID,ProductID,ProductCode,ProductName,ItemDescription,AnnualUnit,SourceRowVersion,Stage,IsOpen,CreatedBy,WeightGrams,ProductGradeSnapshot,ConfigurationRequest,RequestedLayerCount,ResponseLayerCount)
  SELECT ?,OpportunityItemID,ProductID,ProductCode,ProductName,ItemDescription,AnnualUnit,SourceRowVersion,'Assigned',1,CreatedBy,150,?,?,1,1
  FROM dbo.PackagingConfigurationRequestItem WHERE ID=?;SELECT CONVERT(INT,SCOPE_IDENTITY())""",header,self.grade,mode,self.req).fetchval()
  self.header=header
 def response(self,**fields):
  version=bytes_to_b64(self.cur.execute("SELECT RowVersion FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchval())
  result=api.response_save(api.ResponseBatch(rows=[dict(RowNum=1,ID=self.req,RowVersion=version,**fields)]),self.ctx)
  self.assertEqual(result["results"][0]["Status"],"OK",result);return result
 def read(self,username=None):return item_read(username or self.username,self.header,1,25,None,None,"[]")["rows"][0]
 def test_new_density_default_saves_with_driver_rowcount_messages(self):
  self.cur.execute("SET NOCOUNT OFF")
  self.response(NutDensity=".61",ApplicableNetWeightGrams="450")
  row=self.read()
  self.assertEqual(D(row["NutDensityDefault"]),D(".61"))
  self.assertEqual(D(row["ApplicableNetWeightGrams"]),D("450"))
  self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.NutGradeDensityHistory WHERE ResponseItemID=?",self.req).fetchval(),1)
 def test_weight_default_override_volume_and_audit(self):
  self.assertEqual(D(self.read()["ApplicableNetWeightGrams"]),D(150))
  self.response(ApplicableNetWeightGrams="120",NutDensity=".6")
  row=self.read()
  self.assertEqual(D(row["UsedVolumeML"]),D(200));self.assertEqual(D(row["PrimaryNetWeightGrams"]),D(120))
  self.assertEqual(D(row["WeightGrams"]),D(150))
  self.assertGreater(self.cur.execute("SELECT COUNT(*) FROM dbo.PackagingRequestChangeLog WHERE ItemID=? AND FieldName='ApplicableNetWeightGrams'",self.req).fetchval(),0)
 def test_floor_and_both_require_manual_count_and_roundtrip_profiles(self):
  for mode in ("Floor load","Both"):
   self.fresh(mode)
   with self.assertRaises(HTTPException) as error:self.response(ApplicableNetWeightGrams=120)
   self.assertEqual(error.exception.status_code,422)
   self.response(ApplicableNetWeightGrams=120,SelectedContainerType="20DC",CartonsPerContainer=900,ContainerLoadProfiles={"20DC":{"CartonsPerContainer":900}})
   row=self.read();self.assertEqual(row["CalculatedCartonsPerContainer"],"900")
   self.assertEqual(D(row["NetWeightPerContainerKG"]),D(108))
 def test_new_combination_created_ordinary_change_preserves_default_explicit_change_updates(self):
  self.response(NutDensity=".6")
  self.assertEqual(D(self.read()["NutDensityDefault"]),D(".6"))
  self.response(NutDensity=".7");row=self.read()
  self.assertEqual(D(row["NutDensityDefault"]),D(".6"))
  self.response(NutDensity=".7",NutDensityDefaultUpdate=True,NutDensityDefaultRowVersion=row["NutDensityDefaultRowVersion"])
  self.assertEqual(D(self.read()["NutDensityDefault"]),D(".7"))
  self.assertEqual(self.cur.execute("SELECT COUNT(*) FROM dbo.NutGradeDensityHistory WHERE DensityID=(SELECT ID FROM dbo.NutGradeDensity WHERE CombinationHash=?)",grade_combination(self.grade)[0]).fetchval(),2)
 def test_new_response_proposes_existing_default_without_setting_response_density(self):
  self.response(NutDensity=".6");self.fresh()
  row=self.read();self.assertIsNone(row["NutDensity"]);self.assertEqual(D(row["NutDensityDefault"]),D(".6"))
 def test_stale_density_default_rejects_atomically(self):
  self.response(NutDensity=".6");token=self.read()["NutDensityDefaultRowVersion"]
  self.cur.execute("UPDATE dbo.NutGradeDensity SET NutDensity=.8 WHERE CombinationHash=?",grade_combination(self.grade)[0])
  with self.assertRaises(HTTPException) as error:self.response(NutDensity=".7",ApplicableNetWeightGrams=130,NutDensityDefaultUpdate=True,NutDensityDefaultRowVersion=token)
  self.assertEqual(error.exception.status_code,409)
  row=self.read();self.assertEqual(D(row["NutDensity"]),D(".6"));self.assertEqual(D(row["ApplicableNetWeightGrams"]),D(150))
 def test_locked_response_cannot_create_or_update_shared_default(self):
  self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Approved',IsOpen=0 WHERE ID=?",self.req)
  with self.assertRaises(HTTPException) as error:self.response(NutDensity=".6")
  self.assertEqual(error.exception.status_code,409)
  self.assertEqual(self.cur.execute("IF OBJECT_ID('dbo.NutGradeDensity','U') IS NULL SELECT 0; ELSE SELECT COUNT(*) FROM dbo.NutGradeDensity WHERE CombinationHash=?",grade_combination(self.grade)[0]).fetchval(),0)
 def test_sales_cannot_read_draft_weight_density_or_shared_default(self):
  from uuid import uuid4
  name="density-sales-"+uuid4().hex[:10]
  actor=self.cur.execute("INSERT dbo.Users(UserName,IsActive) VALUES(?,1);SELECT CONVERT(INT,SCOPE_IDENTITY())",name).fetchval()
  self.cur.execute("INSERT dbo.UserAccess(UserID,Scope) VALUES(?,'Opportunity')",actor)
  self.response(ApplicableNetWeightGrams=120,NutDensity=".6")
  hidden=self.read(name)
  self.assertIsNone(hidden["ApplicableNetWeightGrams"]);self.assertIsNone(hidden["NutDensity"])
  self.assertNotIn("NutDensityDefault",hidden)
  self.cur.execute("UPDATE dbo.PackagingConfigurationRequestItem SET Stage='Approved',IsOpen=0 WHERE ID=?",self.req)
  visible=self.read(name);self.assertEqual(D(visible["ApplicableNetWeightGrams"]),D(120))
  self.assertNotIn("NutDensityDefault",visible)
 def test_migration_rerun_preserves_saved_versions(self):
  before=tuple(self.cur.execute("SELECT RowVersion,WeightGrams,UsedVolumeML FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchone())
  self.migrate("101_response_weight_loading_density.sql")
  self.assertEqual(before,tuple(self.cur.execute("SELECT RowVersion,WeightGrams,UsedVolumeML FROM dbo.PackagingConfigurationRequestItem WHERE ID=?",self.req).fetchone()))
for method in ("cleanup","apply","batch","edit","request","activate","create_mix","save_fields","dim_rv","payload","preview","save","price_row","maintain","migrate","definition"):
 setattr(ResponseRevisionSQL,method,getattr(foundation.OutputUnitSQL,method))
if __name__=="__main__":unittest.main()
