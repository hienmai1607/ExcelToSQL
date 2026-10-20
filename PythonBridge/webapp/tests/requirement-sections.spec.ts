import {test,expect,type Page} from '@playwright/test';
const types=[
 {ID:11,PackagingOrder:'Primary',PackagingType:'Pouch',ParentTypeID:null,Status:'Active'},
 {ID:12,PackagingOrder:'Secondary',PackagingType:'Carton',Shipping:true,ParentTypeID:null,Status:'Active'},
 {ID:13,PackagingOrder:'Primary',PackagingType:'Child film',ParentTypeID:11,Status:'Active'},
 {ID:14,PackagingOrder:'Primary',PackagingType:'Blocked bag',ParentTypeID:null,Status:'Block'}
];
test('only final Secondary or Tertiary requires Shipping and matching order',async({page})=>{
 const lookup=[...types,
  {ID:15,PackagingOrder:'Secondary',PackagingType:'Storage carton',Shipping:false,ParentTypeID:null,Status:'Active'},
  {ID:16,PackagingOrder:'Tertiary',PackagingType:'Shipping case',Shipping:true,ParentTypeID:null,Status:'Active'},
  {ID:17,PackagingOrder:'Tertiary',PackagingType:'Storage case',Shipping:false,ParentTypeID:null,Status:'Active'},
  {ID:18,PackagingOrder:'Primary',PackagingType:'Shipping pouch',Shipping:true,ParentTypeID:null,Status:'Active'}];
 const {item}=await setup(page,lookup);
 const secondary=item.getByLabel('Secondary Type',{exact:true});
 await expect(secondary.locator('option')).toHaveText(['Choose secondary type','Carton']);
 await item.getByLabel('Requested packaging layers',{exact:true}).selectOption('3');
 await expect(secondary.locator('option')).toHaveText(['Choose secondary type','Carton','Storage carton']);
 await expect(item.getByLabel('Tertiary Type',{exact:true}).locator('option')).toHaveText(['Choose tertiary type','Shipping case']);
 await item.getByLabel('Requested packaging layers',{exact:true}).selectOption('1');
 await expect(item.getByLabel('Primary Type',{exact:true}).locator('option')).toHaveText(['Choose primary type','Pouch','Shipping pouch']);
});
async function setup(page:Page,lookupTypes=types){
 const writes:any[]=[];
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Sales',scopes:['Opportunity'],is_admin:false,user_id:10}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/opportunity/grid')return route.fulfill({json:{rows:[],total:0,page:1}});
  if(path==='/api/opportunity/lookups')return route.fulfill({json:{customers:[{ID:1,CustomerName:'Customer',CustomerCurrencyCode:'USD'}],products:[
   {ID:2,ProductCode:'PRD-2',ProductName:'Almonds',CustomerID:1,ShelfLifeDays:365},
   {ID:3,ProductCode:'PRD-3',ProductName:'Cashews',CustomerID:1,ShelfLifeDays:180}
  ],pallets:[{ID:1,PalletSize:'1.1x1.1M'}],packagingTypes:lookupTypes}});
  if(path==='/api/opportunity/batch'){const payload=route.request().postDataJSON();writes.push(payload);return route.fulfill({json:{header_results:[{RowNum:1,Status:'OK',OpportunityNumber:'OPP-NEW'}],item_results:payload.item_rows.map((r:any)=>({RowNum:r.RowNum,Status:'OK'}))}})}
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'New Opportunity',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New Opportunity',exact:true});
 await form.getByLabel('Customer *',{exact:true}).selectOption('1');
 await form.getByLabel('Description *',{exact:true}).fill('Packaging launch');
 await form.getByLabel('Exchange rate VND per USD *',{exact:true}).fill('25000');
 await form.getByLabel('Exchange rate Customer Currency per USD *',{exact:true}).fill('1');
 await form.getByLabel('Bid open',{exact:true}).fill('10/01/2026');await form.getByLabel('Bid close',{exact:true}).fill('10/10/2026');
 const item=form.getByRole('region',{name:'Item 1',exact:true});
 await item.getByLabel('Product *').selectOption('2');
 await item.getByLabel('Annual units *').fill('1000');await item.getByText('Packaging requirements',{exact:true}).click();await item.getByText('Shipment, Logistics, Co-Man & Others info',{exact:true}).click();
 await item.getByLabel('Container Type',{exact:true}).selectOption('20DC');await item.getByLabel('Pallet size',{exact:true}).selectOption('1.1x1.1M');return {form,item,writes};
}

test('Product Info fits one desktop row and wraps without overflow on mobile',async({page},info)=>{
 const {item}=await setup(page),product=item.getByRole('region',{name:'Product Info',exact:true});
 const fields=[product.getByLabel('Product *',{exact:true}).locator('..'),product.getByLabel('Net weight (g)',{exact:true}).locator('..'),product.getByLabel('Annual units *',{exact:true}).locator('..'),product.getByLabel('Estimated award %',{exact:true}).locator('..'),product.getByLabel('Estimated awarded units',{exact:true}).locator('..'),product.getByLabel('Shelf price',{exact:true}).locator('..'),product.getByLabel('Shelf life (days)',{exact:true}).locator('..'),product.locator('.product-grade-snapshot')];
 // Capture every field in one browser frame; smooth reveal scrolling can move
 // the page between separate boundingBox calls and mimic a layout offset.
 const boxes=await product.locator('.opportunity-product-fields label, .product-grade-snapshot').evaluateAll(nodes=>nodes.map(node=>{const {x,y,width,height}=node.getBoundingClientRect();return {x,y,width,height}}));
 expect(boxes).toHaveLength(fields.length);
 expect(boxes.every(box=>box.width>0&&box.height>0)).toBe(true);
 expect(Math.max(...boxes.map(box=>box.y))-Math.min(...boxes.map(box=>box.y))).toBeLessThan(1);
 await product.screenshot({path:info.outputPath('product-info-one-row.png')});
 await page.setViewportSize({width:390,height:844});
 for(const field of fields)await expect(field).toBeVisible();
 expect(await product.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
});

test('request transparency and layer symbol stay compact and aligned',async({page})=>{
 const {item}=await setup(page);
 await item.getByLabel('Requested packaging layers',{exact:true}).selectOption('2');
 const primary=item.getByRole('region',{name:'Primary packaging requirements',exact:true});
 await expect(primary.getByLabel('Transparent / opaque',{exact:true})).toBeVisible();
 await expect(primary.getByLabel('Transparent / opaque',{exact:true}).locator('option').first()).toHaveText('Choose transparent / opaque');
 const alignment=await primary.evaluate(section=>{
  const symbol=section.querySelector('h4')!.getBoundingClientRect();
  const label=section.querySelector('.layer-packing-way .field-label')!.getBoundingClientRect();
  return {top:Math.abs(symbol.top-label.top),right:Math.abs(symbol.right-section.getBoundingClientRect().right)};
 });
 expect(alignment.top).toBeLessThan(2);expect(alignment.right).toBeLessThan(2);
});

test('packing quantities align with matching layers and have multiplication prefixes',async({page})=>{
 const {item}=await setup(page);
 const header=item.getByRole('region',{name:'Packing Way request',exact:true});
 await item.getByLabel('Requested packaging layers',{exact:true}).selectOption('3');
 await expect(header.getByLabel('No of Primary Unit',{exact:true})).toHaveCount(0);
 await expect(header.getByLabel('No of Secondary Unit',{exact:true})).toHaveCount(0);
 const primary=item.getByRole('region',{name:'Primary packaging requirements',exact:true});
 const secondary=item.getByRole('region',{name:'Secondary packaging requirements',exact:true});
 const tertiary=item.getByRole('region',{name:'Tertiary packaging requirements',exact:true});
 for(const [section,label,value] of [[primary,'No of Primary Unit','12'],[secondary,'No of Secondary Unit','8']] as const){
  await section.getByLabel(label,{exact:true}).fill(value);
  if(label==='No of Secondary Unit'){
   await expect(section.locator('.layer-packing-way .packing-multiplier')).toHaveText(String.fromCharCode(215));
   const prefix=await section.locator('.packing-multiplier').boundingBox(),input=await section.getByLabel(label,{exact:true}).boundingBox();
   expect(prefix!.x+prefix!.width).toBeLessThanOrEqual(input!.x);
  }else await expect(section.locator('.packing-multiplier')).toHaveCount(0);
  await expect(section.getByRole('button',{name:'Clear '+label,exact:true})).toHaveCount(0);
  const quantity=await section.locator('.layer-packing-way').boundingBox(),fields=await section.locator('.packaging-entry-grid').boundingBox();
  expect(quantity!.y+quantity!.height).toBeLessThanOrEqual(fields!.y);
 }
 await expect(tertiary.locator('.packing-fixed-quantity')).toHaveText(String.fromCharCode(215)+'1');
 await primary.getByLabel('No of Primary Unit',{exact:true}).fill('');
 await expect(primary.getByLabel('No of Primary Unit',{exact:true})).toHaveValue('');
 await expect(secondary.getByLabel('No of Secondary Unit',{exact:true})).toHaveValue('8');
 await item.getByLabel('Requested packaging layers',{exact:true}).selectOption('2');
 await expect(secondary.locator('.packing-fixed-quantity')).toHaveText(String.fromCharCode(215)+'1');
 await expect(tertiary).toHaveCount(0);
});

for(const count of [2,3])test('packaging layer sections stay horizontal on desktop: '+count,async({page})=>{
 const {item}=await setup(page);
 await item.getByLabel('Requested packaging layers',{exact:true}).selectOption(String(count));
 const sections=item.locator('.packaging-request-layers>section');
 const boxes=await sections.evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect()));
 expect(boxes).toHaveLength(count);
 expect(Math.max(...boxes.map(b=>b.y))-Math.min(...boxes.map(b=>b.y))).toBeLessThan(1);
 for(let i=1;i<count;i++)expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i-1].right);
 for(const section of await sections.all()){
  const comment=section.getByLabel('Special comments',{exact:true}).locator('..');
  const width=await section.locator('.packaging-entry-grid').boundingBox(),comments=await comment.boundingBox();
  expect(comments!.width).toBeGreaterThan(width!.width*.9);
 }
 await page.setViewportSize({width:600,height:900});
 const stacked=await sections.evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect()));
 for(let i=1;i<count;i++)expect(stacked[i].y).toBeGreaterThanOrEqual(stacked[i-1].bottom);
 expect(await item.locator('.packaging-request-layers').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
});

test('sections have exact choices, root types only and one Product Info shelf-life display',async({page})=>{
 const {item}=await setup(page);
 await expect(item.getByRole('region',{name:'Shipment',exact:true})).toBeVisible();
 await expect(item.getByLabel('Container Type',{exact:true}).locator('option')).toHaveText(['Choose container type','20DC','40DC','40HC','20RC','40RHC']);
 await expect(item.getByLabel('Loading request',{exact:true}).locator('option')).toHaveText(['Choose loading request','Pallet load','Floor load','Both']);
 await expect(item.getByRole('region',{name:'Palletization request',exact:true})).toBeVisible();
 await expect(item.getByLabel('Primary Type',{exact:true}).locator('option')).toHaveText(['Choose primary type','Pouch']);
 await expect(item.getByLabel('Secondary Type',{exact:true}).locator('option')).toHaveText(['Choose secondary type','Carton']);
 for(const label of ['Transparent / opaque','Secondary Transparent / opaque'])await expect(item.getByLabel(label,{exact:true}).locator('option')).toHaveText(['Choose '+label.toLowerCase(),'Transparent','Opaque','NA']);
 const shelves=item.getByLabel('Shelf life (days)',{exact:true});await expect(shelves).toHaveCount(1);
 for(const shelf of await shelves.all()){await expect(shelf).toHaveValue('365');await expect(shelf).toHaveAttribute('readonly','')}
 await item.getByLabel('Product *').selectOption('3');for(const shelf of await shelves.all())await expect(shelf).toHaveValue('180');
 await expect(item.getByLabel('Packaging type',{exact:true})).toHaveCount(0);
});

test('requirements are independent per layer and appear before Container and Palletization',async({page},info)=>{
 const {form,item,writes}=await setup(page);
 await item.getByLabel('Requested packaging layers',{exact:true}).selectOption('3');
 const values=['Yes','No','NA'];
 for(const [i,layer] of ['Primary','Secondary','Tertiary'].entries()){
  const section=item.getByRole('region',{name:layer+' packaging requirements',exact:true});
  await expect(section.getByLabel('Recyclable requirement',{exact:true}).locator('option')).toHaveText(['Choose recyclable requirement','Yes','No','NA']);
  await expect(section.getByLabel('Metalized / aluminum',{exact:true}).locator('option')).toHaveText(['Choose metalized / aluminum','Metalized','Aluminum','NA']);
  await section.getByLabel('Recyclable requirement',{exact:true}).selectOption(values[i]);
  await section.getByLabel('Recycled content',{exact:true}).selectOption(values[2-i]);
  await section.getByLabel('Metalized / aluminum',{exact:true}).selectOption(i===0?'Metalized':i===1?'Aluminum':'NA');
  await section.getByLabel('Special comments',{exact:true}).fill(layer+' note');
  await expect(section.getByLabel('Shelf life (days)',{exact:true})).toHaveCount(0);
 }
 await expect(item.getByRole('region',{name:'Product Info',exact:true}).getByLabel('Shelf life (days)',{exact:true})).toHaveValue('365');
 const tertiary=(await item.getByRole('region',{name:'Tertiary packaging requirements'}).boundingBox())!;
 const container=(await item.getByRole('region',{name:'Shipment'}).boundingBox())!;
 expect(container.y).toBeGreaterThanOrEqual(tertiary.y+tertiary.height);
 await item.getByLabel('Max pallet height (mm)',{exact:true}).scrollIntoViewIfNeeded();
 await expect(item.getByLabel('Max pallet height (mm)',{exact:true})).toBeInViewport();
 await form.screenshot({path:info.outputPath('three-layer-opportunity-layout.png')});
 await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0].item_rows[0]).toMatchObject({RecyclableRequirement:'Yes',SecondaryRecyclableRequirement:'No',TertiaryRecyclableRequirement:'NA',SpecialComments:'Primary note',SecondarySpecialComments:'Secondary note',TertiarySpecialComments:'Tertiary note'});
});

test('Opportunity paging preserves unsaved drafts and submits edits from every page',async({page},info)=>{
 const {form,writes}=await setup(page);
 const footer=form.locator('.record-dialog-footer');
 await footer.getByLabel('Rows per page').fill('1');await footer.getByLabel('Rows per page').blur();
 await form.getByRole('button',{name:'Add item',exact:true}).click();
 await expect(footer).toContainText('2 items · Page 2 of 2');
 const second=form.getByRole('region',{name:'Item 2',exact:true});
 await second.getByLabel('Product *').selectOption('3');await second.getByLabel('Annual units *').fill('200');await second.getByText('Packaging requirements',{exact:true}).click();await second.getByLabel('Pallet size',{exact:true}).selectOption('1.1x1.1M');await second.getByText('Shipment, Logistics, Co-Man & Others info',{exact:true}).click();await second.getByLabel('Container Type',{exact:true}).selectOption('20DC');
 await footer.getByRole('button',{name:'Previous',exact:true}).click();
 await expect(form.getByRole('region',{name:'Item 2',exact:true})).toHaveCount(0);
 await form.getByRole('region',{name:'Item 1',exact:true}).getByLabel('Annual units *').fill('300');
 await footer.getByRole('button',{name:'Next',exact:true}).click();await expect(second.getByLabel('Annual units *')).toHaveValue('200');
 const body=form.locator('.record-dialog-content'),before=(await footer.boundingBox())!;
 await body.evaluate(el=>{el.scrollTop=el.scrollHeight});
 expect(Math.abs((await footer.boundingBox())!.y-before.y)).toBeLessThan(1);
 await form.screenshot({path:info.outputPath('opportunity-fixed-pagination.png')});
 await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0].item_rows.map((x:any)=>x.AnnualUnit)).toEqual([300,200]);
});

test('Opportunity grade icon edits an item snapshot without any Product Master writes',async({page})=>{
 const {form,item,writes}=await setup(page);const masterWrites:string[]=[];
 page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.startsWith('/api/workbench/products'))masterWrites.push(r.url())});
 await page.route('**/api/opportunity/grade-lookups',r=>r.fulfill({json:{rows:[{ID:71,GradeName:'Whole',ParentGradeID:null},{ID:72,GradeName:'Split',ParentGradeID:null}],materials:[]}}));
 await page.route('**/api/opportunity/products/2/grade-snapshot',r=>r.fulfill({json:{items:[{ParentID:'0',ID:1,RawGradeID:71,RawMaterialID:null,Grade:'Whole',RatioPct:'100'}]}}));
 await item.getByRole('button',{name:'Edit Opportunity grade snapshot',exact:true}).click();
 const grades=page.getByRole('dialog',{name:'Product grades',exact:true});
 await expect(grades.getByText('Opportunity grade snapshot',{exact:true})).toBeVisible();
 await expect(grades.locator('.customer-editor-heading').getByLabel('Grade summary')).toBeVisible();
 await expect(grades.locator('.grade-controls')).toHaveCount(0);
 await expect(grades.getByRole('region',{name:'Raw Material',exact:true})).toBeVisible();
 await expect(grades.getByLabel('Grade status')).toHaveCount(0);
 await grades.getByLabel('Grade 0/1',{exact:true}).selectOption('72');
 await grades.getByRole('button',{name:'Use grades',exact:true}).click();expect(masterWrites).toEqual([]);
 await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0].item_rows[0].ProductGradeSnapshot.items[0]).toMatchObject({RawGradeID:72,Grade:'Split',RatioPct:'100'});expect(masterWrites).toEqual([]);
});

test('requested layers control cumulative sections and use multi-order root choices',async({page})=>{
 const all={ID:15,PackagingOrder:'Primary',PackagingOrders:['Primary','Secondary','Tertiary'],PackagingType:'Shared box',Shipping:true,ParentTypeID:null,Status:'Active'};
 const {form,item,writes}=await setup(page,[...types,all]);
 await expect(item.getByLabel('Requested packaging layers',{exact:true})).toHaveValue('2');
 await item.getByLabel('Requested packaging layers',{exact:true}).selectOption('3');
 for(const label of ['Primary Type','Secondary Type','Tertiary Type'])await item.getByLabel(label,{exact:true}).selectOption('15');
 await item.getByLabel('No of Secondary Unit',{exact:true}).fill('8');
 await item.getByLabel('Tertiary Transparent / opaque',{exact:true}).selectOption('NA');
 await expect(item.getByLabel('Shelf life (days)',{exact:true})).toHaveCount(1);
 await item.getByLabel('Requested packaging layers',{exact:true}).selectOption('1');
 await expect(item.getByLabel('Secondary Type',{exact:true})).toHaveCount(0);
 await expect(item.getByLabel('Tertiary Type',{exact:true})).toHaveCount(0);
 await expect(item.getByLabel('Shelf life (days)',{exact:true})).toHaveCount(1);
 await form.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(writes[0].item_rows[0]).toMatchObject({PackagingLayerCount:'1',PrimaryTypeID:'15',SecondaryTypeID:null,TertiaryTypeID:null,NumberOfSecondary:null,TertiaryTransparency:null});
});
test('three requested layers save Tertiary requirements',async({page})=>{
 const {form,item,writes}=await setup(page,[...types,{ID:15,PackagingOrders:['Tertiary'],PackagingOrder:'Tertiary',PackagingType:'Shipping case',Shipping:true,ParentTypeID:null,Status:'Active'}]);
 await item.getByLabel('Requested packaging layers',{exact:true}).selectOption('3');
 await item.getByLabel('Tertiary Type',{exact:true}).selectOption('15');
 await item.getByLabel('No of Secondary Unit',{exact:true}).fill('8');
 await item.getByLabel('Tertiary Transparent / opaque',{exact:true}).selectOption('Opaque');
 await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(writes[0].item_rows[0]).toMatchObject({PackagingLayerCount:'3',TertiaryTypeID:'15',NumberOfSecondary:'8',TertiaryTransparency:'Opaque'});
});

test('Pallet load and Both show pallet inputs; Floor load retains required pallet size and clears unused stacking and height',async({page})=>{
 const {form,item,writes}=await setup(page);
 const config=item.getByLabel('Loading request',{exact:true});
 for(const choice of ['Pallet load','Both']){
  await config.selectOption(choice);await expect(item.getByRole('region',{name:'Palletization request',exact:true})).toBeVisible();
  await expect(item.getByLabel('Pallet stacking',{exact:true}).locator('option')).toHaveText(['Choose pallet stacking','Single','Double']);
 }
 await item.getByLabel('Pallet size',{exact:true}).selectOption('1.1x1.1M');
 await item.getByLabel('Pallet stacking',{exact:true}).selectOption('Double');await item.getByLabel('Max pallet height (mm)',{exact:true}).fill('1800');
 await config.selectOption('Floor load');await expect(item.getByLabel('Pallet size',{exact:true})).toHaveValue('1.1x1.1M');
 await item.getByLabel('Container Type',{exact:true}).selectOption('20RC');
 await item.getByLabel('Primary Type',{exact:true}).selectOption('11');await item.getByLabel('Secondary Type',{exact:true}).selectOption('12');
 await item.getByLabel('Transparent / opaque',{exact:true}).selectOption('Transparent');await item.getByLabel('Secondary Transparent / opaque',{exact:true}).selectOption('Opaque');
 await item.getByLabel('No of Primary Unit',{exact:true}).fill('12');
 await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(writes[0].item_rows[0]).toMatchObject({ContainerRequest:'20RC',ConfigurationRequest:'Floor load',PalletSize:'1.1x1.1M',PalletStacking:null,MaxPalletHeightMM:null,PrimaryTypeID:'11',SecondaryTypeID:'12',NumberOfPrimary:'12',Transparency:'Transparent',SecondaryTransparency:'Opaque',WebPackagingRequirements:true});
 expect(writes[0].item_rows[0]).not.toHaveProperty('ShelfLifeDays');
 expect(writes[0].item_rows[0]).not.toHaveProperty('PackagingType');
});

test('Number of Primary rejects zero, fractional and oversized input before sending',async({page})=>{
 const {form,item,writes}=await setup(page);
 for(const value of ['0','1.5','2147483648']){
  await item.getByLabel('No of Primary Unit',{exact:true}).fill(value);await form.getByRole('button',{name:'Review & save'}).click();
  await expect(form.getByText(/Check Number of Primary/)).toBeVisible();expect(writes).toHaveLength(0);
 }
});

test('Opportunity header has one desktop control row and responsive smaller rows',async({page},testInfo)=>{
 const {form}=await setup(page);
 for(const width of [1440,1020]){
  await page.setViewportSize({width,height:766});
  const boxes=await form.locator('.opportunity-header-fields').evaluate(grid=>[...grid.querySelectorAll('input,select,.opportunity-entry-summary')].map(el=>{const r=el.getBoundingClientRect();return {top:r.top,left:r.left,right:r.right,height:r.height}}));
  expect(new Set(boxes.slice(0,4).map(b=>Math.round(b.top))).size).toBe(1);
  expect(new Set(boxes.slice(4,7).map(b=>Math.round(b.top))).size).toBe(1);
  if(width>=1400)expect(new Set(boxes.slice(0,7).map(b=>Math.round(b.top))).size).toBe(1);
  else expect(boxes[7].top).toBeLessThanOrEqual(boxes[4].top);
  expect(boxes[7].top).toBeGreaterThan(boxes[0].top);
  for(const b of boxes.slice(0,7))expect(b.height).toBe(32);
  const header=await form.locator('.opportunity-header-box').boundingBox();
  expect(header!.height).toBeLessThan(205);
  const viewport=await form.locator('.opportunity-header-fields').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
  expect(viewport.scroll).toBeLessThanOrEqual(viewport.width);
  if(width===1020)await form.locator('.opportunity-header-box').screenshot({path:testInfo.outputPath('compact-header-1020.png')});
 }
 await page.setViewportSize({width:550,height:766});
 const viewport=await form.locator('.opportunity-header-fields').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
 expect(viewport.scroll).toBeLessThanOrEqual(viewport.width);
});

test('copy uses current unsaved packaging only, clears blank source fields and saves through normal review',async({page})=>{
 const {form,item,writes}=await setup(page);
 await expect(item.getByLabel('Copy packaging from item')).toHaveCount(0);
 await expect(item.getByRole('button',{name:'Copy packaging',exact:true})).toBeDisabled();
 await item.getByLabel('Container Type',{exact:true}).selectOption('20RC');
 await item.getByLabel('Loading request',{exact:true}).selectOption('Both');
 await item.getByLabel('Pallet size',{exact:true}).selectOption('1.1x1.1M');
 await item.getByLabel('Pallet stacking',{exact:true}).selectOption('Double');
 await item.getByLabel('Max pallet height (mm)',{exact:true}).fill('1800');
 await item.getByLabel('Primary Type',{exact:true}).selectOption('11');
 await item.getByLabel('Secondary Type',{exact:true}).selectOption('12');
 await item.getByLabel('Transparent / opaque',{exact:true}).selectOption('Transparent');
 await item.getByLabel('Secondary Transparent / opaque',{exact:true}).selectOption('Opaque');
 await item.getByLabel('No of Primary Unit',{exact:true}).fill('24');
 await form.getByRole('button',{name:'Add item',exact:true}).click();
 const target=form.getByRole('region',{name:'Item 2',exact:true});
 await target.getByLabel('Product *').selectOption('3');
 await target.getByLabel('Annual units *').fill('200');
 await target.getByLabel('Estimated award %').fill('40');await target.getByLabel('Shelf price').fill('12.5');
 await target.getByText('Packaging requirements',{exact:true}).click();await target.getByText('Shipment, Logistics, Co-Man & Others info',{exact:true}).click();
 await target.getByRole('region',{name:'Primary packaging requirements',exact:true}).getByLabel('Recycled content',{exact:true}).selectOption('Yes');
 await item.getByRole('region',{name:'Primary packaging requirements',exact:true}).getByLabel('Special comments',{exact:true}).fill('Latest source edit');await target.locator('.packaging-copy > button').click();await expect(page.getByRole('dialog',{name:'Choose packaging source'}).getByLabel('Copy packaging from item').locator('option')).toHaveText(['Choose another item','Item 1 - PRD-2 - Almonds']);
 await page.getByRole('dialog',{name:'Choose packaging source'}).getByLabel('Copy packaging from item').selectOption({label:'Item 1 - PRD-2 - Almonds'});
 // The popup copies the latest unsaved source values without writing to the server.
 await page.getByRole('dialog',{name:'Choose packaging source'}).getByRole('button',{name:'Copy packaging',exact:true}).click();
 expect(writes).toHaveLength(0);
 await expect(target.getByRole('status')).toContainText('Packaging copied from Item 1');
 await expect(target.getByRole('region',{name:'Primary packaging requirements',exact:true}).getByLabel('Recycled content',{exact:true})).toHaveValue('');
 await expect(target.getByRole('region',{name:'Primary packaging requirements',exact:true}).getByLabel('Special comments',{exact:true})).toHaveValue('Latest source edit');
 await expect(target.getByLabel('Product *')).toHaveValue('3');
 await expect(target.getByLabel('Item description *')).toHaveCount(0);
 await expect(target.getByLabel('Annual units *')).toHaveValue('200');
 for(const shelf of await target.getByLabel('Shelf life (days)',{exact:true}).all())await expect(shelf).toHaveValue('180');
 await form.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0].item_rows[1]).toMatchObject({ProductID:3,AnnualUnit:200,EstPctAwarded:40,ShelfPrice:12.5,ContainerRequest:'20RC',ConfigurationRequest:'Both',PalletSize:'1.1x1.1M',PalletStacking:'Double',MaxPalletHeightMM:'1800',PrimaryTypeID:'11',SecondaryTypeID:'12',Transparency:'Transparent',SecondaryTransparency:'Opaque',NumberOfPrimary:'24',RecycledContent:null,SpecialComments:'Latest source edit'});
 expect(writes[0].item_rows[1]).not.toHaveProperty('ShelfLifeDays');
});

test('currency controls use matching compact widths and help aligns with the label line',async({page},info)=>{
 const {form,item}=await setup(page);
 const controls=form.locator('.opportunity-currency input,.opportunity-rate input'),boxes=await controls.evaluateAll(nodes=>nodes.map(el=>{const b=el.getBoundingClientRect();return {width:b.width,font:getComputedStyle(el).fontSize}}));
 expect(boxes).toHaveLength(3);expect(new Set(boxes.map(b=>b.width)).size).toBe(1);for(const b of boxes)expect(b.width).toBeLessThan(150);
 const label=item.locator('.field-label').filter({hasText:'Requested packaging layers'}),note=label.getByRole('note');
 const {l,n,textBox}=await label.evaluate(el=>({l:el.getBoundingClientRect().toJSON(),n:el.querySelector('.info-tip')!.getBoundingClientRect().toJSON(),textBox:el.querySelector('.field-label-text')!.getBoundingClientRect().toJSON()}));expect(Math.abs(l.y+l.height/2-n.y-n.height/2)).toBeLessThan(2);expect(n.x-textBox.x-textBox.width).toBeLessThanOrEqual(6);
 await expect(item.getByLabel('Copy packaging from item')).toHaveCount(0);await expect(item.locator('.packaging-copy > button svg')).toBeVisible();
 await form.screenshot({path:info.outputPath('compact-currency-copy-1920.png')});
});

test('copying Floor load retains required size but clears target stacking and height and removing the source disables copying',async({page})=>{
 const {form,item}=await setup(page);
 await item.getByLabel('Loading request',{exact:true}).selectOption('Floor load');
 await form.getByRole('button',{name:'Add item',exact:true}).click();
 const target=form.getByRole('region',{name:'Item 2',exact:true});
 await target.getByLabel('Product *').selectOption('3');await target.getByText('Packaging requirements',{exact:true}).click();await target.getByText('Shipment, Logistics, Co-Man & Others info',{exact:true}).click();
 await target.getByLabel('Loading request',{exact:true}).selectOption('Both');
 await target.getByLabel('Pallet size',{exact:true}).selectOption('1.1x1.1M');
 await target.getByLabel('Pallet stacking',{exact:true}).selectOption('Double');
 await target.getByLabel('Max pallet height (mm)',{exact:true}).fill('2');
 await target.locator('.packaging-copy > button').click();await page.getByRole('dialog',{name:'Choose packaging source'}).getByLabel('Copy packaging from item').selectOption({label:'Item 1 - PRD-2 - Almonds'});
 await page.getByRole('dialog',{name:'Choose packaging source'}).getByRole('button',{name:'Copy packaging',exact:true}).click();
 await expect(target.getByLabel('Loading request',{exact:true})).toHaveValue('Floor load');
 await expect(target.getByLabel('Pallet size',{exact:true})).toHaveValue('1.1x1.1M');
 await target.getByLabel('Loading request',{exact:true}).selectOption('Both');
 for(const label of ['Pallet stacking','Max pallet height (mm)'])await expect(target.getByLabel(label,{exact:true})).toHaveValue('');
 await item.getByRole('button',{name:'Remove item 1',exact:true}).click();
 const remaining=form.getByRole('region',{name:'Item 1',exact:true}); // Item numbers update when a preceding item is removed.
 await expect(remaining.getByLabel('Copy packaging from item')).toHaveCount(0);
 await expect(remaining.getByRole('button',{name:'Copy packaging',exact:true})).toBeDisabled();
});

test('request editor shows the requirement sections read-only without changing response choices',async({page})=>{
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Admin',scopes:['Admin'],is_admin:true,user_id:1}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/workbench/requests')return route.fulfill({json:{rows:[{RequestID:1,RequestNumber:'PCR-1',ItemCount:1,RequestStatus:'Open'}],total:1}});
  if(path==='/api/packaging/requests')return route.fulfill({json:{rows:[{ItemID:7,ProductCode:'PRD-2',ProductName:'Almonds',ItemStage:'Assigned',ContainerRequest:'Dry',ConfigurationRequest:'Both',PalletSize:'1.1x1.1M',PalletStacking:'Single',PrimaryTypeID:11,PrimaryTypeName:'Requested Pouch',SecondaryTypeID:12,SecondaryTypeName:'Requested Carton',Transparency:'NA',SecondaryTransparency:'Opaque',NumberOfPrimary:24,ShelfLifeDays:365,ProductShelfLifeDays:180,ItemRowVersion:'AAAAAAAAAAE='}],total:1}});
  if(path==='/api/packaging/lookups')return route.fulfill({json:{packagingTypes:types,materials:[],currencies:[]}});
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Requests',exact:true}).click();await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const item=page.getByRole('region',{name:'Request item 7',exact:true});await item.getByText('Packaging request',{exact:true}).click();
 const primary=item.getByRole('region',{name:'Primary packaging requirements',exact:true}),secondary=item.getByRole('region',{name:'Secondary packaging requirements',exact:true});
 await expect(primary.getByText('Requested Pouch',{exact:true})).toBeVisible();await expect(secondary.getByText('Requested Carton',{exact:true})).toBeVisible();
 await expect(primary.getByText('24',{exact:true})).toBeVisible();await expect(primary.getByRole('combobox')).toHaveCount(0);
 for(const shelf of await item.getByLabel('Shelf life (days)',{exact:true}).all()){await expect(shelf).toHaveValue('365');await expect(shelf).toHaveAttribute('readonly','')}
 await expect(item.getByLabel('Primary Type',{exact:true}).locator('option[value="13"]')).toHaveCount(0); // Response uses names, not request IDs.
 await expect(item.getByLabel('Primary Type',{exact:true})).toBeVisible();
});
