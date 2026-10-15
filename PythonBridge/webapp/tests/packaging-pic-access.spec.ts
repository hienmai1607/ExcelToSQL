import {canRespondPackaging} from '../src/packaging-access';
import {test,expect,type Page} from '@playwright/test';
const version='AAAAAAAAAAE=';
async function open(page:Page,session:any,pic=1){
 const row={RequestID:1,ItemID:21,ProductCode:'PRD-21',ProductName:'Product',ItemDescription:'Item',ItemStage:'Assigned',PICUserID:pic,PIC:'Old login name',ItemRowVersion:version,WeightGrams:150,AnnualUnit:1000};
 const writes:string[]=[];
 await page.route('**/api/**',route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(req.method()==='POST')writes.push(path);
  if(path.endsWith('/session'))return route.fulfill({json:session});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/workbench/requests')return route.fulfill({json:{rows:[{RequestID:1,RequestNumber:'PCR-1',ItemCount:1,RequestStatus:'Open'}],total:1}});
  if(path==='/api/packaging/requests')return route.fulfill({json:{rows:[row],total:1}});
  if(path==='/api/workbench/pics')return route.fulfill({json:{rows:[{ID:1,UserName:'PIC'},{ID:2,UserName:'Other PIC'}]}});
  if(path.endsWith('/transition'))return route.fulfill({json:{result:{RowVersion:'AAAAAAAAAAI='}}});
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Requests',exact:true}).click();
 await page.getByRole('button',{name:'View request',exact:true}).click();
 const table=page.getByRole('table',{name:'Packaging request items',exact:true});
 await expect(table).toBeVisible();
 return {table,writes};
}
const cases=[
 {name:'assigned member',scopes:['Packaging','PackagingManager'],user_id:1,is_admin:false,can_assign_packaging:false,edit:true,assign:false},
 {name:'other member',scopes:['Packaging','PackagingManager'],user_id:2,is_admin:false,can_assign_packaging:false,edit:false,assign:false},
 {name:'manager without ownership',scopes:['PackagingManager'],user_id:2,is_admin:false,can_assign_packaging:true,edit:false,assign:true},
 {name:'manager who is assigned member',scopes:['Packaging','PackagingManager'],user_id:1,is_admin:false,can_assign_packaging:true,edit:true,assign:true},
 {name:'Admin without ownership',scopes:['Admin'],user_id:2,is_admin:true,can_assign_packaging:true,edit:true,assign:true},
 {name:'Admin with ownership',scopes:['Admin','Packaging'],user_id:1,is_admin:true,can_assign_packaging:true,edit:true,assign:true},
 {name:'assigned display member',scopes:['Packaging','PackagingManager'],user_id:1,is_admin:false,can_assign_packaging:false,edit:false,assign:false,display:true},
];
for(const c of cases)test(c.name+' has correct response and assignment access',async({page})=>{
 const session={...c,username:'PIC',permissions:{requests:c.display?'display':'edit'}};
 const {table,writes}=await open(page,session);
 await expect(table.getByRole('button',{name:'Submit 21',exact:true})).toHaveCount(c.edit?1:0);
 await expect(table.getByLabel('PIC for item 21',{exact:true})).toHaveCount(c.assign?1:0);
 await table.getByRole('button',{name:'Open response PRD-21',exact:true}).click();
 const item=page.getByRole('region',{name:'Request item 21',exact:true});
 const field=item.getByLabel('No of Primary Unit',{exact:true});
 if(c.edit){await expect(field).toBeEnabled();await field.fill('12')}
 else await expect(field).toBeDisabled();
 expect(writes).toEqual([]);
});
test('only the saved owner can submit; opening confirmation does not write',async({page})=>{
 const {table,writes}=await open(page,{username:'PIC',user_id:1,is_admin:false,scopes:['Packaging'],can_assign_packaging:false,permissions:{requests:'edit'}});
 await table.getByRole('button',{name:'Submit 21',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Confirm response action'});
 await expect(dialog).toBeVisible();expect(writes).toEqual([]);
 await dialog.getByRole('button',{name:'Confirm',exact:true}).click();
 await expect.poll(()=>writes).toEqual(['/api/packaging/items/21/transition']);
});
test('changing PIC selection does not unlock a response before saving assignment',async({page})=>{
 const {table,writes}=await open(page,{username:'PIC',user_id:2,is_admin:false,scopes:['Packaging','PackagingManager'],can_assign_packaging:true,permissions:{requests:'edit'}});
 await table.getByLabel('PIC for item 21',{exact:true}).selectOption('2');
 await expect(table.getByRole('button',{name:'Submit 21',exact:true})).toHaveCount(0);
 expect(writes).toEqual([]);
});

test('explicitly unassigned PIC never falls back to a matching display login',()=>{
 const session={username:'PIC',user_id:1,is_admin:false,scopes:['Packaging']};
 expect(canRespondPackaging(session,{PICUserID:null,PIC:'PIC',ItemStage:'Assigned'})).toBe(false);
 expect(canRespondPackaging({...session,user_id:undefined},{PICUserID:null,PIC:'PIC',ItemStage:'Assigned'})).toBe(false);
 expect(canRespondPackaging(session,{PICUserID:2,PIC:'PIC',ItemStage:'Assigned'})).toBe(false);
 expect(canRespondPackaging(session,{PICUserID:1,PIC:'Old login',ItemStage:'Assigned'})).toBe(true);
});
