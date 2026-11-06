"""Component costing, process mapping, captured requirements and SQL lock checks."""
import sys,unittest,json
from pathlib import Path
from decimal import Decimal as D
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
sys.path.insert(0,str(Path(__file__).resolve().parent))
from tcb_costs import Inputs,calculate,leaves
from npd_desktop_contract import Desktop
import npd_api as api
from npd_recipes import obj,RecipeLine,seasoning_inputs
from recipe_components import validate_assignments,catalog,process_component_inputs,component_contribution
from recipe_component_api import save as save_component,ComponentSave
from loss_process_api import save as save_process,LossMasterSave,active_loss_masters
from fastapi import HTTPException
from uuid import uuid4

class ComponentMath(unittest.TestCase):
 def test_sheet_overrides_survive_json_and_new_sheet_resets_them(self):
  config={'components':[{'ID':3,'SystemKey':'Seasoning','ComponentName':'Seasoning'}],'mappings':[{'ProcessID':20,'ComponentID':3}]}
  source={'ProcessLosses':[{'Path':'0/1','Codes':[{'MasterID':20,'ProcessName':'Seasoning'}],'Ratios':[0]}]}
  approved={'SheetID':21,'SeasoningRatio':5,'SeasoningUSDPerLb':'.14','SeasoningCostBasis':'FinishedProduct'}
  initial=process_component_inputs(source,config,approved,['0/1'])
  component=initial['MaterialCosts'][0]['Components'][0]
  self.assertEqual(component['SourceSheetID'],21)
  component.update(USDPerLb='.2',ManualFields=['USDPerLb'])
  saved=Inputs(**initial).model_dump(mode='json')
  restored=process_component_inputs(saved,config,approved,['0/1'])
  current=restored['MaterialCosts'][0]
  self.assertEqual(D(current['SeasoningUSDPerLb']),D('.2'))
  self.assertEqual(D(current['SeasoningRatio']),5)
  current['Components'][0].update(RatioPct=6,ManualFields=['USDPerLb','RatioPct'])
  restored=process_component_inputs(restored,config,approved,['0/1'])
  current=restored['MaterialCosts'][0]
  self.assertEqual(D(current['RMRatio']),94)
  self.assertEqual(current['Components'][0]['CostBasis'],'FinishedProduct')
  # The manual weighted seasoning contribution remains a finished-product cost.
  self.assertEqual(component_contribution(Inputs(**restored).MaterialCosts[0]),D('.2'))
  renewed=process_component_inputs(restored,config,{**approved,'SheetID':22,'SeasoningRatio':7,'SeasoningUSDPerLb':'.3'},['0/1'])
  current=renewed['MaterialCosts'][0]
  self.assertEqual(D(current['SeasoningUSDPerLb']),D('.3'));self.assertEqual(D(current['RMRatio']),93)
  self.assertEqual(current['Components'][0]['ManualFields'],[])


 def test_components_follow_processes_not_saved_values_or_required_recipe_flag(self):
  config={'components':[{'ID':1,'SystemKey':'Oil','ComponentName':'Oil','Status':'Active'},{'ID':2,'SystemKey':'Seasoning','ComponentName':'Seasoning','Status':'Active'}],
   'mappings':[{'ProcessID':10,'ComponentID':1},{'ProcessID':20,'ComponentID':2}]}
  inputs={'RMRatio':93,'OilPct':2,'OilUSDPerLb':4,'SeasoningRatio':5,'SeasoningUSDPerLb':6,'ProcessingUSDPerLb':0,
   'ProcessLosses':[{'Path':'0/1/1','Codes':[{'MasterID':10}],'Ratios':[0]}]}
  approved={'SheetID':1,'SeasoningRatio':5,'SeasoningUSDPerLb':'.14','SeasoningCostBasis':'FinishedProduct'}
  result=process_component_inputs(inputs,config,approved,['0/1','0/2'])
  first,second=result['MaterialCosts'];self.assertEqual(first['RMRatio'],'98');self.assertEqual(first['OilPct'],2)
  self.assertEqual(result['Components'],[])
  self.assertEqual(first['SeasoningRatio'],'0');self.assertEqual(second['Components'],[]);self.assertEqual(second['RMRatio'],'100')
  inputs['ProcessLosses'][0]['Codes']=[{'MasterID':20}]
  result=process_component_inputs(inputs,config,approved,['0/1','0/2'])
  self.assertEqual(result['MaterialCosts'][0]['SeasoningUSDPerLb'],'0.140000');self.assertEqual(result['MaterialCosts'][0]['RMRatio'],'95')
  self.assertEqual(result['MaterialCosts'][1]['RMRatio'],'100')
  inputs['ProcessLosses']=[]
  result=process_component_inputs(inputs,config,approved,['0/1'])
  self.assertEqual(result['Components'],[]);self.assertEqual(result['MaterialCosts'][0]['RMRatio'],'100')
 def test_stale_or_inactive_recipe_cannot_supply_component_defaults(self):
  config={'components':[{'ID':1,'SystemKey':'Seasoning','ComponentName':'Seasoning'}],'mappings':[{'ProcessID':20,'ComponentID':1}]}
  inputs={'ProcessLosses':[{'Path':'0/1','Codes':[{'MasterID':20}],'Ratios':[0]}]}
  for flag in ('Inactive','Stale'):
   result=process_component_inputs(inputs,config,{flag:True,'SeasoningRatio':5,'SeasoningUSDPerLb':'.14'},['0/1'])
   self.assertEqual(result['MaterialCosts'][0]['SeasoningRatio'],0);self.assertIsNone(result['MaterialCosts'][0]['SeasoningUSDPerLb'])
 def test_multiple_components_use_ratios_and_rebalance_rm(self):
  inputs=Inputs(RMRatio=90,Components=[{'ComponentID':1,'SystemKey':'Salt','ComponentName':'Salt','USDPerLb':2,'RatioPct':3},{'ComponentID':2,'SystemKey':'Oil','ComponentName':'Oil','USDPerLb':4,'RatioPct':2},{'ComponentID':3,'SystemKey':'Seasoning','ComponentName':'Seasoning','USDPerLb':6,'RatioPct':5}],Prices=[{'Path':'0/1','DirectUSDPerLb':10}])
  result=calculate(inputs,leaves([{'ParentID':'0','ID':1,'Grade':'Almonds','Process':True,'RatioPct':100}]),{})
  self.assertEqual(D(result['RMCostUSDPerLb']),9);self.assertEqual(D(result['ProductUSDPerLb']),D('9.44'))
 def test_component_total_cannot_exceed_100(self):
  with self.assertRaises(ValueError):Inputs(RMRatio=98,Components=[{'ComponentID':1,'SystemKey':'Salt','ComponentName':'Salt','USDPerLb':2,'RatioPct':3}])
 def test_approved_seasoning_keeps_salt_oil_and_custom_components(self):
  current={'Components':[{'ComponentID':1,'SystemKey':'Salt','ComponentName':'Salt','USDPerLb':2,'RatioPct':3},{'ComponentID':2,'SystemKey':'Oil','ComponentName':'Oil','USDPerLb':4,'RatioPct':2}]}
  result=seasoning_inputs(current,{'SeasoningComponentID':3,'SeasoningRatio':5,'SeasoningUSDPerLb':6})
  self.assertEqual(result['RMRatio'],'90');self.assertEqual(len(result['Components']),3)

class ComponentWorkflow(Desktop):
 def test_approval_scopes_removed_grades_and_recipe_moq(self):
  from tcb_api import commercial_value,CommercialSave,item_read
  from recipe_scope import validate_seasoning_scope
  self.setup_recipe();original=obj(self.source['ProductGradeSnapshot'])
  selected=[RecipeLine(**r) for r in self.saved['lines'] if r['Kind']=='Seasoning' or r['GradePath']=='0/1']
  selected[0].RatioPct=D(95)
  selected[-1]=selected[-1].model_copy(update={'PriceID':None,'PriceMode':'Direct','DirectPricePerKg':D(10),'DirectPriceCurrency':'USD'})
  saved=api.sheet_save(self.sheet['ID'],api.SheetSave(RowVersion=self.sheet['RowVersion'],Status='Price Ready',Lines=selected),self.admin)
  self.assertEqual(saved['calculation']['ApplicableGradePaths'],['0/1'])
  self.assertEqual(D(saved['calculation']['EstimatedAwardedMT']),D(self.saved['calculation']['EstimatedAwardedMT'])*D('.6'))
  before=obj(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'])
  self.assertFalse(before.get('NPDRecipe'))
  master=next(m for m in active_loss_masters(self.admin) if m['ProcessName']=='Seasoning')
  before['Inputs'].update(ProcessLosses=[{'Path':'0','Codes':[{'MasterID':master['MasterID'],'MasterVersion':master['MasterVersion'],'ProcessName':'Seasoning','Shared':True}],'Ratios':['0']}],ProcessLossMode='GradePath',ProcessLossLayout='Aligned',ProcessLossFormulas={})
  self.cur.execute('UPDATE dbo.OpportunityItem SET TCBCostInfo=? WHERE ID=?',json.dumps(before),self.source['OpportunityItemID'])
  pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=saved['row']['RowVersion'],Action='Submit'),self.admin)['row']
  api.sheet_review(self.sheet['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Approve'),self.admin)
  item=item_read(self.source['OpportunityItemID'],self.admin);value=obj(item['TCBCostInfo'])
  self.assertEqual(value['NPDRecipe']['ApplicableGradePaths'],['0/1'])
  self.assertEqual(obj(item['ProductGradeSnapshot']),original)
  stages=value['Inputs']['ProcessLosses'];included=next(r for r in stages if r['Path']=='0/1')
  self.assertEqual(included['Codes'][0]['MasterID'],master['MasterID']);self.assertFalse(included['Codes'][0]['Shared'])
  self.assertFalse(any(c['MasterID']==master['MasterID'] for r in stages if r['Path']=='0' or r['Path'].startswith('0/2') for c in r.get('Codes') or []))
  recipes={r['Path']:r for r in value['Inputs']['MaterialCosts']}
  self.assertEqual(D(recipes['0/1']['SeasoningRatio']),5);self.assertEqual(D(recipes['0/2']['SeasoningRatio']),0)
  forbidden=__import__('copy').deepcopy(value['Inputs'])
  forbidden['ProcessLosses'].append({'Path':'0/2','Codes':[included['Codes'][0]],'Ratios':['0']})
  with self.assertRaisesRegex(ValueError,'only on grades'):
   commercial_value(CommercialSave(RowVersion=item['RowVersion'],CostInputs=Inputs(**forbidden)),item,self.admin,self.cur)


 def test_commercial_save_preserves_manual_sheet_price_and_provenance(self):
  from tcb_api import commercial_save,CommercialSave,item_read
  self.setup_recipe()
  master=next(m for m in active_loss_masters(self.admin) if m['ProcessName']=='Seasoning')
  value=obj(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'])
  value['Inputs'].update(ProcessLosses=[{'Path':'0/1','Codes':[{'MasterID':master['MasterID'],'MasterVersion':master['MasterVersion'],'ProcessName':'Seasoning'}],'Ratios':['0']}],ProcessLossMode='GradePath',ProcessLossLayout='Aligned',ProcessLossFormulas={})
  self.cur.execute('UPDATE dbo.OpportunityItem SET TCBCostInfo=? WHERE ID=?',json.dumps(value),self.source['OpportunityItemID'])
  pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=self.sheet['RowVersion'],Action='Submit'),self.admin)['row']
  api.sheet_review(self.sheet['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Approve'),self.admin)
  value=obj(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'])
  recipe=next(r for r in value['Inputs']['MaterialCosts'] if r['Path']=='0/1')
  component=next(r for r in recipe['Components'] if r['SystemKey']=='Seasoning')
  self.assertEqual(component['SourceSheetID'],self.sheet['ID'])
  component.update(USDPerLb='.3',ManualFields=['USDPerLb']);recipe['SeasoningUSDPerLb']='.3'
  code=value['Inputs']['ProcessLosses'][0]['Codes'][0];code.update(SourceSheetID=None,ManualLoss=True)
  item=item_read(self.source['OpportunityItemID'],self.admin)
  prices=[{'Path':g['Path'],'DirectUSDPerLb':'10'} for g in leaves(obj(item['ProductGradeSnapshot'])['items'])]
  commercial_save(CommercialSave(RowVersion=item['RowVersion'],CostInputs=Inputs(**value['Inputs']),Prices=prices),self.source['OpportunityItemID'],self.admin)
  reread=obj(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'])
  recipe=next(r for r in reread['Inputs']['MaterialCosts'] if r['Path']=='0/1')
  component=next(r for r in recipe['Components'] if r['SystemKey']=='Seasoning')
  self.assertEqual(D(component['USDPerLb']),D('.3'));self.assertEqual(component['ManualFields'],['USDPerLb'])
  self.assertEqual(component['SourceSheetID'],self.sheet['ID']);self.assertEqual(component['CostBasis'],'FinishedProduct')
  self.assertTrue(reread['Inputs']['ProcessLosses'][0]['Codes'][0]['ManualLoss'])
  self.assertEqual(reread['NPDRecipe']['SheetID'],self.sheet['ID'])


 def test_commercial_preview_uses_only_selected_grade_components(self):
  from tcb_api import commercial_value,CommercialSave,item_read
  from loss_process_api import active_loss_masters
  oil=self.cur.execute("SELECT ID FROM dbo.RecipeComponent WHERE SystemKey='Oil'").fetchval()
  process=save_process(LossMasterSave(ProcessType='QA preview roasting '+uuid4().hex,ComponentIDs=[oil]),self.admin)['rows'][0]
  master=next(m for m in active_loss_masters(self.admin) if m['MasterID']==process['ID'])
  grade_list=leaves(obj(self.source['ProductGradeSnapshot'])['items']);root=grade_list[0]['Path'].split('/')[1];path='0/'+root
  inputs=Inputs(RMRatio=98,OilPct=2,OilUSDPerLb=4,ProcessLosses=[{'Path':path,'Codes':[{'MasterID':master['MasterID'],'MasterVersion':master['MasterVersion'],'ProcessName':master['ProcessName']}],'Ratios':[0]}])
  item=item_read(self.source['OpportunityItemID'],self.admin)
  body=CommercialSave(RowVersion=item['RowVersion'],CostInputs=inputs,Prices=[{'Path':g['Path'],'DirectUSDPerLb':10} for g in grade_list])
  value,_,_,_=commercial_value(body,item,self.admin,self.cur)
  recipes=value['Inputs']['MaterialCosts'];self.assertTrue(recipes)
  selected=next(r for r in recipes if r['Path']==path)
  self.assertEqual(D(selected['OilPct']),2);self.assertEqual(D(selected['RMRatio']),98)
  for row in recipes:
   if row['Path']!=path:self.assertEqual(row['Components'],[]);self.assertEqual(D(row['RMRatio']),100)
  inputs.ProcessLosses=[]
  body=CommercialSave(RowVersion=item['RowVersion'],CostInputs=inputs,Prices=body.Prices)
  value,_,_,_=commercial_value(body,item,self.admin,self.cur)
  for row in value['Inputs']['MaterialCosts']:self.assertEqual(row['Components'],[]);self.assertEqual(D(row['RMRatio']),100)
 def test_approval_keeps_defaults_without_forcing_an_unselected_seasoning_component(self):
  self.setup_recipe()
  value=obj(self.source['TCBCostInfo']);value['Inputs']['ProcessLosses']=[]
  self.cur.execute('UPDATE dbo.OpportunityItem SET TCBCostInfo=? WHERE ID=?',json.dumps(value),self.source['OpportunityItemID'])
  pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=self.sheet['RowVersion'],Action='Submit'),self.admin)['row']
  api.sheet_review(self.sheet['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Approve'),self.admin)
  value=obj(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'])
  self.assertEqual(value['NPDRecipe']['SheetID'],self.sheet['ID']);self.assertEqual(D(value['NPDRecipe']['SeasoningRatio']),5)
  self.assertEqual(value['Inputs']['Components'],[])
  for row in value['Inputs']['MaterialCosts']:self.assertEqual(row['Components'],[]);self.assertEqual(D(row['RMRatio']),100)
 def test_product_grade_version_flag_is_inherited_by_opportunity_snapshot(self):
  from product_grades_api import save as save_grades
  from product_grades import GradeSave,GradeItem
  from opportunity_grade_snapshot import product_snapshot
  from db import bytes_to_b64
  product=self.row('Product',self.source['ProductID'])
  fields=set(GradeItem.model_fields)
  items=[{k:v for k,v in row.items() if k in fields} for row in obj(self.source['ProductGradeSnapshot'])['items']]
  for row in items:row['ParentID']=row['ParentID'].replace('\\/','/')
  result=save_grades(GradeSave(ProductRowVersion=product['RowVersion'],Status='Active',RequiresRecipeConfirmation=True,items=items),self.source['ProductID'],self.admin)
  self.assertTrue(self.row('ProductGradeVersion',result['ID'])['RequiresRecipeConfirmation'])
  self.assertTrue(product_snapshot(self.source['ProductID'],self.admin)['RequiresRecipeConfirmation'])
  self.cur.execute("UPDATE dbo.OpportunityItem SET ProductGradeSnapshot=JSON_MODIFY(ProductGradeSnapshot,'$.RequiresRecipeConfirmation',NULL) WHERE ID=?",self.source['OpportunityItemID'])
  self.assertTrue(obj(self.row('OpportunityItem',self.source['OpportunityItemID'])['ProductGradeSnapshot'])['RequiresRecipeConfirmation'])
 def test_request_captures_opportunity_requirements_instead_of_client_override(self):
  self.setup_recipe();self.assertEqual(self.item['LaunchingDate'],'2027-01-01');self.assertEqual(self.item['SpecialComments'],'Recipe requirements retained')
 def test_sql_blocks_recipe_requirement_changes_while_linked(self):
  self.setup_recipe()
  with self.assertRaisesRegex(Exception,'locked by a linked Recipe Request'):
   self.cur.execute("UPDATE dbo.OpportunityItem SET ProductGradeSnapshot=JSON_MODIFY(ProductGradeSnapshot,'$.RecipeRequirements.SpecialComments','Changed') WHERE ID=?",self.source['OpportunityItemID'])
 def test_sql_blocks_grade_changes_while_linked(self):
  self.setup_recipe()
  with self.assertRaisesRegex(Exception,'locked by a linked Recipe Request'):
   self.cur.execute("UPDATE dbo.OpportunityItem SET ProductGradeSnapshot=JSON_MODIFY(ProductGradeSnapshot,'$.items[0].RatioPct',59) WHERE ID=?",self.source['OpportunityItemID'])
 def test_closing_link_releases_requirements(self):
  self.setup_recipe();item=self.row('NPDRecipeRequestItem',self.item['ID'])
  api.close_item(item['ID'],api.CloseItem(RowVersion=item['RowVersion'],Comment='Revise recipe requirements'),self.admin)
  self.cur.execute("UPDATE dbo.OpportunityItem SET ProductGradeSnapshot=JSON_MODIFY(ProductGradeSnapshot,'$.RecipeRequirements.SpecialComments','Changed') WHERE ID=?",self.source['OpportunityItemID'])
  self.assertFalse(self.row('NPDRecipeRequestItem',item['ID'])['IsLinked'])
 def test_semantically_unchanged_grade_json_is_allowed(self):
  self.setup_recipe();snapshot=obj(self.source['ProductGradeSnapshot'])
  self.cur.execute('UPDATE dbo.OpportunityItem SET ProductGradeSnapshot=? WHERE ID=?',json.dumps(snapshot,indent=2),self.source['OpportunityItemID'])
 def test_process_mapping_and_custom_component_master(self):
  component=save_component(ComponentSave(ComponentName='QA spice '+uuid4().hex),self.admin)['row']
  process=save_process(LossMasterSave(ProcessType='QA coating '+uuid4().hex,ComponentIDs=[component['ID']]),self.admin)['rows'][0]
  config=catalog(self.cur);self.assertIn({'ProcessID':process['ID'],'ComponentID':component['ID']},config['mappings'])
  master=next(m for m in active_loss_masters(self.admin) if m['MasterID']==process['ID'])
  self.assertEqual(json.loads(master['RecipeComponents'])[0]['ID'],component['ID'])
  from loss_process_api import read
  listing=read(page=1,page_size=25,search=process['ProcessType'],status='',sort='[]',ctx=self.admin)
  self.assertEqual(listing['rows'][0]['ComponentNames'],component['ComponentName'])
  recipe={'ComponentID':component['ID'],'SystemKey':component['SystemKey'],'ComponentName':component['ComponentName'],'USDPerLb':2,'RatioPct':5}
  inputs=Inputs(RMRatio=95,Components=[recipe],ProcessLosses=[{'Path':'0/1','Codes':[{'MasterID':process['ID'],'ProcessName':process['ProcessType']}],'Ratios':[0]}])
  validate_assignments(inputs,{},config)
  with self.assertRaisesRegex(ValueError,'not configured'):validate_assignments(Inputs(RMRatio=95,Components=[recipe]),{},config)
 def test_seasoning_loss_defaults_process_without_repricing_seasoning(self):
  self.setup_recipe();source=self.row('OpportunityItem',self.source['OpportunityItemID']);value=obj(source['TCBCostInfo'])
  master=next(m for m in active_loss_masters(self.admin) if m['ProcessName']=='Seasoning')
  value['Inputs'].update(ProcessLosses=[{'Path':'0/1','Codes':[{'MasterID':master['MasterID'],'MasterVersion':master['MasterVersion'],'ProcessName':'Seasoning'}],'Ratios':['0']}],ProcessLossMode='GradePath',ProcessLossLayout='Aligned',ProcessLossFormulas={})
  self.cur.execute('UPDATE dbo.OpportunityItem SET TCBCostInfo=? WHERE ID=?',json.dumps(value),self.source['OpportunityItemID'])
  saved=api.sheet_save(self.sheet['ID'],api.SheetSave(RowVersion=self.sheet['RowVersion'],Status='Price Ready',SeasoningLossPct='2.5',Lines=[RecipeLine(**r) for r in self.saved['lines']]),self.admin)['row']
  pending=api.sheet_review(saved['ID'],api.Review(RowVersion=saved['RowVersion'],Action='Submit'),self.admin)['row']
  api.sheet_review(saved['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Approve'),self.admin)
  value=obj(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'])
  self.assertEqual(D(value['Inputs']['ProcessLosses'][0]['Ratios'][0]),D('0.56'))
  recipe=next(r for r in value['Inputs']['MaterialCosts'] if r['Path']=='0/1')
  self.assertEqual(D(recipe['SeasoningUSDPerLb']),D('0.226796'))
  self.assertEqual(recipe['SeasoningCostBasis'],'FinishedProduct')
  for row in value['Inputs']['MaterialCosts']:
   if row['Path']!='0/1':self.assertEqual(D(row['SeasoningRatio']),0)

if __name__=='__main__':unittest.main()
