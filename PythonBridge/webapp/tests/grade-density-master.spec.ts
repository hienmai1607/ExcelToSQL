import {test,expect,type Page} from '@playwright/test';
const rv='AAAAAAAAAAE=',hash='a'.repeat(64),combination=JSON.stringify([{NutsGrade:[['Almonds',1],['Whole',2]],Ratio:'1'}]);
async function setup(page:Page,scope='Admin'){
 const writes:any[]=[];
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/session'))return route.fulfill({json:{username:'Tester',user_id:1,is_admin:scope==='Admin',scopes:[scope]}});
  if(path.endsWith('/preferences'))return route.fulfill({json:{settings:{},version:0}});
  if(path==='/api/grade-densities/lookups')return route.fulfill({json:{rows:[{CombinationHash:hash,Combination:combination}]}});
  if(path==='/api/grade-densities'&&route.request().method()==='POST'){writes.push(route.request().postDataJSON());return route.fulfill({json:{ID:1}})}
  if(path==='/api/grade-densities')return route.fulfill({json:{rows:[{ID:1,Combination:combination,CombinationHash:hash,NutDensity:'.6',RowVersion:rv,UpdatedByName:'Tester'}],total:1,page:1}});
  return route.fulfill({json:{rows:[],total:0,page:1}});
 });
 await page.goto('./');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.getByRole('button',{name:'Grade Density Master',exact:true}).click();
 return writes;
}
test('density master follows shared layout and creates a selected grade combination',async({page})=>{
 const writes=await setup(page);
 await expect(page.getByRole('heading',{name:'Grade Density Master',exact:true})).toBeVisible();
 await expect(page.getByRole('cell',{name:'Almonds / Whole · 100%',exact:true})).toBeVisible();
 for(const label of ['Refresh','Sort options','Layout options','Excel local template'])await expect(page.getByRole('button',{name:label,exact:true})).toBeVisible();
 await expect(page.getByLabel('Search grade densities',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Status',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'New grade density',exact:true}).click();
 const form=page.getByRole('dialog',{name:'New grade density',exact:true});
 await form.getByLabel('Nuts / grades / ratio',{exact:true}).selectOption(hash);
 await form.getByLabel('Nut density (g/ml)',{exact:true}).fill('0.612345');
 await form.getByRole('button',{name:'Review & save',exact:true}).click();
 await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0]).toMatchObject({ID:null,CombinationHash:hash,NutDensity:'0.612345'});
});
test('density edits retain identity and row version, with immutable combination',async({page})=>{
 const writes=await setup(page,'Packaging');
 await page.getByRole('button',{name:'View grade density 1',exact:true}).click();
 const form=page.getByRole('dialog',{name:'Edit grade density',exact:true});
 await expect(form.getByLabel('Nuts / grades / ratio',{exact:true})).toHaveAttribute('readonly','');
 await form.getByLabel('Nut density (g/ml)',{exact:true}).fill('0.7');
 await form.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 expect(writes[0]).toMatchObject({ID:1,RowVersion:rv,CombinationHash:hash,NutDensity:'0.7'});
});
test('manager can view and close, but cannot maintain density defaults',async({page})=>{
 await setup(page,'PackagingManager');
 await expect(page.getByRole('button',{name:'New grade density',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'View grade density 1',exact:true}).click();
 const form=page.getByRole('dialog',{name:'View grade density',exact:true});
 await expect(form.getByLabel('Nut density (g/ml)',{exact:true})).not.toBeEditable();
 await form.getByRole('button',{name:'Close grade density',exact:true}).click();await expect(form).toHaveCount(0);
});
test('density conflict retains draft and mobile drawer fits',async({page})=>{
 await setup(page);
 await page.route('**/api/grade-densities',route=>route.fulfill({status:409,json:{detail:'Density default changed. Refresh before saving.'}}));
 await page.getByRole('button',{name:'View grade density 1',exact:true}).click();
 const form=page.getByRole('dialog',{name:'Edit grade density',exact:true});
 await page.setViewportSize({width:390,height:844});
 await form.getByLabel('Nut density (g/ml)',{exact:true}).fill('0.8');
 expect(await form.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await form.getByRole('button',{name:'Review & save',exact:true}).click();await page.getByRole('button',{name:'Confirm save',exact:true}).click();
 await expect(form).toContainText('Density default changed');
 await expect(form.getByLabel('Nut density (g/ml)',{exact:true})).toHaveValue('0.8');
});
