"""Per-material costing and authoritative formula variables. No database writes."""
import sys, unittest, json
from pathlib import Path
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from tcb_costs import Inputs, calculate, leaves
import tcb_api

class MaterialCosts(unittest.TestCase):
 def test_grade_leaves_sort_by_numeric_hierarchy(self):
  items=[dict(ParentID="0",ID=i,Grade=str(i),RatioPct="20") for i in [4,5,1,2,3]]
  items += [dict(ParentID="0/1",ID=i,Grade=str(i),RatioPct="25") for i in [10,2,1,3]]
  self.assertEqual([g["Path"] for g in leaves(items)],["0/1/1","0/1/2","0/1/3","0/1/10","0/2","0/3","0/4","0/5"])

 def test_each_line_has_its_own_recipe_and_processing(self):
  inputs=Inputs(Prices=[dict(Path="0/1",DirectUSDPerLb="2"),dict(Path="0/2",DirectUSDPerLb="4")],
   MaterialCosts=[dict(Path="0/1",RMRatio=90,SeasoningRatio=10,SeasoningUSDPerLb=1,ProcessingUSDPerLb=".2"),
                  dict(Path="0/2",RMRatio=80,OilPct=20,OilUSDPerLb=2,ProcessingUSDPerLb=".5")])
  result=calculate(inputs,[dict(Path="0/1",Proportion=Decimal(".4")),dict(Path="0/2",Proportion=Decimal(".6"))],{})
  self.assertEqual(Decimal(result["RMCostUSDPerLb"]),Decimal("3.2"))
  self.assertEqual(Decimal(result["ProductUSDPerLb"]),Decimal("3.30"))
 def test_invalid_duplicate_and_removed_line_rejected(self):
  for rows in ([dict(Path="0/1",RMRatio=90)], [dict(Path="0/1"),dict(Path="0/1")]):
   with self.assertRaises(ValueError):Inputs(MaterialCosts=rows)
  with self.assertRaisesRegex(ValueError,"removed|non-leaf"):
   calculate(Inputs(MaterialCosts=[dict(Path="0/9")]),[dict(Path="0/1",Proportion=Decimal(1))],{})
 def test_legacy_global_costs_are_preserved(self):
  result=calculate(Inputs(Prices=[dict(Path="0/1",DirectUSDPerLb=2)],ProcessingUSDPerLb=".3"),[dict(Path="0/1",Proportion=Decimal(1))],{})
  self.assertEqual(Decimal(result["ProductUSDPerLb"]),Decimal("2.3"))
 def test_nw_is_authoritative_and_missing_zero_rejected(self):
  body=tcb_api.LossSave(RowVersion="rv",Inputs=dict(ProductLossFormula="1/NW",LossProcesses=[]))
  for weight,expected in [(100,"1"),(400,".25")]:
   with patch.object(tcb_api,"require"),patch.object(tcb_api,"item_read",return_value={"WeightGrams":weight}):
    self.assertEqual(Decimal(tcb_api.preview_loss_formula(body,1,None)["LossProductPct"]),Decimal(expected))
  for weight in [None,0]:
   with patch.object(tcb_api,"require"),patch.object(tcb_api,"item_read",return_value={"WeightGrams":weight}),self.assertRaises(Exception):
    tcb_api.preview_loss_formula(body,1,None)
 def test_recipe_round_trip_and_save_preserve_line_identity(self):
  inputs=Inputs(Prices=[dict(Path="0/1",DirectUSDPerLb="2")],MaterialCosts=[dict(Path="0/1",ProcessingUSDPerLb=".5")],ProductLossFormula="1/NW",LossProcesses=[])
  item=dict(WeightGrams=400,IsMixParent=False,RowVersion="AAAAAAAAAAE=",ItemStage="Draft",HeaderStage="Draft",TCBCostInfo=None,
            ProductGradeSnapshot=json.dumps({"items":[dict(ParentID="0",ID=1,Grade="Nuts",RatioPct=100)]}))
  body=tcb_api.Save(RowVersion=item["RowVersion"],Inputs=inputs)
  with patch.object(tcb_api,"require"),patch.object(tcb_api,"item_read",return_value=item),patch.object(tcb_api,"current_prices",return_value=[]),patch.object(tcb_api,"execute",return_value=[[{"RowVersion":"AAAAAAAAAAI="}]]) as write:
   result=tcb_api.save(body,1,SimpleNamespace(username="test"))
  stored=json.loads(write.call_args.args[1][3])
  reopened=Inputs(**stored["Inputs"])
  self.assertEqual(reopened.MaterialCosts[0].Path,"0/1")
  self.assertEqual(reopened.MaterialCosts[0].ProcessingUSDPerLb,Decimal(".5"))
  self.assertEqual(Decimal(stored["Inputs"]["LossProductPct"]),Decimal(".25"))
  self.assertEqual(Decimal(result["saved"]["ProductUSDPerLb"]),Decimal("2.5"))
 def test_commercial_preview_stores_line_recipes_and_rejects_stale_paths(self):
  item=dict(WeightGrams=400,IsMixParent=False,RowVersion="rv",TCBCostInfo=None,ProductGradeSnapshot=json.dumps({"items":[dict(ParentID="0",ID=1,Grade="Nuts",RatioPct=100)]}))
  body=tcb_api.CommercialSave(RowVersion="rv",Prices=[dict(Path="0/1",DirectUSDPerLb=2)],CostInputs=dict(MaterialCosts=[dict(Path="0/1",ProcessingUSDPerLb=".5")]))
  with patch.object(tcb_api,"current_prices",return_value=[]):
   value,*_=tcb_api.commercial_value(body,item,None,None)
  self.assertEqual(value["Inputs"]["MaterialCosts"][0]["ProcessingUSDPerLb"],"0.5")
  self.assertEqual(Decimal(value["ProductUSDPerLb"]),Decimal("2.5"))
  body.CostInputs.MaterialCosts[0].Path="0/9"
  body.Prices=[]
  with patch.object(tcb_api,"current_prices",return_value=[]),self.assertRaisesRegex(ValueError,"non-leaf"):
   tcb_api.commercial_value(body,item,None,None)
 def test_no_client_variable_override_or_unsupported_expression(self):
  with self.assertRaises(ValueError):Inputs(NW=400)
  for formula in ["UNKNOWN+1","NW**2","NW.__class__","__import__('os')"]:
   with self.subTest(formula=formula),self.assertRaises(ValueError):Inputs(ProductLossFormula=formula)
 def test_nw_division_by_zero_is_not_hidden(self):
  body=tcb_api.LossSave(RowVersion="rv",Inputs=dict(ProductLossFormula="1/(NW-NW)"))
  with patch.object(tcb_api,"require"),patch.object(tcb_api,"item_read",return_value={"WeightGrams":400}),self.assertRaisesRegex(Exception,"zero"):
   tcb_api.preview_loss_formula(body,1,None)
if __name__=="__main__":unittest.main()
