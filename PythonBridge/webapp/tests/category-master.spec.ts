import {test,expect,type Page} from '@playwright/test';
const rv='AAAAAAAAAAE=';
async function setup(page:Page,admin=true,blocked=false){
 const writes:any[]=[];
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Tester',user_id:1,scopes:[admin?'Admin':'Product'],is_admin:admin}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/categories'){
   if(route.request().method()==='POST'){writes.push(route.request().postDataJSON());return route.fulfill({json:{rows:[{ID:2,RowVersion:rv}]}})}
   return route.fulfill({json:{rows:[{ID:1,CategoryName:'Almonds',Status:'Active',RowVersion:rv}],total:1,page:1}});
  }
  if(path==='/api/workbench/masters/lookups')return route.fulfill({json:{uoms:[{ID:99,UoMCode:'g',UoMName:'Grams',Category:'Weight/Mass',BaseFactor:1,Status:'Active'}],categories:[{ID:1,CategoryName:'Almonds',Status:'Active'},{ID:2,CategoryName:'Test',Status:'Block'}],customers:[{ID:1,CustomerName:'Northstar',Status:'Active'}],materials:[],currencies:[],creators:[]}});
  if(path==='/api/workbench/masters/products')return route.fulfill({json:{rows:[{ID:7,ProductCode:'P7',ProductName:'Almond pack',CustomerID:1,Category:blocked?'Test':'Almonds',WeightGrams:100,Status:'Active',RowVersion:rv}],total:1,page:1}});
  if(path==='/api/product/batch'){const body=route.request().postDataJSON();writes.push(body);return route.fulfill({json:{results:body.rows.map((r:any)=>({RowNum:r.RowNum,Status:'OK'}))}})}
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 return writes;
}
test('Admin creates and edits categories using review, confirmation and row version',async({page})=>{
 const writes=await setup(page);
 await page.getByRole('button',{name:'Category Master',exact:true}).click();
 await page.getByRole('button',{name:'New category',exact:true}).click();
 let form=page.getByRole('dialog',{name:'New Category',exact:true});
 await form.getByLabel('Category name',{exact:true}).fill('Cashews');
 await form.getByRole('button',{name:'Review & save'}).click();
 await expect(page.getByRole('dialog',{name:'Confirm master save'})).toContainText('Cashews');
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(form).toHaveCount(0);
 expect(writes[0]).toMatchObject({ID:null,CategoryName:'Cashews',Status:'Active'});
 await page.getByRole('button',{name:'View category 1',exact:true}).click();
 form=page.getByRole('dialog',{name:'Edit Category',exact:true});
 await form.getByLabel('Status',{exact:true}).selectOption('Block');
 await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(form).toHaveCount(0);
 expect(writes[1]).toMatchObject({ID:1,RowVersion:rv,CategoryName:'Almonds',Status:'Block'});
});
test('Product user reads Category Master but cannot maintain it',async({page})=>{
 await setup(page,false);await page.getByRole('button',{name:'Category Master',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Category Master',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'New category',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'View category 1',exact:true}).click();
 const form=page.getByRole('dialog',{name:'View Category',exact:true});
 await expect(form.getByLabel('Category name',{exact:true})).toBeDisabled();
 await expect(form.getByRole('button',{name:'Review & save'})).toHaveCount(0);
});
test('Product dropdown only assigns active categories; existing blocked value stays unchanged',async({page})=>{
 const writes=await setup(page,false,true);
 await page.getByRole('button',{name:'New product',exact:true}).click();
 let form=page.getByRole('dialog',{name:'New product',exact:true});
 const category=form.getByRole('combobox',{name:'Category',exact:true});
 await expect(category.locator('option')).toHaveCount(2);
 await category.selectOption('Almonds');
 page.once('dialog',d=>d.accept());await form.getByRole('button',{name:'Close form',exact:true}).click();
 await page.getByRole('button',{name:'Edit product 7',exact:true}).click();
 form=page.getByRole('dialog',{name:'Edit product',exact:true});
 await expect(form.getByRole('combobox',{name:'Category',exact:true})).toHaveValue('Test');
 await expect(form.getByRole('combobox',{name:'Category',exact:true}).locator('option[value="Test"]')).toHaveAttribute('disabled','');
 await form.getByLabel('Product name',{exact:true}).fill('Updated pack');
 await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(form).toHaveCount(0);expect(writes[0].rows[0].Category).toBe('Test');
});
