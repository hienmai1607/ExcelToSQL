import {test,expect,type Page} from '@playwright/test';

test('PCR-30293 saved mix dimensions survive 2 to 1 to 2 without saving',async({page})=>{
 const dimensions=(values:string[])=>values.map((Value,index)=>({Name:['Length','Width','Height'][index],Unit:'mm',Value}));
 const {editor,writes}=await setup(page,2,{RequestedLayerCount:1,IsMixParent:true,WeightGrams:750,ProductMixSnapshot:JSON.stringify(efficiencyMix),
  FirstPMType:'RSC',SecondPMType:'RSC',FirstPMMOQ:1000,SecondPMMOQ:1000,UnitsPerCarton:10,HeightMM:300,
  LayerDimensionCaptures:{Primary:{PackagingTypeName:'RSC',LayerCount:2,Dimensions:dimensions(['100','200','300'])},
   Secondary:{PackagingTypeName:'RSC',LayerCount:2,Dimensions:dimensions(['300','300','300'])}}
 },[{ID:2,PackagingType:'RSC',PackagingOrder:'Secondary',Shipping:true,Status:'Active'}]);
 const primary=editor.getByLabel('Primary captured dimensions',{exact:true}).locator('.captured-dimensions-value');
 const secondary=editor.getByLabel('Secondary captured dimensions',{exact:true}).locator('.captured-dimensions-value');
 await expect(primary).toHaveText('100mm × 200mm × 300mm');
 await expect(secondary).toHaveText('300mm × 300mm × 300mm');
 const layers=editor.getByLabel('Confirmed packaging layers',{exact:true});
 await layers.selectOption('1');
 await expect(primary).toHaveText('100mm × 200mm × 300mm');
 await layers.selectOption('2');
 await expect(primary).toHaveText('100mm × 200mm × 300mm');
 await expect(secondary).toHaveText('300mm × 300mm × 300mm');
 await expect(editor.getByLabel('No of Primary Mix Unit',{exact:true})).toHaveValue('10');
 expect(writes).toHaveLength(0);
});

test('request layer count is inline and response packing labels and symbols share their row',async({page},info)=>{
 const {editor}=await setup(page,2,{UnitsPerCarton:6,PrimaryPricePerUnit:'1828.125000003',PrimaryCurrencyCode:'VND',FirstPMMOQ:192000});
 const packing=editor.getByRole('region',{name:'Packing Way response',exact:true});
 const geometry=await packing.evaluate(section=>{
  const quantity=section.querySelector('.packing-way-layer>label')!.getBoundingClientRect();
  const weight=section.querySelector('.packing-layer-weight')!.getBoundingClientRect();
  const inputs=section.querySelectorAll('.packing-way-layer input');
  return {top:Math.abs(inputs[0].getBoundingClientRect().top-inputs[1].getBoundingClientRect().top),quantity:quantity.width,weight:weight.width};
 });
 expect(geometry.top).toBeLessThan(2);
 const primary=editor.getByRole('region',{name:'Primary packaging response',exact:true});
 const symbolAlignment=await primary.evaluate(section=>{
  const symbol=section.querySelector('h4')!.getBoundingClientRect(),price=section.querySelector('.response-price-field')!.parentElement!.getBoundingClientRect();
  return Math.abs(symbol.top-price.top);
 });
 expect(symbolAlignment).toBeLessThan(2);
 await primary.screenshot({path:info.outputPath('response-price-aligned.png')});
 await editor.getByText('Packaging request',{exact:true}).click();
 const request=editor.locator('.request-layer-choice');
 const inline=await request.evaluate(section=>{
  const label=section.querySelector('.field-label')!.getBoundingClientRect(),value=section.querySelector('p')!.getBoundingClientRect();
  return Math.abs(label.top+label.height/2-value.top-value.height/2);
 });
 expect(inline).toBeLessThan(2);
 const requestPrimary=editor.getByRole('region',{name:'Primary packaging requirements',exact:true});
 expect(await requestPrimary.evaluate(section=>Math.abs(section.querySelector('h4')!.getBoundingClientRect().top-section.querySelector('.layer-packing-way .field-label')!.getBoundingClientRect().top))).toBeLessThan(2);
 await requestPrimary.screenshot({path:info.outputPath('request-symbol-aligned.png')});
});

test('mix response slots exclude Primary-only master types and save cross-order packaging',async({page})=>{
 const types=[
  {ID:11,PackagingOrder:'Primary',PackagingType:'Pouch',Shipping:false},
  {ID:12,PackagingOrder:'Secondary',PackagingOrders:['Secondary','Primary Mix','Secondary Mix'],PackagingType:'Tray',Shipping:false},
  {ID:13,PackagingOrder:'Tertiary',PackagingOrders:['Tertiary','Primary Mix','Secondary Mix','Tertiary Mix'],PackagingType:'Shipping case',Shipping:true}
 ].map(t=>({...t,ParentTypeID:null,Status:'Active'}));
 const {editor,writes}=await setup(page,3,{IsMixParent:true},types);
 for(const layer of ['Primary','Secondary'])await expect(editor.getByLabel(layer+' Type',{exact:true}).locator('option')).toHaveText(['Choose '+layer.toLowerCase()+' type','Tray','Shipping case']);
 await expect(editor.getByLabel('Tertiary Type',{exact:true}).locator('option')).toHaveText(['Choose tertiary type','Shipping case']);
 await editor.getByLabel('Primary Type',{exact:true}).selectOption('Tray');
 await expect(editor.getByRole('button',{name:'Primary Pricing Calculator',exact:true})).toBeEnabled();
 await editor.getByLabel('Secondary Type',{exact:true}).selectOption('Shipping case');
 await editor.getByLabel('Tertiary Type',{exact:true}).selectOption('Shipping case');
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 expect(writes[0].rows[0]).toMatchObject({FirstPMType:'Tray',SecondPMType:'Shipping case',ThirdPMType:'Shipping case'});
});

test('mix child response hides parent shipping controls and excludes them from saves',async({page})=>{
 const {editor,writes}=await setup(page,2,{ParentItemID:90,ConfigurationRequest:'Both',ContainerRequest:'Dry',ResponsePalletSize:'3000x2000mm',ResponseMaxPalletHeightMM:1900,CartonsPerLayer:10,SelectedContainerType:'20DC',ContainerLoadProfiles:{'20DC':{PalletsPerContainer:10}},CartonsPerContainerFloor:100});
 for(const name of ['Palletization response','Efficiency response','Pallet load response','Floor load response'])await expect(editor.getByRole('region',{name,exact:true})).toHaveCount(0);
 await expect(editor.getByLabel('Shipping height (mm)',{exact:true})).toHaveCount(0);
 await editor.getByLabel('No of Primary Unit',{exact:true}).fill('12');
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 expect(writes[0].rows[0].UnitsPerCarton).toBe('12');
 for(const key of ['ResponsePalletSize','ResponsePalletStacking','ResponseMaxPalletHeightMM','HeightMM','CartonsPerLayer','SelectedContainerType','ContainerLoadProfiles','CartonsPerContainerFloor'])expect(writes[0].rows[0]).not.toHaveProperty(key);
});

test('mix response uses captured Product structure and mix unit labels',async({page})=>{
 const mix={MixVersionID:7,items:[{ProductID:2,ProductCode:'PRD-A',ProductName:'Almonds',UnitQuantity:'2',WeightGrams:'150',ProductGradeSnapshot:{items:[]}}]};
 const {editor}=await setup(page,2,{ProductMixSnapshot:JSON.stringify(mix)});
 await expect(editor.getByLabel('No of Primary Mix Unit',{exact:true})).toBeVisible();
 await expect(editor.getByRole('region',{name:'Packing Way response',exact:true}).getByText('No of Secondary Mix',{exact:true})).toBeVisible();
 await editor.getByRole('button',{name:'View grade snapshot',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Product structure',exact:true});
 await expect(dialog.getByRole('cell',{name:'PRD-A · Almonds',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Close product structure',exact:true}).click();
 await expect(editor).toBeVisible();
});
import {responseEfficiency,mixTotals,mixVolumeDisplay} from '../src/response-efficiency';
import {fieldPayload,webResponseFields} from '../src/packaging-fields';

const efficiencyMix={MixVersionID:7,items:[
 {ProductID:2,ProductCode:'PRD-A',ProductName:'Almonds 150g',UnitQuantity:'2',WeightGrams:'150'},
 {ProductID:3,ProductCode:'PRD-B',ProductName:'Almonds 450g',UnitQuantity:'1',WeightGrams:'450'}
]};
const efficiencyChildren=[{ItemID:2,ProductID:2,NutDensity:'.6'},{ItemID:3,ProductID:3,NutDensity:'.9'}];

test('mix efficiency sums child consumption exactly and never requires a parent density',()=>{
 const totals=mixTotals(JSON.stringify(efficiencyMix),JSON.stringify(efficiencyChildren));
 expect(mixVolumeDisplay(totals)).toBe('1,000');
 const values={ResponseLayerCount:'3',UnitsPerCarton:'12',UnitsPerTertiary:'5',NutDensity:'999'};
 expect(responseEfficiency(750,values,{VolumeM3:'.002'},null,totals)).toMatchObject({carton:'375',relative:'50.00'});
 expect(responseEfficiency(750,values,{VolumeM3:'.003'},null,totals)).toMatchObject({carton:'250',relative:'33.33'});
 const missing=mixTotals(efficiencyMix,efficiencyChildren.slice(0,1));
 expect(mixVolumeDisplay(missing)).toBe('');
 expect(responseEfficiency(750,values,{VolumeM3:'.002'},null,missing)).toMatchObject({carton:'375',relative:''});
 expect(fieldPayload(values,webResponseFields,undefined,false,true)).not.toHaveProperty('NutDensity');
 expect(fieldPayload(values,webResponseFields,undefined,true,false)).toHaveProperty('NutDensity','999');
 const fractions=mixTotals({items:[{ProductID:1,UnitQuantity:1,WeightGrams:1},{ProductID:2,UnitQuantity:1,WeightGrams:1}]},[{ProductID:1,NutDensity:3},{ProductID:2,NutDensity:3}]);
 expect(mixVolumeDisplay(fractions)).toBe('0.666667');
});

for(const layers of [1,3])test('mix parent volume and efficiency use off-page children for '+layers+' layers',async({page})=>{
 const {editor,writes}=await setup(page,layers,{
  IsMixParent:true,WeightGrams:750,NutDensity:999,ProductMixSnapshot:JSON.stringify(efficiencyMix),
  MixResponseChildren:JSON.stringify(efficiencyChildren),UnitsPerCarton:12,UnitsPerTertiary:5,
  FirstPMType:'RSC',SecondPMType:'RSC',ThirdPMType:'RSC',HeightMM:100,
  EfficiencyLayerCount:layers,EfficiencyTypeName:'RSC',FinalLayerVolumeM3:'.002'
 },[{ID:2,PackagingType:'RSC',PackagingOrder:'Secondary',Shipping:true,Status:'Active'}]);
 await expect(editor.getByLabel('Nut Density (g/ml)',{exact:true})).toHaveCount(0);
 await expect(editor.getByLabel('Total Used volume (ml)',{exact:true})).toHaveValue('1,000');
 await expect(editor.getByLabel('Mix Carton Efficiency (kg/m3)',{exact:true})).toHaveValue('375');
 await expect(editor.getByLabel('Relative mix carton efficiency %',{exact:true})).toHaveValue('50.00');
 await expect(editor.getByLabel('Used volume (ml)',{exact:true})).toHaveCount(0);
 await editor.getByLabel('Cartons / layer',{exact:true}).fill('10');
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 for(const key of ['NutDensity','UsedVolumeML','MixNetWeightGrams','CartonEfficiencyKGM3','RelativeCartonEfficiencyPct'])expect(writes[0].rows[0]).not.toHaveProperty(key);
 await expect(editor.getByLabel('Total Used volume (ml)',{exact:true})).toHaveValue('1,000');
});

test('editing a mix child density updates the parent total and persists after reload',async({page})=>{
 const {editor,writes}=await setup(page,1,{IsMixParent:true,WeightGrams:750,
  ProductMixSnapshot:JSON.stringify(efficiencyMix),MixResponseChildren:JSON.stringify(efficiencyChildren),
  FirstPMType:'RSC',EfficiencyLayerCount:1,EfficiencyTypeName:'RSC',FinalLayerVolumeM3:'.002'},[],[
  {RequestID:1,ItemID:2,ParentItemID:99,ProductCode:'PRD-A',ProductName:'Almonds 150g',WeightGrams:150,
   ItemStage:'Assigned',PIC:'Admin',ItemRowVersion:'AAAAAAAAAAE=',ResponseLayerCount:1,NutDensity:'0.6'},
  {RequestID:1,ItemID:3,ParentItemID:99,ProductCode:'PRD-B',ProductName:'Almonds 450g',WeightGrams:450,
   ItemStage:'Assigned',PIC:'Admin',ItemRowVersion:'AAAAAAAAAAE=',ResponseLayerCount:1,NutDensity:'0.9'}
 ]);
 const firstChild=editor.getByRole('region',{name:'Request item 2',exact:true});
 const density=firstChild.getByLabel('Nut Density (g/ml)',{exact:true});
 await density.fill('0.3');
 await expect(editor.getByLabel('Total Used volume (ml)',{exact:true})).toHaveValue('1,500');
 await expect(editor.getByLabel('Relative mix carton efficiency %',{exact:true})).toHaveValue('75.00');
 await expect(editor.getByLabel('Mix Carton Efficiency (kg/m3)',{exact:true})).toHaveValue('375');
 await expect(firstChild.getByLabel('Used volume (ml)',{exact:true})).toHaveValue('500');
 await density.fill('0');
 await expect(editor.getByLabel('Total Used volume (ml)',{exact:true})).toHaveValue('');
 await expect(editor.getByLabel('Relative mix carton efficiency %',{exact:true})).toHaveValue('');
 await density.fill('0.3');
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 expect(writes[0].rows[0]).toMatchObject({ID:2,NutDensity:'0.3'});
 await expect(editor.getByLabel('Total Used volume (ml)',{exact:true})).toHaveValue('1,500');
 await expect(editor.getByLabel('Relative mix carton efficiency %',{exact:true})).toHaveValue('75.00');
});

test('mix missing child density keeps volume and relative blank, not a partial total',async({page})=>{
 const {editor}=await setup(page,1,{IsMixParent:true,WeightGrams:750,
  ProductMixSnapshot:JSON.stringify(efficiencyMix),MixResponseChildren:JSON.stringify(efficiencyChildren.slice(0,1)),
  FirstPMType:'RSC',EfficiencyLayerCount:1,EfficiencyTypeName:'RSC',FinalLayerVolumeM3:'.002'});
 await expect(editor.getByLabel('Total Used volume (ml)',{exact:true})).toHaveValue('');
 await expect(editor.getByLabel('Total Used volume (ml)',{exact:true})).toHaveAttribute('placeholder','Awaiting child densities');
 await expect(editor.getByLabel('Relative mix carton efficiency %',{exact:true})).toHaveValue('');
 await expect(editor.getByLabel('Mix Carton Efficiency (kg/m3)',{exact:true})).toHaveValue('375');
});


test('packaging type gets priority and currency stays beside the numeric price',async({page},info)=>{
 const {editor}=await setup(page,3,{FirstPMType:'Glass jar - Formed',SecondPMType:'Short Folding tray + Partition',ThirdPMType:'Inner+Outer Tray',
  PrimaryPricePerUnit:'21140',PrimaryPriceCurrencyCode:'VND',SecondaryPricePerUnit:'5000',SecondaryPriceCurrencyCode:'VND',TertiaryPricePerUnit:'16000',TertiaryPriceCurrencyCode:'VND'});
 for(const width of [1920,1366,390]){
  await page.setViewportSize({width,height:width===390?844:1080});
  for(const layer of ['Primary','Secondary','Tertiary']){
   const section=editor.getByRole('region',{name:layer+' packaging response',exact:true});
   await expect(section.locator('.response-price-currency')).toHaveText('VND');
   expect(await section.locator('.packaging-entry-grid>label').evaluateAll(labels=>labels.map(label=>label.firstChild?.textContent))).toEqual([layer+' Type','MOQ Unit','Price per Unit']);
   const geometry=await section.evaluate(section=>{
    const labels=Array.from(section.querySelectorAll('.packaging-entry-grid>label'));
    const [type,moq,price]=labels.map(el=>el.getBoundingClientRect());
    const input=section.querySelector('.response-price-field input') as HTMLInputElement;
    const currency=section.querySelector('.response-price-currency')!.getBoundingClientRect();
    const s=getComputedStyle(input),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')!;
    ctx.font=s.fontWeight+" "+s.fontSize+" "+s.fontFamily;
    const numberRight=input.getBoundingClientRect().left+ctx.measureText(input.value).width;
    return {type:type.width,moq:moq.width,price:price.width,gap:currency.left-numberRight,
     overflow:section.scrollWidth>section.clientWidth+1};
   });
   expect(geometry.type).toBeGreaterThan(geometry.moq);
   expect(geometry.type).toBeGreaterThan(geometry.price);
   expect(geometry.gap,JSON.stringify({width,layer,geometry})).toBeGreaterThanOrEqual(0);
   expect(geometry.gap).toBeLessThan(14);
   expect(geometry.overflow).toBe(false);
  }
  await editor.locator('.packaging-layer-sections').screenshot({path:info.outputPath('type-price-'+width+'.png')});
 }
});

async function setup(page:Page,layers=3,overrides:Record<string,unknown>={},packagingTypes:unknown[]=[],childRows:Record<string,unknown>[]=[]){
 const writes:any[]=[];
 let row:any={RequestID:1,ItemID:1,ProductCode:'PRD-1',ProductName:'Nut product',ItemDescription:'Item 1',ItemStage:'Assigned',PIC:'Admin',PICUserID:1,ItemRowVersion:'AAAAAAAAAAE=',WeightGrams:'10.00',RequestedLayerCount:2,ResponseLayerCount:layers,...overrides};
 await page.route('**/api/**',route=>{
  const p=new URL(route.request().url()).pathname;
  if(p.endsWith('/session'))return route.fulfill({json:{username:'Admin',user_id:1,is_admin:true,scopes:['Admin']}});
  if(p.endsWith('/preferences'))return route.fulfill({json:{settings:{columns:['CustomerName'],filters:[],sort:[],page_size:25},version:0}});
  if(p==='/api/workbench/requests')return route.fulfill({json:{rows:[{RequestID:1,RequestNumber:'PCR-1',CustomerName:'Customer',OpportunityNumber:'OPP-1',RequestStatus:'Open',ItemCount:1}],total:1}});
  if(p==='/api/packaging/requests')return route.fulfill({json:{rows:[row,...childRows],total:1+childRows.length,page:1}});
  if(p==='/api/packaging/lookups')return route.fulfill({json:{currencies:[],packagingTypes,pallets:[{ID:1,PalletSize:'3000x2000mm',PalletAreaMM2:'6000000'},{ID:2,PalletSize:'1000x1000mm',PalletAreaMM2:'1000000'}]}});
  if(p==='/api/pallet-pricing/pallets')return route.fulfill({json:{rows:[{ID:1,PalletSize:'3000x2000mm',MaterialName:'Large pallet'},{ID:2,PalletSize:'1000x1000mm',MaterialName:'Small pallet'}]}});
  if(p==='/api/workbench/pics')return route.fulfill({json:{rows:[{ID:1,UserName:'Admin'}]}});
  if(p==='/api/packaging/response/batch'){const data=route.request().postDataJSON();writes.push(data);const saved=data.rows[0];if(saved.ID===row.ItemID){row={...row,...saved};const n=Number(row.ResponseLayerCount);if(n<2)row.UnitsPerCarton=null;if(n<3)row.UnitsPerTertiary=null}else{const index=childRows.findIndex(child=>child.ItemID===saved.ID);if(index>=0){childRows[index]={...childRows[index],...saved};row.MixResponseChildren=JSON.stringify(JSON.parse(row.MixResponseChildren).map((child:any)=>child.ItemID===saved.ID?{...child,NutDensity:saved.NutDensity}:child))}}return route.fulfill({json:{results:[{RowNum:1,Status:'OK',NewRowVersion:'AAAAAAAAAAI='}]}})}
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Requests',exact:true}).click();
 await page.getByRole('button',{name:'Edit request PCR-1',exact:true}).click();
 return {writes,editor:page.getByRole('dialog',{name:'Edit Packaging request',exact:true})};
}

for(const layers of [1,2,3])test('Shipping height is hidden but preserved for '+layers+' layers',async({page})=>{
 const {editor}=await setup(page,layers,{HeightMM:250,UnitsPerCarton:12,UnitsPerTertiary:5,ResponseMaxPalletHeightMM:1900});
 const packing=editor.getByRole('region',{name:'Packing Way response',exact:true});
 await expect(packing.getByLabel('Shipping height (mm)',{exact:true})).toBeHidden();
 await expect(packing.getByLabel('Shipping height (mm)',{exact:true})).toHaveValue('250');
 await expect(editor.getByLabel('Layers / pallet',{exact:true})).toHaveValue('7');
 const sections=editor.locator('.packaging-layer-sections>section');
 for(let i=0;i<layers;i++)await expect(sections.nth(i).getByRole('heading')).toHaveText(['I','II','III'][i]);
});

for(const layers of [1,2,3])test('layer typography and dividers stay consistent for '+layers+' layers',async({page},info)=>{
 const {editor}=await setup(page,layers,{HeightMM:250,UnitsPerCarton:12,UnitsPerTertiary:5});
 const packing=editor.getByRole('region',{name:'Packing Way response',exact:true});
 for(const width of [1920,390])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:width===1920?1080:844});
  await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);
  const reference=await packing.locator('.packing-layer-weight input').first().evaluate(el=>{
   const s=getComputedStyle(el);return {fontFamily:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeight,color:s.color};
  });
  for(const card of await packing.locator('.packing-way-layer').all()){
   const labels=await card.locator('label').evaluateAll(els=>els.slice(0,2).map(el=>{
    const s=getComputedStyle(el);return {fontFamily:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeight,color:s.color};
   }));
   expect(labels[1]).toEqual(labels[0]);
   const values=await card.locator('.packing-layer-weight input').evaluateAll(els=>els.map(el=>{
    const s=getComputedStyle(el);return {fontFamily:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeight,color:s.color};
   }));
   expect(values).toEqual([reference,reference]);
  }
  const packingDividers=packing.locator('.packing-way-layer+.packing-way-layer');
  await expect(packingDividers).toHaveCount(layers-1);
  for(const container of [packingDividers,editor.locator('.packaging-layer-sections>section+section'),editor.locator('.packaging-request-layers>section+section')]){
   for(const card of await container.all()){
    const divider=await card.evaluate(el=>{const s=getComputedStyle(el,'::before');return {content:s.content,left:s.borderLeftWidth,top:s.borderTopWidth,color:s.borderColor}});
    expect(divider.content).toBe('""');expect(divider.left).toBe(width===1920?'1px':'0px');expect(divider.top).toBe(width===1920?'0px':'1px');
   }
  }
  const content=editor.locator('.record-dialog-content');
  expect(await content.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
 }
 if(layers===3){
  await page.setViewportSize({width:1920,height:1080});
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','light'));
  await packing.screenshot({path:info.outputPath('packing-way-layer-dividers.png')});
 }
});

test('Packing Way displays captured parent names and units per layer, omitting optional D3',async({page},info)=>{
 const {editor,writes}=await setup(page,3,{FirstPMType:'Pillow',SecondPMType:'Carton',ThirdPMType:'RSC',HeightMM:300,
  LayerDimensionCaptures:{
   Primary:{PackagingTypeName:'Pillow',LayerCount:3,Dimensions:[{Name:'Length',Unit:'mm',Value:'100'},{Name:'Width',Unit:'mm',Value:'200'}]},
   Secondary:{PackagingTypeName:'Carton',LayerCount:3,Dimensions:[{Name:'Length',Unit:'cm',Value:'10'},{Name:'Width',Unit:'cm',Value:'20'},{Name:'Height',Unit:'cm',Value:'30'}]},
   Tertiary:{PackagingTypeName:'RSC',LayerCount:3,Dimensions:[{Name:'Length',Unit:'mm',Value:'100'},{Name:'Width',Unit:'mm',Value:'200'},{Name:'Height',Unit:'mm',Value:'300'}]},
  }});
 const packing=editor.getByRole('region',{name:'Packing Way response',exact:true});
 const primary=packing.getByLabel('Primary captured dimensions',{exact:true}),secondary=packing.getByLabel('Secondary captured dimensions',{exact:true}),tertiary=packing.getByLabel('Tertiary captured dimensions',{exact:true});
 await expect(primary.locator('span').first()).toHaveText('Dimension');
 await expect(primary.locator('span').first()).toHaveAttribute('title','Length × Width');
 await expect(primary.locator('.captured-dimensions-value')).toHaveText('100mm × 200mm');
 await expect(secondary.locator('span').first()).toHaveText('Dimension');
 await expect(secondary.locator('span').first()).toHaveAttribute('title','Length × Width × Height');
 await expect(secondary.locator('.captured-dimensions-value')).toHaveText('10cm × 20cm × 30cm');
 await expect(tertiary.locator('.captured-dimensions-value')).toHaveText('100mm × 200mm × 300mm');
 await expect(tertiary.getByLabel('Tertiary dimension height',{exact:true})).toHaveText('300mm');
 expect(await tertiary.locator('.dimension-height').evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
 await expect(packing.locator('.captured-dimensions input')).toHaveCount(0);expect(writes).toHaveLength(0);
 for(const width of [1920,390]){
  await page.setViewportSize({width,height:width===1920?1080:844});
  for(const field of await packing.locator('.captured-dimensions').all())
   expect(await field.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
  if(width===1920)for(const value of await packing.locator('.captured-dimensions-value').all())
   expect((await value.boundingBox())!.height).toBeLessThanOrEqual(34);
  const content=editor.locator('.record-dialog-content');
  expect(await content.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
 }
 await page.setViewportSize({width:1920,height:1080});
 await packing.screenshot({path:info.outputPath('packing-way-captured-dimensions.png')});
 await editor.getByLabel('Primary Type',{exact:true}).selectOption('');
 await expect(primary.locator('span').first()).toHaveText('Dimension');
 await expect(primary.locator('.captured-dimensions-value')).toHaveText('—');
 await editor.getByLabel('Confirmed packaging layers',{exact:true}).selectOption('2');
 await expect(tertiary).toHaveCount(0);
 await expect(secondary.locator('.captured-dimensions-value')).toHaveText('10cm × 20cm × 30cm');
 await editor.getByLabel('Confirmed packaging layers',{exact:true}).selectOption('3');
 await expect(tertiary.locator('.captured-dimensions-value')).toHaveText('100mm × 200mm × 300mm');
});

test('three layers calculate 10g, 100g, 500g and 25kg per pallet; saves counts only and reloads',async({page})=>{
 const {writes,editor}=await setup(page,3,{HeightMM:350});
 const packing=editor.getByRole('region',{name:'Packing Way response',exact:true});
 await packing.getByLabel('No of Primary Unit',{exact:true}).fill('10');
 await packing.getByLabel('No of Secondary Unit',{exact:true}).fill('5');
 await expect(packing.getByLabel('No of Tertiary Unit',{exact:true})).toHaveValue('1');
 await expect(packing.getByLabel('No of Tertiary Unit',{exact:true})).toHaveAttribute('readonly','');
 await expect(editor.getByLabel('Primary net weight (g)',{exact:true})).toHaveValue('10');
 await expect(editor.getByLabel('Secondary net weight (g)',{exact:true})).toHaveValue('100');
 await expect(editor.getByLabel('Tertiary net weight (g)',{exact:true})).toHaveValue('500');
 const pallet=editor.getByRole('region',{name:'Palletization response',exact:true});
 await pallet.getByLabel('Cartons / layer',{exact:true}).fill('10');await pallet.getByLabel('Max pallet height (mm)',{exact:true}).fill('1900');await expect(packing.getByLabel('Shipping height (mm)',{exact:true})).toHaveValue('350');
 await expect(pallet.getByLabel('Net weight / Pallet (kg)',{exact:true})).toHaveValue('25');
 for(const label of ['Primary net weight (g)','Secondary net weight (g)','Tertiary net weight (g)','Net weight / Pallet (kg)'])await expect(editor.getByLabel(label,{exact:true})).toHaveAttribute('readonly','');
 await expect(editor.getByRole('region',{name:'Secondary packaging response',exact:true}).getByLabel('No of Primary Unit',{exact:true})).toHaveCount(0);
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 expect(writes[0].rows[0]).toMatchObject({UnitsPerCarton:'10',UnitsPerTertiary:'5',CartonsPerLayer:'10',ResponseMaxPalletHeightMM:'1900'});
 for(const key of ['NoOfPrimaryUnit','NoOfSecondaryUnit','NoOfTertiaryUnit','PrimaryNetWeightGrams','SecondaryNetWeightGrams','TertiaryNetWeightGrams','NetWeightPerPalletKG','LayersPerPallet'])expect(writes[0].rows[0]).not.toHaveProperty(key);
 await expect(editor.getByLabel('Tertiary net weight (g)',{exact:true})).toHaveValue('500');
 await expect(editor.getByLabel('Net weight / Pallet (kg)',{exact:true})).toHaveValue('25');
});

test('two layers use 10 x 1, then one layer fixes Primary at 1 and clears inactive payload fields',async({page})=>{
 const {writes,editor}=await setup(page,3,{UnitsPerCarton:10,UnitsPerTertiary:5,CartonsPerLayer:10,LayersPerPallet:5});
 await editor.getByLabel('Confirmed packaging layers',{exact:true}).selectOption('2');
 await expect(editor.getByLabel('Layers / pallet',{exact:true})).toHaveValue('');
 await editor.getByLabel('Max pallet height (mm)',{exact:true}).fill('1900');await expect(editor.getByLabel('Shipping height (mm)',{exact:true})).toHaveAttribute('readonly','');
 const packing=editor.getByRole('region',{name:'Packing Way response',exact:true});
 await expect(packing.getByLabel('No of Secondary Unit',{exact:true})).toHaveValue('1');
 await expect(packing.getByLabel('No of Secondary Unit',{exact:true})).toHaveAttribute('readonly','');
 await expect(packing.getByLabel('No of Tertiary Unit',{exact:true})).toHaveCount(0);
 await expect(editor.getByLabel('Tertiary net weight (g)',{exact:true})).toHaveCount(0);
 await expect(editor.getByLabel('Secondary net weight (g)',{exact:true})).toHaveValue('100');
 await expect(editor.getByLabel('Net weight / Pallet (kg)',{exact:true})).toHaveValue('');
 await editor.getByLabel('Confirmed packaging layers',{exact:true}).selectOption('1');
 await expect(editor.getByLabel('Shipping height (mm)',{exact:true})).toHaveValue('');
 await expect(editor.getByLabel('Shipping height (mm)',{exact:true})).toHaveAttribute('readonly','');
 await expect(packing.getByLabel('No of Primary Unit',{exact:true})).toHaveValue('1');
 await expect(packing.getByLabel('No of Primary Unit',{exact:true})).toHaveAttribute('readonly','');
 await expect(packing.getByLabel('No of Secondary Unit',{exact:true})).toHaveCount(0);
 await expect(editor.getByLabel('Net weight / Pallet (kg)',{exact:true})).toHaveValue('');
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 expect(writes[0].rows[0].ResponseLayerCount).toBe('1');
 expect(writes[0].rows[0]).not.toHaveProperty('UnitsPerCarton');expect(writes[0].rows[0]).not.toHaveProperty('UnitsPerTertiary');
});

test('missing counts or weight show blank calculations, never guessed zeros',async({page})=>{
 const {editor}=await setup(page);
 await expect(editor.getByLabel('Primary net weight (g)',{exact:true})).toHaveValue('10');
 for(const label of ['Secondary net weight (g)','Tertiary net weight (g)','Net weight / Pallet (kg)'])await expect(editor.getByLabel(label,{exact:true})).toHaveValue('');
 await editor.getByLabel('No of Primary Unit',{exact:true}).fill('10');
 await expect(editor.getByLabel('Secondary net weight (g)',{exact:true})).toHaveValue('100');
 await expect(editor.getByLabel('Tertiary net weight (g)',{exact:true})).toHaveValue('');
 await editor.getByLabel('No of Secondary Unit',{exact:true}).fill('5');
 await expect(editor.getByLabel('Tertiary net weight (g)',{exact:true})).toHaveValue('500');
 await editor.getByLabel('No of Primary Unit',{exact:true}).fill('');
 await expect(editor.getByLabel('Secondary net weight (g)',{exact:true})).toHaveValue('');
 await expect(editor.getByLabel('Tertiary net weight (g)',{exact:true})).toHaveValue('');
});

test('unit and pallet counts require positive whole numbers within INT range',async({page})=>{
 const {writes,editor}=await setup(page);
 for(const label of ['No of Primary Unit','No of Secondary Unit','Cartons / layer']){
  for(const value of ['0','-1','1.5','2147483648']){
   const input=editor.getByLabel(label,{exact:true});await input.fill(value);
   await editor.getByRole('button',{name:'Review & save',exact:true}).click();
   await expect(page.getByRole('dialog',{name:'Confirm request save'})).toHaveCount(0);
   expect(writes).toHaveLength(0);await input.fill('');
  }
 }
});

test('fractional product weight stays precise and readonly responses preserve saved packing',async({page})=>{
 const {editor}=await setup(page,3,{WeightGrams:'0.1234',UnitsPerCarton:10,UnitsPerTertiary:5,CartonsPerLayer:10,LayersPerPallet:5,ItemStage:'Approved'});
 await expect(editor.getByLabel('No of Primary Unit',{exact:true})).toBeDisabled();
 await expect(editor.getByLabel('No of Secondary Unit',{exact:true})).toBeDisabled();
 await expect(editor.getByLabel('Secondary net weight (g)',{exact:true})).toHaveValue('1.234');
 await expect(editor.getByLabel('Tertiary net weight (g)',{exact:true})).toHaveValue('6.17');
 await expect(editor.getByLabel('Net weight / Pallet (kg)',{exact:true})).toHaveValue('0.3085');
 await expect(editor.getByRole('button',{name:'Review & save',exact:true})).toBeDisabled();
});

test('Packing Way and pallet fields fit standard 1920x1080 and narrow viewports',async({page})=>{
 const {editor}=await setup(page,3,{UnitsPerCarton:10,UnitsPerTertiary:5,CartonsPerLayer:10,LayersPerPallet:5});
 for(const width of [1920,390]){
  await page.setViewportSize({width,height:width===1920?1080:844});
  const packing=editor.getByRole('region',{name:'Packing Way response',exact:true});
  await packing.scrollIntoViewIfNeeded();await expect(packing).toBeVisible();
  for(const label of ['No of Primary Unit','No of Secondary Unit','No of Tertiary Unit','Net weight / Pallet (kg)']){
   const box=await editor.getByLabel(label,{exact:true}).boundingBox();
   expect(box).not.toBeNull();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 }
});

test('pallet layers use saved Shipping height and react to maximum height changes',async({page})=>{
 const {editor}=await setup(page,2,{ResponseMaxPalletHeightMM:1900,HeightMM:'250.01',ResponseDefaultsInitialized:true,UnitsPerCarton:12,CartonsPerLayer:10});
 const height=editor.getByLabel('Shipping height (mm)',{exact:true}),layers=editor.getByLabel('Layers / pallet',{exact:true});
 await expect(height).toHaveAttribute('readonly','');await expect(layers).toHaveAttribute('readonly','');
 await expect(layers).toHaveValue('6');await expect(editor.getByLabel('Units / pallet',{exact:true})).toHaveValue('720');
 const maximum=editor.getByLabel('Max pallet height (mm)',{exact:true});
 await maximum.focus();await expect(maximum).toHaveValue('1900');await maximum.fill('150');await expect(layers).toHaveValue('0');await expect(editor.getByLabel('Units / pallet',{exact:true})).toHaveValue('0');
 await maximum.fill('');await expect(layers).toHaveValue('');await expect(editor.getByLabel('Units / pallet',{exact:true})).toHaveValue('');
});

test('last-layer height is readonly and final-type changes clear geometry',async({page})=>{
 const {editor}=await setup(page,2,{ResponseMaxPalletHeightMM:1900,HeightMM:250,LayersPerPallet:7});
 const height=editor.getByLabel('Shipping height (mm)',{exact:true});
 await expect(height).toHaveAttribute('readonly','');
 await editor.getByLabel('Secondary Type',{exact:true}).selectOption('');
 await expect(height).toHaveValue('');await expect(editor.getByLabel('Layers / pallet',{exact:true})).toHaveValue('');
});

test('efficiency uses last parent geometry, updates counts and pallet area, and is never submitted',async({page})=>{
 const {editor,writes}=await setup(page,3,{WeightGrams:'1000',UnitsPerCarton:10,UnitsPerTertiary:1,
  HeightMM:2000,ResponseMaxPalletHeightMM:5000,CartonsPerLayer:1,NutDensity:'.5',
  ThirdPMType:'RSC',EfficiencyTypeName:'RSC',EfficiencyLayerCount:3,
  FinalLayerVolumeM3:'30',FinalLayerAreaM2:'15',ResponsePalletSize:'3000x2000mm',ResponseDefaultsInitialized:true});
 const section=editor.getByRole('region',{name:'Efficiency response',exact:true});
 await expect(section.getByLabel('Carton Efficiency (kg/m3)',{exact:true})).toHaveValue('0.333333');
 await expect(section.getByLabel('Relative carton efficiency %',{exact:true})).toHaveValue('0.07');
 await expect(section.getByLabel('Pallet Utilization %',{exact:true})).toHaveValue('250.00');
 await expect(section.getByLabel('Pallet height efficiency %',{exact:true})).toHaveValue('83.00');
 await expect(editor.getByLabel('Pallet height (mm)',{exact:true})).toHaveValue('4,150');
 await expect(editor.getByLabel('Layers / pallet',{exact:true})).toHaveValue('2');
 for(const layer of ['Primary','Secondary','Tertiary']){
  const count=(await editor.getByLabel('No of '+layer+' Unit',{exact:true}).boundingBox())!;
  const weight=(await editor.getByLabel(layer+' net weight (g)',{exact:true}).boundingBox())!;
  expect(weight.x).toBeGreaterThan(count.x);
  expect(Math.abs(weight.y-count.y)).toBeLessThan(6);
 }
 await editor.getByLabel('No of Secondary Unit',{exact:true}).fill('2');
 await expect(section.getByLabel('Carton Efficiency (kg/m3)',{exact:true})).toHaveValue('0.666667');
 await expect(section.getByLabel('Relative carton efficiency %',{exact:true})).toHaveValue('0.13');
 await editor.getByLabel('Pallet',{exact:true}).selectOption('2');
 await expect(section.getByLabel('Pallet Utilization %',{exact:true})).toHaveValue('1,500.00');
 await editor.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 for(const key of ['PalletHeightMM','CartonEfficiencyKGM3','RelativeCartonEfficiencyPct','PalletUtilizationPct','PalletHeightEfficiencyPct','FinalLayerAreaM2','FinalLayerVolumeM3'])
  expect(writes[0].rows[0]).not.toHaveProperty(key);
});

test('missing geometry leaves efficiency blank and changing final layers discards old geometry',async({page})=>{
 const {editor}=await setup(page,3,{UnitsPerCarton:10,UnitsPerTertiary:5,HeightMM:250,
  ResponseMaxPalletHeightMM:1900,ThirdPMType:'RSC',EfficiencyTypeName:'RSC',EfficiencyLayerCount:3,
  FinalLayerVolumeM3:'.005',FinalLayerAreaM2:'.02',CartonsPerLayer:10,NutDensity:'.5'});
 await expect(editor.getByLabel('Carton Efficiency (kg/m3)',{exact:true})).toHaveValue('100');
 await expect(editor.getByLabel('Relative carton efficiency %',{exact:true})).toHaveValue('20.00');
 await expect(editor.getByLabel('Pallet Utilization %',{exact:true})).toHaveValue('');
 await editor.getByLabel('Confirmed packaging layers',{exact:true}).selectOption('2');
 for(const label of ['Carton Efficiency (kg/m3)','Relative carton efficiency %','Pallet Utilization %','Pallet height (mm)','Pallet height efficiency %'])
  await expect(editor.getByLabel(label,{exact:true})).toHaveValue('');
 await page.setViewportSize({width:390,height:844});
 const section=editor.getByRole('region',{name:'Efficiency response',exact:true});
 const box=(await section.boundingBox())!;
 expect(box.x+box.width).toBeLessThanOrEqual(390);
 for(const input of await section.locator('input').all()){
  await expect(input).toHaveAttribute('readonly','');
  const rect=(await input.boundingBox())!;expect(rect.x+rect.width).toBeLessThanOrEqual(390);
 }
});

test('efficiency decimal arithmetic retains precision and rejects invalid counts',()=>{
 const values={ResponseLayerCount:'3',UnitsPerCarton:'10',UnitsPerTertiary:'5',CartonsPerLayer:'10',HeightMM:'250.01',ResponseMaxPalletHeightMM:'1900',NutDensity:'.5'};
 const result=responseEfficiency('0.123456',values,{AreaM2:'0.02',VolumeM3:'0.005'},'1000000');
 expect(result).toEqual({palletHeight:'1,650.06',carton:'1.23456',relative:'0.25',utilization:'20.00',heightEfficiency:'86.85'});
 expect(responseEfficiency('224954',{ResponseLayerCount:'1',NutDensity:'0.5'},{VolumeM3:'1'},null).relative).toBe('44.99');
 // Round from the exact ratio, not a previously rounded six-decimal value.
 expect(responseEfficiency('499949.99',{ResponseLayerCount:'1',NutDensity:'1'},{VolumeM3:'1'},null).relative).toBe('49.99');
 expect(responseEfficiency('10',{...values,UnitsPerTertiary:'1.5'},{VolumeM3:'0.005'},null).carton).toBe('');
 expect(responseEfficiency('10',{...values,NutDensity:'0'},{VolumeM3:'0.005'},null).relative).toBe('');
 expect(responseEfficiency('10',values,{VolumeM3:'0'},null).carton).toBe('');
});

test('response field help stays next to label text in both themes and on mobile',async({page},info)=>{
 const {editor}=await setup(page);
 for(const width of [1920,390]){
  await page.setViewportSize({width,height:width===1920?1080:844});
  for(const theme of ['light','dark']){
   await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);
   const fields=editor.locator('.response-sections label>.field-label:has(>.info-tip):visible');
   await expect(fields).toHaveCount(7);
   for(const field of await fields.all()){
    const text=(await field.locator('.field-label-text').boundingBox())!,icon=(await field.getByRole('note').boundingBox())!;
    const gap=icon.x-text.x-text.width;
    expect(gap).toBeGreaterThanOrEqual(3);expect(gap).toBeLessThanOrEqual(6);
    expect(Math.abs(icon.y+icon.height/2-text.y-text.height/2)).toBeLessThan(2);
    await field.getByRole('note').focus();
    const tooltip=await page.getByRole('tooltip').evaluate(el=>{const box=el.getBoundingClientRect();return {left:box.left,right:box.right}});
    expect(tooltip.left).toBeGreaterThanOrEqual(0);expect(tooltip.right).toBeLessThanOrEqual(width);
   }
   await expect(editor.locator('label>.info-tip')).toHaveCount(0);
   const heading=editor.getByRole('heading',{name:/^Packing Way/});
   await expect(heading.locator('.info-tip+small')).toContainText('Requested layers');
  }
 }
 await page.setViewportSize({width:1920,height:1080});
 const efficiency=editor.getByRole('region',{name:'Efficiency response',exact:true});
 await efficiency.scrollIntoViewIfNeeded();
 await efficiency.screenshot({path:info.outputPath('efficiency-label-info.png')});
});

test('PCR-33168 decimal Shipping captures calculate pallet totals before saving',async({page})=>{
 const {editor,writes}=await setup(page,2,{WeightGrams:400,UnitsPerCarton:6,CartonsPerLayer:20,ResponseMaxPalletHeightMM:900,
 ResponseDefaultsInitialized:true,ResponsePalletSize:'1000x1000mm',SecondPMType:'RSC',
 LayerTareJSON:JSON.stringify({Primary:{KG:'0.4766'},Secondary:{KG:'0.15'}}),
 PalletPricingJSON:JSON.stringify({ID:7,PalletSize:'1000x1000mm',TareKG:'20',Dimensions:{height:'150'}}),
 LayerDimensionCaptures:{Secondary:{PackagingTypeName:'RSC',LayerCount:2,Dimensions:[{Name:'Height',Unit:'mm',Value:'147.000000'}]}}});
 await expect(editor.getByLabel('Layers / pallet',{exact:true})).toHaveValue('5');
 await expect(editor.getByLabel('Units / pallet',{exact:true})).toHaveValue('600');
 await expect(editor.getByLabel('Pallet height (mm)',{exact:true})).toHaveValue('885');
 await expect(editor.getByLabel('Gross weight / Pallet (kg)',{exact:true})).toHaveValue('560.96');
 await expect(editor.getByLabel('Net weight / Pallet (kg)',{exact:true})).toHaveValue('240');

 await editor.getByLabel('Max pallet height (mm)',{exact:true}).fill('750');
 await expect(editor.getByLabel('Layers / pallet',{exact:true})).toHaveValue('4');
 await expect(editor.getByLabel('Units / pallet',{exact:true})).toHaveValue('480');
 await expect(editor.getByLabel('Net weight / Pallet (kg)',{exact:true})).toHaveValue('192');
 await expect(editor.getByLabel('Gross weight / Pallet (kg)',{exact:true})).toHaveValue('452.768');
 expect(writes).toHaveLength(0);
});
