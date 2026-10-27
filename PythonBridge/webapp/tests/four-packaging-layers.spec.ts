import {test,expect,type Page} from '@playwright/test';
import {selectableType,globalOrder} from '../src/packaging-orders';
import {packingWeights} from '../src/packing-way';
import {shippingDimensionsMM} from '../src/response-dimensions';

const rv='AAAAAAAAAAE=',orders=['Primary','Secondary','Tertiary','Quaternary'];
async function setup(page:Page,mix=false,pallet=false,diameter=false,unpriced=false,readOnly=false){
 const types=orders.map((order,i)=>({ID:i+1,PackagingType:'Type '+order,PackagingOrders:[order],PackagingOrder:order,ParentTypeID:null,Shipping:true,Status:'Active'}));
 const base={RequestID:1,ItemID:1,OpportunityItemID:101,ProductCode:'PRD-1',ProductName:'Four layers',WeightGrams:'100',ItemStage:'Working',PICUserID:1,PIC:'Admin',ItemRowVersion:rv,ResponseDefaultsInitialized:true,RequestedLayerCount:4,ResponseLayerCount:4,FirstPMType:'Type Primary',SecondPMType:'Type Secondary',ThirdPMType:'Type Tertiary',FourthPMType:'Type Quaternary',UnitsPerCarton:2,UnitsPerTertiary:3,UnitsPerQuaternary:4,ConfigurationRequest:'Pallet load',LayerTareJSON:JSON.stringify(Object.fromEntries(orders.map(o=>[o,{KG:'0.1'}])))};
 const children=mix?[{...base,ItemID:2,OpportunityItemID:102,ParentItemID:101,ProductID:2,MixChildNumber:1,RequestedLayerCount:2,ResponseLayerCount:2},{...base,ItemID:3,OpportunityItemID:103,ParentItemID:101,ProductID:3,MixChildNumber:2,RequestedLayerCount:1,ResponseLayerCount:1}]:[];
 const root:any=mix?{...base,ProductID:1,IsMixParent:true,RequestedLayerCount:2,ResponseLayerCount:2,FirstPMType:'Type Tertiary',SecondPMType:'Type Quaternary',PackagingLayerStart:3,ProductMixSnapshot:JSON.stringify({items:[{ProductID:2,UnitQuantity:1},{ProductID:3,UnitQuantity:1}]}),MixResponseChildren:JSON.stringify(children)}:base;
 if(pallet)Object.assign(root,{ResponsePalletMaterialID:424,ResponsePalletSize:'1000x1200mm',ResponseMaxPalletHeightMM:2400,HeightMM:250,PalletPricingJSON:JSON.stringify({ID:7,PalletSize:'1000x1200mm',PalletMaterialID:424,Dimensions:{length:'1000',width:'1200',height:'150'},TareKG:'15',MaxPayloadKG:'1200',components:[]}),LayerDimensionCaptures:{Quaternary:{PackagingTypeName:'Type Quaternary',LayerCount:4,Dimensions:[{Name:'Length',Unit:'mm',Value:'600'},{Name:'Width',Unit:'mm',Value:'500'},{Name:'Height',Unit:'mm',Value:'250'}]}}});
 if(diameter)root.LayerDimensionCaptures.Quaternary.Dimensions=[{Name:'Dia',Unit:'mm',Value:'150'},{Name:'Dia',Unit:'mm',Value:'1'},{Name:'Height',Unit:'mm',Value:'500'}];
 if(unpriced)root.PalletPricingJSON=null;
 if(readOnly)Object.assign(root,{ItemStage:'Approved',CartonsPerLayer:3,LayersPerPallet:1});
 let priceVersion=rv,unitPrice='1';const writes:any[]=[];
 const masterPrice=()=>({ID:1,MaterialID:1,VendorID:1,CurrencyID:1,UnitPrice:unitPrice,BaseUoM:'EA',PriceBasis:'EA',QuantityFrom:0,ExchangeRateToUSD:1,EffectiveFrom:'2026-01-01',Status:'Active',RowVersion:priceVersion});
 const lookups={packagingTypes:types,customers:[],products:[],categories:[],currencies:[{ID:1,CurrencyCode:'USD',CurrencyName:'USD',Status:'Active'}],vendors:[{ID:1,VendorName:'Vendor',CurrencyID:1,Status:'Active'}],materials:[{ID:1,MaterialCode:'PKG-1',MaterialName:'Material',UnitOfMeasure:'EA',PackagingTypeID:1,Status:'Active'}],uoms:[{ID:1,UoMCode:'EA',UoMName:'Each',Status:'Active'}],materialDimensions:[],creators:[]};
 await page.route('**/api/**',route=>{
  const p=new URL(route.request().url()).pathname;
  if(p.endsWith('/session'))return route.fulfill({json:{username:'Admin',user_id:1,is_admin:true,scopes:['Admin']}});
  if(p.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(p==='/api/workbench/requests')return route.fulfill({json:{rows:[{RequestID:1,RequestNumber:'PCR-1',RequestStatus:'Open',ItemCount:1+children.length}],total:1}});
  if(p==='/api/packaging/requests')return route.fulfill({json:{rows:[root,...children],total:1+children.length}});
  if(p==='/api/packaging/lookups')return route.fulfill({json:{packagingTypes:types,pallets:[]}});
  if(p==='/api/workbench/masters/lookups')return route.fulfill({json:lookups});
  if(p==='/api/pallet-pricing/pallets')return route.fulfill({json:{rows:[{ID:424,PalletSize:'1000x1200mm',Dimensions:{length:'1000',width:'1200',height:'150'},TareKG:'15',MaxPayloadKG:'1200',MaterialName:'Base pallet'}]}});
  if(p.endsWith('/pallet-capacity')){const small=Number(route.request().postDataJSON().MaxPalletHeightMM)<2000;return route.fulfill({json:{cartons_per_layer:4,pallet_layers:small?1:2,cartons_per_pallet:small?4:8,MaxPayloadKG:'1200'}})}
  if(p==='/api/inline-masters/prices/1'){
   if(route.request().method()==='POST'){writes.push(route.request().postDataJSON());unitPrice='2';priceVersion='AAAAAAAAAAI=';return route.fulfill({json:{results:[{RowNum:1,Status:'OK',NewID:1,NewRowVersion:priceVersion}],records:[masterPrice()]}})}
   return route.fulfill({json:{editable:true,reason:'',lockedFields:['MaterialID'],row:masterPrice()}});
  }
  if(p.endsWith('/pricing/references'))return route.fulfill({json:{references:[]}});
  if(p.endsWith('/pricing'))return route.fulfill({json:{parentType:{ID:1,Shipping:false},materials:[{MaterialID:1,MaterialCode:'PKG-1',MaterialName:'Material',PackagingType:'Film',PackagingTypeID:1,CalculationBasis:'Count',PriceID:1,PriceRowVersion:priceVersion,UnitPrice:unitPrice,CurrencyCode:'USD',VendorMOQ:0,PriceUoM:'EA',EffectiveFrom:'2026-01-01'}],dimensions:[],types:[],uoms:[],saved:[],savedComponents:[]}});
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Packaging Requests',exact:true}).click();await page.getByRole('button',{name:'Edit request PCR-1',exact:true}).click();
 return {editor:page.getByRole('dialog',{name:'Edit Packaging request',exact:true}),writes};
}

test('selecting the base pallet again replaces prior manual counts',async({page})=>{
 const {editor}=await setup(page,false,true,true,true);
 await expect(editor.getByLabel('Cartons / layer',{exact:true})).toHaveValue('4');
 await expect(editor.getByLabel('Layers / pallet',{exact:true})).toHaveValue('2');
 await editor.getByLabel('Cartons / layer',{exact:true}).fill('3');
 await editor.getByLabel('Layers / pallet',{exact:true}).fill('1');
 const pallet=editor.getByLabel('Pallet',{exact:true});
 const value=await pallet.locator('option').last().getAttribute('value');
 await pallet.selectOption('');await pallet.selectOption(value!);
 await expect(editor.getByLabel('Cartons / layer',{exact:true})).toHaveValue('4');
 await expect(editor.getByLabel('Layers / pallet',{exact:true})).toHaveValue('2');
});

test('cumulative type eligibility reserves the fourth layer for the Mix parent',()=>{
 expect(globalOrder('Primary',3)).toBe('Tertiary');
 expect(selectableType({PackagingOrders:['Tertiary'],Shipping:true},'Primary',2,false,true,3)).toBe(true);
 expect(selectableType({PackagingOrders:['Primary'],Shipping:true},'Primary',2,false,true,3)).toBe(false);
 expect(selectableType({PackagingOrders:['Quaternary'],Shipping:false},'Primary',1,false,true,4)).toBe(false);
});
test('four-layer units and weights include all three quantity factors',()=>{
 const values={ResponseLayerCount:'4',UnitsPerCarton:'2',UnitsPerTertiary:'3',UnitsPerQuaternary:'4',CartonsPerLayer:'4',LayersPerPallet:'2'};
 const weights=packingWeights('100',values);
 expect(weights.quaternary).toBe('2,400');expect(weights.unitsPerPallet).toBe('192');
});

test('shipping envelope uses explicit diameter, converts cm and never invents an arbitrary width',()=>{
 expect(shippingDimensionsMM([{Name:'Dia',Unit:'cm',Value:'15'},{Name:'Dia',Unit:'mm',Value:'1'},{Name:'Height',Unit:'mm',Value:'500'}])).toEqual({length:150,width:150,height:500});
 expect(shippingDimensionsMM([{Name:'Length',Unit:'mm',Value:'150'},{Name:'Height',Unit:'mm',Value:'500'}]).width).toBe(0);
});

test('four-layer response exposes every type and remains within the viewport',async({page})=>{
 const {editor}=await setup(page);
 await expect(editor.getByLabel('Confirmed packaging layers',{exact:true}).locator('option')).toHaveCount(4);
 await expect(editor.getByLabel('Quaternary Type',{exact:true})).toHaveValue('Type Quaternary');
 await expect(editor.getByLabel('No of Tertiary Unit',{exact:true})).toHaveValue('4');
 await expect(editor.getByLabel('Quaternary net weight (g)',{exact:true})).toHaveValue('2,400');
 await expect(editor.getByRole('button',{name:'Edit Packaging Type master',exact:true})).toHaveCount(4);
 const master=await editor.getByRole('button',{name:'Edit Packaging Type master',exact:true}).first().boundingBox();
 const calculator=await editor.getByRole('button',{name:'Primary Pricing Calculator',exact:true}).boundingBox();
 expect(master!.width).toBeLessThanOrEqual(calculator!.width+1);
 expect(master!.height).toBeLessThanOrEqual(calculator!.height+1);
 for(const width of [1920,1280,390]){
  await page.setViewportSize({width,height:1080});
  expect(await editor.locator('.record-dialog-content').evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
 }
});
test('Mix children reserve one parent layer and parent types use global labels',async({page})=>{
 const {editor}=await setup(page,true);const sections=editor.locator('.response-sections');
 const parent=sections.nth(0),child=sections.nth(1);
 await expect(parent.getByLabel('Confirmed packaging layers',{exact:true}).locator('option')).toHaveText(['1 — Tertiary','2 — Tertiary + Quaternary']);
 await expect(parent.getByLabel('Tertiary Type',{exact:true})).toHaveValue('Type Tertiary');
 await expect(parent.getByLabel('Quaternary Type',{exact:true})).toHaveValue('Type Quaternary');
 await expect(parent.getByLabel('Primary Type',{exact:true})).toHaveCount(0);
 await expect(child.getByLabel('Confirmed packaging layers',{exact:true}).locator('option')).toHaveCount(3);
});
test('automatic pallet suggestions fill both editable counts without losing the first update',async({page})=>{
 const {editor}=await setup(page,false,true);
 await expect(editor.getByLabel('Cartons / layer',{exact:true})).toHaveValue('4');
 const layers=editor.getByLabel('Layers / pallet',{exact:true});
 await expect(layers).toHaveValue('2');await layers.fill('1');await expect(layers).toHaveValue('1');
 await expect(editor.getByLabel('Cartons / layer',{exact:true})).toHaveValue('4');
});

test('changing maximum pallet height replaces previous manual counts with new proposals',async({page})=>{
 const {editor}=await setup(page,false,true);
 await expect(editor.getByLabel('Layers / pallet',{exact:true})).toHaveValue('2');
 await editor.getByLabel('Cartons / layer',{exact:true}).fill('3');
 await editor.getByLabel('Layers / pallet',{exact:true}).fill('5');
 const maximum=editor.getByLabel('Max pallet height (mm)',{exact:true});
 await maximum.focus();await expect(maximum).toHaveValue('2400');await maximum.fill('1500');
 await expect(maximum).toHaveValue('1500');
 await expect(editor.getByLabel('Cartons / layer',{exact:true})).toHaveValue('4');
 await expect(editor.getByLabel('Layers / pallet',{exact:true})).toHaveValue('1');
});

test('diameter-height packaging proposes pallet counts and manual counts show gross weight',async({page})=>{
 const {editor}=await setup(page,false,true,true);
 await expect(editor.getByLabel('Cartons / layer',{exact:true})).toHaveValue('4');
 await expect(editor.getByLabel('Layers / pallet',{exact:true})).toHaveValue('2');
 await editor.getByLabel('Cartons / layer',{exact:true}).fill('3');
 await editor.getByLabel('Layers / pallet',{exact:true}).fill('1');
 await expect(editor.getByLabel('Gross weight / Pallet (kg)',{exact:true})).toHaveValue('34.5');
});

test('selecting a base pallet proposes counts and previews gross before pallet pricing is applied',async({page})=>{
 const {editor}=await setup(page,false,true,true,true);
 await expect(editor).not.toContainText('Weight preview uses the selected base pallet');
 await expect(editor.getByLabel('Cartons / layer',{exact:true})).toHaveValue('4');
 await expect(editor.getByLabel('Layers / pallet',{exact:true})).toHaveValue('2');
 await expect(editor.getByLabel('Gross weight / Pallet (kg)',{exact:true})).toHaveValue('67');
 await editor.getByLabel('Cartons / layer',{exact:true}).fill('3');
 await editor.getByLabel('Layers / pallet',{exact:true}).fill('1');
 await expect(editor.getByLabel('Gross weight / Pallet (kg)',{exact:true})).toHaveValue('34.5');
});

test('approved responses do not borrow live base-pallet tare when their snapshot is absent',async({page})=>{
 const {editor}=await setup(page,false,true,true,true,true);
 await expect(editor.getByLabel('Gross weight / Pallet (kg)',{exact:true})).toHaveValue('');
 await expect(editor).not.toContainText('Weight preview uses the selected base pallet');
});
test('editing Packaging Pricing retains draft component quantities after catalog refresh',async({page})=>{
 const {editor,writes}=await setup(page);
 await editor.getByRole('button',{name:'Primary Pricing Calculator',exact:true}).click();
 const calc=page.getByRole('dialog',{name:'Primary Pricing Calculator',exact:true});
 await calc.getByRole('button',{name:'Add PKG-1 price 1',exact:true}).click();
 await calc.getByLabel('Component 1 quantity',{exact:true}).fill('3');
 await calc.getByRole('button',{name:'Edit Packaging Price master',exact:true}).click();
 const master=page.getByRole('dialog',{name:'Edit price',exact:true});
 await master.getByLabel('Unit price (Vendor currency)',{exact:true}).fill('2');
 await master.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(master).toHaveCount(0);
 await expect(calc.getByLabel('Component 1 quantity',{exact:true})).toHaveValue('3');
 expect(writes).toHaveLength(1);
});
