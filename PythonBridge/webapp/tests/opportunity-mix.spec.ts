import {test,expect,type Page} from '@playwright/test';
const rv='AAAAAAAAAAE=';
const header={OpportunityID:1,OpportunityNumber:'OPP-MIX',HeaderStage:'Draft',HeaderRowVersion:rv,CustomerID:1,CustomerName:'Northstar',CustomerCurrencyCode:'USD',ExchangeRateVNDPerUSD:25000,ExchangeRateCustomerCurrencyPerUSD:1,OpportunityDesc:'Mix launch',BidOpen:'2026-09-01',BidClose:'2026-10-01'};
const parent={...header,ItemID:10,ProductID:20,ProductCode:'PRD-MIX',ProductName:'Mixed nuts',ItemDescription:'Mix pack',AnnualUnit:'10.0000',EstPctAwarded:50,ShelfPrice:5,ItemStage:'Draft',ItemRowVersion:rv,MixVersionID:7,PackagingType:'Box'};
const child={...header,ItemID:11,ParentItemID:10,ProductID:2,ProductCode:'PRD-ALM',ProductName:'Almonds',ItemDescription:'Almonds',AnnualUnit:'12.5000',EstPctAwarded:null,ShelfPrice:null,ItemStage:'Draft',ItemRowVersion:rv,MixVersionID:7,MixUnitQuantity:'1.2500',MixChildNumber:1,PackagingType:'Pouch'};
async function setup(page:Page,rows:unknown[]=[]){
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Sales',scopes:['Opportunity'],is_admin:false,user_id:10}});
  if(path==='/api/workbench/preferences')return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/opportunity/grid')return route.fulfill({json:{rows,total:rows.length?1:0,page:1}});
  if(path==='/api/opportunity/lookups')return route.fulfill({json:{packagingTypes:[{ID:11,PackagingOrder:'Primary',PackagingType:'Pouch',ParentTypeID:null,Status:'Active'},{ID:12,PackagingOrder:'Primary',PackagingType:'Bag',ParentTypeID:null,Status:'Active'}],pallets:[{ID:1,PalletSize:"1.1x1.1M"},{ID:2,PalletSize:"1200x1000MM"}],customers:[{ID:1,CustomerName:'Northstar',CustomerCurrencyCode:'USD'}],products:[{ID:20,ProductCode:'PRD-MIX',ProductName:'Mixed nuts',CustomerID:1,ShelfLifeDays:365}],mix_children:[
   {ParentProductID:20,MixVersionID:7,ProductID:2,ProductCode:'PRD-ALM',ProductName:'Almonds',UnitQuantity:'1.2500',ShelfLifeDays:180},
   {ParentProductID:20,MixVersionID:7,ProductID:3,ProductCode:'PRD-CAS',ProductName:'Cashews',UnitQuantity:'0.1250',ShelfLifeDays:null}
  ]}});
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
}

test('new mix previews numbered children, calculates units and saves child packaging with the snapshot',async({page})=>{
 await setup(page);let payload:any;
 await page.route('**/api/opportunity/batch',route=>{
  payload=route.request().postDataJSON();
  return route.fulfill({json:{header_results:[{RowNum:1,Status:'OK',OpportunityNumber:'OPP-MIX'}],item_results:payload.item_rows.map((r:any)=>({RowNum:r.RowNum,Status:'OK'}))}});
 });
 await page.getByRole('button',{name:'New Opportunity',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New Opportunity',exact:true});
 await form.getByLabel('Customer *',{exact:true}).selectOption('1');
 await form.getByLabel('Description *',{exact:true}).fill('Mix launch');
 await form.getByLabel('Bid open *').fill('2026-09-01');await form.getByLabel('Bid close *').fill('2026-10-01');
 await form.getByLabel('Exchange rate VND per USD *',{exact:true}).fill('25000');
 await form.getByLabel('Exchange rate Customer Currency per USD *',{exact:true}).fill('1');
 const root=form.getByRole('region',{name:'Item 1',exact:true});
 await root.getByLabel('Product *').selectOption('20');
 await root.getByLabel('Annual units *').fill('10');
 const first=form.getByRole('region',{name:'Item 1.1',exact:true}),second=form.getByRole('region',{name:'Item 1.2',exact:true});
 await expect(first.getByLabel('Product',{exact:true})).toHaveValue('PRD-ALM — Almonds');
 await expect(first.getByLabel('Annual units',{exact:true})).toHaveValue('12.5');
 await expect(second.getByLabel('Annual units',{exact:true})).toHaveValue('1.25');
 await expect(first.getByLabel('Annual units',{exact:true})).toHaveAttribute('readonly','');
 await expect(first.getByLabel('Estimated award %')).toHaveCount(0);
 await expect(first.getByLabel('Shelf price')).toHaveCount(0);
 await root.getByLabel('Annual units *').fill('1000');
 await expect(first.getByLabel('Annual units',{exact:true})).toHaveValue('1,250');
 await first.getByText('Packaging requirements',{exact:true}).click();
 await root.getByText('Packaging requirements',{exact:true}).click();
 await root.getByLabel('Configuration request',{exact:true}).selectOption('Pallet load');
 for(const label of ['Pallet size','Pallet stacking','Max pallet height (mm)','Container request']){
  await expect(first.getByLabel(label,{exact:true})).toHaveCount(0);
  await expect(root.getByLabel(label,{exact:true})).toBeVisible();
 }
 await expect(form.getByLabel('Barrier requirement',{exact:true})).toHaveCount(0);
 await expect(root.getByLabel('Shelf life (days)',{exact:true}).first()).toHaveValue('365');
 await expect(first.getByLabel('Shelf life (days)',{exact:true}).first()).toHaveValue('180');
 await expect(first.getByLabel('Shelf life (days)',{exact:true}).first()).toHaveAttribute('readonly','');
 await second.getByText('Packaging requirements',{exact:true}).click();
 await expect(second.getByLabel('Shelf life (days)',{exact:true}).first()).toHaveValue('');
 await root.getByLabel('Pallet size',{exact:true}).selectOption('1200x1000MM');
 await first.getByLabel('Primary Type',{exact:true}).selectOption('11');
 await root.getByRole('button',{name:'Show mix children for Item 1',exact:true}).click();
 await expect(first).toHaveCount(0);
 await root.getByRole('button',{name:'Show mix children for Item 1',exact:true}).click();
 await form.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('OPP-MIX created');
 expect(payload.item_rows).toHaveLength(1);
 expect(payload.item_rows[0]).toMatchObject({ProductID:20,AnnualUnit:1000,MixVersionID:7});
 expect(payload.item_rows[0].MixChildren).toHaveLength(2);
 expect(payload.item_rows[0].MixChildren[0]).toMatchObject({ProductID:2,PrimaryTypeID:'11'});
 expect(payload.item_rows[0].MixChildren[0].AnnualUnit).toBeUndefined();
 expect(payload.item_rows[0].PalletSize).toBe('1200x1000MM');
 for(const item of [payload.item_rows[0],...payload.item_rows[0].MixChildren]){
  expect(item.BarrierRequirement).toBeUndefined();expect(item.ShelfLifeDays).toBeUndefined();
 }
 for(const key of ['PalletSize','PalletStacking','MaxPalletHeightM','ContainerRequest'])
  expect(payload.item_rows[0].MixChildren[0][key]).toBeUndefined();
});

test('saved child remains editable while parent packaging is processing',async({page})=>{
 await setup(page,[{...parent,HasOpenPackagingRequest:true},child]);let payload:any;
 await page.route('**/api/opportunity/batch',route=>{
  payload=route.request().postDataJSON();
  return route.fulfill({json:{header_results:[{RowNum:1,Status:'OK',OpportunityNumber:'OPP-MIX'}],item_results:payload.item_rows.map((r:any)=>({RowNum:r.RowNum,Status:'OK'}))}});
 });
 await page.getByRole('button',{name:'Edit Opportunity OPP-MIX',exact:true}).click();
 const form=page.getByRole('dialog',{name:'Edit Opportunity',exact:true});
 await form.getByRole('button',{name:'Show mix children for Item 1',exact:true}).click();
 const entry=form.getByRole('region',{name:'Item 1.1',exact:true});
 await entry.getByText('Packaging requirements',{exact:true}).click();
 await entry.getByLabel('Primary Type',{exact:true}).selectOption('12');
 await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('OPP-MIX updated');
 expect(payload.item_rows).toHaveLength(1);
 expect(payload.item_rows[0]).toMatchObject({ID:11,RowVersion:rv,PrimaryTypeID:'12'});
 expect(payload.item_rows[0].ProductID).toBeUndefined();expect(payload.item_rows[0].AnnualUnit).toBeUndefined();
 for(const key of ['PalletSize','PalletStacking','MaxPalletHeightM','ContainerRequest','BarrierRequirement','ShelfLifeDays'])
  expect(payload.item_rows[0][key]).toBeUndefined();
});

test('copy between mix parent and child respects parent-only logistics and Product shelf life',async({page})=>{
 await setup(page,[parent,child]);
 await page.getByRole('button',{name:'Edit Opportunity OPP-MIX',exact:true}).click();
 const form=page.getByRole('dialog',{name:'Edit Opportunity',exact:true});
 await form.getByRole('button',{name:'Show mix children for Item 1',exact:true}).click();
 const root=form.getByRole('region',{name:'Item 1',exact:true}),entry=form.getByRole('region',{name:'Item 1.1',exact:true});
 await root.getByText('Packaging requirements',{exact:true}).click();await entry.getByText('Packaging requirements',{exact:true}).click();
 await root.getByLabel('Container request',{exact:true}).selectOption('Dry');
 await root.getByLabel('Configuration request',{exact:true}).selectOption('Both');
 await root.getByLabel('Pallet size',{exact:true}).selectOption('1.1x1.1M');
 await root.getByLabel('Pallet stacking',{exact:true}).selectOption('Single');
 await root.getByLabel('Primary Type',{exact:true}).selectOption('11');
 await entry.locator('.packaging-copy > button').click();await page.getByRole('dialog',{name:'Choose packaging source'}).getByLabel('Copy packaging from item').selectOption({label:'Item 1 - PRD-MIX - Mixed nuts'});
 await page.getByRole('dialog',{name:'Choose packaging source'}).getByRole('button',{name:'Copy packaging',exact:true}).click();
 await expect(entry.getByLabel('Primary Type',{exact:true})).toHaveValue('11');
 await expect(entry.getByLabel('Configuration request',{exact:true})).toHaveValue('Both');
 await expect(entry.getByLabel('Container request',{exact:true})).toHaveCount(0);
 await expect(entry.getByLabel('Pallet size',{exact:true})).toHaveCount(0);
 await expect(entry.getByLabel('Shelf life (days)',{exact:true}).first()).toHaveValue('180');
 await expect(entry.getByLabel('Annual units',{exact:true})).toHaveValue('12.5');
 await entry.getByLabel('Primary Type',{exact:true}).selectOption('12');
 await root.locator('.packaging-copy > button').click();await page.getByRole('dialog',{name:'Choose packaging source'}).getByLabel('Copy packaging from item').selectOption({label:'Item 1.1 - PRD-ALM - Almonds'});
 await page.getByRole('dialog',{name:'Choose packaging source'}).getByRole('button',{name:'Copy packaging',exact:true}).click();
 await expect(root.getByLabel('Primary Type',{exact:true})).toHaveValue('12');
 await expect(root.getByLabel('Container request',{exact:true})).toHaveValue('Dry');
 await expect(root.getByLabel('Pallet size',{exact:true})).toHaveValue('1.1x1.1M');
 await expect(root.getByLabel('Pallet stacking',{exact:true})).toHaveValue('Single');
 await expect(root.getByLabel('Shelf life (days)',{exact:true}).first()).toHaveValue('365');
});

test('parent and child with new Primary Type can be requested without legacy Packaging type',async({page})=>{
 await setup(page,[{...parent,PackagingType:null,PrimaryTypeID:11},{...child,PackagingType:null,PrimaryTypeID:11}]);let payload:any;
 await page.route('**/api/packaging/manual',route=>{
  payload=route.request().postDataJSON();
  return route.fulfill({json:{header:{ID:100,RequestNumber:'PCR-MIX'},items:payload.items.map((r:any,i:number)=>({ID:101+i,OpportunityItemID:r.OpportunityItemID})),replayed:false}});
 });
 await page.getByRole('button',{name:'View details',exact:true}).click();
 const table=page.getByRole('table',{name:'Opportunity items',exact:true});
 await expect(table.getByRole('row')).toHaveCount(2);
 await table.getByRole('button',{name:'Show mix children for Item 1',exact:true}).click();
 await expect(table.getByRole('row')).toHaveCount(3);await expect(table).toContainText('1.1');
 await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 await table.getByLabel('Select PRD-MIX item 10',{exact:true}).check();
 await table.getByLabel('Select PRD-ALM item 11',{exact:true}).check();
 await page.getByLabel('Response due',{exact:true}).fill('2026-10-20');
 await page.getByRole('button',{name:'Create Packaging Request (2)',exact:true}).click();
 await page.getByRole('button',{name:'Create request',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('PCR-MIX');
 expect(payload.items.map((r:any)=>r.OpportunityItemID)).toEqual([10,11]);
});
