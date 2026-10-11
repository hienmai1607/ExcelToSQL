import {test,expect,type Page} from '@playwright/test';

async function setup(page:Page,overrides:Record<string,unknown>={}){
 const writes:any[]=[];
 let row:any={RequestID:1,ItemID:1,ProductCode:'PRD-1',ProductName:'Almonds',ItemStage:'Assigned',PIC:'Admin',PICUserID:1,ItemRowVersion:'AAAAAAAAAAE=',WeightGrams:150,RequestedLayerCount:3,ResponseLayerCount:3,PrimaryTypeName:'Pillow',SecondaryTypeName:'Box',TertiaryTypeName:'Crate',NumberOfPrimary:12,NumberOfSecondary:5,PalletSize:'1.1x1.1M',PalletStacking:'Double',MaxPalletHeightMM:1800,ConfigurationRequest:'Floor load',SelectedContainerType:'20DC',CartonsPerContainer:100,...overrides};
 await page.route('**/api/**',route=>{
  const p=new URL(route.request().url()).pathname;
  if(p.endsWith('/session'))return route.fulfill({json:{username:'Admin',user_id:1,is_admin:true,scopes:['Admin']}});
  if(p.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(p==='/api/workbench/requests')return route.fulfill({json:{rows:[{RequestID:1,RequestNumber:'PCR-1',ItemCount:1,RequestStatus:'Open'}],total:1}});
  if(p==='/api/packaging/requests')return route.fulfill({json:{rows:[row],total:1}});
  if(p==='/api/packaging/lookups')return route.fulfill({json:{pallets:[{ID:1,PalletSize:'1.1x1.1M'},{ID:2,PalletSize:'1200x1000MM'}],packagingTypes:['Pillow','Box','Crate'].map((PackagingType,i)=>({ID:i+1,PackagingType,Shipping:true,PackagingOrder:['Primary','Secondary','Tertiary'][i],Status:'Active'}))}});
  if(p==='/api/packaging/response/batch'){const body=route.request().postDataJSON();writes.push(body);row={...row,...body.rows[0],ResponseDefaultsInitialized:true};return route.fulfill({json:{results:[{RowNum:1,Status:'OK'}]}})}
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Packaging Requests',exact:true}).click();await page.getByRole('button',{name:'Edit request PCR-1',exact:true}).click();
 return {writes,editor:page.getByRole('dialog',{name:'Edit Packaging request',exact:true})};
}

test('requested types, packing counts and pallet specs default without changing the frozen request',async({page})=>{
 const {editor,writes}=await setup(page);
 for(const [label,value] of [['Primary Type','Pillow'],['Secondary Type','Box'],['Tertiary Type','Crate'],['No of Primary Unit','12'],['No of Secondary Unit','5'],['Pallet size','1.1x1.1M'],['Pallet stacking','Double'],['Max pallet height (mm)','1,800']])await expect(editor.getByLabel(label,{exact:true})).toHaveValue(value);
 const pallet=editor.getByRole('region',{name:'Palletization response',exact:true});
 const size=(await pallet.getByLabel('Pallet size',{exact:true}).boundingBox())!,cartons=(await pallet.getByLabel('Cartons / layer',{exact:true}).boundingBox())!;expect(size.x).toBeLessThan(cartons.x);
 await pallet.getByLabel('Pallet size',{exact:true}).selectOption('1200x1000MM');await pallet.getByLabel('Pallet stacking',{exact:true}).selectOption('Single');const height=pallet.getByLabel('Max pallet height (mm)',{exact:true});await height.focus();await height.fill('1500');
 await editor.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();await expect(editor.getByRole('status')).toContainText('1 item(s) saved');
 expect(writes[0].rows[0]).toMatchObject({FirstPMType:'Pillow',SecondPMType:'Box',ThirdPMType:'Crate',UnitsPerCarton:'12',UnitsPerTertiary:'5',ResponsePalletSize:'1200x1000MM',ResponsePalletStacking:'Single',ResponseMaxPalletHeightMM:'1500'});
 expect(writes[0].rows[0]).not.toHaveProperty('PalletSize');expect(writes[0].rows[0]).not.toHaveProperty('MaxPalletHeightMM');
});

test('existing response choices win over request defaults and saved clears remain cleared',async({page})=>{
 const {editor}=await setup(page,{ResponseDefaultsInitialized:true,FirstPMType:'Existing film',UnitsPerCarton:24,ResponsePalletSize:null,ResponsePalletStacking:'Single',ResponseMaxPalletHeightMM:null});
 await expect(editor.getByLabel('Primary Type',{exact:true})).toHaveValue('Existing film');await expect(editor.getByLabel('No of Primary Unit',{exact:true})).toHaveValue('24');
 await expect(editor.getByLabel('Pallet size',{exact:true})).toHaveValue('');await expect(editor.getByLabel('Pallet stacking',{exact:true})).toHaveValue('Single');await expect(editor.getByLabel('Max pallet height (mm)',{exact:true})).toHaveValue('');
});

for(const [layers,total] of [[1,'50'],[2,'600'],[3,'3,000']])test('Units / pallet derives final-layer units for '+layers+' packaging layers',async({page})=>{
 const {editor,writes}=await setup(page,{RequestedLayerCount:layers,ResponseLayerCount:layers,HeightMM:330});
 await editor.getByLabel('Cartons / layer',{exact:true}).fill('10');await expect(editor.getByLabel('Shipping height (mm)',{exact:true})).toHaveAttribute('readonly','');
 const units=editor.getByLabel('Units / pallet',{exact:true});await expect(units).toHaveValue(total);await expect(units).toHaveAttribute('readonly','');
 await expect(editor.getByLabel('Packs / pallet',{exact:true})).toHaveCount(0);
 await editor.getByLabel('Cartons / layer',{exact:true}).fill('');await expect(units).toHaveValue('');expect(writes).toHaveLength(0);
});

test('currency sits beside each price and pallet specs stay editable on Floor load',async({page})=>{
 const {editor}=await setup(page,{PrimaryPricePerUnit:'36.76875',PrimaryPriceCurrencyCode:'VND',SecondaryPricePerUnit:'6900',SecondaryPriceCurrencyCode:'VND',TertiaryPricePerUnit:'2.25',TertiaryPriceCurrencyCode:'USD'});
 for(const field of await editor.locator('.response-price-field').all()){
  const input=(await field.locator('input').boundingBox())!,currency=(await field.locator('.response-price-currency').boundingBox())!;
  expect(currency.x).toBeGreaterThanOrEqual(input.x+input.width);expect(Math.abs(currency.y+currency.height/2-input.y-input.height/2)).toBeLessThan(2);
 }
 for(const label of ['Pallet size','Pallet stacking','Max pallet height (mm)'])await expect(editor.getByLabel(label,{exact:true})).toBeEnabled();
 await page.setViewportSize({width:390,height:844});const content=editor.locator('.record-dialog-content');expect(await content.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
});
