import {test,expect,type Page} from '@playwright/test';
const rv='AAAAAAAAAAE=';
async function setup(page:Page,admin=true){
 const writes:any[]=[];
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:admin?'Admin':'Sales',user_id:1,is_admin:admin,scopes:admin?['Admin','Opportunity']:['Opportunity']}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/loss-defaults/lookups')return route.fulfill({json:{grades:[{ID:1,GradeName:'Cashews'},{ID:2,GradeName:'W210',ParentGradeID:1}],types:[{ID:10,ProcessType:'Sorting'},{ID:11,ProcessType:'Packing'}]}});
  if(path==='/api/loss-defaults'){
   if(route.request().method()==='POST'){const body=route.request().postDataJSON();writes.push(body);return route.fulfill({json:{rows:[{ID:1,RowVersion:rv}]}})}
   return route.fulfill({json:{rows:[{ID:1,RawGradeID:2,GradeName:'W210',ProcessTypeID:10,ProcessType:'Sorting',LossPct:'5',Status:'Active',RowVersion:rv}],total:1,page:1}});
  }
  return route.fulfill({json:{rows:[],total:0}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Loss Process Master',exact:true}).click();return writes;
}
test('Loss Process Master creates a grade/type default and common All grades Packing',async({page})=>{
 const writes=await setup(page);
 await expect(page.getByRole('button',{name:'Process Types',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'New loss default',exact:true}).click();
 let dialog=page.getByRole('dialog',{name:'New Loss Default',exact:true});
 await dialog.getByLabel('Grade',{exact:true}).selectOption('2');await dialog.getByLabel('Process Type',{exact:true}).selectOption('10');await dialog.getByLabel('Loss (%)',{exact:true}).fill('5.25');
 await dialog.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(dialog).not.toBeVisible();expect(writes[0]).toMatchObject({RawGradeID:2,ProcessTypeID:10,LossPct:'5.25'});
 await page.getByRole('button',{name:'New loss default',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'New Loss Default',exact:true});
 await expect(dialog.getByLabel('Grade',{exact:true})).toHaveValue('');
 await dialog.getByLabel('Process Type',{exact:true}).selectOption('11');await dialog.getByLabel('Loss (%)',{exact:true}).fill('2');
 await dialog.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[1]).toMatchObject({RawGradeID:null,ProcessTypeID:11,LossPct:'2'});
});
test('display-only Loss Process Master cannot save',async({page})=>{
 const writes=await setup(page,false);
 await expect(page.getByRole('button',{name:'New loss default',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'View Loss Default 1',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'View Loss Default',exact:true});
 await expect(dialog.getByLabel('Loss (%)',{exact:true})).toBeDisabled();
 await expect(dialog.getByRole('button',{name:'Review & save',exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Close Loss Default',exact:true}).click();expect(writes).toEqual([]);
});
