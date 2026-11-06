"""Grade-scoped seasoning eligibility and preservation of saved loss formulas."""
import sys,unittest,copy
from pathlib import Path
from decimal import Decimal as D
from datetime import date
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
from recipe_scope import allows_seasoning,validate_seasoning_scope,normalize_seasoning_scope
from recipe_components import process_component_inputs
from grade_process_loss import GradeProcessLoss,process_loss_results
from npd_recipes import RecipeLine,evaluate
CONFIG={'components':[{'ID':3,'SystemKey':'Seasoning','ComponentName':'Seasoning'}],'mappings':[{'ProcessID':20,'ComponentID':3}]}
APPROVED={'SheetID':1,'ApplicableGradePaths':['0/1'],'SeasoningRatio':5,'SeasoningUSDPerLb':'.14','SeasoningCostBasis':'FinishedProduct'}
def code(identity,name):return dict(MasterID=identity,ProcessName=name,Shared=True)
def results(inputs):
 return {r['Path']:D(r['LossPct']) for r in process_loss_results([GradeProcessLoss(**r) for r in inputs['ProcessLosses']],0,targets=['0/1/1','0/1/2','0/2'],formulas=inputs['ProcessLossFormulas'],aligned=True)}
class Scope(unittest.TestCase):
 def test_subset_sheet_uses_retained_grade_mt_and_only_retained_grade_identity(self):
  item={'AnnualUnit':100000,'EstPctAwarded':50,'WeightGrams':200,'GradeSnapshot':{'items':[{'ParentID':'0','ID':1,'Grade':'Cashews','RatioPct':60},{'ParentID':'0','ID':2,'Grade':'Almonds','RatioPct':40}]}}
  lines=[RecipeLine(Kind='Raw',GradePath='0/1',RatioPct=95),RecipeLine(Kind='Seasoning',IngredientID=1,RatioPct=5,LossPct=10,PriceMode='Direct',DirectPricePerKg=2,DirectPriceCurrency='USD')]
  ingredient={'ID':1,'IngredientCode':'ING-1','Description':'Salt','Status':'Active','IngredientVersion':'v1'}
  result=evaluate(lines,item,[],{},ready=True,ingredients=[ingredient])
  self.assertEqual(result['ApplicableGradePaths'],['0/1']);self.assertEqual(D(result['EstimatedAwardedMT']),6);self.assertEqual(D(result['OrderEstimatedAwardedMT']),10);self.assertEqual(D(result['GradeSharePct']),60)
  self.assertAlmostEqual(D(result['Lines'][1]['TotalQtyMT']),D('.3')/D('.9'),places=25)
  self.assertFalse(result['GradeRatiosDiffer']);self.assertEqual(len(item['GradeSnapshot']['items']),2)
  for bad in ([lines[1]],[lines[0],lines[0],lines[1]],[lines[0].model_copy(update={'GradePath':'0/99'}),lines[1]]):
   with self.assertRaisesRegex(ValueError,'captured Level 1'):evaluate(bad,item,[],{},ingredients=[ingredient])
 def test_subset_reselects_applicable_tier_using_scoped_buffered_quantity(self):
  item={'AnnualUnit':100000,'EstPctAwarded':50,'WeightGrams':200,'GradeSnapshot':{'items':[{'ParentID':'0','ID':1,'Grade':'Cashews','RatioPct':60},{'ParentID':'0','ID':2,'Grade':'Almonds','RatioPct':40}]}}
  seasoning=RecipeLine(Kind='Seasoning',IngredientID=1,RatioPct=5,LossPct=10)
  low={'ID':1,'IngredientID':1,'Status':'Active','IngredientStatus':'Active','VendorStatus':'Active','BaseFactor':'1000','PriceUnitFactor':'1000','QuantityFrom':'0','QuantityTo':'500','EffectiveFrom':date(2020,1,1),'EffectiveTo':None,'CurrencyCode':'USD','UnitPrice':'10','RowVersion':'v1','IngredientVersion':'i1'}
  high={**low,'ID':2,'QuantityFrom':'500','QuantityTo':None,'UnitPrice':'8'}
  all_rows=[RecipeLine(Kind='Raw',GradePath='0/1',RatioPct=57),RecipeLine(Kind='Raw',GradePath='0/2',RatioPct=38),seasoning]
  full=evaluate(all_rows,item,[low,high],{},ready=True)
  subset=evaluate([RecipeLine(Kind='Raw',GradePath='0/1',RatioPct=95),seasoning],item,[low,high],{},ready=True)
  self.assertEqual(full['Lines'][-1]['PriceID'],2);self.assertEqual(subset['Lines'][-1]['PriceID'],1)
  self.assertAlmostEqual(D(subset['Lines'][-1]['Price']['RequiredQuantity']),D(300)/D('.9'),places=25)
  self.assertEqual(D(subset['EstimatedAwardedMT']),6)

 def test_eligibility_matches_first_level_and_blocks_all_grades(self):
  self.assertTrue(allows_seasoning(APPROVED,'0/1'));self.assertTrue(allows_seasoning(APPROVED,'0/1/2'))
  self.assertFalse(allows_seasoning(APPROVED,'0/2'));self.assertFalse(allows_seasoning(APPROVED,'0'))
  self.assertFalse(allows_seasoning(None,'0/1',True));self.assertTrue(allows_seasoning(None,'0/1'))
  self.assertFalse(allows_seasoning({**APPROVED,'Stale':True},'0/1',True))
  legacy={'CapturedGrades':[{'ParentID':'0','ID':1},{'ParentID':'0','ID':2}]}
  self.assertTrue(allows_seasoning(legacy,'0/2'))
 def test_api_rejects_unconfirmed_or_global_seasoning(self):
  for path in ['0','0/2','0/2/1']:
   with self.assertRaisesRegex(ValueError,'only on grades'):validate_seasoning_scope({'ProcessLosses':[{'Path':path,'Codes':[code(20,'Seasoning')]}]},CONFIG,APPROVED)
  validate_seasoning_scope({'ProcessLosses':[{'Path':'0/1','Codes':[code(20,'Seasoning')]}]},CONFIG,APPROVED)
  with self.assertRaises(ValueError):validate_seasoning_scope({'ProcessLosses':[{'Path':'0/1','Codes':[code(20,'Seasoning')]}]},CONFIG,None,True)
  validate_seasoning_scope({'ProcessLosses':[{'Path':'0/1','Codes':[code(20,'Seasoning')]}]},CONFIG,None,False)
 def test_legacy_stage_formulas_convert_without_changing_included_grade_math(self):
  legacy={'ProcessLosses':[
   {'Path':'0/1/1','Codes':[code(1,'Sorting')],'Ratios':['.5'],'Formula':'L1*2'},
   {'Path':'0/1/2','Codes':[code(1,'Sorting')],'Ratios':['.75']},
   {'Path':'0/1','Codes':[code(2,'Roasting')],'Ratios':['1.2']},
   {'Path':'0/2','Codes':[code(1,'Sorting')],'Ratios':['.8']},
   {'Path':'0','Codes':[code(30,'Packing'),code(20,'Seasoning')],'Ratios':['.3','.26'],'Formula':'1-(1-L1)*(1-L2)'}]}
  normalized=normalize_seasoning_scope(legacy,CONFIG,APPROVED,['0/1','0/2'])
  actual=results(normalized)
  self.assertAlmostEqual(actual['0/1/1'],100*(1-D('.99')*D('.988')*D('.997')*D('.9974')),places=8)
  self.assertEqual(actual['0/2'],D('1.0976'))
  self.assertEqual(set(normalized['ProcessLossFormulas']),{'0/1/1','0/1/2','0/2'})

 def test_global_migration_preserves_packing_and_included_grade_formula(self):
  original={'ProcessLossMode':'GradePath','ProcessLossLayout':'Aligned','ProcessLosses':[
   {'Path':'0/1/1','Codes':[code(1,'Sorting')],'Ratios':['.5']},
   {'Path':'0/1/2','Codes':[code(1,'Sorting')],'Ratios':['.75']},
   {'Path':'0/1','Codes':[code(2,'Roasting')],'Ratios':['1.2']},
   {'Path':'0/2','Codes':[code(1,'Sorting')],'Ratios':['.8']},
   {'Path':'0','Codes':[code(30,'Packing'),code(20,'Seasoning')],'Ratios':['.3','.26']}],
   'ProcessLossFormulas':{p:'1-(1-L1)*(1-L2)*(1-L3)*(1-L4)' for p in ['0/1/1','0/1/2','0/2']}}
  baseline=copy.deepcopy(original);before=results(original)
  normalized=normalize_seasoning_scope(original,CONFIG,APPROVED,['0/1','0/2'])
  after=results(normalized)
  self.assertEqual(before['0/1/1'],after['0/1/1']);self.assertEqual(before['0/1/2'],after['0/1/2'])
  self.assertEqual(after['0/2'],D('1.0976'))
  global_row=next(r for r in normalized['ProcessLosses'] if r['Path']=='0');self.assertEqual(global_row['Codes'],[code(30,'Packing')]);self.assertEqual(global_row['Ratios'],['.3'])
  local=next(r for r in normalized['ProcessLosses'] if r['Path']=='0/1');self.assertFalse(local['Codes'][-1]['Shared'])
  self.assertEqual(original,baseline);self.assertEqual(normalize_seasoning_scope(normalized,CONFIG,APPROVED,['0/1','0/2']),normalized)
  calculated=process_component_inputs(normalized,CONFIG,APPROVED,['0/1','0/2'])
  included=next(r for r in calculated['MaterialCosts'] if r['Path']=='0/1');excluded=next(r for r in calculated['MaterialCosts'] if r['Path']=='0/2')
  self.assertEqual(D(included['SeasoningRatio']),5);self.assertEqual(D(excluded['SeasoningRatio']),0);self.assertEqual(excluded['Components'],[])
if __name__=='__main__':unittest.main()
