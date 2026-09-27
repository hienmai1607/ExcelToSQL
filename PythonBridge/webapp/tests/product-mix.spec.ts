import {test,expect,type Page} from '@playwright/test';
const rv='AAAAAAAAAAE=';
async function setup(page:Page){
 const writes:any[]=[];
 const product={ID:7,CustomerID:1,CustomerName:'Northstar',ProductCode:'PRD-7',ProductName:'Mixed pack',IsMix:true,MixReady:false,Category:'Nuts',WeightGrams:0,Status:'Active',RowVersion:rv};
 let versions:any[]=[],items:any[]=[];
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Tester',user_id:1,scopes:['Product'],is_admin:false}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{columns:['CustomerName'],filters:[],sort:[],page_size:25,masters:{}},version:0}});
  if(path.endsWith('/lookups'))return route.fulfill({json:{customers:[{ID:1,CustomerName:'Northstar',Status:'Active'}],materials:[],currencies:[],creators:[]}});
  if(path.endsWith('/masters/products'))return route.fulfill({json:{rows:[product],total:1,page:1}});
  if(path.endsWith('/products/7/mix')){
   if(route.request().method()==='POST'){const b=route.request().postDataJSON();writes.push(b);versions=[{ID:4,Version:1,Status:b.Status,RowVersion:rv}];items=b.items.map((i:any)=>({...i,VersionID:4,ProductCode:'CHILD',ProductName:'Child',WeightGrams:100}));return route.fulfill({json:{ID:4}})}
   return route.fulfill({json:{product,versions,items,choices:[{ID:2,ProductCode:'CHILD',ProductName:'Child',WeightGrams:100,RowVersion:rv}]}});
  }
  if(path.endsWith('/products/7/mix/grades'))return route.fulfill({json:{versions,items:items.map(i=>({...i,MixVersionID:i.VersionID,GradeVersion:1,ParentID:'0',ID:1,Grade:'Child Grade A',RatioPct:100}))}});
  if(path.endsWith('/products/7/grades'))return route.fulfill({json:{product,versions:[],items:[]}});
  if(path==='/api/product/batch'){const b=route.request().postDataJSON();writes.push(b);return route.fulfill({json:{results:b.rows.map((r:any)=>({RowNum:r.RowNum,Status:'OK'}))}})}
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 return writes;
}
test('mix activation submits child quantities and version tokens; active mix is read-only',async({page})=>{
 const writes=await setup(page);
 await page.getByRole('button',{name:'Grades for product 7',exact:true}).click();
 const mix=page.getByRole('dialog',{name:'Product Mix',exact:true});
 await mix.getByRole('button',{name:'Add mix item'}).click();
 await mix.getByLabel('Child Product 1').selectOption('2');
 await mix.getByLabel('Unit quantity 1').fill('2.5');
 await expect(mix.locator('.grade-summary')).toContainText('250');
 await mix.getByLabel('Mix status').selectOption('Active');
 await mix.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(mix.getByLabel('Unit quantity 1')).toHaveAttribute('readonly','');
 expect(writes[0]).toMatchObject({Status:'Active',ProductRowVersion:rv,items:[{ProductID:2,UnitQuantity:'2.5',RowVersion:rv}]});
 await mix.getByRole('button',{name:'Grade',exact:true}).click();
 const grades=page.getByRole('dialog',{name:'Product grades',exact:true});
 await expect(grades.getByRole('cell',{name:'Child Grade A',exact:true})).toBeVisible();
 await expect(grades.getByRole('button',{name:'New version',exact:true})).toHaveCount(0);
 await expect(grades.getByRole('button',{name:'Review & save',exact:true})).toHaveCount(0);
 await expect(grades.locator('table input')).toHaveCount(0);
});
test('Product Mix column is display-only; Edit retains the checkbox',async({page})=>{
 await setup(page);
 await expect(page.getByRole('cell',{name:'Setup required',exact:true})).toBeVisible();
 await expect(page.getByRole('checkbox',{name:'Product Mix 7',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Edit product 7',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Edit product',exact:true}).getByLabel('Product Mix',{exact:true})).toBeChecked();
});
test('new Product Mix needs no manually entered net weight',async({page})=>{
 const writes=await setup(page);
 await page.getByRole('button',{name:'New product',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New product',exact:true});
 await form.getByLabel('Product Mix',{exact:true}).check();
 await form.getByLabel('Customer',{exact:true}).selectOption('1');
 await form.getByLabel('Product name',{exact:true}).fill('New mixed pack');
 await form.getByLabel('Category',{exact:true}).fill('Nuts');
 await expect(form.getByLabel('Weight',{exact:true})).toHaveAttribute('readonly','');
 await form.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0].rows[0]).toMatchObject({IsMix:true,CustomerID:1,WeightValue:0,WeightUnit:'g'});
});
test('unsaved mix switching is guarded and invalid quantities stay in the editor',async({page})=>{
 const writes=await setup(page);await page.getByRole('button',{name:'Grades for product 7',exact:true}).click();
 const mix=page.getByRole('dialog',{name:'Product Mix',exact:true});
 await mix.getByRole('button',{name:'Add mix item'}).click();
 await mix.getByLabel('Child Product 1').selectOption('2');await mix.getByLabel('Unit quantity 1').fill('0');
 await mix.getByRole('button',{name:'Review & save'}).click();await expect(mix.getByRole('alert')).toContainText('positive');
 page.once('dialog',d=>d.dismiss());await mix.getByRole('button',{name:'Grade',exact:true}).click();
 await expect(mix).toBeVisible();expect(writes).toHaveLength(0);
});
