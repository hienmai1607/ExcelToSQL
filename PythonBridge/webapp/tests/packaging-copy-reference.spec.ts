import {test,expect,type Page} from '@playwright/test';
import {applyReference,clearCopiedSection} from '../src/packaging-copy-reference';
import {fieldPayload,webResponseFields} from '../src/packaging-fields';
import {palletizationValue} from '../src/tcb-model';

const orders=['Primary','Secondary','Tertiary','Quaternary'];
const rv='AAAAAAAAAAE=';
async function setup(page:Page,manager=false,unpriced=false){
 const writes:any[]=[],previews:any[]=[];
 const types=orders.map((order,i)=>({ID:i+1,PackagingType:'Type '+order,PackagingOrders:[order],ParentTypeID:null,Status:'Active',Shipping:true}));
 const row:any={RequestID:1,ItemID:1,OpportunityItemID:101,ProductCode:'PRD-1',ProductName:'Copy target',WeightGrams:'100',ItemStage:manager?'Pending Review':'Working',PICUserID:1,PIC:'PIC',ItemRowVersion:rv,RequestedLayerCount:4,ResponseLayerCount:4,ResponseDefaultsInitialized:true,FirstPMType:'Type Primary',SecondPMType:'Type Secondary',ThirdPMType:'Type Tertiary',FourthPMType:'Type Quaternary',FirstPMMOQ:10,SecondPMMOQ:10,ThirdPMMOQ:10,FourthPMMOQ:10,UnitsPerCarton:2,UnitsPerTertiary:3,UnitsPerQuaternary:4,ConfigurationRequest:'Pallet load'};
 const references=[10,20].map(ID=>({ID,RequestNumber:'PCR-'+ID,OpportunityNumber:'OPP-'+ID,ProductCode:'PRD-'+ID,ProductName:'Saved reference '+ID,sections:[...orders,'Palletization']}));
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:manager?{username:'Manager',user_id:2,is_admin:false,scopes:['PackagingManager'],can_assign_packaging:true,permissions:{requests:'edit'}}:{username:'Admin',user_id:1,is_admin:true,scopes:['Admin']}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/workbench/requests')return route.fulfill({json:{rows:[{RequestID:1,RequestNumber:'PCR-1',RequestStatus:'Open',ItemCount:1}],total:1}});
  if(path==='/api/packaging/requests')return route.fulfill({json:{rows:[row],total:1}});
  if(path==='/api/packaging/lookups')return route.fulfill({json:{packagingTypes:types,pallets:[]}});
  if(path.endsWith('/copy-references'))return route.fulfill({json:{rows:references}});
  if(path.endsWith('/copy-references/preview')){
   const body=route.request().postDataJSON();previews.push(body);const sections:any={};
   for(const [section,source] of Object.entries(body.sections)){
    const index=orders.indexOf(section),blank=unpriced&&section==='Primary';
    if(index<0){sections[section]={SourceItemID:source,values:{ResponsePalletSize:'1000x1200mm',PalletPricingJSON:''},materials:[],warnings:[]};continue}
    const input={PackagingOrder:section,LayerCount:4,PackagingTypeID:index+1,Fingerprint:'fp-'+section,components:[],SquareMeterUoMID:null,...(blank?{DimensionID:1,DimensionRowVersion:rv,D1:'220',D2:'125',D3:'250'}:{})};
    const result={FinalMOQ:'10',UnitPrice:'2',CurrencyCode:'USD',UnitUSDPrice:'2',Fingerprint:input.Fingerprint,components:[]};
    sections[section]={SourceItemID:source,input,result:blank?null:result,...(blank?{dimensions:[{Name:'Length',Unit:'mm',Value:'220'},{Name:'Width',Unit:'mm',Value:'125'},{Name:'Height',Unit:'mm',Value:'250'}]}:{}),values:{[['FirstPMType','SecondPMType','ThirdPMType','FourthPMType'][index]]:'Type '+section,[['FirstPMMOQ','SecondPMMOQ','ThirdPMMOQ','FourthPMMOQ'][index]]:blank?'':'10',[section+'PricePerUnit']:blank?'':'2',[section+'PriceCurrencyCode']:blank?'':'USD',...(section==='Secondary'?{UnitsPerCarton:'9'}:{})},materials:[{MaterialID:50,MaterialCode:'PKG-50',MaterialName:'Copied film',PriceID:blank?null:11,UnitPrice:blank?null:'2'}],warnings:blank?['Primary: missing applicable pricing; copied materials are retained with blank price.']:[]};
   }
   return route.fulfill({json:{sections}});
  }
  if(path.endsWith('/pricing'))return route.fulfill({json:{parentType:{ID:1,CopyDim:unpriced},materials:[],dimensions:unpriced?[{ID:1,PackagingTypeID:1,RowVersion:rv,D1Name:'Length',D2Name:'Width',D3Name:'Height',D1Unit:'mm',D2Unit:'mm',D3Unit:'mm'}]:[],types:[],uoms:[],saved:[],savedComponents:[]}});
  if(path==='/api/packaging/response/batch'){
   const body=route.request().postDataJSON();writes.push(body);
   if(manager)row.ItemStage='Approved';
   return route.fulfill({json:{results:body.rows.map((r:any)=>({RowNum:r.RowNum,NewID:r.ID,NewRowVersion:rv,Status:'OK',...(manager?{Stage:'Approved'}:{})}))}});
  }
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Requests',exact:true}).click();await page.getByRole('button',{name:'Edit request PCR-1',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
 return {editor,writes,previews};
}

test('copy separate references per section and preserve their source identities on save',async({page})=>{
 const {editor,writes,previews}=await setup(page);
 await editor.getByRole('button',{name:'Copy reference for item 1',exact:true}).click();
 const popup=page.getByRole('dialog',{name:'Copy reference',exact:true});
 await popup.getByLabel('Use one reference for all available sections',{exact:true}).uncheck();
 for(const section of [...orders,'Palletization'])await expect(popup.getByLabel(section+' reference',{exact:true})).toBeVisible();
 await popup.getByLabel('Primary reference',{exact:true}).selectOption('10');
 await popup.getByLabel('Secondary reference',{exact:true}).selectOption('20');
 await popup.getByRole('button',{name:'Preview copy',exact:true}).click();
 await expect(popup.getByLabel('Reference copy preview',{exact:true})).toBeVisible();
 expect(previews[0]).toEqual({LayerCount:4,sections:{Primary:10,Secondary:20}});
 await popup.getByRole('button',{name:'Copy to response',exact:true}).click();
 await expect(editor.getByLabel('No of Primary Unit',{exact:true})).toHaveValue('9');
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(1);
 const copied=JSON.parse(writes[0].rows[0].ReferenceSetupJSON);
 expect(copied.Primary.SourceItemID).toBe(10);expect(copied.Secondary.SourceItemID).toBe(20);
 expect(writes[0].rows[0].PricingCalculations).toHaveLength(2);
});

test('one reference copies all five available sections and popup stays within viewport',async({page})=>{
 const {editor,previews}=await setup(page);
 await editor.getByRole('button',{name:'Copy reference for item 1',exact:true}).click();
 const popup=page.getByRole('dialog',{name:'Copy reference',exact:true});
 await popup.getByLabel('Reference for all sections',{exact:true}).selectOption('10');
 await popup.getByRole('button',{name:'Preview copy',exact:true}).click();
 await expect(popup.getByLabel('Reference copy preview',{exact:true})).toBeVisible();
 expect(Object.keys(previews[0].sections)).toEqual([...orders,'Palletization']);
 for(const width of [1920,1280,390]){
  await page.setViewportSize({width,height:1080});
  const overflow=await popup.evaluate(e=>({pixels:e.scrollWidth-e.clientWidth,offenders:[...e.querySelectorAll('*')].filter(x=>x.getBoundingClientRect().right>e.getBoundingClientRect().right).map(x=>({tag:x.tagName,class:x.className,width:x.getBoundingClientRect().width,text:x.textContent?.slice(0,80)}))}));
  expect(overflow.pixels,JSON.stringify({width,...overflow})).toBeLessThanOrEqual(1);
 }
 await page.setViewportSize({width:1280,height:1080});
 await page.screenshot({path:'test-results/copy-reference-popup.png'});
 await popup.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(editor.getByRole('button',{name:'Review & save',exact:true})).toBeDisabled();
});

test('missing quote keeps the copied material and blank price visible in calculator',async({page})=>{
 const {editor}=await setup(page,false,true);
 await editor.getByRole('button',{name:'Copy reference for item 1',exact:true}).click();
 const popup=page.getByRole('dialog',{name:'Copy reference',exact:true});
 await popup.getByLabel('Use one reference for all available sections',{exact:true}).uncheck();
 await popup.getByLabel('Primary reference',{exact:true}).selectOption('10');
 await popup.getByRole('button',{name:'Preview copy',exact:true}).click();
 await expect(popup.getByLabel('Reference copy preview',{exact:true})).toContainText('price blank');
 await popup.getByRole('button',{name:'Copy to response',exact:true}).click();
 await editor.getByRole('button',{name:'Primary Pricing Calculator',exact:true}).click();
 const calculator=page.getByRole('dialog',{name:'Primary Pricing Calculator',exact:true});
 await expect(calculator.getByLabel('Copied materials without pricing',{exact:true})).toContainText('PKG-50');
 await expect(calculator.getByLabel('Parent D1',{exact:true})).toHaveCount(0);
 await expect(calculator.getByLabel('Copied final dimensions',{exact:true})).toContainText('220 mm');
 await expect(editor.getByLabel('Primary captured dimensions',{exact:true})).toContainText('220mm');
 await expect(calculator.getByRole('button',{name:'Apply to response',exact:true})).toBeDisabled();
});

test('non-Admin manager may edit submitted response, note and confirm completion',async({page})=>{
 const {editor,writes}=await setup(page,true);
 await expect(editor.getByLabel('Confirmed packaging layers',{exact:true})).toBeEnabled();
 await editor.getByLabel('Manager review note for item 1',{exact:true}).fill('Checked dimensions and pricing');
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Confirm request save',exact:true})).toContainText('complete each submitted parent/child family together');
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(1);
 expect(writes[0].rows[0].ReviewNote).toBe('Checked dimensions and pricing');
});

test('unpriced copied pallet material remains visible without enabling a partial priced assembly',async({page})=>{
 const {editor}=await setup(page);
 await page.route('**/copy-references/preview',route=>route.fulfill({json:{sections:{Palletization:{SourceItemID:10,values:{ResponsePalletMaterialID:'424',ResponsePalletSize:'1000x1200mm',PalletPricingJSON:''},calculation:null,result:null,materials:[{ID:null,MaterialID:424,MaterialCode:'PKG-PAL',MaterialName:'Copied pallet',UnitPrice:null}],warnings:['No applicable pallet quote.']}}}}));
 await editor.getByRole('button',{name:'Copy reference for item 1',exact:true}).click();
 const popup=page.getByRole('dialog',{name:'Copy reference',exact:true});
 await popup.getByLabel('Use one reference for all available sections',{exact:true}).uncheck();
 await popup.getByLabel('Palletization reference',{exact:true}).selectOption('10');
 await popup.getByRole('button',{name:'Preview copy',exact:true}).click();
 await expect(popup.getByLabel('Reference copy preview',{exact:true})).toContainText('PKG-PAL');
 await popup.getByRole('button',{name:'Copy to response',exact:true}).click();
 await editor.getByRole('button',{name:'Pallet Pricing Calculator',exact:true}).click();
 const calculator=page.getByRole('dialog',{name:'Pallet Pricing Calculator',exact:true});
 await expect(calculator.getByLabel('Copied pallet materials without pricing',{exact:true})).toContainText('PKG-PAL');
 await expect(calculator.getByRole('button',{name:'Apply pallet pricing',exact:true})).toBeDisabled();
});

test('aligned global sections map to local Mix slots without changing other sections',()=>{
 const draft={values:{ReferenceSetupJSON:'{}',LayerTareJSON:'{"Primary":{"KG":"1"}}',UnitsPerCarton:'2'},pricing:{},pricingResults:{}};
 const next=applyReference(draft,{sections:{Tertiary:{values:{FirstPMType:'Tray'},materials:[],warnings:[],SourceItemID:10}}},3);
 expect(next.values.FirstPMType).toBe('Tray');expect(next.values.UnitsPerCarton).toBe('2');
 expect(JSON.parse(next.values.LayerTareJSON)).toEqual({});
 expect(JSON.parse(clearCopiedSection(next.values,'Tertiary').ReferenceSetupJSON)).toEqual({});
});

test('copied pallet pricing is saved atomically, never as a synthetic snapshot ID',()=>{
 const values={PalletPricingJSON:'{"ID":-1}',ReferenceSetupJSON:'{"Palletization":{"calculation":{"PalletSize":"1000x1200mm","components":[]}}}'};
 const payload=fieldPayload(values,webResponseFields,'Pallet load');
 expect(payload).not.toHaveProperty('PalletPricingID');
 expect(payload.PalletCalculation).toMatchObject({PalletSize:'1000x1200mm'});
});

test('TCB values captured VND pallet pricing with opportunity FX, retaining authoritative zero',()=>{
 expect(palletizationValue({PalletPricingJSON:'{"UnitPrice":"400000","CurrencyCode":"VND","UnitUSDPrice":null}',ExchangeRateVNDPerUSD:'25000'},{})).toBe('16');
 expect(palletizationValue({DefaultPalletUSDPerEA:0,PalletPricingJSON:'{"UnitUSDPrice":15}'},{})).toBe(0);
 expect(palletizationValue({PalletPricingJSON:'{"UnitPrice":"400000","CurrencyCode":"VND"}'},{})).toBeNull();
});
