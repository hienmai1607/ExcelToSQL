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
 await expect(page.getByRole('note',{name:/Saving automatically maintains the reverse conversion/})).toBeVisible();
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

test('conversion grid keeps its final row inside the scroll region and shares search, toolbar and paging',async({page},info)=>{
 await setup(page,'Admin');const queries:URL[]=[];
 await page.route('**/api/unit-conversions?**',r=>{const url=new URL(r.request().url());queries.push(url);return r.fulfill({json:{rows:Array.from({length:30},(_,i)=>({ID:i+1,FromUoM:'m',ToUoM:'m2',Factor:3.77,Status:'Active',MaterialCode:'PKG-1'})),has_more:url.searchParams.get('page')==='1'}})});
 await page.getByRole('button',{name:'Refresh',exact:true}).click();
 const table=page.getByRole('table',{name:'Unit conversions'}),grid=table.locator('..'),pager=page.locator('.conversions-page .pager');
 await expect(table.locator('tbody tr')).toHaveCount(30);
 const icons=page.locator('.conversions-page .view-toolbar > button');
 for(const button of await icons.all()){const b=(await button.boundingBox())!;expect(b.width).toBe(28);expect(b.height).toBe(28)}
 await grid.evaluate(el=>{el.scrollTop=el.scrollHeight});
 const last=(await table.locator('tbody tr').last().boundingBox())!,g=(await grid.boundingBox())!,p=(await pager.boundingBox())!;
 expect(last.y+last.height).toBeLessThanOrEqual(g.y+g.height+1);expect(p.y).toBeGreaterThanOrEqual(g.y+g.height-1);
 await pager.getByRole('button',{name:'Next',exact:true}).click();await expect(pager).toContainText('Page 2');await expect(pager.getByRole('button',{name:'Next',exact:true})).toBeDisabled();
 await page.getByLabel('Search units or material code').fill('PKG-1');await page.getByRole('button',{name:'Search',exact:true}).click();await expect(pager).toContainText('Page 1');
 await expect.poll(()=>queries.at(-1)?.searchParams.get('search')).toBe('PKG-1');
 await page.getByRole('button',{name:'Clear',exact:true}).click();await expect.poll(()=>queries.at(-1)?.searchParams.get('search')).toBe('');
 await expect(page.getByLabel('Search units or material code')).toHaveValue('');
 await page.screenshot({path:info.outputPath('conversions-1920.png')});
 await page.setViewportSize({width:390,height:844});await pager.scrollIntoViewIfNeeded();await expect(pager.getByRole('button',{name:'Next',exact:true})).toBeInViewport();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('automatically generated reverse is identified and editable',async({page})=>{
 await setup(page,'Admin');
 await page.route('**/api/unit-conversions?**',r=>r.fulfill({json:{rows:[
  {ID:10,FromUoMID:2,ToUoMID:1,FromUoM:'G',ToUoM:'KG',Factor:'0.001',Status:'Active',RowVersion:'AAAAAAAAAAI=',ReverseConversionID:9,IsAutoGenerated:true},
  {ID:9,FromUoMID:1,ToUoMID:2,FromUoM:'KG',ToUoM:'G',Factor:'1000',Status:'Active',RowVersion:'AAAAAAAAAAE=',ReverseConversionID:10,IsAutoGenerated:false}
 ],has_more:false}}));
 await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(page.getByRole('columnheader',{name:'Direction',exact:true})).toBeVisible();
 await expect(page.getByText('Automatic reverse',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Edit conversion 10',exact:true}).click();
 await expect(page.getByLabel('From UoM',{exact:true})).toHaveValue('2');
 await expect(page.getByLabel('Conversion factor',{exact:true})).toHaveValue('0.001');
 await expect(page.getByRole('note',{name:/Saving maintains both directions/})).toBeVisible();
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
