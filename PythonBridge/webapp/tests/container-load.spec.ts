import {test,expect,type Page} from '@playwright/test';
import {allowedContainerTypes,proposedContainers,proposalProfiles,profilesPayload,containerChange} from '../src/container-loading';
import {capturedMixQuantity,mixPackingError} from '../src/mix-packing';

async function setup(page:Page,configuration='Both',overrides:Record<string,unknown>={},largeFloor=false){
 const writes:any[]=[];
 let row:any={RequestID:1,ItemID:1,ProductCode:'PRD-1',ProductName:'Nut product',ItemDescription:'Item 1',ItemStage:'Assigned',PIC:'Admin',PICUserID:1,ItemRowVersion:'AAAAAAAAAAE=',WeightGrams:'10.00',RequestedLayerCount:3,ResponseLayerCount:3,UnitsPerCarton:10,UnitsPerTertiary:5,CartonsPerLayer:10,LayersPerPallet:null,HeightMM:400,ResponseMaxPalletHeightMM:950,ConfigurationRequest:configuration,ContainerRequest:'Both',ResponsePalletSize:'1.1x1.1m',...overrides};
 await page.route('**/api/**',route=>{
  const p=new URL(route.request().url()).pathname;
  if(p.endsWith('/session'))return route.fulfill({json:{username:'Admin',user_id:1,is_admin:true,scopes:['Admin']}});
  if(p.endsWith('/preferences'))return route.fulfill({json:{settings:{columns:['CustomerName'],filters:[],sort:[],page_size:25},version:0}});
  if(p==='/api/workbench/requests')return route.fulfill({json:{rows:[{RequestID:1,RequestNumber:'PCR-1',CustomerName:'Customer',OpportunityNumber:'OPP-1',RequestStatus:'Open',ItemCount:1}],total:1}});
  if(p==='/api/packaging/requests')return route.fulfill({json:{rows:[row],total:1,page:1}});
  if(p==='/api/packaging/lookups')return route.fulfill({json:{currencies:[],packagingTypes:[],pallets:[{ID:1,PalletSize:'1.1x1.1m',PalletsPer20DC:20,PalletsPer40DC:40,PalletsPer40HC:44,PalletsPer20RC:18,PalletsPer40RHC:36},{ID:2,PalletSize:'1.2x1.2m',PalletsPer20DC:15,PalletsPer40DC:30,PalletsPer40HC:34,PalletsPer20RC:14,PalletsPer40RHC:28}]}});
  if(p==='/api/workbench/pics')return route.fulfill({json:{rows:[{ID:1,UserName:'Admin'}]}});
  if(p.endsWith('/pallet-capacity'))return route.fulfill({json:{cartons_per_layer:20,pallet_layers:8}});
  if(largeFloor&&p.endsWith('/floor-capacity'))return route.fulfill({json:{rows:[{Code:'40DC',ContainerID:1,Inputs:{carton:{height:500,length:150,width:150},container:{height:2393,length:12032,width:2352},carton_kg:.45,payload_kg:26730},Result:{cartons:4800,container_tiers:4,container_layer:Array.from({length:1200},(_,n)=>({x:Math.floor(n/15)*150,y:n%15*150,length:150,width:150})),container_layout_optimal:true,container_layer_upper_bound:1200,gross_kg:2160,volume_percent:79.7399,warnings:[]}}]}});
  if(p.endsWith('/floor-capacity'))return route.fulfill({json:{rows:['20DC','40DC','40HC','20RC','40RHC'].map((Code,i)=>({Code,ContainerID:i+1,Inputs:{carton:{length:200,width:200,height:200},container:{length:600,width:400,height:400},carton_kg:.21,payload_kg:20},Result:{cartons:Math.min(10+i,12),container_layer:[0,1,2,3,4,5].map(n=>({x:Math.floor(n/2)*200,y:n%2*200,length:200,width:200})),container_layout_optimal:true,container_layer_upper_bound:6,gross_kg:Math.min(10+i,12)*.21,volume_percent:Math.min(10+i,12)/12*100,warnings:[]}}))}});
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
 // No captured geometry/material: stale cartons are cleared, not reused as a proposal.
 await expect(editor.getByLabel('Cartons / layer',{exact:true})).toHaveValue('');
 await editor.getByLabel('Cartons / layer',{exact:true}).fill('10');
 await expect(editor.getByLabel('Carton / Container',{exact:true})).toHaveValue('800');
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 expect(writes[0].rows[0]).not.toHaveProperty('CartonsPerContainer');
 expect(writes[0].rows[0]).not.toHaveProperty('LayersPerContainer');
});

test('Mix final packages allow every exact divisor and use captured parent composition',()=>{
 const child={RequestID:1,ProductID:42,ParentItemID:10};
 const parent={RequestID:1,OpportunityItemID:10,ProductMixSnapshot:JSON.stringify({items:[{ProductID:42,UnitQuantity:6}]})};
 const q=capturedMixQuantity(child,[parent]);expect(q).toBe('6');
 for(const n of ['1','2','3','6'])expect(mixPackingError(q,{ResponseLayerCount:'2',UnitsPerCarton:n})).toBe('');
 expect(mixPackingError(q,{ResponseLayerCount:'3',UnitsPerCarton:'3',UnitsPerTertiary:'2'})).toBe('');
 for(const n of ['4','5','12'])expect(mixPackingError(q,{ResponseLayerCount:'2',UnitsPerCarton:n})).toContain('exact divisor');
 expect(capturedMixQuantity(child,[])).toBeNull();
});

test('proposal flags survive container switches and serialize as booleans',()=>{
 const values={SelectedContainerType:'20DC',CartonsPerContainer:'7',ResponseLayerCount:'1',ContainerLoadProfiles:''};
 expect(proposedContainers(values,{})).toEqual(['20DC']);
 const next={...values,ContainerLoadProfiles:proposalProfiles(values,{ContainerRequest:'Both'},'40DC',true,'8')};
 next.ContainerLoadProfiles=proposalProfiles(next,{ContainerRequest:'Both'},'20DC',false);
 const switched=containerChange(next,'SelectedContainerType','40DC',[],'Floor load');
 expect(proposedContainers(switched,{})).toEqual(['40DC']);expect(switched.CartonsPerContainer).toBe('8');
 expect(profilesPayload(switched.ContainerLoadProfiles)['40DC'].Proposal).toBe(true);
 expect(profilesPayload(switched.ContainerLoadProfiles)['20DC'].Proposal).toBe(false);
});

test('multiple floor Proposal ticks save independently and remain selected after reload',async({page})=>{
 const {editor,writes}=await setup(page,'Floor load',{ResponseLayerCount:1,LayerTareJSON:JSON.stringify({Primary:{KG:'.2'}}),LayerDimensionCaptures:{Primary:{PackagingTypeName:'',LayerCount:1,Dimensions:[{Name:'Length',Unit:'mm',Value:'200'},{Name:'Width',Unit:'mm',Value:'200'},{Name:'Height',Unit:'mm',Value:'200'}]}}});
 await expect(editor.getByLabel('Carton / Container',{exact:true})).toHaveValue('10');
 await editor.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true});
 await expect(dialog.getByLabel('Proposal 20DC',{exact:true})).toBeChecked();
 await expect(dialog.getByLabel('Proposal 20DC',{exact:true})).toBeDisabled();
 await dialog.getByLabel('Container type',{exact:true}).selectOption('40DC');
 await dialog.getByLabel('Floor preview Cartons / Container',{exact:true}).fill('8');
 await dialog.getByLabel('Proposal 40DC',{exact:true}).check();
 await expect(dialog.getByLabel('Proposal 20DC',{exact:true})).toBeChecked();
 await expect(dialog.getByLabel('Proposal 40DC',{exact:true})).toBeChecked();
 await expect(dialog.getByRole('columnheader',{name:'Pallets',exact:true})).toHaveCount(0);
 await expect(dialog.getByText('Palletization',{exact:true})).toHaveCount(0);
 for(const viewport of [{width:1366,height:768},{width:1280,height:720},{width:1920,height:1080}]){
  await page.setViewportSize(viewport);
  const scene=await dialog.getByRole('img',{name:'3D floor arrangement 40DC'}).boundingBox(),controls=await dialog.locator('.load-planner-controls').boundingBox();
  expect(scene!.x).toBeGreaterThanOrEqual(controls!.x+controls!.width);
  const table=await dialog.getByRole('table',{name:'Proposed floor loads'}).boundingBox(),close=await dialog.getByRole('button',{name:'Close',exact:true}).boundingBox();
  expect(table!.y+table!.height).toBeLessThanOrEqual(close!.y);
  await dialog.screenshot({path:test.info().outputPath('floor-layout-'+viewport.width+'.png')});
 }
 await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(1);
 const profiles=writes[0].rows[0].ContainerLoadProfiles;
 expect(profiles['20DC'].Proposal).toBe(true);expect(profiles['40DC'].Proposal).toBe(true);expect(profiles['40DC'].CartonsPerContainer).toBe('8');expect(profiles['40HC'].Proposal).toBe(false);
 await editor.getByRole('button',{name:'3D container load',exact:true}).click();
 await expect(dialog.getByLabel('Proposal 40DC',{exact:true})).toBeChecked();
 await dialog.getByLabel('Container type',{exact:true}).selectOption('40DC');await expect(dialog.getByLabel('Floor preview Cartons / Container',{exact:true})).toHaveValue('8');
});

test('4800-carton scene draws the complete load as a detailed third plus one grouped block',async({page})=>{
 const {editor,writes}=await setup(page,'Floor load',{ContainerRequest:'40DC',SelectedContainerType:'40DC',CartonsPerContainer:4800,WeightGrams:250,ResponseLayerCount:1,LayerTareJSON:JSON.stringify({Primary:{KG:'.2'}}),LayerDimensionCaptures:{Primary:{PackagingTypeName:'',LayerCount:1,Dimensions:[{Name:'Length',Unit:'mm',Value:'150'},{Name:'Width',Unit:'mm',Value:'150'},{Name:'Height',Unit:'mm',Value:'500'}]}}},true);
 await editor.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true}),legend=dialog.locator('.load-section-legend');
 await expect(legend).toContainText('27 rows × 15 cartons/row/layer × 4 layers = 1,620 cartons');
 await expect(legend).toContainText('53 rows × 15 cartons/row/layer × 4 layers = 3,180 cartons');
 await expect(legend).toContainText('Total represented: 4,800 cartons');
 await expect(dialog).not.toContainText('first 2,500');
 await expect(dialog).toContainText('12,032 × 2,352 × 2,393 mm');
 await expect(dialog.locator('.load-warning')).toHaveCount(0);
 for(const viewport of [{width:1366,height:768},{width:1280,height:720},{width:1920,height:1080}]){
  await page.setViewportSize(viewport);
  await dialog.screenshot({path:test.info().outputPath('full-load-'+viewport.width+'.png')});
  const notes=await legend.boundingBox(),table=await dialog.getByRole('table',{name:'Proposed floor loads'}).boundingBox();expect(notes!.y+notes!.height).toBeLessThanOrEqual(table!.y);
 }
 await dialog.getByRole('button',{name:'Top view',exact:true}).click();await dialog.screenshot({path:test.info().outputPath('full-load-top.png')});
 await dialog.getByRole('button',{name:'Zoom in',exact:true}).click();await dialog.getByRole('button',{name:'Reset view',exact:true}).click();
 await dialog.getByLabel('Floor preview Cartons / Container',{exact:true}).fill('2500');
 await expect(legend).toContainText('Total represented: 2,500 cartons');await expect(legend).toContainText('880 cartons (40 in a partial row)');
 await dialog.getByRole('button',{name:'Close',exact:true}).click();expect(writes).toHaveLength(0);
});

test('40DC requests offer all five alternatives and keep 40DC mandatory',async({page})=>{
 const {editor,writes}=await setup(page,'Floor load',{ContainerRequest:'40DC',ShipmentContainerSizeFT:'40FT',ResponseLayerCount:1,LayerTareJSON:JSON.stringify({Primary:{KG:'.2'}}),LayerDimensionCaptures:{Primary:{PackagingTypeName:'',LayerCount:1,Dimensions:[{Name:'Length',Unit:'mm',Value:'200'},{Name:'Width',Unit:'mm',Value:'200'},{Name:'Height',Unit:'mm',Value:'200'}]}}});
 await editor.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true});
 await expect(dialog.getByRole('checkbox')).toHaveCount(5);
 await expect(dialog.getByLabel('Proposal 40DC',{exact:true})).toBeChecked();await expect(dialog.getByLabel('Proposal 40DC',{exact:true})).toBeDisabled();
 await dialog.getByLabel('Proposal 20RC',{exact:true}).check();await dialog.getByLabel('Proposal 40RHC',{exact:true}).check();
 await expect(dialog.getByLabel('Proposal 20DC',{exact:true})).not.toBeChecked();
 await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(1);
 const selected=Object.entries(writes[0].rows[0].ContainerLoadProfiles).filter(([,p])=>(p as any).Proposal).map(([code])=>code);
 expect(selected).toEqual(['40DC','20RC','40RHC']);
});

for(const configuration of ['Floor load','Both'])test(configuration+' proposals share the existing 3D icon, allow manual counts and fit the viewport',async({page})=>{
 const planWrites:string[]=[];page.on('request',r=>{if(r.url().includes('/load-planning/')&&r.url().endsWith('/save'))planWrites.push(r.url())});
 const {editor,writes}=await setup(page,configuration,{ResponseLayerCount:1,LayerTareJSON:JSON.stringify({Primary:{KG:'.2'}}),LayerDimensionCaptures:{Primary:{PackagingTypeName:'',LayerCount:1,Dimensions:[{Name:'Length',Unit:'mm',Value:'200'},{Name:'Width',Unit:'mm',Value:'200'},{Name:'Height',Unit:'mm',Value:'200'}]}}});
 const count=editor.getByLabel('Carton / Container',{exact:true});
 await expect(count).toHaveValue('10');
 await count.fill('7');await expect(count).toHaveValue('7');
 await editor.getByLabel('Container type',{exact:true}).selectOption('40DC');
 await expect(count).toHaveValue('11');
 await editor.getByLabel('Container type',{exact:true}).selectOption('20DC');await expect(count).toHaveValue('7');
 await expect(editor.getByRole('table',{name:'Proposed floor loads',exact:true})).toHaveCount(0);
 await editor.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true});
 await expect(page.getByRole('dialog')).toHaveCount(2);
 await expect(dialog.getByRole('table',{name:'Proposed floor loads',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'View 40DC',exact:true}).click();
 await expect(dialog.getByRole('img',{name:'3D floor arrangement 40DC',exact:true})).toBeVisible();
 const manual=dialog.getByLabel('Floor preview Cartons / Container',{exact:true});
 await manual.fill('12');await expect(dialog.getByRole('button',{name:'Use carton count',exact:true})).toBeDisabled();
 await manual.fill('8');
 if(configuration==='Both'){
  await dialog.getByLabel('Loading mode',{exact:true}).selectOption('pallet');
  await expect(dialog.getByRole('table',{name:'Proposed floor loads',exact:true})).toHaveCount(0);
  await dialog.getByLabel('Loading mode',{exact:true}).selectOption('floor');
  await expect(manual).toHaveValue('8');
 }
 for(const width of [984,390]){
  await page.setViewportSize({width,height:844});const action=dialog.getByRole('button',{name:'Use carton count',exact:true});
  await action.click({trial:true});const box=await dialog.boundingBox();expect(box!.width).toBeLessThanOrEqual(width);
  const heading=await dialog.getByRole('heading',{name:'3D container load',exact:true}).boundingBox();
  expect(heading!.y).toBeGreaterThanOrEqual(box!.y);expect(heading!.y+heading!.height).toBeLessThan(844);
 }
 await dialog.screenshot({path:test.info().outputPath('floor-preview-390.png')});
 await dialog.getByRole('button',{name:'Use carton count',exact:true}).click();
 await expect(editor.getByLabel('Container type',{exact:true})).toHaveValue('40DC');await expect(count).toHaveValue('8');
 expect(writes).toHaveLength(0);expect(planWrites).toHaveLength(0);
 await expect(editor.getByRole('table',{name:'Proposed floor loads',exact:true})).toHaveCount(0);
});

test('approved floor proposals remain view-only inside the same 3D dialog',async({page})=>{
 const {editor,writes}=await setup(page,'Floor load',{ItemStage:'Approved',SelectedContainerType:'20DC',CartonsPerContainer:7,ResponseLayerCount:1,LayerTareJSON:JSON.stringify({Primary:{KG:'.2'}}),LayerDimensionCaptures:{Primary:{PackagingTypeName:'',LayerCount:1,Dimensions:[{Name:'Length',Unit:'mm',Value:'200'},{Name:'Width',Unit:'mm',Value:'200'},{Name:'Height',Unit:'mm',Value:'200'}]}}});
 await editor.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true});
 await expect(dialog.getByLabel('Floor preview Cartons / Container',{exact:true})).toHaveAttribute('readonly','');
 await expect(dialog.getByRole('button',{name:'Use carton count',exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'Use proposal',exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'View 40DC',exact:true}).click();
 await expect(dialog.getByRole('img',{name:'3D floor arrangement 40DC',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await expect(editor.getByLabel('Carton / Container',{exact:true})).toHaveValue('7');expect(writes).toHaveLength(0);
});

test('response formats volume and gross weights and exposes response pallet gross in 3D before calculation',async({page})=>{
 const snapshot={ID:9,PalletSize:'1100x1100mm',Dimensions:{length:'1100',width:'1100',height:'155'},TareKG:'17',MissingTare:[],UnitPrice:'15.5',CurrencyCode:'USD',components:[]};
 const {editor}=await setup(page,'Pallet load',{ResponseLayerCount:1,WeightGrams:'750',NutDensity:'0.61',HeightMM:150,ResponseMaxPalletHeightMM:1805,CartonsPerLayer:50,ResponsePalletSize:'1100x1100mm',LayerTareJSON:JSON.stringify({Primary:{KG:'10.13885'}}),PalletPricingJSON:JSON.stringify(snapshot)});
 await expect(editor.getByLabel('Primary gross weight (g)',{exact:true})).toHaveValue('10,888.85');
 await expect(editor.getByLabel('Used volume (ml)',{exact:true})).toHaveValue('1,229.508');
 const gross=editor.getByLabel('Gross weight / Pallet (kg)',{exact:true});
 expect(await gross.inputValue()).toMatch(/^\d{1,3}(,\d{3})*(\.\d{1,3})?$/);
 const responseGross=await gross.inputValue();
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true});
 await expect(dialog.getByLabel('Gross weight / Pallet (kg)',{exact:true})).toHaveValue(responseGross);
 for(const width of [984,390]){
  await page.setViewportSize({width,height:844});
  const close=dialog.getByRole('button',{name:'Close',exact:true});
  const action=await close.boundingBox(),trail=await dialog.getByRole('navigation',{name:'Open views',exact:true}).boundingBox();
  expect(action!.y+action!.height).toBeLessThanOrEqual(trail!.y);
  await close.click({trial:true});
 }
});

test('container weights show Net then Gross without an incomplete placeholder',async({page})=>{
 const {editor}=await setup(page,'Pallet load');
 const region=editor.getByRole('region',{name:'Container Load response'});
 const labels=await region.locator('label').allTextContents();
 expect(labels.indexOf('Gross weight / Container (kg)')).toBe(labels.indexOf('Net weight / Container (kg)')+1);
 await expect(region.getByLabel('Gross weight / Container (kg)',{exact:true})).not.toHaveAttribute('placeholder',/incomplete/);
 await expect(region).not.toContainText('Tare or load plan incomplete');
});

test('pallet pricing adds matching pallet and accessories and calculates gross weight',async({page},info)=>{
 const price=(ID:number,MaterialCode:string,order:string,weight:string)=>({ID,MaterialCode,MaterialName:MaterialCode,PackagingOrder:order,IsPallet:order==='Pallet',RowVersion:'AAAAAAAAAAE=',MaterialRowVersion:'AAAAAAAAAAI=',CurrencyCode:'USD',UnitPrice:ID===1?'10':'2',QuantityFrom:1,TareWeight:weight,TareWeightBasis:'kg/EA',Dimensions:order==='Pallet'?{length:'1100',width:'1100',height:'150'}:null});
 const pallet=price(1,'PALLET','Pallet','20'),corner=price(2,'CORNER','Primary','.5'),other={...price(3,'WRONG-SIZE','Pallet','10'),Dimensions:{length:'1200',width:'800',height:'140'}};
 let saved:any;
 const {editor}=await setup(page,'Pallet load',{ResponsePalletSize:'1100x1100mm',ResponseLayerCount:2,WeightGrams:100,LayerTareJSON:JSON.stringify({Primary:{KG:'.1'},Secondary:{KG:'3'}})});
 await page.route('**/api/pallet-pricing/**',route=>{
  const request=route.request();if(request.method()==='GET')return route.fulfill({json:{rows:[pallet,corner,other]}});
  saved=request.postDataJSON();const snapshot={ID:9,PalletSize:'1100x1100mm',Dimensions:pallet.Dimensions,TareKG:'22',MissingTare:[],UnitPrice:'18',CurrencyCode:'USD',components:[{...pallet,Quantity:'1'},{...corner,Quantity:'4'}]};
  return route.fulfill({json:snapshot});
 });
 await editor.getByRole('button',{name:'Pallet Pricing Calculator',exact:true}).click();
 const calculator=page.getByRole('dialog',{name:'Pallet Pricing Calculator',exact:true});
 await expect(calculator.getByRole('checkbox',{name:'Select WRONG-SIZE',exact:true})).toHaveCount(0);
 await calculator.getByRole('button',{name:'Add PALLET price 1',exact:true}).click();
 await calculator.getByRole('button',{name:'Add CORNER price 2',exact:true}).click();
 await calculator.getByLabel('Quantity CORNER',{exact:true}).fill('4');
 await calculator.getByRole('button',{name:'Calculate pallet',exact:true}).click();
 await expect(calculator.locator('.pricing-calculator-actions').getByRole('status')).toContainText('22 kg');
 await expect(calculator.locator('.pricing-calculator-body').getByRole('status')).toHaveCount(0);
 for(const width of [984,390]){
  await page.setViewportSize({width,height:844});
  const action=calculator.getByRole('button',{name:'Apply pallet pricing',exact:true});
  const box=await action.boundingBox(),trail=await calculator.getByRole('navigation',{name:'Open views',exact:true}).boundingBox();
  expect(box!.y+box!.height).toBeLessThanOrEqual(trail!.y);
  await action.click({trial:true});
 }
 await expect(calculator.locator('.pricing-calculator-actions').getByRole('status')).toBeInViewport();
 await calculator.screenshot({path:info.outputPath('pallet-calculator-mobile.png')});
 await page.setViewportSize({width:1920,height:1080});
 await calculator.getByRole('button',{name:'Apply pallet pricing',exact:true}).click();
 await expect(calculator).toHaveCount(0);
 expect(saved.components.map((c:any)=>c.Quantity)).toEqual(['1','4']);
 await expect(editor.getByLabel('Gross weight / Pallet (kg)',{exact:true})).toHaveValue('122');
 const efficiency=editor.getByRole('region',{name:'Efficiency response'});
 expect(await efficiency.locator('label').allTextContents()).toEqual(expect.arrayContaining(['Pallet height (mm)']));
 const height=await efficiency.getByLabel('Pallet height (mm)',{exact:true}).boundingBox();
 const percent=await efficiency.getByLabel('Pallet height efficiency %',{exact:true}).boundingBox();
 expect(height!.x).toBeLessThan(percent!.x);
 await editor.getByRole('region',{name:'Palletization response'}).screenshot({path:info.outputPath('pallet-fields.png')});
 await editor.getByLabel('Cartons / layer',{exact:true}).fill('12');
 await expect(editor.getByLabel('Gross weight / Pallet (kg)',{exact:true})).toHaveValue('142');
});

test('historical mix without net composition keeps net unknown and retains captured child gross',async({page})=>{
 const {editor}=await setup(page,'Pallet load',{IsMixParent:true,ProductMixSnapshot:null,MixResponseChildren:JSON.stringify([{ProductID:1,UnitQuantity:1,CartonGrossWeightKG:'1.19067'}]),WeightGrams:'1190.67',ResponseLayerCount:2,LayerTareJSON:JSON.stringify([{PackagingOrder:'Primary',Tare:{KG:'3'}},{PackagingOrder:'Secondary',Tare:{KG:'2'}}])});
 await expect(editor.getByLabel('Primary net weight (g)',{exact:true})).toHaveValue('');
 await expect(editor.getByLabel('Primary gross weight (g)',{exact:true})).toHaveValue('4,190.67');
 await expect(editor.getByLabel('Secondary gross weight (g)',{exact:true})).toHaveValue('43,906.7');
});

test('gross weights survive confirmed-layer changes and recalculate from counts',async({page})=>{
 const tares=[{PackagingOrder:'Primary',Tare:{KG:'0.21',Missing:[]}},{PackagingOrder:'Secondary',Tare:{KG:'3',Missing:[]}},{PackagingOrder:'Tertiary',Tare:{KG:'2',Missing:[]}}];
 const {editor}=await setup(page,'Pallet load',{WeightGrams:'396.89',LayerTareJSON:JSON.stringify(tares)});
 await expect(editor.getByLabel('Primary gross weight (g)',{exact:true})).toHaveValue('606.89');
 await expect(editor.getByLabel('Secondary gross weight (g)',{exact:true})).toHaveValue('9,068.9');
 await expect(editor.getByLabel('Tertiary gross weight (g)',{exact:true})).toHaveValue('47,344.5');
 await editor.getByLabel('Confirmed packaging layers',{exact:true}).selectOption('2');
 await expect(editor.getByLabel('Secondary gross weight (g)',{exact:true})).toHaveValue('9,068.9');
 await editor.getByLabel('No of Primary Unit',{exact:true}).fill('12');
 await expect(editor.getByLabel('Secondary gross weight (g)',{exact:true})).toHaveValue('10,282.68');
 await editor.getByLabel('Confirmed packaging layers',{exact:true}).selectOption('3');
 await expect(editor.getByLabel('Tertiary gross weight (g)',{exact:true})).toHaveValue('53,413.4');
});

for(const child of [false,true])test('highlight only the final parent shipping height: child='+child,async({page})=>{
 const captures=Object.fromEntries(['Primary','Secondary','Tertiary'].map(order=>[order,{LayerCount:3,PackagingTypeName:'Captured '+order,Dimensions:[{Name:'Length',Unit:'mm',Value:'340'},{Name:'Width',Unit:'mm',Value:'145'},{Name:'Height',Unit:'mm',Value:'200'}]}]));
 const {editor}=await setup(page,'Pallet load',{FirstPMType:'Captured Primary',SecondPMType:'Captured Secondary',ThirdPMType:'Captured Tertiary',LayerDimensionCaptures:captures,...(child?{ParentItemID:10}:{})});
 await expect(editor.locator('.captured-dimensions-value').filter({hasText:'200mm'})).toHaveCount(3);
 await expect(editor.locator('.dimension-height')).toHaveCount(child?0:1);
 if(!child){
  await expect(editor.getByLabel('Tertiary dimension height',{exact:true})).toBeVisible();
  await editor.getByLabel('Confirmed packaging layers',{exact:true}).selectOption('2');
  await expect(editor.locator('.dimension-height')).toHaveCount(1);
  await expect(editor.getByLabel('Secondary dimension height',{exact:true})).toBeVisible();
 }
});

test('quantity and weight columns leave room for dimensions without crossing layer boundaries',async({page},info)=>{
 const captures=Object.fromEntries(['Primary','Secondary','Tertiary'].map(order=>[order,{LayerCount:3,PackagingTypeName:'Captured '+order,Dimensions:[{Name:'Length',Unit:'mm',Value:'340'},{Name:'Width',Unit:'mm',Value:'145'},{Name:'Height',Unit:'mm',Value:'200'}]}]));
 const {editor}=await setup(page,'Pallet load',{FirstPMType:'Captured Primary',SecondPMType:'Captured Secondary',ThirdPMType:'Captured Tertiary',LayerDimensionCaptures:captures});
 await expect(editor.getByLabel('Tertiary dimension height',{exact:true})).toHaveText('200mm');
 for(const width of [1920,1280,390]){
  await page.setViewportSize({width,height:900});
  const layers=editor.locator('.packing-way-layer');
  expect(await editor.locator('.packing-way-grid').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await expect(editor.getByPlaceholder('Tare incomplete',{exact:true})).toHaveCount(0);
  for(const layer of await layers.all()){
   await layer.scrollIntoViewIfNeeded();
   expect(await layer.evaluate(el=>{
    const bounds=el.getBoundingClientRect();
    return Array.from(el.children).flatMap(child=>{const r=child.getBoundingClientRect();return r.left>=bounds.left-1&&r.right<=bounds.right+1&&child.scrollWidth<=child.clientWidth+1?[]:[{text:child.textContent,width:r.width,scroll:child.scrollWidth,viewport:window.innerWidth}];});
   })).toEqual([]);
  }
  if(width>=1280){
   expect(await layers.evaluateAll(items=>new Set(items.map(el=>Math.round(el.getBoundingClientRect().top))).size)).toBe(1);
   const calculators=editor.locator('.packaging-layer-sections>section');
   for(const price of await calculators.locator('.packaging-entry-grid>label:last-child').all()){
    expect(await price.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el.firstChild!);return range.getClientRects().length;})).toBe(1);
    expect(await price.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
   }
   for(let i=0;i<3;i++){const a=await layers.nth(i).boundingBox(),b=await calculators.nth(i).boundingBox();expect(Math.abs(a!.x-b!.x)).toBeLessThanOrEqual(1);expect(Math.abs(a!.width-b!.width)).toBeLessThanOrEqual(1);}
  }
  if(width===1280)await editor.screenshot({path:info.outputPath('aligned-three-layers-1280.png')});
  if(width===1920){
   const columns=await layers.first().locator(':scope>label').evaluateAll(labels=>labels.map(label=>label.getBoundingClientRect().width));
   expect(columns[0]).toBeLessThanOrEqual(146);expect(columns[1]).toBeLessThanOrEqual(166);
   expect(columns).toHaveLength(4);
   expect(columns[3]).toBeGreaterThan(Math.max(...columns.slice(0,3)));
   const row=layers.first();
   expect(await row.locator(':scope>label').evaluateAll(labels=>new Set(labels.map(label=>Math.round(label.getBoundingClientRect().top))).size)).toBe(1);
   const quantityWidth=await row.locator('.packing-layer-quantity input').evaluate(el=>el.getBoundingClientRect().width);
   expect(quantityWidth).toBeGreaterThanOrEqual(70);expect(quantityWidth).toBeLessThanOrEqual(105);
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
 await expect(selector.locator('option')).toHaveText(['Choose container type','20DC','40DC','40HC','20RC','40RHC']);
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
 for(const label of ['Applicable Net weight (g)','Carton / Container'])await expect(editor.getByLabel(label,{exact:true})).toHaveAttribute('readonly','');
 await expect(editor.getByLabel('Container type',{exact:true})).toBeEnabled(); // view selection, not a response edit
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

test('captured Shipping height calculates pallet totals live before save',async({page})=>{
 const {editor,writes}=await setup(page,'Pallet load',{ResponseLayerCount:2,ResponsePalletMaterialID:424,HeightMM:null,LayersPerPallet:null,ResponseMaxPalletHeightMM:1130,WeightGrams:400,UnitsPerCarton:6,CartonsPerLayer:20,SecondPMType:'Tray',PalletPricingJSON:JSON.stringify({ID:9,PalletSize:'1.1x1.1m',Dimensions:{length:'1100',width:'1100',height:'150'},TareKG:'22',MissingTare:[],components:[]}),LayerTareJSON:JSON.stringify({Primary:{KG:'.01'},Secondary:{KG:'.1'}}),LayerDimensionCaptures:{Secondary:{PackagingTypeName:'Tray',LayerCount:2,Dimensions:[{Name:'Length',Unit:'mm',Value:'296'},{Name:'Width',Unit:'mm',Value:'195'},{Name:'Height',Unit:'mm',Value:'147'}]}}});
 await expect(editor.getByLabel('Layers / pallet',{exact:true})).toHaveValue('6');
 await expect(editor.getByLabel('Units / pallet',{exact:true})).toHaveValue('720');
 await expect(editor.getByLabel('Net weight / Pallet (kg)',{exact:true})).toHaveValue('288');
 await expect(editor.getByLabel('Gross weight / Pallet (kg)',{exact:true})).toHaveValue('329.2');
 const maximum=editor.getByLabel('Max pallet height (mm)',{exact:true});
 await maximum.focus();await expect(maximum).toHaveValue('1130');await maximum.fill('1420');
 await expect(editor.getByLabel('Layers / pallet',{exact:true})).toHaveValue('8');
 await expect(editor.getByLabel('Units / pallet',{exact:true})).toHaveValue('960');
 await expect(editor.getByLabel('Gross weight / Pallet (kg)',{exact:true})).toHaveValue('431.6');
 await editor.getByLabel('Confirmed packaging layers',{exact:true}).selectOption('3');
 await expect(editor.getByLabel('Layers / pallet',{exact:true})).toHaveValue('');
 await editor.getByLabel('Confirmed packaging layers',{exact:true}).selectOption('2');
 await expect(editor.getByLabel('Layers / pallet',{exact:true})).toHaveValue('8');
 expect(writes).toHaveLength(0);
});
