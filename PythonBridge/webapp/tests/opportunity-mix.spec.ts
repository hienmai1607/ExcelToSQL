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

test('Milestone details are collapsed by default and expand by clicking the milestone',async({page})=>{
 await setup(page,[parent,{...child,StageSummaryJSON:JSON.stringify({PackagingStage:'Approved',TCBSaved:true,PricesSaved:true,ProductInfoComplete:true,PackagingRequirementsComplete:false,ProductReviewComplete:false,ProductReviewMissingFields:['Primary Type']})}]);
 await page.getByRole('button',{name:'View details',exact:true}).click();
 await page.getByRole('button',{name:'Stage Summary',exact:true}).click();
 const card=page.getByRole('article',{name:'Stage for Item 1.1',exact:true});
 const tcb=card.locator('.stage-tcb-details');
 await expect(tcb.locator('ul')).not.toBeVisible();
 await expect(tcb.getByText(/inherited from the parent item/)).not.toBeVisible();
 const toggle=card.getByLabel('View details for TCB Entries item 1.1',{exact:true});
 await expect(toggle).toHaveAttribute('aria-expanded','false');
 await expect(card.locator('.stage-note-chevron')).toHaveCount(0);
 await toggle.locator('.stage-tcb-heading').click();
 await expect(toggle).toHaveAttribute('aria-expanded','true');
 const styling=await toggle.evaluate(el=>({background:getComputedStyle(el).backgroundColor,width:el.getBoundingClientRect().width,parentWidth:el.parentElement!.getBoundingClientRect().width,radius:getComputedStyle(el.querySelector('.stage-tcb-heading')!).borderRadius}));
 expect(styling.background).toBe('rgba(0, 0, 0, 0)');
 expect(styling.width).toBeLessThan(styling.parentWidth/2);
 expect(styling.radius).toBe('999px');
 await expect(tcb.locator('ul')).toBeVisible();
 await expect(tcb.getByText(/inherited from the parent item/)).toBeVisible();
 await toggle.press('Enter');
 await expect(tcb.locator('ul')).not.toBeVisible();
 const review=card.getByLabel('View details for Product Review item 1.1',{exact:true});
 await expect(card.locator('.stage-note-content').nth(1)).not.toBeVisible();
 await review.locator('.stage-dot').click();
 await expect(card.locator('.stage-note-content').nth(1)).toBeVisible();
 await expect(card.locator('.stage-note-content').nth(1)).toContainText('Missing: Primary Type');
 expect(await card.locator('.stage-node small').nth(1).evaluate(el=>getComputedStyle(el).overflowY)).toBe('visible');
});

test('Product Review uses saved required fields rather than Draft status or optional blanks',async({page})=>{
 await setup(page,[{...parent,StageSummaryJSON:JSON.stringify({ProductInfoComplete:true,PackagingRequirementsComplete:true,ProductReviewComplete:true,ProductReviewMissingFields:[]})},{...child,StageSummaryJSON:JSON.stringify({ProductInfoComplete:true,PackagingRequirementsComplete:false,ProductReviewComplete:false,ProductReviewMissingFields:['Primary Type']})}]);
 await page.getByRole('button',{name:'View details',exact:true}).click();
 await page.getByRole('button',{name:'Stage Summary',exact:true}).click();
 const full=page.getByRole('article',{name:'Stage for Item 1',exact:true}),partial=page.getByRole('article',{name:'Stage for Item 1.1',exact:true});
 await expect(full.locator('.stage-node').nth(1)).toHaveClass('stage-node complete');
 await expect(full.locator('.stage-node').nth(1).locator('.stage-note-status')).toHaveText('Complete');
 await expect(full.locator('.stage-node').nth(1).locator('small')).toHaveAttribute('title','Product Info: Complete / Packaging requirements: Complete');
 expect(await full.locator('.stage-node').nth(1).locator('small').evaluate(el=>getComputedStyle(el).overflowY)).toBe('visible');
 await expect(full.locator('.stage-node').nth(2)).toHaveClass('stage-node pending');
 await expect(partial.locator('.stage-node').nth(1)).toHaveClass('stage-node current');
 await expect(partial.locator('.stage-node').nth(1).locator('.stage-note-status')).toHaveText('Incomplete');
 await expect(partial.locator('.stage-node').nth(1).locator('small')).toHaveAttribute('title','Product Info: Complete / Packaging requirements: Incomplete - Missing: Primary Type');
});

test('Stage palette follows the numbered strip and TCB branch inherits and blends its parent color',async({page},info)=>{
 await setup(page,[{...parent,StageSummaryJSON:JSON.stringify({PackagingStage:'Approved',TCBSaved:true,TCBEntriesComplete:true,TCBReviewComplete:true})},{...child,StageSummaryJSON:JSON.stringify({PackagingStage:'Returned',TCBSaved:true,TCBEntriesComplete:true,TCBReviewComplete:true})}]);
 await page.getByRole('button',{name:'View details',exact:true}).click();
 await page.getByRole('button',{name:'Stage Summary',exact:true}).click();
 const root=page.getByRole('article',{name:'Stage for Item 1',exact:true});
 expect(await root.locator('.stage-node').evaluateAll(nodes=>nodes.map(el=>(el as HTMLElement).style.getPropertyValue('--stage-color')))).toEqual(['#ff2600','#ff5100','#ff9100','#ffc400','#ffff00','#d4ff00','#00ee00','#008e8e','#003bff']);
 const parentColor=await root.locator('.stage-node').nth(1).locator('.stage-dot').evaluate(el=>getComputedStyle(el).borderTopColor);
 expect(await root.locator('.stage-tcb-dot').evaluate(el=>getComputedStyle(el).borderTopColor)).toBe(parentColor);
 expect(await root.locator('path[data-from="Product Review"]').evaluate(el=>getComputedStyle(el).stroke)).toBe(parentColor);
 const merge=root.locator('path[data-to="TCB Review"]');
 expect(await merge.evaluate(el=>getComputedStyle(el).stroke)).toContain('url(');
 await expect(root.locator('linearGradient stop').nth(1)).toHaveAttribute('offset','66.6667%');
 await expect(root.locator('linearGradient stop').nth(1)).toHaveAttribute('stop-color','#ff5100');
 await expect(root.locator('linearGradient stop').nth(2)).toHaveAttribute('stop-color','#d4ff00');
 const rejected=page.getByRole('article',{name:'Stage for Item 1.1',exact:true});
 expect(await rejected.locator('path[data-to="TCB Review"]').evaluate(el=>getComputedStyle(el).stroke)).toBe('rgb(197, 206, 204)');
 expect(await root.locator('linearGradient').getAttribute('id')).not.toBe(await rejected.locator('linearGradient').getAttribute('id'));
 await root.screenshot({path:info.outputPath('stage-strip-colors.png')});
});

test('Completed TCB Entries advance independently and full Analysis completes TCB Review',async({page})=>{
 await setup(page,[{...parent,StageSummaryJSON:JSON.stringify({PackagingStage:'Pending Review',TCBSaved:true,TCBEntriesComplete:true,TCBReviewComplete:false,AnalysisMissingFields:['Freight ($/unit)']})},{...child,StageSummaryJSON:JSON.stringify({PackagingStage:'Approved',TCBSaved:true,TCBEntriesComplete:true,TCBReviewComplete:true,PricesSaved:true,PricesFromChildren:true})}]);
 await page.getByRole('button',{name:'View details',exact:true}).click();
 await page.getByRole('button',{name:'Stage Summary',exact:true}).click();
 const root=page.getByRole('article',{name:'Stage for Item 1',exact:true}),complete=page.getByRole('article',{name:'Stage for Item 1.1',exact:true});
 await expect(root.locator('path[data-to="TCB Review"]')).toHaveClass('reached');
 await expect(root.locator('.stage-flow>li').nth(5)).toHaveClass('stage-node pending');
 await expect(root.locator('[aria-current="step"]')).toContainText('TCB Review');
 await expect(root).toContainText('1 Analysis fields unavailable');
 await expect(complete.locator('.stage-flow>li').nth(6)).toHaveClass('stage-node complete');
 await expect(complete.locator('[aria-current="step"]')).toContainText('Customer proposal');
 await expect(complete).toContainText('Analysis complete');
 await expect(complete).toContainText('Price entries: From child items');
 expect(await complete.locator('.stage-flow>li').nth(6).evaluate(el=>getComputedStyle(el,'::after').backgroundColor)).not.toBe('rgb(197, 206, 204)');
});

for(const stage of ['Returned','Canceled','Pending Review','Approved'])test('Stage Summary grays future paths for '+stage,async({page})=>{
 await setup(page,[{...parent,StageSummaryJSON:JSON.stringify({PackagingStage:stage,RequestNumber:'PCR-1',TCBSaved:true,TCBEntriesComplete:stage==='Returned'||stage==='Canceled',TCBReviewComplete:stage==='Returned'||stage==='Canceled',Reason:'Check again'})}]);
 await page.getByRole('button',{name:'View details',exact:true}).click();
 await page.getByRole('button',{name:'Stage Summary',exact:true}).click();
 const card=page.getByRole('article',{name:'Stage for Item 1',exact:true}),nodes=card.locator('.stage-flow>li');
 await expect(nodes.locator('strong')).toHaveText(['Initial','Product Review','Packaging requested','PIC Assigned','Review Submitted','Review result','TCB Review','Customer proposal','Customer result']);
 await expect(card.getByRole('heading',{name:/TCB Entries/})).toBeVisible();
 await expect(card.locator('path[data-to="TCB Review"]')).toHaveClass('pending');
 expect(await card.locator('path[data-to="TCB Review"]').evaluate(el=>getComputedStyle(el).stroke)).toBe('rgb(197, 206, 204)');
 const outgoing=stage==='Returned'?5:stage==='Pending Review'?4:stage==='Approved'?6:1;
 expect(await nodes.nth(outgoing).evaluate(el=>getComputedStyle(el,'::after').backgroundColor)).toBe('rgb(197, 206, 204)');
 if(stage==='Returned'||stage==='Canceled'){
  await expect(nodes.nth(5).locator('.stage-dot')).toHaveText('\u00d7');
  expect(await nodes.nth(5).locator('.stage-dot').evaluate(el=>getComputedStyle(el).color)).toBe('rgb(186, 48, 40)');
 }else await expect(card.locator('.stage-node.blocked')).toHaveCount(0);
 if(stage==='Approved')await expect(card.locator('[aria-current="step"]')).toContainText('TCB Review');
});

test('Stage Summary formats request and review timestamps like Requested at',async({page})=>{
 await setup(page,[{...parent,StageSummaryJSON:JSON.stringify({PackagingStage:'Approved',RequestNumber:'PCR-30508',RequestedAt:'2026-10-06 03:15:58.637466',SubmittedAt:'2026-10-06 04:15:00',ReviewedAt:'2026-10-06 05:15:00'})}]);
 await page.getByRole('button',{name:'View details',exact:true}).click();
 await page.getByRole('button',{name:'Stage Summary',exact:true}).click();
 const root=page.getByRole('article',{name:'Stage for Item 1',exact:true});
 await expect(root).toContainText('10/06/2026, 10:15 AM');
 await expect(root).toContainText('10/06/2026, 11:15 AM');
 await expect(root).toContainText('10/06/2026, 12:15 PM');
 await expect(root).not.toContainText('637466');
});

test('TCB Entries branch connects Product Review to TCB Review and Draft displays as Initial',async({page},info)=>{
 await setup(page,[{...parent,StageSummaryJSON:JSON.stringify({TCBSaved:true})},child]);
 await page.getByRole('button',{name:'View details',exact:true}).click();
 await page.getByRole('button',{name:'Stage Summary',exact:true}).click();
 const root=page.getByRole('article',{name:'Stage for Item 1',exact:true});
 await expect(root.locator('[aria-current="step"]')).toContainText('Initial');
 await expect(root.locator('.stage-node').nth(1).locator('.stage-note-status')).toHaveText('Not reviewed');
 await expect(root.locator('.stage-flow strong')).not.toContainText(['Draft']);
 await expect(root.getByRole('region',{name:'TCB Entries branch from Product Review to TCB Review',exact:true})).toBeVisible();
 const geometry=await root.evaluate(el=>{
  const svg=el.querySelector('svg')!,path=svg.querySelector('path')!,out=svg.querySelector('[data-to="TCB Review"]') as SVGPathElement,nodes=el.querySelectorAll('.stage-flow .stage-dot');
  const start=path.getPointAtLength(0),end=out.getPointAtLength(out.getTotalLength()),matrix=path.getScreenCTM()!;
  const first=new DOMPoint(start.x,start.y).matrixTransform(matrix),last=new DOMPoint(end.x,end.y).matrixTransform(matrix);
  const from=nodes[1].getBoundingClientRect(),to=nodes[6].getBoundingClientRect(),tcb=el.querySelector('.stage-tcb-dot')!.getBoundingClientRect();
  return {startX:first.x,startY:first.y,endX:last.x,endY:last.y,fromX:from.x+from.width/2,fromY:from.y+from.height/2,toX:to.x+to.width/2,toY:to.y+to.height/2,tcbY:tcb.y+ tcb.height/2};
 });
 expect(Math.abs(geometry.startX-geometry.fromX)).toBeLessThan(2);
 expect(Math.abs(geometry.startY-geometry.fromY)).toBeLessThan(2);
 expect(Math.abs(geometry.endX-geometry.toX)).toBeLessThan(2);
 expect(Math.abs(geometry.endY-geometry.toY)).toBeLessThan(2);
 expect(geometry.tcbY).toBeGreaterThan(geometry.fromY+100);
 await root.screenshot({path:info.outputPath('stage-branch.png')});
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
 await expect(root.locator('path[data-from="Product Review"][data-to="TCB Entries"]')).toHaveCount(1);
});

test('Product Info has no TCB launcher and Stage Summary includes collapsed children',async({page})=>{
 await setup(page,[{...parent,StageSummaryJSON:JSON.stringify({PackagingStage:'Working',RequestNumber:'PCR-1',PIC:'Alex',TCBSaved:true})},{...child,StageSummaryJSON:JSON.stringify({PackagingStage:'Returned',Reason:'Resize carton',SubmittedAt:'2026-10-08',ShipmentSaved:true})}]);
 await page.getByRole('button',{name:'View details',exact:true}).click();
 await page.getByRole('button',{name:'Product Info',exact:true}).click();
 await expect(page.getByRole('button',{name:/TCB Review for/})).toHaveCount(0);
 await page.getByRole('button',{name:'TCB Review',exact:true}).click();
 await expect(page.getByRole('button',{name:'TCB Review for PRD-MIX item 10',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Stage Summary',exact:true}).click();
 const summary=page.getByRole('region',{name:'Stage Summary',exact:true});
 const root=summary.getByRole('article',{name:'Stage for Item 1',exact:true}),childCard=summary.getByRole('article',{name:'Stage for Item 1.1',exact:true});
 await expect(root.locator('[aria-current="step"]')).toContainText('PIC Assigned');
 await expect(childCard.locator('[aria-current="step"]')).toContainText('Review result');
 await expect(childCard).toContainText('Returned');
 await expect(childCard).toContainText('Resize carton');
 await expect(root).toContainText('Inputs saved');
 await expect(childCard).toContainText('inherited from the parent');
 await expect(summary.getByRole('button',{name:/TCB Review for/})).toHaveCount(0);
 await page.getByRole('button',{name:'Product Info',exact:true}).click();
 await expect(summary).toHaveCount(0);
});
test('Stage Summary cancellation loops to Product Review and shows customer result',async({page})=>{
 await setup(page,[{...parent,StageSummaryJSON:JSON.stringify({PackagingStage:'Canceled',Reason:'Specification changed'})},{...child,ItemStage:'Awarded'}]);
 await page.getByRole('button',{name:'View details',exact:true}).click();
 await page.getByRole('button',{name:'Stage Summary',exact:true}).click();
 const root=page.getByRole('article',{name:'Stage for Item 1',exact:true}),childCard=page.getByRole('article',{name:'Stage for Item 1.1',exact:true});
 await expect(root.locator('[aria-current="step"]')).toContainText('Product Review');
 await expect(root).toContainText('Specification changed');await expect(root).toContainText('Rejected / Canceled');
 await expect(childCard.locator('[aria-current="step"]')).toContainText('Customer result');
 await expect(childCard).toContainText('Awarded');
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
 const scroll=root.locator('.stage-flow-scroll');expect(await scroll.evaluate(el=>el.scrollWidth>el.clientWidth)).toBeTruthy();
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
 ].map(t=>({Status:'Active',ParentTypeID:null,...t,PackagingOrders:[...(t.PackagingOrders??[t.PackagingOrder]),...(t.ID===11||t.ID===16?[]:['Primary Mix','Secondary Mix']),...(t.Shipping?['Tertiary Mix']:[])]}));
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
 await root.getByText('Packaging requirements',{exact:true}).click();await root.getByText('Shipment, Logistics, Co-Man & Others info',{exact:true}).click();await component.getByText('Packaging requirements',{exact:true}).click();await component.getByText('Others Info',{exact:true}).click();
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
 await root.getByText('Packaging requirements',{exact:true}).click();await root.getByText('Shipment, Logistics, Co-Man & Others info',{exact:true}).click();
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
   {ID:13,PackagingOrder:'Secondary',PackagingOrders:['Secondary','Secondary Mix'],PackagingType:'Carton',ParentTypeID:null,Status:'Active',Shipping:true}
  ]}}));
 await page.getByRole('button',{name:'Edit Opportunity OPP-MIX',exact:true}).click();
 const form=page.getByRole('dialog',{name:'Edit Opportunity',exact:true}),root=form.getByRole('region',{name:'Item 1',exact:true});
 await root.getByRole('button',{name:'Show mix children for Item 1',exact:true}).click();
 const component=form.getByRole('region',{name:'Item 1.1',exact:true});
 await root.getByText('Packaging requirements',{exact:true}).click();await root.getByText('Shipment, Logistics, Co-Man & Others info',{exact:true}).click();
 await component.getByText('Packaging requirements',{exact:true}).click();await component.getByText('Others Info',{exact:true}).click();
 await expect(root.getByLabel('Secondary Type',{exact:true}).locator('option')).toHaveText(['Choose secondary type','Carton']);
 await expect(component.getByLabel('Secondary Type',{exact:true}).locator('option')).toHaveText(['Choose secondary type','Jar','Carton']);
 await component.getByLabel('Secondary Type',{exact:true}).selectOption('12');
 for(const name of ['Pallet size','Max pallet height (mm)'])await expect(component.getByLabel(name,{exact:true})).toHaveCount(0);
});
const rv='AAAAAAAAAAE=';
const header={OpportunityID:1,OpportunityNumber:'OPP-MIX',HeaderStage:'Draft',HeaderRowVersion:rv,CustomerID:1,CustomerName:'Northstar',CustomerCurrencyCode:'USD',ExchangeRateVNDPerUSD:25000,ExchangeRateCustomerCurrencyPerUSD:1,OpportunityDesc:'Mix launch',BidOpen:'2026-09-01',BidClose:'2026-10-01'};
const parent={...header,ContainerRequest:'20DC',PalletSize:'1.1x1.1M',ItemID:10,ProductID:20,ProductCode:'PRD-MIX',ProductName:'Mixed nuts',ItemDescription:'Mix pack',AnnualUnit:'10.0000',EstPctAwarded:50,ShelfPrice:5,ItemStage:'Draft',ItemRowVersion:rv,MixVersionID:7,PackagingType:'Box'};
const child={...header,ItemID:11,ParentItemID:10,ProductID:2,ProductCode:'PRD-ALM',ProductName:'Almonds',ItemDescription:'Almonds',AnnualUnit:'12.5000',EstPctAwarded:null,ShelfPrice:null,ItemStage:'Draft',ItemRowVersion:rv,MixVersionID:7,MixUnitQuantity:'1.2500',MixChildNumber:1,PackagingType:'Pouch'};
async function setup(page:Page,rows:unknown[]=[]){
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Sales',scopes:['Opportunity'],is_admin:false,user_id:10}});
  if(path==='/api/workbench/preferences')return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/opportunity/grid')return route.fulfill({json:{rows,total:rows.length?1:0,page:1}});
  if(path==='/api/opportunity/lookups')return route.fulfill({json:{packagingTypes:[{ID:11,PackagingOrder:'Primary',PackagingOrders:['Primary','Secondary','Primary Mix','Secondary Mix'],PackagingType:'Pouch',ParentTypeID:null,Status:'Active'},{ID:12,PackagingOrder:'Primary',PackagingOrders:['Primary','Primary Mix'],PackagingType:'Bag',ParentTypeID:null,Status:'Active'}],pallets:[{ID:1,PalletSize:"1.1x1.1M"},{ID:2,PalletSize:"1200x1000MM"}],customers:[{ID:1,CustomerName:'Northstar',CustomerCurrencyCode:'USD'}],products:[{ID:20,ProductCode:'PRD-MIX',ProductName:'Mixed nuts',CustomerID:1,ShelfLifeDays:365}],mix_children:[
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
 await form.getByLabel('Bid open',{exact:true}).fill('2026-09-01');await form.getByLabel('Bid close',{exact:true}).fill('2026-10-01');
 await form.getByLabel('Exchange rate VND per USD *',{exact:true}).fill('25000');
 await expect(form.getByLabel('Exchange rate Customer Currency per USD *',{exact:true})).toHaveValue('1');
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
 await root.getByText('Packaging requirements',{exact:true}).click();await root.getByText('Shipment, Logistics, Co-Man & Others info',{exact:true}).click();
 await root.getByLabel('Loading request',{exact:true}).selectOption('Pallet load');
 for(const label of ['Pallet size','Pallet stacking','Max pallet height (mm)']){
  await expect(first.getByLabel(label,{exact:true})).toHaveCount(0);
  await expect(root.getByLabel(label,{exact:true})).toBeVisible();
 }
 await expect(form.getByLabel('Barrier requirement',{exact:true})).toHaveCount(0);
 await expect(root.getByLabel('Shelf life (days)',{exact:true}).first()).toHaveValue('365');
 await expect(first.getByLabel('Shelf life (days)',{exact:true}).first()).toHaveValue('180');
 await expect(first.getByLabel('Shelf life (days)',{exact:true}).first()).toHaveAttribute('readonly','');
 await second.getByText('Packaging requirements',{exact:true}).click();
 await expect(second.getByLabel('Shelf life (days)',{exact:true}).first()).toHaveValue('');
 await root.getByLabel('Container Type',{exact:true}).selectOption('20DC');await root.getByLabel('Pallet size',{exact:true}).selectOption('1200x1000MM');
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
 await entry.getByText('Packaging requirements',{exact:true}).click();await entry.getByText('Others Info',{exact:true}).click();
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
 await root.getByText('Packaging requirements',{exact:true}).click();await root.getByText('Shipment, Logistics, Co-Man & Others info',{exact:true}).click();await entry.getByText('Packaging requirements',{exact:true}).click();await entry.getByText('Others Info',{exact:true}).click();
 await root.getByLabel('Container Type',{exact:true}).selectOption('20DC');
 await root.getByLabel('Loading request',{exact:true}).selectOption('Both');
 await root.getByLabel('Pallet size',{exact:true}).selectOption('1.1x1.1M');
 await root.getByLabel('Pallet stacking',{exact:true}).selectOption('Single');
 await root.getByLabel('Primary Type',{exact:true}).selectOption('11');
 await entry.locator('.packaging-copy > button').click();await page.getByRole('dialog',{name:'Choose packaging source'}).getByLabel('Copy packaging from item').selectOption({label:'Item 1 - PRD-MIX - Mixed nuts'});
 await page.getByRole('dialog',{name:'Choose packaging source'}).getByRole('button',{name:'Copy packaging',exact:true}).click();
 await expect(entry.getByLabel('Primary Type',{exact:true})).toHaveValue('11');
 await expect(entry.getByLabel('Loading request',{exact:true})).toHaveCount(0);
 await expect(entry.getByLabel('Container Type',{exact:true})).toHaveCount(0);
 await expect(entry.getByLabel('Pallet size',{exact:true})).toHaveCount(0);
 await expect(entry.getByLabel('Shelf life (days)',{exact:true}).first()).toHaveValue('180');
 await expect(entry.getByLabel('Annual units',{exact:true})).toHaveValue('12.5');
 await entry.getByLabel('Primary Type',{exact:true}).selectOption('12');
 await root.locator('.packaging-copy > button').click();await page.getByRole('dialog',{name:'Choose packaging source'}).getByLabel('Copy packaging from item').selectOption({label:'Item 1.1 - PRD-ALM - Almonds'});
 await page.getByRole('dialog',{name:'Choose packaging source'}).getByRole('button',{name:'Copy packaging',exact:true}).click();
 await expect(root.getByLabel('Primary Type',{exact:true})).toHaveValue('12');
 await expect(root.getByLabel('Container Type',{exact:true})).toHaveValue('20DC');
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
