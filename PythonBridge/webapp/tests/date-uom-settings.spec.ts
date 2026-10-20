import {test,expect,type Page} from '@playwright/test';
import {formatDate,parseDate,setDateOptions} from '../src/date-format';
import {timestamp} from '../src/datetime';

test('date formats parse unambiguously and timestamps retain Bangkok timezone',()=>{
 expect(parseDate('02/03/2026','mm/dd/yyyy')).toBe('2026-02-03');
 expect(parseDate('02/03/2026','dd/mm/yyyy')).toBe('2026-03-02');
 expect(parseDate('29/02/2025','dd/mm/yyyy')).toBeNull();
 expect(parseDate('29/02/2024','dd/mm/yyyy')).toBe('2024-02-29');
 setDateOptions('dd/mm/yyyy','24h');
 expect(formatDate('2026-12-31')).toBe('31/12/2026');
 expect(timestamp('2026-01-01T17:30:00Z')).toBe('02/01/2026, 00:30');
 setDateOptions('mm/dd/yyyy','12h');
});
test('Opportunity header inputs have matching sizes at desktop, tablet and mobile widths',async({page})=>{
 await setup(page);
 await page.getByRole('button',{name:'New Opportunity',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New Opportunity',exact:true});
 for(const width of [1920,1280,390]){
  await page.setViewportSize({width,height:1080});
  const controls=[form.getByLabel('Customer *',{exact:true}),form.getByLabel('Description *',{exact:true}),form.getByLabel('Bid open',{exact:true}),form.getByLabel('Bid close',{exact:true}),form.getByLabel('Exchange rate VND per USD *',{exact:true}),form.getByLabel('Exchange rate Customer Currency per USD *',{exact:true})];
  const boxes=await Promise.all(controls.map(c=>c.boundingBox()));
  for(const box of boxes){expect(box!.height).toBe(32);expect(box!.width).toBeGreaterThan(90);}
  expect(await form.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 }
});
test('a new Opportunity can be confirmed with no pallet size',async({page})=>{
 const state=await setup(page);
 await page.getByRole('button',{name:'New Opportunity',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New Opportunity',exact:true});
 await form.getByLabel('Customer *',{exact:true}).selectOption('1');
 await form.getByLabel('Description *',{exact:true}).fill('Optional pallet');
 await form.getByLabel('Bid open',{exact:true}).fill('12/01/2026');
 await form.getByLabel('Bid close',{exact:true}).fill('12/02/2026');
 await form.getByLabel('Exchange rate VND per USD *',{exact:true}).fill('25000');
 await form.getByLabel('Exchange rate Customer Currency per USD *',{exact:true}).fill('1.57');
 await form.getByLabel('Product *',{exact:true}).selectOption('10');
 await form.getByLabel('Annual units *',{exact:true}).fill('100');
 await form.locator('summary').filter({hasText:'Packaging requirements'}).click();
 const pallet=form.getByLabel('Pallet size',{exact:true});
 await expect(pallet).toHaveValue('');
 expect(await pallet.evaluate((e:HTMLSelectElement)=>e.required)).toBe(false);
 await form.locator('summary').filter({hasText:'Shipment, Logistics'}).click();
 await form.getByLabel('Container Type',{exact:true}).selectOption('20DC');
 await form.getByRole('button',{name:'Review & save',exact:true}).click();
 const confirm=page.getByRole('dialog',{name:'Confirm Opportunity save',exact:true});
 await expect(confirm).toBeVisible();
 await confirm.getByRole('button',{name:'Confirm save',exact:true}).click();
 const sent=state.writes.find(w=>w.path==='/api/opportunity/batch')?.body;
 expect(sent.item_rows[0].PalletSize).toBeNull();
 expect(sent.header_rows[0]).toMatchObject({BidOpen:'2026-12-01',BidClose:'2026-12-02'});
});


async function setup(page:Page){
 const writes:{path:string;body:any}[]=[];
 let settings:any={date_format:'mm/dd/yyyy',time_format:'12h'},version=0;
 const customers=[{ID:1,CustomerName:'Aldi',CustomerCurrencyCode:'AUD',Status:'Active'}];
 const uoms=[{ID:1,UoMCode:'g',UoMName:'Grams',Category:'Weight/Mass',BaseFactor:1,Status:'Active'},{ID:2,UoMCode:'KG',UoMName:'Kilograms',Category:'Weight/Mass',BaseFactor:1000,Status:'Active'},{ID:3,UoMCode:'mm',UoMName:'Millimeters',Category:'Length/Distance',BaseFactor:1,Status:'Active'},{ID:4,UoMCode:'old',UoMName:'Old mass',Category:'Weight/Mass',BaseFactor:1,Status:'Block'}];
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Tester',user_id:1,is_admin:true,scopes:['Admin']}});
  if(path.endsWith('/preferences')){
   if(route.request().method()==='POST'){const body=route.request().postDataJSON();writes.push({path,body});settings=body.settings;version++;}
   return route.fulfill({json:{settings,version}});
  }
  if(path==='/api/opportunity/lookups')return route.fulfill({json:{customers,products:[{ID:10,CustomerID:1,ProductCode:'P10',ProductName:'Test product',WeightGrams:100,Status:'Active'}],pallets:[],packagingTypes:[]}});
  if(path==='/api/workbench/masters/lookups')return route.fulfill({json:{customers,uoms,categories:[{ID:1,CategoryName:'Nuts',Status:'Active'}],materials:[],currencies:[],creators:[]}});
  if(path==='/api/opportunity/batch'){const body=route.request().postDataJSON();writes.push({path,body});return route.fulfill({json:{header_results:[{RowNum:1,Status:'OK',NewID:1}],item_results:[{RowNum:1,Status:'OK',NewID:1}]}})}
  if(path==='/api/product/batch'){const body=route.request().postDataJSON();writes.push({path,body});return route.fulfill({json:{results:[{RowNum:1,Status:'OK',NewID:1}]}})}
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 return {writes};
}
test('Settings persists date/time preferences and Bid inputs use selected format',async({page})=>{
 const state=await setup(page);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'Settings',exact:true});
 await settings.getByLabel('Date format',{exact:true}).selectOption('dd/mm/yyyy');
 await settings.getByLabel('Time format',{exact:true}).selectOption('24h');
 await settings.getByRole('button',{name:'Save Settings'}).click();
 expect(state.writes[0].body.settings).toMatchObject({date_format:'dd/mm/yyyy',time_format:'24h'});
 await page.getByRole('button',{name:'New Opportunity',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New Opportunity',exact:true});
 await form.getByLabel('Customer *',{exact:true}).selectOption('1');
 await expect(form.getByLabel('Customer currency',{exact:true})).toHaveCount(0);
 await expect(form.getByText('AUD / USD *',{exact:true})).toBeVisible();
 await form.getByLabel('Bid open',{exact:true}).fill('31/12/2026');
 await expect(form.getByLabel('Bid open',{exact:true})).toHaveValue('31/12/2026');
 await expect(form.locator('.date-native-picker').first()).toHaveValue('2026-12-31');
});
test('product weight and mass UoM share a row and only active mass units can be selected',async({page})=>{
 const state=await setup(page);
 await page.getByRole('button',{name:'Products',exact:true}).click();
 await page.getByRole('button',{name:'New product',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New product',exact:true});
 await form.getByLabel('Customer',{exact:true}).selectOption('1');
 await form.getByLabel('Product name',{exact:true}).fill('Kilogram pack');
 await form.getByLabel('Category',{exact:true}).selectOption('Nuts');
 await form.getByLabel('Weight',{exact:true}).fill('0.395');
 await form.getByLabel('Weight unit',{exact:true}).selectOption('KG');
 await expect(form.getByLabel('Weight unit',{exact:true}).locator('option')).toHaveCount(2);
 const weight=await form.getByLabel('Weight',{exact:true}).boundingBox(),unit=await form.getByLabel('Weight unit',{exact:true}).boundingBox();
 expect(Math.abs(weight!.y-unit!.y)).toBeLessThanOrEqual(2);
 await form.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(state.writes.find(w=>w.path==='/api/product/batch')?.body.rows[0]).toMatchObject({WeightUnit:'KG',WeightValue:'0.395'});
});
test('Category status is on the first details row without the removed note',async({page})=>{
 await setup(page);
 await page.getByRole('button',{name:'Category Master',exact:true}).click();
 await page.getByRole('button',{name:'New category',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New Category',exact:true});
 await expect(form.getByText(/Blocked categories remain/)).toHaveCount(0);
 const name=await form.getByLabel('Category name',{exact:true}).boundingBox(),status=await form.getByLabel('Status',{exact:true}).boundingBox();
 expect(Math.abs(name!.y-status!.y)).toBeLessThanOrEqual(2);
 await page.setViewportSize({width:390,height:844});
 expect(await form.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
});
