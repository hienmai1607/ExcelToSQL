import {test,expect} from '@playwright/test';
for(const entity of ['ports','loss-processes'] as const)test(entity+' uses the unified searchable, sortable and saved master view',async({page})=>{
 const title=entity==='ports'?'Ports of Entry':'Loss Master',queries:URLSearchParams[]=[],profiles:any[]=[],exports:any[]=[];
 const row=entity==='ports'?{ID:1,PortName:'Seattle',CustomerName:'Northstar',MarketName:'United States',Status:'Active'}:{ID:1,ProcessType:'Sorting',Sequence:1,LossPct:'5',Status:'Active'};
 await page.route('**/api/**',route=>{
  const url=new URL(route.request().url()),path=url.pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Admin',user_id:1,is_admin:true,scopes:['Admin','Opportunity']}});
  if(path.endsWith('/preferences')){
   if(route.request().method()==='POST'){const body=route.request().postDataJSON();profiles.push(body);return route.fulfill({json:{settings:body.settings,version:1}})}
   return route.fulfill({json:{settings:{},version:0}});
  }
  if(path==='/api/ports/lookups')return route.fulfill({json:{customers:[],markets:[]}});
  if(path==='/api/'+entity+'/export'){exports.push(route.request().postDataJSON());return route.fulfill({body:'xlsx',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})}
  if(path==='/api/'+entity){queries.push(url.searchParams);return route.fulfill({json:{rows:[row],total:26,page:Number(url.searchParams.get('page'))}})}
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('/workbench/');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:title,exact:true}).click();
 const table=page.getByRole('table',{name:title,exact:true});
 await expect(table.getByText('#1',{exact:true})).toBeVisible();
 const toolbar=page.getByRole('toolbar',{name:'Master tasks'});
 await expect(toolbar.getByRole('button')).toHaveCount(5);
 await page.getByLabel(entity==='ports'?'Search ports':'Search loss processes',{exact:true}).fill(entity==='ports'?'Sea':'Sort');
 await page.getByLabel('Status',{exact:true}).selectOption('Active');
 await page.getByRole('button',{name:'Search',exact:true}).click();
 await expect.poll(()=>queries.at(-1)?.get('status')).toBe('Active');
 await expect.poll(()=>queries.at(-1)?.get('search')).toBe(entity==='ports'?'Sea':'Sort');
 const label=entity==='ports'?'Port name':'Process Type';
 await table.getByRole('button',{name:'Sort by '+label,exact:true}).click();
 await expect.poll(()=>JSON.parse(queries.at(-1)?.get('sort')??'[]')[0]?.column).toBe(entity==='ports'?'PortName':'ProcessType');
 await toolbar.getByRole('button',{name:'Layout options',exact:true}).click();
 const panel=page.locator('[aria-label="Master layout"]');
 await panel.getByRole('group',{name:'Visible columns',exact:true}).getByRole('checkbox',{name:'Status',exact:true}).uncheck();
 await expect(table.getByRole('button',{name:'Sort by Status',exact:true})).toHaveCount(0);
 await panel.getByRole('button',{name:'Close layout',exact:true}).click();
 await toolbar.getByRole('button',{name:'Save layout to profile',exact:true}).click();
 await expect.poll(()=>profiles.length).toBe(1);
 expect(profiles[0].settings.shared_masters[entity].columns).not.toContain('Status');
 const download=page.waitForEvent('download');
 await toolbar.getByRole('button',{name:'Excel local template',exact:true}).click();
 await download;expect(exports[0].columns).not.toContain('Status');
 await page.getByRole('button',{name:'Clear',exact:true}).click();
 await expect.poll(()=>queries.at(-1)?.get('status')??'').toBe('');
});
