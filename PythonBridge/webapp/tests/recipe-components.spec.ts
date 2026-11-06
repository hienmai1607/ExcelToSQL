import {test,expect,type Page} from '@playwright/test';
import {recipeCost} from '../src/tcb-model';
import {changeComponent,displayedComponents,applicableComponents,syncRecipeComponents} from '../src/recipe-components';
import {activeCostInputs} from '../src/tcb-grade-pricing';
import {defaultProcessCode} from '../src/grade-process-loss';
const rv='AAAAAAAAAAE=',version='0x0000000000000001';
const components=[{ID:1,ComponentName:'Salt',SystemKey:'Salt',Status:'Active'},{ID:2,ComponentName:'Oil',SystemKey:'Oil',Status:'Active'},{ID:3,ComponentName:'Seasoning',SystemKey:'Seasoning',Status:'Active'}];
const snapshot={RequiresRecipeConfirmation:false,items:[{ParentID:'0',ID:1,Grade:'Cashews',RatioPct:'100',Process:true,RawGradeID:1}]};
const item={ID:11,ItemID:11,ProductID:2,OpportunityID:1,OpportunityNumber:'OPP-RECIPE',CustomerID:1,CustomerName:'Customer',HeaderStage:'Draft',ItemStage:'Draft',HeaderRowVersion:rv,ItemRowVersion:rv,RowVersion:rv,ItemNumber:'1',ProductCode:'PRD-1',ProductName:'Cashews',ProductGradeSnapshot:JSON.stringify(snapshot),AnnualUnit:1000,WeightGrams:200,CustomerCurrencyCode:'USD',ExchangeRateVNDPerUSD:26500,ExchangeRateCustomerCurrencyPerUSD:1,BidOpen:'2026-11-01',BidClose:'2026-12-01',OpportunityDesc:'Recipe review',PrimaryTypeID:50,PackagingLayerCount:1,ContainerRequest:'40DC'};
const masters=[{MasterID:77,MasterVersion:version,ProcessType:'Processing' as const,ProcessName:'Oil Salted Roasting',Sequence:1,LossPct:'0'},{MasterID:78,MasterVersion:version,ProcessType:'Processing' as const,ProcessName:'Seasoning',Sequence:2,LossPct:'0'}];
const data={item,saved:{Inputs:{RMRatio:'100',SeasoningRatio:'0',OilPct:'0',ProcessingUSDPerLb:'0',Prices:[{Path:'0/1',DirectUSDPerLb:'10'}],ProcessLosses:[{Path:'0/1',Codes:[{MasterID:77,MasterVersion:version,ProcessName:'Oil Salted Roasting'}],Ratios:['0']}]}},recipeComponents:{components,mappings:[{ProcessID:77,ComponentID:1},{ProcessID:77,ComponentID:2},{ProcessID:78,ComponentID:3}]},lossMasters:masters,grades:[{Path:'0/1',Grade:'Cashews',RawGradeID:1,Proportion:'1',ProcessPath:'0/1',ProcessPaths:'["0/1"]'}],prices:[]};
async function setup(page:Page,locked=false,enabled=false){
 let linked=locked;const writes:Record<string,unknown>[]=[];
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Admin',user_id:1,is_admin:true,scopes:['Admin']}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/opportunity/grid')return route.fulfill({json:{rows:[{...item,HasLinkedRecipeRequest:linked,ProductGradeSnapshot:JSON.stringify({...snapshot,RequiresRecipeConfirmation:locked||enabled})}],total:1,page:1}});
  if(path==='/api/npd/opportunity-items')return route.fulfill({json:{rows:[{...item,OpportunityItemID:11,HasLinkedRecipeRequest:linked,LaunchingDate:'2027-02-01',SpecialComments:'Low sodium',EstimatedAwardedMT:'1'}]}});
  if(path==='/api/npd/requests'){writes.push(route.request().postDataJSON());linked=true;return route.fulfill({json:{row:{ID:1,RequestNumber:'RRQ-NEW'}}})}
  if(path.endsWith('/grade-lookups'))return route.fulfill({json:{rows:[{ID:1,GradeName:'Cashews',FinalGrade:true,ParentGradeID:null}],materials:[]}});
  if(path==='/api/opportunity/lookups')return route.fulfill({json:{customers:[{ID:1,CustomerName:'Customer',CustomerCurrencyCode:'USD'}],products:[{ID:2,ProductCode:'PRD-1',ProductName:'Cashews',CustomerID:1,WeightGrams:200}],packagingTypes:[{ID:50,PackagingType:'Pouch',PackagingOrder:'Primary',Status:'Active'}],pallets:[],ports:[]}});
  if(path==='/api/opportunity/items/11/tcb')return route.fulfill({json:data});
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();return writes;
}
test('component ratios reduce RM and contribute once to product price',()=>{
 let values:Record<string,unknown>={Prices:[],ProcessLosses:[],RMRatio:100,SeasoningRatio:0,OilPct:0,ProcessingUSDPerLb:0};
 values=changeComponent(values,components[0],'USDPerLb','2',components);values=changeComponent(values,components[0],'RatioPct','3',components);
 values=changeComponent(values,components[1],'USDPerLb','4',components);values=changeComponent(values,components[1],'RatioPct','2',components);
 expect(values.RMRatio).toBe('95');expect(values).not.toHaveProperty('Prices');expect(values).not.toHaveProperty('ProcessLosses');expect(recipeCost(values,{n:10n,d:1n}).product).toEqual({n:241n,d:25n});
});
test('process mappings select Salt and Oil while approved seasoning supplies its loss default',()=>{
 const draft={row:{...item,NPDRecipeSnapshot:'null',RecipeComponentsSnapshot:JSON.stringify(data.recipeComponents)},grades:snapshot.items,steps:[],costingInputs:data.saved.Inputs};expect(displayedComponents(draft).map(c=>c.SystemKey)).toEqual(['Salt','Oil']);
 draft.row.NPDRecipeSnapshot=JSON.stringify({SheetID:1,SeasoningLossPct:'2.5'});
 expect(defaultProcessCode(draft,'0/1',masters[1]).ratio).toBe('2.5');
});

test('approved seasoning defaults respect TCB six-decimal input precision',()=>{
 for(const [price,expected] of [['0.02293459096597653821138211382','0.022935'],['0.051044546648886792452830188679245283018867924528302','0.051045'],['0.0000001','0'],['0.0000005','0'],['0.0000015','0.000002']]){
  const draft={row:{...item,RecipeComponentsSnapshot:JSON.stringify(data.recipeComponents),NPDRecipeSnapshot:JSON.stringify({SheetID:1,SeasoningRatio:6,SeasoningUSDPerLb:price,SeasoningCostBasis:'FinishedProduct'})},
   grades:snapshot.items,steps:[],costingInputs:{...data.saved.Inputs,ProcessLosses:[{Path:'0/1',Codes:[{MasterID:78,MasterVersion:version,ProcessName:'Seasoning'}],Ratios:['1']}]}};
  const result=syncRecipeComponents(draft);
  expect(result.costingInputs.SeasoningUSDPerLb).toBe(expected);
  expect(result.costingInputs.MaterialCosts?.[0].SeasoningUSDPerLb).toBe(expected);
  expect(result.costingInputs.MaterialCosts?.[0].Components).toEqual([expect.objectContaining({USDPerLb:expected,CostBasis:'FinishedProduct'})]);
 }
});

test('only selected processes expose components, including shared ancestors and no saved-value fallback',()=>{
 const draft={row:{...item,RequiresRecipeConfirmation:true,NPDRecipeSnapshot:JSON.stringify({SheetID:1,SeasoningRatio:5,SeasoningUSDPerLb:'.14'}),RecipeComponentsSnapshot:JSON.stringify(data.recipeComponents)},steps:[],costingInputs:{...data.saved.Inputs,OilPct:2,OilUSDPerLb:4,SeasoningRatio:5,SeasoningUSDPerLb:'.14',ProcessLosses:[]}};
 expect(displayedComponents(draft)).toEqual([]);
 draft.costingInputs.ProcessLosses=[{Path:'0/1',Codes:[{MasterID:77,MasterVersion:version,ProcessName:'Oil Salted Roasting'}],Ratios:['0']}];
 expect([...applicableComponents(draft,'0/1/1')]).toEqual([1,2]);expect([...applicableComponents(draft,'0/2')]).toEqual([]);
 expect(displayedComponents(draft).map(c=>c.SystemKey)).toEqual(['Salt','Oil']);
 const resolved=syncRecipeComponents({...draft,grades:[...snapshot.items,{...snapshot.items[0],ID:2,Grade:'Almonds'}]});
 expect(resolved.costingInputs.MaterialCosts[0]).toMatchObject({Path:'0/1',RMRatio:'98',OilPct:2,SeasoningRatio:'0'});
 expect(resolved.costingInputs.MaterialCosts[1]).toMatchObject({Path:'0/2',RMRatio:'100',OilPct:'0',SeasoningRatio:'0',Components:[]});
 const historical={...draft,row:{...draft.row,InactiveTCBVersion:true},costingInputs:{...draft.costingInputs,ProcessLosses:[]}};
 expect(syncRecipeComponents(historical)).toBe(historical);expect(displayedComponents(historical).map(c=>c.SystemKey)).toEqual(['Oil','Seasoning']);
});

test('TCB switches mapped columns and defaults approved seasoning immediately after process selection',async({page},info)=>{
 await setup(page);
 const approved={SheetID:21,SheetNumber:'RCP-APPROVED',Revision:1,SeasoningRatio:'5',SeasoningUSDPerLb:'.14',SeasoningCostBasis:'FinishedProduct',SeasoningLossPct:'2.5'};
 await page.route('**/api/opportunity/items/11/tcb',route=>route.fulfill({json:{...data,saved:{...data.saved,NPDRecipe:approved}}}));
 await page.getByRole('button',{name:'View details',exact:true}).click();await page.getByRole('button',{name:'TCB Review',exact:true}).click();await page.getByRole('button',{name:'TCB Review for PRD-1 item 11',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'TCB Review',exact:true});
 await expect(dialog.getByRole('columnheader',{name:'Seasoning ($/lbs)',exact:true})).toHaveCount(0);
 await dialog.getByLabel('Oil ($/lbs) 0/1',{exact:true}).fill('4');await dialog.getByLabel('Oil Ratio (%) 0/1',{exact:true}).fill('2');
 await dialog.getByLabel('Process type 0/1 L1 item 11',{exact:true}).selectOption('78');
 await expect(dialog.getByRole('columnheader',{name:'Oil ($/lbs)',exact:true})).toHaveCount(0);await expect(dialog.getByRole('columnheader',{name:'Salt ($/lbs)',exact:true})).toHaveCount(0);
 await expect(dialog.getByLabel('Seasoning ($/lbs) 0/1',{exact:true})).toHaveValue('.14');await expect(dialog.getByLabel('Seasoning Ratio (%) 0/1',{exact:true})).toHaveValue('5');
 await expect(dialog.getByLabel('Process loss 0/1 L1 item 11',{exact:true})).toHaveValue('2.5');await expect(dialog.getByLabel('RM Ratio (%) 0/1',{exact:true})).toHaveText('95');
 await dialog.getByRole('button',{name:'Remove process type 0/1 L1 item 11',exact:true}).click();
 await expect(dialog.getByRole('columnheader',{name:'Seasoning ($/lbs)',exact:true})).toHaveCount(0);await expect(dialog.getByLabel('RM Ratio (%) 0/1',{exact:true})).toHaveText('100');
 await dialog.screenshot({path:info.outputPath('recipe-no-fixed-components.png')});
});
test('TCB displays process components and automatically updates RM',async({page},info)=>{
 await setup(page);await page.getByRole('button',{name:'View details',exact:true}).click();await page.getByRole('button',{name:'TCB Review',exact:true}).click();await page.getByRole('button',{name:'TCB Review for PRD-1 item 11',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'TCB Review',exact:true});
 await expect(dialog.getByRole('columnheader',{name:'Salt ($/lbs)',exact:true})).toBeVisible();await expect(dialog.getByRole('columnheader',{name:'Oil ($/lbs)',exact:true})).toBeVisible();
 await expect(dialog.getByRole('columnheader',{name:'Seasoning ($/lbs)',exact:true})).toHaveCount(0);
 await dialog.getByLabel('Salt ($/lbs) 0/1',{exact:true}).fill('2');await dialog.getByLabel('Salt Ratio (%) 0/1',{exact:true}).fill('3');await expect(dialog.getByLabel('RM Ratio (%) 0/1',{exact:true})).toHaveText('97');
 await dialog.getByLabel('Oil ($/lbs) 0/1',{exact:true}).fill('4');await dialog.getByLabel('Oil Ratio (%) 0/1',{exact:true}).fill('2');await expect(dialog.getByLabel('RM Ratio (%) 0/1',{exact:true})).toHaveText('95');
 await page.screenshot({path:info.outputPath('tcb-recipe-components.png')});
});
test('Opportunity grade snapshot enables compact Recipe requirements and captures fields',async({page},info)=>{
 await setup(page);await page.getByRole('button',{name:'Edit Opportunity OPP-RECIPE',exact:true}).click();
 const opportunity=page.getByRole('dialog',{name:'Edit Opportunity',exact:true});await opportunity.getByRole('button',{name:'Edit Opportunity grade snapshot',exact:true}).click();
 const grades=page.getByRole('dialog',{name:'Product grades',exact:true});await grades.getByLabel('Requires Recipe confirmation',{exact:true}).check();await grades.getByRole('button',{name:'Use grades',exact:true}).click();
 await opportunity.getByText('Recipe requirements',{exact:true}).click();await opportunity.getByLabel('Recipe launching date item 1',{exact:true}).fill('2027-02-01');await opportunity.getByLabel('Recipe special comments item 1',{exact:true}).fill('Low sodium');
 await expect(opportunity.getByLabel('Recipe special comments item 1',{exact:true})).toHaveValue('Low sodium');
 const comments=await opportunity.getByLabel('Recipe special comments item 1',{exact:true}).boundingBox(),launch=await opportunity.getByLabel('Recipe launching date item 1',{exact:true}).boundingBox();expect(comments!.height).toBeLessThanOrEqual(42);expect(Math.abs(comments!.height-launch!.height)).toBeLessThanOrEqual(2);await page.screenshot({path:info.outputPath('compact-recipe-requirements.png')});
});
test('linked Recipe Request protects grade and requirement controls in Opportunity',async({page})=>{
 await setup(page,true);await page.getByRole('button',{name:'Edit Opportunity OPP-RECIPE',exact:true}).click();
 const opportunity=page.getByRole('dialog',{name:'Edit Opportunity',exact:true});await expect(opportunity.getByRole('button',{name:'Edit Opportunity grade snapshot',exact:true})).toHaveCount(0);
 await opportunity.getByText('Recipe requirements',{exact:true}).click();await expect(opportunity.getByLabel('Recipe special comments item 1',{exact:true})).toBeDisabled();
});

test('Opportunity opens linked request and sheet in read-only views without leaving its items',async({page})=>{
 const writes=await setup(page,true);
 const unexpectedWrites:string[]=[];
 await page.route('**/api/opportunity/grid?**',route=>route.fulfill({json:{rows:[{...item,HasLinkedRecipeRequest:true,RecipeRequestID:1,RecipeRequestItemID:11,RecipeRequestNumber:'RRQ-1',RecipeSheetID:21,RecipeSheetNumber:'RCP-1'}],total:1,page:1}}));
 await page.route('**/api/npd/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(route.request().method()!=='GET')unexpectedWrites.push(path);
  if(path.endsWith('/lookups'))return route.fulfill({json:{units:[],vendors:[],currencies:[],ingredients:[],members:[]}});
  if(path==='/api/npd/requests/1')return route.fulfill({json:{row:{ID:1,RequestNumber:'RRQ-1',OpportunityNumber:'OPP-RECIPE',CustomerName:'Customer',RequestedByName:'Sales',RequestDue:'2027-01-15',RequestNote:'Develop low sodium blend'}}});
  if(path==='/api/npd/requests/1/items')return route.fulfill({json:{rows:[{...item,ID:11,IsLinked:true,IsOpen:true,PIC:'npd.member',PICUserID:2,ApprovedSheetID:21,ActiveSheetID:21,ActiveSheetNumber:'RCP-1',LatestSheetID:22,LatestSheetNumber:'RCP-2',LatestSheetApprovalStatus:'Draft',SheetVersions:[{ID:22,Revision:2,SheetNumber:'RCP-2',Status:'Draft',ApprovalStatus:'Draft',IsCurrentApproved:false},{ID:21,Revision:1,SheetNumber:'RCP-1',Status:'Price Ready',ApprovalStatus:'Approved',ApprovedByName:'Manager',IsCurrentApproved:true}],HasWorkingSheet:true,Grades:[{GradePath:'0/1',Description:'Cashews',RatioPct:'100'}]}]}});
  if(path==='/api/npd/sheets/21'||path==='/api/npd/sheets/22')return route.fulfill({json:{row:{...item,ID:path.endsWith('/22')?22:21,SheetNumber:path.endsWith('/22')?'RCP-2':'RCP-1',RequestNumber:'RRQ-1',GradeSnapshot:JSON.stringify(snapshot),PIC:'npd.member',PICUserID:2,Status:'Price Ready',ApprovalStatus:path.endsWith('/22')?'Draft':'Approved',Revision:path.endsWith('/22')?2:1},lines:[{Kind:'Raw',GradePath:'0/1',RatioPct:'100',LossPct:'0'}],calculation:{Lines:[],Issues:[],Warnings:[]}}});
  return route.fulfill({status:404,json:{detail:'Unexpected recipe endpoint'}});
 });
 await page.getByRole('button',{name:'Refresh Opportunities',exact:true}).click();await page.getByRole('button',{name:'View details',exact:true}).click();await page.getByRole('button',{name:'Recipe Request',exact:true}).click();
 const table=page.getByRole('table',{name:'Opportunity Recipe Request items',exact:true});await expect(table.getByRole('columnheader',{name:'Linked Recipe Sheet',exact:true})).toBeVisible();
 await table.getByRole('button',{name:'View Recipe Request RRQ-1 for item 11',exact:true}).click();
 const request=page.getByRole('dialog',{name:'RRQ-1',exact:true});await expect(request.getByText('Note: Develop low sodium blend',{exact:true})).toBeVisible();await expect(request.getByText('npd.member',{exact:true})).toBeVisible();await expect(request.getByRole('button',{name:'Save PIC 11',exact:true})).toHaveCount(0);await expect(request.getByRole('button',{name:'Review Recipe Sheet for PRD-1',exact:true})).toHaveCount(0);
 const versions=request.getByRole('table',{name:'Recipe Sheet versions for PRD-1',exact:true});await expect(versions.locator('tbody tr')).toHaveCount(2);await expect(versions.getByText('Current approved sheet',{exact:true})).toHaveCount(1);await expect(request.getByRole('button',{name:'Open RCP-2',exact:true})).toHaveCount(0);
 await versions.getByRole('button',{name:'View Recipe Sheet RCP-2 version 2',exact:true}).click();const draft=page.getByRole('dialog',{name:'RCP-2',exact:true});await expect(draft.getByLabel('Ratio line 1',{exact:true})).toBeDisabled();await expect(draft.getByRole('button',{name:'Save sheet',exact:true})).toHaveCount(0);await draft.getByRole('button',{name:'Close',exact:true}).click();
 await versions.getByRole('button',{name:'View Recipe Sheet RCP-1 version 1',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'RCP-1',exact:true});await expect(sheet.getByLabel('Ratio line 1',{exact:true})).toBeDisabled();await expect(sheet.getByRole('button',{name:'Approve recipe',exact:true})).toHaveCount(0);await expect(sheet.getByRole('button',{name:'Save changes',exact:true})).toHaveCount(0);
 await sheet.getByRole('button',{name:'Close',exact:true}).click();await expect(request).toBeVisible();await request.getByRole('button',{name:'Close recipe request',exact:true}).click();await expect(table).toBeVisible();
 await table.getByRole('button',{name:'View Recipe Sheet RCP-1 for item 11',exact:true}).click();await expect(sheet.getByLabel('Ratio line 1',{exact:true})).toBeDisabled();await sheet.getByRole('button',{name:'Close',exact:true}).click();await expect(table).toBeVisible();expect(writes).toEqual([]);expect(unexpectedWrites).toEqual([]);
});


test('Opportunity Recipe Request tab creates inline and refreshes the link',async({page},info)=>{
 const writes=await setup(page,false,true);await page.getByRole('button',{name:'View details',exact:true}).click();await page.getByRole('button',{name:'Recipe Request',exact:true}).click();
 await page.getByLabel('Select recipe item 11',{exact:true}).check();await expect(page.getByRole('button',{name:'Create Recipe Request (1)',exact:true})).toBeDisabled();
 const form=page.getByRole('form',{name:'Create Recipe Request',exact:true});await form.getByLabel('Response due',{exact:true}).fill('2027-01-15');await form.getByLabel('Request notes',{exact:true}).fill('Develop low sodium blend');
 const due=await form.getByLabel('Response due',{exact:true}).boundingBox(),notes=await form.getByLabel('Request notes',{exact:true}).boundingBox(),button=await form.getByRole('button',{name:'Create Recipe Request (1)',exact:true}).boundingBox();expect(notes!.height).toBeLessThanOrEqual(42);expect(Math.abs(due!.y-notes!.y)).toBeLessThanOrEqual(2);expect(Math.abs(notes!.y-button!.y)).toBeLessThanOrEqual(2);
 await page.screenshot({path:info.outputPath('inline-recipe-request.png')});await form.getByRole('button',{name:'Create Recipe Request (1)',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'New Recipe Request',exact:true})).toHaveCount(0);await expect(page.getByLabel('Select recipe item 11',{exact:true})).toBeDisabled();expect(writes).toHaveLength(1);expect(writes[0]).toMatchObject({RequestDue:'2027-01-15',RequestNote:'Develop low sodium blend',Items:[{OpportunityItemID:11,RowVersion:rv}]});
});


test('Recipe Request is the only highlighted item tab',async({page})=>{
 await setup(page,false,true);await page.getByRole('button',{name:'View details',exact:true}).click();
 const tabs=page.getByRole('group',{name:'Item field groups',exact:true});
 for(const previous of ['All Fields','Packaging Request','TCB Review']){
  await tabs.getByRole('button',{name:previous,exact:true}).click();await tabs.getByRole('button',{name:'Recipe Request',exact:true}).click();
  await expect(tabs.locator('button[aria-pressed=true]')).toHaveCount(1);await expect(tabs.getByRole('button',{name:'Recipe Request',exact:true})).toHaveAttribute('aria-pressed','true');
 }
});


test('Not require has a separate badge color and cannot be selected',async({page})=>{
 await setup(page);await page.route('**/api/opportunity/grid?**',route=>route.fulfill({json:{rows:[item,{...item,ID:12,ItemID:12,ItemNumber:'2',ProductGradeSnapshot:JSON.stringify({...snapshot,RequiresRecipeConfirmation:true})}],total:1,page:1}}));await page.getByRole('button',{name:'Refresh Opportunities',exact:true}).click();await page.getByRole('button',{name:'View details',exact:true}).click();await page.getByRole('button',{name:'Recipe Request',exact:true}).click();
 const table=page.getByRole('table',{name:'Opportunity Recipe Request items',exact:true});await expect(table.getByText('Not require',{exact:true})).toBeVisible();await expect(table.getByText('Optional',{exact:true})).toHaveCount(0);await expect(page.getByLabel('Select recipe item 11',{exact:true})).toBeDisabled();
 const required=await table.getByText('Required',{exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor),optional=await table.getByText('Not require',{exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor);expect(required).not.toBe(optional);
});

test('inline Recipe Request retries an uncertain response using the same creation key',async({page})=>{
 await setup(page,false,true);const bodies:unknown[]=[];await page.route('**/api/npd/requests',route=>{bodies.push(route.request().postDataJSON());return bodies.length===1?route.fulfill({status:503,json:{detail:'Temporary API error'}}):route.fulfill({json:{row:{ID:1,RequestNumber:'RRQ-RECOVERED'}}})});
 await page.getByRole('button',{name:'View details',exact:true}).click();await page.getByRole('button',{name:'Recipe Request',exact:true}).click();await page.getByLabel('Select recipe item 11',{exact:true}).check();const form=page.getByRole('form',{name:'Create Recipe Request',exact:true});await form.getByLabel('Response due',{exact:true}).fill('2027-01-15');await form.getByLabel('Request notes',{exact:true}).fill('Retain this note');await form.getByRole('button',{name:'Create Recipe Request (1)',exact:true}).click();
 await expect(form.getByLabel('Request notes',{exact:true})).toBeDisabled();await form.getByRole('button',{name:'Retry creation',exact:true}).click();await expect(page.getByText('RRQ-RECOVERED created.',{exact:false})).toBeVisible();expect(bodies).toHaveLength(2);expect(bodies[1]).toEqual(bodies[0]);
});


test('approved finished-product seasoning contribution is added once in both recipe formats',()=>{
 const recipe={RMRatio:95,SeasoningRatio:5,SeasoningUSDPerLb:'.14',SeasoningCostBasis:'FinishedProduct',OilPct:0,ProcessingUSDPerLb:0};
 expect(recipeCost(recipe,{n:10n,d:1n}).product).toEqual({n:241n,d:25n});
 expect(recipeCost({...recipe,Components:[{ComponentID:3,SystemKey:'Seasoning',ComponentName:'Seasoning',RatioPct:5,USDPerLb:'.14',CostBasis:'FinishedProduct'}]},{n:10n,d:1n}).product).toEqual({n:241n,d:25n});
 expect(recipeCost({...recipe,SeasoningCostBasis:'Ingredient'},{n:10n,d:1n}).product).toEqual({n:9507n,d:1000n});
});


test('TCB save retains approved component contribution basis on each grade',()=>{
 const recipe={RMRatio:95,SeasoningRatio:5,SeasoningUSDPerLb:'.14',SeasoningCostBasis:'FinishedProduct',OilPct:0,ProcessingUSDPerLb:0,Components:[{ComponentID:3,SystemKey:'Seasoning',ComponentName:'Seasoning',RatioPct:5,USDPerLb:'.14',CostBasis:'FinishedProduct'}]};
 const inputs=activeCostInputs({grades:snapshot.items,quoteGrades:data.grades,selections:[],costingInputs:{...recipe,Prices:[]}});
 expect(inputs.MaterialCosts[0].SeasoningCostBasis).toBe('FinishedProduct');expect(inputs.MaterialCosts[0].Components).toEqual(recipe.Components);
 expect(recipeCost(inputs.MaterialCosts[0],{n:10n,d:1n}).product).toEqual({n:241n,d:25n});
});

test('sheet defaults highlight per field and manual edits survive component synchronization',async({page})=>{
 await setup(page);
 const approved={SheetID:21,SheetNumber:'RCP-APPROVED',Revision:1,SeasoningRatio:'5',SeasoningUSDPerLb:'.14',SeasoningCostBasis:'FinishedProduct',SeasoningLossPct:'2.5'};
 await page.route('**/api/opportunity/items/11/tcb',route=>route.fulfill({json:{...data,item:{...item,ProductGradeSnapshot:JSON.stringify({...snapshot,RequiresRecipeConfirmation:true})},saved:{...data.saved,NPDRecipe:approved,Inputs:{...data.saved.Inputs,ProcessLosses:[{Path:'0/1',Codes:[{MasterID:78,MasterVersion:version,ProcessName:'Seasoning'}],Ratios:['2.5']}]}}}}));
 await page.getByRole('button',{name:'View details',exact:true}).click();await page.getByRole('button',{name:'TCB Review',exact:true}).click();await page.getByRole('button',{name:'TCB Review for PRD-1 item 11',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'TCB Review',exact:true}),price=dialog.getByLabel('Seasoning ($/lbs) 0/1',{exact:true}),ratio=dialog.getByLabel('Seasoning Ratio (%) 0/1',{exact:true}),loss=dialog.getByLabel('Process loss 0/1 L1 item 11',{exact:true});
 await expect(price).toHaveClass('recipe-sheet-default');await expect(ratio).toHaveClass('recipe-sheet-default');await expect(price).toBeEnabled();await expect(loss).toHaveClass('recipe-sheet-default');
 const note=dialog.getByRole('note',{name:/Approved recipe RCP-APPROVED/});await note.click();await expect(page.getByRole('tooltip',{name:/Approved recipe/})).toBeVisible();
 await price.fill('.2');await expect(price).not.toHaveClass('recipe-sheet-default');await expect(ratio).toHaveClass('recipe-sheet-default');
 await dialog.getByLabel('Processing ($/lbs) 0/1',{exact:true}).fill('.1');await expect(price).toHaveValue('.2');
 await ratio.fill('6');await expect(ratio).not.toHaveClass('recipe-sheet-default');await expect(dialog.getByLabel('RM Ratio (%) 0/1',{exact:true})).toHaveText('94');
 await loss.fill('3');await expect(loss).not.toHaveClass('recipe-sheet-default');await expect(price).toHaveValue('.2');
});

test('new approved sheet replaces previous sheet overrides',()=>{
 const source={...data.saved.Inputs,ProcessLosses:[{Path:'0/1',Codes:[{MasterID:78,MasterVersion:version,ProcessName:'Seasoning'}],Ratios:['1']}]};
 const draft={row:{...item,RecipeComponentsSnapshot:JSON.stringify(data.recipeComponents),NPDRecipeSnapshot:JSON.stringify({SheetID:21,SeasoningRatio:5,SeasoningUSDPerLb:'.14'})},grades:snapshot.items,steps:[],costingInputs:source};
 const initial=syncRecipeComponents(draft);
 const manual=changeComponent(initial.costingInputs.MaterialCosts![0],components[2],'USDPerLb','.2',components);
 const next=syncRecipeComponents({...initial,costingInputs:{...initial.costingInputs,MaterialCosts:[{...manual,Path:'0/1'}]}});
 expect(next.costingInputs.MaterialCosts![0].SeasoningUSDPerLb).toBe('.2');
 const renewed=syncRecipeComponents({...next,row:{...next.row,NPDRecipeSnapshot:JSON.stringify({SheetID:22,SeasoningRatio:6,SeasoningUSDPerLb:'.3'})}});
 expect(renewed.costingInputs.MaterialCosts![0].SeasoningUSDPerLb).toBe('.3');
 expect(renewed.costingInputs.MaterialCosts![0].Components).toEqual([expect.objectContaining({SourceSheetID:22,ManualFields:[]})]);
});

test('approved sheet permits Seasoning only for its matching Level 1 grade family',async({page})=>{
 await setup(page);
 const scopedSnapshot={RequiresRecipeConfirmation:true,items:[...snapshot.items,{ParentID:'0',ID:2,Grade:'Almonds',RatioPct:'40',Process:true,RawGradeID:2}]};
 scopedSnapshot.items[0]={...scopedSnapshot.items[0],RatioPct:'60'};
 const approved={SheetID:21,SheetNumber:'RCP-CASHEW',Revision:1,ApplicableGradePaths:['0/1'],SeasoningRatio:'5',SeasoningUSDPerLb:'.14',SeasoningCostBasis:'FinishedProduct',SeasoningLossPct:'2.5'};
 const sorting={MasterID:79,MasterVersion:version,ProcessType:'Sorting',ProcessName:'Sorting',Sequence:1,LossPct:'0'};
 await page.route('**/api/opportunity/items/11/tcb',route=>route.fulfill({json:{...data,item:{...item,ProductGradeSnapshot:JSON.stringify(scopedSnapshot)},lossMasters:[...masters,sorting],grades:[...data.grades,{...data.grades[0],Path:'0/2',Grade:'Almonds',RawGradeID:2,Proportion:'.4',ProcessPath:'0/2'}],saved:{NPDRecipe:approved,Inputs:{...data.saved.Inputs,Prices:[{Path:'0/1',DirectUSDPerLb:'10'},{Path:'0/2',DirectUSDPerLb:'10'}],ProcessLosses:[{Path:'0/1',Codes:[{MasterID:77,MasterVersion:version,ProcessName:'Oil Salted Roasting'}],Ratios:['0']},{Path:'0/2',Codes:[{MasterID:79,MasterVersion:version,ProcessName:'Sorting'}],Ratios:['0']}]}}}}));
 await page.getByRole('button',{name:'View details',exact:true}).click();await page.getByRole('button',{name:'TCB Review',exact:true}).click();await page.getByRole('button',{name:'TCB Review for PRD-1 item 11',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'TCB Review',exact:true});
 await expect(dialog.getByLabel('Process type 0/1 L1 item 11',{exact:true}).locator('option[value="78"]')).toHaveCount(1);
 await expect(dialog.getByLabel('Process type 0/2 L1 item 11',{exact:true}).locator('option[value="78"]')).toHaveCount(0);
 await dialog.getByLabel('Process type 0/1 L1 item 11',{exact:true}).selectOption('78');
 await expect(dialog.getByLabel('Seasoning ($/lbs) 0/1',{exact:true})).toHaveValue('.14');await expect(dialog.getByLabel('Seasoning Ratio (%) 0/1',{exact:true})).toHaveValue('5');
 await expect(dialog.getByLabel('Seasoning ($/lbs) 0/2',{exact:true})).toHaveCount(0);await expect(dialog.getByLabel('RM Ratio (%) 0/2',{exact:true})).toHaveText('100');
 await expect(dialog.getByLabel('Process loss 0/1 L1 item 11',{exact:true})).toHaveValue('2.5');
});
