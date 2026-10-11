import {test,expect,type Page} from '@playwright/test';

const warning='Type, units in the next layer and calculated MOQ are required for each confirmed packaging layer.';
async function setup(page:Page,assigned=true){
 const writes:any[]=[];
 let profile:any={version:0,settings:{columns:['CustomerName'],filters:[],sort:[],page_size:25,dark:false,nav_hidden:false,requests:{header:{columns:['RequestNumber','ItemCount'],sort:[],filters:[],field_version:4}}}};
 const item:any={ItemID:21,RequestID:1,ProductCode:'PRD-1',ProductName:'Almonds',ItemDescription:'Item 1',ItemStage:'Assigned',
  PICUserID:assigned?1:null,PIC:assigned?'Admin':null,ItemRowVersion:'AAAAAAAAAAE=',WeightGrams:10,AnnualUnit:1000,
  RequestedLayerCount:2,ResponseLayerCount:2,UnitsPerCarton:10,PrimaryTypeID:1,PrimaryTypeName:'Pillow',SecondaryTypeID:2,SecondaryTypeName:'Box',
  FirstPMType:'Pillow',SecondPMType:'Box',ConfigurationRequest:'Both',Transparency:'NA',ShelfLifeDays:365,
  SnapshotOrigin:'Request',SnapshotCapturedAt:'2026-10-01T13:43:00',SourceCurrencyCode:'USD',SourceExchangeRateToVND:'25000'};
 await page.route('**/api/**',route=>{
  const req=route.request(),p=new URL(req.url()).pathname;
  if(p.endsWith('/session'))return route.fulfill({json:{username:'Admin',user_id:1,is_admin:true,scopes:['Admin']}});
  if(p.endsWith('/preferences')){if(req.method()==='POST')profile={version:profile.version+1,settings:req.postDataJSON().settings};return route.fulfill({json:profile})}
  if(p==='/api/workbench/requests')return route.fulfill({json:{rows:[{RequestID:1,RequestNumber:'PCR-1',ItemCount:1,RequestStatus:'Open'}],total:1}});
  if(p==='/api/packaging/requests')return route.fulfill({json:{rows:[item],total:1}});
  if(p==='/api/workbench/pics')return route.fulfill({json:{rows:[{ID:1,UserName:'Admin'}]}});
  if(p==='/api/packaging/lookups')return route.fulfill({json:{packagingTypes:[{ID:1,PackagingType:'Pillow',PackagingOrder:'Primary',Status:'Active'},{ID:2,PackagingType:'Box',PackagingOrder:'Secondary',Status:'Active'}]}});
  if(p.endsWith('/assign')){writes.push(req.postDataJSON());Object.assign(item,{PICUserID:1,PIC:'Admin',ItemRowVersion:'AAAAAAAAAAI='});return route.fulfill({json:{result:{RowVersion:item.ItemRowVersion}}})}
  if(p.endsWith('/transition'))return route.fulfill({status:422,json:{detail:warning}});
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('button',{name:'Packaging Requests',exact:true}).click();await page.getByRole('button',{name:'View request',exact:true}).click();
 return {item,writes};
}

test('notification wraps a long response warning from a nowrap table cell without clipping close',async({page},info)=>{
 await setup(page);await page.getByRole('button',{name:'Submit 21',exact:true}).click();await page.getByRole('dialog',{name:'Confirm response action'}).getByRole('button',{name:'Confirm',exact:true}).click();
 const alert=page.getByRole('alert');await expect(alert).toContainText(warning);
 for(const width of [1920,390]){
  await page.setViewportSize({width,height:width===1920?1080:844});
  await expect(alert).toBeInViewport();
  const sizes=await alert.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,textWidth:el.querySelector('span')!.clientWidth,textScroll:el.querySelector('span')!.scrollWidth}));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.width+1);expect(sizes.textScroll).toBeLessThanOrEqual(sizes.textWidth+1);
  const box=(await alert.boundingBox())!,close=(await alert.getByRole('button',{name:'Dismiss notification'}).boundingBox())!;
  expect(close.x+close.width).toBeLessThanOrEqual(box.x+box.width);expect(box.x).toBeGreaterThanOrEqual(0);
 }
 await page.screenshot({path:info.outputPath('wrapped-notification-mobile.png')});
 await alert.getByRole('button',{name:'Dismiss notification'}).click();await expect(alert).toHaveCount(0);
 await expect(page.getByRole('dialog',{name:'Confirm response action'})).toBeVisible();
});

test('Submit and Cancel appear only after the PIC assignment is saved',async({page})=>{
 const state=await setup(page,false),table=page.getByRole('table',{name:'Packaging request items'});
 for(const name of ['Submit 21','Cancel request item 21'])await expect(table.getByRole('button',{name,exact:true})).toHaveCount(0);
 await table.getByLabel('PIC for item 21',{exact:true}).selectOption('1');
 for(const name of ['Submit 21','Cancel request item 21'])await expect(table.getByRole('button',{name,exact:true})).toHaveCount(0);
 expect(state.writes).toHaveLength(0);await table.getByRole('button',{name:'Assign PIC for item 21',exact:true}).click();
 await expect.poll(()=>state.writes.length).toBe(1);
 for(const name of ['Submit 21','Cancel request item 21'])await expect(table.getByRole('button',{name,exact:true})).toBeVisible();
});

test('snapshot metadata is a tab-line info icon and response attachments are absent',async({page},info)=>{
 await setup(page);
 const note=page.locator('.tab-line-info').getByRole('note',{name:/Request-time snapshot/});
 await expect(note).toBeVisible();await expect(note).toHaveAttribute('aria-label',/USD \/ VND: 25,000/);
 await expect(page.locator('.notice').filter({hasText:'Request-time snapshot'})).toHaveCount(0);
 await note.focus();await expect(note).toBeFocused();
 await expect(page.getByRole('tooltip')).toContainText('USD / VND: 25,000');
 await expect(note).not.toHaveAttribute('title');
 const tab=(await page.getByRole('button',{name:'Packaging Responses',exact:true}).boundingBox())!,icon=(await note.boundingBox())!;
 expect(icon.x).toBeGreaterThan(tab.x+tab.width);expect(Math.abs(icon.y+icon.height/2-tab.y-tab.height/2)).toBeLessThan(2);
 await expect(page.getByRole('button',{name:/Attachments for item/})).toHaveCount(0);
 await page.getByRole('button',{name:'Edit request PCR-1',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
 await expect(editor.getByRole('button',{name:/Attachments/})).toHaveCount(0);await expect(editor.locator('input[type=file]')).toHaveCount(0);
 await editor.getByRole('button',{name:'Close request editor',exact:true}).click();
 await page.getByRole('button',{name:'View request',exact:true}).click();
 await page.setViewportSize({width:390,height:844});await note.scrollIntoViewIfNeeded();await expect(note).toBeInViewport();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.screenshot({path:info.outputPath('snapshot-tab-mobile.png')});
});

test('failed PIC assignment never reveals Submit or Cancel',async({page})=>{
 await setup(page,false);
 await page.route('**/api/packaging/items/21/assign',route=>route.fulfill({status:409,json:{detail:'Item changed. Refresh before assigning.'}}));
 const table=page.getByRole('table',{name:'Packaging request items'});
 await table.getByLabel('PIC for item 21',{exact:true}).selectOption('1');
 await table.getByRole('button',{name:'Assign PIC for item 21',exact:true}).click();
 const alert=page.getByRole('alert');await expect(alert).toContainText('Item changed.');
 for(const name of ['Submit 21','Cancel request item 21'])await expect(table.getByRole('button',{name,exact:true})).toHaveCount(0);
 await alert.getByRole('button',{name:'Dismiss notification'}).click();await expect(alert).toHaveCount(0);
});

test('packaging request and response share compact typography and spacing in both themes',async({page},info)=>{
 await setup(page);await page.getByRole('button',{name:'Edit request PCR-1',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
 await editor.getByText('Packaging request',{exact:true}).click();
 const request=editor.getByRole('region',{name:'Primary packaging requirements',exact:true}),response=editor.getByRole('region',{name:'Primary packaging response',exact:true});
 const style=(el:Element)=>{const s=getComputedStyle(el);return {font:s.fontFamily,size:s.fontSize,line:s.lineHeight,weight:s.fontWeight}};
 for(const theme of ['light','dark']){
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  await expect(editor.getByRole('button',{name:'Close request editor',exact:true})).toHaveCount(1);
  await expect(editor.locator('.record-action-bar').getByRole('button',{name:'Close',exact:true})).toHaveCount(0);
  const layerHelp=editor.getByRole('region',{name:'Packing Way request'}).locator('.field-label').first();
  const labelBox=(await layerHelp.locator('.field-label-text').boundingBox())!,noteBox=(await layerHelp.getByRole('note').boundingBox())!;
  expect(noteBox.x-labelBox.x-labelBox.width).toBeGreaterThanOrEqual(3);expect(noteBox.x-labelBox.x-labelBox.width).toBeLessThanOrEqual(6);
  for(const display of await editor.locator('input[readonly]').all()){
   await expect(display).toHaveCSS('border-top-width','0px');await expect(display).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await expect(display).toHaveCSS('padding-left','0px');
  }
  const entry=editor.getByLabel('Nut Density (g/ml)',{exact:true});
  expect(await entry.evaluate(el=>parseFloat(getComputedStyle(el).borderTopWidth))).toBeGreaterThan(0);
  expect(await request.locator('h4').evaluate(style)).toEqual(await response.locator('h4').evaluate(style));
  const reqLabel=request.locator('.field-label').first(),respLabel=response.locator('label').first();
  expect(await reqLabel.evaluate(style)).toEqual(await respLabel.evaluate(style));
  expect(await reqLabel.evaluate(el=>getComputedStyle(el).fontWeight)).toBe('500');
  expect(await request.locator('.packaging-readonly-field p').first().evaluate(style)).toEqual(await editor.locator('.response-product-summary strong').evaluate(style));
  for(const layer of ['Primary','Secondary']){
   const region=editor.getByRole('region',{name:layer+' packaging requirements',exact:true});
   for(const field of await region.locator('.packaging-readonly-field').all()){
    const label=field.locator('.field-label'),value=field.locator('p');
    await expect(label).toHaveCSS('font-size','11px');await expect(value).toHaveCSS('font-size','13px');
    expect(await label.evaluate(el=>getComputedStyle(el).color)).not.toBe(await value.evaluate(el=>getComputedStyle(el).color));
    expect(await label.evaluate(el=>getComputedStyle(el).color)).toBe(await page.locator('html').evaluate(el=>getComputedStyle(el).getPropertyValue('--muted').trim()).then(hex=>{
     const parts=hex.slice(1).match(/../g)!.map(n=>parseInt(n,16));return 'rgb('+parts.join(', ')+')'
    }));
    expect(await field.evaluate(el=>getComputedStyle(el).gap)).toBe('4px');
   }
  }
  for(const region of [request,response]){
   expect(await region.evaluate(el=>getComputedStyle(el).paddingTop)).toBe('8px');
   // Layer symbols share the quantity/price row, not a separate heading row.
   await expect(region.locator('h4')).toHaveCSS('position','absolute');
   await expect(region.locator('h4')).toHaveCSS('margin-bottom','0px');
  }
  const input=editor.getByLabel('No of Primary Unit',{exact:true});
  expect(await input.locator('..').evaluate(el=>getComputedStyle(el).gap)).toBe('4px');
  expect(await input.locator('..').locator('..').evaluate(el=>getComputedStyle(el).paddingTop)).toBe('0px');
  await editor.screenshot({path:info.outputPath('compact-packaging-'+theme+'-1920.png')});
  if(theme==='light'){await editor.getByRole('button',{name:'Close request editor',exact:true}).click();await page.getByRole('button',{name:'Dark mode',exact:true}).click();await page.getByRole('button',{name:'Edit request PCR-1',exact:true}).click();await editor.getByText('Packaging request',{exact:true}).click()}
 }
 await page.setViewportSize({width:390,height:844});
 expect(await editor.locator('.record-dialog-content').first().evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
 await expect(editor.getByRole('button',{name:'Review & save',exact:true})).toBeInViewport();
 const help=editor.getByRole('region',{name:'Packing Way request'}).getByRole('note');
 await help.focus();const tooltip=await page.getByRole('tooltip').evaluate(el=>{const b=el.getBoundingClientRect();return {left:b.left,right:b.right}});
 expect(tooltip.left).toBeGreaterThanOrEqual(0);expect(tooltip.right).toBeLessThanOrEqual(390);
 await editor.screenshot({path:info.outputPath('compact-packaging-dark-mobile.png')});
});

test('Unit Conversions uses standard record and page information for older terminal-page responses',async({page})=>{
 await setup(page);
 await page.route('**/api/unit-conversions?**',route=>route.fulfill({json:{rows:Array.from({length:10},(_,i)=>({ID:i+1,Factor:'1',Status:'Active'})),has_more:false}}));
 await page.getByRole('button',{name:'Unit Conversions',exact:true}).click();
 await expect(page.locator('.conversions-page .pager')).toContainText('10 records · Page 1 of 1');
 await expect(page.locator('.conversions-page .pager').getByRole('button',{name:'Next',exact:true})).toBeDisabled();
});

test('locked response fields display without boxes or dropdown arrows',async({page})=>{
 const {item}=await setup(page);item.ItemStage='Approved';
 await page.getByRole('button',{name:'Edit request PCR-1',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request',exact:true}),type=editor.getByLabel('Primary Type',{exact:true});
 await expect(type).toBeDisabled();await expect(type).toHaveCSS('border-top-width','0px');await expect(type).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await expect(type).toHaveCSS('appearance','none');
 await expect(editor.getByLabel('Nut Density (g/ml)',{exact:true})).toHaveCSS('border-top-width','0px');
 await expect(editor.getByRole('button',{name:'Close request editor',exact:true})).toBeVisible();
 await expect(editor.locator('.record-action-bar').getByRole('button',{name:'Close',exact:true})).toHaveCount(0);
});

test('legacy conversion responses never invent a total while more rows may exist',async({page})=>{
 await setup(page);
 let reply:any={rows:[{ID:1,Factor:'1',Status:'Active'}],has_more:true};
 await page.route('**/api/unit-conversions?**',route=>route.fulfill({json:reply}));
 await page.getByRole('button',{name:'Unit Conversions',exact:true}).click();
 const pager=page.locator('.conversions-page .pager');await expect(pager.locator('>span')).toHaveText('Page 1');
 await expect(pager.getByRole('button',{name:'Next',exact:true})).toBeEnabled();
 reply={rows:[{ID:1,Factor:'1',Status:'Active'}]};
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(pager.locator('>span')).toHaveText('Page 1');
});

test('locked responses expose only the frozen grade snapshot beside Nut Density',async({page},info)=>{
 const state=await setup(page);
 Object.assign(state.item,{ItemStage:'Approved',ProductGradeSnapshot:JSON.stringify({items:[{ParentID:'0',ID:1,RawGradeID:71,Grade:'Frozen Whole',RatioPct:'100'}]})});
 await page.getByRole('button',{name:'Edit request PCR-1',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
 const product=editor.getByRole('region',{name:'Product Info response',exact:true}),grade=product.getByRole('button',{name:'View grade snapshot',exact:true});
 const density=(await product.getByLabel('Nut Density (g/ml)',{exact:true}).boundingBox())!,icon=(await grade.boundingBox())!;
 expect(icon.x+icon.width).toBeLessThanOrEqual(density.x);
 await grade.focus();await grade.press('Enter');
 const popup=page.getByRole('dialog',{name:'Grade snapshot',exact:true});
 await expect(popup.getByText('Frozen Whole',{exact:true})).toBeVisible();
 await expect(popup.getByRole('button',{name:'Use grades',exact:true})).toHaveCount(0);
 await expect(popup.getByRole('combobox')).toHaveCount(0);
 await popup.screenshot({path:info.outputPath('readonly-frozen-grade-snapshot.png')});
 await expect(popup.getByRole('button',{name:'Close grade snapshot',exact:true})).toBeEnabled();
 await popup.getByRole('button',{name:'Close grade snapshot',exact:true}).click();
 await expect(popup).toHaveCount(0);
 await expect(editor).toBeVisible();
 await expect(product.getByLabel('Nut Density (g/ml)',{exact:true})).toBeDisabled();
 state.item.ProductGradeSnapshot=null;
 await editor.getByRole('button',{name:'Close request editor',exact:true}).click();
 await page.getByRole('button',{name:'Edit request PCR-1',exact:true}).click();
 await grade.click();
 await expect(popup.getByText('No grade snapshot was captured.',{exact:true})).toBeVisible();
 await popup.getByRole('button',{name:'Close grade snapshot',exact:true}).click();
 await expect(popup).toHaveCount(0);
 await grade.click();
 await popup.press('Escape');
 await expect(popup).toHaveCount(0);
 await expect(editor).toBeVisible();
});
