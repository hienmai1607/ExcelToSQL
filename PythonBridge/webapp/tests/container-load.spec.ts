import {test,expect,type Page} from '@playwright/test';

async function setup(page:Page,configuration='Both',overrides:Record<string,unknown>={}){
 const writes:any[]=[];
 let row:any={RequestID:1,ItemID:1,ProductCode:'PRD-1',ProductName:'Nut product',ItemDescription:'Item 1',ItemStage:'Assigned',PIC:'Admin',PICUserID:1,ItemRowVersion:'AAAAAAAAAAE=',WeightGrams:'10.00',RequestedLayerCount:3,ResponseLayerCount:3,UnitsPerCarton:10,UnitsPerTertiary:5,CartonsPerLayer:10,LayersPerPallet:5,HeightMM:400,ResponseMaxPalletHeightMM:950,ConfigurationRequest:configuration,ContainerRequest:'Both',ResponsePalletSize:'1.1x1.1m',...overrides};
 await page.route('**/api/**',route=>{
  const p=new URL(route.request().url()).pathname;
  if(p.endsWith('/session'))return route.fulfill({json:{username:'Admin',user_id:1,is_admin:true,scopes:['Admin']}});
  if(p.endsWith('/preferences'))return route.fulfill({json:{settings:{columns:['CustomerName'],filters:[],sort:[],page_size:25},version:0}});
  if(p==='/api/workbench/requests')return route.fulfill({json:{rows:[{RequestID:1,RequestNumber:'PCR-1',CustomerName:'Customer',OpportunityNumber:'OPP-1',RequestStatus:'Open',ItemCount:1}],total:1}});
  if(p==='/api/packaging/requests')return route.fulfill({json:{rows:[row],total:1,page:1}});
  if(p==='/api/packaging/lookups')return route.fulfill({json:{currencies:[],packagingTypes:[],pallets:[{ID:1,PalletSize:'1.1x1.1m',PalletsPer20DC:20,PalletsPer40DC:40,PalletsPer40HC:44,PalletsPer20RC:18,PalletsPer40RHC:36},{ID:2,PalletSize:'1.2x1.2m',PalletsPer20DC:15,PalletsPer40DC:30,PalletsPer40HC:34,PalletsPer20RC:14,PalletsPer40RHC:28}]}});
  if(p==='/api/workbench/pics')return route.fulfill({json:{rows:[{ID:1,UserName:'Admin'}]}});
  if(p==='/api/packaging/response/batch'){const data=route.request().postDataJSON();writes.push(data);row={...row,...data.rows[0],...(data.rows[0].ContainerLoadProfiles?.[data.rows[0].SelectedContainerType]||{})};return route.fulfill({json:{results:[{RowNum:1,Status:'OK',NewRowVersion:'AAAAAAAAAAI='}]}})}
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Packaging requests',exact:true}).click();
 await page.getByRole('button',{name:'Edit request PCR-1',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
 if(row.ItemStage!=='Approved')await editor.getByLabel('Container type',{exact:true}).selectOption(row.ContainerRequest==='Reefer'?'20RC':'20DC');
 return {writes,editor};
}

test('Both shows container and floor formulas live; saves counts only and reloads',async({page})=>{
 const {writes,editor}=await setup(page);
 const pallet=editor.getByRole('region',{name:'Pallet load response',exact:true});
 const floor=editor.getByRole('region',{name:'Floor load response',exact:true});
 await expect(pallet.getByLabel('Layer / Container',{exact:true})).toHaveValue('5');
 await expect(pallet.getByLabel('Layer / Container',{exact:true})).toHaveAttribute('readonly','');
 await expect(pallet.getByLabel('Pallet / Container',{exact:true})).toHaveValue('20');
 await floor.getByLabel('Carton / Container Floor',{exact:true}).fill('1200');
 await expect(pallet.getByLabel('Carton / Container',{exact:true})).toHaveValue('1,000');
 await expect(pallet.getByLabel('Net weight / Container (kg)',{exact:true})).toHaveValue('500');
 await expect(floor.getByLabel('Net weight / Container Floor (kg)',{exact:true})).toHaveValue('600');
 for(const label of ['Carton / Container','Net weight / Container (kg)','Net weight / Container Floor (kg)'])await expect(editor.getByLabel(label,{exact:true})).toHaveAttribute('readonly','');
 await expect(editor.getByRole('region',{name:'Palletization response',exact:true}).getByLabel('Cartons / container',{exact:true})).toHaveCount(0);
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 expect(writes[0].rows[0]).toMatchObject({CartonsPerContainerFloor:'1200',SelectedContainerType:'20DC',ContainerLoadProfiles:{'20DC':{PalletsPerContainer:'20',CartonsPerContainerFloor:'1200'}}});
 for(const key of ['LayersPerContainer','CartonsPerContainer','CalculatedCartonsPerContainer','NetWeightPerContainerKG','NetWeightPerContainerFloorKG'])expect(writes[0].rows[0]).not.toHaveProperty(key);
 await expect(pallet.getByLabel('Net weight / Container (kg)',{exact:true})).toHaveValue('500');
 await expect(floor.getByLabel('Net weight / Container Floor (kg)',{exact:true})).toHaveValue('600');
});

test('Floor load shows floor counts only; uses the last confirmed packaging weight',async({page})=>{
 const {writes,editor}=await setup(page,'Floor load',{ResponseLayerCount:2,LayersPerContainer:100,PalletsPerContainer:20});
 await expect(editor.getByRole('region',{name:'Pallet load response',exact:true})).toHaveCount(0);
 await editor.getByLabel('Carton / Container Floor',{exact:true}).fill('1200');
 await expect(editor.getByLabel('Net weight / Container Floor (kg)',{exact:true})).toHaveValue('120');
 await editor.getByLabel('Confirmed packaging layers',{exact:true}).selectOption('1');
 await expect(editor.getByLabel('Net weight / Container Floor (kg)',{exact:true})).toHaveValue('12');
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 expect(writes[0].rows[0].CartonsPerContainerFloor).toBe('1200');
 expect(writes[0].rows[0]).not.toHaveProperty('LayersPerContainer');
 expect(writes[0].rows[0]).not.toHaveProperty('PalletsPerContainer');
});

test('Pallet load excludes floor fields and preserves legacy entries outside the calculated control',async({page})=>{
 const {writes,editor}=await setup(page,'Pallet load',{CartonsPerContainer:777,CartonsPerContainerFloor:1200});
 await expect(editor.getByRole('region',{name:'Floor load response',exact:true})).toHaveCount(0);
 await expect(editor.getByLabel('Carton / Container',{exact:true})).toHaveValue('1,000');
 await editor.getByLabel('Max pallet height (mm)',{exact:true}).fill('2000');
 await expect(editor.getByLabel('Layer / Container',{exact:true})).toHaveValue('5');
 await expect(editor.getByLabel('Carton / Container',{exact:true})).toHaveValue('1,000');
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 expect(writes[0].rows[0]).not.toHaveProperty('CartonsPerContainerFloor');
 expect(writes[0].rows[0]).not.toHaveProperty('CartonsPerContainer');
});

test('container counts reject zero, fractions and overflow; incomplete calculations remain blank',async({page})=>{
 const {writes,editor}=await setup(page,'Both',{HeightMM:null});
 for(const label of ['Carton / Container','Net weight / Container (kg)','Net weight / Container Floor (kg)'])await expect(editor.getByLabel(label,{exact:true})).toHaveValue('');
 for(const label of ['Carton / Container Floor']){
  for(const value of ['0','-1','1.5','2147483648']){
   const input=editor.getByLabel(label,{exact:true});await input.fill(value);
   await editor.getByRole('button',{name:'Review & save',exact:true}).click();
   await expect(page.getByRole('dialog',{name:'Confirm request save'})).toHaveCount(0);
   expect(writes).toHaveLength(0);await input.fill('');
  }
 }
});

test('large carton totals remain exact and approved response controls are locked',async({page})=>{
 const {editor}=await setup(page,'Both',{ItemStage:'Approved',SelectedContainerType:'20DC',CartonsPerLayer:2147483647,LayersPerContainer:2147483647,PalletsPerContainer:20,CartonsPerContainerFloor:1200});
 await expect(editor.getByLabel('Carton / Container',{exact:true})).toHaveValue((2147483647n*5n*20n).toLocaleString('en-US'));
 for(const label of ['Layer / Container','Pallet / Container','Carton / Container Floor'])await expect(editor.getByLabel(label,{exact:true})).toBeDisabled();
 await expect(editor.getByRole('button',{name:'Review & save',exact:true})).toBeDisabled();
});

test('container fields fit 1920x1080 and mobile without horizontal overflow',async({page})=>{
 const {editor}=await setup(page,'Both',{LayersPerContainer:100,PalletsPerContainer:20,CartonsPerContainerFloor:1200});
 for(const width of [1920,390]){
  await page.setViewportSize({width,height:width===1920?1080:844});
  for(const label of ['Layer / Container','Pallet / Container','Carton / Container','Net weight / Container (kg)','Carton / Container Floor','Net weight / Container Floor (kg)']){
   const input=editor.getByLabel(label,{exact:true});await input.scrollIntoViewIfNeeded();
   const box=await input.boundingBox();expect(box).not.toBeNull();
   expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 }
});

test('container families filter choices; type-specific inputs survive switching and reload',async({page})=>{
 const {editor,writes}=await setup(page,'Both',{ContainerRequest:'Dry'});
 const selector=editor.getByLabel('Container type',{exact:true});
 await expect(selector.locator('option')).toHaveText(['Choose container type','20DC','40DC','40HC']);
 await expect(editor.getByLabel('Layer / Container',{exact:true})).toHaveValue('5');
 await editor.getByLabel('Carton / Container Floor',{exact:true}).fill('100');
 await selector.selectOption('40HC');
 await expect(editor.getByLabel('Layer / Container',{exact:true})).toHaveValue('5');
 await expect(editor.getByLabel('Pallet / Container',{exact:true})).toHaveValue('44');
 await expect(editor.getByLabel('Layer / Container',{exact:true})).toHaveValue('5');
 await editor.getByLabel('Carton / Container Floor',{exact:true}).fill('200');
 await expect(editor.getByLabel('Carton / Container',{exact:true})).toHaveValue('2,200');
 await expect(editor.getByLabel('Net weight / Container (kg)',{exact:true})).toHaveValue('1,100');
 await selector.selectOption('20DC');
 await expect(editor.getByLabel('Layer / Container',{exact:true})).toHaveValue('5');
 await expect(editor.getByLabel('Carton / Container Floor',{exact:true})).toHaveValue('100');
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 expect(writes[0].rows[0].ContainerLoadProfiles['40HC']).toMatchObject({PalletsPerContainer:'44',CartonsPerContainerFloor:'200'});
 await selector.selectOption('40HC');
 await expect(editor.getByLabel('Layer / Container',{exact:true})).toHaveValue('5');
 await expect(editor.getByLabel('Carton / Container Floor',{exact:true})).toHaveValue('200');
});

test('Reefer floor loads use same selector with separate saved counts',async({page})=>{
 const {editor}=await setup(page,'Floor load',{ContainerRequest:'Reefer'});
 const selector=editor.getByLabel('Container type',{exact:true});
 await expect(selector.locator('option')).toHaveText(['Choose container type','20RC','40RHC']);
 await editor.getByLabel('Carton / Container Floor',{exact:true}).fill('100');
 await selector.selectOption('40RHC');
 await expect(editor.getByLabel('Carton / Container Floor',{exact:true})).toHaveValue('');
 await editor.getByLabel('Carton / Container Floor',{exact:true}).fill('200');
 await expect(editor.getByLabel('Net weight / Container Floor (kg)',{exact:true})).toHaveValue('100');
 await selector.selectOption('20RC');
 await expect(editor.getByLabel('Carton / Container Floor',{exact:true})).toHaveValue('100');
 await expect(editor.getByLabel('Net weight / Container Floor (kg)',{exact:true})).toHaveValue('50');
});

test('changing pallet updates all type capacities; invalid inactive profile blocks review',async({page})=>{
 const {editor,writes}=await setup(page);
 await expect(editor.getByLabel('Container type',{exact:true}).locator('option')).toHaveCount(6);
 await expect(editor.getByLabel('Layer / Container',{exact:true})).toHaveValue('5');
 await editor.getByLabel('Container type',{exact:true}).selectOption('40HC');
 await editor.getByLabel('Pallet size',{exact:true}).selectOption('1.2x1.2m');
 await expect(editor.getByLabel('Pallet / Container',{exact:true})).toHaveValue('34');
 await editor.getByLabel('Container type',{exact:true}).selectOption('20DC');
 await expect(editor.getByLabel('Pallet / Container',{exact:true})).toHaveValue('15');
 await expect(editor.getByLabel('Layer / Container',{exact:true})).toHaveValue('5');
 await editor.getByLabel('Carton / Container Floor',{exact:true}).fill('1.5');
 await editor.getByLabel('Container type',{exact:true}).selectOption('40HC');
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Confirm request save'})).toHaveCount(0);
 expect(writes).toHaveLength(0);
});

test('pallet-load fields share one desktop row',async({page})=>{
 const {editor}=await setup(page);
 const bounds=await Promise.all(['Container type','Layer / Container','Pallet / Container','Carton / Container','Net weight / Container (kg)'].map(label=>editor.getByLabel(label,{exact:true}).boundingBox()));
 expect(new Set(bounds.map(b=>Math.round(b!.y))).size).toBe(1);
});


test('clear selector keeps profiles and requires selection before editing counts',async({page})=>{
 const {editor}=await setup(page);
 const selector=editor.getByLabel('Container type',{exact:true});
 await expect(editor.getByLabel('Layer / Container',{exact:true})).toHaveValue('5');
 await selector.selectOption('');
 await expect(editor.getByLabel('Layer / Container',{exact:true})).toHaveAttribute('readonly','');
 await expect(editor.getByLabel('Carton / Container Floor',{exact:true})).toHaveAttribute('readonly','');
 await selector.selectOption('20DC');
 await expect(editor.getByLabel('Layer / Container',{exact:true})).toHaveValue('5');
});

test('20RC uses 2070 mm while every other container uses 2090 mm',async({page})=>{
 const {editor,writes}=await setup(page,'Both',{HeightMM:1040,ResponseMaxPalletHeightMM:1190});
 await expect(editor.getByLabel('Pallet height (mm)',{exact:true})).toHaveValue('1,190');
 await expect(editor.getByLabel('Layer / Container',{exact:true})).toHaveValue('2');
 await expect(editor.getByLabel('Carton / Container',{exact:true})).toHaveValue('400');
 for(const kind of ['40DC','40HC','40RHC']){
  await editor.getByLabel('Container type',{exact:true}).selectOption(kind);
  await expect(editor.getByLabel('Layer / Container',{exact:true})).toHaveValue('2');
 }
 await editor.getByLabel('Container type',{exact:true}).selectOption('20RC');
 await expect(editor.getByLabel('Layer / Container',{exact:true})).toHaveValue('1');
 await expect(editor.getByLabel('Carton / Container',{exact:true})).toHaveValue('180');
 await expect(editor.getByLabel('Net weight / Container (kg)',{exact:true})).toHaveValue('90');
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 expect(writes[0].rows[0]).not.toHaveProperty('LayersPerContainer');
 for(const profile of Object.values(writes[0].rows[0].ContainerLoadProfiles))expect(profile).not.toHaveProperty('LayersPerContainer');
 await expect(editor.getByLabel('Layer / Container',{exact:true})).toHaveValue('1');
});

test('shipping height above clearance yields zero totals, independent of maximum pallet height',async({page})=>{
 const {editor}=await setup(page,'Both',{HeightMM:2300,ResponseMaxPalletHeightMM:2500});
 await expect(editor.getByLabel('Layer / Container',{exact:true})).toHaveValue('0');
 await expect(editor.getByLabel('Carton / Container',{exact:true})).toHaveValue('0');
 await expect(editor.getByLabel('Net weight / Container (kg)',{exact:true})).toHaveValue('0');
 await editor.getByLabel('Max pallet height (mm)',{exact:true}).click();
 await editor.getByLabel('Max pallet height (mm)',{exact:true}).fill('');
 await expect(editor.getByLabel('Max pallet height (mm)',{exact:true})).toHaveValue('');
 await expect(editor.getByLabel('Layer / Container',{exact:true})).toHaveValue('0');
 await expect(editor.getByLabel('Carton / Container',{exact:true})).toHaveValue('0');
});
