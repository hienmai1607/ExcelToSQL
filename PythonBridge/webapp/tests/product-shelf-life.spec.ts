import {test,expect} from '@playwright/test';

test('Product Master shows and maintains whole-day Shelf life',async({page})=>{
 let payload:any;
 const product={ID:7,ProductCode:'PRD-7',ProductName:'Almonds',CustomerID:1,CustomerName:'Northstar',Category:'Nuts',WeightGrams:'100',Status:'Active',ShelfLifeDays:365,RowVersion:'AAAAAAAAAAE='};
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Tester',user_id:1,scopes:['Product'],is_admin:false}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{masters:{}},version:0}});
  if(path.endsWith('/lookups'))return route.fulfill({json:{customers:[{ID:1,CustomerName:'Northstar',Status:'Active'}],materials:[],currencies:[],creators:[]}});
  if(path.endsWith('/masters/products'))return route.fulfill({json:{rows:[product],total:1,page:1}});
  if(path==='/api/product/batch'){payload=route.request().postDataJSON();return route.fulfill({json:{results:[{RowNum:1,Status:'OK'}]}})}
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Products',exact:true}).click();
 await expect(page.getByRole('columnheader').filter({hasText:'Shelf life (days)'})).toBeVisible();
 await page.getByRole('button',{name:'Edit product 7',exact:true}).click();
 const shelf=page.getByLabel('Shelf life (days)',{exact:true});
 await expect(shelf).toHaveValue('365');
 await shelf.fill('1.25');await page.getByRole('button',{name:'Review & save'}).click();
 await expect(page.getByText('Use whole days from 0 to 2,147,483,647.')).toBeVisible();
 expect(payload).toBeUndefined();
 await shelf.fill('730');await page.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(payload.rows[0].ShelfLifeDays).toBe('730');
 await expect(page.getByRole('dialog')).toHaveCount(0);
});
