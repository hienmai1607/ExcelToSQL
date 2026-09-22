import {test,expect,type Page} from '@playwright/test';
const settings={columns:['CustomerName','MarketCode','CurrencyCode','Status','UpdatedAt'],filters:['customer_name','market_id','status'],customer_name:'',market_id:'',status:'',page_size:25,dark:false,nav_hidden:false};
async function mock(page:Page){
 let profile={settings:{...settings},version:0};let exported:any;
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Alice',scopes:['Customer'],is_admin:false}});
  if(path.endsWith('/preferences')){
   if(route.request().method()==='POST'){const body=route.request().postDataJSON();profile={settings:body.settings,version:profile.version+1}}
   return route.fulfill({json:profile});
  }
  if(path==='/api/customer/lookups')return route.fulfill({json:{markets:[{ID:1,MarketCode:'US',MarketName:'United States'}],currencies:[{ID:2,CurrencyCode:'USD',CurrencyName:'US Dollar'}],creators:[{ID:7,UserName:'Alice'}]}});
  if(path==='/api/customer')return route.fulfill({json:{rows:[{ID:1,CustomerName:'Acme',MarketID:1,MarketCode:'US',CurrencyID:2,CurrencyCode:'USD',Status:'Active',RowVersion:'AAAAAAAAAAE=',CreatedAt:'2026-09-19T08:30:00',CreatedByName:'Alice',UpdatedByName:null}],total:1,page:1}});
  if(path.endsWith('/customers/export')){exported=route.request().postDataJSON();return route.fulfill({contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',body:Buffer.from('mock xlsx')})}
  return route.fulfill({json:{rows:[]}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('button',{name:'Dark mode'})).toBeEnabled();
 return {profile:()=>profile,exported:()=>exported};
}
test('saved columns filters and page size restore after reload; export is visible snapshot',async({page})=>{
 const state=await mock(page);await page.getByRole('button',{name:'Layout options'}).click();
 const layout=page.getByRole('complementary',{name:'Customer layout'});
 await layout.getByRole('group',{name:'Visible columns'}).getByLabel('Currency',{exact:true}).uncheck();
 await page.getByLabel('Customer name',{exact:true}).filter({visible:true}).last().fill('Ac');
 await layout.getByRole('group',{name:'Visible filters'}).getByLabel('Market',{exact:true}).uncheck();
 await page.getByLabel('Rows per page').fill('50');await page.getByLabel('Rows per page').press('Enter');
 await layout.getByRole('button',{name:'Save layout to profile'}).click();await expect(page.getByRole('status')).toContainText('saved to your profile');
 expect(state.profile().settings.market_id).toBe('');
 await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('columnheader',{name:'Currency',exact:true})).toHaveCount(0);
 await expect(page.getByLabel('Rows per page')).toHaveValue('50');await expect(page.getByLabel('Customer name',{exact:true})).toHaveValue('Ac');
 await expect(page.getByLabel('Market',{exact:true})).toHaveCount(0);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export current page to Excel'}).click();
 expect((await download).suggestedFilename()).toBe('Customers-current-view.xlsx');
 expect(state.exported()).toEqual({columns:['CustomerName','MarketCode','Status','UpdatedAt'],rows:[['Acme','US','Active',null]]});
});
test('icon rail remains usable; sidebar dark mode and appearance persist',async({page})=>{
 await mock(page);await page.getByRole('button',{name:'Dark mode',exact:true}).click();await page.getByRole('button',{name:'Collapse navigation'}).click();
 await expect(page.getByRole('button',{name:'Dark mode'})).toBeEnabled();await expect(page.getByRole('button',{name:'Save appearance'})).toHaveCount(0);
 await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await expect(page.locator('.sidebar')).toBeVisible();await expect(page.getByRole('button',{name:'Customers',exact:true})).toBeVisible();await expect(page.locator('.nav-text').last()).toBeHidden();await page.getByRole('button',{name:'Expand navigation'}).click();
 await page.getByRole('button',{name:'New customer'}).click();
 await page.getByRole('dialog').getByLabel('Customer name *').fill('Unsaved name');
 await expect(page.getByRole('button',{name:'Hide panel',exact:true})).toHaveCount(0);
 await expect(page.getByText('RECORD PREVIEW')).toHaveCount(0);
 await expect(page.getByRole('dialog').getByLabel('Customer name *')).toHaveValue('Unsaved name');
 await page.screenshot({path:'test-results/customer-dark-panel.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
test('profile conflicts are reported without saying saved',async({page})=>{
 await mock(page);await page.route('**/api/workbench/preferences',async route=>{
  if(route.request().method()==='POST')return route.fulfill({status:409,json:{detail:'Your profile changed in another window.'}});
  return route.fallback();
 });
 await page.getByRole('button',{name:'Layout options'}).click();await page.getByRole('button',{name:'Save layout to profile'}).click();
 await expect(page.getByRole('alert')).toContainText('another window');
 await expect(page.getByText('Layout and filters saved to your profile.')).toHaveCount(0);
});
test('audit columns, creator/currency filters and descriptive entry choices',async({page})=>{
 const state=await mock(page);
 await page.getByRole('button',{name:'Layout options'}).click();
 const layout=page.getByRole('complementary',{name:'Customer layout'});
 const cols=layout.getByRole('group',{name:'Visible columns'});
 for(const name of ['Created at','Created by','Updated by'])await cols.getByLabel(name,{exact:true}).check();
 const filters=layout.getByRole('group',{name:'Visible filters'});
 await filters.getByLabel('Currency',{exact:true}).check();await filters.getByLabel('Created by',{exact:true}).check();
 await page.locator('form.filters').getByLabel('Currency',{exact:true}).selectOption('2');
 await page.locator('form.filters').getByLabel('Created by',{exact:true}).selectOption({label:'Alice'});
 const req=page.waitForRequest(r=>r.url().includes('currency_id=2')&&r.url().includes('created_by=7'));
 await page.getByRole('button',{name:'Search',exact:true}).click();await req;
 await expect(page.getByRole('cell',{name:'Alice',exact:true})).toBeVisible();
 await expect(page.getByRole('cell',{name:'2026-09-19 08:30:00 UTC',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Save layout to profile'}).click();
 await expect(page.getByRole('status')).toContainText('saved to your profile');
 expect(state.profile().settings).toMatchObject({currency_id:'2',created_by:'7'});
 await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.locator('form.filters').getByLabel('Created by',{exact:true})).toHaveValue('7');
 await page.getByRole('button',{name:'New customer'}).click();
 const form=page.getByRole('dialog',{name:'New customer'});
 await expect(form.getByRole('option',{name:'US — United States',exact:true})).toHaveCount(1);
 await expect(form.getByRole('option',{name:'USD — US Dollar',exact:true})).toHaveCount(1);
 await expect(form).not.toContainText('Excel');
 await expect(form).not.toContainText('Three required fields');
 await expect(form).not.toContainText('New customers start as');
});
test('column position persists and determines export order; compact icon tasks',async({page})=>{
 const state=await mock(page);
 await expect(page.getByText('Customer directory',{exact:true})).toHaveCount(0);
 const toolbar=page.getByRole('toolbar',{name:'Customer tasks'});
 for(const name of ['Layout options','Refresh','Export current page to Excel'])await expect(toolbar.getByRole('button',{name,exact:true})).toBeVisible();
 await toolbar.getByRole('button',{name:'Layout options'}).click();
 await page.getByRole('button',{name:'Move Currency left',exact:true}).click();
 await page.getByRole('button',{name:'Move Currency left',exact:true}).click();
 await page.getByRole('button',{name:'Save layout to profile'}).click();await expect(page.getByRole('status')).toContainText('saved to your profile');
 await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('columnheader').first()).toHaveText('Currency');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export current page to Excel'}).click();await download;
 expect(state.exported().columns[0]).toBe('CurrencyCode');
 await page.getByRole('button',{name:'Collapse navigation'}).click();await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.screenshot({path:'test-results/customer-icon-rail.png',fullPage:true});
});
test('theme auto-save failure reverts appearance and reports error',async({page})=>{
 await mock(page);
 await page.route('**/api/workbench/preferences',async route=>{
  if(route.request().method()==='POST')return route.fulfill({status:409,json:{detail:'Profile changed elsewhere. Reload profile.'}});
  return route.fallback();
 });
 await page.getByRole('button',{name:'Dark mode',exact:true}).click();
 await expect(page.getByText('Profile needs attention')).toBeVisible();
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await page.getByText('Profile needs attention').click();
 await expect(page.getByText('Profile changed elsewhere. Reload profile.')).toBeVisible();
});
test('new icon stays in empty table header and task bar is left aligned',async({page})=>{
 await mock(page);await page.route('**/api/customer?*',r=>r.fulfill({json:{rows:[],page:1,total:0}}));
 await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(page.getByRole('heading',{name:'No customers found'})).toBeVisible();
 const create=page.getByRole('columnheader').getByRole('button',{name:'New customer',exact:true});
 await expect(create.locator('svg')).toHaveCount(1);
 const toolbar=page.getByRole('toolbar',{name:'Customer tasks'});
 expect(await toolbar.evaluate(el=>getComputedStyle(el).justifyContent)).toBe('flex-start');
 await create.click();await expect(page.getByRole('dialog',{name:'New customer'})).toBeVisible();
});
