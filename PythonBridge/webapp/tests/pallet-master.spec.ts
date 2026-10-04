import {test,expect,type Page} from '@playwright/test';
import {palletPreview} from '../src/pallet-calculation';
import {palletCapacityLabels,palletCapacityKeys} from '../src/pallet-capacities';
const rv='AAAAAAAAAAE=';
async function setup(page:Page,scope='Admin'){
 const writes:any[]=[],exports:any[]=[],reads:URL[]=[];
 let row:any={ID:1,UnitOfMeasure:'M',Width:'1.1000',Length:'1.1000',PalletAreaMM2:'1210000.00000000',PalletSize:'1.1x1.1M',Status:'Active',ConversionStatus:'Calculated',RowVersion:rv,PalletsPer20DC:10,PalletsPer40DC:20,PalletsPer40HC:22,PalletsPer20RC:8,PalletsPer40RHC:20};
 let profile:any={settings:{columns:['CustomerName'],filters:[],customer_name:'',market_id:'',status:'',page_size:25,dark:false,nav_hidden:false,masters:{}},version:0};
 await page.route('**/api/**',async route=>{
  const p=new URL(route.request().url()).pathname;
  if(p.endsWith('/session'))return route.fulfill({json:{user_id:1,username:'Tester',scopes:[scope],is_admin:scope==='Admin'}});
  if(p.endsWith('/preferences')){if(route.request().method()==='POST')profile={settings:route.request().postDataJSON().settings,version:profile.version+1};return route.fulfill({json:profile})}
  if(p==='/api/workbench/masters/lookups')return route.fulfill({json:{materials:[],currencies:[],creators:[],uoms:[
   {ID:1,UoMCode:'M',UoMName:'Meter',Status:'Active',FactorToMM:'1000.000000000'},
   {ID:2,UoMCode:'MM',UoMName:'Millimeter',Status:'Active',FactorToMM:'1'},
   {ID:3,UoMCode:'BOX',Status:'Active',FactorToMM:null},
   {ID:4,UoMCode:'CM',Status:'Block',FactorToMM:null}
  ]}});
  if(p==='/api/workbench/masters/pallets'){reads.push(new URL(route.request().url()));return route.fulfill({json:{rows:[row],total:1,page:1}})}
  if(p==='/api/packaging/pallet/batch'){const body=route.request().postDataJSON();writes.push(body);for(const change of body.rows)if(change.Command==='U')row={...row,...change};return route.fulfill({json:{results:body.rows.map((r:any)=>({RowNum:r.RowNum,Status:'OK'}))}})}
  if(p==='/api/workbench/masters/pallets/export'){exports.push(route.request().postDataJSON());return route.fulfill({body:Buffer.from('mock'),contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})}
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 return {writes,exports,reads,profile:()=>profile};
}
async function open(page:Page){
 await page.getByRole('button',{name:'Pallet Master',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Pallet Master',exact:true})).toBeVisible();
 await expect(page.getByRole('cell',{name:'1.1x1.1M',exact:true})).toBeVisible();
}

test('pallet preview exact decimals and range limits',()=>{
 expect(palletPreview('1.1','1.1','M','1000')).toEqual({size:'1.1x1.1M',area:'1,210,000',error:''});
 expect(palletPreview('1.2345','1.1','M','1000')).toMatchObject({area:'1,357,950'});
 expect(palletPreview('1234.5678','1','MM','1')).toMatchObject({area:'1,234.5678'});
 expect(palletPreview('1','1','MM','0.000000123')).toMatchObject({area:'',error:'Converted dimensions or area are out of range.'});
 expect(palletPreview('1','1','M','999999999999999')).toMatchObject({area:'',error:'Converted dimensions or area are out of range.'});
 expect(palletPreview('100000000','1','M','1000').error).toBeTruthy();
});

test('Packaging creates pallets with read-only automatic fields',async({page})=>{
 const state=await setup(page,'Packaging');await open(page);
 await expect(page.getByRole('cell',{name:'1,210,000',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'New pallet',exact:true}).click();
 await page.getByLabel('UoM',{exact:true}).selectOption('M');
 await page.getByLabel('Width',{exact:true}).fill('1.1');await page.getByLabel('Length',{exact:true}).fill('1.1');
 await expect(page.getByLabel('Pallet area (mm²)',{exact:true})).toHaveValue('1,210,000');
 await expect(page.getByLabel('Pallet size',{exact:true})).toHaveValue('1.1x1.1M');
 await expect(page.getByLabel('Pallet size',{exact:true})).toHaveAttribute('readonly','');
 await expect(page.getByLabel('Pallet area (mm²)',{exact:true})).toHaveAttribute('readonly','');
 await page.getByRole('button',{name:'Review & save',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Confirm master save'})).toContainText('1.1x1.1M');
 expect(state.writes).toHaveLength(0);
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].rows[0]).toEqual({RowNum:1,Command:'C',ID:null,RowVersion:null,UnitOfMeasure:'M',Width:'1.1',Length:'1.1',...Object.fromEntries(palletCapacityKeys.map(key=>[key,null]))});
});

test('four decimal dimensions round-trip and stale conflicts remain editable',async({page})=>{
 const state=await setup(page);await open(page);await page.getByRole('button',{name:'Edit pallet 1'}).click();
 await page.getByLabel('Width',{exact:true}).fill('1.2345');
 await page.getByLabel('Length',{exact:true}).focus();
 await expect(page.getByLabel('Width',{exact:true})).toHaveValue('1.2345');
 await expect(page.getByLabel('Pallet area (mm²)',{exact:true})).toHaveValue('1,357,950');
 await page.route('**/api/packaging/pallet/batch',r=>r.fulfill({json:{results:[{RowNum:1,Status:'ERROR',Message:'Concurrency conflict. Refresh first.'}]}}));
 await page.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByText('Concurrency conflict. Refresh first.',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Width',{exact:true})).toHaveValue('1.2345');
 expect(state.writes).toHaveLength(0);
});

test('invalid dimensions and missing conversions cannot be submitted',async({page})=>{
 const state=await setup(page);await open(page);await page.getByRole('button',{name:'New pallet',exact:true}).click();
 await page.getByLabel('UoM',{exact:true}).selectOption('M');
 await page.getByLabel('Width',{exact:true}).fill('1.12345');await page.getByLabel('Length',{exact:true}).fill('0');
 await page.getByRole('button',{name:'Review & save',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Confirm master save'})).toHaveCount(0);
 await expect(page.getByText('Use a positive number with up to 8 whole digits and 4 decimal places.')).toHaveCount(2);
 await page.getByLabel('Width',{exact:true}).fill('1.1');await page.getByLabel('Length',{exact:true}).fill('1.1');await page.getByLabel('UoM',{exact:true}).selectOption('BOX');
 await page.getByRole('button',{name:'Review & save',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Confirm master save'})).toHaveCount(0);
 await expect(page.getByText('Admin must maintain an active general conversion from this UoM to MM.').first()).toBeVisible();
 expect(state.writes).toHaveLength(0);
});

test('PackagingManager is read-only and Product role has no access',async({page})=>{
 await setup(page,'PackagingManager');await open(page);
 await expect(page.getByText('Read only',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'New pallet',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Edit pallet 1'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Excel Local Update'})).toHaveCount(0);
});

test('container capacities display, sort, export and round-trip edits with zero and blank values',async({page})=>{
 const state=await setup(page);await open(page);
 for(const label of Object.values(palletCapacityLabels))
  await expect(page.getByRole('button',{name:'Sort by '+label,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Sort by Pallet/40HC',exact:true}).click();
 await expect.poll(()=>state.reads.at(-1)?.searchParams.get('sort')).toContain('"column":"PalletsPer40HC"');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export current page to Excel'}).click();await download;
 for(const [index,key] of palletCapacityKeys.entries()){
  const column=state.exports[0].columns.indexOf(key);
  expect(column).toBeGreaterThanOrEqual(0);
  expect(state.exports[0].rows[0][column]).toBe(String([10,20,22,8,20][index]));
 }
 await page.getByRole('button',{name:'Edit pallet 1',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Edit pallet',exact:true});
 await expect(editor.getByLabel('Pallet/20DC',{exact:true})).toHaveValue('10');
 await editor.getByLabel('Pallet/20DC',{exact:true}).fill('11');
 await editor.getByLabel('Pallet/40HC',{exact:true}).fill('');
 await editor.getByLabel('Pallet/20RC',{exact:true}).fill('0');
 await page.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor).toHaveCount(0);
 expect(state.writes[0].rows[0]).toMatchObject({PalletsPer20DC:'11',PalletsPer40DC:'20',PalletsPer40HC:null,PalletsPer20RC:'0',PalletsPer40RHC:'20'});
 await page.getByRole('button',{name:'Edit pallet 1',exact:true}).click();
 await expect(editor.getByLabel('Pallet/20DC',{exact:true})).toHaveValue('11');
 await expect(editor.getByLabel('Pallet/40HC',{exact:true})).toHaveValue('');
 await expect(editor.getByLabel('Pallet/20RC',{exact:true})).toHaveValue('0');
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('every container capacity rejects negative, fractional and oversized counts before saving',async({page})=>{
 const state=await setup(page);await open(page);await page.getByRole('button',{name:'New pallet',exact:true}).click();
 await page.getByLabel('UoM',{exact:true}).selectOption('M');
 await page.getByLabel('Width',{exact:true}).fill('1.1');await page.getByLabel('Length',{exact:true}).fill('1.1');
 for(const label of Object.values(palletCapacityLabels)){
  const input=page.getByLabel(label,{exact:true});
  for(const value of ['-1','1.5','2147483648','NaN']){
   await input.fill(value);await page.getByRole('button',{name:'Review & save',exact:true}).click();
   await expect(page.getByRole('dialog',{name:'Confirm master save',exact:true})).toHaveCount(0);
   await expect(input).toHaveAttribute('aria-invalid','true');expect(state.writes).toHaveLength(0);
  }
  await input.fill('');
 }
 await page.getByRole('button',{name:'Review & save',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Confirm master save',exact:true})).toBeVisible();
});

test('PackagingManager can view captured container counts without edit authority',async({page})=>{
 const state=await setup(page,'PackagingManager');await open(page);
 await page.getByRole('button',{name:'View pallet 1',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'View pallet',exact:true});
 for(const label of Object.values(palletCapacityLabels))await expect(editor.getByLabel(label,{exact:true})).toBeDisabled();
 await expect(editor.getByLabel('Pallet/20DC',{exact:true})).toHaveValue('10');
 await expect(editor.getByRole('button',{name:'Review & save',exact:true})).toHaveCount(0);
 expect(state.writes).toHaveLength(0);
});

test('unrelated role cannot navigate to Pallet Master',async({page})=>{
 await setup(page,'Product');await expect(page.getByRole('button',{name:'Pallet Master',exact:true})).toBeDisabled();
});

test('numeric export, layout and narrow-screen behavior',async({page})=>{
 const state=await setup(page);await open(page);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export current page to Excel'}).click();await download;
 expect(state.exports[0].rows[0][state.exports[0].columns.indexOf('PalletAreaMM2')]).toBe('1210000.00000000');
 await page.getByRole('button',{name:'Layout options'}).click();
 await page.getByRole('button',{name:'Move Pallet size left'}).click();await page.getByRole('button',{name:'Save layout to profile'}).click();
 await expect(page.getByRole('status')).toContainText('saved');
 expect(state.profile().settings.masters.pallets.columns).toEqual(['UnitOfMeasure','Width','Length','PalletSize','PalletAreaMM2',...palletCapacityKeys,'Status']);
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
