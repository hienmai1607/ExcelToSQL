import {test,expect,type Page} from '@playwright/test';
const rv='AAAAAAAAB9E=';
async function setup(page:Page,scopes=['Admin']){
 const writes:any[]=[],customer={ID:56,CustomerName:'Aldi EU',Status:'Active',CustomerCurrencyCode:'EUR'};
 const child={ID:2,CustomerID:56,ProductCode:'CHILD',ProductName:'Normal child',WeightGrams:100,RowVersion:rv,Status:'Active'};
 const products:any[]=[child,{...child,ID:8,CustomerID:1,ProductName:'Wrong customer'},{...child,ID:9,Status:'Block',ProductName:'Blocked child'}];
 let parent:any=null;
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname,request=route.request();
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Tester',user_id:1,is_admin:scopes.includes('Admin'),scopes}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/opportunity/lookups')return route.fulfill({json:{customers:[customer],products:[child,...(parent&&parent.MixVersion.Status==='Active'?[parent]:[])],unready_products:[{ID:7,CustomerID:56,ProductCode:'PRD-7',ProductName:'Old unfinished mix'}],mix_children:parent&&parent.MixVersion.Status==='Active'?[{ParentProductID:3,ProductID:2,ProductCode:'CHILD',ProductName:'Normal child',UnitQuantity:2.5,MixVersionID:4}]:[],pallets:[],packagingTypes:[]}});
  if(path==='/api/workbench/masters/lookups')return route.fulfill({json:{customers:[customer],products,categories:[{ID:1,CategoryName:'Nuts',Status:'Active'}],materials:[],currencies:[],creators:[]}});
  if(path==='/api/product/batch'){
   const body=request.postDataJSON();writes.push({path,...body});const row=body.rows[0];
   if(row.IsMix){parent={...row,ID:3,ProductCode:'PRD-3',WeightGrams:250};return route.fulfill({json:{results:[{RowNum:1,Status:'OK',NewID:3}]}})}
   products.push({...child,ID:4,ProductCode:'PRD-4',ProductName:row.ProductName,WeightGrams:Number(row.WeightValue)});
   return route.fulfill({json:{results:[{RowNum:1,Status:'OK',NewID:4}]}});
  }
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'New Opportunity',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New Opportunity',exact:true});
 await form.getByLabel('Customer *',{exact:true}).selectOption('56');
 await form.getByLabel('Description *',{exact:true}).fill('Keep Aldi draft');
 await form.getByLabel('Annual units *',{exact:true}).fill('500');
 return {form,writes};
}
async function createMix(page:Page,form:any){
 await form.getByRole('button',{name:'Add new Product for item 1',exact:true}).click();
 const product=page.getByRole('dialog',{name:'New product',exact:true});
 await product.getByLabel('Product Mix',{exact:true}).check();
 await product.getByLabel('Product name',{exact:true}).fill('Test 123');
 await product.getByLabel('Category',{exact:true}).selectOption('Nuts');
 return product;
}
test('choose mix children before any parent save; save includes mix in the same request',async({page})=>{
 const {form,writes}=await setup(page),product=await createMix(page,form);
 await expect(product).not.toContainText('Save this Product, then open Product Mix');
 await product.getByRole('button',{name:'Add child Product',exact:true}).click();
 await product.getByLabel('Child Product 1',{exact:true}).selectOption('2');
 await product.getByLabel('Child quantity 1',{exact:true}).fill('2.5');
 await expect(product.getByLabel('Weight',{exact:true})).toHaveValue('250');
 expect(writes).toHaveLength(0);
 await product.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(product).toHaveCount(0);
 await expect(form.getByLabel('Product *',{exact:true})).toHaveValue('3');
 await expect(form.getByLabel('Product',{exact:true})).toHaveValue('CHILD — Normal child');
 await expect(form.getByLabel('Annual units *',{exact:true})).toHaveValue('500');
 await expect(form.getByLabel('Description *',{exact:true})).toHaveValue('Keep Aldi draft');
 expect(writes).toHaveLength(1);
 expect(writes[0].rows[0]).toMatchObject({IsMix:true,WeightValue:0,MixVersion:{Status:'Active',items:[{ProductID:2,UnitQuantity:'2.5',RowVersion:rv}]}});
 await expect(page.getByRole('dialog',{name:'Product Mix',exact:true})).toHaveCount(0);
});
test('unfinished-mix note and its edit icon are removed from Opportunity',async({page})=>{
 const {form}=await setup(page);
 await expect(form).not.toContainText('Activate a Product Mix version before selecting:');
 await expect(form).not.toContainText('Old unfinished mix');
 await expect(form.getByRole('button',{name:/Configure Product Mix/})).toHaveCount(0);
});
test('child rows validate quantities and only offer active same-customer normal Products',async({page})=>{
 const {form,writes}=await setup(page),product=await createMix(page,form);
 await product.getByRole('button',{name:'Review & save',exact:true}).click();
 await expect(product).toContainText('Add at least one child Product.');
 await product.getByRole('button',{name:'Add child Product',exact:true}).click();
 const choices=product.getByLabel('Child Product 1',{exact:true});
 await expect(choices.locator('option[value="8"]')).toHaveCount(0);
 await expect(choices.locator('option[value="9"]')).toHaveCount(0);
 await choices.selectOption('2');
 await product.getByLabel('Child quantity 1',{exact:true}).fill('0');
 await product.getByRole('button',{name:'Review & save',exact:true}).click();
 await expect(product).toContainText('Use positive unit quantities');
 expect(writes).toHaveLength(0);
});
test('a new normal child can be created without saving or losing the parent mix draft',async({page})=>{
 const {form,writes}=await setup(page),product=await createMix(page,form);
 await product.getByRole('button',{name:'New child Product',exact:true}).click();
 const child=page.getByRole('dialog',{name:'New product',exact:true}).last();
 await expect(child.getByLabel('Product Mix',{exact:true})).toHaveCount(0);
 await expect(child.getByLabel('Customer',{exact:true})).toHaveValue('56');
 await child.getByLabel('Product name',{exact:true}).fill('New child');
 await child.getByLabel('Category',{exact:true}).selectOption('Nuts');
 await child.getByLabel('Weight',{exact:true}).fill('90');
 await child.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'New product',exact:true})).toHaveCount(1);
 await expect(product.getByLabel('Product name',{exact:true})).toHaveValue('Test 123');
 await expect(product.getByLabel('Child Product 1',{exact:true})).toHaveValue('4');
 await expect(product.getByLabel('Weight',{exact:true})).toHaveValue('90');
 expect(writes).toHaveLength(1);expect(writes[0].rows[0].ProductName).toBe('New child');
 await expect(form.getByLabel('Description *',{exact:true})).toHaveValue('Keep Aldi draft');
});
test('saving a Draft mix keeps it unselected in the Opportunity',async({page})=>{
 const {form,writes}=await setup(page),product=await createMix(page,form);
 await product.getByRole('button',{name:'Add child Product',exact:true}).click();
 await product.getByLabel('Child Product 1',{exact:true}).selectOption('2');
 await product.getByLabel('Initial mix status',{exact:true}).selectOption('Draft');
 await product.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(product).toHaveCount(0);
 await expect(form.getByLabel('Product *',{exact:true})).toHaveValue('');
 expect(writes[0].rows[0].MixVersion.Status).toBe('Draft');
});

test('Opportunity-derived Product Mix keeps its Customer fixed across batch sections',async({page})=>{
 const {form,writes}=await setup(page),product=await createMix(page,form);
 await product.getByRole('button',{name:'Add child Product',exact:true}).click();
 await product.getByLabel('Child Product 1',{exact:true}).selectOption('2');
 await expect(product.getByLabel('Customer',{exact:true})).toBeDisabled();
 await expect(product.getByLabel('Customer',{exact:true})).toHaveValue('56');
 await expect(product.getByRole('button',{name:'Add new Customer master',exact:true})).toHaveCount(0);
 await product.getByRole('button',{name:'+ Add record section',exact:true}).click();
 const first=product.getByRole('region',{name:'Record 1',exact:true}),second=product.getByRole('region',{name:'Record 2',exact:true});
 await expect(second.getByLabel('Customer',{exact:true})).toHaveValue('56');
 await expect(second.getByLabel('Customer',{exact:true})).toBeDisabled();
 await expect(first.getByLabel('Child Product 1',{exact:true})).toHaveValue('2');
 expect(writes).toEqual([]);
});

test('Escape closes only an unsaved new child creator and keeps the parent draft',async({page})=>{
 const {form,writes}=await setup(page),product=await createMix(page,form);
 await product.getByRole('button',{name:'New child Product',exact:true}).click();
 const child=page.getByRole('dialog',{name:'New product',exact:true}).last();
 await expect(child.getByLabel('Product name',{exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog',{name:'New product',exact:true})).toHaveCount(1);
 await expect(product.getByLabel('Product name',{exact:true})).toHaveValue('Test 123');
 expect(writes).toHaveLength(0);
});

test('mix status and both child actions share a baseline and size on desktop and mobile',async({page})=>{
 const {form,writes}=await setup(page),product=await createMix(page,form);
 for(const width of [1920,390]){
  await page.setViewportSize({width,height:width===390?844:1080});
  const status=(await product.getByLabel('Initial mix status',{exact:true}).boundingBox())!;
  const plus=(await product.getByRole('button',{name:'Add child Product',exact:true}).boundingBox())!;
  const create=(await product.getByRole('button',{name:'New child Product',exact:true}).boundingBox())!;
  for(const box of [plus,create]){
   expect(Math.abs(box.y-status.y)).toBeLessThanOrEqual(1);
   expect(Math.abs(box.height-status.height)).toBeLessThanOrEqual(1);
   expect(Math.abs(box.width-box.height)).toBeLessThanOrEqual(1);
  }
  expect(plus.x).toBeGreaterThan(status.x+status.width);
  expect(create.x-plus.x-plus.width).toBeGreaterThanOrEqual(6);
  expect(await product.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await product.locator('.mix-draft-toolbar').scrollIntoViewIfNeeded();
  await page.screenshot({path:'test-results/product-mix-toolbar-'+width+'.png'});
 }
 expect(writes).toEqual([]);
});
