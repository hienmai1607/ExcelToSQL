import {test,expect,type Page} from '@playwright/test';
import {allowedContainerTypes} from '../src/container-loading';

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
 await page.getByRole('button',{name:'Packaging Requests',exact:true}).click();
 await page.getByRole('button',{name:'Edit request PCR-1',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
 if(row.ItemStage!=='Approved'&&!row.ParentItemID)await editor.getByLabel('Container type',{exact:true}).selectOption(allowedContainerTypes(row.ContainerRequest,row.ShipmentContainerSizeFT)[0]);
 return {writes,editor};
}

test('Pallet loading calculates cartons using Layers / pallet and no Layer / Container field',async({page})=>{
 const {editor,writes}=await setup(page,'Pallet load');
 await expect(editor.getByRole('region',{name:'Container Load response'})).toBeVisible();
 await expect(editor.getByLabel('Layer / Container',{exact:true})).toHaveCount(0);
 await expect(editor.getByLabel('Pallet / Container',{exact:true})).toHaveValue('20');
 await expect(editor.getByLabel('Carton / Container',{exact:true})).toHaveValue('400');
 await expect(editor.getByLabel('Net weight / Container (kg)',{exact:true})).toHaveValue('200');
 await editor.getByLabel('Max pallet height (mm)',{exact:true}).fill('2000');
 await expect(editor.getByLabel('Carton / Container',{exact:true})).toHaveValue('800');
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 expect(writes[0].rows[0]).not.toHaveProperty('CartonsPerContainer');
 expect(writes[0].rows[0]).not.toHaveProperty('LayersPerContainer');
});

test('quantity and weight columns leave room for dimensions without crossing layer boundaries',async({page},info)=>{
 const captures=Object.fromEntries(['Primary','Secondary','Tertiary'].map(order=>[order,{LayerCount:3,PackagingTypeName:'Captured '+order,Dimensions:[{Name:'Length',Unit:'mm',Value:'340'},{Name:'Width',Unit:'mm',Value:'145'},{Name:'Height',Unit:'mm',Value:'200'}]}]));
 const {editor}=await setup(page,'Pallet load',{FirstPMType:'Captured Primary',SecondPMType:'Captured Secondary',ThirdPMType:'Captured Tertiary',LayerDimensionCaptures:captures});
 await expect(editor.getByLabel('Tertiary dimension height',{exact:true})).toHaveText('200mm');
 for(const width of [1920,1280,390]){
  await page.setViewportSize({width,height:900});
  const layers=editor.locator('.packing-way-layer');
  for(const layer of await layers.all()){
   await layer.scrollIntoViewIfNeeded();
   expect(await layer.evaluate(el=>{
    const bounds=el.getBoundingClientRect();
    return Array.from(el.children).every(child=>{const r=child.getBoundingClientRect();return r.left>=bounds.left-1&&r.right<=bounds.right+1&&child.scrollWidth<=child.clientWidth+1});
   })).toBe(true);
  }
  if(width===1920){
   const columns=await layers.first().locator(':scope>label').evaluateAll(labels=>labels.map(label=>label.getBoundingClientRect().width));
   expect(columns[0]).toBeLessThanOrEqual(146);expect(columns[1]).toBeLessThanOrEqual(166);
   expect(columns[2]).toBeGreaterThan(columns[1]);
   await editor.screenshot({path:info.outputPath('compact-packing-columns.png')});
  }
 }
});

test('Double stacking doubles Pallet capacity but not Floor or Both manual counts',async({page})=>{
 const {editor}=await setup(page,'Pallet load',{ResponsePalletStacking:'Single'});
 await expect(editor.getByLabel('Carton / Container',{exact:true})).toHaveValue('400');
 await editor.getByLabel('Pallet stacking',{exact:true}).selectOption('Double');
 await expect(editor.getByLabel('Carton / Container',{exact:true})).toHaveValue('800');
 await expect(editor.getByLabel('Net weight / Container (kg)',{exact:true})).toHaveValue('400');
});

for(const mixParent of [false,true])test('Product Info stays in one aligned desktop row for '+(mixParent?'Mix parent':'child product'),async({page})=>{
 const {editor}=await setup(page,'Pallet load',mixParent?{IsMixParent:true,WeightGrams:750,ProductMixSnapshot:JSON.stringify({items:[{ProductID:1,UnitQuantity:1,WeightGrams:750}]}),MixResponseChildren:JSON.stringify([{ProductID:1,ApplicableNetWeightGrams:750,NutDensity:'0.5'}])}:{ParentItemID:99,NutDensity:'0.5',NutDensityCombinationAvailable:true});
 const info=editor.getByRole('region',{name:'Product Info response',exact:true});
 const grid=info.locator('.packaging-entry-grid');
 const boxes=await grid.locator(':scope > *').evaluateAll(items=>items.map(item=>{const r=item.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right}}));
 expect(boxes).toHaveLength(6);
 expect(Math.max(...boxes.map(r=>r.y))-Math.min(...boxes.map(r=>r.y))).toBeLessThan(2);
 for(let i=1;i<boxes.length;i++)expect(boxes[i].x-boxes[i-1].right).toBeCloseTo(12,0);
 const bounds=(await grid.boundingBox())!;
 expect(boxes.at(-1)!.right).toBeLessThanOrEqual(bounds.x+bounds.width+1);
 await page.setViewportSize({width:390,height:844});
 expect(await grid.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await expect(info.getByLabel(mixParent?'Total Used volume (ml)':'Used volume (ml)',{exact:true})).toBeVisible();
});

for(const mode of ['Floor load','Both'])test(mode+' has one required manual count, no pallet capacity or Floor section',async({page})=>{
 const {editor,writes}=await setup(page,mode);
 await expect(editor.getByLabel('Pallet / Container',{exact:true})).toHaveCount(0);
 await expect(editor.getByRole('region',{name:'Floor load response'})).toHaveCount(0);
 await expect(editor.getByLabel('Carton / Container Floor',{exact:true})).toHaveCount(0);
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await expect(editor.getByText('Carton / Container is required for Floor load and Both.',{exact:true})).toBeVisible();
 expect(writes).toHaveLength(0);
 await editor.getByLabel('Carton / Container',{exact:true}).fill('1200');
 await expect(editor.getByLabel('Net weight / Container (kg)',{exact:true})).toHaveValue('600');
 await editor.getByLabel('Applicable Net weight (g)',{exact:true}).fill('12');
 await expect(editor.getByLabel('Net weight / Container (kg)',{exact:true})).toHaveValue('720');
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 expect(writes[0].rows[0]).toMatchObject({CartonsPerContainer:'1200',ApplicableNetWeightGrams:'12',SelectedContainerType:'20DC',ContainerLoadProfiles:{'20DC':{CartonsPerContainer:'1200'}}});
 for(const key of ['LayersPerContainer','PalletsPerContainer','CartonsPerContainerFloor','NetWeightPerContainerFloorKG'])expect(writes[0].rows[0]).not.toHaveProperty(key);
});

test('Applicable weight defaults to Product weight and drives response volume and packing weights',async({page})=>{
 const {editor}=await setup(page,'Pallet load',{NutDensity:'0.5'});
 await expect(editor.getByLabel('Applicable Net weight (g)',{exact:true})).toHaveValue('10');
 await expect(editor.getByLabel('Used volume (ml)',{exact:true})).toHaveValue('20');
 await editor.getByLabel('Applicable Net weight (g)',{exact:true}).fill('12');
 await expect(editor.getByLabel('Used volume (ml)',{exact:true})).toHaveValue('24');
 await expect(editor.getByLabel('Primary net weight (g)',{exact:true})).toHaveValue('12');
 await expect(editor.getByLabel('Secondary net weight (g)',{exact:true})).toHaveValue('120');
 await expect(editor.getByLabel('Tertiary net weight (g)',{exact:true})).toHaveValue('600');
});

test('Density default is proposed, changed values require explicit update action',async({page})=>{
 const {editor,writes}=await setup(page,'Pallet load',{NutDensity:null,NutDensityDefault:'0.6',NutDensityDefaultRowVersion:'AAAAAAAAAAI=',NutDensityCombinationAvailable:true});
 const density=editor.getByLabel('Nut Density (g/ml)',{exact:true});
 await expect(density).toHaveValue('0.6');
 await expect(editor.getByRole('button',{name:'Update grade density default'})).toHaveCount(0);
 await density.fill('0.7');
 await editor.getByRole('button',{name:'Update grade density default',exact:true}).click();
 await expect(editor.getByText('Grade default: 0.6 g/ml - will update on Confirm save')).toBeVisible();
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 expect(writes[0].rows[0]).toMatchObject({NutDensity:'0.7',NutDensityDefaultUpdate:true,NutDensityDefaultRowVersion:'AAAAAAAAAAI='});
});
test('An ordinary density edit does not opt into changing the shared default',async({page})=>{
 const {editor,writes}=await setup(page,'Pallet load',{NutDensity:'.6',NutDensityDefault:'0.6',NutDensityDefaultRowVersion:'AAAAAAAAAAI='});
 await editor.getByLabel('Nut Density (g/ml)',{exact:true}).fill('0.7');
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0].rows[0].NutDensityDefaultUpdate).toBe(false);
});
test('New grade combination shows automatic mapping notice',async({page})=>{
 const {editor}=await setup(page,'Pallet load',{NutDensityCombinationAvailable:true,NutDensityDefault:null});
 await expect(editor.getByText('New grade combination: default created on save.')).toBeVisible();
});
test('Mix parent applicable weight is read-only and sums child applicable weights',async({page})=>{
 const {editor}=await setup(page,'Pallet load',{IsMixParent:true,WeightGrams:750,
 ProductMixSnapshot:JSON.stringify({items:[{ProductID:1,UnitQuantity:2,WeightGrams:150},{ProductID:2,UnitQuantity:1,WeightGrams:450}]}),
 MixResponseChildren:JSON.stringify([{ProductID:1,ApplicableNetWeightGrams:140,NutDensity:'0.5'},{ProductID:2,ApplicableNetWeightGrams:400,NutDensity:'0.5'}])});
 await expect(editor.getByLabel('Applicable Net weight (g)',{exact:true})).toHaveValue('680');
 await expect(editor.getByLabel('Applicable Net weight (g)',{exact:true})).toHaveAttribute('readonly','');
 await expect(editor.getByLabel('Total Used volume (ml)',{exact:true})).toHaveValue('1,360');
});
test('Container profiles retain their own manual entries across switches and reload',async({page})=>{
 const {editor,writes}=await setup(page,'Both',{ContainerRequest:'Dry'});
 const selector=editor.getByLabel('Container type',{exact:true});
 await expect(selector.locator('option')).toHaveText(['Choose container type','20DC','40DC','40HC']);
 await editor.getByLabel('Carton / Container',{exact:true}).fill('100');
 await selector.selectOption('40HC');
 await editor.getByLabel('Carton / Container',{exact:true}).fill('200');
 await selector.selectOption('20DC');
 await expect(editor.getByLabel('Carton / Container',{exact:true})).toHaveValue('100');
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 expect(writes[0].rows[0].ContainerLoadProfiles).toMatchObject({'20DC':{CartonsPerContainer:'100'},'40HC':{CartonsPerContainer:'200'}});
});
test('Invalid manual counts never save',async({page})=>{
 const {editor,writes}=await setup(page,'Both');
 for(const value of ['0','-1','1.5','2147483648']){
  await editor.getByLabel('Carton / Container',{exact:true}).fill(value);
  await editor.getByRole('button',{name:'Review & save',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Confirm request save'})).toHaveCount(0);
  expect(writes).toHaveLength(0);
 }
});
test('Approved response fields are locked',async({page})=>{
 const {editor}=await setup(page,'Both',{ItemStage:'Approved',SelectedContainerType:'20DC',CartonsPerContainer:1200});
 for(const label of ['Applicable Net weight (g)','Carton / Container','Container type'])await expect(editor.getByLabel(label,{exact:true})).toBeDisabled();
 await expect(editor.getByRole('button',{name:'Review & save',exact:true})).toBeDisabled();
});
test('Container and density controls fit desktop and mobile',async({page})=>{
 const {editor}=await setup(page,'Both',{CartonsPerContainer:1200,NutDensity:'.7',NutDensityDefault:'0.6'});
 for(const width of [1920,390]){
  await page.setViewportSize({width,height:width===1920?1080:844});
  for(const label of ['Applicable Net weight (g)','Carton / Container','Net weight / Container (kg)','Nut Density (g/ml)']){
   const input=editor.getByLabel(label,{exact:true});await input.scrollIntoViewIfNeeded();
   const box=await input.boundingBox();expect(box).not.toBeNull();
   expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 }
});
