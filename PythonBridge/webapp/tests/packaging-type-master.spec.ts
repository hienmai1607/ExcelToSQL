import {test,expect,type Page} from '@playwright/test';
const rv='AAAAAAAAAAE=';
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
 await expect(page.getByRole('group',{name:'Packaging orders'}).getByRole('checkbox')).toHaveCount(3);
 await expect(page.getByLabel('Price Basis',{exact:true}).locator('option')).toHaveText(['Choose price basis','Count','Square meter','Volume']);
 await page.getByRole('checkbox',{name:'Primary order',exact:true}).check();
 await expect(page.getByLabel('Tare weight (g)',{exact:true})).toHaveCount(0);
 await page.getByLabel('Packaging Type',{exact:true}).fill('Film');await page.getByLabel('Price Basis',{exact:true}).selectOption('Square meter');
 await page.getByRole('button',{name:'Review & save',exact:true}).click();expect(state.writes).toHaveLength(0);
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].rows[0]).toEqual({RowNum:1,Command:'C',ID:null,RowVersion:null,ParentTypeID:null,PackagingOrders:['Primary'],PackagingType:'Film',PriceBasis:'Square meter',Shipping:false});
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
test('only three required inputs remain',async({page})=>{
 const state=await setup(page);await open(page);await page.getByRole('button',{name:'New packaging type',exact:true}).click();
 await page.getByRole('button',{name:'Review & save',exact:true}).click();await expect(page.getByText('Required.',{exact:true})).toHaveCount(3);
 await page.getByRole('checkbox',{name:'Primary order',exact:true}).uncheck();await page.getByRole('checkbox',{name:'Secondary order',exact:true}).check();await page.getByLabel('Packaging Type',{exact:true}).fill('Carton');await page.getByLabel('Price Basis',{exact:true}).selectOption('Volume');
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
 await expect(page.getByRole('button',{name:'Excel Local Update'})).toHaveCount(0);
});
test('unrelated roles cannot navigate to the section',async({page})=>{
 await setup(page,'Opportunity');await expect(page.getByRole('button',{name:'Packaging Type Master',exact:true})).toBeDisabled();
});
test('retired tare column is removed from old profiles, exports and layout options',async({page})=>{
 const state=await setup(page,'Admin',null,true);await open(page);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export current page to Excel'}).click();await download;
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
 await expect(select.locator('option')).toHaveText(['None (root type)','Primary / Pouch','Secondary / Group','Child','Grandchild']);
 await select.selectOption('2');
 await expect(page.getByRole('group',{name:'Packaging orders'})).toHaveCount(0);await page.getByLabel('Packaging Type',{exact:true}).fill('Film');
 await page.getByLabel('Price Basis',{exact:true}).selectOption('Count');
 await page.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(state.writes[0].rows[0].ParentTypeID).toBe(2);expect(state.writes[0].rows[0]).not.toHaveProperty('PackagingOrders');
});

test('parent dropdown excludes self, disables descendants and clears assignment',async({page})=>{
 const state=await setup(page,'Admin',2);await open(page);
 await expect(page.getByRole('cell',{name:'Secondary / Group',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Edit packaging type 1'}).click();
 const select=page.getByLabel('Parent Type',{exact:true});await expect(select).toHaveValue('2');
 await expect(select.locator('option[value="1"]')).toHaveCount(0);
 for(const id of [3,4])await expect(select.locator('option[value="'+id+'"]')).toHaveAttribute('disabled','');
 await expect(select.locator('option[value="5"]')).toHaveCount(0);
 await select.selectOption('');await page.getByRole('checkbox',{name:'Primary order',exact:true}).check();await page.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].rows[0]).toMatchObject({ParentTypeID:null,RowVersion:rv});
});

test('unchanged blocked parent remains visible and saves with other edits',async({page})=>{
 const state=await setup(page,'Admin',5);await open(page);await page.getByRole('button',{name:'Edit packaging type 1'}).click();
 const select=page.getByLabel('Parent Type',{exact:true});await expect(select).toHaveValue('5');
 await expect(select.locator('option[value="5"]')).toHaveText('Secondary / Old group (Blocked)');
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
 await expect(page.getByText('Required.',{exact:true})).toHaveCount(2);
 await page.getByLabel('Parent Type',{exact:true}).selectOption('');
 await expect(page.getByRole('checkbox',{name:'Primary order',exact:true})).toBeChecked();
 await page.getByLabel('Parent Type',{exact:true}).selectOption('3');
 await page.getByLabel('Packaging Type',{exact:true}).fill('Nested film');
 await page.getByLabel('Price Basis',{exact:true}).selectOption('Square meter');
 await page.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].rows[0]).toMatchObject({ParentTypeID:3,PackagingType:'Nested film',PriceBasis:'Square meter'});
 expect(state.writes[0].rows[0]).not.toHaveProperty('PackagingOrders');
});
