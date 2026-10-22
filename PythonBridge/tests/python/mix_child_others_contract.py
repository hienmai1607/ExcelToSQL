"""Own child costs, inherited shared logistics and rollback-only SQL migration checks."""
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from shipment_ownership import CHILD_OTHER_KEYS,effective_shipment,own_others,validate_child_others
from opportunity_excel_api import merge_shipment
from tcb_analysis_columns_contract import row
from tcb_analysis_columns import add_tcb_columns


class Ownership(unittest.TestCase):
 def test_grid_keeps_raw_own_values_but_flattens_effective_costs(self):
  from unittest.mock import patch
  import opportunity_views as views
  root,a=row(10),row(11)
  root.update(IsMixParent=True,ProductMixSnapshot={"items":[{"ProductID":11,"UnitQuantity":2}]})
  root["ShipmentCostInfo"].update(FreightUSDPerContainer="12",PackingUSDPerLb="999")
  root["OwnShipmentCostInfo"]=json.dumps(root["ShipmentCostInfo"])
  a.update(ParentItemID=10,ShipmentCostInfo=root["ShipmentCostInfo"],OwnShipmentCostInfo='{"PackingUSDPerLb":"2"}')
  with patch.object(views,"execute",return_value=[[root,a],[{"Total":1}]]) as execute:
   rows=views.sorted_grid("Sales",1,25,"[]")["rows"]
  self.assertIn("i.ShipmentCostInfo AS OwnShipmentCostInfo",execute.call_args.args[0])
  self.assertIsNone(rows[0]["PackingUSDPerLb"])
  self.assertEqual(rows[1]["PackingUSDPerLb"],"2.00")
  self.assertEqual(rows[1]["FreightUSDPerContainer"],"12.00")
  self.assertEqual(json.loads(rows[1]["OwnShipmentCostInfo"]),{"PackingUSDPerLb":"2"})
  self.assertEqual(rows[1]["TCBPackingPerUnit"],"2")
 def test_unmaintained_child_never_inherits_parent_others(self):
  child=dict(ParentItemID=1,ShipmentCostInfo={"FreightUSDPerContainer":"12","PackingUSDPerLb":"99"},OwnShipmentCostInfo=None)
  self.assertEqual(effective_shipment(child),{"FreightUSDPerContainer":"12"})
  child["OwnShipmentCostInfo"]={"PackingUSDPerLb":"2"}
  self.assertEqual(effective_shipment(child),{"FreightUSDPerContainer":"12","PackingUSDPerLb":"2"})
  self.assertEqual(effective_shipment(dict(IsMixParent=True,ShipmentCostInfo=child["ShipmentCostInfo"])),{"FreightUSDPerContainer":"12"})
 def test_child_excel_edits_only_merge_own_fields(self):
  child=dict(ParentItemID=1,ShipmentCostInfo={"FreightUSDPerContainer":"12","InitialDesignUSD":"99"},OwnShipmentCostInfo=None)
  saved=merge_shipment(None,child,{"PackingUSDPerLb":"2"},{})
  self.assertEqual(saved,{"PackingUSDPerLb":"2"})
  with self.assertRaisesRegex(ValueError,"Others Info"):merge_shipment(None,child,{"FreightUSDPerContainer":"3"},{})
  for field in ("FobbingUSDPerContainer","PaymentTermDays","DutyPct"):
   with self.assertRaises(ValueError):validate_child_others({field:0})
  validate_child_others({key:None for key in ("DutyPct",*CHILD_OTHER_KEYS)})
 def test_child_costs_and_quantity_weighted_parent_allocation(self):
  root,a,b=row(10),row(11),row(12)
  root.update(IsMixParent=True,ProductMixSnapshot={"items":[{"ProductID":11,"UnitQuantity":2},{"ProductID":12,"UnitQuantity":1}]})
  root["ShipmentCostInfo"].update(FobbingUSDPerContainer="12000",PackingUSDPerLb="999",InitialDesignUSD="999999",OtherFixedCostsUSD="999999")
  for child in (a,b):child.update(ParentItemID=10,ShipmentCostInfo=root["ShipmentCostInfo"])
  a["OwnShipmentCostInfo"]={"PackingUSDPerLb":"2","InitialDesignUSD":"100","OtherFixedCostsUSD":"200","InterestPct":"12","InterestDays":30,"MarginMode":"USDPerLb","MarginUSDPerLb":".5"}
  b["OwnShipmentCostInfo"]=None
  add_tcb_columns([root,a,b])
  self.assertEqual(a["TCBFobbingPerUnit"],"4")
  self.assertEqual(b["TCBFobbingPerUnit"],"4")
  self.assertEqual(float(a["TCBFobbingPerUnit"])*2,8)
  self.assertEqual((a["TCBPackingPerUnit"],b["TCBPackingPerUnit"]),("2","0"))
  self.assertEqual((a["TCBInitialDesignPerUnit"],a["TCBFixedCostsPerUnit"]),("0.1","0.2"))
  self.assertEqual((b["TCBInitialDesignPerUnit"],b["TCBFixedCostsPerUnit"]),("0","0"))
  self.assertEqual((a["TCBMarginPerUnit"],b["TCBMarginPerUnit"]),("0.5","0"))
  self.assertGreater(float(a["TCBInterestPerUnit"]),0)
  self.assertEqual(b["TCBInterestPerUnit"],"0")


class Migration(unittest.TestCase):
 def test_rerun_preserves_data_and_checks_ownership(self):
  import db
  self.assertIn(db.DB_SERVER.lower(),{"desktop-5bgmjsc","localhost","."})
  self.assertEqual(db.DB_NAME,"test")
  conn=db.engine.raw_connection()
  cur=conn.cursor()
  def consume():
   while cur.nextset():pass
  try:
   cur.execute("SET NOCOUNT ON; BEGIN TRANSACTION")
   snapshot="SELECT COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(ID,RowVersion,ShipmentCostInfo)) FROM dbo.OpportunityItem"
   before=tuple(cur.execute(snapshot).fetchone())
   sql=(Path(__file__).resolve().parents[2]/"sql/140_mix_child_others_info.sql").read_text(encoding="utf-8")
   cur.execute(sql);consume()
   names=("usp_OpportunityShipment_Validate","usp_OpportunityItem_Fields_Save")
   definitions=[cur.execute("SELECT OBJECT_DEFINITION(OBJECT_ID(?))","dbo."+name).fetchval() for name in names]
   cur.execute(sql);consume()
   self.assertEqual(definitions,[cur.execute("SELECT OBJECT_DEFINITION(OBJECT_ID(?))","dbo."+name).fetchval() for name in names])
   self.assertEqual(before,tuple(cur.execute(snapshot).fetchone()))
   child=cur.execute("SELECT TOP 1 i.ID,i.ParentItemID,i.RowVersion FROM dbo.OpportunityItem i JOIN dbo.Opportunity o ON o.ID=i.OpportunityID WHERE i.ParentItemID IS NOT NULL AND i.Stage='Draft' AND o.Stage='Draft'").fetchone()
   self.assertIsNotNone(child,"A current Mix family is required for ownership validation.")
   cur.execute("SET XACT_ABORT OFF")
   actor=cur.execute("SELECT TOP 1 u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin'").fetchval()
   self.assertIsNotNone(actor)
   fields=json.dumps({"ShipmentCostInfo":{"PackingUSDPerLb":"2","InitialDesignUSD":"120","InterestDays":30,"MarginMode":"USDPerLb","MarginUSDPerLb":"0.5"}})
   cur.execute("EXEC dbo.usp_OpportunityItem_Fields_Save ?,?,?,?,0",actor,child.ID,child.RowVersion,fields);consume()
   own=cur.execute("SELECT ShipmentCostInfo,RowVersion FROM dbo.OpportunityItem WHERE ID=?",child.ID).fetchone()
   self.assertEqual(json.loads(own.ShipmentCostInfo)["PackingUSDPerLb"],"2")
   self.assertNotEqual(bytes(child.RowVersion),bytes(own.RowVersion))
   with self.assertRaisesRegex(Exception,"Concurrency"):
    cur.execute("EXEC dbo.usp_OpportunityItem_Fields_Save ?,?,?,?,0",actor,child.ID,child.RowVersion,fields);consume()
   for item,payload in ((child.ID,dict(PackingUSDPerLb="2",InterestDays=30,MarginMode="Percent",MarginPct="5")),(child.ParentItemID,dict(FobbingUSDPerContainer="12",PaymentTermDays=30))):
    cur.execute("EXEC dbo.usp_OpportunityShipment_Validate ?,?",item,json.dumps(payload));consume()
   for item,payload in ((child.ID,dict(FreightUSDPerContainer="2")),(child.ID,dict(PaymentTermDays=30)),(child.ParentItemID,dict(PackingUSDPerLb="2")),(child.ID,dict(MarginPct="100.01"))):
    with self.subTest(item=item,payload=payload),self.assertRaises(Exception):
     cur.execute("EXEC dbo.usp_OpportunityShipment_Validate ?,?",item,json.dumps(payload));consume()
   self.assertEqual(cur.execute("SELECT @@TRANCOUNT").fetchval(),1)
  finally:
   cur.close()
   conn.cursor().execute("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION")
   conn.close()

if __name__=="__main__":unittest.main()
