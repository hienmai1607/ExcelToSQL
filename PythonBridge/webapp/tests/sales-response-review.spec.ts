import {test,expect,type Page} from '@playwright/test';

const version='AAAAAAAAAAE=';
const item={ItemID:11,ItemNumber:'1',ProductID:2,OpportunityID:1,OpportunityNumber:'OPP-SALES',CustomerID:1,CustomerName:'Customer',HeaderStage:'Draft',ItemStage:'Draft',HeaderRowVersion:version,ItemRowVersion:version,ProductCode:'PRD-1',ProductName:'Review product',AnnualUnit:1000,WeightGrams:200,RequestedLayerCount:2,PackagingLayerCount:2,RecipeRequestID:5,RecipeRequestItemID:6,RecipeRequestNumber:'RRQ-5',RecipeSheetID:7,RecipeSheetNumber:'RCP-OLD',HasLinkedRecipeRequest:true,ProductGradeSnapshot:JSON.stringify({RequiresRecipeConfirmation:true,items:[{ParentID:'0',ID:1,Grade:'Cashews',RatioPct:100,RawGradeID:1}]})};
async function setup(page:Page,canReview=true){
 let state='Pending';const writes:Record<string,unknown>[]=[];
 const review=(kind:string)=>({ID:kind==='packaging'?20:8,Kind:kind,OpportunityItemID:11,RequestID:kind==='packaging'?4:5,RequestNumber:kind==='packaging'?'PCR-4':'RRQ-5',SheetNumber:kind==='recipe'?'RCP-NEW':undefined,RowVersion:version,Stage:state==='Accepted'?'Approved':state==='Returned'?'Returned':'Awaiting Sales',ApprovalStatus:'Approved',SalesReviewStatus:state,CanReview:canReview&&state==='Pending',PIC:'Packaging PIC',ApprovedByName:'Manager',GroupVersions:{20:version,21:version}});
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Sales',user_id:10,is_admin:true,scopes:['Admin']}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/opportunity/grid')return route.fulfill({json:{rows:[{...item,PackagingRequestID:state==='Accepted'?4:3,PackagingRequestNumber:state==='Accepted'?'PCR-4':'PCR-OLD'}],total:1,page:1}});
  if(path==='/api/workbench/requests')return route.fulfill({json:{rows:[{RequestID:4,RequestNumber:'PCR-4',OpportunityNumber:'OPP-SALES',Status:'Open'}],total:1,page:1}});
  if(path==='/api/npd/lookups')return route.fulfill({json:{units:[],vendors:[],currencies:[],ingredients:[],members:[]}});
  if(path==='/api/npd/requests/5')return route.fulfill({json:{row:{ID:5,RequestNumber:'RRQ-5',OpportunityNumber:'OPP-SALES',CustomerName:'Customer'}}});
  if(path==='/api/npd/requests/5/items')return route.fulfill({json:{rows:[]}});
  if(path==='/api/npd/sheets/8')return route.fulfill({json:{row:{ID:8,SheetNumber:'RCP-NEW',RequestNumber:'RRQ-5',Revision:2,RequestItemID:6,Status:'Price Ready',ApprovalStatus:'Approved',SalesReviewStatus:'Pending',RowVersion:version,WeightGrams:200,AnnualUnit:1000,EstPctAwarded:50,ExchangeRateVNDPerUSD:26500,GradeSnapshot:JSON.stringify({items:[]}),ProductCode:'PRD-1',ProductName:'Review product'},lines:[],calculation:{Lines:[],Warnings:[],Issues:[]}}});
  if(path==='/api/opportunity/response-reviews')return route.fulfill({json:{packaging:[review('packaging')],recipe:[review('recipe')]}});
  if(path.startsWith('/api/opportunity/response-reviews/')){
   if(route.request().method()==='POST'){const body=route.request().postDataJSON();writes.push(body);state=body.Action==='Accept'?'Accepted':'Returned';return route.fulfill({json:{status:state}})}
   return route.fulfill({json:path.includes('/recipe/')?{rows:[{ID:8}],calculation:{SeasoningRatio:5,SeasoningUSDPerLb:0.2,SeasoningLossPct:1,Lines:[{Description:'Salt',RatioPct:5,USDPerKg:2,TotalQtyMT:0.01}]}}:{rows:[{ID:20,ProductCode:'MIX-PARENT',ProductName:'Mix family',ResponseLayerCount:1,LayerPrices:[{PackagingOrder:'Quaternary',PackagingTypeName:'Outer carton',FinalMOQ:100,UnitPrice:2,CurrencyCode:'USD'}]},{ID:21,ProductCode:'MIX-CHILD',ProductName:'Child packaging',ResponseLayerCount:3}]}});
  }
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'View details',exact:true}).click();
 return writes;
}

test('Packaging Request combines the response and confirms a whole family acceptance',async({page},info)=>{
 const writes=await setup(page);const items=page.locator('.opportunity-items');
 await expect(items.getByRole('button',{name:'Packaging Responses',exact:true})).toHaveCount(0);
 await items.getByRole('button',{name:'Packaging Request',exact:true}).click();
 await expect(items.getByRole('columnheader',{name:'Response / Sales review'})).toBeVisible();
 await expect(items.getByRole('button',{name:'View Packaging Request PCR-OLD'})).toBeVisible();
 await page.getByRole('button',{name:'View Packaging Request PCR-4 for Sales review'}).click();
 const requestView=page.getByRole('dialog',{name:'Packaging request view'});
 await expect(requestView.getByRole('heading',{name:'PCR-4',exact:true})).toBeVisible();
 await expect(requestView.getByRole('button',{name:'Review & save'})).toHaveCount(0);
 await requestView.getByRole('button',{name:/Close/}).first().click();
 await page.getByRole('button',{name:'View packaging response 20'}).click();
 const dialog=page.getByRole('dialog',{name:'Sales response review'});
 await expect(dialog.getByText('MIX-PARENT · Mix family')).toBeVisible();
 await expect(dialog.getByText('MIX-CHILD · Child packaging')).toBeVisible();
 for(const width of [1920,1440]){
  await page.setViewportSize({width,height:1080});
  expect(await dialog.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
 }
 await page.screenshot({path:info.outputPath('sales-packaging-review-1440.png')});
 await dialog.getByRole('button',{name:'Accept response',exact:true}).click();
 expect(writes).toHaveLength(0);
 await dialog.getByRole('button',{name:'Confirm accept'}).click();
 await expect(dialog).toHaveCount(0);await expect(items.getByText('Accepted',{exact:true})).toBeVisible();
 await expect(items.locator('.sales-review-cell').getByRole('button')).toHaveCount(0);
 await expect(items.getByRole('button',{name:'View Packaging Request PCR-4'})).toBeVisible();
 expect(writes[0]).toMatchObject({Action:'Accept',RowVersion:version,GroupVersions:{20:version,21:version}});
});

test('Sales return requires a reason and keeps the Opportunity item view open',async({page})=>{
 const writes=await setup(page);await page.locator('.opportunity-items').getByRole('button',{name:'Packaging Request',exact:true}).click();
 await page.getByRole('button',{name:'View packaging response 20'}).click();
 const dialog=page.getByRole('dialog',{name:'Sales response review'});
 await expect(dialog.getByRole('button',{name:'Return response'})).toBeDisabled();
 await dialog.getByLabel('Sales review note',{exact:true}).fill('Revise the outer carton.');
 await dialog.getByRole('button',{name:'Return response'}).click();await dialog.getByRole('button',{name:'Confirm return'}).click();
 await expect(page.locator('.opportunity-items').getByText('Returned',{exact:true})).toBeVisible();
 expect(writes[0]).toMatchObject({Action:'Return',Comment:'Revise the outer carton.'});
});

test('Recipe review keeps the current accepted link separate from the proposed replacement',async({page})=>{
 const writes=await setup(page);await page.locator('.opportunity-items').getByRole('button',{name:'Recipe Request',exact:true}).click();
 await expect(page.getByRole('button',{name:'View Recipe Sheet RCP-OLD for item 11'})).toBeVisible();
 await page.getByRole('button',{name:'View Recipe Request RRQ-5 for Sales review'}).click();
 const requestView=page.getByRole('dialog').last();
 await expect(requestView.getByRole('heading',{name:'RRQ-5',exact:true})).toBeVisible();
 await requestView.getByRole('button',{name:/Close/}).first().click();
 await page.getByRole('button',{name:'View Recipe Sheet RCP-NEW for Sales review'}).click();
 const sheetView=page.getByRole('dialog').last();
 await expect(sheetView.getByRole('heading',{name:'RCP-NEW',exact:true})).toBeVisible();
 await expect(sheetView.getByRole('button',{name:'Save sheet',exact:true})).toHaveCount(0);
 await sheetView.getByRole('button',{name:'Close',exact:true}).first().click();
 await page.getByRole('button',{name:'View recipe response 8'}).click();
 const dialog=page.getByRole('dialog',{name:'Sales response review'});
 await expect(dialog.getByRole('heading',{name:'RCP-NEW'})).toBeVisible();await expect(dialog.getByRole('cell',{name:'Salt',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Accept response'}).click();await dialog.getByRole('button',{name:'Confirm accept'}).click();
 await expect(dialog).toHaveCount(0);expect(writes[0].Action).toBe('Accept');
 await expect(page.locator('.sales-review-cell').getByRole('button')).toHaveCount(0);
});

test('Other viewers can inspect manager-approved results without Sales decision controls',async({page})=>{
 await setup(page,false);await page.locator('.opportunity-items').getByRole('button',{name:'Packaging Request',exact:true}).click();
 await page.getByRole('button',{name:'View packaging response 20'}).click();
 const dialog=page.getByRole('dialog',{name:'Sales response review'});
 await expect(dialog.getByRole('heading',{name:/PCR-4/})).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Accept response'})).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'Return response'})).toHaveCount(0);
});
