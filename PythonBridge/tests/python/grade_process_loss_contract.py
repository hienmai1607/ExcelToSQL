import sys
import unittest
from pathlib import Path
from decimal import Decimal
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"core"))
from tcb_costs import Inputs,leaves,calculate
from grade_process_loss import GradeProcessLoss,process_loss_results

TREE=[dict(ParentID="0",ID=1,Grade="Cashews",RatioPct=20,Process=True),
 dict(ParentID="0/1",ID=1,Grade="W320",RatioPct=80,RawGradeID=1,Process=False),
 dict(ParentID="0/1",ID=2,Grade="W210",RatioPct=20,RawGradeID=2,Process=False),
 dict(ParentID="0",ID=2,Grade="Almonds",RatioPct=80,RawGradeID=3,Process=False)]

class Contracts(unittest.TestCase):
 def test_grade_yield_before_recipe_and_root_rollup(self):
  inputs=Inputs(Prices=[dict(Path=path,DirectUSDPerLb=price) for path,price in (("0/1/1","3.6"),("0/1/2","1.8"),("0/2","2"))],
   LossProcesses=[dict(ProcessType="Processing",Sequence=1,LossPct=0)],
   ProcessLosses=[dict(Path="0/1",Ratios=[10],Formula="1-(1-L1)")],
   MaterialCosts=[dict(Path="0/1",RMRatio=80,SeasoningRatio=20,SeasoningUSDPerLb=1,ProcessingUSDPerLb=".1")])
  result=calculate(inputs,leaves(TREE),{},weight=150)
  self.assertEqual(Decimal(result["RMCostUSDPerLb"]),Decimal("2.32"))
  self.assertEqual(Decimal(result["ProductUSDPerLb"]),Decimal("2.236"))
  self.assertEqual(Decimal(result["ProcessLossSnapshots"][0]["LossPct"]),10)
 def test_exact_sequential_loss_and_net_weight_formula(self):
  a=GradeProcessLoss(Path="0/1",Ratios=[5,10])
  self.assertEqual(Decimal(process_loss_results([a],2)[0]["LossPct"]),Decimal("14.5"))
  a=GradeProcessLoss(Path="0/1",Ratios=[0],Formula="1-(1-L1)*(1-2/NW)")
  self.assertEqual(Decimal(process_loss_results([a],1,100)[0]["LossPct"]),2)
 def test_invalid_formula_ratio_count_and_zero_yield(self):
  for row,count in ((dict(Path="0/1",Ratios=[100]),1),(dict(Path="0/1",Ratios=[10],Formula="L2"),1),(dict(Path="0/1",Ratios=[]),1)):
   with self.subTest(row=row),self.assertRaises(ValueError):process_loss_results([GradeProcessLoss(**row)],count)

if __name__=="__main__":unittest.main()
