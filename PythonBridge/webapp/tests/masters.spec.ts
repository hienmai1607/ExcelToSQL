import {captureRevealScrolls,expectReveal} from './reveal-scroll';
import {test,expect,type Page} from '@playwright/test';
const rv='AAAAAAAAAAE=';
test('packaging price overlap resolution is opt-in and confirmed before saving',async({page})=>{
 const state=await setup(page);
 await page.getByRole('button',{name:'Packaging Pricing',exact:true}).click();
 await page.getByRole('button',{name:'New price',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New price',exact:true});
 const resolve=form.getByLabel('Resolve overlap automatically',{exact:true});
 await expect(resolve).not.toBeChecked();
 await form.getByLabel('Vendor',{exact:true}).selectOption('7');
 await form.getByLabel('Material',{exact:true}).selectOption('1');
 await form.getByLabel('Price UoM',{exact:true}).selectOption('EA');
 await form.getByLabel('Quantity from (inclusive)',{exact:true}).fill('1000');
 await form.getByLabel('Unit price (Vendor currency)',{exact:true}).fill('15.50');
 await form.getByLabel('Effective from',{exact:true}).fill('2026-10-21');
 await resolve.check();
 await form.getByRole('button',{name:'Review & save',exact:true}).click();
 const confirmation=page.getByRole('dialog',{name:'Confirm master save',exact:true});
 await expect(confirmation).toContainText('may cap the new quantity range or end the previous same-tier price');
 expect(state.writes).toHaveLength(0);
 await confirmation.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(state.writes[0].rows[0]).toMatchObject({ResolveOverlap:true,QuantityFrom:'1000',EffectiveFrom:'2026-10-21'});
});

test('price defaults to material UoM and USD exchange rate is locked to one',async({page})=>{
 await setup(page);
 await page.route('**/api/workbench/masters/lookups?**',r=>r.fulfill({json:{
 materials:[{ID:1,MaterialCode:'RM',MaterialName:'Nuts',UnitOfMeasure:'lbs',Status:'Active'}],
 vendors:[{ID:7,VendorName:'US vendor',CurrencyID:2,Status:'Active'}],
 currencies:[{ID:2,CurrencyCode:'USD'},{ID:3,CurrencyCode:'VND'}],uoms:[{ID:1,UoMCode:'lbs',Status:'Active'},{ID:2,UoMCode:'kg',Status:'Active'}]
 }}));
 await page.getByRole('button',{name:'Raw Pricing',exact:true}).click();
 await page.getByRole('button',{name:'New raw material price',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New raw material price',exact:true});
 await form.getByLabel('Material',{exact:true}).selectOption('1');
 await expect(form.getByLabel('Price UoM',{exact:true})).toHaveValue('lbs');
 await form.getByLabel('Vendor',{exact:true}).selectOption('7');
 const rate=form.getByLabel('Exchange rate (Vendor currency per USD)',{exact:true});
 await expect(rate).toHaveValue('1');await expect(rate).toHaveAttribute('readonly','');
 await form.getByLabel('Vendor currency',{exact:true}).selectOption('3');
 await expect(rate).toBeEditable();await expect(rate).toHaveValue('');
 await rate.fill('25000');
 await form.getByLabel('Vendor currency',{exact:true}).selectOption('2');
 await expect(rate).toHaveValue('1');
});


test('pricing fields form aligned pairs and blank upper limits save as unlimited',async({page})=>{
 const state=await setup(page);
 await page.getByRole('button',{name:'Packaging Pricing',exact:true}).click();
 await page.getByRole('button',{name:'New price',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New price',exact:true});
 for(const [left,right] of [['Material','Price UoM'],['Quantity from (inclusive)','Quantity to (exclusive)'],['Unit price (Vendor currency)','Exchange rate (Vendor currency per USD)'],['Effective from','Effective to']]){
  const a=await form.getByLabel(left,{exact:true}).boundingBox(),b=await form.getByLabel(right,{exact:true}).boundingBox();
  expect(Math.abs(a!.y-b!.y)).toBeLessThan(2);expect(b!.x).toBeGreaterThan(a!.x);
 }
 await expect(form.getByLabel('Quantity to (exclusive)',{exact:true})).toHaveAttribute('placeholder','Unlimited');
 await expect(form.getByLabel('Effective to',{exact:true})).toHaveValue('');
 await form.getByLabel('Vendor',{exact:true}).selectOption('7');
 await form.getByLabel('Material',{exact:true}).selectOption('1');
 await form.getByLabel('Price UoM',{exact:true}).selectOption('EA');
 await form.getByLabel('Unit price (Vendor currency)',{exact:true}).fill('10');
 await form.getByLabel('Effective from',{exact:true}).fill('2026-10-16');
 await form.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(state.writes[0].rows[0]).toMatchObject({QuantityTo:null,EffectiveTo:null});
});

test('Vendor currency is beside Vendor and the unit price has an adjacent currency code',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Packaging Pricing',exact:true}).click();
 await page.getByRole('button',{name:'New price',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New price',exact:true});
 await form.getByLabel('Vendor',{exact:true}).selectOption('7');
 await form.getByLabel('Unit price (Vendor currency)',{exact:true}).fill('1000');
 const vendor=await form.getByLabel('Vendor',{exact:true}).boundingBox(),currency=await form.getByLabel('Vendor currency',{exact:true}).boundingBox();
 expect(Math.abs(vendor!.y-currency!.y)).toBeLessThan(2);expect(currency!.x).toBeGreaterThan(vendor!.x);
 const input=await form.getByLabel('Unit price (Vendor currency)',{exact:true}).boundingBox(),code=await form.locator('.master-unit-currency').boundingBox();
 await expect(form.locator('.master-unit-currency')).toHaveText('USD');
 expect(code!.x-input!.x-input!.width).toBeLessThanOrEqual(10);
 await page.setViewportSize({width:390,height:844});
 expect(await form.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
});

test('parentless Final component is available for Material assignment',async({page})=>{
 const state=await setup(page);
 await page.route('**/api/workbench/masters/lookups?**',route=>route.fulfill({json:{materials:[],currencies:[],creators:[],uoms:[{ID:1,UoMCode:'EA',Status:'Active'}],packagingTypes:[
  {ID:73,PackagingType:'Ready pouch',PackagingOrder:'Primary',ParentTypeID:null,HasChildren:false,Status:'Active',FinalComponent:true},
  {ID:74,PackagingType:'Not final',PackagingOrder:'Primary',ParentTypeID:null,HasChildren:false,Status:'Active',FinalComponent:false}
 ]}}));
 await page.getByRole('button',{name:'Packaging Material',exact:true}).click();
 await page.getByRole('button',{name:'New material',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New material',exact:true});
 const type=form.getByLabel('Packaging Type',{exact:true});
 await expect(type.locator('option[value="73"]')).toHaveText('Primary / Ready pouch');
 await expect(type.locator('option[value="74"]')).toHaveCount(0);
 await type.selectOption('73');
 await form.getByLabel('Material name',{exact:true}).fill('Ready pouch material');
 await form.getByLabel('Tare weight',{exact:true}).fill('0.011500001');
 await form.getByLabel('Tare basis',{exact:true}).selectOption('kg/EA');
 await form.getByLabel('Base UoM',{exact:true}).selectOption('EA');
 await form.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(state.writes[0].rows[0].PackagingTypeID).toBe(73);
 expect(state.writes[0].rows[0].TareWeight).toBe('0.011500001');
 expect(state.writes[0].rows[0].TareWeightBasis).toBe('kg/EA');
});
test('physical dimensions are maintained on material and absent from pricing',async({page})=>{
 const state=await setup(page);
 await page.route('**/api/workbench/masters/lookups?**',r=>r.fulfill({json:{
  materials:[{ID:1,MaterialCode:'BOX',MaterialName:'Film',PackagingTypeID:70,PriceBasis:'Square meter',Status:'Active'}],
  packagingTypes:[{ID:70,PackagingType:'Film',PackagingOrder:'Primary',FinalComponent:true,Status:'Active'}],
  currencies:[{ID:2,CurrencyCode:'USD'}],vendors:[],creators:[],uoms:[{ID:1,UoMCode:'m',Status:'Active'}],
  materialDimensions:[{ID:9,PackagingTypeID:70,D1Name:'Length',D2Name:'Width',D1Unit:'mm',D2Unit:'mm',RowVersion:rv,Status:'Active'}]
 }}));
 await page.getByRole('button',{name:'Packaging Material',exact:true}).click();
 await page.getByRole('button',{name:'New material',exact:true}).click();
 const material=page.getByRole('dialog',{name:'New material',exact:true});
 await material.getByLabel('Material name',{exact:true}).fill('Film');
 await material.getByLabel('Packaging Type',{exact:true}).selectOption('70');
 await material.getByLabel('Base UoM',{exact:true}).selectOption('m');
 await material.getByLabel('Material dimension definition',{exact:true}).selectOption('9');
 await material.getByLabel('Material D1',{exact:true}).fill('1000');
 await material.getByLabel('Material D2',{exact:true}).fill('500.123456');
 await material.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(state.writes[0].rows[0]).toMatchObject({MaterialDimensionID:9,MaterialDimensionRowVersion:rv,MaterialD1:'1000',MaterialD2:'500.123456',MaterialD3:null});
 await page.getByRole('button',{name:'Packaging Pricing',exact:true}).click();
 await page.getByRole('button',{name:'New price',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New price',exact:true});
 await expect(form.getByLabel('Supplier dimension definition',{exact:true})).toHaveCount(0);
 await expect(form.getByLabel('Material dimension definition',{exact:true})).toHaveCount(0);
 await form.getByLabel('Material',{exact:true}).selectOption('1');
 await form.getByLabel('Price UoM',{exact:true}).selectOption('m');
 await form.getByLabel('Vendor currency',{exact:true}).selectOption('2');
 await form.getByLabel('Unit price (Vendor currency)',{exact:true}).fill('10000');
 await form.getByLabel('Effective from',{exact:true}).fill('2026-10-01');
 await form.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(state.writes[1].rows[0]).not.toHaveProperty('SupplierDimensionID');
 expect(state.writes[1].rows[0]).not.toHaveProperty('MaterialDimensionID');
});

test('Add packaging master record smoothly reveals the last new section',async({page})=>{
 await captureRevealScrolls(page);await setup(page);
 await page.getByRole('button',{name:'Packaging Material',exact:true}).click();
 await page.getByRole('button',{name:'New material',exact:true}).click();
 await page.getByRole('button',{name:'+ Add record section',exact:true}).click();
 await expectReveal(page,null);
 await page.getByRole('button',{name:'+ Add record section',exact:true}).click();
 await expectReveal(page,null);
});

test('raw pricing does not acquire supplier dimension fields',async({page})=>{
 await setup(page,'RawMaterial');
 await page.getByRole('button',{name:'Raw Pricing',exact:true}).click();
 await page.getByRole('button',{name:'New raw material price',exact:true}).click();
 await expect(page.getByLabel('Supplier dimension definition',{exact:true})).toHaveCount(0);
});
async function setup(page:Page,scope='Admin'){
 const writes:any[]=[];let profile:any={settings:{columns:['CustomerName'],filters:[],customer_name:'',market_id:'',status:'',page_size:25,dark:false,nav_hidden:false,masters:{}},version:0};
 await page.route('**/api/**',async route=>{
  const u=new URL(route.request().url()),p=u.pathname;
  if(p.endsWith('/session'))return route.fulfill({json:{user_id:1,username:'Tester',scopes:[scope],is_admin:scope==='Admin'}});
  if(p.endsWith('/preferences')){if(route.request().method()==='POST')profile={settings:route.request().postDataJSON().settings,version:profile.version+1};return route.fulfill({json:profile})}
  if(p==='/api/workbench/masters/lookups')return route.fulfill({json:{packagingTypes:[{ID:70,PackagingOrder:'Primary',PackagingType:'Pouch',ParentTypeID:60,Status:'Active',FinalComponent:true},{ID:71,PackagingOrder:'Secondary',PackagingType:'Carton',ParentTypeID:61,Status:'Active',FinalComponent:true},{ID:72,PackagingOrder:'Primary',PackagingType:'Old bag',ParentTypeID:62,Status:'Block',FinalComponent:true}],rawGrades:[{ID:21,GradeName:'Whole kernels',FinalGrade:false,Status:'Active',ParentGradeID:null,HasChildren:true},{ID:22,GradeName:'W320',FinalGrade:true,ParentGradeName:'Whole kernels',Status:'Active',ParentGradeID:21,HasChildren:false}],uoms:[{ID:4,UoMCode:"EA",UoMName:"Each",Status:"Active"},{ID:1,UoMCode:"Each",UoMName:"Each",Status:"Active"},{ID:2,UoMCode:"Per box",Status:"Active"},{ID:3,UoMCode:"Changed basis",Status:"Active"}],vendors:[{ID:7,VendorName:'Local supplier',Status:'Active',CurrencyID:2}],materials:[{ID:1,MaterialCode:'BOX',MaterialName:'Cardboard box',Status:'Active'}],currencies:[{ID:2,CurrencyCode:'USD',CurrencyName:'US Dollar'},{ID:3,CurrencyCode:'VND',CurrencyName:'Vietnam dong'}],creators:[{ID:1,UserName:'Tester'}]}});
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
 expect(state.writes[0].rows[0]).toMatchObject({Command:'C',MaterialName:'New box'});
});

test('material type dropdown includes only leaves, including blocked-child parents exclusion',async({page})=>{
 const state=await setup(page);
 await page.route('**/api/workbench/masters/lookups?**',route=>route.fulfill({json:{materials:[],currencies:[],creators:[],uoms:[{ID:1,UoMCode:'EA',Status:'Active'}],packagingTypes:[
  {ID:70,PackagingOrder:'Primary',PackagingType:'Group',Status:'Active',HasChildren:true},{ID:73,PackagingType:'Empty root',PackagingOrder:'Primary',ParentTypeID:null,HasChildren:false,Status:'Active'},
  {ID:71,PackagingOrder:'Primary',PackagingOrders:['Primary','Secondary','Tertiary'],PackagingType:'Leaf film',ParentTypeID:70,Status:'Active',HasChildren:false,FinalComponent:true}
 ]}}));
 await page.getByRole('button',{name:'Packaging Material',exact:true}).click();await page.getByRole('button',{name:'New material',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New material',exact:true}),type=form.getByLabel('Packaging Type',{exact:true});
 await expect(type.locator('option[value="70"]')).toHaveCount(0);
 await expect(type.locator('option[value="73"]')).toHaveCount(0);
 await expect(form.getByLabel('Description',{exact:true})).toHaveCount(0);
 await expect(type.locator('option[value="71"]')).toHaveText('Leaf film');
 await type.selectOption('71');await form.getByLabel('Material name',{exact:true}).fill('Leaf material');await form.getByLabel('Base UoM',{exact:true}).selectOption('EA');
 await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(state.writes[0].rows[0].PackagingTypeID).toBe(71);
});
test('material packaging type dropdown assigns an active master ID',async({page})=>{
 const state=await setup(page,'Packaging');await page.getByRole('button',{name:'Packaging Material',exact:true}).click();
 await expect(page.getByRole('button',{name:'Sort by Packaging Type',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'New material',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New material',exact:true});
 const type=form.getByLabel('Packaging Type',{exact:true});
 await expect(type.locator('option')).toHaveText(['No packaging type','Pouch','Carton']);
 await type.selectOption('71');await form.getByLabel('Material name',{exact:true}).fill('Typed carton');
 await form.getByLabel('Base UoM',{exact:true}).selectOption('EA');
 await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].rows[0]).toMatchObject({Command:'C',PackagingTypeID:71});
});
test('blocked existing packaging type is preserved and can be cleared',async({page})=>{
 const state=await setup(page);
 await page.route('**/api/workbench/masters/materials?**',r=>r.fulfill({json:{rows:[{ID:3,MaterialCode:'BAG',MaterialName:'Old bag',UnitOfMeasure:'EA',Status:'Active',RowVersion:rv,PackagingTypeID:72,PackagingType:'Primary / Old bag'}],total:1,page:1}}));
 await page.getByRole('button',{name:'Packaging Material',exact:true}).click();await page.getByRole('button',{name:'Edit material 3'}).click();
 const form=page.getByRole('dialog',{name:'Edit material',exact:true}),type=form.getByLabel('Packaging Type',{exact:true});
 await expect(type).toHaveValue('72');await expect(type.locator('option[value="72"]')).toHaveAttribute('disabled','');
 await form.getByLabel('Material name',{exact:true}).fill('Renamed bag');
 await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(state.writes[0].rows[0].PackagingTypeID).toBe(72);
 await page.getByRole('button',{name:'Edit material 3'}).click();
 await page.getByLabel('Packaging Type',{exact:true}).selectOption('');
 await page.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(state.writes[1].rows[0].PackagingTypeID).toBeNull();
});
test('raw material does not inherit packaging type assignment',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Raw Material',exact:true}).click();
 await page.getByRole('button',{name:'New raw material',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'New raw material',exact:true}).getByLabel('Packaging Type',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('dialog',{name:'New raw material',exact:true}).getByLabel('Origin',{exact:true})).toBeVisible();
});

test('legacy root assignment stays disabled but survives an unrelated material edit',async({page})=>{
 const state=await setup(page);
 await page.route('**/api/workbench/masters/lookups?**',r=>r.fulfill({json:{packagingTypes:[{ID:70,PackagingType:'Legacy root',PackagingOrder:'Primary',ParentTypeID:null,HasChildren:false,Status:'Active'}],uoms:[{ID:1,UoMCode:'EA',Status:'Active'}],currencies:[],materials:[],creators:[]}}));
 await page.route('**/api/workbench/masters/materials?**',r=>r.fulfill({json:{rows:[{ID:3,MaterialCode:'BAG',MaterialName:'Legacy material',Description:'Historical description',PackagingTypeID:70,PackagingType:'Legacy root',UnitOfMeasure:'EA',Status:'Active',RowVersion:rv}],total:1,page:1}}));
 await page.getByRole('button',{name:'Packaging Material',exact:true}).click();await page.getByRole('button',{name:'Edit material 3'}).click();
 const form=page.getByRole('dialog',{name:'Edit material',exact:true}),type=form.getByLabel('Packaging Type',{exact:true});
 await expect(type).toHaveValue('70');await expect(type.locator('option').filter({hasText:'Legacy root'})).toHaveAttribute('disabled','');await expect(form.getByLabel('Description',{exact:true})).toHaveCount(0);
 await form.getByLabel('Material name',{exact:true}).fill('Renamed legacy material');await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(state.writes[0].rows[0].PackagingTypeID).toBe(70);expect(state.writes[0].rows[0]).not.toHaveProperty('Description');
});

test('retired material Description disappears from saved layouts and sort',async({page})=>{
 const state=await setup(page);
 state.profile().settings.masters.materials={columns:['MaterialCode','MaterialName','Description','UnitOfMeasure','Status'],filters:['search','status'],values:{},sort:[{column:'Description',direction:'asc'}],column_widths:{Description:240},page_size:25};
 await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Packaging Material',exact:true}).click();
 await expect(page.getByRole('button',{name:'Sort by Description',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Layout options'}).click();await expect(page.getByRole('complementary').getByRole('checkbox',{name:'Description',exact:true})).toHaveCount(0);
});
test('price preserves decimal precision and nulls, sends version on edit',async({page})=>{
 const state=await setup(page);await page.getByRole('button',{name:'Packaging Pricing',exact:true}).click();
 await page.getByRole('button',{name:'Edit price 4'}).click();
 await expect(page.getByLabel('Unit price (Vendor currency)',{exact:true})).toHaveValue('12,345,678,901,234.12');
 await page.getByLabel('Price UoM',{exact:true}).selectOption('Per box');
 await page.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].rows[0]).toMatchObject({Command:'U',ID:4,RowVersion:rv,QuantityTo:null,EffectiveTo:null,UnitPrice:'12345678901234.1234',EffectiveFrom:'2026-09-20'});
});
test('pricing validates ranges before sending and uses descriptive lookups',async({page})=>{
 const state=await setup(page);await page.getByRole('button',{name:'Packaging Pricing',exact:true}).click();await page.getByRole('button',{name:'New price',exact:true}).click();
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
 await expect(page.getByRole('columnheader').nth(1)).toHaveText('Material name');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.screenshot({path:'test-results/packaging-material-mobile.png',fullPage:true});
});
test('price conflict retains edit and does not claim success',async({page})=>{
 await setup(page);await page.route('**/api/packaging/price/batch',r=>r.fulfill({json:{results:[{RowNum:1,Status:'ERROR',Message:'RowVersion conflict. Refresh first.'}]}}));
 await page.getByRole('button',{name:'Packaging Pricing',exact:true}).click();await page.getByRole('button',{name:'Edit price 4'}).click();
 await page.getByLabel('Price UoM',{exact:true}).selectOption('Changed basis');await page.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByText('RowVersion conflict. Refresh first.')).toBeVisible();await expect(page.getByLabel('Price UoM',{exact:true})).toHaveValue('Changed basis');
});
test('pricing filters, numeric sort and read-only local template',async({page})=>{
 await setup(page,'PackagingManager');let exported:any;
 await page.route('**/api/workbench/masters/prices/export',async r=>{exported=r.request().postDataJSON();await r.fulfill({contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',body:Buffer.from('mock')})});
 await page.getByRole('button',{name:'Packaging Pricing',exact:true}).click();
 await page.locator('form.filters').getByLabel('Currency',{exact:true}).selectOption('2');
 const filtered=page.waitForRequest(r=>r.url().includes('/masters/prices?')&&r.url().includes('currency_id=2'));
 await page.getByRole('button',{name:'Search',exact:true}).click();await filtered;
 const sorted=page.waitForRequest(r=>r.url().includes('/masters/prices?')&&JSON.parse(new URL(r.url()).searchParams.get('sort')||'[]')[0]?.column==='UnitPrice');
 await page.getByRole('button',{name:'Sort by Unit price (Vendor currency)',exact:true}).click();await sorted;
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Excel local template'}).click();await download;
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
 await page.getByRole('button',{name:'Packaging Pricing',exact:true}).click();
 await page.getByRole('button',{name:'Edit price 4'}).click();
 await expect(page.getByLabel('Vendor',{exact:true})).toHaveValue('');
 await page.getByLabel('Vendor',{exact:true}).selectOption('7');
 await expect(page.getByLabel('Vendor currency',{exact:true})).toHaveValue('2');
 await expect(page.getByLabel('Exchange rate (Vendor currency per USD)',{exact:true})).toHaveValue('1');
 await page.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[1].rows[0].VendorID).toBe(7);
 expect(state.writes[1].rows[0].ExchangeRateToUSD).toBe('1');
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
 await page.getByRole('button',{name:'Packaging Pricing',exact:true}).click();
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
 await page.getByLabel('Vendor currency',{exact:true}).selectOption('3');
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
 await expect(page.getByRole('button',{name:'Packaging Material',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Vendors',exact:true})).toHaveCount(0);
 await expect(page.getByRole('navigation').getByRole('region',{name:'Packaging',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'New raw material',exact:true}).click();
 await page.getByLabel('Material name',{exact:true}).fill('Cashew kernels');
 await page.getByLabel('Base UoM',{exact:true}).selectOption('EA');
 await page.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].path).toBe('/api/raw-material/material/batch');
 await page.getByRole('button',{name:'Raw Pricing',exact:true}).click();
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
 await expect(page.getByRole('button',{name:'Raw Material',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Raw Pricing',exact:true})).toHaveCount(0);
});

test('RawMaterial users maintain Raw Grade relationships',async({page})=>{
 const state=await setup(page,'RawMaterial');
 await page.getByRole('button',{name:'Raw Grade Master',exact:true}).click();
 await page.getByRole('button',{name:'New raw grade',exact:true}).click();
 await page.getByLabel('Grade name',{exact:true}).fill('W320');
 await page.getByLabel('Parent grade',{exact:true}).selectOption('21');
 await expect(page.getByLabel('Material assign',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('dialog').getByLabel('Raw Material',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].path).toBe('/api/raw-material/grade/batch');
 expect(state.writes[0].rows[0]).toMatchObject({GradeName:'W320',ParentGradeID:21});
});

test('Raw Grade puts name first and explicitly saves Final grade',async({page})=>{
 const state=await setup(page,'RawMaterial');
 await page.getByRole('button',{name:'Raw Grade Master',exact:true}).click();
 await page.getByRole('button',{name:'New raw grade',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New raw grade',exact:true});
 const flag=form.getByLabel('Final grade',{exact:true});
 await expect(flag).not.toBeChecked();
 await form.getByLabel('Grade name',{exact:true}).fill('NTS Raisins');
 await flag.check();
 const name=await form.getByLabel('Grade name',{exact:true}).boundingBox(),parent=await form.getByLabel('Parent grade',{exact:true}).boundingBox();
 expect(name!.y).toBeLessThan(parent!.y);
 await form.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(state.writes[0].rows[0]).toMatchObject({GradeName:'NTS Raisins',FinalGrade:true,ParentGradeID:null});
});

test('Raw Material selects a final Grade and Grade Master has no material assignment',async({page})=>{
 const state=await setup(page,'RawMaterial');
 await page.getByRole('button',{name:'Raw Material',exact:true}).click();
 await page.getByRole('button',{name:'New raw material',exact:true}).click();
 await page.getByLabel('Material name',{exact:true}).fill('Walnut raw');
 await page.getByLabel('Base UoM',{exact:true}).selectOption('EA');
 await expect(page.getByLabel('Grade',{exact:true}).locator('option[value="21"]')).toHaveCount(0);
 await page.getByLabel('Grade',{exact:true}).selectOption('22');
 await page.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].rows[0]).toMatchObject({MaterialName:'Walnut raw',GradeID:22});
});
