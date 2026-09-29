import {test,expect,type Page} from '@playwright/test';
async function setup(page:Page,scope:string){
 const writes:any[]=[];
 await page.route('**/api/**',async r=>{
  const p=new URL(r.request().url()).pathname;
  if(p.endsWith('/session'))return r.fulfill({json:{user_id:1,username:'Tester',scopes:[scope],is_admin:scope==='Admin'}});
  if(p.endsWith('/preferences'))return r.fulfill({json:{settings:{columns:['CustomerName'],filters:[],sort:[],masters:{},page_size:25},version:0}});
  if(p==='/api/unit-conversions/lookups')return r.fulfill({json:{uoms:[{ID:1,UoMCode:'KG',Status:'Active'},{ID:2,UoMCode:'G',Status:'Active'}],packaging:[{ID:3,MaterialCode:'PKG-1',MaterialName:'Box',Status:'Active'}],raw:[{ID:4,MaterialCode:'RAW-1',MaterialName:'Kernel',Status:'Active'}],vendors:[{ID:5,VendorName:'Vendor 1',Status:'Active'}]}});
  if(p==='/api/unit-conversions'){
   if(r.request().method()==='POST'){writes.push(r.request().postDataJSON());return r.fulfill({json:{ID:10,RowVersion:'AAAAAAAAAAE='}})}
   return r.fulfill({json:{rows:[{ID:9,FromUoMID:1,ToUoMID:2,FromUoM:'KG',ToUoM:'G',Factor:'1000',Status:'Active',RowVersion:'AAAAAAAAAAE='}],has_more:false}});
  }
  if(p.endsWith('/lookups'))return r.fulfill({json:{materials:[],currencies:[],creators:[]}});
  return r.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Unit Conversions',exact:true}).click();
 return writes;
}
test('Admin maintains a general conversion',async({page})=>{
 const writes=await setup(page,'Admin');
 await page.getByRole('button',{name:'New conversion',exact:true}).click();
 await expect(page.getByLabel('Conversion scope')).toHaveValue('general');
 await page.getByLabel('From UoM',{exact:true}).selectOption('1');
 await page.getByLabel('To UoM',{exact:true}).selectOption('2');
 await page.getByLabel('Conversion factor',{exact:true}).fill('1000');
 await page.getByLabel('Conversion factor',{exact:true}).blur();
 await expect(page.getByLabel('Conversion factor',{exact:true})).toHaveValue('1,000');
 await page.getByRole('button',{name:'Save conversion',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(writes[0]).toMatchObject({Factor:'1000',PackagingMaterialID:null,RawMaterialID:null,VendorID:null});
});
test('Raw Material user cannot edit general factors but can maintain vendor-specific ones',async({page})=>{
 const writes=await setup(page,'RawMaterial');
 await expect(page.getByRole('button',{name:'Edit conversion 9',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'New conversion',exact:true}).click();
 await expect(page.getByLabel('Conversion scope').locator('option')).toHaveCount(1);
 await page.getByLabel('Conversion material').selectOption('4');
 await page.getByLabel('Vendor',{exact:true}).selectOption('5');
 await page.getByLabel('From UoM',{exact:true}).selectOption('1');
 await page.getByLabel('To UoM',{exact:true}).selectOption('2');
 await page.getByLabel('Conversion factor',{exact:true}).fill('24');
 await page.getByRole('button',{name:'Save conversion',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(writes[0]).toMatchObject({Factor:'24',RawMaterialID:4,VendorID:5,PackagingMaterialID:null});
});
test('Packaging Manager conversion screen is read only',async({page})=>{
 await setup(page,'PackagingManager');
 await expect(page.getByRole('button',{name:'New conversion',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Edit conversion 9',exact:true})).toHaveCount(0);
});

test('conversion factor retains nine decimals on blur and save',async({page})=>{
 const writes=await setup(page,'Admin');
 await page.getByRole('button',{name:'New conversion',exact:true}).click();
 await page.getByLabel('From UoM',{exact:true}).selectOption('1');
 await page.getByLabel('To UoM',{exact:true}).selectOption('2');
 const input=page.getByLabel('Conversion factor',{exact:true});
 await input.fill('0.0000000001');await input.blur();
 await expect(input).toHaveAttribute('aria-invalid','true');
 await input.fill('0.000000123');await input.blur();
 await expect(input).toHaveValue('0.000000123');
 await page.getByRole('button',{name:'Save conversion',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(writes[0].Factor).toBe('0.000000123');
});
