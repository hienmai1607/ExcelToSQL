import {test,expect} from '@playwright/test';
test('Packaging Request log shows field snapshots, filters on server, paginates and closes',async({page})=>{
 await page.route('**/api/**',route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/session'))return route.fulfill({json:{username:'Alice',scopes:['PackagingManager'],is_admin:false}});
  if(url.pathname.endsWith('/preferences'))return route.fulfill({json:{settings:{columns:['CustomerName'],filters:[],sort:[],page_size:25},version:0}});
  if(url.pathname==='/api/workbench/requests')return route.fulfill({json:{rows:[{RequestID:7,RequestNumber:'PCR-7',RequestStatus:'Open',CustomerName:'Customer'}],total:1,page:1}});
  if(url.pathname.endsWith('/7/changes'))return route.fulfill({json:{rows:[{ID:1,ChangedAt:'2026-09-23T09:00:00',ChangedBy:'Alice',EntityLevel:'Item',ItemID:9,ItemLabel:'Product 1',Action:'Update',FieldName:'Cost',OldValue:null,NewValue:'0.00',Source:'User',Reason:null}],total:60,page:Number(url.searchParams.get('page'))}});
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'View request',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Request change log',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Changes: PCR-7'});
 await expect(dialog.getByRole('cell',{name:'(blank)',exact:true})).toBeVisible();
 await expect(dialog.getByRole('cell',{name:'0.00',exact:true})).toBeVisible();
 await expect(dialog.getByRole('cell',{name:'Alice',exact:true})).toBeVisible();
 const filtered=page.waitForRequest(r=>r.url().includes('/7/changes?')&&r.url().includes('source=System'));
 await dialog.getByLabel('Source',{exact:true}).selectOption('System');await filtered;
 const next=page.waitForRequest(r=>r.url().includes('/7/changes?page=2'));
 await dialog.getByRole('button',{name:'Next',exact:true}).click();await next;
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await dialog.getByRole('button',{name:'Close change log'}).click();
 await expect(dialog).toHaveCount(0);
});
