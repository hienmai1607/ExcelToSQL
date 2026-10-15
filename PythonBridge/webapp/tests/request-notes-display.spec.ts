import {test,expect} from '@playwright/test';

test('Items View omits the request notes box while the editor retains saved notes',async({page})=>{
 const notes='Keep these saved packaging instructions';
 const header={RequestID:1,RequestNumber:'PCR-1',ItemCount:1,RequestStatus:'Open',RequestNotes:notes};
 const item={...header,ItemID:21,ProductCode:'PRD-21',ItemDescription:'Item',ItemStage:'Assigned',PICUserID:1,PIC:'Admin',ItemRowVersion:'AAAAAAAAAAE='};
 const writes:string[]=[];
 await page.route('**/api/**',route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(req.method()!=='GET')writes.push(path);
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Admin',user_id:1,is_admin:true,scopes:['Admin'],can_assign_packaging:true}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/workbench/requests')return route.fulfill({json:{rows:[header],total:1}});
  if(path==='/api/packaging/requests')return route.fulfill({json:{rows:[item],total:1}});
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Packaging Requests',exact:true}).click();
 await page.getByRole('button',{name:'View request',exact:true}).click();
 await expect(page.getByRole('table',{name:'Packaging request items',exact:true})).toBeVisible();
 await expect(page.locator('.request-items .notice')).toHaveCount(0);
 await expect(page.locator('.request-items').getByText('Request notes',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Edit request PCR-1',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Edit Packaging request'}).locator('.request-header-note')).toContainText(notes);
 expect(writes).toEqual([]);
});
