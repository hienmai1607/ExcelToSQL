import {test,expect,type Page} from '@playwright/test';

async function open(page:Page,stage='Approved',approver:string|null='Manager'){
 const writes:string[]=[];
 const header={RequestID:1,RequestNumber:'PCR-1',ItemCount:1,RequestStatus:stage==='Approved'?'Completed':'Open'};
 const item={...header,ItemID:21,ProductCode:'PRD-21',ItemDescription:'Item',ItemStage:stage,PICUserID:2,PIC:'Packaging Person',ApprovedByName:approver,ItemRowVersion:'AAAAAAAAAAE='};
 await page.route('**/api/**',route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(request.method()!=='GET')writes.push(path);
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Admin',user_id:1,is_admin:true,scopes:['Admin']}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/workbench/requests')return route.fulfill({json:{rows:[header],total:1}});
  if(path==='/api/packaging/requests')return route.fulfill({json:{rows:[item],total:1}});
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Requests',exact:true}).click();
 await page.getByRole('button',{name:'View request',exact:true}).click();
 return {writes,table:page.getByRole('table',{name:'Packaging request items',exact:true})};
}

test('item list and editor distinguish the PIC from the approving manager without duplicates',async({page})=>{
 const {writes,table}=await open(page);
 await expect(table.getByText('PIC: Packaging Person',{exact:true})).toHaveCount(1);
 await expect(table.getByText('Approved by: Manager',{exact:true})).toHaveCount(1);
 await page.screenshot({path:'../artifacts/layout-testing/packaging-pic-approver.png'});
 await page.getByRole('button',{name:'Edit request PCR-1',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request',exact:true});
 await expect(editor.getByText('PIC: Packaging Person',{exact:true})).toHaveCount(1);
 await expect(editor.getByText('Approved by: Manager',{exact:true})).toHaveCount(1);
 expect(writes).toEqual([]);
});

test('unknown historical approver is explicit and never replaced by PIC or logged-in user',async({page})=>{
 const {table}=await open(page,'Approved',null);
 await expect(table.getByText('PIC: Packaging Person',{exact:true})).toBeVisible();
 await expect(table.getByText('Approved by: Not recorded',{exact:true})).toBeVisible();
 await expect(table.getByText('Approved by: Admin',{exact:true})).toHaveCount(0);
});

test('a returned item does not label its reviewer as an approver',async({page})=>{
 const {table}=await open(page,'Returned','Manager');
 await expect(table.getByText(/^Approved by:/)).toHaveCount(0);
 await expect(table.getByText('PIC:',{exact:true})).toBeVisible();
});
