import {test,expect,type Page} from '@playwright/test';
import {itemFieldLabels} from '../src/item-view-fields';

async function setup(page:Page){
 let profile:any={version:0,settings:{columns:['CustomerName'],filters:[],sort:[],page_size:25,
  requests:{header:{columns:['RequestNumber','CustomerName','ItemCount'],filters:['search'],sort:[],field_version:3},items:{columns:['ProductCode','CostBasis','HeightMM'],sort:[],field_version:3}},
  opportunity:{items:{columns:['ProductCode','Category','PackagingDescription'],sort:[],field_version:3}}}};
 const item={ItemID:21,RequestID:1,OpportunityID:1,OpportunityNumber:'OPP-1',CustomerName:'Customer',HeaderStage:'Draft',ItemCount:1,ProductID:1,
  ProductCode:'PRD-1',ProductName:'Almonds',ItemDescription:'Item 1',ItemStage:'Assigned',PIC:'Admin',PICUserID:1,ItemRowVersion:'AAAAAAAAAAE=',
  WeightGrams:10,AnnualUnit:1000,RequestedLayerCount:3,ResponseLayerCount:3,UnitsPerCarton:10,UnitsPerTertiary:5,
  PrimaryTypeName:'Pillow',SecondaryTypeName:'Box',TertiaryTypeName:'Carton',ConfigurationRequest:'Both',
  PrimaryPricePerUnit:'36.76875',PrimaryPriceCurrencyCode:'VND',PrimaryNetWeightGrams:10,SecondaryNetWeightGrams:100,TertiaryNetWeightGrams:500,NetWeightPerPalletKG:50};
 await page.route('**/api/**',route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname;
  if(p.endsWith('/session'))return route.fulfill({json:{username:'Admin',user_id:1,is_admin:true,scopes:['Admin']}});
  if(p.endsWith('/preferences')){if(req.method()==='POST')profile={version:profile.version+1,settings:req.postDataJSON().settings};return route.fulfill({json:profile})}
  if(p==='/api/workbench/requests')return route.fulfill({json:{rows:[{RequestID:1,RequestNumber:'PCR-1',OpportunityNumber:'OPP-1',CustomerName:'Customer',ItemCount:3,RequestStatus:'Open',RequestNotes:'Use the approved artwork.\nKeep labels readable.'}],total:1}});
  if(p==='/api/packaging/requests')return route.fulfill({json:{rows:[item,{...item,ItemID:22,ProductCode:'PRD-2'},{...item,ItemID:23,ProductCode:'PRD-3'}],total:30}});
  if(p==='/api/opportunity/grid')return route.fulfill({json:{rows:[item],total:1,page:1}});
  if(p==='/api/packaging/lookups')return route.fulfill({json:{packagingTypes:[]}});
  if(p==='/api/workbench/pics')return route.fulfill({json:{rows:[{ID:1,UserName:'Admin'}]}});
  if(p==='/api/unit-conversions/lookups')return route.fulfill({json:{uoms:[],packaging:[],raw:[],vendors:[]}});
  if(p==='/api/unit-conversions'){const n=Number(url.searchParams.get('page')||1),size=Number(url.searchParams.get('page_size')||50);return route.fulfill({json:{rows:Array.from({length:Math.max(0,Math.min(size,101-(n-1)*size))},(_,i)=>({ID:(n-1)*size+i+1,FromUoM:'m',ToUoM:'m2',Factor:3.77,Status:'Active'})),total:101,page:n,page_size:size,has_more:n*size<101}})}
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 return ()=>profile;
}
async function requests(page:Page){await page.getByRole('button',{name:'Packaging requests',exact:true}).click();await page.getByRole('button',{name:'View request',exact:true}).click()}

test('request note belongs to the header and pagination stays alongside fixed actions',async({page},info)=>{
 await setup(page);await page.getByRole('button',{name:'Packaging requests',exact:true}).click();await page.getByRole('button',{name:'Edit request PCR-1',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'}),body=editor.locator('.record-dialog-content').first(),footer=editor.locator('.record-dialog-footer');
 await expect(editor.locator('.request-header-note')).toContainText('Use the approved artwork.');
 await expect(editor.getByText(/Keep labels readable/)).toHaveCount(1);
 const before=(await footer.boundingBox())!;
 await body.evaluate(el=>{el.scrollTop=el.scrollHeight});expect(await body.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
 await expect(footer.getByRole('button',{name:'Next',exact:true})).toBeInViewport();
 await expect(footer.getByRole('button',{name:'Review & save'})).toBeInViewport();
 expect(Math.abs((await footer.boundingBox())!.y-before.y)).toBeLessThan(1);
 const pager=(await footer.locator('.pager').boundingBox())!,actions=(await footer.locator('.record-action-bar').boundingBox())!;
 expect(pager.x+pager.width).toBeLessThanOrEqual(actions.x);expect(Math.abs(pager.y-actions.y)).toBeLessThan(12);
 await editor.screenshot({path:info.outputPath('fixed-request-pagination.png')});
 await page.setViewportSize({width:390,height:844});await expect(footer.getByRole('button',{name:'Next',exact:true})).toBeInViewport();expect(await editor.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
});

test('request layout migrates to all editor fields and only reorders within a section',async({page})=>{
 const profile=await setup(page);await requests(page);
 const table=page.getByRole('table',{name:'Packaging request items'});await expect(table.getByRole('columnheader')).toHaveCount(Object.keys(itemFieldLabels('requests')).length+1);
 await expect(table.getByRole('columnheader',{name:/Cost basis|Packaging description|1st PM MOQ/})).toHaveCount(0);
 await expect(table.getByRole('button',{name:'Sort by Shipping height (mm)',exact:true})).toHaveCount(1);
 await expect(table.getByRole('button',{name:'Sort by Primary price per unit',exact:true})).toHaveCount(1);
 await page.getByRole('button',{name:'Request item layout',exact:true}).click();
 const panel=page.getByRole('complementary',{name:'Request item layout'}),visible=panel.getByRole('group',{name:'Visible columns',exact:true});
 await expect(visible.getByRole('checkbox')).toHaveCount(Object.keys(itemFieldLabels('requests')).length);
 for(const check of await visible.getByRole('checkbox').all())await expect(check).toBeChecked();
 const product=panel.getByRole('region',{name:'Order Product Info'}),request=panel.getByRole('region',{name:'Order Packaging Request'});
 const before=await product.locator('li').evaluateAll(nodes=>nodes.map(n=>n.children[1].textContent));
 await product.locator('li').nth(1).dragTo(product.locator('li').nth(2));
 expect(await product.locator('li').nth(2).locator('span').nth(1).textContent()).toBe(before[1]);
 const unchanged=await panel.locator('.column-order li').evaluateAll(nodes=>nodes.map(n=>n.children[1].textContent));
 await product.locator('li').first().dragTo(request.locator('li').first());
 expect(await panel.locator('.column-order li').evaluateAll(nodes=>nodes.map(n=>n.children[1].textContent))).toEqual(unchanged);
 await expect(request.getByRole('button',{name:'Move Requested packaging layers left',exact:true})).toBeDisabled();
 await visible.getByLabel('Secondary currency',{exact:true}).uncheck();await panel.getByRole('button',{name:'Save layout to profile'}).click();
 await expect(panel.getByRole('status')).toContainText('saved');expect(profile().settings.requests.items.field_version).toBe(7);
 expect(profile().settings.requests.items.columns).not.toContain('SecondaryPriceCurrencyCode');
 await page.reload();await page.getByRole('button',{name:'Sign in',exact:true}).click();await requests(page);await page.getByRole('button',{name:'Request item layout',exact:true}).click();
 await expect(panel.getByRole('group',{name:'Visible columns',exact:true}).getByLabel('Secondary currency',{exact:true})).not.toBeChecked();
});

test('Opportunity Item View offers the same current editor field sections without legacy-only fields',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Opportunities',exact:true}).click();await page.getByRole('button',{name:'View details',exact:true}).click();
 const table=page.getByRole('table',{name:'Opportunity items'});
 await expect(table.getByRole('columnheader')).toHaveCount(Object.keys(itemFieldLabels('opportunity')).length+1);
 await expect(table.getByRole('columnheader',{name:/Category|Cost basis|Packaging description/})).toHaveCount(0);
 await page.getByRole('button',{name:'Item layout',exact:true}).click();
 const panel=page.getByRole('complementary',{name:'Item layout',exact:true});
 for(const name of ['Product Info','Packaging Request','Packaging Responses'])await expect(panel.getByRole('region',{name:'Order '+name,exact:true})).toHaveCount(1);
 await expect(panel.getByRole('group',{name:'Visible columns',exact:true}).getByLabel('Net weight / container floor (kg)',{exact:true})).toBeChecked();
});

test('conversion pagination shares total records and Page N of M information',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Unit Conversions',exact:true}).click();const pager=page.locator('.conversions-page .pager');
 await expect(pager).toContainText('101 records · Page 1 of 3');
 await pager.getByRole('button',{name:'Next',exact:true}).click();await expect(pager).toContainText('101 records · Page 2 of 3');
 await pager.getByRole('button',{name:'Next',exact:true}).click();await expect(pager).toContainText('101 records · Page 3 of 3');
 await expect(pager.getByRole('button',{name:'Next',exact:true})).toBeDisabled();
 await expect(page.getByRole('table',{name:'Unit conversions'}).locator('tbody tr')).toHaveCount(1);
});

test('search, selected tabs and selected toolbar buttons share theme colors in light and dark mode',async({page},info)=>{
 await setup(page);await requests(page);
 const search=page.getByRole('button',{name:'Search',exact:true}),tab=page.getByRole('button',{name:'All Fields',exact:true}),layout=page.getByRole('button',{name:'Request item layout',exact:true});
 for(const dark of [false,true]){
  if(dark)await page.getByRole('button',{name:'Dark mode',exact:true}).click();
  await layout.click();await page.mouse.move(0,0);
  const colors=await Promise.all([search,tab,layout].map(button=>button.evaluate(el=>({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color}))));
  expect(colors[1]).toEqual(colors[0]);expect(colors[2]).toEqual(colors[0]);expect(colors[0].background).not.toBe(colors[0].color);
  await layout.click();await page.mouse.move(0,0);
 }
 await page.screenshot({path:info.outputPath('dark-theme-toolbar.png')});
});
