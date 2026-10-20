import {test,expect,type Page} from '@playwright/test';
const rv='AAAAAAAAAAE=',version='0x0000000000000001';
async function open(page:Page,failSecond=false,commercial=false,direct=false,root=10,analysis=false,loading='Both',salesContainer='20DC',branching=false,directRoot=false){
 const writes:any[]=[];
 const common={OpportunityID:1,OpportunityNumber:'OPP-LOSS',CustomerName:'Customer',HeaderStage:'Draft',HeaderRowVersion:rv,ItemStage:'Draft',ItemRowVersion:rv,AnnualUnit:1000,WeightGrams:150};
 const rows=[{...common,ItemID:10,ItemNumber:'1',ProductCode:'MIX',ProductName:'Mix parent',ResponseLayerCount:2},{...common,ItemID:11,ParentItemID:10,ItemNumber:'1.1',ProductCode:'CHILD-A',ProductName:'Child A',ResponseLayerCount:1},{...common,ItemID:12,ParentItemID:10,ItemNumber:'1.2',ProductCode:'CHILD-B',ProductName:'Child B',ResponseLayerCount:2},{...common,ItemID:13,ItemNumber:'2',ProductCode:'LOCKED',ProductName:'Locked product',ItemStage:'Approved',ResponseLayerCount:1}];
 if(analysis){
  for(const r of rows)Object.assign(r,{ProductID:r.ItemID,EstPctAwarded:'50',CustomerCurrencyCode:'AUD',ExchangeRateCustomerCurrencyPerUSD:'1.5',PrimaryPricePerUnit:'.1',PrimaryPriceCurrencyCode:'USD',SecondaryPricePerUnit:'1',SecondaryPriceCurrencyCode:'USD',UnitsPerCarton:'10',UnitsPerPallet:'100',ConfigurationRequest:loading,ContainerRequest:salesContainer,SelectedContainerType:'20DC',ContainerLoadProfiles:{'20DC':{PalletsPerContainer:10,CartonsPerContainerFloor:200}},ContainerLoadResults:{'20DC':{CalculatedCartonsPerContainer:100}},ShipmentCostInfo:{PackingUSDPerLb:'.5',InitialDesignUSD:'100',OtherFixedCostsUSD:'50',FobbingUSDPerContainer:'200',InterestPct:'12',InterestMonths:'10',MarginPct:'10'}});
  if(salesContainer==='40DC')for(const r of rows)Object.assign(r,{ResponseContainerFamily:'20DC',LoadPlanJSON:{ID:196,Code:'20DC',Inputs:{},Result:{}},ContainerLoadResults:{'20DC':{CalculatedCartonsPerContainer:100},'40DC':{CalculatedCartonsPerContainer:300}}});
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
  if(path==='/api/opportunity/grade-lookups')return route.fulfill({json:{rows:[{ID:1,GradeName:'Almonds',ParentGradeID:null,FinalGrade:false},{ID:2,GradeName:'NPX',ParentGradeID:1,FinalGrade:true},...(directRoot?[{ID:3,GradeName:'Chocolate',ParentGradeID:null,FinalGrade:true}]:[])],materials:[{ID:3,MaterialCode:'RAW-A',MaterialName:'Almonds',GradeID:2,Status:'Active'},...(directRoot?[{ID:4,MaterialCode:'RAW-B',MaterialName:'Candy Covered Chocolate',GradeID:3,Status:'Active'}]:[])]}});
  const snapshot={items:[{ParentID:'0',ID:1,RawGradeID:1,Grade:'Almonds',RatioPct:'100'},{ParentID:'0/1',ID:1,RawGradeID:2,Grade:'NPX',RatioPct:'100',RawMaterialID:3}]};
  const grades=[{Path:'0/1/1',Grade:'NPX',RawGradeID:2,RawMaterialID:3,Proportion:'1'}];
  if(branching){snapshot.items[1].RatioPct='30';snapshot.items.push({...snapshot.items[1],ID:2,RatioPct:'70'});grades[0].Proportion='.3';grades.push({...grades[0],Path:'0/1/2',Proportion:'.7'})}
  if(directRoot){snapshot.items[0].RatioPct='80';snapshot.items.push({ParentID:'0',ID:2,RawGradeID:3,Grade:'Chocolate',RatioPct:'20',RawMaterialID:4});for(const g of grades)g.Proportion=String(Number(g.Proportion)*.8);grades.push({Path:'0/2',Grade:'Chocolate',RawGradeID:3,RawMaterialID:4,Proportion:'.2'})}
  const prices=[{PriceID:8,PriceVersion:version,RawGradeID:2,MaterialID:3,MaterialCode:'RAW-A',VendorName:'Vendor A',QuantityFrom:0,QuantityTo:null,PriceBasis:'lbs',USDPerLb:'2.00'}];
  const cm=path.match(/\/items\/(\d+)\/commercial(?:\/(preview))?$/);
  if(cm){const body=route.request().postDataJSON();if(cm[2])return route.fulfill({json:{grades,prices,saved:{RMCostUSDPerLb:body.Prices.length?'2.00':null},LossProductPct:'0'}});writes.push({id:Number(cm[1]),...body});return route.fulfill({json:{RowVersion:'AAAAAAAAAAI=',grades,prices,snapshot:body.Grades??snapshot,saved:{Inputs:{...body.CostInputs,...body.Inputs,Prices:body.Prices}}}})}
  const match=path.match(/\/items\/(\d+)\/(tcb|loss-formula|loss-processes)$/);
  if(match){
   const id=Number(match[1]),row=rows.find(r=>r.ItemID===id)!;
   if(match[2]==='tcb')return route.fulfill({json:{item:{ID:id,RowVersion:rv,DefaultPalletUSDPerEA:id===10?'12':null,HeaderStage:'Draft',ItemStage:row.ItemStage,IsMixParent:id===10,LossLayerCount:row.ResponseLayerCount,...(commercial&&id!==10?{ProductGradeSnapshot:JSON.stringify(snapshot),HasOpenPackagingRequest:id===12}:{})},saved:commercial?{Inputs:{RMRatio:'100',SeasoningRatio:'0',OilPct:'0',Prices:[...(direct?[{Path:'0/1/1',DirectUSDPerLb:'3.25'}]:[{Path:'0/1/1',PriceID:8,PriceVersion:version,ExpectedUSDPerLb:'2.00'}]),...(branching?[{Path:'0/1/2',DirectUSDPerLb:'4'}]:[])]}}:{},lossMasters:[{MasterID:1,MasterVersion:version,ProcessType:'Processing',ProcessName:'Sorting',Sequence:1,LossPct:'0'}],grades:commercial&&id!==10?grades:[],prices:commercial?prices:[],gradeError:''}});
   if(match[2]==='loss-formula')return route.fulfill({json:{LossProductPct:'5'}});
   const body=route.request().postDataJSON();writes.push({id,...body});
   if(reject&&id===12){reject=false;return route.fulfill({status:409,json:{detail:'Item changed. Refresh before saving.'}})}
   return route.fulfill({json:{RowVersion:'AAAAAAAAAAI='}});
  }
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('/workbench/');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'View details',exact:true}).click();
 await page.getByRole('button',{name:'TCB Review',exact:true}).click();
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
 await expect(dialog.locator('details').filter({hasText:'CHILD-A'}).getByRole('region',{name:'Grades & pricing',exact:true})).toBeVisible();
 await dialog.getByLabel('Raw Material 0/1/1',{exact:true}).selectOption('');
 const load=dialog.locator('.tcb-product-heading').getByRole('button',{name:'Load pricing for current grades',exact:true});
 await expect(load.locator('svg')).toHaveCount(1);
 await expect(load).toHaveText('');
 await load.click();
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
test('pricing refresh stays an accessible header icon and respects incomplete grades',async({page})=>{
 const {dialog,writes}=await open(page,false,true);
 const child=dialog.locator('#tcb-item-11');
 await child.getByRole('button',{name:'Add child grade to 0/1',exact:true}).click();
 const icon=child.locator('.tcb-product-heading').getByRole('button',{name:'Load pricing for current grades',exact:true});
 await expect(icon).toBeDisabled();await expect(icon).toHaveText('');await expect(icon.locator('svg')).toHaveCount(1);
 await expect(icon).toHaveAttribute('title','Load pricing for current grades');
 await expect(child.getByRole('heading',{name:'Product',exact:true})).toBeVisible();
 await child.getByLabel('Grade 0/1/2',{exact:true}).selectOption('2');
 await child.getByLabel('Ratio 0/1/1',{exact:true}).fill('50');
 await child.getByLabel('Ratio 0/1/2',{exact:true}).fill('50');
 await expect(icon).toBeEnabled();
 expect(writes).toEqual([]);
});

test('unchanged grades retain quote and direct pricing through ratio edits and reload',async({page})=>{
 for(const direct of [false,true]){
  const {dialog,writes}=await open(page,false,true,direct);
  await expect(dialog.locator('details').filter({hasText:'CHILD-A'}).getByRole('region',{name:'Grades & pricing',exact:true})).toBeVisible();
  await dialog.getByLabel('Ratio 0/1/1',{exact:true}).fill('99');
  await dialog.getByLabel('Ratio 0/1/1',{exact:true}).fill('100');
  const reload=dialog.getByRole('button',{name:'Load pricing for current grades',exact:true});
  if(await reload.count())await reload.click();
  if(direct)await expect(dialog.getByLabel('Direct USD/lb item 11 grade 0/1/1',{exact:true})).toHaveValue('3.25');
  else await expect(dialog.getByLabel('Raw price item 11 grade 0/1/1',{exact:true})).toHaveValue('8:'+version+':2.00');
  expect(writes).toEqual([]);
 }
});

test('pricing is aligned inside the grades tree and Process Info never repeats child pickers',async({page},info)=>{
 await page.setViewportSize({width:1920,height:1080});
 const {dialog,writes}=await open(page,false,true,false,10,false,'Both','20DC',true);
 const child=dialog.locator('#tcb-item-11'),tree=child.getByRole('region',{name:'Horizontal grade tree',exact:true});
 const pricing=tree.getByRole('region',{name:'Grade pricing',exact:true});
 expect(await tree.getByRole('region',{name:'Scrollable grade levels',exact:true}).evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await expect(pricing.getByLabel('Raw price item 11 grade 0/1/1',{exact:true})).toBeVisible();
 await expect(pricing.getByLabel('Direct USD/lb item 11 grade 0/1/2',{exact:true})).toHaveValue('4');
 await child.getByLabel('Process 0/1',{exact:true}).check();
 const process=child.getByRole('table',{name:'Process Info',exact:true});
 await expect(process.locator('[data-process-path]')).toHaveCount(1);
 await expect(process.getByRole('columnheader')).toHaveText(['Process grade','Ratio','RM ($/lbs)','RM Ratio (%)','Seasoning/salt ($/lbs)','Seasoning/salt Ratio (%)','Oil ($/lbs)','Oil %','Processing ($/lbs)','Line product ($/lbs)']);
 await expect(process.getByRole('combobox')).toHaveCount(0);
 await expect(child.getByRole('combobox',{name:'Raw price item 11 grade 0/1/1',exact:true})).toHaveCount(1);
 for(const path of ['0/1/1','0/1/2']){
  const source=tree.locator('[data-grade-path="'+path+'"]'),card=pricing.locator('[data-pricing-path="'+path+'"]');
  await expect.poll(async()=>{const a=(await source.boundingBox())!,b=(await card.boundingBox())!;return Math.abs(a.y+a.height/2-b.y-b.height/2)}).toBeLessThan(3);
 }
 const first=pricing.locator('[data-pricing-path="0/1/1"]'),heading=first.locator('.grade-pricing-heading');
 await expect(heading.getByLabel('Direct price item 11 grade 0/1/1',{exact:true})).toHaveCount(1);
 await expect(heading.getByLabel('RM ($/lbs) item 11 grade 0/1/1',{exact:true})).toHaveText('2.00 USD');
 await first.getByLabel('Direct price item 11 grade 0/1/1',{exact:true}).check();
 await expect(heading.getByLabel('Direct USD/lb item 11 grade 0/1/1',{exact:true})).toBeVisible();
 const headerBox=(await heading.boundingBox())!,pickerBox=(await first.getByLabel('Raw price item 11 grade 0/1/1',{exact:true}).boundingBox())!;
 expect(pickerBox.y).toBeGreaterThan(headerBox.y+headerBox.height);
 const helpBox=(await first.getByRole('note').boundingBox())!,labelBox=(await first.getByLabel('Direct price item 11 grade 0/1/1',{exact:true}).locator('..').boundingBox())!;
 expect(helpBox.x-labelBox.x-labelBox.width).toBeLessThan(20);
 await first.getByLabel('Direct USD/lb item 11 grade 0/1/1',{exact:true}).fill('2.1234567');
 await expect(first.getByText(/up to 6 decimals/)).toBeVisible();
 await first.getByLabel('Direct USD/lb item 11 grade 0/1/1',{exact:true}).fill('2');
 await expect(process.locator('[data-process-path="0/1"]')).toContainText('3.40 USD');
 for(const width of [1920,390]){
  await page.setViewportSize({width,height:1080});
  await pricing.getByLabel('Direct USD/lb item 11 grade 0/1/2',{exact:true}).scrollIntoViewIfNeeded();
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  const a=(await first.boundingBox())!,b=(await pricing.locator('[data-pricing-path="0/1/2"]').boundingBox())!;
  expect(b.y-a.y-a.height).toBeGreaterThanOrEqual(6);
  await dialog.screenshot({path:info.outputPath('grades-pricing-'+width+'.png')});
 }
 expect(writes).toHaveLength(0);
});

test('Process toggles keep a fixed header position with and without child summaries',async({page})=>{
 await page.setViewportSize({width:1920,height:1080});
 const {dialog}=await open(page,false,true,false,10,false,'Both','20DC',true,true);
 const child=dialog.locator('#tcb-item-11');
 for(const width of [1920,1440,1280,390]){
  await page.setViewportSize({width,height:1080});
  const offsets=await child.locator('[data-grade-path]').evaluateAll(cards=>cards.map(card=>{
   const box=card.getBoundingClientRect(),label=card.querySelector('.grade-process-toggle')!.getBoundingClientRect();
   return {x:label.x-box.x,y:label.y-box.y};
  }));
  for(const axis of ['x','y'] as const)expect(Math.max(...offsets.map(p=>p[axis]))-Math.min(...offsets.map(p=>p[axis]))).toBeLessThan(2);
 }
});

test('grade material and pricing cards share dimensions and connectors include direct final roots',async({page},info)=>{
 await page.setViewportSize({width:1920,height:1080});
 const {dialog,writes}=await open(page,false,true,false,10,false,'Both','20DC',true,true);
 const child=dialog.locator('#tcb-item-11'),canvas=child.locator('.grade-tree-canvas');
 const raw=canvas.locator('[data-material-path="0/2"]');
 await expect(raw.locator('.grade-material-label')).toHaveText('Raw MaterialRAW-B');
 await expect(canvas.locator('[data-material-path="0/1/1"] .grade-material-label')).toHaveText('Raw MaterialRAW-A');
 await expect(raw.getByLabel('Raw Material 0/2',{exact:true}).locator('option:checked')).toHaveText('Candy Covered Chocolate');
 for(const width of [1920,1440,1280]){
  await page.setViewportSize({width,height:1080});
  await expect.poll(async()=>canvas.locator('[data-grade-path],[data-material-path],[data-pricing-path]').evaluateAll(els=>{
   const boxes=els.map(el=>el.getBoundingClientRect());return Math.max(...boxes.map(b=>b.height))-Math.min(...boxes.map(b=>b.height));
  })).toBeLessThan(2);
  const widths=await canvas.locator('[data-grade-path],[data-material-path],[data-pricing-path]').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().width));
  expect(Math.max(...widths)-Math.min(...widths)).toBeLessThan(2);
  await expect(canvas.locator('[data-connection="grade-material"]')).toHaveCount(3);
  await expect(canvas.locator('[data-connection="material-pricing"]')).toHaveCount(3);
  await expect.poll(async()=>canvas.evaluate(root=>{
   const svg=root.querySelector('svg.grade-tree-links')!,origin=svg.getBoundingClientRect();
   return Math.max(...Array.from(svg.querySelectorAll<SVGPathElement>('path')).map(link=>{
    const id=link.dataset.path!,material=root.querySelector('[data-material-path="'+id+'"]')!,source=root.querySelector('[data-grade-path="'+id+'"]')!,price=root.querySelector('[data-pricing-path="'+id+'"]')!;
    const from=(link.dataset.connection==='grade-material'?source:material).getBoundingClientRect(),to=(link.dataset.connection==='grade-material'?material:price).getBoundingClientRect();
    const start=link.getPointAtLength(0),end=link.getPointAtLength(link.getTotalLength());
    return Math.max(Math.abs(start.x+origin.left-from.right),Math.abs(start.y+origin.top-from.top-from.height/2),Math.abs(end.x+origin.left-to.left),Math.abs(end.y+origin.top-to.top-to.height/2));
   }));
  })).toBeLessThan(2);
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  const cards=canvas.locator('[data-grade-path],[data-material-path],[data-pricing-path]');
  expect(await cards.evaluateAll(els=>els.every(el=>el.scrollWidth<=el.clientWidth+1))).toBe(true);
  await canvas.screenshot({path:info.outputPath('equal-grade-cards-'+width+'.png')});
 }
 expect(writes).toEqual([]);
});

test('raw-only grades keep tree pricing but are excluded from Process Info',async({page})=>{
 const {dialog,writes}=await open(page,false,true,false,10,false,'Both','20DC',true);
 const child=dialog.locator('#tcb-item-11');
 await child.getByLabel('Process 0/1/1',{exact:true}).uncheck();
 await child.getByLabel('Process 0/1/2',{exact:true}).uncheck();
 await expect(child.getByText('No Process grades selected.',{exact:true})).toBeVisible();
 await expect(child.getByRole('table',{name:'Process Info',exact:true})).toHaveCount(0);
 await expect(child.getByLabel('Raw price item 11 grade 0/1/1',{exact:true})).toBeEnabled();
 await expect(child.getByLabel('Direct USD/lb item 11 grade 0/1/2',{exact:true})).toHaveValue('4');
 await expect(child.locator('.tcb-product-totals').getByText('3.40 USD',{exact:true})).toHaveCount(2);
 await dialog.getByRole('button',{name:'Review & save',exact:true}).click();
 await dialog.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(dialog.getByText('Saved item settings for 1 item(s).',{exact:true})).toBeVisible();
 expect(writes[0].Prices).toHaveLength(2);
 expect(writes[0].Grades.items.every((g:any)=>g.Process===false)).toBe(true);
});

test('multiple raw children share one parent processing panel and within-group ratios',async({page},info)=>{
 const {dialog,writes}=await open(page,false,true,false,10,false,'Both','20DC',true);
 const child=dialog.locator('details').filter({hasText:'CHILD-A'});
 await expect(child.getByRole('region',{name:'Grades & pricing',exact:true})).toBeVisible();
 await child.getByLabel('Process 0/1',{exact:true}).check();
 await expect(child.getByRole('button',{name:/Cost details item 11 grade/})).toHaveCount(0);
 const group=child.locator('[data-process-path="0/1"]');
 await expect(group).toContainText('3.40 USD');
 const first=child.locator('[data-cost-grade="0/1/1"]'),second=child.locator('[data-cost-grade="0/1/2"]');
 await expect(child.getByLabel('Ratio 0/1/1',{exact:true})).toHaveValue('30');
 await expect(child.getByLabel('Ratio 0/1/2',{exact:true})).toHaveValue('70');
 await expect(first.getByLabel('Raw price item 11 grade 0/1/1',{exact:true})).toHaveValue('8:'+version+':2.00');
 await expect(second.getByLabel('Direct USD/lb item 11 grade 0/1/2',{exact:true})).toHaveValue('4');
 await expect(child.getByRole('table',{name:'Process Info',exact:true}).getByRole('columnheader')).toHaveCount(10);
 await expect(child.getByRole('table',{name:'Process Info',exact:true}).getByLabel(/^Raw price item/)).toHaveCount(0);
 await expect(first.getByRole('button')).toHaveCount(0);
 await expect(second.getByRole('button')).toHaveCount(0);

 await child.getByLabel('Processing ($/lbs)',{exact:true}).fill('.5');
 await expect(group).toContainText('3.90 USD');
 await child.locator('.commercial-price-table').screenshot({path:info.outputPath('grouped-process-children.png')});
 expect(writes).toHaveLength(0);
});

test('Process parent owns one recipe, hides children temporarily and drops dormant child settings only on save',async({page},info)=>{
 const {dialog,writes}=await open(page,false,true);
 const child=dialog.locator('details').filter({hasText:'CHILD-A'});
 await child.getByLabel('Processing ($/lbs)',{exact:true}).fill('.75');
 await expect(child.getByRole('region',{name:'Grades & pricing',exact:true})).toBeVisible();
 const parentProcess=child.getByLabel('Process 0/1',{exact:true}),childProcess=child.getByLabel('Process 0/1/1',{exact:true});
 await expect(childProcess).toBeChecked();
 await parentProcess.check();
 await expect(childProcess).not.toBeChecked();
 await expect(childProcess).toBeDisabled();
 await expect(dialog.getByRole('button',{name:'Load pricing for current grades',exact:true})).toHaveCount(0);
 await expect(dialog.getByLabel('Raw price item 11 grade 0/1/1',{exact:true})).toHaveValue('8:'+version+':2.00');
 await expect(dialog.getByRole('button',{name:'Cost details item 11 grade 0/1/1',exact:true})).toHaveCount(0);

 await child.getByLabel('Processing ($/lbs)',{exact:true}).fill('.5');
 await expect(child.locator('[data-process-path="0/1"]')).toContainText('2.50 USD');
 await parentProcess.uncheck();
 await expect(childProcess).toBeChecked();
 await expect(childProcess).toBeEnabled();
 await expect(child.getByLabel('Processing ($/lbs)',{exact:true})).toHaveValue('.75');
 await parentProcess.check();
 await expect(child.getByLabel('Processing ($/lbs)',{exact:true})).toHaveValue('.5');
 await child.locator('.commercial-price-table').screenshot({path:info.outputPath('process-parent.png')});
 await dialog.getByRole('button',{name:'Review & save',exact:true}).click();
 await dialog.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(dialog.getByText('Saved item settings for 1 item(s).',{exact:true})).toBeVisible();
 expect(writes).toHaveLength(1);
 expect(writes[0].Grades.items.map((g:any)=>g.Process)).toEqual([true,false]);
 expect(writes[0].Prices).toEqual([{Path:'0/1/1',PriceID:8,PriceVersion:version,ExpectedUSDPerLb:'2.00'}]);
 expect(writes[0].CostInputs.MaterialCosts).toHaveLength(1);
 expect(writes[0].CostInputs.MaterialCosts[0]).toMatchObject({Path:'0/1',ProcessingUSDPerLb:'.5'});
 await parentProcess.uncheck();
 await expect(childProcess).not.toBeChecked();
 await expect(dialog.getByRole('button',{name:'Cost details item 11 grade 0/1/1',exact:true})).toHaveCount(0);
});

test('active PCR locks grades but not raw pricing; Mix parent has no raw price inputs',async({page})=>{
 const {dialog}=await open(page,false,true);
 await expect(dialog.locator('#tcb-item-12').getByRole('region',{name:'Grades & pricing',exact:true})).toBeVisible();
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
 await expect(parent.getByLabel('Palletization ($/EA)',{exact:true})).toHaveValue('12');
 await child.getByLabel('Processing ($/lbs)',{exact:true}).fill('.5');
 await expect(child.locator('.tcb-product-totals').getByText('2.50 USD',{exact:true})).toBeVisible();
 await dialog.getByLabel('Packaging loss ratio item 11 layer 1',{exact:true}).fill('2');
 await dialog.getByRole('button',{name:'Review & save',exact:true}).click();
 await dialog.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(dialog.getByText('Saved item settings for 1 item(s).',{exact:true})).toBeVisible();
 expect(writes.map(w=>w.id)).toEqual([11]);
 expect(writes[0].CostInputs.MaterialCosts[0].ProcessingUSDPerLb).toBe('.5');
 expect(writes[0].Prices[0].PriceID).toBe(8);
 expect(writes[0].Inputs.LossProcesses[0].LossPct).toBe('2');
});

test('TCB combines pricing and inline grades with validated Opportunity-only direct prices',async({page})=>{
 const {dialog,writes}=await open(page,false,true);
 await expect(dialog.getByRole('tab',{name:'Raw Pricing',exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('tab',{name:'Nuts Grades',exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('tab')).toHaveCount(0);
 const manual=dialog.getByLabel('Direct price item 11 grade 0/1/1',{exact:true});
 await expect(manual.locator('..')).toContainText('Direct price');
 await expect(manual.locator('../..').getByRole('note')).toHaveCount(1);
 const master=dialog.getByLabel('Raw price item 11 grade 0/1/1',{exact:true});
 await manual.check();
 await expect(master).toBeDisabled();
 const amount=dialog.getByLabel('Direct USD/lb item 11 grade 0/1/1',{exact:true});
 await expect(dialog.getByRole('button',{name:'Review & save',exact:true})).toBeDisabled();
 await amount.fill('-1');
 await expect(dialog.getByRole('button',{name:'Review & save',exact:true})).toBeDisabled();
 await amount.fill('0');
 await expect(dialog.locator('#tcb-item-11 .tcb-product-totals').getByText('0.00 USD',{exact:true})).toHaveCount(2);
 await manual.uncheck();
 await expect(master).toBeEnabled();
 await master.selectOption('8:'+version+':2.00');
 await manual.check();
 await amount.fill('3.25');
 await expect(dialog.locator('#tcb-item-11 .tcb-product-totals').getByText('3.25 USD',{exact:true})).toHaveCount(2);
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

test('TCB Review launcher is parent-only in TCB Review and scopes standalone items separately',async({page})=>{
 const {dialog}=await open(page,false,true);
 await dialog.getByRole('button',{name:'Close TCB Review',exact:true}).click();
 const parent=page.getByRole('button',{name:'TCB Review for MIX item 10',exact:true});
 const standalone=page.getByRole('button',{name:'TCB Review for LOCKED item 13',exact:true});
 await expect(parent).toBeVisible();await expect(standalone).toBeVisible();
 await expect(page.getByRole('button',{name:/Edit all item losses/})).toHaveCount(0);
 await page.getByRole('button',{name:'Show mix children for Item 1',exact:true}).click();
 await expect(page.getByRole('button',{name:/TCB Review for CHILD/})).toHaveCount(0);
 for(const name of ['All Fields','Product Info','Packaging Request','Packaging Responses']){
  await page.getByRole('button',{name,exact:true}).click();
  await expect(parent).toHaveCount(0);await expect(standalone).toHaveCount(0);
 }
 await page.getByRole('button',{name:'TCB Review',exact:true}).click();
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
 await expect(parent.getByLabel('Palletization ($/EA)',{exact:true})).toHaveValue('12');
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
 const palletCost=pallet.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Pallet & Floor cost ($/unit)',exact:true})});
 expect(await palletCost.getByRole('cell').allTextContents()).toEqual(['0.04 USD','0.04 USD']);
 await expect(pallet.getByRole('row').filter({has:page.getByRole('rowheader',{name:'FOB ($/unit)',exact:true})}).getByText('Incomplete',{exact:true})).toHaveCount(0);
 expect(writes).toHaveLength(0);
 await page.setViewportSize({width:600,height:900});
 expect(await analysis.getByRole('region',{name:'20DC analysis table',exact:true}).evaluate(el=>el.scrollWidth>el.clientWidth)).toBeTruthy();
 await dialog.getByRole('button',{name:'Back to TCB inputs',exact:true}).click();
 await expect(child.getByLabel('Processing ($/lbs)',{exact:true})).toHaveValue('.5');
 await expect(parent.getByLabel('Palletization ($/EA)',{exact:true})).toHaveValue('12');
 await expect(dialog.getByLabel('Product Loss Formula result item 11',{exact:true})).toHaveText('5%');
 await dialog.getByRole('button',{name:'Review & save',exact:true}).click();
 await dialog.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(dialog.getByText('Saved item settings for 1 item(s).',{exact:true})).toBeVisible();
 expect(writes.map(w=>w.id)).toEqual([11]);
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

test('Both combines loading costs in a single child Analysis table without separate results',async({page})=>{
 const {dialog,writes}=await open(page,false,true,false,10,true);
 await expect(dialog.getByLabel('Palletization ($/EA)',{exact:true})).toHaveValue('12');
 await dialog.getByRole('button',{name:'Analysis',exact:true}).click();
 const analysis=dialog.getByRole('region',{name:'TCB Analysis',exact:true});
 await expect(analysis.getByRole('table')).toHaveCount(1);
 await expect(analysis.getByRole('heading',{name:/Pallet load|Floor load/})).toHaveCount(0);
 const row=analysis.getByRole('row').filter({has:page.getByRole('rowheader',{name:'FOB ($/unit)',exact:true})});
 await expect(row.getByText('Incomplete',{exact:true})).toHaveCount(0);
 await expect(row.getByText(/loading calculation is deferred/)).toHaveCount(0);
 expect(writes).toHaveLength(0);
});

test('Analysis uses Sales 40DC with a reference 20DC plan and divides Product cost by yield',async({page})=>{
 const {dialog,writes}=await open(page,false,true,false,10,true,'Pallet load','40DC');
 await dialog.getByRole('button',{name:'Add Product loss item 11',exact:true}).click();
 await dialog.getByLabel('Product loss ratio item 11 row 1',{exact:true}).fill('50');
 await dialog.getByRole('button',{name:'Analysis',exact:true}).click();
 const table=dialog.getByRole('table',{name:'40DC analysis',exact:true});
 await expect(table).toBeVisible();
 await expect(dialog.getByRole('table',{name:'20DC analysis',exact:true})).toHaveCount(0);
 const fobbing=table.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Fobbing fee ($/unit)',exact:true})});
 await expect(fobbing.getByRole('cell')).toHaveText(['0.02 USD','0.02 USD']);
 const product=table.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Product ($/unit)',exact:true})});
 await expect(product.getByRole('cell').first()).toHaveText('1.32 USD');
 expect(writes).toHaveLength(0);
});
