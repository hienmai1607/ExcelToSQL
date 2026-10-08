import {test,expect,type Page} from '@playwright/test';
import {costSections,shipmentValues,shipmentError,shipmentPayload,fixedCost} from '../src/shipment-sections';
import {allowedContainerTypes} from '../src/container-loading';
const heading='Shipment, Logistics, Co-Man & Others info';
const rv='AAAAAAAAAAE=';
const customers=[{ID:1,CustomerName:'Northstar',CustomerCurrencyCode:'AUD',MarketID:5},{ID:2,CustomerName:'Other',CustomerCurrencyCode:'USD',MarketID:6}];
const ports=[{ID:11,CustomerID:1,MarketID:5,PortCode:'SEA',PortName:'Seattle'},{ID:12,CustomerID:1,MarketID:6,PortCode:'WRONG',PortName:'Wrong market'},{ID:13,CustomerID:2,MarketID:5,PortCode:'OTHER',PortName:'Other customer'}];
const products=[{ID:2,ProductCode:'PRD-2',ProductName:'Almonds',CustomerID:1,WeightGrams:150,ShelfLifeDays:365},{ID:3,ProductCode:'PRD-3',ProductName:'Cashews',CustomerID:1,WeightGrams:450},{ID:20,ProductCode:'PRD-MIX',ProductName:'Mix nuts',CustomerID:1,WeightGrams:750,IsMix:true}];
async function setup(page:Page,items:any[]=[],admin=false){
 const writes:any[]=[];
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Sales',user_id:10,scopes:[admin?'Admin':'Opportunity'],is_admin:admin}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/opportunity/grid')return route.fulfill({json:{rows:items,total:items.length?1:0,page:1}});
  if(path==='/api/opportunity/lookups')return route.fulfill({json:{customers,products,ports,pallets:[],packagingTypes:[],mix_children:[{ParentProductID:20,MixVersionID:7,ProductID:2,ProductCode:'PRD-2',ProductName:'Almonds',UnitQuantity:2},{ParentProductID:20,MixVersionID:7,ProductID:3,ProductCode:'PRD-3',ProductName:'Cashews',UnitQuantity:1}]}});
  if(path==='/api/opportunity/batch'){
   const payload=route.request().postDataJSON();writes.push(payload);
   return route.fulfill({json:{header_results:[{RowNum:1,Status:'OK',OpportunityNumber:'OPP-SHIP'}],item_results:payload.item_rows.map((row:any)=>({RowNum:row.RowNum,Status:'OK'}))}});
  }
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 return writes;
}
async function create(page:Page,product='2'){
 await page.getByRole('button',{name:'New Opportunity',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New Opportunity',exact:true});
 await form.getByLabel('Customer *',{exact:true}).selectOption('1');
 await form.getByLabel('Description *',{exact:true}).fill('Shipment test');
 await form.getByLabel('Exchange rate VND per USD *',{exact:true}).fill('25000');
 await form.getByLabel('Exchange rate Customer Currency per USD *',{exact:true}).fill('1.5');
 await form.getByLabel('Bid open *').fill('2026-10-01');await form.getByLabel('Bid close *').fill('2026-10-10');
 const item=form.getByRole('region',{name:'Item 1',exact:true});
 await item.getByLabel('Product *').selectOption(product);await item.getByLabel('Annual units *').fill('1000');
 await item.getByText(heading,{exact:true}).click();
 return {form,item};
}
test('all shipment costs are USD, grouped under one collapse, filtered and saved with two decimals',async({page},info)=>{
 const writes=await setup(page),{form,item}=await create(page);
 for(const title of ['Shipment','Logistics','Co-Man','Others'])await expect(item.getByRole('region',{name:title,exact:true})).toBeVisible();
 await expect(item.getByLabel('Container request',{exact:true})).toHaveCount(0);
 await expect(item.getByLabel('Configuration request',{exact:true}).locator('option')).toHaveText(['Choose configuration request','Dry','Reefer']);
 await expect(item.getByLabel('Loading request',{exact:true}).locator('option')).toHaveText(['Choose loading request','Pallet load','Floor load','Both']);
 await expect(item.getByLabel('Incoterm',{exact:true}).locator('option')).toHaveText(['Choose incoterm','CFA','DDP','EXW','FOB']);
 await expect(item.getByLabel('Port of Entry',{exact:true}).locator('option')).toHaveText(['Choose port of entry','Seattle']);
 await item.getByLabel('Configuration request',{exact:true}).selectOption('Reefer');
 await item.getByLabel('Loading request',{exact:true}).selectOption('Floor load');
 await item.getByLabel('Incoterm',{exact:true}).selectOption('CFA');
 await item.getByLabel('Port of Entry',{exact:true}).selectOption('11');
 await item.getByLabel('Container',{exact:true}).selectOption('40FT');
 for(const field of costSections.flatMap(s=>s.fields)){
  const input=item.getByLabel(field.label,{exact:true});await input.fill(field.kind==='months'?'3':'12.5');await input.blur();
  await expect(input).toHaveValue(field.kind==='months'?'3':'12.50');
  await expect(input.locator('..').locator('.info-tip')).toHaveCount(0);
 }
 await item.screenshot({path:info.outputPath('shipment-costs.png')});
 await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 const row=writes[0].item_rows[0];expect(row).toMatchObject({ContainerRequest:'Reefer',ConfigurationRequest:'Floor load',ShipmentCostInfo:{Incoterm:'CFA',PortOfEntryID:11,ContainerSizeFT:'40FT',InterestMonths:3}});
 for(const field of costSections.flatMap(s=>s.fields))expect(row.ShipmentCostInfo[field.key]).toBe(field.kind==='months'?3:'12.50');
});
test('Mix parent owns shipment and all costs; children inherit read-only without duplicate payloads',async({page})=>{
 const writes=await setup(page),{form,item}=await create(page,'20');
 await item.getByLabel('Configuration request',{exact:true}).selectOption('Dry');
 await item.getByLabel('Loading request',{exact:true}).selectOption('Both');
 await item.getByLabel('Container',{exact:true}).selectOption('20FT');
 await item.getByLabel('Freight ($/Container)',{exact:true}).fill('800');await item.getByLabel('Freight ($/Container)',{exact:true}).blur();
 for(const number of ['1.1','1.2']){
  const child=form.getByRole('region',{name:'Item '+number,exact:true});
  await child.getByText(heading,{exact:true}).click();
  await expect(child.getByLabel('Configuration request',{exact:true})).toHaveValue('Dry');
  await expect(child.getByLabel('Loading request',{exact:true})).toHaveValue('Both');
  await expect(child.getByLabel('Container',{exact:true})).toHaveValue('20FT');
  await expect(child.getByLabel('Freight ($/Container)',{exact:true})).toHaveValue('800.00');
  for(const field of await child.locator('.shipment-sections input').all())await expect(field).toHaveAttribute('readonly','');
 }
 await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0].item_rows).toHaveLength(1);
 expect(writes[0].item_rows[0].ShipmentCostInfo.FreightUSDPerContainer).toBe('800.00');
 for(const child of writes[0].item_rows[0].MixChildren)for(const key of ['ShipmentCostInfo','ContainerRequest','ConfigurationRequest'])expect(child).not.toHaveProperty(key);
});
test('container families and sizes include existing 40RHC only; cost validation preserves exact values',()=>{
 expect(allowedContainerTypes('Dry','20FT')).toEqual(['20DC']);
 expect(allowedContainerTypes('Dry','40FT')).toEqual(['40DC','40HC']);
 expect(allowedContainerTypes('Reefer','20FT')).toEqual(['20RC']);
 expect(allowedContainerTypes('Reefer','40FT')).toEqual(['40RHC']);
 expect(allowedContainerTypes('Both')).toHaveLength(5);
 const values=shipmentValues({FreightUSDPerContainer:'12345678901234567.89',InterestMonths:2});
 expect(shipmentPayload(values)?.FreightUSDPerContainer).toBe('12345678901234567.89');
 expect(shipmentError(values,undefined,customers[0],ports)).toBe('');
 for(const [key,value] of [['DutyPct','100.01'],['InterestMonths','1.5'],['FreightUSDPerContainer','1.234'],['PortOfEntryID','12']])expect(shipmentError({...values,[key]:value},undefined,customers[0],ports)).not.toBe('');
 expect(fixedCost('0012.5')).toBe('12.50');
});

for(const admin of [true,false])test('Port master '+(admin?'admin maintenance':'read-only close and escape'),async({page})=>{
 await setup(page,[],admin);const saved:any[]=[];
 const row={ID:11,RowVersion:rv,CustomerID:1,MarketID:5,PortCode:'SEA',PortName:'Seattle',Status:'Active',CustomerName:'Northstar',MarketCode:'US',MarketName:'United States'};
 await page.route('**/api/ports**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/lookups'))return route.fulfill({json:{customers:customers.map(c=>({...c,Status:'Active'})),markets:[{ID:5,MarketCode:'US',MarketName:'United States'},{ID:6,MarketCode:'AU',MarketName:'Australia'}]}});
  if(route.request().method()==='POST'){saved.push(route.request().postDataJSON());return route.fulfill({json:{rows:[{ID:11,RowVersion:rv}]}})}
  return route.fulfill({json:{rows:[row],total:1}});
 });
 await page.getByRole('button',{name:'Ports of Entry',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Ports of Entry',exact:true})).toBeVisible();
 if(admin){
  await page.getByRole('button',{name:'New port',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'New Port of Entry',exact:true});
  await editor.getByLabel('Customer',{exact:true}).selectOption('1');
  await expect(editor.getByLabel('Market',{exact:true})).toHaveValue('5');
  await expect(editor.getByLabel('Port code',{exact:true})).toHaveCount(0);await editor.getByLabel('Port name',{exact:true}).fill('Los Angeles');
  await editor.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
  expect(saved[0]).not.toHaveProperty('PortCode');
  expect(saved[0]).toMatchObject({CustomerID:1,MarketID:5,PortName:'Los Angeles',Status:'Active'});
 }else await expect(page.getByRole('button',{name:'New port',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'View Port 11',exact:true}).click();
 const editor=page.getByRole('dialog',{name:admin?'Edit Port of Entry':'View Port of Entry',exact:true});
 if(!admin){await expect(editor.getByLabel('Port name',{exact:true})).toBeDisabled();await expect(editor.getByRole('button',{name:'Review & save',exact:true})).toHaveCount(0)}
 await editor.getByRole('button',{name:'Close Port of Entry',exact:true}).click();await expect(editor).toHaveCount(0);
 await page.getByRole('button',{name:'View Port 11',exact:true}).click();await page.keyboard.press('Escape');await expect(editor).toHaveCount(0);
});
test('saved costs reopen and unavailable historical port is preserved',async({page})=>{
 const row={OpportunityID:1,OpportunityNumber:'OPP-SHIP',OpportunityDesc:'Saved shipment',CustomerID:1,CustomerName:'Northstar',CustomerCurrencyCode:'AUD',HeaderStage:'Draft',HeaderRowVersion:rv,BidOpen:'2026-10-01',BidClose:'2026-10-10',ExchangeRateVNDPerUSD:25000,ExchangeRateCustomerCurrencyPerUSD:1.5,ItemID:10,ProductID:2,ProductCode:'PRD-2',ProductName:'Almonds',AnnualUnit:1000,ItemStage:'Draft',ItemRowVersion:rv,ContainerRequest:'Dry',ConfigurationRequest:'Floor load',ShipmentCostInfo:JSON.stringify({PortOfEntryID:99,ContainerSizeFT:'40FT',Incoterm:'DDP',FreightUSDPerContainer:'1234.50',DutyPct:'5.00'})};
 const writes=await setup(page,[row]);
 await page.getByRole('button',{name:'Edit Opportunity OPP-SHIP',exact:true}).click();
 const form=page.getByRole('dialog',{name:'Edit Opportunity',exact:true}),item=form.getByRole('region',{name:'Item 1',exact:true});
 await item.getByText(heading,{exact:true}).click();
 await expect(item.getByLabel('Freight ($/Container)',{exact:true})).toHaveValue('1234.50');
 await expect(item.getByLabel('Port of Entry',{exact:true})).toHaveValue('99');
 await item.getByLabel('Duty %',{exact:true}).fill('6');await item.getByLabel('Duty %',{exact:true}).blur();
 await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0].item_rows[0].ShipmentCostInfo).toMatchObject({PortOfEntryID:99,FreightUSDPerContainer:'1234.50',DutyPct:'6.00'});
});

for(const mix of [false,true])test('processing '+(mix?'Mix parent':'regular item')+' keeps only shipment requirements locked and saves all other shipment fields',async({page})=>{
 const root={OpportunityID:1,OpportunityNumber:'OPP-SHIP',OpportunityDesc:'Processing shipment',CustomerID:1,CustomerName:'Northstar',CustomerCurrencyCode:'AUD',HeaderStage:'Draft',HeaderRowVersion:rv,BidOpen:'2026-10-01',BidClose:'2026-10-10',ExchangeRateVNDPerUSD:25000,ExchangeRateCustomerCurrencyPerUSD:1.5,ItemID:10,ProductID:mix?20:2,ProductCode:mix?'PRD-MIX':'PRD-2',ProductName:mix?'Mix nuts':'Almonds',AnnualUnit:1000,ItemStage:'Draft',ItemRowVersion:rv,HasOpenPackagingRequest:true,ContainerRequest:'Dry',ConfigurationRequest:'Both',ShipmentCostInfo:JSON.stringify({ContainerSizeFT:'20FT',FreightUSDPerContainer:'800.00'}),...(mix?{MixVersionID:7}:{})};
 const child={...root,ItemID:11,ParentItemID:10,ProductID:2,ProductCode:'PRD-2',ProductName:'Almonds',AnnualUnit:2000,MixUnitQuantity:2};
 const writes=await setup(page,mix?[root,child]:[root]);
 await page.getByRole('button',{name:'Edit Opportunity OPP-SHIP',exact:true}).click();
 const form=page.getByRole('dialog',{name:'Edit Opportunity',exact:true}),item=form.getByRole('region',{name:'Item 1',exact:true});
 await item.getByText(heading,{exact:true}).click();
 await expect(item.getByLabel('Product *',{exact:true})).toBeDisabled();
 await expect(item.getByLabel('Annual units *',{exact:true})).toBeDisabled();
 for(const name of ['Configuration request','Loading request'])await expect(item.getByLabel(name,{exact:true})).toBeDisabled();
 await expect(item.getByLabel('Configuration request',{exact:true})).toHaveValue('Dry');
 await expect(item.getByLabel('Loading request',{exact:true})).toHaveValue('Both');
 await item.getByLabel('Incoterm',{exact:true}).selectOption('FOB');
 await item.getByLabel('Port of Entry',{exact:true}).selectOption('11');
 await item.getByLabel('Container',{exact:true}).selectOption('40FT');
 for(const field of costSections.flatMap(section=>section.fields)){
  await expect(item.getByLabel(field.label,{exact:true})).toBeEditable();
  await item.getByLabel(field.label,{exact:true}).fill(field.kind==='months'?'3':'12.5');
  await item.getByLabel(field.label,{exact:true}).blur();
 }
 if(mix){
  await form.getByRole('button',{name:'Show mix children for Item 1',exact:true}).click();
  const entry=form.getByRole('region',{name:'Item 1.1',exact:true});
  await entry.getByText(heading,{exact:true}).click();
  await expect(entry.getByLabel('Container',{exact:true})).toHaveValue('40FT');
  await expect(entry.getByLabel('Freight ($/Container)',{exact:true})).toHaveValue('12.50');
  await expect(entry.getByLabel('Freight ($/Container)',{exact:true})).toHaveAttribute('readonly','');
 }
 await expect(form.getByRole('button',{name:'Review & save'})).toBeEnabled();
 await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0].item_rows).toHaveLength(1);
 const saved=writes[0].item_rows[0];
 expect(Object.keys(saved).sort()).toEqual(['RowNum','Command','ID','RowVersion','OpportunityNumber','ShipmentCostInfo'].sort());
 expect(saved.ShipmentCostInfo).toMatchObject({Incoterm:'FOB',PortOfEntryID:11,ContainerSizeFT:'40FT',FreightUSDPerContainer:'12.50',InterestMonths:3});
});
