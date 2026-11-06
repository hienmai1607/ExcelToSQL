"""Current-schema NPD integration: every business write rolls back.

Run explicitly against the desktop test DB after migration 154:
 python tests/python/npd_desktop_contract.py
"""
import sys,json,unittest
from pathlib import Path
from uuid import uuid4
from datetime import date
from decimal import Decimal
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'core'))
from db import engine,reuse_transaction
from auth import AccessContext
from fastapi import HTTPException
import npd_api as api
from npd_recipes import RecipeLine,raw_grades,obj,awarded_mt

class Desktop(unittest.TestCase):
 def setUp(self):
  self.connection=engine.raw_connection();self.cur=self.connection.cursor()
  assert self.cur.execute('SELECT DB_NAME()').fetchval()=='test','Desktop integration is restricted to test.'
  self.cur.execute('BEGIN TRANSACTION');self.context=reuse_transaction(self.connection);self.context.__enter__()
  user=self.cur.execute("SELECT TOP(1) u.ID,u.UserName FROM dbo.Users u JOIN dbo.UserAccess a ON a.UserID=u.ID WHERE a.Scope='Admin' AND u.IsActive=1 ORDER BY u.ID").fetchone()
  self.admin=AccessContext(user[0],user[1],frozenset({'Admin'}))
  self.source=api.one(self.cur,'SELECT TOP(1) '+api.OPPORTUNITY_SELECT+' '+api.OPPORTUNITY_SOURCE+" WHERE i.Stage='Draft' AND o.Stage='Draft' AND p.IsMix=0 AND i.ProductGradeSnapshot IS NOT NULL AND i.ProductNetWeightGrams>0 AND i.EstPctAwarded>0 AND i.AnnualUnit>0 AND NOT EXISTS(SELECT 1 FROM dbo.NPDRecipeRequestItem r WHERE r.OpportunityItemID=i.ID AND IsLinked=1) ORDER BY i.ID DESC")
  self.original=self.source['TCBCostInfo'];self.original_grade=self.source['ProductGradeSnapshot']
  snapshot=obj(self.source['ProductGradeSnapshot']);snapshot['RequiresRecipeConfirmation']=True
  snapshot['RecipeRequirements']={'LaunchingDate':'2027-01-01','SpecialComments':'Recipe requirements retained'}
  self.cur.execute('UPDATE dbo.OpportunityItem SET ProductGradeSnapshot=? WHERE ID=?',json.dumps(snapshot),self.source['OpportunityItemID'])
  self.source=api.one(self.cur,'SELECT '+api.OPPORTUNITY_SELECT+' '+api.OPPORTUNITY_SOURCE+' WHERE i.ID=?',self.source['OpportunityItemID'])
  self.original_grade=self.source['ProductGradeSnapshot']
 def tearDown(self):
  self.cur.execute('IF @@TRANCOUNT>0 ROLLBACK TRANSACTION');self.context.__exit__(None,None,None);self.cur.close();self.connection.close()
 def row(self,table,identity):return api.one(self.cur,'SELECT * FROM dbo.'+table+' WHERE ID=?',identity)
 def setup_recipe(self):
  lookup=api.lookups(self.admin);unit=next(u for u in lookup['units'] if u['UoMCode'].lower()=='kg')
  self.ingredient=api.ingredient_save(api.Ingredient(Description='QA rollback seasoning '+str(uuid4()),Origin='Vietnam',BaseUoMID=unit['ID']),self.admin)['row']
  vendor=lookup['vendors'][0]['ID'];currency=next(c['ID'] for c in lookup['currencies'] if c['CurrencyCode']=='USD')
  quantity=awarded_mt(self.source)*1000000*Decimal('.05')/Decimal(1000)
  self.price=api.price_save(api.Price(IngredientID=self.ingredient['ID'],VendorID=vendor,CurrencyID=currency,UnitPrice='10',PriceUoMID=unit['ID'],QuantityFrom=quantity,EffectiveFrom=date(2020,1,1)),self.admin)['row']
  body=api.RecipeRequest(CreationKey=uuid4(),RequestDue=date(2026,12,1),RequestNote='Owned rollback test',Items=[api.RequestLine(OpportunityItemID=self.source['OpportunityItemID'],RowVersion=self.source['RowVersion'],LaunchingDate=date(2027,1,1),SpecialComments='Recipe requirements retained')])
  self.request=api.request_create(body,self.admin)['row'];replay=api.request_create(body,self.admin)
  self.assertTrue(replay['replayed']);self.assertEqual(replay['row']['ID'],self.request['ID'])
  item=api.request_items(self.request['ID'],self.admin)['rows'][0]
  self.assertEqual(item['SpecialComments'],'Recipe requirements retained')
  item=api.assign(item['ID'],api.Assignment(RowVersion=item['RowVersion'],PICUserID=self.admin.user_id),self.admin)['row']
  self.item=item
  self.sheet=api.sheet_create(item['ID'],api.NewSheet(CreationKey=uuid4(),RowVersion=item['RowVersion']),self.admin)['row']
  roots=raw_grades(item['GradeSnapshot'])
  lines=[RecipeLine(Kind='Raw',GradePath=g['GradePath'],RatioPct=Decimal(g['RatioPct'])*Decimal('.95')) for g in roots]
  lines.append(RecipeLine(Kind='Seasoning',IngredientID=self.ingredient['ID'],RatioPct=5,LossPct=10))
  self.saved=api.sheet_save(self.sheet['ID'],api.SheetSave(RowVersion=self.sheet['RowVersion'],Status='Price Ready',Lines=lines),self.admin)
  self.sheet=self.saved['row']
  self.assertEqual(Decimal(self.sheet['ExchangeRateVNDPerUSD']),Decimal(self.source['ExchangeRateVNDPerUSD']))
 def test_full_flow_publishes_only_after_approval_and_keeps_grades(self):
  self.setup_recipe()
  self.assertEqual(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'],self.original)
  pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=self.sheet['RowVersion'],Action='Submit'),self.admin)['row']
  self.assertEqual(pending['ApprovalStatus'],'Pending')
  self.assertEqual(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'],self.original)
  approved=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Approve'),self.admin)['row']
  self.assertEqual(approved['ApprovalStatus'],'Approved')
  linked=self.row('OpportunityItem',self.source['OpportunityItemID']);value=obj(linked['TCBCostInfo'])
  self.assertEqual(linked['ProductGradeSnapshot'],self.original_grade)
  self.assertEqual(value['NPDRecipe']['SheetID'],self.sheet['ID'])
  if obj(self.original).get('ProductUSDPerLb') is not None:self.assertIsNotNone(value.get('ProductUSDPerLb'),'Approved recipe must preserve a complete raw-cost calculation.')
  self.assertEqual(Decimal(value['NPDRecipe']['SeasoningRatio']),5)
  self.assertAlmostEqual(Decimal(value['NPDRecipe']['SeasoningUSDPerLb']),Decimal('0.226796'),places=6)
  for recipe in value['Inputs'].get('MaterialCosts') or []:self.assertEqual(Decimal(recipe['SeasoningRatio']),0)
  self.assertFalse(self.row('NPDRecipeRequestItem',self.item['ID'])['IsOpen'])
  versions=api.query(self.cur,'SELECT SavedJSON FROM dbo.OpportunityTCBVersion WHERE ItemID=? AND IsActive=1',self.source['OpportunityItemID'])
  if versions:self.assertEqual(obj(versions[0]['SavedJSON'])['NPDRecipe']['SheetID'],self.sheet['ID'])
 def test_opportunity_recipe_links_follow_approved_publication_only(self):
  from opportunity_views import sorted_grid
  self.setup_recipe()
  def linked(drafts=False):
   rows=sorted_grid(self.admin.username,1,200,'[]',opportunity_number=self.source['OpportunityNumber'],can_read_recipe_drafts=drafts)['rows']
   return next(r for r in rows if r['ItemID']==self.source['OpportunityItemID'])
  request=api.request_read(self.request['ID'],self.admin)['row']
  self.assertEqual(request['RequestNumber'],self.request['RequestNumber']);self.assertEqual(request['RequestedByName'],self.admin.username)
  working=linked(True);public=linked()
  self.assertEqual(working['RecipeRequestID'],self.request['ID']);self.assertEqual(working['RecipeRequestItemID'],self.item['ID'])
  self.assertIsNone(working['RecipeSheetID']);self.assertIsNone(working['RecipeSheetNumber'])
  self.assertIsNone(public['RecipeSheetID']);self.assertIsNone(public['RecipeSheetNumber'])
  with self.assertRaises(HTTPException) as error:api.request_read(-1,self.admin)
  self.assertEqual(error.exception.status_code,404)
  denied=AccessContext(self.admin.user_id,self.admin.username,frozenset({'Opportunity'}),{'recipe-requests':'none'})
  with self.assertRaises(HTTPException) as error:api.request_read(self.request['ID'],denied)
  self.assertEqual(error.exception.status_code,403)
  pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=self.sheet['RowVersion'],Action='Submit'),self.admin)['row']
  self.assertIsNone(linked()['RecipeSheetID'])
  api.sheet_review(self.sheet['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Approve'),self.admin)
  self.assertEqual(linked()['RecipeSheetID'],self.sheet['ID'])
  item=self.row('NPDRecipeRequestItem',self.item['ID'])
  revision=api.sheet_create(item['ID'],api.NewSheet(CreationKey=uuid4(),RowVersion=item['RowVersion']),self.admin)['row']
  self.assertEqual(linked(True)['RecipeSheetID'],self.sheet['ID']);self.assertEqual(linked()['RecipeSheetID'],self.sheet['ID'])
 def test_recipe_request_layout_filters_sort_and_profile_roundtrip(self):
  from preferences_api import Settings,PreferenceWrite,save_preferences,read_preferences
  from npd_views import HEADERS
  self.setup_recipe()
  args=dict(page=1,page_size=1,search=self.request['RequestNumber'],ctx=self.admin,status='',created_by='',assigned_to='',sort='[]')
  result=api.request_list(**args)
  self.assertEqual(result['total'],1);self.assertEqual(result['rows'][0]['ID'],self.request['ID']);self.assertEqual(result['rows'][0]['AssignedToMe'],1)
  for column in HEADERS:
   self.assertEqual(api.request_list(**{**args,'sort':json.dumps([{'column':column,'direction':'asc'}])})['rows'][0]['ID'],self.request['ID'])
  self.assertEqual(api.request_list(**{**args,'page':2})['rows'],[])
  for patch in ({'created_by':'not-a-user'},{'assigned_to':'not-a-user'},{'status':'Closed'},{'search':"x';--"}):self.assertEqual(api.request_list(**{**args,**patch})['total'],0)
  self.assertEqual(api.request_list(**{**args,'created_by':self.admin.username,'assigned_to':self.admin.username,'status':'Open'})['total'],1)
  for sort in ('{}','[{"column":"Password","direction":"asc"}]','[{"column":"Status","direction":"DROP"}]','[{"column":"Status","direction":"asc"},{"column":"Status","direction":"desc"}]'):
   with self.assertRaises(HTTPException):api.request_list(**{**args,'sort':sort})
  prior=read_preferences(self.admin)
  layout={'header':{'columns':['RequestNumber','ItemCount','CustomerName'],'filters':['status','assigned_to'],'values':{'status':'Open','assigned_to':self.admin.username},'sort':[{'column':'RequestedAt','direction':'desc'}],'page_size':5},'items':{'columns':['Review','ProductCode','PIC'],'filters':['pic'],'values':{'pic':self.admin.username},'sort':[{'column':'EstimatedAwardedMT','direction':'asc'}],'page_size':10}}
  settings=Settings.model_validate({**prior['settings'],'recipe_requests':layout})
  save_preferences(PreferenceWrite(settings=settings,version=prior['version']),self.admin)
  self.assertEqual(read_preferences(self.admin)['settings']['recipe_requests'],settings.recipe_requests.model_dump())
  for patch in ({'columns':['ItemCount']},{'columns':['RequestNumber','ItemCount','Password']},{'filters':['pic']},{'filters':['status','status']},{'values':{'status':'Bad'}},{'column_widths':{'Password':120}},{'sort':[{'column':'Password','direction':'asc'}]}):
   with self.assertRaises(ValueError):Settings.model_validate({'recipe_requests':{'header':{**layout['header'],**patch}}})
 def test_recipe_version_metadata_retains_original_pic(self):
  self.setup_recipe()
  version=api.request_items(self.request['ID'],self.admin)['rows'][0]['SheetVersions'][0]
  self.assertEqual(version['PIC'],self.admin.username)
  self.assertEqual(version['CreatedAt'][:26],self.sheet['CreatedAt'][:26])
  self.assertEqual(version['UpdatedAt'][:26],self.sheet['UpdatedAt'][:26])
  self.cur.execute('UPDATE dbo.NPDRecipeRequestItem SET PICUserID=NULL WHERE ID=?',self.item['ID'])
  version=api.request_items(self.request['ID'],self.admin)['rows'][0]['SheetVersions'][0]
  self.assertEqual(version['PIC'],self.admin.username)
 def test_recipe_version_history_keeps_approved_link_until_new_approval(self):
  from opportunity_views import sorted_grid
  self.setup_recipe()
  def linked():
   rows=sorted_grid(self.admin.username,1,200,'[]',opportunity_number=self.source['OpportunityNumber'],can_read_recipe_drafts=True)['rows']
   return next(r for r in rows if r['ItemID']==self.source['OpportunityItemID'])['RecipeSheetID']
  reader=AccessContext(self.admin.user_id,self.admin.username,frozenset({'Opportunity'}),{'recipe-sheets':'display','recipe-requests':'display'})
  def history(ctx=self.admin):return api.request_items(self.request['ID'],ctx)['rows'][0]
  self.assertIsNone(linked());self.assertEqual(len(history()['SheetVersions']),1);self.assertEqual(history(reader)['SheetVersions'],[])
  pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=self.sheet['RowVersion'],Action='Submit'),self.admin)['row']
  approved=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Approve'),self.admin)['row']
  original_json=approved['CalculationJSON']
  item=self.row('NPDRecipeRequestItem',self.item['ID'])
  revision=api.sheet_create(item['ID'],api.NewSheet(CreationKey=uuid4(),RowVersion=item['RowVersion']),self.admin)['row']
  self.assertEqual(linked(),approved['ID']);self.assertEqual(history()['ApprovedSheetID'],approved['ID'])
  self.assertEqual([s['Revision'] for s in history()['SheetVersions']],[2,1]);self.assertEqual([s['IsCurrentApproved'] for s in history()['SheetVersions']],[False,True])
  self.assertEqual([s['ID'] for s in history(reader)['SheetVersions']],[approved['ID']])
  denied=AccessContext(self.admin.user_id,self.admin.username,frozenset({'Opportunity'}),{'recipe-requests':'display','recipe-sheets':'none'})
  self.assertEqual(history(denied)['SheetVersions'],[])
  saved=api.sheet_save(revision['ID'],api.SheetSave(RowVersion=revision['RowVersion'],Status='Price Ready',Lines=[RecipeLine(**r) for r in self.saved['lines']]),self.admin)['row']
  pending=api.sheet_review(saved['ID'],api.Review(RowVersion=saved['RowVersion'],Action='Submit'),self.admin)['row']
  self.assertEqual(linked(),approved['ID'])
  returned=api.sheet_review(saved['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Return',Comment='Revise'),self.admin)['row']
  self.assertEqual(linked(),approved['ID']);self.assertEqual(history()['SheetVersions'][0]['ApprovalStatus'],'Returned')
  pending=api.sheet_review(saved['ID'],api.Review(RowVersion=returned['RowVersion'],Action='Submit'),self.admin)['row']
  api.sheet_review(saved['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Approve'),self.admin)
  self.assertEqual(linked(),saved['ID']);self.assertEqual([s['IsCurrentApproved'] for s in history()['SheetVersions']],[True,False])
  self.assertEqual(api.sheet_read(approved['ID'],reader)['row']['CalculationJSON'],original_json)
 def test_recipe_sheet_filters_sort_pagination_and_public_access(self):
  self.setup_recipe()
  args=dict(page=1,page_size=1,search=self.sheet['SheetNumber'],ctx=self.admin,pic=self.admin.username,status='Price Ready',sort='[{"column":"PIC","direction":"asc"}]')
  result=api.sheet_list(**args)
  self.assertEqual(result['total'],1);self.assertEqual(result['rows'][0]['ID'],self.sheet['ID'])
  for column in ('SheetNumber','RequestNumber','ProductCode','ProductName','PIC','Status','ApprovalStatus','Revision','ApprovedByName'):
   self.assertEqual(api.sheet_list(**{**args,'sort':json.dumps([{'column':column,'direction':'desc'}])})['rows'][0]['ID'],self.sheet['ID'])
  self.assertEqual(api.sheet_list(**{**args,'page':2})['total'],1);self.assertEqual(api.sheet_list(**{**args,'page':2})['rows'],[])
  for patch in ({'pic':"nobody';--"},{'status':'Draft'},{'status':'Approved'}):self.assertEqual(api.sheet_list(**{**args,**patch})['total'],0)
  for invalid in ('{}','[{"column":"Password","direction":"asc"}]','[{"column":"PIC","direction":"DROP"}]'):
   with self.assertRaises(HTTPException) as error:api.sheet_list(**{**args,'sort':invalid})
   self.assertEqual(error.exception.status_code,422)
  reader=AccessContext(self.admin.user_id,self.admin.username,frozenset({'Opportunity'}),{'recipe-sheets':'display'})
  self.assertEqual(api.sheet_list(**{**args,'ctx':reader})['total'],0)
  pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=self.sheet['RowVersion'],Action='Submit'),self.admin)['row']
  self.assertEqual(api.sheet_list(**{**args,'status':'Pending'})['total'],1)
  self.assertEqual(api.sheet_list(**{**args,'ctx':reader,'status':'Pending'})['total'],0)
  api.sheet_review(self.sheet['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Approve'),self.admin)
  self.assertEqual(api.sheet_list(**{**args,'ctx':reader,'status':'Approved'})['total'],1)
 def test_opportunity_recipe_branch_tracks_review_without_changing_opportunity(self):
  from opportunity_views import sorted_grid
  self.setup_recipe()
  def progress(drafts=True):
   rows=sorted_grid(self.admin.username,1,200,'[]',opportunity_number=self.source['OpportunityNumber'],can_read_recipe_drafts=drafts)['rows']
   row=next(r for r in rows if r['ItemID']==self.source['OpportunityItemID'])
   return json.loads(row['StageSummaryJSON'])['Recipe']
  self.assertEqual(progress()['State'],'Assigned');self.assertEqual(progress()['PIC'],self.admin.username);self.assertTrue(progress()['RequestedAt'])
  pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=self.sheet['RowVersion'],Action='Submit'),self.admin)['row']
  self.assertEqual(progress()['State'],'Submitted');self.assertTrue(progress()['SubmittedAt']);self.assertFalse(progress()['Reviewed'])
  api.sheet_review(self.sheet['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Return',Comment='Private review detail'),self.admin)
  self.assertEqual(progress()['State'],'Returned');self.assertTrue(progress()['ReviewedAt']);self.assertEqual(progress()['ReviewedBy'],self.admin.username)
  self.assertEqual(progress()['Reason'],'Private review detail');self.assertNotIn('Reason',progress(False))
  self.assertEqual(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'],self.original)
 def test_submitted_item_exposes_review_state_and_blocks_pic_until_returned(self):
  self.setup_recipe()
  pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=self.sheet['RowVersion'],Action='Submit'),self.admin)['row']
  item=api.request_items(self.request['ID'],self.admin)['rows'][0]
  self.assertEqual(item['Status'],'Submitted');self.assertEqual(item['LatestSheetApprovalStatus'],'Pending');self.assertEqual(item['LatestSheetID'],self.sheet['ID']);self.assertFalse(item['CanAssignPIC'])
  with self.assertRaisesRegex(HTTPException,'Return the submitted sheet'):api.assign(item['ID'],api.Assignment(RowVersion=item['RowVersion'],PICUserID=self.admin.user_id),self.admin)
 def test_returned_item_allows_pic_reassignment(self):
  self.setup_recipe()
  pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=self.sheet['RowVersion'],Action='Submit'),self.admin)['row']
  api.sheet_review(self.sheet['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Return',Comment='Revise recipe'),self.admin)
  item=api.request_items(self.request['ID'],self.admin)['rows'][0]
  self.assertEqual(item['Status'],'Returned');self.assertTrue(item['CanAssignPIC'])
  assigned=api.assign(item['ID'],api.Assignment(RowVersion=item['RowVersion'],PICUserID=self.admin.user_id),self.admin)['row']
  self.assertEqual(assigned['PICUserID'],self.admin.user_id)
 def test_approved_item_keeps_pic_and_separate_approver_and_blocks_reassignment(self):
  self.setup_recipe()
  pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=self.sheet['RowVersion'],Action='Submit'),self.admin)['row']
  api.sheet_review(self.sheet['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Approve'),self.admin)
  item=api.request_items(self.request['ID'],self.admin)['rows'][0]
  self.assertEqual(item['Status'],'Approved');self.assertFalse(item['CanAssignPIC']);self.assertEqual(item['PIC'],self.admin.username);self.assertEqual(item['LatestSheetApprovedByName'],self.admin.username)
  with self.assertRaisesRegex(HTTPException,'approved request items cannot be reassigned'):api.assign(item['ID'],api.Assignment(RowVersion=item['RowVersion'],PICUserID=self.admin.user_id),self.admin)
 def review_manager(self):
  user=self.cur.execute('SELECT TOP(1) ID,UserName FROM dbo.Users WHERE IsActive=1 AND ID<>? ORDER BY ID',self.admin.user_id).fetchone()
  self.assertIsNotNone(user,'Need another active desktop user for manager ownership tests')
  return AccessContext(user[0],user[1],frozenset({'NPDManager'}),{'recipe-requests':'edit','recipe-sheets':'edit'})
 def changed_recipe(self,pending):
  lines=[RecipeLine(**r) for r in self.saved['lines']]
  lines[-1].PriceID=None;lines[-1].PriceMode='Direct';lines[-1].DirectPricePerKg=Decimal(20);lines[-1].DirectPriceCurrency='USD';lines[-1].Note='Manager changed price'
  return api.SheetSave(RowVersion=pending['RowVersion'],Status='Final',ExchangeRateVNDPerUSD='25000',Lines=lines)
 def test_manager_saves_pending_changes_without_publishing_or_changing_pic(self):
  self.setup_recipe();manager=self.review_manager()
  pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=self.sheet['RowVersion'],Action='Submit'),self.admin)['row']
  saved=api.sheet_save(self.sheet['ID'],self.changed_recipe(pending),manager)
  self.assertEqual(saved['row']['ApprovalStatus'],'Pending');self.assertEqual(saved['row']['Status'],'Final');self.assertEqual(saved['row']['SubmittedBy'],pending['SubmittedBy']);self.assertEqual(saved['row']['UpdatedBy'],manager.user_id)
  self.assertEqual(self.row('NPDRecipeRequestItem',self.item['ID'])['PICUserID'],self.admin.user_id)
  self.assertEqual(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'],self.original)
  preview=api.sheet_preview(self.sheet['ID'],api.SheetSave(RowVersion=saved['row']['RowVersion'],Status='Final',Lines=[RecipeLine(**r) for r in saved['lines']]),manager)
  self.assertEqual(Decimal(preview['calculation']['SeasoningUSDPerLb']),Decimal('.45359237'))
  api.sheet_review(self.sheet['ID'],api.Review(RowVersion=saved['row']['RowVersion'],Action='Approve'),manager)
  self.assertEqual(self.row('NPDRecipeSheet',self.sheet['ID'])['ApprovedBy'],manager.user_id)
 def test_manager_modifies_and_approves_atomically_with_final_values(self):
  self.setup_recipe();manager=self.review_manager()
  pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=self.sheet['RowVersion'],Action='Submit'),self.admin)['row']
  result=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Approve',Comment='Approved changes',Changes=self.changed_recipe(pending)),manager)['row']
  self.assertEqual(result['ApprovalStatus'],'Approved');self.assertEqual(result['ApprovedBy'],manager.user_id);self.assertEqual(result['Status'],'Final');self.assertEqual(result['ReviewComment'],'Approved changes')
  self.assertEqual(Decimal(result['ExchangeRateVNDPerUSD']),25000);self.assertEqual(obj(result['LinesJSON'])[-1]['Note'],'Manager changed price')
  item=self.row('NPDRecipeRequestItem',self.item['ID']);self.assertEqual(item['PICUserID'],self.admin.user_id);self.assertEqual(item['ActiveSheetID'],self.sheet['ID']);self.assertFalse(item['IsOpen'])
  published=obj(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo']);self.assertEqual(Decimal(published['NPDRecipe']['SeasoningUSDPerLb']),Decimal('.45359237'));self.assertEqual(published['NPDRecipe']['ApprovedBy'],manager.username)
 def test_submitted_pic_cannot_save_changes_without_manager_permission(self):
  self.setup_recipe();pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=self.sheet['RowVersion'],Action='Submit'),self.admin)['row']
  member=AccessContext(self.admin.user_id,self.admin.username,frozenset({'NPD'}),{'recipe-sheets':'edit','recipe-requests':'display'})
  with self.assertRaisesRegex(HTTPException,'edit access'):api.sheet_save(self.sheet['ID'],self.changed_recipe(pending),member)
 def test_manager_cannot_approve_invalid_modified_recipe(self):
  self.setup_recipe();manager=self.review_manager();pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=self.sheet['RowVersion'],Action='Submit'),self.admin)['row']
  changes=self.changed_recipe(pending);changes.Lines[-1].RatioPct=Decimal(6)
  with self.assertRaisesRegex(HTTPException,'100%'):api.sheet_review(self.sheet['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Approve',Changes=changes),manager)
  self.assertEqual(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'],self.original)
 def test_manager_approval_changes_check_inner_rowversion(self):
  self.setup_recipe();manager=self.review_manager();pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=self.sheet['RowVersion'],Action='Submit'),self.admin)['row']
  changes=self.changed_recipe(pending);changes.RowVersion=self.sheet['RowVersion']
  with self.assertRaises(HTTPException) as error:api.sheet_review(self.sheet['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Approve',Changes=changes),manager)
  self.assertEqual(error.exception.status_code,409)
 def test_exchange_rate_override_is_saved_and_loss_is_server_calculated(self):
  self.setup_recipe()
  vnd=self.cur.execute("SELECT ID FROM dbo.Currency WHERE CurrencyCode='VND'").fetchval()
  self.cur.execute('UPDATE dbo.NPDIngredientPrice SET CurrencyID=?,UnitPrice=265000 WHERE ID=?',vnd,self.price['ID'])
  result=api.sheet_save(self.sheet['ID'],api.SheetSave(RowVersion=self.sheet['RowVersion'],Status='Price Ready',ExchangeRateVNDPerUSD='25000',SeasoningLossPct='99',Lines=[RecipeLine(**r) for r in self.saved['lines']]),self.admin)
  self.assertEqual(Decimal(result['row']['ExchangeRateVNDPerUSD']),25000)
  self.assertEqual(Decimal(result['calculation']['Lines'][-1]['Price']['USDPerKg']),Decimal('10.6'))
  self.assertEqual(Decimal(result['calculation']['Lines'][-1]['Price']['VNDPerKg']),265000)
  self.assertAlmostEqual(Decimal(result['row']['SeasoningLossPct']),Decimal(5)/9,places=10)
  self.assertEqual(api.sheet_read(self.sheet['ID'],self.admin)['row']['ExchangeRateVNDPerUSD'],result['row']['ExchangeRateVNDPerUSD'])
 def test_high_buffer_loss_can_save_but_cannot_submit(self):
  self.setup_recipe();lines=[RecipeLine(**r) for r in self.saved['lines']];lines[-1].LossPct=Decimal(96)
  saved=api.sheet_save(self.sheet['ID'],api.SheetSave(RowVersion=self.sheet['RowVersion'],Status='Price Ready',Lines=lines),self.admin)
  self.assertEqual(Decimal(saved['row']['SeasoningLossPct']),120)
  with self.assertRaisesRegex(HTTPException,'below 100%'):api.sheet_review(self.sheet['ID'],api.Review(RowVersion=saved['row']['RowVersion'],Action='Submit'),self.admin)
  self.assertEqual(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'],self.original)

 def test_direct_price_without_master_survives_reopen_and_approval(self):
  self.setup_recipe()
  self.cur.execute('DELETE dbo.NPDIngredientPrice WHERE ID=?',self.price['ID'])
  lines=[RecipeLine(**r) for r in self.saved['lines']]
  lines[-1].PriceID=None;lines[-1].DirectPricePerKg=Decimal(265000);lines[-1].DirectPriceCurrency='VND'
  result=api.sheet_save(self.sheet['ID'],api.SheetSave(RowVersion=self.sheet['RowVersion'],Status='Price Ready',ExchangeRateVNDPerUSD='26500',Lines=lines),self.admin)
  reopened=api.sheet_read(self.sheet['ID'],self.admin)
  self.assertEqual(reopened['lines'][-1]['DirectPriceCurrency'],'VND')
  self.assertEqual(Decimal(reopened['lines'][-1]['DirectPricePerKg']),265000)
  self.assertEqual(Decimal(result['calculation']['SeasoningUSDPerLb']),Decimal('.226796185'))
  pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=result['row']['RowVersion'],Action='Submit'),self.admin)['row']
  self.assertEqual(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'],self.original)
  api.sheet_review(self.sheet['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Approve'),self.admin)
  approved=obj(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'])
  self.assertEqual(Decimal(approved['NPDRecipe']['SeasoningUSDPerLb']),Decimal('.226796185'))
  self.assertEqual(approved['NPDRecipe']['SeasoningCostBasis'],'FinishedProduct')
 def test_blocked_direct_ingredient_prevents_approval(self):
  self.setup_recipe();lines=[RecipeLine(**r) for r in self.saved['lines']]
  lines[-1].PriceID=None;lines[-1].DirectPricePerKg=Decimal(10);lines[-1].DirectPriceCurrency='USD'
  result=api.sheet_save(self.sheet['ID'],api.SheetSave(RowVersion=self.sheet['RowVersion'],Status='Price Ready',Lines=lines),self.admin)
  pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=result['row']['RowVersion'],Action='Submit'),self.admin)['row']
  self.cur.execute("UPDATE dbo.NPDIngredient SET Status='Block' WHERE ID=?",self.ingredient['ID'])
  with self.assertRaisesRegex(HTTPException,'active ingredient'):api.sheet_review(self.sheet['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Approve'),self.admin)
  self.assertEqual(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'],self.original)

 def test_manual_nut_descriptions_notes_and_costs_are_sheet_only(self):
  self.setup_recipe();lines=[RecipeLine(**r) for r in self.saved['lines']]
  lines[0].IngredientNote='Oil roasted nuts';lines[0].Note='Nuts checked';lines[0].DirectPricePerKg=Decimal(12);lines[0].DirectPriceCurrency='USD';lines[-1].Note='Seasoning note'
  result=api.sheet_save(self.sheet['ID'],api.SheetSave(RowVersion=self.sheet['RowVersion'],Status='Price Ready',Lines=lines),self.admin)
  reopened=api.sheet_read(self.sheet['ID'],self.admin)
  self.assertEqual(reopened['lines'][0]['IngredientNote'],'Oil roasted nuts');self.assertEqual(reopened['lines'][-1]['Note'],'Seasoning note')
  self.assertGreater(Decimal(result['calculation']['CostFGUSDPerKg']),Decimal(result['calculation']['SeasoningUSDPerKg']))
  pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=result['row']['RowVersion'],Action='Submit'),self.admin)['row']
  api.sheet_review(self.sheet['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Approve'),self.admin)
  after=obj(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'])
  self.assertEqual(after.get('PriceSnapshots'),obj(self.original).get('PriceSnapshots'))
 def test_ingredient_grade_nature_is_maintained_in_both_master_and_sheet(self):
  self.setup_recipe();master=self.row('NPDIngredient',self.ingredient['ID'])
  updated=api.ingredient_save(api.Ingredient(ID=master['ID'],RowVersion=master['RowVersion'],Description=master['Description'],Origin='Vietnam',GradeNature='Fine powder',BaseUoMID=master['BaseUoMID']),self.admin)['row']
  self.assertEqual(updated['GradeNature'],'Fine powder')
  result=api.sheet_preview(self.sheet['ID'],api.SheetSave(RowVersion=self.sheet['RowVersion'],Status='Price Ready',Lines=[RecipeLine(**r) for r in self.saved['lines']]),self.admin)['calculation']
  self.assertEqual(result['Lines'][-1]['GradeNature'],'Fine powder');self.assertEqual(result['Lines'][-1]['Origin'],'Vietnam')

 def test_blank_direct_source_is_saved_as_draft_but_blocks_price_ready(self):
  self.setup_recipe();lines=[RecipeLine(**r) for r in self.saved['lines']]
  lines[-1].PriceID=None;lines[-1].PriceMode='Direct';lines[-1].DirectPricePerKg=None;lines[-1].DirectPriceCurrency=None
  draft=api.sheet_save(self.sheet['ID'],api.SheetSave(RowVersion=self.sheet['RowVersion'],Status='Draft',Lines=lines),self.admin)
  self.assertEqual(api.sheet_read(self.sheet['ID'],self.admin)['lines'][-1]['PriceMode'],'Direct')
  self.assertIsNone(draft['calculation']['Lines'][-1]['Price']);self.assertIsNone(draft['calculation']['SeasoningUSDPerLb'])
  with self.assertRaisesRegex(HTTPException,'direct ingredient price'):api.sheet_save(self.sheet['ID'],api.SheetSave(RowVersion=draft['row']['RowVersion'],Status='Price Ready',Lines=lines),self.admin)
 def test_inapplicable_selected_price_keeps_master_details_and_explains_quantity(self):
  self.setup_recipe();required=Decimal(self.saved['calculation']['Lines'][-1]['Price']['RequiredQuantity'])
  self.cur.execute('UPDATE dbo.NPDIngredientPrice SET QuantityFrom=? WHERE ID=?',required+1,self.price['ID'])
  preview=api.sheet_preview(self.sheet['ID'],api.SheetSave(RowVersion=self.sheet['RowVersion'],Status='Draft',Lines=[RecipeLine(**r) for r in self.saved['lines']]),self.admin)['calculation']
  line=preview['Lines'][-1];self.assertEqual(line['SelectedPrice']['ID'],self.price['ID']);self.assertIn('after buffer',line['PriceIssue']);self.assertIsNone(line['Price'])

 def test_return_does_not_publish(self):
  self.setup_recipe();pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=self.sheet['RowVersion'],Action='Submit'),self.admin)['row']
  returned=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Return',Comment='Review seasoning'),self.admin)['row']
  self.assertEqual(returned['ApprovalStatus'],'Returned');self.assertEqual(self.row('OpportunityItem',self.source['OpportunityItemID'])['TCBCostInfo'],self.original)
 def test_changed_quote_blocks_approval_without_publishing(self):
  self.setup_recipe();pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=self.sheet['RowVersion'],Action='Submit'),self.admin)['row']
  self.cur.execute('UPDATE dbo.NPDIngredientPrice SET UnitPrice=11 WHERE ID=?',self.price['ID'])
  with self.assertRaisesRegex(HTTPException,'changed'):api.sheet_review(self.sheet['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Approve'),self.admin)
 def test_approved_sheet_is_immutable(self):
  self.setup_recipe();pending=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=self.sheet['RowVersion'],Action='Submit'),self.admin)['row']
  approved=api.sheet_review(self.sheet['ID'],api.Review(RowVersion=pending['RowVersion'],Action='Approve'),self.admin)['row']
  with self.assertRaisesRegex(HTTPException,'locked'):api.sheet_save(self.sheet['ID'],api.SheetSave(RowVersion=approved['RowVersion'],Status='Draft',Lines=[RecipeLine(**r) for r in self.saved['lines']]),self.admin)
 def test_unassigned_member_cannot_edit_another_pic_sheet(self):
  self.setup_recipe();other=AccessContext(-123,'other.npd',frozenset({'NPD'}),{'recipe-sheets':'edit'})
  with self.assertRaisesRegex(HTTPException,'assigned NPD'):api.owner(other,self.sheet)
 def test_fixed_raw_row_identity_cannot_be_replaced(self):
  self.setup_recipe();lines=[RecipeLine(**r) for r in self.saved['lines']];lines[0].GradePath='0/999'
  with self.assertRaisesRegex(HTTPException,'fixed line'):api.sheet_save(self.sheet['ID'],api.SheetSave(RowVersion=self.sheet['RowVersion'],Status='Price Ready',Lines=lines),self.admin)

if __name__=='__main__':unittest.main()
