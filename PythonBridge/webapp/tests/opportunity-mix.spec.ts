import {test,expect,type Page} from '@playwright/test';

test('Opportunity responses show each item current linked PCR, including mix children and unlinked items',async({page})=>{
 await setup(page,[{...parent,PackagingRequestNumber:'PCR-30293'},
  {...child,PackagingRequestNumber:'PCR-30294'},
  {...parent,ItemID:20,ProductCode:'PRD-OTHER',MixVersionID:null,PackagingRequestNumber:null,OpenPackagingRequestNumber:'PCR-OLD'}]);
 await page.getByRole('button',{name:'View details',exact:true}).click();
 const table=page.getByRole('table',{name:'Opportunity items',exact:true});
 await table.getByRole('button',{name:'Show mix children for Item 1',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Responses',exact:true}).click();
 const headings=await table.getByRole('columnheader').allTextContents();
 const index=headings.findIndex(text=>text.includes('Current linked PCR'));
 expect(index).toBeGreaterThan(0);
 expect(index).toBeLessThan(headings.findIndex(text=>text.includes('Container type')));
 const rows=table.locator('tbody tr');
 await expect(rows.nth(0).getByRole('cell').nth(index)).toHaveText('PCR-30293');
 await expect(rows.nth(1).getByRole('cell').nth(index)).toHaveText('PCR-30294');
 await expect(rows.nth(2).getByRole('cell').nth(index)).toHaveText('—');
 await page.getByRole('button',{name:'All Fields',exact:true}).click();
 await expect(table.getByRole('columnheader',{name:/Current linked PCR/})).toHaveCount(1);
 await page.getByRole('button',{name:'Product Info',exact:true}).click();
 await expect(table.getByRole('columnheader',{name:/Current linked PCR/})).toHaveCount(0);
});

test('mix parent slots offer only Secondary/Tertiary master orders and save cross-order choices',async({page})=>{
 await setup(page,[{...parent,PackagingLayerCount:3}, {...child,PackagingLayerCount:2}]);let payload:any;
 const types=[
  {ID:11,PackagingOrder:'Primary',PackagingType:'Primary bag',Shipping:false},
  {ID:12,PackagingOrder:'Secondary',PackagingType:'Tray',Shipping:false},
  {ID:13,PackagingOrder:'Secondary',PackagingType:'Shipping case',Shipping:true},
  {ID:14,PackagingOrder:'Tertiary',PackagingType:'Shipping carton',Shipping:true},
  {ID:15,PackagingOrders:['Primary','Secondary'],PackagingType:'PET jar',Shipping:false},
  {ID:16,PackagingOrder:'Secondary',PackagingType:'Child component',ParentTypeID:13,Shipping:false},
  {ID:17,PackagingOrder:'Tertiary',PackagingType:'Storage case',Shipping:false}
 ].map(t=>({Status:'Active',ParentTypeID:null,...t}));
 await page.route('**/api/opportunity/lookups',route=>route.fulfill({json:{
  customers:[{ID:1,CustomerName:'Northstar',CustomerCurrencyCode:'USD'}],
  products:[{ID:20,ProductCode:'PRD-MIX',ProductName:'Mixed nuts',CustomerID:1,IsMix:true}],
  mix_children:[],pallets:[],packagingTypes:types
 }}));
 await page.route('**/api/opportunity/batch',route=>{payload=route.request().postDataJSON();return route.fulfill({json:{
  header_results:[{RowNum:1,Status:'OK',OpportunityNumber:'OPP-MIX'}],
  item_results:payload.item_rows.map((r:any)=>({RowNum:r.RowNum,Status:'OK'}))
 }})});
 await page.getByRole('button',{name:'Edit Opportunity OPP-MIX',exact:true}).click();
 const form=page.getByRole('dialog',{name:'Edit Opportunity',exact:true}),root=form.getByRole('region',{name:'Item 1',exact:true});
 await root.getByRole('button',{name:'Show mix children for Item 1',exact:true}).click();
 const component=form.getByRole('region',{name:'Item 1.1',exact:true});
 await root.getByText('Packaging requirements',{exact:true}).click();await component.getByText('Packaging requirements',{exact:true}).click();
 for(const layer of ['Primary','Secondary'])await expect(root.getByLabel(layer+' Type',{exact:true}).locator('option')).toHaveText(['Choose '+layer.toLowerCase()+' type','Tray','Shipping case','Shipping carton','PET jar','Storage case']);
 await expect(root.getByLabel('Tertiary Type',{exact:true}).locator('option')).toHaveText(['Choose tertiary type','Shipping case','Shipping carton']);
 await expect(component.getByLabel('Primary Type',{exact:true}).locator('option')).toHaveText(['Choose primary type','Primary bag','PET jar']);
 await expect(component.getByLabel('Secondary Type',{exact:true}).locator('option')).toHaveText(['Choose secondary type','Tray','Shipping case','PET jar']);
 await root.getByLabel('Primary Type',{exact:true}).selectOption('12');
 await root.getByLabel('Secondary Type',{exact:true}).selectOption('14');
 await root.getByLabel('Tertiary Type',{exact:true}).selectOption('13');
 await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('OPP-MIX updated');
 expect(payload.item_rows).toHaveLength(1);
 expect(payload.item_rows[0]).toMatchObject({ID:10,PrimaryTypeID:'12',SecondaryTypeID:'14',TertiaryTypeID:'13'});
});

test('mix counts explain composition and Grades opens the saved Product structure',async({page})=>{
 await setup(page,[{...parent,PackagingLayerCount:2},child]);
 await page.getByRole('button',{name:'Edit Opportunity OPP-MIX',exact:true}).click();
 const form=page.getByRole('dialog',{name:'Edit Opportunity',exact:true}),root=form.getByRole('region',{name:'Item 1',exact:true});
 await root.getByText('Packaging requirements',{exact:true}).click();
 await expect(root.getByLabel('No of Primary Mix Unit',{exact:true})).toBeVisible();
 await expect(root.getByText('No of Secondary Mix Unit',{exact:true})).toBeVisible();
 await expect(root.getByRole('note',{name:'Mix Product = 1.25 × Almonds',exact:true})).toHaveCount(2);
 await root.getByRole('button',{name:'View grade snapshot',exact:true}).click();
 const structure=page.getByRole('dialog',{name:'Product structure',exact:true});
 await expect(structure.getByRole('cell',{name:'PRD-ALM · Almonds',exact:true})).toBeVisible();
 await expect(structure.getByRole('cell',{name:'1.25',exact:true})).toBeVisible();
 await structure.getByRole('button',{name:'Grade',exact:true}).click();
 await expect(structure.getByRole('region',{name:'Child grades PRD-ALM'})).toBeVisible();
 await expect(structure.getByRole('button',{name:'Use grades'})).toHaveCount(0);
 await structure.getByRole('button',{name:'Close product structure',exact:true}).click();
 await expect(form).toBeVisible();
});

test('child final layer offers non-shipping types while the mix parent requires Shipping',async({page})=>{
 await setup(page,[{...parent,PackagingLayerCount:2}, {...child,PackagingLayerCount:2}]);
 await page.route('**/api/opportunity/lookups',route=>route.fulfill({json:{
  customers:[{ID:1,CustomerName:'Northstar',CustomerCurrencyCode:'USD'}],
  products:[{ID:20,ProductCode:'PRD-MIX',ProductName:'Mixed nuts',CustomerID:1}],
  mix_children:[],pallets:[],packagingTypes:[
   {ID:11,PackagingOrder:'Primary',PackagingType:'Pouch',ParentTypeID:null,Status:'Active',Shipping:false},
   {ID:12,PackagingOrder:'Secondary',PackagingType:'Jar',ParentTypeID:null,Status:'Active',Shipping:false},
   {ID:13,PackagingOrder:'Secondary',PackagingType:'Carton',ParentTypeID:null,Status:'Active',Shipping:true}
  ]}}));
 await page.getByRole('button',{name:'Edit Opportunity OPP-MIX',exact:true}).click();
 const form=page.getByRole('dialog',{name:'Edit Opportunity',exact:true}),root=form.getByRole('region',{name:'Item 1',exact:true});
 await root.getByRole('button',{name:'Show mix children for Item 1',exact:true}).click();
 const component=form.getByRole('region',{name:'Item 1.1',exact:true});
 await root.getByText('Packaging requirements',{exact:true}).click();
 await component.getByText('Packaging requirements',{exact:true}).click();
 await expect(root.getByLabel('Secondary Type',{exact:true}).locator('option')).toHaveText(['Choose secondary type','Carton']);
 await expect(component.getByLabel('Secondary Type',{exact:true}).locator('option')).toHaveText(['Choose secondary type','Jar','Carton']);
 await component.getByLabel('Secondary Type',{exact:true}).selectOption('12');
 for(const name of ['Container request','Configuration request','Pallet size','Max pallet height (mm)'])await expect(component.getByLabel(name,{exact:true})).toHaveCount(0);
});
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
  if(path==='/api/opportunity/lookups')return route.fulfill({json:{packagingTypes:[{ID:11,PackagingOrder:'Primary',PackagingOrders:['Primary','Secondary'],PackagingType:'Pouch',ParentTypeID:null,Status:'Active'},{ID:12,PackagingOrder:'Primary',PackagingType:'Bag',ParentTypeID:null,Status:'Active'}],pallets:[{ID:1,PalletSize:"1.1x1.1M"},{ID:2,PalletSize:"1200x1000MM"}],customers:[{ID:1,CustomerName:'Northstar',CustomerCurrencyCode:'USD'}],products:[{ID:20,ProductCode:'PRD-MIX',ProductName:'Mixed nuts',CustomerID:1,ShelfLifeDays:365}],mix_children:[
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
 for(const label of ['Pallet size','Pallet stacking','Max pallet height (mm)','Container request','Configuration request']){
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
 for(const key of ['PalletSize','PalletStacking','MaxPalletHeightM','ContainerRequest','ConfigurationRequest'])
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
 await expect(entry.getByLabel('Configuration request',{exact:true})).toHaveCount(0);
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

test('selecting a collapsed mix parent includes every child in the request payload',async({page})=>{
 const secondChild={...child,ItemID:12,ProductID:3,ProductCode:'PRD-CAS',MixChildNumber:2};
 await setup(page,[parent,child,secondChild]);let payload:any;
 await page.route('**/api/packaging/manual',route=>{
  payload=route.request().postDataJSON();
  return route.fulfill({json:{header:{ID:100,RequestNumber:'PCR-MIX'},items:payload.items.map((r:any,i:number)=>({ID:101+i,OpportunityItemID:r.OpportunityItemID})),replayed:false}});
 });
 await page.getByRole('button',{name:'View details',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 const table=page.getByRole('table',{name:'Opportunity items',exact:true});
 await expect(table.getByRole('row')).toHaveCount(2);
 await table.getByLabel('Select PRD-MIX item 10',{exact:true}).check();
 await page.getByLabel('Response due',{exact:true}).fill('2026-10-20');
 await expect(page.getByRole('button',{name:'Create Packaging Request (3)',exact:true})).toBeEnabled();
 await table.getByRole('button',{name:'Show mix children for Item 1',exact:true}).click();
 for(const label of ['Select PRD-ALM item 11','Select PRD-CAS item 12'])await expect(table.getByLabel(label,{exact:true})).toBeChecked();
 await table.getByRole('button',{name:'Show mix children for Item 1',exact:true}).click();
 await page.getByRole('button',{name:'Create Packaging Request (3)',exact:true}).click();
 await page.getByRole('button',{name:'Create request',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('PCR-MIX');
 expect(payload.items.map((r:any)=>r.OpportunityItemID)).toEqual([10,11,12]);
});

test('mix selection skips blocked children, keeps individual selection and clears only its own group',async({page})=>{
 const sibling={...child,ItemID:12,ProductCode:'PRD-CAS',MixChildNumber:2};
 const active={...child,ItemID:13,ProductCode:'PRD-OPEN',MixChildNumber:3,HasOpenPackagingRequest:true};
 const closed={...child,ItemID:14,ProductCode:'PRD-CLOSED',MixChildNumber:4,ItemStage:'Closed'};
 const unrelated={...parent,ItemID:20,ProductCode:'PRD-OTHER',MixVersionID:null};
 await setup(page,[parent,child,sibling,active,closed,unrelated]);
 await page.getByRole('button',{name:'View details',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 const table=page.getByRole('table',{name:'Opportunity items',exact:true});
 await table.getByRole('button',{name:'Show mix children for Item 1',exact:true}).click();
 const root=table.getByLabel('Select PRD-MIX item 10',{exact:true});
 const first=table.getByLabel('Select PRD-ALM item 11',{exact:true});
 const second=table.getByLabel('Select PRD-CAS item 12',{exact:true});
 const other=table.getByLabel('Select PRD-OTHER item 20',{exact:true});
 await first.check();await expect(root).not.toBeChecked();await expect(second).not.toBeChecked();
 await other.check();await root.check();
 await expect(first).toBeChecked();await expect(second).toBeChecked();
 for(const label of ['Select PRD-OPEN item 13','Select PRD-CLOSED item 14']){
  await expect(table.getByLabel(label,{exact:true})).toBeDisabled();
  await expect(table.getByLabel(label,{exact:true})).not.toBeChecked();
 }
 await first.uncheck();await expect(root).toBeChecked();await expect(second).toBeChecked();
 await root.uncheck();await expect(first).not.toBeChecked();await expect(second).not.toBeChecked();await expect(other).toBeChecked();
 await root.check();await expect(first).toBeChecked();await expect(second).toBeChecked();
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
 await expect(table.getByLabel('Select PRD-ALM item 11',{exact:true})).toBeChecked();
 await page.getByLabel('Response due',{exact:true}).fill('2026-10-20');
 await page.getByRole('button',{name:'Create Packaging Request (2)',exact:true}).click();
 await page.getByRole('button',{name:'Create request',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('PCR-MIX');
 expect(payload.items.map((r:any)=>r.OpportunityItemID)).toEqual([10,11]);
});
