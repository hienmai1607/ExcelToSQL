import {test,expect,type Page} from '@playwright/test';
import {directPriceValues,recipeMT,type RecipeLine} from '../src/npd-model';
import {workspacePages} from '../src/workspace-access';
const rv='AAAAAAAAAAE=';
const grades={items:[{ParentID:'0',ID:1,Grade:'Cashews',RatioPct:60},{ParentID:'0',ID:2,Grade:'Almonds',RatioPct:40}]};
const ingredient={ID:1,RowVersion:rv,IngredientCode:'ING-1',Description:'Salt',GradeNature:'Fine powder',Origin:'Vietnam',BaseUoMID:23,BaseUoM:'KG',Status:'Active'};
const request={ID:1,RowVersion:rv,RequestNumber:'RRQ-1',OpportunityNumber:'OPP-1',CustomerName:'Review Customer',RequestedByName:'sales',RequestDue:'2026-12-01',Status:'Open',ItemCount:1,Unassigned:0};
const item={ID:11,RowVersion:rv,ProductCode:'PRD-1',ProductName:'Roasted blend',WeightGrams:'200',EstimatedAwardedMT:'10',PICUserID:2,PIC:'npd.member',IsOpen:true,GradeSnapshot:JSON.stringify(grades),Grades:[{GradePath:'0/1',Description:'Cashews',RatioPct:'60'},{GradePath:'0/2',Description:'Almonds',RatioPct:'40'}],LaunchingDate:'2027-01-15',SpecialComments:'Low salt',LatestSheetID:21,LatestSheetNumber:'RCP-1',HasWorkingSheet:true};
const fixed=[{Kind:'Raw',GradePath:'0/1',RatioPct:'57',LossPct:'0',IngredientID:null,PriceID:null},{Kind:'Raw',GradePath:'0/2',RatioPct:'38',LossPct:'0',IngredientID:null,PriceID:null}];
test('Recipe Sheets matches transaction lists and filters PIC and Status before paging',async({page},info)=>{
 await setup(page,'manager');const queries:URLSearchParams[]=[];
 await page.route('**/api/npd/sheets?**',route=>{const params=new URL(route.request().url()).searchParams;queries.push(params);return route.fulfill({json:{rows:[{...item,ID:21,SheetNumber:'RCP-1',RequestNumber:'RRQ-1',Status:'Price Ready',ApprovalStatus:'Pending',Revision:1}],total:1}})});
 await page.getByRole('navigation').getByRole('button',{name:'Recipe Sheets',exact:true}).click();
 const panel=page.locator('.npd-sheets-page');await expect(panel).toHaveClass(/customers-page/);
 await panel.getByLabel('PIC',{exact:true}).fill('npd.member');await panel.getByLabel('Status',{exact:true}).selectOption('Pending');await panel.getByRole('button',{name:'Search',exact:true}).click();
 await expect.poll(()=>queries.at(-1)?.get('pic')).toBe('npd.member');expect(queries.at(-1)?.get('status')).toBe('Pending');expect(queries.at(-1)?.get('page')).toBe('1');
 const filterGeometry=await panel.locator('.filters').evaluate(el=>Array.from(el.querySelectorAll('input,select')).map(e=>e.getBoundingClientRect().y));expect(Math.max(...filterGeometry)-Math.min(...filterGeometry)).toBeLessThan(2);
 const heading=await panel.getByRole('heading',{name:'Recipe Sheets',exact:true}).boundingBox(),refresh=await panel.getByRole('button',{name:'Refresh NPD',exact:true}).boundingBox();expect(refresh!.x-heading!.x-heading!.width).toBeLessThan(40);
 await panel.getByRole('button',{name:'Sort by Product name',exact:true}).click();await expect.poll(()=>queries.at(-1)?.get('sort')).toBe(JSON.stringify([{column:'ProductName',direction:'asc'}]));
 await panel.getByRole('button',{name:'Clear',exact:true}).click();await expect(panel.getByLabel('PIC',{exact:true})).toHaveValue('');await expect(panel.getByLabel('Status',{exact:true})).toHaveValue('');await expect.poll(()=>queries.at(-1)?.get('pic')).toBe('');
 await page.screenshot({path:info.outputPath('recipe-sheets-filters.png')});
});
async function setup(page:Page,role='member',approval='Draft'){
 const calls:{path:string;body:any}[]=[];
 const permissions={...Object.fromEntries(Object.keys(workspacePages).map(k=>[k,'none'])),ingredients:'edit','ingredient-prices':'edit','recipe-requests':role==='manager'?'edit':'display','recipe-sheets':'edit',...(role==='sales'?{opportunities:'edit','recipe-sheets':'display',ingredients:'none','ingredient-prices':'none'}:{})};
 let sheet={ExchangeRateVNDPerUSD:'26500',RowVersion:rv,SheetNumber:'RCP-1',RequestNumber:'RRQ-1',Revision:1,RequestItemID:11,Status:'Price Ready',ApprovalStatus:approval,...item,ID:21,AnnualUnit:'100000',EstPctAwarded:'50',GradeSnapshot:JSON.stringify(grades)};
 let lines:RecipeLine[]=[...fixed.map(r=>({...r,Kind:'Raw' as const})),{Kind:'Seasoning',GradePath:null,IngredientID:1,RatioPct:'5',LossPct:'10',PriceID:null}];
 const calc=(previewLines=lines)=>{
  const mt=recipeMT(sheet,previewLines);
  const priced=previewLines.map(line=>{const direct=directPriceValues(line,sheet.ExchangeRateVNDPerUSD),raw=line.Kind==='Raw';return {...line,GradeNature:raw?grades.items.find(g=>'0/'+g.ID===line.GradePath)?.Grade:ingredient.GradeNature,Origin:raw?'NA':ingredient.Origin,BufferRatio:String(Number(line.RatioPct)/(raw?1:1-Number(line.LossPct)/100)),TotalQtyMT:String(Number(line.RatioPct)/(raw?1:1-Number(line.LossPct)/100)/100*mt),USDPerKg:direct?.USDPerKg??(raw?'0':'10'),VNDPerKg:direct?.VNDPerKg??(raw?'0':String(Number(sheet.ExchangeRateVNDPerUSD)*10)),EffectiveUSDPerLb:direct?.USDPerLb??(raw?'0':'4.5359237'),DirectPrice:direct?{...direct,IngredientCode:'ING-1'}:null,Price:raw||direct?null:{ID:1,RowVersion:rv,IngredientCode:'ING-1',USDPerKg:'10',VNDPerKg:String(Number(sheet.ExchangeRateVNDPerUSD)*10),USDPerLb:'4.5359237'},Candidates:[]}});
  const total=priced.reduce((sum,r)=>sum+Number(r.RatioPct),0),buffer=priced.reduce((sum,r)=>sum+Number(r.BufferRatio),0),fg=priced.reduce((sum,r)=>sum+Number(r.USDPerKg)*Number(r.RatioPct)/100,0),fgBuffer=priced.reduce((sum,r)=>sum+Number(r.USDPerKg)*Number(r.BufferRatio)/100,0),seasoning=priced.filter(r=>r.Kind==='Seasoning'),cost=seasoning.reduce((sum,r)=>sum+Number(r.USDPerKg)*Number(r.RatioPct)/100,0);
  return {EstimatedAwardedMT:String(mt),LossWeightBasis:'Recipe',RatioTotal:String(total),SeasoningRatio:String(seasoning.reduce((sum,r)=>sum+Number(r.RatioPct),0)),SeasoningUSDPerLb:String(cost*.45359237),SeasoningUSDPerKg:String(cost),CostFGUSDPerKg:String(fg),CostFGWithBufferUSDPerKg:String(fgBuffer),LossByValuePct:fg?String((fgBuffer/fg-1)*100):null,SeasoningLossPct:String((buffer/total-1)*100),Lines:priced,Issues:[],Warnings:[]};
 };

 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON();
  if(body)calls.push({path,body});
  if(path.endsWith('/session'))return route.fulfill({json:{username:role==='manager'?'npd.manager':role==='sales'?'sales':'npd.member',user_id:role==='manager'?3:2,is_admin:role==='admin',scopes:role==='sales'?['Opportunity']:role==='manager'?['NPD','NPDManager']:['NPD'],permissions}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/npd/lookups')return route.fulfill({json:{units:[{ID:23,UoMCode:'KG'}],vendors:[{ID:1,VendorName:'Vendor A'}],currencies:[{ID:1,CurrencyCode:'USD'}],ingredients:[ingredient],members:[{ID:2,UserName:'npd.member'}]}});
  if(path==='/api/npd/ingredients/1')return route.fulfill({json:{row:ingredient}});
  if(path==='/api/npd/ingredients')return route.fulfill({json:body?{row:{...ingredient,...body}}:{rows:[ingredient],total:1}});
  if(path==='/api/npd/requests')return route.fulfill({json:body?{row:request}:{rows:[request],total:1}});
  if(path==='/api/npd/opportunity-items')return route.fulfill({json:{rows:[{...item,OpportunityItemID:101,OpportunityID:1,OpportunityNumber:'OPP-1',CustomerName:'Review Customer'}]}});
  if(path==='/api/npd/requests/1/items')return route.fulfill({json:{rows:[item]}});
  if(path==='/api/npd/sheets')return route.fulfill({json:{rows:[sheet],total:1}});
  if(path==='/api/npd/sheets/21/preview')return route.fulfill({json:{calculation:calc(body.Lines)}});
  if(path==='/api/npd/sheets/21/review'){if(body.Changes){lines=body.Changes.Lines;sheet={...sheet,Status:body.Changes.Status,ExchangeRateVNDPerUSD:body.Changes.ExchangeRateVNDPerUSD}}sheet={...sheet,ApprovalStatus:body.Action==='Approve'?'Approved':body.Action==='Return'?'Returned':'Pending'};return route.fulfill({json:{row:sheet}})}
  if(path==='/api/npd/sheets/21'){
   if(body){lines=body.Lines;sheet={...sheet,Status:body.Status,ExchangeRateVNDPerUSD:body.ExchangeRateVNDPerUSD};return route.fulfill({json:{row:sheet,lines,calculation:calc()}})}
   return route.fulfill({json:{row:sheet,lines,calculation:calc()}});
  }
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();return calls;
}
test('assigned NPD edits ratios, keeps raw identities and submits a saved sheet',async({page},info)=>{
 const calls=await setup(page);await page.getByRole('navigation').getByRole('button',{name:'Recipe Sheets',exact:true}).click();await page.getByRole('button',{name:'RCP-1',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'RCP-1',exact:true});
 await expect(dialog.getByLabel('Approval status: Draft',{exact:true})).toHaveText('Approval: Draft');await expect(dialog.getByLabel('Ratio line 1')).toHaveValue('57.00');await expect(dialog.getByLabel('Ratio line 1')).toBeEnabled();
 await expect(dialog.getByRole('button',{name:'Remove ingredient line 1',exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'Remove ingredient line 3',exact:true})).toBeVisible();
 await expect(dialog.getByLabel('Ingredient description line 1',{exact:true})).toBeVisible();await expect(dialog.getByLabel('Price (USD/KG) line 1',{exact:true})).toBeEnabled();
 await expect(dialog.getByRole('button',{name:'Edit ingredient line 3',exact:true})).toBeVisible();
 await expect(dialog.locator('footer').getByLabel('Loss by weight (%)',{exact:true})).toHaveText('0.56%');await expect(dialog.locator('footer input')).toHaveCount(0);await expect(dialog.locator('.npd-sheet-header').getByLabel('Loss by weight (%)',{exact:true})).toHaveCount(0);
 await expect(dialog.getByLabel('Exchange rate (VND / USD)',{exact:true})).toHaveValue('26500.00');await dialog.getByLabel('Exchange rate (VND / USD)',{exact:true}).fill('25000');
 const table=dialog.getByRole('table',{name:'Recipe ingredients',exact:true});await expect(table.getByRole('columnheader',{name:'No.',exact:true})).toBeVisible();await expect(table.getByRole('columnheader',{name:'Code',exact:true})).toBeVisible();await expect(table.getByText('ING-1',{exact:false})).toBeVisible();for(const name of ['Price (VND/KG)','Price (USD/KG)','Ingredient Loss (%)','Buffer Ratio (%)','Total Qty (KG)'])await expect(table.getByRole('columnheader',{name,exact:true})).toBeVisible();

 await dialog.getByLabel('Ratio line 1').fill('55');await expect(dialog.getByRole('button',{name:'Submit for approval'})).toBeDisabled();
 await dialog.getByLabel('Ratio line 1').fill('57');await dialog.getByRole('button',{name:'Save sheet',exact:true}).click();
 expect(calls.find(c=>c.path==='/api/npd/sheets/21')?.body.ExchangeRateVNDPerUSD).toBe('25000');expect(calls.find(c=>c.path==='/api/npd/sheets/21')?.body).not.toHaveProperty('SeasoningLossPct');
 await expect(dialog.getByRole('button',{name:'Submit for approval'})).toBeEnabled();await dialog.getByRole('button',{name:'Submit for approval'}).click();
 await expect(dialog.getByLabel('Ratio line 1')).toBeDisabled();expect(calls.find(c=>c.path.endsWith('/review'))?.body.Action).toBe('Submit');
 for(const width of [1920,1366]){await page.setViewportSize({width,height:1000});const headerFields=await dialog.locator('.npd-sheet-header>label').all(),boxes=await Promise.all(headerFields.map(field=>field.boundingBox()));expect(boxes).toHaveLength(6);expect(Math.max(...boxes.map(box=>box!.y))-Math.min(...boxes.map(box=>box!.y))).toBeLessThanOrEqual(1);expect(await dialog.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);expect((await dialog.boundingBox())!.width).toBeGreaterThan(width*.85);await expect(dialog.getByRole('button',{name:'Close',exact:true})).toBeVisible();for(const field of await dialog.locator('tbody td>input').all()){const input=await field.boundingBox(),cell=await field.locator('..').boundingBox();expect(input!.x+input!.width).toBeLessThanOrEqual(cell!.x+cell!.width+1)}}
 await page.screenshot({path:info.outputPath('npd-recipe-sheet.png')});
});
test('manager modifies a submitted recipe and approves its current edits without changing PIC',async({page})=>{
 const calls=await setup(page,'manager','Pending');await page.getByRole('navigation').getByRole('button',{name:'Recipe Sheets',exact:true}).click();await page.getByRole('button',{name:'RCP-1',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'RCP-1',exact:true});await expect(dialog.getByLabel('Ratio line 1')).toBeEnabled();await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Submit for approval',exact:true})).toHaveCount(0);
 await dialog.getByLabel('Ratio line 1').fill('56');await dialog.getByLabel('Ratio line 2').fill('39');await dialog.getByLabel('Price line 3',{exact:true}).selectOption('direct');await dialog.getByLabel('Price (USD/KG) line 3',{exact:true}).fill('12');await dialog.getByLabel('Note line 3',{exact:true}).fill('Manager adjusted price');await dialog.getByLabel('Sheet status',{exact:true}).selectOption('Final');
 await dialog.getByLabel('Review note',{exact:true}).fill('Approved with changes');await expect(dialog.getByRole('button',{name:'Return',exact:true})).toBeDisabled();
 await dialog.getByRole('button',{name:'Approve recipe',exact:true}).click();await expect(dialog.getByLabel('Approval status: Approved',{exact:true})).toBeVisible();await expect(dialog.getByLabel('Ratio line 1')).toBeDisabled();
 const review=calls.find(c=>c.path.endsWith('/review'))!.body;expect(review).toMatchObject({Action:'Approve',Comment:'Approved with changes',Changes:{RowVersion:rv,Status:'Final',ExchangeRateVNDPerUSD:'26500'}});expect(review.Changes.Lines[2]).toMatchObject({DirectPricePerKg:'12',Note:'Manager adjusted price'});expect(calls.filter(c=>c.path==='/api/npd/sheets/21')).toHaveLength(0);await expect(dialog.getByText('PIC: npd.member',{exact:true})).toBeVisible();
});

test('PIC cannot modify a submitted recipe',async({page})=>{
 await setup(page,'member','Pending');await page.getByRole('navigation').getByRole('button',{name:'Recipe Sheets',exact:true}).click();await page.getByRole('button',{name:'RCP-1',exact:true}).click();const sheet=page.getByRole('dialog',{name:'RCP-1',exact:true});await expect(sheet.getByLabel('Ratio line 1')).toBeDisabled();await expect(sheet.getByRole('button',{name:'Save changes',exact:true})).toHaveCount(0);await expect(sheet.getByRole('button',{name:'Approve recipe',exact:true})).toHaveCount(0);
});

test('ingredient master uses compact fields and the same save endpoint',async({page},info)=>{
 const calls=await setup(page);await page.getByRole('navigation').getByRole('button',{name:'Ingredients Master',exact:true}).click();await page.getByRole('button',{name:'Edit ingredient 1',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Edit ingredient',exact:true});await dialog.getByLabel('Origin',{exact:true}).fill('Thailand');
 const description=await dialog.getByLabel('Description',{exact:true}).boundingBox(),origin=await dialog.getByLabel('Origin',{exact:true}).boundingBox();expect(description!.y).toBe(origin!.y);
 await page.screenshot({path:info.outputPath('npd-master.png')});await dialog.getByRole('button',{name:'Save master'}).click();expect(calls.find(c=>c.path==='/api/npd/ingredients')?.body.Origin).toBe('Thailand');
});
test('Sales views Recipe Request items inline without manual request creation',async({page},info)=>{
 const calls=await setup(page,'sales');await page.getByRole('navigation').getByRole('button',{name:'Recipe Requests',exact:true}).click();
 await expect(page.getByRole('button',{name:'New Recipe Request',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'View items for RRQ-1',exact:true}).click();
 const list=page.getByRole('region',{name:'Items for RRQ-1',exact:true}),table=list.getByRole('table',{name:'Recipe Request items',exact:true});
 await expect(table.getByText('Roasted blend',{exact:true})).toBeVisible();await expect(table.getByText('PIC: npd.member',{exact:true})).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(list.getByRole('combobox',{name:'Assign PIC for PRD-1',exact:true})).toHaveCount(0);
 await page.screenshot({path:info.outputPath('recipe-request-item-list.png')});
 await list.getByRole('button',{name:'Recipe Request',exact:true}).click();await expect(table.getByRole('columnheader',{name:'Special comments',exact:true})).toBeVisible();await expect(table.getByText('Low salt',{exact:true})).toBeVisible();
 await list.getByRole('button',{name:'Product Info',exact:true}).click();await expect(table.getByRole('columnheader',{name:'Special comments',exact:true})).toHaveCount(0);await expect(table.getByRole('columnheader',{name:'Annual units',exact:true})).toBeVisible();
 await list.getByRole('button',{name:'Refresh Recipe Request items',exact:true}).click();await expect(table.getByText('Roasted blend',{exact:true})).toBeVisible();
 await list.getByRole('button',{name:'Close Recipe Request items',exact:true}).click();await expect(list).toHaveCount(0);expect(calls.some(c=>c.path==='/api/npd/requests')).toBeFalsy();
 await expect(page.getByRole('navigation').getByRole('button',{name:'Ingredients Master',exact:true})).toHaveCount(0);
});

test('Recipe Request item list keeps request editing and assigned Recipe Sheet access',async({page})=>{
 await setup(page,'manager');await page.getByRole('navigation').getByRole('button',{name:'Recipe Requests',exact:true}).click();await page.getByRole('button',{name:'View items for RRQ-1',exact:true}).click();
 const list=page.getByRole('region',{name:'Items for RRQ-1',exact:true});await list.getByRole('button',{name:'Recipe Sheets',exact:true}).click();await list.getByRole('button',{name:'RCP-1',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'RCP-1',exact:true});await expect(sheet.getByText('npd.member',{exact:false}).first()).toBeVisible();await sheet.getByRole('button',{name:'Close',exact:true}).click();
 await list.getByRole('button',{name:'Open Recipe Request item PRD-1',exact:true}).click();const requestDialog=page.getByRole('dialog',{name:'RRQ-1',exact:true});await expect(requestDialog.getByLabel('PIC 11',{exact:true})).toBeVisible();
});

test('a first Draft sheet appears in request version history without an approved link',async({page},info)=>{
 await setup(page,'member');await page.route('**/api/npd/requests/1/items',route=>route.fulfill({json:{rows:[{...item,IsLinked:true,ActiveSheetID:null,ApprovedSheetID:null,ActiveSheetNumber:null,SheetVersions:[{ID:21,Revision:1,SheetNumber:'RCP-1',Status:'Draft',ApprovalStatus:'Draft',IsCurrentApproved:false}]}]}}));
 await page.getByRole('navigation').getByRole('button',{name:'Recipe Requests',exact:true}).click();await page.getByRole('button',{name:'RRQ-1',exact:true}).click();
 const request=page.getByRole('dialog',{name:'RRQ-1',exact:true});await expect(request.getByRole('button',{name:'Open RCP-1',exact:true})).toHaveCount(0);
 const versions=request.getByRole('table',{name:'Recipe Sheet versions for PRD-1',exact:true});await expect(versions.locator('tbody tr')).toHaveCount(1);await expect(versions.getByText('Current approved sheet',{exact:true})).toHaveCount(0);
 await page.screenshot({path:info.outputPath('recipe-request-version-history.png')});await versions.getByRole('button',{name:'View Recipe Sheet RCP-1 version 1',exact:true}).click();await expect(page.getByRole('dialog',{name:'RCP-1',exact:true}).getByLabel('Ratio line 1',{exact:true})).toBeEnabled();
});

test('switching request item lists clears previous rows and resets item paging',async({page})=>{
 await setup(page);await page.route('**/api/npd/requests/1/items',route=>route.fulfill({json:{rows:[item,{...item,ID:13,ProductCode:'PRD-1B',ProductName:'First request second item'}]}}));await page.route('**/api/npd/requests?**',route=>route.fulfill({json:{rows:[request,{...request,ID:2,RequestNumber:'RRQ-2'}],total:2}}));await page.route('**/api/npd/requests/2/items',route=>route.fulfill({json:{rows:[{...item,ID:12,ProductCode:'PRD-2',ProductName:'Second recipe product'}]}}));
 await page.getByRole('navigation').getByRole('button',{name:'Recipe Requests',exact:true}).click();await page.getByRole('button',{name:'View items for RRQ-1',exact:true}).click();await expect(page.getByRole('table',{name:'Recipe Request items',exact:true}).getByText('Roasted blend',{exact:true})).toBeVisible();
 const firstList=page.getByRole('region',{name:'Items for RRQ-1',exact:true});await firstList.getByLabel('Rows per page',{exact:true}).fill('1');await firstList.getByLabel('Rows per page',{exact:true}).press('Enter');await firstList.getByRole('button',{name:'Next',exact:true}).click();await expect(firstList.getByText('First request second item',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'View items for RRQ-2',exact:true}).click();const table=page.getByRole('table',{name:'Recipe Request items',exact:true});await expect(table.getByText('Second recipe product',{exact:true})).toBeVisible();await expect(table.getByText('Roasted blend',{exact:true})).toHaveCount(0);
});


test('manager assigns PIC in the item list and refreshes the request unassigned count',async({page},info)=>{
 await setup(page,'manager');let assigned=false;const writes:unknown[]=[];
 await page.route('**/api/npd/requests?**',route=>route.fulfill({json:{rows:[{...request,Unassigned:assigned?0:1}],total:1}}));
 await page.route('**/api/npd/requests/1/items',route=>route.fulfill({json:{rows:[{...item,PICUserID:assigned?2:null,PIC:assigned?'npd.member':null,RowVersion:assigned?'AAAAAAAAAAI=':rv}]}}));
 await page.route('**/api/npd/request-items/11/assign',route=>{writes.push(route.request().postDataJSON());assigned=true;return route.fulfill({json:{row:{...item,PICUserID:2,RowVersion:'AAAAAAAAAAI='}}})});
 await page.getByRole('navigation').getByRole('button',{name:'Recipe Requests',exact:true}).click();await page.getByRole('button',{name:'View items for RRQ-1',exact:true}).click();const list=page.getByRole('region',{name:'Items for RRQ-1',exact:true});
 await expect(list.getByRole('button',{name:'Save PIC for PRD-1',exact:true})).toBeDisabled();await list.getByRole('combobox',{name:'Assign PIC for PRD-1',exact:true}).selectOption('2');await list.getByRole('button',{name:'Save PIC for PRD-1',exact:true}).click();
 await expect(list.getByRole('combobox',{name:'Assign PIC for PRD-1',exact:true})).toHaveValue('2');await expect(list.getByRole('button',{name:'Save PIC for PRD-1',exact:true})).toBeDisabled();const room=await list.getByRole('combobox',{name:'Assign PIC for PRD-1',exact:true}).evaluate(el=>{const style=getComputedStyle(el);return el.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom)-parseFloat(style.fontSize)});expect(room).toBeGreaterThanOrEqual(0);expect(writes).toEqual([{RowVersion:rv,PICUserID:2}]);
 const header=page.getByRole('table',{name:'Recipe Requests',exact:true});await expect(header.getByRole('row').filter({has:page.getByRole('button',{name:'RRQ-1',exact:true})}).locator('td').nth(6)).toHaveText('0');await page.screenshot({path:info.outputPath('inline-recipe-pic.png')});
});

test('rejected PIC assignment keeps item rows and the proposed PIC visible',async({page})=>{
 await setup(page,'manager');await page.route('**/api/npd/requests/1/items',route=>route.fulfill({json:{rows:[{...item,PICUserID:null,PIC:null}]}}));await page.route('**/api/npd/request-items/11/assign',route=>route.fulfill({status:409,json:{detail:'Return the submitted sheet before reassigning this item.'}}));
 await page.getByRole('navigation').getByRole('button',{name:'Recipe Requests',exact:true}).click();await page.getByRole('button',{name:'View items for RRQ-1',exact:true}).click();const list=page.getByRole('region',{name:'Items for RRQ-1',exact:true});await list.getByRole('combobox',{name:'Assign PIC for PRD-1',exact:true}).selectOption('2');await list.getByRole('button',{name:'Save PIC for PRD-1',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Return the submitted sheet');await expect(list.getByRole('combobox',{name:'Assign PIC for PRD-1',exact:true})).toHaveValue('2');await expect(list.getByRole('button',{name:'Open Recipe Request item PRD-1',exact:true})).toBeVisible();
});


test('Recipe Request Review cell keeps assignment controls inside without scrolling',async({page},info)=>{
 await setup(page,'manager');await page.getByRole('navigation').getByRole('button',{name:'Recipe Requests',exact:true}).click();await page.getByRole('button',{name:'View items for RRQ-1',exact:true}).click();const list=page.getByRole('region',{name:'Items for RRQ-1',exact:true});
 for(const width of [1920,1366,700]){
  await page.setViewportSize({width,height:1000});const review=list.locator('.npd-item-review');await expect(review.getByRole('combobox',{name:'Assign PIC for PRD-1',exact:true})).toBeVisible();
  expect((await review.getByRole('combobox',{name:'Assign PIC for PRD-1',exact:true}).boundingBox())!.width).toBeLessThanOrEqual(190);
  const centers=await review.locator('.badge,select,button').evaluateAll(els=>els.map(el=>{const box=el.getBoundingClientRect();return box.y+box.height/2}));expect(Math.max(...centers)-Math.min(...centers)).toBeLessThan(2);
  for(const selector of ['.npd-item-review','.npd-pic-assignment']){const overflow=await list.locator(selector).evaluate(el=>({mode:getComputedStyle(el).overflowX,extra:el.scrollWidth-el.clientWidth}));expect(overflow.extra).toBeLessThanOrEqual(1);expect(['auto','scroll']).not.toContain(overflow.mode)}
  const cell=await review.locator('..').boundingBox();for(const control of await review.locator('select,button').all()){const box=await control.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(cell!.x);expect(box!.x+box!.width).toBeLessThanOrEqual(cell!.x+cell!.width+1)}
 }
 await page.setViewportSize({width:1366,height:1000});await list.locator('.npd-item-review').screenshot({path:info.outputPath('recipe-review-wrap.png')});
});


test('ingredient loss immediately updates buffered quantity and blocks submission at 100 percent uplift',async({page})=>{
 await setup(page);await page.getByRole('navigation').getByRole('button',{name:'Recipe Sheets',exact:true}).click();await page.getByRole('button',{name:'RCP-1',exact:true}).click();const dialog=page.getByRole('dialog',{name:'RCP-1',exact:true});
 await dialog.getByLabel('Loss line 3',{exact:true}).fill('96');await expect(dialog.getByLabel('Loss by weight (%)',{exact:true})).toHaveText('120.00%');await expect(dialog.getByRole('button',{name:'Submit for approval',exact:true})).toBeDisabled();
 const row=dialog.getByRole('table',{name:'Recipe ingredients',exact:true}).locator('tbody tr').nth(2);await expect(row.locator('td').nth(11)).toHaveText('125.00');await expect(row.locator('td').nth(13)).toHaveText('12,500.000');await expect(dialog.getByLabel('Total Buffer Ratio',{exact:true})).toHaveText('220.00%');
});


test('direct ingredient prices convert either currency, save, reopen and return to master pricing',async({page},info)=>{
 const calls=await setup(page);await page.getByRole('navigation').getByRole('button',{name:'Recipe Sheets',exact:true}).click();await page.getByRole('button',{name:'RCP-1',exact:true}).click();
 let dialog=page.getByRole('dialog',{name:'RCP-1',exact:true});const vnd=()=>dialog.getByLabel('Price (VND/KG) line 3',{exact:true}),usd=()=>dialog.getByLabel('Price (USD/KG) line 3',{exact:true});
 await expect(usd()).toHaveText('10.00');await expect(vnd()).toHaveText('265,000.00');await expect(usd()).toHaveJSProperty('tagName','OUTPUT');await expect(vnd()).toHaveJSProperty('tagName','OUTPUT');await dialog.getByLabel('Price line 3',{exact:true}).selectOption('direct');await vnd().fill('530000');await expect(usd()).toHaveValue('20.00');await expect(dialog.getByLabel('Price line 3',{exact:true})).toHaveValue('direct');
 await dialog.getByLabel('Exchange rate (VND / USD)',{exact:true}).fill('25000');await expect(usd()).toHaveValue('21.20');
 await usd().fill('12');await expect(vnd()).toHaveValue('300000.00');await dialog.getByRole('button',{name:'Save sheet',exact:true}).click();
 const saved=calls.find(c=>c.path==='/api/npd/sheets/21')!.body.Lines[2];expect(saved).toMatchObject({DirectPriceCurrency:'USD',DirectPricePerKg:'12',PriceID:null});
 await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'RCP-1',exact:true}).click();dialog=page.getByRole('dialog',{name:'RCP-1',exact:true});await expect(usd()).toHaveValue('12.00');await expect(vnd()).toHaveValue('300000.00');await expect(dialog.locator('.npd-totals')).toContainText('0.27');
 await page.screenshot({path:info.outputPath('npd-direct-price.png')});await dialog.getByLabel('Price line 3',{exact:true}).selectOption('');await expect(dialog.getByLabel('Price line 3',{exact:true})).toHaveValue('');await dialog.getByRole('button',{name:'Save sheet',exact:true}).click();
 expect(calls.filter(c=>c.path==='/api/npd/sheets/21').at(-1)!.body.Lines[2]).toMatchObject({DirectPricePerKg:null,DirectPriceCurrency:null});
});

test('direct prices use exact conversion and retain a free zero price',()=>{
 const line={Kind:'Seasoning' as const,GradePath:null,IngredientID:1,RatioPct:'5',LossPct:'0',PriceID:null,DirectPricePerKg:'265000',DirectPriceCurrency:'VND' as const};
 expect(directPriceValues(line,'26500')).toEqual({VNDPerKg:'265000',USDPerKg:'10',USDPerLb:'4.535924'});
 expect(directPriceValues({...line,DirectPricePerKg:'0'},'26500')).toEqual({VNDPerKg:'0',USDPerKg:'0',USDPerLb:'0'});
});


test('recipe reference layout keeps metadata, notes, total ratio and seven summaries in order',async({page},info)=>{
 const calls=await setup(page);await page.getByRole('navigation').getByRole('button',{name:'Recipe Sheets',exact:true}).click();await page.getByRole('button',{name:'RCP-1',exact:true}).click();const dialog=page.getByRole('dialog',{name:'RCP-1',exact:true}),table=dialog.getByRole('table',{name:'Recipe ingredients',exact:true});
 expect(await table.locator('thead th').allTextContents()).toEqual(['No.','Code','Ingredient','Grade/ type/ nature','Origin','Ratio (%)','#','Vendor','Price (VND/KG)','Price (USD/KG)','Ingredient Loss (%)','Buffer Ratio (%)','Note','Total Qty (KG)','Actions']);
 await expect(table.getByText('USD/lbs',{exact:false})).toHaveCount(0);await expect(table.locator('tbody tr').nth(2).locator('td').nth(11)).toHaveText('5.56');
 await expect(table.getByText('Fine powder',{exact:true})).toBeVisible();await expect(table.getByText('Vietnam',{exact:true})).toBeVisible();await expect(table.getByText('NA',{exact:true})).toHaveCount(2);
 await dialog.getByLabel('Ingredient description line 1',{exact:true}).fill('Oil roasted cashews');await dialog.getByLabel('Note line 1',{exact:true}).fill('Inspect nuts');await dialog.getByLabel('Note line 3',{exact:true}).fill('Fine grind');await dialog.getByLabel('Price (USD/KG) line 1',{exact:true}).fill('12');await dialog.getByRole('button',{name:'Save sheet',exact:true}).click();
 const saved=calls.filter(c=>c.path==='/api/npd/sheets/21').at(-1)!.body.Lines;expect(saved[0]).toMatchObject({IngredientNote:'Oil roasted cashews',Note:'Inspect nuts',DirectPricePerKg:'12'});expect(saved[2].Note).toBe('Fine grind');
 await expect(table.getByLabel('Total ratio',{exact:true})).toHaveText('100.00%');await expect(table.getByLabel('Total Buffer Ratio',{exact:true})).toHaveText('100.56%');await expect(table.locator('tbody tr').nth(0).locator('td').nth(13)).toHaveText('5,700.000');await expect(table.locator('tbody tr').nth(2).locator('td').nth(13)).toHaveText('555.556');await expect(dialog.locator('footer').getByText('Total ratio',{exact:true})).toHaveCount(0);
 expect(await dialog.getByLabel('Recipe cost summaries',{exact:true}).locator(':scope>span').evaluateAll(elements=>elements.map(el=>el.firstChild?.textContent))).toEqual(['Cost of FG ($/kg)','Cost of FG with Buffer ($/kg)','Loss by weight (%)','Loss by value (%)','Seasoning price ($/kg)','Seasoning price ($/lbs)','Seasoning Ratio']);
 for(const width of [1920,1366]){await page.setViewportSize({width,height:1080});expect(await table.locator('..').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);for(const input of await table.locator('input').all()){const box=await input.boundingBox(),cell=await input.locator('..').boundingBox();expect(box!.x+box!.width).toBeLessThanOrEqual(cell!.x+cell!.width+1)}}
 await page.screenshot({path:info.outputPath('recipe-reference-layout.png')});
});


test('Direct price is selectable before typing and stays blank until an amount is entered',async({page})=>{
 await setup(page);await page.getByRole('navigation').getByRole('button',{name:'Recipe Sheets',exact:true}).click();await page.getByRole('button',{name:'RCP-1',exact:true}).click();const sheet=page.getByRole('dialog',{name:'RCP-1',exact:true}),source=sheet.getByLabel('Price line 3',{exact:true});
 await expect(source.locator('option[value="direct"]')).toBeEnabled();await source.selectOption('direct');await expect(source).toHaveValue('direct');await expect(sheet.getByLabel('Price (USD/KG) line 3',{exact:true})).toHaveValue('');await sheet.getByLabel('Price (USD/KG) line 3',{exact:true}).fill('12');await expect(sheet.getByLabel('Price (VND/KG) line 3',{exact:true})).toHaveValue('318000.00');
});

test('a new ingredient price immediately populates its quote and can be saved on the sheet',async({page})=>{
 const calls=await setup(page);await page.getByRole('navigation').getByRole('button',{name:'Recipe Sheets',exact:true}).click();await page.getByRole('button',{name:'RCP-1',exact:true}).click();const sheet=page.getByRole('dialog',{name:'RCP-1',exact:true});
 await page.route('**/api/npd/ingredient-prices',route=>route.fulfill({json:{row:{ID:317,RowVersion:rv,IngredientID:1,VendorID:1,VendorName:'Vendor A',CurrencyID:1,CurrencyCode:'USD',UnitPrice:'12',PriceUoMID:23,PriceUnit:'KG',Status:'Active'}}}));
 await page.route('**/api/npd/sheets/21/preview',route=>{const body=route.request().postDataJSON();const quote={ID:body.Lines[2].PriceID??1,RowVersion:rv,IngredientID:1,IngredientCode:'ING-1',VendorName:'Vendor A',UnitPrice:'12',CurrencyCode:'USD',PriceUnit:'KG',USDPerKg:'12',VNDPerKg:'318000',USDPerLb:'5.44310844'};return route.fulfill({json:{calculation:{RatioTotal:'100',SeasoningRatio:'5',SeasoningUSDPerLb:'.272155422',EstimatedAwardedMT:'10',SeasoningLossPct:'.5555555556',LossWeightBasis:'Recipe',Lines:body.Lines.map((line:RecipeLine)=>line.Kind==='Seasoning'?{...line,PriceID:line.PriceID,USDPerKg:'12',VNDPerKg:'318000',Price:quote,Candidates:[quote]}:line),Issues:[],Warnings:[]}}})});
 await sheet.getByLabel('Ratio line 3',{exact:true}).fill('6');await sheet.getByLabel('Ratio line 3',{exact:true}).fill('5');await sheet.getByLabel('Price line 3',{exact:true}).selectOption('direct');await sheet.getByRole('button',{name:'Add new ingredient price line 3',exact:true}).click();const add=page.getByRole('dialog',{name:'New ingredient pricing',exact:true});await add.getByLabel('Vendor',{exact:true}).selectOption('1');await add.getByLabel('Currency',{exact:true}).selectOption('1');await add.getByLabel('Price',{exact:true}).fill('12');await add.getByLabel('Price unit',{exact:true}).selectOption('23');await add.getByRole('button',{name:'Save master',exact:true}).click();
 await expect(add).toHaveCount(0);await expect(sheet.getByLabel('Price (USD/KG) line 3',{exact:true})).toHaveText('12.00');await expect(sheet.getByLabel('Price line 3',{exact:true})).toHaveValue('317');await expect(sheet.getByLabel('Price line 3',{exact:true}).locator('option:checked')).toContainText('#317');
 await sheet.getByRole('button',{name:'Save sheet',exact:true}).click();expect(calls.filter(call=>call.path==='/api/npd/sheets/21').at(-1)!.body.Lines[2].PriceID).toBe(317);
});


test('selected pricing outside the quantity tier explains the reason and retains master edit',async({page})=>{
 await setup(page);const quote={ID:317,RowVersion:rv,IngredientID:1,IngredientCode:'ING-1',VendorName:'Vendor A',UnitPrice:'10000',CurrencyCode:'VND',PriceUnit:'KG'};
 await page.route('**/api/npd/sheets/21',route=>route.fulfill({json:{row:{...item,ID:21,SheetNumber:'RCP-1',RequestNumber:'RRQ-1',Revision:1,AnnualUnit:'100000',EstPctAwarded:'50',Status:'Draft',ApprovalStatus:'Draft',ExchangeRateVNDPerUSD:'26500'},lines:[...fixed,{Kind:'Seasoning',IngredientID:1,GradePath:null,RatioPct:'5',LossPct:'10',PriceID:317}],calculation:{EstimatedAwardedMT:'10',RatioTotal:'100',SeasoningRatio:'5',SeasoningUSDPerLb:null,Lines:[...fixed,{Kind:'Seasoning',IngredientID:1,PriceID:317,Price:null,SelectedPrice:quote,PriceIssue:'Minimum 1,000 KG; required 160 KG after buffer.',Candidates:[]}],Issues:[],Warnings:[]}}}));
 await page.route('**/api/npd/sheets/21/preview',route=>route.fulfill({json:{calculation:{EstimatedAwardedMT:'10',RatioTotal:'100',SeasoningRatio:'5',SeasoningUSDPerLb:null,Lines:[...fixed,{Kind:'Seasoning',IngredientID:1,PriceID:317,Price:null,SelectedPrice:quote,PriceIssue:'Minimum 1,000 KG; required 160 KG after buffer.',Candidates:[]}],Issues:[],Warnings:[]}}}));
 await page.getByRole('navigation').getByRole('button',{name:'Recipe Sheets',exact:true}).click();await page.getByRole('button',{name:'RCP-1',exact:true}).click();const sheet=page.getByRole('dialog',{name:'RCP-1',exact:true});
 await expect(sheet.getByLabel('Price line 3',{exact:true})).toHaveAttribute('title','Minimum 1,000 KG; required 160 KG after buffer.');await expect(sheet.getByLabel('Price line 3',{exact:true}).locator('option:checked')).toContainText('#317');await expect(sheet.getByRole('button',{name:'Edit ingredient price line 3',exact:true})).toBeVisible();await expect(sheet.getByLabel('Price (USD/KG) line 3',{exact:true})).toHaveText('\u2014');
 await sheet.getByLabel('Price line 3',{exact:true}).selectOption('direct');await expect(sheet.getByText('Minimum 1,000 KG; required 160 KG after buffer.',{exact:true})).toHaveCount(0);await sheet.getByLabel('Price (USD/KG) line 3',{exact:true}).fill('1');await expect(sheet.getByLabel('Price (VND/KG) line 3',{exact:true})).toHaveValue('26500.00');
});


test('missing applicable pricing defaults to Direct, while Auto locks both price fields',async({page})=>{
 const calls=await setup(page);
 // Return a quantity-dependent quote: the larger buffered quantity has a tier.
 await page.route('**/api/npd/sheets/21/preview',route=>{
  const body=route.request().postDataJSON(),available=Number(body.Lines[2].RatioPct)>=6;
  const quote={ID:1,RowVersion:rv,VendorName:'Vendor A',UnitPrice:'10',CurrencyCode:'USD',PriceUnit:'KG',USDPerKg:'10',VNDPerKg:'265000'};
  return route.fulfill({json:{calculation:{EstimatedAwardedMT:'10',RatioTotal:'100',SeasoningRatio:'5',SeasoningUSDPerLb:null,Lines:body.Lines.map((line:RecipeLine)=>line.Kind==='Seasoning'?{...line,Price:available&&line.PriceMode!=='Direct'?quote:null,Candidates:available?[quote]:[],USDPerKg:available?'10':undefined,VNDPerKg:available?'265000':undefined}:line),Issues:[],Warnings:[]}}});
 });
 await page.getByRole('navigation').getByRole('button',{name:'Recipe Sheets',exact:true}).click();await page.getByRole('button',{name:'RCP-1',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'RCP-1',exact:true}),source=sheet.getByLabel('Price line 3',{exact:true}),usd=sheet.getByLabel('Price (USD/KG) line 3',{exact:true}),vnd=sheet.getByLabel('Price (VND/KG) line 3',{exact:true});
 await expect(source).toHaveValue('direct');await expect(usd).toBeEnabled();await expect(vnd).toBeEnabled();
 await usd.fill('12');await expect(vnd).toHaveValue('318000.00');
 await sheet.getByLabel('Ratio line 3',{exact:true}).fill('6');await expect(usd).toHaveValue('12.00');
 await sheet.getByLabel('Ingredient line 3',{exact:true}).selectOption('1');await expect(source).toHaveValue('');await expect(usd).toHaveText('10.00');await expect(usd).toHaveJSProperty('tagName','OUTPUT');await expect(vnd).toHaveJSProperty('tagName','OUTPUT');
 await sheet.getByLabel('Ratio line 3',{exact:true}).fill('5');await expect(source).toHaveValue('direct');await expect(usd).toBeEnabled();await expect(usd).toHaveValue('');
 await usd.fill('9');await sheet.getByRole('button',{name:'Save sheet',exact:true}).click();
 expect(calls.filter(c=>c.path==='/api/npd/sheets/21').at(-1)!.body.Lines[2]).toMatchObject({PriceMode:'Direct',DirectPricePerKg:'9',DirectPriceCurrency:'USD',PriceID:null});
});


test('percentage formatting keeps full precision in saved ratios and quantities',async({page})=>{
 const calls=await setup(page);await page.getByRole('navigation').getByRole('button',{name:'Recipe Sheets',exact:true}).click();await page.getByRole('button',{name:'RCP-1',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'RCP-1',exact:true}),ratio=sheet.getByLabel('Ratio line 3',{exact:true});
 await ratio.fill('5.123456');await sheet.getByLabel('Note line 3',{exact:true}).focus();await expect(ratio).toHaveValue('5.12');
 await sheet.getByRole('button',{name:'Save sheet',exact:true}).click();expect(calls.filter(c=>c.path==='/api/npd/sheets/21').at(-1)!.body.Lines[2].RatioPct).toBe('5.123456');
 await ratio.focus();await expect(ratio).toHaveValue('5.12');await expect(ratio).toHaveAttribute('title','5.123456');
});


test('price sources and vendors use single rows with a sortable multi-vendor quote picker',async({page},info)=>{
 const calls=await setup(page,'admin');
 const quotes=[{ID:2,RowVersion:rv,VendorID:2,VendorName:'Vendor B',UnitPrice:'12',CurrencyCode:'USD',PriceUnit:'KG',USDPerKg:'12',VNDPerKg:'318000',QuantityFrom:'500',QuantityTo:null,RequiredQuantity:'555.555555',BaseUoM:'KG',EffectiveFrom:'2026-11-01'}, {ID:1,RowVersion:rv,VendorID:1,VendorName:'Vendor A',UnitPrice:'10',CurrencyCode:'USD',PriceUnit:'KG',USDPerKg:'10',VNDPerKg:'265000',QuantityFrom:'0',QuantityTo:null,RequiredQuantity:'555.555555',BaseUoM:'KG',EffectiveFrom:'2026-10-01'}];
 await page.route('**/api/npd/sheets/21/preview',route=>{const body=route.request().postDataJSON();const quote=quotes.find(q=>q.ID===body.Lines[2].PriceID)??quotes[0];return route.fulfill({json:{calculation:{EstimatedAwardedMT:'10',RatioTotal:'100',SeasoningRatio:'5',SeasoningUSDPerLb:'.27',Lines:body.Lines.map((line:RecipeLine)=>line.Kind==='Seasoning'?{...line,Price:quote,Candidates:quotes,USDPerKg:quote.USDPerKg,VNDPerKg:quote.VNDPerKg}:line),Issues:[],Warnings:[]}}})});
 await page.getByRole('navigation').getByRole('button',{name:'Recipe Sheets',exact:true}).click();await page.getByRole('button',{name:'RCP-1',exact:true}).click();const sheet=page.getByRole('dialog',{name:'RCP-1',exact:true});
 const table=sheet.getByRole('table',{name:'Recipe ingredients',exact:true}),row=table.locator('tbody tr').nth(2);
 await expect(row.locator('td').nth(6).getByLabel('Price line 3',{exact:true})).toHaveValue('');await expect(row.locator('td').nth(7)).toHaveText('Vendor B');await expect(sheet.getByLabel('Price (USD/KG) line 3',{exact:true})).toHaveText('12.00');
 await sheet.getByRole('button',{name:'View matching prices line 3',exact:true}).click();const picker=page.getByRole('dialog',{name:'Applicable ingredient prices',exact:true});
 await expect(picker.locator('tbody tr').first()).toContainText('Vendor B');await picker.getByRole('button',{name:'Price (USD/KG)',exact:false}).click();await expect(picker.locator('tbody tr').first()).toContainText('Vendor A');
 await picker.locator('tbody tr').first().getByRole('button',{name:'Use price',exact:true}).click();await expect(picker).toHaveCount(0);await expect(row.locator('td').nth(7)).toHaveText('Vendor A');
 await sheet.getByLabel('Price line 3',{exact:true}).selectOption('direct');await expect(row.getByRole('button',{name:'Add new Vendor master',exact:true})).toBeVisible();await sheet.getByLabel('Vendor line 3',{exact:true}).selectOption('1');await expect(row.getByRole('button',{name:'Edit Vendor master',exact:true})).toBeVisible();await sheet.getByLabel('Price (USD/KG) line 3',{exact:true}).fill('9.123456');await sheet.getByRole('button',{name:'Save sheet',exact:true}).click();
 expect(calls.filter(c=>c.path==='/api/npd/sheets/21').at(-1)!.body.Lines[2]).toMatchObject({DirectVendorID:1,DirectPricePerKg:'9.123456',PriceID:null});
 for(const width of [1920,1366]){await page.setViewportSize({width,height:1080});expect(await table.locator('..').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);const rowHeight=(await row.boundingBox())!.height;expect(rowHeight).toBeLessThan(50)}
 await page.screenshot({path:info.outputPath('single-line-price-vendor.png')});
});


test('submitted Recipe Request items lock PIC and open manager approval from Review',async({page})=>{
 await setup(page,'manager','Pending');let approved=false;
 await page.route('**/api/npd/requests/1/items',route=>route.fulfill({json:{rows:[{...item,LatestSheetApprovalStatus:approved?'Approved':'Pending',LatestSheetStatus:'Price Ready',LatestSheetApprovedByName:approved?'npd.manager':null,IsOpen:!approved,ActiveSheetID:approved?21:null}]}}));
 await page.route('**/api/npd/sheets/21/review',route=>{approved=true;return route.fulfill({json:{row:{ID:21}}})});
 await page.getByRole('navigation').getByRole('button',{name:'Recipe Requests',exact:true}).click();await page.getByRole('button',{name:'View items for RRQ-1',exact:true}).click();
 let list=page.getByRole('region',{name:'Items for RRQ-1',exact:true});
 await expect(list.getByRole('combobox',{name:'Assign PIC for PRD-1',exact:true})).toHaveCount(0);await expect(list.getByRole('button',{name:'Save PIC for PRD-1',exact:true})).toHaveCount(0);
 await expect(list.getByText('Submitted',{exact:true}).first()).toBeVisible();await list.getByRole('button',{name:'Open Recipe Request item PRD-1',exact:true}).click();
 const detail=page.getByRole('dialog',{name:'RRQ-1',exact:true});await expect(detail.getByLabel('PIC 11',{exact:true})).toHaveCount(0);await expect(detail.getByRole('button',{name:'Review Recipe Sheet for PRD-1',exact:true})).toBeVisible();await detail.getByRole('button',{name:'Close recipe request',exact:true}).click();
 await list.getByRole('button',{name:'Review Recipe Sheet for PRD-1',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'RCP-1',exact:true});await expect(sheet.getByRole('button',{name:'Approve recipe',exact:true})).toBeVisible();await expect(sheet.getByRole('button',{name:'Return',exact:true})).toBeVisible();
 await sheet.getByRole('button',{name:'Approve recipe',exact:true}).click();await sheet.getByRole('button',{name:'Close',exact:true}).click();
 list=page.getByRole('region',{name:'Items for RRQ-1',exact:true});await expect(list.getByText('Approved by: npd.manager',{exact:true})).toBeVisible();await expect(list.getByText('PIC: npd.member',{exact:true})).toBeVisible();await expect(list.getByRole('combobox',{name:'Assign PIC for PRD-1',exact:true})).toHaveCount(0);
});

test('NPD grade removal updates recipe MOQ and restores the captured share',async({page})=>{
 const calls=await setup(page);await page.getByRole('navigation').getByRole('button',{name:'Recipe Sheets',exact:true}).click();await page.getByRole('button',{name:'RCP-1',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'RCP-1',exact:true});
 await sheet.getByRole('button',{name:'Remove grade Almonds',exact:true}).click();
 await expect(sheet.locator('.npd-sheet-header').getByText('6.000',{exact:true})).toBeVisible();
 await expect(sheet.getByRole('button',{name:'Remove grade Almonds',exact:true})).toHaveCount(0);
 await expect(sheet.getByRole('button',{name:'Remove grade Cashews',exact:true})).toBeDisabled();
 await sheet.getByLabel('Ratio line 1',{exact:true}).fill('95');await sheet.getByRole('button',{name:'Save sheet',exact:true}).click();
 const saved=calls.filter(c=>c.path==='/api/npd/sheets/21').at(-1)!.body;
 expect(saved.Lines.filter((l:RecipeLine)=>l.Kind==='Raw').map((l:RecipeLine)=>l.GradePath)).toEqual(['0/1']);
 await sheet.getByLabel('Restore captured grade',{exact:true}).selectOption('0/2');
 await expect(sheet.getByRole('button',{name:'Remove grade Almonds',exact:true})).toBeEnabled();
 await expect(sheet.getByLabel('Ratio line 2',{exact:true})).toHaveValue('0.00');
 await expect(sheet.locator('.npd-sheet-header').getByText('10.000',{exact:true})).toBeVisible();
});

test('recipe MOQ follows captured grade proportions, independently of editable sheet ratios',()=>{
 const source={AnnualUnit:100000,EstPctAwarded:50,WeightGrams:200,GradeSnapshot:JSON.stringify(grades)};
 const a:RecipeLine={Kind:'Raw',GradePath:'0/1',IngredientID:null,PriceID:null,RatioPct:'95',LossPct:'0'};
 expect(recipeMT(source,[a])).toBe(6);expect(recipeMT(source,[{...a,RatioPct:'80'}])).toBe(6);
 expect(recipeMT(source,[{...a,GradePath:'0/2'}])).toBe(4);
 expect(recipeMT(source,[a,{...a,GradePath:'0/2',RatioPct:'0'}])).toBe(10);
});


test('request detail keeps a compact header and version metadata with inline creation',async({page})=>{
 await setup(page,'member','Pending');
 await page.route('**/api/npd/requests/1/items',route=>route.fulfill({json:{rows:[{...item,LatestSheetApprovalStatus:'Pending',SheetVersions:[{ID:21,SheetNumber:'RCP-1',Revision:1,PIC:'npd.member',Status:'Price Ready',ApprovalStatus:'Pending',CreatedAt:'2026-11-01T01:00:00',UpdatedAt:'2026-11-02T02:00:00'}]}]}}));
 await page.getByRole('navigation').getByRole('button',{name:'Recipe Requests',exact:true}).click();await page.getByRole('button',{name:'RRQ-1',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'RRQ-1',exact:true}),versions=dialog.getByRole('table',{name:'Recipe Sheet versions for PRD-1',exact:true});
 for(const name of ['PIC','Created Date','Updated Date'])await expect(versions.getByRole('columnheader',{name,exact:true})).toBeVisible();
 await expect(versions.getByText('npd.member',{exact:true})).toBeVisible();await expect(versions.locator('.npd-version-date').first()).toContainText('2026');
 await expect(dialog.getByRole('button',{name:'Open RCP-1',exact:true})).toHaveCount(0);await expect(dialog.getByRole('button',{name:'Add new Recipe Sheet for PRD-1',exact:true})).toBeDisabled();
 for(const width of [1920,1440]){
  await page.setViewportSize({width,height:1000});const header=dialog.locator('.npd-item-header');
  const boxes=await header.locator(':scope>h3,:scope>label').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().top+el.getBoundingClientRect().height/2));expect(Math.max(...boxes)-Math.min(...boxes)).toBeLessThan(2);
  expect(await header.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
  const status=dialog.locator('.npd-item-status');expect(await status.evaluate(el=>el.scrollHeight-el.clientHeight)).toBeLessThanOrEqual(1);
 }
 await dialog.getByRole('button',{name:'Close recipe request',exact:true}).click();
 await page.route('**/api/npd/requests/1/items',route=>route.fulfill({json:{rows:[{...item,HasWorkingSheet:false,IsLinked:true,SheetVersions:[]}]}}));
 await page.getByRole('button',{name:'RRQ-1',exact:true}).click();await expect(dialog.getByText('No Recipe Sheets yet.',{exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Add new Recipe Sheet for PRD-1',exact:true})).toBeEnabled();
});


test('Recipe Request layout saves columns, filters, order and sorting to the profile',async({page})=>{
 await setup(page,'manager');let settings:any={},version=0;const queries:URLSearchParams[]=[];
 await page.route('**/api/workbench/preferences',route=>{if(route.request().method()==='POST'){const body=route.request().postDataJSON();settings=body.settings;version++;}return route.fulfill({json:{settings,version}})});
 await page.route('**/api/npd/requests?**',route=>{queries.push(new URL(route.request().url()).searchParams);return route.fulfill({json:{rows:[request],total:1}})});
 await page.getByRole('navigation').getByRole('button',{name:'Recipe Requests',exact:true}).click();await page.getByRole('button',{name:'Recipe Request layout',exact:true}).click();
 const layout=page.getByRole('complementary',{name:'Recipe Request layout',exact:true});
 await layout.getByRole('group',{name:'Visible columns',exact:true}).getByLabel('Customer',{exact:true}).uncheck();
 await layout.getByRole('group',{name:'Visible filters',exact:true}).getByLabel('Status',{exact:true}).check();await layout.getByRole('group',{name:'Visible filters',exact:true}).getByLabel('Created by',{exact:true}).check();
 await layout.getByRole('button',{name:'Move Request right',exact:true}).click();await layout.getByLabel('Records per page',{exact:true}).fill('5');await layout.getByLabel('Records per page',{exact:true}).press('Enter');
 await layout.getByRole('button',{name:'Close layout',exact:true}).click();
 const table=page.getByRole('table',{name:'Recipe Requests',exact:true});await expect(table.getByRole('columnheader',{name:'Customer',exact:true})).toHaveCount(0);await expect(table.getByRole('columnheader').first()).toHaveAccessibleName('Items');
 await page.getByRole('button',{name:'Sort by Items',exact:true}).click();await expect.poll(()=>queries.at(-1)?.get('sort')).toBe(JSON.stringify([{column:'ItemCount',direction:'asc'}]));
 await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('Open');await page.getByLabel('Created by',{exact:true}).fill('sales');await page.getByRole('button',{name:'Search',exact:true}).click();await expect.poll(()=>queries.at(-1)?.get('created_by')).toBe('sales');expect(queries.at(-1)?.get('status')).toBe('Open');expect(queries.at(-1)?.get('page_size')).toBe('5');
 await page.getByRole('button',{name:'Recipe Request layout',exact:true}).click();await layout.getByRole('button',{name:'Save layout to profile',exact:true}).click();await expect(layout.getByText('Layout and sort saved.',{exact:true})).toBeVisible();
 expect(settings.recipe_requests.header).toMatchObject({page_size:5,filters:['search','status','created_by'],sort:[{column:'ItemCount',direction:'asc'}],values:{status:'Open',created_by:'sales'}});expect(settings.recipe_requests.header.columns[0]).toBe('ItemCount');
 await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('navigation').getByRole('button',{name:'Recipe Requests',exact:true}).click();await expect(page.getByLabel('Created by',{exact:true})).toHaveValue('sales');await expect(table.getByRole('columnheader',{name:'Customer',exact:true})).toHaveCount(0);await expect(table.getByRole('button',{name:'RRQ-1',exact:true})).toBeVisible();
});

test('Recipe item layout filters and sorts all items before paging and saves separately',async({page})=>{
 await setup(page,'manager');let saved:any;
 await page.route('**/api/workbench/preferences',route=>{if(route.request().method()==='POST')saved=route.request().postDataJSON().settings;return route.fulfill({json:{settings:saved??{},version:saved?1:0}})});
 await page.route('**/api/npd/requests/1/items',route=>route.fulfill({json:{rows:[{...item,ID:11,ProductCode:'PRD-LARGE',EstimatedAwardedMT:'10'},{...item,ID:12,ProductCode:'PRD-SMALL',EstimatedAwardedMT:'2'},{...item,ID:13,ProductCode:'PRD-OTHER',PIC:'other',EstimatedAwardedMT:'1'}]}}));
 await page.getByRole('navigation').getByRole('button',{name:'Recipe Requests',exact:true}).click();await page.getByRole('button',{name:'View items for RRQ-1',exact:true}).click();
 const list=page.getByRole('region',{name:'Items for RRQ-1',exact:true}),table=list.getByRole('table',{name:'Recipe Request items',exact:true});
 await list.getByRole('button',{name:'Recipe item layout',exact:true}).click();const layout=list.getByRole('complementary',{name:'Recipe item layout',exact:true});
 await layout.getByRole('group',{name:'Visible columns',exact:true}).getByLabel('Special comments',{exact:true}).uncheck();await layout.getByRole('group',{name:'Visible filters',exact:true}).getByLabel('PIC',{exact:true}).check();await layout.getByLabel('Records per page',{exact:true}).fill('1');await layout.getByLabel('Records per page',{exact:true}).press('Enter');await layout.getByRole('button',{name:'Close layout',exact:true}).click();
 await list.getByLabel('PIC',{exact:true}).fill('npd.member');await list.getByRole('button',{name:'Search',exact:true}).click();await table.getByRole('button',{name:'Sort by Estimated awarded MT',exact:true}).click();
 await expect(table.getByRole('button',{name:'Open Recipe Request item PRD-SMALL',exact:true})).toBeVisible();await expect(table.getByRole('columnheader',{name:'Special comments',exact:true})).toHaveCount(0);
 await list.getByRole('button',{name:'Next',exact:true}).click();await expect(table.getByRole('button',{name:'Open Recipe Request item PRD-LARGE',exact:true})).toBeVisible();
 await list.getByRole('button',{name:'Recipe item sort',exact:true}).click();const sort=list.getByRole('complementary',{name:'Recipe item sort',exact:true});await sort.getByLabel('Sort direction 1',{exact:true}).selectOption('desc');await expect(list.getByLabel('Rows per page',{exact:true})).toHaveValue('1');await expect(table.getByRole('button',{name:'Open Recipe Request item PRD-LARGE',exact:true})).toBeVisible();await sort.getByRole('button',{name:'Save layout to profile',exact:true}).click();await expect(sort.getByText('Layout and sort saved.',{exact:true})).toBeVisible();
 expect(saved.recipe_requests.items).toMatchObject({page_size:1,filters:['pic'],values:{pic:'npd.member'},sort:[{column:'EstimatedAwardedMT',direction:'desc'}]});expect(saved.recipe_requests.header).toBeUndefined();
});
