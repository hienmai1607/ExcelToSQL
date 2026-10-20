import {test,expect,type Page} from '@playwright/test';
const version='AAAAAAAAAAE=';
const container={ID:1,RowVersion:version,Code:'20DC',Family:'Dry',SizeFT:20,Status:'Active',Specifications:{length:5900,width:2350,height:2390,payload_kg:28000}};
const inputs={mode:'pallet',weight_source:'response',carton:{length:400,width:300,height:200},carton_kg:10,pallet:{length:1200,width:800,height:140},pallet_kg:20,max_pallet_height:1140,pallet_payload_kg:1000,container:{length:5900,width:2350,height:2390},rotate:true,double_stack:false,stackable:false};
const layer=Array.from({length:8},(_,i)=>({x:(i%4)*300,y:Math.floor(i/4)*400,length:300,width:400}));
const result={pallet_layer:layer,cartons_per_layer:8,pallet_layers:5,cartons_per_pallet:40,container_layer:[...Array.from({length:7},(_,i)=>({x:i*800,y:0,length:800,width:1200})),...Array.from({length:4},(_,i)=>({x:i*1200,y:1200,length:1200,width:800}))],container_tiers:1,floor_positions:11,geometric_units:11,loaded_units:11,cartons:440,loaded_unit_height:1140,gross_kg:4620,volume_percent:40,warnings:[]};
async function setup(page:Page,availableContainers=[container],session:Record<string,unknown>={username:'Admin',user_id:1,is_admin:true,scopes:['Admin']},configuration='Pallet load',rowOverrides:Record<string,unknown>={}){
 const writes:any[]=[];
 const row={LayerTareJSON:JSON.stringify([{PackagingOrder:'Primary',Tare:{KG:'3',Missing:[]}}]),RequestID:1,ItemID:1,ProductCode:'PRD-1',ProductName:'Product',ItemStage:'Assigned',PIC:'Admin',PICUserID:1,ItemRowVersion:version,WeightGrams:100,CartonsPerLayer:5,RequestedLayerCount:1,ResponseLayerCount:1,ResponsePalletSize:'1200x800mm',PalletPricingJSON:JSON.stringify({ID:9,PalletSize:'1200x800mm',Dimensions:{length:'1200',width:'800',height:'140'},TareKG:'20',MissingTare:[],UnitPrice:'15',CurrencyCode:'USD',components:[]}),ConfigurationRequest:configuration,ContainerRequest:'Both',HeightMM:200,ResponseMaxPalletHeightMM:1140,FirstPMType:'Box',LayerDimensionCaptures:{Primary:{PackagingTypeName:'Box',LayerCount:1,Dimensions:[{Name:'Length',Unit:'mm',Value:'400'},{Name:'Width',Unit:'mm',Value:'300'},{Name:'Height',Unit:'mm',Value:'200'}]}},...rowOverrides};
 await page.route('**/api/**',route=>{
  const p=new URL(route.request().url()).pathname;
  if(p.endsWith('/session'))return route.fulfill({json:session});
  if(p.endsWith('/preferences'))return route.fulfill({json:{settings:{columns:['CustomerName'],filters:[],sort:[],page_size:25},version:0}});
  if(p==='/api/workbench/requests')return route.fulfill({json:{rows:[{RequestID:1,RequestNumber:'PCR-1',CustomerName:'Customer',OpportunityNumber:'OPP-1',RequestStatus:'Open',ItemCount:1}],total:1}});
  if(p==='/api/packaging/requests')return route.fulfill({json:{rows:[row],total:1,page:1}});
  if(p.endsWith('/weights'))return route.fulfill({json:{CartonGrossWeightKG:'3.1'}});
  if(p==='/api/load-planning/containers')return route.fulfill({json:{rows:availableContainers}});
  if(p==='/api/load-planning/pallet-prices')return route.fulfill({json:{rows:[{ID:9,RowVersion:version,MaterialCode:'PAL-1',MaterialName:'Euro pallet',Dimensions:{length:1200,width:800,height:140},PriceBasis:'EA',TareWeight:'20',TareWeightBasis:'kg/EA',MaterialRowVersion:version}]}});
  if(p.endsWith('/preview')||p.endsWith('/save')){writes.push(route.request().postDataJSON());return route.fulfill({json:{ID:7,Inputs:route.request().postDataJSON().Inputs,Result:result}})}
  if(p==='/api/packaging/response/batch'){writes.push(route.request().postDataJSON());return route.fulfill({json:{results:[{RowNum:1,Status:'OK',NewRowVersion:version}]}})}
  return route.fulfill({json:{rows:[],currencies:[],packagingTypes:[],pallets:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Requests',exact:true}).click();
 await page.getByRole('button',{name:/^(Edit|View) request PCR-1$/}).click();
 return writes;
}
test('response currency sits immediately beside price and pallet labels lead with L x W',async({page})=>{
 await setup(page,undefined,undefined,undefined,{PrimaryPricePerUnit:'15000',PrimaryPriceCurrencyCode:'VND'});
 const editor=page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
 const field=editor.locator('.response-price-field').first();
 const input=await field.locator('input').boundingBox(),currency=await field.locator('.response-price-currency').boundingBox();
 await expect(field.locator('.response-price-currency')).toHaveText('VND');
 expect(currency!.x-input!.x-input!.width).toBeLessThanOrEqual(8);
 await expect(editor.getByLabel('Pallet',{exact:true}).locator('option:checked')).toHaveText('1200 × 800 mm');
});

test('3D copies final dimensions and captures the viewed container into the draft',async({page},info)=>{
 const writes=await setup(page);
 await expect(page.getByLabel('Primary gross weight (g)',{exact:true})).toHaveValue('3,100');
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true});
 await expect(dialog.getByLabel('carton length',{exact:true})).toHaveValue('400');
 await dialog.getByLabel('Container type',{exact:true}).selectOption('1');
 await expect(dialog.getByLabel('Carton gross weight (kg)',{exact:true})).toHaveValue('3.1');
 await expect(dialog.getByLabel('Carton gross weight (kg)',{exact:true})).toHaveAttribute('readonly','');
 await expect(dialog.getByRole('img',{name:'3D container load layout'})).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Palletization',exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('img',{name:'3D container load layout'})).toBeVisible();
 await dialog.screenshot({path:info.outputPath('container-3d.png')});
 await dialog.getByRole('button',{name:'Top view'}).click();
 await dialog.screenshot({path:info.outputPath('container-plan.png')});

 await expect(dialog.getByRole('button',{name:/Save|Apply/i})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await expect(dialog).toHaveCount(0);
 const editor=page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
 await expect(editor.getByLabel('Container type',{exact:true})).toHaveValue('20DC');
 expect(writes).toHaveLength(2);
 expect(writes[0]).not.toHaveProperty('PalletPriceID');
 expect(writes[0].Inputs.pallet).toEqual({length:1200,width:800,height:140});
 expect(writes[0].Inputs.pallet_kg).toBe(20);
 expect(writes[0].Inputs.weight_source).toBe('response');

});

test('3D defaults to response cartons per layer without persisting the response',async({page})=>{
 const writes=await setup(page);
 await page.route('**/api/load-planning/items/1/*',route=>{
  if(route.request().method()!=='POST')return route.fallback();
  const body=route.request().postDataJSON();writes.push(body);
  return route.fulfill({json:{ID:7,Inputs:body.Inputs,Result:{...result,pallet_layer:layer.slice(0,5),cartons_per_layer:5,cartons_per_pallet:25,cartons:275,gross_kg:1072.5}}});
 });
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true});
 await expect(dialog.getByLabel('Cartons / layer',{exact:true})).toHaveCount(0);
 await dialog.getByLabel('Container type',{exact:true}).selectOption('1');
 await expect(dialog.getByRole('img',{name:'3D container load layout'})).toBeVisible();
 expect(writes[0].Inputs.cartons_per_layer).toBe(5);
 await expect(dialog.getByLabel('Gross weight / Pallet (kg)',{exact:true})).toHaveValue('97.5');
 await expect(dialog.getByRole('button',{name:/Save|Apply/i})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Close',exact:true}).click();
 expect(writes).toHaveLength(2);
 const editor=page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
 await expect(editor.getByLabel('Cartons / layer',{exact:true})).toHaveValue('5');
});

test('planner formats decimals without rounding payload and shows gross per pallet',async({page})=>{
 const writes=await setup(page,[container],undefined,'Both');
 await page.route('**/api/load-planning/items/1/weights',route=>route.fulfill({json:{CartonGrossWeightKG:'10.888850000000000000000',FinalCartonDimensions:{length:'100.000000',width:'200.000000',height:'150.000000'}}}));
 await page.route('**/api/load-planning/items/1/preview',route=>{
  const body=route.request().postDataJSON();writes.push(body);
  return route.fulfill({json:{ID:7,Inputs:body.Inputs,Result:result}});
 });
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true});
 await dialog.getByLabel('Loading mode',{exact:true}).selectOption('pallet');
 await expect(dialog.getByLabel('carton length',{exact:true})).toHaveValue('100');
 await expect(dialog.getByLabel('Carton gross weight (kg)',{exact:true})).toHaveValue('10.889');
 await dialog.getByLabel('Container type',{exact:true}).selectOption('1');
 await expect(dialog.getByRole('img',{name:'3D container load layout'})).toBeVisible();
 await expect(dialog.getByLabel('Gross weight / Pallet (kg)',{exact:true})).toHaveValue('455.554');
 expect(writes[0].Inputs.carton_kg).toBe(10.88885);
 expect(writes[0].Inputs.carton.length).toBe(100);
 await dialog.getByLabel('Loading mode',{exact:true}).selectOption('floor');
 await expect(dialog.getByLabel('Gross weight / Pallet (kg)',{exact:true})).toHaveCount(0);
});

test('restoring a container uses current saved-response gross rather than an old missing weight',async({page})=>{
 await setup(page);
 await page.route('**/api/load-planning/items/1',route=>route.fulfill({json:{rows:[{ID:7,ContainerID:1,Code:'20DC',Inputs:{...inputs,carton_kg:null},Result:result}]}}));
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true});
 await dialog.getByLabel('Container type',{exact:true}).selectOption('1');
 await expect(dialog.getByLabel('Carton gross weight (kg)',{exact:true})).toHaveValue('3.1');
});

test('unknown saved gross weight is explained instead of silently blank',async({page})=>{
 await setup(page);
 await page.route('**/api/load-planning/items/1/weights',route=>route.fulfill({json:{CartonGrossWeightKG:null}}));
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true});
 await expect(dialog.getByRole('status')).toContainText('Carton gross weight is unavailable');
 await expect(dialog.getByLabel('Container type',{exact:true}).locator('option[value="1"]')).toHaveCount(1);
 await expect(dialog.getByText('Weight options',{exact:true})).toHaveCount(0);
 await expect(dialog.getByLabel('Carton gross weight (kg)',{exact:true})).toHaveAttribute('readonly','');
 await dialog.getByLabel('Container type',{exact:true}).selectOption('1');
 await expect(dialog.getByRole('button',{name:'Calculate & view',exact:true})).toHaveCount(0);
});

test('removed pallet lookup is not requested by the viewer',async({page})=>{
 await setup(page);let palletLookupCalled=false;
 await page.route('**/api/load-planning/pallet-prices',route=>{palletLookupCalled=true;return route.fulfill({status:500,json:{detail:'Pallet price lookup unavailable'}})});
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true});
 await expect(dialog.getByLabel('Container type',{exact:true}).locator('option[value="1"]')).toHaveCount(1);
 await expect(dialog.getByLabel('Carton gross weight (kg)',{exact:true})).toHaveValue('3.1');
 expect(palletLookupCalled).toBe(false);
});

test('weight failure leaves container selection available and explains missing carton gross',async({page})=>{
 await setup(page);
 await page.route('**/api/load-planning/items/1/weights',route=>route.fulfill({status:422,json:{detail:'Child packaging tare is missing'}}));
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true});
 await expect(dialog.getByLabel('Container type',{exact:true}).locator('option[value="1"]')).toHaveCount(1);
 await expect(dialog).toContainText('Child packaging tare is missing');
});

test('compact container-only view has icon controls, payload and no desktop vertical scrolling',async({page},info)=>{
 await setup(page);await page.setViewportSize({width:1366,height:768});
 await expect(page.getByRole('button',{name:'3D palletization',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true});
 await expect(dialog.getByRole('option',{name:'Pallet loaded',exact:true})).toHaveCount(1);
 await dialog.getByLabel('Container type',{exact:true}).selectOption('1');
 await expect(dialog.getByRole('img',{name:'3D container load layout'})).toBeVisible();
 await expect(dialog).toContainText('Maximum container payload');
 for(const label of ['Zoom in','Zoom out','Top view','Reset view']){const button=dialog.getByRole('button',{name:label,exact:true});await expect(button).toHaveText('');await expect(button.locator('svg')).toHaveCount(1)}
 expect(await dialog.evaluate(el=>el.scrollHeight<=el.clientHeight+2)).toBe(true);
 expect(await dialog.locator('.load-planner-preview').evaluate(el=>el.scrollHeight<=el.clientHeight+2)).toBe(true);
 await dialog.screenshot({path:info.outputPath('compact-container.png')});
});


test('Clear load plan is an icon inside 3D only and clears the response draft',async({page})=>{
 const plan={ID:7,ContainerID:1,Code:'20DC',Inputs:inputs,Result:result};
 const writes=await setup(page,[container],undefined,'Pallet load',{LoadPlanJSON:JSON.stringify(plan),ContainerPlansJSON:JSON.stringify({'20DC':plan})});
 const editor=page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
 await expect(editor).not.toContainText('Using saved 3D load plan');
 await expect(editor.getByRole('button',{name:'Clear load plan',exact:true})).toHaveCount(0);
 await editor.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true});
 const clear=dialog.getByRole('button',{name:'Clear load plan',exact:true});
 await expect(clear).toHaveAttribute('title','Clear load plan');
 await expect(clear).toHaveText('');
 await expect(clear.locator('svg')).toHaveCount(1);
 await clear.click();
 await expect(dialog).toHaveCount(0);
 expect(writes.some(w=>w.rows)).toBe(false);
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes.find(w=>w.rows).rows[0].LoadPlanID).toBeNull();
});

test('3D exposes clear after automatic capture',async({page})=>{
 await setup(page);
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'3D load planner',exact:true}).getByRole('button',{name:'Clear load plan',exact:true})).toBeVisible();
});

test('automatic previews compare all containers with bounded calls and reuse results when switching views',async({page},info)=>{
 const available=['20DC','40DC','40HC','20RC','40RHC'].map((Code,i)=>({...container,ID:i+1,Code}));
 await setup(page,available);await page.setViewportSize({width:1366,height:768});
 let active=0,maxActive=0;const calls:number[]=[];
 await page.route('**/api/load-planning/items/1/preview',async route=>{
  const body=route.request().postDataJSON();calls.push(body.ContainerID);active++;maxActive=Math.max(maxActive,active);
  await new Promise(resolve=>setTimeout(resolve,30));
  await route.fulfill({json:{Inputs:body.Inputs,Result:{...result,loaded_units:body.ContainerID*2,cartons:body.ContainerID*50,gross_kg:body.ContainerID*123.456,volume_percent:body.ContainerID*5}}});
  active--;
 });
 const posts:string[]=[];page.on('request',r=>{if(r.method()==='POST')posts.push(new URL(r.url()).pathname)});
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true}),table=dialog.getByRole('table',{name:'Container load summary'});
 await expect(table.getByRole('row')).toHaveCount(6);
 await expect(table.getByText('Calculating…',{exact:true})).toHaveCount(0);
 const row=table.getByRole('row').filter({has:page.getByRole('button',{name:'View 40HC',exact:true})});
 await expect(row.getByRole('cell')).toHaveText(['40HC','5,900 × 2,350 × 2,390','6','150','Unknown','370.368','28,000','15%']);
 expect(calls.sort()).toEqual([1,2,3,4,5]);expect(maxActive).toBeLessThanOrEqual(2);
 await table.getByRole('button',{name:'View 40HC',exact:true}).click();
 await expect(dialog.getByLabel('Container type',{exact:true})).toHaveValue('3');
 await expect(dialog.getByRole('img',{name:'3D container load layout'})).toBeVisible();
 expect(calls).toHaveLength(5);
 expect(posts.every(p=>p.endsWith('/preview')||p.endsWith('/save'))).toBe(true);
 await expect(dialog.getByRole('button',{name:'Calculate & view',exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('checkbox',{name:'Allow 90° rotation'})).toHaveCount(0);
 expect(await dialog.evaluate(el=>el.scrollHeight<=el.clientHeight+2)).toBe(true);
 expect(await dialog.locator('.load-planner-preview').evaluate(el=>el.scrollHeight<=el.clientHeight+2)).toBe(true);
 await dialog.screenshot({path:info.outputPath('automatic-container-summary.png')});
});

test('one failed container does not hide other results and can be retried',async({page})=>{
 await setup(page,[container,{...container,ID:2,Code:'40HC'}]);let failed=false;
 await page.route('**/api/load-planning/items/1/preview',route=>{
  const body=route.request().postDataJSON();
  if(body.ContainerID===2&&!failed){failed=true;return route.fulfill({status:422,json:{detail:'Container temporarily unavailable'}})}
  return route.fulfill({json:{Inputs:body.Inputs,Result:result}});
 });
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true}),table=dialog.getByRole('table',{name:'Container load summary'});
 await expect(dialog.getByRole('img',{name:'3D container load layout'})).toBeVisible();
 await expect(table.getByRole('button',{name:'Retry 40HC',exact:true})).toBeVisible();
 await table.getByRole('button',{name:'View 40HC',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'Preview confirm',exact:true})).toHaveCount(0);
 await table.getByRole('button',{name:'Retry 40HC',exact:true}).click();
 await expect(table.getByRole('button',{name:'Retry 40HC',exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('img',{name:'3D container load layout'})).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Preview confirm',exact:true})).toHaveCount(0);
});

test('late results from the previous mode cannot replace the selected mode',async({page})=>{
 await setup(page,[container],undefined,'Both');
 let releaseFloor:(()=>void)|undefined;
 await page.route('**/api/load-planning/items/1/preview',async route=>{
  const body=route.request().postDataJSON();
  if(body.Inputs.mode==='floor')await new Promise<void>(resolve=>{releaseFloor=resolve});
  await route.fulfill({json:{Inputs:body.Inputs,Result:{...result,cartons:body.Inputs.mode==='floor'?100:550}}});
 });
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true}),table=dialog.getByRole('table',{name:'Container load summary'});
 await expect.poll(()=>!!releaseFloor).toBe(true);
 await dialog.getByLabel('Loading mode',{exact:true}).selectOption('pallet');
 await expect(table).toContainText('550');
 releaseFloor!();
 await expect(dialog.getByLabel('Loading mode',{exact:true})).toHaveValue('pallet');
 await expect(table).toContainText('550');
 await expect(table).not.toContainText('100');
});

test('3D shows only read-only pallet gross, carton count and loaded dimensions',async({page})=>{
 await setup(page);
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true});
 await expect(dialog.getByLabel('Gross weight / Pallet (kg)',{exact:true})).toHaveValue('97.5');
 await expect(dialog.getByLabel('Cartons / Pallet',{exact:true})).toHaveValue('25');
 await expect(dialog.getByLabel('Loaded pallet dimension (mm)',{exact:true})).toHaveValue('1,200 × 800 × 1,140');
 for(const name of ['Gross weight / Pallet (kg)','Cartons / Pallet','Loaded pallet dimension (mm)'])await expect(dialog.getByLabel(name,{exact:true})).toHaveAttribute('readonly','');
 for(const name of ['Cartons / layer','Packaging material / price','Pallet tare weight (kg)','Maximum loaded pallet height (mm)','Pallet maximum goods weight (kg)'])await expect(dialog.getByLabel(name,{exact:true})).toHaveCount(0);
 await expect(dialog.getByText('Weight options',{exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('checkbox',{name:'Double stack',exact:true})).toHaveCount(0);
});

test('Cartons per layer stays editable in response after confirmation and saves only there',async({page})=>{
 const plan={ID:7,ContainerID:1,Code:'20DC',Inputs:inputs,Result:result};
 const writes=await setup(page,[container],undefined,'Pallet load',{LoadPlanJSON:JSON.stringify(plan),ContainerPlansJSON:JSON.stringify({'20DC':plan})});
 const editor=page.getByRole('dialog',{name:'Edit Packaging request',exact:true}),count=editor.getByLabel('Cartons / layer',{exact:true});
 await expect(count).toHaveValue('5');
 await expect(count).toBeEditable();
 const palletSection=editor.getByRole('region',{name:'Palletization response',exact:true});
 await expect(palletSection).not.toContainText('Pallet price:');
 await expect(palletSection).not.toContainText('Saved 3D load plan');
 await count.fill('6');
 await expect(editor.getByText('Saved 3D load plan · 40 cartons / pallet',{exact:true})).toHaveCount(0);
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 const saved=writes.find(w=>w.rows).rows[0];
 expect(saved.CartonsPerLayer).toBe('6');
 expect(saved.LoadPlanID).toBeNull();
});

test('viewed container captures automatically and normal response save persists it',async({page})=>{
 const writes=await setup(page);
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true});
 await expect(dialog.getByRole('button',{name:'Preview confirm',exact:true})).toHaveCount(0);
 await expect.poll(()=>writes.filter(w=>w.ItemRowVersion).length).toBe(1);
 await expect(dialog).toBeVisible();
 await dialog.getByRole('button',{name:'Close',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
 await expect(editor.getByLabel('Container type',{exact:true})).toHaveValue('20DC');
 expect(writes.some(w=>w.rows)).toBe(false);
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 const saved=writes.find(w=>w.rows).rows[0];
 expect(saved.LoadPlanID).toBe(7);
 expect(saved.ContainerLoadPlanIDs).toEqual({'1':7});
});

test('only viewed containers are captured and revisiting a row reuses its snapshot',async({page})=>{
 const writes=await setup(page,[container,{...container,ID:2,Code:'40HC'},{...container,ID:3,Code:'20RC'}]);
 const captured:number[]=[];
 await page.route('**/api/load-planning/items/1/save',route=>{
  const body=route.request().postDataJSON();captured.push(body.ContainerID);
  return route.fulfill({json:{ID:100+body.ContainerID,Inputs:body.Inputs,Result:result}});
 });
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true});
 await expect.poll(()=>captured).toEqual([1]);
 await expect(dialog.getByRole('table',{name:'Container load summary'})).not.toContainText('Calculating');
 await dialog.getByRole('button',{name:'View 40HC',exact:true}).click();
 await expect.poll(()=>captured).toEqual([1,2]);
 await dialog.getByRole('button',{name:'View 20DC',exact:true}).click();
 await expect(dialog.getByLabel('Container type',{exact:true})).toHaveValue('1');
 await dialog.getByRole('button',{name:'Close',exact:true}).click();
 expect(captured).toEqual([1,2]);expect(writes.some(w=>w.rows)).toBe(false);
 const editor=page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 const saved=writes.find(w=>w.rows).rows[0];
 expect(saved.LoadPlanID).toBe(101);expect(saved.ContainerLoadPlanIDs).toEqual({'1':101,'2':102});
});

test('failed automatic capture keeps the viewer open and does not save the response',async({page})=>{
 const writes=await setup(page);
 await page.route('**/api/load-planning/items/1/save',route=>route.fulfill({status:409,json:{detail:'Response changed. Refresh before capturing.'}}));
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true});
 await expect(dialog.getByRole('alert')).toContainText('Response changed');
 await expect(dialog).toBeVisible();
 expect(writes.some(w=>w.rows)).toBe(false);
 await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Edit Packaging request',exact:true}).getByLabel('Container type',{exact:true})).toHaveValue('');
});

test('Both requirement captures viewed previews without persisting the response',async({page})=>{
 const writes=await setup(page,[container,{...container,ID:2,Code:'40HC',SizeFT:40}],undefined,'Both');
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true});
 await dialog.getByLabel('Loading mode',{exact:true}).selectOption('pallet');
 await expect(dialog.getByLabel('Loading mode',{exact:true})).toBeEnabled();
 await dialog.getByLabel('Container type',{exact:true}).selectOption('1');
 await expect(dialog.getByRole('img',{name:'3D container load layout'})).toBeVisible();
 await dialog.getByLabel('Container type',{exact:true}).selectOption('2');
 await dialog.getByLabel('Loading mode',{exact:true}).selectOption('floor');
 await expect(dialog.getByRole('img',{name:'3D container load layout'})).toBeVisible();
 await dialog.getByLabel('Container type',{exact:true}).selectOption('1');
 await expect(dialog.getByLabel('Loading mode',{exact:true})).toHaveValue('floor');
 await expect(dialog.getByRole('img',{name:'3D container load layout'})).toBeVisible();
 await dialog.getByRole('button',{name:'Close',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
 await expect(editor.getByLabel('Container type',{exact:true})).toHaveValue('20DC');
 expect(writes.every(w=>w.Inputs)).toBe(true);
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 await expect(dialog.getByLabel('Container type',{exact:true})).toHaveValue('1');
 await expect(dialog.getByRole('img',{name:'3D container load layout'})).toBeVisible();
});
for(const [requirement,mode] of [['Pallet load','pallet'],['Floor load','floor']])test('viewer locks loading mode to '+requirement,async({page})=>{
 const writes=await setup(page,[container],undefined,requirement);
 // An old incompatible setup must never override the requirement.
 await page.route('**/api/load-planning/items/1',route=>route.fulfill({json:{rows:[{ID:7,ContainerID:1,Code:'20DC',Inputs:{...inputs,mode:mode==='pallet'?'floor':'pallet'},Result:result}]}}));
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true});
 await expect(dialog.getByLabel('Loading mode',{exact:true})).toHaveValue(mode);
 await expect(dialog.getByLabel('Loading mode',{exact:true})).toBeDisabled();
 await expect(dialog.getByLabel('Loading mode',{exact:true}).locator('option')).toHaveCount(1);
 await expect(dialog.getByText(/Saved container setups/)).toHaveCount(0);
 await dialog.getByLabel('Container type',{exact:true}).selectOption('1');
 await expect(dialog.getByRole('img',{name:'3D container load layout'})).toBeVisible();
 expect(writes[0].Inputs.mode).toBe(mode);
 await expect(dialog.getByRole('button',{name:/Save|Apply/i})).toHaveCount(0);
});

test('container master is absent for non-Admin even with an edit grant',async({page})=>{
 await setup(page,[container],{username:'Member',user_id:1,is_admin:false,scopes:['Packaging'],permissions:{requests:'edit',containers:'edit'}});
 await expect(page.getByRole('button',{name:'Container Type Master',exact:true})).toHaveCount(0);
});

test('changing mode automatically refreshes preview and mobile view stays within viewport',async({page})=>{
 const writes=await setup(page,[container],undefined,'Both');
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner'});
 await expect(dialog.getByRole('img',{name:'3D container load layout'})).toBeVisible();
 await expect(dialog.getByLabel('carton length',{exact:true})).toHaveAttribute('readonly','');
 await dialog.getByLabel('Loading mode',{exact:true}).selectOption('pallet');
 await expect.poll(()=>writes.some(w=>w.Inputs?.mode==='pallet')).toBe(true);
 await expect(dialog.getByRole('img',{name:'3D container load layout'})).toBeVisible();
 await page.setViewportSize({width:390,height:844});
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+2)).toBe(true);
 await dialog.getByRole('button',{name:'Close load planner'}).click();
 await expect(page.getByRole('dialog',{name:'Edit Packaging request',exact:true})).toBeVisible();
});

test('container master opens from sidebar with add next to ID',async({page})=>{
 await setup(page);
 await page.getByRole('dialog',{name:'Edit Packaging request',exact:true}).press('Escape');
 await page.getByRole('button',{name:'Container Type Master',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Container Type Master'})).toBeVisible();
 await page.getByRole('button',{name:'Add container',exact:true}).click();
 const form=page.getByRole('dialog',{name:'Container type',exact:true});
 await expect(form.getByLabel('Internal length (mm)',{exact:true})).toBeVisible();
 await form.getByRole('button',{name:'Close container'}).click();
});


test('packing preview distinguishes proven layer maximum from overall 3D optimality',async({page})=>{
 await setup(page);
 await page.route('**/api/load-planning/items/1/*',route=>{
  if(route.request().method()!=='POST')return route.fallback();
  return route.fulfill({json:{ID:7,Inputs:route.request().postDataJSON().Inputs,Result:{...result,pallet_layer_capacity:20,pallet_layer_upper_bound:20,pallet_layout_optimal:true,container_layer_capacity:11,container_layer_upper_bound:11,container_layout_optimal:true}}});
 });
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true});
 await expect(dialog.getByText(/Pallet layer: verified maximum 20 cartons/)).toBeVisible();
 await expect(dialog.getByText(/Overall 3D maximum is not guaranteed/)).toBeVisible();
 await expect(dialog.getByText(/Container floor: verified maximum 11 positions/)).toBeVisible();
});


test('Packaging Manager can open review details without editing or saving',async({page})=>{
 const writes=await setup(page,undefined,{username:'Manager',user_id:2,is_admin:false,scopes:['PackagingManager'],permissions:{requests:'edit'}},'Pallet load',{ItemStage:'Pending Review',FirstPMType:'Box',FirstPMMOQ:1000});
 await page.route('**/api/packaging/items/1/pricing/history',route=>route.fulfill({json:{snapshots:[{header:{ID:10,PackagingOrder:'Primary',PackagingTypeName:'Box',IsCurrent:true,UnitPrice:'12',FinalMOQ:'1000',CurrencyCode:'VND'},components:[{MaterialCode:'PKG-SAVED',MaterialName:'Saved liner',Quantity:'2',ProductMOQ:'1000',ProductUnitPrice:'12',CurrencyCode:'VND'}]}]}}));
 const editor=page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
 await expect(editor.getByRole('button',{name:'3D container load',exact:true})).toBeEnabled();
 await expect(editor.getByRole('button',{name:'Pallet Pricing Calculator',exact:true})).toBeEnabled();
 await expect(editor.getByRole('button',{name:'Primary Pricing Calculator',exact:true})).toBeEnabled();
 await expect(editor.getByLabel('Applicable Net weight (g)',{exact:true})).toHaveAttribute('readonly','');
 await editor.getByRole('button',{name:'Primary Pricing Calculator',exact:true}).click();
 const pricing=page.getByRole('dialog',{name:'Saved packaging pricing',exact:true});
 await expect(pricing.getByText('PKG-SAVED — Saved liner',{exact:true})).toBeVisible();
 await expect(pricing.getByRole('button',{name:/Apply|Save/})).toHaveCount(0);
 await pricing.getByRole('button',{name:'Close saved pricing',exact:true}).click();
 await editor.getByRole('button',{name:'Pallet Pricing Calculator',exact:true}).click();
 const pallet=page.getByRole('dialog',{name:'Pallet Pricing Calculator',exact:true});
 await expect(pallet.getByText(/Saved pallet pricing/)).toBeVisible();
 await expect(pallet.getByRole('button',{name:'Apply pallet pricing',exact:true})).toHaveCount(0);
 await pallet.getByRole('button',{name:'Close',exact:true}).click();
 await editor.getByRole('button',{name:'3D container load',exact:true}).click();
 const planner=page.getByRole('dialog',{name:'3D load planner',exact:true});
 await expect(planner.getByRole('img',{name:'3D container load layout'})).toBeVisible();
 await planner.getByRole('button',{name:'Close',exact:true}).click();
 expect(writes).toHaveLength(1); // preview only, never save/capture
 await expect(editor.getByRole('button',{name:'Review & save',exact:true})).toBeDisabled();
});

test('container summary displays net kg separately from gross kg',async({page})=>{
 await setup(page);
 await page.route('**/api/load-planning/items/1/*',route=>{
  if(route.request().method()!=='POST')return route.fallback();
  return route.fulfill({json:{ID:7,Inputs:route.request().postDataJSON().Inputs,Result:{...result,net_kg:4800}}});
 });
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 const table=page.getByRole('table',{name:'Container load summary'});
 await expect(table.getByRole('columnheader',{name:'Net (kg)',exact:true})).toBeVisible();
 await expect(table.getByRole('cell',{name:'4,800',exact:true})).toBeVisible();
});

test('review container selection uses saved profiles without dirtying the response',async({page})=>{
 const saved=(Code:string,cartons:number)=>({ID:Code==='20DC'?1:2,Code,Inputs:inputs,Result:{...result,cartons}});
 const first=saved('20DC',2000),second=saved('40HC',4000);
 const writes=await setup(page,[container,{...container,ID:2,Code:'40HC'}],{username:'Manager',user_id:2,is_admin:false,scopes:['PackagingManager'],permissions:{requests:'display'}},'Pallet load',{
  ItemStage:'Pending Review',RequestedLayerCount:2,ResponseLayerCount:2,WeightGrams:400,ApplicableNetWeightGrams:400,UnitsPerCarton:6,
  SelectedContainerType:'20DC',LoadPlanJSON:JSON.stringify(first),ContainerPlansJSON:JSON.stringify({'20DC':first,'40HC':second})
 });
 const editor=page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
 await expect(editor.getByLabel('Net weight / Container (kg)',{exact:true})).toHaveValue('4,800');
 await editor.getByLabel('Container type',{exact:true}).selectOption('40HC');
 await expect(editor.getByLabel('Net weight / Container (kg)',{exact:true})).toHaveValue('9,600');
 await expect(editor.getByRole('button',{name:'Review & save',exact:true})).toBeDisabled();
 expect(writes).toHaveLength(0);
});

test('five container dimensions and totals fit desktop without scrollbars',async({page},info)=>{
 await setup(page,['20DC','20RC','40DC','40HC','40RHC'].map((Code,i)=>({...container,ID:i+1,Code})));
 await page.route('**/api/load-planning/items/1/*',route=>{
  if(route.request().method()!=='POST')return route.fallback();
  return route.fulfill({json:{ID:7,Inputs:route.request().postDataJSON().Inputs,Result:{...result,net_kg:4800,pallet_layer_capacity:20,pallet_layout_optimal:true,container_layer_capacity:10,container_layout_optimal:true,warnings:['Pallet load rating has not been verified.']}}});
 });
 await page.getByRole('button',{name:'3D container load',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'3D load planner',exact:true}),table=dialog.getByRole('table',{name:'Container load summary'});
 await expect(table.getByRole('cell',{name:'5,900 × 2,350 × 2,390',exact:true})).toHaveCount(5);
 await expect(table.getByText('Calculating…',{exact:true})).toHaveCount(0);
 for(const size of [{width:1366,height:768},{width:1280,height:720},{width:1920,height:1080}]){
  await page.setViewportSize(size);
  await dialog.screenshot({path:info.outputPath('layout-'+size.width+'.png')});
  for(const element of [dialog,dialog.locator('.load-planner-layout'),dialog.locator('.load-planner-preview'),dialog.locator('.load-planner-controls'),dialog.locator('.load-container-table')]){
   const measured=await element.evaluate(el=>({element:el.className,horizontal:el.scrollWidth-el.clientWidth,vertical:el.scrollHeight-el.clientHeight}));
   expect(measured.horizontal,JSON.stringify(size)).toBeLessThanOrEqual(2);
   expect(measured.vertical,JSON.stringify({size,measured})).toBeLessThanOrEqual(2);
  }
  const summary=await table.boundingBox(),close=await dialog.getByRole('button',{name:'Close',exact:true}).boundingBox();
  expect(summary!.y+summary!.height).toBeLessThanOrEqual(close!.y);
 }
 await dialog.screenshot({path:info.outputPath('container-dimensions-compact.png')});
});
