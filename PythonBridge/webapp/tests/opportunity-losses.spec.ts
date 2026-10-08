import {test,expect,type Page} from '@playwright/test';
const rv='AAAAAAAAAAE=',version='0x0000000000000001';
async function open(page:Page,failSecond=false,commercial=false,direct=false,root=10,analysis=false,loading='Both'){
 const writes:any[]=[];
 const common={OpportunityID:1,OpportunityNumber:'OPP-LOSS',CustomerName:'Customer',HeaderStage:'Draft',HeaderRowVersion:rv,ItemStage:'Draft',ItemRowVersion:rv,AnnualUnit:1000,WeightGrams:150};
 const rows=[{...common,ItemID:10,ItemNumber:'1',ProductCode:'MIX',ProductName:'Mix parent',ResponseLayerCount:2},{...common,ItemID:11,ParentItemID:10,ItemNumber:'1.1',ProductCode:'CHILD-A',ProductName:'Child A',ResponseLayerCount:1},{...common,ItemID:12,ParentItemID:10,ItemNumber:'1.2',ProductCode:'CHILD-B',ProductName:'Child B',ResponseLayerCount:2},{...common,ItemID:13,ItemNumber:'2',ProductCode:'LOCKED',ProductName:'Locked product',ItemStage:'Approved',ResponseLayerCount:1}];
 if(analysis){
  for(const r of rows)Object.assign(r,{ProductID:r.ItemID,EstPctAwarded:'50',CustomerCurrencyCode:'AUD',ExchangeRateCustomerCurrencyPerUSD:'1.5',PrimaryPricePerUnit:'.1',PrimaryPriceCurrencyCode:'USD',SecondaryPricePerUnit:'1',SecondaryPriceCurrencyCode:'USD',UnitsPerCarton:'10',UnitsPerPallet:'100',ConfigurationRequest:loading,ContainerRequest:'Dry',SelectedContainerType:'20DC',ContainerLoadProfiles:{'20DC':{PalletsPerContainer:10,CartonsPerContainerFloor:200}},ContainerLoadResults:{'20DC':{CalculatedCartonsPerContainer:100}},ShipmentCostInfo:{PackingUSDPerLb:'.5',InitialDesignUSD:'100',OtherFixedCostsUSD:'50',FobbingUSDPerContainer:'200',InterestPct:'12',InterestMonths:'10',MarginPct:'10'}});
  Object.assign(rows[0],{ProductMixSnapshot:{items:[{ProductID:11,UnitQuantity:2},{ProductID:12,UnitQuantity:1}]}});
  Object.assign(rows[1],{MixUnitQuantity:2});Object.assign(rows[2],{MixUnitQuantity:1,WeightGrams:450});
 }
 Object.assign(rows[1],{TCBFOBPerUnit:'3.6421',TCBDDPCustomerPerUnit:'5.46315',CustomerCurrencyCode:'AUD'});
 let reject=failSecond;
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Sales',user_id:1,is_admin:false,scopes:['Opportunity']}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/opportunity/grid')return route.fulfill({json:{rows,total:1,page:1}});
  if(path==='/api/opportunity/grade-lookups')return route.fulfill({json:{rows:[{ID:1,GradeName:'Almonds',ParentGradeID:null},{ID:2,GradeName:'NPX',ParentGradeID:1}],materials:[{ID:3,MaterialCode:'RAW-A',MaterialName:'Almonds',GradeID:2,Status:'Active'}]}});
  const snapshot={items:[{ParentID:'0',ID:1,RawGradeID:1,Grade:'Almonds',RatioPct:'100'},{ParentID:'0/1',ID:1,RawGradeID:2,Grade:'NPX',RatioPct:'100',RawMaterialID:3}]};
  const grades=[{Path:'0/1/1',Grade:'NPX',RawGradeID:2,RawMaterialID:3,Proportion:'1'}];
  const prices=[{PriceID:8,PriceVersion:version,RawGradeID:2,MaterialID:3,MaterialCode:'RAW-A',VendorName:'Vendor A',QuantityFrom:0,QuantityTo:null,PriceBasis:'lbs',USDPerLb:'2.00'}];
  const cm=path.match(/\/items\/(\d+)\/commercial(?:\/(preview))?$/);
  if(cm){const body=route.request().postDataJSON();if(cm[2])return route.fulfill({json:{grades,prices,saved:{RMCostUSDPerLb:body.Prices.length?'2.00':null},LossProductPct:'0'}});writes.push({id:Number(cm[1]),...body});return route.fulfill({json:{RowVersion:'AAAAAAAAAAI=',grades,prices}})}
  const match=path.match(/\/items\/(\d+)\/(tcb|loss-formula|loss-processes)$/);
  if(match){
   const id=Number(match[1]),row=rows.find(r=>r.ItemID===id)!;
   if(match[2]==='tcb')return route.fulfill({json:{item:{ID:id,RowVersion:rv,HeaderStage:'Draft',ItemStage:row.ItemStage,IsMixParent:id===10,LossLayerCount:row.ResponseLayerCount,...(commercial&&id!==10?{ProductGradeSnapshot:JSON.stringify(snapshot),HasOpenPackagingRequest:id===12}:{})},saved:commercial?{Inputs:{RMRatio:'100',SeasoningRatio:'0',OilPct:'0',Prices:direct?[{Path:'0/1/1',DirectUSDPerLb:'3.25'}]:[{Path:'0/1/1',PriceID:8,PriceVersion:version,ExpectedUSDPerLb:'2.00'}]}}:{},lossMasters:[{MasterID:1,MasterVersion:version,ProcessType:'Processing',ProcessName:'Sorting',Sequence:1,LossPct:'0'}],grades:commercial&&id!==10?grades:[],prices:commercial?prices:[],gradeError:''}});
   if(match[2]==='loss-formula')return route.fulfill({json:{LossProductPct:'5'}});
   const body=route.request().postDataJSON();writes.push({id,...body});
   if(reject&&id===12){reject=false;return route.fulfill({status:409,json:{detail:'Item changed. Refresh before saving.'}})}
   return route.fulfill({json:{RowVersion:'AAAAAAAAAAI='}});
  }
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('/workbench/');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'View details',exact:true}).click();
 await page.getByRole('button',{name:'Product Info',exact:true}).click();
 await page.getByRole('button',{name:root===10?'TCB Review for MIX item 10':'TCB Review for LOCKED item 13',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'TCB Review',exact:true});
 await expect(dialog.getByLabel('Packaging loss ratio item '+root+' layer 1',{exact:true})).toBeVisible();
 return {dialog,writes};
}
test('TCB Review grid tab and layout expose read-only calculated columns and subgroups',async({page})=>{
 const {dialog}=await open(page);
 await dialog.getByRole('button',{name:'Close TCB Review',exact:true}).click();
 await page.getByRole('button',{name:'TCB Review',exact:true}).click();
 const table=page.getByRole('table',{name:'Opportunity items',exact:true});
 await expect(table.getByRole('columnheader',{name:'FOB Costing',exact:true})).toBeVisible();
 await expect(table.getByRole('columnheader',{name:'Destination Logistics',exact:true})).toBeVisible();
 await expect(table.getByRole('columnheader',{name:'Selling Totals',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Show mix children for Item 1',exact:true}).click();
 await expect(table.getByText('3.6421 USD',{exact:true})).toBeVisible();
 await expect(table.getByText('5.46315 AUD',{exact:true})).toBeVisible();
 await expect(table.getByRole('button',{name:'Sort by FOB ($/unit)',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Item layout',exact:true}).click();
 const group=page.getByRole('region',{name:'Visible TCB Review / FOB Costing',exact:true});
 await expect(group.getByLabel('FOB ($/unit)',{exact:true})).toBeChecked();
 await group.getByLabel('FOB ($/unit)',{exact:true}).uncheck();
 await expect(table.getByRole('button',{name:'Sort by FOB ($/unit)',exact:true})).toHaveCount(0);
});
test('TCB validation identifies each item and focuses an invalid field without floating alerts',async({page})=>{
 const {dialog,writes}=await open(page,false,true);
 const childA=dialog.locator('#tcb-item-11'),childB=dialog.locator('#tcb-item-12');
 await dialog.getByLabel('RM Ratio (%)',{exact:true}).nth(0).fill('90');
 await dialog.getByLabel('RM Ratio (%)',{exact:true}).nth(1).fill('80');
 const summary=dialog.getByRole('region',{name:'TCB validation summary'});
 await expect(summary.getByRole('button',{name:/1.1.*Child A/})).toBeVisible();
 await expect(summary.getByRole('button',{name:/1.2.*Child B/})).toBeVisible();
 await expect(childA.getByLabel('RM Ratio (%)',{exact:true})).toHaveAttribute('aria-invalid','true');
 await childB.locator(':scope > summary').click();
 await summary.getByRole('button',{name:/1.2.*Child B/}).click();
 await expect(childB).toHaveAttribute('open','');
 await expect(childB.getByLabel('RM Ratio (%)',{exact:true})).toBeFocused();
 await expect(dialog.locator('.floating-notification')).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'Review & save',exact:true})).toBeDisabled();
 await childA.getByLabel('RM Ratio (%)',{exact:true}).fill('100');
 await childB.getByLabel('RM Ratio (%)',{exact:true}).fill('100');
 await expect(summary).toHaveCount(0);
 expect(writes).toHaveLength(0);
});
test('TCB loss validation stays beside the ratio and summary focuses the correct item',async({page})=>{
 const {dialog,writes}=await open(page,false,true);
 const ratio=dialog.getByLabel('Packaging loss ratio item 12 layer 2',{exact:true});
 await ratio.fill('101');
 await expect(ratio).toHaveAttribute('aria-invalid','true');
 const message=await ratio.getAttribute('aria-describedby');
 await expect(dialog.locator('[id="'+message+'"]')).toContainText('Each process loss');
 const summary=dialog.getByRole('region',{name:'TCB validation summary'});
 await summary.getByRole('button',{name:/1.2.*Child B/}).click();
 await expect(ratio).toBeFocused();
 await ratio.fill('1');
 await expect(summary).toHaveCount(0);
 await dialog.getByRole('button',{name:'Add Product loss item 11',exact:true}).click();
 const product=dialog.getByLabel('Product loss ratio item 11 row 1',{exact:true});
 await product.fill('3.123');
 await expect(product).toHaveAttribute('aria-invalid','true');
 await summary.getByRole('button',{name:/1.1.*Child A/}).click();
 await expect(product).toBeFocused();
 await expect(dialog.locator('.floating-notification')).toHaveCount(0);
 expect(writes).toHaveLength(0);
});
test('TCB two-row headings never overlap while scrolling',async({page})=>{
 const {dialog}=await open(page);
 await dialog.getByRole('button',{name:'Close TCB Review',exact:true}).click();
 await page.getByRole('button',{name:'TCB Review',exact:true}).click();
 const table=page.getByRole('table',{name:'Opportunity items',exact:true});
 const bounds=await table.evaluate(table=>{
  const wrap=table.parentElement!;wrap.style.height='100px';
  table.querySelector('tbody')!.append(...Array.from({length:20},()=>table.querySelector('tbody tr')!.cloneNode(true)));
  wrap.scrollTop=150;
  return new Promise<{bottom:number;top:number}>(resolve=>requestAnimationFrame(()=>{
   const rows=table.querySelectorAll('thead tr');
   resolve({bottom:rows[0].querySelector('th')!.getBoundingClientRect().bottom,top:rows[1].querySelector('th')!.getBoundingClientRect().top});
  }));
 });
 expect(bounds.top).toBeGreaterThanOrEqual(bounds.bottom-1);
});
test('TCB Review includes its parent and children but excludes unrelated items',async({page})=>{
 const {dialog,writes}=await open(page);
 await expect(dialog.getByRole('region',{name:'Product Loss item 10',exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Add Product loss item 11',exact:true}).click();
 await dialog.getByLabel('Product loss ratio item 11 row 1',{exact:true}).fill('5');
 await dialog.getByLabel('Product Loss Formula item 11',{exact:true}).fill('L1');
 await expect(dialog.getByLabel('Packaging loss ratio item 10 layer 2',{exact:true})).toBeVisible();
 await expect(dialog.getByLabel('Packaging loss ratio item 11 layer 2',{exact:true})).toHaveCount(0);
 await expect(dialog.getByLabel('Packaging loss ratio item 13 layer 1',{exact:true})).toHaveCount(0);
 await dialog.getByLabel('Packaging loss ratio item 10 layer 1',{exact:true}).fill('2');
 await dialog.getByLabel('Packaging loss ratio item 12 layer 2',{exact:true}).fill('3');
 await dialog.getByRole('button',{name:'Review & save',exact:true}).click();
 await expect(dialog.getByRole('region',{name:'Review Opportunity losses',exact:true})).toBeVisible();
 expect(writes).toHaveLength(0);
 await dialog.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(dialog.getByText('Saved losses for 3 item(s).',{exact:true})).toBeVisible();
 expect(writes.map(w=>w.id)).toEqual([10,11,12]);
 expect(writes[1].Inputs.ProductLossFormula).toBe('L1');
 expect(writes[0].Inputs.LossProcesses[0]).toMatchObject({ProcessType:'MixPrimaryPackaging',LossPct:'2'});
});
test('partial failure retains remaining edits and retry does not resend saved items',async({page})=>{
 const {dialog,writes}=await open(page,true);
 await dialog.getByLabel('Packaging loss ratio item 11 layer 1',{exact:true}).fill('2');
 await dialog.getByLabel('Packaging loss ratio item 12 layer 1',{exact:true}).fill('3');
 await dialog.getByRole('button',{name:'Review & save',exact:true}).click();
 await dialog.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(dialog.getByText(/Saved 1 item\(s\). Remaining changes are retained/)).toBeVisible();
 await expect(dialog.getByLabel('Packaging loss ratio item 12 layer 1',{exact:true})).toHaveValue('3');
 await dialog.getByRole('button',{name:'Review & save',exact:true}).click();
 await dialog.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(dialog.getByText('Saved losses for 1 item(s).',{exact:true})).toBeVisible();
 expect(writes.map(w=>w.id)).toEqual([11,12,12]);
});
test('TCB Review has no copy controls and editing one item leaves siblings unchanged',async({page})=>{
 const {dialog}=await open(page);
 await expect(dialog.getByLabel('Copy loss section',{exact:true})).toHaveCount(0);
 await expect(dialog.getByLabel('Copy losses from item',{exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'Copy losses to selected items',exact:true})).toHaveCount(0);
 await expect(dialog.getByText('Select for copying',{exact:true})).toHaveCount(0);
 const sibling=dialog.getByLabel('Packaging loss ratio item 11 layer 1',{exact:true}),before=await sibling.inputValue();
 await dialog.getByLabel('Packaging loss ratio item 10 layer 1',{exact:true}).fill('4');
 await expect(sibling).toHaveValue(before);
 page.once('dialog',d=>d.dismiss());
 await dialog.getByRole('button',{name:'Close TCB Review',exact:true}).click();
 await expect(dialog).toBeVisible();
});

test('grades and existing raw quotes edit across items without master price overrides',async({page})=>{
 const {dialog,writes}=await open(page,false,true);
 await dialog.locator('details').filter({hasText:'CHILD-A'}).getByText('Edit grades',{exact:true}).click();
 await dialog.getByLabel('Raw Material 0/1/1',{exact:true}).selectOption('');
 await dialog.getByRole('button',{name:'Load pricing for current grades',exact:true}).click();
 const quote=dialog.getByLabel('Raw price item 11 grade 0/1/1',{exact:true});
 await expect(quote).toHaveValue('');
 await quote.selectOption('8:'+version+':2.00');
 await expect(dialog.getByLabel('Direct USD/lb item 11 grade 0/1/1',{exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Review & save',exact:true}).click();
 await dialog.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(dialog.getByText('Saved item settings for 1 item(s).',{exact:true})).toBeVisible();
 expect(writes).toHaveLength(1);
 expect(writes[0].Grades.items[1].RawMaterialID).toBeNull();
 expect(writes[0].Prices).toEqual([{Path:'0/1/1',PriceID:8,PriceVersion:version,ExpectedUSDPerLb:'2.00'}]);
});
test('active PCR locks grades but not raw pricing; Mix parent has no raw price inputs',async({page})=>{
 const {dialog}=await open(page,false,true);
 await dialog.getByText('View grades (captured by Packaging Request)',{exact:true}).click();
 await expect(dialog.getByText(/Grades are captured by an active Packaging Request/)).toBeVisible();
 await expect(dialog.locator('details').filter({hasText:'CHILD-B'}).getByLabel('Ratio 0/1/1',{exact:true})).toHaveCount(0);
 await expect(dialog.getByLabel('Raw price item 12 grade 0/1/1',{exact:true})).toBeEnabled();
 await expect(dialog.locator('details').filter({hasText:'MIX'}).getByRole('heading',{name:'Product',exact:true})).toHaveCount(0);
 await expect(dialog.getByLabel(/^Raw price item 10 /)).toHaveCount(0);
});

test('combined TCB Review edits parent pallet, child cost and packaging loss together',async({page})=>{
 const {dialog,writes}=await open(page,false,true);
 const parent=dialog.locator('details').filter({hasText:'MIX'});
 const child=dialog.locator('details').filter({hasText:'CHILD-A'});
 await expect(parent.getByRole('heading',{name:'Product',exact:true})).toHaveCount(0);
 await expect(child.getByLabel('Pallet cost ($/EA)',{exact:true})).toHaveCount(0);
 await expect(dialog.getByText(/LOCKED/)).toHaveCount(0);
 await parent.getByLabel('Pallet cost ($/EA)',{exact:true}).fill('12');
 await child.getByLabel('Processing ($/lbs)',{exact:true}).fill('.5');
 await expect(child.getByText('2.50 USD',{exact:true})).toBeVisible();
 await dialog.getByLabel('Packaging loss ratio item 11 layer 1',{exact:true}).fill('2');
 await dialog.getByRole('button',{name:'Review & save',exact:true}).click();
 await dialog.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(dialog.getByText('Saved item settings for 2 item(s).',{exact:true})).toBeVisible();
 expect(writes.map(w=>w.id)).toEqual([10,11]);
 expect(writes[0].CostInputs.PalletUSDPerEA).toBe('12');
 expect(writes[1].CostInputs.ProcessingUSDPerLb).toBe('.5');
 expect(writes[1].Prices[0].PriceID).toBe(8);
 expect(writes[1].Inputs.LossProcesses[0].LossPct).toBe('2');
});

test('TCB combines pricing and inline grades with validated Opportunity-only direct prices',async({page})=>{
 const {dialog,writes}=await open(page,false,true);
 await expect(dialog.getByRole('tab',{name:'Raw Pricing',exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('tab',{name:'Nuts Grades',exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('tab')).toHaveCount(0);
 const manual=dialog.getByLabel('Direct price item 11 grade 0/1/1',{exact:true});
 await expect(manual.locator('..')).not.toContainText('Direct');
 await expect(manual.locator('../..').getByRole('note')).toHaveCount(1);
 const master=dialog.getByLabel('Raw price item 11 grade 0/1/1',{exact:true});
 await manual.check();
 await expect(master).toBeDisabled();
 const amount=dialog.getByLabel('Direct USD/lb item 11 grade 0/1/1',{exact:true});
 await expect(dialog.getByRole('button',{name:'Review & save',exact:true})).toBeDisabled();
 await amount.fill('-1');
 await expect(dialog.getByRole('button',{name:'Review & save',exact:true})).toBeDisabled();
 await amount.fill('0');
 await expect(dialog.getByText('0.00 USD',{exact:true})).toHaveCount(2);
 await manual.uncheck();
 await expect(master).toBeEnabled();
 await master.selectOption('8:'+version+':2.00');
 await manual.check();
 await amount.fill('3.25');
 await expect(dialog.getByText('3.25 USD',{exact:true})).toHaveCount(2);
 await dialog.getByRole('button',{name:'Review & save',exact:true}).click();
 await dialog.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(dialog.getByText('Saved item settings for 1 item(s).',{exact:true})).toBeVisible();
 expect(writes[0].Prices).toEqual([{Path:'0/1/1',DirectUSDPerLb:'3.25'}]);
 expect(writes[0].Grades).toBeUndefined();
});

test('saved direct prices reopen checked and read-only item price inputs stay disabled',async({page})=>{
 const {dialog}=await open(page,false,true,true);
 await expect(dialog.getByLabel('Direct price item 11 grade 0/1/1',{exact:true})).toBeChecked();
 await expect(dialog.getByLabel('Direct USD/lb item 11 grade 0/1/1',{exact:true})).toHaveValue('3.25');
 await expect(dialog.getByLabel('Direct price item 13 grade 0/1/1',{exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Close TCB Review',exact:true}).click();
 await page.getByRole('button',{name:'TCB Review for LOCKED item 13',exact:true}).click();
 await expect(dialog.getByLabel('Direct price item 13 grade 0/1/1',{exact:true})).toBeDisabled();
 await expect(dialog.getByLabel('Direct USD/lb item 13 grade 0/1/1',{exact:true})).toBeDisabled();
});

test('Packaging Loss can be edited and saved twice without closing the popup',async({page})=>{
 const {dialog,writes}=await open(page);
 const ratio=dialog.getByLabel('Packaging loss ratio item 11 layer 1',{exact:true});
 for(const value of ['2','3']){
  await expect(ratio).toBeEnabled();
  await ratio.fill(value);
  await expect(dialog.getByRole('button',{name:'Review & save',exact:true})).toBeEnabled();
  await dialog.getByRole('button',{name:'Review & save',exact:true}).click();
  await dialog.getByRole('button',{name:'Confirm save',exact:true}).click();
  await expect(dialog.getByText('Saved losses for 1 item(s).',{exact:true})).toBeVisible();
  await expect(ratio).toHaveValue(value);
 }
 expect(writes).toHaveLength(2);
 expect(writes[0].RowVersion).toBe(rv);
 expect(writes[1].RowVersion).toBe('AAAAAAAAAAI=');
 expect(writes[1].Inputs.LossProcesses[0].LossPct).toBe('3');
});
test('TCB direct prices can be changed and saved twice without closing the popup',async({page})=>{
 const {dialog,writes}=await open(page,false,true,true);
 const price=dialog.getByLabel('Direct USD/lb item 11 grade 0/1/1',{exact:true});
 for(const value of ['4','5']){
  await price.fill(value);
  await expect(dialog.getByRole('button',{name:'Review & save',exact:true})).toBeEnabled();
  await dialog.getByRole('button',{name:'Review & save',exact:true}).click();
  await dialog.getByRole('button',{name:'Confirm save',exact:true}).click();
  await expect(dialog.getByText('Saved item settings for 1 item(s).',{exact:true})).toBeVisible();
 }
 expect(writes).toHaveLength(2);
 expect(writes[1].RowVersion).toBe('AAAAAAAAAAI=');
 expect(writes[1].Prices[0].DirectUSDPerLb).toBe('5');
});

test('TCB Review launcher is parent-only in Product Info and scopes standalone items separately',async({page})=>{
 const {dialog}=await open(page,false,true);
 await dialog.getByRole('button',{name:'Close TCB Review',exact:true}).click();
 const parent=page.getByRole('button',{name:'TCB Review for MIX item 10',exact:true});
 const standalone=page.getByRole('button',{name:'TCB Review for LOCKED item 13',exact:true});
 await expect(parent).toBeVisible();await expect(standalone).toBeVisible();
 await expect(page.getByRole('button',{name:/Edit all item losses/})).toHaveCount(0);
 await page.getByRole('button',{name:'Show mix children for Item 1',exact:true}).click();
 await expect(page.getByRole('button',{name:/TCB Review for CHILD/})).toHaveCount(0);
 for(const name of ['All Fields','Packaging Request','Packaging Responses']){
  await page.getByRole('button',{name,exact:true}).click();
  await expect(parent).toHaveCount(0);await expect(standalone).toHaveCount(0);
 }
 await page.getByRole('button',{name:'Product Info',exact:true}).click();
 await standalone.click();
 await expect(dialog.getByLabel('Packaging loss ratio item 13 layer 1',{exact:true})).toBeDisabled();
 await expect(dialog.getByLabel('Packaging loss ratio item 10 layer 1',{exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('tab')).toHaveCount(0);
});

test('Product Loss runs horizontally and renumbers left to right after removal',async({page})=>{
 const {dialog,writes}=await open(page);
 const section=dialog.getByRole('region',{name:'Product Loss item 11',exact:true});
 for(let i=1;i<=3;i++){
  await section.getByRole('button',{name:'Add Product loss item 11',exact:true}).click();
  await section.getByLabel('Product loss ratio item 11 row '+i,{exact:true}).fill(String(4-i));
 }
 const table=section.getByRole('table');
 for(const code of ['L1','L2','L3'])await expect(table.getByRole('columnheader',{name:code,exact:true})).toBeVisible();
 await expect(table.getByRole('row')).toHaveCount(2);
 for(let i=1;i<=3;i++){
  const type=await section.getByLabel('Loss type item 11 row '+i,{exact:true}).boundingBox();
  const ratio=await section.getByLabel('Product loss ratio item 11 row '+i,{exact:true}).boundingBox();
  const remove=section.getByRole('button',{name:'Remove Product loss item 11 row '+i,exact:true});
  await expect(table.locator('thead').getByRole('button',{name:'Remove Product loss item 11 row '+i,exact:true})).toBeVisible();
  const removeBox=await remove.boundingBox();
  expect(type).not.toBeNull();expect(ratio).not.toBeNull();expect(removeBox).not.toBeNull();
  expect(type!.y).toBeCloseTo(ratio!.y,0);
  expect(ratio!.x).toBeGreaterThan(type!.x);
  expect(removeBox!.y+removeBox!.height).toBeLessThan(type!.y);
 }
 const boxes=await Promise.all([1,2,3].map(i=>section.getByLabel('Product loss ratio item 11 row '+i,{exact:true}).boundingBox()));
 expect(boxes.every(b=>b!==null)).toBeTruthy();
 expect(boxes[1]!.y).toBeCloseTo(boxes[0]!.y,0);
 expect(boxes[2]!.y).toBeCloseTo(boxes[0]!.y,0);
 expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x);
 expect(boxes[2]!.x).toBeGreaterThan(boxes[1]!.x);
 await page.setViewportSize({width:600,height:900});
 const scroll=section.getByLabel('Product loss processes item 11',{exact:true});
 expect(await scroll.evaluate(el=>el.scrollWidth>el.clientWidth)).toBeTruthy();
 await section.getByRole('button',{name:'Remove Product loss item 11 row 2',exact:true}).click();
 await expect(table.getByRole('columnheader',{name:'L3',exact:true})).toHaveCount(0);
 await expect(section.getByLabel('Product loss ratio item 11 row 2',{exact:true})).toHaveValue('1');
 await dialog.getByRole('button',{name:'Review & save',exact:true}).click();
 await dialog.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(dialog.getByText('Saved losses for 1 item(s).',{exact:true})).toBeVisible();
 expect(writes[0].Inputs.LossProcesses.filter((s:any)=>s.ProcessType==='Processing').map((s:any)=>[s.Sequence,s.LossPct])).toEqual([[1,'3'],[2,'1']]);
});

test('Add is in the loss header and formula test stays inline without saving',async({page})=>{
 const {dialog,writes}=await open(page);
 const section=dialog.getByRole('region',{name:'Product Loss item 11',exact:true});
 await section.locator('thead').getByRole('button',{name:'Add Product loss item 11',exact:true}).click();
 const formula=section.getByLabel('Product Loss Formula item 11',{exact:true});
 await formula.fill('L1');
 const ratio=section.getByLabel('Product loss ratio item 11 row 1',{exact:true});
 await ratio.fill('5');
 const button=section.getByRole('button',{name:'Test calculation item 11',exact:true});
 const result=section.getByLabel('Product Loss Formula result item 11',{exact:true});
 await button.click();
 await expect(result).toHaveText('5%');
 expect(writes).toHaveLength(0);
 const boxes=await Promise.all([formula,button,result].map(el=>el.boundingBox()));
 expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x);
 expect(boxes[2]!.x).toBeGreaterThan(boxes[1]!.x);
 expect(boxes[2]!.y).toBeLessThan(boxes[1]!.y+boxes[1]!.height);
 expect(boxes[2]!.y+boxes[2]!.height).toBeGreaterThan(boxes[1]!.y);
 await ratio.fill('6');
 await expect(result).toHaveText('');
 await button.click();
 await expect(result).toHaveText('5%');
 await formula.fill('L1+');
 await expect(result).toHaveText('');
 await page.route('**/api/opportunity/items/11/loss-formula',route=>route.fulfill({status:422,json:{detail:'Invalid loss formula.'}}));
 await button.click();
 await expect(dialog.getByText('Invalid loss formula.',{exact:true})).toBeVisible();
 await expect(result).toHaveText('');
 expect(writes).toHaveLength(0);
});

test('Analysis help escapes scrolling table clipping and stays within the dialog',async({page})=>{
 const {dialog}=await open(page,false,true,false,10,true,'Pallet load');
 await dialog.getByRole('button',{name:'Analysis',exact:true}).click();
 const analysis=dialog.getByRole('region',{name:'TCB Analysis',exact:true});
 for(const width of [1920,390]){
  await page.setViewportSize({width,height:900});
  for(const name of ['Self Packaging ($/unit)','FOB (customer currency/unit)']){
   const help=analysis.getByRole('rowheader',{name,exact:true}).getByRole('note');
   await help.scrollIntoViewIfNeeded();await help.focus();
   const tooltip=page.getByRole('tooltip');
   await expect(tooltip).toBeVisible();
   expect(await tooltip.evaluate(el=>el.matches(':popover-open'))).toBeTruthy();
   const tip=(await tooltip.boundingBox())!,box=(await dialog.boundingBox())!;
   expect(tip.x).toBeGreaterThanOrEqual(Math.max(0,box.x));
   expect(tip.x+tip.width).toBeLessThanOrEqual(Math.min(width,box.x+box.width));
   expect(tip.y).toBeGreaterThanOrEqual(Math.max(0,box.y));
   expect(tip.y+tip.height).toBeLessThanOrEqual(Math.min(900,box.y+box.height));
   expect(await tooltip.evaluate(el=>getComputedStyle(el).textTransform)).toBe('none');
   await help.press('Escape');await expect(tooltip).toBeHidden();
   await help.blur();
  }
 }
});

test('Analysis icon shows one child-only table, preserves edits and does not save',async({page})=>{
 const {dialog,writes}=await open(page,false,true,false,10,true,'Pallet load');
 const parent=dialog.locator('details').filter({hasText:'MIX'});
 const child=dialog.locator('details').filter({hasText:'CHILD-A'});
 await parent.getByLabel('Pallet cost ($/EA)',{exact:true}).fill('12');
 await child.getByLabel('Processing ($/lbs)',{exact:true}).fill('.5');
 await dialog.getByRole('button',{name:'Add Product loss item 11',exact:true}).click();
 await dialog.getByLabel('Product loss ratio item 11 row 1',{exact:true}).fill('5');
 await dialog.getByLabel('Product Loss Formula item 11',{exact:true}).fill('L1');
 const launcher=dialog.getByRole('button',{name:'Analysis',exact:true});
 await expect(launcher.locator('svg')).toHaveCount(1);await expect(launcher).toHaveText('');
 await launcher.click();
 const analysis=dialog.getByRole('region',{name:'TCB Analysis',exact:true});
 await expect(analysis).toBeVisible();
 await expect(dialog.getByLabel('TCB Review items',{exact:true})).toHaveCount(0);
 const pallet=analysis.getByRole('table',{name:'20DC analysis',exact:true});
 await expect(analysis.getByRole('table')).toHaveCount(1);
 await expect(pallet.getByRole('row')).toHaveCount(29);
 await expect(pallet.getByRole('columnheader')).toHaveCount(3);
 await expect(pallet.getByRole('rowheader',{name:'DDP (customer currency/unit)',exact:true})).toBeVisible();
 expect(await pallet.locator('.analysis-section-start th').evaluate(el=>getComputedStyle(el).borderTopWidth)).toBe('4px');
 await expect(pallet.getByRole('columnheader',{name:/MIX/})).toHaveCount(0);
 const shared=pallet.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Parent Packaging ($/unit)',exact:true})});
 expect(await shared.getByRole('cell').allTextContents()).toEqual(['0.07 USD','0.07 USD']);
 const palletCost=pallet.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Pallet ($/unit)',exact:true})});
 expect(await palletCost.getByRole('cell').allTextContents()).toEqual(['0.04 USD','0.04 USD']);
 await expect(pallet.getByRole('row').filter({has:page.getByRole('rowheader',{name:'FOB ($/unit)',exact:true})}).getByText('Incomplete',{exact:true})).toHaveCount(0);
 expect(writes).toHaveLength(0);
 await page.setViewportSize({width:600,height:900});
 expect(await analysis.getByRole('region',{name:'20DC analysis table',exact:true}).evaluate(el=>el.scrollWidth>el.clientWidth)).toBeTruthy();
 await dialog.getByRole('button',{name:'Back to TCB inputs',exact:true}).click();
 await expect(child.getByLabel('Processing ($/lbs)',{exact:true})).toHaveValue('.5');
 await expect(parent.getByLabel('Pallet cost ($/EA)',{exact:true})).toHaveValue('12');
 await expect(dialog.getByLabel('Product Loss Formula result item 11',{exact:true})).toHaveText('5%');
 await dialog.getByRole('button',{name:'Review & save',exact:true}).click();
 await dialog.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(dialog.getByText('Saved item settings for 2 item(s).',{exact:true})).toBeVisible();
 expect(writes.map(w=>w.id)).toEqual([10,11]);
});
test('Analysis flags incomplete costs without writes and formula failures keep the inputs',async({page})=>{
 const {dialog,writes}=await open(page);
 await dialog.getByRole('button',{name:'Analysis',exact:true}).click();
 const analysis=dialog.getByRole('region',{name:'TCB Analysis',exact:true});
 const fob=analysis.getByRole('row').filter({has:page.getByRole('rowheader',{name:'FOB ($/unit)',exact:true})});
 await expect(fob.getByText('Incomplete',{exact:true})).toHaveCount(2);
 expect(writes).toHaveLength(0);
 await dialog.getByRole('button',{name:'Back to TCB inputs',exact:true}).click();
 await dialog.getByLabel('Product Loss Formula item 11',{exact:true}).fill('L1+');
 await page.route('**/api/opportunity/items/11/loss-formula',route=>route.fulfill({status:422,json:{detail:'Invalid loss formula.'}}));
 await dialog.getByRole('button',{name:'Analysis',exact:true}).click();
 await expect(dialog.getByText('Invalid loss formula.',{exact:true})).toBeVisible();
 await expect(dialog.getByRole('region',{name:'TCB Analysis',exact:true})).toHaveCount(0);
 expect(writes).toHaveLength(0);
});

test('Both is deferred in a single child Analysis table without separate loading results',async({page})=>{
 const {dialog,writes}=await open(page,false,true,false,10,true);
 await dialog.getByRole('button',{name:'Analysis',exact:true}).click();
 const analysis=dialog.getByRole('region',{name:'TCB Analysis',exact:true});
 await expect(analysis.getByRole('table')).toHaveCount(1);
 await expect(analysis.getByRole('heading',{name:/Pallet load|Floor load/})).toHaveCount(0);
 const row=analysis.getByRole('row').filter({has:page.getByRole('rowheader',{name:'FOB ($/unit)',exact:true})});
 await expect(row.getByText('Incomplete',{exact:true})).toHaveCount(2);
 await expect(row.getByText(/loading calculation is deferred/).first()).toBeVisible();
 expect(writes).toHaveLength(0);
});
