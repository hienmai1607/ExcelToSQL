import {test,expect,type Page} from '@playwright/test';
const rv='AAAAAAAAAAE=';
async function setup(page:Page,scope='Admin',stage='Assigned'){
 const writes:any[]=[];
 let profile:any={version:0,settings:{columns:['CustomerName'],filters:[],sort:[],page_size:25,requests:{header:{columns:['RequestNumber','ItemCount','CustomerName','RequestStatus'],sort:[],filters:[],field_version:3,page_size:25}}}};
 const row:any={ItemID:21,RequestID:1,ProductCode:'PRD-11',ItemDescription:'Item 1',ProductName:'Almonds',WeightGrams:10,PIC:'User',PICUserID:1,ItemStage:stage,ItemRowVersion:rv,RequestedLayerCount:3,ResponseLayerCount:3,UnitsPerCarton:10,UnitsPerTertiary:5,ConfigurationRequest:'Both',ShelfLifeDays:365};
 await page.route('**/api/**',async route=>{
  const req=route.request(),p=new URL(req.url()).pathname;
  if(p.endsWith('/session'))return route.fulfill({json:{username:'User',user_id:1,is_admin:scope==='Admin',scopes:[scope]}});
  if(p.endsWith('/preferences')){if(req.method()==='POST')profile={version:profile.version+1,settings:req.postDataJSON().settings};return route.fulfill({json:profile})}
  if(p==='/api/workbench/requests')return route.fulfill({json:{rows:[{RequestID:1,RequestNumber:'PCR-1',ItemCount:1,RequestStatus:'Open'}],total:1}});
  if(p==='/api/packaging/requests')return route.fulfill({json:{rows:[row],total:1}});
  if(p==='/api/workbench/pics')return route.fulfill({json:{rows:[{ID:1,UserName:'User'},{ID:2,UserName:'Other'}]}});
  if(p==='/api/packaging/lookups')return route.fulfill({json:{packagingTypes:[]}});
  if(p.endsWith('/transition')){const body=req.postDataJSON();writes.push(body);row.ItemStage=body.TargetStage;row.ItemRowVersion='AAAAAAAAAAI=';return route.fulfill({json:{result:{RowVersion:row.ItemRowVersion}}})}
  if(p.endsWith('/assign')){const body=req.postDataJSON();writes.push(body);row.PICUserID=body.PICUserID;row.PIC='Other';row.ItemRowVersion='AAAAAAAAAAI=';return route.fulfill({json:{result:{RowVersion:row.ItemRowVersion}}})}
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Packaging Requests',exact:true}).click();
 return {writes,row,profile:()=>profile};
}
async function items(page:Page){await page.getByRole('button',{name:'View request',exact:true}).click();return page.getByRole('table',{name:'Packaging request items'})}

test('review icons share one horizontal row and response attachments are hidden',async({page},info)=>{
 await setup(page);const table=await items(page),row=table.locator('.review-document-row');
 const geometry=await row.evaluate(el=>[...el.querySelectorAll('button,select,.badge,.info-tip')].map(node=>{const b=node.getBoundingClientRect();return {middle:b.y+b.height/2,width:b.width,height:b.height}}));
 expect(Math.max(...geometry.map(g=>g.middle))-Math.min(...geometry.map(g=>g.middle))).toBeLessThan(2);
 expect(await row.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
 for(const button of await row.getByRole('button').all()){const b=(await button.boundingBox())!;expect(b.width).toBe(28);expect(b.height).toBe(28)}
 await page.screenshot({path:info.outputPath('horizontal-review-1920.png')});
 await expect(table.getByRole('button',{name:/Attachments/})).toHaveCount(0);
 await expect(table.locator('input[type=file]')).toHaveCount(0);
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:'Edit request PCR-1',exact:true}).click();
 const request=page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
 await request.getByText('Packaging request',{exact:true}).click();
 const label=request.locator('.field-label').filter({hasText:'Requested packaging layers'}),note=label.getByRole('note');
 const l=(await label.boundingBox())!,n=(await note.boundingBox())!;
 expect(n.y).toBeGreaterThanOrEqual(l.y);expect(n.y+n.height).toBeLessThanOrEqual(l.y+l.height+1);const textBox=(await label.locator('.field-label-text').boundingBox())!;expect(n.x-textBox.x-textBox.width).toBeLessThanOrEqual(6);
 const hierarchy=await request.locator('summary').filter({hasText:'Packaging request'}).evaluate(el=>({background:getComputedStyle(el).backgroundColor,weight:Number(getComputedStyle(el).fontWeight)}));
 expect(hierarchy.background).not.toBe('rgba(0, 0, 0, 0)');expect(hierarchy.weight).toBeGreaterThan(await label.evaluate(el=>Number(getComputedStyle(el).fontWeight)));
 await request.getByRole('button',{name:'Close request editor',exact:true}).click();await page.setViewportSize({width:390,height:844});await items(page);
 const product=table.getByRole('button',{name:'Open response PRD-11',exact:true});await product.scrollIntoViewIfNeeded();await expect(product).toBeInViewport();
 expect(await table.locator('..').evaluate(el=>el.scrollLeft)).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await product.click();await expect(page.getByRole('dialog',{name:'Edit Packaging request',exact:true})).toBeVisible();
});

test('dragging layout columns persists order and keeps layout actions visible',async({page},info)=>{
 const state=await setup(page);await items(page);await page.getByRole('button',{name:'Request item layout',exact:true}).click();
 const panel=page.getByRole('complementary',{name:'Request item layout'}),body=panel.locator('.layout-panel-body');
 const button=panel.getByRole('button',{name:'Save layout to profile'});
 await expect(button).toBeInViewport();const before=await button.boundingBox();
 await body.evaluate(el=>{el.scrollTop=el.scrollHeight});expect(await body.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
 await expect(button).toBeInViewport();expect(Math.abs((await button.boundingBox())!.y-before!.y)).toBeLessThan(1);
 await panel.getByRole('button',{name:'Close layout'}).click();await page.getByRole('button',{name:'Request layout',exact:true}).click();
 const header=page.getByRole('complementary',{name:'Request layout',exact:true}),list=header.getByRole('list',{name:'Column order'});
 const beforeOrder=await list.locator('li').evaluateAll(nodes=>nodes.map(n=>n.children[1].textContent));
 await list.locator('li').nth(0).dragTo(list.locator('li').nth(2));
 const after=await list.locator('li').evaluateAll(nodes=>nodes.map(n=>n.children[1].textContent));
 expect(after).not.toEqual(beforeOrder);expect(after[2]).toBe(beforeOrder[0]);
 await header.getByRole('button',{name:'Save layout to profile'}).click();
 await expect(header.getByRole('status')).toBeInViewport();expect(state.profile().settings.requests.header.columns[2]).toBe('RequestNumber');
 await page.screenshot({path:info.outputPath('drag-layout-1920.png')});
});

test('notifications float above a scrolled native dialog and do not occupy form space',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'}),body=editor.locator('.record-dialog-content').first();
 await body.evaluate(el=>{el.scrollTop=el.scrollHeight});await editor.getByRole('button',{name:'Save item page size'}).click();
 const toast=editor.getByRole('status');await expect(toast).toBeInViewport();await expect(toast).toContainText('page size saved');
 expect(await toast.evaluate(el=>({fixed:getComputedStyle(el).position,open:el.matches(':popover-open')}))).toEqual({fixed:'fixed',open:true});
 expect((await toast.boundingBox())!.y).toBeLessThan(30);
 await toast.getByRole('button',{name:'Dismiss notification'}).click();await expect(toast).toHaveCount(0);
 await editor.getByRole('button',{name:'Save item page size'}).click();await expect(editor.getByRole('status')).toBeInViewport();
});

test('request layers share a row and packaging regions use lines rather than boxes',async({page},info)=>{
 await setup(page);await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'});
 await editor.getByText('Packaging request',{exact:true}).click();
 const regions=['Primary','Secondary','Tertiary'].map(layer=>editor.getByRole('region',{name:layer+' packaging requirements',exact:true}));
 const boxes=await Promise.all(regions.map(r=>r.boundingBox()));
 expect(Math.max(...boxes.map(b=>b!.y))-Math.min(...boxes.map(b=>b!.y))).toBeLessThan(1);
 for(const region of regions)expect(await region.evaluate(el=>({radius:getComputedStyle(el).borderRadius,border:getComputedStyle(el).borderTopWidth}))).toEqual({radius:'0px',border:'0px'});
 await editor.screenshot({path:info.outputPath('horizontal-request-1920.png')});
 await page.setViewportSize({width:390,height:844});
 expect(await editor.locator('.record-dialog-content').first().evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
});

test('manager review is in Item View and return requires a reason and current version',async({page})=>{
 const state=await setup(page,'PackagingManager','Pending Review');const table=await items(page);
 await expect(table.getByRole('button',{name:'Approve 21',exact:true})).toBeVisible();
 await expect(table.getByRole('button',{name:'Submit 21',exact:true})).toHaveCount(0);
 await table.getByRole('button',{name:'Return 21',exact:true}).click();
 const confirm=page.getByRole('dialog',{name:'Confirm response action'});await expect(confirm.getByRole('button',{name:'Confirm',exact:true})).toBeDisabled();
 await confirm.getByLabel('Reason').fill('Check dimensions');await confirm.getByRole('button',{name:'Confirm',exact:true}).click();
 await expect.poll(()=>state.writes.length).toBe(1);expect(state.writes[0]).toEqual({ExpectedRowVersion:rv,TargetStage:'Returned',Comment:'Check dimensions'});
 await expect(table.getByLabel('PIC for item 21',{exact:true})).toBeVisible();
});

test('PIC submission belongs to Item View and sales has no review or assignment authority',async({page})=>{
 const state=await setup(page,'Packaging');const table=await items(page);
 await expect(table.getByLabel('PIC for item 21',{exact:true})).toHaveCount(0);await table.getByRole('button',{name:'Submit 21',exact:true}).click();
 expect(state.writes).toHaveLength(0);await page.getByRole('dialog',{name:'Confirm response action'}).getByRole('button',{name:'Confirm',exact:true}).click();
 await expect.poll(()=>state.row.ItemStage).toBe('Pending Review');
 await page.unrouteAll({behavior:'wait'});const sales=await setup(page,'Opportunity');const salesTable=await items(page);
 await expect(salesTable.getByRole('combobox')).toHaveCount(0);await expect(salesTable.locator('.item-review-buttons button')).toHaveCount(0);expect(sales.writes).toHaveLength(0);
});


test('Customer, master and Opportunity layouts share drag ordering and saved state',async({page})=>{
 const state=await setup(page);state.profile().settings.columns=['CustomerName','Status','MarketCode'];
 await page.route('**/api/customer/lookups',r=>r.fulfill({json:{markets:[],currencies:[],creators:[]}}));
 await page.route('**/api/workbench/masters/lookups?**',r=>r.fulfill({json:{materials:[],currencies:[],creators:[],uoms:[],packagingTypes:[]}}));
 await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).click();
 for(const [nav,open,label,close] of [['Customers','Layout options','Customer layout','Hide layout'],['Packaging Material','Layout options','Master layout','Close layout'],['Opportunities','Opportunity layout','Opportunity layout','Close layout']]){
  await page.getByRole('button',{name:nav,exact:true}).click();await page.getByRole('button',{name:open,exact:true}).click();
  const panel=page.getByRole('complementary',{name:label,exact:true}),list=panel.getByRole('list',{name:'Column order'});
  const before=await list.locator('li').evaluateAll(nodes=>nodes.map(n=>n.children[1].textContent));
  expect(before.length).toBeGreaterThan(2);await list.locator('li').nth(0).dragTo(list.locator('li').nth(2));
  const after=await list.locator('li').evaluateAll(nodes=>nodes.map(n=>n.children[1].textContent));
  expect(after[2]).toBe(before[0]);await panel.getByRole('button',{name:'Save layout to profile',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('saved');await panel.getByRole('button',{name:close,exact:true}).click();
  await page.getByRole('button',{name:open,exact:true}).click();await expect(panel.getByRole('list',{name:'Column order'}).locator('li').locator('span:nth-child(2)')).toHaveText(after as string[]);
  await panel.getByRole('button',{name:close,exact:true}).click();
 }
});

test('new-record icons are small and right-aligned, and Customer sort actions stay fixed',async({page})=>{
 await setup(page);await page.route('**/api/customer/lookups',r=>r.fulfill({json:{markets:[],currencies:[],creators:[]}}));
 await page.getByRole('button',{name:'Customers',exact:true}).click();
 const plus=page.getByRole('button',{name:'New customer',exact:true}),cell=plus.locator('..'),box=(await plus.boundingBox())!,header=(await cell.boundingBox())!;
 expect(box.width).toBeLessThanOrEqual(28);expect(header.x+header.width-box.x-box.width).toBeLessThanOrEqual(12);
 await page.getByRole('button',{name:'Sort options',exact:true}).click();const sort=page.getByRole('complementary',{name:'Customer sort'}),body=sort.locator('.layout-panel-body');
 for(let i=0;i<6;i++)await sort.getByRole('button',{name:'Add sort column',exact:true}).click();
 const close=sort.getByRole('button',{name:'Close sort',exact:true}),before=await close.boundingBox();
 await body.evaluate(el=>{el.scrollTop=el.scrollHeight});await expect(close).toBeInViewport();
 expect(Math.abs((await close.boundingBox())!.y-before!.y)).toBeLessThan(1);
});

test('unknown assignment outcome disables retry until item refresh',async({page})=>{
 await setup(page);let attempts=0;
 await page.route('**/api/packaging/items/21/assign',route=>{attempts++;return route.fulfill({status:503,json:{detail:'Response lost'}})});
 const table=await items(page);await table.getByLabel('PIC for item 21',{exact:true}).selectOption('2');await table.getByRole('button',{name:'Assign PIC for item 21'}).click();
 await expect(table.getByRole('alert')).toContainText('Response lost');await expect(table.getByRole('button',{name:'Assign PIC for item 21'})).toBeDisabled();
 expect(attempts).toBe(1);await page.getByRole('button',{name:'Refresh items',exact:true}).click();await table.getByLabel('PIC for item 21',{exact:true}).selectOption('2');
 await expect(table.getByRole('button',{name:'Assign PIC for item 21'})).toBeEnabled();
});
