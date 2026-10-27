import {test,expect,type Page} from '@playwright/test';
import {selectableType} from '../src/packaging-orders';
const rv='AAAAAAAAAAE=';
test('cumulative eligibility maps parent slots after the deepest child',()=>{
 const regular={PackagingOrders:['Primary'],Shipping:true};
 const parent={PackagingOrders:['Tertiary','Quaternary'],Shipping:true};
 expect(selectableType(regular,'Primary',1,false,false)).toBe(true);
 expect(selectableType(regular,'Primary',1,false,true,3)).toBe(false);
 expect(selectableType(parent,'Primary',2,false,true,3)).toBe(true);
 expect(selectableType(parent,'Secondary',2,false,true,3)).toBe(true);
 expect(selectableType(regular,'Primary',1,true,false)).toBe(true);
});

test('Palletization derives Single and root dimension copying without a separate Copy Dim control',async({page})=>{
 const state=await setup(page);await open(page);await page.getByRole('button',{name:'New packaging type',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New packaging type',exact:true});
 await form.getByLabel('Packaging Type',{exact:true}).fill('Rigid corner');
 await form.getByRole('checkbox',{name:'Palletization order',exact:true}).check();
 await expect(form.getByRole('checkbox',{name:'Single',exact:true})).toBeChecked();
 await expect(form.getByRole('checkbox',{name:'Copy Dim.',exact:true})).toHaveCount(0);
 await form.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(state.writes[0].rows[0]).toMatchObject({PackagingOrders:['Pallet'],CopyDim:true,FinalComponent:true,Shipping:false});
});

test('four canonical layer flags wrap cleanly with logistics on desktop and mobile',async({page})=>{
 await setup(page);await open(page);await page.getByRole('button',{name:'Edit packaging type 1',exact:true}).click();
 const form=page.getByRole('dialog',{name:'Edit packaging type',exact:true});
 await expect(form.getByRole('button',{name:'Add new Packaging Type master',exact:true})).toHaveCount(0);
 for(const width of [1920,390]){
  await page.setViewportSize({width,height:width===390?844:1080});
  const rows=width===390?[['Primary order','Secondary order'],['Tertiary order','Quaternary order'],['Shipping','Palletization order','Single']]:[['Primary order','Secondary order','Tertiary order','Quaternary order'],['Shipping','Palletization order','Single']];
  let previous=-1;
  for(const names of rows){
   const boxes=await Promise.all(names.map(name=>form.getByRole('checkbox',{name,exact:true}).boundingBox()));
   for(const box of boxes)expect(Math.abs(box!.y-boxes[0]!.y)).toBeLessThanOrEqual(2);
   expect(boxes[0]!.y).toBeGreaterThan(previous);previous=boxes[0]!.y;
  }
  expect(await form.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:'test-results/packaging-type-flags-'+width+'.png'});
 }
 await expect(form.getByRole('checkbox',{name:'Copy Dim.',exact:true})).toHaveCount(0);
});

test('root Single automatically sends CopyDim true',async({page})=>{
 const state=await setup(page);await open(page);await page.getByRole('button',{name:'New packaging type',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New packaging type',exact:true});
 await form.getByLabel('Packaging Type',{exact:true}).fill('Single film');
 await form.getByRole('checkbox',{name:'Primary order',exact:true}).check();
 await form.getByRole('checkbox',{name:'Single',exact:true}).check();
 await form.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(state.writes[0].rows[0]).toMatchObject({FinalComponent:true,CopyDim:true});
});

test('Quaternary-only types save without retired Mix flags',async({page})=>{
 const state=await setup(page);await open(page);await page.getByRole('button',{name:'New packaging type',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New packaging type',exact:true});
 await form.getByLabel('Packaging Type',{exact:true}).fill('Quaternary carton');
 await form.getByRole('checkbox',{name:'Quaternary order',exact:true}).check();
 await expect(form.getByRole('checkbox',{name:'Primary order',exact:true})).not.toBeChecked();
 await form.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(state.writes[0].rows[0].PackagingOrders).toEqual(['Quaternary']);
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
 await page.getByRole('checkbox',{name:'Parent Group',exact:true}).check();await expect(shipping).toHaveCount(0);
 await page.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(state.writes[1].rows[0]).toMatchObject({ParentTypeIDs:[2],Shipping:false});
});
async function setup(page:Page,scope='Admin',parent:number|number[]|null=null,legacyLayout=false){
 const writes:any[]=[],exports:any[]=[];
 const types=[
  {ID:1,PackagingOrder:'Primary',PackagingType:'Pouch',Status:'Active',ParentTypeID:Array.isArray(parent)?parent[0]:parent,...(Array.isArray(parent)?{ParentTypeIDs:parent}:{})},
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
 await expect(page.getByRole('group',{name:'Packaging orders'}).getByRole('checkbox')).toHaveCount(5);
 await expect(page.getByLabel('Price Basis',{exact:true})).toHaveCount(0);
 await page.getByRole('checkbox',{name:'Primary order',exact:true}).check();
 await expect(page.getByLabel('Tare weight (g)',{exact:true})).toHaveCount(0);
 await page.getByLabel('Packaging Type',{exact:true}).fill('Film');
 await page.getByRole('button',{name:'Review & save',exact:true}).click();expect(state.writes).toHaveLength(0);
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].rows[0]).toEqual({RowNum:1,Command:'C',ID:null,RowVersion:null,ParentTypeIDs:[],PackagingOrders:['Primary'],PackagingType:'Film',Shipping:false,FinalComponent:false,CopyDim:false});
});

test('one type can support all four orders and persist the selected set',async({page})=>{
 const state=await setup(page);await open(page);await page.getByRole('button',{name:'Edit packaging type 1'}).click();
 await expect(page.getByRole('checkbox',{name:'Primary order',exact:true})).toBeChecked();
 await page.getByRole('checkbox',{name:'Secondary order',exact:true}).check();
 await page.getByRole('checkbox',{name:'Tertiary order',exact:true}).check();
 await page.getByRole('checkbox',{name:'Quaternary order',exact:true}).check();
 await page.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].rows[0].PackagingOrders).toEqual(['Primary','Secondary','Tertiary','Quaternary']);
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
 await page.getByRole('button',{name:'Layout options'}).click();await page.getByRole('button',{name:'Move Packaging Type right'}).click();await page.getByRole('button',{name:'Save layout to profile'}).click();
 await expect(page.getByRole('status')).toContainText('saved');
 expect(state.profile().settings.masters['packaging-types'].sort).toEqual([]);
 expect(state.profile().settings.masters['packaging-types'].column_widths).not.toHaveProperty('TareWeight');
 await expect(page.getByText('Tare weight (g)',{exact:true})).toHaveCount(0);
 expect(state.profile().settings.masters['packaging-types'].columns.slice(0,2)).toEqual(['FinalComponent','PackagingType']);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('new type can select a parent from either order',async({page})=>{
 const state=await setup(page);await open(page);
 await expect(page.getByRole('button',{name:'Sort by Parent Types',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'New packaging type',exact:true}).click();
 const parents=page.getByRole('group',{name:'Parent Types',exact:true});
 await expect(parents.getByRole('checkbox')).toHaveCount(4);
 await parents.getByRole('checkbox',{name:'Parent Group',exact:true}).check();
 await expect(page.getByRole('group',{name:'Packaging orders'})).toHaveCount(0);await page.getByLabel('Packaging Type',{exact:true}).fill('Film');

 await page.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(state.writes[0].rows[0].ParentTypeIDs).toEqual([2]);expect(state.writes[0].rows[0]).not.toHaveProperty('PackagingOrders');
});

test('parent dropdown removes self, descendants and unavailable choices and clears assignment',async({page})=>{
 const state=await setup(page,'Admin',2);await open(page);
 await expect(page.getByRole('cell',{name:'Group',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Edit packaging type 1'}).click();
 const parents=page.getByRole('group',{name:'Parent Types',exact:true});
 await expect(parents.getByRole('checkbox',{name:'Parent Group',exact:true})).toBeChecked();
 for(const name of ['Pouch','Child','Grandchild','Old group'])await expect(parents.getByRole('checkbox',{name:'Parent '+name,exact:true})).toHaveCount(0);
 await parents.getByRole('checkbox',{name:'Parent Group',exact:true}).uncheck();await page.getByRole('checkbox',{name:'Primary order',exact:true}).check();await page.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].rows[0]).toMatchObject({ParentTypeIDs:[],RowVersion:rv});
});

test('unchanged blocked parent remains visible and saves with other edits',async({page})=>{
 const state=await setup(page,'Admin',5);await open(page);await page.getByRole('button',{name:'Edit packaging type 1'}).click();
 await expect(page.getByRole('checkbox',{name:'Parent Old group',exact:true})).toBeChecked();
 await expect(page.getByText('Old group (Blocked)',{exact:true})).toBeVisible();
 await page.getByLabel('Packaging Type',{exact:true}).fill('Renamed pouch');
 await page.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);expect(state.writes[0].rows[0].ParentTypeIDs).toEqual([5]);
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
 expect(state.writes[0].rows[0]).toMatchObject({Command:'U',ID:1,ParentTypeIDs:[2],RowVersion:rv,PackagingType:'Renamed child'});
 expect(state.writes[0].rows[0]).not.toHaveProperty('PackagingOrders');
 expect(state.writes[0].rows[0]).not.toHaveProperty('PackagingOrder');
});

test('switching root to child hides orders and nested child needs only name and basis',async({page})=>{
 const state=await setup(page);await open(page);
 await page.getByRole('button',{name:'New packaging type',exact:true}).click();
 await page.getByRole('checkbox',{name:'Primary order',exact:true}).check();
 await page.getByRole('checkbox',{name:'Parent Child',exact:true}).check();
 await expect(page.getByRole('group',{name:'Packaging orders'})).toHaveCount(0);
 await page.getByRole('button',{name:'Review & save',exact:true}).click();
 await expect(page.getByText('Required.',{exact:true})).toHaveCount(1);
await page.getByRole('checkbox',{name:'Parent Child',exact:true}).uncheck();
 await expect(page.getByRole('checkbox',{name:'Primary order',exact:true})).toBeChecked();
 await page.getByRole('checkbox',{name:'Parent Child',exact:true}).check();
 await page.getByLabel('Packaging Type',{exact:true}).fill('Nested film');

 await page.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(state.writes[0].rows[0]).toMatchObject({ParentTypeIDs:[3],PackagingType:'Nested film',FinalComponent:false});
 expect(state.writes[0].rows[0]).not.toHaveProperty('PackagingOrders');
});

test('one type keeps multiple parents when edited and saves one ID',async({page})=>{
 const state=await setup(page,'Admin',[2,5]);await open(page);
 await page.getByRole('button',{name:'Edit packaging type 1',exact:true}).click();
 const form=page.getByRole('dialog',{name:'Edit packaging type',exact:true});
 await expect(form.getByRole('checkbox',{name:'Parent Group',exact:true})).toBeChecked();
 await expect(form.getByRole('checkbox',{name:'Parent Old group',exact:true})).toBeChecked();
 await form.getByRole('checkbox',{name:'Parent Old group',exact:true}).uncheck();
 await form.getByLabel('Packaging Type',{exact:true}).fill('Shared Seal');
 await form.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(state.writes[0].rows).toHaveLength(1);
 expect(state.writes[0].rows[0]).toMatchObject({ID:1,ParentTypeIDs:[2],PackagingType:'Shared Seal',CopyDim:false});
});

test('new shared component selects several parents without creating duplicate types',async({page})=>{
 const state=await setup(page);await open(page);
 await page.getByRole('button',{name:'New packaging type',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New packaging type',exact:true});
 const parents=form.getByRole('group',{name:'Parent Types',exact:true});
 expect(await parents.evaluate(el=>getComputedStyle(el).display)).toBe('grid');
 for(const name of ['Pouch','Group'])await form.getByRole('checkbox',{name:'Parent '+name,exact:true}).check();
 await form.getByLabel('Packaging Type',{exact:true}).fill('Shared Seal');
 await form.getByRole('checkbox',{name:'Single',exact:true}).check();
 await page.setViewportSize({width:390,height:844});
 expect(await form.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await page.screenshot({path:'test-results/packaging-multiple-parents-mobile.png'});
 await form.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(state.writes[0].rows).toHaveLength(1);
 expect(state.writes[0].rows[0]).toMatchObject({ParentTypeIDs:[1,2],PackagingType:'Shared Seal',CopyDim:false,FinalComponent:true});
});
