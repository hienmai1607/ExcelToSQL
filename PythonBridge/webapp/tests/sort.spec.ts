import {test,expect} from '@playwright/test';
test('multi-sort headers, priorities, pagination and profile persistence',async({page})=>{
 let profile:any={settings:{columns:['CustomerName','MarketCode','CurrencyCode','Status','UpdatedAt'],filters:['customer_name'],customer_name:'',market_id:'',currency_id:'',created_by:'',status:'',page_size:1,dark:false,nav_hidden:false,sort:[{column:'CustomerName',direction:'asc'}]},version:0};
 const requests:any[]=[];
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/session'))return route.fulfill({json:{username:'Admin',scopes:['Admin'],is_admin:true}});
  if(url.pathname.endsWith('/preferences')){if(route.request().method()==='POST'){profile={settings:route.request().postDataJSON().settings,version:profile.version+1}}return route.fulfill({json:profile})}
  if(url.pathname==='/api/customer/lookups')return route.fulfill({json:{markets:[],currencies:[]}});
  if(url.pathname==='/api/customer'){requests.push({page:url.searchParams.get('page'),sort:JSON.parse(url.searchParams.get('sort')||'[]')});return route.fulfill({json:{rows:[{ID:1,CustomerName:'Acme',MarketCode:'US',CurrencyCode:'USD',Status:'Active'}],total:3,page:Number(url.searchParams.get('page'))}})}
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Customers',exact:true}).click();
 await expect(page.getByRole('button',{name:'Next',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Next',exact:true}).click();
 await page.getByRole('button',{name:'Sort by Currency',exact:true}).click();
 await expect.poll(()=>requests.at(-1)).toEqual({page:'1',sort:[{column:'CurrencyCode',direction:'asc'}]});
 await page.getByRole('button',{name:'Sort by Customer',exact:true}).click({modifiers:['Shift']});
 await expect.poll(()=>requests.at(-1)?.sort).toEqual([{column:'CurrencyCode',direction:'asc'},{column:'CustomerName',direction:'asc'}]);
 await page.getByRole('button',{name:'Sort options'}).click();
 await page.getByLabel('Sort direction 2').selectOption('desc');
 await page.getByRole('button',{name:'Raise sort priority 2'}).click();
 await expect.poll(()=>requests.at(-1)?.sort).toEqual([{column:'CustomerName',direction:'desc'},{column:'CurrencyCode',direction:'asc'}]);
 await page.getByRole('button',{name:'Layout options'}).click();
 await page.getByRole('button',{name:'Save layout to profile'}).click();
 await expect(page.getByRole('status')).toContainText('saved to your profile');
 await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Customers',exact:true}).click();
 await expect.poll(()=>requests.at(-1)?.sort).toEqual(profile.settings.sort);
 await expect(page.getByRole('columnheader').nth(1)).toHaveAttribute('aria-sort','descending');
 await page.getByRole('button',{name:'Sort options'}).click();await page.getByRole('button',{name:'Remove sort 2'}).click();
 await page.getByRole('button',{name:'Remove sort 1'}).click();
 await expect.poll(()=>requests.at(-1)?.sort).toEqual([]);
});
