import {test,expect,type Page,type Locator} from '@playwright/test';
const rv='AAAAAAAAAAE=';
const view=(columns:string[])=>({columns,sort:[],filters:[],values:{},field_version:3,column_widths:{...Object.fromEntries(columns.map(c=>[c,500])),_Actions:140,_Documents:180}});
async function setup(page:Page){
 const writes:string[]=[];
 const settings={columns:['CustomerName','MarketCode','CurrencyCode','Status'],filters:[],sort:[],page_size:25,column_widths:{CustomerName:600,MarketCode:600,CurrencyCode:600,Status:300,_Actions:140},
  requests:{header:view(['RequestNumber','OpportunityNumber','CustomerName','ResponseDue','RequestStatus']),items:view(['ProductCode','ItemDescription','AnnualUnit','ItemStage'])},
  opportunity:{header:view(['OpportunityNumber','CustomerName','OpportunityDesc','BidOpen','BidClose','HeaderStage']),items:view(['ProductCode','ItemDescription','AnnualUnit','ItemStage','ConfigurationRequest','PackagingType','SpecialComments'])},
  masters:{materials:{...view(['MaterialCode','MaterialName','Description','UnitOfMeasure','Status']),page_size:25}}
 };
 let profile={settings,version:0};
 const opportunity={OpportunityID:1,OpportunityNumber:'OPP-1',HeaderStage:'Draft',HeaderRowVersion:rv,CustomerID:1,CustomerName:'Customer',CustomerCurrencyCode:'USD',ExchangeRateVNDPerUSD:25000,ExchangeRateCustomerCurrencyPerUSD:1,OpportunityDesc:'Launch',BidOpen:'2026-10-01',BidClose:'2026-10-10',ItemID:1,ProductID:2,ProductCode:'PRD-2',ProductName:'Almonds',ItemDescription:'Pack',ItemStage:'Draft',ItemRowVersion:rv,AnnualUnit:100};
 await page.route('**/api/**',route=>{
  const p=new URL(route.request().url()).pathname;
  if(route.request().method()!=='GET')writes.push(p);
  if(p.endsWith('/session'))return route.fulfill({json:{username:'Admin',user_id:1,scopes:['Admin'],is_admin:true}});
  if(p.endsWith('/preferences')){
   if(route.request().method()==='POST')profile={settings:route.request().postDataJSON().settings,version:profile.version+1};
   return route.fulfill({json:profile});
  }
  if(p==='/api/opportunity/grid')return route.fulfill({json:{rows:[opportunity],total:1,page:1}});
  if(p==='/api/opportunity/lookups')return route.fulfill({json:{customers:[{ID:1,CustomerName:'Customer',CustomerCurrencyCode:'USD'}],products:[{ID:2,CustomerID:1,ProductCode:'PRD-2',ProductName:'Almonds'}]}});
  if(p==='/api/workbench/requests')return route.fulfill({json:{rows:[{RequestID:1,RequestNumber:'PCR-1',OpportunityNumber:'OPP-1',CustomerName:'Customer',RequestStatus:'Open',ItemCount:1}],total:1}});
  if(p==='/api/packaging/requests')return route.fulfill({json:{rows:[{RequestID:1,ItemID:1,ProductCode:'PRD-2',ItemDescription:'Pack',ItemStage:'Assigned',ItemRowVersion:rv}],total:1}});
  if(p==='/api/customer')return route.fulfill({json:{rows:[{ID:1,CustomerName:'Customer',MarketCode:'US',CurrencyCode:'USD',Status:'Active',RowVersion:rv}],total:1}});
  if(p==='/api/customer/lookups')return route.fulfill({json:{markets:[],currencies:[]}});
  if(p==='/api/workbench/masters/materials')return route.fulfill({json:{rows:[{ID:3,MaterialCode:'BAG',MaterialName:'Paper bag',UnitOfMeasure:'EA',Status:'Active',RowVersion:rv}],total:1}});
  if(p==='/api/workbench/masters/lookups')return route.fulfill({json:{materials:[],currencies:[],creators:[],uoms:[{ID:1,UoMCode:'EA',Status:'Active'}]}});
  return route.fulfill({json:{rows:[],total:0,packagingTypes:[]}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 return writes;
}
async function assertPinned(table:Locator,control:Locator){
 await expect(table).toHaveClass(/pin-first-column/);
 expect(await control.evaluate(el=>el.closest('td')?.cellIndex)).toBe(0);
 const wrap=table.locator('..');
 expect(await wrap.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
 const before=await control.boundingBox();
 await wrap.evaluate(el=>{el.scrollLeft=el.scrollWidth});
 expect(await wrap.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
 await expect(control).toBeInViewport();
 const after=await control.boundingBox();
 expect(Math.abs(after!.x-before!.x)).toBeLessThan(2);
 expect(await control.evaluate(el=>{const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!hit&&(hit===el||el.contains(hit))})).toBe(true);
}
test('Packaging Request ID is first and clickable without horizontal scrolling, then stays pinned',async({page},info)=>{
 const writes=await setup(page);
 await page.getByRole('button',{name:'Packaging requests',exact:true}).click();
 const table=page.getByRole('table',{name:'Packaging requests',exact:true}),edit=table.getByRole('button',{name:'Edit request PCR-1',exact:true});
 await expect(edit).toBeInViewport();
 await expect(table.locator('colgroup col').first()).toHaveCSS('width','500px');
 await expect(table.getByRole('columnheader').first()).toContainText('Request');
 await assertPinned(table,edit);
 await table.locator('..').screenshot({path:info.outputPath('pinned-request-actions.png')});
 await edit.click();await expect(page.getByRole('dialog',{name:'Edit Packaging request',exact:true})).toBeVisible();
 expect(writes.filter(p=>p.endsWith('/preferences'))).toHaveLength(0);
});
test('Opportunity Edit stays first and mix selection controls remain pinned',async({page})=>{
 await setup(page);
 const table=page.getByRole('table',{name:'Opportunity overview',exact:true});
 await assertPinned(table,table.getByRole('button',{name:'Edit Opportunity OPP-1',exact:true}));
 await table.getByRole('button',{name:'View details',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 const items=page.getByRole('table',{name:'Opportunity items',exact:true}),select=items.getByRole('checkbox',{name:'Select PRD-2 item 1',exact:true});
 await assertPinned(items,select);
 await select.check();await expect(select).toBeChecked();
});
test('Customer Edit remains pinned and saved data-column order starts after Actions',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Customers',exact:true}).click();
 const table=page.getByRole('table'),edit=table.getByRole('button',{name:'Edit Customer',exact:true});
 await expect(table.getByRole('columnheader').nth(1)).toContainText('Customer');
 await assertPinned(table,edit);
 await edit.click();await expect(page.getByRole('dialog')).toBeVisible();
});
test('master Edit stays pinned while data columns scroll',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Packaging Material',exact:true}).click();
 const table=page.getByRole('table'),edit=table.getByRole('button',{name:'Edit material 3',exact:true});
 await assertPinned(table,edit);
 await edit.click();await expect(page.getByRole('dialog',{name:'Edit material',exact:true})).toBeVisible();
});
test('request Review controls are first and selected-row backgrounds remain opaque in both themes',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Packaging requests',exact:true}).click();
 await page.getByRole('button',{name:'View request',exact:true}).click();
 const header=page.getByRole('table',{name:'Packaging requests',exact:true}),items=page.getByRole('table',{name:'Packaging request items',exact:true});
 await expect(items.getByRole('columnheader').first()).toContainText('Review');
 const documents=items.getByLabel('PIC for item 1',{exact:true});await documents.scrollIntoViewIfNeeded();await assertPinned(items,documents);
 const cell=header.locator('tbody tr.selected td').first();
 expect(await cell.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(237, 245, 238)');
 await page.getByRole('button',{name:'Dark mode',exact:true}).click();
 expect(await cell.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(44, 68, 55)');
});
