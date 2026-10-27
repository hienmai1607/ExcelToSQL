import {test,expect,type Page} from '@playwright/test';
import {costs,changeRecipe,defaultInputs,money,packagingUSD,compareGradePaths} from '../src/tcb-model';
import {withTCBGrades,activeCostInputs} from '../src/tcb-grade-pricing';
import {classifyProcessLeaves,savedProcessTree} from '../src/grade-process';
const version='0x0000000000000001',rv='AAAAAAAAAAE=';
const grades=[{Path:'0/1',RawGradeID:1,RawMaterialID:10,Grade:'Almonds',Proportion:'.6'},{Path:'0/2',RawGradeID:2,RawMaterialID:11,Grade:'Cashew',Proportion:'.4'}];
const prices=[{PriceID:1,PriceVersion:version,RawGradeID:1,MaterialID:10,MaterialCode:'RM-A',VendorName:'Vendor A',QuantityFrom:0,QuantityTo:100,PriceBasis:'KG',USDPerLb:'2'},{PriceID:2,PriceVersion:version,RawGradeID:2,MaterialID:11,MaterialCode:'RM-B',VendorName:'Vendor B',QuantityFrom:100,QuantityTo:null,PriceBasis:'LB',USDPerLb:'4'}];
const row={OpportunityID:1,OpportunityNumber:'OPP-TCB',CustomerName:'Northstar',HeaderStage:'Draft',HeaderRowVersion:rv,ItemID:11,ProductID:2,ProductCode:'PRD-2',ProductName:'Almonds',ItemStage:'Draft',ItemRowVersion:rv,AnnualUnit:1000,WeightGrams:150,CustomerCurrencyCode:'AUD',ExchangeRateCustomerCurrencyPerUSD:'1.5',ExchangeRateVNDPerUSD:'25000',PackagingRequestID:9,ResponseLayerCount:2,PrimaryPricePerUnit:'2500',PrimaryPriceCurrencyCode:'VND',SecondaryPricePerUnit:'.3',SecondaryPriceCurrencyCode:'AUD',HasOpenPackagingRequest:true};
const lossMasters=[['Sorting','5',1],['Processing','10',2],['PrimaryPackaging','2',3],['PrimaryPackaging','3',4],['SecondaryPackaging','7',5],['PrimaryPackaging','5',6],['MixPrimaryPackaging','2',1],['MixSecondaryPackaging','3',2],['Processing','8',1]].map(([ProcessType,LossPct,Sequence],i)=>({MasterID:i+1,MasterVersion:version,ProcessType,LossPct,Sequence}));
async function setup(page:Page,mix=false,readonly=false,saved:Record<string,unknown>={},layers=2,palletUSD:string|null='15.5',quoteRows:Record<string,unknown>[]=prices,leafRows:typeof grades=grades){
 const writes:any[]=[];
 const item={...row,IsMixParent:mix,HeaderStage:readonly?'Closed':'Draft',ItemStage:readonly?'Approved':'Draft'};
 const tree=new Map<string,any>();
 for(const leaf of leafRows){const parts=leaf.Path.split('/');for(let n=2;n<=parts.length;n++){const path=parts.slice(0,n).join('/');if(!tree.has(path))tree.set(path,{ParentID:parts.slice(0,n-1).join('/'),ID:Number(parts[n-1]),Grade:n===parts.length?leaf.Grade:'Parent '+path,RawGradeID:leaf.RawGradeID,RawMaterialID:n===parts.length?leaf.RawMaterialID:null,RatioPct:'100'});}}
 for(const [path,node] of tree){const weight=(prefix:string)=>leafRows.filter(g=>g.Path===prefix||g.Path.startsWith(prefix+'/')).reduce((sum,g)=>sum+Number(g.Proportion),0);const denominator=weight(node.ParentID);node.RatioPct=String(Number((weight(path)/denominator*100).toFixed(2)));}
 const data={item:{ID:11,DefaultPalletUSDPerEA:palletUSD,LossLayerCount:layers,IsMixParent:mix,ProductCode:item.ProductCode,ProductName:item.ProductName,RowVersion:rv,HeaderStage:item.HeaderStage,ItemStage:item.ItemStage,ProductGradeSnapshot:JSON.stringify({items:mix?[]:[...tree.values()]})},saved,lossMasters,grades:mix?[]:leafRows,prices:mix?[]:quoteRows,gradeError:''};
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


test('grade paths sort numerically across mixed depths and multi-digit IDs',()=>{
 const paths=['0/4','0/5','0/1/10','0/2/1','0/1/2','0/1/1'];
 expect(paths.map(Path=>({Path})).sort(compareGradePaths).map(g=>g.Path)).toEqual(['0/1/1','0/1/2','0/1/10','0/2/1','0/4','0/5']);
});

test('grade reconciliation keeps unchanged quote, direct price and recipe, not new or replaced leaves',()=>{
 const items=[{ParentID:'0',ID:1,Grade:'A',RawGradeID:1,RawMaterialID:10,RatioPct:'50'},{ParentID:'0',ID:2,Grade:'B',RawGradeID:2,RawMaterialID:11,RatioPct:'50'}];
 const selections=[{Path:'0/1',PriceID:1,PriceVersion:version,ExpectedUSDPerLb:'2'},{Path:'0/2',DirectUSDPerLb:'4'}];
 const recipes=[{Path:'0/1',ProcessingUSDPerLb:'.1'},{Path:'0/2',ProcessingUSDPerLb:'.2'}];
 const d={grades:items,selections,costingInputs:{Prices:selections,MaterialCosts:recipes}};
 const next=withTCBGrades(d,[...items.map(g=>({...g,RatioPct:'40'})),{ParentID:'0',ID:3,Grade:'New',RawGradeID:3,RatioPct:'20'}]);
 expect(next.selections).toEqual(selections);
 expect(next.costingInputs.MaterialCosts).toEqual(recipes);
 expect(next.grades).toHaveLength(3);
 expect(d.grades).toHaveLength(2);
 const replaced=withTCBGrades(next,next.grades.map(g=>g.ID===2?{...g,RawGradeID:4,Grade:'Replacement'}:g));
 expect(replaced.selections).toEqual([selections[0]]);
 expect(replaced.costingInputs.MaterialCosts).toEqual([recipes[0]]);
 const removed=withTCBGrades(next,next.grades.filter(g=>g.ID!==1));
 expect(removed.selections).toEqual([selections[1]]);
 const parent=withTCBGrades(d,[...items,{ParentID:'0/1',ID:1,Grade:'Child',RawGradeID:5,RatioPct:'100'}]);
 expect(parent.selections).toEqual([selections[1]]);
});

test('process parent blends children and applies its recipe once, leaving raw siblings untouched',()=>{
 const items=[{ParentID:'0',ID:1,Grade:'Blend',RawGradeID:1,RatioPct:'60',Process:true},{ParentID:'0/1',ID:1,Grade:'A',RawGradeID:2,RatioPct:'25',Process:false},{ParentID:'0/1',ID:2,Grade:'B',RawGradeID:3,RatioPct:'75',Process:false},{ParentID:'0',ID:2,Grade:'Raw',RawGradeID:4,RatioPct:'40',Process:false}];
 const leaves=classifyProcessLeaves(items,[{Path:'0/1/1',Grade:'A',Proportion:'.15'},{Path:'0/1/2',Grade:'B',Proportion:'.45'},{Path:'0/2',Grade:'Raw',Proportion:'.4'}]);
 const selections=[{Path:'0/1/1',DirectUSDPerLb:'2'},{Path:'0/1/2',DirectUSDPerLb:'4'},{Path:'0/2',DirectUSDPerLb:'8'}];
 const input={...defaultInputs(),Prices:selections,ProcessingUSDPerLb:'99',MaterialCosts:[{Path:'0/1',RMRatio:'90',SeasoningRatio:'10',SeasoningUSDPerLb:'1',OilPct:'0',ProcessingUSDPerLb:'.2'}]};
 expect(money(costs(input,leaves,[]).rm)).toBe('5.30 USD');
 expect(money(costs(input,leaves,[]).product)).toBe('5.27 USD');
});

test('process toggles retain dormant child flags and recipes until save normalization',()=>{
 const items=[{ParentID:'0',ID:1,Grade:'Blend',RawGradeID:1,RatioPct:'100',Process:false},{ParentID:'0/1',ID:1,Grade:'Child',RawGradeID:2,RatioPct:'100',Process:true}];
 const selections=[{Path:'0/1/1',DirectUSDPerLb:'2'}];
 const d={grades:items,selections,costingInputs:{...defaultInputs(),Prices:selections,MaterialCosts:[{Path:'0/1/1',RMRatio:'100',SeasoningRatio:'0',OilPct:'0',ProcessingUSDPerLb:'.7'}]},quoteGrades:classifyProcessLeaves(items,[{Path:'0/1/1',Grade:'Child',Proportion:'1'}]),pricingGradeKey:JSON.stringify(items)};
 const on=withTCBGrades(d,items.map(g=>g.ParentID==='0'?{...g,Process:true}:g));
 expect(on.selections).toEqual(selections);
 expect(on.costingInputs.MaterialCosts.find(r=>r.Path==='0/1/1')?.ProcessingUSDPerLb).toBe('.7');
 expect(savedProcessTree(on.grades).map(g=>g.Process)).toEqual([true,false]);
 expect(activeCostInputs(on).MaterialCosts.map(r=>r.Path)).toEqual(['0/1']);
 const off=withTCBGrades(on,on.grades.map(g=>g.ParentID==='0'?{...g,Process:false}:g));
 expect(savedProcessTree(off.grades).map(g=>g.Process)).toEqual([false,true]);
 expect(activeCostInputs(off).MaterialCosts).toEqual(d.costingInputs.MaterialCosts);
 expect(money(costs({...off.costingInputs,Prices:off.selections},off.quoteGrades,[]).product)).toBe('2.70 USD');
});

test('raw price picker shows rounded text but saves the original quote precision',async({page})=>{
 const quotes=prices.map((p,i)=>({...p,QuantityFrom:'0.0000',QuantityTo:'1000.0000',USDPerLb:i?'4.000000000':'1.500000000'}));
 const {dialog,writes}=await setup(page,false,false,{},2,'15.5',quotes);
 await expect(dialog.getByRole('columnheader',{name:'Ratio',exact:true})).toHaveCount(1);
 await expect(dialog.getByRole('columnheader',{name:'Final proportion',exact:true})).toHaveCount(0);
 const first=dialog.getByLabel('Raw price item 11 grade 0/1');
 await expect(first.getByRole('option',{name:'RM-A · Vendor A · 0–1,000 KG · 1.50 USD/lb',exact:true})).toHaveCount(1);
 await first.selectOption('1:'+version+':1.500000000');
 await dialog.getByLabel('Raw price item 11 grade 0/2').selectOption('2:'+version+':4.000000000');
 await dialog.getByRole('button',{name:'Review & save',exact:true}).click();
 await dialog.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(dialog.getByText('Saved item settings for 1 item(s).')).toBeVisible();
 expect(writes[0].Prices[0]).toMatchObject({PriceID:1,ExpectedUSDPerLb:'1.500000000'});
});

test('pricing summary renders grade paths in numeric hierarchy order',async({page})=>{
 const leafRows=['0/4','0/5','0/1/10','0/2/1','0/1/2','0/1/1'].map((Path,i)=>({...grades[0],Path,Grade:'Grade '+i}));
 const {dialog}=await setup(page,false,false,{},2,'15.5',prices,leafRows);
 const labels=await dialog.locator('.commercial-price-table>tbody>tr:not(.material-recipe-row)>td:first-child').allTextContents();
 expect(labels.map(label=>label.split(' ')[0])).toEqual(['0/1/1','0/1/2','0/1/10','0/2/1','0/4','0/5']);
});

test('Process Info fits the viewport with inline fields and no nested scrollbars',async({page},info)=>{
 const {dialog}=await setup(page);
 for(const width of [1920,1440,1280,390]){
  await page.setViewportSize({width,height:1080});
  const table=dialog.getByRole('table',{name:'Process Info',exact:true}),row=table.locator('.tcb-process-row').first();
  await expect(table.getByRole('columnheader',{includeHidden:true})).toHaveCount(10);
  await expect(table.getByRole('button')).toHaveCount(0);
  await expect(table.locator('details')).toHaveCount(0);
  await expect(row.getByRole('spinbutton')).toHaveCount(6);
  const headers=await table.locator('thead th').evaluateAll(cells=>cells.map(cell=>{
   const range=document.createRange();range.selectNodeContents(cell);
   const rects=Array.from(range.getClientRects()),box=cell.getBoundingClientRect();
   return {lines:rects.length,right:rects[0]?.right??0,boxRight:box.right};
  }));
  if(width>1000)for(const header of headers){expect(header.lines).toBeLessThanOrEqual(2);expect(header.right).toBeLessThanOrEqual(header.boxRight+1)}
  expect(await table.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  const centers=await row.getByRole('spinbutton').evaluateAll(inputs=>inputs.map(input=>{const b=input.getBoundingClientRect();return b.y+b.height/2}));
  if(width>1000)for(const center of centers)expect(Math.abs(center-centers[0])).toBeLessThan(2);
  await table.screenshot({path:info.outputPath('process-table-'+width+'.png')});
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  const tree=dialog.locator('.grade-tree-scroll');
  expect(await tree.evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
  await expect(dialog.locator('details.tcb-grade-editor')).toHaveCount(0);
 }
});

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
 await dialog.getByLabel('RM Ratio (%)',{exact:true}).first().fill('90');
 await dialog.getByLabel('Seasoning/salt Ratio (%)',{exact:true}).first().fill('5');
 await dialog.getByLabel('Seasoning/salt ($/lbs)',{exact:true}).first().fill('1');
 await dialog.getByLabel('Oil %',{exact:true}).first().fill('5');
 await dialog.getByLabel('Oil ($/lbs)',{exact:true}).first().fill('2');
 await dialog.getByLabel('Processing ($/lbs)',{exact:true}).first().fill('.15');
 await expect(dialog.locator('.tcb-product-totals').getByText('2.86 USD',{exact:true})).toBeVisible();
 await expect(dialog.getByText('0.10 USD',{exact:true})).toBeVisible();
 await expect(dialog.getByText('0.20 USD',{exact:true})).toBeVisible();
 await expect(dialog.getByText('Mix Primary PM ($/EA)',{exact:true})).toHaveCount(0);
 await expect(dialog.getByLabel('Palletization ($/EA)')).toHaveValue('15.5');
 await expect(dialog.getByLabel('Palletization ($/EA)')).toHaveAttribute('readonly','');
 await dialog.getByRole('button',{name:'Review & save'}).click();
 await dialog.getByRole('button',{name:'Confirm save'}).click();
 await expect(dialog.getByText('Saved item settings for 1 item(s).')).toBeVisible();
 expect(writes[0]).toMatchObject({RowVersion:rv,CostInputs:{MaterialCosts:[{Path:'0/1',RMRatio:'90'}]},Prices:[{Path:'0/1',PriceID:1,PriceVersion:version},{Path:'0/2',PriceID:2,PriceVersion:version}]});
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
 await expect(dialog.getByLabel('RM Ratio (%)',{exact:true}).first()).toBeDisabled();
 await expect(dialog.getByRole('button',{name:'Review & save'})).toBeDisabled();
 await dialog.getByRole('button',{name:'Close TCB Review'}).click();
 await expect(page.getByRole('table',{name:'Opportunity items'})).toBeVisible();expect(writes).toEqual([]);
});
test('invalid total blocks save and unsaved close keeps the calculator when cancelled',async({page})=>{
 const {dialog,writes}=await setup(page);
 await dialog.getByLabel('RM Ratio (%)',{exact:true}).first().fill('99');
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

test('inline process recipes remain visible and independent',async({page})=>{
 const {dialog,writes}=await setup(page);
 const recipes=dialog.locator('.tcb-process-row');
 await expect(recipes).toHaveCount(2);
 await expect(dialog.getByRole('columnheader',{name:'RM ($/lbs)',exact:true})).toBeVisible();
 await expect(dialog.getByRole('columnheader',{name:'Line product ($/lbs)',exact:true})).toBeVisible();
 const fields=await recipes.nth(0).getByRole('spinbutton').all();
 expect(fields).toHaveLength(6);
 const boxes=await Promise.all(fields.map(field=>field.boundingBox()));
 for(const box of boxes)expect(Math.abs(box!.y-boxes[0]!.y)).toBeLessThan(2);

 await recipes.nth(0).getByLabel('Processing ($/lbs)',{exact:true}).fill('.5');
 await expect(recipes.nth(1).getByLabel('Processing ($/lbs)',{exact:true})).toHaveValue('0');
 await dialog.getByLabel('Raw price item 11 grade 0/1').selectOption('1:'+version+':2');
 await dialog.getByLabel('Raw price item 11 grade 0/2').selectOption('2:'+version+':4');
 await expect(dialog.locator('.tcb-product-totals').getByText('3.10 USD',{exact:true})).toBeVisible();

 await expect(recipes.nth(0).getByLabel('Processing ($/lbs)',{exact:true})).toBeVisible();
 await expect(dialog.getByRole('button',{name:/Cost details/})).toHaveCount(0);
 const line=dialog.locator('[data-process-path="0/1"]');
 await expect(line.locator('.material-line-total')).toHaveText('2.50 USD');

 await expect(recipes.nth(0).getByLabel('Processing ($/lbs)',{exact:true})).toHaveValue('.5');
 await dialog.getByRole('button',{name:'Review & save',exact:true}).click();
 await dialog.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0].CostInputs.MaterialCosts).toEqual([expect.objectContaining({Path:'0/1',ProcessingUSDPerLb:'.5'})]);
 await page.screenshot({path:'test-results/tcb-material-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});

 await page.screenshot({path:'test-results/tcb-material-mobile.png',fullPage:true});

 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
});
test('Product Loss variable list exposes the captured net weight without editing it',async({page})=>{
 const {dialog,writes}=await setup(page);
 await dialog.getByRole('button',{name:'Product Loss variables',exact:true}).click();
 const variables=page.getByRole('dialog',{name:'Product Loss variables',exact:true});
 await expect(variables.getByRole('cell',{name:'NW',exact:true})).toBeVisible();
 await expect(variables.getByRole('cell',{name:'150',exact:true})).toBeVisible();
 await expect(variables.getByRole('textbox')).toHaveCount(0);
 await variables.getByRole('button',{name:'Close variables',exact:true}).click();
 await expect(dialog).toBeVisible();expect(writes).toHaveLength(0);
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
 await expect(dialog.getByLabel('RM Ratio (%)',{exact:true}).first()).toBeDisabled();
 expect(writes).toHaveLength(0);
});


test('seasoning and oil edits balance RM for only the edited recipe',async({page})=>{
 const {dialog}=await setup(page);
 const rm=dialog.getByLabel('RM Ratio (%)',{exact:true});
 const salt=dialog.getByLabel('Seasoning/salt Ratio (%)',{exact:true}).first();
 const oil=dialog.getByLabel('Oil %',{exact:true}).first();
 await salt.fill('3');await expect(rm.first()).toHaveValue('97');
 await expect(rm.nth(1)).toHaveValue('100');
 await oil.fill('2');await expect(rm.first()).toHaveValue('95');
 await salt.fill('0.1');await oil.fill('0.2');await expect(rm.first()).toHaveValue('99.7');
 await salt.fill('0');await oil.fill('0');await expect(rm.first()).toHaveValue('100');
});

test('recipe remainder uses exact percentages and rejects an impossible remainder',()=>{
 expect(changeRecipe({SeasoningRatio:'0.123456',OilPct:'0.000001'},'SeasoningRatio','0.123456').RMRatio).toBe('99.876543');
 expect(changeRecipe({SeasoningRatio:'60',OilPct:'40'},'OilPct','40').RMRatio).toBe('0');
 expect(changeRecipe({SeasoningRatio:'60',OilPct:'40'},'OilPct','41').RMRatio).toBeNull();
 expect(changeRecipe({RMRatio:'100',SeasoningRatio:'0',OilPct:'0'},'ProcessingUSDPerLb','3').RMRatio).toBe('100');
});
