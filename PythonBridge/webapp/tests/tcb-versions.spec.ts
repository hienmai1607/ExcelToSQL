import {test,expect,type Page} from '@playwright/test';
import {defaultInputs} from '../src/tcb-model';
const rv='AAAAAAAAAAE=',next='AAAAAAAAAAI=';
async function setup(page:Page,readonly=false){
 const snapshot={items:[{ParentID:'0',ID:1,Grade:'Almond',RawGradeID:1,RawMaterialID:1,RatioPct:'100'}]};
 const base:any={OpportunityID:1,OpportunityNumber:'OPP-V1',CustomerName:'Customer',HeaderStage:readonly?'Closed':'Draft',ItemID:11,ProductID:2,ProductCode:'PRD-2',ProductName:'Almonds',ItemStage:readonly?'Approved':'Draft',ItemRowVersion:rv,AnnualUnit:1000,EstPctAwarded:100,WeightGrams:'453.59237',CustomerCurrencyCode:'AUD',ExchangeRateCustomerCurrencyPerUSD:'1.5',ExchangeRateVNDPerUSD:'25000',ResponseLayerCount:1,PrimaryPricePerUnit:'0',PrimaryPriceCurrencyCode:'USD',UnitsPerPallet:1000,ContainerRequest:'20DC',ConfigurationRequest:'Pallet load',SelectedContainerType:'20DC',ContainerLoadResults:{'20DC':{CalculatedCartonsPerContainer:100}},ProductGradeSnapshot:JSON.stringify(snapshot),ShipmentCostInfo:{}};
 const other={...base,ItemID:12,ProductID:3,ProductCode:'PRD-3',ProductName:'Cashews'};
 const external={...base,ItemID:21,OpportunityID:2,OpportunityNumber:'OPP-OTHER',ProductCode:'PRD-OTHER',ProductName:'Other product',CustomerCurrencyCode:'JPY',ExchangeRateCustomerCurrencyPerUSD:'100'};
 const versions:any[]=[{ID:1,Version:1,Name:'Baseline',IsActive:true,RowVersion:rv},{ID:2,Version:2,Name:'Alternative',IsActive:false,RowVersion:rv}];
 const saved:any={1:{Inputs:{...defaultInputs(),Prices:[{Path:'0/1',DirectUSDPerLb:'2'}],LossProcesses:[],PalletUSDPerEA:'0'}},2:{Inputs:{...defaultInputs(),Prices:[{Path:'0/1',DirectUSDPerLb:'2'}],LossProcesses:[],PalletUSDPerEA:'0',ProcessingUSDPerLb:'0.1'}}};
 const writes:any[]=[],state={failSave:false,failCreate:false};
 function data(row=base,v=versions.find(v=>v.IsActive)!){return {item:{ID:row.ItemID,ProductCode:row.ProductCode,ProductName:row.ProductName,ItemStage:row.ItemStage,HeaderStage:row.HeaderStage,IsMixParent:false,RowVersion:row.ItemRowVersion,ProductGradeSnapshot:JSON.stringify(snapshot),LossLayerCount:1,DefaultPalletUSDPerEA:'0',WeightGrams:row.WeightGrams},saved:saved[v.ID],lossMasters:[],grades:[{Path:'0/1',Grade:'Almond',RawGradeID:1,RawMaterialID:1,Proportion:'1'}],prices:[]}}
 function context(row=base){const rows=row===external?[external]:[base,other];return {rows,entries:rows.map(r=>({ItemID:r.ItemID,tcb:data(r)}))}}
 await page.route('**/api/**',route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,post=req.method()==='POST';
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Admin',is_admin:true,scopes:['Admin']}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/opportunity/grid')return route.fulfill({json:{rows:[base],total:1,page:1}});
  if(path==='/api/opportunity/grade-lookups')return route.fulfill({json:{rows:[{ID:1,GradeName:'Almond',Status:'Active',FinalGrade:true}],materials:[{ID:1,GradeID:1,MaterialName:'Almond',MaterialCode:'RAW-1',Status:'Active'}]}});
  if(path==='/api/opportunity/tcb-comparison/items')return route.fulfill({json:{rows:[external,base]}});
  if(path.endsWith('/tcb-comparison'))return route.fulfill({json:context(path.includes('/21/')?external:base)});
  if(path.endsWith('/tcb'))return route.fulfill({json:data()});
  if(path.endsWith('/tcb-version-comparison'))return route.fulfill({json:{versions:versions.map(v=>({version:v,tcb:data(base,v),rows:[{...base,TCBContext:data(base,v)},other]}))}});
  if(path.endsWith('/tcb-versions')){
   if(!post)return route.fulfill({json:{versions}});
   if(state.failCreate)return route.fulfill({status:409,json:{detail:'Could not create the version. Refresh the source and retry.'}});
   const body=req.postDataJSON();writes.push({path,body});const v={ID:3,Version:3,Name:body.Name,IsActive:false,RowVersion:rv};versions.push(v);saved[3]=structuredClone(saved[body.SourceVersionID]??{Inputs:defaultInputs()});return route.fulfill({json:{version:v}});
  }
  const match=path.match(/tcb-versions\/(\d+)(?:\/(preview|activate))?$/);
  if(match){
   const v=versions.find(v=>v.ID===Number(match[1]));
   if(!post)return route.fulfill({json:{version:v,tcb:data(base,v),rows:[{...base,TCBContext:data(base,v)},other]}});
   const body=req.postDataJSON();
   if(match[2]==='activate'){writes.push({path,body});versions.forEach(x=>x.IsActive=x.ID===v.ID);base.ItemRowVersion=next;v.RowVersion=next;return route.fulfill({json:{RowVersion:next}})}
   const value={Inputs:{...saved[v.ID].Inputs,...body.CostInputs,...body.Inputs,Prices:body.Prices}};
   if(match[2]==='preview')return route.fulfill({json:{saved:value,LossProductPct:'0',grades:data().grades,prices:[]}});
   if(state.failSave)return route.fulfill({status:409,json:{detail:'TCB version changed. Refresh before saving.'}});
   writes.push({path,body});saved[v.ID]=value;v.RowVersion=next;
   return route.fulfill({json:{version:v,RowVersion:base.ItemRowVersion,saved:value,snapshot,grades:data().grades,prices:[]}});
  }
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('/workbench/');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'View details',exact:true}).click();
 await page.getByRole('button',{name:'TCB Review',exact:true}).click();await page.getByRole('button',{name:'TCB Review for PRD-2 item 11',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'TCB Review',exact:true});
 await expect(dialog.getByLabel('TCB version item 11',{exact:true})).toHaveValue('1');
 return {dialog,writes,state};
}

test('version controls share the item header and editor heading sizes are consistent',async({page},info)=>{
 const {dialog}=await setup(page);
 await page.setViewportSize({width:1920,height:1080});
 const item=dialog.locator('#tcb-item-11'),title=item.locator('.tcb-item-title'),controls=item.getByLabel('TCB versions item 11',{exact:true});
 await expect(controls.locator('.tcb-version-state')).toHaveText('Active');
 const a=(await title.boundingBox())!,b=(await controls.boundingBox())!;
 expect(Math.abs(a.y+a.height/2-b.y-b.height/2)).toBeLessThan(12);
 expect(b.x).toBeGreaterThan(a.x+a.width/2);
 const sizes=await item.locator('section[aria-label="Product"]>.tcb-product-heading>h3, .tcb-process-info>h3, .product-loss-heading h3').evaluateAll(els=>els.map(e=>getComputedStyle(e).fontSize));
 expect(sizes.length).toBeGreaterThanOrEqual(2);
 expect(new Set(sizes)).toEqual(new Set(['16px']));
 const mainTitle=await dialog.locator('.customer-editor-heading h2').evaluate(el=>getComputedStyle(el).fontSize);
 await dialog.screenshot({path:info.outputPath('compact-tcb-desktop.png')});
 await controls.getByRole('button',{name:'New TCB version item 11'}).click();
 const modal=page.getByRole('dialog',{name:'New TCB version',exact:true});
 expect(await modal.getByRole('heading',{level:2}).evaluate(el=>getComputedStyle(el).fontSize)).toBe(mainTitle);
});

test('new version uses a compact form with padded fields',async({page},info)=>{
 const {dialog}=await setup(page);await page.setViewportSize({width:1920,height:1080});
 await dialog.getByRole('button',{name:'New TCB version item 11'}).click();
 const form=page.getByRole('dialog',{name:'New TCB version',exact:true});
 for(const width of [1920,390]){
  await page.setViewportSize({width,height:1080});
  const box=(await form.boundingBox())!,input=(await form.getByLabel('TCB approach name').boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(560);expect(box.height).toBeLessThan(480);
  expect(input.x-box.x).toBeGreaterThanOrEqual(16);
  expect(await form.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  const save=(await form.getByRole('button',{name:'Save',exact:true}).boundingBox())!;
  expect(save.width).toBeLessThan(120);
  await expect(form.getByRole('button',{name:'Cancel',exact:true})).toBeVisible();
  await form.screenshot({path:info.outputPath('new-version-'+width+'.png')});
 }
});
test('new version failures notify at the top and preserve entered values',async({page})=>{
 const {dialog,state}=await setup(page);state.failCreate=true;
 await dialog.getByRole('button',{name:'New TCB version item 11'}).click();
 const form=page.getByRole('dialog',{name:'New TCB version',exact:true});
 await form.getByLabel('TCB approach name').fill('Draft');
 await form.getByRole('button',{name:'Save',exact:true}).click();
 await expect(form.getByRole('alert')).toContainText('Could not create the version');
 await expect(form.locator('.floating-notification.error')).toBeVisible();
 expect((await form.locator('.floating-notification.error').boundingBox())!.y).toBeLessThan(30);
 await expect(form.getByLabel('TCB approach name')).toHaveValue('Draft');
 state.failCreate=false;await form.getByRole('button',{name:'Save',exact:true}).click();
 await expect(form).toHaveCount(0);
 await expect(page.locator('.floating-notification.success').filter({hasText:'TCB version saved.'})).toBeVisible();
 await expect(dialog.getByLabel('TCB version item 11',{exact:true})).toHaveValue('3');
});

test('new option copies a saved version without activating it',async({page})=>{
 const {dialog,writes}=await setup(page);
 await dialog.getByRole('button',{name:'New TCB version item 11'}).click();
 const form=page.getByRole('dialog',{name:'New TCB version',exact:true});
 await form.getByLabel('TCB approach name').fill('Try new seasoning');
 await form.getByLabel('Copy TCB version from').selectOption('2');
 await form.getByRole('button',{name:'Save',exact:true}).click();
 await expect(dialog.getByLabel('TCB version item 11',{exact:true})).toHaveValue('3');
 await expect(dialog.locator('.tcb-version-state').filter({hasText:/^Alternative$/})).toBeVisible();
 expect(writes[0].body).toMatchObject({SourceVersionID:2,Name:'Try new seasoning'});
 expect(writes.some(w=>w.path.endsWith('/activate'))).toBe(false);
});
test('inactive edits save to the version and activation is explicit',async({page})=>{
 const {dialog,writes}=await setup(page);
 await dialog.getByLabel('TCB version item 11',{exact:true}).selectOption('2');

 await dialog.getByLabel('Processing ($/lbs)',{exact:true}).fill('0.4');
 await expect(dialog.getByRole('button',{name:'Set active',exact:true})).toBeDisabled();
 await dialog.getByRole('button',{name:'Review & save',exact:true}).click();await dialog.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(dialog.getByText('Saved item settings for 1 item(s).',{exact:true})).toBeVisible();
 expect(writes[0].path).toContain('/tcb-versions/2');expect(writes[0].body.CostInputs.MaterialCosts[0].ProcessingUSDPerLb).toBe('0.4');
 page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Set active',exact:true}).click();
 await expect(dialog.locator('.tcb-version-state').filter({hasText:/^Active$/})).toBeVisible();
 expect(writes.some(w=>w.path.endsWith('/2/activate'))).toBe(true);
});
test('version comparison has columns and highlights only the active approach',async({page},info)=>{
 const {dialog}=await setup(page);await dialog.getByRole('button',{name:'Compare TCB versions',exact:true}).click();
 const compare=page.getByRole('dialog',{name:'Compare TCB versions',exact:true});
 await expect(compare.getByRole('columnheader')).toHaveCount(3);
 await expect(compare.locator('thead .tcb-active-version')).toHaveCount(1);
 await expect(compare.getByRole('columnheader',{name:/V1 · Baseline/})).toContainText('Active');
 const fob=compare.getByRole('rowheader',{name:'FOB',exact:true}).locator('..');
 await expect(fob).toContainText('2.00 USD / 3.00 AUD');
 await expect(compare.getByRole('rowheader',{name:/\(\$\/unit\)/})).toHaveCount(0);
 for(const width of [1920,390]){
  await page.setViewportSize({width,height:1080});
  const box=(await compare.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width+1);
  expect(await compare.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await compare.screenshot({path:info.outputPath('version-comparison-'+width+'.png')});
 }
});
test('all-item analysis includes opportunity items outside the opened editor',async({page})=>{
 const {dialog}=await setup(page);await dialog.getByRole('button',{name:'Analysis',exact:true}).click();
 await expect(dialog.getByRole('columnheader')).toHaveCount(3);
 await expect(dialog.getByRole('columnheader',{name:/PRD-3/})).toBeVisible();
});
test('cross-opportunity comparison adds and removes columns without writes',async({page})=>{
 const {dialog,writes}=await setup(page);await dialog.getByRole('button',{name:'Compare opportunity items',exact:true}).click();
 const compare=page.getByRole('dialog',{name:'Compare opportunity items',exact:true});
 await expect(compare.getByRole('columnheader')).toHaveCount(2);
 await expect(compare.getByRole('columnheader').nth(1)).toContainText('OPP-V1');
 await expect(compare.getByRole('columnheader').nth(1)).toContainText('Active');
 await expect(compare.getByRole('columnheader').nth(1).getByRole('button')).toHaveCount(0);
 await compare.getByLabel('Find comparison item').fill('OPP-OTHER');await compare.getByRole('button',{name:'Search items'}).click();
 await compare.getByLabel('Comparison item',{exact:true}).selectOption('21');await compare.getByRole('button',{name:'Add comparison'}).click();
 await expect(compare.getByRole('columnheader',{name:/OPP-OTHER/})).toBeVisible();
 const fob=compare.getByRole('rowheader',{name:'FOB',exact:true}).locator('..');
 await expect(fob).toContainText('2.00 USD / 200.00 JPY');
 await compare.getByRole('button',{name:/Remove comparison column/}).click();
 await expect(compare.getByRole('columnheader')).toHaveCount(2);
 await expect(compare.getByRole('columnheader').nth(1)).toContainText('OPP-V1');
 await expect(compare.locator('thead .tcb-active-version')).toHaveCount(1);
 expect(writes).toHaveLength(0);
});
test('item comparison anchors the saved active approach even while editing an inactive version',async({page})=>{
 const {dialog,writes}=await setup(page);
 await dialog.getByLabel('TCB version item 11',{exact:true}).selectOption('2');

 await dialog.getByLabel('Processing ($/lbs)',{exact:true}).fill('0.8');
 await dialog.getByRole('button',{name:'Compare opportunity items',exact:true}).click();
 const compare=page.getByRole('dialog',{name:'Compare opportunity items',exact:true});
 await expect(compare.getByRole('columnheader')).toHaveCount(2);
 await expect(compare.getByRole('columnheader').nth(1)).toContainText('V1');
 const product=compare.getByRole('rowheader',{name:'Product',exact:true}).locator('..');
 await expect(product.getByRole('cell').first()).toHaveText('2.00 USD');
 await compare.getByRole('button',{name:'Search items'}).click();
 await expect(compare.getByLabel('Comparison item',{exact:true}).getByRole('option',{name:/OPP-V1/})).toHaveAttribute('disabled','');
 await compare.getByLabel('Comparison item',{exact:true}).selectOption('21');
 await compare.getByRole('button',{name:'Add comparison'}).click();
 await expect(compare.getByRole('columnheader')).toHaveCount(3);
 await expect(compare.getByRole('columnheader').nth(1)).toContainText('OPP-V1');
 await expect(compare.getByRole('columnheader').nth(2)).toContainText('OPP-OTHER');
 await compare.getByRole('button',{name:'Add comparison'}).click();
 await expect(compare.getByRole('columnheader')).toHaveCount(3);
 await compare.getByRole('button',{name:'Close Compare opportunity items',exact:true}).click();
 await expect(dialog.getByLabel('Processing ($/lbs)',{exact:true})).toHaveValue('0.8');
 expect(writes).toHaveLength(0);
});

test('stale version save retains the local edits',async({page})=>{
 const {dialog,state}=await setup(page);await dialog.getByLabel('TCB version item 11',{exact:true}).selectOption('2');
 await dialog.getByLabel('Processing ($/lbs)',{exact:true}).fill('0.6');
 await dialog.getByRole('button',{name:'Review & save',exact:true}).click();state.failSave=true;
 await dialog.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('TCB version changed');
 await expect(dialog.getByLabel('Processing ($/lbs)',{exact:true})).toHaveValue('0.6');
});

test('cancelling a dirty version switch preserves edits and the selected approach',async({page})=>{
 const {dialog,writes}=await setup(page);

 await dialog.getByLabel('Processing ($/lbs)',{exact:true}).fill('0.45');
 page.once('dialog',prompt=>prompt.dismiss());
 await dialog.getByLabel('TCB version item 11',{exact:true}).selectOption('2');
 await expect(dialog.getByLabel('TCB version item 11',{exact:true})).toHaveValue('1');
 await expect(dialog.getByLabel('Processing ($/lbs)',{exact:true})).toHaveValue('0.45');
 expect(writes).toHaveLength(0);
});

test('read-only items can inspect versions but cannot create or activate',async({page})=>{
 const {dialog,writes}=await setup(page,true);
 await expect(dialog.getByRole('button',{name:'New TCB version item 11'})).toBeDisabled();
 await dialog.getByLabel('TCB version item 11',{exact:true}).selectOption('2');
 await expect(dialog.getByRole('button',{name:'Set active',exact:true})).toBeDisabled();expect(writes).toHaveLength(0);
});
