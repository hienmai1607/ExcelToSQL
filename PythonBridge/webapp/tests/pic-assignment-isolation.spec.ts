import {test,expect,type Page} from '@playwright/test';
const initial='AAAAAAAAAAE=',updated='AAAAAAAAAAI=';
async function open(page:Page){
 const rows=[21,22].map(ItemID=>({ItemID,RequestID:1,ProductCode:'PRD-'+ItemID,ProductName:'Product '+ItemID,ItemDescription:'Item '+ItemID,ItemStage:'Assigned',PICUserID:1,PIC:'User',ItemRowVersion:initial,WeightGrams:150,AnnualUnit:1000}));
 const writes:{id:number;body:any}[]=[];
 await page.route('**/api/**',route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Admin',user_id:2,is_admin:true,scopes:['Admin']}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/workbench/requests')return route.fulfill({json:{rows:[{RequestID:1,RequestNumber:'PCR-1',ItemCount:2,RequestStatus:'Open'}],total:1}});
  if(path==='/api/packaging/requests')return route.fulfill({json:{rows,total:2}});
  if(path==='/api/workbench/pics')return route.fulfill({json:{rows:[{ID:1,UserName:'User'},{ID:2,UserName:'Admin'}]}});
  const match=path.match(/\/items\/(\d+)\/assign$/);
  if(match){const id=Number(match[1]),body=req.postDataJSON();writes.push({id,body});const row=rows.find(r=>r.ItemID===id)!;row.PICUserID=body.PICUserID;row.PIC=body.PICUserID===2?'Admin':'User';row.ItemRowVersion=updated;return route.fulfill({json:{result:{RowVersion:updated}}})}
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Packaging requests',exact:true}).click();
 await page.getByRole('button',{name:'View request',exact:true}).click();
 const table=page.getByRole('table',{name:'Packaging request items',exact:true});
 await expect(table.getByLabel('PIC for item 21',{exact:true})).toBeVisible();
 return {table,writes};
}
test('saving the second PIC row preserves the first pending assignment',async({page})=>{
 const {table,writes}=await open(page);
 const first=table.getByLabel('PIC for item 21',{exact:true}),second=table.getByLabel('PIC for item 22',{exact:true});
 await first.selectOption('2');await second.selectOption('2');
 const firstNode=await first.elementHandle();
 await table.getByRole('button',{name:'Assign PIC for item 22',exact:true}).click();
 await expect(table.getByRole('button',{name:'Assign PIC for item 22',exact:true})).toBeDisabled();
 expect(writes.map(w=>w.id)).toEqual([22]);
 await expect(first).toHaveValue('2');
 expect(await firstNode!.evaluate(el=>el.isConnected)).toBeTruthy();
 await expect(table.getByRole('button',{name:'Assign PIC for item 21',exact:true})).toBeEnabled();
 expect(writes.map(w=>w.id)).toEqual([22]);
 await table.getByRole('button',{name:'Assign PIC for item 21',exact:true}).click();
 await expect(table.getByRole('button',{name:'Assign PIC for item 21',exact:true})).toBeDisabled();
 await expect(first).toHaveValue('2');await expect(second).toHaveValue('2');
 expect(writes.map(w=>w.id)).toEqual([22,21]);
});
test('saving sequential PIC rows retains the first saved assignment',async({page})=>{
 const {table,writes}=await open(page);
 for(const id of [21,22]){
  await table.getByLabel('PIC for item '+id,{exact:true}).selectOption('2');
  await table.getByRole('button',{name:'Assign PIC for item '+id,exact:true}).click();
  await expect(table.getByRole('button',{name:'Assign PIC for item '+id,exact:true})).toBeDisabled();
 }
 await expect(table.getByLabel('PIC for item 21',{exact:true})).toHaveValue('2');
 await expect(table.getByLabel('PIC for item 22',{exact:true})).toHaveValue('2');
 expect(writes.map(w=>w.id)).toEqual([21,22]);
 expect(writes[0].body.ExpectedRowVersion).toBe(initial);
 expect(writes[1].body.ExpectedRowVersion).toBe(initial);
});
