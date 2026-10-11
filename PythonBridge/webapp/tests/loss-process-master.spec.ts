import {captureRevealScrolls,expectReveal} from './reveal-scroll';
import {test,expect,type Page} from '@playwright/test';
const rv='AAAAAAAAAAE=';
async function open(page:Page,admin=true){
 const writes:any[]=[];
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:admin?'Admin':'Sales',user_id:1,is_admin:admin,scopes:admin?['Admin','Opportunity']:['Opportunity']}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/loss-processes'){
   if(route.request().method()==='POST'){writes.push(route.request().postDataJSON());return route.fulfill({json:{ID:1,RowVersion:rv}})}
   return route.fulfill({json:{rows:[{ID:1,ProcessType:'Sorting',Sequence:1,LossPct:'5',Status:'Active',RowVersion:rv}],total:1,page:1}});
  }
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('/workbench/');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Loss Master',exact:true}).click();
 await expect(page.getByRole('table',{name:'Loss Master'})).toBeVisible();
 return writes;
}
test('admin maintains a separate master and blocks existing entries with version guard',async({page})=>{
 const writes=await open(page);
 await page.getByRole('button',{name:'New loss process',exact:true}).click();
 let dialog=page.getByRole('dialog',{name:'New Loss Process',exact:true});
 await dialog.getByLabel('Process Type',{exact:true}).fill('Roasting custom');
 await expect(dialog.getByLabel('Loss %',{exact:true})).toHaveCount(0);
 await expect(dialog.getByLabel('Process sequence',{exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(dialog).not.toBeVisible();
 expect(writes[0]).toMatchObject({ID:null,ProcessType:'Roasting custom',Status:'Active'});
 await page.getByRole('button',{name:'View Loss Process 1',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'Edit Loss Process',exact:true});
 await dialog.getByLabel('Status',{exact:true}).selectOption('Block');
 await dialog.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(dialog).not.toBeVisible();
 expect(writes[1]).toMatchObject({ID:1,RowVersion:rv,Status:'Block'});
});
test('Opportunity users can inspect the master without editing',async({page})=>{
 const writes=await open(page,false);
 await expect(page.getByRole('button',{name:'New loss process',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'View Loss Process 1',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'View Loss Process',exact:true});
 await expect(dialog.getByRole('button',{name:'Review & save',exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Close Loss Process',exact:true}).click();
 await expect(dialog).not.toBeVisible();expect(writes).toEqual([]);
});

test('Add shared master record smoothly reveals the new section',async({page})=>{
 await captureRevealScrolls(page);await open(page);
 await page.getByRole('button',{name:'New loss process',exact:true}).click();
 await page.getByRole('button',{name:'+ Add record section',exact:true}).click();
 await expectReveal(page,null);
});

test('unified editor creates multiple sections through review without duplicate submissions',async({page})=>{
 const writes=await open(page);
 await page.getByRole('button',{name:'New loss process',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'New Loss Process',exact:true});
 await dialog.getByRole('region',{name:'Record 1',exact:true}).getByLabel('Process Type',{exact:true}).fill('Sorting custom');
 await dialog.getByRole('button',{name:'+ Add record section',exact:true}).click();
 await dialog.getByRole('region',{name:'Record 2',exact:true}).getByLabel('Process Type',{exact:true}).fill('Roasting custom');
 await dialog.getByRole('button',{name:'Review & save',exact:true}).click();
 expect(writes).toEqual([]);
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(dialog).not.toBeVisible();
 expect(writes.map(row=>row.ProcessType)).toEqual(['Sorting custom','Roasting custom']);
});
