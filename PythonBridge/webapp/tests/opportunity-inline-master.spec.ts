import {test,expect,type Page} from '@playwright/test';
async function setup(page:Page,scopes=['Admin']){
 const writes:any[]=[];
 const customers:any[]=[{ID:1,CustomerName:'Customer one',CustomerCurrencyCode:'USD',Status:'Active'}];
 const products:any[]=[{ID:2,CustomerID:1,ProductCode:'PRD-2',ProductName:'Product two',WeightGrams:150,Status:'Active'}];
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname,request=route.request();
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Tester',user_id:1,is_admin:scopes.includes('Admin'),scopes}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/opportunity/lookups')return route.fulfill({json:{customers,products,pallets:[],packagingTypes:[]}});
  if(path==='/api/customer/lookups')return route.fulfill({json:{markets:[{ID:1,MarketCode:'US',MarketName:'USA'}],currencies:[{ID:1,CurrencyCode:'USD',CurrencyName:'US Dollar'}]}});
  if(path==='/api/workbench/masters/lookups')return route.fulfill({json:{customers,categories:[{ID:1,CategoryName:'Nuts',Status:'Active'}],materials:[],currencies:[],creators:[],uoms:[{ID:9,UoMCode:'g',UoMName:'Grams',Category:'Weight/Mass',BaseFactor:1,Status:'Active'}]}});
  if(path==='/api/customer/batch'){
   const body=request.postDataJSON();writes.push({path,...body});customers.push({ID:3,CustomerName:body.rows[0].CustomerName,CustomerCurrencyCode:'USD',Status:'Active'});
   return route.fulfill({json:{results:[{RowNum:1,Status:'OK',NewID:3}]}});
  }
  if(path==='/api/product/batch'){
   const body=request.postDataJSON();writes.push({path,...body});products.push({ID:3,CustomerID:body.rows[0].CustomerID,ProductCode:'PRD-3',ProductName:body.rows[0].ProductName,WeightGrams:150,Status:'Active'});
   return route.fulfill({json:{results:[{RowNum:1,Status:'OK',NewID:3}]}});
  }
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'New Opportunity',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New Opportunity',exact:true});
 await form.getByLabel('Description *',{exact:true}).fill('Keep this opportunity draft');
 return {form,writes};
}
test('create Customer in its master and refresh choices without saving the Opportunity',async({page})=>{
 const {form,writes}=await setup(page);
 await form.getByRole('button',{name:'Add new Customer',exact:true}).click();
 const child=page.getByRole('dialog',{name:'New customer',exact:true});
 await child.getByLabel('Customer name *',{exact:true}).fill('New inline customer');
 await child.getByLabel('Market *',{exact:true}).selectOption('1');
 await child.getByLabel('Currency *',{exact:true}).selectOption('1');
 await child.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(child).toHaveCount(0);
 await expect(form.getByLabel('Customer *',{exact:true})).toHaveValue('3');
 await expect(form.getByLabel('Description *',{exact:true})).toHaveValue('Keep this opportunity draft');
 expect(writes.map(w=>w.path)).toEqual(['/api/customer/batch']);
});
test('create Product with selected Customer prefilled and retain item quantities',async({page})=>{
 const {form,writes}=await setup(page);
 await form.getByLabel('Customer *',{exact:true}).selectOption('1');
 await form.getByLabel('Annual units *',{exact:true}).fill('500');
 await form.getByRole('button',{name:'Add new Product for item 1',exact:true}).click();
 const child=page.getByRole('dialog',{name:'New product',exact:true});
 await expect(child.getByLabel('Customer',{exact:true})).toHaveValue('1');
 await expect(child.getByLabel('Customer',{exact:true})).toBeDisabled();
 await expect(child.getByRole('button',{name:'Add new Customer master',exact:true})).toHaveCount(0);
 await child.getByLabel('Product name',{exact:true}).fill('New inline product');
 await child.getByLabel('Category',{exact:true}).selectOption('Nuts');
 await child.getByLabel('Weight',{exact:true}).fill('150');
 await child.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(child).toHaveCount(0);
 await expect(form.getByLabel('Product *',{exact:true})).toHaveValue('3');
 await expect(form.getByLabel('Annual units *',{exact:true})).toHaveValue('500');
 await expect(form.getByLabel('Description *',{exact:true})).toHaveValue('Keep this opportunity draft');
 expect(writes.map(w=>w.path)).toEqual(['/api/product/batch']);
});
test('Escape closes only the nested master and master permissions hide add icons',async({page})=>{
 const {form}=await setup(page);
 await form.getByRole('button',{name:'Add new Customer',exact:true}).click();
 const child=page.getByRole('dialog',{name:'New customer',exact:true});
 await expect(child.getByLabel('Customer name *',{exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(child).toHaveCount(0);await expect(form).toBeVisible();
 await expect(form.getByLabel('Description *',{exact:true})).toHaveValue('Keep this opportunity draft');
});
test('partial customer creation keeps failed sections open for correction',async({page})=>{
 const {form}=await setup(page);
 await page.route('**/api/customer/batch',route=>route.fulfill({json:{results:[{RowNum:1,Status:'OK',NewID:3},{RowNum:2,Status:'ERROR',Message:'Customer description already exists.'}]}}));
 await form.getByRole('button',{name:'Add new Customer',exact:true}).click();
 const child=page.getByRole('dialog',{name:'New customer',exact:true});
 await child.getByRole('button',{name:'+ Add customer section',exact:true}).click();
 for(const number of [1,2]){
  const section=child.getByRole('region',{name:'Customer '+number,exact:true});
  await section.getByLabel('Customer name *',{exact:true}).fill('Inline customer '+number);
  await section.getByLabel('Market *',{exact:true}).selectOption('1');
  await section.getByLabel('Currency *',{exact:true}).selectOption('1');
 }
 await child.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(child).toBeVisible();
 await expect(child).toContainText('Customer description already exists.');
 await expect(child.getByRole('region',{name:'Customer 1',exact:true}).getByLabel('Customer name *',{exact:true})).toBeDisabled();
 await expect(child.getByRole('region',{name:'Customer 2',exact:true}).getByLabel('Customer name *',{exact:true})).toBeEditable();
});

test('Opportunity-only users do not gain Customer or Product master access',async({page})=>{
 const {form}=await setup(page,['Opportunity']);
 await expect(form.getByRole('button',{name:'Add new Customer',exact:true})).toHaveCount(0);
 await expect(form.getByRole('button',{name:'Add new Product for item 1',exact:true})).toHaveCount(0);
});
test('duplicate descriptions keep the master form open without touching the Opportunity',async({page})=>{
 const {form,writes}=await setup(page);
 await page.route('**/api/customer/batch',route=>route.fulfill({json:{results:[{RowNum:1,Status:'ERROR',Message:'Customer description already exists.'}]}}));
 await form.getByRole('button',{name:'Add new Customer',exact:true}).click();
 const child=page.getByRole('dialog',{name:'New customer',exact:true});
 await child.getByLabel('Customer name *',{exact:true}).fill('Customer one');
 await child.getByLabel('Market *',{exact:true}).selectOption('1');await child.getByLabel('Currency *',{exact:true}).selectOption('1');
 await child.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(child).toContainText('Customer description already exists.');
 await expect(child.getByLabel('Customer name *',{exact:true})).toHaveValue('Customer one');
 expect(writes).toHaveLength(0);
});

test('inline master icons match the compact Add item button size',async({page})=>{
 const {form}=await setup(page);
 for(const width of [1920,390]){
  await page.setViewportSize({width,height:width===390?844:1080});
  const reference=(await form.getByRole('button',{name:'Add item',exact:true}).boundingBox())!;
  for(const name of ['Add new Customer','Add new Product for item 1']){
   const icon=(await form.getByRole('button',{name,exact:true}).boundingBox())!;
   expect(icon.width).toBe(reference.width);
   expect(icon.height).toBe(reference.height);
  }
 }
});

test('create Port master from shipment and select it without saving Opportunity',async({page})=>{
 const {form,writes}=await setup(page);
 let ports:any[]=[];
 const customer={ID:1,CustomerName:'Customer one',CustomerCurrencyCode:'USD',MarketID:10,Status:'Active'};
 await page.route('**/api/opportunity/lookups',route=>route.fulfill({json:{customers:[customer],products:[{ID:2,CustomerID:1,ProductCode:'PRD-2',ProductName:'Product two',WeightGrams:150}],ports}}));
 await page.route('**/api/ports/lookups',route=>route.fulfill({json:{customers:[customer],markets:[{ID:10,MarketCode:'US',MarketName:'USA'}]}}));
 await page.route('**/api/ports',route=>{
  const body=route.request().postDataJSON();writes.push({path:'/api/ports',...body});ports=[{...body,ID:99}];
  return route.fulfill({json:{rows:ports}});
 });
 await form.getByLabel('Customer *',{exact:true}).selectOption('1');
 await form.getByText('Shipment, Logistics, Co-Man & Others info',{exact:true}).click();
 await form.getByRole('button',{name:'Add new Port of Entry master',exact:true}).click();
 const child=page.getByRole('dialog',{name:'New Port of Entry',exact:true});
 await expect(child.getByLabel('Customer',{exact:true})).toHaveValue('1');
 await expect(child.getByLabel('Market',{exact:true})).toHaveValue('10');
 await child.getByLabel('Port name',{exact:true}).fill('New shipping port');
 await child.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(child).toHaveCount(0);
 await expect(form.getByLabel('Port of Entry',{exact:true})).toHaveValue('99');
 await expect(form.getByLabel('Description *',{exact:true})).toHaveValue('Keep this opportunity draft');
 expect(writes.map(w=>w.path)).toEqual(['/api/ports']);
});

test('Sales cannot create Admin-managed Port masters inline',async({page})=>{
 const {form}=await setup(page,['Opportunity']);
 await form.getByLabel('Customer *',{exact:true}).selectOption('1');
 await form.getByText('Shipment, Logistics, Co-Man & Others info',{exact:true}).click();
 await expect(form.getByRole('button',{name:'Add new Port of Entry master',exact:true})).toHaveCount(0);
});
