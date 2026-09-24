import {test,expect,type Page} from '@playwright/test';
const rv='AAAAAAAAAAE=';
async function setup(page:Page,scope='Product'){
 const writes:any[]=[];let profile:any={settings:{columns:['CustomerName'],filters:[],sort:[],page_size:25,dark:false,nav_hidden:false,masters:{}},version:0};
 await page.route('**/api/**',route=>{
  const u=new URL(route.request().url()),p=u.pathname;
  if(p.endsWith('/session'))return route.fulfill({json:{username:'Tester',user_id:1,scopes:[scope],is_admin:scope==='Admin'}});
  if(p.endsWith('/preferences')){if(route.request().method()==='POST')profile={settings:route.request().postDataJSON().settings,version:profile.version+1};return route.fulfill({json:profile})}
  if(p==='/api/workbench/masters/lookups')return route.fulfill({json:{materials:[],currencies:[],creators:[{ID:1,UserName:'Tester'}]}});
  if(p==='/api/workbench/masters/products')return route.fulfill({json:{rows:[{ID:7,ProductCode:'P1',ProductName:'Almonds',WeightGrams:'100.00',WeightOz:'3.53',Status:'Active',CreatedByName:'Tester',RowVersion:rv}],total:1,page:1}});
  if(p==='/api/product/batch'){const body=route.request().postDataJSON();writes.push(body);return route.fulfill({json:{results:body.rows.map((r:any)=>({RowNum:r.RowNum,Status:'OK'}))}})}
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 if(scope==='Admin')await page.getByRole('button',{name:'Products',exact:true}).click();
 return {writes,profile:()=>profile};
}
test('Product user gets master; batch grams and ounces use existing write API',async({page})=>{
 const state=await setup(page);
 await expect(page.getByRole('heading',{name:'Products',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'New product',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New product',exact:true});
 await form.getByLabel('Product code',{exact:true}).fill('P2');await form.getByLabel('Product name',{exact:true}).fill('Cashews');await form.getByLabel('Weight',{exact:true}).fill('250.1234');
 await form.getByLabel('Category',{exact:true}).fill('Nuts');
 await form.getByRole('button',{name:'Add record section'}).click();
 const second=form.getByRole('region',{name:'Record 2'});
 await second.getByLabel('Category',{exact:true}).fill('Nuts');
 await second.getByLabel('Product code',{exact:true}).fill('P3');await second.getByLabel('Product name',{exact:true}).fill('Walnuts');await second.getByLabel('Weight',{exact:true}).fill('8');await second.getByLabel('Weight unit',{exact:true}).selectOption('oz');
 await form.getByRole('button',{name:'Review & save'}).click();expect(state.writes).toHaveLength(0);
 await page.getByRole('button',{name:'Confirm save'}).click();await expect(form).toHaveCount(0);
 expect(state.writes[0].rows).toHaveLength(2);
 expect(state.writes[0].rows[0]).toMatchObject({Command:'C',ProductCode:'P2',WeightValue:'250.1234',WeightUnit:'g'});
 expect(state.writes[0].rows[1]).toMatchObject({WeightValue:'8',WeightUnit:'oz'});
});
test('Admin edits Product with original version; conflict keeps values',async({page})=>{
 await setup(page,'Admin');let body:any;
 await page.route('**/api/product/batch',route=>{body=route.request().postDataJSON();return route.fulfill({json:{results:[{RowNum:1,Status:'ERROR',Message:'Concurrency conflict. Refresh Product.'}]}})});
 await page.getByRole('button',{name:'Edit product 7',exact:true}).click();const form=page.getByRole('dialog',{name:'Edit product',exact:true});
 await expect(form.getByLabel('Weight',{exact:true})).toHaveValue('100.00');
 await form.getByLabel('Product name',{exact:true}).fill('New name');
 await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save'}).click();
 await expect(form.getByText('Concurrency conflict. Refresh Product.')).toBeVisible();
 await expect(form.getByLabel('Product name',{exact:true})).toHaveValue('New name');
 expect(body.rows[0]).toMatchObject({ID:7,Command:'U',RowVersion:rv,WeightValue:'100.00',WeightUnit:'g'});
});
test('invalid weights blocked before submission',async({page})=>{
 const state=await setup(page);await page.getByRole('button',{name:'New product',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New product',exact:true});
 await form.getByLabel('Product code',{exact:true}).fill('P2');await form.getByLabel('Product name',{exact:true}).fill('Cashews');
 for(const weight of ['0','-1','1000000','1.12345']){
  await form.getByLabel('Weight',{exact:true}).fill(weight);await form.getByRole('button',{name:'Review & save'}).click();await expect(form.getByText('Use a positive weight with up to 6 whole digits and 4 decimals.')).toBeVisible();
 }
 expect(state.writes).toHaveLength(0);
});
test('product view sort, creator filter, profile and export are independent',async({page})=>{
 const state=await setup(page);let exported:any;
 await page.route('**/api/workbench/masters/products/export',route=>{exported=route.request().postDataJSON();return route.fulfill({body:'xlsx',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})});
 const request=page.waitForRequest(r=>r.url().includes('/masters/products?')&&new URL(r.url()).searchParams.get('sort')?.includes('WeightGrams')===true);
 await page.getByRole('button',{name:'Sort by Weight (g)',exact:true}).click();await request;
 await page.getByRole('button',{name:'Layout options',exact:true}).click();
 const layout=page.getByRole('complementary',{name:'Master layout'});
 await layout.getByRole('group',{name:'Visible filters'}).getByLabel('Created by',{exact:true}).check();
 await page.getByRole('combobox',{name:'Created by',exact:true}).selectOption('1');
 await layout.getByRole('button',{name:'Save layout to profile'}).click();await expect(page.getByRole('status')).toContainText('saved');
 expect(state.profile().settings.masters.products.values.created_by).toBe('1');
 expect(state.profile().settings.columns).toEqual(['CustomerName']);
 await page.getByRole('button',{name:'Export current page to Excel',exact:true}).click();
 await expect.poll(()=>exported?.columns).toContain('WeightGrams');
 expect(exported.rows[0]).toContain('100.00');
});
test('unrelated role has no Product master access',async({page})=>{
 await setup(page,'Packaging');await expect(page.getByRole('button',{name:'Products',exact:true})).toBeDisabled();
});
