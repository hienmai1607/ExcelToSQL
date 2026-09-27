import {test,expect,type Page} from '@playwright/test';
const rv='AAAAAAAAAAE=';
async function setup(page:Page){
 const writes:any[]=[];
 const product={ID:7,ProductCode:'PRD-0000000007',ProductName:'Almonds',Category:'Nuts',WeightGrams:'100',Status:'Active',RowVersion:rv};
 await page.route('**/api/**',route=>{
  const p=new URL(route.request().url()).pathname;
  if(p.endsWith('/session'))return route.fulfill({json:{username:'Tester',user_id:1,scopes:['Product'],is_admin:false}});
  if(p.endsWith('/preferences'))return route.fulfill({json:{settings:{columns:['CustomerName'],filters:[],sort:[],page_size:25,masters:{}},version:0}});
  if(p.endsWith('/lookups'))return route.fulfill({json:{customers:[{ID:1,CustomerName:"Northstar",Status:"Active"}],materials:[],currencies:[],creators:[]}});
  if(p.endsWith('/masters/products'))return route.fulfill({json:{rows:[product],total:1,page:1}});
  if(p==='/api/product/batch'){const body=route.request().postDataJSON();writes.push(body);return route.fulfill({json:{results:body.rows.map((r:any)=>({RowNum:r.RowNum,Status:'OK'}))}})}
  if(p.endsWith('/products/7/grades'))return route.fulfill({json:{product,versions:[{ID:3,Version:1,Status:'Active',RowVersion:rv}],items:[{VersionID:3,ParentID:'0',ID:1,Grade:'Existing',RatioPct:100}]}});
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 return {writes,product};
}
test('new Product has automatic code and nested grades persist across parent navigation',async({page})=>{
 const {writes}=await setup(page);
 await page.getByRole('button',{name:'New product',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New product',exact:true});
 await expect(form.getByLabel('Product code',{exact:true})).toHaveCount(0);
 await expect(form.getByText('Product code: Assigned on save')).toBeVisible();
 await form.getByLabel('Customer',{exact:true}).selectOption('1');
 await form.getByLabel('Product name',{exact:true}).fill('Blend');
 await form.getByLabel('Category',{exact:true}).fill('Nuts');
 await form.getByLabel('Weight',{exact:true}).fill('100');
 await form.getByRole('button',{name:'Grades for record 1'}).click();
 const grades=page.getByRole('dialog',{name:'Product grades',exact:true});
 await grades.getByRole('button',{name:'By level',exact:true}).click();
 await grades.getByRole('button',{name:'Add grade',exact:true}).click();
 await grades.getByLabel('Grade 0/1',{exact:true}).fill('A');
 await grades.getByLabel('Ratio 0/1',{exact:true}).fill('60');
 await grades.getByRole('button',{name:'Add grade',exact:true}).click();
 await grades.getByLabel('Grade 0/2',{exact:true}).fill('B');
 await grades.getByLabel('Ratio 0/2',{exact:true}).fill('40');
 await grades.getByRole('button',{name:'Next level',exact:true}).click();
 await expect(grades.getByRole('combobox',{name:'Parent ID'})).toHaveValue('0/1');
 await grades.getByRole('button',{name:'Add grade',exact:true}).click();
 await grades.getByLabel('Grade 0/1/1',{exact:true}).fill('A1');
 await grades.getByLabel('Ratio 0/1/1',{exact:true}).fill('90');
 await grades.getByRole('button',{name:'Use grades'}).click();
 await expect(grades.getByRole('alert')).toContainText('parent 0/1 must total 100%');
 await grades.getByLabel('Ratio 0/1/1',{exact:true}).fill('100');
 await grades.getByRole('combobox',{name:'Parent ID'}).selectOption('0/2');
 await grades.getByRole('button',{name:'Add grade',exact:true}).click();
 await grades.getByLabel('Grade 0/2/1',{exact:true}).fill('B1');
 await grades.getByRole('button',{name:'Previous level'}).click();
 await expect(grades.getByLabel('Grade 0/1',{exact:true})).toHaveValue('A');
 await grades.getByRole('button',{name:'Use grades'}).click();
 await expect(grades).toHaveCount(0);
 await form.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0].rows[0].ProductCode).toBeUndefined();
 expect(writes[0].rows[0].GradeVersion.items).toHaveLength(4);
 expect(writes[0].rows[0].GradeVersion.items[3]).toMatchObject({ParentID:'0/2',ID:1,RatioPct:'100'});
});

test('grade toolbar displays compact structural summary',async({page})=>{
 await setup(page);
 await page.getByRole('button',{name:'Grades for product 7',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Product grades',exact:true});
 await expect(dialog.getByLabel('Grade summary')).toContainText('Balanced parents');
 await expect(dialog.getByLabel('Grade summary')).toContainText('1 / 1');
 await page.screenshot({path:'test-results/product-grade-layout.png',fullPage:true});
});
test('active version is immutable; copying supports activation and retains conflicts',async({page})=>{
 await setup(page);let submitted:any;
 await page.route('**/products/7/grades',async route=>{
  if(route.request().method()==='GET')return route.fallback();
  submitted=route.request().postDataJSON();
  return route.fulfill({status:409,json:{detail:'Product or its grade versions changed. Refresh before saving.'}});
 });
 await page.getByRole('button',{name:'Grades for product 7'}).click();
 const grades=page.getByRole('dialog',{name:'Product grades',exact:true});
 await grades.getByRole('button',{name:'By level',exact:true}).click();
 await expect(grades.getByLabel('Grade 0/1',{exact:true})).toHaveAttribute('readonly','');
 await grades.getByRole('button',{name:'New version',exact:true}).click();
 await grades.getByLabel('Grade 0/1',{exact:true}).fill('Revision');
 await grades.getByRole('combobox',{name:'Grade status'}).selectOption('Active');
 await grades.getByRole('button',{name:'Review & save'}).click();
 const confirm=page.getByRole('dialog',{name:'Confirm grade save'});
 await expect(confirm.getByText('The currently active version will become Inactive.')).toBeVisible();
 await confirm.getByRole('button',{name:'Confirm save'}).click();
 await expect(grades.getByRole('alert')).toContainText('Refresh before saving');
 await expect(grades.getByLabel('Grade 0/1',{exact:true})).toHaveValue('Revision');
 expect(submitted).toMatchObject({VersionID:null,RowVersion:null,ProductRowVersion:rv,Status:'Active'});
});
test('removing a parent removes descendants with confirmation',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'New product',exact:true}).click();
 await page.getByRole('button',{name:'Grades for record 1'}).click();
 const grades=page.getByRole('dialog',{name:'Product grades',exact:true});
 await grades.getByRole('button',{name:'By level',exact:true}).click();
 await grades.getByRole('button',{name:'Add grade',exact:true}).click();await grades.getByLabel('Grade 0/1',{exact:true}).fill('Root');
 await grades.getByRole('button',{name:'Next level'}).click();
 await grades.getByRole('button',{name:'Add grade',exact:true}).click();await grades.getByLabel('Grade 0/1/1',{exact:true}).fill('Child');
 await grades.getByRole('button',{name:'Previous level'}).click();
 page.once('dialog',dialog=>dialog.accept());
 await grades.getByRole('button',{name:'Remove grade 0/1',exact:true}).click();
 await expect(grades.getByRole('button',{name:'Next level'})).toBeDisabled();
 await grades.getByRole('button',{name:'Use grades'}).click();
 await expect(grades.getByRole('alert')).toHaveText('Add at least one grade.');
});

test('all levels edit together, add descendants and save the complete structure',async({page})=>{
 const {product}=await setup(page);let submitted:any;
 let items=[
  {VersionID:3,ParentID:'0',ID:1,Grade:'Root',RatioPct:'100'},
  {VersionID:3,ParentID:'0/1',ID:1,Grade:'Child A',RatioPct:'60'},
  {VersionID:3,ParentID:'0/1',ID:2,Grade:'Child B',RatioPct:'40'}
 ];
 await page.route('**/products/7/grades',route=>{
  if(route.request().method()==='POST'){
   submitted=route.request().postDataJSON();
   items=submitted.items.map((i:any)=>({...i,VersionID:3}));
   return route.fulfill({json:{ID:3}});
  }
  return route.fulfill({json:{product,versions:[{ID:3,Version:1,Status:'Draft',RowVersion:rv}],items}});
 });
 await page.getByRole('button',{name:'Grades for product 7'}).click();
 const grades=page.getByRole('dialog',{name:'Product grades',exact:true});
 await expect(grades.getByRole('button',{name:'All levels',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(grades.getByLabel('Grade 0/1',{exact:true})).toBeVisible();
 await expect(grades.getByLabel('Grade 0/1/1',{exact:true})).toBeVisible();
 await grades.getByLabel('Grade 0/1',{exact:true}).fill('Updated root');
 await grades.getByLabel('Ratio 0/1/1',{exact:true}).fill('50');
 await grades.getByRole('button',{name:'Review & save'}).click();
 await expect(grades.getByRole('alert')).toContainText('parent 0/1 must total 100%');
 await grades.getByLabel('Ratio 0/1/2',{exact:true}).fill('50');
 await grades.getByRole('button',{name:'Add child grade to 0/1/1',exact:true}).click();
 await grades.getByLabel('Grade 0/1/1/1',{exact:true}).fill('Grandchild');
 await expect(grades.getByRole('region',{name:'Grades under 0/1/1',exact:true}).getByRole('status')).toContainText('100% / 100%');
 await grades.getByRole('button',{name:'By level',exact:true}).click();
 await expect(grades.getByLabel('Grade 0/1/1/1',{exact:true})).toHaveCount(0);
 await grades.getByRole('button',{name:'All levels',exact:true}).click();
 await expect(grades.getByLabel('Grade 0/1/1/1',{exact:true})).toHaveValue('Grandchild');
 await expect(grades.getByLabel('Grade 0/1',{exact:true})).toHaveValue('Updated root');
 await grades.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('dialog',{name:'Confirm grade save'}).getByRole('button',{name:'Confirm save'}).click();
 await expect.poll(()=>submitted?.items.length).toBe(4);
 expect(submitted.items[0].Grade).toBe('Updated root');
 expect(submitted.items[1].RatioPct).toBe('50');
 await expect(grades.getByLabel('Grade 0/1/1/1',{exact:true})).toHaveValue('Grandchild');
});
