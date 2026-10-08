"""Opportunity-owned losses: no Product inheritance or price requirement."""
import sys,json,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from auth import AccessContext
from tcb_costs import Inputs
from loss_process_api import LossMasterSave
import tcb_api
class OpportunityLossTests(unittest.TestCase):
 def setUp(self):
  self.ctx=AccessContext(1,"Sales",frozenset({"Opportunity"}))
  self.master=dict(MasterID=1,MasterVersion="0x0000000000000001",ProcessType="Processing",ProcessName="Roasting",Sequence=1,LossPct="0")
  self.item=dict(ID=1,RowVersion="AAAAAAAAAAE=",ItemStage="Draft",HeaderStage="Draft",IsMixParent=False,LossLayerCount=2,TCBCostInfo=None,ProductLossSnapshot=json.dumps([self.master]))
 def test_master_has_no_sequence_or_loss_inputs(self):
  self.assertEqual(set(LossMasterSave(ProcessType="Sorting").model_dump()),{"ProcessType","ID","RowVersion","Status"})
 def test_product_snapshot_does_not_force_assignments(self):
  result=tcb_api.resolve_loss_assignments(self.item,Inputs(LossProcesses=[]),self.ctx)
  self.assertEqual(result.LossProcesses,[])
 def test_item_can_assign_product_sequence_and_loss(self):
  with patch.object(tcb_api,"active_loss_masters",return_value=[self.master]):
   result=tcb_api.resolve_loss_assignments(self.item,Inputs(LossProcesses=[{**self.master,"Sequence":3,"LossPct":"5"}]),self.ctx)
  self.assertEqual(result.LossProductPct,5)
  self.assertEqual(result.LossProcesses[0].Sequence,3)
 def test_loss_only_save_preserves_costs_without_calculating_prices(self):
  self.item["TCBCostInfo"]=json.dumps({"Inputs":{"ProcessingUSDPerLb":"2","Prices":[]},"ProductUSDPerLb":"4"})
  with patch.object(tcb_api,"item_read",return_value=self.item),patch.object(tcb_api,"active_loss_masters",return_value=[self.master]),patch.object(tcb_api,"current_prices") as prices,patch.object(tcb_api,"execute",return_value=[[{"RowVersion":"AAAAAAAAAAI="}]]) as write:
   result=tcb_api.save_losses(tcb_api.LossSave(RowVersion=self.item["RowVersion"],Inputs={"LossProcesses":[{**self.master,"LossPct":"5"}]}),1,self.ctx)
  prices.assert_not_called()
  self.assertEqual(result["saved"]["ProductUSDPerLb"],"4")
  self.assertEqual(result["saved"]["Inputs"]["ProcessingUSDPerLb"],"2")
  self.assertEqual(result["saved"]["Inputs"]["LossProductPct"],"5.00")
class FormulaTests(unittest.TestCase):
 def test_product_formula_with_loss_codes_and_zero(self):
  steps=[dict(ProcessType="Processing",Sequence=i+1,LossPct=value) for i,value in enumerate(["5","10"])]
  self.assertEqual(Inputs(LossProcesses=steps,ProductLossFormula="100-(100-L1)*(100-L2)/100").LossProductPct, __import__("decimal").Decimal("14.5"))
  self.assertEqual(Inputs(LossProcesses=steps,ProductLossFormula="0").LossProductPct,0)
 def test_formula_rejects_unknown_code_functions_division_and_out_of_range(self):
  from pydantic import ValidationError
  for formula in ["L9","L1/0","L1**2","__import__('os')","101","-1"]:
   with self.subTest(formula=formula),self.assertRaises(ValidationError):
    Inputs(LossProcesses=[dict(ProcessType="Processing",Sequence=1,LossPct="5")],ProductLossFormula=formula)
class MigrationTests(unittest.TestCase):
 def test_migrations_94_95_compile_and_is_rerunnable_without_persistent_writes(self):
  import pyodbc,re
  conn=pyodbc.connect("DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost;DATABASE=test;Trusted_Connection=yes;TrustServerCertificate=yes",autocommit=True)
  cur=conn.cursor()
  try:
   cur.execute("BEGIN TRANSACTION")
   sql=(Path(__file__).resolve().parents[2]/"sql/94_opportunity_owned_losses.sql").read_text()+"\n"+(Path(__file__).resolve().parents[2]/"sql/95_item_loss_formula.sql").read_text()
   for _ in range(2):
    for batch in re.split(r"^GO\s*$",sql,flags=re.M|re.I):
     if batch.strip():
      cur.execute(batch)
      while cur.nextset():pass
   self.assertIsNone(cur.execute("SELECT OBJECT_ID('dbo.tr_OpportunityItem_ProductLossSnapshot')").fetchval())
  finally:
   cur.execute("IF @@TRANCOUNT>0 ROLLBACK")
   conn.close()
if __name__=="__main__":unittest.main()
