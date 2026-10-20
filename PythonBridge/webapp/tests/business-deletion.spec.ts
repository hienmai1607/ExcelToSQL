import {test,expect,type Page} from '@playwright/test';
const version='AAAAAAAAAAE=';
async function setup(page:Page,admin=true,available=true){
 const writes:any[]=[];
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Tester',user_id:1,is_admin:admin,scopes:[admin?'Admin':'PackagingManager']}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/workbench/masters/materials')return route.fulfill({json:{rows:[{ID:3,MaterialCode:'MAT-3',MaterialName:'Unused film',UnitOfMeasure:'EA',Status:'Active',RowVersion:version}],total:1,page:1}});
  if(path==='/api/workbench/masters/lookups')return route.fulfill({json:{materials:[],currencies:[],creators:[],uoms:[],packagingTypes:[]}});
  if(path.endsWith('/eligibility'))return route.fulfill({json:{rows:route.request().postDataJSON().rows.map((r:any)=>({...r,available}))}});
  if(path.startsWith('/api/business-records/')){writes.push(route.request().postDataJSON());return route.fulfill({json:{deleted:true,ID:3}})}
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Material',exact:true}).click();
 return writes;
}
test('permanent deletion requires confirmation and sends the displayed row version',async({page})=>{
 const writes=await setup(page);
 await page.getByRole('button',{name:'Delete material MAT-3',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Confirm permanent deletion',exact:true});
 await expect(dialog).toContainText('cannot be undone');expect(writes).toHaveLength(0);
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(writes).toHaveLength(0);
 await page.getByRole('button',{name:'Delete material MAT-3',exact:true}).click();
 await dialog.getByRole('button',{name:'Delete permanently',exact:true}).click();
 await expect(dialog).toHaveCount(0);expect(writes).toEqual([{ID:3,RowVersion:version}]);
 await expect(page.getByText('Record deleted.',{exact:true})).toBeVisible();
});
for(const message of ['Cannot delete: referenced by PackagingPrice.','Record changed. Refresh before deleting.']){
 test('server refusal stays visible: '+message,async({page})=>{
  await setup(page);
  await page.route('**/api/business-records/materials/delete',route=>route.fulfill({status:409,json:{detail:message}}));
  await page.getByRole('button',{name:'Delete material MAT-3',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Confirm permanent deletion',exact:true});
  await dialog.getByRole('button',{name:'Delete permanently',exact:true}).click();
  await expect(dialog.getByRole('alert')).toHaveText(message);
  await expect(page.getByText('Record deleted.',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Edit material 3',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.getByRole('button',{name:'Delete material MAT-3',exact:true})).toHaveCount(0);
 });
}
test('unknown network outcome cannot be blindly resubmitted',async({page})=>{
 await setup(page);
 await page.route('**/api/business-records/materials/delete',route=>route.abort());
 await page.getByRole('button',{name:'Delete material MAT-3',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Confirm permanent deletion',exact:true});
 await dialog.getByRole('button',{name:'Delete permanently',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('outcome is unknown');
 await expect(dialog.getByRole('button',{name:'Delete permanently',exact:true})).toBeDisabled();
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(page.getByRole('button',{name:'Delete material MAT-3',exact:true})).toHaveCount(0);
});
test('request header deletion uses its dedicated header row version',async({page})=>{
 const writes=await setup(page);
 await page.route('**/api/workbench/requests?**',route=>route.fulfill({json:{rows:[{RequestID:3,RequestNumber:'PCR-3',HeaderRowVersion:version,RequestStatus:'Open',ItemCount:0}],total:1,page:1}}));
 await page.getByRole('button',{name:'Packaging Requests',exact:true}).click();
 await page.getByRole('button',{name:'Delete request PCR-3',exact:true}).click();
 await page.getByRole('dialog',{name:'Confirm permanent deletion',exact:true}).getByRole('button',{name:'Delete permanently',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toEqual({ID:3,RowVersion:version});
});

test('trash stays hidden for unavailable records',async({page})=>{
 await setup(page,true,false);
 await expect(page.getByRole('button',{name:'Edit material 3',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Delete material MAT-3',exact:true})).toHaveCount(0);
});
test('trash stays hidden while eligibility is loading or fails',async({page})=>{
 await setup(page);
 let release:(()=>void)|undefined;
 await page.route('**/api/business-records/materials/eligibility',async route=>{
  await new Promise<void>(resolve=>{release=resolve});
  await route.fulfill({status:503,json:{detail:'Unavailable'}});
 });
 await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(page.getByRole('button',{name:'Edit material 3',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Delete material MAT-3',exact:true})).toHaveCount(0);
 await expect.poll(()=>!!release).toBe(true);release!();
 await expect(page.getByRole('button',{name:'Delete material MAT-3',exact:true})).toHaveCount(0);
});

test('visible rows share one batch and only eligible icons appear',async({page})=>{
 await setup(page);
 await expect(page.getByRole('button',{name:'Delete material MAT-3',exact:true})).toBeVisible();
 const batches:any[]=[];
 await page.route('**/api/workbench/masters/materials?**',route=>route.fulfill({json:{rows:[3,4].map(ID=>({ID,MaterialCode:'MAT-'+ID,MaterialName:'Material '+ID,Status:'Active',RowVersion:version})),total:2,page:1}}));
 await page.route('**/api/business-records/materials/eligibility',route=>{
  const body=route.request().postDataJSON();batches.push(body);
  return route.fulfill({json:{rows:body.rows.map((r:any)=>({...r,available:r.ID===3}))}});
 });
 await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(page.getByRole('button',{name:'Delete material MAT-3',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Delete material MAT-4',exact:true})).toHaveCount(0);
 expect(batches).toHaveLength(1);expect(batches[0].rows.map((r:any)=>r.ID)).toEqual([3,4]);
});

test('display-only users have no deletion control',async({page})=>{
 await setup(page,false);
 await expect(page.getByRole('button',{name:'View material 3',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:/^Delete /})).toHaveCount(0);
});
