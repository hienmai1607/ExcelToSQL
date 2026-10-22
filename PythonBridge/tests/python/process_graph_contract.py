"""Processing graph and commercial grade-edit regression contracts."""
import json
import unittest
from unittest.mock import patch
import tcb_api
from decimal import Decimal
from tcb_costs import Inputs,leaves,calculate
from product_grades import GradeTree


class GradeEditRegression(unittest.TestCase):
 def test_level_one_recipe_survives_editing_child_process_grades(self):
  items=[dict(ParentID="0",ID=1,Grade="Cashews",RatioPct=100,Process=False),
         dict(ParentID="0/1",ID=1,Grade="W210",RatioPct=40,Process=True),
         dict(ParentID="0/1",ID=2,Grade="W320",RatioPct=60,Process=True)]
  item=dict(RowVersion="rv",IsMixParent=False,WeightGrams=100,TCBCostInfo=None,ProductGradeSnapshot=None)
  body=tcb_api.CommercialSave(RowVersion="rv",Grades={"items":items},CostInputs={"MaterialCosts":[{"Path":"0/1","ProcessingUSDPerLb":".2"}]})
  with patch.object(tcb_api,"validate_snapshot"),patch.object(tcb_api,"current_prices",return_value=[]),patch.object(tcb_api,"palletization_usd",return_value=None),patch.object(tcb_api,"resolve_loss_assignments",side_effect=lambda item,inputs,ctx:inputs):
   saved,_,_,_=tcb_api.commercial_value(body,item,None,None)
  self.assertEqual(saved["Inputs"]["MaterialCosts"][0]["Path"],"0/1")


class GraphMath(unittest.TestCase):
 def test_aligned_columns_keep_parent_codes_and_packing_in_the_same_slots(self):
  from tcb_costs import grade_loss_results
  items=[dict(ParentID="0",ID=1,Grade="Cashews",RatioPct=50,Process=True),dict(ParentID="0/1",ID=1,Grade="W210",RatioPct=40,Process=True),dict(ParentID="0/1",ID=2,Grade="W320",RatioPct=60,Process=False),dict(ParentID="0",ID=2,Grade="Almonds",RatioPct=50,Process=False)]
  def row(path,ratios):return dict(Path=path,Codes=[dict(ProcessName="Type "+str(i)) for i in range(len(ratios))],Ratios=ratios)
  inputs=Inputs(ProcessLossMode="GradePath",ProcessLossLayout="Aligned",ProcessLosses=[row("0/1/1",[1,2,3]),row("0/1",[4,5]),row("0",[6])],ProcessLossFormulas={"0/1":"L5+L6","0/1/1":"L1+L4+L6","0/2":"L6"})
  result=grade_loss_results(inputs,leaves(items))
  self.assertEqual(result[0]["Ratios"],["0","0","0","4","5","6"])
  self.assertEqual(result[1]["Ratios"],["1","2","3","4","5","6"])
  self.assertEqual(result[2]["Ratios"],["0","0","0","0","0","6"])
  self.assertEqual([Decimal(r["LossPct"]) for r in result],[11,11,6])
 def test_path_formulas_cover_parent_only_and_packing_only_grades(self):
  from tcb_costs import grade_loss_results
  items=[dict(ParentID="0",ID=1,Grade="Cashews",RatioPct=50,Process=True),
         dict(ParentID="0/1",ID=1,Grade="W210",RatioPct=40,Process=False),
         dict(ParentID="0/1",ID=2,Grade="W320",RatioPct=60,Process=False),
         dict(ParentID="0",ID=2,Grade="Almonds",RatioPct=50,Process=False)]
  inputs=Inputs(ProcessLossMode="GradePath",ProcessLosses=[dict(Path="0/1",Codes=[dict(ProcessName="Roast")],Ratios=[10],Formula="L99"),dict(Path="0",Codes=[dict(ProcessName="Packing")],Ratios=[2],Formula="L99")],ProcessLossFormulas={"0/1":"L1+L2","0/2":"L1"})
  rows=grade_loss_results(inputs,leaves(items),100)
  self.assertEqual([r["Path"] for r in rows],["0/1","0/2"])
  self.assertEqual([Decimal(r["LossPct"]) for r in rows],[12,2])
  for formula in ("L3","L1+","1","-1"):
   with self.subTest(formula=formula),self.assertRaises(ValueError):
    grade_loss_results(Inputs(**{**inputs.model_dump(),"ProcessLossFormulas":{"0/1":formula}}),leaves(items),100)
 def test_preview_uses_unsaved_grades_and_roundtrip_keeps_complete_formula(self):
  items=[dict(ParentID="0",ID=1,Grade="Cashews",RatioPct=100,Process=True),dict(ParentID="0/1",ID=1,Grade="W210",RatioPct=100,Process=True)]
  data=dict(ProcessLossMode="GradePath",ProcessLosses=[dict(Path="0/1/1",Codes=[dict(ProcessName="Sorting")],Ratios=[5]),dict(Path="0/1",Codes=[dict(ProcessName="Roast")],Ratios=[10]),dict(Path="0",Codes=[dict(ProcessName="Packing")],Ratios=[2])],ProcessLossFormulas={"0/1/1":"L1+L2+L3"},Prices=[dict(Path="0/1/1",DirectUSDPerLb=2)])
  item=dict(RowVersion="rv",IsMixParent=False,WeightGrams=100,TCBCostInfo=None,ProductGradeSnapshot=None)
  body=tcb_api.LossSave(RowVersion="rv",Grades={"items":items},Inputs=data)
  with patch.object(tcb_api,"require"),patch.object(tcb_api,"item_read",return_value=item):
   preview=tcb_api.preview_loss_formula(body,11,None)
  self.assertEqual(Decimal(preview["ProcessLossSnapshots"][0]["LossPct"]),17)
  commercial=tcb_api.CommercialSave(RowVersion="rv",Grades={"items":items},Inputs=data,Prices=data["Prices"])
  with patch.object(tcb_api,"validate_snapshot"),patch.object(tcb_api,"current_prices",return_value=[]),patch.object(tcb_api,"palletization_usd",return_value=None),patch.object(tcb_api,"resolve_loss_assignments",side_effect=lambda item,inputs,ctx:inputs):
   saved,_,_,_=tcb_api.commercial_value(commercial,item,None,None)
  reopened=Inputs(**json.loads(json.dumps(saved))["Inputs"])
  self.assertEqual(reopened.ProcessLossMode,"GradePath")
  self.assertEqual(reopened.ProcessLossFormulas,{"0/1/1":"L1+L2+L3"})
  self.assertEqual(calculate(reopened,leaves(items),{})["RMCostUSDPerLb"],saved["RMCostUSDPerLb"])
 def test_complete_grade_formula_uses_inherited_variables_once_before_recipe(self):
  items=[dict(ParentID="0",ID=1,Grade="Cashews",RatioPct=100,Process=True),
         dict(ParentID="0/1",ID=1,Grade="W210",RatioPct=40,Process=True),
         dict(ParentID="0/1",ID=2,Grade="W320",RatioPct=60,Process=True)]
  def stage(path,name,ratio):return dict(Path=path,Codes=[dict(ProcessName=name)],Ratios=[ratio])
  inputs=Inputs(Prices=[dict(Path="0/1/1",DirectUSDPerLb=2),dict(Path="0/1/2",DirectUSDPerLb=4)],
   ProcessLosses=[stage("0/1/1","Sorting",5),stage("0/1/2","Sorting",3),stage("0/1","Roasting",10),stage("0","Packing",2)],
   MaterialCosts=[dict(Path="0/1",RMRatio=90,SeasoningRatio=10,SeasoningUSDPerLb=1,ProcessingUSDPerLb=".2")])
  # Non-sequential manual formula deliberately differs from multiplying stage yields.
  inputs=Inputs(**{**inputs.model_dump(),"ProcessLossMode":"GradePath","ProcessLossFormulas":{"0/1/1":"L1+L2+L3","0/1/2":"1-(1-L1)*(1-L2)*(1-L3)"}})
  result=calculate(inputs,leaves(items),{})
  rm=Decimal(2)/Decimal(".83")*Decimal(".4")+Decimal(4)/Decimal(".97")/Decimal(".9")/Decimal(".98")*Decimal(".6")
  self.assertAlmostEqual(Decimal(result["RMCostUSDPerLb"]),rm,places=24)
  self.assertAlmostEqual(Decimal(result["ProductUSDPerLb"]),rm*Decimal(".9")+Decimal(".3"),places=24)
  rows=result["ProcessLossSnapshots"]
  self.assertEqual([r["Path"] for r in rows],["0/1/1","0/1/2"])
  self.assertEqual(rows[0]["Ratios"],["5","10","2"])
  self.assertEqual(Decimal(rows[0]["LossPct"]),17)
 def test_type_snapshots_survive_master_changes_but_new_stale_types_are_rejected(self):
  code=dict(MasterID=7,MasterVersion="0x0000000000000001",ProcessName="Old sorting",Shared=False)
  stage=dict(Path="0/1",Codes=[code],Ratios=[5],Formula="L1")
  item=dict(TCBCostInfo=json.dumps({"Inputs":{"ProcessLosses":[stage]}}))
  with patch.object(tcb_api,"active_loss_masters",side_effect=AssertionError("Historical snapshot must not be replaced")):
   result=tcb_api.resolve_loss_assignments(item,Inputs(ProcessLosses=[stage]),None)
  self.assertEqual(result.ProcessLosses[0].Codes[0].ProcessName,"Old sorting")
  with patch.object(tcb_api,"active_loss_masters",return_value=[]),self.assertRaises(Exception):
   tcb_api.resolve_loss_assignments(dict(TCBCostInfo=None),Inputs(ProcessLosses=[stage]),None)
 def test_shared_row_local_types_copy_percentage_by_identity_not_variable_position(self):
  a=dict(MasterID=1,ProcessName="Sorting",Shared=False)
  b=dict(MasterID=2,ProcessName="Shared roast",Shared=True)
  inputs=Inputs(ProcessLosses=[dict(Path="0/1",Codes=[a,b],Ratios=[2,7]),dict(Path="0/2",Codes=[b],Ratios=[9])])
  self.assertEqual(inputs.ProcessLosses[1].Ratios,[Decimal(7)])
 def test_child_parent_and_final_packing_losses_apply_to_rm_before_recipe(self):
  items=[dict(ParentID="0",ID=1,Grade="Cashews",RatioPct=100,Process=True),
         dict(ParentID="0/1",ID=1,Grade="W210",RatioPct=40,Process=True),
         dict(ParentID="0/1",ID=2,Grade="W320",RatioPct=60,Process=True)]
  GradeTree(items=items)
  def stage(path,names,ratios,formula):
   return dict(Path=path,Codes=[dict(ProcessName=n) for n in names],Ratios=ratios,Formula=formula)
  inputs=Inputs(Prices=[dict(Path="0/1/1",DirectUSDPerLb=2),dict(Path="0/1/2",DirectUSDPerLb=4)],
   ProcessLosses=[stage("0/1/1",["Sorting","Roasting"],[10,20],"1-(1-L1)*(1-L2)"),
                  stage("0/1/2",["Sorting"],[5],"L1"),
                  stage("0/1",["Roasting"],[10],"L1"),
                  stage("0",["Packing"],[2],"L1")],
   MaterialCosts=[dict(Path="0/1",RMRatio=90,SeasoningRatio=10,SeasoningUSDPerLb=1,ProcessingUSDPerLb=".2")])
  result=calculate(inputs,leaves(items),{})
  rm=(Decimal(2)/Decimal(".9")/Decimal(".8")*Decimal(".4")+Decimal(4)/Decimal(".95")*Decimal(".6"))/Decimal(".9")/Decimal(".98")
  self.assertAlmostEqual(Decimal(result["RMCostUSDPerLb"]),rm,places=24)
  self.assertAlmostEqual(Decimal(result["ProductUSDPerLb"]),rm*Decimal(".9")+Decimal(".1")+Decimal(".2"),places=24)
  self.assertEqual(len(result["ProcessLossSnapshots"]),4)
  self.assertEqual(result["Inputs"]["ProcessLosses"] if "Inputs" in result else inputs.ProcessLosses[0].Formula,"1-(1-L1)*(1-L2)")
 def test_duplicate_type_and_wrong_local_ratio_count_are_rejected(self):
  from grade_process_loss import GradeProcessLoss
  with self.assertRaises(ValueError):GradeProcessLoss(Path="0/1",Codes=[dict(ProcessName="Roasting"),dict(ProcessName="Roasting")],Ratios=[1,2])
  with self.assertRaises(ValueError):GradeProcessLoss(Path="0/1",Codes=[dict(ProcessName="Roasting")],Ratios=[])


class MasterMigration(unittest.TestCase):
 def test_default_model_and_permission_guard(self):
  import grade_loss_master_api as api
  from auth import AccessContext
  from fastapi import HTTPException
  for value in ("100","-1","1.234","NaN"):
   with self.subTest(value=value),self.assertRaises(ValueError):api.LossDefaultSave(ProcessTypeID=1,LossPct=value)
  with patch.object(api,"execute") as execute,self.assertRaises(HTTPException):
   api.save(api.LossDefaultSave(ProcessTypeID=1,LossPct=2),AccessContext(1,"Sales",frozenset({"Opportunity"})))
  execute.assert_not_called()
 def test_rerun_preserves_types_and_default_crud_has_concurrency(self):
  import db
  from pathlib import Path
  self.assertEqual(db.DB_NAME,"test")
  self.assertIn(db.DB_SERVER.lower(),{"desktop-5bgmjsc",".","localhost"})
  conn=db.engine.raw_connection();cur=conn.cursor()
  def consume():
   while cur.nextset():pass
  try:
   cur.execute("SET NOCOUNT ON; BEGIN TRANSACTION")
   snapshot="SELECT COUNT_BIG(*),CHECKSUM_AGG(BINARY_CHECKSUM(ID,RowVersion,ProcessType,Shared)) FROM dbo.LossProcessMaster"
   before=tuple(cur.execute(snapshot).fetchone())
   sql=Path("sql/141_grade_process_loss_master.sql").read_text(encoding="utf-8")
   for _ in range(2):cur.execute(sql);consume()
   self.assertEqual(before,tuple(cur.execute(snapshot).fetchone()))
   self.assertIn("-- Nested grade processing (141)",cur.execute("SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.usp_ProductGrade_Save'))").fetchval())
   actor=cur.execute("SELECT TOP 1 u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE u.IsActive=1 AND a.Scope='Admin'").fetchval()
   choice=cur.execute("SELECT TOP 1 g.ID,t.ID FROM dbo.RawGrade g CROSS JOIN dbo.LossProcessMaster t WHERE g.Status='Active' AND t.Status='Active' AND NOT EXISTS(SELECT 1 FROM dbo.GradeProcessLossMaster d WHERE d.RawGradeID=g.ID AND d.ProcessTypeID=t.ID)").fetchone()
   self.assertIsNotNone(choice)
   cur.execute("EXEC dbo.usp_GradeProcessLoss_Save ?,NULL,NULL,?,?,5,'Active'",actor,choice[0],choice[1])
   saved=cur.fetchone();consume()
   self.assertEqual(cur.execute("SELECT LossPct FROM dbo.GradeProcessLossMaster WHERE ID=?",saved.ID).fetchval(),5)
   cur.execute("EXEC dbo.usp_GradeProcessLoss_Save ?,?,?,?, ?,7,'Active'",actor,saved.ID,saved.RowVersion,choice[0],choice[1]);consume()
   self.assertEqual(cur.execute("SELECT LossPct FROM dbo.GradeProcessLossMaster WHERE ID=?",saved.ID).fetchval(),7)
   with self.assertRaisesRegex(Exception,"changed"):
    cur.execute("EXEC dbo.usp_GradeProcessLoss_Save ?,?,?,?, ?,8,'Active'",actor,saved.ID,saved.RowVersion,choice[0],choice[1]);consume()
  finally:
   cur.close();conn.cursor().execute("IF @@TRANCOUNT>0 ROLLBACK TRANSACTION");conn.close()

if __name__=="__main__":unittest.main()
