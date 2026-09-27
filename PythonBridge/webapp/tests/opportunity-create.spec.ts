import {test,expect,type Page} from '@playwright/test';
async function setup(page:Page,scopes=['Opportunity']){
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Sales',user_id:10,scopes,is_admin:scopes.includes('Admin')}});
  if(path==='/api/opportunity/grid')return route.fulfill({json:{rows:[],total:0,page:1}});
  if(path==='/api/opportunity/lookups')return route.fulfill({json:{currencies:[{ID:1,CurrencyCode:'VND',CurrencyName:'Vietnamese Dong'}],customers:[{ID:1,CustomerName:'Northstar',CustomerCurrencyCode:'USD',CurrencyID:2}],products:[{ID:2,ProductCode:'Almonds',CustomerID:1},{ID:3,ProductCode:'Cashews',CustomerID:1}]}});
  if(path==='/api/workbench/preferences')return route.fulfill({json:{settings:{dark:false,nav_hidden:false,columns:['CustomerName'],filters:[],sort:[],page_size:25},version:0}});
  if(path==='/api/customer')return route.fulfill({json:{rows:[],total:0,page:1}});
  if(path==='/api/customer/lookups')return route.fulfill({json:{markets:[],currencies:[]}});
  return route.fulfill({status:500,json:{detail:'Unexpected '+path}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
}
async function fill(page:Page){
 await page.getByRole('button',{name:'New Opportunity',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New Opportunity',exact:true});
 await form.getByLabel('Customer *',{exact:true}).selectOption('1');
 await expect(form.getByLabel('Customer currency',{exact:true})).toHaveValue('USD');
 await expect(form.getByLabel('Customer currency',{exact:true})).toHaveAttribute('readonly','');
 await expect(form.getByLabel('Currency *',{exact:true})).toHaveCount(0);
 await form.getByLabel('Exchange rate VND per USD *',{exact:true}).fill('25000');
 await form.getByLabel('Exchange rate Customer Currency per USD *',{exact:true}).fill('1');
 await form.getByLabel('Description *',{exact:true}).fill('Retail launch');
 await form.getByLabel('Bid open *').fill('2026-09-01');
 await form.getByLabel('Bid close *').fill('2026-10-01');
 const item=form.getByRole('region',{name:'Item 1',exact:true});
 await item.getByLabel('Product *').selectOption('2');
 await item.getByLabel('Item description *').fill('Roasted almonds');
 await item.getByLabel('Annual units *').fill('1000');
 return form;
}
test('creates one header with multiple items only after confirmation',async({page})=>{
 await setup(page);let payload:any;
 await page.route('**/api/opportunity/batch',route=>{
  payload=route.request().postDataJSON();
  return route.fulfill({json:{header_results:[{RowNum:1,Status:'OK',OpportunityNumber:'OPP-2026-12345'}],item_results:payload.item_rows.map((x:any)=>({RowNum:x.RowNum,Status:'OK'}))}});
 });
 const form=await fill(page);
 const bounds=await form.boundingBox();
 expect(bounds!.width).toBeGreaterThan(page.viewportSize()!.width*0.9);
 const first=form.getByRole('region',{name:'Item 1',exact:true});
 await first.getByText('Packaging requirements',{exact:true}).click();
 await first.getByLabel('Packaging type',{exact:true}).fill('Pouch');
 await first.getByLabel('Max pallet height (m)',{exact:true}).fill('1.25');
 await first.getByLabel('Shelf life (days)',{exact:true}).fill('365');
 await form.getByRole('button',{name:'Add item',exact:true}).click();
 const item=form.getByRole('region',{name:'Item 2',exact:true});
 await item.getByLabel('Product *').selectOption('3');
 await item.getByLabel('Item description *').fill('Cashew mix');
 await item.getByLabel('Annual units *').fill('0');
 await item.getByLabel('Estimated award %').fill('0');
 await item.getByLabel('Shelf price').fill('12.50');
 await form.getByRole('button',{name:'Review & save'}).click();
 await expect(page.getByRole('dialog',{name:'Confirm Opportunity save'})).toBeVisible();expect(payload).toBeUndefined();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('OPP-2026-12345 created');
 expect(payload.header_rows[0]).toMatchObject({ExchangeRateVNDPerUSD:'25000',ExchangeRateCustomerCurrencyPerUSD:'1'});
 expect(payload.item_rows[0]).toMatchObject({PackagingType:'Pouch',MaxPalletHeightM:'1.25',ShelfLifeDays:'365'});
 expect(payload.header_rows).toHaveLength(1);expect(payload.item_rows).toHaveLength(2);
 expect(payload.item_rows.every((x:any)=>x.OpportunityNumber===payload.header_rows[0].OpportunityNumber)).toBeTruthy();
 expect(payload.item_rows[0].EstPctAwarded).toBeNull();expect(payload.item_rows[0].ShelfPrice).toBeNull();
 expect(payload.item_rows[1].AnnualUnit).toBe(0);expect(payload.item_rows[1].EstPctAwarded).toBe(0);
 expect(payload.header_rows[0].Stage).toBeUndefined();
});

test('entry controls align and packaging fields use a compact grid',async({page})=>{
 await page.setViewportSize({width:1800,height:1100});
 await setup(page);const form=await fill(page);
 const selectors=['Customer *','Bid open *','Bid close *','Customer currency','Exchange rate VND per USD *','Exchange rate Customer Currency per USD *'];
 const boxes=await Promise.all(selectors.map(name=>form.getByLabel(name,{exact:true}).boundingBox()));
 for(const box of boxes)expect(box!.height).toBe(38);
 await form.getByText('Packaging requirements',{exact:true}).click();
 const pallet=await form.getByLabel('Pallet size',{exact:true}).boundingBox();
 const stacking=await form.getByLabel('Pallet stacking',{exact:true}).boundingBox();
 expect(Math.abs(pallet!.width-stacking!.width)).toBeLessThan(2);
 expect(pallet!.width).toBeLessThan(450);
 await expect(form.getByLabel('Opportunity summary')).toContainText('Available products');
 await page.screenshot({path:'test-results/opportunity-entry-layout.png',fullPage:true});
});

test('product choices follow Customer and clear selections when Customer changes',async({page})=>{
 await setup(page);
 await page.route('**/api/opportunity/lookups',route=>route.fulfill({json:{customers:[{ID:1,CustomerName:'Northstar',CustomerCurrencyCode:'USD',CurrencyID:2},{ID:2,CustomerName:'Southstar'}],products:[{ID:2,ProductCode:'North product',CustomerID:1},{ID:3,ProductCode:'South product',CustomerID:2},{ID:4,ProductCode:'Unassigned',CustomerID:null}],currencies:[]}}));
 await page.getByRole('button',{name:'New Opportunity',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New Opportunity',exact:true}),product=form.getByLabel('Product *',{exact:true});
 await expect(product).toBeDisabled();
 await form.getByLabel('Customer *',{exact:true}).selectOption('1');
 await expect(product.locator('option')).toHaveText(['Choose product','North product']);
 await product.selectOption('2');
 await form.getByLabel('Customer *',{exact:true}).selectOption('2');
 await expect(product).toHaveValue('');
 await expect(product.locator('option')).toHaveText(['Choose product','South product']);
});
test('validates numeric limits, dates and keeps at least one item',async({page})=>{
 await setup(page);const form=await fill(page);
 await expect(form.getByRole('button',{name:'Remove item 1'})).toBeDisabled();
 await form.getByLabel('Annual units *').fill('1.5');await form.getByLabel('Estimated award %').fill('101');
 await form.getByRole('button',{name:'Review & save'}).click();
 await expect(form.getByRole('alert')).toContainText('whole number');
 await expect(form.getByRole('alert')).toContainText('0 to 100');
 await expect(page.getByRole('dialog',{name:'Confirm Opportunity save'})).toHaveCount(0);
 await form.getByLabel('Annual units *').fill('1');await form.getByLabel('Estimated award %').fill('');
 await form.getByLabel('Bid close *').fill('2026-08-01');
 await form.getByRole('button',{name:'Review & save'}).click();
 await expect(page.getByRole('dialog',{name:'Confirm Opportunity save'})).toHaveCount(0);
});
test('SQL rejection preserves all input for correction',async({page})=>{
 await setup(page);await page.route('**/api/opportunity/batch',route=>route.fulfill({json:{header_results:[{RowNum:1,Status:'ERROR',Message:'Active Customer is required.'}],item_results:[{RowNum:2,Status:'ERROR',Message:'Document rolled back.'}]}}));
 const form=await fill(page);await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save'}).click();
 await expect(form.getByRole('alert')).toContainText('Active Customer');
 await expect(form.getByLabel('Description *',{exact:true})).toHaveValue('Retail launch');
 await expect(form.getByRole('button',{name:'Review & save'})).toBeEnabled();
});
test('lost save reply prevents blind duplicate submission',async({page})=>{
 await setup(page);await page.route('**/api/opportunity/batch',route=>route.abort('failed'));
 const form=await fill(page);await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save'}).click();
 await expect(form.getByRole('alert')).toContainText('Save outcome unknown');
 await expect(form.getByRole('button',{name:'Review & save'})).toBeDisabled();
});
test('mobile form fits and unsaved navigation is guarded',async({page})=>{
 await setup(page,['Admin']);await page.setViewportSize({width:390,height:844});const form=await fill(page);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 page.once('dialog',dialog=>dialog.dismiss());
 await form.getByRole('button',{name:'Close Opportunity form'}).click();
 await expect(form).toBeVisible();
 await page.screenshot({path:'test-results/opportunity-create-mobile.png',fullPage:true});
});
