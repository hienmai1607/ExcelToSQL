"""Process-parent math and current-schema persistence. Database fixtures always roll back."""
import unittest,base64,json
from decimal import Decimal
from uuid import uuid4
from tcb_costs import Inputs,leaves,calculate,trim_process_recipes
from product_grades import GradeTree,GradeSave
from final_grade_contract import FinalGrades
import product_grades_api as products
from tcb_versions_contract import TCBVersions
import tcb_versions_api as versions

def tree():
 return [
  dict(ParentID="0",ID=1,Grade="Roasted blend",RatioPct="60",Process=True),
  dict(ParentID="0/1",ID=1,Grade="A",RatioPct="25",Process=False),
  dict(ParentID="0/1",ID=2,Grade="B",RatioPct="75",Process=False),
  dict(ParentID="0",ID=2,Grade="Raw",RatioPct="40",Process=False)]
def prices():
 return [dict(Path=p,DirectUSDPerLb=v) for p,v in [("0/1/1","2"),("0/1/2","4"),("0/2","8")]]

class ProcessMath(unittest.TestCase):
 def test_children_blend_into_one_parent_recipe(self):
  inputs=Inputs(Prices=prices(),MaterialCosts=[dict(Path="0/1",RMRatio=90,SeasoningRatio=10,SeasoningUSDPerLb=1,ProcessingUSDPerLb=".2")])
  result=calculate(inputs,leaves(tree()),{})
  self.assertEqual(Decimal(result["RMCostUSDPerLb"]),Decimal("5.3"))
  self.assertEqual(Decimal(result["ProductUSDPerLb"]),Decimal("5.27"))
  self.assertEqual(len(result["PriceSnapshots"]),3)
  self.assertEqual(len(result["MaterialCostSnapshots"]),1)
  self.assertEqual(result["MaterialCostSnapshots"][0]["Path"],"0/1")
  self.assertEqual(Decimal(result["MaterialCostSnapshots"][0]["RMUSDPerLb"]),Decimal("3.5"))
 def test_unprocessed_nodes_never_apply_global_recipe(self):
  items=tree()
  for g in items:g["Process"]=False
  result=calculate(Inputs(Prices=prices(),ProcessingUSDPerLb=20),leaves(items),{})
  self.assertEqual(Decimal(result["ProductUSDPerLb"]),Decimal("5.3"))
  self.assertEqual(result["MaterialCostSnapshots"],[])
 def test_nested_process_is_rejected(self):
  items=tree();items[1]["Process"]=True
  with self.assertRaisesRegex(ValueError,"cannot also"):leaves(items)
  with self.assertRaisesRegex(ValueError,"cannot also"):GradeTree(items=items)
 def test_only_applicable_recipe_is_saved_and_raw_prices_stay(self):
  inputs=Inputs(Prices=prices(),MaterialCosts=[dict(Path="0/1",ProcessingUSDPerLb=".2"),dict(Path="0/1/1",ProcessingUSDPerLb=99)])
  trim_process_recipes(inputs,tree(),leaves(tree()))
  self.assertEqual([r.Path for r in inputs.MaterialCosts],["0/1"])
  self.assertEqual(len(inputs.Prices),3)
  calculate(inputs,leaves(tree()),{})
 def test_unpriced_child_is_not_silently_omitted(self):
  with self.assertRaisesRegex(ValueError,"price"):calculate(Inputs(Prices=prices()[:-1]),leaves(tree()),{})
 def test_legacy_costs_stay_unchanged(self):
  items=[dict(ParentID="0",ID=1,Grade="Legacy",RatioPct=100)]
  result=calculate(Inputs(Prices=[dict(Path="0/1",DirectUSDPerLb=2)],ProcessingUSDPerLb=".3"),leaves(items),{})
  self.assertEqual(Decimal(result["ProductUSDPerLb"]),Decimal("2.3"))

class ProcessPersistence(unittest.TestCase):
 setUp=FinalGrades.setUp
 cleanup=FinalGrades.cleanup
 grade=FinalGrades.grade
 material=FinalGrades.material
 def test_product_flag_round_trips_and_is_captured_and_copied(self):
  parent=self.grade(False);child=self.grade(True,parent["NewID"]);material=self.material(child["NewID"])
  self.assertEqual(material["Status"],"OK",material)
  customer=self.cur.execute("SELECT TOP(1) ID FROM dbo.Customer WHERE Status='Active'").fetchval()
  product=self.cur.execute("INSERT dbo.Product(ProductCode,ProductName,WeightGrams,CustomerID,CreatedBy) VALUES(?,'Process fixture',100,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())","GP-"+uuid4().hex[:12],customer,self.ctx.user_id).fetchval()
  token=base64.b64encode(self.cur.execute("SELECT RowVersion FROM dbo.Product WHERE ID=?",product).fetchval()).decode()
  items=[dict(ParentID="0",ID=1,Grade="parent",RatioPct=100,RawGradeID=parent["NewID"],Process=True),
         dict(ParentID="0/1",ID=1,Grade="child",RatioPct=100,RawGradeID=child["NewID"],RawMaterialID=material["NewID"],Process=False)]
  result=products.save(GradeSave(ProductRowVersion=token,Status="Active",items=items),product,self.ctx)
  stored=self.cur.execute("SELECT ParentID,Process FROM dbo.ProductGradeItem WHERE VersionID=? ORDER BY ParentID",result["ID"]).fetchall()
  self.assertEqual([(r[0],r[1]) for r in stored],[("0",True),("0/1",False)])
  copied=products.grade_copy(product,self.ctx)
  self.assertEqual([g["Process"] for g in copied["items"]],[True,False])
  captured=json.loads(self.cur.execute("SELECT ProductGradeSnapshot FROM dbo.v_ProductActiveGradeSnapshot WHERE ProductID=?",product).fetchval())
  self.assertEqual([g["Process"] for g in captured["items"]],[True,False])

class ProcessVersion(unittest.TestCase):
 setUp_fixture=TCBVersions.setUp_fixture
 setUp=TCBVersions.setUp
 cleanup=TCBVersions.cleanup
 token=TCBVersions.token
 all=TCBVersions.all
 create=TCBVersions.create
 def test_grouped_costs_save_reopen_copy_and_activate_with_only_parent_recipe(self):
  def grade(parent=None,final=True):
   return self.cur.execute("INSERT dbo.RawGrade(GradeName,Status,CreatedBy,ParentGradeID,FinalGrade) VALUES(?,'Active',?,?,?);SELECT CONVERT(INT,SCOPE_IDENTITY())","Process-"+uuid4().hex[:12],self.actor,parent,final).fetchval()
  root=grade(final=False);a=grade(root);b=grade(root);raw=grade()
  items=tree()
  for node,master in zip(items,[root,a,b,raw]):node["RawGradeID"]=master
  self.cur.execute("UPDATE dbo.OpportunityItem SET ProductGradeSnapshot=? WHERE ID=?",json.dumps({"items":items}),self.item)
  active=self.all()[0]
  body=versions.VersionSave(RowVersion=self.token(),VersionRowVersion=active["RowVersion"],Prices=prices(),Inputs={"LossProcesses":[]},
   CostInputs={"MaterialCosts":[dict(Path="0/1",RMRatio=90,SeasoningRatio=10,SeasoningUSDPerLb=1,ProcessingUSDPerLb=".2"),dict(Path="0/1/1",ProcessingUSDPerLb=99)]})
  result=versions.version_save(body,self.item,active["ID"],self.ctx)
  self.assertEqual(Decimal(result["saved"]["ProductUSDPerLb"]),Decimal("5.27"))
  self.assertEqual([r["Path"] for r in result["saved"]["Inputs"]["MaterialCosts"]],["0/1"])
  reopened=versions.version_read(self.item,active["ID"],self.ctx)
  self.assertEqual([g["ProcessPath"] for g in reopened["tcb"]["grades"]],["0/1","0/1",None])
  copied=self.create(result["version"],"Process copy")
  readcopy=versions.version_read(self.item,copied["ID"],self.ctx)
  self.assertEqual(Decimal(readcopy["tcb"]["saved"]["ProductUSDPerLb"]),Decimal("5.27"))
  versions.activate_version(versions.ActivateVersion(ItemRowVersion=self.token(),VersionRowVersion=copied["RowVersion"]),self.item,copied["ID"],self.ctx)
  live=json.loads(self.cur.execute("SELECT TCBCostInfo FROM dbo.OpportunityItem WHERE ID=?",self.item).fetchval())
  self.assertEqual(Decimal(live["ProductUSDPerLb"]),Decimal("5.27"))
  self.assertEqual([r["Path"] for r in live["Inputs"]["MaterialCosts"]],["0/1"])
