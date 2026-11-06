"""Executable NPD calculation contracts; no database required."""
import sys,unittest
from pathlib import Path
from datetime import date
from decimal import Decimal as D
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
from npd_recipes import RecipeLine,evaluate,seasoning_inputs,quote_key,awarded_mt,validate_submission
from workspace_access import permission_scopes,enforce_route,merge_permissions
from auth import AccessContext
from fastapi import HTTPException

class Recipes(unittest.TestCase):
 def setUp(self):
  self.item={'AnnualUnit':'100000','EstPctAwarded':'50','WeightGrams':'200','GradeSnapshot':{'items':[{'ParentID':'0','ID':1,'Grade':'Cashews','RatioPct':60},{'ParentID':'0','ID':2,'Grade':'Almonds','RatioPct':40}]}}
  self.lines=[RecipeLine(Kind='Raw',GradePath='0/1',RatioPct=57),RecipeLine(Kind='Raw',GradePath='0/2',RatioPct=38),RecipeLine(Kind='Seasoning',IngredientID=1,RatioPct=5,LossPct=10)]
  self.price={'ID':1,'IngredientID':1,'Status':'Active','IngredientStatus':'Active','VendorStatus':'Active','BaseFactor':'1000','PriceUnitFactor':'1000','QuantityFrom':'0','QuantityTo':None,'EffectiveFrom':date(2020,1,1),'EffectiveTo':None,'CurrencyCode':'USD','UnitPrice':'10','RowVersion':'price-v1','IngredientVersion':'ingredient-v1'}
 def calc(self,prices=None,lines=None,ready=True):return evaluate(lines or self.lines,self.item,prices if prices is not None else [self.price],{},ready=ready,today=date(2026,11,4))
 def test_award_mass_tier_and_loss_once(self):
  result=self.calc();self.assertEqual(D(result['EstimatedAwardedMT']),10)
  self.assertAlmostEqual(D(result['Lines'][-1]['Price']['RequiredQuantity']),D(500)/D('.9'),places=25)
  self.assertAlmostEqual(D(result['Lines'][-1]['TotalQtyMT']),D('.5')/D('.9'),places=25)
  self.assertAlmostEqual(D(result['SeasoningLossPct']),D(5)/9,places=25)
  self.assertAlmostEqual(D(result['SeasoningUSDPerLb']),D('4.5359237')*D('.05'),places=25)
  self.assertAlmostEqual(D(result['SeasoningContributionUSDPerLb']),D('4.5359237')*D('.05'),places=25)
  self.assertFalse(result['GradeRatiosDiffer'])
 def test_nearest_applicable_moq_precedes_cheapest_vendor(self):
  closer={**self.price,'ID':2,'VendorID':2,'QuantityFrom':'500','UnitPrice':'12'}
  result=self.calc([self.price,closer]);self.assertEqual(result['Lines'][-1]['PriceID'],2)
  self.assertEqual([r['ID'] for r in result['Lines'][-1]['Candidates']],[2,1])
  self.lines[-1].PriceID=1;self.assertEqual(self.calc([self.price,closer])['Lines'][-1]['PriceID'],1)
 def test_direct_vendor_captured_and_blocked_vendor_rejected(self):
  line=self.lines[-1].model_copy(update={'PriceMode':'Direct','DirectPricePerKg':D(10),'DirectPriceCurrency':'USD','DirectVendorID':3})
  ingredients=[{'ID':1,'IngredientCode':'ING-1','Description':'Salt','IngredientVersion':'v1','Status':'Active'}]
  vendor={'ID':3,'VendorName':'Manual Vendor','Status':'Active'}
  result=evaluate([*self.lines[:-1],line],self.item,[],{},ready=True,ingredients=ingredients,vendors=[vendor])
  self.assertEqual(result['Lines'][-1]['DirectPrice']['VendorName'],'Manual Vendor')
  with self.assertRaisesRegex(ValueError,'active vendor'):evaluate([*self.lines[:-1],line],self.item,[],{},ingredients=ingredients,vendors=[{**vendor,'Status':'Block'}])
 def test_from_inclusive_to_exclusive(self):
  low={**self.price,'QuantityTo':'500'};high={**self.price,'ID':2,'QuantityFrom':'500','UnitPrice':'8'}
  result=self.calc([low,high]);self.assertEqual(result['Lines'][-1]['PriceID'],2)
 def test_buffered_quantity_selects_higher_tier(self):
  a=self.calc();self.lines[-1].LossPct=D(50);b=self.calc([self.price,{**self.price,'ID':2,'QuantityFrom':'1000','UnitPrice':'8'}])
  self.assertEqual(D(b['Lines'][-1]['Price']['RequiredQuantity']),1000)
  self.assertEqual(b['Lines'][-1]['PriceID'],2)
  self.assertNotEqual(a['Lines'][-1]['Price']['RequiredQuantity'],b['Lines'][-1]['Price']['RequiredQuantity'])
  validate_submission(b)
  self.lines[-1].LossPct=D(96);c=self.calc();self.assertEqual(D(c['SeasoningLossPct']),120)
  with self.assertRaisesRegex(ValueError,'below 100%'):validate_submission(c)
 def test_changed_raw_proportions_only_warn(self):
  self.lines[0].RatioPct=D(50);self.lines[1].RatioPct=D(45)
  result=self.calc();self.assertTrue(result['GradeRatiosDiffer']);self.assertIn('TCB grade proportions are unchanged',result['Warnings'][0])
  self.assertEqual(self.item['GradeSnapshot']['items'][0]['RatioPct'],60)
 def test_missing_raw_prices_are_allowed(self):
  lines=[RecipeLine(Kind='Raw',GradePath='0/1',RatioPct=60),RecipeLine(Kind='Raw',GradePath='0/2',RatioPct=40)]
  result=self.calc([],lines);self.assertEqual(result['SeasoningUSDPerLb'],'0');self.assertFalse(result['Issues'])
 def test_missing_or_blocked_ingredient_price_blocks_ready(self):
  for patch in ({'Status':'Block'},{'IngredientStatus':'Block'},{'VendorStatus':'Block'},{'QuantityFrom':'556'},{'EffectiveFrom':date(2030,1,1)}):
   with self.subTest(patch=patch),self.assertRaisesRegex(ValueError,'applicable ingredient price'):self.calc([{**self.price,**patch}])
 def test_draft_reports_missing_quote_without_publishing(self):
  self.assertEqual(len(self.calc([],ready=False)['Issues']),1)
 def test_require_complete_ratios_and_fixed_identity(self):
  self.lines[0].RatioPct=D(50)
  with self.assertRaisesRegex(ValueError,'100%'):self.calc()
  self.lines[0].GradePath='0/3'
  with self.assertRaisesRegex(ValueError,'fixed line'):self.calc()
 def test_g_price_normalizes_to_same_lb_cost(self):
  a=self.calc();b=self.calc([{**self.price,'PriceUnitFactor':'1','UnitPrice':'.01'}])
  self.assertEqual(a['SeasoningUSDPerLb'],b['SeasoningUSDPerLb'])
 def test_cost_outside_tcb_decimal_range_is_rejected_before_approval(self):
  with self.assertRaisesRegex(ValueError,'price range'):self.calc([{**self.price,'UnitPrice':'9999999999999','PriceUnitFactor':'1'}])
 def test_currency_and_current_rate(self):
  p={**self.price,'CurrencyCode':'VND','UnitPrice':'265000'}
  result=evaluate(self.lines,self.item,[p],{'ExchangeRateVNDPerUSD':'26500'},ready=True)
  self.assertEqual(D(result['SeasoningUSDPerLb']),D(self.calc()['SeasoningUSDPerLb']))
 def test_explicit_quote_cannot_silently_fall_back(self):
  self.lines[-1].PriceID=2
  with self.assertRaisesRegex(ValueError,'inactive or unavailable'):self.calc()
 def test_tcb_inputs_rebalance_without_mutating_oil_or_processing(self):
  inputs={'RMRatio':98,'OilPct':2,'OilUSDPerLb':1,'ProcessingUSDPerLb':'.1','MaterialCosts':[{'Path':'0/1','OilPct':3}]}
  result=seasoning_inputs(inputs,{'SeasoningRatio':'5','SeasoningUSDPerLb':'4.535923712345'})
  self.assertEqual(result['RMRatio'],'93');self.assertEqual(result['MaterialCosts'][0]['RMRatio'],'92')
  self.assertEqual(result['SeasoningUSDPerLb'],'4.535924');self.assertEqual(inputs['RMRatio'],98)
  self.assertEqual(result['ProcessingUSDPerLb'],'.1')
 def test_oil_plus_seasoning_cannot_exceed_100(self):
  with self.assertRaisesRegex(ValueError,'exceed 100'):seasoning_inputs({'OilPct':99},{'SeasoningRatio':'5','SeasoningUSDPerLb':'2'})
 def test_quote_fingerprint_detects_current_price_or_conversion_changes(self):
  a=self.calc();b=self.calc([{**self.price,'UnitPrice':'11'}]);self.assertNotEqual(quote_key(a),quote_key(b))
 def test_sales_read_permissions_do_not_grant_npd_pic_scope(self):
  self.assertNotIn('NPD',permission_scopes({'recipe-requests':'display','recipe-sheets':'display'}))
 def test_incomplete_opportunity_lookup_has_zero_estimate(self):
  self.assertEqual(awarded_mt({'AnnualUnit':None,'EstPctAwarded':None,'WeightGrams':None}),0)
 def test_legacy_recipe_defaults_follow_selected_process_components(self):
  config={'components':[{'ID':3,'SystemKey':'Seasoning','ComponentName':'Seasoning'}],
          'mappings':[{'ProcessID':20,'ComponentID':3}]}
  approved={'SeasoningRatio':'5','SeasoningUSDPerLb':'2.5'}
  selected=seasoning_inputs({'LossProcesses':[{'MasterID':20}]},approved,config)
  self.assertEqual(D(selected['SeasoningRatio']),5);self.assertEqual(D(selected['RMRatio']),95)
  self.assertEqual(D(selected['SeasoningUSDPerLb']),D('2.5'))
  unselected=seasoning_inputs({},approved,config)
  self.assertEqual(D(unselected['SeasoningRatio']),0);self.assertEqual(unselected['Components'],[])
 def test_two_ingredients_weighted_contribution_and_buffer_loss(self):
  lines=[RecipeLine(Kind='Raw',GradePath='0/1',RatioPct=57),RecipeLine(Kind='Raw',GradePath='0/2',RatioPct=38),RecipeLine(Kind='Seasoning',IngredientID=1,RatioPct=3,LossPct=10),RecipeLine(Kind='Seasoning',IngredientID=2,RatioPct=2,LossPct=20)]
  prices=[{**self.price,'UnitPrice':'2','PriceUnitFactor':'453.59237'},{**self.price,'ID':2,'IngredientID':2,'UnitPrice':'4','PriceUnitFactor':'453.59237'}]
  result=self.calc(prices,lines);self.assertEqual(D(result['SeasoningUSDPerLb']),D('.14'))
  self.assertAlmostEqual(D(result['SeasoningLossPct']),(D(3)/D('.9')+D(2)/D('.8')-5),places=24)
  approved={**result,'SeasoningComponentID':3};inputs=seasoning_inputs({'RMRatio':100,'OilPct':0,'ProcessingUSDPerLb':0},approved)
  from tcb_costs import Inputs,calculate,leaves
  grades=leaves([{'ParentID':'0','ID':1,'Grade':'Cashews','RatioPct':100,'Process':True}])
  inputs['Prices']=[{'Path':'0/1','DirectUSDPerLb':10}]
  self.assertEqual(D(calculate(Inputs(**inputs),grades,{})['ProductUSDPerLb']),D('9.64'))
  inputs['Components']=[{'ComponentID':3,'SystemKey':'Seasoning','ComponentName':'Seasoning','RatioPct':5,'USDPerLb':'.14','CostBasis':'FinishedProduct'}]
  result=calculate(Inputs(**inputs),grades,{})
  self.assertEqual(D(result['ProductUSDPerLb']),D('9.64'))
  self.assertEqual(result['MaterialCostSnapshots'][0]['Inputs']['Components'][0]['CostBasis'],'FinishedProduct')
 def test_zero_seasoning_loss_is_zero(self):
  lines=[RecipeLine(Kind='Raw',GradePath='0/1',RatioPct=60),RecipeLine(Kind='Raw',GradePath='0/2',RatioPct=40)]
  result=self.calc([],lines);self.assertEqual(D(result['SeasoningLossPct']),0);validate_submission(result)
 def test_prices_normalize_to_kg_and_use_sheet_fx(self):
  p={**self.price,'CurrencyCode':'VND','UnitPrice':'265000'}
  result=evaluate(self.lines,self.item,[p],{'ExchangeRateVNDPerUSD':'26500'},ready=True)
  price=result['Lines'][-1]['Price'];self.assertEqual(D(price['USDPerKg']),10);self.assertEqual(D(price['VNDPerKg']),265000)
  result=evaluate(self.lines,self.item,[p],{'ExchangeRateVNDPerUSD':'25000'},ready=True)
  self.assertEqual(D(result['Lines'][-1]['Price']['USDPerKg']),D('10.6'))

 def direct(self,currency='USD',amount='10',status='Active',rate='26500'):
  lines=[*self.lines[:-1],RecipeLine(Kind='Seasoning',IngredientID=1,RatioPct=5,LossPct=10,DirectPricePerKg=amount,DirectPriceCurrency=currency)]
  ingredients=[{'ID':1,'IngredientCode':'ING-1','Description':'Salt','IngredientVersion':'v1','Status':status}]
  return evaluate(lines,self.item,[],{'ExchangeRateVNDPerUSD':rate},ready=True,ingredients=ingredients)
 def test_direct_price_in_either_currency_without_pricing_master(self):
  usd=self.direct();vnd=self.direct('VND','265000')
  self.assertEqual(usd['SeasoningUSDPerLb'],vnd['SeasoningUSDPerLb'])
  self.assertEqual(D(usd['SeasoningUSDPerLb']),D('.226796185'))
  line=usd['Lines'][-1];self.assertIsNone(line['PriceID']);self.assertIsNone(line['Price'])
  self.assertEqual(D(line['DirectPrice']['VNDPerKg']),265000)
  self.assertEqual(D(self.direct('VND','265000',rate='25000')['Lines'][-1]['DirectPrice']['USDPerKg']),D('10.6'))
 def test_direct_zero_price_is_a_valid_explicit_price(self):
  self.assertEqual(D(self.direct(amount='0')['SeasoningUSDPerLb']),0)
 def test_direct_price_validation(self):
  for patch in ({'DirectPricePerKg':'-1','DirectPriceCurrency':'USD'},{'DirectPricePerKg':'1'},{'DirectPriceCurrency':'USD'},{'DirectPricePerKg':'1','DirectPriceCurrency':'USD','PriceID':1}):
   with self.subTest(patch=patch),self.assertRaises(ValueError):RecipeLine(Kind='Seasoning',IngredientID=1,**patch)
  self.assertEqual(RecipeLine(Kind='Raw',GradePath='0/1',DirectPricePerKg=1,DirectPriceCurrency='USD').DirectPricePerKg,1)
  with self.assertRaisesRegex(ValueError,'active ingredient'):self.direct(status='Block')
  with self.assertRaisesRegex(ValueError,'exchange rate'):self.direct('VND','265000',rate=None)
 def test_direct_quote_fingerprint_detects_price_and_ingredient_changes(self):
  a=self.direct();b=self.direct(amount='11');self.assertNotEqual(quote_key(a),quote_key(b))
  b=self.direct();b['Lines'][-1]['DirectPrice']['IngredientVersion']='v2';self.assertNotEqual(quote_key(a),quote_key(b))

 def test_quote_fingerprint_compares_exact_values_instead_of_decimal_formatting(self):
  a=self.direct();b=self.direct()
  for key in ('UnitPrice','USDPerKg','VNDPerKg','USDPerLb'):b['Lines'][-1]['DirectPrice'][key]=format(D(b['Lines'][-1]['DirectPrice'][key]),'.12f')
  self.assertEqual(quote_key(a),quote_key(b))
  b['Lines'][-1]['DirectPrice']['VNDPerKg']='265000.000001';self.assertNotEqual(quote_key(a),quote_key(b))
  a=self.calc();b=self.calc();b['Lines'][-1]['Price']['USDPerLb']='4.535923700000';self.assertEqual(quote_key(a),quote_key(b))
 def test_finished_goods_summaries_include_optional_nut_cost_and_all_weight(self):
  lines=[RecipeLine(Kind='Raw',GradePath='0/1',RatioPct=57,DirectPricePerKg=10,DirectPriceCurrency='USD',IngredientNote='Roasted cashews',Note='Inspect nuts'),RecipeLine(Kind='Raw',GradePath='0/2',RatioPct=38),RecipeLine(Kind='Seasoning',IngredientID=1,RatioPct=5,LossPct=20,DirectPricePerKg=20,DirectPriceCurrency='USD',Note='Fine grind')]
  ingredients=[{'ID':1,'IngredientCode':'ING-1','Description':'Sugar','GradeNature':'Fine powder','Origin':'Vietnam','Status':'Active','IngredientVersion':'v1'}]
  result=evaluate(lines,self.item,[],{'ExchangeRateVNDPerUSD':25000},ready=True,ingredients=ingredients)
  self.assertEqual(D(result['CostFGUSDPerKg']),D('6.7'))
  self.assertEqual(D(result['CostFGWithBufferUSDPerKg']),D('6.95'))
  self.assertEqual(D(result['SeasoningLossPct']),D('1.25'))
  self.assertAlmostEqual(D(result['LossByValuePct']),D('.25')/D('6.7')*100,places=24)
  self.assertEqual(D(result['SeasoningUSDPerKg']),1)
  self.assertEqual(D(result['SeasoningUSDPerLb']),D('.45359237'))
  self.assertEqual(result['Lines'][0]['GradeNature'],'Cashews');self.assertEqual(result['Lines'][0]['Origin'],'NA')
  self.assertEqual(result['Lines'][0]['IngredientNote'],'Roasted cashews');self.assertEqual(result['Lines'][2]['Note'],'Fine grind')
  self.assertEqual(result['Lines'][2]['GradeNature'],'Fine powder');self.assertEqual(result['Lines'][2]['Origin'],'Vietnam')
 def test_missing_seasoning_price_does_not_display_a_zero_finished_goods_cost(self):
  result=self.calc([],ready=False);self.assertIsNone(result['CostFGUSDPerKg']);self.assertIsNone(result['SeasoningUSDPerKg'])
 def test_zero_cost_keeps_value_loss_undefined(self):
  lines=[RecipeLine(Kind='Raw',GradePath='0/1',RatioPct=60),RecipeLine(Kind='Raw',GradePath='0/2',RatioPct=40)]
  result=self.calc([],lines);self.assertEqual(D(result['CostFGUSDPerKg']),0);self.assertIsNone(result['LossByValuePct'])

 def test_selected_tier_explains_minimum_and_buffered_quantity(self):
  self.item.update(AnnualUnit=32000,EstPctAwarded=60,WeightGrams=400)
  self.lines[-1].RatioPct=D(2);self.lines[-1].LossPct=D(4);self.lines[-1].PriceID=1
  result=self.calc([{**self.price,'QuantityFrom':'1000','BaseUoM':'KG'}],ready=False)
  row=result['Lines'][-1];self.assertIn('1,000 KG',row['PriceIssue']);self.assertIn('160 KG',row['PriceIssue'])
  self.assertEqual(row['SelectedPrice']['ID'],1);self.assertIsNone(row['Price']);self.assertIsNone(result['SeasoningUSDPerLb'])
 def test_direct_selection_does_not_fall_back_to_master_or_assume_zero(self):
  self.lines[-1]=RecipeLine(Kind='Seasoning',IngredientID=1,RatioPct=5,PriceMode='Direct')
  draft=self.calc(ready=False);self.assertIsNone(draft['Lines'][-1]['Price']);self.assertIsNone(draft['SeasoningUSDPerLb'])
  with self.assertRaisesRegex(ValueError,'direct ingredient price'):self.calc()

 def test_member_routes_keep_assignment_manager_only(self):
  ctx=AccessContext(2,'npd',frozenset({'NPD'}),merge_permissions({'NPD'},[]))
  enforce_route(ctx,'/api/npd/sheets/1/preview','POST')
  with self.assertRaises(HTTPException):enforce_route(ctx,'/api/npd/request-items/1/assign','POST')

if __name__=='__main__':unittest.main()
