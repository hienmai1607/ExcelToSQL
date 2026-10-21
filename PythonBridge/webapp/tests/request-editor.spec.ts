import {test,expect,type Page} from '@playwright/test';
test('response last-layer dropdown requires Shipping and follows confirmed layers',async({page})=>{
 await setup(page);
 await page.route('**/api/packaging/lookups',r=>r.fulfill({json:{packagingTypes:[
  {ID:1,PackagingOrder:'Primary',PackagingType:'Film',Shipping:false},
  {ID:2,PackagingOrder:'Secondary',PackagingType:'Carton',Shipping:true},
  {ID:3,PackagingOrder:'Secondary',PackagingType:'Storage box',Shipping:false},
  {ID:4,PackagingOrder:'Tertiary',PackagingType:'Crate',Shipping:true},
  {ID:5,PackagingOrder:'Tertiary',PackagingType:'Storage crate',Shipping:false}
 ]}}));
 await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const item=page.getByRole('region',{name:'Request item 1',exact:true});
 await expect(item.getByLabel('Secondary Type',{exact:true}).locator('option')).toHaveText(['Choose secondary type','Carton']);
 await item.getByLabel('Confirmed packaging layers',{exact:true}).selectOption('3');
 await expect(item.getByLabel('Secondary Type',{exact:true}).locator('option')).toHaveText(['Choose secondary type','Carton','Storage box']);
 await expect(item.getByLabel('Tertiary Type',{exact:true}).locator('option')).toHaveText(['Choose tertiary type','Crate']);
});
async function setup(page:Page,failSecond=false,sessionOverride:Record<string,unknown>={},editorPageSize=25){
 const writes:any[]=[];
 const rows=[1,2,3].map(id=>({RequestID:1,ItemID:id,ProductCode:'P'+id,ProductName:'Product '+id,ItemDescription:'Item '+id,ItemStage:id===3?'Approved':'Assigned',PICUserID:1,PIC:'Admin',ItemRowVersion:'AAAAAAAAAAE=',AnnualUnit:100,WeightGrams:10}));
 await page.route('**/api/**',route=>{
 const p=new URL(route.request().url()).pathname;
 if(p.endsWith('/session'))return route.fulfill({json:{username:'Admin',user_id:1,is_admin:true,scopes:['Admin'],...sessionOverride}});
 if(p.endsWith('/preferences'))return route.fulfill({json:{settings:{columns:['CustomerName'],filters:[],sort:[],page_size:25,requests:{editor_page_size:editorPageSize}},version:0}});
 if(p==='/api/workbench/requests')return route.fulfill({json:{rows:[{RequestID:1,RequestNumber:'PCR-1',CustomerName:'Customer',OpportunityNumber:'OPP-1',RequestStatus:'Open',ItemCount:3}],total:1}});
 if(p==='/api/packaging/requests'){const u=new URL(route.request().url()),page=Number(u.searchParams.get('page')||1),size=Number(u.searchParams.get('page_size')||200);return route.fulfill({json:{rows:rows.slice((page-1)*size,page*size),total:rows.length,page}})}
 if(p==='/api/workbench/pics')return route.fulfill({json:{rows:[{ID:1,UserName:'Admin'},{ID:2,UserName:'PIC'}]}});
 if(p==='/api/packaging/lookups')return route.fulfill({json:{currencies:[],packagingTypes:[{ID:1,PackagingOrder:'Primary',PackagingType:'Film'},{ID:2,PackagingOrder:'Secondary',PackagingType:'Carton',Shipping:true}]}});
 if(p==='/api/packaging/response/batch'){const data=route.request().postDataJSON();writes.push(data);const r=data.rows[0];if(failSecond&&r.ID===2)return route.fulfill({json:{results:[{RowNum:1,Status:'ERROR',Message:'Conflict: refresh required.'}]}});Object.assign(rows.find(x=>x.ItemID===r.ID)!,r,{ItemRowVersion:'AAAAAAAAAAI='});return route.fulfill({json:{results:[{RowNum:1,Status:'OK'}]}})}
 if(p.endsWith('/assign')){const body=route.request().postDataJSON();writes.push(body);Object.assign(rows.find(x=>x.ItemID===Number(p.split('/').at(-2)))!,{PICUserID:body.PICUserID,PIC:'PIC',ItemRowVersion:'AAAAAAAAAAI='});return route.fulfill({json:{result:{RowVersion:'AAAAAAAAAAI='}}})}
 return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Requests',exact:true}).click();
 return writes;
}
test('header editor saves multiple responses; Item View owns review controls',async({page})=>{
 const writes=await setup(page);
 await page.getByRole('button',{name:'View request',exact:true}).click();
 const table=page.getByRole('table',{name:'Packaging request items'});
 await expect(table.getByRole('combobox')).toHaveCount(2);
 await expect(table.getByRole('button',{name:'Cancel request item 1',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'});
 for(const id of [1,2])await editor.getByRole('region',{name:'Request item '+id,exact:true}).getByLabel('No of Primary Unit',{exact:true}).fill(String(id+10));
 await expect(editor.getByRole('region',{name:'Request item 3',exact:true}).getByLabel('No of Primary Unit',{exact:true})).toBeDisabled();
 await editor.getByRole('button',{name:'Review & save'}).click();expect(writes).toHaveLength(0);
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('2 item(s) saved.');
 expect(writes.map(w=>w.rows[0].ID)).toEqual([1,2]);
 expect(writes[1].rows[0]).toMatchObject({UnitsPerCarton:'12',RowVersion:'AAAAAAAAAAE='});
});
test('response types use order-filtered master dropdowns and retired fields are absent',async({page})=>{
 const writes=await setup(page);await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'});
 const item=editor.getByRole('region',{name:'Request item 1',exact:true});
 const primary=item.getByLabel('Primary Type',{exact:true}),secondary=item.getByLabel('Secondary Type',{exact:true});
 await expect(primary.locator('option')).toHaveText(['Choose primary type','Film']);
 await expect(secondary.locator('option')).toHaveText(['Choose secondary type','Carton']);
 await expect(item.getByLabel('Pallet type',{exact:true})).toHaveCount(0);
 await expect(item.getByLabel('PM cost (VND)',{exact:true})).toHaveCount(0);
 await expect(item.getByLabel('Packaging description',{exact:true})).toHaveCount(0);
 await primary.selectOption('Film');await secondary.selectOption('Carton');
 await editor.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved.');
 expect(writes[0].rows[0]).toMatchObject({FirstPMType:'Film',SecondPMType:'Carton'});
 for(const key of ['PalletType','Cost','CurrencyID'])expect(writes[0].rows[0]).not.toHaveProperty(key);
 expect(writes[0].rows[0]).not.toHaveProperty('PackagingDescription');
});

test('responses group primary, secondary and palletization fields; PIC stays beside item status',async({page})=>{
 await setup(page);
 await page.route('**/api/packaging/requests?**',r=>r.fulfill({json:{rows:[{RequestID:1,ItemID:1,ProductCode:'P1',ProductName:'Product 1',ItemStage:'Assigned',PIC:'Admin',PICUserID:1,ItemRowVersion:'AAAAAAAAAAE=',PackagingDescription:'Historical description'}],total:1}}));
 await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'}),item=editor.getByRole('region',{name:'Request item 1',exact:true});
 const header=item.locator('header');
 await expect(header.getByLabel('PIC for item 1',{exact:true})).toHaveCount(1);
 await expect(header.getByText('PIC: Admin',{exact:true})).toBeVisible();
 await expect(header.getByText('Assigned',{exact:true})).toBeVisible();
 const primary=item.getByRole('region',{name:'Primary packaging response',exact:true});
 const secondary=item.getByRole('region',{name:'Secondary packaging response',exact:true});
 const pallet=item.getByRole('region',{name:'Palletization response',exact:true});
 const packing=item.getByRole('region',{name:'Packing Way response',exact:true});
 await expect(packing.getByLabel('No of Primary Unit',{exact:true})).toBeVisible();
 await expect(packing.getByLabel('No of Secondary Unit',{exact:true})).toHaveValue('1');
 await expect(packing.getByLabel('No of Secondary Unit',{exact:true})).toHaveAttribute('readonly','');
 for(const label of ['Primary Type','Primary MOQ unit','Primary price per unit'])await expect(primary.getByLabel(label,{exact:true})).toBeVisible();
 for(const label of ['Secondary Type','Secondary MOQ unit','Secondary price per unit'])await expect(secondary.getByLabel(label,{exact:true})).toBeVisible();
 for(const label of ['Pallet','Pallet stacking','Max pallet height (mm)','Cartons / layer','Layers / pallet','Units / pallet'])await expect(pallet.getByLabel(label,{exact:true})).toBeVisible();
 const load=item.getByRole('region',{name:'Container Load response',exact:true});
 for(const label of ['Pallet / Container','Carton / Container','Net weight / Container (kg)'])await expect(load.getByLabel(label,{exact:true})).toBeVisible();
 await expect(item.getByLabel('Packaging description',{exact:true})).toHaveCount(0);
 await expect(editor.getByRole('button',{name:'Review & save'})).toBeDisabled();
});

test('requested type labels and all recent requirements display; empty responses default from the request snapshot',async({page})=>{
 await page.setViewportSize({width:1920,height:1080});
 const writes=await setup(page);
 const itemReads:URL[]=[];
 await page.route('**/api/packaging/requests?**',r=>{
  const url=new URL(r.request().url());itemReads.push(url);
  // The legacy, unsorted SQL read omits the new requirement snapshot fields.
  const snapshots=url.searchParams.has('sort')?{PrimaryTypeID:1,PrimaryTypeName:'Film',SecondaryTypeID:2,SecondaryTypeName:'Carton',SecondaryTransparency:'Opaque',NumberOfPrimary:24}:{};
  return r.fulfill({json:{rows:[{RequestID:1,ItemID:1,ProductCode:'P1',ItemStage:'Assigned',PIC:'Admin',PICUserID:1,ItemRowVersion:'AAAAAAAAAAE=',...snapshots,Transparency:'Transparent',ShelfLifeDays:365,ProductShelfLifeDays:180,ContainerRequest:'Reefer',ConfigurationRequest:'Both',PalletSize:'1.1x1.1M',PalletStacking:'Double',MaxPalletHeightM:'1.8',RecyclableRequirement:'Yes',RecycledContent:'20%',MetalizedAluminum:'NA',SpecialComments:'Keep cold'}],total:1}});
 });
 await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'}),item=editor.getByRole('region',{name:'Request item 1',exact:true});
 await item.getByText('Packaging request',{exact:true}).click();
 const primary=item.getByRole('region',{name:'Primary packaging requirements',exact:true}),secondary=item.getByRole('region',{name:'Secondary packaging requirements',exact:true});
 await expect(primary.getByText('Requested Primary Type',{exact:true})).toBeVisible();
 await expect(secondary.getByText('Requested Secondary Type',{exact:true})).toBeVisible();
 await expect(primary.getByText('Film',{exact:true})).toBeVisible();
 await expect(secondary.getByText('Carton',{exact:true})).toBeVisible();
 await expect(primary.getByText('Transparent',{exact:true})).toBeVisible();
 await expect(secondary.getByText('Secondary Transparent / opaque',{exact:true})).toBeVisible();
 await expect(secondary.getByText('Opaque',{exact:true})).toBeVisible();await expect(primary.getByText('24',{exact:true})).toBeVisible();
 expect(itemReads[0].searchParams.get('sort')).toBe('[]');
 expect(itemReads[0].searchParams.get('request_id')).toBe('1');
 expect(itemReads[0].searchParams.get('page')).toBe('1');
 expect(itemReads[0].searchParams.get('page_size')).toBe('25');
 for(const shelf of await item.getByLabel('Shelf life (days)',{exact:true}).all())await expect(shelf).toHaveValue('365');
 for(const text of ['Reefer','Both','1.1x1.1M','Double','1800','Yes','20%','NA','Keep cold'])await expect(item.locator('.requirement-sections').first().getByText(text,{exact:true})).toBeVisible();
 await expect(item.getByLabel('Primary Type',{exact:true})).toHaveValue('Film');
 await expect(item.getByLabel('Secondary Type',{exact:true})).toHaveValue('Carton');
 expect(writes).toHaveLength(0);
 // Both loading requires a selected container and manually entered capacity.
 await item.getByLabel('Container type',{exact:true}).selectOption('20RC');
 await item.getByLabel('Carton / Container',{exact:true}).fill('100');
 await editor.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0].rows[0]).toMatchObject({FirstPMType:'Film',SecondPMType:'Carton'});
 for(const key of ['PrimaryTypeID','PrimaryTypeName','SecondaryTransparency','NumberOfPrimary'])expect(writes[0].rows[0]).not.toHaveProperty(key);
});

test('requested defaults do not overwrite saved responses or make read-only items dirty',async({page})=>{
 await setup(page);
 await page.route('**/api/packaging/requests?**',r=>r.fulfill({json:{rows:[{RequestID:1,ItemID:1,ProductCode:'P1',ItemStage:'Assigned',PIC:'Admin',PICUserID:1,ItemRowVersion:'AAAAAAAAAAE=',PrimaryTypeName:'Requested film',SecondaryTypeName:'Requested carton',FirstPMType:'Film',SecondPMType:'Carton'},{RequestID:1,ItemID:2,ProductCode:'P2',ItemStage:'Approved',PrimaryTypeName:'Film',SecondaryTypeName:'Carton',ItemRowVersion:'AAAAAAAAAAE='}],total:2}}));
 await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'}),item=editor.getByRole('region',{name:'Request item 1',exact:true});
 await expect(item.getByLabel('Primary Type',{exact:true})).toHaveValue('Film');
 await expect(item.getByLabel('Secondary Type',{exact:true})).toHaveValue('Carton');
 const locked=editor.getByRole('region',{name:'Request item 2',exact:true});
 await expect(locked.getByLabel('Primary Type',{exact:true})).toBeDisabled();
 await expect(locked.getByLabel('Primary Type',{exact:true})).toHaveValue('');
 await expect(editor.getByRole('button',{name:'Review & save'})).toBeDisabled();
});

for(const snapshot of [null,0]){
 test('request shelf life preserves '+(snapshot===null?'a missing historical snapshot':'a zero-day snapshot')+' instead of using current Product Master',async({page})=>{
  await setup(page);
  await page.route('**/api/packaging/requests?**',r=>r.fulfill({json:{rows:[{RequestID:1,ItemID:1,ProductCode:'P1',ItemStage:'Approved',ShelfLifeDays:snapshot,ProductShelfLifeDays:180,ItemRowVersion:'AAAAAAAAAAE='}],total:1}}));
  await page.getByRole('button',{name:'Edit request PCR-1'}).click();
  const editor=page.getByRole('dialog',{name:'Edit Packaging request'}),item=editor.getByRole('region',{name:'Request item 1',exact:true});
  await item.getByText('Packaging request',{exact:true}).click();
  const fields=item.getByLabel('Shelf life (days)',{exact:true});
  await expect(fields).toHaveCount(1);
  for(const field of await fields.all()){await expect(field).toHaveValue(snapshot===null?'':'0');await expect(field).toHaveAttribute('readonly','')}
  await expect(editor.getByRole('button',{name:'Review & save'})).toBeDisabled();
 });
}

test('each response type defaults independently and user can clear a default before saving',async({page})=>{
 const writes=await setup(page);
 await page.route('**/api/packaging/requests?**',r=>r.fulfill({json:{rows:[{RequestID:1,ItemID:1,ProductCode:'P1',ItemStage:'Assigned',PIC:'Admin',PICUserID:1,ItemRowVersion:'AAAAAAAAAAE=',PrimaryTypeName:'Requested film',SecondaryTypeName:'Carton',FirstPMType:'Saved film',SecondPMType:null}],total:1}}));
 await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'});
 await expect(editor.getByLabel('Primary Type',{exact:true})).toHaveValue('Saved film');
 await expect(editor.getByLabel('Secondary Type',{exact:true})).toHaveValue('Carton');
 await editor.getByLabel('Secondary Type',{exact:true}).selectOption('');
 await editor.getByLabel('No of Primary Unit',{exact:true}).fill('12');
 await expect(editor.getByLabel('Secondary Type',{exact:true})).toHaveValue('');
 await editor.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0].rows[0]).toMatchObject({FirstPMType:'Saved film',SecondPMType:null});
});

test('unavailable requested default is shown but must be replaced with an active type before saving',async({page})=>{
 const writes=await setup(page);
 await page.route('**/api/packaging/requests?**',r=>r.fulfill({json:{rows:[{RequestID:1,ItemID:1,ProductCode:'P1',ItemStage:'Assigned',PIC:'Admin',PICUserID:1,ItemRowVersion:'AAAAAAAAAAE=',PrimaryTypeName:'Retired film'}],total:1}}));
 await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'}),primary=editor.getByLabel('Primary Type',{exact:true});
 await expect(primary).toHaveValue('Retired film');
 await expect(primary.locator('option[value="Retired film"]')).toHaveAttribute('disabled','');
 await editor.getByRole('button',{name:'Review & save'}).click();
 await expect(editor.getByRole('alert')).toContainText('Choose an active Primary Type');
 expect(writes).toHaveLength(0);
 await primary.selectOption('Film');await editor.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0].rows[0].FirstPMType).toBe('Film');
});
test('an unavailable historical type survives unrelated edits',async({page})=>{
 const writes=await setup(page);
 await page.route('**/api/packaging/requests?**',r=>r.fulfill({json:{rows:[{RequestID:1,ItemID:1,ProductCode:'P1',ItemStage:'Assigned',PIC:'Admin',PICUserID:1,ItemRowVersion:'AAAAAAAAAAE=',FirstPMType:'Old film',Cost:500,CurrencyID:2,CostBasis:'per pack'}],total:1}}));
 await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'});
 const primary=editor.getByLabel('Primary Type',{exact:true});
 await expect(primary).toHaveValue('Old film');
 await expect(primary.locator('option[value="Old film"]')).toHaveAttribute('disabled','');
 await editor.getByLabel('No of Primary Unit',{exact:true}).fill('13');
 await editor.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved.');
 expect(writes[0].rows[0]).toMatchObject({FirstPMType:'Old film',UnitsPerCarton:'13'});
 expect(writes[0].rows[0]).not.toHaveProperty('Cost');
});
test('submitting from the request editor shows a top success notification',async({page})=>{
 await setup(page);
 let submitted=false;
 await page.route('**/api/packaging/items/1/transition',route=>{
  submitted=true;return route.fulfill({json:{result:{Stage:'Pending Review'}}});
 });
 await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'});
 await editor.getByRole('button',{name:'Submit 1',exact:true}).click();
 await page.getByRole('dialog',{name:'Confirm response action'}).getByRole('button',{name:'Confirm',exact:true}).click();
 const notice=editor.locator('.floating-notification.success');
 await expect(notice).toContainText('Item group updated successfully.');
 expect(submitted).toBe(true);
 expect((await notice.boundingBox())!.y).toBeLessThan(30);
});

test('partial save preserves failed draft and never resends successful items',async({page})=>{
 const writes=await setup(page,true);await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'});
 for(const id of [1,2])await editor.getByRole('region',{name:'Request item '+id,exact:true}).getByLabel('No of Primary Unit',{exact:true}).fill(String(id+10));
 await editor.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.locator('.floating-notification.error')).toContainText('Conflict');
 await expect(editor.locator('.floating-notification.warning')).toContainText('Some changes were not saved');
 await expect(editor.getByRole('region',{name:'Request item 2',exact:true}).getByLabel('No of Primary Unit',{exact:true})).toHaveValue('12');
 await editor.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(3);expect(writes.map(w=>w.rows[0].ID)).toEqual([1,2,2]);
});
test('Item View reassignment removes the former non-Admin PIC response edit access',async({page})=>{
 const writes=await setup(page,false,{is_admin:false,scopes:['Packaging','PackagingManager'],can_assign_packaging:true});await page.getByRole('button',{name:'View request',exact:true}).click();
 await page.getByLabel('PIC for item 1',{exact:true}).selectOption('2');
 await page.getByRole('button',{name:'Assign PIC for item 1',exact:true}).click();
 await expect(page.getByLabel('PIC for item 1',{exact:true})).toHaveValue('2');
 await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'});
 await expect(editor.getByLabel('PIC for item 1',{exact:true})).toHaveValue('2');
 await expect(editor.getByRole('region',{name:'Request item 1',exact:true}).getByLabel('No of Primary Unit',{exact:true})).toBeDisabled();
 expect(writes).toEqual([{PICUserID:2,ExpectedRowVersion:'AAAAAAAAAAE='}]);
});
test('pagination retains drafts and canceling discard keeps the editor open',async({page})=>{
 await setup(page,false,{},1);
 await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'});
 const field=editor.getByRole('region',{name:'Request item 1',exact:true}).getByLabel('No of Primary Unit',{exact:true});
 await field.fill('15');page.on('dialog',d=>d.dismiss());
 await editor.getByRole('button',{name:'Next',exact:true}).click();
 await editor.getByRole('button',{name:'Previous',exact:true}).click();
 await expect(field).toHaveValue('15');
 await editor.getByRole('button',{name:'Close request editor',exact:true}).click();
 await expect(field).toHaveValue('15');
});

test('unknown save outcome prevents duplicate retries',async({page})=>{
 await setup(page);
 await page.route('**/api/packaging/response/batch',r=>r.fulfill({status:503,json:{detail:'Response lost'}}));
 await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'});
 await editor.getByRole('region',{name:'Request item 1',exact:true}).getByLabel('No of Primary Unit',{exact:true}).fill('16');
 await editor.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByText('Save outcome uncertain. Close and refresh before making further changes.')).toBeVisible();
 await expect(editor.getByRole('button',{name:'Review & save'})).toBeDisabled();
 await expect(editor.getByRole('region',{name:'Request item 1',exact:true}).getByLabel('No of Primary Unit',{exact:true})).toHaveValue('16');
});
test('request editor fits a mobile viewport',async({page})=>{
 await setup(page);await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'});
 await expect(editor.getByRole('region',{name:'Request item 1',exact:true})).toBeVisible();
 expect(await editor.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
});

test('density restores, calculates volume live from snapshot weight and saves only the input',async({page})=>{
 const writes=await setup(page);
 await page.route('**/api/packaging/requests?**',r=>r.fulfill({json:{rows:[{RequestID:1,ItemID:1,ProductCode:'P1',ItemStage:'Assigned',PIC:'Admin',PICUserID:1,ItemRowVersion:'AAAAAAAAAAE=',WeightGrams:'150.00',NutDensity:'0.600000',UsedVolumeML:'250.000000',ProductWeightGrams:300}],total:1}}));
 await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'});
 const primary=editor.getByRole('region',{name:'Primary packaging response',exact:true});
 const product=editor.getByRole('region',{name:'Product Info response',exact:true});
 const density=product.getByLabel('Nut Density (g/ml)',{exact:true}),volume=product.getByLabel('Used volume (ml)',{exact:true});
 await expect(density).toHaveValue('0.6');await expect(volume).toHaveValue('250');
 await expect(volume).toHaveAttribute('readonly','');
 await expect(editor.getByRole('button',{name:'Review & save'})).toBeDisabled();
 await density.fill('0.75');await expect(volume).toHaveValue('200');
 await editor.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0].rows[0]).toMatchObject({NutDensity:'0.75',RowVersion:'AAAAAAAAAAE='});
 for(const key of ['UsedVolumeML','WeightGrams','PackagingDescription'])expect(writes[0].rows[0]).not.toHaveProperty(key);
});

test('density rejects zero, negative and excessive precision; blank density clears volume',async({page})=>{
 const writes=await setup(page);
 await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'}),item=editor.getByRole('region',{name:'Request item 1',exact:true});
 const density=item.getByLabel('Nut Density (g/ml)',{exact:true}),volume=item.getByLabel('Used volume (ml)',{exact:true});
 for(const invalid of ['0','-0.5','0.1234567','Infinity','1000000000000']){
  await density.fill(invalid);await expect(volume).toHaveValue('');
  await editor.getByRole('button',{name:'Review & save'}).click();
  await expect(editor.getByRole('alert')).toContainText('Nut Density');
  expect(writes).toHaveLength(0);
 }
 await density.fill('0.000001');await expect(volume).toHaveValue('10,000,000');
 await density.fill('');await expect(volume).toHaveValue('');
 await expect(editor.getByRole('region',{name:'Request item 3',exact:true}).getByLabel('Nut Density (g/ml)',{exact:true})).toBeDisabled();
});
