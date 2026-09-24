import {test,expect,type Page} from '@playwright/test';
const rv='AAAAAAAAAAE=';
const header={PackagingType:'Pouch',OpportunityID:1,OpportunityNumber:'OPP-2026-00001',CustomerName:'Northstar Foods',OpportunityDesc:'Autumn retail range',BidOpen:'2026-09-01',BidClose:'2026-10-15',HeaderStage:'Draft',HeaderRowVersion:rv};
const opps=[{...header,ItemID:11,ProductCode:'P-101',ItemDescription:'Roasted almonds',AnnualUnit:12000,ItemStage:'Draft',ItemRowVersion:rv},{...header,ItemID:12,ProductCode:'P-102',ItemDescription:'Cashew assortment',AnnualUnit:9000,ItemStage:'Draft',ItemRowVersion:rv}];
const request={RequestID:5,RequestNumber:'PKG-00005',OpportunityNumber:header.OpportunityNumber,CustomerName:header.CustomerName,ResponseDue:'2026-10-01',RequestedByName:'Sales',ItemCount:2,Unassigned:1,RequestStatus:'Open'};
const reqItems=[{...request,ItemID:101,ProductCode:'P-101',ItemDescription:'Roasted almonds',PackagingRequirement:'Recyclable carton',ItemStage:'Assigned',PICUserID:null,PIC:null,ItemRowVersion:rv},{...request,ItemID:102,ProductCode:'P-102',ItemDescription:'Cashew assortment',PackagingRequirement:'',ItemStage:'Approved',PICUserID:2,PIC:'Packaging User',ItemRowVersion:rv}];
async function mock(page:Page,scopes=['Admin']) {
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());let body:unknown;
  if(url.pathname.endsWith('/session'))body={username:'Admin',scopes,is_admin:scopes.includes('Admin')};
  else if(url.pathname==='/api/opportunity/grid')body={rows:opps,total:1,page:1};
  else if(url.pathname==='/api/workbench/requests')body={rows:[request],total:1,page:1};
  else if(url.pathname==='/api/workbench/pics')body={rows:[{ID:2,UserName:'Packaging User'}]};
  else if(url.pathname==='/api/packaging/requests')body={rows:reqItems,total:2,page:1};
  else if(url.pathname.endsWith('/attachments'))body={rows:[]};
  else return route.fulfill({status:500,json:{detail:'Unexpected mock endpoint: '+url.pathname}});
  return route.fulfill({json:body});
 });
}
test('active request blocks selection until its item completes or cancels',async({page})=>{
 await mock(page);let active=true;
 await page.route('**/api/opportunity/grid?**',route=>route.fulfill({json:{rows:opps.map((r,i)=>({...r,HasOpenPackagingRequest:i===0&&active,OpenPackagingRequestNumber:i===0&&active?'PKG-009':null,OpenPackagingRequestStage:i===0&&active?'Pending Review':null})),total:1,page:1}}));
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'View details'}).click();await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 await expect(page.getByRole('checkbox',{name:'Select P-101 item 11'})).toBeDisabled();
 await expect(page.getByText('PKG-009 · Pending Review')).toBeVisible();
 await expect(page.getByRole('checkbox',{name:'Select P-102 item 12'})).toBeEnabled();
 active=false;await page.getByRole('button',{name:'Refresh Opportunities'}).click();await page.getByRole('button',{name:'View details'}).click();await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 await expect(page.getByRole('checkbox',{name:'Select P-101 item 11'})).toBeEnabled();
});
test('items are boxed and request box follows selection without losing entered notes',async({page})=>{
 await mock(page);await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'View details'}).click();await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 await expect(page.locator('.opportunity-items-box')).toHaveClass(/panel/);
 const requestBox=page.getByRole('region',{name:'Packaging request',exact:true});
 await expect(requestBox).toHaveCount(0);
 const item=page.getByRole('checkbox',{name:'Select P-101 item 11'});
 await item.check();await expect(requestBox).toBeVisible();
 await page.getByLabel('Request notes',{exact:true}).fill('Keep this note');
 await item.uncheck();await expect(requestBox).toHaveCount(0);
 await item.check();await expect(page.getByLabel('Request notes',{exact:true})).toHaveValue('Keep this note');
 await expect(page.getByRole('button',{name:'Item layout',exact:true})).toBeVisible();
});
test('browse details, filter, select a subset and create exactly that subset',async({page})=>{
 await mock(page);let payload:any;
 await page.route('**/api/packaging/manual',async route=>{payload=route.request().postDataJSON();await route.fulfill({json:{header:{RequestNumber:'PKG-00006'},items:payload.items,replayed:false}})});
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByLabel('Customer',{exact:true}).fill('North');
 const requested=page.waitForRequest(r=>r.url().includes('customer_name=North'));
 await page.getByRole('button',{name:'Apply filters'}).click();await requested;
 await page.getByRole('button',{name:'View details'}).click();await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 await expect(page.getByText('Roasted almonds')).toBeVisible();
 await page.getByRole('checkbox',{name:'Select P-101 item 11'}).check();
 await page.getByLabel('Response due',{exact:true}).fill('2099-10-01');
 await page.getByLabel('Requirement 11').fill('Recyclable carton');
 await page.getByRole('button',{name:'Create Packaging Request (1)'}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 expect(payload).toBeUndefined();
 await page.getByRole('button',{name:'Create request',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('PKG-00006');
 expect(payload.items).toEqual([{OpportunityItemID:11,ExpectedRowVersion:rv,PackagingRequirement:'Recyclable carton'}]);
 expect(payload.ExpectedRowVersion).toBe(rv);
 expect(payload.CreationKey).toMatch(/^[0-9a-f-]{36}$/);
});
test('lost create reply retains payload across reload and retries the same key',async({page})=>{
 await mock(page);const payloads:any[]=[];
 await page.route('**/api/packaging/manual',async route=>{payloads.push(route.request().postDataJSON());if(payloads.length===1)return route.abort('failed');return route.fulfill({json:{header:{RequestNumber:'PKG-00006'},items:payloads[1].items,replayed:true}})});
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'View details'}).click();await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 await page.getByRole('checkbox',{name:'Select P-101 item 11'}).check();
 await page.getByLabel('Response due',{exact:true}).fill('2099-10-01');
 await page.getByRole('button',{name:'Create Packaging Request (1)'}).click();
 await page.getByRole('button',{name:'Create request',exact:true}).click();
 await expect(page.getByRole('button',{name:'Retry saved request'})).toBeVisible();
 await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Retry saved request'}).click();
 await expect(page.getByRole('status')).toContainText('recovered');
 expect(payloads[1]).toEqual(payloads[0]);
});
test('manager assigns an item with its RowVersion and locked items cannot be assigned',async({page})=>{
 await mock(page,['PackagingManager']);let payload:any;
 await page.route('**/api/packaging/items/101/assign',async route=>{payload=route.request().postDataJSON();return route.fulfill({json:{result:{ID:101,RowVersion:'AAAAAAAAAAI='}}})});
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'View request'}).click();
 await page.getByLabel('PIC for item 101').selectOption('2');
 await expect(page.getByLabel('PIC for item 102')).toBeDisabled();
 await page.getByRole('button',{name:'Assign',exact:true}).first().click();
 await page.getByRole('button',{name:'Confirm assignment'}).click();
 await expect(page.getByRole('status')).toContainText('PIC assigned');
 expect(payload).toEqual({PICUserID:2,ExpectedRowVersion:rv});
});
test('sales can read requests but cannot assign PICs',async({page})=>{
 await mock(page,['Opportunity']);await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Packaging requests'}).click();
 await page.getByRole('button',{name:'View request'}).click();
 await expect(page.getByLabel('PIC for item 101')).toBeDisabled();
});
test('assignment conflict preserves the old PIC and shows refresh guidance',async({page})=>{
 await mock(page);await page.route('**/api/packaging/items/101/assign',route=>route.fulfill({status:409,json:{detail:'Conflict: stale RowVersion.'}}));
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Packaging requests'}).click();await page.getByRole('button',{name:'View request'}).click();
 await page.getByLabel('PIC for item 101').selectOption('2');await page.getByRole('button',{name:'Assign',exact:true}).first().click();await page.getByRole('button',{name:'Confirm assignment'}).click();
 await expect(page.getByRole('alert')).toContainText('Refresh request items');
 await expect(page.getByRole('status')).toHaveCount(0);
});
test('mobile layout has no page overflow and screenshot',async({page})=>{
 await mock(page);await page.setViewportSize({width:390,height:844});await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('button',{name:'View details'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
 await page.screenshot({path:'test-results/mobile.png',fullPage:true});
});
test('desktop screenshot and editable page size reaches API',async({page})=>{
 await mock(page);await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'View details'}).click();await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 await page.screenshot({path:'test-results/opportunities.png',fullPage:true});
 const requested=page.waitForRequest(r=>r.url().includes('page_size=10'));
 await page.getByLabel('Rows per page').fill('10');await page.getByLabel('Rows per page').press('Enter');await requested;
});
test('missing Packaging type blocks request creation before posting',async({page})=>{
 await mock(page);
 await page.route('**/api/opportunity/grid?**',route=>route.fulfill({json:{rows:opps.map(r=>({...r,PackagingType:null})),total:1,page:1}}));
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'View details'}).click();await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 await page.getByRole('checkbox',{name:'Select P-101 item 11'}).check();
 await page.getByLabel('Response due').fill('2026-10-01');
 await page.getByRole('button',{name:'Create Packaging Request (1)'}).click();
 await expect(page.getByRole('alert')).toContainText('Enter Packaging type');
 await expect(page.getByRole('dialog')).toHaveCount(0);
});
