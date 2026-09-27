import {test,expect,type Page} from '@playwright/test';
const rv='AAAAAAAAAAE=';
const header={CustomerCurrencyCode:'USD',ExchangeRateVNDPerUSD:25000,ExchangeRateCustomerCurrencyPerUSD:1,OpportunityID:1,OpportunityNumber:'OPP-1',CustomerID:1,CustomerName:'Northstar',OpportunityDesc:'Retail',BidOpen:'2026-09-01',BidClose:'2026-10-01',HeaderStage:'Draft',HeaderRowVersion:rv};
const rows=[
 {...header,ItemID:11,ProductName:'Roasted almonds',WeightGrams:'100.00',ProductID:2,ProductCode:'Almonds',ItemDescription:'Almond pack',AnnualUnit:100,EstPctAwarded:null,ShelfPrice:20,ItemStage:'Draft',ItemRowVersion:'AAAAAAAAAAI='},
 {...header,ItemID:12,ProductID:3,ProductCode:'Cashews',ItemDescription:'Cashew pack',AnnualUnit:5,EstPctAwarded:0,ShelfPrice:3,ItemStage:'Draft',ItemRowVersion:'AAAAAAAAAAM='},
 {...header,ItemID:13,ProductID:4,ProductCode:'Walnuts',ItemDescription:'Walnut pack',AnnualUnit:20,EstPctAwarded:50,ShelfPrice:null,ItemStage:'In progress',ItemRowVersion:'AAAAAAAAAAQ='}
];
async function setup(page:Page,locked=false){
 let profile:any={settings:{dark:false,nav_hidden:false,columns:['CustomerName'],filters:[],sort:[],page_size:25},version:0};
 const writes:any[]=[];
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Sales',user_id:10,scopes:['Opportunity'],is_admin:false}});
  if(path==='/api/workbench/preferences'){if(route.request().method()==='POST')profile={settings:route.request().postDataJSON().settings,version:profile.version+1};return route.fulfill({json:profile})}
  if(path==='/api/opportunity/grid')return route.fulfill({json:{rows:rows.map(r=>({...r,HeaderStage:locked?'In progress':'Draft'})),total:1,page:1}});
  if(path==='/api/opportunity/lookups')return route.fulfill({json:{currencies:[{ID:1,CurrencyCode:'VND',CurrencyName:'Vietnamese Dong'}],customers:[{ID:1,CustomerName:'Northstar',CustomerCurrencyCode:'USD',CurrencyID:2}],products:[{ID:2,CustomerID:1,ProductCode:'Almonds'},{ID:3,CustomerID:1,ProductCode:'Cashews'},{ID:4,CustomerID:1,ProductCode:'Walnuts'},{ID:5,CustomerID:1,ProductCode:'Pecans'}]}});
  if(path==='/api/opportunity/batch'){const body=route.request().postDataJSON();writes.push(body);return route.fulfill({json:{header_results:[{RowNum:1,Status:'OK',OpportunityNumber:'OPP-1'}],item_results:body.item_rows.map((r:any)=>({RowNum:r.RowNum,Status:'OK'}))}})}
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 return {writes,profile:()=>profile};
}
test('layout filters hide clear and restore saved criteria without overview banner',async({page})=>{
 const state=await setup(page);
 await expect(page.getByRole('heading',{name:'Overview',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Opportunity layout',exact:true}).click();
 const layout=page.getByRole('complementary',{name:'Opportunity layout',exact:true});
 const choices=layout.getByRole('group',{name:'Visible filters'});
 await choices.getByLabel('Bid open from',{exact:true}).check();
 await page.getByRole('textbox',{name:'Customer',exact:true}).fill('North');
 await page.getByLabel('Bid open from',{exact:true}).filter({visible:true}).last().fill('2026-09-01');
 await page.getByRole('button',{name:'Apply filters'}).click();
 const cleared=page.waitForRequest(r=>r.url().includes('/api/opportunity/grid')&&!new URL(r.url()).searchParams.has('customer_name'));
 await choices.getByLabel('Customer',{exact:true}).uncheck();await cleared;
 await expect(page.getByRole('textbox',{name:'Customer',exact:true})).toHaveCount(0);
 await layout.getByRole('button',{name:'Save layout to profile'}).click();await expect(layout.getByRole('status')).toContainText('saved');
 expect(state.profile().settings.opportunity.header.values).toEqual({bid_open_from:'2026-09-01'});
 await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByLabel('Bid open from',{exact:true})).toHaveValue('2026-09-01');
 await expect(page.getByRole('textbox',{name:'Customer',exact:true})).toHaveCount(0);
 const clearedAll=page.waitForRequest(r=>r.url().includes('/api/opportunity/grid')&&!new URL(r.url()).searchParams.has('bid_open_from'));
 await page.getByRole('button',{name:'Clear filters'}).click();await clearedAll;
});
test('header edit uses original version and sends no unchanged items',async({page})=>{
 const state=await setup(page);await page.getByRole('button',{name:'Edit Opportunity OPP-1',exact:true}).click();
 const form=page.getByRole('dialog',{name:'Edit Opportunity',exact:true});
 await expect(form.getByRole('button',{name:'Review & save'})).toBeDisabled();
 await form.getByLabel('Description *',{exact:true}).fill('Retail updated');
 await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save'}).click();
 await expect(page.getByRole('status')).toContainText('OPP-1 updated.');
 expect(state.writes[0].header_rows[0]).toMatchObject({ID:1,Command:'U',RowVersion:rv,OpportunityNumber:'OPP-1',OpportunityDesc:'Retail updated'});
 expect(state.writes[0].item_rows).toEqual([]);
});
test('item edit sends changed line version and new items, preserves blanks and locks other stages',async({page})=>{
 const state=await setup(page);await page.getByRole('button',{name:'View details'}).click();await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 await expect(page.getByRole('table',{name:'Opportunity items'}).getByRole('columnheader',{name:'Edit',exact:true})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Select items for packaging'})).toHaveCount(0);
 await expect(page.locator('section.opportunity-items')).not.toHaveClass(/panel/);
 await page.getByRole('button',{name:'Edit Opportunity OPP-1',exact:true}).click();
 const form=page.getByRole('dialog',{name:'Edit Opportunity',exact:true});
 const item=form.getByRole('region',{name:'Item 1',exact:true});
 await item.getByLabel('Annual units *').fill('101');await item.getByLabel('Shelf price').fill('');
 await expect(form.getByRole('region',{name:'Item 3',exact:true}).getByLabel('Annual units *')).toBeDisabled();
 await expect(form.getByRole('button',{name:'Remove item 1',exact:true})).toBeDisabled();
 await form.getByRole('button',{name:'Add item',exact:true}).click();
 const added=form.getByRole('region',{name:'Item 4',exact:true});
 await added.getByLabel('Product *').selectOption('5');await added.getByLabel('Item description *').fill('Pecan pack');await added.getByLabel('Annual units *').fill('50');
 await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save'}).click();
 await expect(page.getByRole('status')).toContainText('updated');
 expect(state.writes[0].item_rows).toHaveLength(2);
 expect(state.writes[0].item_rows[0]).toMatchObject({ID:11,Command:'U',RowVersion:'AAAAAAAAAAI=',AnnualUnit:101,ShelfPrice:null,EstPctAwarded:null});
 expect(state.writes[0].item_rows[1]).toMatchObject({Command:'C',ProductID:5,OpportunityNumber:'OPP-1'});
});
test('conflict retains edits without claiming success',async({page})=>{
 await setup(page);await page.route('**/api/opportunity/batch',route=>route.fulfill({json:{header_results:[{RowNum:1,Status:'ERROR',Message:'Conflict: stale RowVersion. Refresh before retrying.'}],item_results:[]}}));
 await page.getByRole('button',{name:'Edit Opportunity OPP-1',exact:true}).click();
 const form=page.getByRole('dialog',{name:'Edit Opportunity',exact:true});
 await form.getByLabel('Description *',{exact:true}).fill('Keep my changes');
 await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save'}).click();
 await expect(form.getByRole('alert')).toContainText('Conflict');
 await expect(form.getByLabel('Description *',{exact:true})).toHaveValue('Keep my changes');
 await expect(page.getByRole('status')).toHaveCount(0);
});
test('non-Draft header blocks header and item editing',async({page})=>{
 await setup(page,true);await expect(page.getByRole('button',{name:'Edit Opportunity OPP-1',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'View details'}).click();await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 await expect(page.getByRole('button',{name:'Edit Opportunity header',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Edit item 11',exact:true})).toHaveCount(0);
});
test('header and item views persist separately; sorting keeps item selection by ID',async({page})=>{
 const state=await setup(page);
 await page.getByRole('button',{name:'Opportunity sort',exact:true}).click();
 const hs=page.getByRole('complementary',{name:'Opportunity sort',exact:true});
 const request=page.waitForRequest(r=>r.url().includes('/api/opportunity/grid')&&new URL(r.url()).searchParams.get('sort')?.includes('CustomerName')===true);
 await hs.getByLabel('Sort column 1').selectOption('CustomerName');await request;
 await hs.getByRole('button',{name:'Add sort column'}).click();
 await hs.getByRole('button',{name:'Save layout to profile'}).click();await expect(hs.getByRole('status')).toContainText('saved');
 await hs.getByRole('button',{name:'Close sort'}).click();
 await page.getByRole('button',{name:'View details'}).click();await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 await page.getByRole('checkbox',{name:'Select Almonds item 11'}).check();
 const table=page.getByRole('table',{name:'Opportunity items',exact:true});
 await page.getByRole('button',{name:'All Fields',exact:true}).click();
 await table.getByRole('button',{name:'Sort by Shelf price',exact:true}).click();
 await expect(table.locator('tbody tr').first()).toContainText('Cashews');
 await expect(table.locator('tbody tr').last()).toContainText('Walnuts');
 await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 await expect(page.getByRole('checkbox',{name:'Select Almonds item 11'})).toBeChecked();
 await page.getByRole('button',{name:'Item layout',exact:true}).click();
 const layout=page.getByRole('complementary',{name:'Item layout',exact:true});
 await expect(layout.getByLabel('Description',{exact:true})).toBeDisabled();
 await layout.getByLabel('Estimated award %',{exact:true}).uncheck();
 await layout.getByRole('button',{name:'Move Shelf price left',exact:true}).click();
 await layout.getByRole('button',{name:'Save layout to profile'}).click();await expect(layout.getByRole('status')).toContainText('saved');
 expect(state.profile().settings.opportunity.header.sort[0].column).toBe('CustomerName');
 expect(state.profile().settings.opportunity.items.columns).toContain('ItemDescription');
 expect(state.profile().settings.opportunity.items.columns).not.toContain('EstPctAwarded');
 expect(state.profile().settings.columns).toEqual(['CustomerName']);
 await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'View details'}).click();await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 await expect(page.getByRole('table',{name:'Opportunity items',exact:true}).getByRole('button',{name:'Sort by Description',exact:true})).toHaveCount(1);
});
test('item tabs retain selection without removed entry columns; prefix layout survives reload',async({page})=>{
 const state=await setup(page);
 await page.getByRole('button',{name:'View details'}).click();await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 const table=page.getByRole('table',{name:'Opportunity items',exact:true});
 await table.getByRole('checkbox',{name:'Select Almonds item 11'}).check();
 await expect(table.getByRole('columnheader',{name:'Packaging requirement',exact:true})).toHaveCount(0);
 await expect(table.getByRole('columnheader',{name:'Attachments',exact:true})).toHaveCount(0);
 await expect(table.locator('input[type=file]')).toHaveCount(0);
 await page.getByRole('button',{name:'Product Info',exact:true}).click();
 await expect(table.getByRole('columnheader',{name:'Packaging requirement',exact:true})).toHaveCount(0);
 await expect(table.getByRole('button',{name:'Sort by Annual units',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 await expect(table.getByRole('button',{name:'Sort by Annual units',exact:true})).toHaveCount(0);
 await expect(table.getByRole('button',{name:'Sort by Product',exact:true})).toBeVisible();
 await expect(table.getByLabel('Requirement 11',{exact:true})).toHaveCount(0);
 await expect(table.getByRole('checkbox',{name:'Select Almonds item 11'})).toBeChecked();
 await page.getByRole('button',{name:'Item layout',exact:true}).click();
 const layout=page.getByRole('complementary',{name:'Item layout',exact:true});
 await layout.getByLabel('Prefix Annual units',{exact:true}).check();
 await layout.getByLabel('Prefix Description',{exact:true}).uncheck();
 await layout.getByRole('button',{name:'Save layout to profile'}).click();
 await expect(layout.getByRole('status')).toContainText('saved');
 expect(state.profile().settings.opportunity.items.prefix_columns).toEqual(['ProductCode','AnnualUnit']);
 await expect(table.getByRole('button',{name:'Sort by Annual units',exact:true})).toBeVisible();
 await expect(table.getByRole('button',{name:'Sort by Description',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'All Fields',exact:true}).click();
 await expect(table.getByLabel('Requirement 11',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 await expect(table.getByLabel('Requirement 11',{exact:true})).toHaveCount(0);
 await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'View details'}).click();await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 await expect(table.getByRole('button',{name:'Sort by Annual units',exact:true})).toBeVisible();
 await expect(table.getByRole('button',{name:'Sort by Description',exact:true})).toHaveCount(0);
});
test('active Packaging processing locks item entry in the Opportunity editor',async({page})=>{
 await setup(page);
 await page.route('**/api/opportunity/grid?**',route=>route.fulfill({json:{rows:rows.map((r,i)=>({...r,HasOpenPackagingRequest:i===0})),total:1,page:1}}));
 await page.getByRole('button',{name:'Refresh Opportunities'}).click();
 await page.getByRole('button',{name:'Edit Opportunity OPP-1',exact:true}).click();
 const form=page.getByRole('dialog',{name:'Edit Opportunity',exact:true});
 const first=form.getByRole('region',{name:'Item 1',exact:true});
 await expect(first.getByLabel('Annual units *')).toBeDisabled();
 await first.getByText('Packaging requirements',{exact:true}).click();
 await expect(first.getByLabel('Packaging type',{exact:true})).toBeDisabled();
 await expect(form.getByRole('region',{name:'Item 2',exact:true}).getByLabel('Annual units *')).toBeEnabled();
});
test('request box only appears in Packaging tab; Product Info is read-only',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'View details'}).click();
 const table=page.getByRole('table',{name:'Opportunity items',exact:true});
 const box=page.getByRole('region',{name:'Packaging request',exact:true});
 await expect(table.getByRole('checkbox')).toHaveCount(0);
 await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 await expect(box).toHaveCount(0);
 await table.getByRole('checkbox',{name:'Select Almonds item 11'}).check();
 await box.getByLabel('Request notes').fill('Keep this draft');
 await page.getByRole('button',{name:'Product Info',exact:true}).click();
 await expect(box).toHaveCount(0);
 await expect(table.getByText('Roasted almonds',{exact:true})).toBeVisible();
 await expect(table.getByRole('cell',{name:'100',exact:true}).last()).toBeVisible();
 await expect(table.getByRole('textbox')).toHaveCount(0);
 await expect(table.getByRole('checkbox')).toHaveCount(0);
 await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 await expect(table.getByRole('checkbox',{name:'Select Almonds item 11'})).toBeChecked();
 await expect(box.getByLabel('Request notes')).toHaveValue('Keep this draft');
 await page.getByRole('button',{name:'All Fields',exact:true}).click();
 await expect(box).toHaveCount(0);
});
