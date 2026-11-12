import sys,json,unittest
from pathlib import Path
from decimal import Decimal as D
from uuid import uuid4
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
sys.path.insert(0,str(Path(__file__).resolve().parent))
from recipe_levels import RecipeDetails,flatten
from npd_recipes import RecipeLine,obj

def level(process,base,ingredients=()):return dict(ProcessName=process,BaseRatioPct=str(base),Ingredients=[dict(IngredientID=i,RatioPct=str(r)) for i,r in ingredients])
def nut(path,weight,levels):return dict(GradePath=path,BlendRatioPct=str(weight),Levels=levels)
def snapshot(count=1):return {'items':[{'ParentID':'0','ID':i+1,'Grade':['Cashews','Almonds','Macadamias'][i],'RatioPct':[40,40,20][i] if count==3 else 100/count} for i in range(count)]}

class LevelMath(unittest.TestCase):
 def test_dry_roast_then_seasoning(self):
  details=RecipeDetails(Nuts=[nut('0/1',100,[level('Dry roast',100),level('Seasoning',94,[(1,3),(2,3)])])])
  lines,issues=flatten(details,snapshot(),[],True)
  self.assertEqual(issues,[]);self.assertEqual([l.RatioPct for l in lines],[D(94),D(3),D(3)])
 def test_oil_at_two_levels_is_added_once_in_full_view(self):
  details=RecipeDetails(Nuts=[nut('0/1',100,[level('Oil roast',96,[(1,4)]),level('Seasoning',94,[(1,3),(2,3)])])])
  prior=[RecipeLine(Kind='Seasoning',IngredientID=1,RatioPct=0,PriceMode='Direct',DirectPricePerKg=2,DirectPriceCurrency='USD',Note='Chosen quote')]
  lines,_=flatten(details,snapshot(),prior,True)
  self.assertEqual(lines[0].RatioPct,D('90.24'))
  oil=next(l for l in lines if l.IngredientID==1)
  self.assertEqual(oil.RatioPct,D('6.76'));self.assertEqual(oil.DirectPricePerKg,2);self.assertEqual(oil.Note,'Chosen quote')
  self.assertEqual(sum(l.RatioPct for l in lines),100)
 def test_different_nut_recipes_flatten_before_blending(self):
  details=RecipeDetails(Nuts=[nut('0/1',40,[level('Oil roast',96,[(1,4)]),level('Seasoning',94,[(2,6)])]),nut('0/2',40,[level('Dry roast',100),level('Seasoning',95,[(2,5)])]),nut('0/3',20,[level('Dry roast',100)])])
  lines,_=flatten(details,snapshot(3),[],True)
  self.assertEqual([l.RatioPct for l in lines if l.Kind=='Raw'],[D('36.096'),D(38),D(20)])
  self.assertEqual(next(l.RatioPct for l in lines if l.IngredientID==1),D('1.504'))
  self.assertEqual(next(l.RatioPct for l in lines if l.IngredientID==2),D('4.4'))
 def test_invalid_levels_can_draft_but_not_be_ready(self):
  details=RecipeDetails(Nuts=[nut('0/1',100,[level('',95)])])
  _,issues=flatten(details,snapshot(),[],False);self.assertEqual(len(issues),1)
  with self.assertRaisesRegex(ValueError,'ratios must total'):flatten(details,snapshot(),[],True)
 def test_process_name_is_not_required_for_ready_sheet(self):
  details=RecipeDetails(Nuts=[nut('0/1',100,[level('',100)])])
  lines,issues=flatten(details,snapshot(),[],True)
  self.assertEqual(issues,[]);self.assertEqual(lines[0].RatioPct,100)
 def test_unknown_or_duplicate_nuts_rejected(self):
  for nuts in [[nut('0/2',100,[level('Dry',100)])],[nut('0/1',50,[level('Dry',100)])]*2]:
   with self.assertRaisesRegex(ValueError,'at most once'):flatten(RecipeDetails(Nuts=nuts),snapshot(),[],False)
 def test_rounding_reconciles_only_complete_recipes(self):
  details=RecipeDetails(Nuts=[nut('0/1',100,[level('Roast',33.333333,[(1,66.666667)]),level('Season',33.333333,[(2,66.666667)])])])
  lines,_=flatten(details,snapshot(),[],True)
  self.assertEqual(sum(l.RatioPct for l in lines),100)

import npd_desktop_contract as desktop
import npd_api as api
class LevelWorkflow(unittest.TestCase):
 setUp=desktop.Desktop.setUp
 tearDown=desktop.Desktop.tearDown
 row=desktop.Desktop.row
 accept_sheet=desktop.Desktop.accept_sheet
 setup_recipe=desktop.Desktop.setup_recipe
 def test_save_reopen_return_approve_and_revision_preserve_details(self):
  self.setup_recipe()
  paths=[r for r in self.saved['lines'] if r['Kind']=='Raw']
  details=RecipeDetails(Nuts=[nut(r['GradePath'],D(r['RatioPct'])/D('.95'),[level('Oil roast',96,[(self.ingredient['ID'],4)]),level('Seasoning',94,[(self.ingredient['ID'],6)])]) for r in paths])
  body=api.SheetSave(RowVersion=self.sheet['RowVersion'],Status='Price Ready',Lines=[RecipeLine(**r) for r in self.saved['lines']],RecipeDetails=details)
  saved=api.sheet_save(self.sheet['ID'],body,self.admin)
  self.assertEqual(D(saved['calculation']['SeasoningRatio']),D('9.76'))
  self.assertEqual(saved['calculation']['RecipeDetails'],details.model_dump(mode='json'))
  self.assertFalse(saved['calculation']['GradeRatiosDiffer'])
  read=api.sheet_read(self.sheet['ID'],self.admin)
  self.assertEqual(read['calculation']['RecipeDetails'],saved['calculation']['RecipeDetails'])
  self.assertEqual(len([r for r in read['lines'] if r['Kind']=='Seasoning']),1)
  pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=read['row']['RowVersion'],Action='Submit'),self.admin)['row']
  returned=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Return',Comment='Check levels'),self.admin)['row']
  pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=returned['RowVersion'],Action='Submit'),self.admin)['row']
  approved=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Approve'),self.admin)['row']
  self.accept_sheet(self.sheet['ID'])
  self.assertEqual(approved['ApprovalStatus'],'Approved')
  item=api.request_items(self.request['ID'],self.admin)['rows'][0]
  revision=api.sheet_create(item['ID'],api.NewSheet(CreationKey=uuid4(),RowVersion=item['RowVersion']),self.admin)['row']
  self.assertEqual(api.sheet_read(revision['ID'],self.admin)['calculation']['RecipeDetails'],details.model_dump(mode='json'))
