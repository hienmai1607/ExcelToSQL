import {test,expect,type Page} from '@playwright/test';
const rv='AAAAAAAAAAE=';

test('edit places names, orders and flags in three rows and fits on mobile',async({page})=>{
 await setup(page);await open(page);
 await page.getByRole('button',{name:'Edit packaging type 1'}).click();
 const form=page.getByRole('dialog',{name:'Edit packaging type',exact:true});
 const parent=await form.getByLabel('Parent Type',{exact:true}).boundingBox();
 const name=await form.getByLabel('Packaging Type',{exact:true}).boundingBox();
 expect(Math.abs(parent!.y-name!.y)).toBeLessThanOrEqual(2);
 expect(parent!.x+parent!.width).toBeLessThan(name!.x);
 const orders=await Promise.all(['Primary','Secondary','Tertiary'].map(o=>form.getByRole('checkbox',{name:o+' order',exact:true}).boundingBox()));
 expect(Math.max(...orders.map(o=>o!.y))-Math.min(...orders.map(o=>o!.y))).toBeLessThanOrEqual(2);
 expect(orders[0]!.y).toBeGreaterThan(name!.y+name!.height);
 const flags=await Promise.all(['FinalComponent','CopyDim','Shipping'].map(key=>form.locator('[data-field="'+key+'"]').boundingBox()));
 expect(Math.max(...flags.map(o=>o!.y))-Math.min(...flags.map(o=>o!.y))).toBeLessThanOrEqual(2);
 expect(flags[0]!.y).toBeGreaterThan(orders[0]!.y);
 expect(flags[0]!.x).toBeLessThan(flags[1]!.x);expect(flags[1]!.x).toBeLessThan(flags[2]!.x);
 for(const label of ['Single','Copy Dim.','Shipping']){
  const checkbox=form.getByRole('checkbox',{name:label,exact:true});
  expect(await checkbox.evaluate(input=>{const label=input.closest('label')!,a=input.getBoundingClientRect(),b=label.getBoundingClientRect();return getComputedStyle(label).flexDirection==='row'&&getComputedStyle(input).order==='-1'&&Math.abs(a.top+a.height/2-b.top-b.height/2)<2})).toBe(true);
 }
 for(let i=0;i<flags.length;i++)expect(Math.abs(flags[i]!.x-orders[i]!.x)).toBeLessThanOrEqual(2);
 const status=await form.getByLabel('Status',{exact:true}).boundingBox();
 expect(Math.abs(status!.y+status!.height/2-flags[0]!.y-flags[0]!.height/2)).toBeLessThanOrEqual(2);
 expect(status!.x).toBeGreaterThan(flags[2]!.x);
 const primary=form.locator('.packaging-order-option').first();
 expect(await primary.evaluate(el=>getComputedStyle(el).flexDirection)).toBe('row');
 await page.setViewportSize({width:390,height:844});
 expect(await form.evaluate(el=>el.scrollWidth<=el.clientWidth+2)).toBeTruthy();
});

test('Copy Dim. follows Single, is conditional, and clears when Single is unticked',async({page})=>{
 await setup(page);await open(page);await page.getByRole('button',{name:'New packaging type',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New packaging type',exact:true});
 const single=form.getByRole('checkbox',{name:'Single',exact:true}),copy=form.getByRole('checkbox',{name:'Copy Dim.',exact:true}),shipping=form.getByRole('checkbox',{name:'Shipping',exact:true});
 await expect(copy).toBeDisabled();await single.check();await expect(copy).toBeEnabled();await copy.check();
 await expect(form.getByLabel('Parent Type',{exact:true})).toBeDisabled();
 const a=await single.boundingBox(),b=await copy.boundingBox(),c=await shipping.boundingBox();
 expect(a!.x).toBeLessThan(b!.x);expect(b!.x).toBeLessThan(c!.x);expect(Math.abs(a!.y-b!.y)).toBeLessThan(2);
 await single.uncheck();await expect(copy).not.toBeChecked();await expect(copy).toBeDisabled();
 await expect(form.getByLabel('Parent Type',{exact:true})).toBeEnabled();
 await single.check();await form.getByLabel('Parent Type',{exact:true}).selectOption('2');
 await expect(copy).toBeDisabled();
 await form.getByLabel('Parent Type',{exact:true}).selectOption('');await expect(copy).toBeEnabled();
});

test('type form uses three horizontal rows without Order and Price Basis captions',async({page})=>{
 const state=await setup(page);await open(page);
 await page.getByRole('button',{name:'New packaging type',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New packaging type',exact:true});
 await expect(form.getByText('Order',{exact:true})).toHaveCount(0);
 await expect(form.getByLabel('Price Basis',{exact:true})).toHaveCount(0);
 await form.getByRole('checkbox',{name:'Primary order',exact:true}).check();
 await form.getByLabel('Packaging Type',{exact:true}).fill('Ready pouch');
 await form.getByRole('checkbox',{name:'Single',exact:true}).check();
 const name=await form.getByLabel('Packaging Type',{exact:true}).boundingBox();
 const shipping=await form.getByRole('checkbox',{name:'Shipping',exact:true}).boundingBox();
 expect(shipping!.y).toBeGreaterThan(name!.y);
 await form.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(state.writes[0].rows[0]).toMatchObject({ParentTypeID:null,FinalComponent:true,Shipping:false,PackagingType:'Ready pouch'});
 expect(state.writes[0].rows[0]).not.toHaveProperty('PriceBasis');
});
test('Shipping is editable for roots and cleared when assigning a parent',async({page})=>{
 const state=await setup(page);await open(page);
 await expect(page.getByRole('button',{name:'Sort by Shipping',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Edit packaging type 1'}).click();
 const shipping=page.getByRole('checkbox',{name:'Shipping',exact:true});
 await shipping.check();await page.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].rows[0].Shipping).toBe(true);
 await page.getByRole('button',{name:'Edit packaging type 1'}).click();await shipping.check();
 await page.getByLabel('Parent Type',{exact:true}).selectOption('2');await expect(shipping).toHaveCount(0);
 await page.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(state.writes[1].rows[0]).toMatchObject({ParentTypeID:2,Shipping:false});
});
async function setup(page:Page,scope='Admin',parent:number|null=null,legacyLayout=false){
 const writes:any[]=[],exports:any[]=[];
 const types=[
  {ID:1,PackagingOrder:'Primary',PackagingType:'Pouch',Status:'Active',ParentTypeID:parent},
  {ID:2,PackagingOrder:'Secondary',PackagingType:'Group',Status:'Active',ParentTypeID:null},
  {ID:3,PackagingOrder:'Primary',PackagingType:'Child',Status:'Active',ParentTypeID:1},
  {ID:4,PackagingOrder:'Primary',PackagingType:'Grandchild',Status:'Active',ParentTypeID:3},
  {ID:5,PackagingOrder:'Secondary',PackagingType:'Old group',Status:'Block',ParentTypeID:null}
 ];
 let profile:any={settings:{columns:['CustomerName'],filters:[],customer_name:'',market_id:'',status:'',page_size:25,dark:false,nav_hidden:false,masters:{}},version:0};
 if(legacyLayout)profile.settings.masters['packaging-types']={columns:['PackagingOrder','TareWeight','PackagingType','PriceBasis'],filters:['search','status'],values:{},sort:[{column:'TareWeight',direction:'desc'}],column_widths:{TareWeight:200},page_size:25};
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{user_id:1,username:'Tester',scopes:[scope],is_admin:scope==='Admin'}});
  if(path.endsWith('/preferences')){if(route.request().method()==='POST')profile={settings:route.request().postDataJSON().settings,version:profile.version+1};return route.fulfill({json:profile})}
  if(path==='/api/workbench/masters/lookups')return route.fulfill({json:{materials:[],currencies:[],creators:[],packagingTypes:types}});
  if(path==='/api/workbench/masters/packaging-types')return route.fulfill({json:{rows:[{...types[0],ParentType:parent?'Secondary / '+(parent===5?'Old group':'Group'):null,PriceBasis:'Count',TareWeight:'1234.123',RowVersion:rv}],total:1,page:1}});
  if(path==='/api/packaging/type/batch'){const body=route.request().postDataJSON();writes.push(body);return route.fulfill({json:{results:body.rows.map((r:any)=>({RowNum:r.RowNum,Status:'OK'}))}})}
  if(path==='/api/workbench/masters/packaging-types/export'){exports.push(route.request().postDataJSON());return route.fulfill({body:Buffer.from('mock'),contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})}
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 return {writes,exports,profile:()=>profile};
}
async function open(page:Page){
 await page.getByRole('button',{name:'Packaging Type Master',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Packaging Type Master',exact:true})).toBeVisible();
 await expect(page.getByRole('cell',{name:'Pouch',exact:true})).toBeVisible();
}
test('Packaging maintains types without tare weight',async({page})=>{
 const state=await setup(page,'Packaging');await open(page);
 await expect(page.getByRole('cell',{name:'1,234.123',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'New packaging type',exact:true}).click();
 await expect(page.getByRole('group',{name:'Packaging orders'}).getByRole('checkbox')).toHaveCount(4);
 await expect(page.getByLabel('Price Basis',{exact:true})).toHaveCount(0);
 await page.getByRole('checkbox',{name:'Primary order',exact:true}).check();
 await expect(page.getByLabel('Tare weight (g)',{exact:true})).toHaveCount(0);
 await page.getByLabel('Packaging Type',{exact:true}).fill('Film');
 await page.getByRole('button',{name:'Review & save',exact:true}).click();expect(state.writes).toHaveLength(0);
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].rows[0]).toEqual({RowNum:1,Command:'C',ID:null,RowVersion:null,ParentTypeID:null,PackagingOrders:['Primary'],PackagingType:'Film',Shipping:false,FinalComponent:false,CopyDim:false});
});

test('one type can support all three orders and persist the selected set',async({page})=>{
 const state=await setup(page);await open(page);await page.getByRole('button',{name:'Edit packaging type 1'}).click();
 await expect(page.getByRole('checkbox',{name:'Primary order',exact:true})).toBeChecked();
 await page.getByRole('checkbox',{name:'Secondary order',exact:true}).check();
 await page.getByRole('checkbox',{name:'Tertiary order',exact:true}).check();
 await page.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].rows[0].PackagingOrders).toEqual(['Primary','Secondary','Tertiary']);
 expect(state.writes[0].rows[0]).not.toHaveProperty('PackagingOrder');
});
test('only layer selection and type name are required',async({page})=>{
 const state=await setup(page);await open(page);await page.getByRole('button',{name:'New packaging type',exact:true}).click();
 await page.getByRole('button',{name:'Review & save',exact:true}).click();await expect(page.getByText('Required.',{exact:true})).toHaveCount(2);
 await page.getByRole('checkbox',{name:'Primary order',exact:true}).uncheck();await page.getByRole('checkbox',{name:'Secondary order',exact:true}).check();await page.getByLabel('Packaging Type',{exact:true}).fill('Carton');
 await page.getByRole('button',{name:'Review & save',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Confirm master save'})).toBeVisible();
 expect(state.writes).toHaveLength(0);
});
test('edit preserves RowVersion without sending retired tare weight',async({page})=>{
 const state=await setup(page);await open(page);await page.getByRole('button',{name:'Edit packaging type 1'}).click();
 await expect(page.getByLabel('Tare weight (g)',{exact:true})).toHaveCount(0);
 await page.getByRole('checkbox',{name:'Primary order',exact:true}).uncheck();await page.getByRole('checkbox',{name:'Secondary order',exact:true}).check();
 await page.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].rows[0]).toMatchObject({Command:'U',ID:1,RowVersion:rv,PackagingOrders:['Secondary'],Status:'Active'});
 expect(state.writes[0].rows[0]).not.toHaveProperty('TareWeight');
});
test('PackagingManager has read-only access',async({page})=>{
 await setup(page,'PackagingManager');await open(page);
 await expect(page.getByText('Read only',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'New packaging type',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Edit packaging type 1'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Excel local template'})).toHaveCount(1);
});
test('unrelated roles cannot navigate to the section',async({page})=>{
 await setup(page,'Opportunity');await expect(page.getByRole('button',{name:'Packaging Type Master',exact:true})).toHaveCount(0);
});
test('retired tare column is removed from old profiles, exports and layout options',async({page})=>{
 const state=await setup(page,'PackagingManager',null,true);await open(page);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Excel local template'}).click();await download;
 expect(state.exports[0].columns).not.toContain('TareWeight');
 await expect(page.getByRole('button',{name:'Sort by Tare weight (g)',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Layout options'}).click();await page.getByRole('button',{name:'Move Packaging Type left'}).click();await page.getByRole('button',{name:'Save layout to profile'}).click();
 await expect(page.getByRole('status')).toContainText('saved');
 expect(state.profile().settings.masters['packaging-types'].sort).toEqual([]);
 expect(state.profile().settings.masters['packaging-types'].column_widths).not.toHaveProperty('TareWeight');
 await expect(page.getByText('Tare weight (g)',{exact:true})).toHaveCount(0);
 expect(state.profile().settings.masters['packaging-types'].columns.slice(0,2)).toEqual(['PackagingType','PackagingOrder']);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('new type can select a parent from either order',async({page})=>{
 const state=await setup(page);await open(page);
 await expect(page.getByRole('button',{name:'Sort by Parent Type',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'New packaging type',exact:true}).click();
 const select=page.getByLabel('Parent Type',{exact:true});
 await expect(select.locator('option')).toHaveText(['None (root type)','Pouch','Group','Child','Grandchild']);
 await select.selectOption('2');
 await expect(page.getByRole('group',{name:'Packaging orders'})).toHaveCount(0);await page.getByLabel('Packaging Type',{exact:true}).fill('Film');

 await page.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(state.writes[0].rows[0].ParentTypeID).toBe(2);expect(state.writes[0].rows[0]).not.toHaveProperty('PackagingOrders');
});

test('parent dropdown removes self, descendants and unavailable choices and clears assignment',async({page})=>{
 const state=await setup(page,'Admin',2);await open(page);
 await expect(page.getByRole('cell',{name:'Group',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Edit packaging type 1'}).click();
 const select=page.getByLabel('Parent Type',{exact:true});await expect(select).toHaveValue('2');
 await expect(select.locator('option[value="1"]')).toHaveCount(0);
 for(const id of [3,4])await expect(select.locator('option[value="'+id+'"]')).toHaveCount(0);
 await expect(select.locator('option[value="5"]')).toHaveCount(0);
 await select.selectOption('');await page.getByRole('checkbox',{name:'Primary order',exact:true}).check();await page.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].rows[0]).toMatchObject({ParentTypeID:null,RowVersion:rv});
});

test('unchanged blocked parent remains visible and saves with other edits',async({page})=>{
 const state=await setup(page,'Admin',5);await open(page);await page.getByRole('button',{name:'Edit packaging type 1'}).click();
 const select=page.getByLabel('Parent Type',{exact:true});await expect(select).toHaveValue('5');
 await expect(select.locator('option[value="5"]')).toHaveText('Old group (Blocked)');
 await page.getByLabel('Packaging Type',{exact:true}).fill('Renamed pouch');
 await page.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(state.writes[0].rows[0].ParentTypeID).toBe(5);
});

test('existing child has a blank Order cell and updates without sending orders',async({page})=>{
 const state=await setup(page,'Admin',2);await open(page);
 const row=page.getByRole('row').filter({has:page.getByRole('button',{name:'Edit packaging type 1'})});
 await expect(row.getByRole('cell',{name:'Primary',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Edit packaging type 1'}).click();
 await expect(page.getByRole('group',{name:'Packaging orders'})).toHaveCount(0);
 await page.getByLabel('Packaging Type',{exact:true}).fill('Renamed child');
 await page.getByRole('button',{name:'Review & save',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Confirm master save'})).toContainText('Renamed child');
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].rows[0]).toMatchObject({Command:'U',ID:1,ParentTypeID:2,RowVersion:rv,PackagingType:'Renamed child'});
 expect(state.writes[0].rows[0]).not.toHaveProperty('PackagingOrders');
 expect(state.writes[0].rows[0]).not.toHaveProperty('PackagingOrder');
});

test('switching root to child hides orders and nested child needs only name and basis',async({page})=>{
 const state=await setup(page);await open(page);
 await page.getByRole('button',{name:'New packaging type',exact:true}).click();
 await page.getByRole('checkbox',{name:'Primary order',exact:true}).check();
 await page.getByLabel('Parent Type',{exact:true}).selectOption('3');
 await expect(page.getByRole('group',{name:'Packaging orders'})).toHaveCount(0);
 await page.getByRole('button',{name:'Review & save',exact:true}).click();
 await expect(page.getByText('Required.',{exact:true})).toHaveCount(1);
await page.getByLabel('Parent Type',{exact:true}).selectOption('');
 await expect(page.getByRole('checkbox',{name:'Primary order',exact:true})).toBeChecked();
 await page.getByLabel('Parent Type',{exact:true}).selectOption('3');
 await page.getByLabel('Packaging Type',{exact:true}).fill('Nested film');

 await page.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].rows[0]).toMatchObject({ParentTypeID:3,PackagingType:'Nested film',FinalComponent:false});
 expect(state.writes[0].rows[0]).not.toHaveProperty('PackagingOrders');
});
