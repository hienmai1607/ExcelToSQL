"""Recipe level Process Type losses: compounding, Full-view loss/buffer and TCB-published loss. No database."""
import sys,unittest
from datetime import date
from decimal import Decimal as D
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
from recipe_levels import RecipeDetails,flatten
from npd_recipes import RecipeLine,evaluate

def level(base,ingredients=(),loss=0,process=None):
 return dict(ProcessTypeID=process,LossPct=str(loss),BaseRatioPct=str(base),Ingredients=[dict(IngredientID=i,RatioPct=str(r)) for i,r in ingredients])
def details(*levels,blend=100):return RecipeDetails(Nuts=[dict(GradePath='0/1',BlendRatioPct=str(blend),Levels=list(levels))])
SNAPSHOT={'items':[{'ParentID':'0','ID':1,'Grade':'Cashews','RatioPct':100}]}
ITEM={'AnnualUnit':'100000','EstPctAwarded':'50','WeightGrams':'200','GradeSnapshot':SNAPSHOT}
def by(lines):return {('Raw' if l.Kind=='Raw' else l.IngredientID):l for l in lines}
def buffer(line):return line.RatioPct/(1-line.LossPct/100)

class LevelLoss(unittest.TestCase):
 def test_level_loss_buffers_every_line_of_its_level(self):
  # User example: 5% loss, Cashews 90% -> buffer ~94.74%.
  lines,issues=flatten(details(level(90,[(1,10)],loss=5,process=7)),SNAPSHOT,[],True)
  rows=by(lines);self.assertEqual(issues,[])
  self.assertEqual((rows['Raw'].RatioPct,rows['Raw'].LossPct,rows[1].LossPct),(D(90),D(5),D(5)))
  self.assertAlmostEqual(float(buffer(rows['Raw'])),90/.95,places=5)

 def test_losses_compound_through_later_levels(self):
  lines,_=flatten(details(level(90,[(1,10)],loss=5),level(95,[(2,5)],loss=2)),SNAPSHOT,[],True)
  rows=by(lines)
  self.assertEqual((rows['Raw'].RatioPct,rows[1].RatioPct,rows[2].RatioPct),(D('85.5'),D('9.5'),D(5)))
  # Level 1 material passes both processes: 1 - 0.95 * 0.98 = 6.9%; Level 2 ingredient only 2%.
  self.assertEqual((rows['Raw'].LossPct,rows[1].LossPct,rows[2].LossPct),(D('6.9'),D('6.9'),D(2)))
  self.assertAlmostEqual(float(buffer(rows['Raw'])),85.5/.95/.98,places=4)

 def test_same_ingredient_at_two_levels_combines_loss(self):
  lines,_=flatten(details(level(90,[(1,10)],loss=5),level(90,[(1,10)],loss=0)),SNAPSHOT,[],True)
  oil=by(lines)[1]
  self.assertEqual(oil.RatioPct,D(19))
  self.assertAlmostEqual(float(buffer(oil)),9/.95+10,places=4)

 def test_no_process_keeps_existing_sheets_unchanged(self):
  lines,_=flatten(details(level(94,[(1,6)])),SNAPSHOT,[],True)
  self.assertTrue(all(l.LossPct==0 for l in lines))
  legacy=RecipeDetails(**{'Nuts':[{'GradePath':'0/1','BlendRatioPct':'100','Levels':[{'ProcessName':'Old','OutputName':'','BaseRatioPct':'100','Ingredients':[]}]}]})
  self.assertEqual(legacy.Nuts[0].Levels[0].LossPct,0)

 def test_manual_buffer_survives_recalculation_and_loss_is_rederived(self):
  prior=[RecipeLine(Kind='Seasoning',IngredientID=1,LossPct=D(50),BufferRatioPct=D(12),Note='kept')]
  oil=by(flatten(details(level(90,[(1,10)],loss=5)),SNAPSHOT,prior,True)[0])[1]
  self.assertEqual((oil.BufferRatioPct,oil.LossPct,oil.Note),(D(12),D(5),'kept'))

class PublishedLoss(unittest.TestCase):
 def calc(self,lines):return evaluate(lines,ITEM,[],{},ready=False,today=date(2026,11,17))
 def test_published_seasoning_loss_excludes_nut_buffers(self):
  lines,_=flatten(details(level(90,[(1,10)],loss=5)),SNAPSHOT,[],False)
  result=self.calc(lines)
  self.assertAlmostEqual(float(D(result['LossByWeightPct'])),100/.95-100,places=4)
  self.assertAlmostEqual(float(D(result['SeasoningLossPct'])),(90+10/.95)-100,places=4)
  raw=result['Lines'][0]
  self.assertAlmostEqual(float(D(raw['BufferRatio'])),90/.95,places=4)
  self.assertAlmostEqual(float(D(raw['TotalQtyMT'])),90/.95/100*10,places=4)

 def test_flat_sheet_published_loss_is_unchanged(self):
  lines=[RecipeLine(Kind='Raw',GradePath='0/1',RatioPct=90),RecipeLine(Kind='Seasoning',IngredientID=1,RatioPct=10,LossPct=10)]
  result=self.calc(lines)
  self.assertEqual(D(result['SeasoningLossPct']),D(result['LossByWeightPct']))
  self.assertAlmostEqual(float(D(result['SeasoningLossPct'])),90+10/.9-100,places=6)

 def test_manual_buffer_drives_quantity_and_must_not_be_below_ratio(self):
  lines=[RecipeLine(Kind='Raw',GradePath='0/1',RatioPct=90,BufferRatioPct=99),RecipeLine(Kind='Seasoning',IngredientID=1,RatioPct=10,BufferRatioPct=8)]
  result=self.calc(lines)
  self.assertEqual(D(result['Lines'][0]['BufferRatio']),D(99));self.assertEqual(D(result['Lines'][0]['CalculatedBufferRatio']),D(90))
  self.assertTrue(any('must not be below its ratio' in i for i in result['Issues']))

if __name__=='__main__':unittest.main()
