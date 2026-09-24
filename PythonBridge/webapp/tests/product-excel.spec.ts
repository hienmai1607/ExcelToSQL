import {test,expect} from '@playwright/test';
test('Product Excel workbench uses current layout, filters and page',async({page})=>{
 let submitted:any;
 await page.route('**/api/**',route=>{
  const p=new URL(route.request().url()).pathname;
  if(p.endsWith('/session'))return route.fulfill({json:{username:'Admin',scopes:['Admin'],is_admin:true}});
  if(p.endsWith('/preferences'))return route.fulfill({json:{settings:{columns:['CustomerName'],filters:[],sort:[],page_size:25,masters:{products:{columns:['Grade','ProductName'],filters:['search'],values:{search:'Nut'},sort:[{column:'Grade',direction:'desc'}],page_size:200}}},version:0}});
  if(p.endsWith('/product-excel/download')){submitted=route.request().postDataJSON();return route.fulfill({body:'test workbook',headers:{'Content-Type':'application/vnd.ms-excel.sheet.macroEnabled.12','Content-Disposition':'attachment; filename="Product_Local_Update.xlsm"'}})}
  if(p.endsWith('/lookups'))return route.fulfill({json:{materials:[],currencies:[],creators:[]}});
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Products',exact:true}).click();
 await page.getByRole('button',{name:'Layout options',exact:true}).click();
 const layout=page.getByRole('complementary',{name:'Master layout'});
 for(const name of ['Product code','Product name','Category','Weight (g)']){
  await expect(layout.getByRole('checkbox',{name,exact:true})).toBeChecked();
  await expect(layout.getByRole('checkbox',{name,exact:true})).toBeDisabled();
 }
 await expect(layout.getByRole('checkbox',{name:'Grade',exact:true})).toBeEnabled();
 const download=page.waitForEvent('download');
 await page.getByRole('button',{name:'Excel Local Update',exact:true}).click();
 expect((await download).suggestedFilename()).toBe('Product_Local_Update.xlsm');
 expect(submitted.layout.columns).toEqual(['Grade','ProductName','ProductCode','Category','WeightGrams']);
 expect(submitted.layout.values.search).toBe('Nut');
 expect(submitted.layout.page_size).toBe(200);
 await expect(page.getByText('Open the downloaded workbook',{exact:false})).toBeVisible();
});
