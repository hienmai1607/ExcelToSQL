import {test,expect,type Page} from '@playwright/test';
import {workspacePages} from '../src/workspace-access';
const rv='AAAAAAAAAAE=',permissions=(extra:Record<string,string>={})=>({...Object.fromEntries(Object.keys(workspacePages).map(k=>[k,'none'])),...extra});
async function setup(page:Page,admin=true,access:Record<string,string>|null=null,scopes?:string[]){
 const writes:any[]=[];
 const roles=[{ID:2,RoleName:'Sales reader',IsActive:true,RowVersion:rv,Permissions:permissions({opportunities:'display'})},{ID:3,RoleName:'Packaging editor',IsActive:true,RowVersion:rv,Permissions:permissions({materials:'edit'})}];
 const users=[{ID:1,UserName:'Admin',IsActive:true,RowVersion:rv,DirectScopes:['Admin'],RoleIDs:[]},{ID:8,UserName:'Alice',IsActive:true,RowVersion:rv,DirectScopes:[],RoleIDs:[2]}];
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname,body=route.request().postDataJSON();
  if(route.request().method()==='POST'&&path.startsWith('/api/administrator/')){writes.push({path,body});return route.fulfill({json:{ID:10}})}
  if(path.endsWith('/session'))return route.fulfill({json:{username:admin?'Admin':'Alice',user_id:admin?1:8,is_admin:admin,scopes:scopes??(admin?['Admin']:['Customer','Packaging','PackagingManager','Opportunity']),permissions:access}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/administrator/roles')return route.fulfill({json:{rows:roles}});
  if(path==='/api/administrator/users')return route.fulfill({json:{rows:users}});
  if(path==='/api/administrator/markets')return route.fulfill({json:{rows:[{ID:1,MarketCode:'US',MarketName:'United States',RowVersion:rv}]}});
  if(path==='/api/administrator/currencies')return route.fulfill({json:{rows:[{ID:1,CurrencyCode:'USD',CurrencyName:'US Dollar',RowVersion:rv}]}});
  if(path==='/api/customer/lookups')return route.fulfill({json:{markets:[{ID:1,MarketCode:'US'}],currencies:[{ID:1,CurrencyCode:'USD'}]}});
  if(path==='/api/customer')return route.fulfill({json:{rows:[{ID:4,CustomerName:'Acme',MarketID:1,CurrencyID:1,Status:'Active',RowVersion:rv}],total:1,page:1}});
  if(path==='/api/opportunity/grid')return route.fulfill({json:{rows:[{OpportunityID:1,OpportunityNumber:'OPP-1',HeaderStage:'Draft',ItemID:11,ProductCode:'PRD-1',ItemStage:'Draft',HeaderRowVersion:rv,ItemRowVersion:rv}],total:1,page:1}});
  if(path==='/api/workbench/opportunity-excel/readonly')return route.fulfill({body:'xlsx',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();return writes;
}
test('Administrator group and all four pages are Admin-only',async({page},info)=>{
 await setup(page);
 const nav=page.getByRole('navigation',{name:'Workspace navigation'}),group=nav.getByRole('region',{name:'Administrator'});
 await expect(group).toBeVisible();
 await expect(nav.getByRole('region')).toHaveCount(5);
 await expect(nav.getByRole('button')).toHaveCount(22);
 for(const title of ['User role','User master','Market Master','Currency Master']){
  await nav.getByRole('button',{name:title,exact:true}).click();
  await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
  await expect(page.getByRole('table',{name:title,exact:true}).getByRole('columnheader').first().getByRole('button',{name:'New '+title,exact:true})).toBeVisible();
 }
 await page.screenshot({path:info.outputPath('administrator-sidebar.png'),fullPage:true});
});

for(const level of ['display','edit'] as const)test('assigned UoM '+level+' permission enables only its permitted controls',async({page})=>{
 await setup(page,false,permissions({uoms:level}));
 const nav=page.getByRole('navigation').getByRole('button',{name:'Units of Measure',exact:true});
 await expect(nav).toBeEnabled();await nav.click();
 await expect(page.getByRole('heading',{name:'Units of Measure',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'New UoM',exact:true})).toHaveCount(level==='edit'?1:0);
 await expect(page.getByRole('navigation').getByRole('region',{name:'Administrator'})).toHaveCount(0);
});
test('non-Admin has no Administrator group or maintenance buttons',async({page})=>{
 await setup(page,false,permissions({customers:'display'}));
 await expect(page.getByRole('navigation').getByRole('region',{name:'Administrator'})).toHaveCount(0);
 for(const title of ['User role','User master','Market Master','Currency Master'])await expect(page.getByRole('button',{name:title,exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'New customer',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'View Acme',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'View customer',exact:true});
 await expect(dialog.getByLabel('Customer name *')).toBeDisabled();
 await expect(dialog.getByRole('button',{name:'Review & save'})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Close customer form'}).click();
 await expect(dialog).toHaveCount(0);
});
test('role maintenance saves per-page permissions only after review',async({page},info)=>{
 const writes=await setup(page);await page.getByRole('button',{name:'User role',exact:true}).click();
 await page.getByRole('button',{name:'New User role',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'New User role',exact:true});
 await dialog.getByLabel('Role name *').fill('Packaging display');
 await dialog.getByLabel('Packaging Material access',{exact:true}).selectOption('display');
 await dialog.getByLabel('Packaging Pricing access',{exact:true}).selectOption('edit');
 await dialog.getByLabel('Category Master access',{exact:true}).selectOption('edit');
 await page.screenshot({path:info.outputPath('role-permissions.png')});
 await dialog.getByRole('button',{name:'Review & save'}).click();expect(writes).toHaveLength(0);
 await expect(page.getByRole('dialog',{name:'Confirm master save'})).toContainText('Packaging display');
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0]).toMatchObject({path:'/api/administrator/roles',body:{ID:null,RowVersion:null,RoleName:'Packaging display',IsActive:true,Permissions:{materials:'display',prices:'edit',categories:'edit',opportunities:'none'}}});
 expect(Object.keys(writes[0].body.Permissions)).toHaveLength(Object.keys(workspacePages).length);
});
test('User master maintains multiple roles, activity and original row version',async({page})=>{
 const writes=await setup(page);await page.getByRole('button',{name:'User master',exact:true}).click();
 await page.getByRole('button',{name:'Edit User master 8',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Edit User master',exact:true});
 await expect(dialog.getByLabel('Role Sales reader',{exact:true})).toBeChecked();
 await dialog.getByLabel('Role Packaging editor',{exact:true}).check();
 await dialog.getByLabel('Access',{exact:true}).selectOption('0');
 await dialog.getByRole('button',{name:'Review & save'}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0].body).toEqual({ID:8,RowVersion:rv,UserName:'Alice',IsActive:false,RoleIDs:[2,3],DirectScopes:[]});
});
test('current Admin protections are visible in User master',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'User master',exact:true}).click();
 await page.getByRole('button',{name:'Edit User master 1',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Edit User master',exact:true});
 await expect(dialog.getByLabel('Login name *')).toBeDisabled();
 await expect(dialog.getByLabel('Access',{exact:true})).toBeDisabled();
 await expect(dialog.getByLabel('Direct access Admin',{exact:true})).toBeChecked();
 await expect(dialog.getByLabel('Direct access Admin',{exact:true})).toBeDisabled();
});
for(const entity of ['Market Master','Currency Master'])test(entity+' saves existing code/name with concurrency protection',async({page})=>{
 const writes=await setup(page);await page.getByRole('button',{name:entity,exact:true}).click();
 await page.getByRole('button',{name:'Edit '+entity+' 1',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Edit '+entity,exact:true});
 await dialog.getByLabel('Name *',{exact:true}).fill('Updated name');
 await dialog.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0]).toMatchObject({path:'/api/administrator/'+(entity.startsWith('Market')?'markets':'currencies'),body:{ID:1,RowVersion:rv,Code:entity.startsWith('Market')?'US':'USD',Name:'Updated name'}});
});
test('Display Opportunity has no edit or request selection and downloads readonly XLSX',async({page})=>{
 await setup(page,false,permissions({opportunities:'display'}));
 await expect(page.getByRole('button',{name:'New Opportunity',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'Edit Opportunity OPP-1',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'View details',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Request',exact:true}).click();
 await expect(page.getByRole('checkbox',{name:'Select PRD-1 item 11',exact:true})).toBeDisabled();
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Excel local template',exact:true}).click();
 expect((await downloaded).suggestedFilename()).toBe('opportunity-readonly.xlsx');
});
test('role maintenance fits mobile without horizontal page overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page);
 await page.getByRole('button',{name:'User role',exact:true}).click();await page.getByRole('button',{name:'New User role',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'New User role',exact:true});
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+2)).toBe(true);
});

test('sidebar removes inaccessible pages and empty groups while preserving Display and Edit pages',async({page})=>{
 await setup(page,false,permissions({requests:'display',customers:'edit'}));
 const nav=page.getByRole('navigation',{name:'Workspace navigation'});
 await expect(nav.getByRole('button')).toHaveCount(2);
 await expect(nav.getByRole('button',{name:'Packaging Requests',exact:true})).toBeEnabled();
 await expect(nav.getByRole('button',{name:'Customers',exact:true})).toBeEnabled();
 await expect(nav.getByRole('region',{name:'Sales workspace',exact:true})).toBeVisible();
 await expect(nav.getByRole('region',{name:'Packaging',exact:true})).toBeVisible();
 for(const title of ['Raw materials','Shared masters','Administrator'])await expect(nav.getByRole('region',{name:title,exact:true})).toHaveCount(0);
 for(const title of ['Packaging Material','Packaging Pricing','Packaging Type Master','Packaging Dimension Master','Pallet Master','Opportunities','Products'])await expect(nav.getByRole('button',{name:title,exact:true})).toHaveCount(0);
 await nav.getByRole('button',{name:'Packaging Requests',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Packaging Requests',exact:true})).toBeVisible();
});

test('user with no page grants has no sidebar groups or page buttons',async({page})=>{
 await setup(page,false,permissions());
 const nav=page.getByRole('navigation',{name:'Workspace navigation'});
 await expect(nav.getByRole('region')).toHaveCount(0);
 await expect(nav.getByRole('button')).toHaveCount(0);
 await expect(page.getByText('No access is assigned for this page.',{exact:true})).toBeVisible();
});

test('legacy user without access scopes has no sidebar groups',async({page})=>{
 await setup(page,false,null,[]);
 const nav=page.getByRole('navigation',{name:'Workspace navigation'});
 await expect(nav.getByRole('region')).toHaveCount(0);
 await expect(nav.getByRole('button')).toHaveCount(0);
});
