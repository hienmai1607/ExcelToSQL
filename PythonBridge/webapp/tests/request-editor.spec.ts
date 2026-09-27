import {test,expect,type Page} from '@playwright/test';
async function setup(page:Page,failSecond=false){
 const writes:any[]=[];
 const rows=[1,2,3].map(id=>({RequestID:1,ItemID:id,ProductCode:'P'+id,ProductName:'Product '+id,ItemDescription:'Item '+id,ItemStage:id===3?'Approved':'Assigned',PICUserID:1,PIC:'Admin',ItemRowVersion:'AAAAAAAAAAE=',AnnualUnit:100,WeightGrams:10}));
 await page.route('**/api/**',route=>{
 const p=new URL(route.request().url()).pathname;
 if(p.endsWith('/session'))return route.fulfill({json:{username:'Admin',user_id:1,is_admin:true,scopes:['Admin']}});
 if(p.endsWith('/preferences'))return route.fulfill({json:{settings:{columns:['CustomerName'],filters:[],sort:[],page_size:25},version:0}});
 if(p==='/api/workbench/requests')return route.fulfill({json:{rows:[{RequestID:1,RequestNumber:'PCR-1',CustomerName:'Customer',OpportunityNumber:'OPP-1',RequestStatus:'Open',ItemCount:3}],total:1}});
 if(p==='/api/packaging/requests')return route.fulfill({json:{rows,total:30,page:1}});
 if(p==='/api/workbench/pics')return route.fulfill({json:{rows:[{ID:1,UserName:'Admin'},{ID:2,UserName:'PIC'}]}});
 if(p==='/api/packaging/lookups')return route.fulfill({json:{currencies:[{ID:1,CurrencyCode:'VND'}]}});
 if(p==='/api/packaging/response/batch'){const data=route.request().postDataJSON();writes.push(data);const r=data.rows[0];if(failSecond&&r.ID===2)return route.fulfill({json:{results:[{RowNum:1,Status:'ERROR',Message:'Conflict: refresh required.'}]}});Object.assign(rows.find(x=>x.ItemID===r.ID)!,r,{ItemRowVersion:'AAAAAAAAAAI='});return route.fulfill({json:{results:[{RowNum:1,Status:'OK'}]}})}
 if(p.endsWith('/assign')){writes.push(route.request().postDataJSON());return route.fulfill({json:{result:{RowVersion:'AAAAAAAAAAI='}}})}
 return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Packaging requests',exact:true}).click();
 return writes;
}
test('header editor saves multiple responses; details remain view only',async({page})=>{
 const writes=await setup(page);
 await page.getByRole('button',{name:'View request',exact:true}).click();
 const table=page.getByRole('table',{name:'Packaging request items'});
 await expect(table.getByRole('combobox')).toHaveCount(0);
 await expect(table.getByRole('button',{name:'Cancel request item'})).toHaveCount(0);
 await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'});
 for(const id of [1,2])await editor.getByRole('region',{name:'Request item '+id,exact:true}).getByLabel('Packaging description',{exact:true}).fill('Response '+id);
 await expect(editor.getByRole('region',{name:'Request item 3',exact:true}).getByLabel('Packaging description',{exact:true})).toBeDisabled();
 await editor.getByRole('button',{name:'Review & save'}).click();expect(writes).toHaveLength(0);
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('2 item(s) saved.');
 expect(writes.map(w=>w.rows[0].ID)).toEqual([1,2]);
 expect(writes[1].rows[0]).toMatchObject({PackagingDescription:'Response 2',RowVersion:'AAAAAAAAAAE='});
});
test('partial save preserves failed draft and never resends successful items',async({page})=>{
 const writes=await setup(page,true);await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'});
 for(const id of [1,2])await editor.getByRole('region',{name:'Request item '+id,exact:true}).getByLabel('Packaging description',{exact:true}).fill('Response '+id);
 await editor.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('alert')).toContainText('Conflict');
 await expect(editor.getByRole('region',{name:'Request item 2',exact:true}).getByLabel('Packaging description',{exact:true})).toHaveValue('Response 2');
 await editor.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(3);expect(writes.map(w=>w.rows[0].ID)).toEqual([1,2,2]);
});
test('assignment uses returned row version before saving the response',async({page})=>{
 const writes=await setup(page);await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'});
 await editor.getByLabel('PIC for item 1').selectOption('2');
 await editor.getByRole('region',{name:'Request item 1',exact:true}).getByLabel('Packaging description',{exact:true}).fill('Updated');
 await editor.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByRole('status')).toContainText('1 item(s) saved.');
 expect(writes[0]).toEqual({PICUserID:2,ExpectedRowVersion:'AAAAAAAAAAE='});
 expect(writes[1].rows[0].RowVersion).toBe('AAAAAAAAAAI=');
});
test('canceling discard keeps drafts on close and pagination',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'});
 const field=editor.getByRole('region',{name:'Request item 1',exact:true}).getByLabel('Packaging description',{exact:true});
 await field.fill('Keep draft');page.on('dialog',d=>d.dismiss());
 await editor.getByRole('button',{name:'Next',exact:true}).click();
 await expect(field).toHaveValue('Keep draft');
 await editor.getByRole('button',{name:'Close request editor',exact:true}).click();
 await expect(field).toHaveValue('Keep draft');
});

test('unknown save outcome prevents duplicate retries',async({page})=>{
 await setup(page);
 await page.route('**/api/packaging/response/batch',r=>r.fulfill({status:503,json:{detail:'Response lost'}}));
 await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'});
 await editor.getByRole('region',{name:'Request item 1',exact:true}).getByLabel('Packaging description',{exact:true}).fill('Keep me');
 await editor.getByRole('button',{name:'Review & save'}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(editor.getByText('Save outcome uncertain. Close and refresh before making further changes.')).toBeVisible();
 await expect(editor.getByRole('button',{name:'Review & save'})).toBeDisabled();
 await expect(editor.getByRole('region',{name:'Request item 1',exact:true}).getByLabel('Packaging description',{exact:true})).toHaveValue('Keep me');
});
test('request editor fits a mobile viewport',async({page})=>{
 await setup(page);await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Edit request PCR-1'}).click();
 const editor=page.getByRole('dialog',{name:'Edit Packaging request'});
 await expect(editor.getByRole('region',{name:'Request item 1',exact:true})).toBeVisible();
 expect(await editor.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
});
