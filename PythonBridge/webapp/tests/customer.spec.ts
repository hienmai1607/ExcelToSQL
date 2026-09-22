import {test,expect,type Page} from '@playwright/test';
const customer={ID:7,CustomerName:'Northstar Foods',MarketID:1,MarketCode:'US',CurrencyID:2,CurrencyCode:'USD',Status:'Active',RowVersion:'AAAAAAAAAAE=',CreatedAt:'2026-09-19'};
async function setup(page:Page,result='OK'){
 const writes:any[]=[];
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Customer User',scopes:['Customer'],is_admin:false}});
  if(path==='/api/customer/lookups')return route.fulfill({json:{markets:[{ID:1,MarketCode:'US'}],currencies:[{ID:2,CurrencyCode:'USD'}]}});
  if(path==='/api/customer')return route.fulfill({json:{rows:[customer],total:1,page:1}});
  if(path==='/api/customer/batch'){writes.push(route.request().postDataJSON());return route.fulfill({json:{results:route.request().postDataJSON().rows.map((r:any)=>({RowNum:r.RowNum,Status:result,Message:result==='OK'?'Saved':'RowVersion conflict: refresh required.'}))}})}
  return route.fulfill({status:404,json:{detail:'Unexpected endpoint'}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Customers',exact:true})).toBeVisible();return writes;
}
async function fill(page:Page){
 const form=page.getByRole('dialog',{name:'New customer',exact:true});
 await form.getByLabel('Customer name *',{exact:true}).fill('Acme Foods');
 await form.getByLabel('Market *',{exact:true}).selectOption('1');
 await form.getByLabel('Currency *',{exact:true}).selectOption('2');
}
test('Customer-only access, validation, confirmation and create payload',async({page})=>{
 const writes=await setup(page);
 await expect(page.getByRole('button',{name:'Opportunities'})).toBeDisabled();
 await page.getByRole('button',{name:'New customer',exact:true}).click();
 await page.getByRole('button',{name:'Review & save'}).click();
 await expect(page.getByText('Enter a customer name.')).toBeVisible();expect(writes).toHaveLength(0);
 await fill(page);await page.getByRole('button',{name:'Review & save'}).click();expect(writes).toHaveLength(0);
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('1 customer(s) created');
 expect(writes[0].rows[0]).toEqual({RowNum:1,Command:'C',ID:null,CustomerName:'Acme Foods',MarketID:1,CurrencyID:2,Status:null,RowVersion:null});
 await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('edit retains input on row-level conflict and sends original version',async({page})=>{
 const writes=await setup(page,'ERROR');await page.getByRole('button',{name:'Edit Northstar Foods'}).click();
 await page.getByRole('dialog').getByLabel('Customer name *').fill('Changed name');
 await page.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('RowVersion conflict');
 await expect(page.getByRole('dialog').getByLabel('Customer name *')).toHaveValue('Changed name');
 expect(writes[0].rows[0]).toMatchObject({Command:'U',ID:7,RowVersion:customer.RowVersion});
});
test('edit uses icon and no longer has a Block section',async({page})=>{
 const writes=await setup(page);
 const edit=page.getByRole('button',{name:'Edit Northstar Foods'});
 await expect(edit.locator('svg')).toHaveCount(1);await edit.click();
 await expect(page.getByRole('heading',{name:'Block this customer'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Block customer',exact:true})).toHaveCount(0);
 expect(writes).toHaveLength(0);
});
test('stacked sections submit once with separate row numbers',async({page})=>{
 const writes=await setup(page);await page.getByRole('button',{name:'New customer'}).click();await fill(page);
 await page.getByRole('button',{name:'+ Add customer section'}).click();
 const second=page.getByRole('region',{name:'Customer 2',exact:true});
 await second.getByLabel('Customer name *').fill('Second customer');await second.getByLabel('Market *',{exact:true}).selectOption('1');await second.getByLabel('Currency *',{exact:true}).selectOption('2');
 await page.getByRole('button',{name:'Review & save'}).click();expect(writes).toHaveLength(0);
 await expect(page.getByRole('heading',{name:'Create 2 customers?'})).toBeVisible();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(writes).toHaveLength(1);expect(writes[0].rows.map((r:any)=>[r.RowNum,r.CustomerName])).toEqual([[1,'Acme Foods'],[2,'Second customer']]);
});
test('partial batch success only retries failed sections',async({page})=>{
 await setup(page);const writes:any[]=[];
 await page.route('**/api/customer/batch',async route=>{const body=route.request().postDataJSON();writes.push(body);await route.fulfill({json:{results:body.rows.map((r:any)=>({RowNum:r.RowNum,Status:r.RowNum===2&&writes.length===1?'ERROR':'OK',Message:'Name is already used.'}))}})});
 await page.getByRole('button',{name:'New customer'}).click();await fill(page);await page.getByRole('button',{name:'+ Add customer section'}).click();
 const second=page.getByRole('region',{name:'Customer 2',exact:true});
 await second.getByLabel('Customer name *').fill('Second customer');await second.getByLabel('Market *',{exact:true}).selectOption('1');await second.getByLabel('Currency *',{exact:true}).selectOption('2');
 await page.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Some customers were not saved');
 await expect(page.getByRole('region',{name:'Customer 1',exact:true}).getByLabel('Customer name *')).toBeDisabled();
 await second.getByLabel('Customer name *').fill('Corrected customer');
 await page.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(writes[1].rows).toHaveLength(1);expect(writes[1].rows[0].RowNum).toBe(2);
});
test('filters and editable rows per page reach API; mobile form fits',async({page})=>{
 await setup(page);await page.getByLabel('Customer name',{exact:true}).fill('North');
 const filter=page.waitForRequest(r=>r.url().includes('customer_name=North'));await page.getByRole('button',{name:'Search',exact:true}).click();await filter;
 const paging=page.waitForRequest(r=>r.url().includes('page_size=50'));await page.getByLabel('Rows per page').fill('50');await page.getByLabel('Rows per page').press('Enter');await paging;
 await page.screenshot({path:'test-results/customer-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.getByRole('button',{name:'New customer'}).click();await fill(page);
 await page.screenshot({path:'test-results/customer-mobile.png',fullPage:true});
 expect(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBeTruthy();
});
test('unknown network save disables retry to avoid duplicate creates',async({page})=>{
 await setup(page);await page.route('**/api/customer/batch',r=>r.abort('failed'));
 await page.getByRole('button',{name:'New customer'}).click();await fill(page);await page.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('Save outcome unknown');
 await expect(page.getByRole('button',{name:'Review & save'})).toBeDisabled();
});
