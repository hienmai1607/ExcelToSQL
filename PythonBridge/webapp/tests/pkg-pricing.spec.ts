import {test,expect,type Page} from '@playwright/test';

test('mix child pricing does not require Shipping D3 even on its last packaging layer',async({page})=>{
 const {editor,dialog,optionsData,previews}=await setup(page,false,false,true);
 await dialog.getByRole('button',{name:'Close pricing calculator',exact:true}).click();
 Object.assign(optionsData,{isMixChild:true,parentType:{ID:10,Shipping:true}});
 optionsData.dimensions=[{ID:10,PackagingTypeID:10,PackagingType:'Shipping parent',D1Name:'Length',D2Name:'Width',D3Name:'Height',D1Unit:'mm',D2Unit:'mm',D3Unit:'mm',RowVersion:'AAAAAAAAAAE='}];
 await editor.getByLabel('Confirmed packaging layers',{exact:true}).selectOption('2');
 await editor.getByLabel('Secondary Type',{exact:true}).selectOption('Carton');
 await editor.getByRole('button',{name:'Secondary Pricing Calculator',exact:true}).click();
 const calculator=page.getByRole('dialog',{name:'Secondary Pricing Calculator',exact:true});
 await calculator.getByRole('button',{name:'Add PKG-Jar price 2'}).click();
 await expect(calculator.getByLabel('Parent D3',{exact:true})).not.toHaveAttribute('required','');
 await calculator.getByRole('button',{name:'Calculate pricing',exact:true}).click();
 await expect(calculator.getByRole('button',{name:'Apply to response',exact:true})).toBeEnabled();
 expect(previews[0]).toMatchObject({PackagingOrder:'Secondary',LayerCount:2,D3:null});
});

test('Copy Dim. locks final inputs and permits only one material',async({page})=>{
 const {editor,dialog,optionsData,previews}=await setup(page);
 await dialog.getByRole('button',{name:'Close pricing calculator',exact:true}).click();
 optionsData.parentType.CopyDim=true;
 for(const p of optionsData.materials){p.CopyDim=true;p.CopiedDimensions={DimensionID:1,DimensionRowVersion:'AAAAAAAAAAE=',D1:'250',D2:'150',D3:null}}
 await editor.getByRole('button',{name:'Primary Pricing Calculator',exact:true}).click();
 const calculator=page.getByRole('dialog',{name:'Primary Pricing Calculator',exact:true});
 await calculator.getByRole('button',{name:'Add PKG-Label price 1',exact:true}).click();
 await expect(calculator.getByLabel('Parent D1',{exact:true})).toHaveValue('250');
 await expect(calculator.getByLabel('Parent D2',{exact:true})).toHaveValue('150');
 await expect(calculator.getByLabel('Parent D1',{exact:true})).toBeDisabled();
 await expect(calculator.getByLabel('Parent dimension definition',{exact:true})).toBeDisabled();
 await expect(calculator.getByRole('button',{name:'Add PKG-Jar price 2',exact:true})).toBeDisabled();
 await calculator.getByRole('button',{name:'Calculate pricing',exact:true}).click();
 await expect(calculator.getByRole('button',{name:'Apply to response',exact:true})).toBeEnabled();
 expect(previews[0].components).toHaveLength(1);expect(previews[0].D1).toBe('250');
 await calculator.getByRole('button',{name:'Remove component 1',exact:true}).click();
 await expect(calculator.getByRole('button',{name:'Add PKG-Jar price 2',exact:true})).toBeEnabled();
});

test('pricing popup actions stay visible while content scrolls',async({page})=>{
 const {dialog}=await setup(page);
 const footer=dialog.locator('.pricing-calculator-actions'),before=await footer.boundingBox();
 await expect(footer.getByRole('button',{name:'Calculate pricing',exact:true})).toBeInViewport();
 await expect(footer.getByRole('button',{name:'Apply to response',exact:true})).toBeInViewport();
 await expect(footer.getByRole('button',{name:'Close',exact:true})).toBeInViewport();
 await dialog.locator('.pricing-calculator-body').evaluate(el=>el.scrollTop=el.scrollHeight);
 const after=await footer.boundingBox();
 expect(after!.y).toBeCloseTo(before!.y,1);
});

test('child consumption formula is selected separately from parent occupied space',async({page})=>{
 const state=await setup(page,true);
 state.optionsData.dimensions.push({ID:9,PackagingTypeID:2,ParentDimensionID:1,PackagingType:'Label',D1Name:'Height',D2Name:'Width',D1Unit:'mm',D2Unit:'mm',ConvertFromParentFormula:'(D2*2+25)*D1/1000000',ConvertFromSupplierFormula:'D1*D2/1000000',RowVersion:'AAAAAAAAAAE='});
 Object.assign(state.optionsData.materials[0],{SupplierDimensionID:9,SupplierD1:'1000',SupplierD2:'500'});
 await state.dialog.getByRole('button',{name:'Close pricing calculator',exact:true}).click();
 await state.editor.getByRole('button',{name:'Primary Pricing Calculator',exact:true}).click();
 await state.dialog.getByRole('button',{name:'Add PKG-Label price 1'}).click();
 await expect(state.dialog.getByText('Convert from parent fx: (D2*2+25)*D1/1000000',{exact:true})).toBeVisible();
 await expect(state.dialog.getByText('Convert from supplier fx: D1*D2/1000000',{exact:true})).toBeVisible();
 await expect(state.dialog.getByLabel('Component 1 conversion definition',{exact:true})).toHaveCount(0);
 await expect(state.dialog.getByLabel('Supplier D1',{exact:true})).toHaveCount(0);
});
test('multiple child consumption definitions require a choice and never expose child measurement inputs',async({page})=>{
 const state=await setup(page,true);
 for(const id of [9,10])state.optionsData.dimensions.push({ID:id,PackagingTypeID:2,ParentDimensionID:1,PackagingType:'Label',D1Name:'Height',D2Name:'Width',D1Unit:'mm',D2Unit:'mm',ConvertFromParentFormula:id===9?'D1*D2/1000000':'(D2*2+25)*D1/1000000',RowVersion:'AAAAAAAAAAE='});
 await state.dialog.getByRole('button',{name:'Close pricing calculator',exact:true}).click();
 await state.editor.getByRole('button',{name:'Primary Pricing Calculator',exact:true}).click();
 await state.dialog.getByRole('button',{name:'Add PKG-Label price 1'}).click();
 await state.dialog.getByLabel('Component 1 conversion definition',{exact:true}).selectOption('10');
 await state.dialog.getByLabel('Parent D1',{exact:true}).fill('200');
 await state.dialog.getByLabel('Parent D2',{exact:true}).fill('100');
 await state.dialog.getByRole('button',{name:'Calculate pricing',exact:true}).click();
 expect(state.previews[0]).toMatchObject({D1:'200',D2:'100'});
 expect(state.previews[0].components[0]).toMatchObject({DimensionID:10,DimensionRowVersion:'AAAAAAAAAAE=',D1:null,D2:null,D3:null});
});
test('supplier conversion measurements are read-only in the response calculator',async({page})=>{
 const state=await setup(page,true);
 Object.assign(state.optionsData.materials[0],{SupplierDimensionID:9,SupplierD1:'1000',SupplierD2:'500',SupplierAreaPerPriceUnit:'.5'});
 await state.dialog.getByRole('button',{name:'Close pricing calculator',exact:true}).click();
 await state.editor.getByRole('button',{name:'Primary Pricing Calculator',exact:true}).click();
 await state.dialog.getByRole('button',{name:'Add PKG-Label price 1'}).click();
 await expect(state.dialog.getByLabel('Component 1 formula',{exact:true})).toHaveCount(0);
 await expect(state.dialog.getByText('D1: 1,000 × D2: 500',{exact:true})).toBeVisible();
 await expect(state.dialog.getByLabel('Supplier D1',{exact:true})).toHaveCount(0);
 await expect(state.dialog.getByLabel('Parent D1',{exact:true})).toBeVisible();
 await expect(state.dialog.getByText(/Convert from parent fx:/)).toBeVisible();
});

async function setup(page:Page,area=false,previewFailure=false,threeLayers=false,stored:Record<string,unknown>={}){
 const writes:any[]=[],previews:any[]=[],geometryPreviews:any[]=[];
 const row={RequestID:1,ItemID:1,ProductCode:'PRD-1',ProductName:'Nut product',WeightGrams:'10',ItemDescription:'Item 1',ItemStage:'Assigned',PIC:'Admin',PICUserID:1,ItemRowVersion:'AAAAAAAAAAE=',FirstPMType:'PET jar',RequestedLayerCount:threeLayers?3:2,...stored};
 const materials=[{TareWeight:'0.00125',TareWeightBasis:area?'kg/m2':'kg/EA',MaterialID:1,MaterialCode:'PKG-Label',MaterialName:'Label',PackagingType:'Label',PackagingTypeID:2,CalculationBasis:area?'Square meter':'Count',PriceID:1,PriceRowVersion:'AAAAAAAAAAE=',UnitPrice:'10000',CurrencyCode:'VND',VendorMOQ:'5000',QuantityTo:null,PriceUoM:area?'m':'EA',EffectiveFrom:'2026-01-01',EffectiveTo:'2026-12-31'},
  {TareWeight:'0',TareWeightBasis:'kg/EA',MaterialID:2,MaterialCode:'PKG-Jar',MaterialName:'Jar',PackagingType:'Jar',PackagingTypeID:3,CalculationBasis:'Count',PriceID:2,PriceRowVersion:'AAAAAAAAAAE=',UnitPrice:'3000',CurrencyCode:'VND',VendorMOQ:'1000',QuantityTo:null,PriceUoM:'EA',EffectiveFrom:'2026-01-01',EffectiveTo:null},
  {MaterialID:3,MaterialCode:'PKG-NoPrice',MaterialName:'No price',PackagingType:'Jar',PackagingTypeID:3,CalculationBasis:'Count',PriceID:null}];
 const optionsData:any={parentType:{ID:1,Shipping:false},materials,dimensions:[{ID:1,PackagingTypeID:1,PackagingType:'PET jar',DimensionBasis:'Square meter',D1Name:'Height',D2Name:'Width',D1Unit:'mm',D2Unit:'mm',SquareMeterFormula:'D1*D2/1000000',RowVersion:'AAAAAAAAAAE='}],types:[{ID:2,AncestorIDs:[2,1]},{ID:3,AncestorIDs:[3,1]}],uoms:[{ID:1,UoMCode:'m2',UoMName:'Square meter'}],saved:[],savedComponents:[]};
 await page.route('**/api/**',route=>{
  const url=new URL(route.request().url()),p=url.pathname;
  if(p.endsWith('/session'))return route.fulfill({json:{username:'Admin',is_admin:true,scopes:['Admin']}});
  if(p.endsWith('/preferences'))return route.fulfill({json:{settings:{columns:['CustomerName'],filters:[],sort:[],page_size:25},version:0}});
  if(p==='/api/workbench/requests')return route.fulfill({json:{rows:[{RequestID:1,RequestNumber:'PCR-1',CustomerName:'Customer',OpportunityNumber:'OPP-1',RequestStatus:'Open',ItemCount:1}],total:1}});
  if(p==='/api/packaging/requests')return route.fulfill({json:{rows:[row],total:1}});
  if(p==='/api/workbench/pics')return route.fulfill({json:{rows:[{ID:1,UserName:'Admin'}]}});
  if(p==='/api/packaging/lookups')return route.fulfill({json:{currencies:[],packagingTypes:[{ID:1,PackagingOrder:'Primary',PackagingType:'PET jar'},{ID:4,PackagingOrder:'Primary',PackagingType:'Pillow'},{ID:10,PackagingOrder:'Secondary',PackagingOrders:['Secondary','Tertiary'],PackagingType:'Carton',Shipping:true}]}});
  if(p==='/api/packaging/items/1/pricing')return route.fulfill({json:optionsData});
  if(p.endsWith('/pricing/references'))return route.fulfill({json:{references:[{ID:8,RequestNumber:'PCR-OLD',OpportunityNumber:'OPP-OLD',ProductCode:'PRD-OLD',PackagingTypeName:'PET jar',CreatedAt:'2026-10-01'}]}});
  if(p.endsWith('/pricing/references/8'))return route.fulfill({json:{input:{PackagingOrder:'Primary',PackagingTypeID:1,SquareMeterUoMID:null,ReferencePricingMasterID:8,components:[{PriceID:1,PriceRowVersion:'AAAAAAAAAAE=',Quantity:'2',DimensionID:null,DimensionRowVersion:null,D1:null,D2:null,D3:null}]},warnings:[],unavailable:[]}});
  if(p.endsWith('/pricing/geometry')){const data=route.request().postDataJSON();geometryPreviews.push(data);return route.fulfill({json:{components:data.components.map((c:any)=>({PriceID:c.PriceID,Factor:'250',ReverseFactor:'0.004',SourceUoMCode:'m',TargetUoMCode:'m2',AreaPerMaterial:data.D1&&data.D2?String(Number(data.D1)*Number(data.D2)/1000000):null,AreaPerProductUnit:data.D1&&data.D2?String(Number(data.D1)*Number(data.D2)/1000000*Number(c.Quantity)):null,AreaStatus:data.D1&&data.D2?null:'Enter the formula measurements.',ConversionStatus:null}))}})}
  if(p.endsWith('/pricing/history'))return route.fulfill({json:{snapshots:[{header:{ID:1,PackagingOrder:'Primary',PackagingTypeName:'PET jar',FinalMOQ:'2500',UnitPrice:'23000',CurrencyCode:'VND',IsCurrent:true,CreatedByName:'Admin',CreatedAt:'2026-10-02',OpportunityItemID:7,ProductID:3,ProductGradeVersionID:5,SourcePricingMasterID:8,ContextSnapshotJSON:JSON.stringify({Request:{ProductCode:'PRD-1',ProductName:'Nut product',RequestNumber:'PCR-1',OpportunityNumber:'OPP-1',WeightGrams:'150',ShelfLifeDays:365},Product:{RowVersion:'AAAAAAAAAAM='},ProductGradeVersion:{Version:2}})},components:[{MaterialCode:'PKG-Label',MaterialName:'Label',Quantity:'2',ProductMOQ:'2500',ProductUnitPrice:'20000',CurrencyCode:'VND',UnitPrice:'10000',PriceUoM:'EA',VendorMOQ:'5000',Factor:'1',Consumption:'2',EffectiveFrom:'2026-01-01',EffectiveTo:'2026-12-31',Dimension:{ID:1,D1Name:'Height',D2Name:'Width',D1Unit:'mm',D2Unit:'mm',SquareMeterFormula:'D1*D2/1000000'},Measurements:{D1:'100',D2:'50',D3:null}}]}]}});
  if(p.endsWith('/pricing/preview')){const data=route.request().postDataJSON();previews.push(data);if(previewFailure)return route.fulfill({status:409,json:{detail:'Material price changed. Refresh the calculator.'}});return route.fulfill({json:{calculation:{ParentDimension:optionsData.dimensions.find((d:any)=>d.ID===data.DimensionID)??null,ParentMeasurements:{D1:data.D1,D2:data.D2,D3:data.D3},FinalMOQ:area?'25000':'2500',UnitPrice:area?'2000':'23000',CurrencyCode:'VND',UnitUSDPrice:'0.92',Fingerprint:'a'.repeat(64),components:data.components.map((c:any)=>({PriceID:c.PriceID,Quantity:c.Quantity,MaterialName:c.PriceID===1?'Label':'Jar',ProductMOQ:c.PriceID===1?'2500':'1000',ProductUnitPrice:c.PriceID===1?'20000':'3000',CurrencyCode:'VND',Area:area?'50':null,Consumption:area?'.2':c.Quantity}))}}})}
  if(p==='/api/packaging/response/batch'){const data=route.request().postDataJSON();writes.push(data);Object.assign(row,data.rows[0]);return route.fulfill({json:{results:[{Status:'OK'}]}})}
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Packaging Requests',exact:true}).click();await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'});
 await editor.getByRole('button',{name:'Primary Pricing Calculator',exact:true}).click();
 return {editor,dialog:page.getByRole('dialog',{name:'Primary Pricing Calculator',exact:true}),writes,previews,geometryPreviews,optionsData,row};
}

test('changing confirmed layers preserves Primary dimension capture and calculator inputs',async({page})=>{
 const {editor,dialog}=await setup(page,true);
 await dialog.getByRole('button',{name:'Close pricing calculator',exact:true}).click();
 await editor.getByLabel('Confirmed packaging layers',{exact:true}).selectOption('1');
 await editor.getByRole('button',{name:'Primary Pricing Calculator',exact:true}).click();
 await dialog.getByRole('button',{name:'Add PKG-Label price 1'}).click();
 await dialog.getByLabel('Parent D1',{exact:true}).fill('200');
 await dialog.getByLabel('Parent D2',{exact:true}).fill('100');
 await dialog.getByRole('button',{name:'Calculate pricing',exact:true}).click();
 await dialog.getByRole('button',{name:'Apply to response',exact:true}).click();
 const dimensions=editor.getByLabel('Primary captured dimensions',{exact:true}).locator('.captured-dimensions-value');
 await expect(dimensions).toContainText('200mm');
 await editor.getByLabel('Confirmed packaging layers',{exact:true}).selectOption('2');
 await expect(dimensions).toContainText('200mm');
 await editor.getByRole('button',{name:'Primary Pricing Calculator',exact:true}).click();
 await expect(dialog.getByLabel('Parent D1',{exact:true})).toHaveValue('200');
 await expect(dialog.getByLabel('Parent D2',{exact:true})).toHaveValue('100');
 await expect(dialog.getByLabel('Component 1 quantity',{exact:true})).toHaveValue('1');
});

test('failed pricing revalidation preserves defaults and performs no save',async({page})=>{
 const {editor,dialog,writes}=await setup(page,true);
 await dialog.getByRole('button',{name:'Add PKG-Label price 1'}).click();
 await dialog.getByLabel('Parent D1',{exact:true}).fill('200');
 await dialog.getByLabel('Parent D2',{exact:true}).fill('100');
 await dialog.getByRole('button',{name:'Calculate pricing',exact:true}).click();
 await dialog.getByRole('button',{name:'Apply to response',exact:true}).click();
 await editor.getByLabel('Confirmed packaging layers',{exact:true}).selectOption('3');
 await page.route('**/pricing/preview',route=>route.fulfill({status:409,json:{detail:'Material price changed. Refresh the calculator.'}}));
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await expect(editor.getByRole('alert')).toContainText('Material price changed');
 await expect(page.getByRole('dialog',{name:'Confirm request save',exact:true})).toHaveCount(0);
 expect(writes).toHaveLength(0);
 await expect(editor.getByLabel('Primary captured dimensions',{exact:true})).toContainText('200mm');
 await editor.getByRole('button',{name:'Primary Pricing Calculator',exact:true}).click();
 await expect(dialog.getByLabel('Parent D1',{exact:true})).toHaveValue('200');
 await expect(dialog.getByLabel('Parent D2',{exact:true})).toHaveValue('100');
});

test('all layer drafts survive 3 to 1 to 3; saving 1 includes only Primary pricing',async({page})=>{
 const {editor,dialog,optionsData,previews,writes}=await setup(page,false,false,true);
 await dialog.getByRole('button',{name:'Close pricing calculator',exact:true}).click();
 optionsData.dimensions=[1,10].map(id=>({ID:id,PackagingTypeID:id,PackagingType:id===1?'PET jar':'Carton',D1Name:'Length',D2Name:'Width',D3Name:'Height',D1Unit:'mm',D2Unit:'mm',D3Unit:'mm',RowVersion:'AAAAAAAAAAE='}));
 for(const [index,order] of ['Primary','Secondary','Tertiary'].entries()){
  if(order!=='Primary')await editor.getByLabel(order+' Type',{exact:true}).selectOption('Carton');
  await editor.getByRole('button',{name:order+' Pricing Calculator',exact:true}).click();
  const calc=page.getByRole('dialog',{name:order+' Pricing Calculator',exact:true});
  await calc.getByRole('button',{name:'Add PKG-Jar price 2'}).click();
  await calc.getByLabel('Component 1 quantity',{exact:true}).fill(String(index+1));
  for(const [key,value] of [['D1',String((index+1)*100)],['D2','200'],['D3','300']])await calc.getByLabel('Parent '+key,{exact:true}).fill(value);
  await calc.getByRole('button',{name:'Calculate pricing',exact:true}).click();
  await calc.getByRole('button',{name:'Apply to response',exact:true}).click();
 }
 await editor.getByLabel('No of Primary Unit',{exact:true}).fill('12');
 await editor.getByLabel('No of Secondary Unit',{exact:true}).fill('5');
 await editor.getByLabel('Confirmed packaging layers',{exact:true}).selectOption('1');
 await expect(editor.getByLabel('Primary captured dimensions',{exact:true})).toContainText('100mm');
 await editor.getByLabel('Confirmed packaging layers',{exact:true}).selectOption('3');
 await expect(editor.getByLabel('No of Primary Unit',{exact:true})).toHaveValue('12');
 await expect(editor.getByLabel('No of Secondary Unit',{exact:true})).toHaveValue('5');
 for(const [index,order] of ['Primary','Secondary','Tertiary'].entries()){
  await expect(editor.getByLabel(order+' Type',{exact:true})).toHaveValue(order==='Primary'?'PET jar':'Carton');
  await expect(editor.getByLabel(order+' captured dimensions',{exact:true})).toContainText(String((index+1)*100)+'mm');
  await expect(editor.getByLabel(order+' price per unit',{exact:true})).toHaveValue('23,000');
  await editor.getByRole('button',{name:order+' Pricing Calculator',exact:true}).click();
  const calc=page.getByRole('dialog',{name:order+' Pricing Calculator',exact:true});
  await expect(calc.getByLabel('Parent D1',{exact:true})).toHaveValue(String((index+1)*100));
  await expect(calc.getByLabel('Component 1 quantity',{exact:true})).toHaveValue(String(index+1));
  await calc.getByRole('button',{name:'Close pricing calculator',exact:true}).click();
 }
 await editor.getByLabel('Confirmed packaging layers',{exact:true}).selectOption('1');
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 expect(previews.at(-1)).toMatchObject({PackagingOrder:'Primary',LayerCount:1,D1:'100'});
 expect(writes[0].rows[0].PricingCalculations).toHaveLength(1);
 expect(writes[0].rows[0].PricingCalculations[0]).toMatchObject({PackagingOrder:'Primary',LayerCount:1,D1:'100',components:[{Quantity:'1'}]});
 for(const key of ['SecondPMType','ThirdPMType','UnitsPerCarton','UnitsPerTertiary'])expect(writes[0].rows[0]).not.toHaveProperty(key);
});

test('saved Primary dimensions remain defaults and active pricing is revalidated for new layers',async({page})=>{
 const {editor,dialog,optionsData,previews,writes}=await setup(page,true,false,false,{ResponseLayerCount:1,FirstPMMOQ:'25000',PrimaryPricePerUnit:'2000',ResponseDefaultsInitialized:true,
  LayerDimensionCaptures:{Primary:{PackagingTypeName:'PET jar',LayerCount:1,Dimensions:[{Name:'Height',Unit:'mm',Value:'200'},{Name:'Width',Unit:'mm',Value:'100'}]}}});
 const input={PackagingOrder:'Primary',LayerCount:1,PackagingTypeID:1,SquareMeterUoMID:1,DimensionID:1,DimensionRowVersion:'AAAAAAAAAAE=',D1:'200',D2:'100',D3:null,
  components:[{PriceID:1,PriceRowVersion:'AAAAAAAAAAE=',Quantity:'2',DimensionID:null,DimensionRowVersion:null,D1:null,D2:null,D3:null}]};
 optionsData.saved=[{ID:8,PackagingTypeID:1,PackagingTypeName:'PET jar',IsCurrent:true,InputJSON:JSON.stringify(input)}];
 await dialog.getByRole('button',{name:'Close pricing calculator',exact:true}).click();
 await editor.getByLabel('Confirmed packaging layers',{exact:true}).selectOption('2');
 await expect(editor.getByLabel('Primary captured dimensions',{exact:true})).toContainText('200mm');
 await expect(editor.getByLabel('Primary price per unit',{exact:true})).toHaveValue('2,000');
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 expect(previews[0]).toMatchObject({PackagingOrder:'Primary',LayerCount:2,D1:'200',D2:'100'});
 expect(writes[0].rows[0].PricingCalculations[0]).toMatchObject({PackagingOrder:'Primary',LayerCount:2,D1:'200',D2:'100'});
});

test('calculator selects child materials and applies MOQ, then saves calculation with response',async({page})=>{
 const {editor,dialog,writes,previews}=await setup(page);
 await expect(dialog.getByText('10,000 VND / EA')).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Add PKG-NoPrice price unavailable'})).toBeDisabled();
 await dialog.getByRole('button',{name:'Add PKG-Label price 1'}).click();await dialog.getByLabel('Component 1 quantity').fill('2');
 await dialog.getByRole('button',{name:'Add PKG-Jar price 2'}).click();await dialog.getByRole('button',{name:'Calculate pricing',exact:true}).click();
 await expect(dialog.getByRole('status')).toContainText('Final MOQ: 2,500');await expect(dialog.getByRole('status')).toContainText('23,000 VND');
 expect(previews[0].components.map((c:any)=>c.Quantity)).toEqual(['2','1']);expect(writes).toHaveLength(0);
 await dialog.getByRole('button',{name:'Apply to response',exact:true}).click();
 await expect(editor.getByLabel('Primary MOQ unit',{exact:true})).toHaveValue('2,500');
 await expect(editor.getByLabel('Primary MOQ unit',{exact:true})).toHaveAttribute('readonly','');
 await expect(editor.getByLabel('Primary price per unit',{exact:true})).toHaveValue('23,000');
 await expect(editor.getByLabel('Primary price per unit',{exact:true})).toHaveAttribute('readonly','');
 await expect(editor.getByLabel('Cost basis',{exact:true})).toHaveCount(0);
 await editor.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 expect(writes[0].rows[0].PricingCalculations[0]).toMatchObject({PackagingOrder:'Primary',PackagingTypeID:1,Fingerprint:'a'.repeat(64)});
 expect(writes[0].rows[0].PricingCalculations[0]).not.toHaveProperty('UnitPrice');
 for(const key of ['FirstPMMOQ','PrimaryPricePerUnit','PrimaryPriceCurrencyCode','CostBasis'])expect(writes[0].rows[0]).not.toHaveProperty(key);
});

test('confirmed layers independently control Tertiary calculator and readonly totals',async({page})=>{
 const {dialog,editor,writes,previews}=await setup(page,false,false,true);
 await dialog.getByRole('button',{name:'Close pricing calculator',exact:true}).click();
 await expect(editor.getByLabel('Confirmed packaging layers',{exact:true})).toHaveValue('3');
 await expect(editor.getByText('Requested layers: 3.',{exact:false})).toBeVisible();
 await editor.getByLabel('Confirmed packaging layers',{exact:true}).selectOption('1');
 await expect(editor.getByLabel('Secondary Type',{exact:true})).toHaveCount(0);
 await expect(editor.getByLabel('Tertiary Type',{exact:true})).toHaveCount(0);
 await editor.getByLabel('Confirmed packaging layers',{exact:true}).selectOption('3');
 await editor.getByLabel('Tertiary Type',{exact:true}).selectOption('Carton');
 await editor.getByLabel('No of Secondary Unit',{exact:true}).fill('8');
 await editor.getByRole('button',{name:'Tertiary Pricing Calculator',exact:true}).click();
 const calc=page.getByRole('dialog',{name:'Tertiary Pricing Calculator',exact:true});
 await calc.getByRole('button',{name:'Add PKG-Label price 1'}).click();
 await calc.getByRole('button',{name:'Calculate pricing',exact:true}).click();
 await expect(calc.getByRole('button',{name:'Apply to response',exact:true})).toBeEnabled();
 expect(previews[0]).toMatchObject({PackagingOrder:'Tertiary',LayerCount:3});
 await calc.getByRole('button',{name:'Apply to response',exact:true}).click();
 for(const label of ['Tertiary MOQ unit','Tertiary price per unit'])await expect(editor.getByLabel(label,{exact:true})).toHaveAttribute('readonly','');
 await editor.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 expect(writes[0].rows[0]).toMatchObject({ResponseLayerCount:'3',ThirdPMType:'Carton',UnitsPerTertiary:'8'});
 expect(writes[0].rows[0].PricingCalculations[0]).toMatchObject({PackagingOrder:'Tertiary',LayerCount:3});
 expect(writes[0].rows[0]).not.toHaveProperty('ThirdPMMOQ');
});

test('loads an editable reference and recalculates before applying',async({page})=>{
 const {dialog,editor,previews,writes}=await setup(page);
 await dialog.getByLabel('Pricing reference',{exact:true}).selectOption('8');
 await dialog.getByRole('button',{name:'Load reference',exact:true}).click();
 await expect(dialog.getByLabel('Component 1 quantity')).toHaveValue('2');
 await expect(dialog.getByRole('button',{name:'Apply to response',exact:true})).toBeDisabled();
 await dialog.getByLabel('Component 1 quantity').fill('3');
 await dialog.getByRole('button',{name:'Calculate pricing',exact:true}).click();
 expect(previews[0]).toMatchObject({ReferencePricingMasterID:8,components:[{Quantity:'3'}]});
 await dialog.getByRole('button',{name:'Apply to response',exact:true}).click();
 await editor.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0].rows[0].PricingCalculations[0].ReferencePricingMasterID).toBe(8);
});

test('unavailable reference lines require explicit acknowledgement before calculation',async({page})=>{
 const {dialog,previews}=await setup(page);
 await page.route('**/pricing/references/8?**',route=>route.fulfill({json:{input:{PackagingOrder:'Primary',PackagingTypeID:1,SquareMeterUoMID:null,ReferencePricingMasterID:8,components:[{PriceID:1,PriceRowVersion:'AAAAAAAAAAE=',Quantity:'2',DimensionID:null,DimensionRowVersion:null,D1:null,D2:null,D3:null}]},warnings:[],unavailable:[{MaterialCode:'PKG-OLD',MaterialName:'Old jar',Reason:'No current effective price.'}]}}));
 await dialog.getByLabel('Pricing reference',{exact:true}).selectOption('8');await dialog.getByRole('button',{name:'Load reference'}).click();
 await expect(dialog.getByRole('alert')).toContainText('PKG-OLD');
 await expect(dialog.getByRole('button',{name:'Calculate pricing'})).toBeDisabled();
 await dialog.getByRole('button',{name:'Confirm omitted reference components'}).click();
 await dialog.getByRole('button',{name:'Calculate pricing'}).click();expect(previews).toHaveLength(1);
});

test('area dimension labels come from master and raw measurements are sent for server calculation',async({page})=>{
 const {dialog,previews}=await setup(page,true);
 await dialog.getByRole('button',{name:'Add PKG-Label price 1'}).click();
 await expect(dialog.getByLabel('Parent dimension definition')).toHaveValue('1');
 await dialog.getByLabel('Parent D1').fill('10000');await dialog.getByLabel('Parent D2').fill('5000');
 await expect(dialog.getByLabel('Square-meter UoM')).toHaveValue('1');
 await dialog.getByRole('button',{name:'Calculate pricing',exact:true}).click();
 await expect(dialog.getByRole('status')).toContainText('Final MOQ: 25,000');await expect(dialog.getByRole('status')).toContainText('2,000 VND');
 expect(previews[0]).toMatchObject({D1:'10000',D2:'5000',DimensionID:1,DimensionRowVersion:'AAAAAAAAAAE='});
 expect(previews[0].components[0]).toMatchObject({D1:null,D2:null,D3:null});
 expect(previews[0]).not.toHaveProperty('SquareMeterFormula');
});

test('applied parent dimensions appear immediately in Packing Way and remain snapshot-only',async({page})=>{
 const {editor,dialog,writes}=await setup(page,true);
 await dialog.getByRole('button',{name:'Add PKG-Label price 1'}).click();
 await dialog.getByLabel('Parent D1').fill('100');await dialog.getByLabel('Parent D2').fill('200');
 await dialog.getByRole('button',{name:'Calculate pricing',exact:true}).click();
 await expect(dialog.getByRole('status')).toContainText('Final MOQ');
 await dialog.getByRole('button',{name:'Apply to response',exact:true}).click();
 const captured=editor.getByRole('region',{name:'Packing Way response',exact:true}).getByLabel('Primary captured dimensions',{exact:true});
 await expect(captured.locator('span').first()).toHaveText('Height × Width');
 await expect(captured.locator('.captured-dimensions-value')).toHaveText('100mm × 200mm');
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 expect(writes[0].rows[0].PricingCalculations[0]).toMatchObject({D1:'100',D2:'200',D3:null,DimensionID:1});
 expect(writes[0].rows[0]).not.toHaveProperty('LayerDimensionCaptures');
});

test('material lines show effective date ranges and count items have no area section',async({page})=>{
 const {dialog,geometryPreviews}=await setup(page);
 await expect(dialog.getByRole('columnheader',{name:'Tare weight',exact:true})).toBeVisible();
 await expect(dialog.getByRole('row').filter({hasText:'PKG-Label'})).toContainText('0.00125 kg/EA');
 await expect(dialog.getByRole('row').filter({hasText:'PKG-Jar'})).toContainText('0 kg/EA');
 await expect(dialog.getByRole('row').filter({hasText:'PKG-NoPrice'}).getByRole('cell').nth(3)).toHaveText('—');
 await expect(dialog.getByRole('columnheader',{name:'Effective date',exact:true})).toBeVisible();
 await expect(dialog.getByRole('row').filter({hasText:'PKG-Label'})).toContainText('2026-01-01 → 2026-12-31');
 await expect(dialog.getByRole('row').filter({hasText:'PKG-Jar'})).toContainText('2026-01-01 → Open-ended');
 await dialog.getByRole('button',{name:'Add PKG-Label price 1'}).click();
 await expect(dialog.getByLabel('Pricing component 1')).toContainText('Effective date: 2026-01-01 → 2026-12-31');
 await expect(dialog.getByLabel('Component 1 square-meter details')).toHaveCount(0);expect(geometryPreviews).toHaveLength(0);
});

test('square-meter selection shows both conversion directions and automatically updates areas',async({page})=>{
 const {dialog,previews,writes}=await setup(page,true);
 await dialog.getByRole('button',{name:'Add PKG-Label price 1'}).click();
 const details=dialog.getByLabel('Component 1 square-meter details');
 await expect(details).toContainText('1 m = 250 m2 · 1 m2 = 0.004 m');
 await expect(dialog.getByLabel('Component 1 area per material',{exact:true})).toHaveValue('');
 await expect(dialog.getByLabel('Parent dimension definition')).toHaveValue('1');
 await dialog.getByLabel('Parent D1').fill('10000');await dialog.getByLabel('Parent D2').fill('5000');
 await expect(dialog.getByLabel('Component 1 area per material',{exact:true})).toHaveValue('50');
 await expect(dialog.getByLabel('Component 1 area per material',{exact:true})).toHaveAttribute('readonly','');
 await expect(dialog.getByLabel('Component 1 area per packaging unit',{exact:true})).toHaveValue('50');
 await dialog.getByLabel('Component 1 quantity').fill('2');
 await expect(dialog.getByLabel('Component 1 area per packaging unit',{exact:true})).toHaveValue('100');
 await dialog.getByLabel('Parent D2').fill('');
 await expect(dialog.getByLabel('Component 1 area per material',{exact:true})).toHaveValue('');
 await expect(dialog.getByLabel('Component 1 area per packaging unit',{exact:true})).toHaveValue('');
 await expect(dialog.getByRole('button',{name:'Apply to response',exact:true})).toBeDisabled();
 expect(previews).toHaveLength(0);expect(writes).toHaveLength(0);
});

test('a delayed geometry reply cannot overwrite newer dimensions',async({page})=>{
 const {dialog}=await setup(page,true);
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve});
 let started!:()=>void;const first=new Promise<void>(resolve=>{started=resolve});
 await page.route('**/pricing/geometry',async route=>{
  const data=route.request().postDataJSON(),c=data;
  if(c.D2==='1'){started();await held}
  await route.fulfill({json:{components:[{PriceID:1,Factor:'250',ReverseFactor:'.004',SourceUoMCode:'m',TargetUoMCode:'m2',AreaPerMaterial:c.D2==='1'?'1':'2',AreaPerProductUnit:c.D2==='1'?'1':'2',AreaStatus:null,ConversionStatus:null}]}});
 });
 await dialog.getByRole('button',{name:'Add PKG-Label price 1'}).click();await expect(dialog.getByLabel('Parent dimension definition')).toHaveValue('1');
 await dialog.getByLabel('Parent D1').fill('100');await dialog.getByLabel('Parent D2').fill('1');await first;
 await dialog.getByLabel('Parent D2').fill('2');await expect(dialog.getByLabel('Component 1 area per material',{exact:true})).toHaveValue('2');
 const completed=page.waitForResponse(r=>r.url().endsWith('/pricing/geometry'));release();await completed;
 await expect(dialog.getByLabel('Component 1 area per material',{exact:true})).toHaveValue('2');
});

test('final pricing overrides an earlier conversion preview',async({page})=>{
 const {dialog}=await setup(page,true);
 await dialog.getByRole('button',{name:'Add PKG-Label price 1'}).click();await expect(dialog.getByLabel('Parent dimension definition')).toHaveValue('1');
 await dialog.getByLabel('Parent D1').fill('100');await dialog.getByLabel('Parent D2').fill('80');
 const details=dialog.getByLabel('Component 1 square-meter details');
 await expect(details).toContainText('1 m = 250 m2');
 await page.route('**/pricing/preview',route=>route.fulfill({json:{calculation:{FinalMOQ:'1',UnitPrice:'0.8',CurrencyCode:'VND',UnitUSDPrice:null,Fingerprint:'a'.repeat(64),components:[{PriceID:1,Factor:'100',ReverseFactor:'0.01',SourceUoMCode:'m',TargetUoMCode:'m2',AreaPerMaterial:'0.008',AreaPerProductUnit:'0.008',AreaStatus:null,ConversionStatus:null,ProductMOQ:'1',ProductUnitPrice:'0.8',CurrencyCode:'VND',Consumption:'0.00008'}]}}}));
 await dialog.getByRole('button',{name:'Calculate pricing',exact:true}).click();
 await expect(details).toContainText('1 m = 100 m2 · 1 m2 = 0.01 m');
 await expect(dialog.getByLabel('Component 1 area per material',{exact:true})).toHaveValue('0.008');
});

test('area preview failures keep area blank and cannot apply pricing',async({page})=>{
 const {dialog}=await setup(page,true);
 await page.route('**/pricing/geometry',route=>route.fulfill({status:409,json:{detail:'Material price changed. Refresh the calculator.'}}));
 await dialog.getByRole('button',{name:'Add PKG-Label price 1'}).click();
 await expect(dialog.getByLabel('Component 1 square-meter details')).toContainText('Material price changed. Refresh the calculator.');
 await expect(dialog.getByLabel('Component 1 area per material',{exact:true})).toHaveValue('');
 await expect(dialog.getByRole('button',{name:'Apply to response',exact:true})).toBeDisabled();
});

test('area details fit standard desktop and narrow viewports',async({page})=>{
 const {dialog}=await setup(page,true);
 await dialog.getByRole('button',{name:'Add PKG-Label price 1'}).click();await expect(dialog.getByLabel('Parent dimension definition')).toHaveValue('1');
 await dialog.getByLabel('Parent D1').fill('100');await dialog.getByLabel('Parent D2').fill('80');
 await expect(dialog.getByLabel('Component 1 area per material',{exact:true})).toHaveValue('0.008');
 for(const size of [{width:1920,height:1080},{width:390,height:844}]){
  await page.setViewportSize(size);const box=await dialog.boundingBox();expect(box!.width).toBeLessThanOrEqual(size.width);expect(box!.height).toBeLessThanOrEqual(size.height);
  const area=await dialog.getByLabel('Component 1 square-meter details').boundingBox();expect(area!.x).toBeGreaterThanOrEqual(box!.x);expect(area!.x+area!.width).toBeLessThanOrEqual(box!.x+box!.width+1);
 }
 await page.setViewportSize({width:1920,height:1080});await dialog.screenshot({path:'test-results/pkg-pricing-area.png'});
});

test('editing quantity invalidates preview and changing response type drops its calculation',async({page})=>{
 const {editor,dialog,writes}=await setup(page);
 await dialog.getByRole('button',{name:'Add PKG-Label price 1'}).click();await dialog.getByRole('button',{name:'Calculate pricing',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'Apply to response',exact:true})).toBeEnabled();
 await dialog.getByLabel('Component 1 quantity').fill('2');await expect(dialog.getByRole('button',{name:'Apply to response',exact:true})).toBeDisabled();
 await dialog.getByRole('button',{name:'Calculate pricing',exact:true}).click();await dialog.getByRole('button',{name:'Apply to response',exact:true}).click();
 await editor.getByLabel('Primary Type',{exact:true}).selectOption('Pillow');
 await editor.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved');expect(writes[0].rows[0]).not.toHaveProperty('PricingCalculations');
});

test('stale price is visible and cannot be applied',async({page})=>{
 const {dialog,writes}=await setup(page,false,true);
 await dialog.getByRole('button',{name:'Add PKG-Label price 1'}).click();await dialog.getByRole('button',{name:'Calculate pricing',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('Material price changed');
 await expect(dialog.getByRole('button',{name:'Apply to response',exact:true})).toBeDisabled();expect(writes).toHaveLength(0);
});

test('calculator remains within 1920x1080 and narrow viewports',async({page})=>{
 const {dialog}=await setup(page);
 for(const size of [{width:1920,height:1080},{width:390,height:844}]){await page.setViewportSize(size);const box=await dialog.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.width).toBeLessThanOrEqual(size.width);expect(box!.height).toBeLessThanOrEqual(size.height)}
 await page.setViewportSize({width:1920,height:1080});await dialog.getByRole('button',{name:'Add PKG-Label price 1'}).click();await dialog.screenshot({path:'test-results/pkg-pricing.png'});
});

test('reopening a pending calculator keeps applied component selections',async({page})=>{
 const {editor,dialog}=await setup(page);
 await dialog.getByRole('button',{name:'Add PKG-Label price 1'}).click();await dialog.getByLabel('Component 1 quantity').fill('2');await dialog.getByRole('button',{name:'Calculate pricing',exact:true}).click();await dialog.getByRole('button',{name:'Apply to response',exact:true}).click();
 await editor.getByRole('button',{name:'Primary Pricing Calculator',exact:true}).click();
 await expect(dialog.getByLabel('Component 1 quantity')).toHaveValue('2');
 await expect(dialog.getByLabel('Component 1 previous calculation')).toContainText('20,000 VND / packaging unit');
 await expect(dialog.getByLabel('Component 1 previous calculation')).toContainText('Last applied calculation (not saved yet)');
 await expect(dialog.getByRole('button',{name:'Apply to response',exact:true})).toBeDisabled();
});

test('saved component prices remain visible before and after recalculating with current prices',async({page})=>{
 const {editor,dialog,optionsData,previews,writes}=await setup(page);
 await dialog.getByRole('button',{name:'Close pricing calculator',exact:true}).click();
 const input={PackagingOrder:'Primary',PackagingTypeID:1,SquareMeterUoMID:null,components:[
  {PriceID:1,PriceRowVersion:'AAAAAAAAAAE=',Quantity:'2',DimensionID:null,DimensionRowVersion:null,D1:null,D2:null,D3:null},
  {PriceID:2,PriceRowVersion:'AAAAAAAAAAE=',Quantity:'1',DimensionID:null,DimensionRowVersion:null,D1:null,D2:null,D3:null}]};
 const saved={ID:7,PackagingTypeID:1,PackagingTypeName:'PET jar',InputJSON:JSON.stringify(input),IsCurrent:true,CreatedAt:'2026-10-01',FinalMOQ:'2500',UnitPrice:'20000',CurrencyCode:'VND'};
 optionsData.saved=[saved];optionsData.componentSnapshot=saved;
 optionsData.savedComponents=[{PriceID:1,Quantity:'2',ProductMOQ:'2500',ProductUnitPrice:'18000',CurrencyCode:'VND'},{PriceID:2,Quantity:'1',ProductMOQ:'1000',ProductUnitPrice:'2000',CurrencyCode:'VND'}];
 await editor.getByRole('button',{name:'Primary Pricing Calculator',exact:true}).click();
 await expect(dialog.getByLabel('Component 1 previous calculation')).toContainText('18,000 VND / packaging unit');
 await expect(dialog.getByLabel('Component 2 previous calculation')).toContainText('2,000 VND / packaging unit');
 await expect(dialog.getByLabel('Component 1 previous calculation')).toContainText('Saved pricing #7 · 2026-10-01');
 await expect(dialog.getByLabel('Parent dimension definition')).toHaveValue('1');
 await expect(dialog.getByLabel('Parent dimension definition')).toHaveValue('1');
 await expect(dialog.getByLabel('Component 2 dimension')).toHaveCount(0);
 expect(previews).toHaveLength(0);expect(writes).toHaveLength(0);
 await expect(dialog.getByRole('button',{name:'Apply to response',exact:true})).toBeDisabled();
 await dialog.screenshot({path:'test-results/pkg-pricing-previous-components.png'});
 await dialog.getByRole('button',{name:'Calculate pricing',exact:true}).click();
 await expect(dialog.getByLabel('Pricing component 1',{exact:true})).toContainText('Unit price: 20,000 VND');
 await expect(dialog.getByLabel('Component 1 previous calculation')).toContainText('18,000 VND / packaging unit');
});

test('only multiple dimension definitions use a dropdown',async({page})=>{
 const {editor,dialog,optionsData,previews}=await setup(page,true);
 await dialog.getByRole('button',{name:'Close pricing calculator',exact:true}).click();
 optionsData.dimensions.push({...optionsData.dimensions[0],ID:2,D1Name:'Length'});
 await editor.getByRole('button',{name:'Primary Pricing Calculator',exact:true}).click();
 await dialog.getByRole('button',{name:'Add PKG-Label price 1'}).click();
 const dimension=dialog.getByLabel('Parent dimension definition');
 await expect(dimension).toHaveValue('');await expect(dimension).toHaveJSProperty('tagName','SELECT');
 await dimension.selectOption('2');
 await dialog.getByLabel('Parent D1').fill('100');await dialog.getByLabel('Parent D2').fill('80');
 await dialog.getByRole('button',{name:'Calculate pricing',exact:true}).click();
 expect(previews[0]).toMatchObject({DimensionID:2,D1:'100',D2:'80'});
});

test('loaded reference preserves previous component price after a vendor price replacement',async({page})=>{
 const {dialog}=await setup(page);
 await page.route('**/pricing/references/8?**',route=>route.fulfill({json:{
  input:{PackagingOrder:'Primary',PackagingTypeID:1,SquareMeterUoMID:null,ReferencePricingMasterID:8,components:[{PriceID:1,PriceRowVersion:'AAAAAAAAAAE=',Quantity:'2',DimensionID:null,DimensionRowVersion:null,D1:null,D2:null,D3:null}]},
  warnings:[],unavailable:[],componentSnapshot:{ID:8,CreatedAt:'2026-10-01'},
  previousComponents:[{PriceID:100,CurrentPriceID:1,ProductUnitPrice:'16000',CurrencyCode:'VND',ProductMOQ:'2500',Quantity:'2'}]}}));
 await dialog.getByLabel('Pricing reference',{exact:true}).selectOption('8');await dialog.getByRole('button',{name:'Load reference',exact:true}).click();
 await expect(dialog.getByLabel('Component 1 previous calculation')).toContainText('16,000 VND / packaging unit');
 await expect(dialog.getByLabel('Component 1 previous calculation')).toContainText('Saved pricing #8');
 await expect(dialog.getByLabel('Parent dimension definition')).toHaveValue('1');
 await dialog.getByLabel('Component 1 quantity').fill('3');
 await expect(dialog.getByLabel('Component 1 previous calculation')).toContainText('Quantity: 2');
 await expect(dialog.getByRole('button',{name:'Apply to response',exact:true})).toBeDisabled();
});

test('secondary calculated price and MOQ are readonly, saved with calculator and restored from response',async({page})=>{
 const {editor,dialog,writes,row}=await setup(page);
 await dialog.getByRole('button',{name:'Close pricing calculator',exact:true}).click();
 await editor.getByLabel('Secondary Type',{exact:true}).selectOption('Carton');
 await editor.getByRole('button',{name:'Secondary Pricing Calculator',exact:true}).click();
 const secondary=page.getByRole('dialog',{name:'Secondary Pricing Calculator',exact:true});
 await secondary.getByRole('button',{name:'Add PKG-Jar price 2'}).click();
 await secondary.getByRole('button',{name:'Calculate pricing',exact:true}).click();
 await secondary.getByRole('button',{name:'Apply to response',exact:true}).click();
 await expect(editor.getByLabel('Secondary MOQ unit',{exact:true})).toHaveValue('2,500');
 await expect(editor.getByLabel('Secondary price per unit',{exact:true})).toHaveValue('23,000');
 await expect(editor.getByLabel('Secondary MOQ unit',{exact:true})).toHaveAttribute('readonly','');
 await expect(editor.getByLabel('Secondary price per unit',{exact:true})).toHaveAttribute('readonly','');
 Object.assign(row,{SecondPMMOQ:'2500',SecondaryPricePerUnit:'23000',SecondaryPriceCurrencyCode:'VND'});
 await editor.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 expect(writes[0].rows[0].PricingCalculations[0]).toMatchObject({PackagingOrder:'Secondary',PackagingTypeID:10,Fingerprint:'a'.repeat(64)});
 for(const key of ['SecondPMMOQ','SecondaryPricePerUnit','SecondaryPriceCurrencyCode'])expect(writes[0].rows[0]).not.toHaveProperty(key);
 await expect(editor.getByLabel('Secondary price per unit',{exact:true})).toHaveValue('23,000');
 await expect(editor.getByLabel('Secondary MOQ unit',{exact:true})).toHaveValue('2,500');
 await editor.getByLabel('Secondary Type',{exact:true}).selectOption('');
 await expect(editor.getByLabel('Secondary MOQ unit',{exact:true})).toHaveValue('');
 await expect(editor.getByLabel('Secondary price per unit',{exact:true})).toHaveValue('');
});

test('saved pricing remains view-only for an approved item and blocked type',async({page})=>{
 const {editor,dialog,writes}=await setup(page);
 await dialog.getByRole('button',{name:'Close pricing calculator',exact:true}).click();
 await page.route('**/api/packaging/requests?**',r=>r.fulfill({json:{rows:[{RequestID:1,ItemID:1,ProductCode:'PRD-1',ItemStage:'Approved',FirstPMType:'Old PET jar',FirstPMMOQ:'2500',ItemRowVersion:'AAAAAAAAAAE='}],total:1}}));
 await editor.getByRole('button',{name:'Refresh items',exact:true}).click();
 await editor.getByRole('button',{name:'View saved pricing for item 1',exact:true}).click();
 const history=page.getByRole('dialog',{name:'Saved packaging pricing',exact:true});
 await expect(history.getByText('PKG-Label — Label',{exact:true})).toBeVisible();
 await expect(history.getByText(/23,000 VND/)).toBeVisible();
 await history.getByText('Opportunity item and product versions',{exact:true}).click();
 await expect(history.getByText(/Opportunity item: 7/)).toBeVisible();
 await expect(history.getByText(/Grade version: 2/)).toBeVisible();
 await expect(history.getByText('Reference pricing #8',{exact:true})).toBeVisible();
 await history.getByText('Stored dimensions, vendor prices and conversions',{exact:true}).click();
 await expect(history.getByText(/Effective 2026-01-01 to 2026-12-31/)).toBeVisible();
 await expect(history.getByText(/Formula: D1\*D2\/1000000/)).toBeVisible();
 await expect(history.getByRole('button',{name:'Apply to response'})).toHaveCount(0);expect(writes).toHaveLength(0);
});

test('Enter recalculates without submitting the surrounding response',async({page})=>{
 const {dialog,writes,previews}=await setup(page);
 await dialog.getByRole('button',{name:'Add PKG-Label price 1'}).click();await dialog.getByLabel('Component 1 quantity').press('Enter');
 await expect(dialog.getByRole('status')).toContainText('Final MOQ');expect(previews).toHaveLength(1);expect(writes).toHaveLength(0);
 await expect(page.getByRole('dialog',{name:'Confirm request save'})).toHaveCount(0);
});

test('Shipping parent Height is required and final-layer pricing drives pallet height',async({page})=>{
 const {editor,dialog,optionsData,previews,writes,row}=await setup(page);
 await dialog.getByRole('button',{name:'Close pricing calculator',exact:true}).click();
 optionsData.parentType={ID:10,Shipping:true};
 optionsData.dimensions=[{ID:10,PackagingTypeID:10,PackagingType:'Carton',D1Name:'Length',D2Name:'Width',D3Name:'Height',D1Unit:'mm',D2Unit:'mm',D3Unit:'mm',RowVersion:'AAAAAAAAAAE='}];
 await editor.getByLabel('Secondary Type',{exact:true}).selectOption('Carton');
 await editor.getByLabel('Max pallet height (mm)',{exact:true}).fill('1900');
 await editor.getByLabel('Cartons / layer',{exact:true}).fill('10');
 await editor.getByLabel('No of Primary Unit',{exact:true}).fill('12');
 await editor.getByRole('button',{name:'Secondary Pricing Calculator',exact:true}).click();
 const calc=page.getByRole('dialog',{name:'Secondary Pricing Calculator',exact:true});
 await calc.getByRole('button',{name:'Add PKG-Jar price 2'}).click();
 await expect(calc.getByLabel('Parent D3',{exact:true})).toHaveAttribute('required','');
 await expect(calc.getByLabel('Component 1 Height',{exact:true})).toHaveCount(0);
 await calc.getByRole('button',{name:'Calculate pricing',exact:true}).click();
 await expect(calc.getByRole('alert')).toContainText('D3 Height');expect(previews).toHaveLength(0);
 await calc.getByLabel('Parent D3',{exact:true}).fill('250');
 await page.route('**/pricing/preview',route=>route.fulfill({json:{calculation:{FinalMOQ:'1000',UnitPrice:'3000',CurrencyCode:'VND',UnitUSDPrice:null,Fingerprint:'a'.repeat(64),FinalLayerHeightMM:'250',ParentGeometryMetrics:{AreaM2:'.02',VolumeM3:'.005'},components:[]}}}));
 await calc.getByRole('button',{name:'Calculate pricing',exact:true}).click();
 await calc.getByRole('button',{name:'Apply to response',exact:true}).click();
 await expect(editor.getByLabel('Shipping height (mm)',{exact:true})).toHaveAttribute('readonly','');
 await expect(editor.getByLabel('Shipping height (mm)',{exact:true})).toHaveValue('250');
 await expect(editor.getByLabel('Layers / pallet',{exact:true})).toHaveValue('7');
 await expect(editor.getByLabel('Units / pallet',{exact:true})).toHaveValue('840');
 await expect(editor.getByLabel('Pallet height (mm)',{exact:true})).toHaveValue('1,900');
 await expect(editor.getByLabel('Carton Efficiency (kg/m3)',{exact:true})).toHaveValue('24');
 await expect(editor.getByLabel('Pallet height efficiency %',{exact:true})).toHaveValue('100.00');
 await expect(editor.locator('.pricing-summary')).toHaveCount(0);
 await expect(editor.getByText(/Save response to store/)).toHaveCount(0);
 // A stale displayed height is not resubmitted over the freshly calculated height.
 row.HeightMM='100';
 await editor.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0].rows[0]).not.toHaveProperty('HeightMM');
 expect(writes[0].rows[0].PricingCalculations[0]).toMatchObject({DimensionID:10,D3:'250'});
});

for(const [order,layers,required] of [['Secondary',3,false],['Tertiary',3,true],['Primary',2,false],['Primary',1,true]] as const){
 test(order+' Shipping Height is '+(required?'required':'optional')+' with '+layers+' confirmed layers',async({page})=>{
  const {editor,dialog,optionsData,previews}=await setup(page,false,false,layers===3);
  await dialog.getByRole('button',{name:'Close pricing calculator',exact:true}).click();
  optionsData.parentType={ID:order==='Primary'?1:10,Shipping:true};
  optionsData.dimensions=[{ID:10,PackagingTypeID:optionsData.parentType.ID,PackagingType:'Shipping parent',D1Name:'Length',D2Name:'Width',D3Name:'Height',D1Unit:'mm',D2Unit:'mm',D3Unit:'mm',RowVersion:'AAAAAAAAAAE='}];
  await editor.getByLabel('Confirmed packaging layers',{exact:true}).selectOption(String(layers));
  if(order!=='Primary')await editor.getByLabel(order+' Type',{exact:true}).selectOption('Carton');
  await editor.getByRole('button',{name:order+' Pricing Calculator',exact:true}).click();
  const calc=page.getByRole('dialog',{name:order+' Pricing Calculator',exact:true});
  await calc.getByRole('button',{name:'Add PKG-Jar price 2'}).click();
  const height=calc.getByLabel('Parent D3',{exact:true});
  expect(await height.evaluate((input:HTMLInputElement)=>input.required)).toBe(required);
  await expect(height.locator('..')).toHaveText(required?'D3 — Height (mm) *':'D3 — Height (mm)');
  await calc.getByRole('button',{name:'Calculate pricing',exact:true}).click();
  if(required){
   await expect(calc.getByRole('alert')).toContainText('last confirmed packaging layer');
   expect(previews).toHaveLength(0);
  }else{
   await expect(calc.getByRole('button',{name:'Apply to response',exact:true})).toBeEnabled();
   expect(previews[0]).toMatchObject({PackagingOrder:order,LayerCount:layers,D3:null});
   await calc.getByRole('button',{name:'Apply to response',exact:true}).click();
   await expect(editor.getByLabel('Shipping height (mm)',{exact:true})).toHaveValue('');
  }
 });
}

for(const area of [false,true]){
 test('component cards align horizontally and wrap on mobile ('+(area?'area':'count')+')',async({page})=>{
  const {dialog}=await setup(page,area);
  await dialog.getByRole('button',{name:'Add PKG-Label price 1'}).click();
  await dialog.getByRole('button',{name:'Add PKG-Jar price 2'}).click();
  const first=dialog.getByRole('region',{name:'Pricing component 1',exact:true});
  const second=dialog.getByRole('region',{name:'Pricing component 2',exact:true});
  const left=(await first.boundingBox())!,right=(await second.boundingBox())!;
  expect(Math.abs(left.y-right.y)).toBeLessThan(2);
  expect(right.x).toBeGreaterThan(left.x+left.width);
  expect((await dialog.getByLabel('Component 1 quantity').boundingBox())!.width).toBeGreaterThan(left.width*.8);
  await page.setViewportSize({width:390,height:844});
  const top=(await first.boundingBox())!,bottom=(await second.boundingBox())!;
  expect(Math.abs(top.x-bottom.x)).toBeLessThan(2);
  expect(bottom.y).toBeGreaterThan(top.y+top.height);
  expect(top.x+top.width).toBeLessThanOrEqual(390);
  expect(bottom.x+bottom.width).toBeLessThanOrEqual(390);
  for(const card of [first,second]){
   expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  }
 });
}

test('editing parent measurements invalidates pricing and reopening restores the single parent entry',async({page})=>{
 const {dialog,editor}=await setup(page,true);
 await dialog.getByRole('button',{name:'Add PKG-Label price 1'}).click();
 await dialog.getByLabel('Parent D1').fill('200');await dialog.getByLabel('Parent D2').fill('100');
 await dialog.getByRole('button',{name:'Calculate pricing',exact:true}).click();
 await expect(dialog.getByRole('button',{name:'Apply to response',exact:true})).toBeEnabled();
 await dialog.getByLabel('Parent D2').fill('110');
 await expect(dialog.getByRole('button',{name:'Apply to response',exact:true})).toBeDisabled();
 await dialog.getByRole('button',{name:'Calculate pricing',exact:true}).click();
 await dialog.getByRole('button',{name:'Apply to response',exact:true}).click();
 await editor.getByRole('button',{name:'Primary Pricing Calculator',exact:true}).click();
 await expect(dialog.getByLabel('Parent D1')).toHaveValue('200');
 await expect(dialog.getByLabel('Parent D2')).toHaveValue('110');
 await expect(dialog.getByLabel('Component 1 Height')).toHaveCount(0);
});
