import json
import unittest
from item_stage_summary import stage_summary


class Completion(unittest.TestCase):
 def row(self,id=1,parent=None,mix=False):
  from tcb_analysis_columns import TCB_COLUMNS
  info={key:True for key in ("TCBSaved","ShipmentSaved","LossSaved","GradesSaved","PricesSaved")}
  return {"ItemID":id,"ParentItemID":parent,"IsMixParent":mix,"StageSummaryJSON":json.dumps(info),**{key:"0" for key in TCB_COLUMNS}}
 def complete(self,rows):
  from item_stage_summary import complete_stage_summaries
  return [json.loads(r["StageSummaryJSON"]) for r in complete_stage_summaries(rows)]
 def test_completion_uses_real_saved_analysis_calculation(self):
  from tcb_analysis_columns_contract import row
  from tcb_analysis_columns import add_tcb_columns
  from item_stage_summary import complete_stage_summaries
  saved=row()
  saved["StageSummaryJSON"]=stage_summary(saved)
  info=json.loads(complete_stage_summaries(add_tcb_columns([saved]))[0]["StageSummaryJSON"])
  self.assertTrue(info["TCBReviewComplete"])
  self.assertTrue(info["TCBEntriesComplete"])
  saved=row();saved["CustomerCurrencyCode"]=None
  saved["StageSummaryJSON"]=stage_summary(saved)
  info=json.loads(complete_stage_summaries(add_tcb_columns([saved]))[0]["StageSummaryJSON"])
  self.assertFalse(info["TCBReviewComplete"])
 def test_every_analysis_field_available_including_zero_completes_review(self):
  info=self.complete([self.row()])[0]
  self.assertTrue(info["TCBEntriesComplete"]);self.assertTrue(info["TCBReviewComplete"])
  self.assertEqual(info["AnalysisMissingFields"],[])
 def test_missing_analysis_field_keeps_review_pending_but_entries_can_advance(self):
  row=self.row();row["TCBFreightPerUnit"]=None
  info=self.complete([row])[0]
  self.assertTrue(info["TCBEntriesComplete"]);self.assertFalse(info["TCBReviewComplete"])
  self.assertIn("Freight ($/unit)",info["AnalysisMissingFields"])
 def test_mix_parent_uses_all_children_prices_and_analysis(self):
  root=self.row(1,mix=True);a=self.row(2,1);b=self.row(3,1)
  root["StageSummaryJSON"]=json.dumps({"TCBSaved":True,"ShipmentSaved":True,"LossSaved":True})
  root_info,_,_=self.complete([root,a,b])
  self.assertTrue(root_info["PricesSaved"]);self.assertTrue(root_info["PricesFromChildren"])
  self.assertTrue(root_info["TCBEntriesComplete"]);self.assertTrue(root_info["TCBReviewComplete"])
  b["TCBFOBPerUnit"]=None
  self.assertFalse(self.complete([root,a,b])[0]["TCBReviewComplete"])
 def test_missing_or_returned_child_does_not_complete_mix_review(self):
  root=self.row(1,mix=True)
  self.assertFalse(self.complete([root])[0]["TCBReviewComplete"])
  child=self.row(2,1);child["StageSummaryJSON"]=json.dumps({"PackagingStage":"Returned","PricesSaved":True})
  info=self.complete([root,child])[0]
  self.assertTrue(info["TCBBlockedByChildren"]);self.assertFalse(info["TCBReviewComplete"])
class StageSummary(unittest.TestCase):
 def test_child_tracks_own_tcb_with_inherited_shipping_and_zero_prices(self):
  row={"ParentItemID":1,"ProductGradeSnapshot":'{"Grades":[{"ID":1}]}',
       "ShipmentCostInfo":'{"DutyPct":0}',"_TCBCostInfo":'{"Inputs":{"Prices":[{"DirectUSDPerLb":"0"}],"ProductLossFormula":"0"},"ProductUSDPerLb":"0"}',
       "_StagePackagingStage":"Returned","_StageReason":"Resize","_StagePIC":"Alex"}
  result=json.loads(stage_summary(row))
  for field in ["TCBSaved","TCBCalculated","ShipmentSaved","LossSaved","PricesSaved","GradesSaved","ShipmentInherited"]:
   self.assertTrue(result[field],field)
  self.assertEqual(result["Reason"],"Resize")
  self.assertFalse(any(k.startswith("_Stage") for k in row))
 def test_empty_data_does_not_claim_completion(self):
  result=json.loads(stage_summary({"_TCBCostInfo":"bad","ProductGradeSnapshot":"null"}))
  for field in ["TCBSaved","TCBCalculated","ShipmentSaved","LossSaved","PricesSaved","GradesSaved"]:
   self.assertFalse(result[field],field)
 def test_cancel_reason_preserved(self):
  result=json.loads(stage_summary({"_StagePackagingStage":"Canceled","_StageReason":"New spec"}))
  self.assertEqual(result["PackagingStage"],"Canceled")
  self.assertEqual(result["Reason"],"New spec")

class ProductReview(unittest.TestCase):
 def row(self,**patch):
  return {"ProductID":1,"AnnualUnit":"0.0000","PrimaryTypeID":2,"PalletSize":"1x1m",**patch}
 def info(self,**patch):
  return json.loads(stage_summary(self.row(**patch)))
 def test_required_saved_fields_complete_without_optional_values(self):
  info=self.info()
  self.assertTrue(info["ProductInfoComplete"]);self.assertTrue(info["PackagingRequirementsComplete"])
  self.assertTrue(info["ProductReviewComplete"]);self.assertEqual(info["ProductReviewMissingFields"],[])
 def test_partial_save_lists_missing_required_fields(self):
  info=self.info(AnnualUnit=None,PrimaryTypeID=None,PalletSize="")
  self.assertFalse(info["ProductReviewComplete"])
  self.assertEqual(info["ProductReviewMissingFields"],["Annual units","Primary Type","Pallet size"])
 def test_child_does_not_require_own_pallet(self):
  self.assertTrue(self.info(ParentItemID=5,PalletSize=None)["ProductReviewComplete"])
 def test_legacy_packaging_and_valid_zero_units_are_supported(self):
  self.assertTrue(self.info(PrimaryTypeID=None,PackagingType="Pillow")["ProductReviewComplete"])
  for units in ["", "-1", "1.5", "NaN", "Infinity"]:
   self.assertFalse(self.info(AnnualUnit=units)["ProductInfoComplete"])
