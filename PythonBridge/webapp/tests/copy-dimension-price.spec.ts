import {test,expect} from '@playwright/test';
test('Copy Dim. pricing does not maintain independent measurements',async({page})=>{
 const writes:any[]=[];
 await page.route('**/api/**',route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Admin',is_admin:true,scopes:['Admin']}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/workbench/masters/lookups')return route.fulfill({json:{
   materials:[{ID:5,MaterialCode:'PKG-Single',MaterialName:'Single box',PackagingTypeID:8,CopyDim:true,Status:'Active'}],
   currencies:[{ID:1,CurrencyCode:'USD'}],creators:[],vendors:[],uoms:[{ID:2,UoMCode:'EA',Status:'Active'}],
   supplierDimensions:[],materialDimensions:[{ID:9,PackagingTypeID:8,D1Name:'Length',D2Name:'Width',D1Unit:'mm',D2Unit:'mm',Status:'Active',RowVersion:'AAAAAAAAAAE='}]}});
  if(path==='/api/packaging/price/batch'){const body=req.postDataJSON();writes.push(body);return route.fulfill({json:{results:[{RowNum:1,Status:'OK'}]}})}
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Pricing',exact:true}).click();
 await page.getByRole('button',{name:'New price',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New price',exact:true});
 await form.getByLabel('Material',{exact:true}).selectOption('5');
 await form.getByLabel('Vendor currency',{exact:true}).selectOption('1');
 await form.getByLabel('Price UoM',{exact:true}).selectOption('EA');
 await form.getByLabel('Unit price (Vendor currency)',{exact:true}).fill('10');
 await form.getByLabel('Effective from',{exact:true}).fill('2026-01-01');
 await expect(form.getByLabel('Material dimension definition',{exact:true})).toHaveCount(0);
 await expect(form.getByLabel('Supplier dimension definition',{exact:true})).toHaveCount(0);
 await form.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(1);
 expect(writes[0].rows[0]).not.toHaveProperty('MaterialDimensionID');
 expect(writes[0].rows[0]).not.toHaveProperty('SupplierDimensionID');
});
