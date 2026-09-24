import {test,expect} from '@playwright/test';
test('Packaging request workbook uses both layouts and mandatory review columns',async({page})=>{
 let submitted:any;
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'PIC',scopes:['Packaging'],is_admin:false}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{columns:['CustomerName'],filters:[],sort:[],page_size:25,requests:{header:{field_version:3,columns:['ResponseDue'],sort:[],filters:['search'],values:{}},items:{field_version:3,columns:['PMCost'],sort:[]}}},version:0}});
  if(path.endsWith('/packaging-excel/download')){submitted=route.request().postDataJSON();return route.fulfill({body:'test',headers:{'Content-Type':'application/vnd.ms-excel.sheet.macroEnabled.12'}})}
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Request layout',exact:true}).click();
 await expect(page.getByRole('group',{name:'Visible columns',exact:true}).getByRole('checkbox',{name:'Request',exact:true})).toBeDisabled();
 const download=page.waitForEvent('download');
 await page.getByRole('button',{name:'Excel Local Update',exact:true}).click();
 expect((await download).suggestedFilename()).toBe('Packaging_Request_Local_Update.xlsm');
 expect(submitted.views.header.columns).toContain('RequestNumber');
 expect(submitted.views.items.columns).toContain('FirstPMType');
 expect(submitted.views.items.columns).toContain('SecondPMMOQ');
 expect(submitted.page_size).toBe(25);
});
