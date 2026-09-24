import {test,expect} from '@playwright/test';
test('Opportunity combined workbook uses both layouts and keeps required columns',async({page})=>{
 let submitted:any;
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Admin',scopes:['Admin'],is_admin:true}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{columns:['CustomerName'],filters:[],sort:[],page_size:25,opportunity:{header:{field_version:3,columns:['HeaderStage'],sort:[],filters:['customer_name'],values:{}},items:{field_version:3,columns:['ShelfPrice'],sort:[]}}},version:0}});
  if(path.endsWith('/opportunity-excel/download')){submitted=route.request().postDataJSON();return route.fulfill({body:'test',headers:{'Content-Type':'application/vnd.ms-excel.sheet.macroEnabled.12'}})}
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Opportunity layout',exact:true}).click();
 await expect(page.getByRole('group',{name:'Visible columns',exact:true}).getByRole('checkbox',{name:'Customer',exact:true})).toBeDisabled();
 const download=page.waitForEvent('download');
 await page.getByRole('button',{name:'Excel Local Update',exact:true}).click();
 expect((await download).suggestedFilename()).toBe('Opportunity_Local_Update.xlsm');
 expect(submitted.views.header.columns).toContain('CustomerName');
 expect(submitted.views.items.columns).toEqual(['ShelfPrice','ProductCode','ItemDescription','AnnualUnit']);
 expect(submitted.page_size).toBe(25);
});
