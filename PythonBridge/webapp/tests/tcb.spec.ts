import {test,expect,type Page} from '@playwright/test';
import {costs,defaultInputs,money,packagingUSD} from '../src/tcb-model';
const version='0x0000000000000001',rv='AAAAAAAAAAE=';
const grades=[{Path:'0/1',RawGradeID:1,RawMaterialID:10,Grade:'Almonds',Proportion:'.6'},{Path:'0/2',RawGradeID:2,RawMaterialID:11,Grade:'Cashew',Proportion:'.4'}];
const prices=[{PriceID:1,PriceVersion:version,RawGradeID:1,MaterialID:10,MaterialCode:'RM-A',VendorName:'Vendor A',QuantityFrom:0,QuantityTo:100,PriceBasis:'KG',USDPerLb:'2'},{PriceID:2,PriceVersion:version,RawGradeID:2,MaterialID:11,MaterialCode:'RM-B',VendorName:'Vendor B',QuantityFrom:100,QuantityTo:null,PriceBasis:'LB',USDPerLb:'4'}];
const row={OpportunityID:1,OpportunityNumber:'OPP-TCB',CustomerName:'Northstar',HeaderStage:'Draft',HeaderRowVersion:rv,ItemID:11,ProductID:2,ProductCode:'PRD-2',ProductName:'Almonds',ItemStage:'Draft',ItemRowVersion:rv,AnnualUnit:1000,WeightGrams:150,CustomerCurrencyCode:'AUD',ExchangeRateCustomerCurrencyPerUSD:'1.5',ExchangeRateVNDPerUSD:'25000',PackagingRequestID:9,ResponseLayerCount:2,PrimaryPricePerUnit:'2500',PrimaryPriceCurrencyCode:'VND',SecondaryPricePerUnit:'.3',SecondaryPriceCurrencyCode:'AUD',HasOpenPackagingRequest:true};
const lossMasters=[['Sorting','5',1],['Processing','10',2],['PrimaryPackaging','2',3],['PrimaryPackaging','3',4],['SecondaryPackaging','7',5],['PrimaryPackaging','5',6],['MixPrimaryPackaging','2',1],['MixSecondaryPackaging','3',2],['Processing','8',1]].map(([ProcessType,LossPct,Sequence],i)=>({MasterID:i+1,MasterVersion:version,ProcessType,LossPct,Sequence}));
async function setup(page:Page,mix=false,readonly=false,saved:Record<string,unknown>={},layers=2,palletUSD:string|null='15.5'){
 const writes:any[]=[];
 const item={...row,IsMixParent:mix,HeaderStage:readonly?'Closed':'Draft',ItemStage:readonly?'Approved':'Draft'};
 const data={item:{ID:11,DefaultPalletUSDPerEA:palletUSD,LossLayerCount:layers,IsMixParent:mix,ProductCode:item.ProductCode,ProductName:item.ProductName,RowVersion:rv,HeaderStage:item.HeaderStage,ItemStage:item.ItemStage,ProductGradeSnapshot:JSON.stringify({items:[]})},saved,lossMasters,grades:mix?[]:grades,prices:mix?[]:prices,gradeError:''};
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Sales',user_id:1,is_admin:false,scopes:['Opportunity']}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/opportunity/grid')return route.fulfill({json:{rows:[item],total:1,page:1}});
  if(path==='/api/opportunity/items/11/loss-processes'||path==='/api/opportunity/items/11/loss-formula'||path==='/api/opportunity/items/11/tcb'||path==='/api/opportunity/items/11/commercial'||path==='/api/opportunity/items/11/commercial/preview'){
   if(route.request().method()==='GET')return route.fulfill({json:data});
   const body=route.request().postDataJSON();if(path.endsWith('/preview')||path.endsWith('/loss-formula'))return route.fulfill({json:{LossProductPct:'0',saved:{RMCostUSDPerLb:'2.8'}}});writes.push(body);return route.fulfill({json:{saved:{Inputs:body.Inputs,RMCostUSDPerLb:'2.8',ProductUSDPerLb:'2.82',GradeSnapshot:{items:[]}},RowVersion:'AAAAAAAAAAI='}});
  }
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('/workbench/');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'View details',exact:true}).click();
 await page.getByRole('button',{name:'TCB Review',exact:true}).click();
 await page.getByRole('button',{name:'TCB Review for PRD-2 item 11',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'TCB Review',exact:true});
 await expect(dialog.getByRole('heading',{name:'Packaging',exact:true})).toBeVisible();
 return {dialog,writes};
}
test('exact nested proportions, balanced ingredients and USD response conversion',()=>{
 const input={...defaultInputs(),Prices:grades.map((g,i)=>({Path:g.Path,PriceID:i+1,PriceVersion:version})),RMRatio:'90',SeasoningRatio:'5',SeasoningUSDPerLb:'1',OilPct:'5',OilUSDPerLb:'2',ProcessingUSDPerLb:'.15',LossProductPct:'20'};
 expect(money(costs(input,grades,prices).rm)).toBe('2.80 USD');
 expect(money(costs(input,grades,prices).product)).toBe('2.82 USD');
 expect(costs({...input,OilPct:'4'},grades,prices).balanced).toBe(false);
 expect(money(packagingUSD(row,0,row))).toBe('0.10 USD');
 expect(money(packagingUSD(row,1,row))).toBe('0.20 USD');
 expect(packagingUSD(row,2,row)).toBeNull();
 expect(money(packagingUSD({...row,PrimaryPriceCurrencyCode:'EUR',PrimaryLayerPricingSnapshot:'{"UnitUSDPrice":"0.123456"}'},0,row))).toBe('0.12 USD');
});
test('calculator selects prices, calculates live and saves item inputs even with active PCR',async({page})=>{
 const {dialog,writes}=await setup(page,false,false,{Inputs:{LossProcesses:[{ProcessType:'PrimaryPackaging',Sequence:1,LossPct:'5'}]}});
 await expect(dialog.getByRole('button',{name:'Review & save'})).toBeDisabled();
 await dialog.getByLabel('Raw price item 11 grade 0/1').selectOption('1:'+version+':2');
 await dialog.getByLabel('Raw price item 11 grade 0/2').selectOption('2:'+version+':4');
 await expect(dialog.getByText('2.80 USD',{exact:true})).toHaveCount(2);
 await dialog.getByLabel('RM Ratio (%)',{exact:true}).fill('90');
 await dialog.getByLabel('Seasoning/salt Ratio (%)',{exact:true}).fill('5');
 await dialog.getByLabel('Seasoning/salt ($/lbs)',{exact:true}).fill('1');
 await dialog.getByLabel('Oil %',{exact:true}).fill('5');
 await dialog.getByLabel('Oil ($/lbs)',{exact:true}).fill('2');
 await dialog.getByLabel('Processing ($/lbs)',{exact:true}).fill('.15');
 await expect(dialog.getByText('2.82 USD',{exact:true})).toBeVisible();
 await expect(dialog.getByText('0.10 USD',{exact:true})).toBeVisible();
 await expect(dialog.getByText('0.20 USD',{exact:true})).toBeVisible();
 await expect(dialog.getByText('Mix Primary PM ($/EA)',{exact:true})).toHaveCount(0);
 await expect(dialog.getByLabel('Palletization ($/EA)')).toHaveValue('15.5');
 await expect(dialog.getByLabel('Palletization ($/EA)')).toHaveAttribute('readonly','');
 await dialog.getByRole('button',{name:'Review & save'}).click();
 await dialog.getByRole('button',{name:'Confirm save'}).click();
 await expect(dialog.getByText('Saved item settings for 1 item(s).')).toBeVisible();
 expect(writes[0]).toMatchObject({RowVersion:rv,CostInputs:{RMRatio:'90'},Prices:[{Path:'0/1',PriceID:1,PriceVersion:version},{Path:'0/2',PriceID:2,PriceVersion:version}]});
 expect(writes[0].CostInputs.RMCostUSDPerLb).toBeUndefined();
 expect(writes[0].CostInputs.PalletUSDPerEA).toBeUndefined();
 await dialog.getByRole('button',{name:'Close TCB Review'}).click();
 await expect(page.getByRole('table',{name:'Opportunity items'})).toBeVisible();
});
test('Mix parent has only Mix packaging inputs, losses and pallet; no Product costing',async({page})=>{
 const {dialog,writes}=await setup(page,true,false,{Inputs:{LossProcesses:[{ProcessType:'MixSecondaryPackaging',Sequence:1,LossPct:'3',MasterID:8,MasterVersion:version}]}});
 await expect(dialog.getByRole('heading',{name:'Product',exact:true})).toHaveCount(0);
 await expect(dialog.getByText('Mix Primary PM ($/EA)',{exact:true})).toBeVisible();
 await expect(dialog.getByText('Mix Secondary PM ($/EA)',{exact:true})).toBeVisible();
 await expect(dialog.getByLabel('Palletization ($/EA)')).toHaveValue('15.5');
 await expect(dialog.getByLabel('Palletization ($/EA)')).toHaveAttribute('readonly','');
 await dialog.getByLabel('Packaging loss ratio item 11 layer 2',{exact:true}).fill('4');
 await dialog.getByRole('button',{name:'Review & save'}).click();
 await dialog.getByRole('button',{name:'Confirm save'}).click();
 expect(writes[0].CostInputs?.PalletUSDPerEA).toBeUndefined();
 expect(writes[0].Inputs.LossProcesses.find((p:any)=>p.ProcessType==='MixSecondaryPackaging')).toMatchObject({LossPct:'4'});
 expect(writes[0].Inputs.MixSecondaryLossPct).toBeUndefined();
});
test('read-only calculator closes without writes or closing Opportunity details',async({page})=>{
 const {dialog,writes}=await setup(page,false,true);
 await expect(dialog.getByLabel('RM Ratio (%)',{exact:true})).toBeDisabled();
 await expect(dialog.getByRole('button',{name:'Review & save'})).toBeDisabled();
 await dialog.getByRole('button',{name:'Close TCB Review'}).click();
 await expect(page.getByRole('table',{name:'Opportunity items'})).toBeVisible();expect(writes).toEqual([]);
});
test('invalid total blocks save and unsaved close keeps the calculator when cancelled',async({page})=>{
 const {dialog,writes}=await setup(page);
 await dialog.getByLabel('RM Ratio (%)',{exact:true}).fill('99');
 await expect(dialog.getByText('RM + Seasoning/salt + Oil ratios must total 100%.').first()).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Review & save'})).toBeDisabled();
 page.once('dialog',d=>d.dismiss());await dialog.getByRole('button',{name:'Close TCB Review'}).click();
 await expect(dialog).toBeVisible();expect(writes).toEqual([]);
});

test('Palletization copies current response USD price instead of an old manual cost',async({page})=>{
 const {dialog,writes}=await setup(page,true,false,{Inputs:{PalletUSDPerEA:'15'}});
 const field=dialog.getByLabel('Palletization ($/EA)',{exact:true});
 await expect(field).toHaveValue('15.5');
 await expect(field).toHaveAttribute('readonly','');
 await expect(dialog.getByLabel('Pallet cost ($/EA)',{exact:true})).toHaveCount(0);
 expect(writes).toHaveLength(0);
});
test('missing response palletization stays blank and explicit zero is retained',async({page})=>{
 for(const price of [null,'0']){
  const {dialog}=await setup(page,true,false,{Inputs:{PalletUSDPerEA:'15'}},2,price);
  await expect(dialog.getByLabel('Palletization ($/EA)',{exact:true})).toHaveValue(price??'');
 }
});


test('TCB Review displays saved Product loss and exposes its loss editor',async({page})=>{
 const {dialog}=await setup(page,false,false,{Inputs:{LossProcesses:lossMasters.slice(0,2)}});
 await expect(dialog.getByRole('region',{name:'Loss process',exact:true})).toHaveCount(0);
 await expect(dialog.getByText('Loss group',{exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'Add Product loss item 11',exact:true})).toBeVisible();
 const product=dialog.getByRole('region',{name:'Product',exact:true});
 await expect(product.getByText('Loss product (%)',{exact:true})).toHaveCount(0);
 const losses=dialog.getByRole('region',{name:'Product Loss item 11',exact:true});
 await expect(losses.getByText('Loss product (%)',{exact:true})).toBeVisible();
 await expect(losses.getByLabel('Product Loss Formula result item 11',{exact:true})).toHaveText('14.5%');
});
test('TCB Review uses its own tab and Packaging Summary appears only in Responses',async({page})=>{
 const {dialog}=await setup(page);
 await dialog.getByRole('button',{name:'Close TCB Review',exact:true}).click();
 await expect(page.getByRole('button',{name:'Loss processes for PRD-2 item 11',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'TCB Calculator for PRD-2 item 11',exact:true})).toHaveCount(0);
 const summary=page.getByRole('button',{name:'Packaging Summary for PRD-2 item 11',exact:true});
 await expect(summary).toHaveCount(0);
 for(const name of ['Product Info','Packaging Request','All Fields']){
  await page.getByRole('button',{name,exact:true}).click();await expect(summary).toHaveCount(0);
 }
 await page.getByRole('button',{name:'Packaging Responses',exact:true}).click();
 await expect(summary).toBeVisible();
 await page.getByRole('button',{name:'All Fields',exact:true}).click();
 await expect(summary).toHaveCount(0);
 await page.getByRole('button',{name:'TCB Review',exact:true}).click();
 await page.getByRole('button',{name:'TCB Review for PRD-2 item 11',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'TCB Review',exact:true}).getByRole('tab')).toHaveCount(0);
});

test('Product costs use horizontal component columns and pair cost with ratio',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});
 const {dialog}=await setup(page),product=dialog.locator('[aria-label="Product"]'),table=product.getByRole('table',{name:/Product costs item/});
 await expect(table.getByRole('columnheader')).toHaveText(['Raw material','Seasoning/salt','Oil']);
 await expect(table.getByRole('row')).toHaveCount(2);
 await expect(table.locator('input')).toHaveCount(5);
 await expect(table.getByLabel('Processing ($/lbs)',{exact:true})).toHaveCount(0);
 await expect(product.locator('.tcb-product-totals').getByLabel('Processing ($/lbs)',{exact:true})).toBeVisible();
 await expect(product.locator('.tcb-product-totals').getByText('Product ($/lbs)',{exact:true})).toBeVisible();
 for(const cell of await table.locator('td').all()){
  const box=(await cell.boundingBox())!;
  for(const field of await cell.locator('input').all()){
   const b=(await field.boundingBox())!;expect(b.x+b.width).toBeLessThanOrEqual(box.x+box.width-4);
  }
 }
 for(const pair of await table.locator('.tcb-product-cost-ratio').all()){
  const fields=await pair.locator('input').all();
  if(fields.length===2){
   const [a,b]=await Promise.all(fields.map(field=>field.boundingBox()));
   expect(Math.abs(a!.y-b!.y)).toBeLessThan(1);expect(b!.x).toBeGreaterThan(a!.x);
  }
 }
 const heading=table.locator('.field-label-text').first(),icon=table.locator('.info-tip').first();
 const head=(await heading.boundingBox())!,info=(await icon.boundingBox())!;
 expect(info.x).toBeGreaterThanOrEqual(head.x+head.width);
 expect(Math.abs(info.y+info.height/2-head.y-head.height/2)).toBeLessThan(2);
 for(const width of [900,390]){
  await page.setViewportSize({width,height:1000});
  expect(await product.evaluate(el=>{const own=el.querySelector('.tcb-product-scroll')!;return own.getBoundingClientRect().width-el.getBoundingClientRect().width})).toBeLessThanOrEqual(1);
  expect(await table.locator('..').evaluate(el=>el.scrollWidth>el.clientWidth)).toBeTruthy();
  await expect(table.getByRole('columnheader')).toHaveCount(3);
 }
});

test('packaging layers are horizontal columns with price and loss on one line and a separate pallet field',async({page})=>{
 for(const layers of [1,3]){
  await page.setViewportSize({width:1440,height:1000});
  const {dialog}=await setup(page,false,false,{},layers);
  const packaging=dialog.locator('[aria-label="Packaging"]'),table=packaging.getByRole('table');
  await expect(table.getByRole('columnheader')).toHaveCount(layers+1);
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table.getByRole('rowheader',{name:'PM price ($/EA) / Loss ratio (%)',exact:true})).toBeVisible();
  for(const cell of await table.locator('td').all()){
   const price=(await cell.locator('output').boundingBox())!,loss=(await cell.locator('input').boundingBox())!;
   expect(Math.abs(price.y+price.height/2-loss.y-loss.height/2)).toBeLessThan(1);
   expect(loss.x).toBeGreaterThan(price.x);
  }
  const inputs=table.locator('input'),bounds=await inputs.evaluateAll(elements=>elements.map(el=>el.getBoundingClientRect().toJSON()));
  expect(bounds).toHaveLength(layers);
  for(const field of bounds)expect(Math.abs(field.y-bounds[0].y)).toBeLessThan(1);
  await expect(packaging.getByLabel('Palletization ($/EA)',{exact:true})).toHaveCount(1);
  const pallet=(await packaging.getByLabel('Palletization ($/EA)',{exact:true}).boundingBox())!,box=(await table.boundingBox())!;
  expect(pallet.y).toBeGreaterThan(box.y+box.height);
  await page.setViewportSize({width:390,height:844});
  expect(await packaging.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
 }
});

test('standalone items offer read-only Analysis without enabling edits',async({page})=>{
 const {dialog,writes}=await setup(page,false,true);
 await expect(dialog.getByRole('button',{name:'Analysis',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Analysis',exact:true}).click();
 await expect(dialog.getByRole('region',{name:'TCB Analysis',exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Back to TCB inputs',exact:true}).click();
 await expect(dialog.getByLabel('RM Ratio (%)',{exact:true})).toBeDisabled();
 expect(writes).toHaveLength(0);
});
