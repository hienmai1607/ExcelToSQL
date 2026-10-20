import {test,expect,type Page} from '@playwright/test';

const rv='AAAAAAAAAAE=';
test('packaging pricing navigation displays its full label',async({page})=>{
 await setup(page);
 const button=page.getByRole('button',{name:'Packaging Pricing',exact:true}),label=button.locator('.nav-text');
 await expect(label).toHaveText('Packaging Pricing');
 expect(await label.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
 await page.setViewportSize({width:390,height:844});
 await expect(label).toBeVisible();
 expect(await label.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
 await button.click();await expect(page.getByRole('heading',{name:'Packaging Pricing',exact:true})).toBeVisible();
});
const view=(columns:string[],page_size=25)=>({columns,page_size,sort:[],filters:[],values:{},field_version:3});
async function setup(page:Page,scope='Admin'){
 let profile:any={version:0,settings:{columns:['CustomerName'],filters:[],sort:[],page_size:25,dark:false,nav_hidden:false,
  requests:{header:view(['RequestNumber','CustomerName','ItemCount','RequestStatus']),items:view(['ProductCode','ItemDescription','ItemStage'])},
  opportunity:{header:view(['OpportunityNumber','CustomerName','ItemCount']),items:view(['ProductCode','ItemDescription'])}}};
 const writes:any[]=[],reads:URL[]=[];
 const row={ItemID:21,RequestID:1,ProductCode:'PRD-0000000011',ProductName:'Natural Almonds 150g',ItemDescription:'Item 1',ItemStage:'Assigned',PIC:'Admin',PICUserID:1,ItemRowVersion:rv,WeightGrams:'150',AnnualUnit:1000,
  RequestedLayerCount:3,ResponseLayerCount:3,UnitsPerCarton:10,UnitsPerTertiary:5,NutDensity:'0.61',ConfigurationRequest:'Both',FirstPMType:'Pillow',SecondPMType:'Box',ThirdPMType:'Carton',
  FirstPMMOQ:5303417,PrimaryPricePerUnit:'36.76875',PrimaryCurrencyCode:'VND',SecondPMMOQ:6000,SecondaryPricePerUnit:6900,SecondaryCurrencyCode:'VND',
  CartonsPerLayer:10,LayersPerPallet:10,LayersPerContainer:100,PalletsPerContainer:20,CartonsPerContainerFloor:2000};
 await page.route('**/api/**',route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname;
  if(req.method()!=='GET')writes.push({path:p,body:req.postDataJSON()});
  if(p.endsWith('/session'))return route.fulfill({json:{username:'Admin',user_id:1,scopes:[scope],is_admin:scope==='Admin'}});
  if(p.endsWith('/preferences')){
   if(req.method()==='POST')profile={version:profile.version+1,settings:req.postDataJSON().settings};
   return route.fulfill({json:profile});
  }
  if(p==='/api/workbench/requests'){reads.push(url);return route.fulfill({json:{rows:[{RequestID:1,RequestNumber:'PCR-1',OpportunityNumber:'OPP-1',CustomerName:'Customer',RequestStatus:'Open',ItemCount:1}],total:1}})}
  if(p==='/api/packaging/requests'){reads.push(url);return route.fulfill({json:{rows:[row],total:1,page:1}})}
  if(p==='/api/workbench/pics')return route.fulfill({json:{rows:[{ID:1,UserName:'Admin'}]}});
  if(p==='/api/packaging/lookups')return route.fulfill({json:{packagingTypes:[{ID:1,PackagingType:'Pillow',PackagingOrder:'Primary',Status:'Active'},{ID:2,PackagingType:'Box',PackagingOrder:'Secondary',Status:'Active'},{ID:3,PackagingType:'Carton',Shipping:true,PackagingOrder:'Tertiary',Status:'Active'}]}});
  if(p==='/api/unit-conversions'){reads.push(url);return route.fulfill({json:{rows:[{ID:9,FromUoMID:1,ToUoMID:2,FromUoM:'KG',ToUoM:'G',Factor:'1000',Status:'Active',RowVersion:rv}],has_more:false}})}
  if(p==='/api/unit-conversions/lookups')return route.fulfill({json:{uoms:[{ID:1,UoMCode:'KG',Status:'Active'},{ID:2,UoMCode:'G',Status:'Active'}],packaging:[],raw:[],vendors:[]}});
  if(p==='/api/workbench/masters/materials')return route.fulfill({json:{rows:[{ID:45,MaterialCode:'PKG-45',MaterialName:'Film',UnitOfMeasure:'EA',Status:'Active',RowVersion:rv}],total:1}});
  if(p==='/api/workbench/masters/lookups')return route.fulfill({json:{uoms:[],materials:[],currencies:[],creators:[],packagingTypes:[]}});
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 return {writes,reads,profile:()=>profile};
}
async function requests(page:Page){
 await page.getByRole('button',{name:'Packaging Requests',exact:true}).click();
}
async function openEditor(page:Page){
 await requests(page);await page.getByRole('button',{name:'Edit request PCR-1',exact:true}).click();
 return page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
}

test('business editor titles and heading levels use the shared type scale',async({page})=>{
 await setup(page);
 const editor=await openEditor(page);
 const sizes=await editor.locator('h2,h3,h4').evaluateAll(els=>els.map(el=>({tag:el.tagName,size:getComputedStyle(el).fontSize})));
 expect(sizes.length).toBeGreaterThan(3);
 for(const heading of sizes)expect(heading.size).toBe(({H2:'22px',H3:'16px',H4:'14px'} as Record<string,string>)[heading.tag]);
});

test('1920 workspace groups navigation and pins the record action bar while body scrolls',async({page},info)=>{
 await setup(page);
 for(const group of ['Sales workspace','Packaging','Raw materials','Shared masters'])await expect(page.locator('.nav-group-title').getByText(group,{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Units of Measure',exact:true})).toBeInViewport();
 await requests(page);await page.screenshot({path:info.outputPath('workspace-navigation-1920.png')});
 const editor=await openEditor(page),body=editor.locator('.record-dialog-content').first();
 await expect(editor.getByRole('region',{name:'Product Info response'}).getByLabel('Nut Density (g/ml)',{exact:true})).toHaveValue('0.61');
 await editor.getByText('Packaging request',{exact:true}).click();
 const action=editor.getByRole('button',{name:'Review & save',exact:true}),close=editor.getByRole('button',{name:'Close request editor',exact:true});
 await expect(action).toBeInViewport();await expect(close).toBeInViewport();
 const before=await action.boundingBox();
 await body.evaluate(el=>{el.scrollTop=el.scrollHeight});
 expect(await body.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
 await expect(action).toBeInViewport();await expect(close).toBeInViewport();
 expect(Math.abs((await action.boundingBox())!.y-before!.y)).toBeLessThan(1);
 await body.evaluate(el=>{el.scrollTop=0});
 await editor.screenshot({path:info.outputPath('request-workspace-1920.png')});
});

test('density is in Product Info and each Packing Way weight sits below its matching count',async({page})=>{
 await setup(page);const editor=await openEditor(page);
 const product=editor.getByRole('region',{name:'Product Info response'}),packing=editor.getByRole('region',{name:'Packing Way response'});
 await expect(product.getByLabel('Used volume (ml)',{exact:true})).toHaveValue('245.902');
 const values=[['Primary','10','150'],['Secondary','5','1,500'],['Tertiary','1','7,500']];
 for(const [layer,count,weight] of values){
  const countInput=packing.getByLabel('No of '+layer+' Unit',{exact:true}),weightInput=packing.getByLabel(layer+' net weight (g)',{exact:true});
  await expect(countInput).toHaveValue(count);await expect(weightInput).toHaveValue(weight);await expect(weightInput).toHaveAttribute('readonly','');
  expect(await weightInput.evaluate(el=>el.closest('.packing-way-layer')?.contains(el.parentElement!.previousElementSibling))).toBe(true);
 }
 const boxes=[];
 for(const layer of ['Primary','Secondary','Tertiary']){
  const region=editor.getByRole('region',{name:layer+' packaging response',exact:true});
  await expect(region.getByLabel('Nut Density (g/ml)',{exact:true})).toHaveCount(0);
  await expect(region.getByLabel(layer+' net weight (g)',{exact:true})).toHaveCount(0);
  await expect(region.getByRole('button',{name:layer+' Pricing Calculator',exact:true})).toBeEnabled();
  boxes.push((await region.boundingBox())!);
 }
 expect(Math.max(...boxes.map(b=>b.y))-Math.min(...boxes.map(b=>b.y))).toBeLessThan(1);
 expect(boxes[2].x+boxes[2].width).toBeLessThan(1920);
 await packing.getByLabel('Confirmed packaging layers',{exact:true}).selectOption('2');
 await expect(packing.getByLabel('No of Secondary Unit',{exact:true})).toHaveValue('1');
 await expect(packing.getByLabel('No of Secondary Unit',{exact:true})).toHaveAttribute('readonly','');
 await expect(packing.getByLabel('No of Tertiary Unit',{exact:true})).toHaveCount(0);
 await expect(editor.getByRole('region',{name:'Tertiary packaging response',exact:true})).toHaveCount(0);
});

test('record IDs open the editor; item totals show lines and product links jump to the response',async({page})=>{
 await setup(page);await requests(page);
 const table=page.getByRole('table',{name:'Packaging Requests',exact:true});
 await expect(table.locator('tbody td').first().getByRole('button',{name:'Edit request PCR-1'})).toHaveText('PCR-1');
 await table.getByRole('button',{name:'View request',exact:true}).click();
 const lines=page.getByRole('table',{name:'Packaging request items',exact:true});
 await expect(lines).toBeVisible();
 await lines.getByRole('button',{name:'Open response PRD-0000000011',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Edit Packaging request'}).getByRole('region',{name:'Request item 21',exact:true})).toBeInViewport();
});

test('independent header, Item View and Edit View page sizes persist and restore after reload',async({page})=>{
 const state=await setup(page);await requests(page);
 await page.getByRole('button',{name:'Request layout',exact:true}).click();
 const layout=page.getByRole('complementary',{name:'Request layout',exact:true});
 await layout.getByLabel('Records per page',{exact:true}).fill('40');await layout.getByLabel('Records per page',{exact:true}).press('Enter');
 await layout.getByRole('button',{name:'Save layout to profile'}).click();await expect(layout.getByRole('status')).toContainText('saved');
 await layout.getByRole('button',{name:'Close layout'}).click();
 await page.getByRole('button',{name:'View request',exact:true}).click();
 await page.getByRole('button',{name:'Request item layout',exact:true}).click();
 const itemLayout=page.getByRole('complementary',{name:'Request item layout',exact:true});
 await itemLayout.getByLabel('Records per page',{exact:true}).fill('10');await itemLayout.getByLabel('Records per page',{exact:true}).press('Enter');
 await itemLayout.getByRole('button',{name:'Save layout to profile'}).click();await expect(itemLayout.getByRole('status')).toContainText('saved');
 await itemLayout.getByRole('button',{name:'Close layout'}).click();
 await page.getByRole('button',{name:'Edit request PCR-1',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'});
 page.on('dialog',dialog=>dialog.accept());
 await editor.getByLabel('Rows per page',{exact:true}).fill('15');await editor.getByLabel('Rows per page',{exact:true}).press('Enter');
 await editor.getByRole('button',{name:'Save item page size',exact:true}).click();await expect(editor.getByRole('status')).toContainText('page size saved');
 expect(state.profile().settings.requests.header.page_size).toBe(40);
 expect(state.profile().settings.requests.items.page_size).toBe(10);
 await expect.poll(()=>state.profile().settings.requests.editor_page_size).toBe(15);
 await editor.getByRole('button',{name:'Close request editor',exact:true}).click();
 await page.getByRole('button',{name:'View request',exact:true}).click();
 await page.getByRole('button',{name:'Request item layout',exact:true}).click();
 await itemLayout.getByLabel('Records per page',{exact:true}).fill('12');await itemLayout.getByLabel('Records per page',{exact:true}).press('Enter');
 await itemLayout.getByRole('button',{name:'Save layout to profile'}).click();await expect(itemLayout.getByRole('status')).toContainText('saved');
 expect(state.profile().settings.requests.editor_page_size).toBe(15);
 await itemLayout.getByRole('button',{name:'Close layout'}).click();
 await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).click();await requests(page);
 await expect(page.getByLabel('Rows per page',{exact:true})).toHaveValue('40');
 await page.getByRole('button',{name:'View request',exact:true}).click();
 await expect(page.locator('.request-items').getByLabel('Rows per page',{exact:true})).toHaveValue('12');
 await page.getByRole('button',{name:'Edit request PCR-1',exact:true}).click();
 await expect(page.getByRole('dialog').getByLabel('Rows per page',{exact:true})).toHaveValue('15');
});

test('Item View product link opens the correct editor page with a different page size',async({page})=>{
 const state=await setup(page);
 state.profile().settings.requests.items.page_size=10;
 state.profile().settings.requests.editor_page_size=3;
 const rows=Array.from({length:22},(_,i)=>({ItemID:i+1,RequestID:1,ProductCode:'PRD-'+(i+1),ProductName:'Almonds',ItemDescription:'Item '+(i+1),ItemStage:'Approved',PIC:'Admin',WeightGrams:150,ResponseLayerCount:1}));
 await page.route('**/api/packaging/requests?**',route=>{
  const url=new URL(route.request().url()),current=Number(url.searchParams.get('page')||1),size=Number(url.searchParams.get('page_size')||25);
  return route.fulfill({json:{rows:rows.slice((current-1)*size,current*size),total:rows.length,page:current}});
 });
 await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).click();await requests(page);
 await page.getByRole('button',{name:'View request',exact:true}).click();
 const items=page.locator('.request-items');
 await items.getByRole('button',{name:'Next',exact:true}).click();
 await items.getByRole('button',{name:'Open response PRD-11',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
 await expect(editor.getByLabel('Rows per page',{exact:true})).toHaveValue('3');
 await expect(editor.locator('.pager')).toContainText('Page 4 of 8');
 await expect(editor.getByRole('region',{name:'Request item 11',exact:true})).toBeVisible();
 await editor.getByRole('button',{name:'Close request editor',exact:true}).click();
 await page.getByRole('button',{name:'View request',exact:true}).click();
 await expect(items.getByLabel('Rows per page',{exact:true})).toHaveValue('10');
 expect(state.profile().settings.requests.items.page_size).toBe(10);
});

for(const mode of ['new','edit'])test('Opportunity '+mode+' editor saves its page size without changing Item View',async({page})=>{
 const state=await setup(page);
 state.profile().settings.opportunity.items.page_size=10;
 state.profile().settings.opportunity.editor_page_size=2;
 await page.route('**/api/opportunity/lookups',r=>r.fulfill({json:{customers:[{ID:1,CustomerName:'Customer',CustomerCurrencyCode:'USD'}],products:[{ID:1,ProductCode:'PRD-1',ProductName:'Almonds',CustomerID:1}],currencies:[],packagingTypes:[],pallets:[]}}));
 if(mode==='edit')await page.route('**/api/opportunity/grid?**',r=>r.fulfill({json:{rows:[{OpportunityID:1,OpportunityNumber:'OPP-1',HeaderStage:'Draft',CustomerID:1,CustomerName:'Customer',OpportunityDesc:'Test',ItemID:21,ProductID:1,ProductCode:'PRD-1',ProductName:'Almonds',ItemStage:'Draft',ItemDescription:'Item 1',AnnualUnit:100,ItemCount:1}],total:1,page:1}}));
 await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).click();
 const label=mode==='new'?'New Opportunity':'Edit Opportunity';
 await page.getByRole('button',{name:mode==='new'?label:label+' OPP-1',exact:true}).click();
 const editor=page.getByRole('dialog',{name:label,exact:true});
 await expect(editor.getByLabel('Rows per page',{exact:true})).toHaveValue('2');
 await editor.getByLabel('Rows per page',{exact:true}).fill('3');await editor.getByLabel('Rows per page',{exact:true}).press('Enter');
 await editor.getByRole('button',{name:'Save item page size to profile',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('page size saved');
 expect(state.profile().settings.opportunity.items.page_size).toBe(10);
 expect(state.profile().settings.opportunity.editor_page_size).toBe(3);
 await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:mode==='new'?label:label+' OPP-1',exact:true}).click();
 await expect(page.getByRole('dialog',{name:label,exact:true}).getByLabel('Rows per page',{exact:true})).toHaveValue('3');
});

test('utility list page sizes save without altering other saved layouts',async({page})=>{
 const state=await setup(page);
 await page.getByRole('button',{name:'Unit Conversions',exact:true}).click();
 await page.getByRole('button',{name:'Layout options',exact:true}).click();
 const layout=page.getByRole('complementary',{name:'List layout'});
 await layout.getByLabel('Records per page',{exact:true}).fill('70');await layout.getByLabel('Records per page',{exact:true}).press('Enter');
 await layout.getByRole('button',{name:'Save layout to profile'}).click();await expect(layout.getByRole('status')).toContainText('saved');
 expect(state.profile().settings.list_layouts['unit-conversions'].page_size).toBe(70);
 expect(state.profile().settings.requests.header.page_size).toBe(25);
 await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Unit Conversions',exact:true}).click();
 await expect(page.getByLabel('Rows per page',{exact:true})).toHaveValue('70');
 await expect.poll(()=>state.reads.filter(u=>u.pathname==='/api/unit-conversions').at(-1)?.searchParams.get('page_size')).toBe('70');
});

test('read-only record links expose disabled details with no save actions or writes',async({page})=>{
 const state=await setup(page,'PackagingManager');
 await page.getByRole('button',{name:'Packaging Material',exact:true}).click();
 await page.getByRole('button',{name:'View material 45',exact:true}).click();
 const material=page.getByRole('dialog',{name:'View material',exact:true});
 await expect(material.getByLabel('Material name',{exact:true})).toBeDisabled();
 await expect(material.getByRole('button',{name:'Review & save',exact:true})).toHaveCount(0);
 await material.getByRole('button',{name:'Close form',exact:true}).click();
 await page.getByRole('button',{name:'Unit Conversions',exact:true}).click();
 await page.getByRole('button',{name:'View conversion 9',exact:true}).click();
 const conversion=page.getByRole('dialog',{name:'View conversion',exact:true});
 await expect(conversion.getByLabel('Conversion factor',{exact:true})).toBeDisabled();
 await expect(conversion.getByLabel('Conversion scope',{exact:true})).toHaveValue('general');
 await expect(conversion.getByRole('button',{name:'Save conversion',exact:true})).toHaveCount(0);
 expect(state.writes).toHaveLength(0);
});

test('responsive dark workspace keeps actions reachable without page overflow',async({page},info)=>{
 await setup(page);await page.getByRole('button',{name:'Dark mode',exact:true}).click();
 const editor=await openEditor(page);
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await editor.screenshot({path:info.outputPath('request-workspace-dark.png')});
 await page.setViewportSize({width:390,height:844});
 const body=editor.locator('.record-dialog-content').first();
 await body.evaluate(el=>{el.scrollTop=el.scrollHeight});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 expect(await body.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
 await expect(editor.getByRole('button',{name:'Review & save',exact:true})).toBeInViewport();
 await expect(editor.getByRole('button',{name:'Close request editor',exact:true})).toBeInViewport();
 await editor.screenshot({path:info.outputPath('request-workspace-mobile.png')});
});
