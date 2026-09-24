import {test,expect} from '@playwright/test';
for(const entity of ['materials','prices'] as const){
 test(entity+' Excel Local Update respects required fields and layout',async({page})=>{
  let submitted:any;
  await page.route('**/api/**',r=>{
   const path=new URL(r.request().url()).pathname;
   if(path.endsWith('/session'))return r.fulfill({json:{username:'Admin',scopes:['Admin'],is_admin:true}});
   if(path.endsWith('/preferences'))return r.fulfill({json:{settings:{columns:['CustomerName'],filters:[],sort:[],page_size:25,masters:{[entity]:{columns:['Status'],filters:[],values:{},sort:[],page_size:200}}},version:0}});
   if(path.endsWith('/master-excel/'+entity+'/download')){submitted=r.request().postDataJSON();return r.fulfill({body:'test workbook'})}
   if(path.endsWith('/lookups'))return r.fulfill({json:{materials:[],currencies:[],creators:[]}});
   return r.fulfill({json:{rows:[],total:0,page:1}});
  });
  await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('button',{name:entity==='materials'?'Packaging Material':'Packaging Material Pricing',exact:true}).click();
  await page.getByRole('button',{name:'Layout options',exact:true}).click();
  const columns=page.getByRole('group',{name:'Visible columns',exact:true});
  await expect(columns.getByRole('checkbox',{name:entity==='materials'?'Material code':'Material',exact:true})).toBeDisabled();
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Excel Local Update',exact:true}).click();
  expect((await download).suggestedFilename()).toBe(entity==='materials'?'Packaging_Material_Local_Update.xlsm':'Packaging_Pricing_Local_Update.xlsm');
  expect(submitted.layout.columns).toContain(entity==='materials'?'UnitOfMeasure':'EffectiveFrom');
  expect(submitted.layout.page_size).toBe(200);
 });
}
