import {test,expect,type Page} from '@playwright/test';
async function setup(page:Page){
 let profile:any={settings:{columns:['CustomerName'],filters:[],sort:[],page_size:25,dark:false,nav_hidden:false},version:0};
 await page.route('**/api/**',route=>{
  const p=new URL(route.request().url()).pathname;
  if(p.endsWith('/session'))return route.fulfill({json:{username:'Manager',user_id:1,scopes:['PackagingManager'],is_admin:false}});
  if(p.endsWith('/preferences')){if(route.request().method()==='POST')profile={settings:route.request().postDataJSON().settings,version:profile.version+1};return route.fulfill({json:profile})}
  if(p==='/api/workbench/requests')return route.fulfill({json:{rows:[{RequestID:1,RequestNumber:'PKG-1',OpportunityNumber:'OPP-1',CustomerName:'Customer',RequestStatus:'Open',RequestedByName:'Sales',ResponseDue:'2026-10-01',ItemCount:2,Unassigned:1}],total:1,page:1}});
  if(p==='/api/packaging/requests')return route.fulfill({json:{rows:[{RequestID:1,ItemID:7,ProductCode:'P1',ItemDescription:'Pack',ItemStage:'Assigned',PICUserID:null,PIC:null,AnnualUnit:100,ItemRowVersion:'AAAAAAAAAAE=',RequestedByName:'Sales'}],total:700,page:1}});
  if(p==='/api/workbench/pics')return route.fulfill({json:{rows:[{ID:2,UserName:'PIC'}]}});
  return route.fulfill({json:{rows:[]}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 return ()=>profile;
}
test('compact request views save header/item layout independently and sort on server',async({page})=>{
 const profile=await setup(page);
 await expect(page.getByRole('heading',{name:'Request register'})).toHaveCount(0);
 await page.getByRole('button',{name:'Request layout',exact:true}).click();
 const layout=page.getByRole('complementary',{name:'Request layout',exact:true});
 await layout.getByRole('group',{name:'Visible columns'}).getByLabel('Unassigned',{exact:true}).uncheck();
 await layout.getByRole('button',{name:'Move Customer left'}).click();
 await layout.getByRole('group',{name:'Visible filters'}).getByLabel('Status',{exact:true}).uncheck();
 await layout.getByRole('button',{name:'Save layout to profile'}).click();await expect(layout.getByRole('status')).toContainText('saved');
 await layout.getByRole('button',{name:'Close layout'}).click();
 await expect(page.getByRole('combobox',{name:'Status',exact:true})).toHaveCount(0);
 const headerRequest=page.waitForRequest(r=>r.url().includes('/workbench/requests?')&&new URL(r.url()).searchParams.get('sort')?.includes('ResponseDue')===true);
 await page.getByRole('button',{name:'Sort by Response due',exact:true}).click();await headerRequest;
 await page.getByRole('button',{name:'PKG-1',exact:true}).click();
 await expect(page.getByRole('table',{name:'Packaging request items'})).toBeVisible();
 const itemRequest=page.waitForRequest(r=>r.url().includes('/packaging/requests?')&&new URL(r.url()).searchParams.get('sort')?.includes('AnnualUnit')===true);
 await page.getByRole('button',{name:'Sort by Annual units',exact:true}).click();await itemRequest;
 await page.getByRole('button',{name:'Request item layout',exact:true}).click();
 const itemLayout=page.getByRole('complementary',{name:'Request item layout',exact:true});
 await itemLayout.getByRole('group',{name:'Visible columns'}).getByLabel('Description',{exact:true}).uncheck();
 await itemLayout.getByRole('button',{name:'Save layout to profile'}).click();await expect(itemLayout.getByRole('status')).toContainText('saved');
 expect(profile().settings.requests.header.columns).not.toContain('Unassigned');
 expect(profile().settings.requests.items.columns).not.toContain('ItemDescription');
 expect(profile().settings.columns).toEqual(['CustomerName']);
 await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('button',{name:'Sort by Unassigned',exact:true})).toHaveCount(0);
});
test('request mobile toolbar and item box fit; close returns to list',async({page})=>{
 await setup(page);await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'View request',exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await expect(page.locator('.request-items > .panel')).toBeVisible();
 await page.screenshot({path:'test-results/packaging-request-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Close request details',exact:true}).click();
 await expect(page.getByRole('table',{name:'Packaging request items'})).toHaveCount(0);
});
