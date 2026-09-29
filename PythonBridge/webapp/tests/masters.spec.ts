import {test,expect,type Page} from '@playwright/test';
const rv='AAAAAAAAAAE=';
async function setup(page:Page,scope='Admin'){
 const writes:any[]=[];let profile:any={settings:{columns:['CustomerName'],filters:[],customer_name:'',market_id:'',status:'',page_size:25,dark:false,nav_hidden:false,masters:{}},version:0};
 await page.route('**/api/**',async route=>{
  const u=new URL(route.request().url()),p=u.pathname;
  if(p.endsWith('/session'))return route.fulfill({json:{user_id:1,username:'Tester',scopes:[scope],is_admin:scope==='Admin'}});
  if(p.endsWith('/preferences')){if(route.request().method()==='POST')profile={settings:route.request().postDataJSON().settings,version:profile.version+1};return route.fulfill({json:profile})}
  if(p==='/api/workbench/masters/lookups')return route.fulfill({json:{rawGrades:[{ID:21,GradeName:'Whole kernels',MaterialCode:'RAW-1',Status:'Active',MaterialStatus:'Active',ParentGradeID:null}],uoms:[{ID:4,UoMCode:"EA",UoMName:"Each",Status:"Active"},{ID:1,UoMCode:"Each",UoMName:"Each",Status:"Active"},{ID:2,UoMCode:"Per box",Status:"Active"},{ID:3,UoMCode:"Changed basis",Status:"Active"}],vendors:[{ID:7,VendorName:'Local supplier',Status:'Active',CurrencyID:2}],materials:[{ID:1,MaterialCode:'BOX',MaterialName:'Cardboard box',Status:'Active'}],currencies:[{ID:2,CurrencyCode:'USD',CurrencyName:'US Dollar'}],creators:[{ID:1,UserName:'Tester'}]}});
  if(p==='/api/workbench/masters/materials')return route.fulfill({json:{rows:[{ID:3,MaterialCode:'BAG',MaterialName:'Paper bag',Description:null,UnitOfMeasure:'EA',Status:'Active',RowVersion:rv}],total:1,page:1}});
  if(p==='/api/workbench/masters/prices')return route.fulfill({json:{rows:[{ID:4,MaterialID:1,MaterialCode:'BOX',MaterialName:'Cardboard box',CurrencyID:2,CurrencyCode:'USD',BaseUoM:'Each',QuantityFrom:'0.0000',QuantityTo:null,UnitPrice:'12345678901234.1234',EffectiveFrom:'2026-09-20',EffectiveTo:null,Status:'Active',RowVersion:rv}],total:1,page:1}});
  if(p.endsWith('/batch')){const payload=route.request().postDataJSON();writes.push({path:p,...payload});return route.fulfill({json:{results:payload.rows.map((r:any)=>({RowNum:r.RowNum,Status:'OK'}))}})}
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 return {writes,profile:()=>profile};
}
test('material uses stacked batch sections and confirmation',async({page})=>{
 const state=await setup(page,'Packaging');await page.getByRole('button',{name:'Packaging Material',exact:true}).click();
 await page.getByRole('button',{name:'New material',exact:true}).click();
 const first=page.getByRole('region',{name:'Record 1',exact:true});
 await expect(first.getByLabel('Material code',{exact:true})).toHaveCount(0);await first.getByLabel('Material name',{exact:true}).fill('New box');await first.getByLabel('Base UoM',{exact:true}).selectOption('EA');
 await page.getByRole('button',{name:'+ Add record section'}).click();
 const second=page.getByRole('region',{name:'Record 2',exact:true});
 await second.getByLabel('Material name',{exact:true}).fill('New bag');await second.getByLabel('Base UoM',{exact:true}).selectOption('EA');
 await page.getByRole('button',{name:'Review & save'}).click();expect(state.writes).toHaveLength(0);
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].path).toBe('/api/packaging/material/batch');expect(state.writes[0].rows).toHaveLength(2);
 expect(state.writes[0].rows[0]).toMatchObject({Command:'C',Description:null,MaterialName:'New box'});
});
test('price preserves decimal precision and nulls, sends version on edit',async({page})=>{
 const state=await setup(page);await page.getByRole('button',{name:'Packaging Material Pricing',exact:true}).click();
 await page.getByRole('button',{name:'Edit price 4'}).click();
 await expect(page.getByLabel('Unit price (Vendor currency)',{exact:true})).toHaveValue('12,345,678,901,234.12');
 await page.getByLabel('Price UoM',{exact:true}).selectOption('Per box');
 await page.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].rows[0]).toMatchObject({Command:'U',ID:4,RowVersion:rv,QuantityTo:null,EffectiveTo:null,UnitPrice:'12345678901234.1234',EffectiveFrom:'2026-09-20'});
});
test('pricing validates ranges before sending and uses descriptive lookups',async({page})=>{
 const state=await setup(page);await page.getByRole('button',{name:'Packaging Material Pricing',exact:true}).click();await page.getByRole('button',{name:'New price',exact:true}).click();
 await page.getByRole('dialog',{name:'New price',exact:true}).getByLabel('Material',{exact:true}).selectOption({label:'BOX — Cardboard box'});await page.getByRole('dialog',{name:'New price',exact:true}).getByLabel('Vendor currency',{exact:true}).selectOption({label:'USD — US Dollar'});
 await page.getByLabel('Price UoM',{exact:true}).selectOption('Each');await page.getByLabel('Quantity from (inclusive)').fill('10');await page.getByLabel('Quantity to (exclusive)').fill('5');
 await page.getByLabel('Unit price (Vendor currency)',{exact:true}).fill('0.12');await page.getByLabel('Effective from',{exact:true}).fill('2026-09-20');await page.getByLabel('Effective to',{exact:true}).fill('2026-09-19');
 await page.getByRole('button',{name:'Review & save'}).click();
 await expect(page.getByText('Must be greater than quantity from.')).toBeVisible();await expect(page.getByText('Must be on or after effective from.')).toBeVisible();expect(state.writes).toHaveLength(0);
 await page.getByLabel('Quantity to (exclusive)').fill('');await page.getByLabel('Effective to',{exact:true}).fill('');
 await page.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].rows[0]).toMatchObject({UnitPrice:'0.12',QuantityTo:null,EffectiveTo:null});
});
test('manager reads but cannot maintain; scopes protect master navigation',async({page})=>{
 await setup(page,'PackagingManager');await page.getByRole('button',{name:'Packaging Material',exact:true}).click();
 await expect(page.getByText('Read only',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'New material',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Edit material 3'})).toHaveCount(0);
});
test('master profile order persists independently of Customer; mobile fits',async({page})=>{
 const state=await setup(page);await page.getByRole('button',{name:'Packaging Material',exact:true}).click();await page.getByRole('button',{name:'Layout options'}).click();
 await page.getByRole('button',{name:'Move Material name left'}).click();await page.getByRole('button',{name:'Save layout to profile'}).click();await expect(page.getByRole('status')).toContainText('saved');
 expect(state.profile().settings.columns).toEqual(['CustomerName']);
 await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Packaging Material',exact:true}).click();
 await expect(page.getByRole('columnheader').first()).toHaveText('Material name');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.screenshot({path:'test-results/packaging-material-mobile.png',fullPage:true});
});
test('price conflict retains edit and does not claim success',async({page})=>{
 await setup(page);await page.route('**/api/packaging/price/batch',r=>r.fulfill({json:{results:[{RowNum:1,Status:'ERROR',Message:'RowVersion conflict. Refresh first.'}]}}));
 await page.getByRole('button',{name:'Packaging Material Pricing',exact:true}).click();await page.getByRole('button',{name:'Edit price 4'}).click();
 await page.getByLabel('Price UoM',{exact:true}).selectOption('Changed basis');await page.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByText('RowVersion conflict. Refresh first.')).toBeVisible();await expect(page.getByLabel('Price UoM',{exact:true})).toHaveValue('Changed basis');
});
test('pricing filters, numeric sort and current-view export',async({page})=>{
 await setup(page);let exported:any;
 await page.route('**/api/workbench/masters/prices/export',async r=>{exported=r.request().postDataJSON();await r.fulfill({contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',body:Buffer.from('mock')})});
 await page.getByRole('button',{name:'Packaging Material Pricing',exact:true}).click();
 await page.locator('form.filters').getByLabel('Currency',{exact:true}).selectOption('2');
 const filtered=page.waitForRequest(r=>r.url().includes('/masters/prices?')&&r.url().includes('currency_id=2'));
 await page.getByRole('button',{name:'Search',exact:true}).click();await filtered;
 const sorted=page.waitForRequest(r=>r.url().includes('/masters/prices?')&&JSON.parse(new URL(r.url()).searchParams.get('sort')||'[]')[0]?.column==='UnitPrice');
 await page.getByRole('button',{name:'Sort by Unit price (Vendor currency)',exact:true}).click();await sorted;
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export current page to Excel'}).click();await download;
 expect(exported.rows[0][exported.columns.indexOf('UnitPrice')]).toBe('12345678901234.1234');
 expect(exported.rows[0][exported.columns.indexOf('QuantityTo')]).toBeNull();
 await page.screenshot({path:'test-results/packaging-price-desktop.png',fullPage:true});
});

test('Vendor master creation and optional pricing selection',async({page})=>{
 const state=await setup(page,'Packaging');
 await page.getByRole('button',{name:'Vendors',exact:true}).click();
 await page.getByRole('button',{name:'New vendor',exact:true}).click();
 await page.getByLabel('Vendor name',{exact:true}).fill('Supplier A');
 await page.getByLabel('Address',{exact:true}).fill('Bangkok');
 await page.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0]).toMatchObject({path:'/api/packaging/vendor/batch',rows:[{Command:'C',VendorName:'Supplier A',Address:'Bangkok'}]});
 await page.getByRole('button',{name:'Packaging Material Pricing',exact:true}).click();
 await page.getByRole('button',{name:'Edit price 4'}).click();
 await expect(page.getByLabel('Vendor',{exact:true})).toHaveValue('');
 await page.getByLabel('Vendor',{exact:true}).selectOption('7');
 await expect(page.getByLabel('Vendor currency',{exact:true})).toHaveValue('2');
 await page.getByLabel('Exchange rate (Vendor currency per USD)',{exact:true}).fill('25000');
 await page.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[1].rows[0].VendorID).toBe(7);
 expect(state.writes[1].rows[0].ExchangeRateToUSD).toBe('25000');
});
test('Packaging manager can view Vendors but cannot create',async({page})=>{
 await setup(page,'PackagingManager');
 await page.getByRole('button',{name:'Vendors',exact:true}).click();
 await expect(page.getByText('Read only',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'New vendor',exact:true})).toHaveCount(0);
});

test('Admin maintains UoM through the common master form',async({page})=>{
 const state=await setup(page);
 await page.getByRole('button',{name:'Units of Measure',exact:true}).click();
 await page.getByRole('button',{name:'New UoM',exact:true}).click();
 await page.getByLabel('UoM code',{exact:true}).fill('KG');
 await page.getByLabel('UoM name',{exact:true}).fill('Kilogram');
 await page.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0]).toMatchObject({path:'/api/packaging/uom/batch',rows:[{Command:'C',UoMCode:'KG',UoMName:'Kilogram'}]});
});
test('Packaging users cannot access UoM maintenance',async({page})=>{
 await setup(page,'Packaging');
 await expect(page.getByRole('button',{name:'Units of Measure',exact:true})).toHaveCount(0);
});

test('dragged master column width saves and reloads without sorting',async({page})=>{
 const state=await setup(page);
 await page.getByRole('button',{name:'Packaging Material',exact:true}).click();
 const handle=page.getByRole('separator',{name:'Resize Material name',exact:true});
 const before=await handle.boundingBox();expect(before).not.toBeNull();
 await page.mouse.move(before!.x+4,before!.y+10);await page.mouse.down();
 await page.mouse.move(before!.x+124,before!.y+10);await page.mouse.up();
 await expect(handle).toHaveAttribute('aria-valuenow','300');
 const header=page.getByRole('columnheader').filter({has:handle});
 expect((await header.boundingBox())!.width).toBeCloseTo(300,0);
 await page.getByRole('button',{name:'Layout options',exact:true}).click();
 await page.getByRole('button',{name:'Save layout to profile'}).click();
 await expect(page.getByRole('status')).toContainText('saved');
 expect(state.profile().settings.masters.materials.column_widths.MaterialName).toBe(300);
 expect(state.profile().settings.masters.materials.sort[0].column).toBe('MaterialCode');
 await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Material',exact:true}).click();
 await expect(handle).toHaveAttribute('aria-valuenow','300');
 await handle.focus();await page.keyboard.press('ArrowLeft');
 await expect(handle).toHaveAttribute('aria-valuenow','290');
});

test('pricing entry groups thousands and rejects excess decimals',async({page})=>{
 const state=await setup(page);
 await page.getByRole('button',{name:'Packaging Material Pricing',exact:true}).click();
 await page.getByRole('button',{name:'Edit price 4'}).click();
 const price=page.getByLabel('Unit price (Vendor currency)',{exact:true});
 await expect(price).toHaveValue('12,345,678,901,234.12');
 await price.fill('25000.123456');await price.blur();
 await expect(price).toHaveAttribute('aria-invalid','true');
 await page.getByRole('button',{name:'Review & save'}).click();
 await expect(page.getByRole('button',{name:'Confirm save',exact:true})).toHaveCount(0);
 await price.fill('25,00.12');await price.blur();
 await expect(price).toHaveAttribute('aria-invalid','true');
 await price.fill('25,000.12');await price.blur();
 await expect(price).toHaveValue('25,000.12');
 const rate=page.getByLabel('Exchange rate (Vendor currency per USD)',{exact:true});
 await rate.fill('25000.1234');await rate.blur();
 await expect(rate).toHaveAttribute('aria-invalid','true');
 await rate.fill('25000.123');await rate.blur();
 await expect(rate).toHaveValue('25,000.123');
 await page.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].rows[0]).toMatchObject({UnitPrice:'25000.12',ExchangeRateToUSD:'25000.123'});
});

test('RawMaterial role creates raw masters and pricing through isolated routes',async({page})=>{
 const state=await setup(page,'RawMaterial');
 await expect(page.getByRole('button',{name:'Packaging Material',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Vendors',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'New raw material',exact:true}).click();
 await page.getByLabel('Material name',{exact:true}).fill('Cashew kernels');
 await page.getByLabel('Base UoM',{exact:true}).selectOption('EA');
 await page.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].path).toBe('/api/raw-material/material/batch');
 await page.getByRole('button',{name:'Raw Material Pricing',exact:true}).click();
 await page.getByRole('button',{name:'New raw material price',exact:true}).click();
 await page.getByLabel('Vendor',{exact:true}).selectOption('7');
 await expect(page.getByLabel('Vendor currency',{exact:true})).toHaveValue('2');
 await page.getByRole('dialog').getByLabel('Material',{exact:true}).selectOption('1');
 await page.getByLabel('Price UoM',{exact:true}).selectOption('EA');
 await page.getByLabel('Unit price (Vendor currency)',{exact:true}).fill('12500.25');
 await page.getByLabel('Unit price (Vendor currency)',{exact:true}).blur();
 await expect(page.getByLabel('Unit price (Vendor currency)',{exact:true})).toHaveValue('12,500.25');
 await page.getByLabel('Effective from',{exact:true}).fill('2026-09-28');
 await page.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[1].path).toBe('/api/raw-material/price/batch');
 expect(state.writes[1].rows[0]).toMatchObject({VendorID:7,CurrencyID:2,UnitPrice:'12500.25'});
});
test('Packaging role cannot open Raw Material masters',async({page})=>{
 await setup(page,'Packaging');
 await expect(page.getByRole('button',{name:'Raw Material',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Raw Material Pricing',exact:true})).toBeDisabled();
});

test('RawMaterial users maintain Raw Grade relationships',async({page})=>{
 const state=await setup(page,'RawMaterial');
 await page.getByRole('button',{name:'Raw Grade Master',exact:true}).click();
 await page.getByRole('button',{name:'New raw grade',exact:true}).click();
 await page.getByLabel('Grade name',{exact:true}).fill('W320');
 await page.getByLabel('Parent grade',{exact:true}).selectOption('21');
 await page.getByLabel('Material assign',{exact:true}).check();
 await page.getByRole('dialog').getByLabel('Raw Material',{exact:true}).selectOption('1');
 await page.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].path).toBe('/api/raw-material/grade/batch');
 expect(state.writes[0].rows[0]).toMatchObject({GradeName:'W320',MaterialAssign:true,MaterialID:1,ParentGradeID:21});
});

test('Raw Grade can be saved without material after unticking assignment',async({page})=>{
 const state=await setup(page,'RawMaterial');
 await page.getByRole('button',{name:'Raw Grade Master',exact:true}).click();
 await page.getByRole('button',{name:'New raw grade',exact:true}).click();
 await page.getByLabel('Grade name',{exact:true}).fill('Group grade');
 await expect(page.getByRole('dialog').getByLabel('Raw Material',{exact:true})).toHaveCount(0);
 await page.getByLabel('Material assign',{exact:true}).check();
 await page.getByRole('button',{name:'Review & save'}).click();
 await expect(page.getByText('Required.',{exact:true})).toBeVisible();
 await page.getByRole('dialog').getByLabel('Raw Material',{exact:true}).selectOption('1');
 await page.getByLabel('Material assign',{exact:true}).uncheck();
 await page.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].rows[0]).toMatchObject({MaterialAssign:false,MaterialID:null});
});
